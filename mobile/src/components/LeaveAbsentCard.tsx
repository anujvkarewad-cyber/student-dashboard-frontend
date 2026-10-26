import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../api/client';
import { Card, Chip, FormInput, PrimaryButton } from './ui';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing } from '../theme';
import type { AttendanceStatus } from '../types';
import { getSessionGeneration } from '../storage/session';

/**
 * "On leave" / "Absent" self-reporting (owner spec, 14 Oct 2026).
 *
 * Students disappear from the tracker and only explain later ("absent the").
 * This card sits on top of the tracker list so they can say it themselves:
 *   - I was absent        -> pick the day (today or up to 3 days back) + reason
 *   - Going on leave      -> start day + how many days (2/3/4...) + reason
 * The mentor tracker then shows Leave / Absent instead of Missed, the days stay
 * out of the attendance % and the night reminders skip them.
 *
 * Dates are deliberately chip-based (no native date-picker dependency) so the
 * whole flow works on every Android build we ship.
 */

const shortDate = (iso: string) => {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const addDays = (base: Date, days: number) => {
  const next = new Date(base.getTime());
  next.setDate(next.getDate() + days);
  return next;
};

const isoOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const ABSENT_OPTIONS = [
  { label: 'Today', offset: 0 },
  { label: 'Yesterday', offset: 1 },
  { label: '2 days ago', offset: 2 },
  { label: '3 days ago', offset: 3 },
];

const LEAVE_START_OPTIONS = [
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
  { label: 'Day after', offset: 2 },
];

const LEAVE_LENGTHS = [1, 2, 3, 4, 5, 6, 7, 10, 14];

export const LeaveAbsentCard = () => {
  const { student, backendMode } = useAuth();
  const studentId = student?.studentId || '';
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'none' | 'absent' | 'leave'>('none');
  const [absentOffset, setAbsentOffset] = useState(0);
  const [leaveStart, setLeaveStart] = useState(0);
  const [leaveDays, setLeaveDays] = useState(3);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canWrite = backendMode === 'live';

  const load = useCallback(async () => {
    if (!studentId || !canWrite) return;
    const epoch = getSessionGeneration();
    setLoading(true);
    try {
      const result = await api.getAttendanceStatus(studentId);
      if (epoch === getSessionGeneration() && result?.studentId === studentId) setStatus(result);
    } catch (err) {
      setError((err as Error)?.message || 'Could not load your leave status.');
    } finally {
      setLoading(false);
    }
  }, [canWrite, studentId]);

  useEffect(() => {
    setStatus(null);
    setError('');
    setNotice('');
    void load();
  }, [load]);

  const today = useMemo(() => new Date(), []);
  const backfillDays = status?.limits?.backfillDays ?? 3;
  const maxLeaveDays = status?.limits?.maxLeaveDays ?? 21;
  const absentOptions = ABSENT_OPTIONS.filter((option) => option.offset <= backfillDays);
  const lengths = LEAVE_LENGTHS.filter((value) => value <= maxLeaveDays);

  const ownStatus = status?.studentId === studentId ? status : null;
  const activeLeave = ownStatus?.leaves?.find((row) => row.active) || null;
  const upcomingLeave =
    activeLeave || ownStatus?.leaves?.find((row) => row.from > (ownStatus?.today || '')) || null;

  const startIso = isoOf(addDays(today, leaveStart));
  const endIso = isoOf(addDays(today, leaveStart + Math.max(0, leaveDays - 1)));

  const close = () => {
    setMode('none');
    setReason('');
    setError('');
  };

  const saveAbsent = async () => {
    if (!studentId) return;
    setSaving(true);
    setError('');
    try {
      await api.markAbsent(studentId, { date: isoOf(addDays(today, absentOffset)), reason: reason.trim() });
      setNotice('Marked. Your mentor will see you were absent.');
      close();
      await load();
    } catch (err) {
      setError((err as Error)?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveLeave = async () => {
    if (!studentId) return;
    setSaving(true);
    setError('');
    try {
      await api.requestLeave(studentId, { from: startIso, to: endIso, reason: reason.trim() });
      setNotice(`Leave saved: ${shortDate(startIso)} – ${shortDate(endIso)}.`);
      close();
      await load();
    } catch (err) {
      setError((err as Error)?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const cancelLeave = async () => {
    if (!studentId || !upcomingLeave) return;
    setSaving(true);
    setError('');
    try {
      await api.cancelLeave(studentId, upcomingLeave.leaveId);
      setNotice('Leave cancelled.');
      await load();
    } catch (err) {
      setError((err as Error)?.message || 'Could not cancel. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Hidden in batch/demo modes: leave reporting is a live-only feature.
  if (!canWrite || !studentId) return null;

  const banner = activeLeave
    ? {
        icon: 'airplane-outline' as const,
        tone: 'leave' as const,
        title: `On leave till ${shortDate(activeLeave.to)}`,
        body: activeLeave.from === activeLeave.to
          ? 'Your mentor can see this day as Leave.'
          : `${shortDate(activeLeave.from)} – ${shortDate(activeLeave.to)} · ${activeLeave.days} day${
              activeLeave.days === 1 ? '' : 's'
            }`,
      }
    : ownStatus?.status === 'absent'
      ? {
          icon: 'close-circle-outline' as const,
          tone: 'absent' as const,
          title: 'Marked absent today',
          body: 'Your mentor can see why today is empty.',
        }
      : upcomingLeave
        ? {
            icon: 'calendar-outline' as const,
            tone: 'leave' as const,
            title: `Leave planned from ${shortDate(upcomingLeave.from)}`,
            body: `Till ${shortDate(upcomingLeave.to)} · ${upcomingLeave.days} day${
              upcomingLeave.days === 1 ? '' : 's'
            }`,
          }
        : null;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <Ionicons name="calendar-number-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Away from study?</Text>
          <Text style={styles.sub}>
            Tell your mentor once instead of leaving the day empty.
          </Text>
        </View>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      {banner ? (
        <View
          style={[
            styles.banner,
            banner.tone === 'leave' ? styles.bannerLeave : styles.bannerAbsent,
          ]}
        >
          <Ionicons name={banner.icon} size={18} color={banner.tone === 'leave' ? '#1D4ED8' : colors.red} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>{banner.title}</Text>
            <Text style={styles.bannerBody}>{banner.body}</Text>
          </View>
          {upcomingLeave && !activeLeave ? (
            <Pressable onPress={cancelLeave} hitSlop={10} disabled={saving}>
              <Text style={styles.cancelLink}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {ownStatus?.recentAbsent?.length ? (
        <View style={styles.banner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Recent absent days</Text>
            {[...ownStatus.recentAbsent].reverse().map(row => (
              <Text key={row.date} style={styles.bannerBody}>{shortDate(row.date)} · Absent{row.reason ? ` — ${row.reason}` : ''}</Text>
            ))}
          </View>
        </View>
      ) : null}
      {ownStatus?.leaves?.length ? (
        <View style={styles.banner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Leave records</Text>
            {ownStatus.leaves.map(row => (
              <Text key={row.leaveId} style={styles.bannerBody}>{shortDate(row.from)} – {shortDate(row.to)} · Leave{row.reason ? ` — ${row.reason}` : ''}</Text>
            ))}
          </View>
        </View>
      ) : null}

      {activeLeave ? (
        <Pressable onPress={cancelLeave} hitSlop={10} disabled={saving} style={styles.cancelRow}>
          <Ionicons name="close-circle-outline" size={16} color={colors.muted} />
          <Text style={styles.cancelRowText}>I am back — cancel my leave</Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <PrimaryButton
          label="I was absent"
          icon="close-circle-outline"
          variant="secondary"
          onPress={() => {
            setMode('absent');
            setReason('');
            setError('');
          }}
          style={styles.action}
        />
        <PrimaryButton
          label="Going on leave"
          icon="airplane-outline"
          onPress={() => {
            setMode('leave');
            setReason('');
            setError('');
          }}
          style={styles.action}
        />
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error && mode === 'none' ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={mode !== 'none'} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>
                {mode === 'absent' ? 'Mark an absent day' : 'Going on leave'}
              </Text>
              <Text style={styles.sheetSub}>
                {mode === 'absent'
                  ? 'Pick the day you could not study. Your mentor sees "Absent" with your reason.'
                  : 'Your mentor sees "Leave" for these days and the tracker % stays honest.'}
              </Text>

              {mode === 'absent' ? (
                <>
                  <Text style={styles.label}>Day</Text>
                  <View style={styles.chips}>
                    {absentOptions.map((option) => (
                      <Chip
                        key={option.label}
                        label={option.label}
                        selected={absentOffset === option.offset}
                        onPress={() => setAbsentOffset(option.offset)}
                      />
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Leave starts</Text>
                  <View style={styles.chips}>
                    {LEAVE_START_OPTIONS.map((option) => (
                      <Chip
                        key={option.label}
                        label={`${option.label} · ${shortDate(isoOf(addDays(today, option.offset)))}`}
                        selected={leaveStart === option.offset}
                        onPress={() => setLeaveStart(option.offset)}
                      />
                    ))}
                  </View>

                  <Text style={styles.label}>How many days</Text>
                  <View style={styles.chips}>
                    {lengths.map((value) => (
                      <Chip
                        key={value}
                        label={`${value}d`}
                        selected={leaveDays === value}
                        onPress={() => setLeaveDays(value)}
                      />
                    ))}
                  </View>
                  <View style={styles.rangePill}>
                    <Ionicons name="calendar-outline" size={15} color={colors.primary} />
                    <Text style={styles.rangeText}>
                      {shortDate(startIso)} – {shortDate(endIso)}
                    </Text>
                  </View>
                </>
              )}

              <FormInput
                label={mode === 'absent' ? 'Reason (optional)' : 'Reason (optional)'}
                placeholder={mode === 'absent' ? 'Fever, family function…' : 'Going home, wedding…'}
                value={reason}
                onChangeText={setReason}
                maxLength={160}
                style={styles.reason}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <PrimaryButton
                label={mode === 'absent' ? 'Save absence' : 'Save leave'}
                icon="checkmark"
                loading={saving}
                onPress={mode === 'absent' ? saveAbsent : saveLeave}
              />
              <Pressable onPress={close} hitSlop={8} style={styles.dismiss}>
                <Text style={styles.dismissText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bannerLeave: { backgroundColor: '#E8F0FF' },
  bannerAbsent: { backgroundColor: colors.redSoft },
  bannerTitle: { color: colors.ink, fontSize: 13.5, fontWeight: '800' },
  bannerBody: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  cancelLink: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  cancelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  cancelRowText: { color: colors.muted, fontSize: 12.5, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  notice: { color: colors.success, fontSize: 12.5, marginTop: spacing.sm, fontWeight: '600' },
  error: { color: colors.red, fontSize: 12.5, marginTop: spacing.sm },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  sheetTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  sheetSub: { color: colors.muted, fontSize: 12.5, marginTop: 4, lineHeight: 17 },
  label: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: '800',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  rangePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  rangeText: { color: colors.primary, fontSize: 12.5, fontWeight: '800' },
  reason: { marginTop: spacing.lg },
  dismiss: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: 6 },
  dismissText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
