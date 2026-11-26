// Live Quiz "Coming Soon" entry — contract test.
//
// The teaser is deliberately dumb (static markup, no backend), so the things
// that can actually break are wiring ones: a sidebar tab that points at a view
// the router does not know, a view with no template, a Coming-Soon screen that
// quietly starts calling the API, or a half-finished version bump. All four are
// asserted here against the real files the app ships.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const html = read("index.html");
const app = read("app.js");
const sw = read("service-worker.js");

test("every sidebar tab resolves to a title, a template and a renderer", () => {
  const views = [...html.matchAll(/<a[^>]*class="nav-item[^"]*"[^>]*data-view="([a-z]+)"/g)].map(m => m[1]);
  assert.ok(views.length >= 14, `expected at least 14 nav tabs, found ${views.length}`);
  for (const v of views) {
    const titled = new RegExp(`\\n\\s*${v}:\\s*"`).test(app);
    assert.ok(titled, `app.js VIEW_TITLES is missing "${v}"`);
    if (v !== "dashboard") {
      assert.ok(html.includes(`id="tpl-${v}"`), `index.html is missing template tpl-${v}`);
    }
    const wired = new RegExp(`\\b${v}:\\s*render`).test(app);
    assert.ok(wired, `router map in app.js has no renderer for "${v}"`);
  }
  assert.ok(views.includes("livequiz"), "the Live Quiz tab must be in the sidebar");
});

test("the Live Quiz tab is labelled Coming Soon, never live", () => {
  const tab = html.match(/<a[^>]*data-view="livequiz"[\s\S]*?<\/a>/);
  assert.ok(tab, "livequiz nav item not found");
  assert.match(tab[0], /data-soon="1"/, 'livequiz tab must carry data-soon="1"');
  assert.match(tab[0], /class="nav-soon">SOON</, "livequiz tab must show the SOON chip");

  assert.match(app, /const LIVE_QUIZ_ENABLED = false;/,
    "LIVE_QUIZ_ENABLED must stay false until the quiz backend ships");

  const tpl = html.match(/<template id="tpl-livequiz">[\s\S]*?<\/template>/);
  assert.ok(tpl, "tpl-livequiz missing");
  const view = tpl[0];
  assert.match(view, /data-testid="livequiz-status">COMING SOON</, "status tag must read COMING SOON");
  assert.match(view, /class="lqsoon-banner"/, "the view must be the single Coming Soon banner");

  // Owner's call: announcement only. A sneak peek of the lobby is NOT shown.
  for (const banned of ["lqsoon-preview", "lqsoon-stage", "DESIGN PREVIEW", "lqsoon-rail",
                        "lqsoon-cd", "Join Quiz", "04:36", "180 students"]) {
    assert.ok(!view.includes(banned),
      `the Coming Soon view must not contain "${banned}" - banner only, no preview, no mock data`);
  }
  assert.doesNotMatch(view, /<form|<input|<select|onclick=/,
    "the teaser must stay inert: no form fields, no inline handlers");
  assert.doesNotMatch(view, /<a [^>]*href="\/api/, "the teaser must not link at the API");
});

test("the banner says only 'Daily Live Quiz' + 'COMING SOON' — English, no time, no schedule", () => {
  // Comments are for the developer, not the student: strip them so the copy
  // guards below look at rendered text only.
  const view = html.match(/<template id="tpl-livequiz">[\s\S]*?<\/template>/)[0]
    .replace(/<!--[\s\S]*?-->/g, "");
  const banner = view.match(/<div class="lqsoon-banner"[\s\S]*?\n    <\/div>/)[0];

  assert.match(banner, /<h2>Daily Live Quiz<\/h2>/, "title must read exactly 'Daily Live Quiz'");
  assert.match(banner, /data-testid="livequiz-status">COMING SOON<\/span>/, "tag must read COMING SOON");
  // Owner (2026-11-26): remove the 8 PM line — the banner must carry no subtitle.
  assert.ok(!/<p[ >]/.test(banner), "the banner must not carry a subtitle line at all");
  assert.ok(!/<li|<ul|<table/.test(banner), "the banner must not carry lists or rows");

  // No clock time, no schedule, no durations — anywhere in the view.
  assert.doesNotMatch(view, /\d{1,2}:\d{2}\s*(AM|PM|IST)/i, "no start time in the Coming Soon view");
  assert.doesNotMatch(view, /\b(tonight|daily at|schedule|countdown|\d+\s?(min|mins|minutes|questions?))\b/i,
    "no schedule, countdown or duration claims in the Coming Soon view");

  // English only — the owner has asked for English copy throughout.
  const devanagari = view.match(/[\u0900-\u097F]/g);
  assert.deepEqual(devanagari || [], [], "no Devanagari in the shipped view");
  for (const hin of ["Roz", "shaam", "yahin", "yahan", "karne", "bhi", "mat", "diya", "hoga", "tareeka", "Din"]) {
    assert.ok(!new RegExp(`\\b${hin}\\b`).test(view), `Hinglish copy left in the banner: "${hin}"`);
  }
});

test("the Coming Soon renderer performs no network work", () => {
  const fn = app.match(/function renderLiveQuiz\(\)\s*\{[\s\S]*?\n  \}\n/);
  assert.ok(fn, "renderLiveQuiz() not found");
  const body = fn[0];
  for (const forbidden of ["fetch(", "api.", "XMLHttpRequest", "EventSource", "setInterval"]) {
    assert.ok(!body.includes(forbidden),
      `renderLiveQuiz must not touch the network or run timers, found "${forbidden}"`);
  }
  assert.match(body, /LIVE_QUIZ_ENABLED && window\.UMP_LIVE_QUIZ/,
    "live mode must require BOTH the flag and a mounted live module");
});

test("the teaser is styled only from Midnight tokens", () => {
  const layer = read("midnight.css");
  const block = layer.match(/21 · LIVE QUIZ — COMING SOON[\s\S]*?(?=\n?\/\* =+\n|$)/);
  assert.ok(block, "the Live Quiz section of midnight.css is missing");
  const css = block[0];
  const rawHex = [...css.matchAll(/#[0-9A-Fa-f]{3,6}\b/g)].map(m => m[0]);
  assert.deepEqual(rawHex, [], `midnight.css Live Quiz block hardcodes colours: ${rawHex.join(", ")}`);
  assert.ok(/\.lqsoon-banner\s*\{[^}]*border:\s*1px solid var\(--amber-line\)/.test(css),
    "the banner must carry the amber not-yet treatment");
  for (const gone of ["lqsoon-preview", "lqsoon-watermark", "lqsoon-rail", "lqsoon-cd"]) {
    assert.ok(!css.includes(gone), `midnight.css must not keep dead "${gone}" styles from the removed preview`);
  }
});

test("one version string across html, app and service worker", () => {
  const appVer = app.match(/const APP_VERSION = "([^"]+)"/)[1];
  const swVer = sw.match(/const CACHE_VERSION = "([^"]+)"/)[1];
  assert.equal(swVer, appVer, "service worker CACHE_VERSION must match APP_VERSION");
  const assetVers = [...html.matchAll(/[?&]v=([^"'&]+)/g)].map(m => m[1]);
  assert.ok(assetVers.length >= 13, `expected 13+ cache-busted assets, found ${assetVers.length}`);
  for (const v of assetVers) assert.equal(v, appVer, "index.html still references a stale asset version");
});
