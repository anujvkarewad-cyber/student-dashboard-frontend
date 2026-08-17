import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { EnrichedMcqQuestion, McqDifficulty } from '../data/mcqMetadata';
import { restoreMcqAttempts, syncCompletedMcqAttempts } from '../services/mcqCloudSync';
import { CaGroup, subjectGroup } from '../utils/caGroups';
import { useAuth } from './AuthContext';
import { useMcqBank } from './McqBankContext';

export type PracticeGroup = CaGroup | 'Combined';
export type PracticeMode = 'Mixed' | 'Normal' | 'Case Study';
export type PracticeDifficulty = McqDifficulty | 'Mixed';

export type PracticeConfig = {
  group: PracticeGroup;
  subject: string;
  chapter: string;
  mode: PracticeMode;
  difficulty: PracticeDifficulty;
  requestedCount: number;
};

export type McqPracticeSession = {
  id: string;
  bankRevision?: string;
  config: PracticeConfig;
  questionIds: string[];
  answers: Record<string, number>;
  startedAt: number;
  completedAt?: number;
  score?: number;
  total?: number;
  durationSeconds?: number;
};

type McqPracticeValue = {
  hydrated: boolean;
  activeSession?: McqPracticeSession;
  history: McqPracticeSession[];
  allQuestions: EnrichedMcqQuestion[];
  availableQuestions: (config: PracticeConfig) => EnrichedMcqQuestion[];
  questionsForSession: (session: McqPracticeSession) => EnrichedMcqQuestion[];
  startPractice: (config: PracticeConfig, questionIds?: string[]) => Promise<McqPracticeSession>;
  answerQuestion: (questionId: string, option: number) => Promise<void>;
  submitPractice: () => Promise<McqPracticeSession | null>;
  abandonPractice: () => Promise<void>;
};

const McqPracticeContext = createContext<McqPracticeValue | undefined>(undefined);
const storageKey = (studentId: string) => `ump_mcq_practice_${studentId}`;

const hash = (value: string) => {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(31, result) + value.charCodeAt(index) | 0;
  return result >>> 0;
};

const shuffled = <T,>(items: T[], seedValue: number) => {
  const result = [...items];
  let seed = seedValue || 1;
  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
};

const mergePracticeAttempts = (local: McqPracticeSession[], remote: McqPracticeSession[]) => {
  const merged = new Map<string, McqPracticeSession>();
  [...local, ...remote].forEach((attempt) => {
    const current = merged.get(attempt.id);
    const timestamp = Number(attempt.completedAt || attempt.startedAt || 0);
    const currentTimestamp = Number(current?.completedAt || current?.startedAt || 0);
    if (!current || timestamp >= currentTimestamp) merged.set(attempt.id, attempt);
  });
  return [...merged.values()].sort((a, b) => Number(b.completedAt || b.startedAt) - Number(a.completedAt || a.startedAt)).slice(0, 150);
};

const filterQuestions = (allQuestions: EnrichedMcqQuestion[], config: PracticeConfig) => allQuestions.filter((question) => {
  const group = subjectGroup(question.subject);
  if (config.group !== 'Combined' && group !== config.group) return false;
  if (config.subject !== 'All Subjects' && question.subject !== config.subject) return false;
  if (config.chapter !== 'All Chapters' && question.chapter !== config.chapter) return false;
  if (config.mode === 'Normal' && question.kind !== 'normal') return false;
  if (config.mode === 'Case Study' && question.kind !== 'case-study') return false;
  if (config.difficulty !== 'Mixed' && question.difficulty !== config.difficulty) return false;
  return true;
});

export const McqPracticeProvider = ({ children }: PropsWithChildren) => {
  const { student, backendMode } = useAuth();
  const { hydrated: bankHydrated, revision: bankRevision, questions: allQuestions } = useMcqBank();
  const [history, setHistory] = useState<McqPracticeSession[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const activeSession = history.find((session) => !session.completedAt);

  useEffect(() => {
    let mounted = true;
    setHydrated(false);
    if (!student) {
      setHistory([]);
      setHydrated(true);
      return;
    }
    if (!bankHydrated) return;
    AsyncStorage.getItem(storageKey(student.studentId)).then(async (saved) => {
      if (!mounted) return;
      let localAttempts: McqPracticeSession[] = [];
      try {
        const parsed = saved ? JSON.parse(saved) as McqPracticeSession[] : [];
        // Completed legacy sessions can still contribute to aggregate history,
        // but an unfinished session must never resume with changed question text.
        const migrated = parsed.filter((session) => session.bankRevision === bankRevision || Boolean(session.completedAt));
        if (migrated.length !== parsed.length) await AsyncStorage.setItem(storageKey(student.studentId), JSON.stringify(migrated));
        if (!mounted) return;
        localAttempts = migrated;
        setHistory(migrated);
      } catch { if (mounted) setHistory([]); }
      if (mounted) setHydrated(true);

      if (backendMode !== 'mock') {
        restoreMcqAttempts().then(async ({ practice }) => {
          if (!mounted) return;
          const merged = mergePracticeAttempts(localAttempts, practice as McqPracticeSession[]);
          setHistory(merged);
          await AsyncStorage.setItem(storageKey(student.studentId), JSON.stringify(merged));
          await syncCompletedMcqAttempts([], merged);
        }).catch(() => undefined);
      }
    });
    return () => { mounted = false; };
  }, [backendMode, bankHydrated, bankRevision, student]);

  const persist = useCallback(async (next: McqPracticeSession[]) => {
    setHistory(next);
    if (student) await AsyncStorage.setItem(storageKey(student.studentId), JSON.stringify(next.slice(0, 150)));
  }, [student]);

  const availableQuestions = useCallback((config: PracticeConfig) => filterQuestions(allQuestions, config), [allQuestions]);
  const questionsForSession = useCallback((session: McqPracticeSession) => session.questionIds
    .map((id) => allQuestions.find((question) => question.id === id))
    .filter(Boolean) as EnrichedMcqQuestion[], [allQuestions]);

  const startPractice = useCallback(async (config: PracticeConfig, questionIds?: string[]) => {
    if (activeSession) return activeSession;
    const pool = questionIds?.length
      ? allQuestions.filter((question) => questionIds.includes(question.id))
      : filterQuestions(allQuestions, config);
    if (!pool.length) throw new Error('No mentor-published questions match these filters.');
    const now = Date.now();
    const selected = shuffled(pool, hash(`${student?.studentId}:${now}:${JSON.stringify(config)}`)).slice(0, questionIds?.length || Math.min(config.requestedCount, pool.length));
    const session: McqPracticeSession = {
      id: `practice:${now}`,
      bankRevision,
      config,
      questionIds: selected.map((question) => question.id),
      answers: {},
      startedAt: now,
    };
    await persist([session, ...history]);
    return session;
  }, [activeSession, allQuestions, bankRevision, history, persist, student?.studentId]);

  const answerQuestion = useCallback(async (questionId: string, option: number) => {
    if (!activeSession) return;
    const updated = { ...activeSession, answers: { ...activeSession.answers, [questionId]: option } };
    await persist(history.map((session) => session.id === activeSession.id ? updated : session));
  }, [activeSession, history, persist]);

  const submitPractice = useCallback(async () => {
    if (!activeSession) return null;
    const questions = questionsForSession(activeSession);
    const completedAt = Date.now();
    const updated: McqPracticeSession = {
      ...activeSession,
      completedAt,
      score: questions.reduce((total, question) => total + (activeSession.answers[question.id] === question.answer ? 1 : 0), 0),
      total: questions.length,
      durationSeconds: Math.max(1, Math.floor((completedAt - activeSession.startedAt) / 1000)),
    };
    await persist(history.map((session) => session.id === activeSession.id ? updated : session));
    if (backendMode !== 'mock') syncCompletedMcqAttempts([], [updated]).catch(() => undefined);
    return updated;
  }, [activeSession, backendMode, history, persist, questionsForSession]);

  const abandonPractice = useCallback(async () => {
    if (!activeSession) return;
    await persist(history.filter((session) => session.id !== activeSession.id));
  }, [activeSession, history, persist]);

  const value = useMemo<McqPracticeValue>(() => ({
    hydrated,
    activeSession,
    history,
    allQuestions,
    availableQuestions,
    questionsForSession,
    startPractice,
    answerQuestion,
    submitPractice,
    abandonPractice,
  }), [abandonPractice, activeSession, allQuestions, answerQuestion, availableQuestions, history, hydrated, questionsForSession, startPractice, submitPractice]);

  return <McqPracticeContext.Provider value={value}>{children}</McqPracticeContext.Provider>;
};

export const useMcqPractice = () => {
  const context = useContext(McqPracticeContext);
  if (!context) throw new Error('useMcqPractice must be used inside McqPracticeProvider');
  return context;
};
