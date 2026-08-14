import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useData } from './DataContext';
import { useStudyReceipts } from './StudyReceiptContext';

export type NotificationType = 'announcement' | 'mentor' | 'material' | 'report' | 'feedback' | 'memory';
export type NotificationTarget = 'home' | 'notes' | 'reports' | 'receipt';

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  date: string;
  target: NotificationTarget;
  sessionId?: string;
  order: number;
};

type NotificationsValue = {
  notifications: AppNotification[];
  unreadCount: number;
  isRead: (id: string) => boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsValue | undefined>(undefined);
const readKey = (studentId: string) => `ump_mobile_read_notifications_${studentId}`;

const stable = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);

export const NotificationsProvider = ({ children }: PropsWithChildren) => {
  const { student } = useAuth();
  const { data } = useData();
  const { dueReceipts } = useStudyReceipts();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    if (!student) {
      setReadIds(new Set());
      return;
    }
    AsyncStorage.getItem(readKey(student.studentId)).then((saved) => {
      if (!mounted) return;
      try { setReadIds(new Set(saved ? JSON.parse(saved) as string[] : [])); }
      catch { setReadIds(new Set()); }
    });
    return () => { mounted = false; };
  }, [student]);

  const notifications = useMemo<AppNotification[]>(() => {
    const items: AppNotification[] = [];
    let order = 10_000;

    dueReceipts.forEach((item) => items.push({
      id: `memory:${item.id}`,
      type: 'memory',
      title: '24-hour memory check due',
      body: `${item.subject} · ${item.target}`,
      date: 'Due now',
      target: 'receipt',
      sessionId: item.sessionId,
      order: order--,
    }));
    data.feedback.forEach((item) => items.push({
      id: `feedback:${item.id}`,
      type: 'feedback',
      title: `Message from ${item.mentor || 'your mentor'}`,
      body: item.message,
      date: [item.date, item.time].filter(Boolean).join(' · '),
      target: 'home',
      order: order--,
    }));
    data.announcements.forEach((item) => items.push({
      id: `announcement:${stable(item.title)}:${stable(item.date)}`,
      type: 'announcement',
      title: item.title || 'New announcement',
      body: item.message || item.body || '',
      date: item.date || 'Recently',
      target: 'home',
      order: order--,
    }));
    data.mentorNotes.forEach((item) => items.push({
      id: `mentor:${stable(item.date)}:${stable(item.note)}`,
      type: 'mentor',
      title: 'New mentor guidance',
      body: item.note,
      date: item.date || 'Recently',
      target: 'home',
      order: order--,
    }));
    data.studyNotes.forEach((item) => items.push({
      id: `material:${item.id}`,
      type: 'material',
      title: item.title || 'New study material',
      body: [item.subject, item.category, item.description].filter(Boolean).join(' · '),
      date: item.date || 'Recently',
      target: 'notes',
      order: order--,
    }));
    data.reports.forEach((item) => items.push({
      id: `report:${stable(item.weekOf)}`,
      type: 'report',
      title: 'Weekly report is ready',
      body: `${item.weekOf}${item.level ? ` · ${item.level}` : ''}${item.weeklyHours != null ? ` · ${item.weeklyHours} hours` : ''}`,
      date: item.weekOf || 'Recently',
      target: 'reports',
      order: order--,
    }));

    return items.sort((a, b) => b.order - a.order).slice(0, 50);
  }, [data.announcements, data.feedback, data.mentorNotes, data.reports, data.studyNotes, dueReceipts]);

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

  const value = useMemo<NotificationsValue>(() => ({
    notifications,
    unreadCount: notifications.reduce((total, item) => total + (readIds.has(item.id) ? 0 : 1), 0),
    isRead: (id) => readIds.has(id),
    markRead,
    markAllRead,
  }), [markAllRead, markRead, notifications, readIds]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = () => {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used inside NotificationsProvider');
  return context;
};
