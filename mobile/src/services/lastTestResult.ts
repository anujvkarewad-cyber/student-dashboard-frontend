import type { AiMcq, ShortAnswerResult } from '../api/reformApi';

export type TestResultPayload = {
  id: string;
  chapterId: string;
  chapterTitle: string;
  mode: 'quiz' | 'test';
  finishedAt: string;
  mcq: Array<{ question: AiMcq; chosenOptionId: string | null; correct: boolean | null }>;
  short: Array<{ questionId: string; prompt: string; answer: string; result: ShortAnswerResult | null }>;
  scorePct: number | null;
  /** mentor-uploaded test meta (answer key + marking scheme source) */
  testMeta?: { title: string; subject: string; chapter: string; maxMarks: number; obtainedMarks: number; markingScheme: string; durationMin: number };
};

let last: TestResultPayload | null = null;

export const setLastTestResult = (payload: TestResultPayload) => { last = payload; };
export const getLastTestResult = (id?: string): TestResultPayload | null => (!id || last?.id === id ? last : last);
