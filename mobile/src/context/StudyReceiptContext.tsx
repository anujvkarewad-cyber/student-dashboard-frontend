import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { evaluatePrivateReceipt } from '../services/privateReceipt';
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
  cloudSummaryShared?: boolean;
  review?: RetentionReview;
  /** Real mark from the answer evaluator. Absent on receipts made before grading. */
  recallScore?: number;
  recallVerdict?: string;
  missingPoints?: string[];
  gradedConcept?: string;
};

type StudyReceiptsValue = {
  hydrated: boolean;
  receipts: StudyReceipt[];
  dueReceipts: StudyReceipt[];
  buildQuestions: (session: FocusSession) => RecallQuestion[];
  createReceipt: (session: FocusSession, answers: RecallAnswer[], confidence: RecallConfidence, requestAi?: boolean) => Promise<StudyReceipt>;
  markSummaryShared: (sessionId: string) => Promise<void>;
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
    ? ` on "${typedTarget}"`
    : '';

  // The old version asked the student to describe the session back to itself
  // ("Which mock did you attempt?", "When will you revise next?"). Those are
  // journaling prompts, not recall: they need no retrieval from memory, so a
  // student can answer them without having learned anything, and the score that
  // came out of them was their own opinion of themselves.
  //
  // These ask for the content itself, with notes closed. That is the thing that
  // actually strengthens memory, and it can be marked.
  if (kind === 'mock') {
    return [
      {
        id: `${session.id}:mock-provisions`,
        prompt: `Notes closed. Write out the provisions, sections, standards or formats you used in this ${session.subject} paper${targetSuffix}, from memory.`,
        helper: 'Name them precisely - section or SA numbers where they apply.',
      },
      {
        id: `${session.id}:mock-wrong`,
        prompt: 'Write out the questions you know you got wrong, and the correct answer or treatment for each.',
        helper: 'Give the right answer, not just the topic. This is the one that matters.',
      },
      {
        id: `${session.id}:mock-working`,
        prompt: `Reproduce the working or format of one question from this paper${targetSuffix} without looking it up.`,
        helper: 'Steps, figures and the final labelled answer.',
      },
    ];
  }

  if (kind === 'revision') {
    return [
      {
        id: `${session.id}:revise-provisions`,
        prompt: `Notes closed. Write the provisions, sections, rules or standards you revised in this ${session.subject} session${targetSuffix}, from memory.`,
        helper: 'Quote them as precisely as you can.',
      },
      {
        id: `${session.id}:revise-detail`,
        prompt: `Now write the detail behind the most important one of those - the conditions, exceptions or limits.`,
        helper: 'An examiner marks the detail, not the heading.',
      },
      {
        id: `${session.id}:revise-apply`,
        prompt: `Give one situation where this applies and state the correct treatment or conclusion.`,
        helper: 'Application is what separates a pass from a distinction.',
      },
    ];
  }

  return [
    {
      id: `${session.id}:core`,
      prompt: `Notes closed. Write everything you can recall about "${target}" from this ${session.subject} session.`,
      helper: 'Provisions, formulae, steps, exceptions - whatever comes back.',
    },
    {
      id: `${session.id}:detail`,
      prompt: `Now the precise detail: the exact section, rule, standard or formula for "${target}".`,
      helper: 'Vague descriptions score nothing in the real paper.',
    },
    {
      id: `${session.id}:apply`,
      prompt: `State the conclusion or final treatment for a standard question on "${target}", and how you reach it.`,
      helper: 'An answer with no conclusion loses marks even when the working is right.',
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
  const currentOwner = useRef(student?.studentId);
  currentOwner.current = student?.studentId;
  const [receipts, setReceipts] = useState<StudyReceipt[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    setHydrated(false);
    setReceipts([]);
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

  const createReceipt = useCallback(async (session: FocusSession, answers: RecallAnswer[], confidence: RecallConfidence, requestAi = false) => {
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

    // The receipt is saved first so the student never waits on the network.
    // Optional private feedback is transient server processing, never a shared
    // score/revision record. Default is local-only, without network grading.
    if (student && requestAi) {
      const owner = student.studentId;
      const selected = [...answers].sort((a, b) => b.response.length - a.response.length)[0];
      const recallText = selected?.response || '';
      if (recallText.trim().length >= 40) {
        const question = selected?.prompt || `Recall everything about ${receipt.target}.`;
        evaluatePrivateReceipt({
          studentId: student.studentId,
          question,
          studentAnswer: recallText,
          subject: receipt.subject,
          concept: receipt.target,
        })
          .then((outcome) => {
            if (!outcome.ok || currentOwner.current !== owner) return;
            setReceipts((current) => {
              if (currentOwner.current !== owner) return current;
              const next = current.map((item) =>
                item.id === receipt.id
                  ? {
                      ...item,
                      recallScore: outcome.score,
                      recallVerdict: outcome.verdict,
                      missingPoints: outcome.missingKeyPoints.slice(0, 5),
                      gradedConcept: receipt.target,
                    }
                  : item,
              );
              void AsyncStorage.setItem(storageKey(owner), JSON.stringify(next.slice(0, 250))).catch(() => undefined);
              return next;
            });
          })
          .catch(() => undefined);
      }
    }

    return receipt;
  }, [persist, receipts, student]);

  const markSummaryShared = useCallback(async (sessionId: string) => {
    const sid = student?.studentId;
    if (!sid || currentOwner.current !== sid) return;
    setReceipts(current => {
      if (currentOwner.current !== sid || current.find(r => r.sessionId === sessionId)?.cloudSummaryShared) return current;
      const next = current.map(r => r.sessionId === sessionId ? { ...r, cloudSummaryShared: true } : r);
      // Local scheduling hint only; the summary itself is already durable on
      // the backend. A storage error never deletes the private receipt.
      void AsyncStorage.setItem(storageKey(sid), JSON.stringify(next.slice(0, 250))).catch(() => undefined);
      return next;
    });
  }, [student?.studentId]);

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
    dueReceipts: receipts.filter((item) => !item.cloudSummaryShared && !item.review && item.nextReviewAt <= Date.now()),
    buildQuestions: questionSet,
    createReceipt,
    completeReview,
    markSummaryShared,
    receiptForSession: (sessionId) => receipts.find((item) => item.sessionId === sessionId),
  }), [markSummaryShared, completeReview, createReceipt, hydrated, receipts]);

  return <StudyReceiptsContext.Provider value={value}>{children}</StudyReceiptsContext.Provider>;
};

export const useStudyReceipts = () => {
  const context = useContext(StudyReceiptsContext);
  if (!context) throw new Error('useStudyReceipts must be used inside StudyReceiptsProvider');
  return context;
};
