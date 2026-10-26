import { config } from '../config';
import { getSavedSession, getSessionGeneration } from '../storage/session';

export type SmartBinding = {
  ownerId: string; subject: string; concept: string;
  planId?: string; taskId?: string; revisionKey?: string; revisionVersion?: number;
};
export type SmartTask = { id: string; subject: string; topic: string; hours?: number; mandatory: boolean; done: boolean };
export type SmartDay = { day: number; scheduledDate: string; nominalDate: string; projectedDate: string; completedOn?: string; done: boolean; locked: boolean; taskCount: number; tasks: SmartTask[] };
export type Extension = { id: string; requestedDays: number; approvedDays?: number; status: string; reason: string; note?: string };
export type SmartProgress = {
  planId: string; name: string; studentId: string; startDate: string; totalDays: number; currentDay: number;
  completedDays: number; completedTasks: number; totalTasks: number; progressPercent: number;
  complete: boolean; canWork: boolean; overdueDays: number; extensionDaysNeeded: number;
  backupDaysUsed: number; backupDaysRemaining: number; includedBackupDays: number;
  approvedExtensionDays: number; extensionDaysUsed: number; extensionDaysRemaining: number;
  deadline: string; projectedFinishDate: string; remainingCalendarDays: number;
  extensions: Extension[]; days: SmartDay[];
};
export type CloudChapter = { revisionKey: string; revisionVersion: number; subject: string; concept: string; strength: string; accuracy: number; questionAccuracy: number | null; questionAttemptedTotal: number; dueOn: string; lastAssessmentSource: string; lastRevisionCompletedAt?: string; suggestedToday?: boolean };
export type SmartDashboard = { today: string; studentId: string; targetAccessError?: string; plans: { planId: string; name: string; startAvailableOn: string; includedBackupDays: number; totalDays: number; progress: SmartProgress | null }[]; history: SmartProgress[]; revisions: { chapters: CloudChapter[]; due: CloudChapter[]; budgetMinutes: number; suggestedMinutes: number; additionalDueCount: number } };

/** No silent null/success or offline tick: the server is authoritative. */
export async function smartTargetRequest<T = any>(ownerId: string, action: string, payload: Record<string, unknown> = {}, allowWrite = false): Promise<T> {
  if (!['dashboard', 'session'].includes(action) && !allowWrite) throw new Error('Switch to Full Live before saving target progress.');
  const generation = getSessionGeneration();
  const credentials = await getSavedSession();
  if (!credentials?.password || credentials.studentId !== ownerId || generation !== getSessionGeneration()) throw new Error('Please sign in again.');
  if (!config.mentorApiUrl) throw new Error('Target server is not configured.');
  const stillOwner = async () => {
    const current = await getSavedSession();
    return generation === getSessionGeneration() && current?.studentId === ownerId && current.password === credentials.password;
  };
  const routeUnavailable = (status: number) => new Error(`Personal target service is unavailable on the configured server (HTTP ${status}). No successful result was confirmed.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    if (!await stillOwner()) throw new Error('Account changed. Reload your targets.');
    const response = await fetch(`${config.mentorApiUrl}/api/smart-targets/student/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ ...payload, studentId: credentials.studentId, password: credentials.password }),
    });
    let data;
    try { data = await response.json(); }
    catch {
      if (!await stillOwner()) throw new Error('Account changed. Reload your targets.');
      if (response.status === 404 || response.status === 405) throw routeUnavailable(response.status);
      throw new Error('Target server returned an unreadable response. No successful result was confirmed.');
    }
    if (!await stillOwner()) throw new Error('Account changed. Reload your targets.');
    // A missing POST API can be shadowed by an older backend's GET-only route.
    // Never retry as GET, switch providers, or turn this into an empty dashboard.
    if (response.status === 404 || response.status === 405) throw routeUnavailable(response.status);
    if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Target request failed. Refresh and retry.');
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Request timed out. Refresh to check what was saved before retrying.');
    throw error;
  } finally { clearTimeout(timeout); }
}

/** Same conservative subject aliases as Target Plans; no fuzzy chapter merging. */
export function chapterIdentity(subject: string, concept: string): string {
  const text = String(subject || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const hints: [string[], string][] = [
    [['cost', 'costing', 'cm'], 'Cost and Management Accounting'],
    [['audit', 'auditing'], 'Auditing and Assurance'],
    [['account', 'accounting', 'as '], 'Advanced Accounting'],
    [['law', 'legal'], 'Corporate and Other Laws'],
    [['tax', 'taxation', 'gst', 'dt'], 'Taxation'],
    [['fm', 'sm', 'financial', 'strategic'], 'Financial Management and Strategic Management'],
  ];
  const canonical = hints.find(([keys]) => keys.some(key => text.startsWith(key) || text.includes(` ${key}`) || text === key))?.[1] || text;
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${normalize(canonical)}:${normalize(concept)}`;
}
