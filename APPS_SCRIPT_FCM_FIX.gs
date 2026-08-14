/**
 * ============================================================
 *  FIXED FCM BLOCK — Replace your existing FCM section with this
 *  Copy everything below and replace from:
 *    const FCM_PROJECT_ID...
 *  to the end of:
 *    function createStreakReminderTrigger() etc.
 *  Keep your other functions intact.
 * ============================================================
 */

const FCM_PROJECT_ID = PropertiesService.getScriptProperties().getProperty('FCM_PROJECT_ID') || 'ump-dashboard';
const FCM_CLIENT_EMAIL = PropertiesService.getScriptProperties().getProperty('FCM_CLIENT_EMAIL') || 'firebase-adminsdk-fbsvc@ump-dashboard.iam.gserviceaccount.com';

// Helper to base64url encode
function base64UrlEncode_(input) {
  return Utilities.base64Encode(input)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getFcmAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('fcm_access_token');
  if (cached) return cached;

  const rawKey = PropertiesService.getScriptProperties().getProperty('FCM_PRIVATE_KEY');
  if (!rawKey) {
    throw new Error('FCM_PRIVATE_KEY is missing in Script Properties. Go to Apps Script > Project Settings > Script Properties > Add FCM_PRIVATE_KEY');
  }
  // Handle both literal \n and real newlines
  const privateKey = rawKey.replace(/\\n/g, '\n').trim();

  if (privateKey.indexOf('BEGIN PRIVATE KEY') === -1) {
    throw new Error('FCM_PRIVATE_KEY does not look like a PEM private key. Make sure you copied the full key including BEGIN/END lines.');
  }

  // Allow overriding client email from properties too
  const clientEmail = FCM_CLIENT_EMAIL;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const signingInput = base64UrlEncode_(JSON.stringify(header)) + '.' + base64UrlEncode_(JSON.stringify(claimSet));

  let signatureBytes;
  try {
    signatureBytes = Utilities.computeRsaSha256Signature(signingInput, privateKey);
  } catch (e) {
    throw new Error('Failed to sign JWT — private key format invalid. Original error: ' + e.message);
  }

  const jwt = signingInput + '.' + base64UrlEncode_(signatureBytes);

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });

  const text = response.getContentText();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error('FCM auth returned non-JSON: ' + text.slice(0, 500));
  }

  if (!data.access_token) {
    throw new Error('FCM auth failed: ' + text);
  }

  cache.put('fcm_access_token', data.access_token, 3300); // ~55 min, token lives 60
  return data.access_token;
}

// --- DeviceTokens sheet helpers ---

function ensureDeviceTokensSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("DeviceTokens");
  if (!sheet) {
    sheet = ss.insertSheet("DeviceTokens");
    sheet.appendRow(["StudentID", "Token", "UpdatedAt", "UserAgent"]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#EFF6FF');
    sheet.setFrozenRows(1);
  }
  // Ensure 4th column exists for future
  if (sheet.getLastColumn() < 4) {
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue("UserAgent");
  }
  return sheet;
}

function saveDeviceToken(payload) {
  try {
    if (!payload || !payload.studentId || !payload.token) {
      throw new Error('studentId and token are required');
    }

    const studentId = normalizeId_(payload.studentId); // normalized UMP0001
    const token = String(payload.token).trim();
    if (token.length < 20) throw new Error('Token looks too short/invalid');

    const sheet = ensureDeviceTokensSheet_();
    const lastRow = sheet.getLastRow();
    const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];

    let updated = false;

    // Strategy: one row per unique token globally. If token already exists, update its studentId and timestamp.
    // This handles: same device logging in as different student, token refresh, etc.
    for (let i = 0; i < values.length; i++) {
      const existingToken = String(values[i][1] || '').trim();
      if (existingToken === token) {
        // Update StudentID + UpdatedAt
        sheet.getRange(i + 2, 1).setValue(studentId);
        sheet.getRange(i + 2, 3).setValue(new Date());
        if (payload.userAgent) {
          try { sheet.getRange(i + 2, 4).setValue(payload.userAgent); } catch (_){}
        }
        updated = true;
        Logger.log('Updated existing token row for ' + studentId);
        break;
      }
    }

    if (!updated) {
      sheet.appendRow([studentId, token, new Date(), payload.userAgent || '']);
      Logger.log('Inserted new token for ' + studentId);
    }

    // Optional cleanup: Keep only latest 10 tokens per student to avoid bloat
    const allRows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    const studentRows = [];
    allRows.forEach((r, idx) => {
      if (normalizeId_(r[0]) === studentId) studentRows.push({ idx: idx + 2, date: r[2] ? new Date(r[2]) : new Date(0) });
    });
    if (studentRows.length > 10) {
      studentRows.sort((a,b) => a.date - b.date); // oldest first
      const toDelete = studentRows.slice(0, studentRows.length - 10).map(r => r.idx).sort((a,b) => b-a);
      toDelete.forEach(rowNum => {
        try { sheet.deleteRow(rowNum); } catch(_){}
      });
    }

    return { success: true, updated: updated };
  } catch (err) {
    Logger.log('saveDeviceToken error: ' + err.message);
    throw err;
  }
}

function getTokensForStudent_(studentId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('DeviceTokens');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const wantedId = normalizeId_(studentId);
  if (!wantedId) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const tokens = [];
  const seen = new Set();
  rows.forEach(r => {
    const sid = normalizeId_(r[0]);
    const tok = String(r[1] || '').trim();
    if (sid === wantedId && tok && !seen.has(tok)) {
      seen.add(tok);
      tokens.push(tok);
    }
  });
  return tokens;
}

function getAllTokens_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('DeviceTokens');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const set = new Set();
  rows.forEach(r => {
    const tok = String(r[1] || '').trim();
    if (tok) set.add(tok);
  });
  return Array.from(set);
}

function removeDeviceToken_(token) {
  if (!token) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('DeviceTokens');
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  // Delete from bottom to avoid shift
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][1]).trim() === String(token).trim()) {
      sheet.deleteRow(i + 2);
      Logger.log('Removed stale token: ' + token.slice(0,20)+'...');
      return; // remove only first match (should be unique)
    }
  }
}

// --- Core sender with rich payload ---

function sendFcmToToken_(token, title, body, extra) {
  if (!token) return null;
  extra = extra || {};
  try {
    const accessToken = getFcmAccessToken_();
    const url = 'https://fcm.googleapis.com/v1/projects/' + FCM_PROJECT_ID + '/messages:send';

    // FCM v1 requires data values to be strings
    const safeTitle = String(title || 'UMP Dashboard').slice(0, 200);
    const safeBody = String(body || '').slice(0, 500);

    const dataPayload = {
      title: safeTitle,
      body: safeBody,
      link: String(extra.link || '/'),
      tag: String(extra.tag || 'ump-general'),
      timestamp: String(Date.now()),
    };

    // Merge custom data if provided (must be string=>string)
    if (extra.data) {
      Object.keys(extra.data).forEach(k => {
        dataPayload[k] = String(extra.data[k]);
      });
    }

    const payload = {
      message: {
        token: token,
        notification: {
          title: safeTitle,
          body: safeBody,
        },
        data: dataPayload,
        webpush: {
          notification: {
            title: safeTitle,
            body: safeBody,
            icon: '/icon/icon-192.png',
            badge: '/icon/icon-192.png',
          },
          fcm_options: {
            link: dataPayload.link,
          },
        },
        android: {
          priority: 'HIGH',
          notification: {
            icon: 'stock_ticker_update',
            color: '#2563EB',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      },
    };

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + accessToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const text = response.getContentText();
    let result;
    try { result = JSON.parse(text); } catch (_) { result = { raw: text }; }

    const code = response.getResponseCode();
    if (code >= 400 || (result && result.error)) {
      Logger.log('FCM send error code=' + code + ' for token ' + token.slice(0,20) + '... => ' + text.slice(0, 600));
      // Clean up invalid/unregistered tokens
      if (result && result.error) {
        const errStr = JSON.stringify(result.error).toLowerCase();
        if (
          errStr.indexOf('unregistered') !== -1 ||
          errStr.indexOf('invalid-argument') !== -1 ||
          errStr.indexOf('notregistered') !== -1 ||
          errStr.indexOf('invalid registration') !== -1
        ) {
          removeDeviceToken_(token);
        }
      }
      return null;
    }

    // Success
    return result;
  } catch (err) {
    Logger.log('sendFcmToToken_ failed: ' + err.message);
    return null;
  }
}

function sendPushToStudent(studentId, title, body, extra) {
  const tokens = getTokensForStudent_(studentId);
  if (tokens.length === 0) {
    Logger.log('No tokens for student ' + studentId);
    return { sent: 0, reason: 'no_tokens' };
  }
  let success = 0;
  tokens.forEach(t => {
    const res = sendFcmToToken_(t, title, body, extra || {});
    if (res) success++;
    Utilities.sleep(120); // small throttle to avoid burst limits
  });
  return { sent: success, total: tokens.length };
}

function sendPushToAll(title, body, extra) {
  const tokens = getAllTokens_();
  if (tokens.length === 0) {
    Logger.log('No tokens in DeviceTokens sheet');
    return { sent: 0, reason: 'no_tokens' };
  }
  let success = 0;
  tokens.forEach(t => {
    const res = sendFcmToToken_(t, title, body, extra || {});
    if (res) success++;
    Utilities.sleep(120);
  });
  return { sent: success, total: tokens.length };
}

function matchStudentsForNote_(ss, audience, group) {
  const students = readStudents_(ss);
  const groupMatches = (noteGroup, studentGroup) => {
    if (!noteGroup || noteGroup === 'Both Groups') return true;
    if (!studentGroup || studentGroup === 'Both Groups') return true;
    return noteGroup === studentGroup;
  };
  return students.filter(s => {
    const batchOk = !audience || audience === 'All Batches' || audience === s.batch;
    const groupOk = groupMatches(group, s.group);
    return batchOk && groupOk;
  }).map(s => s.id);
}

// Scheduled pushes — now pass link so notification click opens right page

function sendWeeklyReportPushes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const students = readStudents_(ss);
  students.forEach(s => {
    sendPushToStudent(s.id, '📊 Weekly report ready', 'Your weekly study report is ready — check it in Reports.', { link: '/#reports', tag: 'weekly-report' });
    Utilities.sleep(200);
  });
}

function sendDailyStreakReminders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const list = enrichStudents_(ss);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = fmtDate_(yesterday);

  list.forEach(s => {
    const t = s.tracker.find(x => x.date === yesterdayKey);
    const submittedYesterday = t && t.submitted;
    if (!submittedYesterday) {
      sendPushToStudent(s.id, '🔥 Streak break ho sakta hai!', "Kal ka study log nahi mila — jaldi entry daal do taaki streak na tootein.", { link: '/#tracker', tag: 'streak-reminder' });
      Utilities.sleep(200);
    }
  });
}

// Installer triggers — run once manually

function createWeeklyReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendWeeklyReportPushes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklyReportPushes')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();
  return 'Weekly report push trigger installed — runs every Monday ~9AM.';
}

function createStreakReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailyStreakReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyStreakReminders')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();
  return 'Streak reminder push trigger installed — runs daily ~7AM.';
}

// ---- TEST HELPERS ----

function testFcmAuth() {
  try {
    const token = getFcmAccessToken_();
    Logger.log('✅ FCM Auth OK, token length: ' + token.length);
    return 'OK';
  } catch (e) {
    Logger.log('❌ FCM Auth FAILED: ' + e.message);
    throw e;
  }
}

function testPushToStudent() {
  const studentId = 'UMP0001'; // <- change to a real ID that has a token
  const res = sendPushToStudent(studentId, 'Test from Apps Script', 'If you see this, backend FCM is working!', { link: '/', tag: 'test' });
  Logger.log(JSON.stringify(res));
  return res;
}

function testPushToAll() {
  const res = sendPushToAll('Test broadcast', 'Backend FCM broadcast test — ignore', { link: '/', tag: 'test-broadcast' });
  Logger.log(JSON.stringify(res));
  return res;
}

function debugDeviceTokens() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DeviceTokens');
  if (!sheet) return 'No sheet';
  const last = sheet.getLastRow();
  Logger.log('DeviceTokens rows: ' + (last-1));
  const vals = sheet.getRange(2, 1, Math.min(20, last-1), 3).getValues();
  vals.forEach((r,i)=> Logger.log((i+2)+': '+r[0]+' | '+String(r[1]).slice(0,30)+'... | '+r[2]));
  return last-1 + ' tokens total';
}

