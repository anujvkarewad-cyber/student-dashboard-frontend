import { dailyMcqBank, type DailyMcqQuestion } from '../data/dailyMcqBank';
import { officialMcqChapterCatalog, type OfficialMcqChapter } from '../data/icaiChapterCatalog';

/**
 * Offline syllabus brain (mock / backend-off mode).
 *
 * v2 — ICAI ANSWER FORMAT
 * The old version returned a couple of MCQ explanations stitched together and
 * signed off with "This is a summary". That is not an ICAI answer. This version
 * classifies the question and renders the same ICAI skeleton the live backend
 * uses, so the student sees the right *shape* of answer even offline:
 *
 *   theory      -> Provision -> Explanation -> Conclusion
 *   practical   -> Assumptions -> Working Notes -> Statement -> Final Answer
 *   distinguish -> two-column table on exam-relevant bases
 *   case study  -> Provisions Applicable -> Application -> Conclusion
 */

export type AnswerMode = 'theory' | 'practical' | 'distinguish' | 'case_study';

const PRACTICAL_CUES = [
  'compute', 'calculate', 'solve', 'prepare', 'find the', 'amount of', 'value of',
  'working note', 'cost sheet', 'valuation', 'depreciat', 'closing stock',
  'trial balance', 'gross profit', 'net profit', 'reconciliation', 'apportion',
  'reapportion', 'marginal cost', 'break even', 'breakeven', 'npv', 'irr',
  'payback', 'wacc', 'how much',
];
const DISTINGUISH_CUES = [
  'distinguish', 'differentiate', 'difference between', 'compare', 'versus', 'v/s', ' vs ', 'tabulate',
];
const CASESTUDY_CUES = [
  'in the given case', 'advise', 'comment whether', 'is he liable', 'are they liable',
  'whether the company', 'state with reasons', 'examine whether', 'discuss the validity',
  'case study', 'ltd.', 'limited,', 'pvt', 'given the following facts',
];

/** Same classification as the backend, so offline and live answers match. */
export function detectAnswerMode(query: string): AnswerMode {
  const q = ` ${(query || '').toLowerCase()} `;
  if (DISTINGUISH_CUES.some((c) => q.includes(c))) return 'distinguish';
  if (PRACTICAL_CUES.some((c) => q.includes(c))) return 'practical';
  if (CASESTUDY_CUES.some((c) => q.includes(c))) return 'case_study';
  return 'theory';
}

const STOP = new Set(['kya', 'hai', 'kaise', 'kyun', 'what', 'is', 'the', 'how', 'why', 'explain', 'about', 'for', 'and', 'with', 'from', 'define', 'batao', 'samjhao', 'means', 'meaning', 'ka', 'ki', 'ke', 'se', 'mein', 'aur', 'hoti', 'hota', 'hotai', 'karo', 'write', 'note', 'on', 'in', 'of', 'to']);

const tokens = (q: string) =>
  Array.from(new Set(
    q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)),
  ));

const NO_MATERIAL_HEADS: Record<AnswerMode, string[]> = {
  theory: ['Provision', 'Explanation', 'Conclusion'],
  practical: ['Assumptions', 'Working Notes', 'Statement', 'Final Answer'],
  distinguish: [],
  case_study: ['Provisions Applicable', 'Application to the Given Facts', 'Conclusion'],
};

function noMaterial(mode: AnswerMode): string {
  const where =
    'The bundled offline notes do not cover this question directly, and quoting a ' +
    'section or figure from memory risks a wrong provision, which ICAI penalises heavily.';

  if (mode === 'distinguish') {
    return (
      'This question asks for a distinction, which needs the two-column table format:\n\n' +
      '| Basis of Difference | | |\n|---|---|---|\n| | | |\n\n' +
      `${where} Name the two items exactly as they appear in the module (for example ` +
      '"equity share capital vs preference share capital") and ask again.'
    );
  }
  if (mode === 'practical') {
    return (
      'Assumptions\nNone stated in the question.\n\n' +
      'Working Notes\nThe offline notes do not hold the figures for this question, so the ' +
      'computation cannot be completed here.\n\n' +
      'Statement\nSet out the statement with the title the question asks for, in ' +
      'Particulars / Amount (Rs) form.\n\n' +
      'Final Answer\nState the figure with its unit once the statement is complete.\n\n' +
      `${where}`
    );
  }
  const heads = NO_MATERIAL_HEADS[mode];
  return heads
    .map((h) => `${h}\n${h === 'Conclusion' ? 'Not found in the provided material.' : where}`)
    .join('\n\n');
}

export function answerFromSyllabus(query: string): string {
  const mode = detectAnswerMode(query);
  const toks = tokens(query);

  if (!toks.length) {
    return (
      'Provision\nNot enough detail in the question.\n\n' +
      'Explanation\nName the chapter or the exact concept, for example "consistency", ' +
      '"NRV", "revenue recognition", "Section 43" or "SA 700".\n\n' +
      'Conclusion\nAsk again with the concept name and you will get the full ICAI-format answer.'
    );
  }

  const scored = dailyMcqBank
    .map((q) => {
      const hay = `${q.prompt} ${q.explanation} ${q.sourceRef || ''}`.toLowerCase();
      const score = toks.filter((t) => hay.includes(t)).length;
      return { q, score };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score);

  const chapScored = officialMcqChapterCatalog
    .map((c) => {
      const hay = `${c.displayTitle} ${c.subject}`.toLowerCase();
      const score = toks.filter((t) => hay.includes(t)).length;
      return { c, score };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score);

  if (!scored.length && !chapScored.length) return noMaterial(mode);

  const chapter = chapScored.length ? chapScored[0].c : null;
  const refs = Array.from(new Set(
    scored.slice(0, 3).map((s) => s.q.sourceRef).filter((r): r is string => !!r),
  ));
  const points = scored.slice(0, 4).map((s) => s.q.explanation.trim());

  const footer = refs.length ? `\n\n[Source: ICAI module extract \u2014 ${refs.join(' / ')}]` : '';
  // NOTE: chapter.paper already reads "Paper 2: Corporate and Other Laws", so we
  // must not prefix it again - the old code printed "Paper Paper 2: ...".
  const paperLabel = chapter
    ? (/^paper\b/i.test(chapter.paper) ? chapter.paper : `Paper ${chapter.paper}`)
    : '';
  const chapterLine = chapter
    ? `Chapter: ${chapter.displayTitle} (${chapter.subject}, ${paperLabel})\n\n`
    : '';

  // ---------------- DISTINGUISH ----------------
  if (mode === 'distinguish') {
    const rows = points
      .slice(0, 6)
      .map((p) => `| ${p.replace(/\.$/, '')} | | |`)
      .join('\n');
    return (
      `${chapterLine}The two items to be distinguished are covered below.\n\n` +
      `| Basis of Difference | | |\n|---|---|---|\n${rows}` +
      footer
    );
  }

  // ---------------- PRACTICAL ----------------
  if (mode === 'practical') {
    const method = points.map((p) => `- ${p}`).join('\n');
    return (
      `${chapterLine}Assumptions\nNone stated in the question.\n\n` +
      'Working Notes\nThe offline notes do not hold the figures for this question, so the ' +
      'computation cannot be completed here. The method and treatment to apply are:\n' +
      `${method || '- Not found in the provided material.'}\n\n` +
      'Statement\nSet out your statement with the title the question asks for, in ' +
      'Particulars / Amount (Rs) form, using the method above.\n\n' +
      'Final Answer\nState the figure with its unit once the statement is complete.' +
      footer
    );
  }

  // ---------------- CASE STUDY ----------------
  if (mode === 'case_study') {
    const prov = refs.length ? refs.map((r) => `- ${r}`).join('\n') : '- Not found in the provided material.';
    const app = points.map((p) => `- ${p}`).join('\n');
    return (
      `${chapterLine}Provisions Applicable\n${prov}\n\n` +
      `Application to the Given Facts\n${app}\n\n` +
      'Conclusion\nApply the provisions above to the facts of your question and state the ' +
      'outcome (liable / not liable, valid / void, allowed / disallowed).' +
      footer
    );
  }

  // ---------------- THEORY (default) ----------------
  const prov = refs.length ? refs.map((r) => `- ${r}`).join('\n') : '- Not found in the provided material.';
  const expl = points.map((p) => `- ${p}`).join('\n');
  const concl = points.length ? points[points.length - 1] : 'Not found in the provided material.';
  return (
    `${chapterLine}Provision\n${prov}\n\n` +
    `Explanation\n${expl}\n\n` +
    `Conclusion\n${concl}` +
    footer
  );
}

/** Best-matching catalog chapter for a free-text query (used by revision rounds). */
export function matchChapter(query: string): OfficialMcqChapter | null {
  const toks = tokens(query);
  if (!toks.length) return null;
  let best: OfficialMcqChapter | null = null;
  let bestScore = 0;
  for (const c of officialMcqChapterCatalog) {
    const hay = `${c.displayTitle} ${c.subject} ${c.module}`.toLowerCase();
    const score = toks.filter((t) => hay.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** Pick up to n questions for a revision round on a chapter. */
export function pickQuizQuestions(chapter: OfficialMcqChapter, n = 3): DailyMcqQuestion[] {
  const chapNo = `chapter ${chapter.chapterNumber}`;
  const inChapter = dailyMcqBank.filter((q) => (q.sourceRef || '').toLowerCase().includes(chapNo) && q.subject === chapter.subject);
  const pool = inChapter.length ? inChapter : dailyMcqBank.filter((q) => q.subject === chapter.subject);
  return pool.slice(0, n);
}
