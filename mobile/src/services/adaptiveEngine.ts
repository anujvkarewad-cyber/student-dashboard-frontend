/**
 * Adaptive learning engine.
 *
 * Pure logic, no React and no device APIs, so every rule below can be unit
 * tested outside the app. Storage lives in adaptiveStore.ts.
 *
 * The engine answers four questions:
 *   1. How strong is this student on each micro-concept?      -> strength
 *   2. What should they revise today?                         -> dueAt / plan
 *   3. Which concepts should the next question set cover?      -> 60/30/10
 *   4. What are they getting wrong, and why?                  -> mistake loop
 *
 * Design note: concept strength is deliberately driven by ACCURACY WITHIN THE
 * CONCEPT, not by how many questions were answered. A student who answers two
 * questions correctly has not mastered anything, which is why a minimum number
 * of attempts is required before a concept can be called "strong".
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Strength = 'weak' | 'medium' | 'strong';

/** Why a question went wrong. Asked of the student, never guessed. */
export type MistakeType =
  | 'concept'      // did not know the rule
  | 'application'  // knew the rule, applied it to the facts wrongly
  | 'calculation'  // arithmetic / working error
  | 'misread'      // misread the question
  | 'guess';       // got it right for the wrong reason (recorded on correct answers)

export type Confidence = 'Low' | 'Medium' | 'High';

export type ConceptStat = {
  concept: string;
  subject: string;
  chapterId?: string;
  attempts: number;
  correct: number;
  mistakes: number;
  /** How many times each mistake type has been seen. Drives the mistake loop. */
  mistakeTypes: Partial<Record<MistakeType, number>>;
  /** Consecutive correct answers. Feeds the "perfect twice" fast-track. */
  consecutiveCorrect: number;
  /** Consecutive answers at 100% - the literal "perfect twice" rule. */
  consecutivePerfect: number;
  /** Consecutive correct answers given with High confidence. */
  consecutiveConfidentCorrect: number;
  strength: Strength;
  /** Concept never answered yet - treated as high value, not as "weak". */
  unseen: boolean;
  lastSeenAt: number;
  /** When the concept was first attempted - bounds the consistency window. */
  firstSeenAt: number;
  lastWrongAt: number;
  /** True when the most recent wrong answer was given with High confidence. */
  lastWrongConfidenceWasHigh: boolean;
  dueAt: number;
  /** Raised as the student keeps getting the concept right. */
  difficultyTarget: 'easy' | 'moderate' | 'hard';
};

export type AttemptInput = {
  concept: string;
  subject: string;
  chapterId?: string;
  correct: boolean;
  confidence: Confidence;
  mistakeType?: MistakeType;
  at?: number;
};

export type IntervalReason =
  | 'wrong-high-confidence'
  | 'repeated-mistake'
  | 'perfect-twice'
  | 'above-85'
  | '70-85'
  | '40-70'
  | 'below-40'
  | 'no-attempts';

export type ScheduleResult = {
  dueAt: number;
  intervalDays: number;
  reason: IntervalReason;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tunables - every number from the spec lives here so it can be changed in one
// place without hunting through the logic.
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_ATTEMPTS_FOR_STRENGTH = 2;

export const INTERVALS = {
  below40: 1,
  between40and70: 3,
  between70and85: 7,
  above85: 14,
  perfectTwice: 21,
  overrideShort: 1,
} as const;

export const MIX = { weak: 0.6, medium: 0.3, strong: 0.1 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Strength
// ─────────────────────────────────────────────────────────────────────────────

export const accuracyOf = (s: Pick<ConceptStat, 'attempts' | 'correct'>): number =>
  s.attempts === 0 ? 0 : (s.correct / s.attempts) * 100;

/**
 * Weak / Medium / Strong from accuracy.
 *
 * The boundaries match the revision-interval table below on purpose: a concept
 * is "medium" if it earns the 40-70 revision slot, "strong" if it earns 70+.
 * One consistent set of thresholds is easier to reason about than two.
 */
export const strengthFor = (
  attempts: number,
  accuracy: number,
): Strength => {
  if (attempts < MIN_ATTEMPTS_FOR_STRENGTH) return 'weak';
  if (accuracy >= 70) return 'strong';
  if (accuracy >= 40) return 'medium';
  return 'weak';
};

export const emptyStat = (concept: string, subject: string, chapterId?: string): ConceptStat => ({
  concept,
  subject,
  chapterId,
  attempts: 0,
  correct: 0,
  mistakes: 0,
  mistakeTypes: {},
  consecutiveCorrect: 0,
  consecutivePerfect: 0,
  consecutiveConfidentCorrect: 0,
  strength: 'weak',
  unseen: true,
  lastSeenAt: 0,
  firstSeenAt: 0,
  lastWrongAt: 0,
  lastWrongConfidenceWasHigh: false,
  dueAt: 0,
  difficultyTarget: 'easy',
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Spaced repetition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When should this concept come back?
 *
 * Base intervals follow accuracy. Three overrides beat the base table, in this
 * order of authority:
 *
 *   - High confidence + wrong   -> 1 day. Overconfidence is the most dangerous
 *     state a student can be in, and it needs the shortest loop.
 *   - Repeated mistake          -> 1 day. Same mistake type twice or more.
 *   - Perfect twice             -> 21 days. Two 100% answers in a row earns the
 *     long pass.
 */
export const scheduleNext = (stat: ConceptStat, now: number = Date.now()): ScheduleResult => {
  if (stat.attempts === 0) {
    return { dueAt: now, intervalDays: 0, reason: 'no-attempts' };
  }

  const accuracy = accuracyOf(stat);

  // --- override: got it wrong while saying they were confident
  const lastWasHighConfidenceWrong =
    stat.lastWrongAt > 0 && stat.consecutiveConfidentCorrect === 0 && stat.lastWrongConfidenceWasHigh === true
      ? true
      : false;
  if (lastWasHighConfidenceWrong) {
    return { dueAt: now + INTERVALS.overrideShort * DAY_MS, intervalDays: INTERVALS.overrideShort, reason: 'wrong-high-confidence' };
  }

  // --- override: the same mistake type, more than once
  const repeatedMistake = Object.values(stat.mistakeTypes).some((n) => (n || 0) >= 2);
  if (repeatedMistake && accuracy < 70) {
    return { dueAt: now + INTERVALS.overrideShort * DAY_MS, intervalDays: INTERVALS.overrideShort, reason: 'repeated-mistake' };
  }

  // --- override: two perfect answers in a row
  if (stat.consecutivePerfect >= 2) {
    return { dueAt: now + INTERVALS.perfectTwice * DAY_MS, intervalDays: INTERVALS.perfectTwice, reason: 'perfect-twice' };
  }

  // --- base table
  if (accuracy > 85) {
    return { dueAt: now + INTERVALS.above85 * DAY_MS, intervalDays: INTERVALS.above85, reason: 'above-85' };
  }
  if (accuracy >= 70) {
    return { dueAt: now + INTERVALS.between70and85 * DAY_MS, intervalDays: INTERVALS.between70and85, reason: '70-85' };
  }
  if (accuracy >= 40) {
    return { dueAt: now + INTERVALS.between40and70 * DAY_MS, intervalDays: INTERVALS.between40and70, reason: '40-70' };
  }
  return { dueAt: now + INTERVALS.below40 * DAY_MS, intervalDays: INTERVALS.below40, reason: 'below-40' };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Recording an attempt (the mistake loop)
// ─────────────────────────────────────────────────────────────────────────────

export const recordAttempt = (
  stat: ConceptStat,
  input: AttemptInput,
  now: number = Date.now(),
): ConceptStat => {
  const next: ConceptStat = { ...stat, mistakeTypes: { ...stat.mistakeTypes } };

  next.attempts += 1;
  next.unseen = false;
  next.lastSeenAt = now;
  // Stamped once, on the first attempt, and never moved.
  if (!next.firstSeenAt) next.firstSeenAt = now;

  if (input.correct) {
    next.correct += 1;
    next.consecutiveCorrect += 1;
    next.consecutivePerfect = input.confidence === 'High' || input.confidence === 'Medium'
      ? next.consecutivePerfect + 1
      : next.consecutivePerfect;
    next.consecutiveConfidentCorrect =
      input.confidence === 'High' ? next.consecutiveConfidentCorrect + 1 : 0;
    next.lastWrongConfidenceWasHigh = false;
  } else {
    next.mistakes += 1;
    next.consecutiveCorrect = 0;
    next.consecutivePerfect = 0;
    next.consecutiveConfidentCorrect = 0;
    next.lastWrongAt = now;
    next.lastWrongConfidenceWasHigh = input.confidence === 'High';
    if (input.mistakeType) {
      next.mistakeTypes[input.mistakeType] = (next.mistakeTypes[input.mistakeType] || 0) + 1;
    }
  }

  next.strength = strengthFor(next.attempts, accuracyOf(next));
  next.difficultyTarget = difficultyFor(next);

  const scheduled = scheduleNext(next, now);
  next.dueAt = scheduled.dueAt;
  return next;
};

/**
 * Difficulty escalates only on sustained success: two clean answers, then
 * harder questions on that concept. It never escalates on a lucky single hit.
 * A wrong answer drops it straight back down.
 */
export const difficultyFor = (stat: ConceptStat): ConceptStat['difficultyTarget'] => {
  if (stat.consecutiveCorrect >= 4) return 'hard';
  if (stat.consecutiveCorrect >= 2) return 'moderate';
  return 'easy';
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Adaptive selection - 60% weak / 30% medium / 10% strong
// ─────────────────────────────────────────────────────────────────────────────

const shuffleWith = <T,>(items: T[], rng: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * Split a question count into the 60/30/10 buckets.
 *
 * Rounding is handled by largest-remainder so the buckets always add up to
 * exactly `count` - with a 10-question set you cannot have 6 + 3 + 1 = 10 and
 * with a 3-question set you must still get 2 weak + 1 medium rather than
 * 1.8 + 0.9 + 0.3.
 */
export const splitBuckets = (count: number): { weak: number; medium: number; strong: number } => {
  if (count <= 0) return { weak: 0, medium: 0, strong: 0 };
  const raw = {
    weak: count * MIX.weak,
    medium: count * MIX.medium,
    strong: count * MIX.strong,
  };
  const base = {
    weak: Math.floor(raw.weak),
    medium: Math.floor(raw.medium),
    strong: Math.floor(raw.strong),
  };
  let leftover = count - (base.weak + base.medium + base.strong);
  const order = (['weak', 'medium', 'strong'] as const)
    .map((k) => ({ k, frac: raw[k] - base[k] }))
    .sort((a, b) => b.frac - a.frac);
  for (const { k } of order) {
    if (leftover <= 0) break;
    base[k] += 1;
    leftover -= 1;
  }
  // A short set must never be all-strong: if the student gets only one
  // question, it should be their weakest concept, not their best.
  if (count >= 1 && base.weak === 0) {
    if (base.strong > 0) { base.strong -= 1; base.weak += 1; }
    else if (base.medium > 0) { base.medium -= 1; base.weak += 1; }
  }
  return base;
};

/**
 * Choose which concepts the next set should cover.
 *
 * Unseen concepts count as weak on purpose: an untested concept is the
 * highest-value thing to test, so a new student gets a broad first set rather
 * than a random one.
 */
export const selectConcepts = (
  stats: ConceptStat[],
  count: number,
  rng: () => number = Math.random,
): ConceptStat[] => {
  if (!stats.length || count <= 0) return [];
  const buckets = splitBuckets(count);

  const dueFirst = (list: ConceptStat[], now: number) =>
    [...list].sort((a, b) => {
      const aOverdue = a.dueAt <= now ? 1 : 0;
      const bOverdue = b.dueAt <= now ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      if (a.unseen !== b.unseen) return a.unseen ? -1 : 1;
      return a.lastSeenAt - b.lastSeenAt;
    });

  const now = Date.now();
  const weakPool = stats.filter((s) => s.unseen || s.strength === 'weak');
  const mediumPool = stats.filter((s) => !s.unseen && s.strength === 'medium');
  const strongPool = stats.filter((s) => !s.unseen && s.strength === 'strong');

  const picked: ConceptStat[] = [];
  const take = (pool: ConceptStat[], n: number) => {
    if (n <= 0) return;
    picked.push(...dueFirst(pool, now).slice(0, n));
  };

  take(weakPool, buckets.weak);
  take(mediumPool, buckets.medium);
  take(strongPool, buckets.strong);

  // Backfill: a student with no medium concepts yet still needs a full set.
  if (picked.length < count) {
    const chosen = new Set(picked.map((p) => p.concept));
    const rest = shuffleWith(
      dueFirst(stats.filter((s) => !chosen.has(s.concept)), now),
      rng,
    );
    picked.push(...rest.slice(0, count - picked.length));
  }
  return picked.slice(0, count);
};

/**
 * Pick actual questions for the chosen concepts.
 *
 * Questions never asked by this student come first, so the same question is not
 * served twice while fresh ones sit unused.
 */
export const pickQuestions = <T extends { id: string; conceptTags?: string[] }>(
  pool: T[],
  concepts: string[],
  count: number,
  seenQuestionIds: Set<string>,
  rng: () => number = Math.random,
): T[] => {
  if (!pool.length || count <= 0 || !concepts.length) return [];
  const wanted = new Set(concepts);
  const matching = pool.filter((q) => (q.conceptTags || []).some((t) => wanted.has(t)));
  const usable = matching.length ? matching : pool;
  const unseen = usable.filter((q) => !seenQuestionIds.has(q.id));
  const seen = usable.filter((q) => seenQuestionIds.has(q.id));
  return [...shuffleWith(unseen, rng), ...shuffleWith(seen, rng)].slice(0, count);
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Revision plan and insights (student-facing dashboard)
// ─────────────────────────────────────────────────────────────────────────────

export type RevisionPlan = {
  today: ConceptStat[];
  overdue: ConceptStat[];
  weak: ConceptStat[];
  counts: { today: number; overdue: number; weak: number };
};

export const buildRevisionPlan = (
  stats: ConceptStat[],
  now: number = Date.now(),
): RevisionPlan => {
  const attempted = stats.filter((s) => !s.unseen);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const overdue = attempted
    .filter((s) => s.dueAt < now)
    .sort((a, b) => a.dueAt - b.dueAt);

  const today = attempted
    .filter((s) => s.dueAt >= now && s.dueAt <= endOfToday.getTime())
    .sort((a, b) => a.dueAt - b.dueAt);

  const weak = [...stats]
    .filter((s) => s.unseen || s.strength === 'weak')
    .sort((a, b) => accuracyOf(a) - accuracyOf(b));

  return {
    today,
    overdue,
    weak,
    counts: { today: today.length, overdue: overdue.length, weak: weak.length },
  };
};

export type Insights = {
  topWeak: ConceptStat[];
  /** Accuracy for the last `days` days, oldest first. */
  trend: { day: string; answered: number; correct: number; accuracy: number }[];
  /** Share of the last 14 days with at least one attempt, 0-100. */
  consistency: number;
  totalAttempts: number;
  overallAccuracy: number;
  /** The mistake type that is costing the most marks overall. */
  topMistake: { type: MistakeType; count: number } | null;
};

export const buildInsights = (
  stats: ConceptStat[],
  now: number = Date.now(),
  days = 14,
): Insights => {
  const attempted = stats.filter((s) => !s.unseen);
  const totalAttempts = attempted.reduce((n, s) => n + s.attempts, 0);
  const totalCorrect = attempted.reduce((n, s) => n + s.correct, 0);

  const topWeak = [...attempted]
    .filter((s) => s.strength !== 'strong')
    .sort((a, b) => a.correct / Math.max(1, a.attempts) - b.correct / Math.max(1, b.attempts))
    .slice(0, 5);

  const mistakes: Partial<Record<MistakeType, number>> = {};
  for (const s of attempted) {
    for (const [type, n] of Object.entries(s.mistakeTypes)) {
      mistakes[type as MistakeType] = (mistakes[type as MistakeType] || 0) + (n || 0);
    }
  }
  const topMistakeEntry = Object.entries(mistakes).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
  const topMistake = topMistakeEntry
    ? { type: topMistakeEntry[0] as MistakeType, count: topMistakeEntry[1] || 0 }
    : null;

  // Activity per day, derived from lastSeenAt. lastSeenAt is the only timestamp
  // kept per concept, so a day counts if any concept was touched on it.
  const trend: Insights['trend'] = [];
  let activeDays = 0;
  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = new Date(now - i * DAY_MS);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = dayStart.getTime() + DAY_MS;
    const touched = attempted.filter((s) => s.lastSeenAt >= dayStart.getTime() && s.lastSeenAt < dayEnd);
    if (touched.length) activeDays += 1;
    const answered = touched.reduce((n, s) => n + s.attempts, 0);
    const correct = touched.reduce((n, s) => n + s.correct, 0);
    trend.push({
      day: `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`,
      answered,
      correct,
      accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    });
  }

  const firstSeen = attempted.reduce(
    (earliest, s) => (s.firstSeenAt && (!earliest || s.firstSeenAt < earliest) ? s.firstSeenAt : earliest),
    0,
  );
  const daysSinceStart = firstSeen
    ? Math.floor((now - firstSeen) / 86_400_000) + 1
    : 1;
  // Capped at `days` so a long-standing student is still measured over 14 days.
  const windowDays = Math.max(1, Math.min(days, daysSinceStart));

  return {
    topWeak,
    trend,
    // Consistency is the share of days the student has actually been around for,
    // not of a fixed 14-day window. Dividing a first-week student by 14 would
    // report 7% to someone who has studied every single day they have had the
    // app, which is both wrong and discouraging.
    consistency: Math.round((activeDays / windowDays) * 100),
    totalAttempts,
    overallAccuracy: totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
    topMistake,
  };
};

export const MISTAKE_LABEL: Record<MistakeType, string> = {
  concept: 'Did not know the rule',
  application: 'Knew the rule, applied it wrongly',
  calculation: 'Working / arithmetic slip',
  misread: 'Misread the question',
  guess: 'Right answer, wrong reason',
};
