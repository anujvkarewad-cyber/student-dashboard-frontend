#!/usr/bin/env node
/* CA Inter Chapter MCQ Generator — single file, zero dependencies.
 * 30 plain MCQs + 5 scenarios x 4 linked per official ICAI chapter (94).
 * Gemini only, 1 chapter = 1 request. Resumable + quarantine + review exports.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");
const CAT = path.join(REPO, "mobile", "src", "data", "icaiChapterCatalog.ts");
const CFG = path.join(ROOT, "config", "chapters.json");
const STATE = path.join(ROOT, "state", "generation-progress.json");
const FAIL = path.join(ROOT, "state", "failed-chapters.json");
const LOG = path.join(ROOT, "state", "generation.log");
const GEN = path.join(ROOT, "generated");
const REV = path.join(ROOT, "review");
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DELAY = Number(process.env.GEN_REQUEST_DELAY_MS || 4000);
const VMAX = Number(process.env.GEN_MAX_VALIDATION_RETRIES || 3);
const AMAX = Number(process.env.GEN_MAX_API_RETRIES || 6);
const SLUG = { Accounts: "accounts", Law: "law", Taxation: "taxation", Costing: "costing", Audit: "audit", FM: "fm", SM: "sm" };
const REVISION = "icai-chapter-bank-v1";

function log(msg) {
  const line = `[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${msg}`;
  console.log(line);
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + "\n"); } catch (e) {}
}
function load(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return fb; } }
function save(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function loadDotEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  for (const raw of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i < 1) continue;
    const k = l.slice(0, i).trim();
    const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}
function between(src, m, e) {
  const s = src.indexOf(m);
  if (s < 0) throw new Error("marker missing: " + m);
  return src.slice(s + m.length, src.indexOf(e, s + m.length)).trim().replace(/;$/, "");
}
function deriveCatalog() {
  const src = fs.readFileSync(CAT, "utf8");
  const groups = Function(`"use strict";return (${between(src, "const chapterGroups: ChapterGroup[] = ", "\n\nexport const officialMcqChapterCatalog")});`)();
  const chapters = [];
  groups.forEach((g) => g.chapters.forEach(([n, t]) => chapters.push({ id: g.idPrefix + "-" + n, subject: g.subject, paper: g.paper, section: g.section, part: g.part, module: g.module, chapterNumber: n, title: t, sourceUrl: g.sourceUrl })));
  chapters.forEach((c, i) => (c.catalogOrder = i));
  if (new Set(chapters.map((c) => c.id)).size !== chapters.length) throw new Error("duplicate chapter ids");
  return chapters;
}
function loadChapters() {
  const canonical = fs.existsSync(CAT) ? deriveCatalog() : null;
  let snapshot = load(CFG, { chapters: [] }).chapters || [];
  if (canonical) {
    const norm = (arr) => JSON.stringify(arr.map((c) => ({ id: c.id, subject: c.subject, paper: c.paper, module: c.module, chapterNumber: c.chapterNumber, title: c.title })).sort((a, b) => a.id.localeCompare(b.id)));
    if (norm(snapshot) !== norm(canonical)) {
      snapshot = canonical;
      save(CFG, { revision: "icai-may-2026-v1", source: "mobile/src/data/icaiChapterCatalog.ts", generatedAt: new Date().toISOString(), chapters: snapshot });
      log(`config/chapters.json auto-regenerated from the official catalog (${snapshot.length} chapters).`);
    }
  }
  if (!snapshot.length) throw new Error("catalog empty");
  return snapshot;
}

function promptFor(ch, feedback) {
  const out = [
    "You are an expert CA (Chartered Accountancy) exam content creator for ICAI CA Intermediate (New Scheme), September 2026 attempt.",
    "Create ORIGINAL practice MCQs (never reproduce ICAI copyrighted questions). Facts and rules must match the official ICAI BoS May 2026 study material for this chapter.",
    "",
    `Chapter: ${ch.paper} · ${ch.module}${ch.section ? " · " + ch.section : ""} · Chapter ${ch.chapterNumber}: ${ch.title} (subject: ${ch.subject})`,
    "",
    'Return ONE JSON object: {"plain": [ ...exactly 30 MCQs... ], "scenarios": [ ...exactly 5 scenarios... ]}.',
    "Each scenario: {\"passage\": \"self-contained fact pattern\", \"linkedMcqs\": [ ...exactly 4 MCQs based on the passage... ]}.",
    "",
    "Every MCQ object (plain AND linked) must have:",
    '- "prompt": one clear question.',
    '- "options": exactly 4 plausible strings, only one correct.',
    '- "answerIndex": 0-3 (index of correct option).',
    '- "explanation": 2-4 sentences naming the concept/rule/standard and why the option is right.',
    '- "difficulty": "Easy" | "Medium" | "Hard" (plain: ~10 Easy, ~12 Medium, ~8 Hard; scenario-linked: Medium or Hard).',
    '- "conceptTags": 2-4 short tags.',
    "",
    "Rules: questions test THIS chapter only; distinct plausible options; avoid all-of-the-above unless required; return ONLY the JSON (no markdown, no comments).",
  ];
  if (feedback) out.push("", "PREVIOUS RESPONSE REJECTED. Fix these validation errors and return corrected JSON:", feedback);
  return out.join("\n");
}
const SCHEMA = {
  type: "OBJECT",
  properties: {
    plain: { type: "ARRAY", minItems: 30, maxItems: 30, items: {
      type: "OBJECT",
      properties: { prompt: { type: "STRING" }, options: { type: "ARRAY", minItems: 4, maxItems: 4, items: { type: "STRING" } }, answerIndex: { type: "INTEGER" }, explanation: { type: "STRING" }, difficulty: { type: "STRING" }, conceptTags: { type: "ARRAY", items: { type: "STRING" } } },
      required: ["prompt", "options", "answerIndex", "explanation", "difficulty", "conceptTags"],
    } },
    scenarios: { type: "ARRAY", minItems: 5, maxItems: 5, items: {
      type: "OBJECT",
      properties: { passage: { type: "STRING" }, linkedMcqs: { type: "ARRAY", minItems: 4, maxItems: 4, items: {
        type: "OBJECT",
        properties: { prompt: { type: "STRING" }, options: { type: "ARRAY", minItems: 4, maxItems: 4, items: { type: "STRING" } }, answerIndex: { type: "INTEGER" }, explanation: { type: "STRING" }, difficulty: { type: "STRING" }, conceptTags: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["prompt", "options", "answerIndex", "explanation", "difficulty", "conceptTags"],
      } } },
      required: ["passage", "linkedMcqs"],
    } },
  },
  required: ["plain", "scenarios"],
};
async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 65536, responseMimeType: "application/json", responseSchema: SCHEMA } }), signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  const cand = data && data.candidates && data.candidates[0];
  if (!cand || !cand.content || !Array.isArray(cand.content.parts) || !cand.content.parts.length) throw new Error(`no candidates (finish: ${cand && cand.finishReason})`);
  const text = cand.content.parts.map((p) => p.text || "").join("");
  if (!text.trim()) throw new Error("empty response");
  try { return JSON.parse(text); } catch (e) { throw new Error(`non-JSON: ${text.slice(0, 120)}`); }
}
function mockGen(ch, fail) {
  const stub = (t) => ({ prompt: `${t}: original practice question for ${ch.title}.`, options: [`${t} A`, `${t} B`, `${t} C`, `${t} D`], answerIndex: 0, explanation: `${t}: explanation covering the concept, rule and why the chosen option is correct for ${ch.title}, in enough detail.`, difficulty: "Medium", conceptTags: [ch.title.slice(0, 20), "mock"] });
  const plain = Array.from({ length: 30 }, (_, i) => stub("Q" + String(i + 1).padStart(2, "0")));
  const scenarios = Array.from({ length: 5 }, (_, si) => ({ passage: `Scenario ${si + 1} fact pattern for ${ch.title}. A student-friendly original case situation with facts, figures and context to test application of concepts from this chapter.`, linkedMcqs: Array.from({ length: 4 }, (_, mi) => stub(`S${si + 1}Q${mi + 1}`)) }));
  if (fail) { plain.pop(); scenarios[0].linkedMcqs[0].options = ["a", "b", "c"]; }
  return { plain, scenarios };
}
function validate(p, ch) {
  const errs = [];
  if (!p || typeof p !== "object") return { ok: false, errors: ["not an object"] };
  const seen = new Set();
  const chk = (q, label) => {
    if (!q || typeof q !== "object") return errs.push(`${label}: missing`);
    if (typeof q.prompt !== "string" || q.prompt.trim().length < 8) errs.push(`${label}: prompt`);
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((o) => typeof o !== "string" || !o.trim())) errs.push(`${label}: options`);
    else if (new Set(q.options.map((o) => o.trim().toLowerCase())).size < 4) errs.push(`${label}: options not distinct`);
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) errs.push(`${label}: answerIndex`);
    if (typeof q.explanation !== "string" || q.explanation.trim().length < 40) errs.push(`${label}: explanation`);
    if (!["Easy", "Medium", "Hard"].includes(q.difficulty)) errs.push(`${label}: difficulty`);
    if (!Array.isArray(q.conceptTags) || !q.conceptTags.length || q.conceptTags.some((t) => typeof t !== "string" || !t.trim())) errs.push(`${label}: conceptTags`);
    const n = String(q.prompt || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    if (seen.has(n)) errs.push(`${label}: duplicate prompt`); else seen.add(n);
  };
  if (!Array.isArray(p.plain) || p.plain.length !== 30) errs.push(`plain: need 30, got ${Array.isArray(p.plain) ? p.plain.length : 0}`);
  if (!Array.isArray(p.scenarios) || p.scenarios.length !== 5) errs.push(`scenarios: need 5, got ${Array.isArray(p.scenarios) ? p.scenarios.length : 0}`);
  (p.plain || []).forEach((q, i) => chk(q, `plain[${i + 1}]`));
  (p.scenarios || []).forEach((s, si) => {
    if (!s || typeof s.passage !== "string" || s.passage.trim().length < 40) errs.push(`scenarios[${si + 1}]: passage`);
    const l = s && Array.isArray(s.linkedMcqs) ? s.linkedMcqs : [];
    if (l.length !== 4) errs.push(`scenarios[${si + 1}]: need 4 linked, got ${l.length}`);
    l.forEach((q, mi) => chk(q, `S${si + 1}Q${mi + 1}`));
  });
  return { ok: !errs.length, errors: errs };
}
const pad = (v, w) => String(v).padStart(w, "0");
function normalize(p, ch) {
  const ref = { paper: ch.paper, module: ch.module, chapterNumber: ch.chapterNumber, chapterTitle: ch.title };
  const q = (x) => ({ prompt: x.prompt.trim(), options: x.options.map((o) => o.trim()), answerIndex: x.answerIndex, explanation: x.explanation.trim(), difficulty: x.difficulty, conceptTags: x.conceptTags.map((t) => String(t).trim()).filter(Boolean) });
  const plain = p.plain.map((x, i) => ({ id: `adp_q_${ch.id}_${pad(i + 1, 3)}`, kind: "normal", chapterId: ch.id, subject: ch.subject, ...q(x), sourceRef: ref, status: "needs_review" }));
  const scenarios = p.scenarios.map((s, si) => ({ id: `adp_s_${ch.id}_${pad(si + 1, 2)}`, kind: "scenario", chapterId: ch.id, subject: ch.subject, passage: s.passage.trim(), sourceRef: ref, status: "needs_review", linkedMcqs: s.linkedMcqs.map((x, mi) => ({ id: `adp_q_${ch.id}_${pad(si + 1, 2)}${mi + 1}`, kind: "scenario", scenarioId: `adp_s_${ch.id}_${pad(si + 1, 2)}`, sequenceInScenario: mi + 1, chapterId: ch.id, subject: ch.subject, ...q(x), status: "needs_review" })) }));
  const linked = scenarios.reduce((n, s) => n + s.linkedMcqs.length, 0);
  return { schemaVersion: "1.0.0", bankRevision: REVISION, chapterId: ch.id, subject: ch.subject, paper: ch.paper, module: ch.module, chapterNumber: ch.chapterNumber, chapterTitle: ch.title, generatedAt: new Date().toISOString(), model: MODEL, status: "needs_review", counts: { plain: plain.length, scenarios: scenarios.length, linkedMcqs: linked, total: plain.length + linked }, plain, scenarios };
}
function loadState() {
  const s = load(STATE, { completed: [], quarantined: {} });
  if (!Array.isArray(s.completed)) s.completed = [];
  if (!s.quarantined || typeof s.quarantined !== "object") s.quarantined = {};
  return s;
}
async function generateOne(ch, opts) {
  const t0 = Date.now();
  let feedback = "";
  for (let attempt = 1; attempt <= VMAX; attempt++) {
    let payload;
    for (let a = 1; ; a++) {
      try { payload = opts.mock ? await (async () => { await sleep(20); return mockGen(ch, opts.mockFail.includes(ch.id)); })() : await callGemini(promptFor(ch, feedback)); break; }
      catch (e) {
        const m = (e && e.message || String(e)).slice(0, 160);
        if (a >= AMAX) throw new Error(`provider failed x${a}: ${m}`);
        log(`  ${ch.id} provider retry ${a}/${AMAX}: ${m}`);
        await sleep(Math.min(60000, 2000 * 2 ** a));
      }
    }
    const v = validate(payload, ch);
    if (v.ok) {
      const file = path.join(GEN, SLUG[ch.subject] || String(ch.subject).toLowerCase(), `${ch.id}.json`);
      const doc = normalize(payload, ch);
      save(file, doc);
      log(`OK ${ch.id} (attempt ${attempt}) 30 plain + 5x4 linked -> ${path.relative(ROOT, file)} (${Math.round((Date.now() - t0) / 1000)}s)`);
      return { status: "completed" };
    }
    feedback = `Validation errors:\n${v.errors.slice(0, 12).map((e) => "- " + e).join("\n")}`;
    log(`  ${ch.id} validation fail ${attempt}/${VMAX}: ${v.errors.slice(0, 4).join(" | ")}`);
  }
  return { status: "quarantined", attempts: VMAX, reason: feedback.slice(0, 600) };
}
function csvEsc(v) { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function buildReview() {
  fs.mkdirSync(REV, { recursive: true });
  const rows = [];
  for (const ch of loadChapters()) {
    const f = path.join(GEN, SLUG[ch.subject] || String(ch.subject).toLowerCase(), `${ch.id}.json`);
    if (!fs.existsSync(f)) continue;
    const d = load(f, null);
    if (!d) continue;
    const push = (x, sid) => rows.push([ch.id, ch.subject, ch.paper, ch.module, ch.chapterNumber, ch.chapterTitle, x.id, x.kind, sid || "", x.prompt, x.options[0], x.options[1], x.options[2], x.options[3], x.answerIndex, x.options[x.answerIndex], x.explanation, x.difficulty, (x.conceptTags || []).join(" | "), x.status || "needs_review"]);
    (d.plain || []).forEach((x) => push(x, ""));
    (d.scenarios || []).forEach((s) => { rows.push([ch.id, ch.subject, ch.paper, ch.module, ch.chapterNumber, ch.chapterTitle, s.id, "scenario-passage", "", `CASE SCENARIO: ${s.passage}`, "", "", "", "", "", "", "", "", "", "needs_review"]); (s.linkedMcqs || []).forEach((x) => push(x, s.id)); });
  }
  const H = ["chapterId", "subject", "paper", "module", "chapterNumber", "chapterTitle", "questionId", "kind", "scenarioId", "prompt", "optionA", "optionB", "optionC", "optionD", "answerIndex", "answerText", "explanation", "difficulty", "conceptTags", "status"];
  fs.writeFileSync(path.join(REV, "review-queue.csv"), "\uFEFF" + [H.join(","), ...rows.map((r) => r.map(csvEsc).join(","))].join("\n"));
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const byChapter = {};
  rows.forEach((r) => { (byChapter[r[0]] = byChapter[r[0]] || []).push(r); });
  const html = ["<!DOCTYPE html><html><head><meta charset='utf-8'><title>MCQ Review Queue</title><style>body{font-family:Georgia,serif;background:#f4f6fb;color:#1c2b4a;padding:24px}h1{font-size:22px}.ch{background:#fff;border:1px solid #dde4f2;border-radius:12px;padding:16px;margin-bottom:16px}.ch h2{font-size:15px;margin:0 0 4px}.ch .sub{color:#5b6b8c;font-size:12px}.q{border-top:1px solid #eef1f8;padding:10px 0}.q .p{font-weight:bold}.opt{margin-left:14px}.opt.ok{color:#0d7a52;font-weight:bold}.expl{font-size:12.5px;color:#44557a;background:#f2f6ff;border-radius:8px;padding:8px;margin-top:6px}.scen{background:#fbf7ff;border:1px solid #e7dcf7;border-radius:10px;padding:10px;margin:10px 0;font-style:italic}.tag{font-size:10px;font-weight:bold;background:#e8edfb;color:#3157d5;border-radius:999px;padding:2px 8px}</style></head><body><h1>MCQ Mentor Review Queue</h1>"];
  for (const [cid, rs] of Object.entries(byChapter)) {
    const r0 = rs[0];
    html.push(`<div class='ch'><h2>${esc(r0[2])} · ${esc(r0[3])} · Chapter ${r0[4]}: ${esc(r0[5])}</h2><div class='sub'>${esc(r0[1])} — ${rs.length} rows</div>`);
    for (const r of rs) {
      if (r[7] === "scenario-passage") { html.push(`<div class='scen'>CASE SCENARIO: ${esc(r[9].replace("CASE SCENARIO: ", ""))}</div>`); continue; }
      const letters = ["A", "B", "C", "D"];
      html.push(`<div class='q'><span class='tag'>${esc(r[17])}</span> ${esc(r[7].toUpperCase())} · ${esc(r[18])}<div class='p'>${esc(r[9])}</div>${[0, 1, 2, 3].map((i) => `<div class='opt${i === r[14] ? " ok" : ""}'>${letters[i]}. ${esc(r[10 + i])}${i === r[14] ? " ✔" : ""}</div>`).join("")}<div class='expl'><b>Explanation:</b> ${esc(r[16])}</div></div>`);
    }
    html.push("</div>");
  }
  html.push("</body></html>");
  fs.writeFileSync(path.join(REV, "review-queue.html"), html.join(""));
  log(`Review queue written: review-queue.csv (${rows.length} rows) + review-queue.html (${Object.keys(byChapter).length} chapters).`);
}
async function main() {
  loadDotEnv();
  const argv = process.argv.slice(2);
  const opts = { dry: argv.includes("--dry-run"), mock: argv.includes("--mock"), mockFail: [], chapter: null, limit: 0 };
  for (const a of argv) {
    if (a.startsWith("--mock-fail=")) opts.mockFail = a.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (a.startsWith("--chapter=")) opts.chapter = a.split("=")[1].trim();
    if (a.startsWith("--limit=")) opts.limit = Number(a.split("=")[1]) || 0;
  }
  if (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== "gemini") throw new Error("only gemini supported");
  const chapters = loadChapters();
  log(`Catalog OK: ${chapters.length} chapters. Provider: ${opts.mock ? "MOCK" : "gemini/" + MODEL}`);
  const state = loadState();
  const pending = chapters.filter((c) => !state.completed.includes(c.id) && !state.quarantined[c.id]);
  const sel = opts.chapter ? pending.filter((c) => c.id === opts.chapter) : opts.limit ? pending.slice(0, opts.limit) : pending;
  if (!sel.length) { log("Nothing pending."); if (!opts.dry) buildReview(); return; }
  log(`Plan: ${sel.length} pending (completed ${state.completed.length}, quarantined ${Object.keys(state.quarantined).length}).`);
  if (opts.dry) { sel.forEach((c, i) => log(`  ${i + 1}. ${c.id}`)); return; }
  const fails = [];
  const base = state.completed.length;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    log(`[${base + i + 1}/${chapters.length}] ${c.id} (${c.subject})`);
    try {
      const r = await generateOne(c, opts);
      if (r.status === "completed") state.completed.push(c.id);
      else { state.quarantined[c.id] = { attempts: r.attempts, reason: r.reason, at: new Date().toISOString() }; fails.push({ chapterId: c.id, subject: c.subject, paper: c.paper, module: c.module, chapterNumber: c.chapterNumber, chapterTitle: c.title, attempts: r.attempts, reason: r.reason, at: new Date().toISOString() }); }
    } catch (e) {
      const m = (e && e.message || String(e)).slice(0, 400);
      state.quarantined[c.id] = { attempts: AMAX, reason: m, at: new Date().toISOString() };
      fails.push({ chapterId: c.id, subject: c.subject, paper: c.paper, module: c.module, chapterNumber: c.chapterNumber, chapterTitle: c.title, attempts: AMAX, reason: m, at: new Date().toISOString() });
      log(`QUARANTINE ${c.id}: ${m}`);
    }
    save(STATE, { ...state, updatedAt: new Date().toISOString() });
    if (fails.length) save(FAIL, fails);
    if (!opts.mock && i < sel.length - 1) await sleep(DELAY);
  }
  log(`SUMMARY: completed ${state.completed.length}/${chapters.length}, quarantined ${Object.keys(state.quarantined).length}.`);
  buildReview();
  if (fails.length) process.exitCode = 1;
}
main().catch((e) => { log("FATAL: " + (e && e.message || e)); process.exit(2); });
