/**
 * Live Mentor-Approved MCQ Bank Loader
 * Connects student dashboard to mentor backend (FastAPI) so when mentor approves
 * a chapter in MCQ Review, it immediately shows in student app/web.
 * 
 * Flow: Mentor approves in https://ujjwal-pathak-project.vercel.app/ai-content/queue
 *  -> status becomes approved/release_candidate
 *  -> backend /api/content/student/bank.json returns approved questions
 *  -> this loader fetches bank.json and replaces static dailyMcqBank
 *  -> demo data (needs_review) is automatically excluded by backend filter
 * 
 * Usage: Include AFTER learning-data.js but BEFORE learning-tools.js in index.html:
 * <script src="learning-data.js"></script>
 * <script src="live-bank-loader.js"></script>
 * <script src="learning-tools.js"></script>
 */

(function () {
  'use strict';

  // Config - change this to your Render backend URL
  // Priority: window.MENTOR_API_URL > localStorage > default
  const DEFAULT_MENTOR_API = 'https://ujjwal-pathak-project.onrender.com';
  const MENTOR_API = (
    window.MENTOR_API_URL ||
    localStorage.getItem('ump_mentor_api_url') ||
    DEFAULT_MENTOR_API
  ).replace(/\/$/, '');

  const BANK_URL = `${MENTOR_API}/api/content/student/bank.json`;
  const CACHE_KEY = 'ump_live_bank';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  console.log('[Live Bank] Mentor API:', MENTOR_API);
  console.log('[Live Bank] Fetching live approved bank from:', BANK_URL);

  function getCached() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.ts > CACHE_TTL) {
        console.log('[Live Bank] Cache expired');
        return null;
      }
      return data.payload;
    } catch (e) {
      return null;
    }
  }

  function setCached(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        ts: Date.now(),
        payload
      }));
    } catch (e) {
      console.warn('[Live Bank] Cache save failed', e);
    }
  }

  function applyLiveBank(liveData) {
    if (!liveData || !Array.isArray(liveData.questions) || liveData.questions.length === 0) {
      console.log('[Live Bank] No live questions (count=0), keeping static bank. Mentor needs to approve chapters first.');
      return false;
    }

    // Validate live questions have required fields
    const validQuestions = liveData.questions.filter(q => 
      q && q.id && q.prompt && Array.isArray(q.options) && q.options.length === 4
    );

    if (validQuestions.length === 0) {
      console.warn('[Live Bank] Live data has 0 valid questions, keeping static');
      return false;
    }

    // Replace static bank with live approved bank
    // This automatically removes demo data (demo has status needs_review, not in live bank)
    const oldCount = (window.UMP_LEARNING_DATA && window.UMP_LEARNING_DATA.questions && window.UMP_LEARNING_DATA.questions.length) || 0;
    
    // Ensure official chapter catalog exists - build from live data if needed
    const chapterMap = {};
    validQuestions.forEach(q => {
      if (q.chapterId && !chapterMap[q.chapterId]) {
        chapterMap[q.chapterId] = {
          id: q.chapterId,
          subject: q.subject,
          title: q.chapterTitle || q.chapterId,
          displayTitle: q.chapter || q.chapterTitle || q.chapterId
        };
      }
    });

    // Merge or replace: if live bank has approved chapters, use it; otherwise keep static + live
    // Strategy: REPLACE static with live when live has data (mentor-approved), to remove demo
    window.UMP_LEARNING_DATA = {
      revision: liveData.revision || 'live-approved-' + new Date().toISOString(),
      generatedAt: liveData.generatedAt || new Date().toISOString(),
      questions: validQuestions,
      officialMcqChapterCatalog: window.UMP_LEARNING_DATA ? window.UMP_LEARNING_DATA.officialMcqChapterCatalog : Object.values(chapterMap),
      manifest: window.UMP_LEARNING_DATA ? window.UMP_LEARNING_DATA.manifest : { targetAttempt: 'May 2026', notice: 'Live mentor-approved content' },
      liveBank: true,
      liveCount: validQuestions.length
    };

    console.log(`[Live Bank] ✅ Applied live bank: ${oldCount} static -> ${validQuestions.length} live approved (demo removed)`);
    console.log(`[Live Bank] Chapters: ${Object.keys(chapterMap).length}`, Object.keys(chapterMap));

    // Also expose for debugging
    window.UMP_LIVE_BANK = liveData;

    return true;
  }

  async function fetchLiveBank() {
    // Try cache first for instant load, then refresh in background
    const cached = getCached();
    if (cached) {
      console.log('[Live Bank] Using cached live bank:', cached.count || cached.questions?.length);
      applyLiveBank(cached);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout (Render cold start can be slow)

      const res = await fetch(BANK_URL, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const liveData = await res.json();
      
      console.log(`[Live Bank] Fetched live bank: ${liveData.count} questions, revision ${liveData.revision}`);

      if (liveData.count === 0) {
        console.log('[Live Bank] Live bank is empty (0) — mentor has not approved any chapter yet. Student will see static demo until approval.');
        console.log('[Live Bank] To make a chapter live: Mentor Dashboard → Review Queue → Approve 50 questions → Chapter Coverage → Approve Chapter');
        return;
      }

      setCached(liveData);
      
      const wasApplied = applyLiveBank(liveData);
      
      if (wasApplied) {
        // If learning-tools already initialized, need to reload? For now, next navigation will use new data
        // If on MCQ page, show toast
        if (window.UMP_LEARNING_TOOLS && wasApplied) {
          console.log('[Live Bank] Live bank applied, MCQ pool updated. Navigate to MCQ to see new chapters.');
        }
      }

    } catch (err) {
      console.warn('[Live Bank] Failed to fetch live bank (will keep static demo):', err.message);
      console.warn('[Live Bank] Check: Is backend running at', MENTOR_API, '? CORS allowed?');
      console.warn('[Live Bank] Test URL in browser:', BANK_URL);
      
      if (cached) {
        console.log('[Live Bank] Keeping cached version due to fetch failure');
      } else {
        console.log('[Live Bank] No cache and fetch failed — using static demo bank (376 questions). Mentor should approve chapters to make live bank available.');
      }
    }
  }

  // Expose manual refresh for debugging
  window.UMP_REFRESH_LIVE_BANK = function() {
    console.log('[Live Bank] Manual refresh triggered');
    localStorage.removeItem(CACHE_KEY);
    return fetchLiveBank();
  };

  window.UMP_CLEAR_LIVE_CACHE = function() {
    localStorage.removeItem(CACHE_KEY);
    console.log('[Live Bank] Cache cleared');
  };

  // Auto-fetch on load
  // Wait for DOM + learning-data.js to be loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchLiveBank);
  } else {
    // Small delay to ensure learning-data.js has set window.UMP_LEARNING_DATA
    setTimeout(fetchLiveBank, 100);
  }

  // Also refresh when student navigates to MCQ view (to catch new approvals)
  let lastMcqCheck = 0;
  const originalPushState = history.pushState;
  history.pushState = function() {
    originalPushState.apply(this, arguments);
    const hash = location.hash;
    if (hash.includes('mcq') && Date.now() - lastMcqCheck > 30000) { // 30s throttle
      lastMcqCheck = Date.now();
      setTimeout(fetchLiveBank, 500);
    }
  };
})();
