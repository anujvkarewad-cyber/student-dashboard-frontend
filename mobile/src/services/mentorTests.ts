import { getSavedSession, getSessionGeneration } from '../storage/session';

/**
 * Native Mentor Tests flow (v1.15.0).
 * Mirrors the web contracts exactly:
 *  - Python backend: POST /api/student-tests/list|paper|submit with {studentId, password}
 *  - Apps Script:    {action:'student.test.uploadSubmission', payload:{base64,mimeType,filename}}
 *                    {action:'student.test.record', payload:{...}} (fire-and-forget sheet row)
 * React Native has no CORS, so both are called directly (no /api/proxy hop).
 */
const PYTHON_BACKEND = 'https://ujjwal-pathak-app-566076646952.asia-south1.run.app';
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzyfWa8agayMB0XLjkbfhfj2MdIRElAiY2Wnd7-eQKd1zlMl099ky6Cif06TWydzr8D/exec';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // Apps Script times out above this (web parity)

export type MentorTest = {
  id: string;
  testId: string;
  title: string;
  subject?: string;
  batch?: string;
  group?: string;
  kind?: string;
  hasPaper: boolean;
  hasAnswerSheet: boolean;
  hasMarkingScheme: boolean;
  status?: string;
  attempted: boolean;
  lastScore: number | null;
  lastTotal: number | null;
  maxMarks: number | null;
  instructions: string;
  mentorRemark?: string;
};

export type PaperMeta = {
  previousEvaluation?: { score: number; total?: number } | null;
  previousEvaluationUnavailable?: boolean;
  title?: string;
  subject?: string;
  kind: string;
  maxMarks: number | null;
  durationMinutes: number | null;
  paperUrl: string | null;
  answerSheetUrl: string | null;
  answerSheetText: string;
  markingSchemeUrl: string | null;
  markingSchemeText: string;
  instructions: string;
  mentorRemark?: string;
  questions: McqQuestion[];
};

export type McqQuestion = {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
  marks: number;
  subject?: string;
  chapter?: string;
};

async function creds(): Promise<{ studentId: string; password: string }> {
  const s = await getSavedSession();
  if (!s || !s.studentId || !s.password) throw new Error('Login required');
  return { studentId: s.studentId, password: s.password };
}

async function postJson(url: string, body: unknown, timeoutMs?: number): Promise<any> {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) throw new Error(`Server error (${res.status}). Try again.`);
    return await res.json();
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function listMentorTests(): Promise<MentorTest[]> {
  const c = await creds();
  const data = await postJson(`${PYTHON_BACKEND}/api/student-tests/list`, c);
  const raw: any[] = Array.isArray(data?.tests) ? data.tests : [];
  return raw.map((t): MentorTest => ({
    id: String(t.testId || t.id || t.title || Math.random()),
    testId: String(t.testId || t.id || ''),
    title: String(t.title || 'Untitled test'),
    subject: t.subject ? String(t.subject) : undefined,
    batch: t.batch ? String(t.batch) : undefined,
    group: t.group ? String(t.group) : undefined,
    kind: t.kind ? String(t.kind) : undefined,
    hasPaper: !!t.hasPaper,
    hasAnswerSheet: !!t.hasAnswerSheet,
    hasMarkingScheme: !!t.hasMarkingScheme,
    status: t.status ? String(t.status) : undefined,
    attempted: !!t.attempted,
    lastScore: typeof t.lastScore === 'number' ? t.lastScore : null,
    lastTotal: typeof t.lastTotal === 'number' ? t.lastTotal : null,
    maxMarks: typeof t.maxMarks === 'number' ? t.maxMarks : null,
    instructions: t.instructions ? String(t.instructions) : '',
    mentorRemark: t.mentorRemark ? String(t.mentorRemark) : '',
  }));
}

export async function getPaperMeta(testId: string): Promise<PaperMeta> {
  const c = await creds();
  const data = await postJson(`${PYTHON_BACKEND}/api/student-tests/paper`, { ...c, testId });
  // Backend returns the paper under `test` (web parity: app.js line ~871).
  const meta =
    data?.test && typeof data.test === 'object'
      ? data.test
      : data?.meta && typeof data.meta === 'object'
        ? data.meta
        : data || {};
  // The screen used to forget a confirmed paper submission after reopening:
  // list showed Evaluated, but the detail screen locked the answer key again.
  // Restore only a matching record from the authenticated server list, using
  // the SAME captured credentials. Never infer submission from route params.
  let previousEvaluation: PaperMeta['previousEvaluation'] = null;
  let previousEvaluationUnavailable = false;
  if (meta.kind === 'paper-test') {
    try {
      const listing = await postJson(`${PYTHON_BACKEND}/api/student-tests/list`, c, 8000);
      const previous = Array.isArray(listing?.tests)
        ? listing.tests.find((row: any) => String(row.testId || row.id || '') === testId)
        : null;
      if (previous?.attempted === true && typeof previous.lastScore === 'number' && Number.isFinite(previous.lastScore)) {
        previousEvaluation = {
          score: previous.lastScore,
          total: typeof previous.lastTotal === 'number' && Number.isFinite(previous.lastTotal) ? previous.lastTotal : undefined,
        };
      }
    } catch {
      // A failed status read must never become a fake successful submission.
      previousEvaluationUnavailable = true;
    }
  }
  return {
    previousEvaluation,
    previousEvaluationUnavailable,
    title: meta.title ? String(meta.title) : undefined,
    subject: meta.subject ? String(meta.subject) : undefined,
    kind: String(meta.kind || 'mcq-test'),
    maxMarks: typeof meta.maxMarks === 'number' ? meta.maxMarks : null,
    durationMinutes: typeof meta.durationMinutes === 'number' ? meta.durationMinutes : null,
    paperUrl: meta.paperUrl ? String(meta.paperUrl) : null,
    answerSheetUrl: meta.answerSheetUrl ? String(meta.answerSheetUrl) : null,
    answerSheetText: meta.answerSheetText ? String(meta.answerSheetText) : '',
    markingSchemeUrl: meta.markingSchemeUrl ? String(meta.markingSchemeUrl) : null,
    markingSchemeText: meta.markingScheme ? String(meta.markingScheme) : '',
    instructions: meta.instructions ? String(meta.instructions) : '',
    mentorRemark: meta.mentorRemark ? String(meta.mentorRemark) : '',
    questions: Array.isArray(data?.questions)
      ? data.questions.map((q: any): McqQuestion => ({
          id: String(q.id || ''),
          prompt: String(q.prompt || ''),
          options: Array.isArray(q.options)
            ? q.options.map((o: any) => ({ id: String(o.id || ''), text: String(o.text || '') }))
            : [],
          marks: Number(q.marks || 0),
          subject: q.subject ? String(q.subject) : undefined,
          chapter: q.chapter ? String(q.chapter) : undefined,
        }))
      : [],
  };
}

/** MCQ-type mentor test: server-side grading (web parity). */
export async function submitMcqAnswers(opts: {
  testId: string;
  answers: Record<string, string>;
  durationSeconds?: number;
}): Promise<{ score?: number; total?: number; scorePct?: number; correctCount?: number; title?: string }> {
  const c = await creds();
  const res = await postJson(`${PYTHON_BACKEND}/api/student-tests/submit`, {
    ...c,
    testId: opts.testId,
    answers: opts.answers,
    durationSeconds: opts.durationSeconds || 0,
  });
  if (res?.detail || res?.error) throw new Error(String(res.detail || res.error));
  return res || {};
}

/** Direct Apps Script base64 upload (same payload shape as the web app). Returns the Drive share URL. */
export async function uploadAnswerSheet(opts: {
  base64: string;
  mimeType: string;
  filename: string;
}): Promise<string> {
  const generation = getSessionGeneration();
  const actor = await creds();
  const stillOwner = async () => {
    const current = await getSavedSession();
    return generation === getSessionGeneration() && current?.studentId === actor.studentId && current?.password === actor.password;
  };
  if (!await stillOwner()) throw new Error('Session changed. Keep the original file.');
  // This preserves the existing Script wire contract, NOT proof of Script-side
  // authentication/private ACLs. Those require the authoritative source.
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST', body: JSON.stringify({ action: 'student.test.uploadSubmission', payload: opts }),
  });
  const data = await res.json().catch(() => null);
  if (!await stillOwner()) throw new Error('Session changed. Keep the original file.');
  const result = data?.result;
  const url = typeof result === 'string' ? result : result?.url;
  if (!res.ok || !data || data.error || data.ok === false || data.success === false || result?.error || result?.ok === false || result?.success === false || typeof url !== 'string' || !url.trim()) {
    throw new Error('Upload could not be confirmed. Keep the original file and check before retrying.');
  }
  return url;

}

export async function submitSelfMarks(opts: {
  testId: string;
  selfMarks: number;
  remarks: string;
  answerUrl: string;
}): Promise<{ score?: number; total?: number; scorePct?: number; title?: string }> {
  const c = await creds();
  const res = await postJson(`${PYTHON_BACKEND}/api/student-tests/submit`, {
    ...c,
    testId: opts.testId,
    selfMarks: opts.selfMarks,
    remarks: String(opts.remarks || '').slice(0, 500),
    answerUrl: opts.answerUrl,
  });
  if (res?.detail || res?.error) throw new Error(String(res.detail || res.error));
  // Sheet row for the mentor - fire and forget, never blocks the student (web parity).
  try {
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'student.test.record',
        payload: {
          testId: opts.testId,
          title: res?.title || opts.testId,
          studentId: c.studentId,
          score: res?.score,
          total: res?.total,
          scorePct: res?.scorePct,
          remarks: opts.remarks,
          selfMarks: true,
          answerUrl: opts.answerUrl,
        },
      }),
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
  return res || {};
}

/** Downloads a document into memory and returns base64. Nothing is written to disk (protection). */
export async function fetchPdfBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the document (${res.status})`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // A 200 response can be a login page or HTML error, not the actual PDF.
  const header = String.fromCharCode(...bytes.subarray(0, 1024));
  if (!header.includes('%PDF-')) throw new Error('The attachment did not return a PDF. Ask your mentor to check the file link and access.');
  let bin = '';
  const CH = 32768;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}
