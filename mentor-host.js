/**
 * Single source of truth for the mentor API host.
 *
 * This used to be hardcoded in three separate files, all pointing at two Render
 * services. Both of those are gone (they answer 503), so every one of those
 * copies silently fell back to the small preview bank bundled in
 * learning-data.js and students never saw the published questions.
 *
 * Resolution order:
 *   1. an explicit override in localStorage (support / staging)
 *   2. a host cached by a previous successful probe
 *   3. the live deployment
 *
 * A background probe re-checks every candidate and re-points the cache if the
 * live host ever stops answering, so a future move does not need a code change.
 * The probe never blocks: callers get a usable host synchronously.
 */
(function () {
  "use strict";

  var LIVE_HOST = "https://ump-mentor-api.vercel.app";
  // Render hosts are suspended (503). Do not probe them.
  var CANDIDATES = [LIVE_HOST];
  var PROBE_PATH = "/api/content/student/bank-meta.json";
  var CACHE_KEY = "ump_mentor_host_v2";
  var OVERRIDE_KEY = "ump_mentor_api_url";
  var PROBE_INTERVAL_MS = 5 * 60 * 1000;

  function read(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch (_) {
      return "";
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      /* private mode: the cache is an optimisation, never a requirement */
    }
  }

  function trim(host) {
    return String(host || "").replace(/\/+$/, "");
  }

  /** Synchronous, always returns a usable host. */
  function current() {
    var override = trim(read(OVERRIDE_KEY));
    if (override) return override;
    return trim(read(CACHE_KEY)) || LIVE_HOST;
  }

  function probe(host) {
    return new Promise(function (resolve) {
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 12000) : null;
      var done = function (count) {
        if (timer) clearTimeout(timer);
        resolve(count);
      };
      try {
        fetch(trim(host) + PROBE_PATH, {
          signal: controller ? controller.signal : undefined,
          headers: { Accept: "application/json", "Cache-Control": "no-cache" }
        })
          .then(function (response) {
            if (!response.ok) return done(-1);
            return response.json().then(function (meta) {
              done(Number((meta && meta.count) || 0));
            });
          })
          .catch(function () { done(-1); });
      } catch (_) {
        done(-1);
      }
    });
  }

  function verifyHost() {
    var previous = current();
    return Promise.all(CANDIDATES.map(function (host) {
      return probe(host).then(function (count) {
        return { host: trim(host), count: count };
      });
    })).then(function (results) {
      var best = results.reduce(function (win, row) {
        return row.count > win.count ? row : win;
      }, results[0]);

      if (best && best.count > 0) {
        write(CACHE_KEY, best.host);
        if (best.host !== previous) {
          window.dispatchEvent(new CustomEvent("ump:mentor-host-change", {
            detail: { host: best.host, previous: previous, count: best.count }
          }));
        }
        window.UMP_MENTOR_HOST_STATUS = {
          host: best.host,
          count: best.count,
          checkedAt: Date.now(),
          candidates: results
        };
        return best.host;
      }

      // Nothing answered. Keep whatever we had so a transient outage does not
      // destroy a working configuration.
      window.UMP_MENTOR_HOST_STATUS = {
        host: previous,
        count: 0,
        checkedAt: Date.now(),
        candidates: results
      };
      return previous;
    });
  }

  window.UMP_MENTOR_API_URL = current;
  window.UMP_MENTOR_API_HOSTS = CANDIDATES.slice();
  window.UMP_MENTOR_VERIFY_HOST = verifyHost;

  // Publish immediately so scripts running later in the same tick see it.
  var initial = current();
  window.MENTOR_API_URL = initial;

  var lastProbe = 0;
  function backgroundVerify() {
    if (Date.now() - lastProbe < PROBE_INTERVAL_MS) return;
    lastProbe = Date.now();
    verifyHost();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", backgroundVerify);
  } else {
    backgroundVerify();
  }
})();
