import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, EmptyState, PrimaryButton } from '../components/ui';
import type { UploadedPaperTest } from '../data/uploadedTests';
const uploadedPaperTests: UploadedPaperTest[] = [];
import { addTestHistory } from '../services/testHistory';
import { syncTestHistorySoon } from '../services/testHistorySync';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

/**
 * Mentor-published question paper (batch-wise).
 * Student flow: View Question Paper → Submit Your Answer → answer key +
 * marking scheme unlock BELOW on the same screen → student checks his own
 * answer sheet, writes his marks (self evaluation) and submits, so the
 * mentor knows exactly what marks the student gave himself.
 */
type Submission = { at: string; note: string; marks?: number | null; marksAt?: string };

export const TestPaperScreen = () => {
  const { student } = useAuth();
  const route = useRoute<RouteProp<RootStackParamList, 'TestPaper'>>();
  const test = uploadedPaperTests.find((t) => t.id === route.params.testId);

  const [showPaper, setShowPaper] = useState(false);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState<Submission | null>(null);
  const [marksInput, setMarksInput] = useState('');
  const [marksError, setMarksError] = useState('');
  const [editingMarks, setEditingMarks] = useState(false);

  const key = `ump_paper_sub_${test?.id}`;
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw) as Submission;
          setSubmitted(parsed);
          if (parsed.marks != null) setMarksInput(String(parsed.marks));
        }
      } catch { /* fresh */ }
    })();
  }, [key]);

  if (!test) return <EmptyState icon="clipboard-outline" title="Test not found" message="The mentor will publish new tests soon." />;

  const save = async (rec: Submission) => {
    await AsyncStorage.setItem(key, JSON.stringify(rec)).catch(() => undefined);
    setSubmitted(rec);
  };

  const submitAnswer = async () => {
    const rec: Submission = { at: new Date().toISOString(), note: note.trim() };
    await save(rec);
    addTestHistory({
      id: `${test.id}-sub`,
      testId: test.id,
      kind: 'paper-test',
      title: test.title,
      subject: test.subject,
      at: rec.at,
      total: test.maxMarks,
      note: rec.note || undefined,
    });
    syncTestHistorySoon(student);
  };

  const submitMarks = async () => {
    if (!submitted) return;
    const value = parseFloat(marksInput.replace(',', '.'));
    if (Number.isNaN(value) || value < 0) {
      setMarksError('Enter the marks you obtained (0 or more).');
      return;
    }
    if (test.maxMarks && value > test.maxMarks) {
      setMarksError(`Marks cannot be more than ${test.maxMarks}.`);
      return;
    }
    setMarksError('');
    const marks = Math.round(value * 2) / 2; // allow half marks
    const rec: Submission = { ...submitted, marks, marksAt: new Date().toISOString() };
    await save(rec);
    setEditingMarks(false);
    addTestHistory({
      id: `${test.id}-sub`,
      testId: test.id,
      kind: 'paper-test',
      title: test.title,
      subject: test.subject,
      at: rec.marksAt as string,
      score: marks,
      total: test.maxMarks,
      selfMarks: true,
      note: submitted.note || undefined,
    });
    syncTestHistorySoon(student);
  };

  const marksDone = submitted?.marks != null && !editingMarks;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.meta}>
        <View style={styles.metaRow}>
          <View style={styles.iconBox}><Ionicons name="document-text" size={20} color={colors.primary} /></View>
          <View style={styles.metaCopy}>
            <Text style={styles.title}>{test.title}</Text>
            <Text style={styles.sub}>{test.subject}</Text>
          </View>
        </View>
        <View style={styles.chips}>
          <Text style={styles.chip}>{test.durationMin} min</Text>
          {test.maxMarks ? <Text style={styles.chip}>{test.maxMarks} marks</Text> : null}
          {test.batches.map((b) => <Text key={b} style={[styles.chip, styles.chipBatch]}>{b}</Text>)}
        </View>
        {test.note ? <Text style={styles.note}>📌 {test.note}</Text> : null}
      </Card>

      <View style={styles.actions}>
        <PrimaryButton label={showPaper ? 'Hide Question Paper' : 'View Question Paper'} icon="eye-outline" variant="secondary" onPress={() => setShowPaper((s) => !s)} style={{ flex: 1 }} />
        {submitted ? (
          <PrimaryButton label="Submitted ✓" disabled icon="checkmark-circle" onPress={() => undefined} style={{ flex: 1 }} />
        ) : (
          <PrimaryButton label="Submit Your Answer" icon="send" onPress={submitAnswer} style={{ flex: 1 }} />
        )}
      </View>

      {!submitted ? (
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Optional note for mentor (e.g. attempted all 4 questions)"
          placeholderTextColor={colors.muted}
          style={styles.noteInput}
        />
      ) : null}

      {!submitted ? (
        <Card style={styles.lockCard}>
          <Ionicons name="lock-closed" size={18} color={colors.amber} />
          <Text style={styles.lockText}>The answer key + marking scheme unlock below after you submit your answer.</Text>
        </Card>
      ) : null}

      {showPaper ? (
        <>
          <Text style={styles.sectionTitle}>Question Paper</Text>
          {test.paperPages.map((src: any, i: number) => (
            <Image key={i} source={src} style={styles.page} resizeMode="contain" />
          ))}
        </>
      ) : null}

      {submitted ? (
        <>
          <Card style={styles.doneCard}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.doneText}>Answer submitted {new Date(submitted.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.{submitted.note ? ` Note to mentor: "${submitted.note}"` : ''}</Text>
          </Card>

          {/* Self evaluation — student checks his answer sheet with the key +
              marking scheme below, writes his marks and submits to the mentor. */}
          <Card style={marksDone ? styles.marksCardDone : styles.marksCard}>
            <View style={styles.marksHead}>
              <Ionicons name="create-outline" size={18} color={marksDone ? colors.success : colors.purple} />
              <Text style={styles.marksTitle}>Self Evaluation</Text>
              {marksDone ? <Text style={styles.marksBadge}>Sent to mentor</Text> : null}
            </View>
            {marksDone ? (
              <>
                <Text style={styles.marksBig}>{submitted.marks}{test.maxMarks ? ` / ${test.maxMarks}` : ''} marks</Text>
                <Text style={styles.marksSub}>
                  Submitted {new Date(submitted.marksAt || submitted.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Your mentor can see the marks you gave yourself.
                </Text>
                <PrimaryButton label="Update Marks" icon="refresh" variant="secondary" onPress={() => { setEditingMarks(true); setMarksInput(String(submitted.marks ?? '')); }} />
              </>
            ) : (
              <>
                <Text style={styles.marksSub}>
                  Check your answer sheet with the answer key and marking scheme below, then write the marks you obtained. Your mentor will see your self-evaluated marks.
                </Text>
                <View style={styles.marksInputRow}>
                  <TextInput
                    value={marksInput}
                    onChangeText={(t) => { setMarksInput(t); setMarksError(''); }}
                    placeholder={test.maxMarks ? `Marks obtained (out of ${test.maxMarks})` : 'Marks obtained'}
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={styles.marksInput}
                  />
                  <PrimaryButton label="Submit Marks" icon="send" onPress={submitMarks} />
                </View>
                {marksError ? <Text style={styles.marksError}>{marksError}</Text> : null}
              </>
            )}
          </Card>

          {test.answerKeyPages.length ? (
            <>
              <Text style={styles.sectionTitle}>Answer Key</Text>
              {test.answerKeyPages.map((src: any, i: number) => (
                <Image key={i} source={src} style={styles.page} resizeMode="contain" />
              ))}
            </>
          ) : null}

          {test.markingSchemePages.length ? (
            <>
              <Text style={styles.sectionTitle}>Marking Scheme</Text>
              {test.markingSchemePages.map((src: any, i: number) => (
                <Image key={i} source={src} style={styles.page} resizeMode="contain" />
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: 60, gap: spacing.md },
  meta: { padding: spacing.md, gap: 8 },
  metaRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  iconBox: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  metaCopy: { flex: 1 },
  title: { fontSize: 15, fontWeight: '900', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: { fontSize: 10.5, fontWeight: '800', color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  chipBatch: { color: colors.purple, backgroundColor: colors.purpleSoft },
  note: { fontSize: 12, color: colors.inkSoft, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 8 },
  lockCard: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.amberSoft, borderColor: colors.amber, padding: spacing.md },
  noteInput: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 10, fontSize: 13, color: colors.ink },
  lockText: { flex: 1, fontSize: 12, color: colors.ink, lineHeight: 17 },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: colors.ink, marginTop: spacing.xs },
  page: { width: '100%', aspectRatio: 1 / 1.35, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', marginBottom: spacing.md },
  doneCard: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.tealSoft, borderColor: colors.teal, padding: spacing.md },
  doneText: { flex: 1, fontSize: 12, color: colors.ink, lineHeight: 17 },
  marksCard: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.purpleSoft, borderColor: colors.purple },
  marksCardDone: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.tealSoft, borderColor: colors.teal },
  marksHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  marksTitle: { flex: 1, fontSize: 13.5, fontWeight: '900', color: colors.ink },
  marksBadge: { fontSize: 9, fontWeight: '900', color: colors.success, backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  marksBig: { fontSize: 24, fontWeight: '900', color: colors.ink },
  marksSub: { fontSize: 11.5, color: colors.inkSoft, lineHeight: 16 },
  marksInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  marksInput: { flex: 1, minWidth: 130, backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 10, fontSize: 13.5, color: colors.ink },
  marksError: { fontSize: 11, color: colors.red, fontWeight: '700' },
});
