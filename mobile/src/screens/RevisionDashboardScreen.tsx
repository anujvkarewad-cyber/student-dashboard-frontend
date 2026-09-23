import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, SectionHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import {
  accuracyOf,
  buildInsights,
  buildRevisionPlan,
  MISTAKE_LABEL,
  type ConceptStat,
} from '../services/adaptiveEngine';
import { conceptList, loadState, type AdaptiveState } from '../services/adaptiveStore';
import { colors, radius, spacing } from '../theme';

const strengthTone = (s: ConceptStat): { label: string; bg: string; fg: string } => {
  if (s.unseen) return { label: 'Not started', bg: '#F2F2F7', fg: '#8E8E93' };
  if (s.strength === 'strong') return { label: 'Strong', bg: '#E7F6EC', fg: '#1B7F3B' };
  if (s.strength === 'medium') return { label: 'Medium', bg: '#FFF4E0', fg: '#9A6400' };
  return { label: 'Weak', bg: '#FDECEC', fg: '#B3261E' };
};

const daysUntil = (dueAt: number) => {
  const diff = dueAt - Date.now();
  if (diff <= 0) return 'due now';
  const d = Math.ceil(diff / 86400000);
  return d === 1 ? 'tomorrow' : `in ${d} days`;
};

const ConceptRow = ({ stat }: { stat: ConceptStat }) => {
  const tone = strengthTone(stat);
  const acc = Math.round(accuracyOf(stat));
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{stat.concept}</Text>
        <Text style={styles.rowSub}>
          {stat.unseen
            ? 'Not attempted yet'
            : `${acc}% correct · ${stat.attempts} attempt${stat.attempts === 1 ? '' : 's'} · ${daysUntil(stat.dueAt)}`}
        </Text>
      </View>
      <View style={[styles.pill, { backgroundColor: tone.bg }]}>
        <Text style={[styles.pillText, { color: tone.fg }]}>{tone.label}</Text>
      </View>
    </View>
  );
};

const Stat = ({ value, label, tone }: { value: string; label: string; tone?: string }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

export const RevisionDashboardScreen = () => {
  const { student } = useAuth();
  const navigation = useNavigation<any>();
  const [state, setState] = useState<AdaptiveState | null>(null);

  const load = useCallback(async () => {
    if (!student) return;
    setState(await loadState(student.studentId));
  }, [student]);

  useEffect(() => {
    load();
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [load, navigation]);

  const concepts = useMemo(() => (state ? conceptList(state) : []), [state]);
  const plan = useMemo(() => buildRevisionPlan(concepts), [concepts]);
  const insights = useMemo(() => buildInsights(concepts), [concepts]);

  if (!student) return null;

  if (!state) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const nothingYet = concepts.length === 0;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Revision</Text>
        <Text style={styles.subtitle}>
          Built from what you actually got right and wrong, not from a timetable.
        </Text>

        {nothingYet ? (
          <Card>
            <Text style={styles.emptyTitle}>Nothing to revise yet</Text>
            <Text style={styles.emptyBody}>
              Answer a few practice questions and this screen fills itself in — your weak
              concepts, what is due today, and what keeps slipping.
            </Text>
            <View style={styles.ctaRow}>
              <Pressable style={styles.cta} onPress={() => navigation.navigate('McqPractice')}>
                <Text style={styles.ctaText}>Practise MCQs</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </Pressable>
              <Pressable style={[styles.cta, styles.ctaAlt]} onPress={() => navigation.navigate('WrittenAnswer')}>
                <Text style={[styles.ctaText, { color: '#000' }]}>Write an answer</Text>
              </Pressable>
            </View>
          </Card>
        ) : (
          <>
            {/* --- headline numbers --- */}
            <Card>
              <View style={styles.statRow}>
                <Stat value={String(plan.counts.overdue)} label="Overdue" tone={plan.counts.overdue ? '#B3261E' : undefined} />
                <Stat value={String(plan.counts.today)} label="Due today" />
                <Stat value={`${insights.overallAccuracy}%`} label="Accuracy" />
                <Stat value={`${insights.consistency}%`} label="Consistency" />
              </View>
            </Card>

            {/* --- overdue first: the shortest loops are the ones about to be forgotten --- */}
            {plan.overdue.length > 0 ? (
              <>
                <SectionHeader title="Overdue — revise now" />
                <Card>
                  {plan.overdue.slice(0, 6).map((s) => (
                    <ConceptRow key={s.concept} stat={s} />
                  ))}
                  {plan.overdue.length > 6 ? (
                    <Text style={styles.more}>+{plan.overdue.length - 6} more overdue</Text>
                  ) : null}
                </Card>
              </>
            ) : null}

            <SectionHeader title="Due today" />
            <Card>
              {plan.today.length === 0 ? (
                <Text style={styles.emptyInline}>
                  Nothing falls due today. Your next revision is {plan.weak.length} weak concept
                  {plan.weak.length === 1 ? '' : 's'} away — pick one and keep the streak alive.
                </Text>
              ) : (
                plan.today.slice(0, 6).map((s) => <ConceptRow key={s.concept} stat={s} />)
              )}
            </Card>

            <SectionHeader title="Weak concepts" />
            <Card>
              {plan.weak.slice(0, 6).map((s) => (
                <ConceptRow key={s.concept} stat={s} />
              ))}
            </Card>

            {/* --- insights --- */}
            <Pressable style={styles.writeRow} onPress={() => navigation.navigate('WrittenAnswer')}>
              <Ionicons name="create-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.writeTitle}>Write a full answer</Text>
                <Text style={styles.writeSub}>Get it marked strictly, like an examiner would</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
            </Pressable>

            <SectionHeader title="Your pattern" />
            <Card>
              <Text style={styles.insightLead}>
                {insights.consistency >= 70
                  ? 'You are consistent — that matters more than any single score.'
                  : insights.consistency >= 40
                    ? 'Your study is patchy. Consistency is what moves accuracy.'
                    : 'You are studying in bursts. Short daily sessions beat long gaps.'}
              </Text>

              {insights.topMistake ? (
                <Text style={styles.insightLine}>
                  Biggest cause of lost marks:{' '}
                  <Text style={styles.insightStrong}>
                    {MISTAKE_LABEL[insights.topMistake.type]}
                  </Text>{' '}
                  ({insights.topMistake.count} time{insights.topMistake.count === 1 ? '' : 's'})
                </Text>
              ) : null}

              {insights.topWeak.length > 0 ? (
                <Text style={styles.insightLine}>
                  Needs the most work:{' '}
                  <Text style={styles.insightStrong}>
                    {insights.topWeak.slice(0, 3).map((s) => s.concept).join(', ')}
                  </Text>
                </Text>
              ) : null}

              <View style={styles.spark}>
                {insights.trend.map((point) => (
                  <View key={point.day} style={styles.sparkCol}>
                    <View
                      style={[
                        styles.sparkBar,
                        {
                          height: Math.max(3, (point.accuracy / 100) * 44),
                          backgroundColor: point.answered ? colors.primary : '#E5E5EA',
                        },
                      ]}
                    />
                  </View>
                ))}
              </View>
              <Text style={styles.sparkLabel}>Accuracy, last 14 days</Text>
              <Text style={styles.tracked}>{insights.totalAttempts} questions tracked</Text>
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  ctaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 14, flexWrap: 'wrap' },
  ctaAlt: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D1D6' },
  writeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  writeTitle: { fontSize: 14, fontWeight: '800', color: '#000' },
  writeSub: { fontSize: 11, color: '#8E8E93', marginTop: 2 },
  flex: { flex: 1, backgroundColor: '#F7F8FA' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F8FA' },
  container: { padding: spacing.lg, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 13, color: '#8E8E93', marginTop: 4, marginBottom: spacing.lg },

  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 20, fontWeight: '700', color: '#000' },
  statLabel: { fontSize: 11, color: '#8E8E93', marginTop: 2 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#000' },
  rowSub: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '700' },
  more: { fontSize: 12, color: '#8E8E93', marginTop: 8 },

  insightLead: { fontSize: 14, color: '#000', fontWeight: '600', marginBottom: 10 },
  insightLine: { fontSize: 13, color: '#3C3C43', marginBottom: 6, lineHeight: 19 },
  insightStrong: { fontWeight: '700', color: '#000' },

  spark: { flexDirection: 'row', alignItems: 'flex-end', height: 46, marginTop: 14, gap: 3 },
  sparkCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sparkBar: { width: '100%', borderRadius: 3 },
  sparkLabel: { fontSize: 11, color: '#8E8E93', marginTop: 6, marginBottom: 4 },
  tracked: { fontSize: 12, color: '#8E8E93' },

  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#000' },
  emptyBody: { fontSize: 13, color: '#3C3C43', lineHeight: 19, marginTop: 6 },
  emptyInline: { fontSize: 13, color: '#3C3C43', lineHeight: 19 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#000',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  ctaText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
