import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDailyTarget, completeTargetTask, type DailyTarget } from '../api/reformApi';
import { Card, PrimaryButton } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Reform policy item 4: "AI targets come on a daily basis… today's target
 * must be completed to get the next one — accountability."
 * Backend AI targets are used when available; otherwise a local 3-step
 * target runs with the same accountability rule.
 */
export const DailyTargetScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { student } = useAuth();
  const today = dateKey(new Date());
  const yesterday = dateKey(new Date(Date.now() - 86400000));

  const [tasks, setTasks] = useState<DailyTarget[]>([]);
  const [locked, setLocked] = useState(false);
  const [backendLive, setBackendLive] = useState(false);

  const readLocal = useCallback(async (key: string): Promise<Record<string, boolean>> => {
    try {
      const raw = await AsyncStorage.getItem(`ump_target_${key}`);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }, []);

  useEffect(() => {
    (async () => {
      if (student) {
        const remote = await fetchDailyTarget(student.studentId);
        if (remote) {
          setBackendLive(true);
          setTasks(remote.tasks);
          setLocked(remote.locked);
          return;
        }
      }
      const y = await readLocal(yesterday);
      const yDone = ['mcq', 'tracker', 'revise'].every((k) => y[k]);
      const t = await readLocal(today);
      setLocked(!yDone);
      setTasks([
        { id: 'mcq', label: 'Daily MCQ Challenge', detail: 'Complete the 10 daily questions', kind: 'mcq', done: Boolean(t.mcq) },
        { id: 'tracker', label: 'Tracker log', detail: 'Log your study hours and topic', kind: 'tracker', done: Boolean(t.tracker) },
        { id: 'revise', label: 'Revision round', detail: 'Revise the previous day chapter for 15 minutes', kind: 'revise', done: Boolean(t.revise) },
      ]);
    })();
  }, [readLocal, student, today, yesterday]);

  const toggleTask = async (task: DailyTarget) => {
    if (locked) return;
    const nextDone = !task.done;
    if (backendLive && student) {
      if (nextDone) await completeTargetTask(student.studentId, task.id);
    }
    const next = tasks.map((t) => (t.id === task.id ? { ...t, done: nextDone } : t));
    setTasks(next);
    const map = await readLocal(today);
    map[task.id] = nextDone;
    await AsyncStorage.setItem(`ump_target_${today}`, JSON.stringify(map)).catch(() => undefined);
  };

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.head}>
        <Text style={styles.headDate}>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
        <Text style={styles.headSub}>{backendLive ? 'AI built this target from your progress' : 'Finish all three today — tomorrow unlocks only then'}</Text>
        <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%` }]} /></View>
        <Text style={styles.progressLabel}>{doneCount}/{tasks.length} complete</Text>
      </Card>

      {locked ? (
        <Card style={styles.lockCard}>
          <Ionicons name="lock-closed" size={22} color={colors.red} />
          <Text style={styles.lockTitle}>Today's target is locked</Text>
          <Text style={styles.lockText}>Yesterday's target was not completed. Accountability rule: finish yesterday first — talk to your mentor if there was an issue.</Text>
        </Card>
      ) : null}

      {tasks.map((task) => (
        <Pressable key={task.id} onPress={() => toggleTask(task)} disabled={locked}>
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
  lockCard: { backgroundColor: colors.redSoft, borderColor: colors.red, alignItems: 'center', gap: 6, padding: spacing.lg },
  lockTitle: { fontSize: 14, fontWeight: '900', color: colors.red },
  lockText: { fontSize: 12.5, color: colors.inkSoft, textAlign: 'center', lineHeight: 18 },
  taskCard: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: spacing.md },
  check: { width: 26, height: 26, borderRadius: 9, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: colors.success, borderColor: colors.success },
  taskCopy: { flex: 1 },
  taskLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },
  taskLabelDone: { textDecorationLine: 'line-through', color: colors.muted },
  taskDetail: { fontSize: 12, color: colors.muted, marginTop: 2 },
  mini: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.sm },
});
