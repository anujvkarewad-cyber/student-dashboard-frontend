/**
 * Turns a practice question into the micro-concept it tests.
 *
 * The published bank does not yet carry `conceptTags` (the backend's
 * content_validation.py requires them for NEW content, but the 4,700 questions
 * live today were published before that rule). Rather than invent topic labels
 * we cannot justify, concepts are resolved from evidence already inside the
 * question, in descending order of how specific that evidence is:
 *
 *   1. conceptTags          - authoritative, used the moment the bank has them
 *   2. an explicit ICAI reference in the question text
 *                             ("Section 139", "SA 700", "AS 11", "Ind AS 116")
 *                             - ICAI questions name their own topic, so this is
 *                             a genuine micro-concept, not a guess
 *   3. the chapter title     - the topic the question was filed under
 *
 * Every returned concept therefore traces back to something real in the
 * question. A strength score is only ever attached to a label we can defend.
 */

export type ConceptSource = {
  id: string;
  subject: string;
  chapterId: string;
  chapterTitle: string;
  /** Display form, e.g. "Module 1 · Chapter 3: Buyback of Securities". */
  chapter?: string;
  prompt: string;
  explanation?: string;
  /** Present once the published bank starts emitting them. */
  conceptTags?: string[];
};

export type ConceptOrigin = 'tag' | 'reference' | 'chapter';

export type ResolvedConcept = {
  /** Stable identity used for storage and comparison. */
  key: string;
  /** What the student sees. */
  label: string;
  subject: string;
  chapterId: string;
  origin: ConceptOrigin;
};

/**
 * Ordered by diagnostic strength. Each entry is validated before use so a
 * stray number in prose cannot become a concept.
 */
const REFERENCE_RULES: {
  origin: ConceptOrigin;
  pattern: RegExp;
  accept: (captured: string) => boolean;
  format: (captured: string) => string;
}[] = [
  {
    // "Ind AS 116" must be matched before the bare "AS" rule and must not be
    // mistaken for it.
    origin: 'reference',
    pattern: /\bInd AS\s+(\d{1,3})\b/,
    accept: (n) => Number(n) >= 1 && Number(n) <= 120,
    format: (n) => `Ind AS ${n}`,
  },
  {
    // Standards on Auditing are always 3 digits, 200-799.
    origin: 'reference',
    pattern: /\bSA\s+(\d{3})\b/,
    accept: (n) => Number(n) >= 200 && Number(n) <= 799,
    format: (n) => `SA ${n}`,
  },
  {
    origin: 'reference',
    pattern: /\bAS\s+(\d{1,2})\b/,
    accept: (n) => Number(n) >= 1 && Number(n) <= 32,
    format: (n) => `AS ${n}`,
  },
  {
    // "Section 139" / "Section 2(1)" / "section 43" - the Companies Act and the
    // Income-tax Act both number in the hundreds at most.
    origin: 'reference',
    pattern: /\b[Ss]ection\s+(\d{1,3}[A-Z]?)\b/,
    accept: (n) => Number(n.replace(/[A-Z]/g, '')) >= 1 && Number(n.replace(/[A-Z]/g, '')) <= 999,
    format: (n) => `Section ${n.toUpperCase()}`,
  },
  {
    origin: 'reference',
    pattern: /\bRule\s+(\d{1,3}[A-Z]?)\b/,
    accept: (n) => Number(n.replace(/[A-Z]/g, '')) >= 1,
    format: (n) => `Rule ${n.toUpperCase()}`,
  },
];

const ARTICLE_RULE = {
  pattern: /\bArticle\s+(\d{1,3}[A-Z]?)\b/,
  accept: (n: string) => Number(n.replace(/[A-Z]/g, '')) >= 1,
  format: (n: string) => `Article ${n.toUpperCase()}`,
};

export const conceptKey = (label: string): string =>
  (label || '').trim().toLowerCase().replace(/\s+/g, ' ');

const titleOf = (source: ConceptSource): string => {
  const raw = (source.chapterTitle || '').trim();
  if (raw) return raw;
  // Fall back to the display string, stripped of its "Module 1 · Chapter 3: "
  // prefix, only when the plain title is missing.
  return (source.chapter || '').replace(/^.*?:\s*/, '').trim() || 'Unfiled chapter';
};

const findReference = (text: string): string | undefined => {
  if (!text) return undefined;
  for (const rule of REFERENCE_RULES) {
    const match = rule.pattern.exec(text);
    if (match && rule.accept(match[1])) return rule.format(match[1]);
  }
  const article = ARTICLE_RULE.pattern.exec(text);
  if (article && ARTICLE_RULE.accept(article[1])) return ARTICLE_RULE.format(article[1]);
  return undefined;
};

/**
 * The question stem is the primary signal; the explanation is a fallback for
 * questions that describe the situation before naming the provision.
 */
const referenceFrom = (source: ConceptSource): string | undefined =>
  findReference(source.prompt) || findReference(source.explanation || '');

export const conceptsForQuestion = (source: ConceptSource): ResolvedConcept[] => {
  const subject = source.subject;
  const chapterId = source.chapterId;

  const tags = (source.conceptTags || []).map((t) => (t || '').trim()).filter(Boolean);
  if (tags.length) {
    return tags.map((label) => ({
      key: conceptKey(label),
      label,
      subject,
      chapterId,
      origin: 'tag' as ConceptOrigin,
    }));
  }

  const reference = referenceFrom(source);
  if (reference) {
    return [{ key: conceptKey(reference), label: reference, subject, chapterId, origin: 'reference' }];
  }

  const label = titleOf(source);
  return [{ key: conceptKey(label), label, subject, chapterId, origin: 'chapter' }];
};

/** The single concept an attempt is recorded against. */
export const primaryConcept = (source: ConceptSource): ResolvedConcept =>
  conceptsForQuestion(source)[0];

/** Human-readable explanation of why a concept was chosen, for the UI. */
export const ORIGIN_NOTE: Record<ConceptOrigin, string> = {
  tag: 'Tagged by your mentor',
  reference: 'Named in the question',
  chapter: 'Chapter topic',
};
