#!/usr/bin/env node
/**
 * Web workflow tests for the APK-parity Focus Room, Study Receipt, Daily MCQ
 * and Unlimited MCQ Practice flows.
 *
 * Loads the generated web data bundle (learning-data.js) and the learning
 * tools runtime (learning-tools.js) in a sandboxed VM, then asserts the rules
 * that must stay identical between the APK (mobile/src) and the web client:
 *  - data bundle integrity (canonical ICAI chapter mapping, difficulties, kinds)
 *  - deterministic daily questions (date + Student ID + group) with 7 normal + 3 case-study
 *  - per-group daily streaks
 *  - adaptive Study Receipt question sets per session type
 *  - unlimited practice filtering
 *
 * Exits non-zero on the first failed assertion so it can gate CI/deploys.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const DAY_MS = 24 * 60 * 60 * 1000;

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`\n✗ FAILED: ${name}`);
    console.error(`  ${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
    throw error;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const assertDeepEqual = (actual, expected, message) => {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message} — expected ${right}, got ${left}`);
};

// ---------------------------------------------------------------------------
// Sandbox: browser-like globals, localStorage backed by a Map.
// ---------------------------------------------------------------------------
const storage = new Map();
const localStorageStub = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Map,
  Set,
  Array,
  Object,
  String,
  Number,
  Boolean,
  parseInt,
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  localStorage: localStorageStub,
  navigator: { wakeLock: undefined },
  document: { visibilityState: "hidden", addEventListener: () => undefined },
};
sandbox.window = sandbox;
vm.createContext(sandbox);

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
vm.runInContext(read("learning-data.js"), sandbox, { filename: "learning-data.js" });
vm.runInContext(read("learning-tools.js"), sandbox, { filename: "learning-tools.js" });

const parity = sandbox.UMP_LEARNING_TOOLS && sandbox.UMP_LEARNING_TOOLS.parity;
assert(parity, "learning-tools.js did not expose the parity API");

const questions = parity.questions();
const chapters = parity.chapters();
const manifest = parity.manifest();
const questionById = new Map(questions.map((question) => [question.id, question]));

const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
console.log("\n1. Web data bundle (generated from APK sources)");
// ---------------------------------------------------------------------------
test("bundle revision is the canonical MCQ bank revision", () => {
  assertEqual(parity.revision(), "icai-may-2026-v1", "bundle revision");
  assertEqual(manifest.targetAttempt, "September 2026", "ICAI content manifest target attempt");
});

test("bundle carries the APK question bank and full chapter catalogue", () => {
  assert(questions.length >= 40, `expected at least 40 questions, got ${questions.length}`);
  assert(chapters.length >= 90, `expected at least 90 official chapters, got ${chapters.length}`);
});

test("an asynchronously fetched published bank replaces the captured runtime bank", () => {
  const original = sandbox.UMP_LEARNING_DATA;
  const replacement = { ...original, revision: "published-r9", questions: [questions[0]] };
  assert(sandbox.UMP_LEARNING_TOOLS.replaceLearningData(replacement), "runtime rejected the replacement bank");
  assertEqual(parity.revision(), "published-r9", "runtime revision after replacement");
  assertEqual(parity.questions().length, 1, "runtime question count after replacement");
  sandbox.UMP_LEARNING_TOOLS.replaceLearningData(original);
  assertEqual(parity.questions().length, questions.length, "runtime bank restore");
});

test("every question is fully mapped and well-formed", () => {
  const subjects = ["Accounts", "Law", "Taxation", "Costing", "Audit", "FM", "SM"];
  const difficulties = ["Easy", "Medium", "Hard"];
  for (const question of questions) {
    assert(subjects.includes(question.subject), `Q${question.id}: unknown subject ${question.subject}`);
    assert(Array.isArray(question.options) && question.options.length === 4, `Q${question.id}: needs 4 options`);
    assert(question.options.every((option) => String(option).trim().length > 0), `Q${question.id}: empty option`);
    assert(Number.isInteger(question.answer) && question.answer >= 0 && question.answer <= 3, `Q${question.id}: bad answer index`);
    assert(String(question.explanation).trim().length > 0, `Q${question.id}: missing explanation`);
    assert(difficulties.includes(question.difficulty), `Q${question.id}: bad difficulty ${question.difficulty}`);
    assert(question.kind === "normal" || question.kind === "case-study", `Q${question.id}: bad kind`);
    assert(question.officialChapter && question.officialChapter.paper, `Q${question.id}: missing official chapter mapping`);
    assert(String(question.chapter).length > 0, `Q${question.id}: missing chapter display title`);
  }
});

test("case-study and normal pools match the APK composition", () => {
  const caseStudy = questions.filter((question) => question.kind === "case-study");
  const normal = questions.filter((question) => question.kind !== "case-study");
  assertEqual(caseStudy.length, 12, "case-study question count");
  assertEqual(normal.length, questions.length - 12, "normal question count");
});

test("each group pool has enough normal and case-study questions for a daily paper", () => {
  for (const group of ["Group I", "Group II"]) {
    const pool = questions.filter((question) => parity.subjectGroup(question.subject) === group);
    const normal = pool.filter((question) => question.kind !== "case-study").length;
    const caseStudy = pool.filter((question) => question.kind === "case-study").length;
    assert(normal >= 7, `${group}: needs >= 7 normal, has ${normal}`);
    assert(caseStudy >= 3, `${group}: needs >= 3 case-study, has ${caseStudy}`);
  }
});

// ---------------------------------------------------------------------------
console.log("\n2. Daily MCQ Challenge rules");
// ---------------------------------------------------------------------------
test("daily questions are deterministic for (date, Student ID, group)", () => {
  const first = parity.dailyQuestionIds("2026-08-16", "UMP0001", "Group I");
  const second = parity.dailyQuestionIds("2026-08-16", "UMP0001", "Group I");
  assertDeepEqual(first, second, "same inputs must produce identical papers");
});

test("daily paper has exactly 10 unique questions: 7 normal + 3 case-study", () => {
  const ids = parity.dailyQuestionIds("2026-08-16", "UMP0001", "Group I");
  assertEqual(ids.length, 10, "daily paper size");
  assertEqual(new Set(ids).size, 10, "daily paper must have unique questions");
  const picked = ids.map((id) => questionById.get(id)).filter(Boolean);
  assertEqual(picked.length, 10, "all picked ids must resolve to questions");
  assertEqual(picked.filter((question) => question.kind !== "case-study").length, 7, "normal question count");
  assertEqual(picked.filter((question) => question.kind === "case-study").length, 3, "case-study question count");
});

test("daily paper only contains questions from the selected group", () => {
  for (const group of ["Group I", "Group II"]) {
    const ids = parity.dailyQuestionIds("2026-08-16", "UMP0001", group);
    const picked = ids.map((id) => questionById.get(id));
    assert(picked.every((question) => parity.subjectGroup(question.subject) === group), `${group}: cross-group question leaked in`);
  }
});

test("daily papers differ per group, student and date", () => {
  const base = parity.dailyQuestionIds("2026-08-16", "UMP0001", "Group I");
  const otherGroup = parity.dailyQuestionIds("2026-08-16", "UMP0001", "Group II");
  const otherStudent = parity.dailyQuestionIds("2026-08-16", "UMP0002", "Group I");
  const nextDay = parity.dailyQuestionIds("2026-08-17", "UMP0001", "Group I");
  assert(JSON.stringify(base) !== JSON.stringify(otherGroup), "groups must not share a paper");
  assert(JSON.stringify(base) !== JSON.stringify(otherStudent), "students must not share a paper");
  assert(JSON.stringify(base) !== JSON.stringify(nextDay), "dates must not share a paper");
});

test("daily streaks are counted per group from completed attempts", () => {
  storage.clear();
  const yesterday = localDateKey(new Date(Date.now() - DAY_MS));
  const dayBefore = localDateKey(new Date(Date.now() - 2 * DAY_MS));
  const today = localDateKey();
  storage.set("ump_daily_mcq_guest", JSON.stringify([
    { bankRevision: parity.revision(), date: dayBefore, group: "Group I", completedAt: Date.now() - 2 * DAY_MS },
    { bankRevision: parity.revision(), date: yesterday, group: "Group I", completedAt: Date.now() - DAY_MS },
    { bankRevision: parity.revision(), date: yesterday, group: "Group II", completedAt: Date.now() - DAY_MS },
  ]));
  assertEqual(parity.dailyStreak("Group I"), 2, "Group I streak without today");
  assertEqual(parity.dailyStreak("Group II"), 1, "Group II streak without today");
  storage.set("ump_daily_mcq_guest", JSON.stringify([
    { bankRevision: parity.revision(), date: dayBefore, group: "Group I", completedAt: Date.now() - 2 * DAY_MS },
    { bankRevision: parity.revision(), date: yesterday, group: "Group I", completedAt: Date.now() - DAY_MS },
    { bankRevision: parity.revision(), date: today, group: "Group I", completedAt: Date.now() },
  ]));
  assertEqual(parity.dailyStreak("Group I"), 3, "Group I streak with today");
  assertEqual(parity.dailyStreak("Group II"), 0, "Group II streak stays independent");
  storage.clear();
});

// ---------------------------------------------------------------------------
console.log("\n3. Adaptive Study Receipt questions");
// ---------------------------------------------------------------------------
test("regular subject sessions get 3 subject-specific recall prompts", () => {
  const session = { id: "s-acc", subject: "Accounts", target: "AS 16 and 20 questions" };
  const set = parity.buildRecallQuestions(session);
  assertEqual(set.length, 3, "regular subject prompt count");
  assert(set[0].prompt.includes("Accounts"), "first prompt should name the subject");
  assert(set[0].prompt.includes("AS 16"), "first prompt should name the session target");
  assert(set.every((item) => item.id.startsWith("s-acc:")), "prompt ids must be scoped to the session");
  assert(new Set(set.map((item) => item.id)).size === set.length, "prompt ids must be unique");
});

test("revision sessions get 4 revision-specific prompts with the target", () => {
  const session = { id: "s-rev", subject: "Revision", target: "Costing — marginal costing" };
  const set = parity.buildRecallQuestions(session);
  assertEqual(set.length, 4, "revision prompt count");
  assert(set[0].prompt.includes("marginal costing"), "revision topics prompt should include the target");
  assert(set[1].prompt.includes("recall"), "revision set should ask what was recalled without notes");
  assert(set[2].prompt.includes("revise again"), "revision set should ask which concepts need another revision");
  assert(set[3].prompt.includes("next revision"), "revision set should ask when the next revision is planned");
  assert(!set.some((item) => item.prompt.includes("mock")), "revision set must not contain mock prompts");
});

test("mock test sessions get 5 mock-specific prompts and no generic concept prompt", () => {
  const session = { id: "s-mock", subject: "Mock Test", target: "FM Mock 1" };
  const set = parity.buildRecallQuestions(session);
  assertEqual(set.length, 5, "mock prompt count");
  assert(set[0].prompt.includes("FM Mock 1"), "mock attempt prompt should include the target");
  assert(set.some((item) => item.prompt.includes("questions did you attempt")), "mock set should ask about attempted questions");
  assert(set.some((item) => item.prompt.includes("difficult")), "mock set should ask for the hardest section");
  assert(set.some((item) => item.prompt.includes("time management")), "mock set should ask about time management");
  assert(set.some((item) => item.prompt.includes("next mock")), "mock set should ask about improvements for the next mock");
  assert(!set.some((item) => item.prompt.includes("main concept")), "mock set must not contain generic concept prompts");
});

test("mock sessions without a typed target stay clean", () => {
  const set = parity.buildRecallQuestions({ id: "s-mock2", subject: "Mock Test", target: "" });
  assertEqual(set.length, 5, "mock prompt count without target");
  assert(!set[0].prompt.includes("for “"), "no dangling target suffix when target is empty");
});

test("session kind detection matches APK rules", () => {
  assertEqual(parity.recallSessionKind({ subject: "Mock Test" }), "mock", "Mock Test");
  assertEqual(parity.recallSessionKind({ subject: "mock" }), "mock", "lowercase mock");
  assertEqual(parity.recallSessionKind({ subject: "Revision" }), "revision", "Revision");
  assertEqual(parity.recallSessionKind({ subject: "Accounts" }), "subject", "Accounts");
  assertEqual(parity.recallSessionKind({ subject: "FM" }), "subject", "FM");
});

// ---------------------------------------------------------------------------
console.log("\n4. Unlimited MCQ Practice filters");
// ---------------------------------------------------------------------------
test("group filter returns the correct pool", () => {
  const pool = parity.practicePool({ group: "Group I", subject: "All Subjects", chapter: "All Chapters", mode: "Mixed", difficulty: "Mixed" });
  assert(pool.length > 0, "Group I pool should not be empty");
  assert(pool.every((question) => parity.subjectGroup(question.subject) === "Group I"), "Group I pool contains cross-group questions");
  const combined = parity.practicePool({ group: "Combined", subject: "All Subjects", chapter: "All Chapters", mode: "Mixed", difficulty: "Mixed" });
  assertEqual(combined.length, questions.length, "Combined pool should include every question");
});

test("subject, chapter, mode and difficulty filters narrow the pool", () => {
  const accounts = parity.practicePool({ group: "Combined", subject: "Accounts", chapter: "All Chapters", mode: "Mixed", difficulty: "Mixed" });
  assert(accounts.length > 0 && accounts.every((question) => question.subject === "Accounts"), "subject filter");

  const firstChapter = accounts[0].chapter;
  const chapterOnly = parity.practicePool({ group: "Combined", subject: "All Subjects", chapter: firstChapter, mode: "Mixed", difficulty: "Mixed" });
  assert(chapterOnly.length > 0 && chapterOnly.every((question) => question.chapter === firstChapter), "chapter filter");

  const caseStudy = parity.practicePool({ group: "Combined", subject: "All Subjects", chapter: "All Chapters", mode: "Case Study", difficulty: "Mixed" });
  assert(caseStudy.length === 12 && caseStudy.every((question) => question.kind === "case-study"), "case-study filter");

  const hard = parity.practicePool({ group: "Combined", subject: "All Subjects", chapter: "All Chapters", mode: "Mixed", difficulty: "Hard" });
  assert(hard.length === 9 && hard.every((question) => question.difficulty === "Hard"), "hard filter");

  const easyNormal = parity.practicePool({ group: "Combined", subject: "All Subjects", chapter: "All Chapters", mode: "Normal", difficulty: "Easy" });
  assert(easyNormal.length > 0 && easyNormal.every((question) => question.kind !== "case-study" && question.difficulty === "Easy"), "combined mode + difficulty filter");
});

// ---------------------------------------------------------------------------
console.log("\n5. CA group helpers");
// ---------------------------------------------------------------------------
test("groupsForStudent mirrors the APK caGroups logic", () => {
  assertDeepEqual(parity.groupsForStudent("Group I"), ["Group I"], "Group I student");
  assertDeepEqual(parity.groupsForStudent("Group II"), ["Group II"], "Group II student");
  assertDeepEqual(parity.groupsForStudent("Group I & Group II"), ["Group I", "Group II"], "both-groups student");
  assertDeepEqual(parity.groupsForStudent("Both Groups"), ["Group I", "Group II"], "both-groups wording");
  assertDeepEqual(parity.groupsForStudent(undefined), ["Group I", "Group II"], "unknown group falls back to both");
});

test("subjectGroup mirrors the APK subject grouping", () => {
  assertEqual(parity.subjectGroup("Accounts"), "Group I", "Accounts");
  assertEqual(parity.subjectGroup("Law"), "Group I", "Law");
  assertEqual(parity.subjectGroup("Taxation"), "Group I", "Taxation");
  assertEqual(parity.subjectGroup("Costing"), "Group II", "Costing");
  assertEqual(parity.subjectGroup("Audit"), "Group II", "Audit");
  assertEqual(parity.subjectGroup("FM"), "Group II", "FM");
  assertEqual(parity.subjectGroup("SM"), "Group II", "SM");
  assertEqual(parity.subjectGroup("Revision"), "General", "Revision is not an MCQ subject");
  assertEqual(parity.subjectGroup("Mock Test"), "General", "Mock Test is not an MCQ subject");
});

console.log(`\nAll ${passed} web workflow checks passed.`);
if (process.exitCode) process.exit(process.exitCode);
