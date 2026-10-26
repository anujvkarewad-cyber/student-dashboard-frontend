import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getSessionGeneration } from '../storage/session';
import { fetchMessages } from '../api/reformApi';
import { notifyNow, syncDailyNotifications } from '../services/dailyNotifications';
import { NativePushStatus, registerNativePush, subscribeToNativeTokenChanges } from '../services/pushNotifications';
import { CaGroup, groupsForStudent } from '../utils/caGroups';
import { useAuth } from './AuthContext';
import { useDailyMcq } from './DailyMcqContext';
import { useData } from './DataContext';
import { useStudyReceipts } from './StudyReceiptContext';

export type NotificationType = 'announcement' | 'mentor' | 'material' | 'report' | 'feedback' | 'memory' | 'mcq' | 'target' | 'log';
export type NotificationTarget = 'home' | 'notes' | 'reports' | 'receipt' | 'mcq' | 'target' | 'tracker' | 'messages';

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  date: string;
  target: NotificationTarget;
  sessionId?: string;
  group?: CaGroup;
  order: number;
};

type NotificationsValue = {
  notifications: AppNotification[];
  unreadCount: number;
  pushStatus: NativePushStatus;
  enablePush: () => Promise<void>;
  isRead: (id: string) => boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  isCleared: (id: string) => boolean;
};

const NotificationsContext = createContext<NotificationsValue | undefined>(undefined);
const readKey = (studentId: string) => `ump_mobile_read_notifications_${studentId}`;
const clearedKey = (studentId: string) => `ump_mobile_cleared_notifications_${studentId}`;

const stable = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);

export const NotificationsProvider = ({ children }: PropsWithChildren) => {
  const { student, backendMode } = useAuth();
  const { data } = useData();
  const { dateKey: dailyMcqDate, todayAttempts: dailyMcqAttempts } = useDailyMcq();
  const { dueReceipts } = useStudyReceipts();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  const [pushStatus, setPushStatus] = useState<NativePushStatus>('idle');
  // Mentor replies and the day's own state are not in `data`, so they are tracked
  // here rather than being faked from other screens' state.
  const [mentorReplies, setMentorReplies] = useState<{ id: string; text: string }[]>([]);
  const [targetDoneToday, setTargetDoneToday] = useState(false);
  const replyOwner = useRef('');
  const seenMentorIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!student) {
      setReadIds(new Set());
      setClearedIds(new Set());
      return;
    }
    AsyncStorage.getItem(readKey(student.studentId)).then((saved) => {
      if (!mounted) return;
      try { setReadIds(new Set(saved ? JSON.parse(saved) as string[] : [])); }
      catch { setReadIds(new Set()); }
    });
    AsyncStorage.getItem(clearedKey(student.studentId)).then((saved) => {
      if (!mounted) return;
      try { setClearedIds(new Set(saved ? JSON.parse(saved) as string[] : [])); }
      catch { setClearedIds(new Set()); }
    });
    return () => { mounted = false; };
  }, [student]);

  useEffect(() => {
    if (!student || backendMode !== 'live') {
      setPushStatus('idle');
      return;
    }
    let mounted = true;
    setPushStatus('requesting');
    registerNativePush(student.studentId).then((status) => {
      if (mounted) setPushStatus(status);
    });
    const tokenSubscription = subscribeToNativeTokenChanges(student.studentId);
    // The target unlocks at 00:00, so its notification is scheduled with the OS
    // rather than derived in-app - it has to arrive with the phone locked.
    syncDailyNotifications().catch(() => undefined);
    return () => {
      mounted = false;
      tokenSubscription.remove();
    };
  }, [backendMode, student]);

  // ── mentor replies ────────────────────────────────────────────────────────
  // A reply the student never notices is the same as no reply. Polling lives
  // here, not on the Messages screen, so it fires wherever they are in the app.
  useEffect(() => {
    if (!student) {
      setMentorReplies([]);
      seenMentorIds.current = null;
      return;
    }
    let mounted = true;

    setMentorReplies([]);
    seenMentorIds.current = null;
    replyOwner.current = student.studentId;
    const epoch = getSessionGeneration();
    const poll = async () => {
      const res = await fetchMessages(student.studentId);
      if (!mounted || getSessionGeneration() !== epoch || !res?.messages) return;
      const fromMentor = res.messages.filter((m) => m.from === 'mentor');
      if (!fromMentor.length) return;

      // First pass only records what already exists - the student must not be
      // notified about a conversation they have already read.
      if (seenMentorIds.current === null) {
        seenMentorIds.current = new Set(fromMentor.map((m) => m.id));
        return;
      }

      const fresh = fromMentor.filter((m) => !seenMentorIds.current?.has(m.id));
      if (!fresh.length) return;
      fresh.forEach((m) => seenMentorIds.current?.add(m.id));
      setMentorReplies((current) => [...fresh.map((m) => ({ id: m.id, text: m.text })), ...current].slice(0, 20));

      const newest = fresh[fresh.length - 1];
      // Bring the reply to the phone itself: the student is not sitting on the
      // Messages screen, which is the whole reason a notification is needed.
      await notifyNow('Reply from your mentor', newest.text);
    };

    poll();
    const timer = setInterval(poll, 30_000);
    return () => { mounted = false; clearInterval(timer); };
  }, [student]);

  // ── today's target ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!student) return;
    let mounted = true;
    const read = async () => {
      const key = new Date().toISOString().slice(0, 10);
      try {
        const raw = await AsyncStorage.getItem(`ump_target_${key}`);
        const map = raw ? JSON.parse(raw) : {};
        const done = Boolean(map.mcq) && Boolean(map.tracker) && Boolean(map.revise);
        if (mounted) setTargetDoneToday(done);
      } catch {
        if (mounted) setTargetDoneToday(false);
      }
    };
    read();
    const timer = setInterval(read, 60_000);
    return () => { mounted = false; clearInterval(timer); };
  }, [student]);

  const enablePush = useCallback(async () => {
    if (!student || backendMode !== 'live') return;
    setPushStatus('requesting');
    setPushStatus(await registerNativePush(student.studentId, true));
  }, [backendMode, student]);

  const notifications = useMemo<AppNotification[]>(() => {
    const items: AppNotification[] = [];
    if (!student) return items;
    let order = 10_000;

    // Suppress duplicates: only add if ID not already present
    const existingIds = new Set(items.map(i => i.id));
    const addIfUnique = (item: AppNotification) => {
      if (existingIds.has(item.id) || clearedIds.has(item.id)) return;
      existingIds.add(item.id);
      items.push(item);
    };

    groupsForStudent(student?.group).forEach((group) => {
      const attempt = dailyMcqAttempts.find((item) => item.group === group);
      if (attempt?.completedAt) return;
      addIfUnique({
        id: `mcq:${dailyMcqDate}:${group}`,
        type: 'mcq',
        title: attempt ? `Continue ${group} Daily MCQ` : `${group} Daily MCQ is ready`,
        body: attempt ? `${Object.keys(attempt.answers).length}/10 answered · finish before the day ends` : `10 ${group} questions · 10 minute challenge`,
        date: 'Today',
        target: 'mcq',
        group,
        order: order--,
      });
    });
    // The day's own business, sent from the app rather than waiting for the
    // student to go looking for it.
    if (!targetDoneToday) {
      const dayKey = new Date().toISOString().slice(0, 10);
      addIfUnique({
        id: `target:${dayKey}`,
        type: 'target',
        title: 'Today\'s target is open',
        body: 'Three tasks waiting. It stays open all day - finish whenever you sit down.',
        date: 'Today',
        target: 'target',
        order: order--,
      });
    }

    // Only in the evening: asking at 10 in the morning is nagging, not helping.
    if (new Date().getHours() >= 21) {
      const dayKey = new Date().toISOString().slice(0, 10);
      const loggedToday = (data.studyLog || []).some((entry) => String(entry.date || '').startsWith(dayKey));
      if (!loggedToday) {
        addIfUnique({
          id: `log:${dayKey}`,
          type: 'log',
          title: 'Today\'s study log is still pending',
          body: 'Log your hours so your mentor can see the work behind the marks.',
          date: 'Tonight',
          target: 'tracker',
          order: order--,
        });
      }
    }

    (replyOwner.current === student?.studentId ? mentorReplies : []).forEach((reply) => addIfUnique({
      id: `mentorreply:${reply.id}`,
      type: 'mentor',
      title: 'Reply from your mentor',
      body: reply.text,
      date: 'Now',
      target: 'messages',
      order: order--,
    }));

    dueReceipts.forEach((item) => addIfUnique({
      id: `memory:${item.id}`,
      type: 'memory',
      title: '24-hour memory check due',
      body: `${item.subject} · ${item.target}`,
      date: 'Due now',
      target: 'receipt',
      sessionId: item.sessionId,
      order: order--,
    }));
    data.feedback.forEach((item) => addIfUnique({
      id: `feedback:${item.id}`,
      type: 'feedback',
      title: `Message from ${item.mentor || 'your mentor'}`,
      body: item.message,
      date: [item.date, item.time].filter(Boolean).join(' · '),
      target: 'home',
      order: order--,
    }));
    data.announcements.forEach((item) => addIfUnique({
      id: `announcement:${stable(item.title)}:${stable(item.date)}`,
      type: 'announcement',
      title: item.title || 'New announcement',
      body: item.message || item.body || '',
      date: item.date || 'Recently',
      target: 'home',
      order: order--,
    }));
    data.mentorNotes.forEach((item) => addIfUnique({
      id: `mentor:${stable(item.date)}:${stable(item.note)}`,
      type: 'mentor',
      title: 'New mentor guidance',
      body: item.note,
      date: item.date || 'Recently',
      target: 'home',
      order: order--,
    }));
    data.studyNotes.forEach((item) => addIfUnique({
      id: `material:${item.id}`,
      type: 'material',
      title: item.title || 'New study material',
      body: [item.subject, item.category, item.description].filter(Boolean).join(' · '),
      date: item.date || 'Recently',
      target: 'notes',
      order: order--,
    }));
    data.reports.forEach((item) => addIfUnique({
      id: `report:${stable(item.weekOf)}`,
      type: 'report',
      title: 'Weekly report is ready',
      body: `${item.weekOf}${item.level ? ` · ${item.level}` : ''}${item.weeklyHours != null ? ` · ${item.weeklyHours} hours` : ''}`,
      date: item.weekOf || 'Recently',
      target: 'reports',
      order: order--,
    }));

    return items.sort((a, b) => b.order - a.order).slice(0, 50).filter(i => !clearedIds.has(i.id));
  }, [dailyMcqAttempts, dailyMcqDate, data.announcements, data.feedback, data.mentorNotes, data.reports, data.studyLog, data.studyNotes, dueReceipts, mentorReplies, student?.group, student?.studentId, targetDoneToday, clearedIds]);

  const persist = useCallback(async (next: Set<string>) => {
    setReadIds(next);
    if (student) await AsyncStorage.setItem(readKey(student.studentId), JSON.stringify([...next].slice(-200)));
  }, [student]);

  const markRead = useCallback(async (id: string) => {
    if (readIds.has(id)) return;
    const next = new Set(readIds);
    next.add(id);
    await persist(next);
  }, [persist, readIds]);

  const markAllRead = useCallback(async () => {
    const next = new Set(readIds);
    notifications.forEach((item) => next.add(item.id));
    await persist(next);
  }, [notifications, persist, readIds]);

  const persistCleared = useCallback(async (next: Set<string>) => {
    setClearedIds(next);
    if (student) await AsyncStorage.setItem(clearedKey(student.studentId), JSON.stringify([...next].slice(-200)));
  }, [student]);

  const clearAll = useCallback(async () => {
    const next = new Set(clearedIds);
    notifications.forEach((item) => next.add(item.id));
    await persistCleared(next);
  }, [notifications, persistCleared, clearedIds]);

  const isCleared = useCallback((id: string) => clearedIds.has(id), [clearedIds]);

  const value = useMemo<NotificationsValue>(() => ({
    notifications,
    unreadCount: notifications.reduce((total, item) => total + (readIds.has(item.id) ? 0 : 1), 0),
    pushStatus,
    enablePush,
    isRead: (id) => readIds.has(id),
    markRead,
    markAllRead,
    clearAll,
    isCleared,
  }), [enablePush, markAllRead, markRead, notifications, pushStatus, readIds, clearAll, isCleared]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = () => {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used inside NotificationsProvider');
  return context;
};
