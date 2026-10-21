import { config } from '../config';
import { getSavedSession } from '../storage/session';

type McqReviewItem = {
  id: string; prompt: string; options: string[]; answer: number;
  selected?: number | null; explanation?: string; subject?: string;
  chapter?: string; difficulty?: string; kind?: string; correct?: boolean;
};

type LocalDaily = {
  officialSetId?: string; bankRevision?: string; date: string; group: string; questionIds: string[];
  answers: Record<string, number>; startedAt: number; completedAt?: number;
  score?: number; total?: number; durationSeconds?: number; review?: McqReviewItem[];
};

type LocalPractice = {
  id: string;
  bankRevision?: string;
  config: {
    group: string; subject: string; chapter: string; mode: string;
    difficulty: string; requestedCount: number;
  };
  questionIds: string[]; answers: Record<string, number>; startedAt: number;
  completedAt?: number; score?: number; total?: number; durationSeconds?: number; review?: McqReviewItem[];
};

type CloudAttempt = Record<string, unknown> & { attemptId: string; kind: 'daily' | 'practice' };
type RestoredAttempts = { daily: LocalDaily[]; practice: LocalPractice[] };
const restores = new Map<string, Promise<RestoredAttempts>>();

const post = async <T,>(path: string, payload: Record<string, unknown>, expectedOwner?: string): Promise<T> => {
  const session = await getSavedSession();
  if (!session?.studentId || !session.password) throw new Error('Student login is required for MCQ cloud backup');
  if (expectedOwner && session.studentId !== expectedOwner) throw new Error("Account changed before MCQ sync");
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const active = await getSavedSession();
    if (active?.studentId !== session.studentId || active?.password !== session.password) throw new Error('Account changed during MCQ sync');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      response = await fetch(`${config.mentorApiUrl}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ ...payload, studentId: session.studentId, password: session.password }),
      });
    } catch (error) {
      if (attempt === 2) throw new Error('MCQ network unavailable; local attempts are retained');
    } finally { clearTimeout(timer); }
    if (response?.ok) break;
    if (response && ![408,429,500,502,503,504].includes(response.status)) break;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    response = attempt < 2 ? undefined : response;
  }
  if (!response?.ok) throw new Error(`MCQ cloud request failed (${response?.status || 'network'}); local attempts are retained`);
  const data = await response.json();
  const current = await getSavedSession();
  if (current?.studentId !== session.studentId || current?.password !== session.password) throw new Error('Account changed during MCQ sync');
  return data as T;
};

const dailyToCloud = (attempt: LocalDaily): CloudAttempt | null => attempt.completedAt ? {
  attemptId: `daily:${attempt.date}:${attempt.group}`,
  kind: 'daily',
  ...(attempt.officialSetId ? { officialSetId: attempt.officialSetId } : {}),
  bankRevision: attempt.bankRevision || 'unknown',
  date: attempt.date,
  group: attempt.group,
  questionIds: attempt.questionIds,
  answers: attempt.answers,
  startedAt: attempt.startedAt,
  completedAt: attempt.completedAt,
  score: attempt.score || 0,
  total: attempt.total || attempt.questionIds.length,
  durationSeconds: attempt.durationSeconds || 0,
  review: attempt.review || [],
} : null;

const practiceToCloud = (attempt: LocalPractice): CloudAttempt | null => attempt.completedAt ? {
  attemptId: attempt.id,
  kind: 'practice',
  bankRevision: attempt.bankRevision || 'unknown',
  config: attempt.config,
  questionIds: attempt.questionIds,
  answers: attempt.answers,
  startedAt: attempt.startedAt,
  completedAt: attempt.completedAt,
  score: attempt.score || 0,
  total: attempt.total || attempt.questionIds.length,
  durationSeconds: attempt.durationSeconds || 0,
  review: attempt.review || [],
} : null;

export const syncCompletedMcqAttempts = async (daily: LocalDaily[] = [], practice: LocalPractice[] = [], expectedOwner?: string) => {
  const attempts = [
    ...daily.map(dailyToCloud).filter(Boolean),
    ...practice.map(practiceToCloud).filter(Boolean),
  ] as CloudAttempt[];
  if (!attempts.length) return { ok: true, accepted: 0 };
  let accepted = 0;
  for (let offset = 0; offset < attempts.length; offset += 100) {
    const batch = attempts.slice(offset, offset + 100);
    const ack = await post<{ ok: boolean; accepted: number }>('/api/student-attempts/sync', { attempts: batch }, expectedOwner);
    if (ack.ok !== true || ack.accepted !== batch.length) throw new Error('MCQ backup acknowledgement incomplete; local attempts retained');
    accepted += ack.accepted;
  }
  return { ok: true, accepted };
};

export const restoreMcqAttempts = async (): Promise<RestoredAttempts> => {
  const owner = (await getSavedSession())?.studentId;
  if (!owner) throw new Error('Student login required');
  if (restores.has(owner)) return restores.get(owner)!;
  const restorePromise = (async () => {
    const data = await post<{ daily: CloudAttempt[]; practice: CloudAttempt[] }>('/api/student-attempts/restore', {}, owner);
    return {
      daily: (data.daily || []).map((item) => {
        const { attemptId: _attemptId, kind: _kind, ...attempt } = item;
        return attempt as LocalDaily;
      }),
      practice: (data.practice || []).map((item) => {
        const { attemptId, kind: _kind, ...attempt } = item;
        return { ...attempt, id: attemptId } as LocalPractice;
      }),
    };
  })();
  restores.set(owner, restorePromise);
  try { return await restorePromise; } finally { if (restores.get(owner) === restorePromise) restores.delete(owner); }
};


export const fetchOfficialDailySet = (group: string, expectedOwner: string) => post<{
  officialSetId: string; date: string; group: string; bankRevision: string;
  questionIds: string[]; questions: import('../data/mcqMetadata').EnrichedMcqQuestion[]; issuedAt: number;
}>('/api/student-attempts/daily-set', { group }, expectedOwner);
