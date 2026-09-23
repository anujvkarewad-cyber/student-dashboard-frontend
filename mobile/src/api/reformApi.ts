import { config } from '../config';

/**
 * v1.11.0 Reform API client.
 * All calls go to the Render mentor API (`/api/ai/*`, `/api/targets/*`,
 * `/api/messages/*`). Every helper returns `null` when the backend route is
 * not deployed yet, so the UI can show a friendly "setup pending" state
 * instead of crashing. Secrets (GROQ_API_KEY) live ONLY in Render env vars.
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
    const res = await fetch(`${config.mentorApiUrl}${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    if (res.status === 404) return null; // route not deployed yet
    if (!res.ok) return null;
    return (await res.json()) as T;
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
export const fetchMessages = (studentId: string) =>
  mentorFetch<{ messages: ChatMessage[] }>(`/api/messages/thread?studentId=${encodeURIComponent(studentId)}`);

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
