import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, PrimaryButton } from '../components/ui';
import { colors, radius, spacing } from '../theme';

type ReminderPref = { id: string; label: string; sub: string; time: string; on: boolean; custom?: boolean };

const DEFAULTS: ReminderPref[] = [
  { id: 'target', label: 'Morning target', sub: 'Morning reminder for the daily target', time: '07:30', on: true },
  { id: 'mcq', label: 'Daily MCQ', sub: 'Evening Daily MCQ reminder', time: '18:00', on: true },
  { id: 'revise', label: 'Revision round', sub: 'Night-time revision reminder', time: '21:30', on: false },
];

const KEY = 'ump_reminders_v1';
const CUSTOM_KEY = 'ump_reminders_custom_v1';

const timeOk = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

async function scheduleAll(prefs: ReminderPref[]) {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (!settings.granted) await Notifications.requestPermissionsAsync();
    await Notifications.cancelAllScheduledNotificationsAsync();
    for (const p of prefs.filter((x) => x.on && timeOk(x.time))) {
      const [hour, minute] = p.time.split(':').map(Number);
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Ujjwal Pathak Mentorship', body: p.sub || p.label },
        trigger: { hour, minute, repeats: true } as never,
      });
    }
  } catch { /* best effort */ }
}

/**
 * Reform policy item 5: reminders on the app (free). Students can also add
 * their own custom reminders ("Add reminder" button).
 */
export const RemindersScreen = () => {
  const [prefs, setPrefs] = useState<ReminderPref[]>(DEFAULTS);
  const [custom, setCustom] = useState<ReminderPref[]>([]);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newTime, setNewTime] = useState('19:00');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) setPrefs(JSON.parse(raw));
        const rawC = await AsyncStorage.getItem(CUSTOM_KEY);
        if (rawC) setCustom(JSON.parse(rawC));
      } catch { /* defaults */ }
    })();
  }, []);

  const persistAndSchedule = async (nextPrefs: ReminderPref[], nextCustom: ReminderPref[]) => {
    setPrefs(nextPrefs);
    setCustom(nextCustom);
    await AsyncStorage.setItem(KEY, JSON.stringify(nextPrefs)).catch(() => undefined);
    await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(nextCustom)).catch(() => undefined);
    await scheduleAll([...nextPrefs, ...nextCustom]);
  };

  const toggle = (id: string) => {
    const inDefaults = prefs.some((p) => p.id === id);
    const nextPrefs = inDefaults ? prefs.map((p) => (p.id === id ? { ...p, on: !p.on } : p)) : prefs;
    const nextCustom = !inDefaults ? custom.map((p) => (p.id === id ? { ...p, on: !p.on } : p)) : custom;
    persistAndSchedule(nextPrefs, nextCustom);
  };

  const remove = (id: string) => persistAndSchedule(prefs, custom.filter((p) => p.id !== id));

  const add = () => {
    const label = newLabel.trim();
    if (!label) { setErr('Write what the reminder is for.'); return; }
    if (!timeOk(newTime)) { setErr('Time must be HH:MM (24-hour), e.g. 19:30.'); return; }
    setErr('');
    const item: ReminderPref = { id: `custom-${Date.now()}`, label, sub: label, time: newTime, on: true, custom: true };
    setAdding(false);
    setNewLabel('');
    persistAndSchedule(prefs, [...custom, item]);
  };

  const Row = ({ p }: { p: ReminderPref }) => (
    <Card style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.label}>{p.label} · {p.time}</Text>
        <Text style={styles.sub}>{p.sub}</Text>
      </View>
      {p.custom ? (
        <Pressable onPress={() => remove(p.id)} style={styles.trash} accessibilityLabel="Delete reminder">
          <Ionicons name="trash-outline" size={17} color={colors.red} />
        </Pressable>
      ) : null}
      <Pressable onPress={() => toggle(p.id)} style={[styles.switch, p.on && styles.switchOn]} accessibilityRole="switch">
        <View style={[styles.knob, p.on && styles.knobOn]} />
      </Pressable>
    </Card>
  );

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.head}>
        <Ionicons name="notifications" size={20} color={colors.primary} />
        <Text style={styles.headText}>In-app reminders are completely free — no WhatsApp needed. Add your own with the button below.</Text>
      </Card>

      {prefs.map((p) => <Row key={p.id} p={p} />)}

      <Text style={styles.sectionTitle}>My reminders</Text>
      {custom.length ? custom.map((p) => <Row key={p.id} p={p} />) : (
        <Text style={styles.noneText}>No custom reminders yet.</Text>
      )}

      {adding ? (
        <Card style={styles.formCard}>
          <Text style={styles.formLabel}>Reminder text</Text>
          <TextInput value={newLabel} onChangeText={setNewLabel} placeholder="e.g. Revise Audit chapter 4" placeholderTextColor={colors.muted} style={styles.input} />
          <Text style={styles.formLabel}>Time (24-hour)</Text>
          <TextInput value={newTime} onChangeText={setNewTime} placeholder="19:00" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, { width: 110 }]} />
          {err ? <Text style={styles.errText}>{err}</Text> : null}
          <View style={styles.formRow}>
            <PrimaryButton label="Save reminder" icon="checkmark" onPress={add} style={{ flex: 1 }} />
            <PrimaryButton label="Cancel" variant="secondary" onPress={() => setAdding(false)} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : (
        <PrimaryButton label="+ Add reminder" icon="add-circle-outline" onPress={() => setAdding(true)} />
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: 60, gap: spacing.md },
  head: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: spacing.md },
  headText: { flex: 1, fontSize: 12.5, color: colors.inkSoft, lineHeight: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '900', color: colors.ink, marginTop: spacing.xs },
  noneText: { fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md },
  copy: { flex: 1 },
  label: { fontSize: 14, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  trash: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.redSoft, alignItems: 'center', justifyContent: 'center' },
  switch: { width: 48, height: 28, borderRadius: 999, backgroundColor: colors.border, justifyContent: 'center', paddingHorizontal: 3 },
  switchOn: { backgroundColor: colors.success },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  formCard: { padding: spacing.md, gap: 8 },
  formLabel: { fontSize: 11, fontWeight: '900', color: colors.inkSoft },
  input: { backgroundColor: colors.canvas, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: colors.ink },
  errText: { fontSize: 11.5, color: colors.red, fontWeight: '700' },
  formRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
