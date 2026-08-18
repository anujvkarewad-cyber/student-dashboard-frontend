/** Share MCQ chapter summaries with the mentor dashboard. */
(function () {
  "use strict";

  function apiBase() {
    return String(
      (window.UMP_MENTOR_API_URL && window.UMP_MENTOR_API_URL()) ||
      window.MENTOR_API_URL ||
      "https://ujjwal-pathak-mentor-api.onrender.com"
    ).replace(/\/$/, "");
  }

  function studentId() {
    try {
      return (JSON.parse(localStorage.getItem("ump_student") || "null") || {}).studentId || "";
    } catch (_) {
      return "";
    }
  }

  function flagKey(id) {
    return "ump_share_progress_" + id;
  }

  function isOn(id) {
    return localStorage.getItem(flagKey(id)) === "1";
  }

  function setLocal(id, on) {
    if (on) localStorage.setItem(flagKey(id), "1");
    else localStorage.removeItem(flagKey(id));
  }

  function readJson(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function bandOf(pct) {
    if (pct >= 85) return "Mastered";
    if (pct >= 70) return "Strong";
    if (pct >= 50) return "Medium";
    return "Weak";
  }

  function rangeOf(pct) {
    if (pct >= 85) return "85-100";
    if (pct >= 70) return "70-84";
    if (pct >= 50) return "50-69";
    return "0-49";
  }

  function mondayOf(ts) {
    const d = new Date(ts);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  function buildPayload(id) {
    const questions = (window.UMP_LEARNING_DATA && window.UMP_LEARNING_DATA.questions) || [];
    const byId = {};
    questions.forEach((q) => { if (q && q.id) byId[q.id] = q; });
    const sessions = readJson("ump_mcq_daily_" + id).concat(readJson("ump_mcq_practice_" + id));
    const byChapter = {};
    const weekMap = {};
    sessions.forEach((session) => {
      if (!session || !session.completedAt) return;
      (session.questionIds || []).forEach((qid) => {
        const q = byId[qid];
        const ans = (session.answers || {})[qid];
        if (!q || !q.chapterId || ans == null) return;
        const correct = Number(ans) === Number(q.answer);
        const bucket = byChapter[q.chapterId] || {
          correct: 0, answered: 0, lastTs: 0, subject: q.subject || "",
        };
        bucket.correct += correct ? 1 : 0;
        bucket.answered += 1;
        bucket.lastTs = Math.max(bucket.lastTs, Number(session.completedAt) || Date.now());
        byChapter[q.chapterId] = bucket;
        const week = mondayOf(session.completedAt);
        const wk = weekMap[q.chapterId] || {};
        const cell = wk[week] || { correct: 0, answered: 0 };
        cell.correct += correct ? 1 : 0;
        cell.answered += 1;
        wk[week] = cell;
        weekMap[q.chapterId] = wk;
      });
    });
    const summaries = Object.keys(byChapter).sort().slice(0, 94).map((chapterId) => {
      const b = byChapter[chapterId];
      const pct = b.answered ? (b.correct / b.answered) * 100 : 0;
      const day = new Date(b.lastTs);
      const y = day.getFullYear();
      const m = String(day.getMonth() + 1).padStart(2, "0");
      const d = String(day.getDate()).padStart(2, "0");
      return {
        studentId: id,
        chapterId,
        masteryBand: bandOf(pct),
        attemptCount: b.answered,
        accuracyRange: rangeOf(pct),
        lastActivityDate: y + "-" + m + "-" + d,
        weakConceptTags: pct < 50 ? [b.subject].filter(Boolean) : [],
      };
    });
    const trend = [];
    Object.keys(weekMap).forEach((chapterId) => {
      Object.keys(weekMap[chapterId]).sort().slice(-12).forEach((week) => {
        const b = weekMap[chapterId][week];
        const pct = b.answered ? (b.correct / b.answered) * 100 : 0;
        trend.push({
          weekStart: week,
          chapterId,
          masteryBand: bandOf(pct),
          attemptCount: b.answered,
          accuracyRange: rangeOf(pct),
        });
      });
    });
    return { summaries, trend };
  }

  async function setSharing(on) {
    const id = studentId();
    if (!id) throw new Error("Login required");
    const res = await fetch(apiBase() + "/api/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: id, sharing: on, device: "web" }),
    });
    if (!res.ok) throw new Error("Could not save sharing");
    setLocal(id, on);
    if (on) await syncNow();
  }

  async function syncNow() {
    const id = studentId();
    if (!id || !isOn(id)) return;
    const payload = buildPayload(id);
    if (!payload.summaries.length) return;
    await fetch(apiBase() + "/api/progress-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sync-Token": "web" },
      body: JSON.stringify({ studentId: id, summaries: payload.summaries, trend: payload.trend }),
    });
  }

  function paint() {
    const btn = document.getElementById("share-progress-btn");
    const text = document.getElementById("share-progress-text");
    const card = document.getElementById("share-progress-card");
    const id = studentId();
    if (!btn || !id) return;
    const on = isOn(id);
    btn.textContent = on ? "Turn off" : "Turn on";
    if (text) {
      text.textContent = on
        ? "Sharing ON — mentor chapter summaries dekh sakte hain. Raw answers nahi jaate."
        : "Mentor sirf chapter-level summary dekhenge — raw answers nahi.";
    }
    if (card) card.style.border = on ? "1px solid #86EFAC" : "";
    if (!btn.dataset.wired) {
      btn.dataset.wired = "1";
      btn.addEventListener("click", async () => {
        const next = !isOn(id);
        btn.disabled = true;
        btn.textContent = "Saving…";
        try {
          await setSharing(next);
        } catch (err) {
          alert(err.message || "Could not save sharing");
        }
        btn.disabled = false;
        paint();
      });
    }
  }

  window.UMP_PROGRESS_SHARE = { paint, syncNow, setSharing, isOn };
})();
