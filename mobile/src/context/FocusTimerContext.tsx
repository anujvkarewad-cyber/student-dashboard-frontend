import AsyncStorage from '@react-native-async-storage/async-storage';
import * as KeepAwake from 'expo-keep-awake';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import type { SmartBinding } from '../services/smartTargets';

export type FocusStatus = 'idle' | 'running' | 'paused';

export type FocusSession = {
  id: string;
  subject: string;
  target?: string;
  smartTarget?: SmartBinding;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
};

type FocusTimerState = {
  status: FocusStatus;
  subject: string;
  target: string;
  smartTarget?: SmartBinding;
  startedAt: number | null;
  sessionStartedAt: number | null;
  elapsedBeforeRun: number;
};

type FocusTimerValue = {
  hydrated: boolean;
  status: FocusStatus;
  subject: string;
  target: string;
  elapsedSeconds: number;
  sessions: FocusSession[];
  smartTarget?: SmartBinding;
  bindTarget: (binding: SmartBinding) => Promise<void>;
  setSubject: (subject: string) => void;
  setTarget: (target: string) => void;
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
  target: '',
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
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const currentOwner = useRef(student?.studentId);
  currentOwner.current = student?.studentId;
  const ready = hydrated && loadedOwner === student?.studentId;
  const [clock, setClock] = useState(Date.now());

  const saveTimer = useCallback(async (next: FocusTimerState) => {
    if (!student || currentOwner.current !== student.studentId) throw new Error('Account changed.');
    setTimer(next);
    if (student) await AsyncStorage.setItem(timerKey(student.studentId), JSON.stringify(next));
  }, [student]);

  const saveSessions = useCallback(async (next: FocusSession[]) => {
    if (!student || currentOwner.current !== student.studentId) throw new Error('Account changed.');
    setSessions(next);
    if (student) await AsyncStorage.setItem(historyKey(student.studentId), JSON.stringify(next));
  }, [student]);

  useEffect(() => {
    let mounted = true;
    setHydrated(false);
    setLoadedOwner(null);
    setTimer(idleTimer);
    setSessions([]);
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
        setTimer(savedTimer ? { ...idleTimer, ...(JSON.parse(savedTimer) as FocusTimerState) } : idleTimer);
        setSessions(savedSessions ? JSON.parse(savedSessions) as FocusSession[] : []);
      } catch {
        setTimer(idleTimer);
        setSessions([]);
      }
      setLoadedOwner(student.studentId);
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

  const bindTarget = useCallback(async (binding: SmartBinding) => {
    if (!ready) throw new Error('Please wait for your timer to load.');
    if (!student || binding.ownerId !== student.studentId) throw new Error('Account changed. Reload your targets.');
    if (JSON.stringify(timer.smartTarget) === JSON.stringify(binding)) return;
    if (timer.status !== 'idle') throw new Error('Finish or discard your current timer before starting another task.');
    await saveTimer({ ...idleTimer, subject: binding.subject, target: binding.concept, smartTarget: binding });
  }, [ready, saveTimer, student, timer]);

  const setSubject = useCallback((subject: string) => {
    if (!ready || timer.status !== 'idle' || timer.smartTarget) return;
    saveTimer({ ...timer, subject }).catch(() => undefined);
  }, [ready, saveTimer, timer]);

  const setTarget = useCallback((target: string) => {
    if (!ready || timer.status !== 'idle' || timer.smartTarget) return;
    saveTimer({ ...timer, target }).catch(() => undefined);
  }, [ready, saveTimer, timer]);

  const start = useCallback(async () => {
    if (!ready || timer.status !== 'idle' || !timer.subject || !timer.target.trim()) return;
    const now = Date.now();
    await saveTimer({
      status: 'running',
      smartTarget: timer.smartTarget,
      subject: timer.subject,
      target: timer.target.trim(),
      startedAt: now,
      sessionStartedAt: now,
      elapsedBeforeRun: 0,
    });
    setClock(now);
  }, [ready, saveTimer, timer]);

  const pause = useCallback(async () => {
    if (!ready || timer.status !== 'running') return;
    const elapsed = elapsedFor(timer);
    await saveTimer({ ...timer, status: 'paused', startedAt: null, elapsedBeforeRun: elapsed });
    setClock(Date.now());
  }, [ready, saveTimer, timer]);

  const resume = useCallback(async () => {
    if (!ready || timer.status !== 'paused') return;
    const now = Date.now();
    await saveTimer({ ...timer, status: 'running', startedAt: now });
    setClock(now);
  }, [ready, saveTimer, timer]);

  const finish = useCallback(async () => {
    if (!ready || timer.status === 'idle') return null;
    const now = Date.now();
    const durationSeconds = elapsedFor(timer, now);
    const completed: FocusSession = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      subject: timer.subject,
      target: timer.target.trim(),
      smartTarget: timer.smartTarget,
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
  }, [ready, saveSessions, saveTimer, sessions, timer]);

  const discard = useCallback(async () => {
    if (!ready) return;
    await saveTimer({ ...idleTimer, subject: timer.subject || idleTimer.subject });
    setClock(Date.now());
  }, [ready, saveTimer, timer.subject]);

  const removeSession = useCallback(async (id: string) => {
    if (!ready) return;
    await saveSessions(sessions.filter((session) => session.id !== id));
  }, [ready, saveSessions, sessions]);

  const value = useMemo<FocusTimerValue>(() => ({
    hydrated: ready,
    status: ready ? timer.status : 'idle',
    subject: ready ? timer.subject : idleTimer.subject,
    target: ready ? timer.target : '',
    smartTarget: ready ? timer.smartTarget : undefined,
    bindTarget,
    elapsedSeconds: ready ? elapsedFor(timer, clock) : 0,
    sessions: ready ? sessions : [],
    setSubject,
    setTarget,
    start,
    pause,
    resume,
    finish,
    discard,
    removeSession,
  }), [ready, bindTarget, clock, discard, finish, hydrated, pause, removeSession, resume, sessions, setSubject, setTarget, start, timer]);

  return <FocusTimerContext.Provider value={value}>{children}</FocusTimerContext.Provider>;
};

export const useFocusTimer = () => {
  const context = useContext(FocusTimerContext);
  if (!context) throw new Error('useFocusTimer must be used inside FocusTimerProvider');
  return context;
};
