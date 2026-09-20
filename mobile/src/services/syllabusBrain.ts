import { dailyMcqBank, type DailyMcqQuestion } from '../data/dailyMcqBank';
import { officialMcqChapterCatalog, type OfficialMcqChapter } from '../data/icaiChapterCatalog';

/**
 * Offline syllabus brain (mock / backend-off mode).
 * In live mode Groq (RAG over ICAI modules) does this job; this local
 * version answers from bundled MCQ explanations + the chapter catalog so
 * the app never feels empty.
 */

const STOP = new Set(['kya', 'hai', 'kaise', 'kyun', 'what', 'is', 'the', 'how', 'why', 'explain', 'about', 'for', 'and', 'with', 'from', 'define', 'batao', 'samjhao', 'means', 'meaning', 'ka', 'ki', 'ke', 'se', 'mein', 'aur', 'hoti', 'hota', 'hotai', 'karo', 'write', 'note', 'on', 'in', 'of', 'to']);

const tokens = (q: string) =>
  Array.from(new Set(
    q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)),
  ));

export function answerFromSyllabus(query: string): string {
  const toks = tokens(query);
  if (!toks.length) return 'Add a little more detail — name the chapter or concept (e.g. "consistency", "NRV", "revenue recognition").';

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

  if (!scored.length && !chapScored.length) {
    return 'This topic did not exactly match my bundled syllabus notes. Once the live AI (Groq + ICAI modules) is connected, you will get a detailed answer from the full syllabus. Meanwhile, try the concept name or chapter number.';
  }

  const parts: string[] = [];
  if (chapScored.length) {
    const c = chapScored[0].c;
    parts.push(`📘 Chapter: ${c.displayTitle} (${c.subject}, Paper ${c.paper})`);
  }
  for (const s of scored.slice(0, 2)) {
    parts.push(`• ${s.q.explanation}`);
    if (s.q.sourceRef) parts.push(`  (Ref: ${s.q.sourceRef})`);
  }
  parts.push('');
  parts.push('This is a summary — the live AI will explain step-by-step from the full module text. Try the quiz round on this chapter!');
  return parts.join('\n');
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
