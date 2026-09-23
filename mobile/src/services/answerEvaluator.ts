/**
 * Written-answer grading.
 *
 * Multiple choice already knows right from wrong. This is the other half: a
 * student writes an answer the way the real paper demands, and gets marked
 * strictly, with the points they missed and a model answer to compare against.
 *
 * The backend never invents a mark. When it cannot grade, this reports that
 * plainly so the screen can offer a retry - a guessed score would be stored and
 * would then drive the student's revision schedule.
 */
import { config } from '../config';

export type EvaluationResult = {
  ok: true;
  mode: 'graded';
  score: number;
  accuracyPct: number;
  verdict: 'Insufficient' | 'Weak' | 'Average' | 'Good' | 'Exam-ready';
  missingKeyPoints: string[];
  conceptualMistakes: string[];
  keywordsExpected: string[];
  keywordsPresent: string[];
  strengths: string[];
  modelAnswer: string;
  improvementAdvice: string[];
  subject?: string;
  model?: string;
};

export type EvaluationFailure = {
  ok: false;
  mode: 'unavailable' | 'offline';
  error: string;
};

export type EvaluationOutcome = EvaluationResult | EvaluationFailure;

export type EvaluateInput = {
  studentId: string;
  question: string;
  studentAnswer: string;
  subject?: string;
  chapterId?: string;
  /** The concept this answer is being tested on, so the mark can drive it. */
  concept?: string;
};

const TIMEOUT_MS = 60_000;

/**
 * A written answer is long, so the wait is longer than a lookup. The screen
 * shows progress state rather than a spinner over a frozen form.
 */
export const evaluateAnswer = async (input: EvaluateInput): Promise<EvaluationOutcome> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.mentorApiUrl}/api/ai/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        studentId: input.studentId,
        question: input.question.trim(),
        studentAnswer: input.studentAnswer.trim(),
        subject: input.subject,
        chapterId: input.chapterId,
        concept: input.concept,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        mode: 'unavailable',
        error: `The marker is unavailable right now (HTTP ${response.status}). Please try again.`,
      };
    }

    const data = await response.json();
    if (!data || data.ok !== true) {
      return {
        ok: false,
        mode: 'unavailable',
        error: (data && data.error) || 'Could not grade this answer. Please try again.',
      };
    }

    return {
      ok: true,
      mode: 'graded',
      score: Number(data.score) || 0,
      accuracyPct: Number(data.accuracyPct) || 0,
      verdict: data.verdict || 'Average',
      missingKeyPoints: data.missingKeyPoints || [],
      conceptualMistakes: data.conceptualMistakes || [],
      keywordsExpected: data.keywordsExpected || [],
      keywordsPresent: data.keywordsPresent || [],
      strengths: data.strengths || [],
      modelAnswer: data.modelAnswer || '',
      improvementAdvice: data.improvementAdvice || [],
      subject: data.subject,
      model: data.model,
    };
  } catch (reason) {
    const aborted = reason instanceof Error && reason.name === 'AbortError';
    return {
      ok: false,
      mode: 'offline',
      error: aborted
        ? 'The marker took too long to respond. Please try again.'
        : 'The marker could not be reached. Check your connection and try again.',
    };
  } finally {
    clearTimeout(timer);
  }
};

/** Colour a verdict consistently everywhere it is shown. */
export const VERDICT_TONE: Record<EvaluationResult['verdict'], { bg: string; fg: string }> = {
  Insufficient: { bg: '#FDECEC', fg: '#B3261E' },
  Weak: { bg: '#FDECEC', fg: '#B3261E' },
  Average: { bg: '#FFF4E0', fg: '#9A6400' },
  Good: { bg: '#E7F6EC', fg: '#1B7F3B' },
  'Exam-ready': { bg: '#E7F6EC', fg: '#15703A' },
};

/** Terms the examiner expected but the answer never used. */
export const missedKeywords = (result: EvaluationResult): string[] => {
  const used = new Set(result.keywordsPresent.map((k) => k.toLowerCase()));
  return result.keywordsExpected.filter((k) => !used.has(k.toLowerCase()));
};
