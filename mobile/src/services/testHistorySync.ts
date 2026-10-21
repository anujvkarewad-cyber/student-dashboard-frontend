// Uploads the student's mentor-test history to the mentor dashboard backend.
//
//   POST {mentorApiUrl}/api/test-history/sync
//
// Contract mirrors progressSync.ts:
//   - only when the student has consented (Profile → share progress)
//   - short-lived student-bound credential-verified session
//   - payload is the allowlisted TestHistoryEntry shape (no raw answers)
// The backend upserts per student+test+entry, so re-sending the full local
// history is safe and idempotent (paper-test marks updates replace in place).
import { config } from '../config';
import { getShareChoice, studentSyncHeaders } from './progressSync';
import { getTestHistory } from './testHistory';

export type SyncableStudent = {
  studentId: string;
  studentName?: string;
  name?: string;
  batch?: string;
};

export const syncTestHistory = async (student: SyncableStudent | null | undefined): Promise<boolean> => {
  if (!student?.studentId) return false;
  try {
    const sharing = await getShareChoice(student.studentId);
    if (!sharing) return false;

    const entries = await getTestHistory();
    if (!entries.length) return false;

    const response = await fetch(`${config.mentorApiUrl}/api/test-history/sync`, {
      method: 'POST',
      headers: await studentSyncHeaders(student.studentId),
      body: JSON.stringify({
        studentId: student.studentId,
        studentName: student.studentName || student.name || undefined,
        batch: student.batch || undefined,
        entries: entries.slice(0, 300).map((e) => ({
          id: e.id,
          testId: e.testId,
          kind: e.kind,
          title: e.title,
          subject: e.subject || undefined,
          at: e.at,
          score: e.score ?? undefined,
          total: e.total ?? undefined,
          scorePct: e.scorePct ?? undefined,
          selfMarks: e.selfMarks ?? undefined,
          note: e.note ?? undefined,
        })),
      }),
    });
    // 429 (rate limited) and 403 (consent off server-side) are fine — retry later.
    return response.ok;
  } catch {
    return false;
  }
};

/** Fire-and-forget variant for UI call sites. */
export const syncTestHistorySoon = (student: SyncableStudent | null | undefined) => {
  syncTestHistory(student).catch(() => undefined);
};
