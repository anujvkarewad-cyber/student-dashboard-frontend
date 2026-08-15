import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
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
  refreshAll: () => Promise<void>;
  refreshTracker: () => Promise<void>;
  refreshLeaderboard: () => Promise<void>;
  refreshReports: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  submitStudyLog: (entry: StudyLogPayload) => Promise<void>;
  dismissFeedback: (id: string) => Promise<void>;
};

const DataContext = createContext<DataContextValue | undefined>(undefined);

const cacheKey = (studentId: string) => `ump_mobile_cache_${api.getMode()}_${studentId}`;
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.';

export const DataProvider = ({ children }: PropsWithChildren) => {
  const { student } = useAuth();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback(async (next: DashboardData) => {
    if (!student) return;
    try { await AsyncStorage.setItem(cacheKey(student.studentId), JSON.stringify(next)); } catch { /* cache is best effort */ }
  }, [student]);

  const fetchAll = useCallback(async (showRefresh = false) => {
    if (!student) return;
    showRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    const id = student.studentId;
    try {
      const values = await Promise.all([
        api.getStats(id),
        api.getStudyLog(id),
        api.getLeaderboard(),
        api.getWeeklyReports(id),
        api.getAnnouncements(),
        api.getStudentMentorNotes(id),
        api.getNotes(id),
        api.getMentorFeedback(id),
      ]);
      const next: DashboardData = {
        stats: values[0] || {},
        studyLog: values[1] || [],
        leaderboard: values[2] || [],
        reports: values[3] || [],
        announcements: values[4] || [],
        mentorNotes: values[5] || [],
        studyNotes: values[6] || [],
        feedback: values[7] || [],
      };
      setData(next);
      await persist(next);
    } catch (e) {
      setError(messageOf(e));
      throw e;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [persist, student]);

  useEffect(() => {
    let mounted = true;
    if (!student) {
      setData(emptyData);
      setLoading(false);
      return;
    }
    const start = async () => {
      try {
        const cached = await AsyncStorage.getItem(cacheKey(student.studentId));
        if (mounted && cached) setData(JSON.parse(cached) as DashboardData);
      } catch { /* fetch below remains the source of truth */ }
      if (mounted) fetchAll(false).catch(() => undefined);
    };
    start();
    return () => { mounted = false; };
  }, [fetchAll, student]);

  const updateAndPersist = useCallback((updater: (current: DashboardData) => DashboardData) => {
    setData((current) => {
      const next = updater(current);
      persist(next);
      return next;
    });
  }, [persist]);

  const refreshTracker = useCallback(async () => {
    if (!student) return;
    setRefreshing(true);
    setError(null);
    try {
      const [stats, studyLog] = await Promise.all([
        api.getStats(student.studentId),
        api.getStudyLog(student.studentId),
      ]);
      updateAndPersist((current) => ({ ...current, stats, studyLog }));
    } catch (e) {
      setError(messageOf(e));
      throw e;
    } finally { setRefreshing(false); }
  }, [student, updateAndPersist]);

  const refreshLeaderboard = useCallback(async () => {
    setRefreshing(true);
    try {
      const leaderboard = await api.getLeaderboard();
      updateAndPersist((current) => ({ ...current, leaderboard }));
    } finally { setRefreshing(false); }
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
    setRefreshing(true);
    try {
      const studyNotes = await api.getNotes(student.studentId);
      updateAndPersist((current) => ({ ...current, studyNotes }));
    } finally { setRefreshing(false); }
  }, [student, updateAndPersist]);

  const submitStudyLog = useCallback(async (entry: StudyLogPayload) => {
    if (!student) throw new Error('Please log in again.');
    const result = await api.addStudyLog(student.studentId, entry);
    if (!result?.success) throw new Error(result?.message || 'The study log could not be saved.');
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
    refreshAll: () => fetchAll(true),
    refreshTracker,
    refreshLeaderboard,
    refreshReports,
    refreshNotes,
    submitStudyLog,
    dismissFeedback,
  }), [data, loading, refreshing, error, fetchAll, refreshTracker, refreshLeaderboard, refreshReports, refreshNotes, submitStudyLog, dismissFeedback]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used inside DataProvider');
  return context;
};
