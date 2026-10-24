const APPS_SCRIPT_URL = "/api/proxy";
const PRIVATE_ACTIONS = new Set(['getStats','getStudyLog','getWeeklyReports','getStudentMentorNotes','getStudentFeedback','getAnnouncements','getLeaderboard','notes.listForStudent','attendance.status','addStudyLog','deleteStudyLog','attendance.markAbsent','attendance.requestLeave','attendance.cancelLeave','feedback.read','saveDeviceToken','messages.thread','messages.send','ai.ask','ai.dailyTarget','ai.evaluate','revision.plan']);
let privateGeneration = 0;
const pushRequests = new Map();
async function retireWebPush(actor) {
  if (!actor?.studentId || !actor.password) return;
  const key = 'ump_fcm_token_' + actor.studentId;
  const token = localStorage.getItem(key);
  if (!token && !pushRequests.get(actor.studentId)?.size) return true;
  let timer;
  try {
    await Promise.race([Promise.allSettled([...(pushRequests.get(actor.studentId) || [])]), new Promise(resolve => { timer = setTimeout(resolve, 4000); })]);
  } finally { clearTimeout(timer); }
  localStorage.removeItem(key);
  if (!token) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch('/api/mentor/api/push/device-token/remove', {
      method: 'POST', keepalive: true, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Student-Id':actor.studentId, 'X-Session-Password':actor.password },
      body: JSON.stringify({ studentId:actor.studentId, token })
    });
    const data = await response.json();
    return response.ok && data?.result?.success === true;
  } catch { return false; }
  finally { clearTimeout(timeout); }
}
window.UMP_PRIVATE_EPOCH = () => privateGeneration;
const savedActor = () => { try { return JSON.parse(localStorage.getItem('ump_student') || 'null'); } catch { return null; } };
function privateChanged() {
  const error = new Error('Student session changed. Keep any draft and sign in again.');
  error.privateSessionChanged = true;
  return error;
}
window.UMP_CLEAR_PRIVATE_SESSION = (removeCredentials = true) => {
  privateGeneration++;
  const old = savedActor();
  if (old?.studentId) localStorage.removeItem(`ump_cache_${old.studentId}`);
  if (removeCredentials) localStorage.removeItem('ump_student');
  privateWorkspaceProof = null;
  if (removeCredentials) {
    window.dispatchEvent?.(new Event('ump:private-invalidated'));
    return retireWebPush(old);
  }
  return Promise.resolve();
};

async function callAPI(action, payload = {}) {

  if (action === 'messages.thread') {
    const secure = await readPrivateWorkspace('messages', payload.studentId);
    if (secure) return secure;
    throw privateChanged(); // Never downgrade a denied private inbox to ID-only.
  }
  const protectedCall = PRIVATE_ACTIONS.has(action);
  const epoch = privateGeneration;
  const actor = protectedCall ? savedActor() : null;
  if (protectedCall && (!actor?.studentId || !actor.password)) throw privateChanged();
  if (actor && payload.studentId && String(payload.studentId).trim().toUpperCase() !== actor.studentId.trim().toUpperCase()) throw privateChanged();
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(actor ? { 'X-Student-Id':actor.studentId, 'X-Session-Password':actor.password } : {})
    },
    body: JSON.stringify({
      action,
      payload
    })
  }).catch((error) => {
    if (action === 'addStudyLog') throw new Error('Save outcome is unknown. Keep this draft and check Study tracker before retrying.');
    throw error;
  });

  if (protectedCall) {
    const active = savedActor();
    if (epoch !== privateGeneration || active?.studentId !== actor.studentId || active?.password !== actor.password) throw privateChanged();
    if (response.status === 401 || response.status === 403) {
      if (typeof window.UMP_PRESERVE_TRACKER_DRAFT === 'function') window.UMP_PRESERVE_TRACKER_DRAFT();
      window.UMP_CLEAR_PRIVATE_SESSION();
      if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('ump:private-invalidated'));
      throw privateChanged();
    }
  }
  // Study Log transport/parse failures may occur after the write committed.
  // Preserve the existing result envelope; never manufacture a saved result.
  let data;
  try { data = await response.json(); }
  catch (error) {
    if (action === 'addStudyLog') throw new Error('Save outcome is unknown. Keep this draft and check Study tracker before retrying.');
    throw error;
  }
  if (protectedCall) {
    const active = savedActor();
    if (epoch !== privateGeneration || active?.studentId !== actor.studentId || active?.password !== actor.password) throw privateChanged();
  }
  if (protectedCall && action !== 'addStudyLog' && !response.ok) throw new Error('Private data could not refresh.');
  if (action === 'addStudyLog') {
    if (!response.ok || !data || data.error || data.result?.success !== true) {
      throw new Error(data?.result?.message || 'Save outcome is unknown. Keep this draft and check Study tracker before retrying.');
    }
    return data.result;
  }

  if (data.error) {
    throw new Error(data.error);
  }

  if (action === 'getAnnouncements') {
    const secure = await readPrivateWorkspace('announcements');
    const active = savedActor();
    if (epoch !== privateGeneration || active?.studentId !== actor.studentId || active?.password !== actor.password) throw privateChanged();
    return [...new Map([...(secure?.announcements || []), ...(Array.isArray(data.result) ? data.result : [])].map(row => [row.id || JSON.stringify([row.title, row.message, row.body, row.date]), row])).values()];
  }
  return data.result;
}

// Read-only, credential-proven inbox. Never stores a bearer token persistently.
let privateWorkspaceProof = null;
async function readPrivateWorkspace(section, expectedStudentId) {
  const saved = () => { try { return JSON.parse(localStorage.getItem('ump_student') || 'null'); } catch { return null; } };
  const session = saved();
  if (!session?.studentId || !session.password || (expectedStudentId && expectedStudentId !== session.studentId)) { privateWorkspaceProof = null; return null; }
  const epoch = privateGeneration;
  const unchanged = () => { const active = saved(); return epoch === privateGeneration && active?.studentId === session.studentId && active.password === session.password; };
  const base = '/api/mentor/api/mentor-workspace/student';
  try {
    if (!privateWorkspaceProof || privateWorkspaceProof.studentId !== session.studentId || privateWorkspaceProof.password !== session.password || privateWorkspaceProof.expiresAt < Date.now()) {
      privateWorkspaceProof = null;
      const response = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: session.studentId, password: session.password }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) return null;
      const proof = await response.json();
      if (proof.studentId !== session.studentId || typeof proof.token !== 'string' || !proof.token || !unchanged()) return null;
      privateWorkspaceProof = { studentId: session.studentId, password: session.password, token: proof.token, expiresAt: Date.now() + 720000 };
    }
    const response = await fetch(base + '/' + section, { headers: { 'X-Workspace-Token': privateWorkspaceProof.token }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) { if ([401,403].includes(response.status)) privateWorkspaceProof = null; return null; }
    const data = await response.json();
    if (data.studentId !== session.studentId || !unchanged()) { privateWorkspaceProof = null; return null; }
    return data;
  } catch { return null; }
}

async function uploadStudyProof(studentId, file) {
  const actor=savedActor(), epoch=privateGeneration;
  if(!actor?.password || actor.studentId!==studentId) throw privateChanged();
  const capability=await fetch('/api/proof-capabilities',{headers:{'X-Student-Id':actor.studentId,'X-Session-Password':actor.password},redirect:'error',cache:'no-store'});
  const support=await capability.json();
  const ready=savedActor();
  if(epoch!==privateGeneration || ready?.studentId!==actor.studentId || ready?.password!==actor.password) throw privateChanged();
  if(capability.status!==200 || support?.protocol!=='private-v1' || support?.private!==true || support?.maxBytes!==10*1024*1024) throw new Error('Private proof upload is unavailable. Keep your draft; no file was uploaded.');
  const binary=atob(String(file.base64||''));
  if(!binary.length || binary.length>10*1024*1024) throw new Error('Study proof must be between 1 byte and 10 MB.');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const response=await fetch('/api/proof-upload',{method:'PUT',redirect:'error',cache:'no-store',headers:{'Content-Type':file.mimeType,'X-File-Name':encodeURIComponent(file.fileName||'proof'),'X-Student-Id':actor.studentId,'X-Session-Password':actor.password,'X-Proof-Protocol':'private-v1'},body:bytes}).catch(()=>{throw new Error('Proof upload outcome is unknown. Keep your draft and check before retrying.');});
  const current=savedActor();
  if(epoch!==privateGeneration || current?.studentId!==actor.studentId || current?.password!==actor.password) throw privateChanged();
  let data;try{data=await response.json();}catch{throw new Error('Proof upload outcome is unknown. Keep your draft and check before retrying.');}
  if(!response.ok || data?.success!==true || data?.ok===false || data?.error || typeof data.proofUrl!=='string' || !data.proofUrl.trim()) throw new Error('Proof upload was not acknowledged. Keep this draft; do not submit it again until checked.');
  const url=new URL(data.proofUrl,window.location.origin);
  if(url.username || url.password || url.origin!==window.location.origin || url.pathname!=='/api/proof-file' || url.hash || [...url.searchParams.keys()].some(k=>k!=='fileId') || url.searchParams.getAll('fileId').length!==1) throw new Error('Invalid proof acknowledgement.');
  return url.origin===window.location.origin ? url.pathname+url.search : url.href;
}
async function readPrivateStudyProof(value) {
  const url=new URL(value,window.location.origin);
  if(url.origin!==window.location.origin || url.pathname!=='/api/proof-file' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(k=>k!=='fileId') || url.searchParams.getAll('fileId').length!==1) throw new Error('Invalid private proof link.');
  const actor=savedActor(),epoch=privateGeneration;
  if(!actor?.studentId || !actor.password) throw privateChanged();
  const response=await fetch(url.href,{headers:{'X-Student-Id':actor.studentId,'X-Session-Password':actor.password},cache:'no-store',redirect:'error'});
  if(!response.ok) throw new Error('Private proof unavailable.');
  const mimeType=(response.headers.get('Content-Type')||'').split(';')[0];
  if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(mimeType) || !response.body) throw new Error('Invalid proof response.');
  const reader=response.body.getReader(), chunks=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>10*1024*1024)throw new Error('Proof exceeds 10 MB.');chunks.push(value);}}
  finally {await reader.cancel().catch(()=>{});}
  const current=savedActor();
  if(epoch!==privateGeneration || current?.studentId!==actor.studentId || current?.password!==actor.password) throw privateChanged();
  if(!size)throw new Error('Proof is empty.');
  return new Blob(chunks,{type:mimeType});
}

window.UMP_API = {

  validateLogin(studentId, password) {
    return callAPI("validateLogin", { studentId, password });
  },

  validateStudent(studentId) {
    return callAPI("validateStudent", { studentId });
  },

  changePassword(studentId, currentPassword, newPassword) {
    return callAPI("changePassword", {
      studentId,
      currentPassword,
      newPassword
    });
  },

  forgotPassword(studentId, email) {
  return callAPI("forgotPassword", {
    studentId,
    email
  });
},

  getStats(studentId) {
    return callAPI("getStats", { studentId });
  },

  getStudyLog(studentId) {
    return callAPI("getStudyLog", { studentId });
  },

  async addStudyLog(studentId, entry) {
    if(!entry.proofFile) return callAPI("addStudyLog", {studentId,...entry});
    const proofUrl=await uploadStudyProof(studentId,entry.proofFile);
    const {proofFile,...fields}=entry;
    return callAPI("addStudyLog",{studentId,...fields,proofUrl});
  },

  getPrivateProof(value) { return readPrivateStudyProof(value); },

  deleteStudyLog(studentId, entry) {
    return callAPI("deleteStudyLog", { studentId, ...entry });
  },

  getLeaderboard() {
    return callAPI("getLeaderboard");
  },

  getWeeklyReports(studentId) {
    return callAPI("getWeeklyReports", { studentId });
},

  testConnection() {
    return Promise.resolve(true);
  },

  getMentorFeedback(studentId) {
    return callAPI("getStudentFeedback", { studentId });
  },

  getAnnouncements() {
    return callAPI("getAnnouncements");
  },

  getNotes(studentId) {
  return callAPI("notes.listForStudent", { studentId });
},

  getStudentMentorNotes(studentId) {
    return callAPI("getStudentMentorNotes", { studentId });
  },


verifyOTP(studentId, otp) {
    return callAPI("verifyOTP", {
        studentId,
        otp
    });
},
  resetPassword(studentId, password) {
  return callAPI("resetPassword", {
    studentId,
    password
  });
},
markMentorFeedbackRead(id) {
  return callAPI("feedback.read", { id });
},
  saveDeviceToken(studentId, token) {
  const actor = savedActor();
  if (!actor?.password || actor.studentId !== studentId) return Promise.reject(privateChanged());
  // Persist a possible binding before transport, not a success claim.
  localStorage.setItem('ump_fcm_token_' + studentId, token);
  const work = callAPI("saveDeviceToken", { studentId, token });
  const jobs = pushRequests.get(studentId) || new Set();
  jobs.add(work); pushRequests.set(studentId, jobs);
  void work.finally(() => { jobs.delete(work); if (!jobs.size) pushRequests.delete(studentId); }).catch(() => undefined);
  return work;
},
};
