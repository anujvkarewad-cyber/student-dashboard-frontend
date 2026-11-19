const APP_VERSION = "2.8.4";

(function () {
  "use strict";
  let currentStudent = null;
  let forcedTheme = localStorage.getItem("ump_dev_theme") || null;
  const api = window.UMP_API;

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function drivePreviewUrl(raw) {
    let url;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol !== 'https:' || !['drive.google.com', 'www.drive.google.com'].includes(url.hostname)) return null;
    const id = url.pathname.match(/^\/(?:file\/)?d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1]
      || (/^\/(?:uc|open)$/.test(url.pathname) ? url.searchParams.get('id') : '');
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
    const key = url.searchParams.get('resourcekey');
    return `https://drive.google.com/file/d/${id}/preview${key ? `?resourcekey=${encodeURIComponent(key)}` : ''}`;
  }
  
  function testDocumentPreviewUrl(raw) {
    const preview = drivePreviewUrl(raw);
    if (preview) return preview;
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid document link. Please ask your mentor to check this attachment.');
    return url.href;
  }
  

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
    notifCleared: new Set(), // ✅ Persistent cleared notifications (survives refresh/relogin)
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
    focus: "Focus Room",
    tutor: "Tutor & Messages",
    tests: "Tests",
    mcq: "Daily & Practice MCQ",
    written: "Written Answers",
    revision: "Revision Planner",
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

    if (savedStudent?.studentId) localStorage.removeItem(`ump_cache_${savedStudent.studentId}`);
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
          localStorage.setItem('ump_student', JSON.stringify({ studentId: s.studentId || savedStudent.studentId, password: savedStudent.password }));
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
    err.style.display = "none";

    if (!id || !password) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

    const result = await api.validateLogin(id, password);

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>Login</span>';

    if (!result.success) {
      err.hidden = true;
      // Access OFF → poora blocked screen (reason ke saath), warna normal popup.
      if (result.code === "access_blocked") {
        showAccessBlockedScreen(result);
        return;
      }
      showLoginErrorPopup(result.message);
      return;
    }

    localStorage.setItem(
      "ump_student",
      JSON.stringify({ studentId: result.studentId || id, password: password })
    );

    if (result.forcePasswordChange) {
      showChangePasswordScreen(result);
      return;
    }

    enterApp(result);
  });

  $("#logout-btn").addEventListener("click", async () => {
    await window.UMP_CLEAR_PRIVATE_SESSION();
    location.reload();
  });

  const privateFence = () => {
    const owner = state.student?.studentId;
    const epoch = window.UMP_PRIVATE_EPOCH();
    const credential = localStorage.getItem('ump_student');
    return () => state.student?.studentId === owner && window.UMP_PRIVATE_EPOCH() === epoch && localStorage.getItem('ump_student') === credential;
  };
  const clearDerivedPrivateUi = () => {
    state.notifFeed = []; state.notifUnread = 0; state.notifCleared = new Set();
    state.notifSeen = { announcements: new Set(), mentorNotes: new Set(), notes: new Set(), reports: new Set() };
    Object.values(state.charts || {}).forEach(chart => { try { chart?.destroy(); } catch {} });
    state.charts = {};
    document.getElementById('mentor-feedback-popup')?.remove();
    for (const id of ['notes-subject-modal', 'note-viewer-overlay']) {
      const node = document.getElementById(id);
      if (node) { node.hidden = true; if (id === 'note-viewer-overlay') node.style.display = 'none'; }
    }
    const privateFrame = document.getElementById('note-viewer-frame');
    if (privateFrame) privateFrame.src = '';
    const privateLink = document.getElementById('note-viewer-newtab');
    if (privateLink) privateLink.removeAttribute('href');
    updateNotifBadge();
    renderNotifPanel();
  };
  const lockPrivateDashboard = () => {
    if (typeof window.UMP_PRESERVE_TRACKER_DRAFT === 'function') window.UMP_PRESERVE_TRACKER_DRAFT();
    state.stats = {}; state.log = []; state.leaderboard = []; state.reports = [];
    state.announcements = []; state.mentorNotes = []; state.studyNotes = [];
    state.student = null;
    currentStudent = null;
    clearDerivedPrivateUi();
    $("#app-shell").hidden = true;
    $("#login-screen").hidden = false;
    const modal = document.getElementById('tracker-modal');
    if (modal) modal.hidden = true;
  };
  window.addEventListener('ump:private-invalidated', lockPrivateDashboard);
  window.addEventListener('storage', event => {
    if (event.key === 'ump_student') {
      window.UMP_CLEAR_PRIVATE_SESSION(false);
      lockPrivateDashboard();
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !state.student) return;
    let actor;
    try { actor = JSON.parse(localStorage.getItem('ump_student') || 'null'); } catch { actor = null; }
    if (!actor?.studentId || !actor.password) { lockPrivateDashboard(); return; }
    // Non-destructive revalidation: losing focus (file pickers, cameras,
    // alt-tab) must not wipe the in-memory UI, kill uploads in flight or
    // discard tracker drafts. Re-check with the server in the background and
    // lock only on a definitive refusal (wrong password / removed / blocked /
    // expired cohort). Network failure keeps the current view untouched.
    try {
      const result = await api.validateLogin(actor.studentId, actor.password);
      const current = JSON.parse(localStorage.getItem('ump_student') || 'null');
      if (current?.studentId !== actor.studentId || current?.password !== actor.password) return;
      if (result?.success === true) {
        localStorage.setItem('ump_student', JSON.stringify({ studentId: result.studentId || actor.studentId, password: actor.password }));
        return; // session still valid — leave view, state and drafts untouched
      }
      if (['wrong_password','not_found','removed','access_blocked','group_closed'].includes(result?.code)) {
        lockPrivateDashboard();
        window.UMP_CLEAR_PRIVATE_SESSION();
      }
      // Unknown/malformed response: keep the session; do not destroy state.
    } catch { /* Network error: keep the current view; do not wipe private data. */ }
  });

  async function enterApp(student) {
    currentStudent = student;
    state.student = student;
    const active = privateFence();
    clearDerivedPrivateUi();
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

    const studentId = student.studentId;
    // Server-derived private data is never restored from disk before fresh
    // authorization. Keep authored receipts, recordings and drafts untouched.
    localStorage.removeItem(`ump_cache_${studentId}`);
    state.stats = {}; state.log = []; state.leaderboard = []; state.reports = [];
    state.announcements = []; state.mentorNotes = []; state.studyNotes = [];
    $("#topbar-streak").textContent = "—";
    const initial = (location.hash || "#dashboard").slice(1);
    navigate(VIEW_TITLES[initial] ? initial : "dashboard");

    // === OPTIMIZED: Critical data in parallel (not sequential) ===
    // This reduces dashboard load from ~7-10s sequential to ~2-3s parallel
    try {
      const [stats, announcements, mentorNotes, leaderboard] = await Promise.all([
        safeFetch(() => api.getStats(studentId), state.stats || {}),
        safeFetch(() => api.getAnnouncements(), state.announcements || []),
        safeFetch(() => api.getStudentMentorNotes(studentId), state.mentorNotes || []),
        safeFetch(() => api.getLeaderboard(), state.leaderboard || [])
      ]);
      if (!active()) return;
      state.stats = stats;
      state.announcements = announcements;
      state.mentorNotes = mentorNotes;
      state.leaderboard = leaderboard;
      $("#topbar-streak").textContent = stats.streak ?? 0;

      // Refresh dashboard if still on it
      if ((location.hash || "#dashboard").slice(1) === "dashboard") {
        // Use rAF to avoid blocking main thread
        requestAnimationFrame(() => navigate("dashboard"));
      }
    } catch (e) {
      console.error("Critical data parallel fetch failed", e);
    }

    if (!active()) return;
    // === Background non-critical data — also parallel, no artificial delays ===
    // Use allSettled so one failure doesn't block others
    Promise.allSettled([
      safeFetch(() => api.getStudyLog(studentId), []).then(v => {
        if (!active()) return;
        state.log = v;
        if ((location.hash || "#dashboard").slice(1) === "tracker") renderTracker();
      }),
      safeFetch(() => api.getWeeklyReports(studentId), []).then(v => {
        if (!active()) return;
        state.reports = v;
        if ((location.hash || "#dashboard").slice(1) === "reports") renderReports();
      }),
      safeFetch(() => api.getNotes(studentId), []).then(v => {
        if (!active()) return;
        state.studyNotes = v;
        if ((location.hash || "#dashboard").slice(1) === "notes") renderNotes();
      }),
      safeFetch(() => api.getMentorFeedback(studentId), []).then(v => {
        if (!active()) return;
        if (Array.isArray(v) && v.length > 0) showMentorFeedback(v[0]);
      })
    ]).then(() => {
      console.log("✅ Background data loaded (parallel)");
    });

    // notifications: seed baseline (don't toast for stuff that already existed) + start polling
    seedNotifBaseline();
    checkStreakReminder();
    initPullToRefresh();

    // --- Robust FCM registration ---
    (async () => {
      if (!window.UMP_PUSH) {
        console.warn("[APP] UMP_PUSH not loaded");
        return;
      }

      if (!window.UMP_PUSH.isSupported()) {
        console.warn("[APP] Push not supported on this browser/device");
        return;
      }

      const perm = window.UMP_PUSH.getPermissionState();
      console.log("[APP] Push permission state:", perm);

      if (perm === "denied") {
        console.warn("[APP] Push permission previously denied — user needs to enable from browser settings");
        if (window.__umpShowPushToast) {
          window.__umpShowPushToast(
            "🔕 Notifications blocked",
            "Enable notifications from browser settings to receive mentor updates."
          );
        }
        return;
      }

      const token = await window.UMP_PUSH.requestAndSaveToken(studentId);
      if (token) {
        console.log("[APP] Push registered successfully");
      } else {
        console.warn("[APP] Push registration failed or permission not granted");
        if (Notification.permission === "default" && !sessionStorage.getItem("ump_push_prompt_shown")) {
          sessionStorage.setItem("ump_push_prompt_shown", "1");
          setTimeout(() => {
            if (window.__umpShowPushToast) {
              window.__umpShowPushToast(
                "🔔 Enable notifications",
                "Allow notifications to get instant mentor messages and new notes alerts."
              );
            }
          }, 3000);
        }
      }

      setInterval(() => {
        window.UMP_PUSH.refreshIfNeeded(studentId);
      }, 30 * 60 * 1000);
    })();

    if (!state._notifPollStarted) {
      state._notifPollStarted = true;
      setTimeout(() => {
        if (!state.student) return;
        checkForNewNotifications();
      }, 15000);
      setInterval(() => {
        if (!state.student) return;
        checkForNewNotifications();
        checkStreakReminder();
      }, 90000);
      setInterval(() => { 
        state.notifConsecutiveFailures = 0; 
      }, 300000);
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

    // Stop feature timers and release any screen wake lock before replacing a view.
    if (window.UMP_LEARNING_TOOLS) window.UMP_LEARNING_TOOLS.cleanup();

    const node = tpl.content.cloneNode(true);
    const container = $("#view-container");
    container.innerHTML = "";
    container.appendChild(node);

    try {
      ({
        dashboard: renderDashboard,
        tracker: renderTracker,
        focus: renderFocus,
        tutor: renderTutor,
        tests: renderTests,
        mcq: renderMCQ,
        written: renderWrittenView,
        revision: renderRevisionView,
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
    tb.innerHTML = state.log.length ? state.log.map((row, idx) => `
      <tr>
        <td><b>${dayShort(row.date)}</b></td>
        <td>${escapeHtml(row.topic || "")}</td>
        <td><b class="mono">${fmt(row.hours, 1)}</b></td>
        <td>${row.proof && row.proof !== "#" ? `<button type="button" class="btn btn-secondary" data-view-proof="${idx}"><i class="fa-solid fa-arrow-up-right-from-square"></i> View</button>` : "—"}</td>
        <td><button type="button" class="btn btn-secondary" data-del-log="${idx}" title="Delete this entry" style="padding:4px 10px;font-size:12px;color:#B91C1C">Delete</button></td>
      </tr>`).join("")
      : `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:30px">No submissions yet — start logging your daily study!</td></tr>`;

    $$('[data-view-proof]',tb).forEach(btn=>btn.addEventListener('click',async()=>{
      const value=state.log[Number(btn.dataset.viewProof)]?.proof;
      if(!value)return;
      let overlay=null,objectUrl=null;
      const dispose=()=>{overlay?.remove();if(objectUrl)URL.revokeObjectURL(objectUrl);window.removeEventListener('ump:private-invalidated',dispose);};
      try {
        const url=new URL(value,window.location.origin);
        if(url.pathname!=='/api/proof-file'){
          if(url.protocol!=='https:' || url.username || url.password)throw Error('Invalid proof link.');
          window.open(url.href,'_blank','noopener,noreferrer');return;
        }
        const fence=privateFence();
        const blob=await api.getPrivateProof(url.href);if(!fence())return;
        objectUrl=URL.createObjectURL(blob);
        overlay=document.createElement('div');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Private study proof');
        Object.assign(overlay.style,{position:'fixed',inset:'0',background:'white',zIndex:'100000',display:'flex',flexDirection:'column',padding:'12px'});
        const close=document.createElement('button');close.textContent='Close private proof';close.className='btn btn-secondary';close.onclick=dispose;
        const view=document.createElement(blob.type==='application/pdf'?'iframe':'img');view.src=objectUrl;
        if(blob.type==='application/pdf')view.setAttribute('sandbox','');
        Object.assign(view.style,{flex:'1',minHeight:'0',objectFit:'contain',border:'0',width:'100%'});
        overlay.append(close,view);document.body.append(overlay);window.addEventListener('ump:private-invalidated',dispose);
      }catch{dispose();alert('Private proof could not be opened. Sign in again or ask your mentor to check access.');}
    }));

    $$("[data-del-log]", tb).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = state.log[Number(btn.dataset.delLog)];
        if (!row) return;
        if (!confirm(`Delete ${dayShort(row.date)} · ${fmt(row.hours, 1)}h?`)) return;
        btn.disabled = true;
        try {
          const result = await api.deleteStudyLog(state.student.studentId, {
            date: row.date,
            hours: row.hours,
            topic: row.topic || ""
          });
          if (!result || result.success === false) {
            alert((result && result.message) || "Delete failed.");
            return;
          }
          const [stats, log] = await Promise.all([
            api.getStats(state.student.studentId),
            api.getStudyLog(state.student.studentId)
          ]);
          state.stats = stats;
          state.log = log;
          $("#topbar-streak").textContent = stats.streak ?? 0;
          renderTracker();
        } catch (err) {
          alert(err.message || "Delete failed.");
        } finally {
          btn.disabled = false;
        }
      });
    });

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

  // ---------- APK-parity Focus + MCQ tools ----------
  function renderFocus() {
    const root = $("#focus-root");
    if (!root || !window.UMP_LEARNING_TOOLS) {
      if (root) root.innerHTML = "<div class='card'>Focus Room could not be loaded. Please refresh once.</div>";
      return;
    }
    window.UMP_LEARNING_TOOLS.renderFocus(root, state.student);
  }

  function renderTutor() {
    const student = state.student;
    if (!student) return;
    const thread = $("#tutor-thread");
    if (window.UMP_SMART_TARGETS) window.UMP_SMART_TARGETS.mount();

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

    const revisionBox = $("#tutor-revision");
    const paintPlan = (plan) => {
      const chapters = (plan && plan.chapters) || [];
      if (!revisionBox) return;
      if (!chapters.length) {
        revisionBox.textContent = "No chapter mark is saved yet.";
        return;
      }
      revisionBox.innerHTML = chapters.map((item) => "<div style='padding:8px 0;border-bottom:1px solid #eef2f7;'><b>" + escapeHtml(item.concept || "Chapter") + "</b> · " + escapeHtml(item.strength || "") + "<div class='muted'>Revise on " + escapeHtml(item.dueOn || "") + ". " + escapeHtml(item.reminder || "") + "</div></div>").join("");
    };
    callAPI("revision.plan", { studentId: student.studentId }).then(paintPlan).catch(() => { if (revisionBox) revisionBox.textContent = "Revision dates could not be loaded."; });


    const paintThread = (messages) => {
      if (!messages || !messages.length) {
        thread.textContent = "No messages yet.";
        return;
      }
      thread.innerHTML = messages.map((msg) => "<div style='padding:8px 0;border-bottom:1px solid #eef2f7;'><b>" + (msg.from === "student" ? "You" : "Mentor") + "</b><div>" + escapeHtml(msg.text || "") + "</div></div>").join("");
    };
    callAPI("messages.thread", { studentId: student.studentId }).then((data) => paintThread((data && data.messages) || [])).catch(() => { thread.textContent = "Messages could not be loaded."; });

    $("#tutor-send").onclick = () => {
      const text = ($("#tutor-message").value || "").trim();
      if (!text) return;
      callAPI("messages.send", { studentId: student.studentId, studentName: student.studentName || student.name || "", text: text }).then(() => {
        $("#tutor-message").value = "";
        return callAPI("messages.thread", { studentId: student.studentId });
      }).then((data) => paintThread((data && data.messages) || [])).catch(() => { thread.textContent = "The message could not be sent."; });
    };
  }

  function renderMentorRemark(value) {
    const remark = String(value || "").trim();
    if (!remark) return "";
    return "<div class='mentor-test-remark' style='border-left:3px solid #3157d5;background:#eff6ff;padding:10px 12px;border-radius:6px;font-size:13px;line-height:1.5;'><b>Mentor’s remark</b><div>" + escapeHtml(remark) + "</div></div>";
  }

  function renderTests() {
    // Workbook practice is a tutorial/demo-only surface: visible to the demo
    // account and master IDs, never to real students.
    const wb = $("#workbook-link");
    if (wb) {
      const sid = String((state.student && state.student.studentId) || "").toUpperCase();
      wb.hidden = !(sid === "UMP9900" || (state.student && state.student.master === true));
    }
    const list = $("#tests-list");
    const player = $("#tests-player");
    if (!list) return;

    const paint = () => {
      const tests = window.UMP_WEB_TESTS || [];
      if (!tests.length) {
        list.textContent = "No mentor test is published yet.";
        return;
      }
      // Status + last score dikhao taaki student ko pata rahe kya pending hai.
      list.innerHTML = tests.map((test) => {
        const bits = [];
        if (test.status === "upcoming") bits.push("coming soon");
        if (test.status === "closed") bits.push("closed");
        if (test.attempted && test.lastScore != null) bits.push(test.lastScore + "/" + test.lastTotal);
        const label = test.title + (bits.length ? " · " + bits.join(" · ") : "");
        return "<div class='student-test-item' style='margin:0 0 10px;'>"
          + "<button type='button' class='btn-primary sm' data-test='" + escapeHtml(test.id) + "' style='margin:0 8px 8px 0;'>" + escapeHtml(label) + "</button>"
          + renderMentorRemark(test.mentorRemark)
          + "</div>";
      }).join("");
      list.querySelectorAll("[data-test]").forEach((btn) => {
        btn.onclick = () => startWebTest(tests.find((item) => item.id === btn.dataset.test), player);
      });
    };

    // Server se published tests laao (test-channel.js). Uske bina purana local
    // behaviour chalta rahega — is file ke na hone par app waise hi kaam kare.
    if (window.UMP_TEST_CHANNEL) {
      list.textContent = "Tests load ho rahe hain…";
      window.UMP_TEST_CHANNEL.load().then(paint).catch(() => paint());
      return;
    }
    paint();
  }

  function startWebTest(test, player) {
    if (!test) return;
    // Server-side paper + grading (answers phone par nahi bhejte).
    if (window.UMP_TEST_CHANNEL) {
      player.innerHTML = "<h3>" + escapeHtml(test.title) + "</h3><p class='muted'>Paper load ho raha hai…</p>";
      window.UMP_TEST_CHANNEL.paper(test.id)
        .then((data) => {
          // Paper test me questions nahi hote — student khud solve karke marks bharta hai.
          if (data && (data.selfEvaluate || (data.test && data.test.kind === "paper-test"))) {
            startPaperTest(test, data, player);
            return;
          }
          startChannelWebTest(test, data, player);
        })
        .catch((error) => {
          player.innerHTML = "<h3>" + escapeHtml(test.title) + "</h3><p class='muted'>" + escapeHtml(error.message || "The paper could not be loaded") + "</p>";
        });
      return;
    }
    player.innerHTML = "<h3>" + escapeHtml(test.title) + "</h3><p class='muted'>" + escapeHtml(test.subject) + " · " + test.durationMin + " min · " + test.maxMarks + " marks</p>"
      + test.questions.map((q, index) => "<div style='margin:14px 0;'><b>" + (index + 1) + ". " + escapeHtml(q.prompt) + "</b>" + q.options.map((opt) => "<label style='display:block;margin-top:6px;'><input type='radio' name='" + q.id + "' value='" + opt.id + "'/> " + escapeHtml(opt.id) + ". " + escapeHtml(opt.text) + "</label>").join("") + "</div>").join("")
      + "<button type='button' class='btn-primary sm' id='submit-web-test'>Submit</button><div id='web-test-result' style='margin-top:12px;'></div>";
    $("#submit-web-test").onclick = () => {
      let score = 0;
      let max = 0;
      const lines = test.questions.map((q) => {
        max += q.marks || 0;
        const picked = player.querySelector("input[name='" + q.id + "']:checked");
        const ok = picked && picked.value === q.correctOptionId;
        if (ok) score += q.marks || 0;
        return "<div style='margin-top:10px;'><b>" + escapeHtml(q.prompt) + "</b><div>" + (ok ? "Correct." : "Correct option: " + q.correctOptionId) + " " + escapeHtml(q.explanation || "") + "</div></div>";
      });
      $("#web-test-result").innerHTML = "<b>Score: " + score + " / " + max + "</b>" + lines.join("");
    };
  }

  // Paper test: answer sheet + marking scheme dikhao, phir student apne marks
  // (self-evaluation) bharke submit kare. Marks server par jaate hain aur mentor
  // dashboard (Tests → Submissions) me turant dikhte hain.
  function startPaperTest(test, data, player) {
    const meta = (data && data.test) || {};
    const maxMarks = Number(meta.maxMarks || test.maxMarks || 0);
    const mentorRemarkHtml = renderMentorRemark(meta.mentorRemark || test.mentorRemark);
    const escapeHtml = (unsafe) => String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

    let state = {
      answerUrl: null,
      isUploading: false,
      phase: test.lastScore != null ? 3 : (test.attempted ? 1 : 1)
    };

    function render() {
      if (state.phase === 3) {
          player.innerHTML = `
            <div class="card" style="padding: 25px; text-align: center; border-top: 4px solid #10b981; background: #f0fdf4;">
              <h2 style="color: #166534; margin-bottom:10px;">✅ Test Evaluated</h2>
              <h3 style="margin-bottom:10px;">${escapeHtml(meta.title || test.title)}</h3>
              <div style="font-size: 20px; margin-bottom: 10px;">Marks: <b style="color: #047857;">${test.lastScore} / ${maxMarks || test.lastTotal || "?"}</b></div>
              ${mentorRemarkHtml}
              <p class="muted">Your mentor has received your answer sheet and self-evaluation.</p>
            </div>
          `;
          return;
      }

      if (state.phase === 2) {
          player.innerHTML = `
            <div class="card" style="padding:20px; border-top: 4px solid #3b82f6;">
              <h3 style="margin-bottom:5px;">${escapeHtml(meta.title || test.title)}</h3>
              <p style="color:#2563eb; font-weight:bold; margin-bottom:15px;">✅ Answer Uploaded Successfully!</p>
              ${mentorRemarkHtml}
              <div style="background: #f1f5f9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <div style="font-weight:bold; margin-bottom:8px; font-size:16px;">Step 3: Self-Evaluation</div>
                <p class="muted" style="margin-bottom:12px; font-size:13px;">Open the answer sheet below, check your uploaded answers, and enter your marks.</p>
                ${meta.answerSheetUrl ? `<button class='btn-primary sm test-viewer-btn' data-url='${escapeHtml(meta.answerSheetUrl)}' data-label='Answer Sheet' style="background:#10b981; color:white; border:none; padding:8px 16px; border-radius:5px; cursor:pointer;">📝 Open Answer Sheet</button>` : meta.answerSheetText ? `<div class="test-answer-text">${escapeHtml(meta.answerSheetText).replace(/\n/g, '<br>')}</div>` : `<span class="muted" style="color:red;">Mentor has not provided an answer sheet.</span>`}
              </div>

              <div style="border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px;">
                <div style="font-weight:bold; margin-bottom:15px; font-size:16px;">Step 4: Submit Marks & Mistakes</div>
                
                <div style="margin-bottom:15px;">
                  <label style="display:block; font-weight:bold; margin-bottom:5px; font-size:14px;">How many marks did you score? (out of ${maxMarks || '?'}):</label>
                  <input type="number" id="eval-marks" class="input" placeholder="e.g. 45" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:5px;" />
                </div>
                
                <div style="margin-bottom:15px;">
                  <label style="display:block; font-weight:bold; margin-bottom:5px; font-size:14px;">What mistakes did you make? (Self-Analysis):</label>
                  <textarea id="eval-remarks" class="input" placeholder="e.g. Silly mistake in Q3, forgot formula in Q5" rows="3" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:5px;"></textarea>
                </div>

                <button id="submit-evaluation-btn" class="btn-primary" style="width:100%; padding:12px; font-size:16px;">✅ Submit Final Evaluation</button>
                <div id="eval-err" style="color:red; margin-top:10px; text-align:center; font-size:14px;"></div>
              </div>
            </div>
          `;

          // Setup Viewer Button
          player.querySelectorAll('.test-viewer-btn').forEach(btn => {
             btn.onclick = () => {
                 let url = btn.getAttribute('data-url');
                 let label = btn.getAttribute('data-label');
                 let preview;
                 try { preview = testDocumentPreviewUrl(url); }
                 catch (_) { window.alert("This document link is invalid. Please ask your mentor to check the attachment."); return; }
                 if (typeof openNoteViewer === "function") {
                     openNoteViewer({ title: label, previewUrl: preview, viewUrl: url, fileId: "" });
                 } else {
                     window.open(url, '_blank');
                 }
             };
          });

          // Submit logic
          player.querySelector("#submit-evaluation-btn").onclick = () => {
              const marks = player.querySelector("#eval-marks").value;
              const remarks = player.querySelector("#eval-remarks").value;
              const errDiv = player.querySelector("#eval-err");
              
              if (!marks) { errDiv.textContent = "Please enter your marks first."; return; }
              if (maxMarks && Number(marks) > maxMarks) { errDiv.textContent = "Marks cannot be greater than " + maxMarks; return; }
              if (!remarks) { errDiv.textContent = "Please write a brief analysis of your mistakes."; return; }

              const btn = player.querySelector("#submit-evaluation-btn");
              btn.disabled = true;
              btn.textContent = "Submitting to Mentor... Please wait";

              window.UMP_TEST_CHANNEL.submitMarks(test.testId || test.id, marks, remarks, state.answerUrl)
                .then(res => {
                    test.attempted = true;
                    test.lastScore = res.score;
                    test.lastTotal = res.total;
                    state.phase = 3;
                    render();
                    setTimeout(() => { window.UMP_TEST_CHANNEL.load().then(renderTests).catch(()=>{}); }, 1500);
                })
                .catch(err => {
                    btn.disabled = false;
                    btn.textContent = "✅ Submit Final Evaluation";
                    errDiv.textContent = err.message || "Failed to submit. Try again.";
                });
          };
          return;
      }

      // Phase 1: Show QP and Ask for Upload
      player.innerHTML = `
        <div class="card" style="padding:20px; border-top: 4px solid #3b82f6;">
          <div style="margin-bottom:20px;">
            <h3 style="margin-bottom:5px;">${escapeHtml(meta.title || test.title)}</h3>
            <div class="muted" style="font-size:14px;">${escapeHtml(meta.subject || "")} • ${maxMarks ? maxMarks + " marks" : "Paper Test"} • ${meta.durationMinutes ? meta.durationMinutes + " mins" : ""}</div>
            ${mentorRemarkHtml}
          </div>

          <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <div style="font-weight:bold; margin-bottom:8px; font-size:16px;">Step 1: Download & Solve</div>
            <p class="muted" style="margin-bottom:12px; font-size:13px;">Click below to open the question paper. Solve it honestly on your notebook.</p>
            ${meta.paperUrl ? `<button class='btn-primary sm test-viewer-btn' data-url='${escapeHtml(meta.paperUrl)}' data-label='Question Paper' style="background:#3b82f6; color:white; border:none; padding:8px 16px; border-radius:5px; cursor:pointer;">📄 Open Question Paper</button>` : `<span class="muted" style="color:red;">No paper attached.</span>`}
          </div>

          <div style="border: 2px dashed #cbd5e1; padding: 15px; border-radius: 8px;">
            <div style="font-weight:bold; margin-bottom:8px; font-size:16px;">Step 2: Upload Answer Sheet</div>
            <p class="muted" style="margin-bottom:12px; font-size:13px;">Upload your solved answer sheet (PDF or Image, max 10MB) to unlock the Marking Scheme.</p>
            
            <input type="file" id="answer-file" accept="image/*,application/pdf" style="display:block; width:100%; margin-bottom:15px; padding:10px; border:1px solid #e2e8f0; border-radius:5px; background:white;" />
            
            <button id="upload-btn" class="btn-primary" style="width:100%; padding:12px; font-size:16px;">📤 Upload Answer Sheet</button>
            <div id="upload-progress" style="margin-top:12px; display:none;">
              <div style="height:12px; background:#e2e8f0; border-radius:999px; overflow:hidden;">
                <div class="upload-progress-fill" style="height:100%; width:0%; background:#3b82f6; border-radius:999px; transition:width .2s linear;"></div>
              </div>
              <div class="upload-progress-text" style="margin-top:8px; color:#3b82f6; font-weight:bold; font-size:14px; text-align:center;">Starting upload…</div>
              <div style="margin-top:4px; color:#64748b; font-size:11px; text-align:center;">Large PDFs can take 30–120s on mobile data — keep this screen open.</div>
            </div>
            <div id="upload-err" style="margin-top:10px; color:red; text-align:center; font-size:14px;"></div>
          </div>
        </div>
      `;

      // Setup Viewer Button
      player.querySelectorAll('.test-viewer-btn').forEach(btn => {
         btn.onclick = () => {
             let url = btn.getAttribute('data-url');
             let label = btn.getAttribute('data-label');
             let preview;
                 try { preview = testDocumentPreviewUrl(url); }
                 catch (_) { window.alert("This document link is invalid. Please ask your mentor to check the attachment."); return; }
             if (typeof openNoteViewer === "function") {
                 openNoteViewer({ title: label, previewUrl: preview, viewUrl: url, fileId: "" });
             } else {
                 window.open(url, '_blank');
             }
         };
      });

      // Upload Logic
      player.querySelector("#upload-btn").onclick = () => {
          const fileInput = player.querySelector("#answer-file");
          const file = fileInput && fileInput.files[0];
          const errDiv = player.querySelector("#upload-err");
          const progDiv = player.querySelector("#upload-progress");
          const btn = player.querySelector("#upload-btn");

          if (!file) { errDiv.textContent = "Please select a file to upload."; return; }
          if (file.size > 10485760) { errDiv.textContent = "File is too large! Maximum allowed size is 10 MB."; return; }

          errDiv.textContent = "";
          btn.style.display = "none";
          progDiv.style.display = "block";
          
          const uploadCurrent = privateFence();
          // NB: inside startPaperTest, `state` is the LOCAL paper-test object
          // ({ answerUrl, isUploading, phase }), never the app state — checking
          // state.student here always failed and silently blocked every upload.
          // Guard with the stored session credential + fence instead.
          if (!localStorage.getItem('ump_student') || !uploadCurrent()) { btn.style.display = "block"; progDiv.style.display = "none"; errDiv.textContent = "Your session expired. Please log in again."; return; }
          const reader = new FileReader();
          reader.onload = () => {
              if (!uploadCurrent()) return;
              const base64 = reader.result.split(',')[1];
              const appsScriptUrl = "https://script.google.com/macros/s/AKfycbzyfWa8agayMB0XLjkbfhfj2MdIRElAiY2Wnd7-eQKd1zlMl099ky6Cif06TWydzr8D/exec";
              const payload = JSON.stringify({
                action: 'student.test.uploadSubmission',
                payload: { base64, mimeType: file.type, filename: file.name }
              });
              const fillEl = typeof progDiv.querySelector === 'function' ? progDiv.querySelector('.upload-progress-fill') : null;
              const textEl = typeof progDiv.querySelector === 'function' ? progDiv.querySelector('.upload-progress-text') : null;
              const totalMb = (payload.length / 1048576).toFixed(1);
              const showFailure = (msg) => {
                btn.style.display = "block";
                progDiv.style.display = "none";
                errDiv.textContent = "Upload failed: " + msg;
              };
              const xhr = new XMLHttpRequest();
              xhr.open('POST', appsScriptUrl, true);
              xhr.timeout = 120000;
              xhr.upload.onprogress = (e) => {
                if (!uploadCurrent()) return;
                if (e && e.lengthComputable && e.total > 0) {
                  const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
                  if (fillEl) fillEl.style.width = pct + '%';
                  if (textEl) textEl.textContent = 'Uploading… ' + pct + '% (~' + totalMb + ' MB)';
                } else if (textEl) {
                  textEl.textContent = 'Uploading…';
                }
              };
              xhr.ontimeout = () => {
                if (!uploadCurrent()) return;
                showFailure('Timed out after 2 minutes. Check your connection — the file is kept; try again (Wi-Fi recommended).');
              };
              xhr.onerror = () => {
                if (!uploadCurrent()) return;
                showFailure('Network error. Check your connection and try again — the file is kept.');
              };
              xhr.onload = () => {
                if (!uploadCurrent()) return;
                let data = null;
                try { data = JSON.parse(xhr.responseText); } catch { data = null; }
                const result = data?.result;
                const url = typeof result === 'string' ? result : result?.url;
                const okHttp = xhr.status >= 200 && xhr.status < 300;
                if (!okHttp || !data || data.error || data.ok === false || data.success === false || result?.error || result?.ok === false || result?.success === false || typeof url !== 'string' || !url.trim()) { showFailure('Upload could not be confirmed. Keep the original file and try again.'); return; }
                if (fillEl) fillEl.style.width = '100%';
                if (textEl) textEl.textContent = 'Upload complete ✓';
                state.answerUrl = url;
                state.phase = 2; // Move to evaluation phase
                render();
              };
              xhr.send(payload);
          };
          reader.onerror = () => {
             btn.style.display = "block";
             progDiv.style.display = "none";
             errDiv.textContent = "Could not read file locally.";
          };
          reader.readAsDataURL(file);
      };
    }

    render();
  }

  // Server-graded runner: submit par score + per-question review server se aata hai.
  function startChannelWebTest(test, data, player) {
    const meta = (data && data.test) || {};
    const questions = (data && data.questions) || [];
    const mentorRemarkHtml = renderMentorRemark(meta.mentorRemark || test.mentorRemark);
    const startedAt = Date.now();
    if (!questions.length) {
      player.innerHTML = "<h3>" + escapeHtml(test.title) + "</h3><p class='muted'>No questions have been published for this test yet.</p>";
      return;
    }
    player.innerHTML = "<h3>" + escapeHtml(meta.title || test.title) + "</h3>"
      + "<p class='muted'>" + escapeHtml(meta.subject || test.subject || "") + (meta.durationMinutes ? " · " + meta.durationMinutes + " min" : "") + " · " + questions.length + " questions · " + escapeHtml(String(meta.maxMarks || test.maxMarks || questions.length)) + " marks</p>"
      + mentorRemarkHtml
      + (meta.instructions ? "<p class='muted'>" + escapeHtml(meta.instructions) + "</p>" : "")
      + questions.map((q, index) => "<div style='margin:14px 0;'><b>" + (index + 1) + ". " + escapeHtml(q.prompt) + "</b>" + (q.options || []).map((opt) => "<label style='display:block;margin-top:6px;'><input type='radio' name='" + escapeHtml(q.id) + "' value='" + escapeHtml(opt.id) + "'/> " + escapeHtml(opt.id) + ". " + escapeHtml(opt.text) + "</label>").join("") + "</div>").join("")
      + "<button type='button' class='btn-primary sm' id='submit-web-test'>Submit</button><div id='web-test-result' style='margin-top:12px;'></div>";

    $("#submit-web-test").onclick = () => {
      const answers = {};
      let answered = 0;
      questions.forEach((q) => {
        const picked = player.querySelector("input[name='" + q.id + "']:checked");
        if (picked) { answers[q.id] = picked.value; answered += 1; }
      });
      if (!answered) {
        $("#web-test-result").innerHTML = "<p class='muted'>Please answer at least one question first.</p>";
        return;
      }
      const button = $("#submit-web-test");
      button.disabled = true;
      button.textContent = "Checking…";
      window.UMP_TEST_CHANNEL.submit(test.id, answers, (Date.now() - startedAt) / 1000)
        .then((result) => {
          const lines = (result.review || []).map((item, index) => {
            const shown = item.selected == null ? "no option selected" : (item.options || [])[item.selected];
            const right = (item.options || [])[item.answer];
            return "<div style='margin-top:10px;'><b>" + (index + 1) + ". " + escapeHtml(item.prompt) + "</b>"
              + "<div style='color:" + (item.correct ? "#16a34a" : "#dc2626") + ";font-weight:600;'>" + (item.correct ? "Sahi" : "Galat") + "</div>"
              + "<div class='muted'>Your answer: " + escapeHtml(String(shown == null ? "—" : shown)) + " · Correct answer: " + escapeHtml(String(right == null ? "—" : right)) + "</div>"
              + (item.explanation ? "<div class='muted'>" + escapeHtml(item.explanation) + "</div>" : "")
              + "</div>";
          });
          $("#web-test-result").innerHTML = "<b>Score: " + result.score + " / " + result.total + " (" + (result.scorePct == null ? "—" : result.scorePct + "%") + ")</b>"
            + " <span class='muted'>· mentor ko bhej diya gaya</span>" + lines.join("");
          button.textContent = "Submitted";
          window.UMP_TEST_CHANNEL.load().then(() => renderTests()).catch(() => {});
        })
        .catch((error) => {
          button.disabled = false;
          button.textContent = "Submit";
          $("#web-test-result").innerHTML = "<p class='muted'>" + escapeHtml(error.message || "Submission failed — please try again.") + "</p>";
        });
    };
  }

  function renderMCQ() {
    const dcHost = $("#daily-challenge-root");
    if (dcHost && window.UMP_EXTRAS) window.UMP_EXTRAS.renderDailyChallenge(dcHost, state.student);
    const root = $("#mcq-root");
    if (!root || !window.UMP_LEARNING_TOOLS) {
      if (root) root.innerHTML = "<div class='card'>MCQ Zone could not be loaded. Please refresh once.</div>";
      return;
    }
    window.UMP_LEARNING_TOOLS.renderMCQ(root, state.student);
  }

  function renderWrittenView() {
    const root = $("#written-root");
    if (root && window.UMP_EXTRAS) window.UMP_EXTRAS.renderWritten(root);
  }

  function renderRevisionView() {
    const root = $("#revision-root");
    if (root && window.UMP_EXTRAS) window.UMP_EXTRAS.renderRevision(root);
  }

  // ---------- Performance ----------
  function renderPerformance() {
    const attempts = window.UMP_LEARNING_TOOLS
      ? window.UMP_LEARNING_TOOLS.getPerformanceAttempts(state.student.studentId)
      : api.getLocalAttempts(state.student.studentId);
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

    const notesActive = privateFence();
    api.getNotes(state.student.studentId)
      .then(list => { if (!notesActive()) return; state.studyNotes = list || []; render(state.studyNotes); })
      .catch(err => console.error("Failed to refresh notes:", err));
  }
  
  function openNoteViewer(note) {
    const overlay = document.getElementById("note-viewer-overlay");
    const frame = document.getElementById("note-viewer-frame");
    const title = document.getElementById("note-viewer-title");
    const newTabLink = document.getElementById("note-viewer-newtab");

    // 9 Oct 2026: backend ab har note ke saath previewUrl/viewUrl bhejta hai
    // (hamara proxy — Drive ka raw link student ko dikhta hi nahi). Purane
    // notes ke liye Drive link fallback waise hi rehta hai.
    const previewUrl = note.previewUrl || `https://drive.google.com/file/d/${note.fileId}/preview`;
    frame.src = previewUrl;
    title.textContent = note.title;
    newTabLink.href = note.viewUrl || `https://drive.google.com/file/d/${note.fileId}/view`;
    overlay.hidden = false;
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
    const remRoot = $("#reminders-root");
    if (remRoot && window.UMP_EXTRAS) window.UMP_EXTRAS.renderReminders(remRoot, s);
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
    if (window.UMP_PROGRESS_SHARE) window.UMP_PROGRESS_SHARE.paint();

    // --- Push notification enable section inside profile card ---
    try {
      const profileGrid = document.querySelector(".profile-grid");
      if (profileGrid && !document.getElementById("push-status-row")) {
        const pushDiv = document.createElement("div");
        pushDiv.id = "push-status-row";
        pushDiv.style.gridColumn = "1 / -1";
        pushDiv.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:700; font-size:14px;">🔔 Push Notifications</div>
              <div id="push-status-text" style="font-size:13px; color:#64748B; margin-top:4px;">Checking...</div>
            </div>
            <button id="enable-push-btn" class="btn-primary sm" type="button">
              <i class="fa-solid fa-bell"></i> Enable Notifications
            </button>
          </div>
          <div id="push-debug" style="margin-top:10px; font-size:11px; color:#94A3B8; word-break:break-all;"></div>
        `;
        profileGrid.appendChild(pushDiv);

        const statusText = pushDiv.querySelector("#push-status-text");
        const enableBtn = pushDiv.querySelector("#enable-push-btn");
        const debugEl = pushDiv.querySelector("#push-debug");

        const updateStatus = () => {
          const perm = (window.UMP_PUSH && window.UMP_PUSH.getPermissionState()) || (Notification && Notification.permission) || "unknown";
          const token = localStorage.getItem("ump_fcm_token_" + state.student.studentId);
          if (perm === "granted" && token) {
            statusText.textContent = "✅ Enabled on this device";
            statusText.style.color = "#10B981";
            enableBtn.innerHTML = '<i class="fa-solid fa-check"></i> Enabled';
            enableBtn.disabled = true;
            debugEl.textContent = "Token: " + token.slice(0, 40) + "...";
          } else if (perm === "denied") {
            statusText.textContent = "❌ Blocked — enable from browser site settings, then reload";
            statusText.style.color = "#EF4444";
            enableBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Blocked';
            enableBtn.disabled = true;
          } else if (perm === "default") {
            statusText.textContent = "⚪ Not yet enabled";
            statusText.style.color = "#F59E0B";
            enableBtn.disabled = false;
          } else {
            statusText.textContent = "Status: " + perm;
            enableBtn.disabled = false;
          }
        };

        updateStatus();

        enableBtn.addEventListener("click", async () => {
          enableBtn.disabled = true;
          enableBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enabling...';
          try {
            const t = await window.UMP_PUSH.requestAndSaveToken(state.student.studentId, { force: true });
            if (t) {
              if (window.__umpShowPushToast) window.__umpShowPushToast("✅ Notifications enabled", "You will now receive mentor updates instantly.");
            } else {
              if (window.__umpShowPushToast) window.__umpShowPushToast("❌ Could not enable", "Check browser permission and try again.");
            }
          } catch (e) {
            console.error(e);
          }
          setTimeout(updateStatus, 600);
        });
      }
    } catch (e) {
      console.warn("push UI inject failed", e);
    }
  }

  // ── Mentor-controlled access OFF (8 Oct 2026) ──────────────────────────
  // Mentor access OFF karta hai to login ke saath-saath HAR API call block —
  // ye poora screen dikhta hai (reason ke saath).
  function showAccessBlockedScreen(info) {
    const payload = info || {};
    const reason = String(payload.reason || "").trim();
    const existing = document.getElementById("ump-access-blocked");
    if (existing) existing.remove();

    if (!document.getElementById("ump-access-blocked-style")) {
      const style = document.createElement("style");
      style.id = "ump-access-blocked-style";
      style.textContent = `
        #ump-access-blocked { position: fixed; inset: 0; z-index: 100002; background: #F8FAFC;
          display: flex; align-items: center; justify-content: center; padding: 20px; font-family: inherit; }
        #ump-access-blocked .uab-card { max-width: 460px; width: 100%; background: #fff; border: 1px solid #FECACA;
          border-radius: 20px; padding: 28px; text-align: center; box-shadow: 0 20px 50px rgba(15,23,42,.12); }
        #ump-access-blocked .uab-icon { width: 56px; height: 56px; margin: 0 auto; border-radius: 50%;
          background: #FEE2E2; color: #DC2626; display: flex; align-items: center; justify-content: center; font-size: 26px; }
        #ump-access-blocked h2 { margin: 16px 0 6px; font-size: 20px; color: #0F172A; }
        #ump-access-blocked p { margin: 0; color: #475569; font-size: 14px; line-height: 1.6; }
        #ump-access-blocked .uab-reason { margin-top: 14px; background: #FEF2F2; border: 1px solid #FECACA;
          border-radius: 12px; padding: 12px 14px; color: #991B1B; font-size: 14px; text-align: left; }
        #ump-access-blocked button { margin-top: 18px; width: 100%; height: 44px; border: 0; border-radius: 12px;
          background: #2563EB; color: #fff; font-weight: 600; font-size: 15px; cursor: pointer; }
      `;
      document.head.appendChild(style);
    }

    const wrap = document.createElement("div");
    wrap.id = "ump-access-blocked";
    wrap.innerHTML =
      '<div class="uab-card">' +
        '<div class="uab-icon">&#128274;</div>' +
        '<h2>App access is OFF</h2>' +
        '<p>Your mentor has turned off access for this account. Please contact your mentor.</p>' +
        (reason ? '<div class="uab-reason"><strong>Reason:</strong> ' + escapeHtml(reason) + '</div>' : '') +
        '<button type="button" id="ump-access-blocked-reload">Try again</button>' +
      '</div>';
    document.body.appendChild(wrap);
    const btn = document.getElementById("ump-access-blocked-reload");
    if (btn) btn.addEventListener("click", () => window.location.reload());
  }

  window.addEventListener("ump:access-blocked", (event) => {
    showAccessBlockedScreen((event && event.detail) || {});
  });

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
  const tlHoursQuick = document.getElementById("tl-hours-quick");
  const tlTomorrow = document.getElementById("tl-tomorrow");
  const tlMentorSupport = document.getElementById("tl-mentor-support");
  const tlProofFile = document.getElementById("tl-proof-file");
  const tlError = document.getElementById("tl-error");
  const tlSubmitBtn = document.getElementById("tl-submit");

  const tlNoSection = document.getElementById("tl-no-section");
  const tlYesSection = document.getElementById("tl-yes-section");
  const tlReasonOther = document.getElementById("tl-reason-other");

  // Phone camera photos 3–8 MB ke hote hain — pehle 3 MB par submit block ho
  // jata tha ("file is too large" = "submit nahi ho raha"). Ab raw cap 15 MB
  // hai aur image submit se pehle chhoti JPEG me compress hoti hai.
  const MAX_PROOF_BYTES = 15 * 1024 * 1024;
  const PROOF_JPEG_TARGET = 900 * 1024;

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

  // Hours ke quick chips (½h / 1h / 2h ...) — ek tap me value bhar jati hai.
  if (tlHoursQuick) {
    tlHoursQuick.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-hours]") : null;
      if (!btn) return;
      tlHours.value = btn.getAttribute("data-hours");
      if (tlHours.value === "0") {
        const noInput = document.querySelector('input[name="tl-planned"][value="No"]');
        if (noInput) {
          noInput.checked = true;
          // Reuse the existing change handlers to update chips, reveal the
          // reason, and clear hidden subjects/targets/proof from a previous choice.
          noInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      clearModalError(tlError);
      clearFieldError();
    });
  }
  tlHours.addEventListener("input", () => { clearModalError(tlError); clearFieldError(); });
  tlDate.addEventListener("change", () => { clearModalError(tlError); clearFieldError(); });

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

  const ownTrackerDrafts = new Map();
  let restoredTrackerProof = null;
  window.UMP_PRESERVE_TRACKER_DRAFT = () => {
    if (!state.student || !trackerModal || trackerModal.hidden) return;
    const fields = [...trackerModal.querySelectorAll('input,textarea,select')]
      .filter(field => field.type !== 'file')
      .map(field => ({ id: field.id, name: field.name, value: field.value, checked: field.checked }));
    ownTrackerDrafts.set(state.student.studentId, { fields, file: (tlProofFile.files && tlProofFile.files[0]) || restoredTrackerProof });
  };

  function openTrackerModal() {
    if (!state.student) return;

    document.getElementById("tracker-modal-student-name").textContent = state.student.studentName || "";
    document.getElementById("tracker-modal-student-id").textContent = state.student.studentId || "";

    // toISOString() UTC deta hai — IST me raat 12 se subah 5:30 tak kal ki date
    // auto-fill ho jati thi, isliye study aksar pichhle din me chali jati thi.
    const nowLocal = new Date();
    tlDate.value = new Date(nowLocal.getTime() - nowLocal.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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
    clearModalError(tlError);
    clearFieldError();

    restoredTrackerProof = null;
    const draft = ownTrackerDrafts.get(state.student.studentId);
    if (draft) {
      const fields = [...trackerModal.querySelectorAll('input,textarea,select')];
      for (const saved of draft.fields) {
        const field = fields.find(item => (saved.id && item.id === saved.id) || (saved.name && item.name === saved.name && item.value === saved.value));
        if (field) { field.value = saved.value; if ('checked' in field) field.checked = saved.checked; }
      }
      restoredTrackerProof = draft.file;
      const planned = getRadioValue('tl-planned');
      tlNoSection.hidden = planned !== 'No'; tlYesSection.hidden = planned !== 'Yes';
      tlReasonOther.hidden = getRadioValue('tl-reason') !== 'Other';
    }
    trackerModal.hidden = false;
  }

  function closeTrackerModal() {
    trackerModal.hidden = true;
  }

  document.getElementById("tl-cancel").addEventListener("click", closeTrackerModal);

  trackerModal.addEventListener("click", (e) => {
    if (e.target === trackerModal) closeTrackerModal();
  });

  // Image ko canvas par resize + JPEG compress karta hai (max 1600px, target
  // ~900 KB) — isse 8 MB ka photo bhi ~200-400 KB ban jata hai aur submit
  // kabhi size ki wajah se fail nahi hota. Non-image / koi problem ho to null.
  function compressProofImage(file) {
    return new Promise((resolve) => {
      const type = String(file.type || "");
      if (type.indexOf("image/") !== 0 || type === "image/gif" || !window.FileReader || !document.createElement("canvas").getContext) {
        return resolve(null);
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const MAX_DIM = 1600;
          const scale = Math.min(1, MAX_DIM / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || 1) * scale));
          const h = Math.max(1, Math.round((img.height || 1) * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          let quality = 0.78;
          let dataUrl = canvas.toDataURL("image/jpeg", quality);
          while (dataUrl.length * 0.75 > PROOF_JPEG_TARGET && quality > 0.4) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL("image/jpeg", quality);
          }
          URL.revokeObjectURL(url);
          resolve(dataUrl.split(",")[1] || null);
        } catch (err) {
          try { URL.revokeObjectURL(url); } catch (e) {}
          resolve(null);
        }
      };
      img.onerror = () => { try { URL.revokeObjectURL(url); } catch (e) {} resolve(null); };
      img.src = url;
    });
  }

  function readProofFile() {
    return new Promise((resolve, reject) => {
      const file = (tlProofFile.files && tlProofFile.files[0]) || restoredTrackerProof;
      if (!file) return resolve(null);

      // Pehle compress karo, size check BAAD me — warna 20 MP ka normal phone
      // photo bhi cap se bada hote hi reject ho jata tha (yahi "submit nahi
      // ho raha" ka bada karan tha). Cap sirf un files par lagta hai jo image
      // nahi hain ya compress nahi ho payin (PDF etc.).
      compressProofImage(file).then((compressed) => {
        if (compressed) {
          const base = String(file.name || "proof").replace(/\.[^.]+$/, "");
          return resolve({ fileName: base + ".jpg", mimeType: "image/jpeg", base64: compressed, compressed: true });
        }
        if (file.size > MAX_PROOF_BYTES) {
          return reject(new Error("That file is too large — please attach something under 15 MB."));
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
    });
  }

  // 8 Oct (raat): #tl-error / #fp-error par class "login-error" lagi hai aur
  // CSS me .login-error{display:none} hai — sirf `hidden=false` karne se text
  // DIKHTA HI NAHI tha. Student ko lagta tha "submit button kaam nahi kar raha".
  // Ab inline display bhi set karte hain (cached CSS ke bawajood visible).
  function setModalError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.style.display = "block";
  }

  function clearModalError(el) {
    if (!el) return;
    el.textContent = "";
    el.hidden = true;
    el.style.display = "none";
  }

  // 9 Oct 2026: jo field khali hai usi par laal ring + auto-scroll + focus.
  // Pehle ek hi combined message aata tha aur khali field scroll ke bahar (upar)
  // hota tha — student ko samajh hi nahi aata tha kya chhoot raha hai.
  function clearFieldError() {
    document.querySelectorAll(".field-error").forEach((n) => n.classList.remove("field-error"));
  }

  function highlightFieldError(el) {
    clearFieldError();
    if (!el) return;
    const field = (el.closest && el.closest(".field")) || el;
    field.classList.add("field-error");
    try { field.scrollIntoView({ block: "center", behavior: "smooth" }); }
    catch (e) { try { field.scrollIntoView(); } catch (e2) {} }
    try { if (field.focus) field.focus({ preventScroll: true }); } catch (e) {}
  }

  tlSubmitBtn.addEventListener("click", async () => {
    const date = tlDate.value;
    // "2,5" (comma wala keyboard) bhi chale — pehle wahan value hi blank ho jati thi.
    const hoursRaw = String(tlHours.value == null ? "" : tlHours.value).replace(",", ".").trim();
    const hours = Number(hoursRaw);
    const planned = getRadioValue("tl-planned");
    const mentorSupport = tlMentorSupport.value;

    // 9 Oct 2026: ek-ek field ka apna message — taaki student ko turant pata chale
    // kya chhoot raha hai (aur wo field screen par highlight ho jaye).
    if (!date) {
      setModalError(tlError, "No study date selected — tap a date on the calendar above.");
      highlightFieldError(tlDate);
      return;
    }
    if (!hoursRaw) {
      setModalError(tlError, "Enter today's total study hours — if you did not study today, enter 0 or use the 0 hrs option.");
      highlightFieldError(tlHours);
      return;
    }
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(hoursRaw) || !Number.isFinite(hours) || hours < 0 || hours > 24) {
      setModalError(tlError, "Study hours 0 se 24 ke beech number hona chahiye (jaise 0, 0.5 ya 2.5).");
      highlightFieldError(tlHours);
      return;
    }
    if (hours === 0 && planned !== "No") {
      setModalError(tlError, 'For 0 hours, select No for "Did you follow today\'s plan?" and give a reason.');
      highlightFieldError(tlPlannedGroup);
      return;
    }
    if (!planned) {
      setModalError(tlError, "This is required: did you follow today's plan? Pick one of Yes / No / Maybe.");
      highlightFieldError(tlPlannedGroup);
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
        setModalError(tlError, "Please select the main reason you couldn't study today.");
        highlightFieldError(tlReasonGroup);
        return;
      }
      if (reasonChoice === "Other" && !tlReasonOther.value.trim()) {
        setModalError(tlError, "Please specify your reason.");
        highlightFieldError(tlReasonOther);
        return;
      }
      reason = reasonChoice === "Other" ? tlReasonOther.value.trim() : reasonChoice;
    } else {
      const subjectList = getCheckboxValues(tlSubjectsGroup);
      targetDone = getRadioValue("tl-target");

      if (!subjectList.length) {
        setModalError(tlError, "Please select at least one subject you studied today.");
        highlightFieldError(tlSubjectsGroup);
        return;
      }
      if (!targetDone) {
        setModalError(tlError, "Please select whether you completed today's target.");
        highlightFieldError(tlTargetGroup);
        return;
      }
      if (!tlProofFile.files.length) {
        setModalError(tlError, "Please attach today's study proof.");
        highlightFieldError(tlProofFile);
        return;
      }

      subjects = subjectList.join(", ");
      tomorrowTarget = tlTomorrow.value.trim();
    }

    tlSubmitBtn.disabled = true;
    const originalLabel = tlSubmitBtn.innerHTML;
    tlSubmitBtn.innerHTML = "<span>Submitting...</span>";
    clearModalError(tlError);

    const studentId = state.student.studentId;
    // Snapshot before the write: if the acknowledgement is lost we can still tell
    // the student the truth by reading the log back, instead of handing them an
    // "outcome unknown" dead end.
    const logBefore = JSON.stringify(Array.isArray(state.log) ? state.log : []);

    try {
      proofFile = planned === "No" ? null : await readProofFile();

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

      if (!result || result.success !== true) {
        setModalError(tlError, (result && result.message) || "Server didn't save the entry — please try again.");
        return;
      }

      // The backend acknowledged the save. Never add optimistic hours: an
      // identical retry may already exist under the backend's legacy identity.
      // Retain the existing tracker read path, without adding an auth exception,
      // new reconciliation endpoint, cache-policy change or automatic resend.
      try {
        const [stats, log] = await Promise.all([
          api.getStats(studentId), api.getStudyLog(studentId)
        ]);
        if (!stats || typeof stats !== "object" || Array.isArray(stats) || !Array.isArray(log)) {
          throw new Error("Tracker response unavailable");
        }
        if (state.student?.studentId !== studentId) return;
        state.stats = stats;
        state.log = log;
      } catch {
        setModalError(tlError, "The server acknowledged your save, but the tracker could not refresh. Keep this draft and check Study tracker before submitting again.");
        return;
      }
      if (typeof ownTrackerDrafts !== 'undefined') ownTrackerDrafts.delete(studentId);
      restoredTrackerProof = null;
      closeTrackerModal();
      renderTracker();
    } catch (err) {
      if (err && err.saveOutcomeUnknown) {
        // The server may have committed the write even though the reply never
        // arrived. Read the log back once and report what actually happened.
        try {
          const [stats, log] = await Promise.all([api.getStats(studentId), api.getStudyLog(studentId)]);
          const logNow = JSON.stringify(Array.isArray(log) ? log : []);
          if (state.student?.studentId === studentId && Array.isArray(log) && logNow !== logBefore) {
            state.stats = stats; state.log = log;
            if (typeof ownTrackerDrafts !== 'undefined') ownTrackerDrafts.delete(studentId);
            restoredTrackerProof = null;
            closeTrackerModal();
            renderTracker();
            showToast("fa-circle-check", "Saved", "Your tracker is up to date.");
            return;
          }
          setModalError(tlError, "Not saved yet — nothing was added. Your draft is kept, please try again.");
        } catch {
          setModalError(tlError, "Saved or not, we could not confirm. Keep this draft and check Study tracker — do not submit twice.");
        }
        return;
      }
      if (err && err.sessionExpired) {
        setModalError(tlError, err.message || "Your session expired. Sign in again to continue.");
        return;
      }
      setModalError(tlError, err.message || "Something went wrong. Please try again.");
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

    error.hidden = true; error.style.display = "none";

    if (!studentId || !email) {
      error.textContent = "Please enter Student ID and registered Email.";
      error.hidden = false; error.style.display = "block";
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
      error.hidden = false; error.style.display = "block";
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

    error.hidden = true; error.style.display = "none";

    if (!password || !confirmPassword) {
      error.hidden = false; error.style.display = "block";
      error.textContent = "Please fill all fields.";
      return;
    }
    if (password.length < 6) {
      error.hidden = false; error.style.display = "block";
      error.textContent = "Password must be at least 6 characters.";
      return;
    }
    if (password !== confirmPassword) {
      error.hidden = false; error.style.display = "block";
      error.textContent = "Passwords do not match.";
      return;
    }

    try {
      const result = await api.resetPassword(studentId, password);

      if (!result.success) {
        error.hidden = false; error.style.display = "block";
        error.textContent = result.message;
        return;
      }

      alert("Password reset successfully!");

      document.getElementById("reset-modal").hidden = true;
      forgotModal.hidden = true;
      otpModal.hidden = true;
    } catch (err) {
      error.hidden = false; error.style.display = "block";
      error.textContent = err.message || "Unable to reset password.";
    }
  });

  // ============ NOTIFICATIONS ============ (IMPROVED: description + timeAgo + click navigations)
  const notifBell = document.getElementById("notif-bell");
  const notifBadge = document.getElementById("notif-badge");
  const notifPanel = document.getElementById("notif-panel");
  const notifPanelList = document.getElementById("notif-panel-list");
  const notifWrap = document.getElementById("notif-wrap");

  const annKey  = (a) => `a:${a.title}|${a.date}|${(a.message||"").slice(0,20)}`;
  const noteMKey = (n) => `m:${n.date}|${String(n.note || "").slice(0, 60)}`;
  const noteNKey = (n) => `n:${n.id}`;
  const repKey  = (r) => `r:${r.weekOf}`;

  const CLEARED_KEY = () => `ump_cleared_notifs_${state.student ? state.student.studentId : 'global'}`;

  function loadClearedNotifs() {
    try {
      const raw = localStorage.getItem(CLEARED_KEY());
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) state.notifCleared = new Set(arr);
      }
    } catch (e) { console.warn("Failed to load cleared notifs:", e); }
  }

  function saveClearedNotifs() {
    try {
      localStorage.setItem(CLEARED_KEY(), JSON.stringify([...state.notifCleared]));
    } catch (e) { console.warn("Failed to save cleared notifs:", e); }
  }

  function clearAllNotifications() {
    // Persist cleared IDs so they don't come back after refresh/relogin
    state.notifFeed.forEach(item => {
      const key = item.raw ? (item.type + ':' + (item.raw.id || item.raw.weekOf || item.title)) : (item.type + ':' + item.title);
      if (key) state.notifCleared.add(key);
    });
    saveClearedNotifs();
    // Also clear feed for current session
    state.notifFeed = [];
    state.notifUnread = 0;
    updateNotifBadge();
    renderNotifPanel();
    if (window.__umpShowPushToast) window.__umpShowPushToast("✅ Cleared", "All notifications cleared. They will not return.");
  }

  function seedNotifBaseline() {
    loadClearedNotifs();
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

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    if (s < 604800) return `${Math.floor(s/86400)}d ago`;
    return new Date(ts).toLocaleDateString("en-IN", { day:"2-digit", month:"short" });
  }

  function pushNotif(icon, title, sub, opts = {}) {
    // Suppress duplicates: check feed and cleared set
    const raw = opts.raw || null;
    const dupKey = raw ? (opts.type + ':' + (raw.id || raw.weekOf || raw.title || sub)) : (opts.type + ':' + title);
    const isDup = state.notifFeed.some(i => {
      const r = i.raw || null;
      const k = r ? (i.type + ':' + (r.id || r.weekOf || r.title || i.sub)) : (i.type + ':' + i.title);
      return k === dupKey;
    }) || (dupKey ? state.notifCleared.has(dupKey) : false);
    if (isDup) {
      console.log("🔕 Suppressed duplicate notification:", title);
      return;
    }
    const item = {
      icon,
      title: title || "Notification",
      sub: sub || "",
      desc: opts.desc || sub || "",
      type: opts.type || "general",
      ts: Date.now(),
      raw: opts.raw || null,
      nav: opts.nav || null
    };
    state.notifFeed.unshift(item);
    state.notifFeed = state.notifFeed.slice(0, 30);
    state.notifUnread++;
    updateNotifBadge();
    showToast(icon, title, sub, opts);
  }

  function showToast(icon, title, sub, opts = {}) {
    let stack = document.getElementById("notif-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "notif-toast-stack";
      stack.className = "notif-toast-stack";
      document.body.appendChild(stack);
    }
    const el = document.createElement("div");
    el.className = "notif-toast";
    const fullDesc = opts.desc && opts.desc !== sub ? `<div class="notif-toast-desc">${escapeHtml(opts.desc.slice(0,180))}</div>` : "";
    el.innerHTML = `
      <div class="notif-toast-icon"><i class="fa-solid ${icon}"></i></div>
      <div style="flex:1;min-width:0">
        <div class="notif-toast-title">${escapeHtml(title)}</div>
        <div class="notif-toast-sub">${escapeHtml((sub || "").slice(0,120))}</div>
        ${fullDesc}
      </div>
      <button class="notif-toast-close" style="background:none;border:none;color:#94A3B8;cursor:pointer;margin-left:8px"><i class="fa-solid fa-xmark"></i></button>
    `;
    if (opts.nav) {
      el.style.cursor = "pointer";
      el.addEventListener("click", (e) => {
        if (!e.target.closest(".notif-toast-close")) {
          if (opts.nav.startsWith("#")) location.hash = opts.nav;
          else navigate(opts.nav);
          el.remove();
        }
      });
    }
    el.querySelector(".notif-toast-close").addEventListener("click", () => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    });
    stack.appendChild(el);
    setTimeout(() => {
      if (!el.parentNode) return;
      el.style.transition = "opacity .3s ease, transform .3s ease";
      el.style.opacity = "0";
      el.style.transform = "translateX(30px)";
      setTimeout(() => el.remove(), 300);
    }, 6000);
  }

  window.__umpShowPushToast = (title, body, nav) => showToast("fa-bell", title, body, { desc: body, nav: nav || null });

  async function safeFetch(fn, fallback) {
    try {
      const result = await fn();
      state.notifConsecutiveFailures = 0;
      return result;
    } catch (err) {
      if (err?.privateSessionChanged) throw err;
      state.notifConsecutiveFailures++;
      if (state.notifConsecutiveFailures <= 2) {
        console.warn("Fetch failed (non-fatal):", err.message);
      }
      return fallback;
    }
  }

  async function checkForNewNotifications(showLogs = true) {
    if (!state.student) return 0;
    if (isCheckingNotifications) return 0;
    if (state.notifConsecutiveFailures >= 3) return 0;
    const active = privateFence();
    isCheckingNotifications = true;
    if (showLogs) console.log("🔄 Checking notifications (parallel, no artificial lag)...");
    try {
      const [announcements, mentorNotes, studyNotes, reports] = await Promise.all([
        safeFetch(() => api.getAnnouncements(), state.announcements),
        safeFetch(() => api.getStudentMentorNotes(state.student.studentId), state.mentorNotes),
        safeFetch(() => api.getNotes(state.student.studentId), state.studyNotes),
        safeFetch(() => api.getWeeklyReports(state.student.studentId), state.reports)
      ]);
      if (!active()) return 0;
      let newCount = 0;
      (announcements || []).forEach(a => {
        const k = annKey(a);
        const clearedKey = 'announcement:' + k;
        if (state.notifCleared.has(clearedKey)) return; // Suppress cleared notifications
        if (!state.notifSeen.announcements.has(k)) {
          state.notifSeen.announcements.add(k);
          newCount++;
          pushNotif("fa-bullhorn", a.title || "New announcement", (a.message||"").slice(0,100) || a.title || "", {
            desc: a.message || a.body || "",
            type: "announcement",
            raw: a,
            nav: "#dashboard"
          });
        }
      });
      (mentorNotes || []).forEach(n => {
        const k = noteMKey(n);
        const clearedKey = 'mentor:' + k;
        if (state.notifCleared.has(clearedKey)) return;
        if (!state.notifSeen.mentorNotes.has(k)) {
          state.notifSeen.mentorNotes.add(k);
          newCount++;
          pushNotif("fa-comment-dots", "New mentor note", (n.note || "").slice(0, 100), {
            desc: n.note || "",
            type: "mentor",
            raw: n,
            nav: "#dashboard"
          });
        }
      });
      (studyNotes || []).forEach(n => {
        const k = noteNKey(n);
        const clearedKey = 'notes:' + k;
        if (state.notifCleared.has(clearedKey)) return;
        if (!state.notifSeen.notes.has(k)) {
          state.notifSeen.notes.add(k);
          newCount++;
          pushNotif("fa-file-pdf", "New study material", n.title || "", {
            desc: `${n.subject || ""} ${n.category || ""} - ${n.title || ""} ${n.description || ""}`.trim(),
            type: "notes",
            raw: n,
            nav: "#notes"
          });
        }
      });
      (reports || []).forEach(r => {
        const k = repKey(r);
        const clearedKey = 'report:' + k;
        if (state.notifCleared.has(clearedKey)) return;
        if (!state.notifSeen.reports.has(k)) {
          state.notifSeen.reports.add(k);
          newCount++;
          pushNotif("fa-envelope-open-text", "Weekly report ready", r.weekOf || "", {
            desc: `Level: ${r.level || ""}, Hours: ${r.weeklyHours || ""}, Rank: ${r.rank || ""}`,
            type: "report",
            raw: r,
            nav: "#reports"
          });
        }
      });
      state.announcements = announcements;
      state.mentorNotes = mentorNotes;
      state.studyNotes = studyNotes;
      state.reports = reports;
      const activeView = (location.hash || "#dashboard").slice(1);
      if (activeView === "tutor") {
        renderMentorNotes(state.mentorNotes || []);
        const box = document.getElementById("announcement-list");
        if (box && state.announcements) {
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
      if (activeView === "reports") renderReports();
      if (activeView === "notes") renderNotes();
      if (showLogs) console.log(`✅ Notification check complete, ${newCount} new`);
      return newCount;
    } catch (err) {
      console.error("❌ Notification check failed:", err);
      state.notifConsecutiveFailures++;
      return 0;
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
      "Your streak may break tonight",
      "You have not logged study hours today. Open Daily Study Tracker and add today's entry.",
      { desc: "Maintain your daily streak by logging study hours before midnight.", type: "streak", nav: "#tracker" }
    );
  }

  function renderNotifPanel() {
    if (!notifPanelList) return;
    // Filter out cleared notifications (persistent across relogin/refresh)
    const visibleFeed = state.notifFeed.filter(item => {
      const raw = item.raw || null;
      const key = raw ? (item.type + ':' + (raw.id || raw.weekOf || raw.title || item.sub)) : (item.type + ':' + item.title);
      return !state.notifCleared.has(key);
    });
    if (!visibleFeed.length) {
      notifPanelList.innerHTML = `<div class="notif-empty">No notifications yet.<br><small style="color:#94A3B8">Pull down to refresh ↕️</small></div>`;
      return;
    }
    notifPanelList.innerHTML = visibleFeed.map((n, idx) => `
      <div class="notif-item ${n.type ? 'notif-type-'+n.type : ''}" data-idx="${idx}" data-nav="${n.nav || ''}" style="cursor:${n.nav ? 'pointer' : 'default'}">
        <div class="notif-item-icon"><i class="fa-solid ${n.icon}"></i></div>
        <div style="flex:1;min-width:0">
          <div class="notif-item-title" style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(n.title)}</span>
            <span style="font-size:10px;color:#94A3B8;white-space:nowrap">${timeAgo(n.ts)}</span>
          </div>
          <div class="notif-item-sub" style="margin-top:2px">${escapeHtml(n.sub || "")}</div>
          ${n.desc && n.desc !== n.sub ? `<div class="notif-item-desc" style="margin-top:6px;font-size:12px;color:#475569;line-height:1.4;background:#F8FAFC;padding:6px 8px;border-radius:6px;white-space:normal;word-break:break-word">${escapeHtml(n.desc.slice(0,200))}${n.desc.length>200?'...':''}</div>` : ""}
          ${n.type ? `<span style="display:inline-block;margin-top:6px;font-size:10px;padding:2px 6px;border-radius:10px;background:#EEF2FF;color:#4F46E5;text-transform:uppercase">${escapeHtml(n.type)}</span>` : ""}
        </div>
      </div>
    `).join("");
    notifPanelList.querySelectorAll("[data-nav]").forEach(el => {
      el.addEventListener("click", () => {
        const nav = el.getAttribute("data-nav");
        if (nav) {
          notifPanel.hidden = true;
          if (nav.startsWith("#")) location.hash = nav;
          else navigate(nav);
        }
      });
    });
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
    const panelHead = document.querySelector(".notif-panel-head");
    if (panelHead && !document.getElementById("notif-refresh-btn")) {
      const refreshBtn = document.createElement("button");
      refreshBtn.id = "notif-refresh-btn";
      refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
      refreshBtn.title = "Refresh notifications";
      refreshBtn.style.cssText = "background:none;border:none;cursor:pointer;color:#64748B;padding:4px 8px;border-radius:6px;margin-left:auto";
      refreshBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        refreshBtn.disabled = true;
        await checkForNewNotifications(true);
        renderNotifPanel();
        refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        refreshBtn.disabled = false;
      });
      panelHead.style.display = "flex";
      panelHead.style.alignItems = "center";
      panelHead.style.justifyContent = "space-between";
      panelHead.appendChild(refreshBtn);

      // ✅ Persistent Clear All notifications button
      const clearBtn = document.createElement("button");
      clearBtn.id = "notif-clear-all-btn";
      clearBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Clear All';
      clearBtn.title = "Clear all notifications permanently";
      clearBtn.style.cssText = "background:none;border:none;cursor:pointer;color:#EF4444;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;margin-left:8px;";
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Clear all notifications? They will not return after refresh or relogin.")) {
          clearAllNotifications();
        }
      });
      panelHead.appendChild(clearBtn);
    }
  }

  // ========== PULL TO REFRESH ========== (FEATURE 2)
  let pullState = { startY: 0, pulling: false, threshold: 80, currentY: 0 };

  function createPullIndicator() {
    if (document.getElementById("pull-refresh-indicator")) return;
    const indicator = document.createElement("div");
    indicator.id = "pull-refresh-indicator";
    indicator.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; height: 60px;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.9) 100%);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid #E2E8F0;
      transform: translateY(-100%);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 9999;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px; color: #475569; gap: 10px;
    `;
    indicator.innerHTML = `
      <span id="pull-refresh-icon" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#EEF2FF;color:#4F46E5;transition:transform 0.2s"><i class="fa-solid fa-arrow-down"></i></span>
      <span id="pull-refresh-text">Pull to refresh</span>
    `;
    document.body.appendChild(indicator);
    const style = document.createElement("style");
    style.id = "pull-refresh-style";
    style.textContent = `
      @keyframes pullSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .pull-refreshing #pull-refresh-icon { animation: pullSpin 0.8s linear infinite; background:#2563EB !important; color:#fff !important; }
      .notif-item:hover { background:#F8FAFC; }
      .notif-item { padding:12px; border-bottom:1px solid #F1F5F9; display:flex; gap:10px; transition:background 0.15s; }
      .notif-item:last-child { border-bottom:none; }
      .notif-item-icon { width:36px; height:36px; border-radius:10px; background:#EEF2FF; color:#4F46E5; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
      .notif-panel { max-height: 70vh; overflow-y:auto; }
      .notif-panel-head { padding:12px 16px; font-weight:700; border-bottom:1px solid #F1F5F9; position:sticky; top:0; background:#fff; z-index:1; }
      .notif-toast { display:flex; gap:12px; padding:14px 16px; background:#fff; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.12); border:1px solid #E2E8F0; min-width:300px; max-width:380px; margin-bottom:10px; }
      .notif-toast-stack { position:fixed; top:20px; right:20px; z-index:100002; display:flex; flex-direction:column; gap:8px; }
      .notif-toast-icon { width:40px;height:40px;border-radius:10px;background:#EEF2FF;color:#4F46E5;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
      .notif-toast-title { font-weight:700; font-size:14px; color:#0F172A; }
      .notif-toast-sub { font-size:13px; color:#475569; margin-top:2px; }
      .notif-toast-desc { font-size:12px; color:#64748B; margin-top:6px; background:#F8FAFC; padding:6px 8px; border-radius:6px; }
    `;
    document.head.appendChild(style);
  }

  async function refreshCurrentView() {
    const view = (location.hash || "#dashboard").slice(1);
    const studentId = state.student?.studentId;
    if (!studentId) return;
    const active = privateFence();
    console.log("🔄 Pull refresh for view:", view);
    const indicator = document.getElementById("pull-refresh-indicator");
    const icon = document.getElementById("pull-refresh-icon");
    const text = document.getElementById("pull-refresh-text");
    if (indicator) {
      indicator.classList.add("pull-refreshing");
      if (icon) icon.innerHTML = '<i class="fa-solid fa-spinner"></i>';
      if (text) text.textContent = "Refreshing...";
    }
    try {
      if (view === "dashboard" || view === "") {
        const [stats, announcements, mentorNotes, leaderboard] = await Promise.all([
          safeFetch(() => api.getStats(studentId), state.stats),
          safeFetch(() => api.getAnnouncements(), state.announcements),
          safeFetch(() => api.getStudentMentorNotes(studentId), state.mentorNotes),
          safeFetch(() => api.getLeaderboard(), state.leaderboard)
        ]);
        if (!active()) return;
        state.stats = stats;
        state.announcements = announcements;
        state.mentorNotes = mentorNotes;
        state.leaderboard = leaderboard;
        $("#topbar-streak").textContent = stats.streak ?? 0;
        navigate("dashboard");
        if (window.__umpShowPushToast) window.__umpShowPushToast("✅ Refreshed", "Dashboard updated");
      } else if (view === "tracker") {
        const [stats, log] = await Promise.all([
          api.getStats(studentId),
          api.getStudyLog(studentId)
        ]);
        if (!active()) return;
        state.stats = stats;
        state.log = log;
        $("#topbar-streak").textContent = stats.streak ?? 0;
        renderTracker();
        if (window.__umpShowPushToast) window.__umpShowPushToast("✅ Refreshed", "Tracker updated");
      } else if (view === "notes") {
        const notes = await safeFetch(() => api.getNotes(studentId), state.studyNotes);
        if (!active()) return;
        state.studyNotes = notes;
        renderNotes();
        if (window.__umpShowPushToast) window.__umpShowPushToast("✅ Refreshed", "Notes updated");
      } else if (view === "reports") {
        const reports = await api.getWeeklyReports(studentId);
        if (!active()) return;
        state.reports = reports;
        renderReports();
      } else if (view === "leaderboard") {
        const lb = await api.getLeaderboard();
        if (!active()) return;
        state.leaderboard = lb;
        renderLeaderboard();
      } else {
        await checkForNewNotifications(false);
        if (!active()) return;
        renderNotifPanel();
      }
    } catch (e) {
      console.error("Pull refresh failed", e);
      if (window.__umpShowPushToast) window.__umpShowPushToast("❌ Refresh failed", e.message || "Try again");
    } finally {
      setTimeout(() => {
        const ind = document.getElementById("pull-refresh-indicator");
        if (ind) {
          ind.style.transform = "translateY(-100%)";
          ind.classList.remove("pull-refreshing");
          const ic = document.getElementById("pull-refresh-icon");
          const tx = document.getElementById("pull-refresh-text");
          if (ic) ic.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
          if (tx) tx.textContent = "Pull to refresh";
        }
      }, 500);
    }
  }

  function initPullToRefresh() {
    createPullIndicator();
    const mainEl = document.querySelector(".main") || document.getElementById("view-container") || document.body;
    const indicator = document.getElementById("pull-refresh-indicator");
    if (!mainEl || !indicator) return;
    let startY = 0;
    let isAtTop = false;
    mainEl.addEventListener("touchstart", (e) => {
      const scrollTopMain = mainEl.scrollTop || 0;
      const scrollTopWin = window.scrollY || document.documentElement.scrollTop || 0;
      const viewContainer = document.querySelector(".view-container");
      const containerScroll = viewContainer ? viewContainer.scrollTop : 0;
      if (scrollTopMain === 0 && scrollTopWin === 0 && containerScroll === 0) {
        isAtTop = true;
        startY = e.touches[0].clientY;
        pullState.startY = startY;
        pullState.pulling = false;
      } else {
        isAtTop = false;
      }
    }, { passive: true });
    mainEl.addEventListener("touchmove", (e) => {
      if (!isAtTop) return;
      const currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      if (diff > 0 && diff < 150) {
        const scrollTop = mainEl.scrollTop || document.documentElement.scrollTop || 0;
        if (scrollTop === 0) {
          pullState.pulling = true;
          pullState.currentY = diff;
          const progress = Math.min(diff / pullState.threshold, 1.2);
          indicator.style.transform = `translateY(${Math.min(diff - 60, 0)}px)`;
          const icon = document.getElementById("pull-refresh-icon");
          const text = document.getElementById("pull-refresh-text");
          if (progress >= 1) {
            if (icon) { icon.style.transform = "rotate(180deg)"; icon.style.background = "#DCFCE7"; icon.style.color = "#16A34A"; }
            if (text) text.textContent = "Release to refresh";
          } else {
            if (icon) { icon.style.transform = `rotate(${progress * 180}deg)`; icon.style.background = "#EEF2FF"; icon.style.color = "#4F46E5"; }
            if (text) text.textContent = "Pull to refresh";
          }
        }
      }
    }, { passive: true });
    mainEl.addEventListener("touchend", async () => {
      if (!isAtTop || !pullState.pulling) return;
      const diff = pullState.currentY;
      pullState.pulling = false;
      isAtTop = false;
      if (diff >= pullState.threshold) {
        indicator.style.transform = "translateY(0)";
        await refreshCurrentView();
      } else {
        indicator.style.transform = "translateY(-100%)";
      }
      pullState.currentY = 0;
    }, { passive: true });
    // Mouse drag for desktop testing
    let mouseDown = false;
    mainEl.addEventListener("mousedown", (e) => {
      if ((mainEl.scrollTop || 0) === 0 && e.clientY < 120) {
        mouseDown = true;
        startY = e.clientY;
      }
    });
    mainEl.addEventListener("mousemove", (e) => {
      if (!mouseDown) return;
      const diff = e.clientY - startY;
      if (diff > 0 && diff < 120 && (mainEl.scrollTop || 0) === 0) {
        const progress = Math.min(diff / pullState.threshold, 1);
        indicator.style.transform = `translateY(${Math.min(diff - 60, 0)}px)`;
        const text = document.getElementById("pull-refresh-text");
        if (progress >= 1 && text) text.textContent = "Release to refresh";
      }
    });
    mainEl.addEventListener("mouseup", async (e) => {
      if (!mouseDown) return;
      mouseDown = false;
      const diff = e.clientY - startY;
      if (diff >= pullState.threshold) {
        indicator.style.transform = "translateY(0)";
        await refreshCurrentView();
      } else {
        indicator.style.transform = "translateY(-100%)";
      }
    });
  }


  // ============ BOOT ============
  boot();

  // Foreground private-data refresh uses the authorization-first listener above.

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
