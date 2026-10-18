(function () {
  "use strict";

  let learningData = window.UMP_LEARNING_DATA || { questions: [], manifest: {}, revision: "unknown" };
  let questions = Array.isArray(learningData.questions) ? learningData.questions : [];
  let QUESTION_BY_ID = new Map(questions.map((question) => [question.id, question]));
  const SUBJECTS = ["Accounts", "Law", "Taxation", "Costing", "Audit", "FM", "SM", "Revision", "Mock Test"];
  const GROUPS = ["Group I", "Group II"];
  const DAILY_SECONDS = 10 * 60;
  const DAILY_GOAL_SECONDS = 8 * 60 * 60;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const LETTERS = ["A", "B", "C", "D"];

  let activeRoot = null;
  let activeStudent = null;
  let activeFeature = null;
  let clockTimer = null;
  let wakeLock = null;
  let visibilityListenerInstalled = false;
  let focusReceiptSessionId = null;
  let dailyAutoSubmitting = false;
  const cloudRestoredStudents = new Set();

  const mcqUi = {
    mode: "daily",
    selectedGroup: null,
    dailyIndex: 0,
    practiceIndex: 0,
    practiceResult: null,
    practiceConfig: null,
  };

  const idleFocusTimer = () => ({
    status: "idle",
    subject: "Accounts",
    target: "",
    startedAt: null,
    sessionStartedAt: null,
    elapsedBeforeRun: 0,
  });

  const $ = (selector, root = activeRoot) => root ? root.querySelector(selector) : null;
  const escapeHtml = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  const escapeAttr = escapeHtml;

  function studentId() {
    return String(activeStudent?.studentId || "guest");
  }

  function loadJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.warn("Could not restore local learning data:", key, error);
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn("Could not save local learning data:", key, error);
    }
  }

  const focusTimerKey = () => `ump_focus_timer_${studentId()}`;
  const focusHistoryKey = () => `ump_focus_sessions_${studentId()}`;
  const receiptsKey = () => `ump_study_receipts_${studentId()}`;
  const dailyKey = () => `ump_daily_mcq_${studentId()}`;
  const practiceKey = () => `ump_mcq_practice_${studentId()}`;

  function currentFocusTimer() {
    return { ...idleFocusTimer(), ...loadJson(focusTimerKey(), {}) };
  }

  function focusSessions() {
    const value = loadJson(focusHistoryKey(), []);
    return Array.isArray(value) ? value : [];
  }

  function studyReceipts() {
    const value = loadJson(receiptsKey(), []);
    return Array.isArray(value) ? value : [];
  }

  function setClockUpdater(updater) {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    if (updater) clockTimer = setInterval(updater, 1000);
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;
    try { await wakeLock.release(); } catch (_) { /* already released */ }
    wakeLock = null;
  }

  async function requestWakeLock() {
    if (!activeRoot || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
    try {
      if (!wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (error) {
      console.info("Screen wake lock is unavailable; the timer still uses timestamps.", error);
    }
  }

  function installVisibilityHandler() {
    if (visibilityListenerInstalled) return;
    visibilityListenerInstalled = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && activeRoot && activeFeature === "focus" && currentFocusTimer().status === "running") {
        requestWakeLock();
      }
    });
  }

  function cleanup() {
    setClockUpdater(null);
    activeRoot = null;
    activeFeature = null;
    releaseWakeLock();
  }

  function formatTimer(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function formatCompact(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m`;
    return `${safe}s`;
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const minutes = Math.floor(safe / 60);
    const secs = safe % 60;
    return minutes ? `${minutes}m ${secs}s` : `${secs}s`;
  }

  function isToday(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }

  function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDate(timestamp, includeTime = false) {
    const options = { day: "2-digit", month: "short" };
    if (includeTime) Object.assign(options, { hour: "2-digit", minute: "2-digit" });
    return new Date(timestamp).toLocaleString("en-IN", options);
  }

  function elapsedFor(timer, now = Date.now()) {
    if (timer.status !== "running" || !timer.startedAt) return Number(timer.elapsedBeforeRun || 0);
    return Number(timer.elapsedBeforeRun || 0) + Math.max(0, Math.floor((now - timer.startedAt) / 1000));
  }

  function groupsForStudent(group) {
    const value = String(group || "").toLowerCase();
    if (/both|group\s*(i|1)\s*(&|and|\+)\s*(ii|2)/.test(value)) return [...GROUPS];
    const hasOne = /group\s*(i|1)\b/.test(value);
    const hasTwo = /group\s*(ii|2)\b/.test(value);
    if (hasOne && !hasTwo) return ["Group I"];
    if (hasTwo && !hasOne) return ["Group II"];
    return [...GROUPS];
  }

  function subjectGroup(subject) {
    const value = String(subject || "").trim().toLowerCase();
    if (/cost|costing|audit|auditing|financial management|strategic management/.test(value)
      || /^(fm|sm)(\b|\s|&)/.test(value) || value === "fm" || value === "sm") return "Group II";
    if (/account|law|tax|gst|direct tax|corporate/.test(value)) return "Group I";
    return "General";
  }

  function icon(name) {
    return `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
  }

  function emptyState(iconName, title, message) {
    return `<div class="lt-empty">${icon(iconName)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
  }

  // ---------------------------------------------------------------------------
  // Focus Room + Study Receipts
  // ---------------------------------------------------------------------------

  function focusStats(timer, sessions) {
    const todaySessions = sessions.filter((session) => isToday(session.endedAt));
    const completedToday = todaySessions.reduce((total, session) => total + Number(session.durationSeconds || 0), 0);
    const liveToday = timer.status === "idle" ? 0 : elapsedFor(timer);
    const todayTotal = completedToday + liveToday;
    return {
      todaySessions,
      todayTotal,
      longest: todaySessions.reduce((best, session) => Math.max(best, Number(session.durationSeconds || 0)), 0),
      goalProgress: Math.min(1, todayTotal / DAILY_GOAL_SECONDS),
    };
  }

  function dueReceipts() {
    return studyReceipts().filter((receipt) => !receipt.review && Number(receipt.nextReviewAt) <= Date.now());
  }

  function renderFocus(root, student) {
    cleanup();
    activeRoot = root;
    activeStudent = student;
    activeFeature = "focus";
    focusReceiptSessionId = null;
    installVisibilityHandler();
    renderFocusRoom();
  }

  function renderFocusRoom() {
    if (!activeRoot) return;
    const timer = currentFocusTimer();
    const sessions = focusSessions();
    const receipts = studyReceipts();
    const receiptBySession = new Map(receipts.map((receipt) => [receipt.sessionId, receipt]));
    const due = dueReceipts();
    const elapsed = elapsedFor(timer);
    const stats = focusStats(timer, sessions);
    const statusLabel = timer.status.toUpperCase();
    const ringDegrees = ((elapsed % 3600) / 3600) * 360;

    activeRoot.innerHTML = `
      <div class="lt-shell lt-focus-shell" data-testid="focus-room">
        <header class="lt-page-header">
          <div><span class="lt-eyebrow">DEEP WORK ZONE</span><h2>Focus room</h2><p>Start the clock. Put the phone down. Do the work.</p></div>
          <span class="lt-status ${timer.status === "running" ? "is-running" : ""}"><i></i>${escapeHtml(statusLabel)}</span>
        </header>

        <section class="lt-timer-card ${timer.status === "running" ? "is-running" : ""}">
          <div class="lt-timer-ring" style="--ring-deg:${ringDegrees}deg">
            <div class="lt-timer-center">
              <span class="lt-dark-chip">${icon("book")} ${escapeHtml(timer.subject)}</span>
              ${timer.target ? `<p class="lt-active-target">${escapeHtml(timer.target)}</p>` : ""}
              <strong class="lt-timer-value js-focus-time">${formatTimer(elapsed)}</strong>
              <small class="js-focus-hint">${timer.status === "running" ? "Stay focused — screen will remain awake" : timer.status === "paused" ? "Session paused" : "Ready when you are"}</small>
            </div>
          </div>
          <div class="lt-timer-actions">
            ${timer.status === "idle" ? `<button class="lt-action primary" data-focus-action="start">${icon("play")} Start focus</button>` : ""}
            ${timer.status === "running" ? `<button class="lt-action light" data-focus-action="pause">${icon("pause")} Pause</button><button class="lt-action danger" data-focus-action="finish">${icon("stop")} Finish</button>` : ""}
            ${timer.status === "paused" ? `<button class="lt-action primary" data-focus-action="resume">${icon("play")} Resume</button><button class="lt-action light" data-focus-action="finish">${icon("check")} Finish</button>` : ""}
          </div>
          ${timer.status !== "idle" ? `<button class="lt-discard" data-focus-action="discard">Discard session</button>` : ""}
        </section>

        <h3 class="lt-section-title">Choose subject</h3>
        <section class="lt-card lt-subject-card">
          <div class="lt-chip-row">
            ${SUBJECTS.map((subject) => `<button class="lt-chip ${timer.subject === subject ? "selected" : ""}" data-focus-subject="${escapeAttr(subject)}" ${timer.status !== "idle" ? "disabled" : ""}>${escapeHtml(subject)}</button>`).join("")}
          </div>
          <div class="lt-divider"></div>
          <label class="lt-input-label" for="focus-target">SESSION TARGET</label>
          <input id="focus-target" class="lt-text-input" maxlength="140" value="${escapeAttr(timer.target)}" placeholder="e.g. Understand AS 16 and solve 20 questions" ${timer.status !== "idle" ? "disabled" : ""}>
          <p class="lt-field-help">${timer.status !== "idle" ? `${icon("lock")} Subject and target are locked while a session is active.` : "Your target becomes the source prompt for the Study Receipt."}</p>
        </section>

        ${due.length ? `<button class="lt-memory-due" data-focus-action="open-receipt" data-session-id="${escapeAttr(due[0].sessionId)}"><span>${icon("bell")}</span><div><b>${due.length} memory check${due.length === 1 ? "" : "s"} due</b><small>Test what you still remember after 24 hours.</small></div>${icon("chevron-right")}</button>` : ""}

        <h3 class="lt-section-title">Today's focus</h3>
        <section class="lt-card lt-goal-card">
          <div class="lt-goal-top"><div><strong class="js-focus-total">${formatCompact(stats.todayTotal)}</strong><span>of 8 hour daily goal</span></div><b class="lt-goal-percent js-focus-percent">${Math.round(stats.goalProgress * 100)}%</b></div>
          <div class="lt-progress"><i class="js-focus-progress" style="width:${stats.goalProgress * 100}%"></i></div>
          <div class="lt-mini-stats">
            <div><b>${stats.todaySessions.length}</b><span>SESSIONS</span></div>
            <div><b>${formatCompact(stats.longest)}</b><span>LONGEST</span></div>
            <div><b>${escapeHtml(timer.subject)}</b><span>CURRENT</span></div>
          </div>
        </section>

        <h3 class="lt-section-title">Recent focus sessions</h3>
        <div class="lt-session-list">
          ${sessions.length ? sessions.slice(0, 10).map((session) => {
            const receipt = receiptBySession.get(session.id);
            return `<article class="lt-card lt-session-card">
              <span class="lt-session-icon">${icon("check-double")}</span>
              <div class="lt-session-body"><b>${escapeHtml(session.subject)}</b>${session.target ? `<p>${escapeHtml(session.target)}</p>` : ""}<small>${formatDate(session.endedAt)} · ${new Date(session.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small></div>
              <div class="lt-session-end"><strong>${formatCompact(session.durationSeconds)}</strong><div><button title="${receipt ? "View Study Receipt" : "Create Study Receipt"}" data-focus-action="open-receipt" data-session-id="${escapeAttr(session.id)}" class="lt-icon-button ${receipt ? "done" : ""}">${icon("receipt")}</button><button title="Remove session" data-focus-action="remove-session" data-session-id="${escapeAttr(session.id)}" class="lt-icon-button muted">${icon("trash")}</button></div></div>
            </article>`;
          }).join("") : emptyState("stopwatch", "No focus sessions yet", "Choose a subject and start your first distraction-free session.")}
        </div>
        <div class="lt-local-note">${icon("mobile-screen")}<span>Timer history stays on this device for now and does not write to the mentorship backend.</span></div>
      </div>`;

    bindFocusRoomEvents();
    if (timer.status === "running") {
      requestWakeLock();
      setClockUpdater(updateFocusClock);
    } else {
      releaseWakeLock();
      setClockUpdater(null);
    }
  }

  function updateFocusClock() {
    if (!activeRoot) return;
    const timer = currentFocusTimer();
    if (timer.status !== "running") return;
    const elapsed = elapsedFor(timer);
    const time = $(".js-focus-time");
    const ring = $(".lt-timer-ring");
    if (time) time.textContent = formatTimer(elapsed);
    if (ring) ring.style.setProperty("--ring-deg", `${((elapsed % 3600) / 3600) * 360}deg`);
    const stats = focusStats(timer, focusSessions());
    const total = $(".js-focus-total");
    const percent = $(".js-focus-percent");
    const progress = $(".js-focus-progress");
    if (total) total.textContent = formatCompact(stats.todayTotal);
    if (percent) percent.textContent = `${Math.round(stats.goalProgress * 100)}%`;
    if (progress) progress.style.width = `${stats.goalProgress * 100}%`;
  }

  function bindFocusRoomEvents() {
    activeRoot.onclick = async (event) => {
      const subjectButton = event.target.closest("[data-focus-subject]");
      if (subjectButton) {
        const timer = currentFocusTimer();
        if (timer.status === "idle") {
          timer.subject = subjectButton.dataset.focusSubject;
          saveJson(focusTimerKey(), timer);
          renderFocusRoom();
        }
        return;
      }

      const button = event.target.closest("[data-focus-action]");
      if (!button) return;
      const action = button.dataset.focusAction;
      const timer = currentFocusTimer();

      if (action === "start") {
        if (!timer.target.trim()) {
          alert("Set a session target before starting the timer.");
          $("#focus-target")?.focus();
          return;
        }
        const now = Date.now();
        saveJson(focusTimerKey(), { status: "running", subject: timer.subject, target: timer.target.trim(), startedAt: now, sessionStartedAt: now, elapsedBeforeRun: 0 });
        await requestWakeLock();
        renderFocusRoom();
      } else if (action === "pause" && timer.status === "running") {
        saveJson(focusTimerKey(), { ...timer, status: "paused", startedAt: null, elapsedBeforeRun: elapsedFor(timer) });
        await releaseWakeLock();
        renderFocusRoom();
      } else if (action === "resume" && timer.status === "paused") {
        saveJson(focusTimerKey(), { ...timer, status: "running", startedAt: Date.now() });
        await requestWakeLock();
        renderFocusRoom();
      } else if (action === "discard" && timer.status !== "idle") {
        if (confirm("Discard current timer? This unfinished focus time will not be added to your history.")) {
          saveJson(focusTimerKey(), { ...idleFocusTimer(), subject: timer.subject || "Accounts" });
          await releaseWakeLock();
          renderFocusRoom();
        }
      } else if (action === "finish" && timer.status !== "idle") {
        const durationSeconds = elapsedFor(timer);
        if (!confirm(`Finish this focus session? ${formatCompact(durationSeconds)} of ${timer.subject} will be saved.`)) return;
        const now = Date.now();
        const session = {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          subject: timer.subject,
          target: timer.target.trim(),
          startedAt: timer.sessionStartedAt || now,
          endedAt: now,
          durationSeconds,
        };
        const sessions = focusSessions();
        if (durationSeconds > 0) saveJson(focusHistoryKey(), [session, ...sessions].slice(0, 100));
        saveJson(focusTimerKey(), { ...idleFocusTimer(), subject: timer.subject });
        await releaseWakeLock();
        if (durationSeconds > 0) renderStudyReceipt(session.id);
        else renderFocusRoom();
      } else if (action === "open-receipt") {
        renderStudyReceipt(button.dataset.sessionId);
      } else if (action === "remove-session") {
        if (confirm("Remove this local focus session?")) {
          saveJson(focusHistoryKey(), focusSessions().filter((session) => session.id !== button.dataset.sessionId));
          renderFocusRoom();
        }
      }
    };

    activeRoot.oninput = (event) => {
      if (event.target.id !== "focus-target") return;
      const timer = currentFocusTimer();
      if (timer.status !== "idle") return;
      timer.target = event.target.value;
      saveJson(focusTimerKey(), timer);
    };
  }

  function recallSessionKind(session) {
    const subject = String(session.subject || "").trim().toLowerCase();
    if (subject === "mock test" || subject === "mock") return "mock";
    if (subject === "revision") return "revision";
    return "subject";
  }

  // Recall prompts adapt to the session type selected in the Focus Room so a
  // Mock Test session never shows generic "main concept" prompts and a Revision
  // session asks about re-revision plans instead of first-time learning.
  // Keep this logic in sync with the APK (mobile/src/context/StudyReceiptContext.tsx).
  function buildRecallQuestions(session) {
    const target = String(session.target || session.subject).trim();
    const kind = recallSessionKind(session);
    const typedTarget = String(session.target || "").trim();
    const targetSuffix = typedTarget && typedTarget.toLowerCase() !== String(session.subject).toLowerCase()
      ? ` for “${typedTarget}”`
      : "";

    if (kind === "mock") {
      return [
        { id: `${session.id}:mock-attempt`, prompt: `Which mock test or paper did you attempt${targetSuffix}?`, helper: "Name the mock series, paper and section you attempted." },
        { id: `${session.id}:mock-performance`, prompt: "How did the exam go overall, and how many questions did you attempt?", helper: "Include how you felt about accuracy and whether you reached every question." },
        { id: `${session.id}:mock-difficulty`, prompt: "Which section felt the most difficult, and why?", helper: "Name the topics or question types that slowed you down." },
        { id: `${session.id}:mock-time`, prompt: "How was your time management during the mock?", helper: "Note where you spent too much or too little time." },
        { id: `${session.id}:mock-improve`, prompt: "What mistakes did you make, and what will you improve in your next mock?", helper: "Be specific — silly errors, concept gaps or presentation issues." },
      ];
    }

    if (kind === "revision") {
      return [
        { id: `${session.id}:revise-topics`, prompt: `Which chapters or topics did you revise${targetSuffix}?`, helper: "List the chapters, topics or past questions you covered." },
        { id: `${session.id}:revise-recall`, prompt: "Without opening your notes, what were you able to recall?", helper: "Write the points that came back to you from memory first." },
        { id: `${session.id}:revise-gaps`, prompt: "Which concepts, formulas or rules do you still need to revise again?", helper: "Note the weak spots you noticed during recall." },
        { id: `${session.id}:revise-next`, prompt: "When will you do your next revision of this material?", helper: "Pick a realistic date or day and stick to it." },
      ];
    }

    return [
      { id: `${session.id}:core`, prompt: `In your own words, explain the main concept you studied about “${target}” in this ${session.subject} session.`, helper: "Write it as if you were teaching a junior student." },
      { id: `${session.id}:details`, prompt: `Recall the important rules, provisions, formulas or steps from this ${session.subject} session.`, helper: "Short bullet-style answers are enough." },
      { id: `${session.id}:application`, prompt: "What is one mistake you could make on this topic in the exam, and how would you avoid it?", helper: "Use your own words. Accuracy verification will come from mentor-approved sources later." },
    ];
  }

  function answerEffort(response) {
    const length = response.trim().length;
    if (length >= 120) return 100;
    if (length >= 60) return 85;
    if (length >= 25) return 65;
    if (length > 0) return 35;
    return 0;
  }

  function reviewScore(response, confidence) {
    const base = confidence === "High" ? 85 : confidence === "Medium" ? 65 : 40;
    const bonus = response.trim().length >= 100 ? 10 : response.trim().length >= 40 ? 5 : 0;
    return Math.min(100, base + bonus);
  }

  function confidenceChips(name, selected) {
    return ["Low", "Medium", "High"].map((value) => `<label class="lt-choice ${selected === value ? "selected" : ""}"><input type="radio" name="${name}" value="${value}" ${selected === value ? "checked" : ""}><span>${value}</span></label>`).join("");
  }

  function renderStudyReceipt(sessionId) {
    focusReceiptSessionId = sessionId;
    setClockUpdater(null);
    const session = focusSessions().find((item) => item.id === sessionId);
    const receipt = studyReceipts().find((item) => item.sessionId === sessionId);
    if (!session && !receipt) {
      activeRoot.innerHTML = `<div class="lt-shell">${emptyState("receipt", "Session not found", "This local focus session may have been removed.")}<button class="lt-wide-button" data-receipt-action="back">Back to Focus Room</button></div>`;
      bindReceiptEvents();
      return;
    }
    if (receipt) renderExistingReceipt(receipt);
    else renderReceiptForm(session);
  }

  function renderReceiptForm(session) {
    const recallQuestions = buildRecallQuestions(session);
    activeRoot.innerHTML = `
      <div class="lt-shell lt-receipt-shell" data-testid="study-receipt-form">
        <section class="lt-receipt-intro">
          <span class="lt-receipt-icon">${icon("receipt")}</span><span class="lt-eyebrow">PROOF OF LEARNING</span>
          <h2>Turn focused time into a Study Receipt.</h2><p>Close your notes first. These prompts test active recall—not typing speed or timer duration.</p>
          <div><b>${escapeHtml(session.subject)}</b><strong>${formatDuration(session.durationSeconds)}</strong></div><small>Target: ${escapeHtml(session.target || session.subject)}</small>
        </section>
        <form id="receipt-form">
          ${recallQuestions.map((question, index) => `<section class="lt-recall-block"><span>RECALL ${index + 1} OF ${recallQuestions.length}</span><h3>${escapeHtml(question.prompt)}</h3><p>${escapeHtml(question.helper)}</p><textarea data-recall-id="${escapeAttr(question.id)}" data-prompt="${escapeAttr(question.prompt)}" data-helper="${escapeAttr(question.helper)}" placeholder="Answer without opening your notes…"></textarea></section>`).join("")}
          <section class="lt-confidence"><h3>How confident are you about this topic?</h3><div>${confidenceChips("recall-confidence", "Medium")}</div></section>
          <div class="lt-form-error" id="receipt-error" hidden></div>
          <button type="submit" class="lt-wide-button">${icon("receipt")} Create Study Receipt</button>
          <small class="lt-honesty">Your answers stay on this device.</small>
        </form>
        <button class="lt-text-button" data-receipt-action="back">${icon("arrow-left")} Back to Focus Room</button>
      </div>`;
    bindReceiptEvents(session);
  }

  function renderExistingReceipt(receipt) {
    const reviewDue = Number(receipt.nextReviewAt) <= Date.now();
    activeRoot.innerHTML = `
      <div class="lt-shell lt-receipt-shell" data-testid="study-receipt-result">
        <section class="lt-receipt-result">
          <span class="lt-receipt-check">${icon("check")}</span><span>STUDY RECEIPT</span><h2>Learning captured</h2><p>${escapeHtml(receipt.subject)} · ${formatDuration(receipt.focusedSeconds)}</p><div><b>${receipt.recallEffortScore}</b><small>RECALL EFFORT</small></div>
        </section>
        <div class="lt-info-note">${icon("circle-info")}<span>This score measures answer effort and detail. It is not AI grading or an academic correctness score.</span></div>
        <section class="lt-card lt-receipt-details">
          <div><span>Subject</span><b>${escapeHtml(receipt.subject)}</b></div><div><span>Session target</span><b>${escapeHtml(receipt.target)}</b></div><div><span>Focused time</span><b>${formatDuration(receipt.focusedSeconds)}</b></div><div><span>Confidence</span><b>${escapeHtml(receipt.confidence)}</b></div><div><span>Verification</span><b class="lt-soft-badge">SELF-RECALL</b></div>
        </section>
        <h3 class="lt-section-title">Your recall answers</h3>
        ${receipt.answers.map((answer, index) => `<article class="lt-card lt-answer-card"><span>RECALL ${index + 1}</span><h3>${escapeHtml(answer.prompt)}</h3><p>${escapeHtml(answer.response)}</p></article>`).join("")}
        <h3 class="lt-section-title">24-hour memory check</h3>
        <section class="lt-card lt-memory-card">
          <div class="lt-memory-head"><span>${icon("brain")}</span><div><b>${receipt.review ? "Memory check complete" : reviewDue ? "Your memory check is ready" : "Review scheduled"}</b><small>${receipt.review ? formatDate(receipt.review.completedAt, true) : `Available ${formatDate(receipt.nextReviewAt, true)}`}</small></div></div>
          ${receipt.review ? `<div class="lt-retention"><b>${receipt.review.selfReportedScore}</b><div><span>SELF-REPORTED RETENTION</span><p>${escapeHtml(receipt.review.response)}</p></div></div>` : reviewDue ? `<form id="memory-form"><p>Without reopening your notes, write what you still remember about “${escapeHtml(receipt.target)}”.</p><textarea id="memory-response" placeholder="Write what you still remember…"></textarea><div class="lt-choice-row">${confidenceChips("review-confidence", "Medium")}</div><div class="lt-form-error" id="memory-error" hidden></div><button class="lt-wide-button" type="submit">Complete memory check</button></form>` : `<button class="lt-wide-button secondary" disabled>${icon("clock")} Available after 24 hours</button>`}
        </section>
        <div class="lt-locked-layer"><span>${icon("sparkles")}</span><div><b>AI verification layer</b><p>Next phase: source-cited grading from mentor-approved PDFs through a secure endpoint.</p></div>${icon("lock")}</div>
        <button class="lt-wide-button secondary" data-receipt-action="back">${icon("arrow-left")} Back to Focus Room</button>
      </div>`;
    bindReceiptEvents(null, receipt);
  }

  function bindReceiptEvents(session, receipt) {
    activeRoot.onclick = (event) => {
      const button = event.target.closest("[data-receipt-action]");
      if (button?.dataset.receiptAction === "back") renderFocusRoom();
    };

    const form = $("#receipt-form");
    if (form) form.addEventListener("submit", (event) => {
      event.preventDefault();
      const answers = [...form.querySelectorAll("[data-recall-id]")].map((field) => ({ id: field.dataset.recallId, prompt: field.dataset.prompt, helper: field.dataset.helper, response: field.value.trim() }));
      const error = $("#receipt-error");
      if (answers.some((answer) => answer.response.length < 12)) {
        error.hidden = false;
        error.textContent = "Please attempt every recall prompt in your own words before creating the receipt.";
        return;
      }
      const confidence = form.querySelector('input[name="recall-confidence"]:checked')?.value || "Medium";
      const now = Date.now();
      const recallEffortScore = Math.round(answers.reduce((total, answer) => total + answerEffort(answer.response), 0) / Math.max(answers.length, 1));
      const newReceipt = {
        id: `receipt:${session.id}`, sessionId: session.id, subject: session.subject, target: String(session.target || session.subject).trim(),
        focusedSeconds: session.durationSeconds, sessionStartedAt: session.startedAt, sessionEndedAt: session.endedAt,
        questions: answers.map(({ id, prompt, helper }) => ({ id, prompt, helper })), answers, confidence, recallEffortScore,
        source: "self-recall", createdAt: now, nextReviewAt: now + DAY_MS,
      };
      saveJson(receiptsKey(), [newReceipt, ...studyReceipts()].slice(0, 250));
      renderExistingReceipt(newReceipt);
    });

    const memoryForm = $("#memory-form");
    if (memoryForm && receipt) memoryForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const response = $("#memory-response").value.trim();
      const error = $("#memory-error");
      if (response.length < 15) {
        error.hidden = false;
        error.textContent = "Write what you still remember before completing the memory check.";
        return;
      }
      const confidence = memoryForm.querySelector('input[name="review-confidence"]:checked')?.value || "Medium";
      const updated = { ...receipt, review: { response, confidence, selfReportedScore: reviewScore(response, confidence), completedAt: Date.now() } };
      saveJson(receiptsKey(), studyReceipts().map((item) => item.id === receipt.id ? updated : item));
      renderExistingReceipt(updated);
    });

    activeRoot.onchange = (event) => {
      if (event.target.type !== "radio") return;
      event.target.closest(".lt-choice-row, .lt-confidence")?.querySelectorAll(".lt-choice").forEach((label) => label.classList.toggle("selected", label.contains(event.target)));
    };
  }

  // ---------------------------------------------------------------------------
  // Daily MCQ
  // ---------------------------------------------------------------------------

  function hashDaily(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function seededRandom(seedValue) {
    let seed = seedValue || 1;
    return () => {
      seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
      return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dailyQuestionIds(date, id, group) {
    const random = seededRandom(hashDaily(`${date}:${id}:${group}`));
    const pool = questions.filter((question) => subjectGroup(question.subject) === group);
    const pick = (items, count) => items.map((question) => ({ question, sort: random() })).sort((a, b) => a.sort - b.sort).slice(0, count).map(({ question }) => question.id);
    return [...pick(pool.filter((question) => question.kind !== "case-study"), 7), ...pick(pool.filter((question) => question.kind === "case-study"), 3)]
      .map((idValue) => ({ id: idValue, sort: random() })).sort((a, b) => a.sort - b.sort).map(({ id: idValue }) => idValue);
  }

  function dailyHistory() {
    const raw = loadJson(dailyKey(), []);
    const parsed = Array.isArray(raw) ? raw : [];
    const today = localDateKey();
    const migrated = parsed.filter((attempt) => attempt.bankRevision === learningData.revision || Boolean(attempt.completedAt && attempt.date < today));
    if (migrated.length !== parsed.length) saveJson(dailyKey(), migrated);
    return migrated;
  }

  function saveDaily(history, syncCompleted = false) {
    const saved = history.slice(0, 180);
    saveJson(dailyKey(), saved);
    if (syncCompleted && window.UMP_MCQ_CLOUD) window.UMP_MCQ_CLOUD.queue(saved, []);
  }

  function attemptForGroup(group) {
    return dailyHistory().find((attempt) => attempt.date === localDateKey() && attempt.group === group);
  }

  function dailyQuestionsForGroup(group) {
    const attempt = attemptForGroup(group);
    const ids = attempt?.questionIds || dailyQuestionIds(localDateKey(), studentId(), group);
    return ids.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean);
  }

  function dailyStreak(group) {
    const completed = new Set(dailyHistory().filter((attempt) => attempt.group === group && attempt.completedAt).map((attempt) => attempt.date));
    const cursor = new Date();
    if (!completed.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (completed.has(localDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function attemptTimestamp(attempt) {
    return Number(attempt?.completedAt || attempt?.startedAt || 0);
  }

  function mergeAttempts(local, remote, keyFor) {
    const merged = new Map();
    [...(local || []), ...(remote || [])].forEach((attempt) => {
      const key = keyFor(attempt);
      if (!key) return;
      const current = merged.get(key);
      if (!current || attemptTimestamp(attempt) >= attemptTimestamp(current)) merged.set(key, attempt);
    });
    return [...merged.values()].sort((left, right) => attemptTimestamp(right) - attemptTimestamp(left));
  }

  function restoreCloudAttemptsForStudent() {
    const id = studentId();
    if (!id || id === "guest" || !window.UMP_MCQ_CLOUD || cloudRestoredStudents.has(id)) return;
    cloudRestoredStudents.add(id);
    window.UMP_MCQ_CLOUD.restore().then((remote) => {
      const localDaily = loadJson(dailyKey(), []);
      const localPractice = loadJson(practiceKey(), []);
      const daily = mergeAttempts(localDaily, remote.daily, (attempt) => `${attempt.date}:${attempt.group}`).slice(0, 180);
      const practice = mergeAttempts(localPractice, remote.practice, (attempt) => attempt.id).slice(0, 150);
      saveJson(dailyKey(), daily);
      saveJson(practiceKey(), practice);
      // Back up completed legacy/local attempts that were not in the cloud yet.
      window.UMP_MCQ_CLOUD.queue(daily, practice);
      if (activeFeature === "mcq" && activeRoot && studentId() === id) renderMcqCurrent();
    }).catch((error) => {
      cloudRestoredStudents.delete(id); // retry next time the MCQ screen opens
      console.warn("[MCQ Cloud] Restore delayed:", error.message);
    });
  }

  function renderMCQ(root, student) {
    cleanup();
    activeRoot = root;
    activeFeature = "mcq";
    const changedStudent = activeStudent?.studentId !== student?.studentId;
    activeStudent = student;
    const allowed = groupsForStudent(student?.group);
    if (changedStudent || !allowed.includes(mcqUi.selectedGroup)) {
      mcqUi.mode = "daily";
      mcqUi.selectedGroup = allowed[0];
      mcqUi.dailyIndex = 0;
      mcqUi.practiceIndex = 0;
      mcqUi.practiceResult = null;
      mcqUi.practiceConfig = null;
    }
    renderMcqCurrent();
    restoreCloudAttemptsForStudent();
  }

  function replaceLearningData(nextData) {
    if (!nextData || !Array.isArray(nextData.questions)) return false;
    learningData = nextData;
    questions = nextData.questions;
    QUESTION_BY_ID = new Map(questions.map((question) => [question.id, question]));
    mcqUi.dailyIndex = 0;
    mcqUi.practiceIndex = 0;
    mcqUi.practiceResult = null;
    mcqUi.practiceConfig = null;
    if (activeFeature === "mcq" && activeRoot) renderMcqCurrent();
    return true;
  }

  function renderPublishedBankState() {
    setClockUpdater(null);
    const status = window.UMP_LIVE_BANK_STATUS || {};
    const loading = status.state === "loading";
    const failed = status.state === "error";
    const title = loading
      ? "Loading published MCQs…"
      : failed
        ? "Published MCQs could not be loaded"
        : "No MCQs are published yet";
    const message = loading
      ? "The content server may take up to a minute to wake up. This page will update automatically."
      : failed
        ? (status.error || "Check your connection and try again.")
        : "Once your mentor publishes a chapter, its questions will appear here automatically.";
    activeRoot.innerHTML = `<div class="lt-shell lt-mcq-shell" data-testid="published-bank-state">${emptyState(loading ? "rotate" : failed ? "triangle-exclamation" : "book-open", title, message)}<button class="lt-wide-button secondary" data-live-bank-retry>${icon("rotate-right")} ${loading ? "Check again" : "Retry published bank"}</button></div>`;
    const retry = activeRoot.querySelector("[data-live-bank-retry]");
    if (retry) retry.onclick = () => {
      retry.disabled = true;
      if (window.UMP_REFRESH_LIVE_BANK) window.UMP_REFRESH_LIVE_BANK();
    };
  }

  function renderMcqCurrent() {
    if (!questions.length) {
      renderPublishedBankState();
      return;
    }
    if (mcqUi.mode === "practice") renderPractice();
    else renderDaily();
  }

  function groupSelectorHtml() {
    const allowed = groupsForStudent(activeStudent?.group);
    return `<div class="lt-group-selector">${allowed.map((group) => {
      const attempt = attemptForGroup(group);
      const selected = mcqUi.selectedGroup === group;
      const short = group === "Group I" ? "G1" : "G2";
      const status = attempt?.completedAt ? `${attempt.score}/${attempt.total} done` : attempt ? `${Object.keys(attempt.answers || {}).length}/10 answered` : "Ready today";
      return `<button class="lt-group-card ${selected ? "selected" : ""} ${group === "Group II" ? "group-two" : ""}" data-daily-group="${group}"><span>${short}</span><div><b>${group}</b><small>${status}</small></div>${attempt?.completedAt ? icon("circle-check") : ""}</button>`;
    }).join("")}</div>`;
  }

  function renderDaily() {
    setClockUpdater(null);
    const group = mcqUi.selectedGroup;
    const attempt = attemptForGroup(group);
    if (!attempt) renderDailyIntro(group);
    else if (attempt.completedAt) renderDailyResult(group, attempt);
    else renderDailyQuiz(group, attempt);
  }

  function renderDailyIntro(group) {
    const dailyQuestions = dailyQuestionsForGroup(group);
    const subjects = [...new Set(dailyQuestions.map((question) => question.subject))];
    const streak = dailyStreak(group);
    const now = new Date();
    const gradientClass = group === "Group II" ? "group-two" : "";
    activeRoot.innerHTML = `
      <div class="lt-shell lt-mcq-shell" data-testid="daily-mcq-intro">
        <span class="lt-select-label">CHOOSE YOUR GROUP</span>${groupSelectorHtml()}
        <section class="lt-daily-hero ${gradientClass}">
          <div class="lt-calendar"><b>${now.getDate()}</b><span>${now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}</span></div>
          <span>${group.toUpperCase()} · DAILY KNOWLEDGE CHECK</span><h2>10 ${group} questions.<br>One focused attempt.</h2><p>Build recall consistency with a fresh mixed-subject challenge every day.</p>
          <div class="lt-hero-stats"><div><b>7 + 3</b><span>NORMAL + CASE</span></div><div><b>10m</b><span>TIME LIMIT</span></div><div><b>${streak}</b><span>DAY STREAK</span></div></div>
        </section>
        <div class="lt-draft-note">${icon("shield-halved")}<div><b>ICAI-mapped draft · ${escapeHtml(learningData.manifest.targetAttempt || "September 2026")}</b><p>Chapter names and numbers follow official ICAI BoS modules. Questions are original drafts pending mentor approval and amendment review.</p></div></div>
        <button class="lt-practice-promo" data-mcq-action="practice"><span>${icon("infinity")}</span><div><small>NO DAILY LIMIT</small><b>Unlimited Practice Zone</b><p>Combined · chapter-wise · Easy/Medium/Hard · Normal/Case Study</p></div>${icon("arrow-right")}</button>
        <h3 class="lt-section-title">Today's mix</h3><section class="lt-card"><div class="lt-chip-row">${subjects.map((subject) => `<span class="lt-static-chip">${escapeHtml(subject)}</span>`).join("")}</div></section>
        <h3 class="lt-section-title">Challenge rules</h3><section class="lt-card lt-rules"><div>${icon("stopwatch")}<span><b>10-minute timer</b><small>The attempt auto-submits when time runs out.</small></span></div><div>${icon("calendar-day")}<span><b>One attempt per group per day</b><small>Group I and Group II maintain separate results and streaks.</small></span></div><div>${icon("list-check")}<span><b>7 normal + 3 case-study MCQs</b><small>Questions are mixed across your selected group's subjects.</small></span></div></section>
        <button class="lt-wide-button" data-mcq-action="start-daily">${icon("play")} Start ${group} challenge</button>
        <p class="lt-honesty">Today's question order is fixed for your Student ID and device date.</p>
        ${dailyHistory().filter((item) => item.group === group && item.completedAt && item.date !== localDateKey()).slice(0, 8).map((item) => `<button class="lt-wide-button secondary" data-daily-open-result="${escapeAttr(item.date)}">${icon("clipboard")} ${escapeHtml(item.date)} · ${item.score}/${item.total} · view wrong answers</button>`).join("")}
      </div>`;
    bindMcqEvents();
  }

  function renderQuestion(question, selected, index, total, answered, context, timeText) {
    return `
      <div class="lt-quiz-header"><div><span>${context === "daily" ? "DAILY CHALLENGE" : "UNLIMITED PRACTICE"} · ${escapeHtml(question.subject)}</span><h2>Question ${index + 1} of ${total}</h2></div><b class="lt-quiz-clock ${context === "daily" ? "js-daily-clock" : "js-practice-clock"}">${icon(context === "daily" ? "clock" : "stopwatch")} ${escapeHtml(timeText)}</b></div>
      <div class="lt-progress"><i style="width:${(answered / total) * 100}%"></i></div><p class="lt-answered">${answered} of ${total} answered</p>
      <section class="lt-card lt-question-card">
        <div class="lt-question-badges"><span>${escapeHtml(question.subject)}</span><span class="${question.kind === "case-study" ? "case" : ""}">${question.kind === "case-study" ? "CASE STUDY" : "NORMAL"}</span><span class="difficulty ${question.difficulty === "Hard" ? "hard" : ""}">${escapeHtml(question.difficulty)}</span></div>
        <p class="lt-chapter">${escapeHtml(question.chapter)}</p>
        ${question.caseStudy ? `<div class="lt-case"><b>${escapeHtml(question.caseStudy.title)}</b><p>${escapeHtml(question.caseStudy.passage)}</p></div>` : ""}
        <h3 class="lt-question-text">${escapeHtml(question.prompt)}</h3>
        <div class="lt-options">${question.options.map((option, optionIndex) => `<button class="lt-option ${selected === optionIndex ? "selected" : ""}" data-${context}-option="${optionIndex}"><span>${LETTERS[optionIndex]}</span><b>${escapeHtml(option)}</b></button>`).join("")}</div>
      </section>`;
  }

  function quizNavigationHtml(index, total, answers, questionIds, context) {
    return `<div class="lt-quiz-actions"><button class="lt-wide-button secondary" data-${context}-nav="prev" ${index === 0 ? "disabled" : ""}>${icon("arrow-left")} Previous</button>${index === total - 1 ? `<button class="lt-wide-button" data-${context}-submit>${icon("check")} Submit</button>` : `<button class="lt-wide-button" data-${context}-nav="next">Next ${icon("arrow-right")}</button>`}</div><div class="lt-question-dots">${questionIds.map((id, dotIndex) => `<button class="${dotIndex === index ? "current" : ""} ${answers[id] != null ? "answered" : ""}" data-${context}-dot="${dotIndex}">${dotIndex + 1}</button>`).join("")}</div>`;
  }

  function renderDailyQuiz(group, attempt) {
    const dailyQuestions = attempt.questionIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean);
    mcqUi.dailyIndex = Math.min(mcqUi.dailyIndex, dailyQuestions.length - 1);
    const question = dailyQuestions[mcqUi.dailyIndex];
    const answered = Object.keys(attempt.answers || {}).length;
    const elapsed = Math.max(0, Math.floor((Date.now() - attempt.startedAt) / 1000));
    const left = Math.max(0, DAILY_SECONDS - elapsed);
    activeRoot.innerHTML = `<div class="lt-shell lt-mcq-shell" data-testid="daily-mcq-quiz">${renderQuestion(question, attempt.answers[question.id], mcqUi.dailyIndex, dailyQuestions.length, answered, "daily", formatClock(left))}${quizNavigationHtml(mcqUi.dailyIndex, dailyQuestions.length, attempt.answers, attempt.questionIds, "daily")}<p class="lt-honesty">The timer continues if this tab is put in the background.</p></div>`;
    bindMcqEvents();
    dailyAutoSubmitting = false;
    setClockUpdater(updateDailyClock);
  }

  function updateDailyClock() {
    const attempt = attemptForGroup(mcqUi.selectedGroup);
    if (!attempt || attempt.completedAt) return;
    const left = Math.max(0, DAILY_SECONDS - Math.floor((Date.now() - attempt.startedAt) / 1000));
    const clock = $(".js-daily-clock");
    if (clock) {
      clock.innerHTML = `${icon("clock")} ${formatClock(left)}`;
      clock.classList.toggle("warning", left <= 60);
    }
    if (left <= 0 && !dailyAutoSubmitting) {
      dailyAutoSubmitting = true;
      submitDaily(mcqUi.selectedGroup);
      alert(`Time is up. Your ${mcqUi.selectedGroup} answered questions have been submitted.`);
      renderDaily();
    }
  }

  function startDaily(group) {
    const history = dailyHistory();
    const existing = attemptForGroup(group);
    if (existing) return;
    const other = history.find((attempt) => attempt.date === localDateKey() && attempt.group !== group && !attempt.completedAt);
    if (other) {
      alert(`Finish the ${other.group} attempt before starting ${group}.`);
      return;
    }
    const attempt = { bankRevision: learningData.revision, date: localDateKey(), group, questionIds: dailyQuestionIds(localDateKey(), studentId(), group), answers: {}, startedAt: Date.now() };
    saveDaily([attempt, ...history]);
    mcqUi.dailyIndex = 0;
    renderDaily();
  }

  function answerDaily(option) {
    const group = mcqUi.selectedGroup;
    const history = dailyHistory();
    const attempt = history.find((item) => item.date === localDateKey() && item.group === group);
    if (!attempt || attempt.completedAt) return;
    const questionId = attempt.questionIds[mcqUi.dailyIndex];
    const updated = { ...attempt, answers: { ...attempt.answers, [questionId]: option } };
    saveDaily(history.map((item) => item.date === localDateKey() && item.group === group ? updated : item));
    renderDailyQuiz(group, updated);
  }

  function submitDaily(group) {
    const history = dailyHistory();
    const attempt = history.find((item) => item.date === localDateKey() && item.group === group);
    if (!attempt || attempt.completedAt) return attempt;
    const attemptQuestions = attempt.questionIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean);
    const completedAt = Date.now();
    const updated = { ...attempt, completedAt, score: attemptQuestions.reduce((total, question) => total + (attempt.answers[question.id] === question.answer ? 1 : 0), 0), total: attemptQuestions.length, durationSeconds: Math.max(1, Math.floor((completedAt - attempt.startedAt) / 1000)), review: buildReview(attemptQuestions, attempt) };
    saveDaily(history.map((item) => item.date === localDateKey() && item.group === group ? updated : item), true);
    return updated;
  }

  function buildReview(attemptQuestions, attempt) {
    return (attemptQuestions || []).map((question) => {
      const selected = attempt.answers ? attempt.answers[question.id] : undefined;
      return {
        id: question.id,
        prompt: question.prompt,
        options: question.options || [],
        answer: question.answer,
        selected: selected == null ? null : selected,
        explanation: question.explanation || "",
        subject: question.subject || "",
        chapter: question.chapter || "",
        difficulty: question.difficulty || "",
        kind: question.kind || "",
        caseStudy: question.caseStudy || null,
        officialPaper: question.officialChapter?.paper || "",
        correct: selected === question.answer,
      };
    });
  }

  function questionsFromAttempt(attempt) {
    if (Array.isArray(attempt?.review) && attempt.review.length) {
      return attempt.review.map((item) => ({
        id: item.id,
        prompt: item.prompt,
        options: item.options || [],
        answer: item.answer,
        explanation: item.explanation,
        subject: item.subject,
        chapter: item.chapter,
        difficulty: item.difficulty,
        kind: item.kind,
        caseStudy: item.caseStudy,
        officialChapter: { paper: item.officialPaper || "Paper" },
      }));
    }
    return (attempt?.questionIds || []).map((id) => QUESTION_BY_ID.get(id)).filter(Boolean);
  }

  function reviewCards(attemptQuestions, attempt) {
    const cards = (attempt?.review?.length ? attempt.review.map((item) => ({
      id: item.id,
      prompt: item.prompt,
      options: item.options || [],
      answer: item.answer,
      explanation: item.explanation,
      subject: item.subject,
      difficulty: item.difficulty,
      kind: item.kind,
      caseStudy: item.caseStudy,
      officialChapter: { paper: item.officialPaper || "Paper" },
      chapter: item.chapter,
      selected: item.selected,
    })) : attemptQuestions.map((question) => ({ ...question, selected: attempt.answers?.[question.id] })));
    return cards.map((question, index) => {
      const selected = question.selected != null ? question.selected : attempt.answers?.[question.id];
      const correct = selected === question.answer;
      return `<article class="lt-card lt-review-card"><div class="lt-review-top"><span class="${correct ? "correct" : "wrong"}">${icon(correct ? "check" : "xmark")}</span><b>Q${index + 1} · ${escapeHtml(question.subject)} · ${escapeHtml(question.difficulty)}</b></div>${question.caseStudy ? `<div class="lt-mini-case"><b>${escapeHtml(question.caseStudy.title)}</b><p>${escapeHtml(question.caseStudy.passage)}</p></div>` : ""}<h3>${escapeHtml(question.prompt)}</h3><p>Your answer: <strong class="${correct ? "correct-text" : "wrong-text"}">${selected == null ? "Not answered" : escapeHtml(question.options[selected])}</strong></p>${correct ? "" : `<p class="lt-correct-answer">Correct: ${escapeHtml(question.options[question.answer])}</p>`}<div class="lt-explanation">${icon("lightbulb")}<span>${escapeHtml(question.explanation)}</span></div><div class="lt-source">${icon("book-open")}<span>ICAI BoS · ${escapeHtml(question.officialChapter.paper)} · ${escapeHtml(question.chapter)}</span></div></article>`;
    }).join("");
  }

  function renderDailyResult(group, attempt) {
    const attemptQuestions = questionsFromAttempt(attempt);
    const percentage = attempt.total ? Math.round((Number(attempt.score || 0) / attempt.total) * 100) : 0;
    activeRoot.innerHTML = `<div class="lt-shell lt-mcq-shell" data-testid="daily-mcq-result"><span class="lt-select-label">TODAY'S GROUP RESULTS</span>${groupSelectorHtml()}<section class="lt-result-hero ${percentage < 70 ? "low" : ""}"><span>${icon(percentage >= 70 ? "trophy" : "chart-simple")}</span><small>${group.toUpperCase()} · DAILY RESULT</small><h2>${percentage}%</h2><p>${attempt.score}/${attempt.total} correct · ${formatDuration(attempt.durationSeconds)}</p><b>${icon("fire")} ${dailyStreak(group)} day streak</b></section><h3 class="lt-section-title">Answer review</h3>${reviewCards(attemptQuestions, attempt)}<button class="lt-wide-button secondary" data-mcq-action="practice">${icon("infinity")} Open Unlimited Practice</button></div>`;
    bindMcqEvents();
  }

  // ---------------------------------------------------------------------------
  // Unlimited MCQ Practice
  // ---------------------------------------------------------------------------

  function practiceHistory() {
    const raw = loadJson(practiceKey(), []);
    const parsed = Array.isArray(raw) ? raw : [];
    const migrated = parsed.filter((session) => session.bankRevision === learningData.revision || Boolean(session.completedAt));
    if (migrated.length !== parsed.length) saveJson(practiceKey(), migrated);
    return migrated;
  }

  function savePractice(history, syncCompleted = false) {
    const saved = history.slice(0, 150);
    saveJson(practiceKey(), saved);
    if (syncCompleted && window.UMP_MCQ_CLOUD) window.UMP_MCQ_CLOUD.queue([], saved);
    if (syncCompleted && window.UMP_PROGRESS_SHARE) window.UMP_PROGRESS_SHARE.syncNow();
  }

  function activePractice() {
    return practiceHistory().find((session) => !session.completedAt);
  }

  function defaultPracticeConfig() {
    const allowed = groupsForStudent(activeStudent?.group);
    return { group: allowed.length > 1 ? "Combined" : allowed[0], subject: "All Subjects", chapter: "All Chapters", mode: "Mixed", difficulty: "Mixed", requestedCount: 10 };
  }

  function practicePool(config) {
    return questions.filter((question) => {
      const group = subjectGroup(question.subject);
      if (config.group !== "Combined" && group !== config.group) return false;
      if (config.subject !== "All Subjects" && question.subject !== config.subject) return false;
      if (config.chapter !== "All Chapters" && question.chapter !== config.chapter) return false;
      if (config.mode === "Normal" && question.kind !== "normal") return false;
      if (config.mode === "Case Study" && question.kind !== "case-study") return false;
      if (config.difficulty !== "Mixed" && question.difficulty !== config.difficulty) return false;
      return true;
    });
  }

  function hashPractice(value) {
    let result = 0;
    for (let index = 0; index < value.length; index += 1) result = (Math.imul(31, result) + value.charCodeAt(index)) | 0;
    return result >>> 0;
  }

  function shuffled(items, seedValue) {
    const result = [...items];
    const random = seededRandom(seedValue);
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  function renderPractice() {
    setClockUpdater(null);
    const active = activePractice();
    if (mcqUi.practiceResult) renderPracticeResult(mcqUi.practiceResult);
    else if (active) renderPracticeQuiz(active);
    else renderPracticeSetup();
  }

  function practiceChip(label, filter, selected, value = label) {
    return `<button class="lt-chip ${selected ? "selected" : ""}" data-practice-filter="${filter}" data-value="${escapeAttr(value)}">${escapeHtml(label)}</button>`;
  }

  function renderPracticeSetup() {
    const config = mcqUi.practiceConfig || defaultPracticeConfig();
    mcqUi.practiceConfig = config;
    const allowed = groupsForStudent(activeStudent?.group);
    const groupOptions = allowed.length > 1 ? ["Combined", ...allowed] : allowed;
    const availableSubjects = ["All Subjects", ...new Set(questions.filter((question) => config.group === "Combined" || subjectGroup(question.subject) === config.group).sort((a, b) => a.chapterOrder - b.chapterOrder).map((question) => question.subject))];
    if (!availableSubjects.includes(config.subject)) { config.subject = "All Subjects"; config.chapter = "All Chapters"; }
    const availableChapters = ["All Chapters", ...new Set(questions.filter((question) => (config.group === "Combined" || subjectGroup(question.subject) === config.group) && (config.subject === "All Subjects" || question.subject === config.subject)).sort((a, b) => a.chapterOrder - b.chapterOrder).map((question) => question.chapter))];
    if (!availableChapters.includes(config.chapter)) config.chapter = "All Chapters";
    const pool = practicePool(config);
    const completed = practiceHistory().filter((session) => session.completedAt);
    const average = completed.length ? Math.round(completed.reduce((sum, session) => sum + ((session.score || 0) / Math.max(session.total || 1, 1)) * 100, 0) / completed.length) : 0;
    const latest = completed[0];

    activeRoot.innerHTML = `<div class="lt-shell lt-mcq-shell" data-testid="practice-setup"><section class="lt-practice-hero"><span>${icon("infinity")}</span><small>ICAI-PATTERN PRACTICE</small><h2>Unlimited MCQ Practice Zone</h2><p>Build a custom session by group, subject, chapter, type and difficulty. Practice sessions never change the Daily Challenge streak.</p><div><b>${completed.length} sessions</b><b>${average}% avg</b><b>${questions.length} question pool</b></div></section><div class="lt-draft-note">${icon("book-open")}<p>${escapeHtml(learningData.manifest.notice || "Original ICAI-mapped practice content.")}</p></div><section class="lt-card lt-practice-filters"><div><label>GROUP</label><span>${groupOptions.map((item) => practiceChip(item, "group", config.group === item)).join("")}</span></div><hr><div><label>SUBJECT</label><span>${availableSubjects.map((item) => practiceChip(item, "subject", config.subject === item)).join("")}</span></div><hr><div><label>OFFICIAL ICAI CHAPTER</label><span class="lt-scroll-chips">${availableChapters.map((item) => practiceChip(item, "chapter", config.chapter === item)).join("")}</span></div><hr><div><label>QUESTION TYPE</label><span>${["Mixed", "Normal", "Case Study"].map((item) => practiceChip(item, "mode", config.mode === item)).join("")}</span></div><hr><div><label>DIFFICULTY</label><span>${["Mixed", "Easy", "Medium", "Hard"].map((item) => practiceChip(item, "difficulty", config.difficulty === item)).join("")}</span></div><hr><div><label>SESSION SIZE</label><span>${[5, 10, 20, 50].map((item) => practiceChip(String(item), "requestedCount", config.requestedCount === item, item)).join("")}</span></div></section><div class="lt-pool ${pool.length ? "" : "empty"}">${icon(pool.length ? "layer-group" : "circle-exclamation")}<div><b>${pool.length} questions match</b><p>${pool.length ? `This session will use ${Math.min(config.requestedCount, pool.length)} unique questions.` : "Broaden chapter, type or difficulty filters."}</p></div></div><button class="lt-wide-button" data-practice-action="start" ${pool.length ? "" : "disabled"}>${icon("play")} Start ${Math.min(config.requestedCount, pool.length)}-question practice</button>${completed.length ? completed.slice(0, 8).map((session) => `<button class="lt-wide-button secondary" data-practice-open-result="${escapeAttr(session.id)}">${icon("clipboard")} ${new Date(session.completedAt).toLocaleDateString("en-IN")} · ${session.score}/${session.total} · view wrong answers</button>`).join("") : emptyState("infinity", "No practice sessions yet", "Configure a session above. There is no daily practice limit.")}<button class="lt-text-button" data-mcq-action="daily">${icon("arrow-left")} Back to Daily MCQ</button></div>`;
    bindMcqEvents();
  }

  function startPractice(config, questionIds) {
    if (activePractice()) return;
    const pool = questionIds?.length ? questions.filter((question) => questionIds.includes(question.id)) : practicePool(config);
    if (!pool.length) { alert("No questions match these filters. Try Mixed difficulty or All Chapters."); return; }
    const now = Date.now();
    const selected = shuffled(pool, hashPractice(`${studentId()}:${now}:${JSON.stringify(config)}`)).slice(0, questionIds?.length || Math.min(config.requestedCount, pool.length));
    const session = { id: `practice:${now}`, bankRevision: learningData.revision, config: { ...config }, questionIds: selected.map((question) => question.id), answers: {}, startedAt: now };
    savePractice([session, ...practiceHistory()]);
    mcqUi.practiceIndex = 0;
    mcqUi.practiceResult = null;
    renderPractice();
  }

  function renderPracticeQuiz(session) {
    const sessionQuestions = session.questionIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean);
    mcqUi.practiceIndex = Math.min(mcqUi.practiceIndex, sessionQuestions.length - 1);
    const question = sessionQuestions[mcqUi.practiceIndex];
    const answered = Object.keys(session.answers || {}).length;
    const elapsed = Math.max(1, Math.floor((Date.now() - session.startedAt) / 1000));
    activeRoot.innerHTML = `<div class="lt-shell lt-mcq-shell" data-testid="practice-quiz">${renderQuestion(question, session.answers[question.id], mcqUi.practiceIndex, sessionQuestions.length, answered, "practice", formatDuration(elapsed))}${quizNavigationHtml(mcqUi.practiceIndex, sessionQuestions.length, session.answers, session.questionIds, "practice")}<button class="lt-text-button danger" data-practice-action="abandon">Discard practice session</button></div>`;
    bindMcqEvents();
    setClockUpdater(() => {
      const clock = $(".js-practice-clock");
      if (clock) clock.innerHTML = `${icon("stopwatch")} ${formatDuration(Math.max(1, Math.floor((Date.now() - session.startedAt) / 1000)))}`;
    });
  }

  function answerPractice(option) {
    const history = practiceHistory();
    const session = history.find((item) => !item.completedAt);
    if (!session) return;
    const questionId = session.questionIds[mcqUi.practiceIndex];
    const updated = { ...session, answers: { ...session.answers, [questionId]: option } };
    savePractice(history.map((item) => item.id === session.id ? updated : item));
    renderPracticeQuiz(updated);
  }

  function submitPractice() {
    const history = practiceHistory();
    const session = history.find((item) => !item.completedAt);
    if (!session) return;
    const sessionQuestions = session.questionIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean);
    const completedAt = Date.now();
    const updated = { ...session, completedAt, score: sessionQuestions.reduce((total, question) => total + (session.answers[question.id] === question.answer ? 1 : 0), 0), total: sessionQuestions.length, durationSeconds: Math.max(1, Math.floor((completedAt - session.startedAt) / 1000)), review: buildReview(sessionQuestions, session) };
    savePractice(history.map((item) => item.id === session.id ? updated : item), true);
    mcqUi.practiceResult = updated;
    renderPractice();
  }

  function renderPracticeResult(result) {
    const resultQuestions = questionsFromAttempt(result);
    const wrongIds = resultQuestions.filter((question) => result.answers[question.id] !== question.answer).map((question) => question.id);
    const percentage = result.total ? Math.round(((result.score || 0) / result.total) * 100) : 0;
    activeRoot.innerHTML = `<div class="lt-shell lt-mcq-shell" data-testid="practice-result"><section class="lt-result-hero ${percentage < 70 ? "low" : ""}"><span>${icon(percentage >= 70 ? "trophy" : "chart-simple")}</span><small>UNLIMITED PRACTICE RESULT</small><h2>${percentage}%</h2><p>${result.score}/${result.total} correct · ${formatDuration(result.durationSeconds)}</p><b>${escapeHtml(result.config.group)} · ${escapeHtml(result.config.subject)} · ${escapeHtml(result.config.difficulty)}</b></section><h3 class="lt-section-title">Answer review</h3>${reviewCards(resultQuestions, result)}${wrongIds.length ? `<button class="lt-wide-button" data-practice-action="retry" data-question-ids="${escapeAttr(wrongIds.join(","))}">${icon("rotate-right")} Retry ${wrongIds.length} incorrect question${wrongIds.length === 1 ? "" : "s"}</button>` : ""}<button class="lt-wide-button secondary" data-practice-action="another">${icon("infinity")} Start another practice</button><button class="lt-wide-button secondary" data-mcq-action="daily">${icon("calendar")} Back to Daily MCQ</button></div>`;
    bindMcqEvents();
  }

  function bindMcqEvents() {
    activeRoot.onclick = (event) => {
      const groupButton = event.target.closest("[data-daily-group]");
      if (groupButton) {
        const current = attemptForGroup(mcqUi.selectedGroup);
        if (current && !current.completedAt && groupButton.dataset.dailyGroup !== mcqUi.selectedGroup) {
          alert(`Finish your ${mcqUi.selectedGroup} timer before switching groups.`);
          return;
        }
        mcqUi.selectedGroup = groupButton.dataset.dailyGroup;
        mcqUi.dailyIndex = 0;
        renderDaily();
        return;
      }

      const actionButton = event.target.closest("[data-mcq-action]");
      if (actionButton) {
        const action = actionButton.dataset.mcqAction;
        if (action === "practice") { mcqUi.mode = "practice"; mcqUi.practiceResult = null; renderPractice(); }
        if (action === "daily") { mcqUi.mode = "daily"; renderDaily(); }
        if (action === "start-daily") startDaily(mcqUi.selectedGroup);
        return;
      }

      const dailyOption = event.target.closest("[data-daily-option]");
      if (dailyOption) { answerDaily(Number(dailyOption.dataset.dailyOption)); return; }
      const dailyNav = event.target.closest("[data-daily-nav]");
      if (dailyNav) {
        mcqUi.dailyIndex += dailyNav.dataset.dailyNav === "next" ? 1 : -1;
        renderDaily();
        return;
      }
      const dailyDot = event.target.closest("[data-daily-dot]");
      if (dailyDot) { mcqUi.dailyIndex = Number(dailyDot.dataset.dailyDot); renderDaily(); return; }
      const openDaily = event.target.closest("[data-daily-open-result]");
      if (openDaily) {
        const past = dailyHistory().find((item) => item.group === mcqUi.selectedGroup && item.date === openDaily.dataset.dailyOpenResult && item.completedAt);
        if (past) renderDailyResult(mcqUi.selectedGroup, past);
        return;
      }
      if (event.target.closest("[data-daily-submit]")) {
        const attempt = attemptForGroup(mcqUi.selectedGroup);
        const unanswered = attempt.questionIds.length - Object.keys(attempt.answers || {}).length;
        if (confirm(unanswered ? `${unanswered} unanswered question${unanswered === 1 ? "" : "s"} will count as incorrect. Submit?` : "Submit your daily challenge?")) { submitDaily(mcqUi.selectedGroup); renderDaily(); }
        return;
      }

      const filter = event.target.closest("[data-practice-filter]");
      if (filter) {
        const config = mcqUi.practiceConfig || defaultPracticeConfig();
        const name = filter.dataset.practiceFilter;
        const value = name === "requestedCount" ? Number(filter.dataset.value) : filter.dataset.value;
        config[name] = value;
        if (name === "group") { config.subject = "All Subjects"; config.chapter = "All Chapters"; }
        if (name === "subject") config.chapter = "All Chapters";
        mcqUi.practiceConfig = config;
        renderPracticeSetup();
        return;
      }

      const openPractice = event.target.closest("[data-practice-open-result]");
      if (openPractice) {
        const past = practiceHistory().find((session) => session.id === openPractice.dataset.practiceOpenResult);
        if (past) { mcqUi.practiceResult = past; renderPractice(); }
        return;
      }

      const practiceAction = event.target.closest("[data-practice-action]");
      if (practiceAction) {
        const action = practiceAction.dataset.practiceAction;
        if (action === "start") startPractice(mcqUi.practiceConfig || defaultPracticeConfig());
        if (action === "abandon" && confirm("Discard this practice session? Current answers will be removed.")) {
          const active = activePractice();
          if (active) savePractice(practiceHistory().filter((session) => session.id !== active.id));
          mcqUi.practiceIndex = 0;
          renderPractice();
        }
        if (action === "another") { mcqUi.practiceResult = null; mcqUi.practiceIndex = 0; renderPractice(); }
        if (practiceAction.dataset.practiceOpenResult) {
          const past = practiceHistory().find((session) => session.id === practiceAction.dataset.practiceOpenResult);
          if (past) { mcqUi.practiceResult = past; renderPractice(); }
          return;
        }
        if (action === "retry") {
          const ids = String(practiceAction.dataset.questionIds || "").split(",").filter(Boolean);
          const config = { ...(mcqUi.practiceResult?.config || defaultPracticeConfig()), requestedCount: ids.length };
          mcqUi.practiceResult = null;
          startPractice(config, ids);
        }
        return;
      }

      const practiceOption = event.target.closest("[data-practice-option]");
      if (practiceOption) { answerPractice(Number(practiceOption.dataset.practiceOption)); return; }
      const practiceNav = event.target.closest("[data-practice-nav]");
      if (practiceNav) {
        mcqUi.practiceIndex += practiceNav.dataset.practiceNav === "next" ? 1 : -1;
        renderPractice();
        return;
      }
      const practiceDot = event.target.closest("[data-practice-dot]");
      if (practiceDot) { mcqUi.practiceIndex = Number(practiceDot.dataset.practiceDot); renderPractice(); return; }
      if (event.target.closest("[data-practice-submit]")) {
        const active = activePractice();
        const unanswered = active.questionIds.length - Object.keys(active.answers || {}).length;
        if (confirm(unanswered ? `${unanswered} unanswered question${unanswered === 1 ? "" : "s"} will count as incorrect. Finish practice?` : "Finish and submit this practice?")) submitPractice();
      }
    };
  }

  function getPerformanceAttempts(id) {
    const daily = loadJson(`ump_daily_mcq_${id}`, []);
    const practice = loadJson(`ump_mcq_practice_${id}`, []);
    const normalizedDaily = (Array.isArray(daily) ? daily : []).filter((attempt) => attempt.completedAt).map((attempt) => ({
      date: attempt.completedAt || attempt.date,
      subject: attempt.group,
      chapter: "Daily MCQ Challenge",
      score: Number(attempt.score || 0),
      total: Number(attempt.total || 0),
      percentage: attempt.total ? Math.round((Number(attempt.score || 0) / attempt.total) * 100) : 0,
      timeTaken: Number(attempt.durationSeconds || 0),
    }));
    const normalizedPractice = (Array.isArray(practice) ? practice : []).filter((session) => session.completedAt).map((session) => ({
      date: session.completedAt,
      subject: session.config?.subject === "All Subjects" ? session.config?.group || "Combined" : session.config?.subject || "Practice",
      chapter: session.config?.chapter || "All Chapters",
      score: Number(session.score || 0),
      total: Number(session.total || 0),
      percentage: session.total ? Math.round((Number(session.score || 0) / session.total) * 100) : 0,
      timeTaken: Number(session.durationSeconds || 0),
    }));
    return [...normalizedDaily, ...normalizedPractice].sort((left, right) => new Date(right.date) - new Date(left.date));
  }

  // Pure logic surface used by the web workflow tests (scripts/test-web.js) and
  // kept in sync with the APK implementations in mobile/src.
  window.UMP_LEARNING_TOOLS = {
    renderFocus,
    renderMCQ,
    replaceLearningData,
    getPerformanceAttempts,
    cleanup,
    parity: {
      buildRecallQuestions,
      recallSessionKind,
      dailyQuestionIds,
      dailyStreak,
      groupsForStudent,
      subjectGroup,
      practicePool,
      hashDaily,
      seededRandom,
      questions: () => questions,
      revision: () => learningData.revision,
      chapters: () => (learningData.officialMcqChapterCatalog || []),
      manifest: () => learningData.manifest,
    },
  };

  // Status-only changes (loading → error/stale) also need to refresh the empty
  // bank panel even when the question array itself did not change.
  window.addEventListener?.("ump:live-bank-change", () => {
    if (activeFeature === "mcq" && activeRoot && !questions.length) {
      renderPublishedBankState();
    }
  });
})();
