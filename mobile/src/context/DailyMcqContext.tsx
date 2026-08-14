import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dailyMcqBank, DailyMcqQuestion } from '../data/dailyMcqBank';
import { useAuth } from './AuthContext';

export type DailyMcqAttempt = {
  date: string;
  questionIds: string[];
  answers: Record<string, number>;
  startedAt: number;
  completedAt?: number;
  score?: number;
  total?: number;
  durationSeconds?: number;
};

type DailyMcqValue = {
  hydrated: boolean;
  dateKey: string;
  todayAttempt?: DailyMcqAttempt;
  todayQuestions: DailyMcqQuestion[];
  history: DailyMcqAttempt[];
  streak: number;
  startDaily: () => Promise<DailyMcqAttempt>;
  answerQuestion: (questionId: string, option: number) => Promise<void>;
  submitDaily: () => Promise<DailyMcqAttempt | null>;
};

const DailyMcqContext = createContext<DailyMcqValue | undefined>(undefined);
const storageKey = (studentId: string) => `ump_daily_mcq_${studentId}`;

const localDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

const seededRandom = (seedValue: number) => {
  let seed = seedValue || 1;
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
};

const dailyQuestionIds = (date: string, studentId: string) => {
  const random = seededRandom(hash(`${date}:${studentId}`));
  return [...dailyMcqBank]
    .map((question) => ({ question, sort: random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 10)
    .map(({ question }) => question.id);
};

const calculateStreak = (attempts: DailyMcqAttempt[]) => {
  const completed = new Set(attempts.filter((attempt) => attempt.completedAt).map((attempt) => attempt.date));
  const cursor = new Date();
  if (!completed.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (completed.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

export const DailyMcqProvider = ({ children }: PropsWithChildren) => {
  const { student } = useAuth();
  const [history, setHistory] = useState<DailyMcqAttempt[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const dateKey = localDateKey();
  const todayAttempt = history.find((attempt) => attempt.date === dateKey);

  useEffect(() => {
    let mounted = true;
    setHydrated(false);
    if (!student) {
      setHistory([]);
      return;
    }
    AsyncStorage.getItem(storageKey(student.studentId)).then((saved) => {
      if (!mounted) return;
      try { setHistory(saved ? JSON.parse(saved) as DailyMcqAttempt[] : []); }
      catch { setHistory([]); }
      setHydrated(true);
    });
    return () => { mounted = false; };
  }, [student]);

  const persist = useCallback(async (next: DailyMcqAttempt[]) => {
    setHistory(next);
    if (student) await AsyncStorage.setItem(storageKey(student.studentId), JSON.stringify(next.slice(0, 90)));
  }, [student]);

  const startDaily = useCallback(async () => {
    if (!student) throw new Error('Please sign in again.');
    const existing = history.find((attempt) => attempt.date === dateKey);
    if (existing) return existing;
    const attempt: DailyMcqAttempt = {
      date: dateKey,
      questionIds: dailyQuestionIds(dateKey, student.studentId),
      answers: {},
      startedAt: Date.now(),
    };
    await persist([attempt, ...history]);
    return attempt;
  }, [dateKey, history, persist, student]);

  const answerQuestion = useCallback(async (questionId: string, option: number) => {
    const current = history.find((attempt) => attempt.date === dateKey);
    if (!current || current.completedAt) return;
    const updated = { ...current, answers: { ...current.answers, [questionId]: option } };
    await persist(history.map((attempt) => attempt.date === dateKey ? updated : attempt));
  }, [dateKey, history, persist]);

  const submitDaily = useCallback(async () => {
    const current = history.find((attempt) => attempt.date === dateKey);
    if (!current || current.completedAt) return current || null;
    const questions = current.questionIds.map((id) => dailyMcqBank.find((question) => question.id === id)).filter(Boolean) as DailyMcqQuestion[];
    const score = questions.reduce((total, question) => total + (current.answers[question.id] === question.answer ? 1 : 0), 0);
    const completedAt = Date.now();
    const updated: DailyMcqAttempt = {
      ...current,
      completedAt,
      score,
      total: questions.length,
      durationSeconds: Math.max(1, Math.floor((completedAt - current.startedAt) / 1000)),
    };
    await persist(history.map((attempt) => attempt.date === dateKey ? updated : attempt));
    return updated;
  }, [dateKey, history, persist]);

  const todayQuestions = useMemo(() => (todayAttempt?.questionIds || dailyQuestionIds(dateKey, student?.studentId || 'demo'))
    .map((id) => dailyMcqBank.find((question) => question.id === id))
    .filter(Boolean) as DailyMcqQuestion[], [dateKey, student?.studentId, todayAttempt?.questionIds]);

  const value = useMemo<DailyMcqValue>(() => ({
    hydrated,
    dateKey,
    todayAttempt,
    todayQuestions,
    history,
    streak: calculateStreak(history),
    startDaily,
    answerQuestion,
    submitDaily,
  }), [answerQuestion, dateKey, history, hydrated, startDaily, submitDaily, todayAttempt, todayQuestions]);

  return <DailyMcqContext.Provider value={value}>{children}</DailyMcqContext.Provider>;
};

export const useDailyMcq = () => {
  const context = useContext(DailyMcqContext);
  if (!context) throw new Error('useDailyMcq must be used inside DailyMcqProvider');
  return context;
};
