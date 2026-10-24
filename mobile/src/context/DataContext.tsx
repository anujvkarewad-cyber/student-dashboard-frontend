import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { api } from '../api/client';
import { getSessionGeneration } from '../storage/session';
import type { DashboardData, StudyLogPayload } from '../types';
import { useAuth } from './AuthContext';

const emptyData: DashboardData = {
  stats: {},
  studyLog: [],
  leaderboard: [],
  reports: [],
  announcements: [],
  mentorNotes: [],
  studyNotes: [],
  feedback: [],
};

type DataContextValue = {
  data: DashboardData;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refreshAll: (silent?: boolean) => Promise<void>;
  refreshTracker: (silent?: boolean) => Promise<void>;
  refreshLeaderboard: (silent?: boolean) => Promise<void>;
  refreshReports: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  submitStudyLog: (entry: StudyLogPayload) => Promise<void>;
  deleteStudyLog: (entry: { date: string; hours: number; topic?: string }) => Promise<void>;
  dismissFeedback: (id: string) => Promise<void>;
};

const DataContext = createContext<DataContextValue | undefined>(undefined);

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.';
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = async <T,>(request: Promise<T>): Promise<Settled<T>> => {
  try { return { ok: true, value: await request }; }
  catch (error) { return { ok: false, error }; }
};

export const DataProvider = ({ children }: PropsWithChildren) => {
  const { student } = useAuth();
  const epoch = getSessionGeneration();
  const identity = `${epoch}:${student?.studentId || ''}`;
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const isCurrent = useCallback(() => activeIdentity.current === identity && getSessionGeneration() === epoch, [identity, epoch]);
  const [stored, setStored] = useState({ identity: '', data: emptyData });
  const data = stored.identity === identity && student ? stored.data : emptyData;
  const setData = useCallback((value: React.SetStateAction<DashboardData>) => {
    if (!isCurrent()) return;
    setStored(current => {
      if (!isCurrent()) return current;
      const previous = current.identity === identity ? current.data : emptyData;
      return { identity, data: typeof value === 'function' ? value(previous) : value };
    });
  }, [identity, isCurrent]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notesRefreshRef = useRef<Promise<void> | null>(null);

  const fetchAll = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (!student || !isCurrent()) return;
    setData(emptyData);
    // 'silent' is used for background freshness pulls (app foreground / screen
    // focus) so no spinner flashes while the data is refreshed under the hood.
    if (mode === 'initial') setLoading(true);
    else if (mode === 'refresh') setRefreshing(true);
    setError(null);
    const id = student.studentId;
    try {
      // Wave 1 paints the home screen. Wave 2 waits so 200 phones opening
      // together do not fire 8 calls in the same second.
      const first = await Promise.all([
        settle(api.getStats(id)),
        settle(api.getStudyLog(id)),
        settle(api.getAnnouncements()),
      ]);
      if (!isCurrent()) return;
      setData((current) => {
        const next: DashboardData = {
          ...current,
          stats: first[0].ok ? first[0].value || {} : current.stats,
          studyLog: first[1].ok ? first[1].value || [] : current.studyLog,
          announcements: first[2].ok ? first[2].value || [] : current.announcements,
        };
        return next;
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (!isCurrent()) return;
      const rest = await Promise.all([
        settle(api.getLeaderboard()),
        settle(api.getWeeklyReports(id)),
        settle(api.getStudentMentorNotes(id)),
        settle(api.getNotes(id)),
        settle(api.getMentorFeedback(id)),
      ]);
      const values = [...first, rest[0], rest[1], rest[2], rest[3], rest[4]];
      const failures = values.filter((result) => !result.ok);
      if (failures.length === values.length) throw failures[0].error;
      if (!isCurrent()) return;
      setData((current) => {
        const next: DashboardData = {
          stats: first[0].ok ? first[0].value || {} : current.stats,
          studyLog: first[1].ok ? first[1].value || [] : current.studyLog,
          announcements: first[2].ok ? first[2].value || [] : current.announcements,
          leaderboard: rest[0].ok ? rest[0].value || [] : current.leaderboard,
          reports: rest[1].ok ? rest[1].value || [] : current.reports,
          mentorNotes: rest[2].ok ? rest[2].value || [] : current.mentorNotes,
          studyNotes: rest[3].ok ? rest[3].value || [] : current.studyNotes,
          feedback: rest[4].ok ? rest[4].value || [] : current.feedback,
        };
        return next;
      });
      if (failures.length) setError(`${failures.length} dashboard section${failures.length === 1 ? '' : 's'} could not refresh. Unavailable sections stay empty.`);
    } catch (e) {
      if (isCurrent()) setError(messageOf(e));
      throw e;
    } finally {
      if (isCurrent()) { setLoading(false); setRefreshing(false); }
    }
  }, [isCurrent, setData, student]);

  useEffect(() => {
    let mounted = true;
    if (!student) {
      setData(emptyData);
      setLoading(false);
      return;
    }
    // Remove only legacy server dashboard caches, never authored drafts/audio.
    for (const mode of ['live', 'live-readonly', 'mock']) {
      AsyncStorage.removeItem(`ump_mobile_cache_${mode}_${student.studentId}`).catch(() => undefined);
    }
    notesRefreshRef.current = null;
    if (mounted) fetchAll('initial').catch(() => undefined);
    return () => { mounted = false; };
  }, [fetchAll, student, setData]);

  // Systematic freshness: whenever the app returns to the foreground, silently
  // re-pull every dashboard section (stats, leaderboard, daily, reports, notes)
  // so nothing is stale when a student reopens the app hours later. This is the
  // single fix that keeps the "small things" up to date without the user having
  // to pull-to-refresh each screen.
  useEffect(() => {
    if (!student) return;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (previous.match(/inactive|background/) && next === 'active') {
        fetchAll('silent').catch(() => undefined);
      }
      previous = next;
    });
    return () => subscription.remove();
  }, [fetchAll, student]);

  const updateAndPersist = useCallback((updater: (current: DashboardData) => DashboardData) => {
    setData((current) => {
      const next = updater(current);
      return next;
    });
  }, [setData]);

  const refreshTracker = useCallback(async (silent = false) => {
    if (!student) return;
    if (!silent) { setRefreshing(true); setError(null); }
    try {
      const [stats, studyLog] = await Promise.all([
        api.getStats(student.studentId),
        api.getStudyLog(student.studentId),
      ]);
      updateAndPersist((current) => ({ ...current, stats, studyLog }));
    } catch (e) {
      if (!silent) setError(messageOf(e));
      throw e;
    } finally { if (!silent) setRefreshing(false); }
  }, [student, updateAndPersist]);

  const refreshLeaderboard = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const leaderboard = await api.getLeaderboard();
      updateAndPersist((current) => ({ ...current, leaderboard }));
    } finally { if (!silent) setRefreshing(false); }
  }, [updateAndPersist]);

  const refreshReports = useCallback(async () => {
    if (!student) return;
    setRefreshing(true);
    try {
      const reports = await api.getWeeklyReports(student.studentId);
      updateAndPersist((current) => ({ ...current, reports }));
    } finally { setRefreshing(false); }
  }, [student, updateAndPersist]);

  const refreshNotes = useCallback(async () => {
    if (!student) return;
    if (notesRefreshRef.current) return notesRefreshRef.current;
    const request = (async () => {
      setRefreshing(true);
      try {
        const studyNotes = await api.getNotes(student.studentId);
        updateAndPersist((current) => ({ ...current, studyNotes }));
      } finally { setRefreshing(false); }
    })();
    notesRefreshRef.current = request;
    try { await request; }
    finally { if (notesRefreshRef.current === request) notesRefreshRef.current = null; }
  }, [student, updateAndPersist]);

  const submitStudyLog = useCallback(async (entry: StudyLogPayload) => {
    if (!student) throw new Error('Please log in again.');
    const result = await api.addStudyLog(student.studentId, entry);
    if (result?.success !== true) throw new Error(result?.message || 'Save outcome is unknown. Keep this draft and check Study tracker before retrying.');
    try { await refreshTracker(); }
    catch {
      throw new Error('The server acknowledged your save, but the tracker could not refresh. Keep this draft and check Study tracker before submitting again.');
    }
  }, [refreshTracker, student]);

  const deleteStudyLog = useCallback(async (entry: { date: string; hours: number; topic?: string }) => {
    if (!student) throw new Error('Please log in again.');
    const result = await api.deleteStudyLog(student.studentId, entry);
    if (!result?.success) throw new Error(result?.message || 'The study log could not be deleted.');
    await refreshTracker();
  }, [refreshTracker, student]);

  const dismissFeedback = useCallback(async (id: string) => {
    try { await api.markMentorFeedbackRead(id); }
    catch (error) { if (!api.isReadOnlyMode()) throw error; }
    updateAndPersist((current) => ({
      ...current,
      feedback: current.feedback.filter((item) => item.id !== id),
    }));
  }, [updateAndPersist]);

  const value = useMemo(() => ({
    data,
    loading,
    refreshing,
    error,
    refreshAll: (silent = false) => fetchAll(silent ? 'silent' : 'refresh'),
    refreshTracker,
    refreshLeaderboard,
    refreshReports,
    refreshNotes,
    submitStudyLog,
    deleteStudyLog,
    dismissFeedback,
  }), [data, loading, refreshing, error, fetchAll, refreshTracker, refreshLeaderboard, refreshReports, refreshNotes, submitStudyLog, deleteStudyLog, dismissFeedback]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used inside DataProvider');
  return context;
};
