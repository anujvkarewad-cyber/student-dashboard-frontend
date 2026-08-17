import { config } from '../config';
import { getSavedSession } from '../storage/session';

type LocalDaily = {
  bankRevision?: string; date: string; group: string; questionIds: string[];
  answers: Record<string, number>; startedAt: number; completedAt?: number;
  score?: number; total?: number; durationSeconds?: number;
};

type LocalPractice = {
  id: string;
  bankRevision?: string;
  config: {
    group: string; subject: string; chapter: string; mode: string;
    difficulty: string; requestedCount: number;
  };
  questionIds: string[]; answers: Record<string, number>; startedAt: number;
  completedAt?: number; score?: number; total?: number; durationSeconds?: number;
};

type CloudAttempt = Record<string, unknown> & { attemptId: string; kind: 'daily' | 'practice' };
type RestoredAttempts = { daily: LocalDaily[]; practice: LocalPractice[] };
let restorePromise: Promise<RestoredAttempts> | null = null;

const post = async <T,>(path: string, payload: Record<string, unknown>): Promise<T> => {
  const session = await getSavedSession();
  if (!session) throw new Error('Student login is required for MCQ cloud backup');
  const response = await fetch(`${config.mentorApiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...session, ...payload }),
  });
  if (!response.ok) throw new Error(`MCQ cloud request failed (${response.status})`);
  return response.json() as Promise<T>;
};

const dailyToCloud = (attempt: LocalDaily): CloudAttempt | null => attempt.completedAt ? {
  attemptId: `daily:${attempt.date}:${attempt.group}`,
  kind: 'daily',
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
} : null;

export const syncCompletedMcqAttempts = async (daily: LocalDaily[] = [], practice: LocalPractice[] = []) => {
  const attempts = [
    ...daily.map(dailyToCloud).filter(Boolean),
    ...practice.map(practiceToCloud).filter(Boolean),
  ] as CloudAttempt[];
  if (!attempts.length) return { ok: true, accepted: 0 };
  return post<{ ok: boolean; accepted: number }>('/api/student-attempts/sync', { attempts });
};

export const restoreMcqAttempts = async (): Promise<RestoredAttempts> => {
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
    const data = await post<{ daily: CloudAttempt[]; practice: CloudAttempt[] }>('/api/student-attempts/restore', {});
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
  try { return await restorePromise; } finally { restorePromise = null; }
};
