/**
 * Authenticated cloud backup/restore for completed MCQ attempts.
 */
(function () {
  "use strict";

  const DEFAULT_API = "https://ujjwal-pathak-mentor-api.onrender.com";
  function apiBase() {
    return (
      (window.UMP_MENTOR_API_URL && window.UMP_MENTOR_API_URL()) ||
      window.MENTOR_API_URL ||
      DEFAULT_API
    ).replace(/\/$/, "");
  }
  const pending = new Map();
  let flushTimer = null;
  let restorePromise = null;

  function savedCredentials() {
    try {
      const saved = JSON.parse(localStorage.getItem("ump_student") || "null");
      return saved?.studentId && saved?.password
        ? { studentId: saved.studentId, password: saved.password }
        : null;
    } catch (_) {
      return null;
    }
  }

  async function post(path, payload) {
    const credentials = savedCredentials();
    if (!credentials) throw new Error("Student login is required for MCQ cloud backup");
    const response = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...credentials, ...payload }),
    });
    if (!response.ok) throw new Error(`MCQ cloud request failed (${response.status})`);
    return response.json();
  }

  function dailyCloudAttempt(attempt) {
    if (!attempt?.completedAt || !attempt.date || !attempt.group) return null;
    return {
      attemptId: `daily:${attempt.date}:${attempt.group}`,
      kind: "daily",
      bankRevision: String(attempt.bankRevision || "unknown"),
      date: attempt.date,
      group: attempt.group,
      questionIds: attempt.questionIds || [],
      answers: attempt.answers || {},
      startedAt: Number(attempt.startedAt || 0),
      completedAt: Number(attempt.completedAt),
      score: Number(attempt.score || 0),
      total: Number(attempt.total || 0),
      durationSeconds: Number(attempt.durationSeconds || 0),
      review: Array.isArray(attempt.review) ? attempt.review : [],
    };
  }

  function practiceCloudAttempt(attempt) {
    if (!attempt?.completedAt || !attempt.id || !attempt.config) return null;
    return {
      attemptId: attempt.id,
      kind: "practice",
      bankRevision: String(attempt.bankRevision || "unknown"),
      config: attempt.config,
      questionIds: attempt.questionIds || [],
      answers: attempt.answers || {},
      startedAt: Number(attempt.startedAt || 0),
      completedAt: Number(attempt.completedAt),
      score: Number(attempt.score || 0),
      total: Number(attempt.total || 0),
      durationSeconds: Number(attempt.durationSeconds || 0),
      review: Array.isArray(attempt.review) ? attempt.review : [],
    };
  }

  function fromCloud(attempt) {
    const copy = { ...attempt };
    delete copy.kind;
    delete copy.attemptId;
    if (attempt.kind === "practice") copy.id = attempt.attemptId;
    return copy;
  }

  async function flush() {
    flushTimer = null;
    if (!pending.size) return;
    const attempts = [...pending.values()];
    pending.clear();
    try {
      await post("/api/student-attempts/sync", { attempts });
      window.UMP_MCQ_CLOUD_STATUS = { state: "synced", at: Date.now(), count: attempts.length };
    } catch (error) {
      attempts.forEach((attempt) => pending.set(`${attempt.kind}:${attempt.attemptId}`, attempt));
      window.UMP_MCQ_CLOUD_STATUS = { state: "error", at: Date.now(), error: error.message };
      console.warn("[MCQ Cloud] Backup delayed:", error.message);
    }
  }

  function queue(daily = [], practice = []) {
    daily.map(dailyCloudAttempt).filter(Boolean).forEach((attempt) => {
      pending.set(`${attempt.kind}:${attempt.attemptId}`, attempt);
    });
    practice.map(practiceCloudAttempt).filter(Boolean).forEach((attempt) => {
      pending.set(`${attempt.kind}:${attempt.attemptId}`, attempt);
    });
    if (!pending.size) return;
    window.UMP_MCQ_CLOUD_STATUS = { state: "pending", at: Date.now(), count: pending.size };
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1200);
  }

  async function restore() {
    if (restorePromise) return restorePromise;
    restorePromise = (async () => {
      const data = await post("/api/student-attempts/restore", {});
      return {
        daily: (data.daily || []).map(fromCloud),
        practice: (data.practice || []).map(fromCloud),
      };
    })();
    try {
      return await restorePromise;
    } finally {
      restorePromise = null;
    }
  }

  window.UMP_MCQ_CLOUD = { queue, flush, restore };
})();
