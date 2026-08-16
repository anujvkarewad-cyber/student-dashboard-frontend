import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import type { FocusSession } from './FocusTimerContext';

export type RecallConfidence = 'Low' | 'Medium' | 'High';

export type RecallQuestion = {
  id: string;
  prompt: string;
  helper: string;
};

export type RecallAnswer = RecallQuestion & {
  response: string;
};

export type RetentionReview = {
  response: string;
  confidence: RecallConfidence;
  selfReportedScore: number;
  completedAt: number;
};

export type StudyReceipt = {
  id: string;
  sessionId: string;
  subject: string;
  target: string;
  focusedSeconds: number;
  sessionStartedAt: number;
  sessionEndedAt: number;
  questions: RecallQuestion[];
  answers: RecallAnswer[];
  confidence: RecallConfidence;
  recallEffortScore: number;
  source: 'self-recall';
  createdAt: number;
  nextReviewAt: number;
  review?: RetentionReview;
};

type StudyReceiptsValue = {
  hydrated: boolean;
  receipts: StudyReceipt[];
  dueReceipts: StudyReceipt[];
  buildQuestions: (session: FocusSession) => RecallQuestion[];
  createReceipt: (session: FocusSession, answers: RecallAnswer[], confidence: RecallConfidence) => Promise<StudyReceipt>;
  completeReview: (receiptId: string, response: string, confidence: RecallConfidence) => Promise<StudyReceipt | null>;
  receiptForSession: (sessionId: string) => StudyReceipt | undefined;
};

const StudyReceiptsContext = createContext<StudyReceiptsValue | undefined>(undefined);
const storageKey = (studentId: string) => `ump_study_receipts_${studentId}`;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RecallSessionKind = 'mock' | 'revision' | 'subject';

const sessionKind = (session: FocusSession): RecallSessionKind => {
  const subject = String(session.subject || '').trim().toLowerCase();
  if (subject === 'mock test' || subject === 'mock') return 'mock';
  if (subject === 'revision') return 'revision';
  return 'subject';
};

// Recall prompts adapt to the session type selected in the Focus Room so a
// Mock Test session never shows generic "main concept" prompts and a Revision
// session asks about re-revision plans instead of first-time learning.
// Keep this logic in sync with the web client (learning-tools.js).
const questionSet = (session: FocusSession): RecallQuestion[] => {
  const target = session.target?.trim() || session.subject;
  const kind = sessionKind(session);
  const typedTarget = String(session.target || '').trim();
  const targetSuffix = typedTarget && typedTarget.toLowerCase() !== String(session.subject).toLowerCase()
    ? ` for “${typedTarget}”`
    : '';

  if (kind === 'mock') {
    return [
      {
        id: `${session.id}:mock-attempt`,
        prompt: `Which mock test or paper did you attempt${targetSuffix}?`,
        helper: 'Name the mock series, paper and section you attempted.',
      },
      {
        id: `${session.id}:mock-performance`,
        prompt: 'How did the exam go overall, and how many questions did you attempt?',
        helper: 'Include how you felt about accuracy and whether you reached every question.',
      },
      {
        id: `${session.id}:mock-difficulty`,
        prompt: 'Which section felt the most difficult, and why?',
        helper: 'Name the topics or question types that slowed you down.',
      },
      {
        id: `${session.id}:mock-time`,
        prompt: 'How was your time management during the mock?',
        helper: 'Note where you spent too much or too little time.',
      },
      {
        id: `${session.id}:mock-improve`,
        prompt: 'What mistakes did you make, and what will you improve in your next mock?',
        helper: 'Be specific — silly errors, concept gaps or presentation issues.',
      },
    ];
  }

  if (kind === 'revision') {
    return [
      {
        id: `${session.id}:revise-topics`,
        prompt: `Which chapters or topics did you revise${targetSuffix}?`,
        helper: 'List the chapters, topics or past questions you covered.',
      },
      {
        id: `${session.id}:revise-recall`,
        prompt: 'Without opening your notes, what were you able to recall?',
        helper: 'Write the points that came back to you from memory first.',
      },
      {
        id: `${session.id}:revise-gaps`,
        prompt: 'Which concepts, formulas or rules do you still need to revise again?',
        helper: 'Note the weak spots you noticed during recall.',
      },
      {
        id: `${session.id}:revise-next`,
        prompt: 'When will you do your next revision of this material?',
        helper: 'Pick a realistic date or day and stick to it.',
      },
    ];
  }

  return [
    {
      id: `${session.id}:core`,
      prompt: `In your own words, explain the main concept you studied about “${target}” in this ${session.subject} session.`,
      helper: 'Write it as if you were teaching a junior student.',
    },
    {
      id: `${session.id}:details`,
      prompt: `Recall the important rules, provisions, formulas or steps from this ${session.subject} session.`,
      helper: 'Short bullet-style answers are enough.',
    },
    {
      id: `${session.id}:application`,
      prompt: 'What is one mistake you could make on this topic in the exam, and how would you avoid it?',
      helper: 'Use your own words. Accuracy verification will come from mentor-approved sources later.',
    },
  ];
};

const answerEffort = (response: string) => {
  const length = response.trim().length;
  if (length >= 120) return 100;
  if (length >= 60) return 85;
  if (length >= 25) return 65;
  if (length > 0) return 35;
  return 0;
};

const recallEffort = (answers: RecallAnswer[]) => Math.round(
  answers.reduce((total, answer) => total + answerEffort(answer.response), 0) / Math.max(answers.length, 1),
);

const reviewScore = (response: string, confidence: RecallConfidence) => {
  const confidenceBase = confidence === 'High' ? 85 : confidence === 'Medium' ? 65 : 40;
  const detailBonus = response.trim().length >= 100 ? 10 : response.trim().length >= 40 ? 5 : 0;
  return Math.min(100, confidenceBase + detailBonus);
};

export const StudyReceiptsProvider = ({ children }: PropsWithChildren) => {
  const { student } = useAuth();
  const [receipts, setReceipts] = useState<StudyReceipt[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    setHydrated(false);
    if (!student) {
      setReceipts([]);
      return;
    }
    AsyncStorage.getItem(storageKey(student.studentId)).then((saved) => {
      if (!mounted) return;
      try { setReceipts(saved ? JSON.parse(saved) as StudyReceipt[] : []); }
      catch { setReceipts([]); }
      setHydrated(true);
    });
    return () => { mounted = false; };
  }, [student]);

  const persist = useCallback(async (next: StudyReceipt[]) => {
    setReceipts(next);
    if (student) await AsyncStorage.setItem(storageKey(student.studentId), JSON.stringify(next.slice(0, 250)));
  }, [student]);

  const createReceipt = useCallback(async (session: FocusSession, answers: RecallAnswer[], confidence: RecallConfidence) => {
    const now = Date.now();
    const existing = receipts.find((item) => item.sessionId === session.id);
    if (existing) return existing;
    const receipt: StudyReceipt = {
      id: `receipt:${session.id}`,
      sessionId: session.id,
      subject: session.subject,
      target: session.target?.trim() || session.subject,
      focusedSeconds: session.durationSeconds,
      sessionStartedAt: session.startedAt,
      sessionEndedAt: session.endedAt,
      questions: answers.map(({ id, prompt, helper }) => ({ id, prompt, helper })),
      answers,
      confidence,
      recallEffortScore: recallEffort(answers),
      source: 'self-recall',
      createdAt: now,
      nextReviewAt: now + DAY_MS,
    };
    await persist([receipt, ...receipts]);
    return receipt;
  }, [persist, receipts]);

  const completeReview = useCallback(async (receiptId: string, response: string, confidence: RecallConfidence) => {
    const current = receipts.find((item) => item.id === receiptId);
    if (!current) return null;
    const updated: StudyReceipt = {
      ...current,
      review: {
        response: response.trim(),
        confidence,
        selfReportedScore: reviewScore(response, confidence),
        completedAt: Date.now(),
      },
    };
    await persist(receipts.map((item) => item.id === receiptId ? updated : item));
    return updated;
  }, [persist, receipts]);

  const value = useMemo<StudyReceiptsValue>(() => ({
    hydrated,
    receipts,
    dueReceipts: receipts.filter((item) => !item.review && item.nextReviewAt <= Date.now()),
    buildQuestions: questionSet,
    createReceipt,
    completeReview,
    receiptForSession: (sessionId) => receipts.find((item) => item.sessionId === sessionId),
  }), [completeReview, createReceipt, hydrated, receipts]);

  return <StudyReceiptsContext.Provider value={value}>{children}</StudyReceiptsContext.Provider>;
};

export const useStudyReceipts = () => {
  const context = useContext(StudyReceiptsContext);
  if (!context) throw new Error('useStudyReceipts must be used inside StudyReceiptsProvider');
  return context;
};
