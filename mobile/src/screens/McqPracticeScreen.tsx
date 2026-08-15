import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Chip, EmptyState, PrimaryButton, SectionHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { McqPracticeSession, PracticeConfig, PracticeDifficulty, PracticeGroup, PracticeMode, useMcqPractice } from '../context/McqPracticeContext';
import { icaiContentManifest } from '../data/icaiContentManifest';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';
import { CaGroup, caGroupDetails, groupsForStudent, subjectGroup } from '../utils/caGroups';

type Props = NativeStackScreenProps<RootStackParamList, 'McqPractice'>;
const letters = ['A', 'B', 'C', 'D'];
const counts = [5, 10, 20, 50];
const modes: PracticeMode[] = ['Mixed', 'Normal', 'Case Study'];
const difficulties: PracticeDifficulty[] = ['Mixed', 'Easy', 'Medium', 'Hard'];

const formatDuration = (seconds?: number) => {
  if (!seconds) return '—';
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes ? `${minutes}m ${secs}s` : `${secs}s`;
};

const SetupRow = ({ title, children }: React.PropsWithChildren<{ title: string }>) => <View style={styles.setupRow}><Text style={styles.setupLabel}>{title}</Text><View style={styles.chips}>{children}</View></View>;

export const McqPracticeScreen = ({ navigation }: Props) => {
  const { student } = useAuth();
  const { hydrated, activeSession, history, allQuestions, availableQuestions, questionsForSession, startPractice, answerQuestion, submitPractice, abandonPractice } = useMcqPractice();
  const allowed = useMemo(() => groupsForStudent(student?.group), [student?.group]);
  const groupOptions: PracticeGroup[] = allowed.length > 1 ? ['Combined', ...allowed] : allowed;
  const [config, setConfig] = useState<PracticeConfig>({ group: groupOptions[0], subject: 'All Subjects', chapter: 'All Chapters', mode: 'Mixed', difficulty: 'Mixed', requestedCount: 10 });
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<McqPracticeSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [clock, setClock] = useState(Date.now());

  const session = activeSession;
  const sessionQuestions = session ? questionsForSession(session) : [];
  const question = sessionQuestions[index];
  const answered = session ? Object.keys(session.answers).length : 0;
  const pool = availableQuestions(config);

  const availableSubjects = useMemo(() => ['All Subjects', ...Array.from(new Set(allQuestions
    .filter((item) => config.group === 'Combined' || subjectGroup(item.subject) === config.group)
    .sort((left, right) => left.chapterOrder - right.chapterOrder)
    .map((item) => item.subject)))], [allQuestions, config.group]);
  const availableChapters = useMemo(() => ['All Chapters', ...Array.from(new Set(allQuestions
    .filter((item) => (config.group === 'Combined' || subjectGroup(item.subject) === config.group) && (config.subject === 'All Subjects' || item.subject === config.subject))
    .sort((left, right) => left.chapterOrder - right.chapterOrder)
    .map((item) => item.chapter)))], [allQuestions, config.group, config.subject]);

  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [session]);

  const patchConfig = (patch: Partial<PracticeConfig>) => setConfig((current) => ({ ...current, ...patch }));
  const chooseGroup = (group: PracticeGroup) => patchConfig({ group, subject: 'All Subjects', chapter: 'All Chapters' });
  const chooseSubject = (subject: string) => patchConfig({ subject, chapter: 'All Chapters' });

  const start = async () => {
    setStarting(true);
    try {
      await startPractice(config);
      setIndex(0);
      setResult(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      Alert.alert('Cannot start practice', error instanceof Error ? error.message : 'Change the selected filters and try again.');
    } finally { setStarting(false); }
  };

  const select = async (option: number) => {
    if (!question) return;
    Haptics.selectionAsync().catch(() => undefined);
    await answerQuestion(question.id, option);
  };

  const finish = () => Alert.alert('Finish practice?', `${sessionQuestions.length - answered} unanswered question${sessionQuestions.length - answered === 1 ? '' : 's'} will count as incorrect.`, [
    { text: 'Continue', style: 'cancel' },
    { text: 'Submit', onPress: async () => { const completed = await submitPractice(); if (completed) setResult(completed); } },
  ]);

  const abandon = () => Alert.alert('Discard this practice session?', 'The current answers will be removed. Daily Challenge scores are not affected.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: () => { abandonPractice(); setIndex(0); } },
  ]);

  if (!hydrated) return <SafeAreaView style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>Preparing Practice Zone…</Text></SafeAreaView>;

  if (result) {
    const questions = questionsForSession(result);
    const wrongIds = questions.filter((question) => result.answers[question.id] !== question.answer).map((question) => question.id);
    const percentage = result.total ? Math.round(((result.score || 0) / result.total) * 100) : 0;
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <LinearGradient colors={percentage >= 70 ? ['#126B61', '#209A83'] : ['#354969', '#607495']} style={styles.resultHero}>
            <View style={styles.resultIcon}><Ionicons name={percentage >= 70 ? 'trophy' : 'analytics'} size={28} color={percentage >= 70 ? colors.amber : colors.primary} /></View>
            <Text style={styles.resultEyebrow}>UNLIMITED PRACTICE RESULT</Text>
            <Text style={styles.resultScore}>{percentage}%</Text>
            <Text style={styles.resultSub}>{result.score}/{result.total} correct · {formatDuration(result.durationSeconds)}</Text>
            <Text style={styles.resultConfig}>{result.config.group} · {result.config.subject} · {result.config.difficulty}</Text>
          </LinearGradient>

          <SectionHeader title="Answer review" />
          {questions.map((item, itemIndex) => {
            const selected = result.answers[item.id];
            const correct = selected === item.answer;
            return (
              <Card key={item.id} style={styles.reviewCard}>
                <View style={styles.reviewTop}><View style={[styles.resultMark, { backgroundColor: correct ? colors.tealSoft : colors.redSoft }]}><Ionicons name={correct ? 'checkmark' : 'close'} size={15} color={correct ? colors.success : colors.red} /></View><Text style={styles.reviewMeta}>Q{itemIndex + 1} · {item.subject} · {item.chapter} · {item.difficulty}</Text></View>
                {item.caseStudy ? <View style={styles.miniCase}><Text style={styles.miniCaseTitle}>{item.caseStudy.title}</Text><Text style={styles.miniCaseText}>{item.caseStudy.passage}</Text></View> : null}
                <Text style={styles.reviewQuestion}>{item.prompt}</Text>
                <Text style={styles.answerLine}>Your answer: <Text style={{ color: correct ? colors.success : colors.red, fontWeight: '900' }}>{selected == null ? 'Not answered' : item.options[selected]}</Text></Text>
                {!correct ? <Text style={styles.correctLine}>Correct: {item.options[item.answer]}</Text> : null}
                <View style={styles.explanation}><Ionicons name="bulb-outline" size={15} color={colors.primary} /><Text style={styles.explanationText}>{item.explanation}</Text></View>
                <View style={styles.officialSource}><Ionicons name="book-outline" size={13} color={colors.muted} /><Text style={styles.officialSourceText}>ICAI BoS · {item.officialChapter.paper} · {item.chapter}</Text></View>
              </Card>
            );
          })}
          {wrongIds.length ? <PrimaryButton label={`Retry ${wrongIds.length} incorrect question${wrongIds.length === 1 ? '' : 's'}`} icon="refresh-circle-outline" onPress={async () => { await startPractice(result.config, wrongIds); setResult(null); setIndex(0); }} /> : null}
          <PrimaryButton label="Start another practice" icon="infinite" variant={wrongIds.length ? 'secondary' : 'primary'} onPress={() => { setResult(null); setIndex(0); }} style={{ marginTop: wrongIds.length ? spacing.md : 0 }} />
          <PrimaryButton label="Back to Daily MCQ" icon="calendar-outline" variant="secondary" onPress={() => navigation.navigate('DailyMcq')} style={{ marginTop: spacing.md }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (session && question) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.quizContent} showsVerticalScrollIndicator={false}>
          <View style={styles.quizHeader}><View><Text style={styles.quizEyebrow}>UNLIMITED PRACTICE · {question.subject}</Text><Text style={styles.quizPosition}>Question {index + 1} of {sessionQuestions.length}</Text></View><View style={styles.elapsed}><Ionicons name="stopwatch-outline" size={16} color={colors.primary} /><Text style={styles.elapsedText}>{formatDuration(Math.floor((clock - session.startedAt) / 1000))}</Text></View></View>
          <View style={styles.progress}><View style={[styles.progressFill, { width: `${((index + 1) / sessionQuestions.length) * 100}%` }]} /></View>
          <Text style={styles.answered}>{answered}/{sessionQuestions.length} answered</Text>

          <Card style={styles.questionCard}>
            <View style={styles.badges}><View style={styles.subjectBadge}><Text style={styles.subjectBadgeText}>{question.subject}</Text></View><View style={[styles.kindBadge, question.kind === 'case-study' && styles.caseBadge]}><Text style={[styles.kindText, question.kind === 'case-study' && styles.caseText]}>{question.kind === 'case-study' ? 'CASE STUDY' : 'NORMAL'}</Text></View><View style={[styles.difficultyBadge, question.difficulty === 'Hard' && styles.hardBadge]}><Text style={styles.difficultyText}>{question.difficulty.toUpperCase()}</Text></View></View>
            <Text style={styles.chapter}>ICAI BoS · {question.chapter}</Text>
            {question.caseStudy ? <View style={styles.caseStudy}><Text style={styles.caseTitle}>{question.caseStudy.title}</Text><Text style={styles.casePassage}>{question.caseStudy.passage}</Text></View> : null}
            <Text style={styles.questionText}>{question.prompt}</Text>
            <View style={styles.options}>{question.options.map((option, optionIndex) => {
              const selected = session.answers[question.id] === optionIndex;
              return <Pressable key={option} onPress={() => select(optionIndex)} style={[styles.option, selected && styles.optionSelected]}><View style={[styles.letter, selected && styles.letterSelected]}><Text style={[styles.letterText, selected && styles.letterTextSelected]}>{letters[optionIndex]}</Text></View><Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>{selected ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}</Pressable>;
            })}</View>
          </Card>

          <View style={styles.quizActions}><PrimaryButton label="Previous" icon="arrow-back" variant="secondary" disabled={index === 0} onPress={() => setIndex((value) => Math.max(0, value - 1))} style={{ flex: 1 }} />{index < sessionQuestions.length - 1 ? <PrimaryButton label="Next" icon="arrow-forward" onPress={() => setIndex((value) => Math.min(sessionQuestions.length - 1, value + 1))} style={{ flex: 1 }} /> : <PrimaryButton label="Submit" icon="checkmark-done" onPress={finish} style={{ flex: 1 }} />}</View>
          <View style={styles.dots}>{sessionQuestions.map((item, dotIndex) => <Pressable key={item.id} onPress={() => setIndex(dotIndex)} style={[styles.dot, dotIndex === index && styles.dotCurrent, session.answers[item.id] != null && styles.dotAnswered]}><Text style={[styles.dotText, (dotIndex === index || session.answers[item.id] != null) && { color: '#FFFFFF' }]}>{dotIndex + 1}</Text></Pressable>)}</View>
          <Pressable onPress={abandon} style={styles.abandon}><Text style={styles.abandonText}>Discard practice session</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const completedCount = history.filter((item) => item.completedAt).length;
  const average = completedCount ? Math.round(history.filter((item) => item.completedAt && item.total).reduce((sum, item) => sum + ((item.score || 0) / (item.total || 1)) * 100, 0) / completedCount) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={['#172F61', '#3C58C5', '#7459D4']} style={styles.hero}><View style={styles.heroIcon}><Ionicons name="infinite" size={30} color={colors.primary} /></View><Text style={styles.heroEyebrow}>ICAI-PATTERN PRACTICE</Text><Text style={styles.heroTitle}>Unlimited MCQ Practice Zone</Text><Text style={styles.heroText}>Build a custom session by group, subject, chapter, type and difficulty. Practice sessions never change the Daily Challenge streak.</Text><View style={styles.heroStats}><Text style={styles.heroStat}>{completedCount} sessions</Text><Text style={styles.heroStat}>{average}% avg</Text><Text style={styles.heroStat}>{allQuestions.length} question pool</Text></View></LinearGradient>

        <View style={styles.sourceBanner}><Ionicons name="shield-checkmark-outline" size={19} color="#9A6508" /><Text style={styles.sourceText}>Official chapter taxonomy: ICAI BoS May 2026 modules · Target attempt: {icaiContentManifest.targetAttempt}. Questions are original drafts; mentor approval and amendment review remain required.</Text></View>

        <SectionHeader title="Build your practice" />
        <Card style={styles.setupCard}>
          <SetupRow title="COURSE GROUP">{groupOptions.map((item) => <Chip key={item} label={item} selected={config.group === item} onPress={() => chooseGroup(item)} />)}</SetupRow>
          <View style={styles.line} />
          <SetupRow title="SUBJECT">{availableSubjects.map((item) => <Chip key={item} label={item} selected={config.subject === item} onPress={() => chooseSubject(item)} />)}</SetupRow>
          <View style={styles.line} />
          <SetupRow title="CHAPTER">{availableChapters.map((item) => <Chip key={item} label={item} selected={config.chapter === item} onPress={() => patchConfig({ chapter: item })} />)}</SetupRow>
          <View style={styles.line} />
          <SetupRow title="QUESTION TYPE">{modes.map((item) => <Chip key={item} label={item} selected={config.mode === item} onPress={() => patchConfig({ mode: item })} />)}</SetupRow>
          <View style={styles.line} />
          <SetupRow title="DIFFICULTY">{difficulties.map((item) => <Chip key={item} label={item} selected={config.difficulty === item} onPress={() => patchConfig({ difficulty: item })} />)}</SetupRow>
          <View style={styles.line} />
          <SetupRow title="SESSION SIZE">{counts.map((item) => <Chip key={item} label={String(item)} selected={config.requestedCount === item} onPress={() => patchConfig({ requestedCount: item })} />)}</SetupRow>
        </Card>

        <View style={[styles.poolCard, !pool.length && styles.poolEmpty]}><View style={styles.poolIcon}><Ionicons name={pool.length ? 'layers-outline' : 'alert-circle-outline'} size={22} color={pool.length ? colors.primary : colors.red} /></View><View style={{ flex: 1 }}><Text style={styles.poolTitle}>{pool.length} questions match</Text><Text style={styles.poolText}>{pool.length ? `This session will use ${Math.min(config.requestedCount, pool.length)} unique questions. Start unlimited new sessions for fresh ordering.` : 'Broaden chapter, type or difficulty filters.'}</Text></View></View>
        <PrimaryButton label={`Start ${Math.min(config.requestedCount, pool.length)}-question practice`} icon="play" loading={starting} disabled={!pool.length} onPress={start} />

        {completedCount ? <View style={styles.historySummary}><Ionicons name="analytics-outline" size={20} color={colors.primary} /><Text style={styles.historyText}>Practice history is stored locally. Latest: {history.find((item) => item.completedAt)?.score}/{history.find((item) => item.completedAt)?.total}</Text></View> : <Card style={{ marginTop: spacing.xl }}><EmptyState icon="infinite-outline" title="No practice sessions yet" message="Configure a session above. There is no daily practice limit." /></Card>}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas, gap: spacing.md }, loadingText: { color: colors.muted, fontSize: 11 },
  content: { padding: spacing.lg, paddingBottom: 50 }, quizContent: { padding: spacing.lg, paddingBottom: 40 },
  hero: { borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.lg }, heroIcon: { width: 55, height: 55, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, heroEyebrow: { color: 'rgba(255,255,255,0.62)', fontSize: 8, fontWeight: '900', letterSpacing: 1.2, marginTop: spacing.lg }, heroTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', marginTop: 3 }, heroText: { color: 'rgba(255,255,255,0.7)', fontSize: 10, lineHeight: 16, marginTop: spacing.sm }, heroStats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }, heroStat: { color: '#FFFFFF', fontSize: 8, fontWeight: '800', backgroundColor: 'rgba(8,20,50,0.2)', paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.pill },
  sourceBanner: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xxl }, sourceText: { flex: 1, color: '#76561F', fontSize: 8, lineHeight: 13 },
  setupCard: { marginBottom: spacing.lg }, setupRow: { gap: spacing.sm, paddingVertical: spacing.sm }, setupLabel: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, line: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  poolCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg }, poolEmpty: { backgroundColor: colors.redSoft }, poolIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, poolTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' }, poolText: { color: colors.muted, fontSize: 8, lineHeight: 13, marginTop: 3 },
  historySummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xl }, historyText: { flex: 1, color: colors.inkSoft, fontSize: 9 },
  quizHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, quizEyebrow: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 }, quizPosition: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: 3 }, elapsed: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 8 }, elapsedText: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  progress: { height: 7, borderRadius: 4, backgroundColor: colors.primarySoft, overflow: 'hidden', marginTop: spacing.xl }, progressFill: { height: 7, borderRadius: 4, backgroundColor: colors.primary }, answered: { color: colors.muted, fontSize: 8, textAlign: 'right', marginTop: 5, marginBottom: spacing.lg },
  questionCard: { padding: spacing.lg }, badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, subjectBadge: { backgroundColor: colors.purpleSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 5 }, subjectBadgeText: { color: colors.purple, fontSize: 7, fontWeight: '900' }, kindBadge: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 5 }, caseBadge: { backgroundColor: colors.amberSoft }, kindText: { color: colors.primary, fontSize: 7, fontWeight: '900' }, caseText: { color: '#94610B' }, difficultyBadge: { backgroundColor: colors.tealSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 5 }, hardBadge: { backgroundColor: colors.redSoft }, difficultyText: { color: colors.inkSoft, fontSize: 7, fontWeight: '900' }, chapter: { color: colors.muted, fontSize: 9, fontWeight: '800', marginTop: spacing.md },
  caseStudy: { backgroundColor: '#F8F6FF', borderRadius: radius.md, borderWidth: 1, borderColor: '#E3DCFA', padding: spacing.md, marginTop: spacing.md }, caseTitle: { color: colors.purple, fontSize: 10, fontWeight: '900' }, casePassage: { color: colors.inkSoft, fontSize: 11, lineHeight: 18, marginTop: spacing.sm }, questionText: { color: colors.ink, fontSize: 17, lineHeight: 25, fontWeight: '900', marginTop: spacing.lg }, options: { gap: spacing.md, marginTop: spacing.xl }, option: { minHeight: 59, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, optionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, letter: { width: 31, height: 31, borderRadius: 10, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, letterSelected: { backgroundColor: colors.primary }, letterText: { color: colors.inkSoft, fontSize: 10, fontWeight: '900' }, letterTextSelected: { color: '#FFFFFF' }, optionText: { flex: 1, color: colors.inkSoft, fontSize: 11, lineHeight: 17, fontWeight: '700' }, optionTextSelected: { color: colors.ink, fontWeight: '900' },
  quizActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }, dots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl }, dot: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, dotCurrent: { borderColor: colors.primary, borderWidth: 2 }, dotAnswered: { backgroundColor: colors.primary }, dotText: { color: colors.muted, fontSize: 8, fontWeight: '900' }, abandon: { alignSelf: 'center', padding: spacing.lg }, abandonText: { color: colors.red, fontSize: 9, textDecorationLine: 'underline' },
  resultHero: { borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', marginBottom: spacing.xxl }, resultIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, resultEyebrow: { color: 'rgba(255,255,255,0.62)', fontSize: 8, fontWeight: '900', letterSpacing: 1, marginTop: spacing.md }, resultScore: { color: '#FFFFFF', fontSize: 47, fontWeight: '900' }, resultSub: { color: 'rgba(255,255,255,0.75)', fontSize: 10 }, resultConfig: { color: '#FFFFFF', fontSize: 8, backgroundColor: 'rgba(8,20,50,0.2)', borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 6, marginTop: spacing.md },
  reviewCard: { marginBottom: spacing.md }, reviewTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, resultMark: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, reviewMeta: { flex: 1, color: colors.muted, fontSize: 7, fontWeight: '900' }, miniCase: { backgroundColor: colors.purpleSoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }, miniCaseTitle: { color: colors.purple, fontSize: 9, fontWeight: '900' }, miniCaseText: { color: colors.inkSoft, fontSize: 9, lineHeight: 14, marginTop: 4 }, reviewQuestion: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: '900', marginTop: spacing.md }, answerLine: { color: colors.muted, fontSize: 9, marginTop: spacing.md }, correctLine: { color: colors.success, fontSize: 9, fontWeight: '900', marginTop: 4 }, explanation: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }, explanationText: { flex: 1, color: colors.inkSoft, fontSize: 9, lineHeight: 14 },
  officialSource: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.md }, officialSourceText: { flex: 1, color: colors.muted, fontSize: 7, lineHeight: 12 },
});
