import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, EmptyState, ErrorBanner } from '../components/ui';
import { useData } from '../context/DataContext';
import { colors, radius, spacing } from '../theme';
import type { StudyLog } from '../types';

const format = (value?: number) => value == null ? '—' : Number(value).toFixed(1).replace('.0', '');
const niceDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const Summary = ({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) => (
  <View style={styles.summaryItem}>
    <View style={styles.summaryIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View>
    <Text style={styles.summaryValue}>{value}</Text>
    <Text style={styles.summaryLabel}>{label}</Text>
  </View>
);

const LogRow = ({ item }: { item: StudyLog }) => (
  <Card style={styles.logCard}>
    <View style={styles.dateTile}>
      <Text style={styles.dateDay}>{new Date(item.date).getDate() || '—'}</Text>
      <Text style={styles.dateMonth}>{new Date(item.date).toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}</Text>
    </View>
    <View style={styles.logBody}>
      <Text style={styles.logTopic} numberOfLines={2}>{item.topic || 'Focused study session'}</Text>
      <Text style={styles.logDate}>{niceDate(item.date)}</Text>
    </View>
    <View style={styles.hoursPill}><Text style={styles.hours}>{format(item.hours)}h</Text></View>
    {item.proof && item.proof !== '#' ? (
      <Pressable onPress={() => Linking.openURL(item.proof!)} hitSlop={10}><Ionicons name="open-outline" size={20} color={colors.primary} /></Pressable>
    ) : null}
  </Card>
);

export const TrackerScreen = () => {
  const navigation = useNavigation<any>();
  const { data, error, refreshing, refreshTracker } = useData();
  const stats = data.stats;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={data.studyLog}
        keyExtractor={(item, index) => `${item.date}-${index}`}
        renderItem={({ item }) => <LogRow item={item} />}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshTracker().catch(() => undefined)} colors={[colors.primary]} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View><Text style={styles.eyebrow}>CONSISTENCY HUB</Text><Text style={styles.title}>Study tracker</Text></View>
              <Pressable style={styles.addTop} onPress={() => navigation.navigate('AddStudyLog')}>
                <Ionicons name="add" size={25} color={colors.surface} />
              </Pressable>
            </View>
            {error ? <ErrorBanner message={error} onRetry={() => refreshTracker().catch(() => undefined)} /> : null}
            <Card style={styles.summaryCard}>
              <Summary icon="checkmark-done-outline" label="Sessions" value={String(stats.totalEntries ?? '—')} />
              <View style={styles.divider} />
              <Summary icon="time-outline" label="Total hrs" value={format(stats.totalHours)} />
              <View style={styles.divider} />
              <Summary icon="trending-up-outline" label="Average" value={format(stats.averageHours)} />
            </Card>
            <View style={styles.listHeader}><Text style={styles.listTitle}>Recent sessions</Text><Text style={styles.listCount}>{data.studyLog.length} entries</Text></View>
          </>
        }
        ListEmptyComponent={<EmptyState icon="book-outline" title="No study sessions yet" message="Log your first focused session and start building your consistency streak." />}
        ListFooterComponent={<View style={styles.footerSpace} />}
      />
      <Pressable style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.96 }] }]} onPress={() => navigation.navigate('AddStudyLog')}>
        <Ionicons name="add" size={25} color={colors.surface} /><Text style={styles.fabText}>Log hours</Text>
      </Pressable>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.lg },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', letterSpacing: -0.7, marginTop: 3 },
  addTop: { width: 43, height: 43, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  summaryCard: { paddingVertical: spacing.lg, paddingHorizontal: spacing.sm, flexDirection: 'row', marginBottom: spacing.xxl, shadowOpacity: 0.05 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryIcon: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  summaryValue: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  summaryLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
  divider: { width: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  listTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  listCount: { color: colors.muted, fontSize: 11 },
  logCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.md, shadowOpacity: 0.04 },
  dateTile: { width: 49, height: 52, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  dateDay: { color: colors.primaryDark, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  dateMonth: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  logBody: { flex: 1 },
  logTopic: { color: colors.ink, fontSize: 13, fontWeight: '800', lineHeight: 18 },
  logDate: { color: colors.muted, fontSize: 10, marginTop: 4 },
  hoursPill: { backgroundColor: colors.tealSoft, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill },
  hours: { color: colors.teal, fontSize: 12, fontWeight: '900' },
  footerSpace: { height: 40 },
  fab: { position: 'absolute', right: spacing.lg, bottom: 22, height: 54, borderRadius: 27, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primary, shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 7 },
  fabText: { color: colors.surface, fontWeight: '900', fontSize: 14 },
});
