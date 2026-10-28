import { getSavedSession, getSessionGeneration, clearSavedSession } from '../storage/session';
import { readWorkspaceInbox } from '../services/workspaceInbox';
import { config } from '../config';

/**
 * v1.11.0 Reform API client.
 * All calls go through the Cloudflare gateway (`/api/mentor/*`); the upstream
 * origin and AI credentials remain encrypted server-side. Every helper returns
 * `null` when a route is unavailable, so the UI can show a friendly setup state
 * instead of crashing.
 */

export type AiMcq = {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionId?: string;
  explanation?: string;
  markingScheme?: string;
  difficulty: 'easy' | 'moderate' | 'hard';
};

export type ShortAnswerResult = {
  score: number; // 0..5
  covered: string[];
  missed: string[];
  modelAnswer: string;
};

export type DailyTarget = {
  id: string;
  label: string;
  detail: string;
  kind: 'chapter' | 'mcq' | 'tracker' | 'revise';
  chapterId?: string;
  done: boolean;
};

export type ChatMessage = {
  id: string;
  from: 'student' | 'mentor';
  text: string;
  at: string;
};

type FetchOpts = { method?: 'GET' | 'POST'; body?: unknown };

async function mentorFetch<T>(path: string, opts: FetchOpts = {}): Promise<T | null> {
  try {
    const protectedCall = ['/api/messages/','/api/ai/','/api/revision/','/api/targets/complete','/api/student-auth/whatsapp','/api/student-auth/reminder-notify'].some(prefix => path.startsWith(prefix));
    const epoch = getSessionGeneration();
    const session = protectedCall ? await getSavedSession() : null;
    if (protectedCall && (!session?.studentId || !session.password || epoch !== getSessionGeneration())) return null;
    const queryOwner = /[?&]studentId=([^&]+)/.exec(path)?.[1];
    if (session && queryOwner && decodeURIComponent(queryOwner).trim().toUpperCase() !== session.studentId.trim().toUpperCase()) return null;
    const bodyOwner = (opts.body as { studentId?: string } | undefined)?.studentId;
    if (session && bodyOwner && bodyOwner.trim().toUpperCase() !== session.studentId.trim().toUpperCase()) return null;
    const res = await fetch(`${config.mentorApiUrl}${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(session ? {'X-Student-Id':session.studentId, 'X-Session-Password':session.password} : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    if (protectedCall && epoch !== getSessionGeneration()) return null;
    if (protectedCall && [401,403].includes(res.status)) { await clearSavedSession(); return null; }
    if (res.status === 404) return null; // route not deployed yet
    if (!res.ok) return null;
    const data = await res.json();
    if (protectedCall && epoch !== getSessionGeneration()) return null;
    return data as T;
  } catch {
    return null;
  }
}

/** AI chapter quiz — questions generated from the student's finished chapter. */
export const fetchChapterQuiz = (studentId: string, chapterId: string, mode: 'quiz' | 'test') =>
  mentorFetch<{ questions: AiMcq[]; shortQuestions: { id: string; prompt: string }[] }>(
    `/api/ai/chapter-quiz`,
    { method: 'POST', body: { studentId, chapterId, mode } },
  );

/** AI evaluates a student's short answer against key points. */
export const evaluateShortAnswer = (studentId: string, chapterId: string, questionId: string, answer: string) =>
  mentorFetch<ShortAnswerResult>(`/api/ai/evaluate-short`, {
    method: 'POST',
    body: { studentId, chapterId, questionId, answer },
  });

/** Today's AI-generated target list (locked until yesterday done). */
export const fetchDailyTarget = (studentId: string) =>
  mentorFetch<{ date: string; tasks: DailyTarget[]; locked: boolean; lockReason?: string }>(
    `/api/ai/daily-target?studentId=${encodeURIComponent(studentId)}`,
  );

export const completeTargetTask = (studentId: string, taskId: string) =>
  mentorFetch<{ ok: boolean }>(`/api/targets/complete`, { method: 'POST', body: { studentId, taskId } });

/** The whole published plan, day by day, so the app can show every published day. */
export type PlanDayTask = { id: string; label: string; detail: string; kind: string; done: boolean };
export type PlanDay = {
  planId: string;
  planName: string;
  day: number | null;
  date: string;
  isToday: boolean;
  tasks: PlanDayTask[];
};
export const fetchTargetPlanDays = (studentId: string) =>
  mentorFetch<{ today: string; days: PlanDay[] }>(
    `/api/ai/target-plan-days?studentId=${encodeURIComponent(studentId)}`,
  );

/** One earlier turn of the AI conversation, sent so follow-ups stay in context. */
export type AiTurn = { role: 'user' | 'assistant'; text: string };

export type AiAnswer = {
  answer: string;
  /** Which ICAI skeleton the backend used: theory | practical | distinguish | case_study */
  answerFormat?: string;
  /** How well the retrieved module material covered the question: full | partial | general */
  grounding?: string;
  mode?: string;
};

/**
 * Free-form syllabus doubt → Groq RAG over ICAI modules (live mode).
 *
 * `history` carries the previous turns of this chat so the student can ask
 * follow-ups like "explain more", "give an example" or "what about for a
 * private company?" and the backend keeps the thread's context.
 */
/** A photographed question, or a small file the student picked. */
export type AiAttachment = {
  kind: 'image' | 'file';
  name: string;
  mime: string;
  /** base64, with no "data:" prefix. */
  data: string;
};

export const askAi = (
  studentId: string,
  question: string,
  chapterId?: string,
  history?: AiTurn[],
  attachment?: AiAttachment | null,
) =>
  mentorFetch<AiAnswer>(`/api/ai/ask`, {
    method: 'POST',
    // Only the last 8 turns are sent - enough for context, small enough to be fast.
    body: { studentId, question, chapterId, history: history?.slice(-8), attachment },
  });

/** Student ↔ mentor messenger thread. */
export const fetchMessages = async (studentId: string) =>
  // A rejected/unavailable scoped reader must never fall back to an ID-only thread.
  await readWorkspaceInbox<{ studentId: string; messages: ChatMessage[] }>('messages', studentId);

export const sendMessage = (studentId: string, text: string, studentName?: string, batch?: string) =>
  mentorFetch<{ ok: boolean; message: ChatMessage }>(`/api/messages/send`, {
    method: 'POST',
    body: { studentId, text, studentName, batch },
  });

// ── WhatsApp number fit (enrollment, reminders, announcements) ────────────
export const saveWhatsAppNumber = (studentId: string, number: string) =>
  mentorFetch<{ result?: { success?: boolean; whatsapp?: string; message?: string } }>('/api/student-auth/whatsapp', { method: 'POST', body: { studentId, number } });

export const notifyReminderWhatsApp = (studentId: string, text: string) =>
  mentorFetch<{ result?: { success?: boolean } }>('/api/student-auth/reminder-notify', { method: 'POST', body: { studentId, text } });
