import AsyncStorage from '@react-native-async-storage/async-storage';
import * as KeepAwake from 'expo-keep-awake';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

export type FocusStatus = 'idle' | 'running' | 'paused';

export type FocusSession = {
  id: string;
  subject: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
};

type FocusTimerState = {
  status: FocusStatus;
  subject: string;
  startedAt: number | null;
  sessionStartedAt: number | null;
  elapsedBeforeRun: number;
};

type FocusTimerValue = {
  hydrated: boolean;
  status: FocusStatus;
  subject: string;
  elapsedSeconds: number;
  sessions: FocusSession[];
  setSubject: (subject: string) => void;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  finish: () => Promise<FocusSession | null>;
  discard: () => Promise<void>;
  removeSession: (id: string) => Promise<void>;
};

const idleTimer: FocusTimerState = {
  status: 'idle',
  subject: 'Accounts',
  startedAt: null,
  sessionStartedAt: null,
  elapsedBeforeRun: 0,
};

const FocusTimerContext = createContext<FocusTimerValue | undefined>(undefined);
const KEEP_AWAKE_TAG = 'ump-focus-timer';

const timerKey = (studentId: string) => `ump_focus_timer_${studentId}`;
const historyKey = (studentId: string) => `ump_focus_sessions_${studentId}`;

const elapsedFor = (timer: FocusTimerState, now = Date.now()) => {
  if (timer.status !== 'running' || !timer.startedAt) return timer.elapsedBeforeRun;
  return timer.elapsedBeforeRun + Math.max(0, Math.floor((now - timer.startedAt) / 1000));
};

export const FocusTimerProvider = ({ children }: PropsWithChildren) => {
  const { student } = useAuth();
  const [timer, setTimer] = useState<FocusTimerState>(idleTimer);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [clock, setClock] = useState(Date.now());

  const saveTimer = useCallback(async (next: FocusTimerState) => {
    setTimer(next);
    if (student) await AsyncStorage.setItem(timerKey(student.studentId), JSON.stringify(next));
  }, [student]);

  const saveSessions = useCallback(async (next: FocusSession[]) => {
    setSessions(next);
    if (student) await AsyncStorage.setItem(historyKey(student.studentId), JSON.stringify(next));
  }, [student]);

  useEffect(() => {
    let mounted = true;
    setHydrated(false);
    if (!student) {
      setTimer(idleTimer);
      setSessions([]);
      return;
    }
    Promise.all([
      AsyncStorage.getItem(timerKey(student.studentId)),
      AsyncStorage.getItem(historyKey(student.studentId)),
    ]).then(([savedTimer, savedSessions]) => {
      if (!mounted) return;
      try {
        setTimer(savedTimer ? JSON.parse(savedTimer) as FocusTimerState : idleTimer);
        setSessions(savedSessions ? JSON.parse(savedSessions) as FocusSession[] : []);
      } catch {
        setTimer(idleTimer);
        setSessions([]);
      }
      setHydrated(true);
    });
    return () => { mounted = false; };
  }, [student]);

  useEffect(() => {
    if (timer.status !== 'running') {
      KeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      return;
    }
    KeepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearInterval(interval);
      KeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [timer.status]);

  const setSubject = useCallback((subject: string) => {
    if (timer.status !== 'idle') return;
    saveTimer({ ...timer, subject }).catch(() => undefined);
  }, [saveTimer, timer]);

  const start = useCallback(async () => {
    if (timer.status !== 'idle' || !timer.subject) return;
    const now = Date.now();
    await saveTimer({
      status: 'running',
      subject: timer.subject,
      startedAt: now,
      sessionStartedAt: now,
      elapsedBeforeRun: 0,
    });
    setClock(now);
  }, [saveTimer, timer]);

  const pause = useCallback(async () => {
    if (timer.status !== 'running') return;
    const elapsed = elapsedFor(timer);
    await saveTimer({ ...timer, status: 'paused', startedAt: null, elapsedBeforeRun: elapsed });
    setClock(Date.now());
  }, [saveTimer, timer]);

  const resume = useCallback(async () => {
    if (timer.status !== 'paused') return;
    const now = Date.now();
    await saveTimer({ ...timer, status: 'running', startedAt: now });
    setClock(now);
  }, [saveTimer, timer]);

  const finish = useCallback(async () => {
    if (timer.status === 'idle') return null;
    const now = Date.now();
    const durationSeconds = elapsedFor(timer, now);
    const completed: FocusSession = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      subject: timer.subject,
      startedAt: timer.sessionStartedAt || now,
      endedAt: now,
      durationSeconds,
    };
    const nextHistory = durationSeconds > 0 ? [completed, ...sessions].slice(0, 100) : sessions;
    await Promise.all([
      saveTimer({ ...idleTimer, subject: timer.subject }),
      saveSessions(nextHistory),
    ]);
    setClock(now);
    return durationSeconds > 0 ? completed : null;
  }, [saveSessions, saveTimer, sessions, timer]);

  const discard = useCallback(async () => {
    await saveTimer({ ...idleTimer, subject: timer.subject || idleTimer.subject });
    setClock(Date.now());
  }, [saveTimer, timer.subject]);

  const removeSession = useCallback(async (id: string) => {
    await saveSessions(sessions.filter((session) => session.id !== id));
  }, [saveSessions, sessions]);

  const value = useMemo<FocusTimerValue>(() => ({
    hydrated,
    status: timer.status,
    subject: timer.subject,
    elapsedSeconds: elapsedFor(timer, clock),
    sessions,
    setSubject,
    start,
    pause,
    resume,
    finish,
    discard,
    removeSession,
  }), [clock, discard, finish, hydrated, pause, removeSession, resume, sessions, setSubject, start, timer]);

  return <FocusTimerContext.Provider value={value}>{children}</FocusTimerContext.Provider>;
};

export const useFocusTimer = () => {
  const context = useContext(FocusTimerContext);
  if (!context) throw new Error('useFocusTimer must be used inside FocusTimerProvider');
  return context;
};
