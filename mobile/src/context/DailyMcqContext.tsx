import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { EnrichedMcqQuestion } from '../data/mcqMetadata';
import { CaGroup, subjectGroup } from '../utils/caGroups';
import { restoreMcqAttempts, syncCompletedMcqAttempts, fetchOfficialDailySet } from '../services/mcqCloudSync';
import { useAuth } from './AuthContext';
import { useMcqBank } from './McqBankContext';

export type DailyMcqAttempt = {
  officialSetId?: string;
  officialQuestions?: EnrichedMcqQuestion[];
  bankRevision?: string;
  date: string;
  group: CaGroup;
  questionIds: string[];
  answers: Record<string, number>;
  startedAt: number;
  completedAt?: number;
  score?: number;
  total?: number;
  durationSeconds?: number;
  review?: Array<{
    id: string; prompt: string; options: string[]; answer: number;
    selected?: number | null; explanation?: string; subject?: string;
    chapter?: string; difficulty?: string; kind?: string; correct?: boolean;
  }>;
};

type DailyMcqValue = {
  hydrated: boolean;
  syncStatus: "local" | "pending" | "synced" | "error";
  retrySync: () => Promise<void>;
  dateKey: string;
  todayAttempts: DailyMcqAttempt[];
  history: DailyMcqAttempt[];
  attemptForGroup: (group: CaGroup) => DailyMcqAttempt | undefined;
  questionsForGroup: (group: CaGroup) => EnrichedMcqQuestion[];
  streakForGroup: (group: CaGroup) => number;
  startDaily: (group: CaGroup) => Promise<DailyMcqAttempt>;
  answerQuestion: (group: CaGroup, questionId: string, option: number) => Promise<void>;
  submitDaily: (group: CaGroup) => Promise<DailyMcqAttempt | null>;
};

const DailyMcqContext = createContext<DailyMcqValue | undefined>(undefined);
const storageKey = (studentId: string) => `ump_daily_mcq_${studentId}`;

const localDateKey = (date = new Date()) => new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10);

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

const dailyQuestionIds = (bank: EnrichedMcqQuestion[], date: string, studentId: string, group: CaGroup) => {
  const random = seededRandom(hash(`${date}:${studentId}:${group}`));
  const pool = bank.filter((question) => subjectGroup(question.subject) === group);
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

const mergeDailyAttempts = (local: DailyMcqAttempt[], remote: DailyMcqAttempt[]) => {
  const merged = new Map<string, DailyMcqAttempt>();
  [...local, ...remote].forEach((attempt) => {
    const key = `${attempt.date}:${attempt.group}`;
    const current = merged.get(key);
    const timestamp = Number(attempt.completedAt || attempt.startedAt || 0);
    const currentTimestamp = Number(current?.completedAt || current?.startedAt || 0);
    if (!current || timestamp >= currentTimestamp) {
      const sameSet = current?.officialSetId && current.officialSetId === attempt.officialSetId
        && JSON.stringify(current.questionIds) === JSON.stringify(attempt.questionIds);
      merged.set(key, sameSet && !attempt.officialQuestions?.length
        ? { ...attempt, officialQuestions: current.officialQuestions } : attempt);
    }
  });
  return [...merged.values()].sort((a, b) => Number(b.completedAt || b.startedAt) - Number(a.completedAt || a.startedAt)).slice(0, 180);
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
  const { student, backendMode } = useAuth();
  const activeOwner = useRef(student?.studentId);
  activeOwner.current = student?.studentId;
  const { revision: bankRevision, questions: mcqBank } = useMcqBank();
  const [history, setHistory] = useState<DailyMcqAttempt[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const historyRef = useRef<DailyMcqAttempt[]>([]);
  historyRef.current = history;
  const [syncStatus, setSyncStatus] = useState<"local" | "pending" | "synced" | "error">("local");
  useEffect(() => { setSyncStatus("local"); }, [student?.studentId]);
  const dateKey = localDateKey();
  const todayAttempts = history.filter((attempt) => attempt.date === dateKey && (attempt.group === 'Group I' || attempt.group === 'Group II'));

  useEffect(() => {
    let mounted = true;
    setHydrated(false);
    if (!student) {
      setHistory([]);
      setHydrated(true);
      return;
    }
    AsyncStorage.getItem(storageKey(student.studentId)).then(async (saved) => {
      if (!mounted) return;
      let localAttempts: DailyMcqAttempt[] = [];
      try {
        const parsed = saved ? JSON.parse(saved) as DailyMcqAttempt[] : [];
        // Loading a new bank must never delete saved attempts or wait for 7MB.
        localAttempts = Array.isArray(parsed) ? parsed : [];
        historyRef.current = localAttempts;
        setHistory(localAttempts);
      } catch { if (mounted) setHistory([]); }
      if (mounted) setHydrated(true);

      if (backendMode !== 'mock') {
        restoreMcqAttempts().then(async ({ daily }) => {
          if (!mounted) return;
          const merged = mergeDailyAttempts(historyRef.current, daily as DailyMcqAttempt[]);
          historyRef.current = merged;
          setHistory(merged);
          await AsyncStorage.setItem(storageKey(student.studentId), JSON.stringify(merged));
          if (!merged.some(attempt => attempt.completedAt)) { if (mounted) setSyncStatus('local'); return; }
          if (mounted) setSyncStatus('pending');
          await syncCompletedMcqAttempts(merged, [], student.studentId);
          if (mounted) setSyncStatus('synced');
        }).catch(() => { if (mounted) setSyncStatus('error'); });
      }
    }).catch(() => { if (mounted) { setHydrated(true); setSyncStatus('error'); } });
    return () => { mounted = false; };
  }, [backendMode, student?.studentId]);

  const persist = useCallback(async (next: DailyMcqAttempt[]) => {
    historyRef.current = next;
    setHistory(next);
    if (student) await AsyncStorage.setItem(storageKey(student.studentId), JSON.stringify(next.slice(0, 180)));
  }, [student]);

  const attemptForGroup = useCallback((group: CaGroup) => history.find((attempt) => attempt.date === dateKey && attempt.group === group), [dateKey, history]);

  const questionsForGroup = useCallback((group: CaGroup) => {
    const attempt = attemptForGroup(group);
    const ids = attempt?.questionIds || dailyQuestionIds(mcqBank, dateKey, student?.studentId || 'student', group);
    return ids.map((id) => (attempt?.officialQuestions || mcqBank).find((question) => question.id === id)).filter((question): question is EnrichedMcqQuestion => Boolean(question));
  }, [attemptForGroup, dateKey, mcqBank, student?.studentId]);

  const startDaily = useCallback(async (group: CaGroup) => {
    if (!student) throw new Error('Please sign in again.');
    if (backendMode === 'mock' && !mcqBank.length) throw new Error('No mentor-published MCQs are available yet.');
    const existing = history.find((attempt) => attempt.date === dateKey && attempt.group === group);
    if (existing) return existing;
    const runningOtherGroup = history.find((attempt) => attempt.date === dateKey && attempt.group !== group && !attempt.completedAt);
    if (runningOtherGroup) throw new Error(`Finish the ${runningOtherGroup.group} attempt before starting ${group}.`);
    const official = backendMode === 'mock' ? null : await fetchOfficialDailySet(group, student.studentId);
    if (activeOwner.current !== student.studentId) throw new Error('Account changed; local attempts are retained.');
    if (official && (official.date !== dateKey || official.group !== group || official.questionIds.length !== 10)) throw new Error('Daily assignment changed; refresh the app and check the device clock.');
    const attempt: DailyMcqAttempt = {
      ...(official ? { officialSetId: official.officialSetId, officialQuestions: official.questions } : {}),
      bankRevision: official?.bankRevision || bankRevision,
      date: dateKey,
      group,
      questionIds: official?.questionIds || dailyQuestionIds(mcqBank, dateKey, student.studentId, group),
      answers: {},
      startedAt: Date.now(),
    };
    await persist([attempt, ...history]);
    return attempt;
  }, [backendMode, bankRevision, dateKey, history, mcqBank, persist, student]);

  const answerQuestion = useCallback(async (group: CaGroup, questionId: string, option: number) => {
    const current = history.find((attempt) => attempt.date === dateKey && attempt.group === group);
    if (!current || current.completedAt) return;
    const updated = { ...current, answers: { ...current.answers, [questionId]: option } };
    await persist(history.map((attempt) => attempt.date === dateKey && attempt.group === group ? updated : attempt));
  }, [dateKey, history, persist]);

  const submitDaily = useCallback(async (group: CaGroup) => {
    const current = history.find((attempt) => attempt.date === dateKey && attempt.group === group);
    if (!current || current.completedAt) return current || null;
    const questions = current.questionIds.map((id) => (current.officialQuestions || mcqBank).find((question) => question.id === id)).filter((question): question is EnrichedMcqQuestion => Boolean(question));
    const score = questions.reduce((total, question) => total + (current.answers[question.id] === question.answer ? 1 : 0), 0);
    const completedAt = Date.now();
    const updated: DailyMcqAttempt = {
      ...current,
      completedAt,
      score,
      total: questions.length,
      durationSeconds: Math.max(1, Math.floor((completedAt - current.startedAt) / 1000)),
      review: questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        options: question.options,
        answer: question.answer,
        selected: current.answers[question.id] == null ? null : current.answers[question.id],
        explanation: question.explanation || '',
        subject: question.subject,
        chapter: question.chapter,
        difficulty: question.difficulty,
        kind: question.kind,
        correct: current.answers[question.id] === question.answer,
      })),
    };
    await persist(history.map((attempt) => attempt.date === dateKey && attempt.group === group ? updated : attempt));
    if (backendMode !== 'mock') {
      const owner = student?.studentId; setSyncStatus('pending');
      syncCompletedMcqAttempts([updated], [], owner).then(() => {
        if (activeOwner.current === owner) setSyncStatus('synced');
      }).catch(() => { if (activeOwner.current === owner) setSyncStatus('error'); });
    }
    return updated;
  }, [backendMode, dateKey, history, mcqBank, persist, student]);

  const retrySync = useCallback(async () => {
    const owner = student?.studentId;
    if (!owner || backendMode === 'mock') return;
    setSyncStatus('pending');
    try {
      await syncCompletedMcqAttempts(history, [], owner);
      if (activeOwner.current === owner) setSyncStatus('synced');
    } catch { if (activeOwner.current === owner) setSyncStatus('error'); }
  }, [backendMode, history, student?.studentId]);

  const value = useMemo<DailyMcqValue>(() => ({
    syncStatus, retrySync,
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
  }), [syncStatus, retrySync, answerQuestion, attemptForGroup, dateKey, history, hydrated, questionsForGroup, startDaily, submitDaily, todayAttempts]);

  return <DailyMcqContext.Provider value={value}>{children}</DailyMcqContext.Provider>;
};

export const useDailyMcq = () => {
  const context = useContext(DailyMcqContext);
  if (!context) throw new Error('useDailyMcq must be used inside DailyMcqProvider');
  return context;
};
