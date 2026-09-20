import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, EmptyState } from '../components/ui';
import { getLastTestResult } from '../services/lastTestResult';
import { colors, radius, spacing } from '../theme';

/**
 * Reform policy item 6: "All test submitted on app and they will get answer
 * key immediately on app with marking scheme."
 */
export const TestResultScreen = () => {
  const result = getLastTestResult();

  if (!result) {
    return <EmptyState icon="clipboard-outline" title="No result yet" message="Submit a test and the answer key with marking scheme will appear here." />;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.scoreCard}>
        <View style={styles.scoreRow}>
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreBadgeText}>{result.scorePct == null ? '—' : `${result.scorePct}%`}</Text>
          </View>
          <View style={styles.scoreCopy}>
            <Text style={styles.scoreTitle}>{result.chapterTitle}</Text>
            <Text style={styles.scoreMeta}>
              {result.testMeta ? `Mentor Test · ${result.testMeta.obtainedMarks}/${result.testMeta.maxMarks} marks` : result.mode === 'test' ? 'Chapter Test' : 'AI Quiz'}
              {' · '}{new Date(result.finishedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>
        {result.testMeta ? (
          <View style={styles.schemeBox}>
            <Text style={styles.schemeTitle}>📐 Marking Scheme (mentor)</Text>
            <Text style={styles.schemeText}>{result.testMeta.markingScheme}</Text>
          </View>
        ) : null}
      </Card>

      <Text style={styles.sectionTitle}>Answer Key</Text>
      {result.mcq.map((row, i) => (
        <Card key={i} style={styles.keyCard}>
          <View style={styles.keyHead}>
            <Text style={styles.keyIndex}>Q{i + 1}</Text>
            <Ionicons
              name={row.correct === true ? 'checkmark-circle' : row.correct === false ? 'close-circle' : 'help-circle'}
              size={18}
              color={row.correct === true ? colors.success : row.correct === false ? colors.red : colors.amber}
            />
          </View>
          <Text style={styles.keyQuestion}>{row.question.prompt}</Text>
          <View style={styles.keyRow}>
            <Text style={styles.keyLabel}>Your answer:</Text>
            <Text style={styles.keyValue}>{row.chosenOptionId || '—'}</Text>
            <Text style={[styles.keyLabel, { marginLeft: 14 }]}>Correct:</Text>
            <Text style={[styles.keyValue, { color: colors.success }]}>{row.question.correctOptionId || '—'}</Text>
          </View>
          {row.question.explanation ? (
            <View style={styles.explainBox}>
              <Text style={styles.explainText}>{row.question.explanation}</Text>
            </View>
          ) : null}
        </Card>
      ))}

      {result.short.length ? (
        <>
          <Text style={styles.sectionTitle}>Short Answers · Marking Scheme</Text>
          {result.short.map((row, i) => (
            <Card key={`s${i}`} style={styles.keyCard}>
              <Text style={styles.keyQuestion}>{row.prompt}</Text>
              <Text style={styles.yourAnswer}>Your answer: {row.answer}</Text>
              {row.result ? (
                <View style={styles.explainBox}>
                  <Text style={styles.explainText}>Score {row.result.score}/5</Text>
                  {row.result.covered.length ? <Text style={styles.explainText}>✅ {row.result.covered.join(' · ')}</Text> : null}
                  {row.result.missed.length ? <Text style={styles.explainText}>❌ {row.result.missed.join(' · ')}</Text> : null}
                  <Text style={styles.explainText}>Marking scheme: {row.result.modelAnswer}</Text>
                </View>
              ) : (
                <Text style={styles.pendingText}>AI evaluation pending — the score appears after mentor review.</Text>
              )}
            </Card>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: 60, gap: spacing.md },
  scoreCard: { padding: spacing.lg },
  scoreRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  scoreBadge: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  scoreBadgeText: { color: '#fff', fontSize: 17, fontWeight: '900' },
  scoreCopy: { flex: 1 },
  scoreTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  scoreMeta: { fontSize: 12, color: colors.muted, marginTop: 3 },
  schemeBox: { marginTop: 10, backgroundColor: colors.amberSoft, borderRadius: 10, padding: spacing.sm, gap: 3 },
  schemeTitle: { fontSize: 12, fontWeight: '900', color: colors.ink },
  schemeText: { fontSize: 12, color: colors.inkSoft, lineHeight: 17 },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: colors.ink, marginTop: spacing.sm },
  keyCard: { padding: spacing.md, gap: 8 },
  keyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  keyIndex: { fontSize: 12, fontWeight: '900', color: colors.primary },
  keyQuestion: { fontSize: 13.5, fontWeight: '700', color: colors.ink, lineHeight: 20 },
  keyRow: { flexDirection: 'row', alignItems: 'center' },
  keyLabel: { fontSize: 12, color: colors.muted },
  keyValue: { fontSize: 12.5, fontWeight: '900', color: colors.ink, marginLeft: 4 },
  explainBox: { backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: spacing.sm, gap: 3 },
  explainText: { fontSize: 12, color: colors.inkSoft, lineHeight: 17 },
  yourAnswer: { fontSize: 12.5, color: colors.inkSoft, lineHeight: 18 },
  pendingText: { fontSize: 12, color: colors.amber, fontWeight: '700' },
});
