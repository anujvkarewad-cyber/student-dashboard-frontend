/**
 * Published MCQ bank loader.
 *
 * The mentor FastAPI service is the source of truth. Static questions bundled
 * in learning-data.js are build-time preview data only and are cleared before
 * the MCQ tools initialise unless a cached published bank is available.
 */
(function () {
  "use strict";

  const DEFAULT_MENTOR_API = "https://ujjwal-pathak-project.onrender.com";
  const MENTOR_API = (
    window.MENTOR_API_URL ||
    localStorage.getItem("ump_mentor_api_url") ||
    DEFAULT_MENTOR_API
  ).replace(/\/$/, "");
  const BANK_URL = `${MENTOR_API}/api/content/student/bank.json`;
  const BANK_META_URL = `${MENTOR_API}/api/content/student/bank-meta.json`;
  const CACHE_KEY = "ump_live_published_bank_v1";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 65 * 1000; // Render free-tier cold starts can exceed 30 seconds.
  const REVISION_POLL_MS = 10 * 1000;
  const originalData = window.UMP_LEARNING_DATA || {};

  function setStatus(state, detail = {}) {
    window.UMP_LIVE_BANK_STATUS = {
      state,
      bankUrl: BANK_URL,
      checkedAt: Date.now(),
      ...detail,
    };
    window.dispatchEvent(new CustomEvent("ump:live-bank-change", {
      detail: window.UMP_LIVE_BANK_STATUS,
    }));
  }

  function getCached() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!saved || !saved.payload || Date.now() - Number(saved.ts || 0) > CACHE_TTL) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return saved.payload;
    } catch (_) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
  }

  function setCached(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), payload }));
    } catch (error) {
      console.warn("[Published Bank] Cache save failed:", error);
    }
  }

  function chapterCatalog(questions) {
    const fromQuestions = new Map();
    questions.forEach((question) => {
      if (!question.chapterId || fromQuestions.has(question.chapterId)) return;
      fromQuestions.set(question.chapterId, question.officialChapter || {
        id: question.chapterId,
        subject: question.subject,
        title: question.chapterTitle || question.chapterId,
        officialTitle: question.chapterTitle || question.chapterId,
        displayTitle: question.chapter || question.chapterTitle || question.chapterId,
        chapterNumber: question.chapterNumber || 0,
        module: question.chapterModule || "Module 1",
        catalogOrder: question.chapterOrder || 0,
      });
    });
    return fromQuestions.size
      ? [...fromQuestions.values()]
      : (originalData.officialMcqChapterCatalog || []);
  }

  function applyBank(payload, state = "ready") {
    if (!payload || !Array.isArray(payload.questions)) {
      throw new Error("Published bank response does not contain a questions array");
    }

    const validQuestions = payload.questions.filter((question) =>
      question &&
      question.id &&
      question.prompt &&
      Array.isArray(question.options) &&
      question.options.length === 4 &&
      Number.isInteger(question.answer) &&
      question.answer >= 0 &&
      question.answer < 4
    );
    if (validQuestions.length !== payload.questions.length) {
      console.warn(
        `[Published Bank] Ignored ${payload.questions.length - validQuestions.length} malformed question(s)`
      );
    }

    const nextData = {
      ...originalData,
      revision: String(payload.revision || "published-r0"),
      generatedAt: payload.generatedAt || new Date().toISOString(),
      questions: validQuestions,
      officialMcqChapterCatalog: chapterCatalog(validQuestions),
      manifest: {
        ...(originalData.manifest || {}),
        notice: "Mentor-reviewed and published question bank.",
      },
      liveBank: true,
      liveCount: validQuestions.length,
    };

    window.UMP_LEARNING_DATA = nextData;
    window.UMP_LIVE_BANK = { ...payload, questions: validQuestions, count: validQuestions.length };

    // learning-tools.js may already be initialised (the network request is
    // asynchronous). Replace its captured bank instead of only replacing a
    // window global that the tool no longer reads.
    if (window.UMP_LEARNING_TOOLS?.replaceLearningData) {
      window.UMP_LEARNING_TOOLS.replaceLearningData(nextData);
    }

    setStatus(state, {
      revision: nextData.revision,
      count: validQuestions.length,
      cached: state === "cached" || state === "stale",
    });
    console.log(
      `[Published Bank] Applied ${validQuestions.length} question(s), revision ${nextData.revision}`
    );
    return nextData;
  }

  const cachedAtStartup = getCached();
  if (cachedAtStartup) {
    // This synchronous apply runs before learning-tools.js, so a returning
    // student immediately starts with the last known published bank.
    applyBank(cachedAtStartup, "cached");
  } else {
    // Fail closed: do not expose bundled preview/previous questions while the
    // authoritative published bank is loading.
    applyBank({ revision: "published-loading", generatedAt: null, questions: [] }, "loading");
  }

  let requestInFlight = null;
  async function fetchPublishedBank({ force = false } = {}) {
    if (requestInFlight) return requestInFlight;

    const hadUsableCache = Boolean(getCached());
    setStatus("loading", {
      revision: window.UMP_LEARNING_DATA?.revision,
      count: window.UMP_LEARNING_DATA?.questions?.length || 0,
      cached: hadUsableCache,
    });

    requestInFlight = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(BANK_URL, {
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload.questions)) throw new Error("Invalid JSON bank shape");

        // An empty response is authoritative and deliberately clears both the
        // old cache and old questions.
        setCached(payload);
        return applyBank(payload, "ready");
      } catch (error) {
        const message = error?.name === "AbortError"
          ? "The content server took too long to wake up. Please retry."
          : String(error?.message || error);
        console.warn("[Published Bank] Fetch failed:", message, BANK_URL);
        const stale = getCached();
        if (stale) {
          applyBank(stale, "stale");
          setStatus("stale", {
            revision: stale.revision,
            count: stale.questions?.length || 0,
            cached: true,
            error: message,
          });
        } else {
          applyBank({ revision: "published-unavailable", questions: [] }, "error");
          setStatus("error", { count: 0, cached: false, error: message });
        }
        return null;
      } finally {
        clearTimeout(timeout);
        requestInFlight = null;
      }
    })();

    return requestInFlight;
  }

  let metaRequestInFlight = null;
  async function checkPublishedRevision() {
    if (metaRequestInFlight || document.visibilityState === "hidden") return metaRequestInFlight;
    metaRequestInFlight = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(BANK_META_URL, {
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const meta = await response.json();
        const currentRevision = String(window.UMP_LEARNING_DATA?.revision || "");
        const currentCount = Number(window.UMP_LEARNING_DATA?.questions?.length || 0);
        if (String(meta.revision || "") !== currentRevision || Number(meta.count || 0) !== currentCount) {
          console.log(`[Published Bank] New revision detected: ${currentRevision} -> ${meta.revision}`);
          await fetchPublishedBank({ force: true });
        }
      } catch (error) {
        // Polling is best-effort. The full-bank loader owns user-visible errors.
        console.debug("[Published Bank] Revision check skipped:", error?.message || error);
      } finally {
        clearTimeout(timeout);
        metaRequestInFlight = null;
      }
    })();
    return metaRequestInFlight;
  }

  window.UMP_REFRESH_LIVE_BANK = function () {
    localStorage.removeItem(CACHE_KEY);
    return fetchPublishedBank({ force: true });
  };
  window.UMP_CLEAR_LIVE_CACHE = function () {
    localStorage.removeItem(CACHE_KEY);
    console.log("[Published Bank] Cache cleared");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => fetchPublishedBank());
  } else {
    fetchPublishedBank();
  }

  let lastMcqRefresh = 0;
  function refreshOnMcqNavigation() {
    if (!location.hash.includes("mcq") || Date.now() - lastMcqRefresh < 3_000) return;
    lastMcqRefresh = Date.now();
    checkPublishedRevision();
  }
  window.addEventListener("hashchange", refreshOnMcqNavigation);
  window.addEventListener("focus", refreshOnMcqNavigation);

  // While the MCQ screen is open, poll only the tiny revision endpoint. The
  // multi-megabyte question bank is downloaded again only after a publish.
  setInterval(() => {
    if (location.hash.includes("mcq")) checkPublishedRevision();
  }, REVISION_POLL_MS);
})();
