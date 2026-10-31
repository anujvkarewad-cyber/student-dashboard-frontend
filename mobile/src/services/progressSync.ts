// Mentor analytics progress sync (consent-gated, summaries only).
//
// Two endpoints on the mentor (FastAPI) backend:
//   POST /api/consent        — turn sharing ON/OFF for this student
//   POST /api/progress-sync  — upload allowlisted per-chapter MCQ summaries
//
// Privacy: only chapter-level summary fields are sent (chapterId, masteryBand,
// attemptCount, accuracyRange, lastActivityDate, weakConceptTags). Raw answers,
// question text and per-question history NEVER leave the device.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../config';
import { getSavedSession } from '../storage/session';
import type { EnrichedMcqQuestion } from '../data/mcqMetadata';

export type ProgressSummary = {
  studentId: string;
  chapterId: string;
  masteryBand: string;
  attemptCount: number;
  accuracyRange: string;
  lastActivityDate: string;
  weakConceptTags: string[];
};

export type ProgressTrendPoint = {
  weekStart: string;
  chapterId: string;
  masteryBand: string;
  attemptCount: number;
  accuracyRange: string;
};

const CONSENT_KEY = 'ump_mentor_share_progress_v1';

export const getShareChoice = async (studentId: string): Promise<boolean> => {
  try {
    const raw = await AsyncStorage.getItem(`${CONSENT_KEY}:${studentId}`);
    // Default ON — only "0" means the student explicitly turned sharing off.
    return raw !== '0';
  } catch {
    return true;
  }
};

export const storeShareChoice = async (studentId: string, on: boolean) => {
  try {
    if (on) await AsyncStorage.setItem(`${CONSENT_KEY}:${studentId}`, '1');
    else await AsyncStorage.setItem(`${CONSENT_KEY}:${studentId}`, '0');
  } catch {
    /* best-effort local flag */
  }
};

// Keep a stable owner and payload across bounded transient retries. A response
// for a previous account must never update the active account's UI/local flags.
async function postStudentProgress(studentId: string, path: string, payload: unknown) {
  const initial = await getSavedSession();
  if (!initial || initial.studentId !== studentId || !initial.password) throw new Error('Student login required');
  const assertOwner = async () => {
    const current = await getSavedSession();
    if (current?.studentId !== studentId || current?.password !== initial.password) throw new Error('Account changed during progress sync');
  };
  const headers = await studentSyncHeaders(studentId);
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assertOwner();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let response: Response | undefined;
    let data: any = {};
    try {
      response = await fetch(`${config.mentorApiUrl}${path}`, { method: 'POST', headers, body, signal: controller.signal });
      data = await response.json().catch(() => ({}));
    } catch {
      if (attempt === 2) throw new Error('Progress network unavailable; local data retained');
    } finally { clearTimeout(timer); }
    await assertOwner();
    if (response && (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2)) return { response, data };
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw new Error('Progress network unavailable; local data retained');
}

export const setMentorSharing = async (studentId: string, sharing: boolean): Promise<void> => {
  const { response, data } = await postStudentProgress(studentId, '/api/consent', { studentId, sharing, device: `android-v${config.appVersion || '1.10.2'}` });
  if (!response.ok) throw new Error(`Could not ${sharing ? 'enable' : 'disable'} sharing (${response.status}). ${typeof data?.detail === 'string' ? data.detail : ''}`.trim());
  if (data.ok !== true || data.studentId !== studentId || data.sharing !== sharing) throw new Error('Consent acknowledgement incomplete');
  await storeShareChoice(studentId, sharing);
};

export async function studentSyncHeaders(studentId: string) {
  const saved = await getSavedSession();
  if (!saved || saved.studentId !== studentId || !saved.password) throw new Error('Student login required');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${config.mentorApiUrl}/api/student-sync/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ studentId, password: saved.password }),
    });
    if (!response.ok) throw new Error(`Student sync sign-in failed (${response.status})`);
    const data = await response.json();
    const current = await getSavedSession();
    if (!data.token || data.studentId !== studentId || current?.studentId !== studentId || current?.password !== saved.password) throw new Error('Student sync identity changed');
    return { 'Content-Type': 'application/json', 'X-Student-Sync-Token': String(data.token) };
  } finally { clearTimeout(timer); }
}

// ── Aggregation ────────────────────────────────────────────────────────────

const accuracyToBand = (accuracy: number): string => {
  if (accuracy >= 85) return 'Mastered';
  if (accuracy >= 70) return 'Strong';
  if (accuracy >= 50) return 'Medium';
  return 'Weak';
};

const accuracyToRange = (accuracy: number): string => {
  if (accuracy >= 85) return '85-100';
  if (accuracy >= 70) return '70-84';
  if (accuracy >= 50) return '50-69';
  return '0-49';
};

type Session = {
  questionIds: string[];
  answers: Record<string, number>;
  completedAt?: number;
  date?: string;
};

const mondayOf = (timestamp: number): string => {
  const date = new Date(timestamp);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  const start = new Date(date);
  start.setDate(date.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 10);
};

const localDay = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

type AnswerEvent = {
  chapterId: string;
  subject: string;
  chapterTitle: string;
  correct: boolean;
  ts: number;
};

export const buildProgressPayload = (
  studentId: string,
  sessions: Session[],
  questionLookup: Map<string, EnrichedMcqQuestion>,
) => {
  const events: AnswerEvent[] = [];
  for (const session of sessions) {
    if (!session.completedAt) continue;
    for (const questionId of session.questionIds) {
      const answer = session.answers[questionId];
      if (answer === undefined || answer === null) continue;
      const question = questionLookup.get(questionId);
      if (!question?.chapterId) continue;
      events.push({
        chapterId: question.chapterId,
        subject: question.subject,
        chapterTitle: question.chapterTitle || question.chapter || question.subject,
        correct: answer === question.answer,
        ts: session.completedAt,
      });
    }
  }
  if (!events.length) return { summaries: [] as ProgressSummary[], trend: [] as ProgressTrendPoint[] };

  // Per-chapter summary
  const byChapter = new Map<string, { correct: number; answered: number; lastTs: number; subject: string; chapterTitle: string }>();
  for (const event of events) {
    const bucket = byChapter.get(event.chapterId) || { correct: 0, answered: 0, lastTs: 0, subject: event.subject, chapterTitle: event.chapterTitle };
    bucket.correct += event.correct ? 1 : 0;
    bucket.answered += 1;
    bucket.lastTs = Math.max(bucket.lastTs, event.ts);
    byChapter.set(event.chapterId, bucket);
  }

  const summaries: ProgressSummary[] = [];
  for (const [chapterId, bucket] of byChapter) {
    const accuracy = bucket.answered ? (bucket.correct / bucket.answered) * 100 : 0;
    summaries.push({
      studentId,
      chapterId,
      masteryBand: accuracyToBand(accuracy),
      attemptCount: bucket.answered,
      accuracyRange: accuracyToRange(accuracy),
      lastActivityDate: localDay(bucket.lastTs),
      weakConceptTags: accuracy < 50 ? [bucket.subject, bucket.chapterTitle].filter(Boolean).slice(0, 8) : [],
    });
  }

  // Per-chapter weekly trend (drives improvement / at-risk analytics)
  const trend: ProgressTrendPoint[] = [];
  const weekByChapter = new Map<string, Map<string, { correct: number; answered: number }>>();
  for (const event of events) {
    const week = mondayOf(event.ts);
    const weeks = weekByChapter.get(event.chapterId) || new Map<string, { correct: number; answered: number }>();
    const bucket = weeks.get(week) || { correct: 0, answered: 0 };
    bucket.correct += event.correct ? 1 : 0;
    bucket.answered += 1;
    weeks.set(week, bucket);
    weekByChapter.set(event.chapterId, weeks);
  }
  for (const [chapterId, weeks] of weekByChapter) {
    const sorted = [...weeks.keys()].sort().slice(-12);
    for (const week of sorted) {
      const bucket = weeks.get(week)!;
      const accuracy = bucket.answered ? (bucket.correct / bucket.answered) * 100 : 0;
      trend.push({
        weekStart: week,
        chapterId,
        masteryBand: accuracyToBand(accuracy),
        attemptCount: bucket.answered,
        accuracyRange: accuracyToRange(accuracy),
      });
    }
  }
  // Keep the same 94-chapter cap as the backend; sort summaries by chapterId.
  summaries.sort((a, b) => a.chapterId.localeCompare(b.chapterId));
  return { summaries: summaries.slice(0, 94), trend };
};

export const syncProgress = async (studentId: string, summaries: ProgressSummary[], trend: ProgressTrendPoint[]): Promise<{ ok: boolean; accepted?: number }> => {
  if (!summaries.length) return { ok: true, accepted: 0 };
  const { response, data: result } = await postStudentProgress(studentId, '/api/progress-sync', { studentId, summaries, trend });
  if (!response.ok) {
    if (response.status === 403) return { ok: false }; // sharing disabled — silence
    throw new Error(`Progress sync failed (${response.status}). ${typeof result?.detail === 'string' ? result.detail : ''}`.trim());
  }
  if (result.ok !== true || result?.accepted?.summaries !== summaries.length) throw new Error('Progress acknowledgement incomplete');
  return { ok: true, accepted: result.accepted.summaries };
};
