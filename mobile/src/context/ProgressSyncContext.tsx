import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { EnrichedMcqQuestion } from '../data/mcqMetadata';
import { buildProgressPayload, getShareChoice, setMentorSharing, syncProgress, ProgressSummary, ProgressTrendPoint } from '../services/progressSync';
import { useAuth } from './AuthContext';
import { useDailyMcq } from './DailyMcqContext';
import { useMcqBank } from './McqBankContext';
import { useMcqPractice } from './McqPracticeContext';

export type ProgressSyncStatus = 'idle' | 'off' | 'syncing' | 'ok' | 'error';

type ProgressSyncValue = {
  sharing: boolean;
  status: ProgressSyncStatus;
  lastSyncedAt?: string;
  setSharing: (on: boolean) => Promise<void>;
  syncNow: () => Promise<void>;
};

const ProgressSyncContext = createContext<ProgressSyncValue | undefined>(undefined);

export const ProgressSyncProvider = ({ children }: PropsWithChildren) => {
  const { student, backendMode } = useAuth();
  const { history: dailyHistory } = useDailyMcq();
  const { history: practiceHistory } = useMcqPractice();
  const { questions: liveQuestions } = useMcqBank();
  const [sharing, setSharingState] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<ProgressSyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<string>();
  const syncingRef = useRef<number | null>(null);
  const ownerRef = useRef(student?.studentId);
  const ownerEpoch = useRef(0);
  if (ownerRef.current !== student?.studentId) {
    ownerRef.current = student?.studentId;
    ownerEpoch.current += 1;
  }

  // Build a lookup from every available question id to its chapter metadata.
  const questionLookup = useMemo<Map<string, EnrichedMcqQuestion>>(() => {
    const lookup = new Map<string, EnrichedMcqQuestion>();
    for (const question of liveQuestions) if (question?.id) lookup.set(question.id, question);
    // Official Daily snapshots carry their own chapter metadata; progress must
    // not wait for the 4,700-question practice bank to finish downloading.
    for (const attempt of dailyHistory) {
      for (const question of attempt.officialQuestions || []) {
        if (question?.id) lookup.set(question.id, question);
      }
    }
    return lookup;
  }, [liveQuestions, dailyHistory]);

  // Restore the student's saved sharing choice.
  useEffect(() => {
    let mounted = true;
    setLoaded(false); setSharingState(false); setStatus('idle'); setLastSyncedAt(undefined);
    if (!student) {
      setLoaded(true);
      setSharingState(false);
      return;
    }
    getShareChoice(student.studentId).then((on) => {
      if (!mounted) return;
      setSharingState(on);
      setLoaded(true);
    });
    return () => { mounted = false; };
  }, [student]);

  const syncNow = useCallback(async (confirmedSharing = false) => {
    if (!student || backendMode === 'mock' || backendMode === 'live-readonly') return;
    if (!sharing && !confirmedSharing) { setStatus('off'); return; }
    const epoch = ownerEpoch.current;
    const stillOwner = () => ownerEpoch.current === epoch && ownerRef.current === student.studentId;
    if (syncingRef.current === epoch) return;
    syncingRef.current = epoch;
    setStatus('syncing');
    try {
      const sessions = [
        ...dailyHistory.filter((attempt) => attempt.completedAt),
        ...practiceHistory.filter((session) => session.completedAt),
      ];
      const { summaries, trend } = buildProgressPayload(student.studentId, sessions, questionLookup);
      if (!summaries.length) { if (stillOwner()) setStatus('idle'); return; }
      const result = await syncProgress(student.studentId, summaries, trend);
      if (!stillOwner()) return;
      // Progress sync must not upload unrelated mentor-test history.
      if (result.ok) {
        setStatus('ok');
        setLastSyncedAt(new Date().toISOString());
        await AsyncStorage.setItem(`ump_progress_synced_at:${student.studentId}`, new Date().toISOString()).catch(() => undefined);
      } else {
        setStatus('off'); // 403 — sharing was revoked server-side
      }
    } catch {
      if (stillOwner()) setStatus('error');
    } finally {
      if (syncingRef.current === epoch) syncingRef.current = null;
    }
  }, [backendMode, dailyHistory, practiceHistory, questionLookup, sharing, student]);

  // Auto-sync once a completed attempt exists while sharing is ON.
  const hasCompleted = (dailyHistory.some((a) => a.completedAt) || practiceHistory.some((s) => s.completedAt));
  useEffect(() => {
    if (!loaded || !student || sharing === false || !hasCompleted) return;
    if (backendMode === 'mock' || backendMode === 'live-readonly') return;
    const timer = setTimeout(() => { syncNow().catch(() => undefined); }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, sharing, hasCompleted, backendMode, student?.studentId]);

  const setSharing = useCallback(async (on: boolean) => {
    if (!student) return;
    const epoch = ownerEpoch.current;
    const stillOwner = () => ownerEpoch.current === epoch && ownerRef.current === student.studentId;
    if (backendMode === 'mock' || backendMode === 'live-readonly') { setSharingState(on); return; }
    try {
      await setMentorSharing(student.studentId, on);
      if (!stillOwner()) return;
      setSharingState(on);
      if (on) await syncNow(true);
      else setStatus('off');
    } catch {
      if (stillOwner()) setStatus('error');
    }
  }, [backendMode, student, syncNow]);

  const value = useMemo<ProgressSyncValue>(() => ({ sharing, status, lastSyncedAt, setSharing, syncNow }), [lastSyncedAt, setSharing, sharing, status, syncNow]);

  return <ProgressSyncContext.Provider value={value}>{children}</ProgressSyncContext.Provider>;
};

export const useProgressSync = () => {
  const context = useContext(ProgressSyncContext);
  if (!context) throw new Error('useProgressSync must be used inside ProgressSyncProvider');
  return context;
};
