import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/ui';
import { useData } from '../context/DataContext';
import { colors, radius, spacing } from '../theme';

const format = (value?: number) => value == null ? '—' : Number(value).toFixed(1).replace('.0', '');

export const ReportsScreen = () => {
  const { data, refreshing, refreshReports } = useData();
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={data.reports}
        keyExtractor={(item, index) => `${item.weekOf}-${index}`}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshReports().catch(() => undefined)} colors={[colors.primary]} />}
        ListHeaderComponent={
          <View style={styles.intro}>
            <View style={styles.introIcon}><Ionicons name="analytics" size={27} color={colors.primary} /></View>
            <View style={styles.introBody}><Text style={styles.introTitle}>Your weekly story</Text><Text style={styles.introText}>A simple view of effort, consistency and cohort position across each week.</Text></View>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={styles.report}>
            <View style={styles.timeline}>
              <View style={[styles.timelineDot, index === 0 && styles.latestDot]} />
              {index < data.reports.length - 1 ? <View style={styles.timelineLine} /> : null}
            </View>
            <View style={styles.reportCard}>
              <View style={styles.reportTop}>
                <View><Text style={styles.weekLabel}>WEEK OF</Text><Text style={styles.week}>{item.weekOf}</Text></View>
                <View style={[styles.level, item.level === 'Excellent' && styles.excellent]}><Text style={[styles.levelText, item.level === 'Excellent' && styles.excellentText]}>{item.level || 'Progressing'}</Text></View>
              </View>
              <View style={styles.stats}>
                <View style={styles.stat}><Ionicons name="time-outline" size={18} color={colors.primary} /><Text style={styles.statValue}>{format(item.weeklyHours)}h</Text><Text style={styles.statLabel}>HOURS</Text></View>
                <View style={styles.statDivider} />
                <View style={styles.stat}><Ionicons name="flame-outline" size={18} color={colors.amber} /><Text style={styles.statValue}>{item.streak || 0}</Text><Text style={styles.statLabel}>STREAK</Text></View>
                <View style={styles.statDivider} />
                <View style={styles.stat}><Ionicons name="trophy-outline" size={18} color={colors.purple} /><Text style={styles.statValue}>#{item.rank || '—'}</Text><Text style={styles.statLabel}>RANK</Text></View>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={<EmptyState icon="calendar-outline" title="No reports yet" message="Your weekly mentorship reports will appear here." />}
        ListFooterComponent={<View style={{ height: 30 }} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg },
  intro: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.xxl },
  introIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  introBody: { flex: 1 },
  introTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  introText: { color: colors.inkSoft, fontSize: 11, lineHeight: 17, marginTop: 4 },
  report: { flexDirection: 'row' },
  timeline: { width: 27, alignItems: 'center' },
  timelineDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#B8C4D6', marginTop: 23, zIndex: 2, borderWidth: 2, borderColor: colors.canvas },
  latestDot: { backgroundColor: colors.primary, width: 13, height: 13, borderRadius: 7 },
  timelineLine: { position: 'absolute', top: 34, bottom: -23, width: 2, backgroundColor: colors.border },
  reportCard: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  reportTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  weekLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  week: { color: colors.ink, fontSize: 15, fontWeight: '900', marginTop: 3 },
  level: { borderRadius: radius.pill, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 6 },
  levelText: { color: colors.primary, fontSize: 9, fontWeight: '900' },
  excellent: { backgroundColor: colors.tealSoft },
  excellentText: { color: colors.success },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, backgroundColor: colors.canvas, borderRadius: radius.md, paddingVertical: spacing.md },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.ink, fontSize: 14, fontWeight: '900', marginTop: 4 },
  statLabel: { color: colors.muted, fontSize: 7, fontWeight: '800', letterSpacing: 0.5, marginTop: 2 },
  statDivider: { height: 39, width: 1, backgroundColor: colors.border },
});
