import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, EmptyState, ErrorBanner, SectionHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { listMentorTests, type MentorTest } from '../services/mentorTests';
import { colors, radius, spacing } from '../theme';

/**
 * v1.15.0 - native Mentor Tests list (WebView portal removed).
 * Shows every test published for the student's batch/group (server-side
 * matches_target), no daily-target gate - parity with the web flow.
 */
export const TestsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { student, backendMode } = useAuth();
  const [tests, setTests] = useState<MentorTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const list = await listMentorTests();
      setTests(list);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tests.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (backendMode === 'live') void load();
    else {
      setLoading(false);
      setTests([]);
    }
  }, [backendMode, student?.studentId, load]);

  const statusOf = (t: MentorTest): { label: string; tone: string } => {
    if (t.attempted && t.lastScore != null) return { label: `✅ Evaluated · ${t.lastScore}/${t.lastTotal ?? t.maxMarks ?? '?'}`, tone: colors.teal };
    if (t.attempted) return { label: '📤 Uploaded · self-eval pending', tone: colors.amber };
    return { label: '📄 Open', tone: colors.primary };
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>Tests</Text>
        <Text style={styles.subtitle}>Mentor tests — solve, upload, self-evaluate, submit marks</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
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

<Pressable onPress={() => navigation.navigate('Workbooks')}><Card style={styles.testCard}><Text style={styles.title}>Audit & SM workbooks</Text><Text>Type or write in the app. Get meaning-based model-answer feedback.</Text></Card></Pressable>
        <SectionHeader title="Mentor tests" />
        {error ? (
          <ErrorBanner message={error} onRetry={() => void load()} />
        ) : loading ? (
          <Card style={styles.testCard}><Text style={styles.testMeta}>Loading mentor tests…</Text></Card>
        ) : tests.length === 0 ? (
          <EmptyState icon="document-text-outline" title="No tests yet" message="Tests published by your mentor for your batch and group will appear here." />
        ) : (
          tests.map((t) => {
            const st = statusOf(t);
            return (
              <Pressable key={t.id} onPress={() => navigation.navigate('MentorTest', { testId: t.testId || t.id })}>
                <Card style={styles.testCard}>
                  <View style={styles.testRow}>
                    <View style={styles.testIconBox}><Ionicons name="document-text" size={20} color={colors.primary} /></View>
                    <View style={styles.testCopy}>
                      <Text style={styles.testTitle} numberOfLines={2}>{t.title}</Text>
                      <Text style={styles.testMeta} numberOfLines={1}>
                        {[t.subject, t.batch, t.group, t.maxMarks ? `${t.maxMarks} marks` : null].filter(Boolean).join(' · ') || 'Paper test'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </View>
                  <View style={[styles.statusChip, { backgroundColor: st.tone + '22' }]}>
                    <Text style={[styles.statusText, { color: st.tone }]}>{st.label}</Text>
                  </View>
                </Card>
              </Pressable>
            );
          })
        )}

        <SectionHeader title="Practice" />
        {(
          [
            ['flame', 'Daily MCQ Challenge', '10 questions for today — do them daily', colors.amber, colors.amberSoft, () => navigation.navigate('DailyMcq')],
            ['trophy', 'Leaderboard', 'Ranked on your test marks and Daily MCQ score', colors.teal, colors.tealSoft, () => navigation.navigate('Leaderboard')],
          ] as Array<[keyof typeof Ionicons.glyphMap, string, string, string, string, () => void]>
        ).map(([icon, title, sub, tint, soft, go]) => (
          <Pressable key={title} onPress={go}>
            <Card style={styles.row}>
              <View style={[styles.iconBox, { backgroundColor: soft }]}><Ionicons name={icon} size={22} color={tint} /></View>
              <View style={styles.testCopy}>
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
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md },
  title: { color: colors.ink, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  weekCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.ink, padding: spacing.lg, marginBottom: spacing.lg },
  weekIconBox: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  weekTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  weekSub: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 2 },
  testCard: { padding: spacing.lg, marginBottom: spacing.md },
  testRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  testIconBox: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  testCopy: { flex: 1 },
  testTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  testMeta: { color: colors.muted, fontSize: 10, marginTop: 2 },
  statusChip: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3, marginTop: spacing.sm },
  statusText: { fontSize: 9, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.md },
  iconBox: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  rowSub: { color: colors.muted, fontSize: 10, marginTop: 2 },
});
