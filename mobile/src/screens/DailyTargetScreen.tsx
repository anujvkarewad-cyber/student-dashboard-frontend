import { SmartTargetsPanel } from '../components/SmartTargetsPanel';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDailyTarget, completeTargetTask, type DailyTarget } from '../api/reformApi';
import { Card, PrimaryButton } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

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
          setBackendLive(true);
          setTasks(remote.tasks);
          return;
        }
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

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SmartTargetsPanel />
      <Text style={{ fontWeight: "700", marginTop: 16 }}>Calendar targets & daily checklist</Text>
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

      {tasks.map((task) => (
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
      ))}
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
});
