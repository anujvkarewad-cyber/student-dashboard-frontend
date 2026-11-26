// Live Quiz "Coming Soon" banner — Android (React Native) contract test.
//
// There is no runnable RN toolchain in this workspace (mobile/ has no
// node_modules, no emulator), so the banner cannot be rendered here. What CAN
// be checked mechanically is the thing the owner actually signed off on: the
// banner exists on Home, sits directly under the group-wise daily-MCQ card, is
// inert (no touch target, no navigation), says only "coming soon" — no design
// preview, no countdown, no mock numbers — and introduces no new colours.
//
// These are source assertions against mobile/src/screens/DashboardScreen.tsx.
// They do NOT prove the screen renders; the render check has to happen in a
// real build (see quiz-preview/SPEC-APK-COMING-SOON.md §5).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = "mobile/src/screens/DashboardScreen.tsx";
const src = fs.readFileSync(path.join(root, file), "utf8");

test("Home has exactly one Live Quiz coming-soon banner, between the MCQ card and the target summary", () => {
  const at = src.indexOf("<View style={styles.liveQuizSoon}>");
  // The daily-MCQ card is the Pressable whose eyebrow reads GROUP-WISE DAILY MCQ.
  const daily = src.indexOf("GROUP-WISE DAILY MCQ");
  const dailyCard = src.lastIndexOf("<Pressable", daily);
  const summary = src.indexOf("<SmartTargetHomeSummary />");
  assert.ok(at > 0, "banner JSX missing");
  assert.equal(src.split("styles.liveQuizSoon}").length - 1, 1, "banner must appear exactly once");
  assert.ok(dailyCard > 0 && dailyCard < at, "banner must come AFTER the group-wise daily-MCQ card");
  assert.ok(src.indexOf("</Pressable>", daily) < at, "banner must sit below the closed daily-MCQ card, not inside it");
  assert.ok(at < summary, "banner must come BEFORE <SmartTargetHomeSummary />");
  // No other screen may duplicate it.
  const others = fs.readdirSync(path.join(root, "mobile/src/screens"))
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => fs.readFileSync(path.join(root, "mobile/src/screens", f), "utf8").includes("liveQuizSoon") && f !== "DashboardScreen.tsx");
  assert.deepEqual(others, [], `banner leaked into other screens: ${others.join(", ")}`);
});

test("the banner is inert — not a touch target, no navigation, no lobby mount", () => {
  const jsx = src.slice(src.indexOf("<View style={styles.liveQuizSoon}>"), src.indexOf("<SmartTargetHomeSummary />"));
  assert.match(jsx, /<\/View>\s*$/s, "banner JSX should end at the closing View");
  for (const banned of ["Pressable", "TouchableOpacity", "onPress", "navigation.", "navigate(", "LiveQuizLobby", "Ionicons name=\"chevron"]) {
    assert.ok(!jsx.includes(banned), `inert banner must not contain ${banned}`);
  }
});

test("banner copy is English, title + COMING SOON only — no time, no schedule, no subtitle", () => {
  const jsx = src.slice(src.indexOf("<View style={styles.liveQuizSoon}>"), src.indexOf("<SmartTargetHomeSummary />"));
  assert.match(jsx, /<Text style={styles.liveQuizSoonTitle}>Daily Live Quiz<\/Text>/,
    "title must read exactly 'Daily Live Quiz'");
  assert.match(jsx, /liveQuizSoonStatusText}>COMING SOON<\/Text>/, "chip must read COMING SOON");
  assert.doesNotMatch(jsx, /\d{1,2}:\d{2}\s*(AM|PM|IST)/i, "no start time — the 8 PM line was removed on request");
  assert.doesNotMatch(jsx, /countdown|schedule|Join Quiz|questions/i, "no schedule/countdown/claims in the banner");
  assert.doesNotMatch(jsx, /[\u0900-\u097F]/, "no Devanagari in the banner");
  for (const hin of ["Roz", "shaam", "yahin", "bhi", "hoga", "Launch ke baad"]) {
    assert.ok(!new RegExp(`\\b${hin}\\b`).test(jsx), `Hinglish copy left in the RN banner: "${hin}"`);
  }
  // The rejected teaser content must stay out of the RN app entirely.
  const dir = path.join(root, "mobile/src");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const tsx = walk(dir).filter((f) => /\.(tsx|ts)$/.test(f) && !f.includes(`${path.sep}livequiz${path.sep}`));
  const hits = tsx.filter((f) => /DESIGN PREVIEW|lqsoon|LiveQuizSoon|sneak peek|04:36|180 students|QUIZ SHURU HONE/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(hits.map((f) => path.relative(root, f)), [], `teaser leftovers in mobile/src: ${hits.join(", ")}`);
});

test("banner styles use existing tokens only — no new palette entries, no dead styles", () => {
  const block = src.match(/liveQuizSoon: \{[\s\S]*?liveQuizSoonStatusText: \{[^}]*\}/);
  assert.ok(block, "banner StyleSheet block not found");
  const defined = [...new Set((block[0].match(/\b(liveQuizSoon[A-Za-z]*):/g) || []).map((x) => x.slice(0, -1)))];
  assert.ok(defined.length >= 5, `expected the banner style set, found ${defined.join(", ")}`);
  for (const k of defined) {
    assert.ok(src.includes(`styles.${k}`), `dead style left in the banner: ${k}`);
  }
  assert.doesNotMatch(block[0], /shadow|elevation/, "the banner must stay flat (no shadow rules)");
  const allowed = new Set(["#8A5A00", "#F3DFAE"]); // both already used by the frozen live-quiz screens
  const hexes = [...new Set(block[0].match(/#[0-9A-Fa-f]{6}/g) || [])];
  for (const h of hexes) assert.ok(allowed.has(h), `new colour literal in the banner: ${h}`);
  assert.ok(/colors\.amberSoft/.test(block[0]) && /colors\.amber\b/.test(block[0]), "banner must sit on the amber tokens");
  // Sizes must come from the shared scale, not invented spacing.
  assert.ok(/gap: spacing\.md/.test(block[0]) && /borderRadius: radius\.lg/.test(block[0]), "banner must use spacing/radius tokens");
});
