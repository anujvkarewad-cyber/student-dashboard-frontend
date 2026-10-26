/* UMP MCQ cloud backup / restore — classic browser script (no ESM, no TypeScript).
 *
 * History: the previous file was copied verbatim from the mobile TypeScript
 * project. It opened with `import { config } from '../config'` and
 * `import { getSavedSession } from '../storage/session'` — paths that do not
 * exist in this web root — and it contained type annotations, so it could never
 * execute in a browser no matter how it was loaded. As a result
 * window.UMP_MCQ_CLOUD stayed undefined and mentor-side MCQ backup was silently
 * switched off (every caller in learning-tools.js is guarded by
 * `window.UMP_MCQ_CLOUD &&`, so nothing crashed).
 *
 * This rewrite keeps the same public surface — queue(daily, practice) and
 * restore() — and talks to the same mentor endpoints, which are live and
 * reachable through the student service:
 *     POST {apiBase}/api/student-attempts/sync      {studentId, password, attempts}
 *     POST {apiBase}/api/student-attempts/restore   {studentId, password}
 * The backend models forbid extra keys (`extra="forbid"`), so this file sends
 * exactly the allowed fields and sanitises every payload before sending.
 */
(function () {
  "use strict";

  var SYNC_PATH = "/api/student-attempts/sync";
  var RESTORE_PATH = "/api/student-attempts/restore";
  var MAX_ATTEMPTS = 300;
  var INFLIGHT_RESTORES = new Map();

  function apiBase() {
    return String(
      (window.UMP_MENTOR_API_URL && window.UMP_MENTOR_API_URL()) ||
      window.MENTOR_API_URL ||
      "/api/mentor"
    ).replace(/\/+$/, "");
  }

  function session() {
    try {
      var raw = JSON.parse(localStorage.getItem("ump_student") || "null") || {};
      var studentId = String(raw.studentId || "").trim().toUpperCase();
      var password = String(raw.password || "");
      if (!studentId || !password) return null;
      return { studentId: studentId, password: password };
    } catch (_) {
      return null;
    }
  }

  function post(path, payload) {
    var current = session();
    if (!current) {
      return Promise.reject(new Error("Student login is required for MCQ cloud backup"));
    }
    return fetch(apiBase() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ studentId: current.studentId, password: current.password }, payload)),
    }).then(function (response) {
      if (!response.ok) throw new Error("MCQ cloud request failed (" + response.status + ")");
      return response.json().then(function(data) {
        var active = session();
        if (!active || active.studentId !== current.studentId || active.password !== current.password) throw new Error('Account changed during MCQ sync');
        return data;
      });
    });
  }

  // ---------- payload building (bounded to what the backend accepts) ----------
  function int(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? Math.round(n) : fallback;
  }

  function txt(value, max, fallback) {
    var s = String(value == null ? "" : value).trim();
    if (!s) s = fallback || "";
    return s.slice(0, max);
  }

  function cleanReview(review) {
    if (!Array.isArray(review)) return null;
    var out = review.filter(function (item) {
      return item && typeof item.id === "string" && item.id.length > 0;
    }).slice(0, 50);
    return out.length ? out : null;
  }

  function cleanAnswers(answers) {
    var out = {};
    var keys = answers && typeof answers === "object" ? Object.keys(answers).slice(0, 50) : [];
    keys.forEach(function (key) {
      var choice = int(answers[key], -1);
      if (choice >= 0 && choice <= 3) out[key] = choice;
    });
    return out;
  }

  function cleanConfig(config) {
    var c = config && typeof config === "object" ? config : {};
    return {
      group: txt(c.group, 32, "Combined"),
      subject: txt(c.subject, 80, "All Subjects"),
      chapter: txt(c.chapter, 240, "All Chapters"),
      mode: txt(c.mode, 32, "Mixed"),
      difficulty: txt(c.difficulty, 32, "Mixed"),
      requestedCount: Math.min(50, Math.max(1, int(c.requestedCount, 10))),
    };
  }

  function toCloud(attempt, kind, attemptId) {
    if (!attempt || !attempt.completedAt) return null; // only completed attempts travel
    var ids = (Array.isArray(attempt.questionIds) ? attempt.questionIds : [])
      .filter(function (id) { return typeof id === "string" && id.length > 0; })
      .slice(0, 50);
    if (!ids.length) return null;
    var payload = {
      attemptId: String(attemptId || "").slice(0, 180),
      kind: kind,
      bankRevision: txt(attempt.bankRevision, 120, "unknown"),
      questionIds: ids,
      answers: cleanAnswers(attempt.answers),
      startedAt: Math.max(0, int(attempt.startedAt, 0)),
      completedAt: Math.max(0, int(attempt.completedAt, 0)),
      score: Math.min(50, Math.max(0, int(attempt.score, 0))),
      total: Math.min(50, Math.max(1, int(attempt.total, ids.length) || ids.length)),
      durationSeconds: Math.min(86400, Math.max(0, int(attempt.durationSeconds, 0))),
    };
    if (!payload.attemptId) return null;
    if (kind === "daily") {
      if (attempt.officialSetId) payload.officialSetId = txt(attempt.officialSetId, 64, "");
      payload.date = txt(attempt.date, 16, "");
      payload.group = txt(attempt.group, 32, "");
    } else {
      payload.config = cleanConfig(attempt.config);
    }
    var review = cleanReview(attempt.review);
    if (review) payload.review = review;
    return payload;
  }

  // ---------- public API ----------
  function officialDaily(group) { return post('/api/student-attempts/daily-set', { group: group }); }

  function syncCompletedMcqAttempts(daily, practice) {
    var attempts = [];
    (Array.isArray(daily) ? daily : []).forEach(function (attempt) {
      var clean = toCloud(attempt, "daily", "daily:" + (attempt && attempt.date) + ":" + (attempt && attempt.group));
      if (clean) attempts.push(clean);
    });
    (Array.isArray(practice) ? practice : []).forEach(function (attempt) {
      var clean = toCloud(attempt, "practice", attempt && attempt.id);
      if (clean) attempts.push(clean);
    });
    if (!attempts.length) return Promise.resolve({ ok: true, accepted: 0 });
    // Fire-and-forget callers: never reject, just log, so the UI can never break.
    var batch = attempts.slice(-MAX_ATTEMPTS);
    return post(SYNC_PATH, { attempts: batch }).then(function (ack) {
      if (!ack || ack.ok !== true || ack.accepted !== batch.length) throw new Error('MCQ backup acknowledgement incomplete');
      return ack;
    }).catch(function (error) {
      console.warn("[MCQ Cloud] Backup skipped:", error.message);
      return { ok: false, accepted: 0 };
    });
  }

  function strip(item) {
    var out = {};
    Object.keys(item || {}).forEach(function (key) {
      if (key !== "attemptId" && key !== "kind") out[key] = item[key];
    });
    return out;
  }

  function restoreMcqAttempts() {
    var owner = (session() || {}).studentId;
    if (!owner) return Promise.reject(new Error('Student login required'));
    if (INFLIGHT_RESTORES.has(owner)) return INFLIGHT_RESTORES.get(owner);
    var restoring = post(RESTORE_PATH, {}).then(function (data) {
      return {
        daily: ((data && data.daily) || []).map(strip),
        practice: ((data && data.practice) || []).map(function (item) {
          var attempt = strip(item);
          attempt.id = item && item.attemptId ? item.attemptId : attempt.id;
          return attempt;
        }),
      };
    });
    INFLIGHT_RESTORES.set(owner, restoring);
    var clear = function () { if (INFLIGHT_RESTORES.get(owner) === restoring) INFLIGHT_RESTORES.delete(owner); };
    restoring.then(clear, clear);
    return restoring;
  }

  window.UMP_MCQ_CLOUD = { officialDaily: officialDaily,
    queue: syncCompletedMcqAttempts,
    sync: syncCompletedMcqAttempts,
    restore: restoreMcqAttempts,
    version: "web-1.0.0",
  };
})();
