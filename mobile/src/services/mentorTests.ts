import { getSavedSession } from '../storage/session';

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
};

export type PaperMeta = {
  title?: string;
  subject?: string;
  maxMarks: number | null;
  durationMinutes: number | null;
  paperUrl: string | null;
  answerSheetUrl: string | null;
  markingSchemeUrl: string | null;
  instructions: string;
};

async function creds(): Promise<{ studentId: string; password: string }> {
  const s = await getSavedSession();
  if (!s || !s.studentId || !s.password) throw new Error('Login required');
  return { studentId: s.studentId, password: s.password };
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server error (${res.status}). Try again.`);
  return res.json();
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
  }));
}

export async function getPaperMeta(testId: string): Promise<PaperMeta> {
  const c = await creds();
  const data = await postJson(`${PYTHON_BACKEND}/api/student-tests/paper`, { ...c, testId });
  const meta = data?.meta && typeof data.meta === 'object' ? data.meta : data || {};
  return {
    title: meta.title ? String(meta.title) : undefined,
    subject: meta.subject ? String(meta.subject) : undefined,
    maxMarks: typeof meta.maxMarks === 'number' ? meta.maxMarks : null,
    durationMinutes: typeof meta.durationMinutes === 'number' ? meta.durationMinutes : null,
    paperUrl: meta.paperUrl ? String(meta.paperUrl) : null,
    answerSheetUrl: meta.answerSheetUrl ? String(meta.answerSheetUrl) : null,
    markingSchemeUrl: meta.markingSchemeUrl ? String(meta.markingSchemeUrl) : null,
    instructions: meta.instructions ? String(meta.instructions) : '',
  };
}

/** Direct Apps Script base64 upload (same payload shape as the web app). Returns the Drive share URL. */
export async function uploadAnswerSheet(opts: {
  base64: string;
  mimeType: string;
  filename: string;
}): Promise<string> {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'student.test.uploadSubmission', payload: opts }),
  });
  const data = await res.json().catch(() => null);
  if (!data || data.error) throw new Error(data?.error ? String(data.error) : 'Upload failed. Try again.');
  const url = data?.result?.url || (typeof data?.result === 'string' ? data.result : '');
  if (!url) throw new Error('Upload finished but no file link came back. Try again.');
  return String(url);
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
  let bin = '';
  const CH = 32768;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}
