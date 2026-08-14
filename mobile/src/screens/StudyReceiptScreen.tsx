import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Chip, PrimaryButton, SectionHeader } from '../components/ui';
import { config } from '../config';
import { useFocusTimer } from '../context/FocusTimerContext';
import { RecallAnswer, RecallConfidence, useStudyReceipts } from '../context/StudyReceiptContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'StudyReceipt'>;
const confidenceOptions: RecallConfidence[] = ['Low', 'Medium', 'High'];

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
};

export const StudyReceiptScreen = ({ route, navigation }: Props) => {
  const { sessions } = useFocusTimer();
  const { buildQuestions, createReceipt, completeReview, receiptForSession } = useStudyReceipts();
  const session = sessions.find((item) => item.id === route.params.sessionId);
  const receipt = receiptForSession(route.params.sessionId);
  const questions = useMemo(() => session ? buildQuestions(session) : [], [buildQuestions, session]);
  const [answers, setAnswers] = useState<RecallAnswer[]>([]);
  const [confidence, setConfidence] = useState<RecallConfidence>('Medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewResponse, setReviewResponse] = useState('');
  const [reviewConfidence, setReviewConfidence] = useState<RecallConfidence>('Medium');

  useEffect(() => {
    if (!answers.length && questions.length) setAnswers(questions.map((question) => ({ ...question, response: '' })));
  }, [answers.length, questions]);

  const updateAnswer = (id: string, response: string) => setAnswers((current) => current.map((answer) => answer.id === id ? { ...answer, response } : answer));

  const save = async () => {
    if (!session) return;
    if (answers.some((answer) => answer.response.trim().length < 12)) {
      setError('Please attempt every recall prompt in your own words before creating the receipt.');
      return;
    }
    setError('');
    setSaving(true);
    try { await createReceipt(session, answers, confidence); }
    catch (e) { setError(e instanceof Error ? e.message : 'Study receipt could not be saved.'); }
    finally { setSaving(false); }
  };

  const saveReview = async () => {
    if (!receipt || reviewResponse.trim().length < 15) {
      setError('Write what you still remember before completing the memory check.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await completeReview(receipt.id, reviewResponse, reviewConfidence);
      setReviewOpen(false);
    } finally { setSaving(false); }
  };

  if (!session && !receipt) {
    return <SafeAreaView style={styles.safe}><View style={styles.missing}><Ionicons name="receipt-outline" size={35} color={colors.muted} /><Text style={styles.missingTitle}>Session not found</Text><Text style={styles.missingText}>This local focus session may have been removed.</Text></View></SafeAreaView>;
  }

  if (receipt) {
    const reviewDue = receipt.nextReviewAt <= Date.now();
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <LinearGradient colors={['#173A68', '#3456C5', '#6857D6']} style={styles.receiptHero}>
            <View style={styles.receiptCheck}><Ionicons name="checkmark" size={27} color={colors.success} /></View>
            <Text style={styles.receiptEyebrow}>STUDY RECEIPT</Text>
            <Text style={styles.receiptTitle}>Self-recall complete</Text>
            <Text style={styles.receiptSub}>{receipt.subject} · {formatDuration(receipt.focusedSeconds)}</Text>
            <View style={styles.scoreCircle}><Text style={styles.scoreValue}>{receipt.recallEffortScore}</Text><Text style={styles.scoreLabel}>EFFORT</Text></View>
          </LinearGradient>

          <View style={styles.disclaimer}><Ionicons name="information-circle" size={19} color={colors.primary} /><Text style={styles.disclaimerText}>This score measures recall completeness, not academic correctness. “Verified learning” will require a mentor-approved answer source.</Text></View>

          <SectionHeader title="Session proof" />
          <Card style={styles.detailCard}>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Target</Text><Text style={styles.detailValue}>{receipt.target}</Text></View>
            <View style={styles.line} />
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Focused time</Text><Text style={styles.detailValue}>{formatDuration(receipt.focusedSeconds)}</Text></View>
            <View style={styles.line} />
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Confidence</Text><Text style={styles.detailValue}>{receipt.confidence}</Text></View>
            <View style={styles.line} />
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Source</Text><Text style={styles.selfRecallBadge}>SELF RECALL</Text></View>
          </Card>

          <SectionHeader title="Your closed-book recall" />
          {receipt.answers.map((answer, index) => (
            <Card key={answer.id} style={styles.answerCard}>
              <Text style={styles.answerNumber}>PROMPT {index + 1}</Text>
              <Text style={styles.answerPrompt}>{answer.prompt}</Text>
              <Text style={styles.answerText}>{answer.response}</Text>
            </Card>
          ))}

          <SectionHeader title="24-hour memory check" />
          <Card style={styles.memoryCard}>
            <View style={styles.memoryTop}><View style={styles.memoryIcon}><Ionicons name={receipt.review ? 'checkmark-done' : 'alarm-outline'} size={22} color={receipt.review ? colors.success : colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.memoryTitle}>{receipt.review ? 'Memory check completed' : reviewDue ? 'Your memory check is due' : 'Scheduled for tomorrow'}</Text><Text style={styles.memoryDate}>{receipt.review ? new Date(receipt.review.completedAt).toLocaleString('en-IN') : new Date(receipt.nextReviewAt).toLocaleString('en-IN')}</Text></View></View>
            {receipt.review ? (
              <View style={styles.retentionResult}><Text style={styles.retentionScore}>{receipt.review.selfReportedScore}%</Text><View style={{ flex: 1 }}><Text style={styles.retentionLabel}>SELF-REPORTED RETENTION</Text><Text style={styles.retentionText}>{receipt.review.response}</Text></View></View>
            ) : reviewOpen ? (
              <View style={styles.reviewForm}>
                <Text style={styles.reviewPrompt}>Without opening notes, what can you still recall about “{receipt.target}”?</Text>
                <TextInput value={reviewResponse} onChangeText={setReviewResponse} multiline placeholder="Write from memory…" placeholderTextColor={colors.muted} style={styles.textArea} />
                <Text style={styles.confidenceLabel}>How confident are you now?</Text>
                <View style={styles.chips}>{confidenceOptions.map((item) => <Chip key={item} label={item} selected={reviewConfidence === item} onPress={() => setReviewConfidence(item)} />)}</View>
                <PrimaryButton label="Complete memory check" loading={saving} onPress={saveReview} />
              </View>
            ) : (
              <PrimaryButton label={reviewDue ? 'Start memory check' : config.useMocks ? 'Preview memory check now' : 'Available after 24 hours'} variant="secondary" icon="refresh-outline" disabled={!reviewDue && !config.useMocks} onPress={() => setReviewOpen(true)} />
            )}
          </Card>

          <View style={styles.aiCard}><View style={styles.aiIcon}><Ionicons name="sparkles" size={22} color={colors.purple} /></View><View style={{ flex: 1 }}><Text style={styles.aiTitle}>AI verification layer</Text><Text style={styles.aiText}>Next phase: generate and grade source-cited questions from mentor-approved PDFs through a secure server endpoint.</Text></View><View style={styles.lockBadge}><Ionicons name="lock-closed" size={11} color={colors.muted} /></View></View>

          <PrimaryButton label="Back to Focus Room" icon="arrow-back" onPress={() => navigation.navigate('Main', { screen: 'Focus' })} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <LinearGradient colors={['#E9EFFF', '#F6F4FF']} style={styles.intro}>
            <View style={styles.introIcon}><Ionicons name="receipt-outline" size={28} color={colors.primary} /></View>
            <Text style={styles.introEyebrow}>PROOF OF LEARNING</Text>
            <Text style={styles.introTitle}>Turn focused time into a Study Receipt.</Text>
            <Text style={styles.introText}>Close your notes first. These prompts test active recall—not typing speed or timer duration.</Text>
            <View style={styles.sessionSummary}><Text style={styles.sessionSubject}>{session?.subject}</Text><Text style={styles.sessionTime}>{formatDuration(session?.durationSeconds || 0)}</Text></View>
            <Text style={styles.target}>Target: {session?.target || session?.subject}</Text>
          </LinearGradient>

          {answers.map((answer, index) => (
            <View key={answer.id} style={styles.questionBlock}>
              <Text style={styles.questionNumber}>RECALL {index + 1} OF {answers.length}</Text>
              <Text style={styles.question}>{answer.prompt}</Text>
              <Text style={styles.helper}>{answer.helper}</Text>
              <TextInput
                value={answer.response}
                onChangeText={(value) => updateAnswer(answer.id, value)}
                multiline
                textAlignVertical="top"
                placeholder="Answer without opening your notes…"
                placeholderTextColor={colors.muted}
                style={styles.textArea}
              />
            </View>
          ))}

          <View style={styles.confidenceBlock}>
            <Text style={styles.confidenceTitle}>How confident are you about this topic?</Text>
            <View style={styles.chips}>{confidenceOptions.map((item) => <Chip key={item} label={item} selected={confidence === item} onPress={() => setConfidence(item)} />)}</View>
          </View>

          {error ? <View style={styles.error}><Ionicons name="alert-circle" size={19} color={colors.red} /><Text style={styles.errorText}>{error}</Text></View> : null}
          <PrimaryButton label="Create Study Receipt" icon="receipt-outline" loading={saving} onPress={save} />
          <Text style={styles.honesty}>Your answers stay on this device in the current preview build.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: 50 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  missingTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: spacing.md },
  missingText: { color: colors.muted, fontSize: 11, marginTop: spacing.xs },
  intro: { borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.xxl, borderWidth: 1, borderColor: '#DCE2FA' },
  introIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  introEyebrow: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  introTitle: { color: colors.ink, fontSize: 23, lineHeight: 29, fontWeight: '900', letterSpacing: -0.5, marginTop: spacing.xs },
  introText: { color: colors.inkSoft, fontSize: 11, lineHeight: 17, marginTop: spacing.sm },
  sessionSummary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl },
  sessionSubject: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  sessionTime: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  target: { color: colors.muted, fontSize: 10, marginTop: 4 },
  questionBlock: { marginBottom: spacing.xxl },
  questionNumber: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  question: { color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: '900', marginTop: spacing.sm },
  helper: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4, marginBottom: spacing.md },
  textArea: { minHeight: 115, backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.ink, fontSize: 13, lineHeight: 19 },
  confidenceBlock: { gap: spacing.md, marginBottom: spacing.xl },
  confidenceTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  confidenceLabel: { color: colors.inkSoft, fontSize: 11, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.redSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  errorText: { flex: 1, color: colors.red, fontSize: 11, lineHeight: 17 },
  honesty: { color: colors.muted, fontSize: 8, textAlign: 'center', marginTop: spacing.md },
  receiptHero: { borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', overflow: 'hidden', marginBottom: spacing.lg },
  receiptCheck: { width: 55, height: 55, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  receiptEyebrow: { color: 'rgba(255,255,255,0.62)', fontSize: 8, fontWeight: '900', letterSpacing: 1.3 },
  receiptTitle: { color: '#FFFFFF', fontSize: 23, fontWeight: '900', marginTop: 3 },
  receiptSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 4 },
  scoreCircle: { width: 78, height: 78, borderRadius: 39, backgroundColor: 'rgba(8,20,50,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  scoreValue: { color: '#FFFFFF', fontSize: 27, fontWeight: '900' },
  scoreLabel: { color: 'rgba(255,255,255,0.58)', fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  disclaimer: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xxl },
  disclaimerText: { flex: 1, color: colors.inkSoft, fontSize: 9, lineHeight: 14 },
  detailCard: { marginBottom: spacing.xxl },
  detailRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  detailLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  detailValue: { flex: 1, color: colors.ink, fontSize: 11, fontWeight: '900', textAlign: 'right' },
  line: { height: 1, backgroundColor: colors.border },
  selfRecallBadge: { color: colors.primary, fontSize: 8, fontWeight: '900', backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.pill },
  answerCard: { marginBottom: spacing.md, shadowOpacity: 0.03 },
  answerNumber: { color: colors.primary, fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  answerPrompt: { color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: '900', marginTop: 5 },
  answerText: { color: colors.inkSoft, fontSize: 11, lineHeight: 18, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  memoryCard: { marginBottom: spacing.xxl },
  memoryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  memoryIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  memoryTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  memoryDate: { color: colors.muted, fontSize: 9, marginTop: 3 },
  reviewForm: { gap: spacing.md },
  reviewPrompt: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: '800' },
  retentionResult: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, backgroundColor: colors.tealSoft, borderRadius: radius.md, padding: spacing.md },
  retentionScore: { color: colors.success, fontSize: 25, fontWeight: '900' },
  retentionLabel: { color: colors.success, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  retentionText: { color: colors.inkSoft, fontSize: 9, lineHeight: 14, marginTop: 4 },
  aiCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.purpleSoft, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.xxl },
  aiIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  aiTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  aiText: { color: colors.inkSoft, fontSize: 9, lineHeight: 14, marginTop: 3 },
  lockBadge: { width: 27, height: 27, borderRadius: 9, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
});
