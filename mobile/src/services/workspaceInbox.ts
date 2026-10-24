// Secure read-only compatibility for mentor-workspace private messages/announcements.
// No writes/retries, no persistent token, and no account-ID-only private fallback.
import { config } from '../config';
import { getSavedSession, subscribeSessionInvalidation, getSessionGeneration } from '../storage/session';

subscribeSessionInvalidation(() => { cached = null; });
let cached: { studentId: string; password: string; token: string; expiresAt: number } | null = null;
export async function readWorkspaceInbox<T>(section: 'messages' | 'announcements', expectedStudentId?: string): Promise<T | null> {
  const epoch = getSessionGeneration();
  const session = await getSavedSession();
  if (!session?.studentId || !session.password || (expectedStudentId && session.studentId !== expectedStudentId)) { cached = null; return null; }
  const unchanged = async () => {
    const active = await getSavedSession();
    return epoch === getSessionGeneration() && active?.studentId === session.studentId && active.password === session.password;
  };
  const base = `${config.mentorApiUrl}/api/mentor-workspace/student`;
  try {
    if (!cached || cached.studentId !== session.studentId || cached.password !== session.password || cached.expiresAt < Date.now()) {
      cached = null;
      const auth = await fetch(`${base}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: session.studentId, password: session.password }), signal: AbortSignal.timeout(config.requestTimeoutMs) });
      if (!auth.ok) return null;
      const proof = await auth.json();
      if (proof.studentId !== session.studentId || typeof proof.token !== 'string' || !proof.token || !await unchanged()) return null;
      cached = { studentId: session.studentId, password: session.password, token: proof.token, expiresAt: Date.now() + 12 * 60 * 1000 };
    }
    const response = await fetch(`${base}/${section}`, { headers: { 'X-Workspace-Token': cached.token }, signal: AbortSignal.timeout(config.requestTimeoutMs) });
    if (!response.ok) { if (response.status === 401 || response.status === 403) cached = null; return null; }
    const data = await response.json();
    if (data.studentId !== session.studentId || !await unchanged()) { cached = null; return null; }
    return data as T;
  } catch { return null; }
}
