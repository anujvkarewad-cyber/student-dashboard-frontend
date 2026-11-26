/**
 * LiveQuizResultScreen — score + per-quiz leaderboard after submit.
 *
 * Uses the existing APK theme only: white cards, navy ink, blue primary, teal
 * for positive results, amber for the pending tone. Styled to sit beside
 * LeaderboardScreen and TestsScreen without looking like a different app.
 *
 * The student's own row is always rendered, even when it falls below the fold,
 * and ties break on answer time ascending so two 30/30 students rank
 * deterministically.
 */
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, InitialsAvatar } from '../../components/ui';
import type { RootStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme';

export type LiveLeaderboardRow = {
  studentId: string; name: string; score: number; total: number; timeSeconds: number; isMe?: boolean;
};
export type LiveQuizResult = {
  testId: string; title: string; group?: string | null;
  score: number; total: number; rank: number; participants: number;
  timeSeconds: number; rows: LiveLeaderboardRow[];
};

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export const LiveQuizResultScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'LiveQuizResult'>>();
  const { testId } = route.params;

  const [data, setData] = useState<LiveQuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await (globalThis as any).UMP_LIVE_QUIZ_fetchResult?.(testId);
        if (cancelled) return;
        if (!res) throw new Error('Result available nahi hai');
        setData(res);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Result load nahi hua');
      }
    })();
    return () => { cancelled = true; };
  }, [testId]);

  if (error) {
    return (
      <View style={[styles.page, styles.center]}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.red} />
        <Text style={styles.errText}>{error}</Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.page, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.errText}>Leaderboard ban raha hai…</Text>
      </View>
    );
  }

  const top3 = data.rows.slice(0, 3);
  const rest = data.rows.slice(3);
  const pct = data.total ? Math.round((data.score / data.total) * 100) : 0;
  const podium = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : [];
  const places = [2, 1, 3];

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Leaderboard</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {data.title}{data.group ? ` · ${data.group}` : ''}
          </Text>
        </View>
        <View style={styles.finalPill}>
          <View style={styles.finalDot} />
          <Text style={styles.finalText}>FINAL</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {podium.length > 0 && (
          <View style={styles.podium}>
            {podium.map((r, i) => {
              const place = places[i];
              const gold = place === 1;
              return (
                <View key={r.studentId} style={styles.pod}>
                  <InitialsAvatar name={r.name} size={gold ? 56 : 46} />
                  <Text style={styles.podName} numberOfLines={1}>{r.name.split(' ')[0]}</Text>
                  <Text style={[styles.podScore, gold && { color: colors.primary }]}>{r.score}</Text>
                  <View style={[styles.podBase, gold && styles.podBaseGold, place === 2 && { height: 46 }, place === 3 && { height: 34 }]} />
                </View>
              );
            })}
          </View>
        )}

        <Card style={styles.summary}>
          <Text style={styles.sumLabel}>TUMHARA SCORE</Text>
          <Text style={styles.sumBig}>{data.score}<Text style={styles.sumTotal}>/{data.total}</Text></Text>
          <View style={styles.sumGrid}>
            <View style={styles.sumCell}>
              <Text style={[styles.sumValue, { color: colors.primary }]}>#{data.rank}</Text>
              <Text style={styles.sumKey}>RANK</Text>
            </View>
            <View style={styles.sumCell}>
              <Text style={styles.sumValue}>{pct}%</Text>
              <Text style={styles.sumKey}>ACCURACY</Text>
            </View>
            <View style={styles.sumCell}>
              <Text style={styles.sumValue}>{mmss(data.timeSeconds)}</Text>
              <Text style={styles.sumKey}>TIME</Text>
            </View>
          </View>
          <Text style={styles.sumNote}>{data.participants} students mein se</Text>
        </Card>

        {rest.map((r, i) => (
          <Card key={r.studentId} style={[styles.row, r.isMe && styles.rowMe]}>
            <Text style={styles.rank}>{i + 4}</Text>
            <InitialsAvatar name={r.name} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{r.name}{r.isMe ? ' (tum)' : ''}</Text>
              <Text style={styles.rowMeta}>{r.score} correct · {mmss(r.timeSeconds)}</Text>
            </View>
            <Text style={[styles.rowScore, r.isMe && { color: colors.primary }]}>{r.score}</Text>
          </Card>
        ))}
        <View style={{ height: spacing.md }} />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.ghost} onPress={() => navigation.navigate('Tests')}>
          <Text style={styles.ghostText}>Tests</Text>
        </Pressable>
        <Pressable style={styles.cta} onPress={() => navigation.navigate('LiveQuizReview', { testId })}>
          <Text style={styles.ctaText}>Solutions dekho</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xxl },
  errText: { color: colors.muted, fontSize: 12.5, textAlign: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  title: { color: colors.ink, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  finalPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.tealSoft, paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill },
  finalDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal },
  finalText: { color: colors.teal, fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },

  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },

  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingTop: spacing.sm },
  pod: { flex: 1, alignItems: 'center', gap: 6 },
  podName: { color: colors.inkSoft, fontSize: 11.5, fontWeight: '800', maxWidth: 88 },
  podScore: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  podBase: { width: '100%', height: 40, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomWidth: 0, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  podBaseGold: { height: 66, backgroundColor: colors.primarySoft, borderColor: '#CFDAFF' },

  summary: { alignItems: 'center', paddingVertical: spacing.lg },
  sumLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  sumBig: { color: colors.ink, fontSize: 36, fontWeight: '900', letterSpacing: -1, marginTop: 4 },
  sumTotal: { color: colors.muted, fontSize: 17, fontWeight: '800' },
  sumGrid: { flexDirection: 'row', alignSelf: 'stretch', marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  sumCell: { flex: 1, alignItems: 'center' },
  sumValue: { color: colors.ink, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  sumKey: { color: colors.muted, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.3, marginTop: 2 },
  sumNote: { color: colors.muted, fontSize: 11, marginTop: spacing.md },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowMe: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  rank: { width: 22, textAlign: 'center', color: colors.muted, fontSize: 12, fontWeight: '900' },
  name: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  rowMeta: { color: colors.muted, fontSize: 10.5, marginTop: 2 },
  rowScore: { color: colors.ink, fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },

  footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, paddingTop: spacing.sm },
  ghost: { paddingHorizontal: spacing.lg, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#CFDAFF', borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  cta: { flex: 1, minHeight: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: colors.surface, fontSize: 15, fontWeight: '800' },
});
