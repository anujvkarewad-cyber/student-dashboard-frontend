import { SmartTargetsPanel } from '../components/SmartTargetsPanel';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDailyTarget, completeTargetTask, fetchTargetPlanDays, type DailyTarget, type PlanDay } from '../api/reformApi';
import { Card, PrimaryButton } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

/**
 * Calendar day in IST, never UTC.
 *
 * The backend resolves "today" with Asia/Kolkata, but `toISOString()` renders a
 * UTC day. Between 00:00 and 05:30 IST the two disagree by one date, so the app
 * marked today's published day as `isToday === false` and showed "This day has
 * passed — view only" instead of the checklist (found 09-Nov-2026).
 */
const IST_OFFSET_MS = 19800000; // +05:30
const dateKey = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Task ticks are booleans; `__completedAt` stores the finishing timestamp. */
type LocalTargetMap = Record<string, boolean | number | undefined>;

/**
 * Daily target.
 *
 * The earlier rule locked the whole day when yesterday was incomplete, which
 * punished a student twice: once for missing a day, and again by taking away the
 * only screen that could get them back on track.
 *
 * The target now opens at 00:00 every night, on its own. A student who is still
 * working after midnight - which for CA students preparing alongside college is
 * the normal case, not the exception - finds the fresh target already open the
 * moment they finish, instead of being told to come back later. Missing a day is
 * shown as a nudge, never as a wall.
 *
 * A mentor-uploaded target is used when one is published. Groq only writes the revision reminder. Otherwise a local 3-step target runs.
 */
export const DailyTargetScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { student } = useAuth();
  const today = dateKey(new Date());
  const yesterday = dateKey(new Date(Date.now() - 86400000));

  const [tasks, setTasks] = useState<DailyTarget[]>([]);
  // Kept only to show an honest nudge - it no longer blocks anything.
  const [behind, setBehind] = useState(false);
  const [backendLive, setBackendLive] = useState(false);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  // Every published plan day, so the whole mentor plan is visible at a glance.
  const [planDays, setPlanDays] = useState<PlanDay[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>('');

  const readLocal = useCallback(async (key: string): Promise<LocalTargetMap> => {
    try {
      const raw = await AsyncStorage.getItem(`ump_target_${key}`);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }, []);

  // Re-pull the mentor target every time the screen is focused (not just on
  // mount) so a target published or edited mid-day shows up immediately.
  useFocusEffect(useCallback(() => {
    (async () => {
      if (student) {
        const remote = await fetchDailyTarget(student.studentId);
        if (remote) {
          void fetchTargetPlanDays(student.studentId).then((plan) => {
            if (plan) {
              setPlanDays(plan.days);
              setSelectedDay((prev) => prev || (plan.days.find((d) => d.isToday)?.date ?? plan.today));
            }
          });
          setBackendLive(true);
          setTasks(remote.tasks);
          return;
        }
        setPlanDays([]);
      }
      const y = await readLocal(yesterday);
      setBehind(!['mcq', 'tracker', 'revise'].every((k) => y[k]));
      const t = await readLocal(today);
      setCompletedAt(typeof t.__completedAt === 'number' ? t.__completedAt : null);
      setTasks([
        { id: 'mcq', label: 'Daily MCQ Challenge', detail: 'Complete the 10 daily questions', kind: 'mcq', done: Boolean(t.mcq) },
        { id: 'tracker', label: 'Tracker log', detail: 'Log your study hours and topic', kind: 'tracker', done: Boolean(t.tracker) },
        { id: 'revise', label: 'Revision round', detail: 'Revise the previous day chapter for 15 minutes', kind: 'revise', done: Boolean(t.revise) },
      ]);
    })();
  }, [readLocal, student, today, yesterday]));

  const toggleTask = async (task: DailyTarget) => {
    const nextDone = !task.done;
    if (backendLive && student) {
      if (nextDone) await completeTargetTask(student.studentId, task.id);
    }
    const next = tasks.map((t) => (t.id === task.id ? { ...t, done: nextDone } : t));
    setTasks(next);
    const map = await readLocal(today);
    map[task.id] = nextDone;

    // Stamp the moment the day's target is finished. A student who finishes after
    // midnight is told immediately that the next day's target is already open,
    // rather than being left to wonder when it appears.
    const allDone = next.every((t) => t.done);
    const stamp = allDone ? Date.now() : null;
    if (stamp) map.__completedAt = stamp;
    else delete map.__completedAt;
    setCompletedAt(stamp);
    await AsyncStorage.setItem(`ump_target_${today}`, JSON.stringify(map)).catch(() => undefined);
  };

  const doneCount = tasks.filter((t) => t.done).length;

  // Lock rule (owner-approved design): the day-strip opens with TODAY selected and
  // highlighted; a future day stays locked until the day before it is complete.
  // Today and past days always stay open — today is the only place ticks happen.
  const hasPlan = backendLive && planDays.length > 0;
  const isPlanDayDone = (d: PlanDay) =>
    d.tasks.length > 0 && d.tasks.every((t) => t.done);
  const isDayLocked = (index: number) => {
    const d = planDays[index];
    if (!d) return true;
    if (d.isToday || d.date <= today) return false;
    const prev = planDays[index - 1];
    if (!prev) return false;
    return !(prev.isToday
      ? (tasks.length > 0 && doneCount === tasks.length)
      : isPlanDayDone(prev));
  };
  const selectedIndex = planDays.findIndex((d) => d.date === selectedDay);
  const selectedPlanDay = selectedIndex >= 0 ? planDays[selectedIndex] : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SmartTargetsPanel />
      {!hasPlan ? (
        <Text style={{ fontWeight: "700", marginTop: 16 }}>Calendar targets & daily checklist</Text>
      ) : null}
      <Card style={styles.head}>
        <Text style={styles.headDate}>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
        <Text style={styles.headSub}>{backendLive ? 'Set by your mentor. The revision line is only a reminder.' : 'Opens at 12:00 AM daily — finish it whenever you sit down'}</Text>
        <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%` }]} /></View>
        <Text style={styles.progressLabel}>{doneCount}/{tasks.length} complete</Text>
      </Card>

      {completedAt ? (
        <Card style={styles.openCard}>
          <Ionicons name="sunny" size={20} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.openTitle}>Target complete</Text>
            <Text style={styles.openText}>
              {new Date(completedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              {' · tomorrow\u2019s target is already open — it unlocked at 12:00 AM. Finish it whenever you sit down next.'}
            </Text>
          </View>
        </Card>
      ) : null}

      {behind && !completedAt ? (
        <Card style={styles.behindCard}>
          <Ionicons name="information-circle" size={20} color={colors.amber} />
          <View style={{ flex: 1 }}>
            <Text style={styles.behindTitle}>Yesterday was not finished</Text>
            <Text style={styles.behindText}>Today is open anyway — catch up if you can. Talk to your mentor if something came up.</Text>
          </View>
        </Card>
      ) : null}

      {/* When a plan is active, today's checklist renders below in the plan card —
          it is not repeated here (owner-approved: tasks appear in exactly one place). */}
      {!hasPlan ? tasks.map((task) => (
        <Pressable key={task.id} onPress={() => toggleTask(task)}>
          <Card style={styles.taskCard}>
            <View style={[styles.check, task.done && styles.checkDone]}>
              {task.done ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
            </View>
            <View style={styles.taskCopy}>
              <Text style={[styles.taskLabel, task.done && styles.taskLabelDone]}>{task.label}</Text>
              <Text style={styles.taskDetail}>{task.detail}</Text>
            </View>
            {task.kind === 'mcq' ? <PrimaryButton label="Open" variant="secondary" onPress={() => navigation.navigate('DailyMcq')} style={styles.mini} /> : null}
            {task.kind === 'tracker' ? <PrimaryButton label="Log" variant="secondary" onPress={() => navigation.navigate('AddStudyLog')} style={styles.mini} /> : null}
          </Card>
        </Pressable>
      )) : null}

      {hasPlan ? (
        <View style={styles.planWrap}>
          <Text style={styles.planTitle}>Full plan — day wise</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.planStrip}>
            {planDays.map((d, i) => {
              const active = d.date === selectedDay;
              const locked = isDayLocked(i);
              return (
                <Pressable key={`${d.planId}|${d.day}|${d.date}`} onPress={() => { if (!locked) setSelectedDay(d.date); }}>
                  <View style={[styles.planDayChip, active && styles.planDayChipOn, (d.isToday && !active) && styles.planDayChipToday, locked && styles.planDayChipLocked]}>
                    <Text style={[styles.planDayNum, active && styles.planDayNumOn]}>
                      {locked ? '🔒 ' : ''}{d.day != null ? `Day ${d.day}` : '—'}
                    </Text>
                    <Text style={[styles.planDayDate, active && styles.planDayDateOn]}>
                      {new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          {(() => {
            if (selectedIndex >= 0 && isDayLocked(selectedIndex)) {
              const prev = planDays[selectedIndex - 1];
              return (
                <Card style={styles.planCard}>
                  <Text style={styles.planLockIcon}>🔒</Text>
                  <Text style={styles.planLockTitle}>
                    {(selectedPlanDay && selectedPlanDay.day != null ? `Day ${selectedPlanDay.day}` : 'This day')} — locked
                  </Text>
                  <Text style={styles.planLockText}>
                    {prev
                      ? `This day opens only after ${prev.day != null ? `Day ${prev.day}` : 'the previous day'} is fully complete. Finish today's target first — the plan moves forward one day at a time.`
                      : 'This day is locked for now.'}
                  </Text>
                </Card>
              );
            }
            const day = selectedPlanDay || planDays.find((d) => d.isToday) || planDays[0];
            if (!day) return null;
            const label = day.day != null ? `Day ${day.day}` : 'This day';
            const isPast = day.date < today;
            return (
              <Card style={styles.planCard}>
                <Text style={styles.planCardTitle}>
                  {label} · {new Date(day.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {day.isToday ? ' · today' : day.date > today ? ' · unlocked · upcoming' : ''}
                </Text>
                {/* Today card = the real checklist (ticking happens here). Other days are read-only. */}
                {day.isToday
                  ? tasks.map((task) => (
                      <Pressable key={task.id} onPress={() => toggleTask(task)}>
                        <View style={styles.planTaskRow}>
                          <View style={[styles.check, task.done && styles.checkDone]}>
                            {task.done ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.planTaskLabel, task.done && styles.taskLabelDone]}>{task.label}</Text>
                            {task.detail ? <Text style={styles.taskDetail}>{task.detail}</Text> : null}
                          </View>
                          {task.kind === 'mcq' ? <PrimaryButton label="Open" variant="secondary" onPress={() => navigation.navigate('DailyMcq')} style={styles.mini} /> : null}
                          {task.kind === 'tracker' ? <PrimaryButton label="Log" variant="secondary" onPress={() => navigation.navigate('AddStudyLog')} style={styles.mini} /> : null}
                        </View>
                      </Pressable>
                    ))
                  : day.tasks.map((t) => (
                      <View key={t.id} style={styles.planTaskRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.planTaskLabel, isPast && t.done && styles.taskLabelDone]}>{t.label}</Text>
                          {t.detail ? <Text style={styles.taskDetail}>{t.detail}</Text> : null}
                        </View>
                      </View>
                    ))}
              </Card>
            );
          })()}
          <Text style={styles.planHint}>
            {selectedPlanDay && isDayLocked(selectedIndex)
              ? 'Locked days open once the previous day is complete.'
              : selectedPlanDay?.isToday
                ? "Tick today's tasks here — the next day unlocks as soon as all are complete."
                : selectedPlanDay && selectedPlanDay.date > today
                  ? "This day is unlocked (its previous day is complete) — ticking always happens on today's card."
                  : 'This day has passed — view only.'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: 60, gap: spacing.md },
  head: { padding: spacing.lg, gap: 6 },
  headDate: { fontSize: 16, fontWeight: '900', color: colors.ink },
  headSub: { fontSize: 12.5, color: colors.muted },
  progressBar: { height: 8, borderRadius: 999, backgroundColor: colors.canvas, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: colors.success },
  progressLabel: { fontSize: 11.5, fontWeight: '800', color: colors.success },
  openCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.tealSoft, borderColor: colors.success, padding: spacing.md },
  openTitle: { fontSize: 13.5, fontWeight: '900', color: colors.ink },
  openText: { fontSize: 12, color: colors.inkSoft, marginTop: 2, lineHeight: 17 },
  behindCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.amberSoft, borderColor: colors.amber, padding: spacing.md },
  behindTitle: { fontSize: 13.5, fontWeight: '900', color: colors.ink },
  behindText: { fontSize: 12, color: colors.inkSoft, marginTop: 2, lineHeight: 17 },
  taskCard: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: spacing.md },
  check: { width: 26, height: 26, borderRadius: 9, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: colors.success, borderColor: colors.success },
  taskCopy: { flex: 1 },
  taskLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },
  taskLabelDone: { textDecorationLine: 'line-through', color: colors.muted },
  taskDetail: { fontSize: 12, color: colors.muted, marginTop: 2 },
  mini: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.sm },
  planWrap: { marginTop: 4, gap: 10 },
  planTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  planStrip: { gap: 8, paddingRight: 8 },
  planDayChip: { width: 64, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 2 },
  planDayChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  planDayChipToday: { borderColor: colors.success, borderWidth: 1.5 },
  planDayChipLocked: { opacity: 0.45 },
  planDayNum: { fontSize: 11.5, fontWeight: '800', color: colors.ink },
  planDayNumOn: { color: '#fff' },
  planDayDate: { fontSize: 10.5, color: colors.muted },
  planDayDateOn: { color: '#fff' },
  planCard: { padding: spacing.md, gap: 8 },
  planCardTitle: { fontSize: 13, fontWeight: '900', color: colors.ink, marginBottom: 2 },
  planTaskRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  planTaskLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  planLockIcon: { fontSize: 28, textAlign: 'center' },
  planLockTitle: { fontSize: 13.5, fontWeight: '900', color: colors.ink, textAlign: 'center', marginTop: 6 },
  planLockText: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4, lineHeight: 18 },
  planHint: { fontSize: 11, color: colors.muted },
});
