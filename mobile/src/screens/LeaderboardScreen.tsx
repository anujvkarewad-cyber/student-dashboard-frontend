import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, InitialsAvatar } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { colors, radius, spacing } from '../theme';
import type { LeaderboardEntry } from '../types';

const format = (value?: number) => value == null ? '—' : Number(value).toFixed(1).replace('.0', '');

const PodiumPerson = ({ item, place }: { item?: LeaderboardEntry; place: 1 | 2 | 3 }) => {
  if (!item) return <View style={styles.podiumPerson} />;
  const size = place === 1 ? 62 : 52;
  return (
    <View style={[styles.podiumPerson, place === 1 && styles.firstPerson]}>
      {place === 1 ? <Ionicons name="trophy" size={25} color="#FFD466" style={styles.crown} /> : null}
      <View style={[styles.podiumAvatar, place === 1 && styles.firstAvatar]}><InitialsAvatar name={item.studentName} size={size} /></View>
      <View style={[styles.placeBadge, place === 1 && styles.placeOne]}><Text style={styles.placeText}>{place}</Text></View>
      <Text style={styles.podiumName} numberOfLines={1}>{item.studentName.split(' ')[0]}</Text>
      <Text style={styles.podiumHours}>{format(item.weeklyHours)} hrs</Text>
    </View>
  );
};

export const LeaderboardScreen = () => {
  const { student } = useAuth();
  const { data, refreshing, refreshLeaderboard } = useData();
  const list = data.leaderboard.filter(Boolean);
  const me = list.find((item) => item.studentId === student?.studentId);

  const renderRow = ({ item }: { item: LeaderboardEntry }) => {
    const isMe = item.studentId === student?.studentId;
    return (
      <View style={[styles.row, isMe && styles.myRow]}>
        <View style={[styles.rank, item.rank <= 3 && styles.topRank]}><Text style={[styles.rankText, item.rank <= 3 && styles.topRankText]}>{item.rank}</Text></View>
        <InitialsAvatar name={item.studentName} size={42} />
        <View style={styles.person}>
          <Text style={styles.personName}>{item.studentName}{isMe ? '  (You)' : ''}</Text>
          <Text style={styles.personId}>{item.studentId} · {item.status || 'Active'}</Text>
        </View>
        <View style={styles.score}>
          <Text style={styles.scoreValue}>{format(item.weeklyHours)}h</Text>
          <View style={styles.streak}><Ionicons name="flame" size={12} color={colors.amber} /><Text style={styles.streakText}>{item.streak || 0}</Text></View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={list}
        keyExtractor={(item) => `${item.rank}-${item.studentId}`}
        renderItem={renderRow}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshLeaderboard().catch(() => undefined)} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.header}><Text style={styles.eyebrow}>WEEKLY FOCUS</Text><Text style={styles.title}>Leaderboard</Text><Text style={styles.subtitle}>Celebrate consistency, not comparison.</Text></View>
            <LinearGradient colors={['#18376C', '#3C55C6', '#6652C5']} style={styles.podium}>
              <View style={styles.podiumGlow} />
              <View style={styles.podiumRow}>
                <PodiumPerson item={list[1]} place={2} />
                <PodiumPerson item={list[0]} place={1} />
                <PodiumPerson item={list[2]} place={3} />
              </View>
            </LinearGradient>
            {me ? (
              <View style={styles.mySummary}>
                <View><Text style={styles.myLabel}>YOUR POSITION</Text><Text style={styles.myRank}>#{me.rank}</Text></View>
                <View style={styles.myDivider} />
                <View><Text style={styles.myLabel}>THIS WEEK</Text><Text style={styles.myValue}>{format(me.weeklyHours)} hours</Text></View>
                <View style={styles.myDivider} />
                <View><Text style={styles.myLabel}>STREAK</Text><Text style={styles.myValue}>{me.streak || 0} days</Text></View>
              </View>
            ) : null}
            <View style={styles.tableHeader}><Text style={styles.tableTitle}>All students</Text><Text style={styles.updated}>Pull to refresh</Text></View>
          </>
        }
        ListEmptyComponent={<EmptyState icon="trophy-outline" title="Leaderboard unavailable" message="Rankings will appear once weekly study data is available." />}
        ListFooterComponent={<View style={{ height: 100 }} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.lg },
  header: { paddingTop: spacing.lg, paddingBottom: spacing.lg },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', letterSpacing: -0.7, marginTop: 3 },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 4 },
  podium: { height: 250, borderRadius: radius.xl, paddingHorizontal: spacing.md, overflow: 'hidden', justifyContent: 'flex-end' },
  podiumGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.08)', alignSelf: 'center', top: -100 },
  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', paddingBottom: spacing.xl },
  podiumPerson: { flex: 1, alignItems: 'center', minHeight: 150, justifyContent: 'flex-end' },
  firstPerson: { minHeight: 200 },
  podiumAvatar: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)', borderRadius: 99, padding: 2 },
  firstAvatar: { borderColor: '#FFD466', borderWidth: 3 },
  crown: { marginBottom: 4 },
  placeBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#A4AEC5', borderWidth: 2, borderColor: '#33497F', alignItems: 'center', justifyContent: 'center', marginTop: -9 },
  placeOne: { backgroundColor: '#FFD466' },
  placeText: { color: '#26365C', fontSize: 10, fontWeight: '900' },
  podiumName: { color: colors.surface, fontSize: 12, fontWeight: '800', marginTop: 6, maxWidth: 80 },
  podiumHours: { color: 'rgba(255,255,255,0.65)', fontSize: 10, marginTop: 2 },
  mySummary: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginTop: -1, paddingVertical: spacing.lg },
  myLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.6, textAlign: 'center' },
  myRank: { color: colors.primary, fontSize: 21, fontWeight: '900', textAlign: 'center', marginTop: 3 },
  myValue: { color: colors.ink, fontSize: 13, fontWeight: '900', textAlign: 'center', marginTop: 5 },
  myDivider: { height: 34, width: 1, backgroundColor: colors.border },
  tableHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xxl, marginBottom: spacing.md },
  tableTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  updated: { color: colors.muted, fontSize: 10 },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md },
  myRow: { borderColor: '#AFC0FA', backgroundColor: '#F7F9FF' },
  rank: { width: 27, height: 27, borderRadius: 9, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  topRank: { backgroundColor: colors.amberSoft },
  rankText: { color: colors.inkSoft, fontSize: 12, fontWeight: '900' },
  topRankText: { color: '#A86B00' },
  person: { flex: 1 },
  personName: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  personId: { color: colors.muted, fontSize: 9, marginTop: 3 },
  score: { alignItems: 'flex-end' },
  scoreValue: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 3 },
  streakText: { color: colors.muted, fontSize: 9, fontWeight: '700' },
});
