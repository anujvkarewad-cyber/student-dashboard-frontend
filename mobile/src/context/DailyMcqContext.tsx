import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dailyMcqBank, DailyMcqQuestion } from '../data/dailyMcqBank';
import { CaGroup, subjectGroup } from '../utils/caGroups';
import { useAuth } from './AuthContext';

export type DailyMcqAttempt = {
  date: string;
  group: CaGroup;
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
  todayAttempts: DailyMcqAttempt[];
  history: DailyMcqAttempt[];
  attemptForGroup: (group: CaGroup) => DailyMcqAttempt | undefined;
  questionsForGroup: (group: CaGroup) => DailyMcqQuestion[];
  streakForGroup: (group: CaGroup) => number;
  startDaily: (group: CaGroup) => Promise<DailyMcqAttempt>;
  answerQuestion: (group: CaGroup, questionId: string, option: number) => Promise<void>;
  submitDaily: (group: CaGroup) => Promise<DailyMcqAttempt | null>;
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

const dailyQuestionIds = (date: string, studentId: string, group: CaGroup) => {
  const random = seededRandom(hash(`${date}:${studentId}:${group}`));
  const pool = dailyMcqBank.filter((question) => subjectGroup(question.subject) === group);
  const pick = (questions: typeof pool, count: number) => questions
    .map((question) => ({ question, sort: random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, count)
    .map(({ question }) => question.id);
  // Balanced daily paper: seven direct-concept questions and three
  // original case-study questions.
  return [...pick(pool.filter((question) => question.kind !== 'case-study'), 7), ...pick(pool.filter((question) => question.kind === 'case-study'), 3)]
    .map((id) => ({ id, sort: random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ id }) => id);
};

const calculateStreak = (attempts: DailyMcqAttempt[], group: CaGroup) => {
  const completed = new Set(attempts.filter((attempt) => attempt.group === group && attempt.completedAt).map((attempt) => attempt.date));
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
  const todayAttempts = history.filter((attempt) => attempt.date === dateKey && (attempt.group === 'Group I' || attempt.group === 'Group II'));

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
    if (student) await AsyncStorage.setItem(storageKey(student.studentId), JSON.stringify(next.slice(0, 180)));
  }, [student]);

  const attemptForGroup = useCallback((group: CaGroup) => history.find((attempt) => attempt.date === dateKey && attempt.group === group), [dateKey, history]);

  const questionsForGroup = useCallback((group: CaGroup) => {
    const attempt = attemptForGroup(group);
    const ids = attempt?.questionIds || dailyQuestionIds(dateKey, student?.studentId || 'demo', group);
    return ids.map((id) => dailyMcqBank.find((question) => question.id === id)).filter(Boolean) as DailyMcqQuestion[];
  }, [attemptForGroup, dateKey, student?.studentId]);

  const startDaily = useCallback(async (group: CaGroup) => {
    if (!student) throw new Error('Please sign in again.');
    const existing = history.find((attempt) => attempt.date === dateKey && attempt.group === group);
    if (existing) return existing;
    const runningOtherGroup = history.find((attempt) => attempt.date === dateKey && attempt.group !== group && !attempt.completedAt);
    if (runningOtherGroup) throw new Error(`Finish the ${runningOtherGroup.group} attempt before starting ${group}.`);
    const attempt: DailyMcqAttempt = {
      date: dateKey,
      group,
      questionIds: dailyQuestionIds(dateKey, student.studentId, group),
      answers: {},
      startedAt: Date.now(),
    };
    await persist([attempt, ...history]);
    return attempt;
  }, [dateKey, history, persist, student]);

  const answerQuestion = useCallback(async (group: CaGroup, questionId: string, option: number) => {
    const current = history.find((attempt) => attempt.date === dateKey && attempt.group === group);
    if (!current || current.completedAt) return;
    const updated = { ...current, answers: { ...current.answers, [questionId]: option } };
    await persist(history.map((attempt) => attempt.date === dateKey && attempt.group === group ? updated : attempt));
  }, [dateKey, history, persist]);

  const submitDaily = useCallback(async (group: CaGroup) => {
    const current = history.find((attempt) => attempt.date === dateKey && attempt.group === group);
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
    await persist(history.map((attempt) => attempt.date === dateKey && attempt.group === group ? updated : attempt));
    return updated;
  }, [dateKey, history, persist]);

  const value = useMemo<DailyMcqValue>(() => ({
    hydrated,
    dateKey,
    todayAttempts,
    history,
    attemptForGroup,
    questionsForGroup,
    streakForGroup: (group) => calculateStreak(history, group),
    startDaily,
    answerQuestion,
    submitDaily,
  }), [answerQuestion, attemptForGroup, dateKey, history, hydrated, questionsForGroup, startDaily, submitDaily, todayAttempts]);

  return <DailyMcqContext.Provider value={value}>{children}</DailyMcqContext.Provider>;
};

export const useDailyMcq = () => {
  const context = useContext(DailyMcqContext);
  if (!context) throw new Error('useDailyMcq must be used inside DailyMcqProvider');
  return context;
};
