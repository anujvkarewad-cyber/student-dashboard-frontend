const APP_VERSION = "2.1.7";

(function () {
  "use strict";
  let currentStudent = null;
  let forcedTheme = localStorage.getItem("ump_dev_theme") || null;
  const api = window.UMP_API;

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ----- state -----
  const state = {
    student: null,
    stats: null,
    log: [],
    leaderboard: [],
    reports: [],
    charts: {},
    notifSeen: { announcements: new Set(), mentorNotes: new Set(), notes: new Set(), reports: new Set() },
    notifUnread: 0,
    notifFeed: [],
    notifConsecutiveFailures: 0,
    // MCQ
    mcq: {
      subject: null,
      chapter: null,
      questions: [],
      answers: [],
      index: 0,
      startedAt: 0,
      timerId: null,
      timeLeft: 0,
    },
  };

  // ✅ FIX: Add request guard flags
  let isCheckingNotifications = false;
  let isRefreshingData = false;

  const VIEW_TITLES = {
    dashboard: "Dashboard",
    tracker: "Daily Study Tracker",
    mcq: "MCQ Practice",
    performance: "Performance",
    leaderboard: "Leaderboard",
    reports: "Weekly Reports",
    notes: "Notes & Study Material",
    profile: "Profile",
  };

  // ============ AUTH ============
  let savedStudent = null;
  try {
    savedStudent = JSON.parse(localStorage.getItem("ump_student"));
  } catch (err) {
    console.error("Corrupt saved session, clearing it:", err);
    localStorage.removeItem("ump_student");
  }

  async function boot() {
    const loader = $("#boot-loader");
    const loginScreen = $("#login-screen");

    if (!savedStudent) {
      if (loader) loader.hidden = true;
      loginScreen.hidden = false;
      return;
    }

    try {
      const s = await api.validateLogin(
        savedStudent.studentId,
        savedStudent.password
      );

      if (s.success) {
        if (s.forcePasswordChange) {
          showChangePasswordScreen(s);
        } else {
          await enterApp(s);
        }
      } else {
        localStorage.removeItem("ump_student");
        loginScreen.hidden = false;
      }
    } catch (err) {
      console.error("Auto-login failed:", err);
      loginScreen.hidden = false;
    } finally {
      if (loader) loader.hidden = true;
    }
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = $("#student-id").value.trim().toUpperCase();
    const password = $("#password").value;

    const err = $("#login-error");
    const btn = e.target.querySelector("button[type=submit]");

    err.hidden = true;

    if (!id || !password) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

    const result = await api.validateLogin(id, password);

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>Login</span>';

    if (!result.success) {
      err.hidden = true;
      showLoginErrorPopup(result.message);
      return;
    }

    localStorage.setItem(
      "ump_student",
      JSON.stringify({ studentId: id, password: password })
    );

    if (result.forcePasswordChange) {
      showChangePasswordScreen(result);
      return;
    }

    enterApp(result);
  });

  $("#logout-btn").addEventListener("click", () => {
    localStorage.removeItem("ump_student");
    location.reload();
  });

  async function enterApp(student) {
    currentStudent = student;
    state.student = student;
    $("#login-screen").hidden = true;
    $("#app-shell").hidden = false;

    const loader = $("#boot-loader");
    if (loader) loader.hidden = true;

    const version = document.getElementById("app-version");
    if (version) version.textContent = `Version ${APP_VERSION}`;

    const initials = (student.studentName || "S").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
    $("#user-avatar").textContent = initials;
    $("#user-name").textContent = student.studentName;
    $("#user-id").textContent = student.studentId;

    // safe defaults so an early navigate() doesn't hit undefined data
    state.stats = {};
    state.log = [];
    state.leaderboard = [];
    state.reports = [];
    state.announcements = [];
    state.mentorNotes = [];
    state.studyNotes = [];

    const studentId = student.studentId;

    // load core data in small parallel batches — full parallel (7 at once)
    // overloads Apps Script, full sequential is too slow. Batches of ~3 balance both.
    const [stats, log, lb] = await Promise.all([
      safeFetch(() => api.getStats(studentId), {}),
      safeFetch(() => api.getStudyLog(studentId), []),
      safeFetch(() => api.getLeaderboard(), []),
    ]);
    state.stats = stats;
    state.log = log;
    state.leaderboard = lb;
    $("#topbar-streak").textContent = stats.streak ?? 0;

    const [reports, announcements] = await Promise.all([
      safeFetch(() => api.getWeeklyReports(studentId), []),
      safeFetch(() => api.getAnnouncements(), []),
    ]);
    state.reports = reports;
    state.announcements = announcements;

    const [notes, studyNotes] = await Promise.all([
      safeFetch(() => api.getStudentMentorNotes(studentId), []),
      safeFetch(() => api.getNotes(studentId), []),
    ]);
    state.mentorNotes = notes;
    state.studyNotes = studyNotes;

    // route — do this once, after data is loaded
    const initial = (location.hash || "#dashboard").slice(1);
    navigate(VIEW_TITLES[initial] ? initial : "dashboard");

    // mentor feedback popup (non-blocking, after route)
    const feedbacks = await safeFetch(() => api.getMentorFeedback(studentId), []);
    if (Array.isArray(feedbacks) && feedbacks.length > 0) {
      showMentorFeedback(feedbacks[0]);
    }

    // notifications: seed baseline (don't toast for stuff that already existed) + start polling
    seedNotifBaseline();
    checkStreakReminder();
    if (window.UMP_PUSH) window.UMP_PUSH.requestAndSaveToken(studentId);

    if (!state._notifPollStarted) {
      state._notifPollStarted = true;
      setInterval(() => {
        if (!state.student) return;
        checkForNewNotifications();
        checkStreakReminder();
      }, 300000); // every 5 min — lighter on Apps Script

      setInterval(() => { state.notifConsecutiveFailures = 0; }, 300000);
    }
  }

  // =======================================
  // PASSWORD CHANGE
  // =======================================

  async function updatePassword() {
    const currentPassword = $("#current-password").value.trim();
    const newPassword = $("#new-password").value.trim();
    const confirmPassword = $("#confirm-password").value.trim();

    const msg = $("#password-msg");
    msg.innerHTML = "";
    msg.style.color = "red";

    if (!currentPassword || !newPassword || !confirmPassword) {
      msg.innerHTML = "Please fill all fields.";
      return;
    }
    if (newPassword !== confirmPassword) {
      msg.innerHTML = "New Password and Confirm Password do not match.";
      return;
    }
    if (newPassword.length < 6) {
      msg.innerHTML = "Password must be at least 6 characters.";
      return;
    }

    try {
      const result = await api.changePassword(
        currentStudent.studentId,
        currentPassword,
        newPassword
      );

      if (!result.success) {
        msg.innerHTML = result.message;
        return;
      }

      localStorage.setItem(
        "ump_student",
        JSON.stringify({ studentId: currentStudent.studentId, password: newPassword })
      );

      msg.style.color = "green";
      msg.innerHTML = "Password updated successfully.";

      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      msg.innerHTML = err;
    }
  }

  function showChangePasswordScreen(student) {
    enterApp(student);

    setTimeout(() => {
      navigate("profile");

      const msg = document.createElement("div");
      msg.style.background = "#fff3cd";
      msg.style.color = "#856404";
      msg.style.padding = "15px";
      msg.style.borderRadius = "8px";
      msg.style.marginBottom = "20px";
      msg.style.fontWeight = "600";
      msg.innerHTML = "⚠ This is your first login. Please change your password before using the dashboard.";

      const profile = document.querySelector(".profile-page");
      if (profile) profile.prepend(msg);
    }, 500);
  }

  // ============ ROUTER ============
  function navigate(view) {
    try {
      if (!VIEW_TITLES[view]) view = "dashboard";

      history.replaceState(null, "", "#" + view);

      $$(".nav-item[data-view]").forEach(el =>
        el.classList.toggle("active", el.dataset.view === view)
      );

      $("#view-title").textContent = VIEW_TITLES[view];

      Object.values(state.charts).forEach(c => c && c.destroy());
      state.charts = {};
    } catch (e) {
      console.error(e);
      return;
    }

    const tpl = document.getElementById("tpl-" + view);
    if (!tpl) {
      console.error("Template not found:", view);
      return;
    }

    const node = tpl.content.cloneNode(true);
    const container = $("#view-container");
    container.innerHTML = "";
    container.appendChild(node);

    try {
      ({
        dashboard: renderDashboard,
        tracker: renderTracker,
        mcq: renderMCQ,
        performance: renderPerformance,
        leaderboard: renderLeaderboard,
        reports: renderReports,
        notes: renderNotes,
        profile: renderProfile,
      })[view]();
    } catch (e) {
      console.error("RENDER ERROR:", e);
    }
  }

  $$(".nav-item[data-view]").forEach(el =>
    el.addEventListener("click", (e) => { e.preventDefault(); navigate(el.dataset.view); })
  );
  
  window.addEventListener("hashchange", () => {
    const v = (location.hash || "#dashboard").slice(1);
    if (state.student) navigate(v);
  });

  const menuToggleBtn = $("#menu-toggle-btn");
  const sidebarEl = $(".sidebar");
  if (menuToggleBtn && sidebarEl) {
    menuToggleBtn.addEventListener("click", () => {
      sidebarEl.classList.toggle("open");
    });

    $$(".nav-item[data-view]").forEach(el =>
      el.addEventListener("click", () => sidebarEl.classList.remove("open"))
    );
  }

  // ============ HELPERS ============
  const fmt = (n, d = 1) => (n == null || isNaN(n) ? "—" : Number(n).toFixed(d).replace(/\.0$/, ""));

  const timeOfDay = () => {
    if (forcedTheme && forcedTheme !== "auto") return forcedTheme;

    const h = new Date().getHours();
    if (h >= 5 && h < 10) return "morning";
    if (h >= 10 && h < 17) return "afternoon";
    if (h >= 17 && h < 19) return "evening";
    return "night";
  };

  const dayShort = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };

  const rankBadgeText = (r) => {
    if (r === 1) return "Diamond";
    if (r === 2) return "Platinum";
    if (r === 3) return "Gold";
    if (r <= 5) return "Silver";
    if (r <= 10) return "Bronze";
    return "Rising";
  };

  // ============ VIEWS ============
  function renderDashboard() {
    const s = state.student;
    const st = state.stats || {};
    const tod = timeOfDay();

    $("[data-tod]").textContent = tod;

    const hero = document.querySelector(".welcome-strip");
    hero.classList.remove("hero-morning", "hero-afternoon", "hero-evening", "hero-night");

    switch (tod.toLowerCase()) {
      case "morning":
        hero.classList.add("hero-morning");
        break;
      case "afternoon":
        hero.classList.add("hero-afternoon");
        break;
      case "evening":
        hero.classList.add("hero-evening");
        break;
      default:
        hero.classList.add("hero-night");
    }

    $("[data-hello]").textContent = s.studentName;
    $("[data-caLevel]").textContent = `${s.caLevel} · ${s.group}`;
    $("[data-k='streak']").textContent = st.streak ?? 0;
    $("[data-k='today']").textContent = fmt(st.todayHours, 1);
    $("[data-k='weekly']").textContent = fmt(st.weeklyHours, 1);
    $("[data-k='monthly']").textContent = fmt(st.monthlyHours, 1);
    $("[data-k='total']").textContent = fmt(st.totalHours, 1);
    $("[data-k='avg']").textContent = fmt(st.averageHours, 1) + " hr";
    $("[data-k='sessions']").textContent = st.totalEntries ?? 0;
    $("[data-k='last']").textContent = dayShort(st.lastSubmission) || "—";
    $("[data-k='rank']").textContent = "#" + (st.rank ?? "-");
    $("[data-k='weekly2']").textContent = fmt(st.weeklyHours, 1) + " hr";
    $("[data-cohort]").textContent = state.leaderboard.length + " students";
    $("[data-rankBadge]").textContent = rankBadgeText(st.rank || 999);

    const pct = Math.min(100, Math.round(((st.totalHours || 0) / 1000) * 100));
    $("[data-progressBar]").style.width = pct + "%";
    $("[data-progressPct]").textContent = pct + "% to 1000 hr goal";

    const ctx = document.getElementById("chart-weekly").getContext("2d");
    const labels = lastNDates(7);
    const data = st.last7 || Array(7).fill(0);
    state.charts.weekly = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Study Hours",
          data,
          borderColor: "#2563EB",
          backgroundColor: (ctx) => {
            const chart = ctx.chart;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return null;

            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, "rgba(37,99,235,.30)");
            gradient.addColorStop(.6, "rgba(139,92,246,.12)");
            gradient.addColorStop(1, "rgba(255,255,255,0)");
            return gradient;
          },
          fill: true,
          tension: .45,
          borderWidth: 4,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointBackgroundColor: "#FFFFFF",
          pointBorderColor: "#2563EB",
          pointBorderWidth: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            displayColors: false,
            backgroundColor: "#0F172A",
            titleColor: "#fff",
            bodyColor: "#fff"
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: "#64748B",
              font: { family: "Plus Jakarta Sans", weight: "600", size: window.innerWidth < 480 ? 10 : 12 },
              maxRotation: 0,
              minRotation: 0,
              autoSkip: true,
              maxTicksLimit: window.innerWidth < 480 ? 4 : 7
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: "#EEF2F7" },
            ticks: {
              color: "#64748B",
              stepSize: 2,
              font: { size: window.innerWidth < 480 ? 10 : 12 }
            }
          }
        }
      }
    });

    const box = document.getElementById("announcement-list");
    if (box) {
      if (!state.announcements || state.announcements.length === 0) {
        box.innerHTML = "<div class='muted'>No announcements available.</div>";
      } else {
        box.innerHTML = state.announcements.map(a => `
          <div class="announcement-item">
            <div class="announcement-dot"></div>
            <div class="announcement-content">
              <div class="announcement-top">
                <h4>${escapeHtml(a.title)}</h4>
                <span>${escapeHtml(a.date)}</span>
              </div>
              <p>${escapeHtml(a.message)}</p>
            </div>
          </div>
        `).join("");
      }
    }

    const notesBox = document.getElementById("mentor-notes-list");
    if (notesBox) {
      renderMentorNotes(state.mentorNotes || []);
    }
  }

  function lastNDates(n) {
    const arr = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      arr.push(d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }));
    }
    return arr;
  }

  function renderTracker() {
    const st = state.stats || {};
    $$("[data-k='sessions']").forEach(el => el.textContent = st.totalEntries ?? 0);
    $$("[data-k='total']").forEach(el => el.textContent = fmt(st.totalHours, 1));
    $$("[data-k='avg']").forEach(el => el.textContent = fmt(st.averageHours, 1));
    $$("[data-k='weekly']").forEach(el => el.textContent = fmt(st.weeklyHours, 1));

    const tb = $("#tracker-tbody");
    tb.innerHTML = state.log.length ? state.log.map(row => `
      <tr>
        <td><b>${dayShort(row.date)}</b></td>
        <td>${escapeHtml(row.topic || "")}</td>
        <td><b class="mono">${fmt(row.hours, 1)}</b></td>
        <td>${row.proof && row.proof !== "#" ? `<a href="${row.proof}" target="_blank"><i class="fa-solid fa-arrow-up-right-from-square"></i> View</a>` : "—"}</td>
      </tr>`).join("")
      : `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:30px">No submissions yet — start logging your daily study!</td></tr>`;

    const trackerBtn = $("#open-tracker-form");
    if (trackerBtn) {
      trackerBtn.addEventListener("click", openTrackerModal);
    }

    const refreshBtn = $("#refresh-tracker-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        const icon = refreshBtn.querySelector("i");
        icon.classList.add("fa-spin");
        refreshBtn.disabled = true;
        try {
          const [stats, log] = await Promise.all([
            api.getStats(state.student.studentId),
            api.getStudyLog(state.student.studentId)
          ]);
          state.stats = stats;
          state.log = log;
          $("#topbar-streak").textContent = stats.streak ?? 0;
          renderTracker();
        } catch (err) {
          console.error("Manual tracker refresh failed:", err);
        } finally {
          icon.classList.remove("fa-spin");
          refreshBtn.disabled = false;
        }
      });
    }
  }

  // ---------- MCQ ----------
  function renderMCQ() {
    const grid = $("#mcq-subjects");
    grid.innerHTML = api.getSubjects().map(s => `
      <div class="subject-card" data-subject="${s.id}" data-testid="subject-${s.id}"
        style="--sc-color:${s.color};--sc-bg:${s.bg}">
        <div class="sc-icon"><i class="fa-solid ${s.icon}"></i></div>
        <div class="sc-title">${escapeHtml(s.name)}</div>
        <div class="sc-meta">${api.getChapters(s.id).length} chapters available</div>
        <div class="sc-arrow"><i class="fa-solid fa-arrow-right"></i></div>
      </div>
    `).join("");

    $$(".subject-card", grid).forEach(el => el.addEventListener("click", () => showChapters(el.dataset.subject)));
    $$("[data-mcq-back]").forEach(el => el.addEventListener("click", () => showSubjectsPanel()));
  }

  function showSubjectsPanel() {
    $("#mcq-subjects").hidden = false;
    $("#mcq-chapters").hidden = true;
    $("#mcq-quiz").hidden = true;
    $("#mcq-result").hidden = true;
    stopTimer();
  }

  function showChapters(subjectId) {
    const subject = api.getSubjects().find(s => s.id === subjectId);
    state.mcq.subject = subject;
    $("#mcq-subjects").hidden = true;
    $("#mcq-chapters").hidden = false;
    $("#mcq-subject-title").textContent = `${subject.name} · Chapters`;

    const chapters = api.getChapters(subjectId);
    const grid = $("#chapter-grid");
    grid.innerHTML = chapters.map(c => `
      <div class="chapter-card" data-testid="chapter-${c.id}">
        <div class="chapter-name">${escapeHtml(c.name)}</div>
        <div class="chapter-meta">
          <span class="tag difficulty-${c.difficulty.toLowerCase()}">${c.difficulty}</span>
          <span class="tag">${c.questions} Qs</span>
        </div>
        <div class="chapter-stats">
          <span>Last score: <b>${c.lastScore != null ? c.lastScore + "%" : "—"}</b></span>
          <span>${c.lastAttempt ? dayShort(c.lastAttempt) : "New"}</span>
        </div>
        <button class="btn-primary sm" data-start="${c.id}" data-testid="start-quiz-${c.id}">
          <i class="fa-solid fa-play"></i> Start Quiz
        </button>
      </div>
    `).join("");

    $$("[data-start]", grid).forEach(btn =>
      btn.addEventListener("click", () => startQuiz(subjectId, btn.dataset.start))
    );
  }

  async function startQuiz(subjectId, chapterId) {
    const chapter = api.getChapters(subjectId).find(c => c.id === chapterId);
    state.mcq.chapter = chapter;
    state.mcq.questions = await api.getQuestions(subjectId, chapterId, 10);
    state.mcq.answers = new Array(state.mcq.questions.length).fill(null);
    state.mcq.index = 0;
    state.mcq.startedAt = Date.now();
    state.mcq.timeLeft = state.mcq.questions.length * 60;

    $("#mcq-chapters").hidden = true;
    $("#mcq-quiz").hidden = false;
    renderQuizStep();
    startTimer();
  }

  function renderQuizStep() {
    const { questions, index, answers, chapter } = state.mcq;
    const q = questions[index];
    const total = questions.length;
    const answered = answers.filter(a => a != null).length;

    $("#mcq-quiz").innerHTML = `
      <div class="card">
        <div class="quiz-topbar">
          <div>
            <div class="quiz-qnum">Question ${index + 1} / ${total}</div>
            <h3 style="margin-top:4px">${escapeHtml(chapter.name)}</h3>
          </div>
          <div class="quiz-progress">
            <div class="quiz-progress-bar"><div class="quiz-progress-fill" style="width:${(answered / total) * 100}%"></div></div>
            <div class="quiz-progress-label">${answered} of ${total} answered</div>
          </div>
          <div id="quiz-timer" class="quiz-timer" data-testid="quiz-timer"><i class="fa-regular fa-clock"></i> <span></span></div>
        </div>

        <div class="quiz-question" data-testid="quiz-question">${escapeHtml(q.q)}</div>
        <div class="quiz-options" data-testid="quiz-options">
          ${q.options.map((opt, i) => `
            <div class="quiz-option ${answers[index] === i ? "selected" : ""}" data-opt="${i}" data-testid="quiz-option-${i}">
              <div class="qo-letter">${String.fromCharCode(65 + i)}</div>
              <div>${escapeHtml(opt)}</div>
            </div>
          `).join("")}
        </div>

        <div class="quiz-actions">
          <button class="btn-ghost" id="quiz-prev" ${index === 0 ? "disabled" : ""} data-testid="quiz-prev-btn">
            <i class="fa-solid fa-arrow-left"></i> Previous
          </button>
          ${index < total - 1
            ? `<button class="btn-primary sm" id="quiz-next" data-testid="quiz-next-btn">Next <i class="fa-solid fa-arrow-right"></i></button>`
            : `<button class="btn-primary sm" id="quiz-submit" data-testid="quiz-submit-btn"><i class="fa-solid fa-check"></i> Submit Quiz</button>`
          }
        </div>
      </div>
    `;

    $$("[data-opt]").forEach(el => el.addEventListener("click", () => {
      state.mcq.answers[state.mcq.index] = Number(el.dataset.opt);
      renderQuizStep();
    }));
    const prev = $("#quiz-prev");   if (prev) prev.addEventListener("click", () => { state.mcq.index--; renderQuizStep(); });
    const next = $("#quiz-next");   if (next) next.addEventListener("click", () => { state.mcq.index++; renderQuizStep(); });
    const sub  = $("#quiz-submit"); if (sub)  sub.addEventListener("click", submitQuiz);
    updateTimerDisplay();
  }

  function startTimer() {
    stopTimer();
    updateTimerDisplay();
    state.mcq.timerId = setInterval(() => {
      state.mcq.timeLeft--;
      if (state.mcq.timeLeft <= 0) {
        stopTimer();
        submitQuiz();
        return;
      }
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    if (state.mcq.timerId) {
      clearInterval(state.mcq.timerId);
      state.mcq.timerId = null;
    }
  }

  function updateTimerDisplay() {
    const el = $("#quiz-timer");
    if (!el) return;
    const t = state.mcq.timeLeft;
    const m = Math.floor(t / 60), s = t % 60;
    el.querySelector("span").textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    el.classList.toggle("warn", t <= 30);
  }

  async function submitQuiz() {
    stopTimer();
    const { questions, answers, chapter, startedAt } = state.mcq;
    let correct = 0;
    answers.forEach((a, i) => { if (a === questions[i].answer) correct++; });
    const total = questions.length;
    const pct = Math.round((correct / total) * 100);
    const timeTaken = Math.round((Date.now() - startedAt) / 1000);
    const level = pct >= 85 ? "Excellent" : pct >= 70 ? "Good" : pct >= 50 ? "Average" : "Needs work";

    await api.saveQuizAttempt(state.student.studentId, {
      subject: state.mcq.subject.name,
      chapter: chapter.name,
      chapterId: chapter.id,
      score: correct,
      total,
      percentage: pct,
      timeTaken
    });

    $("#mcq-quiz").hidden = true;
    $("#mcq-result").hidden = false;
    $("#mcq-result").innerHTML = `
      <div class="card">
        <div class="result-icon"><i class="fa-solid ${pct >= 70 ? "fa-trophy" : "fa-flag-checkered"}"></i></div>
        <div class="result-title">${pct}%</div>
        <div class="result-sub">${escapeHtml(chapter.name)} · ${level}</div>
        <div class="result-grid">
          <div><b>${correct}</b><span>Correct</span></div>
          <div><b>${total - correct}</b><span>Wrong</span></div>
          <div><b>${total}</b><span>Total</span></div>
          <div><b>${Math.floor(timeTaken / 60)}:${String(timeTaken % 60).padStart(2, "0")}</b><span>Time taken</span></div>
        </div>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn-ghost" id="review-btn" data-testid="review-answers-btn"><i class="fa-solid fa-list"></i> Review Answers</button>
          <button class="btn-primary sm" id="mcq-done" data-testid="mcq-done-btn"><i class="fa-solid fa-arrow-right"></i> Back to Chapters</button>
        </div>
        <div id="review-panel" hidden style="margin-top:28px;text-align:left"></div>
      </div>
    `;
    $("#mcq-done").addEventListener("click", () => { $("#mcq-result").hidden = true; showChapters(state.mcq.subject.id); });
    $("#review-btn").addEventListener("click", () => renderReview());
  }

  function renderReview() {
    const { questions, answers } = state.mcq;
    const el = $("#review-panel");
    el.hidden = false;
    el.innerHTML = questions.map((q, i) => {
      const ans = answers[i], correct = q.answer;
      return `
        <div class="card" style="margin-top:12px;text-align:left">
          <div style="font-weight:700;margin-bottom:10px">Q${i + 1}. ${escapeHtml(q.q)}</div>
          ${q.options.map((opt, j) => {
            const isCorrect = j === correct;
            const isChosen = j === ans;
            const bg = isCorrect ? "background:#E7FBF3;color:#065F46;border-color:#10B981;" :
                       isChosen ? "background:#FEE2E2;color:#B91C1C;border-color:#F87171;" : "";
            return `<div class="quiz-option" style="cursor:default;${bg}">
              <div class="qo-letter">${String.fromCharCode(65 + j)}</div>
              <div>${escapeHtml(opt)} ${isCorrect ? '<b style="margin-left:6px">✓ Correct</b>' : isChosen ? '<b style="margin-left:6px">Your answer</b>' : ""}</div>
            </div>`;
          }).join("")}
        </div>
      `;
    }).join("");
    el.scrollIntoView({ behavior: "smooth" });
  }

  // ---------- Performance ----------
  function renderPerformance() {
    const attempts = api.getLocalAttempts(state.student.studentId);
    const total = attempts.reduce((a, x) => a + x.total, 0);
    const correct = attempts.reduce((a, x) => a + x.score, 0);
    const overall = total ? Math.round((correct / total) * 100) : 0;
    const avg = attempts.length ? Math.round(attempts.reduce((a, x) => a + x.percentage, 0) / attempts.length) : 0;

    $("[data-p='overall']").textContent  = attempts.length ? overall + "%" : "—";
    $("[data-p='avg']").textContent      = attempts.length ? avg + "%"     : "—";
    $("[data-p='solved']").textContent   = total;
    $("[data-p='attempts']").textContent = attempts.length;

    const bySub = {};
    attempts.forEach(a => {
      bySub[a.subject] = bySub[a.subject] || { s: 0, t: 0 };
      bySub[a.subject].s += a.score;
      bySub[a.subject].t += a.total;
    });
    const subjLabels = Object.keys(bySub);
    const subjData = subjLabels.map(k => Math.round((bySub[k].s / bySub[k].t) * 100));

    const ctx = document.getElementById("chart-subjects").getContext("2d");
    state.charts.subjects = new Chart(ctx, {
      type: "bar",
      data: {
        labels: subjLabels.length ? subjLabels : ["Accounts", "Law", "Tax", "CMA"],
        datasets: [{
          label: "Accuracy %",
          data: subjLabels.length ? subjData : [0, 0, 0, 0],
          backgroundColor: ["#2563EB", "#8B5CF6", "#10B981", "#FB923C"],
          borderRadius: 10,
          barThickness: 34
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, max: 100, grid: { color: "#EEF0F4" }, ticks: { callback: v => v + "%" } },
          y: { grid: { display: false } }
        }
      }
    });

    const byCh = {};
    attempts.forEach(a => {
      byCh[a.chapter] = byCh[a.chapter] || { s: 0, t: 0 };
      byCh[a.chapter].s += a.score;
      byCh[a.chapter].t += a.total;
    });
    const chapters = Object.entries(byCh).map(([n, v]) => ({ name: n, acc: Math.round((v.s / v.t) * 100) }));
    chapters.sort((a, b) => b.acc - a.acc);
    const strong = chapters.slice(0, 3);
    const weak = chapters.slice(-3).reverse().filter(c => c.acc < 75);

    const renderList = (arr, empty) => arr.length
      ? arr.map(c => `<li><span>${escapeHtml(c.name)}</span><b>${c.acc}%</b></li>`).join("")
      : `<li style="justify-content:center;color:var(--muted)">${empty}</li>`;
    $("#strong-list").innerHTML = renderList(strong, "Take a few quizzes to see your strong chapters");
    $("#weak-list").innerHTML   = renderList(weak,   "Great work — no weak chapters yet");

    const tb = $("#attempts-tbody");
    tb.innerHTML = attempts.length ? attempts.slice(0, 10).map(a => `
      <tr>
        <td>${dayShort(a.date)}</td>
        <td>${escapeHtml(a.subject)}</td>
        <td>${escapeHtml(a.chapter)}</td>
        <td><b class="mono">${a.score}/${a.total}</b></td>
        <td>${a.percentage}%</td>
        <td>${Math.floor(a.timeTaken / 60)}m ${a.timeTaken % 60}s</td>
      </tr>
    `).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:30px">No quiz attempts yet — head to MCQ Practice to get started!</td></tr>`;
  }

  // ---------- Leaderboard ----------
  function renderLeaderboard() {
    const leaderboard = state.leaderboard || [];
    const me = leaderboard.find(x => x.studentId === state.student.studentId);
    const st = state.stats;

    $("[data-lb='current']").textContent = "#" + (me ? me.rank : st.rank || "-");
    $("[data-lb='weekly']").textContent  = "#" + (st.weeklyRank || (me && me.rank) || "-");
    $("[data-lb='monthly']").textContent = "#" + (st.monthlyRank || "-");

    const rows = leaderboard
      .filter(r => r)
      .slice(0, 10)
      .map(r => `
        <tr class="${r.studentId === state.student.studentId ? "me-row" : ""}" data-testid="lb-row-${r.rank}">
          <td><span class="rank-cell ${r.rank <= 3 ? "r" + r.rank : ""}">${r.rank}</span></td>
          <td><b>${escapeHtml(r.studentName)}</b><br><span class="muted mono">${escapeHtml(r.studentId)}</span></td>
          <td><b class="mono">${fmt(r.weeklyHours, 1)}</b></td>
          <td class="mono">${fmt(r.totalHours, 1)}</td>
          <td><i class="fa-solid fa-fire" style="color:var(--peach)"></i> ${r.streak}</td>
          <td><span class="status-pill status-${r.status}">${escapeHtml(r.status)}</span></td>
        </tr>
      `).join("");
    $("#lb-tbody").innerHTML = rows;
  }

  // ---------- Reports ----------
  function renderReports() {
    const list = $("#reports-list");
    list.innerHTML = state.reports.length ? state.reports.map(r => `
      <div class="report-item">
        <div>
          <div class="ri-title"><i class="fa-solid fa-calendar-week" style="color:var(--blue);margin-right:8px"></i>${escapeHtml(r.weekOf)}</div>
          <div class="ri-meta">Performance level: <b>${escapeHtml(r.level)}</b></div>
        </div>
        <div class="ri-stats">
          <span>Hours <b>${fmt(r.weeklyHours, 1)}</b></span>
          <span>Streak <b>${r.streak}</b></span>
          <span>Rank <b>#${r.rank}</b></span>
        </div>
      </div>
    `).join("") : `<div class="muted" style="text-align:center;padding:30px">Weekly reports will appear here every Sunday.</div>`;
  }

  // ---------- Notes ----------
  function renderNotes() {
    const box = document.getElementById("notes-list");
    if (!box) return;

    const groupBySubject = (list) => {
      const groups = {};
      (list || []).forEach(n => {
        const key = n.subject || "Other";
        (groups[key] = groups[key] || []).push(n);
      });
      return groups;
    };

    const groupByCategory = (list) => {
      const groups = {};
      (list || []).forEach(n => {
        const key = (n.category && String(n.category).trim()) ? String(n.category).trim() : "General";
        (groups[key] = groups[key] || []).push(n);
      });
      return groups;
    };

    const noteRowHtml = (n) => `
      <div class="report-item note-item" data-testid="note-${n.id}"
        style="display:flex;flex-direction:column;align-items:stretch;gap:12px;margin-bottom:12px;padding-bottom:14px;border-bottom:1px solid #EEF0F4;">
        <div style="display:flex;align-items:flex-start;gap:14px;min-width:0;width:100%">
          <div class="note-icon" style="flex-shrink:0"><i class="fa-solid fa-file-pdf"></i></div>
          <div style="min-width:0;flex:1">
            <div class="ri-title" style="white-space:normal;word-break:break-word;line-height:1.35">${escapeHtml(n.title)}</div>
            ${n.description ? `<div class="ri-meta" style="margin:4px 0">${escapeHtml(n.description)}</div>` : ""}
            <div class="ri-meta">${escapeHtml(n.date || "")}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;width:100%">
          <button class="btn btn-secondary" data-open-note="${n.id}" data-testid="open-${n.id}">
            <i class="fa-solid fa-eye"></i> Open
          </button>
        </div>
      </div>
    `;

    const folderCardHtml = (name, count, testidPrefix) => `
      <div class="report-item note-subject-card" data-folder="${escapeHtml(name)}" data-testid="${testidPrefix}-${escapeHtml(name)}"
        style="cursor:pointer;flex-direction:column;align-items:flex-start;gap:10px;">
        <div class="note-icon"><i class="fa-solid fa-folder"></i></div>
        <div class="ri-title">${escapeHtml(name)}</div>
        <div class="ri-meta">${count} file${count > 1 ? "s" : ""}</div>
      </div>
    `;

    const modal = document.getElementById("notes-subject-modal");
    const modalTitle = document.getElementById("notes-subject-modal-title");
    const modalList = document.getElementById("notes-subject-modal-list");
    const modalSearchWrap = document.getElementById("notes-subject-modal-search-wrap");
    if (!modal || !modalTitle || !modalList) return;

    const ensureBackButton = () => {
      let backBtn = document.getElementById("notes-subject-modal-back");
      if (!backBtn) {
        const headerLeft = document.createElement("div");
        headerLeft.style.display = "flex";
        headerLeft.style.alignItems = "center";
        headerLeft.style.gap = "10px";
        headerLeft.style.minWidth = "0";

        backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.id = "notes-subject-modal-back";
        backBtn.className = "btn btn-secondary";
        backBtn.title = "Back";
        backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
        backBtn.hidden = true;

        modalTitle.parentNode.insertBefore(headerLeft, modalTitle);
        headerLeft.appendChild(backBtn);
        headerLeft.appendChild(modalTitle);
      }
      return backBtn;
    };
    const backBtn = ensureBackButton();

    const showNotesList = (heading, notes, onBack) => {
      modalTitle.textContent = heading;
      backBtn.hidden = !onBack;
      backBtn.onclick = onBack || null;
      if (modalSearchWrap) modalSearchWrap.hidden = false;

      const renderFiltered = (query) => {
        const q = (query || "").trim().toLowerCase();
        const filtered = q ? notes.filter(n => (n.title || "").toLowerCase().includes(q)) : notes;

        modalList.innerHTML = filtered.length
          ? filtered.map(noteRowHtml).join("")
          : "<div class='muted' style='text-align:center;padding:20px'>No notes match your search.</div>";

        $$("[data-open-note]", modalList).forEach(btn =>
          btn.addEventListener("click", () => {
            const note = notes.find(n => n.id === btn.dataset.openNote);
            if (note) openNoteViewer(note);
          })
        );
      };

      renderFiltered("");

      const searchInput = document.getElementById("notes-subject-modal-search");
      if (searchInput) {
        searchInput.value = "";
        const freshInput = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(freshInput, searchInput);
        freshInput.addEventListener("input", () => renderFiltered(freshInput.value));
      }
    };

    const showCategoryFolders = (subject, notesForSubject) => {
      modalTitle.textContent = subject;
      backBtn.hidden = true;
      if (modalSearchWrap) modalSearchWrap.hidden = true;

      const catGroups = groupByCategory(notesForSubject);
      const catNames = Object.keys(catGroups).sort((a, b) => {
        if (a === "General") return -1;
        if (b === "General") return 1;
        return a.localeCompare(b);
      });

      modalList.innerHTML = `
        <div class="notes-subject-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;">
          ${catNames.map(cat => folderCardHtml(cat, catGroups[cat].length, "category-folder")).join("")}
        </div>
      `;

      $$("[data-folder]", modalList).forEach(card =>
        card.addEventListener("click", () => {
          const cat = card.dataset.folder;
          showNotesList(`${subject} · ${cat}`, catGroups[cat], () => showCategoryFolders(subject, notesForSubject));
        })
      );
    };

    const openSubjectModal = (subject, notesForSubject) => {
      const hasRealCategories = notesForSubject.some(n => n.category && String(n.category).trim());

      if (hasRealCategories) {
        showCategoryFolders(subject, notesForSubject);
      } else {
        showNotesList(subject, notesForSubject, null);
      }

      modal.hidden = false;
    };

    const closeSubjectModal = () => {
      const searchInput = document.getElementById("notes-subject-modal-search");
      if (searchInput) searchInput.value = "";
      backBtn.hidden = true;
      modal.hidden = true;
    };

    if (!modal.dataset.wired) {
      const closeBtn = document.getElementById("notes-subject-modal-close");
      if (closeBtn) closeBtn.addEventListener("click", closeSubjectModal);
      modal.addEventListener("click", (e) => { if (e.target === modal) closeSubjectModal(); });
      modal.dataset.wired = "1";
    }

    const render = (list) => {
      if (!list || list.length === 0) {
        box.innerHTML = "<div class='muted' style='text-align:center;padding:30px'>No notes uploaded yet. Your mentor's notes will appear here.</div>";
        return;
      }

      const groups = groupBySubject(list);

      box.innerHTML = `
        <div class="notes-subject-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;">
          ${Object.keys(groups).map(subject => `
            <div class="report-item note-subject-card" data-subject="${escapeHtml(subject)}" data-testid="subject-folder-${escapeHtml(subject)}"
              style="cursor:pointer;flex-direction:column;align-items:flex-start;gap:10px;">
              <div class="note-icon"><i class="fa-solid fa-folder"></i></div>
              <div class="ri-title">${escapeHtml(subject)}</div>
              <div class="ri-meta">${groups[subject].length} file${groups[subject].length > 1 ? "s" : ""}</div>
            </div>
          `).join("")}
        </div>
      `;

      $$(".note-subject-card", box).forEach(card =>
        card.addEventListener("click", () => {
          const subject = card.dataset.subject;
          openSubjectModal(subject, groups[subject]);
        })
      );
    };

    render(state.studyNotes);

    api.getNotes(state.student.studentId)
      .then(list => { state.studyNotes = list || []; render(state.studyNotes); })
      .catch(err => console.error("Failed to refresh notes:", err));
  }
  
  function openNoteViewer(note) {
    const overlay = document.getElementById("note-viewer-overlay");
    const frame = document.getElementById("note-viewer-frame");
    const title = document.getElementById("note-viewer-title");
    const newTabLink = document.getElementById("note-viewer-newtab");

    const previewUrl = `https://drive.google.com/file/d/${note.fileId}/preview`;
    frame.src = previewUrl;
    title.textContent = note.title;
    newTabLink.href = `https://drive.google.com/file/d/${note.fileId}/view`;
    overlay.style.display = "flex";
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("note-viewer-close")?.addEventListener("click", () => {
      const overlay = document.getElementById("note-viewer-overlay");
      const frame = document.getElementById("note-viewer-frame");
      overlay.style.display = "none";
      frame.src = "";
    });
  });

  // ---------- Profile ----------
  function renderProfile() {
    const s = state.student, st = state.stats;
    const initials = (s.studentName || "S").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
    $("#profile-avatar").textContent = initials;
    $("#profile-name").textContent = s.studentName;
    $("#profile-id").textContent = s.studentId;
    $("#profile-caLevel").textContent = s.caLevel;
    $("#p-email").textContent = s.email || "—";
    $("#p-phone").textContent = s.phone || "—";
    $("#p-join").textContent = s.joinedOn || "—";
    $("#p-group").textContent = s.group || "—";
    $("#p-attempt").textContent = s.attempt || "—";
    $("#p-batch").textContent = s.batch || "—";
    $("#p-target").textContent = (s.targetHours || 70) + " hrs";
    $("#p-total").textContent = fmt(st.totalHours, 1) + " hrs";

    const btn = $("#change-password-btn");
    if (btn) {
      btn.addEventListener("click", updatePassword);
    }
  }

  function showLoginErrorPopup(message) {
    const old = document.getElementById("login-error-popup");
    if (old) old.remove();

    if (!document.getElementById("login-error-popup-style")) {
      const style = document.createElement("style");
      style.id = "login-error-popup-style";
      style.textContent = `
        #login-error-popup .login-err-overlay {
          position: fixed; inset: 0; z-index: 100001;
          background: rgba(15, 23, 42, 0.55);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        #login-error-popup .login-err-popup {
          background: #fff; border-radius: 16px; padding: 28px;
          max-width: 380px; width: 100%;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0,0,0,0.25);
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        #login-error-popup .login-err-icon {
          width: 56px; height: 56px; border-radius: 50%;
          background: #FEE2E2; color: #DC2626;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 16px; font-size: 22px;
        }
        #login-error-popup h2 { margin: 0 0 10px; font-size: 19px; color: #0F172A; }
        #login-error-popup p { margin: 0 0 22px; color: #64748B; line-height: 1.5; }
        #login-error-popup button {
          background: #2563EB; color: #fff; border: none;
          padding: 10px 22px; border-radius: 8px; font-weight: 600;
          cursor: pointer; width: 100%;
        }
      `;
      document.head.appendChild(style);
    }

    const isPasswordIssue = /password/i.test(message || "");
    const heading = isPasswordIssue ? "Incorrect Password" : "Login Failed";
    const body = message || "Please check your Student ID and password, then try again.";

    const popup = document.createElement("div");
    popup.id = "login-error-popup";
    popup.innerHTML = `
      <div class="login-err-overlay">
        <div class="login-err-popup">
          <div class="login-err-icon"><i class="fa-solid fa-circle-exclamation"></i></div>
          <h2>${heading}</h2>
          <p>${escapeHtml(body)}</p>
          <button id="login-err-ok-btn">Try Again</button>
        </div>
      </div>
    `;
    document.body.appendChild(popup);

    document.getElementById("login-err-ok-btn").addEventListener("click", () => popup.remove());
    popup.querySelector(".login-err-overlay").addEventListener("click", (e) => {
      if (e.target.classList.contains("login-err-overlay")) popup.remove();
    });
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, s => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[s]);
  }

  function showMentorFeedback(feedback) {
    const old = document.getElementById("mentor-feedback-popup");
    if (old) old.remove();

    if (!document.getElementById("mentor-feedback-style")) {
      const style = document.createElement("style");
      style.id = "mentor-feedback-style";
      style.textContent = `
        #mentor-feedback-popup .mentor-overlay {
          position: fixed; inset: 0; z-index: 99999;
          background: rgba(15, 23, 42, 0.55);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        #mentor-feedback-popup .mentor-popup {
          background: #fff; border-radius: 16px; padding: 28px;
          max-width: 420px; width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.25);
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        #mentor-feedback-popup h2 { margin: 0 0 12px; font-size: 20px; }
        #mentor-feedback-popup .mentor-meta { color: #64748B; font-size: 13px; margin-bottom: 14px; }
        #mentor-feedback-popup .mentor-message {
          background: #F8FAFC; border-radius: 10px; padding: 14px;
          margin-bottom: 20px; line-height: 1.5; color: #1E293B;
        }
        #mentor-feedback-popup #mentor-ok-btn {
          background: #2563EB; color: #fff; border: none;
          padding: 10px 22px; border-radius: 8px; font-weight: 600;
          cursor: pointer; width: 100%;
        }
      `;
      document.head.appendChild(style);
    }

    const popup = document.createElement("div");
    popup.id = "mentor-feedback-popup";
    popup.innerHTML = `
      <div class="mentor-overlay">
        <div class="mentor-popup">
          <h2>📩 Message from Mentor</h2>
          <div class="mentor-meta">
            <b>${escapeHtml(feedback.mentor)}</b><br>
            ${escapeHtml(feedback.date)} ${escapeHtml(feedback.time)}
          </div>
          <div class="mentor-message">${escapeHtml(feedback.message)}</div>
          <button id="mentor-ok-btn">Got It</button>
        </div>
      </div>
    `;

    document.body.appendChild(popup);

    document.getElementById("mentor-ok-btn").addEventListener("click", async () => {
      try {
        await api.markMentorFeedbackRead(feedback.id);
      } catch (err) {
        console.error("Failed to mark feedback read:", err);
      }
      popup.remove();
    });
  }

  function renderMentorNotes(notes) {
    const container = document.getElementById("mentor-notes-list");

    if (!notes || notes.length === 0) {
      container.innerHTML = `
        <div class="mentor-empty">
          <div class="mentor-empty-icon">💡</div>
          <h3>No Mentor Notes Yet</h3>
          <p>Your mentor will share guidance, motivation and important updates here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = notes.map(n => `
      <div class="mentor-note-card">
        <div class="mentor-note-header">
          <div class="mentor-avatar">UP</div>
          <div>
            <div class="mentor-name">Ujjwal Pathak</div>
            <div class="mentor-note-date">📅 ${escapeHtml(n.date)}</div>
          </div>
        </div>
        <div class="mentor-quote">❝</div>
        <div class="mentor-note-text">${escapeHtml(n.note)}</div>
      </div>
    `).join("");
  }

  // ---------- Forgot password modal ----------
  const forgotModal = document.getElementById("forgot-modal");

  function openForgotPasswordModal(e) {
    e.preventDefault();
    forgotModal.hidden = false;
    document.getElementById("fp-student-id").focus();
  }

  function closeForgotPasswordModal() {
    forgotModal.hidden = true;
  }

  document.getElementById("forgot-password-link").addEventListener("click", openForgotPasswordModal);
  document.getElementById("fp-cancel").addEventListener("click", closeForgotPasswordModal);

  forgotModal.addEventListener("click", (e) => {
    if (e.target === forgotModal) closeForgotPasswordModal();
  });

  // ---------- Log Study Hours modal ----------
  const trackerModal = document.getElementById("tracker-modal");
  const tlDate = document.getElementById("tl-date");
  const tlHours = document.getElementById("tl-hours");
  const tlTomorrow = document.getElementById("tl-tomorrow");
  const tlMentorSupport = document.getElementById("tl-mentor-support");
  const tlProofFile = document.getElementById("tl-proof-file");
  const tlError = document.getElementById("tl-error");
  const tlSubmitBtn = document.getElementById("tl-submit");

  const tlNoSection = document.getElementById("tl-no-section");
  const tlYesSection = document.getElementById("tl-yes-section");
  const tlReasonOther = document.getElementById("tl-reason-other");

  const MAX_PROOF_BYTES = 3 * 1024 * 1024;

  function wireChipGroup(groupEl) {
    groupEl.querySelectorAll(".choice-chip").forEach((chip) => {
      const input = chip.querySelector("input");
      input.addEventListener("change", () => {
        if (input.type === "radio") {
          groupEl.querySelectorAll(".choice-chip").forEach((c) => c.classList.remove("active"));
        }
        chip.classList.toggle("active", input.checked);
      });
    });
  }

  function resetChipGroup(groupEl) {
    groupEl.querySelectorAll(".choice-chip").forEach((chip) => {
      const input = chip.querySelector("input");
      input.checked = false;
      chip.classList.remove("active");
    });
  }

  function getRadioValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : "";
  }

  function getCheckboxValues(groupEl) {
    return Array.from(groupEl.querySelectorAll("input[type='checkbox']:checked")).map((c) => c.value);
  }

  const tlPlannedGroup = document.getElementById("tl-planned-group");
  const tlReasonGroup = document.getElementById("tl-reason-group");
  const tlSubjectsGroup = document.getElementById("tl-subjects-group");
  const tlTargetGroup = document.getElementById("tl-target-group");

  [tlPlannedGroup, tlReasonGroup, tlSubjectsGroup, tlTargetGroup].forEach(wireChipGroup);

  tlReasonGroup.addEventListener("change", () => {
    tlReasonOther.hidden = getRadioValue("tl-reason") !== "Other";
    if (tlReasonOther.hidden) tlReasonOther.value = "";
  });

  tlPlannedGroup.addEventListener("change", () => {
    const planned = getRadioValue("tl-planned");
    tlNoSection.hidden = planned !== "No";
    tlYesSection.hidden = !(planned === "Yes" || planned === "Maybe");

    if (planned !== "No") {
      resetChipGroup(tlReasonGroup);
      tlReasonOther.hidden = true;
      tlReasonOther.value = "";
    }
    if (!(planned === "Yes" || planned === "Maybe")) {
      resetChipGroup(tlSubjectsGroup);
      resetChipGroup(tlTargetGroup);
      tlProofFile.value = "";
      tlTomorrow.value = "";
    }
  });

  function openTrackerModal() {
    if (!state.student) return;

    document.getElementById("tracker-modal-student-name").textContent = state.student.studentName || "";
    document.getElementById("tracker-modal-student-id").textContent = state.student.studentId || "";

    const today = new Date();
    tlDate.value = today.toISOString().slice(0, 10);
    tlHours.value = "";
    resetChipGroup(tlPlannedGroup);
    resetChipGroup(tlReasonGroup);
    resetChipGroup(tlSubjectsGroup);
    resetChipGroup(tlTargetGroup);
    tlReasonOther.hidden = true;
    tlReasonOther.value = "";
    tlNoSection.hidden = true;
    tlYesSection.hidden = true;
    tlTomorrow.value = "";
    tlMentorSupport.value = "";
    tlProofFile.value = "";
    tlError.hidden = true;

    trackerModal.hidden = false;
  }

  function closeTrackerModal() {
    trackerModal.hidden = true;
  }

  document.getElementById("tl-cancel").addEventListener("click", closeTrackerModal);

  trackerModal.addEventListener("click", (e) => {
    if (e.target === trackerModal) closeTrackerModal();
  });

  function readProofFile() {
    return new Promise((resolve, reject) => {
      const file = tlProofFile.files && tlProofFile.files[0];
      if (!file) return resolve(null);

      if (file.size > MAX_PROOF_BYTES) {
        return reject(new Error("That file is too large — please attach something under 3 MB."));
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(",")[1] || "";
        resolve({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64
        });
      };
      reader.onerror = () => reject(new Error("Couldn't read that file — please try again."));
      reader.readAsDataURL(file);
    });
  }

  tlSubmitBtn.addEventListener("click", async () => {
    const date = tlDate.value;
    const hours = parseFloat(tlHours.value);
    const planned = getRadioValue("tl-planned");
    const mentorSupport = tlMentorSupport.value;

    if (!date || !hours || hours <= 0 || !planned) {
      tlError.textContent = "Please fill in date, hours, and whether you studied as planned.";
      tlError.hidden = false;
      return;
    }

    let reason = "";
    let subjects = "";
    let targetDone = "";
    let tomorrowTarget = "";
    let proofFile = null;

    if (planned === "No") {
      const reasonChoice = getRadioValue("tl-reason");
      if (!reasonChoice) {
        tlError.textContent = "Please select the main reason you couldn't study today.";
        tlError.hidden = false;
        return;
      }
      if (reasonChoice === "Other" && !tlReasonOther.value.trim()) {
        tlError.textContent = "Please specify your reason.";
        tlError.hidden = false;
        return;
      }
      reason = reasonChoice === "Other" ? tlReasonOther.value.trim() : reasonChoice;
    } else {
      const subjectList = getCheckboxValues(tlSubjectsGroup);
      targetDone = getRadioValue("tl-target");

      if (!subjectList.length) {
        tlError.textContent = "Please select at least one subject you studied today.";
        tlError.hidden = false;
        return;
      }
      if (!targetDone) {
        tlError.textContent = "Please select whether you completed today's target.";
        tlError.hidden = false;
        return;
      }
      if (!tlProofFile.files.length) {
        tlError.textContent = "Please attach today's study proof.";
        tlError.hidden = false;
        return;
      }

      subjects = subjectList.join(", ");
      tomorrowTarget = tlTomorrow.value.trim();
    }

    tlSubmitBtn.disabled = true;
    const originalLabel = tlSubmitBtn.innerHTML;
    tlSubmitBtn.innerHTML = "<span>Submitting...</span>";
    tlError.hidden = true;

    const studentId = state.student.studentId;

    try {
      proofFile = await readProofFile();

      const result = await api.addStudyLog(studentId, {
        date,
        hours,
        studiedAsPlanned: planned,
        reason,
        subjects,
        targetCompleted: targetDone,
        tomorrowTarget,
        mentorSupport,
        proofFile
      });

      if (!result || !result.success) {
        tlError.textContent = (result && result.message) || "Server didn't save the entry — please try again.";
        tlError.hidden = false;
        return;
      }

      state.log = [{ date, topic: subjects || reason, hours, proof: result.proofUrl ? "#" : "" }, ...(state.log || [])];
      state.stats = state.stats || {};
      state.stats.totalEntries = (state.stats.totalEntries || 0) + 1;
      state.stats.totalHours = (state.stats.totalHours || 0) + hours;
      state.stats.averageHours = state.stats.totalHours / state.stats.totalEntries;

      closeTrackerModal();
      renderTracker();

      setTimeout(async () => {
        try {
          const [stats, log] = await Promise.all([
            api.getStats(studentId),
            api.getStudyLog(studentId)
          ]);
          state.stats = stats;
          state.log = log;
          const activeView = (location.hash || "#dashboard").slice(1);
          if (activeView === "tracker") renderTracker();
        } catch (err) {
          console.error("Post-submit reconcile failed:", err);
        }
      }, 1500);
    } catch (err) {
      tlError.textContent = err.message || "Something went wrong. Please try again.";
      tlError.hidden = false;
    } finally {
      tlSubmitBtn.disabled = false;
      tlSubmitBtn.innerHTML = originalLabel;
    }
  });

  // ---------- Forgot password: OTP flow ----------
  const otpModal = document.getElementById("otp-modal");
  const otpInputs = document.querySelectorAll(".otp-input");

  document.getElementById("fp-send-otp").addEventListener("click", async () => {
    const studentId = document.getElementById("fp-student-id").value.trim().toUpperCase();
    const email = document.getElementById("fp-email").value.trim();
    const error = document.getElementById("fp-error");

    error.hidden = true;

    if (!studentId || !email) {
      error.textContent = "Please enter Student ID and registered Email.";
      error.hidden = false;
      return;
    }

    const btn = document.getElementById("fp-send-otp");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending OTP...</span>`;

    try {
      await api.forgotPassword(studentId, email);

      forgotModal.hidden = true;
      otpModal.hidden = false;
      otpInputs.forEach(i => i.value = "");
      otpInputs[0].focus();
    } catch (err) {
      error.textContent = err.message || "Unable to send OTP.";
      error.hidden = false;
    }

    btn.disabled = false;
    btn.innerHTML = `<span>Send OTP</span> <i class="fa-solid fa-paper-plane"></i>`;
  });

  otpInputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "");

      if (input.value && index < otpInputs.length - 1) {
        otpInputs[index + 1].focus();
      }
      checkOTPComplete();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && input.value === "" && index > 0) {
        otpInputs[index - 1].focus();
      }
    });

    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const data = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);

      data.split("").forEach((digit, i) => {
        if (otpInputs[i]) otpInputs[i].value = digit;
      });

      if (data.length > 0) {
        otpInputs[Math.min(data.length - 1, 5)].focus();
      }
      checkOTPComplete();
    });
  });

  const verifyBtn = document.getElementById("verify-otp-btn");
  verifyBtn.disabled = true;

  function checkOTPComplete() {
    const otp = [...otpInputs].map(i => i.value).join("");
    verifyBtn.disabled = otp.length !== 6;
  }

  verifyBtn.addEventListener("click", async () => {
    const otp = [...otpInputs].map(i => i.value).join("");
    const studentId = document.getElementById("fp-student-id").value.trim().toUpperCase();

    try {
      const result = await api.verifyOTP(studentId, otp);

      if (!result.success) {
        alert(result.message);
        return;
      }

      otpModal.hidden = true;
      document.getElementById("reset-modal").hidden = false;
      document.getElementById("reset-password").value = "";
      document.getElementById("reset-confirm-password").value = "";
      document.getElementById("reset-password").focus();
    } catch (err) {
      alert(err.message || "OTP verification failed.");
    }
  });

  const resetBtn = document.getElementById("reset-password-btn");
  resetBtn.addEventListener("click", async () => {
    const studentId = document.getElementById("fp-student-id").value.trim().toUpperCase();
    const password = document.getElementById("reset-password").value.trim();
    const confirmPassword = document.getElementById("reset-confirm-password").value.trim();
    const error = document.getElementById("reset-error");

    error.hidden = true;

    if (!password || !confirmPassword) {
      error.hidden = false;
      error.textContent = "Please fill all fields.";
      return;
    }
    if (password.length < 6) {
      error.hidden = false;
      error.textContent = "Password must be at least 6 characters.";
      return;
    }
    if (password !== confirmPassword) {
      error.hidden = false;
      error.textContent = "Passwords do not match.";
      return;
    }

    try {
      const result = await api.resetPassword(studentId, password);

      if (!result.success) {
        error.hidden = false;
        error.textContent = result.message;
        return;
      }

      alert("Password reset successfully!");

      document.getElementById("reset-modal").hidden = true;
      forgotModal.hidden = true;
      otpModal.hidden = true;
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message || "Unable to reset password.";
    }
  });

  // ============ NOTIFICATIONS ============
  const notifBell = document.getElementById("notif-bell");
  const notifBadge = document.getElementById("notif-badge");
  const notifPanel = document.getElementById("notif-panel");
  const notifPanelList = document.getElementById("notif-panel-list");
  const notifWrap = document.getElementById("notif-wrap");

  const annKey  = (a) => `a:${a.title}|${a.date}`;
  const noteMKey = (n) => `m:${n.date}|${String(n.note || "").slice(0, 40)}`;
  const noteNKey = (n) => `n:${n.id}`;
  const repKey  = (r) => `r:${r.weekOf}`;

  function seedNotifBaseline() {
    (state.announcements || []).forEach(a => state.notifSeen.announcements.add(annKey(a)));
    (state.mentorNotes || []).forEach(n => state.notifSeen.mentorNotes.add(noteMKey(n)));
    (state.studyNotes || []).forEach(n => state.notifSeen.notes.add(noteNKey(n)));
    (state.reports || []).forEach(r => state.notifSeen.reports.add(repKey(r)));
  }

  function updateNotifBadge() {
    if (!notifBadge) return;
    notifBadge.textContent = state.notifUnread > 9 ? "9+" : String(state.notifUnread);
    notifBadge.hidden = state.notifUnread === 0;
  }

  function pushNotif(icon, title, sub) {
    state.notifFeed.unshift({ icon, title, sub, ts: Date.now() });
    state.notifFeed = state.notifFeed.slice(0, 20);
    state.notifUnread++;
    updateNotifBadge();
    showToast(icon, title, sub);
  }

  function showToast(icon, title, sub) {
    let stack = document.getElementById("notif-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "notif-toast-stack";
      stack.className = "notif-toast-stack";
      document.body.appendChild(stack);
    }
    const el = document.createElement("div");
    el.className = "notif-toast";
    el.innerHTML = `
      <div class="notif-toast-icon"><i class="fa-solid ${icon}"></i></div>
      <div>
        <div class="notif-toast-title">${escapeHtml(title)}</div>
        <div class="notif-toast-sub">${escapeHtml(sub || "")}</div>
      </div>
    `;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .3s ease, transform .3s ease";
      el.style.opacity = "0";
      el.style.transform = "translateX(30px)";
      setTimeout(() => el.remove(), 300);
    }, 5000);
  }

  window.__umpShowPushToast = (title, body) => showToast("fa-bell", title, body);

  // ✅ FIX: Improved safeFetch with better error tracking
  async function safeFetch(fn, fallback) {
    try {
      const result = await fn();
      state.notifConsecutiveFailures = 0;
      return result;
    } catch (err) {
      state.notifConsecutiveFailures++;
      if (state.notifConsecutiveFailures <= 2) {
        console.warn("Notification sub-fetch failed (non-fatal):", err.message);
      }
      return fallback;
    }
  }

  // ✅ FIX: Completely rewritten checkForNewNotifications with debouncing
  async function checkForNewNotifications() {
  if (!state.student) return;
  if (isCheckingNotifications) return;
  if (state.notifConsecutiveFailures >= 3) return;

  isCheckingNotifications = true;

  try {
    // Sequential - ek ek karke
    const announcements = await safeFetch(
      () => api.getAnnouncements(),
      state.announcements
    );

    await new Promise(r => setTimeout(r, 2000)); // 2 sec gap

    const mentorNotes = await safeFetch(
      () => api.getStudentMentorNotes(state.student.studentId),
      state.mentorNotes
    );

    await new Promise(r => setTimeout(r, 2000)); // 2 sec gap

    const studyNotes = await safeFetch(
      () => api.getNotes(state.student.studentId),
      state.studyNotes
    );

    await new Promise(r => setTimeout(r, 2000)); // 2 sec gap

    const reports = await safeFetch(
      () => api.getWeeklyReports(state.student.studentId),
      state.reports
    );

    // Announcements check
    (announcements || []).forEach(a => {
      const k = annKey(a);
      if (!state.notifSeen.announcements.has(k)) {
        state.notifSeen.announcements.add(k);
        pushNotif("fa-bullhorn", a.title || "New announcement", a.message || "");
      }
    });

    // Mentor notes check
    (mentorNotes || []).forEach(n => {
      const k = noteMKey(n);
      if (!state.notifSeen.mentorNotes.has(k)) {
        state.notifSeen.mentorNotes.add(k);
        pushNotif("fa-comment-dots", "New mentor note", n.note || "");
      }
    });

    // Study notes check
    (studyNotes || []).forEach(n => {
      const k = noteNKey(n);
      if (!state.notifSeen.notes.has(k)) {
        state.notifSeen.notes.add(k);
        pushNotif("fa-file-pdf", "New study material", n.title || "");
      }
    });

    // Reports check
    (reports || []).forEach(r => {
      const k = repKey(r);
      if (!state.notifSeen.reports.has(k)) {
        state.notifSeen.reports.add(k);
        pushNotif("fa-envelope-open-text", "Weekly report ready", r.weekOf || "");
      }
    });

    // State update
    state.announcements = announcements;
    state.mentorNotes = mentorNotes;
    state.studyNotes = studyNotes;
    state.reports = reports;

    // Re-render active view
    const activeView = (location.hash || "#dashboard").slice(1);
    if (activeView === "dashboard") renderMentorNotes(state.mentorNotes || []);
    if (activeView === "reports") renderReports();
    if (activeView === "notes") renderNotes();

    console.log('✅ Notification check complete');

  } catch (err) {
    console.error("❌ Notification check failed:", err);
    state.notifConsecutiveFailures++;
  } finally {
    isCheckingNotifications = false;
  }
}

  function isToday(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d)) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  }

  function checkStreakReminder() {
    if (!state.student || !state.stats) return;

    const now = new Date();
    if (now.getHours() < 18) return;

    const todayKey = now.toISOString().slice(0, 10);
    const storageKey = `ump_streak_reminder_${state.student.studentId}_${todayKey}`;
    if (localStorage.getItem(storageKey)) return;

    if (isToday(state.stats.lastSubmission)) return;

    localStorage.setItem(storageKey, "1");
    pushNotif(
      "fa-fire",
      "Streak break ho sakta hai!",
      "Aaj abhi tak study log nahi kiya hai — abhi \"Log study hours\" pe jaake entry daal do."
    );
  }

  function renderNotifPanel() {
    if (!notifPanelList) return;
    if (!state.notifFeed.length) {
      notifPanelList.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
      return;
    }
    notifPanelList.innerHTML = state.notifFeed.map(n => `
      <div class="notif-item">
        <div class="notif-item-icon"><i class="fa-solid ${n.icon}"></i></div>
        <div>
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div class="notif-item-sub">${escapeHtml((n.sub || "").slice(0, 90))}</div>
        </div>
      </div>
    `).join("");
  }

  if (notifBell) {
    notifBell.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = notifPanel.hidden;
      notifPanel.hidden = !willOpen;
      if (willOpen) {
        renderNotifPanel();
        state.notifUnread = 0;
        updateNotifBadge();
      }
    });

    document.addEventListener("click", (e) => {
      if (notifWrap && !notifWrap.contains(e.target)) notifPanel.hidden = true;
    });
  }

  // ============ BOOT ============
  boot();

  // ✅ FIX: Improved background refresh with request guard
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    if (!state.student) return;
    if (isRefreshingData) return; // ✅ Prevent overlapping refreshes

    isRefreshingData = true;

    try {
      const [stats, log] = await Promise.all([
        api.getStats(state.student.studentId),
        api.getStudyLog(state.student.studentId)
      ]);
      
      state.stats = stats;
      state.log = log;
      $("#topbar-streak").textContent = stats.streak ?? 0;

      const activeView = (location.hash || "#dashboard").slice(1);
      if (activeView === "tracker") renderTracker();

      checkForNewNotifications();
      checkStreakReminder();
      
      console.log('🔄 Background refresh completed');
    } catch (err) {
      console.error("Background refresh failed:", err);
    } finally {
      isRefreshingData = false;
    }
  });

  // ---------- Developer Theme Panel ----------
  document.addEventListener("DOMContentLoaded", () => {
    const devToggle = document.getElementById("devToggle");
    const devPanel = document.getElementById("devPanel");

    if (!devToggle || !devPanel) return;

    devToggle.addEventListener("click", () => {
      devPanel.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (!devPanel.contains(e.target) && !devToggle.contains(e.target)) {
        devPanel.classList.remove("show");
      }
    });

    Array.from(devPanel.querySelectorAll("button[data-theme]")).forEach((btn) => {
      if (btn.dataset.theme === forcedTheme) btn.classList.add("active-theme");

      btn.addEventListener("click", () => {
        const chosen = btn.dataset.theme;
        forcedTheme = chosen === "auto" ? null : chosen;

        if (forcedTheme) {
          localStorage.setItem("ump_dev_theme", forcedTheme);
        } else {
          localStorage.removeItem("ump_dev_theme");
        }

        devPanel.querySelectorAll("button[data-theme]").forEach((b) =>
          b.classList.toggle("active-theme", b === btn)
        );

        const activeView = (location.hash || "#dashboard").slice(1);
        if (activeView === "dashboard" && state.student) renderDashboard();
      });
    });
  });

})();