import { SmartTargetsPanel } from '../components/SmartTargetsPanel';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
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
  // Day the student is currently allowed to work on (1-based, within planDays).
  // Persisted locally so a restart does not re-lock days that were already earned.
  const [unlockedUpTo, setUnlockedUpTo] = useState<number>(0);
  const [gateDay, setGateDay] = useState<number | null>(null);
  // True until the first plan read settles. Without it the screen painted the
  // fallback (CalendarPlanCard + the local 3-step list) for a moment and then
  // swapped to the real plan card - the student saw two different screens on
  // every open and it looked like the app was showing the wrong day
  // (22-Nov-2026).
  const [planLoading, setPlanLoading] = useState<boolean>(true);

  const readLocal = useCallback(async (key: string): Promise<LocalTargetMap> => {
    try {
      const raw = await AsyncStorage.getItem(`ump_target_${key}`);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }, []);

  // Re-pull the mentor target every time the screen is focused (not just on
  // mount) so a target published or edited mid-day shows up immediately.
  useFocusEffect(useCallback(() => {
    setPlanLoading(true);
    (async () => {
      if (student) {
        const remote = await fetchDailyTarget(student.studentId);
        if (remote) {
          void fetchTargetPlanDays(student.studentId).then(async (plan) => {
            setPlanLoading(false);
            if (plan) {
              // Fold in this device's ticks before the first paint, so a tick made
              // before the backend learned about plan dates is not lost on open.
              const merged = await Promise.all(
                plan.days.map(async (d) => {
                  const local = await readLocal(d.date);
                  return { ...d, tasks: d.tasks.map((t) => (t.done ? t : { ...t, done: local[t.id] === true })) };
                }),
              );
              setPlanDays(merged);
              // Pick the opening day from the PLAN's own days. The old code fell
              // back to plan.today, which is the calendar date - so once the plan
              // ended (or had not started) selectedDay pointed at a date no plan
              // day owns, selectedIndex became -1 and the screen sat on an empty
              // selection with a permanently disabled unlock button (22-Nov-2026).
              setSelectedDay((prev) => {
                if (prev && plan.days.some((d) => d.date === prev)) return prev;
                const today = plan.days.find((d) => d.isToday);
                if (today) return today.date;
                // The plan is over (or has not started): open the FIRST day that
                // was never finished, so a student catching up starts where the
                // work actually stopped instead of on the last calendar day.
                const unfinished = plan.days.find((d) => !(d.tasks.length > 0 && d.tasks.every((t) => t.done)));
                return (unfinished ?? [...plan.days].reverse().find((d) => d.date <= plan.today) ?? plan.days[0])?.date ?? '';
              });
            }
          });
          setBackendLive(true);
          setTasks(remote.tasks);
          return;
        }
        setPlanDays([]);
        setPlanLoading(false);
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

  /**
   * Re-read the plan and fold in the ticks this device has made.
   *
   * The server is the source of truth for `done`, but it only knows about ticks
   * once the tick endpoint understands plan dates. Until that deploy lands, a
   * plain reload snapped every tick back to unticked because the server row was
   * written under today's date instead of the plan day (found 22-Nov-2026). The
   * merge means the screen is correct either way: server wins when it does have
   * the tick, the local mirror keeps it visible when it does not.
   */
  const reloadPlan = useCallback(async () => {
    if (!student) return;
    const plan = await fetchTargetPlanDays(student.studentId).catch(() => null);
    if (!plan?.days?.length) return;
    const merged = await Promise.all(
      plan.days.map(async (d) => {
        const local = await readLocal(d.date);
        const ticks = d.tasks.map((t) => (t.done ? t : { ...t, done: local[t.id] === true }));
        return { ...d, tasks: ticks };
      }),
    );
    setPlanDays(merged);
  }, [student, readLocal]);

  /** Persisted unlock pointer, keyed by the plan so a new plan starts fresh. */
  const unlockKey = planDays.length ? `ump_unlock_${planDays[0].planId}` : '';
  const persistUnlock = useCallback(async (upTo: number) => {
    setUnlockedUpTo(upTo);
    if (!unlockKey) return;
    await AsyncStorage.setItem(unlockKey, String(upTo)).catch(() => undefined);
  }, [unlockKey]);

  // Restore the unlocked pointer whenever the plan changes. A fresh plan opens on
  // the day the backend marks as today, otherwise on the last day that has passed.
  useEffect(() => {
    if (!unlockKey) { setUnlockedUpTo(0); return; }
    let live = true;
    (async () => {
      const raw = await AsyncStorage.getItem(unlockKey).catch(() => null);
      const saved = Number(raw ?? 0);
      if (!live) return;
      if (Number.isFinite(saved) && saved >= 1) { setUnlockedUpTo(saved); return; }
      // Same rule as the opening day: the first day that is not finished. Falling
      // back to the calendar (today / last past day) opened the plan on Day 20 for
      // a student who never started Day 1 (found 22-Nov-2026).
      const isDone = (d: PlanDay) => d.tasks.length > 0 && d.tasks.every((t) => t.done);
      const todayIdx = planDays.findIndex((d) => d.isToday);
      const firstOpenIdx = planDays.findIndex((d) => !isDone(d));
      const lastPastIdx = planDays.reduce((acc, d, i) => (d.date <= today ? i : acc), -1);
      const pickIdx = todayIdx >= 0 ? todayIdx : firstOpenIdx >= 0 ? firstOpenIdx : lastPastIdx;
      setUnlockedUpTo(Math.max(1, pickIdx + 1));
    })();
    return () => { live = false; };
  }, [unlockKey, planDays, today]);

  /**
   * Tick one task.
   *
   * `planDate` is the date of the plan day the task belongs to. The offline
   * fallback (no published plan) leaves it out and keeps the old behaviour of
   * writing under today's key. When a plan IS active the tick must be stored
   * against the day the student has open - storing it under today was why the
   * selected day never filled up (found 22-Nov-2026).
   */
  const togglePlanTask = async (planDate: string, task: { id: string; done: boolean }) => {
    const nextDone = !task.done;
    if (backendLive && student) {
      await completeTargetTask(student.studentId, task.id, planDate, nextDone);
    }
    setPlanDays((prev) =>
      prev.map((d) =>
        d.date === planDate
          ? { ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, done: nextDone } : t)) }
          : d,
      ),
    );
    // Mirror the tick locally so it survives a reload while the network settles.
    const map = await readLocal(planDate);

    map[task.id] = nextDone;
    const localDay = planDays.find((d) => d.date === planDate);
    const allDone = Boolean(localDay?.tasks.every((t) => (t.id === task.id ? nextDone : t.done)));
    if (allDone) map.__completedAt = map.__completedAt || Date.now();
    else if (map.__completedAt) delete map.__completedAt;
    await AsyncStorage.setItem(`ump_target_${planDate}`, JSON.stringify(map)).catch(() => undefined);
    void reloadPlan();
  };

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
  // While the first read is in flight show nothing rather than the fallback, so
  // the screen never flashes a different (wrong-looking) layout before the plan.
  const showFallback = !planLoading && !hasPlan;
  // A published plan only owns ticking while it actually covers today. Once the
  // plan has ended (or has not started) there is no plan day marked isToday, so
  // the plan card falls back to a read-only past day and the local checklist is
  // hidden - leaving the student with no way to tick anything at all.
  const isPlanDayDone = (d: PlanDay) =>
    d.tasks.length > 0 && d.tasks.every((t) => t.done);
  // Exactly ONE day is open at a time: the one the student has earned. Finished
  // days to its left stay readable, everything to its right is locked. The old
  // rule (`index + 1 > unlockedUpTo`) left every earlier day open as well, so
  // selecting Day 3 while Day 2 was still unfinished offered to unlock Day 4 and
  // silently skipped a day (found 22-Nov-2026).
  const isDayLocked = (index: number) => index + 1 > unlockedUpTo;
  const isDayReadOnly = (index: number) => index + 1 < unlockedUpTo;

  const selectedIndex = planDays.findIndex((d) => d.date === selectedDay);
  const selectedPlanDay = selectedIndex >= 0 ? planDays[selectedIndex] : null;

  // The day the student is actually working on - the pointer, resolved to a real
  // plan day. Everything the unpicked-day UI promises is measured against this,
  // never against whatever chip happens to be highlighted.
  const currentIndex = Math.min(Math.max(unlockedUpTo, 1), Math.max(planDays.length, 1)) - 1;
  const currentPlanDay = planDays[currentIndex] ?? null;

  /** True when the selected plan day has every task done. */
  const selectedDayComplete = Boolean(
    selectedPlanDay && selectedPlanDay.tasks.length > 0 && selectedPlanDay.tasks.every((t) => t.done),
  );
  /** The one day that accepts ticks: the earned pointer, and only while it is viewed. */
  const isSelectedCurrent = selectedIndex >= 0 && selectedIndex === currentIndex;
  const isDayOpen = Boolean(isSelectedCurrent && !isDayLocked(selectedIndex));
  const readOnly = !isDayOpen;
  const currentDayComplete = Boolean(
    currentPlanDay && currentPlanDay.tasks.length > 0 && currentPlanDay.tasks.every((t) => t.done),
  );

  /** Open a day from the strip. Locked days explain themselves instead of jumping. */
  const openPlanDay = (index: number) => {
    const d = planDays[index];
    if (!d) return;
    if (isDayLocked(index)) { setGateDay(index); return; }
    setGateDay(null);
    setSelectedDay(d.date);
  };

  /**
   * Earn the next day.
   *
   * Deliberately driven by the CURRENT day, not by the selected chip: the button
   * only ever advances one step. Ticking everything on the current day is the
   * only way forward, so a finished earlier day can never skip an unfinished one.
   */
  const unlockNextDay = async () => {
    if (!currentPlanDay || !currentDayComplete) return;
    const next = currentIndex + 2; // 1-based position of the following day
    if (next > planDays.length) return;
    setGateDay(null);
    await persistUnlock(next);
    setSelectedDay(planDays[next - 1].date);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* Hide the secondary calendar card while the real plan is loading OR live,
          so the student only ever sees one plan card - the day-wise one. */}
      <SmartTargetsPanel hideCalendarPlan={planLoading || hasPlan} />
      {planLoading ? (
        <Card style={styles.planCard}>
          <View style={styles.skeletonTitle} />
          <View style={styles.skeletonRow} />
          <View style={styles.skeletonRow} />
          <View style={[styles.skeletonRow, { width: '62%' }]} />
        </Card>
      ) : null}
      {showFallback ? (
        <Text style={{ fontWeight: "700", marginTop: 16 }}>Calendar targets & daily checklist</Text>
      ) : null}
      {/* When a published plan is active, the plan card below already shows the
          real date, day and checklist. This local-tasks summary would show a
          second, different count (local 0/4 next to the plan's 0/3), so it is
          hidden for plan users and kept for the offline fallback. */}
      {showFallback ? (
        <Card style={styles.head}>
          <Text style={styles.headDate}>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
          <Text style={styles.headSub}>{backendLive ? 'Set by your mentor. The revision line is only a reminder.' : 'Opens at 12:00 AM daily — finish it whenever you sit down'}</Text>
          <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%` }]} /></View>
          <Text style={styles.progressLabel}>{doneCount}/{tasks.length} complete</Text>
        </Card>
      ) : null}

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
      {/* The local 3-step list belongs to the NO-PLAN fallback only. It used to be
          gated on `!planCoversToday`, which meant a published plan that had ended
          (or not started) showed BOTH this list and the plan card - two different
          checklists on one screen, which is what made "the selected day" look
          wrong (found 22-Nov-2026). */}
      {showFallback ? tasks.map((task) => (
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
              const finished = isDayReadOnly(i);
              return (
                <Pressable key={`${d.planId}|${d.day}|${d.date}`} onPress={() => openPlanDay(i)}>
                  <View style={[styles.planDayChip, active && styles.planDayChipOn, (d.isToday && !active) && styles.planDayChipToday, locked && styles.planDayChipLocked, !locked && isPlanDayDone(d) && !active && styles.planDayChipDone]}>
                    <Text style={[styles.planDayNum, active && styles.planDayNumOn]}>
                      {locked ? '🔒 ' : finished || isPlanDayDone(d) ? '✓ ' : '● '}{d.day != null ? `Day ${d.day}` : '—'}
                    </Text>
                    <Text style={[styles.planDayDate, active && styles.planDayDateOn]}>
                      {new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          {gateDay != null && (
            <Card style={[styles.planCard, styles.gateCard]}>
              <Text style={styles.gateTitle}>
                Day {planDays[gateDay]?.day ?? gateDay + 1} is locked
              </Text>
              <Text style={styles.gateText}>
                {currentPlanDay
                  ? `Finish Day ${currentPlanDay.day ?? currentIndex + 1} first — this day unlocks only after every task on it is complete.`
                  : 'This day unlocks once the earlier days are complete.'}
              </Text>
            </Card>
          )}
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
            return (
              <Card style={styles.planCard}>
                <Text style={styles.planCardTitle}>
                  {label} · {new Date(day.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {day.isToday ? ' · today' : day.date > today ? ' · unlocked · upcoming' : ''}
                </Text>
                {/* The checklist is always the SELECTED day's own tasks.
                    It used to be `day.isToday ? tasks : day.tasks`, so every
                    unlocked day rendered today's checklist under another day's
                    date - the heading said "Day 5" and the rows were today's
                    (found 22-Nov-2026). Ticking is allowed only on the one open
                    day; finished days stay visible but read-only. */}
                {day.tasks.map((t) => {
                  const tappable = isDayOpen && !readOnly;
                  const row = (
                    <View style={styles.planTaskRow}>
                      <View style={[styles.check, t.done && styles.checkDone]}>
                        {t.done ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.planTaskLabel, t.done && styles.taskLabelDone]}>{t.label}</Text>
                        {t.detail ? <Text style={styles.taskDetail}>{t.detail}</Text> : null}
                      </View>
                      {tappable && t.kind === 'mcq' ? <PrimaryButton label="Open" variant="secondary" onPress={() => navigation.navigate('DailyMcq')} style={styles.mini} /> : null}
                      {tappable && t.kind === 'tracker' ? <PrimaryButton label="Log" variant="secondary" onPress={() => navigation.navigate('AddStudyLog')} style={styles.mini} /> : null}
                    </View>
                  );
                  return tappable
                    ? <Pressable key={t.id} onPress={() => void togglePlanTask(day.date, t)}>{row}</Pressable>
                    : <View key={t.id}>{row}</View>;
                })}
              </Card>
            );
          })()}
          <Text style={styles.planHint}>
            {!selectedPlanDay
              ? ''
              : isDayLocked(selectedIndex)
                ? 'This day is locked — finish the day you are on first.'
                : readOnly
                  ? 'This day is done — view only. Ticking happens on the day you have open.'
                  : selectedDayComplete
                    ? 'Every task on this day is complete.'
                    : `${selectedPlanDay.tasks.filter((t) => t.done).length}/${selectedPlanDay.tasks.length} tasks done — finish them all to earn the next day.`}
          </Text>

          {/* One day at a time. The button is driven by the open day, never by
              whichever chip is highlighted, and it stays visible-but-disabled
              until that checklist is clear. */}
          {currentPlanDay && currentIndex + 1 < planDays.length ? (
            <PrimaryButton
              label={
                currentDayComplete
                  ? `Unlock Day ${planDays[currentIndex + 1].day ?? currentIndex + 2}`
                  : `Unlock Day ${planDays[currentIndex + 1].day ?? currentIndex + 2} — finish ${currentPlanDay.tasks.filter((t) => !t.done).length} task(s) first`
              }
              disabled={!currentDayComplete}
              onPress={() => void unlockNextDay()}
              style={styles.unlockBtn}
            />
          ) : null}
          {currentPlanDay && currentIndex + 1 >= planDays.length ? (
            <Text style={styles.planHint}>That was the last day of the plan.</Text>
          ) : null}
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
  planDayChipDone: { backgroundColor: colors.tealSoft, borderColor: colors.success },
  gateCard: { backgroundColor: colors.amberSoft, borderColor: colors.amber },
  gateTitle: { fontSize: 13.5, fontWeight: '900', color: colors.ink },
  gateText: { fontSize: 12, color: colors.inkSoft, marginTop: 3, lineHeight: 17 },
  unlockBtn: { marginTop: 6 },
  skeletonTitle: { height: 14, width: '58%', borderRadius: 6, backgroundColor: colors.canvas, marginBottom: 12 },
  skeletonRow: { height: 12, width: '86%', borderRadius: 6, backgroundColor: colors.canvas, marginBottom: 10 },
});
