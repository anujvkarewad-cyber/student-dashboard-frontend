import { config } from '../config';
import { getSavedSession } from '../storage/session';

export const PRACTICE_AUDIO_BYTES = 2 * 1024 * 1024;
export const PRACTICE_AUDIO_SECONDS = 120;
export const practiceUrl = (path: string) => {
  if (!config.mentorApiUrl) throw new Error('The study backend is not configured. You can still type.');
  return `${config.mentorApiUrl}/api/practice${path}`;
};
export async function practiceSession(scope: 'receipt' | 'workbook' = 'receipt') {
  const saved = await getSavedSession();
  if (!saved?.studentId || !saved.password) throw new Error('Please sign in to use practice tools.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(practiceUrl(scope === 'workbook' ? '/workbooks/session' : '/session'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: saved.studentId, password: saved.password }), signal: controller.signal });
    const data = await r.json();
    if (!r.ok || !data.token) throw new Error(typeof data.detail === 'string' ? data.detail : 'Practice sign-in is unavailable. Your draft is safe.');
    return { token: String(data.token), studentId: String(data.studentId) };
  } finally { clearTimeout(timer); }
}
export async function practiceJson(path: string, body?: unknown) {
  const { token } = await practiceSession();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(practiceUrl(path), { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Practice-Token': token }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Practice processing failed. Keep your draft and retry.');
    return data;
  } finally { clearTimeout(timer); }
}
