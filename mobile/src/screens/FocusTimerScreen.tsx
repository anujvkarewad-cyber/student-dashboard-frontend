import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Card, Chip, EmptyState, SectionHeader } from '../components/ui';
import { useFocusTimer } from '../context/FocusTimerContext';
import { useStudyReceipts } from '../context/StudyReceiptContext';
import { colors, radius, spacing } from '../theme';

const subjects = ['Accounts', 'Law', 'Taxation', 'Costing', 'Audit', 'FM', 'SM', 'Revision', 'Mock Test'];
const DAILY_GOAL_SECONDS = 8 * 60 * 60;

const formatTimer = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
};

const formatCompact = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
};

const isToday = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
};

const TimerAction = ({ icon, label, onPress, tone = 'primary' }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; tone?: 'primary' | 'light' | 'danger' }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.timerAction, styles[`${tone}Action`], pressed && styles.pressed]}>
    <Ionicons name={icon} size={21} color={tone === 'light' ? colors.primary : '#FFFFFF'} />
    <Text style={[styles.timerActionText, tone === 'light' && styles.lightActionText]}>{label}</Text>
  </Pressable>
);

export const FocusTimerScreen = () => {
  const navigation = useNavigation<any>();
  const { hydrated, status, subject, target, elapsedSeconds, sessions, setSubject, setTarget, start, pause, resume, finish, discard, removeSession } = useFocusTimer();
  const { receiptForSession, dueReceipts } = useStudyReceipts();

  const todaySessions = useMemo(() => sessions.filter((session) => isToday(session.endedAt)), [sessions]);
  const completedToday = todaySessions.reduce((total, session) => total + session.durationSeconds, 0);
  const liveToday = status === 'idle' ? 0 : elapsedSeconds;
  const todayTotal = completedToday + liveToday;
  const longest = todaySessions.reduce((best, session) => Math.max(best, session.durationSeconds), 0);
  const goalProgress = Math.min(1, todayTotal / DAILY_GOAL_SECONDS);
  const hourProgress = (elapsedSeconds % 3600) / 3600;
  const circumference = 2 * Math.PI * 124;

  const tap = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium) => {
    Haptics.impactAsync(style).catch(() => undefined);
  };

  const startTimer = async () => {
    if (!target.trim()) {
      Alert.alert('Set a session target', 'Write exactly what you plan to understand or complete before starting the timer.');
      return;
    }
    tap();
    await start();
  };

  const pauseTimer = async () => {
    tap(Haptics.ImpactFeedbackStyle.Light);
    await pause();
  };

  const resumeTimer = async () => {
    tap();
    await resume();
  };

  const confirmFinish = () => Alert.alert(
    'Finish this focus session?',
    `${formatCompact(elapsedSeconds)} of ${subject} will be saved to your focus history.`,
    [
      { text: 'Keep studying', style: 'cancel' },
      {
        text: 'Finish & save',
        onPress: async () => {
          tap(Haptics.ImpactFeedbackStyle.Heavy);
          const session = await finish();
          if (session) navigation.navigate('StudyReceipt', { sessionId: session.id });
        },
      },
    ],
  );

  const confirmDiscard = () => Alert.alert(
    'Discard current timer?',
    'This unfinished focus time will not be added to your history.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => discard() },
    ],
  );

  if (!hydrated) {
    return <SafeAreaView style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>Restoring your focus timer…</Text></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View><Text style={styles.eyebrow}>DEEP WORK ZONE</Text><Text style={styles.title}>Focus room</Text><Text style={styles.subtitle}>Start the clock. Put the phone down. Do the work.</Text></View>
          <View style={[styles.statusPill, status === 'running' && styles.statusRunning]}><View style={[styles.statusDot, status === 'running' && styles.runningDot]} /><Text style={styles.statusText}>{status.toUpperCase()}</Text></View>
        </View>

        <LinearGradient colors={status === 'running' ? ['#101F49', '#304FC0', '#6558D7'] : ['#172B52', '#365584', '#526C91']} style={styles.timerCard}>
          <View style={styles.timerGlow} />
          <View style={styles.ringWrap}>
            <Svg width={280} height={280} style={styles.ring}>
              <Circle cx="140" cy="140" r="124" stroke="rgba(255,255,255,0.13)" strokeWidth="8" fill="none" />
              <Circle
                cx="140"
                cy="140"
                r="124"
                stroke={status === 'running' ? '#75E4C9' : '#C9D6FF'}
                strokeWidth="8"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={circumference * (1 - hourProgress)}
                transform="rotate(-90 140 140)"
              />
            </Svg>
            <View style={styles.timerCenter}>
              <View style={styles.subjectPill}><Ionicons name="book" size={13} color="#C9D6FF" /><Text style={styles.activeSubject}>{subject}</Text></View>
              {target ? <Text style={styles.activeTarget} numberOfLines={2}>{target}</Text> : null}
              <Text style={styles.timerText}>{formatTimer(elapsedSeconds)}</Text>
              <Text style={styles.timerHint}>{status === 'running' ? 'Stay focused — screen will remain awake' : status === 'paused' ? 'Session paused' : 'Ready when you are'}</Text>
            </View>
          </View>

          <BlurView intensity={50} tint="dark" style={styles.actionsGlass}>
            {status === 'idle' ? <TimerAction icon="play" label="Start focus" onPress={startTimer} /> : null}
            {status === 'running' ? (
              <><TimerAction icon="pause" label="Pause" tone="light" onPress={pauseTimer} /><TimerAction icon="stop" label="Finish" tone="danger" onPress={confirmFinish} /></>
            ) : null}
            {status === 'paused' ? (
              <><TimerAction icon="play" label="Resume" onPress={resumeTimer} /><TimerAction icon="checkmark" label="Finish" tone="light" onPress={confirmFinish} /></>
            ) : null}
          </BlurView>
          {status !== 'idle' ? <Pressable onPress={confirmDiscard} style={styles.discard}><Text style={styles.discardText}>Discard session</Text></Pressable> : null}
        </LinearGradient>

        <SectionHeader title="Choose subject" />
        <Card style={styles.subjectCard}>
          <View style={styles.chips}>{subjects.map((item) => <Chip key={item} label={item} selected={subject === item} onPress={() => setSubject(item)} />)}</View>
          <View style={styles.targetDivider} />
          <Text style={styles.targetLabel}>SESSION TARGET</Text>
          <TextInput
            value={target}
            onChangeText={setTarget}
            editable={status === 'idle'}
            placeholder="e.g. Understand AS 16 and solve 20 questions"
            placeholderTextColor={colors.muted}
            maxLength={140}
            style={[styles.targetInput, status !== 'idle' && styles.targetInputLocked]}
          />
          {status !== 'idle' ? <Text style={styles.lockedHint}><Ionicons name="lock-closed" size={11} /> Subject and target are locked while a session is active.</Text> : <Text style={styles.targetHelp}>Your target becomes the source prompt for the Study Receipt.</Text>}
        </Card>

        {dueReceipts.length ? (
          <Pressable onPress={() => navigation.navigate('StudyReceipt', { sessionId: dueReceipts[0].sessionId })} style={styles.memoryDue}>
            <View style={styles.memoryDueIcon}><Ionicons name="alarm" size={21} color={colors.purple} /></View>
            <View style={{ flex: 1 }}><Text style={styles.memoryDueTitle}>{dueReceipts.length} memory check{dueReceipts.length === 1 ? '' : 's'} due</Text><Text style={styles.memoryDueText}>Test what you still remember after 24 hours.</Text></View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </Pressable>
        ) : null}

        <SectionHeader title="Today's focus" />
        <Card style={styles.goalCard}>
          <View style={styles.goalTop}>
            <View><Text style={styles.goalValue}>{formatCompact(todayTotal)}</Text><Text style={styles.goalLabel}>of 8 hour daily goal</Text></View>
            <View style={styles.goalPercent}><Text style={styles.goalPercentText}>{Math.round(goalProgress * 100)}%</Text></View>
          </View>
          <View style={styles.goalTrack}><LinearGradient colors={[colors.teal, colors.primary]} style={[styles.goalFill, { width: `${goalProgress * 100}%` }]} /></View>
          <View style={styles.miniStats}>
            <View style={styles.miniStat}><Text style={styles.miniValue}>{todaySessions.length}</Text><Text style={styles.miniLabel}>SESSIONS</Text></View>
            <View style={styles.miniDivider} />
            <View style={styles.miniStat}><Text style={styles.miniValue}>{formatCompact(longest)}</Text><Text style={styles.miniLabel}>LONGEST</Text></View>
            <View style={styles.miniDivider} />
            <View style={styles.miniStat}><Text style={styles.miniValue}>{subject}</Text><Text style={styles.miniLabel}>CURRENT</Text></View>
          </View>
        </Card>

        <SectionHeader title="Recent focus sessions" />
        {sessions.length ? sessions.slice(0, 10).map((session) => {
          const receipt = receiptForSession(session.id);
          return (
            <Card key={session.id} style={styles.sessionCard}>
              <View style={styles.sessionIcon}><Ionicons name="checkmark-done" size={20} color={colors.success} /></View>
              <View style={styles.sessionBody}>
                <Text style={styles.sessionSubject}>{session.subject}</Text>
                {session.target ? <Text style={styles.sessionTarget} numberOfLines={1}>{session.target}</Text> : null}
                <Text style={styles.sessionDate}>{new Date(session.endedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · {new Date(session.startedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
              <View style={styles.sessionRight}>
                <Text style={styles.sessionDuration}>{formatCompact(session.durationSeconds)}</Text>
                <View style={styles.sessionActions}>
                  <Pressable onPress={() => navigation.navigate('StudyReceipt', { sessionId: session.id })} style={[styles.receiptButton, receipt && styles.receiptButtonDone]}>
                    <Ionicons name={receipt ? 'receipt' : 'receipt-outline'} size={16} color={receipt ? colors.success : colors.primary} />
                  </Pressable>
                  <Pressable hitSlop={10} onPress={() => Alert.alert('Remove session?', 'This only removes the local focus record.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => removeSession(session.id) }])}>
                    <Ionicons name="trash-outline" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              </View>
            </Card>
          );
        }) : <Card><EmptyState icon="timer-outline" title="No focus sessions yet" message="Choose a subject and start your first distraction-free session." /></Card>}

        <View style={styles.privacyNote}><Ionicons name="phone-portrait-outline" size={18} color={colors.primary} /><Text style={styles.privacyText}>Timer history stays on this device for now and does not write to the mentorship backend.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas, gap: spacing.md },
  loadingText: { color: colors.muted, fontSize: 12 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 110 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: spacing.lg, gap: spacing.md },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', letterSpacing: -0.7, marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, marginTop: 4 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 7, borderRadius: radius.pill },
  statusRunning: { backgroundColor: colors.tealSoft },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  runningDot: { backgroundColor: colors.teal },
  statusText: { color: colors.inkSoft, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  timerCard: { borderRadius: radius.xl, overflow: 'hidden', alignItems: 'center', padding: spacing.lg, marginBottom: spacing.xxl, shadowColor: '#17305B', shadowOffset: { width: 0, height: 13 }, shadowOpacity: 0.25, shadowRadius: 24, elevation: 8 },
  timerGlow: { position: 'absolute', width: 230, height: 230, borderRadius: 115, backgroundColor: 'rgba(120,228,204,0.09)', top: 20 },
  ringWrap: { width: 280, height: 280, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute' },
  timerCenter: { alignItems: 'center' },
  subjectPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(9,23,53,0.28)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  activeSubject: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  activeTarget: { color: 'rgba(255,255,255,0.68)', fontSize: 9, lineHeight: 13, textAlign: 'center', maxWidth: 185, marginTop: spacing.sm },
  timerText: { color: '#FFFFFF', fontSize: 40, fontWeight: '900', letterSpacing: 1.5, marginTop: spacing.md, fontVariant: ['tabular-nums'] },
  timerHint: { color: 'rgba(255,255,255,0.62)', fontSize: 9, marginTop: 6 },
  actionsGlass: { alignSelf: 'stretch', minHeight: 66, borderRadius: 20, overflow: 'hidden', backgroundColor: 'rgba(8,18,44,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', padding: spacing.sm, flexDirection: 'row', gap: spacing.sm },
  timerAction: { flex: 1, minHeight: 49, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm },
  primaryAction: { backgroundColor: colors.primary },
  lightAction: { backgroundColor: '#FFFFFF' },
  dangerAction: { backgroundColor: colors.red },
  timerActionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  lightActionText: { color: colors.primary },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  discard: { paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  discardText: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', textDecorationLine: 'underline' },
  subjectCard: { marginBottom: spacing.xxl, shadowOpacity: 0.04 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  targetDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  targetLabel: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  targetInput: { minHeight: 49, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF', color: colors.ink, fontSize: 12, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  targetInputLocked: { backgroundColor: colors.canvas, color: colors.muted },
  targetHelp: { color: colors.muted, fontSize: 8, marginTop: spacing.sm },
  lockedHint: { color: colors.muted, fontSize: 9, marginTop: spacing.md },
  memoryDue: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.purpleSoft, borderWidth: 1, borderColor: '#DED4FF', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.xxl },
  memoryDueIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  memoryDueTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  memoryDueText: { color: colors.muted, fontSize: 9, marginTop: 3 },
  goalCard: { marginBottom: spacing.xxl, shadowOpacity: 0.04 },
  goalTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalValue: { color: colors.ink, fontSize: 25, fontWeight: '900' },
  goalLabel: { color: colors.muted, fontSize: 10, marginTop: 3 },
  goalPercent: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tealSoft },
  goalPercentText: { color: colors.success, fontWeight: '900', fontSize: 13 },
  goalTrack: { height: 8, borderRadius: 4, backgroundColor: colors.primarySoft, overflow: 'hidden', marginTop: spacing.lg },
  goalFill: { height: 8, borderRadius: 4 },
  miniStats: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl },
  miniStat: { flex: 1, alignItems: 'center' },
  miniValue: { color: colors.ink, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  miniLabel: { color: colors.muted, fontSize: 7, fontWeight: '900', letterSpacing: 0.5, marginTop: 4 },
  miniDivider: { width: 1, height: 32, backgroundColor: colors.border },
  sessionCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.sm, shadowOpacity: 0.03 },
  sessionIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.tealSoft, alignItems: 'center', justifyContent: 'center' },
  sessionBody: { flex: 1 },
  sessionSubject: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  sessionTarget: { color: colors.inkSoft, fontSize: 9, marginTop: 2 },
  sessionDate: { color: colors.muted, fontSize: 8, marginTop: 3 },
  sessionRight: { alignItems: 'flex-end', gap: 7 },
  sessionDuration: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  sessionActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  receiptButton: { width: 29, height: 29, borderRadius: 9, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  receiptButtonDone: { backgroundColor: colors.tealSoft },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md },
  privacyText: { flex: 1, color: colors.inkSoft, fontSize: 9, lineHeight: 14 },
});
