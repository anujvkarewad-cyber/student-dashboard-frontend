import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistent history of every mentor test a student attempts (MCQ tests
 * and paper tests). Powers the Weekly Report ("which tests he gave") and
 * later the mentor dashboard (self-evaluation marks of paper tests).
 */
export type TestHistoryEntry = {
  id: string;
  testId: string;
  kind: 'mcq-test' | 'paper-test';
  title: string;
  subject: string;
  at: string; // ISO timestamp of submission / marks update
  score?: number; // marks obtained (auto for MCQ, self-evaluated for paper)
  total?: number; // max marks
  scorePct?: number; // MCQ only
  selfMarks?: boolean; // true when marks were written by the student himself
  note?: string;
};

const KEY = 'ump_test_history_v1';

export const getTestHistory = async (): Promise<TestHistoryEntry[]> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as TestHistoryEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const addTestHistory = async (entry: TestHistoryEntry): Promise<void> => {
  try {
    const list = await getTestHistory();
    // Paper tests: one attempt per test (submission + self marks update in place).
    // MCQ tests: every attempt is recorded separately.
    const next = entry.kind === 'paper-test'
      ? list.filter((e) => e.testId !== entry.testId)
      : list;
    next.unshift(entry);
    await AsyncStorage.setItem(KEY, JSON.stringify(next.slice(0, 300)));
  } catch {
    /* non-fatal */
  }
};
