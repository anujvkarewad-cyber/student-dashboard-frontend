import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, SectionHeader } from '../components/ui';
import { uploadedPaperTests, uploadedTests } from '../data/uploadedTests';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

/**
 * Reform policy: all tests live on the app; instant answer key +
 * marking scheme after submit. Tests are created and uploaded by the
 * MENTOR (redesign/tests/*.json) — not AI generated.
 */
export const TestsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { student } = useAuth();
  const batch = String(student?.batch || '');
  const visible = (batches: string[]) =>
    batch === 'ALL' || Boolean((student as any)?.master) || batches.includes('All Batches') || (batch !== '' && batches.includes(batch));
  const myPaper = uploadedPaperTests.filter((x) => visible(x.batches));
  const myMcq = uploadedTests.filter((x) => visible((x as any).batches || ['All Batches']));

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>Tests</Text>
        <Text style={styles.subtitle}>Mentor's tests — instant answer key + marking scheme after submit</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Weekly Report — this week's full record: study hours, tests given, MCQ report */}
        <Pressable onPress={() => navigation.navigate('WeeklyReport')}>
          <Card style={styles.weekCard}>
            <View style={styles.weekIconBox}><Ionicons name="calendar" size={22} color="#fff" /></View>
            <View style={styles.testCopy}>
              <Text style={styles.weekTitle}>Weekly Report</Text>
              <Text style={styles.weekSub}>This week's record — study hours, tests you gave, MCQ report</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.85)" />
          </Card>
        </Pressable>

        <SectionHeader title={`Mentor Tests${batch ? ` · ${batch}` : ''}`} />
        {myPaper.map((t) => (
          <Pressable key={t.id} onPress={() => navigation.navigate('TestPaper', { testId: t.id })}>
            <Card style={styles.testCard}>
              <View style={styles.testIconBox}><Ionicons name="newspaper-outline" size={20} color={colors.purple} /></View>
              <View style={styles.testCopy}>
                <Text style={styles.testTitle}>{t.title}</Text>
                <Text style={styles.testMeta}>{t.subject} · {t.durationMin} min{t.maxMarks ? ` · ${t.maxMarks} marks` : ''}</Text>
                <View style={styles.testChips}>
                  {t.batches.map((b) => <Text key={b} style={[styles.testChip, { color: colors.purple, backgroundColor: colors.purpleSoft }]}>{b}</Text>)}
                  <Text style={[styles.testChip, { color: colors.success }]}>Answer key ✓</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        ))}
        {myMcq.length ? myMcq.map((t) => (
          <Pressable key={t.id} onPress={() => navigation.navigate('TestPlayer', { testId: t.id })}>
            <Card style={styles.testCard}>
              <View style={styles.testIconBox}><Ionicons name="document-text" size={20} color={colors.primary} /></View>
              <View style={styles.testCopy}>
                <Text style={styles.testTitle}>{t.title}</Text>
                <Text style={styles.testMeta}>{t.subject} · {t.chapter}</Text>
                <View style={styles.testChips}>
                  <Text style={styles.testChip}>{t.questions.length} questions</Text>
                  <Text style={styles.testChip}>{t.maxMarks} marks</Text>
                  <Text style={styles.testChip}>{t.durationMin} min</Text>
                  <Text style={[styles.testChip, { color: colors.success }]}>Answer key ✓</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        )) : null}
        {!myPaper.length && !myMcq.length ? (
          <Card style={styles.testCard}><Text style={styles.testMeta}>No tests published for your batch yet.</Text></Card>
        ) : null}

        <SectionHeader title="Practice" />
        {([
          ['flame', 'Daily MCQ Challenge', '10 questions for today — do them daily', colors.amber, colors.amberSoft, () => navigation.navigate('DailyMcq')],
          ['barbell', 'Unlimited MCQ Practice', 'Chapter / difficulty wise practice', colors.primary, colors.primarySoft, () => navigation.navigate('McqPractice')],
          ['trophy', 'Leaderboard', 'See your rank in the batch', colors.teal, colors.tealSoft, () => navigation.navigate('Leaderboard')],
          ['document-text', 'Mentor Weekly Summary', 'Progress, streak and rank from your mentor', colors.success, colors.tealSoft, () => navigation.navigate('Reports')],
        ] as Array<[keyof typeof Ionicons.glyphMap, string, string, string, string, () => void]>).map(([icon, title, sub, tint, soft, go]) => (
          <Pressable key={title} onPress={go}>
            <Card style={styles.row}>
              <View style={[styles.iconBox, { backgroundColor: soft }]}><Ionicons name={icon} size={22} color={tint} /></View>
              <View style={styles.copy}>
                <Text style={styles.rowTitle}>{title}</Text>
                <Text style={styles.rowSub}>{sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingTop: 56, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  title: { fontSize: 26, fontWeight: '900', color: colors.ink },
  subtitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 110, gap: spacing.sm },
  testCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: spacing.sm },
  testIconBox: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  weekCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: spacing.md, backgroundColor: colors.primary, borderColor: colors.primaryDark },
  weekIconBox: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  testCopy: { flex: 1 },
  testTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  testMeta: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  weekTitle: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  weekSub: { fontSize: 11.5, color: 'rgba(255,255,255,0.88)', marginTop: 2, lineHeight: 16 },
  testChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  testChip: { fontSize: 10, fontWeight: '800', color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: spacing.sm },
  iconBox: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  rowTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
