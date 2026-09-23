import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, PrimaryButton, SectionHeader } from '../components/ui';
import { useAdaptive } from '../context/AdaptiveContext';
import { useAuth } from '../context/AuthContext';
import { useMcqBank } from '../context/McqBankContext';
import type { RootStackParamList } from '../navigation/types';
import type { Confidence } from '../services/adaptiveEngine';
import {
  evaluateAnswer,
  missedKeywords,
  VERDICT_TONE,
  type EvaluationResult,
} from '../services/answerEvaluator';
import { primaryConcept } from '../services/conceptResolver';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'WrittenAnswer'>;

const CONFIDENCE: { value: Confidence; hint: string }[] = [
  { value: 'Low', hint: 'Guessed' },
  { value: 'Medium', hint: 'Fairly sure' },
  { value: 'High', hint: 'Certain' },
];

/** Score at or above this counts as a correct attempt for the engine. */
const PASS_MARK = 6;

const Bullets = ({ items, tone }: { items: string[]; tone?: string }) => (
  <View style={styles.bullets}>
    {items.map((item, i) => (
      <View key={`${i}-${item.slice(0, 12)}`} style={styles.bulletRow}>
        <Text style={[styles.bulletDot, tone ? { color: tone } : null]}>•</Text>
        <Text style={styles.bulletText}>{item}</Text>
      </View>
    ))}
  </View>
);

export const WrittenAnswerScreen = ({ navigation }: Props) => {
  const { student } = useAuth();
  const { questions } = useMcqBank();
  const { recordAnswer, weak } = useAdaptive();

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [subject, setSubject] = useState<string | undefined>();
  const [confidence, setConfidence] = useState<Confidence | undefined>();
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // Suggest prompts from the concepts the student is weakest at, so the
  // written practice aims at their actual gaps rather than at random chapters.
  const suggestions = useMemo(() => {
    if (!questions.length) return [];
    const wanted = new Set(weak.slice(0, 12).map((w) => w.chapterId).filter(Boolean));
    const fromWeak = questions.filter((q) => wanted.has(q.chapterId));
    const pool = fromWeak.length ? fromWeak : questions;
    const seen = new Set<string>();
    const out: typeof questions = [];
    for (const q of pool) {
      if (seen.has(q.chapterId)) continue;
      seen.add(q.chapterId);
      out.push(q);
      if (out.length >= 5) break;
    }
    return out;
  }, [questions, weak]);

  const pickSuggestion = (q: (typeof questions)[number]) => {
    setQuestion(q.prompt);
    setSubject(q.subject);
    setResult(null);
    setError(undefined);
  };

  const reset = () => {
    setQuestion('');
    setAnswer('');
    setSubject(undefined);
    setConfidence(undefined);
    setResult(null);
    setError(undefined);
  };

  const submit = async () => {
    if (!student || !question.trim() || !answer.trim() || !confidence) return;
    setBusy(true);
    setError(undefined);
    const concept = primaryConcept({
      id: 'written',
      subject: subject || 'General',
      chapterId: '',
      chapterTitle: 'Written answer',
      prompt: question,
    });

    const outcome = await evaluateAnswer({
      studentId: student.studentId,
      question,
      studentAnswer: answer,
      subject,
      concept: concept.label,
    });
    setBusy(false);

    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }

    setResult(outcome);

    // The mark becomes an attempt on the concept, so a written answer moves
    // the same strength score and revision schedule the MCQs do. Confidence is
    // the rating the student gave BEFORE seeing the mark, which is what makes
    // a confident-but-wrong answer detectable.
    const correct = outcome.score >= PASS_MARK;
    recordAnswer({
      question: {
        id: 'written',
        subject: subject || 'General',
        chapterId: '',
        chapterTitle: question.slice(0, 120),
        prompt: question,
      },
      correct,
      confidence,
      mistakeType: correct
        ? undefined
        : outcome.conceptualMistakes.length
          ? 'concept'
          : outcome.missingKeyPoints.length
            ? 'application'
            : 'misread',
    }).catch(() => undefined);
  };

  if (!student) return null;

  const canSubmit = Boolean(question.trim() && answer.trim() && confidence) && !busy;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Written Answer</Text>
          <Text style={styles.subtitle}>
            Write it the way you would in the exam, and it gets marked like one.
          </Text>

          {!result ? (
            <>
              {!question ? (
                <>
                  <SectionHeader title="Answer one of your weak topics" />
                  <Card>
                    {suggestions.length ? (
                      suggestions.map((q) => (
                        <Pressable key={q.id} style={styles.suggest} onPress={() => pickSuggestion(q)}>
                          <Text style={styles.suggestSubject}>{q.subject} · {q.chapterTitle}</Text>
                          <Text style={styles.suggestPrompt} numberOfLines={2}>{q.prompt}</Text>
                        </Pressable>
                      ))
                    ) : (
                      <Text style={styles.hint}>
                        Practise a few questions first and your weak topics will appear here.
                      </Text>
                    )}
                  </Card>
                </>
              ) : null}

              <SectionHeader title={question ? 'The question' : 'Or type your own'} />
              <Card>
                <TextInput
                  value={question}
                  onChangeText={(text) => { setQuestion(text); setResult(null); }}
                  placeholder="Paste a question from a past paper or your notes…"
                  placeholderTextColor="#9AA0A6"
                  multiline
                  style={[styles.input, styles.questionInput]}
                />
              </Card>

              <SectionHeader title="Your answer" />
              <Card>
                <TextInput
                  value={answer}
                  onChangeText={setAnswer}
                  placeholder="Write the provision, the working and the conclusion…"
                  placeholderTextColor="#9AA0A6"
                  multiline
                  style={[styles.input, styles.answerInput]}
                />
                <Text style={styles.counter}>{answer.trim().split(/\s+/).filter(Boolean).length} words</Text>
              </Card>

              {/* Asked before the mark is revealed. That ordering is the whole
                  point: a confident wrong answer is the dangerous one. */}
              <SectionHeader title="How confident are you?" />
              <Card>
                <View style={styles.confRow}>
                  {CONFIDENCE.map((option) => {
                    const active = confidence === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => setConfidence(option.value)}
                        style={[styles.confTile, active && styles.confTileActive]}
                      >
                        <Text style={[styles.confLabel, active && { color: '#FFFFFF' }]}>
                          {option.value}
                        </Text>
                        <Text style={[styles.confHint, active && { color: '#E8EBFF' }]}>
                          {option.hint}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!confidence ? (
                  <Text style={styles.hint}>Tap one before the mark is revealed.</Text>
                ) : null}
              </Card>

              {error ? (
                <View style={styles.error}>
                  <Ionicons name="alert-circle-outline" size={16} color="#B3261E" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <PrimaryButton
                label={busy ? 'Marking…' : 'Get it marked'}
                icon="checkmark-done"
                loading={busy}
                disabled={!canSubmit}
                onPress={submit}
              />
              {busy ? (
                <View style={styles.marking}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.markingText}>
                    Marking strictly against the ICAI material…
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Card>
                <View style={styles.scoreRow}>
                  <View style={[styles.scoreBadge, { backgroundColor: VERDICT_TONE[result.verdict].bg }]}>
                    <Text style={[styles.scoreNumber, { color: VERDICT_TONE[result.verdict].fg }]}>
                      {result.score}
                    </Text>
                    <Text style={[styles.scoreOutOf, { color: VERDICT_TONE[result.verdict].fg }]}>/10</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.verdict, { color: VERDICT_TONE[result.verdict].fg }]}>
                      {result.verdict}
                    </Text>
                    <Text style={styles.scoreMeta}>
                      {result.accuracyPct}% · you said {confidence}
                    </Text>
                    {confidence === 'High' && result.score < PASS_MARK ? (
                      <Text style={styles.illusion}>
                        You felt certain but scored {result.score}. That gap is what to fix first.
                      </Text>
                    ) : null}
                    {confidence === 'Low' && result.score >= PASS_MARK ? (
                      <Text style={styles.illusionGood}>
                        You knew it better than you thought.
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Card>

              {result.strengths.length ? (
                <>
                  <SectionHeader title="What you got right" />
                  <Card><Bullets items={result.strengths} tone="#1B7F3B" /></Card>
                </>
              ) : null}

              {result.missingKeyPoints.length ? (
                <>
                  <SectionHeader title="What was missing" />
                  <Card><Bullets items={result.missingKeyPoints} tone="#9A6400" /></Card>
                </>
              ) : null}

              {result.conceptualMistakes.length ? (
                <>
                  <SectionHeader title="What was wrong" />
                  <Card><Bullets items={result.conceptualMistakes} tone="#B3261E" /></Card>
                </>
              ) : null}

              {missedKeywords(result).length ? (
                <>
                  <SectionHeader title="Terms the examiner looks for" />
                  <Card>
                    <View style={styles.chips}>
                      {result.keywordsExpected.map((k) => {
                        const used = result.keywordsPresent.some((p) => p.toLowerCase() === k.toLowerCase());
                        return (
                          <View key={k} style={[styles.chip, used ? styles.chipUsed : styles.chipMissed]}>
                            <Ionicons
                              name={used ? 'checkmark' : 'close'}
                              size={11}
                              color={used ? '#1B7F3B' : '#B3261E'}
                            />
                            <Text style={[styles.chipText, { color: used ? '#1B7F3B' : '#B3261E' }]}>{k}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </Card>
                </>
              ) : null}

              <SectionHeader title="Model answer" />
              <Card>
                <Text style={styles.modelAnswer}>{result.modelAnswer}</Text>
              </Card>

              {result.improvementAdvice.length ? (
                <>
                  <SectionHeader title="Next time" />
                  <Card><Bullets items={result.improvementAdvice} tone={colors.primary} /></Card>
                </>
              ) : null}

              <View style={styles.actions}>
                <PrimaryButton label="Answer another" icon="add" onPress={reset} style={{ flex: 1 }} />
                <PrimaryButton
                  label="Revision"
                  icon="refresh-circle-outline"
                  variant="secondary"
                  onPress={() => navigation.navigate('Main', { screen: 'Revision' })}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F7F8FA' },
  container: { padding: spacing.lg, paddingBottom: 56 },
  title: { fontSize: 28, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 13, color: '#8E8E93', marginTop: 4, marginBottom: spacing.lg },

  suggest: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  suggestSubject: { fontSize: 11, fontWeight: '700', color: colors.primary },
  suggestPrompt: { fontSize: 13, color: '#1C1C1E', marginTop: 3, lineHeight: 18 },

  input: {
    fontSize: 15,
    color: '#000',
    lineHeight: 22,
    padding: 0,
  },
  questionInput: { minHeight: 64 },
  answerInput: { minHeight: 170 },
  counter: { fontSize: 11, color: '#8E8E93', marginTop: 10, textAlign: 'right' },

  confRow: { flexDirection: 'row', gap: spacing.sm },
  confTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  confTileActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  confLabel: { fontSize: 14, fontWeight: '900', color: '#000' },
  confHint: { fontSize: 10, fontWeight: '700', color: '#8E8E93', marginTop: 2 },

  hint: { fontSize: 12, color: '#8E8E93', marginTop: 10 },

  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FDECEC',
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.md,
  },
  errorText: { flex: 1, fontSize: 12, color: '#B3261E', fontWeight: '700' },

  marking: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  markingText: { fontSize: 12, color: '#8E8E93' },

  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  scoreNumber: { fontSize: 30, fontWeight: '900' },
  scoreOutOf: { fontSize: 14, fontWeight: '800', marginLeft: 1 },
  verdict: { fontSize: 18, fontWeight: '900' },
  scoreMeta: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  illusion: { fontSize: 12, color: '#B3261E', fontWeight: '700', marginTop: 6, lineHeight: 17 },
  illusionGood: { fontSize: 12, color: '#1B7F3B', fontWeight: '700', marginTop: 6 },

  bullets: { gap: 8 },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bulletDot: { fontSize: 14, fontWeight: '900', lineHeight: 20, color: colors.primary },
  bulletText: { flex: 1, fontSize: 13, color: '#1C1C1E', lineHeight: 20 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  chipUsed: { backgroundColor: '#E7F6EC' },
  chipMissed: { backgroundColor: '#FDECEC' },
  chipText: { fontSize: 11, fontWeight: '800' },

  modelAnswer: { fontSize: 13, color: '#1C1C1E', lineHeight: 21 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
});
