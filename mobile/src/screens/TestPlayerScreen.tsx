import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, EmptyState, PrimaryButton } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import type { UploadedTest } from '../data/uploadedTests';
const uploadedTests: UploadedTest[] = [];
import { setLastTestResult } from '../services/lastTestResult';
import { addTestHistory } from '../services/testHistory';
import { syncTestHistorySoon } from '../services/testHistorySync';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing } from '../theme';

/**
 * Mentor-uploaded test player. The test + answer key + marking scheme are
 * created by the mentor (redesign/tests/*.json) — NOT AI generated.
 * Instant answer key + marking scheme after submit (TestResultScreen).
 */
export const TestPlayerScreen = () => {
  const { student } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'TestPlayer'>>();
  const test = uploadedTests.find((t) => t.id === route.params.testId);

  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});

  if (!test) return <EmptyState icon="clipboard-outline" title="Test not found" message="The mentor will upload new tests soon." />;

  const q = test.questions[index];
  const answered = Object.values(answers).filter(Boolean).length;

  const pick = (optId: string) => {
    setChosen(optId);
    setAnswers((prev) => ({ ...prev, [q.id]: optId }));
  };

  const submit = () => {
    const neg = test.negativeMarks ?? 0;
    let obtained = 0;
    const rows = test.questions.map((qq) => {
      const pickId = answers[qq.id] || null;
      const correct = pickId === qq.correctOptionId;
      if (correct) obtained += qq.marks;
      else if (pickId && neg > 0) obtained -= neg;
      return { question: { id: qq.id, prompt: qq.prompt, options: qq.options, correctOptionId: qq.correctOptionId, explanation: qq.explanation, difficulty: 'moderate' as const }, chosenOptionId: pickId, correct };
    });
    obtained = Math.max(0, obtained);
    const resultId = `${test.id}-${Date.now()}`;
    addTestHistory({
      id: resultId,
      testId: test.id,
      kind: 'mcq-test',
      title: test.title,
      subject: test.subject,
      at: new Date().toISOString(),
      score: obtained,
      total: test.maxMarks,
      scorePct: Math.round((obtained / test.maxMarks) * 100),
    });
    syncTestHistorySoon(student);
    setLastTestResult({
      id: resultId,
      chapterId: test.id,
      chapterTitle: test.title,
      mode: 'test',
      finishedAt: new Date().toISOString(),
      mcq: rows,
      short: [],
      scorePct: Math.round((obtained / test.maxMarks) * 100),
      testMeta: { title: test.title, subject: test.subject, chapter: test.chapter, maxMarks: test.maxMarks, obtainedMarks: obtained, markingScheme: test.markingScheme, durationMin: test.durationMin },
    });
    navigation.replace('TestResult', { resultId });
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.meta}>
        <View style={styles.metaRow}>
          <Ionicons name="clipboard" size={18} color={colors.primary} />
          <Text style={styles.metaTitle}>{test.title}</Text>
        </View>
        <Text style={styles.metaSub}>{test.subject} · {test.chapter}</Text>
        <View style={styles.metaChips}>
          <Text style={styles.chip}>{test.maxMarks} marks</Text>
          <Text style={styles.chip}>{test.durationMin} min</Text>
          <Text style={styles.chip}>{test.questions.length} questions</Text>
          {test.negativeMarks ? <Text style={[styles.chip, { color: colors.red }]}>-{test.negativeMarks} negative</Text> : null}
        </View>
        <View style={styles.prog}><View style={[styles.progFill, { width: `${(answered / test.questions.length) * 100}%` }]} /></View>
        <Text style={styles.progText}>{answered}/{test.questions.length} answered</Text>
      </Card>

      <Text style={styles.kicker}>Question {index + 1}/{test.questions.length}</Text>
      <Card style={styles.qCard}><Text style={styles.qText}>{q.prompt}</Text></Card>
      {q.options.map((opt) => (
        <Pressable key={opt.id} onPress={() => pick(opt.id)} style={[styles.opt, answers[q.id] === opt.id && styles.optSel]}>
          <View style={[styles.optBadge, answers[q.id] === opt.id && styles.optBadgeSel]}>
            <Text style={[styles.optBadgeText, answers[q.id] === opt.id && { color: '#fff' }]}>{opt.id}</Text>
          </View>
          <Text style={styles.optText}>{opt.text}</Text>
        </Pressable>
      ))}

      <View style={styles.navRow}>
        <PrimaryButton label="← Prev" variant="secondary" disabled={index === 0} onPress={() => { setIndex(index - 1); setChosen(answers[test.questions[index - 1].id] || null); }} style={{ flex: 1 }} />
        {index + 1 < test.questions.length ? (
          <PrimaryButton label="Next →" onPress={() => { setIndex(index + 1); setChosen(answers[test.questions[index + 1].id] || null); }} style={{ flex: 1 }} icon="arrow-forward" />
        ) : (
          <PrimaryButton label="Submit ✓" onPress={submit} style={{ flex: 1 }} disabled={answered === 0} />
        )}
      </View>
      {index + 1 === test.questions.length && answered < test.questions.length ? (
        <Text style={styles.warn}>⚠️ {test.questions.length - answered} questions are unanswered — they score 0 on submit.</Text>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: 60, gap: spacing.sm },
  meta: { padding: spacing.md, gap: 6 },
  metaRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  metaTitle: { fontSize: 14.5, fontWeight: '900', color: colors.ink, flex: 1 },
  metaSub: { fontSize: 11.5, color: colors.muted },
  metaChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  chip: { fontSize: 10.5, fontWeight: '800', color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  prog: { height: 6, borderRadius: 999, backgroundColor: colors.canvas, overflow: 'hidden', marginTop: 4 },
  progFill: { height: 6, borderRadius: 999, backgroundColor: colors.primary },
  progText: { fontSize: 10.5, fontWeight: '800', color: colors.muted },
  kicker: { fontSize: 12, fontWeight: '900', color: colors.inkSoft, marginTop: spacing.xs },
  qCard: { padding: spacing.md },
  qText: { fontSize: 14, fontWeight: '700', color: colors.ink, lineHeight: 21 },
  opt: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, padding: spacing.md },
  optSel: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optBadge: { width: 26, height: 26, borderRadius: 8, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  optBadgeSel: { backgroundColor: colors.primary },
  optBadgeText: { fontSize: 12, fontWeight: '800', color: colors.inkSoft },
  optText: { flex: 1, fontSize: 13, color: colors.ink, lineHeight: 19 },
  navRow: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
  warn: { fontSize: 11.5, color: colors.amber, fontWeight: '700', textAlign: 'center' },
});
