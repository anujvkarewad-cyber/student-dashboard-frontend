import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, PrimaryButton, SectionHeader } from '../components/ui';
import { useDailyMcq } from '../context/DailyMcqContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

const QUIZ_SECONDS = 10 * 60;
const letters = ['A', 'B', 'C', 'D'];

type Props = NativeStackScreenProps<RootStackParamList, 'DailyMcq'>;

const formatClock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const formatDuration = (seconds?: number) => {
  if (!seconds) return '—';
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes ? `${minutes}m ${secs}s` : `${secs}s`;
};

export const DailyMcqScreen = ({ navigation }: Props) => {
  const { hydrated, todayAttempt, todayQuestions, history, streak, startDaily, answerQuestion, submitDaily } = useDailyMcq();
  const [index, setIndex] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [starting, setStarting] = useState(false);
  const autoSubmitted = useRef(false);

  const active = todayAttempt && !todayAttempt.completedAt;
  const elapsed = active ? Math.max(0, Math.floor((clock - todayAttempt.startedAt) / 1000)) : 0;
  const timeLeft = Math.max(0, QUIZ_SECONDS - elapsed);
  const answered = todayAttempt ? Object.keys(todayAttempt.answers).length : 0;
  const question = todayQuestions[index];
  const percentage = todayAttempt?.completedAt && todayAttempt.total ? Math.round(((todayAttempt.score || 0) / todayAttempt.total) * 100) : 0;

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [active]);

  useEffect(() => {
    if (!active || timeLeft > 0 || autoSubmitted.current) return;
    autoSubmitted.current = true;
    submitDaily().then(() => Alert.alert('Time is up', 'Your answered questions have been submitted.'));
  }, [active, submitDaily, timeLeft]);

  const subjectMix = useMemo(() => [...new Set(todayQuestions.map((item) => item.subject))], [todayQuestions]);

  const start = async () => {
    setStarting(true);
    try {
      await startDaily();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } finally { setStarting(false); }
  };

  const select = async (option: number) => {
    if (!question) return;
    Haptics.selectionAsync().catch(() => undefined);
    await answerQuestion(question.id, option);
  };

  const confirmSubmit = () => {
    const unanswered = todayQuestions.length - answered;
    Alert.alert(
      'Submit daily challenge?',
      unanswered ? `${unanswered} question${unanswered === 1 ? ' is' : 's are'} still unanswered.` : 'You have answered all questions.',
      [
        { text: 'Review', style: 'cancel' },
        { text: 'Submit', onPress: () => submitDaily() },
      ],
    );
  };

  if (!hydrated) return <SafeAreaView style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>Preparing today’s challenge…</Text></SafeAreaView>;

  if (!todayAttempt) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <LinearGradient colors={['#162E61', '#3459CD', '#7256D7']} style={styles.hero}>
            <View style={styles.heroGlow} />
            <View style={styles.calendar}><Text style={styles.calendarDay}>{new Date().getDate()}</Text><Text style={styles.calendarMonth}>{new Date().toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}</Text></View>
            <Text style={styles.eyebrow}>DAILY KNOWLEDGE CHECK</Text>
            <Text style={styles.title}>10 questions.{`\n`}One focused attempt.</Text>
            <Text style={styles.subtitle}>Build recall consistency with a fresh mixed-subject challenge every day.</Text>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}><Text style={styles.heroStatValue}>10</Text><Text style={styles.heroStatLabel}>QUESTIONS</Text></View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}><Text style={styles.heroStatValue}>10m</Text><Text style={styles.heroStatLabel}>TIME LIMIT</Text></View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}><Text style={styles.heroStatValue}>{streak}</Text><Text style={styles.heroStatLabel}>DAY STREAK</Text></View>
            </View>
          </LinearGradient>

          <View style={styles.draftBanner}><Ionicons name="shield-outline" size={20} color="#A86B00" /><View style={{ flex: 1 }}><Text style={styles.draftTitle}>Demo draft question bank</Text><Text style={styles.draftText}>Use this build to test the experience. Mentor approval and syllabus-version labels are required before exam reliance.</Text></View></View>

          <SectionHeader title="Today's mix" />
          <Card style={styles.mixCard}>
            <View style={styles.subjects}>{subjectMix.map((subject) => <View key={subject} style={styles.subjectChip}><Text style={styles.subjectText}>{subject}</Text></View>)}</View>
          </Card>

          <SectionHeader title="Challenge rules" />
          <Card style={styles.rulesCard}>
            <View style={styles.rule}><View style={styles.ruleIcon}><Ionicons name="timer-outline" size={19} color={colors.primary} /></View><View><Text style={styles.ruleTitle}>10-minute timer</Text><Text style={styles.ruleText}>The attempt auto-submits when time runs out.</Text></View></View>
            <View style={styles.ruleLine} />
            <View style={styles.rule}><View style={styles.ruleIcon}><Ionicons name="calendar-outline" size={19} color={colors.primary} /></View><View><Text style={styles.ruleTitle}>One scored attempt per day</Text><Text style={styles.ruleText}>Answers persist if you leave and return.</Text></View></View>
            <View style={styles.ruleLine} />
            <View style={styles.rule}><View style={styles.ruleIcon}><Ionicons name="bulb-outline" size={19} color={colors.primary} /></View><View><Text style={styles.ruleTitle}>Explanations after submission</Text><Text style={styles.ruleText}>Review both correct and incorrect answers.</Text></View></View>
          </Card>

          <PrimaryButton label="Start today's MCQ" icon="play" loading={starting} onPress={start} />
          {history.filter((item) => item.completedAt).length ? <Text style={styles.historyHint}>{history.filter((item) => item.completedAt).length} previous daily challenge{history.filter((item) => item.completedAt).length === 1 ? '' : 's'} stored on this device.</Text> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (todayAttempt.completedAt) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <LinearGradient colors={percentage >= 70 ? ['#126B61', '#1A9B86'] : ['#344867', '#536B8E']} style={styles.resultHero}>
            <View style={styles.resultIcon}><Ionicons name={percentage >= 70 ? 'trophy' : 'flag'} size={29} color={percentage >= 70 ? colors.amber : colors.primary} /></View>
            <Text style={styles.resultEyebrow}>TODAY'S RESULT</Text>
            <Text style={styles.resultScore}>{percentage}%</Text>
            <Text style={styles.resultText}>{todayAttempt.score}/{todayAttempt.total} correct · {formatDuration(todayAttempt.durationSeconds)}</Text>
            <View style={styles.resultStreak}><Ionicons name="flame" size={17} color="#FFD36D" /><Text style={styles.resultStreakText}>{streak} day MCQ streak</Text></View>
          </LinearGradient>

          <View style={styles.draftBanner}><Ionicons name="information-circle-outline" size={20} color="#A86B00" /><Text style={styles.draftText}>Preview result only—questions are not yet marked as mentor-approved exam content.</Text></View>

          <SectionHeader title="Answer review" />
          {todayQuestions.map((item, itemIndex) => {
            const selected = todayAttempt.answers[item.id];
            const correct = selected === item.answer;
            return (
              <Card key={item.id} style={styles.reviewCard}>
                <View style={styles.reviewTop}><View style={[styles.reviewStatus, correct ? styles.correctStatus : styles.wrongStatus]}><Ionicons name={correct ? 'checkmark' : 'close'} size={15} color={correct ? colors.success : colors.red} /></View><Text style={styles.reviewNumber}>Q{itemIndex + 1} · {item.subject}</Text></View>
                <Text style={styles.reviewQuestion}>{item.prompt}</Text>
                <Text style={styles.yourAnswer}>Your answer: <Text style={[styles.answerStrong, { color: correct ? colors.success : colors.red }]}>{selected == null ? 'Not answered' : item.options[selected]}</Text></Text>
                {!correct ? <Text style={styles.correctAnswer}>Correct answer: {item.options[item.answer]}</Text> : null}
                <View style={styles.explanation}><Ionicons name="bulb-outline" size={16} color={colors.primary} /><Text style={styles.explanationText}>{item.explanation}</Text></View>
              </Card>
            );
          })}
          <PrimaryButton label="Back to dashboard" icon="home-outline" onPress={() => navigation.navigate('Main', { screen: 'Home' })} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.quizContent} showsVerticalScrollIndicator={false}>
        <View style={styles.quizHeader}>
          <View><Text style={styles.quizEyebrow}>DAILY MCQ · {question?.subject}</Text><Text style={styles.quizPosition}>Question {index + 1} of {todayQuestions.length}</Text></View>
          <View style={[styles.clock, timeLeft <= 60 && styles.clockWarning]}><Ionicons name="timer-outline" size={17} color={timeLeft <= 60 ? colors.red : colors.primary} /><Text style={[styles.clockText, timeLeft <= 60 && { color: colors.red }]}>{formatClock(timeLeft)}</Text></View>
        </View>
        <View style={styles.progress}><View style={[styles.progressFill, { width: `${((index + 1) / todayQuestions.length) * 100}%` }]} /></View>
        <Text style={styles.answered}>{answered} of {todayQuestions.length} answered</Text>

        <Card style={styles.questionCard}>
          <View style={styles.questionSubject}><Text style={styles.questionSubjectText}>{question?.subject}</Text></View>
          <Text style={styles.questionText}>{question?.prompt}</Text>
          <View style={styles.options}>
            {question?.options.map((option, optionIndex) => {
              const selected = todayAttempt.answers[question.id] === optionIndex;
              return (
                <Pressable key={option} onPress={() => select(optionIndex)} style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.optionPressed]}>
                  <View style={[styles.optionLetter, selected && styles.optionLetterSelected]}><Text style={[styles.optionLetterText, selected && styles.optionLetterTextSelected]}>{letters[optionIndex]}</Text></View>
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
                  {selected ? <Ionicons name="checkmark-circle" size={21} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Card>

        <View style={styles.quizActions}>
          <PrimaryButton label="Previous" icon="arrow-back" variant="secondary" disabled={index === 0} onPress={() => setIndex((value) => Math.max(0, value - 1))} style={{ flex: 1 }} />
          {index < todayQuestions.length - 1
            ? <PrimaryButton label="Next" icon="arrow-forward" onPress={() => setIndex((value) => Math.min(todayQuestions.length - 1, value + 1))} style={{ flex: 1 }} />
            : <PrimaryButton label="Submit" icon="checkmark-done" onPress={confirmSubmit} style={{ flex: 1 }} />}
        </View>

        <View style={styles.questionDots}>{todayQuestions.map((item, dotIndex) => <Pressable key={item.id} onPress={() => setIndex(dotIndex)} style={[styles.dot, dotIndex === index && styles.dotCurrent, todayAttempt.answers[item.id] != null && styles.dotAnswered]}><Text style={[styles.dotText, (dotIndex === index || todayAttempt.answers[item.id] != null) && styles.dotTextActive]}>{dotIndex + 1}</Text></Pressable>)}</View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas, gap: spacing.md },
  loadingText: { color: colors.muted, fontSize: 11 },
  content: { padding: spacing.lg, paddingBottom: 50 },
  hero: { borderRadius: radius.xl, padding: spacing.xl, overflow: 'hidden', marginBottom: spacing.lg },
  heroGlow: { position: 'absolute', width: 230, height: 230, borderRadius: 115, backgroundColor: 'rgba(255,255,255,0.08)', right: -70, top: -80 },
  calendar: { width: 58, height: 61, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  calendarDay: { color: colors.primary, fontSize: 22, fontWeight: '900', lineHeight: 24 },
  calendarMonth: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  eyebrow: { color: 'rgba(255,255,255,0.64)', fontSize: 8, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#FFFFFF', fontSize: 29, lineHeight: 35, fontWeight: '900', letterSpacing: -0.8, marginTop: spacing.xs },
  subtitle: { color: 'rgba(255,255,255,0.72)', fontSize: 11, lineHeight: 17, marginTop: spacing.sm, maxWidth: 290 },
  heroStats: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, backgroundColor: 'rgba(8,20,50,0.22)', borderRadius: radius.lg, paddingVertical: spacing.md },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  heroStatLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 7, fontWeight: '900', letterSpacing: 0.6, marginTop: 3 },
  heroDivider: { width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.16)' },
  draftBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xxl },
  draftTitle: { color: '#8D5C05', fontSize: 10, fontWeight: '900' },
  draftText: { flex: 1, color: '#7A5A22', fontSize: 8, lineHeight: 13, marginTop: 2 },
  mixCard: { marginBottom: spacing.xxl },
  subjects: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  subjectChip: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 7 },
  subjectText: { color: colors.primary, fontSize: 9, fontWeight: '900' },
  rulesCard: { marginBottom: spacing.xxl, paddingVertical: spacing.sm },
  rule: { minHeight: 63, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ruleIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  ruleTitle: { color: colors.ink, fontSize: 11, fontWeight: '900' },
  ruleText: { color: colors.muted, fontSize: 8, marginTop: 3 },
  ruleLine: { height: 1, backgroundColor: colors.border, marginLeft: 51 },
  historyHint: { color: colors.muted, fontSize: 8, textAlign: 'center', marginTop: spacing.md },
  quizContent: { padding: spacing.lg, paddingBottom: 40 },
  quizHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quizEyebrow: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  quizPosition: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: 3 },
  clock: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 8 },
  clockWarning: { backgroundColor: colors.redSoft },
  clockText: { color: colors.primary, fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  progress: { height: 7, borderRadius: 4, backgroundColor: colors.primarySoft, overflow: 'hidden', marginTop: spacing.xl },
  progressFill: { height: 7, borderRadius: 4, backgroundColor: colors.primary },
  answered: { color: colors.muted, fontSize: 8, textAlign: 'right', marginTop: 5, marginBottom: spacing.lg },
  questionCard: { padding: spacing.lg, shadowOpacity: 0.05 },
  questionSubject: { alignSelf: 'flex-start', backgroundColor: colors.purpleSoft, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  questionSubjectText: { color: colors.purple, fontSize: 8, fontWeight: '900' },
  questionText: { color: colors.ink, fontSize: 18, lineHeight: 26, fontWeight: '900', marginTop: spacing.lg },
  options: { gap: spacing.md, marginTop: spacing.xl },
  option: { minHeight: 60, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  optionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  optionPressed: { opacity: 0.78 },
  optionLetter: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  optionLetterSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionLetterText: { color: colors.inkSoft, fontSize: 11, fontWeight: '900' },
  optionLetterTextSelected: { color: '#FFFFFF' },
  optionText: { flex: 1, color: colors.inkSoft, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  optionTextSelected: { color: colors.ink, fontWeight: '900' },
  quizActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  questionDots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl },
  dot: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dotCurrent: { borderColor: colors.primary, borderWidth: 2 },
  dotAnswered: { backgroundColor: colors.primary },
  dotText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  dotTextActive: { color: '#FFFFFF' },
  resultHero: { borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', marginBottom: spacing.lg },
  resultIcon: { width: 57, height: 57, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  resultEyebrow: { color: 'rgba(255,255,255,0.62)', fontSize: 8, fontWeight: '900', letterSpacing: 1.2, marginTop: spacing.md },
  resultScore: { color: '#FFFFFF', fontSize: 48, fontWeight: '900', letterSpacing: -1.5 },
  resultText: { color: 'rgba(255,255,255,0.72)', fontSize: 10 },
  resultStreak: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(8,20,50,0.2)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7, marginTop: spacing.md },
  resultStreakText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  reviewCard: { marginBottom: spacing.md, shadowOpacity: 0.03 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reviewStatus: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  correctStatus: { backgroundColor: colors.tealSoft },
  wrongStatus: { backgroundColor: colors.redSoft },
  reviewNumber: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  reviewQuestion: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: '900', marginTop: spacing.md },
  yourAnswer: { color: colors.muted, fontSize: 10, marginTop: spacing.md },
  answerStrong: { fontWeight: '900' },
  correctAnswer: { color: colors.success, fontSize: 10, fontWeight: '800', marginTop: 5 },
  explanation: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  explanationText: { flex: 1, color: colors.inkSoft, fontSize: 9, lineHeight: 14 },
});
