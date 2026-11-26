/**
 * LiveQuizReviewScreen — question-wise solutions after a live quiz.
 *
 * WHY THERE ARE TWO STATES
 * A live quiz runs inside a fixed window (e.g. 20:00–20:40). A fast student can
 * submit at 20:12. If full solutions were shown that early, the answer key could
 * be forwarded to the batch WhatsApp group while ~150 students are still
 * attempting — the leaderboard would be meaningless.
 *
 * So:
 *   • Immediately after submit  → right/wrong per question + their own answer.
 *     Enough to understand the score, useless to leak.
 *   • After window_end          → full solution: correct option text, and the
 *     explanation.
 *
 * The backend is the authority for both: `solutionVisibleUntil` comes from the
 * test window, never from the device clock.
 */
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/ui';
import type { RootStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme';

export type ReviewOption = { id: string; text: string };
export type ReviewQuestion = {
  id: string;
  prompt: string;
  options: ReviewOption[];
  chosenOptionId: string | null;
  /** Absent until the backend unlocks solutions. */
  correctOptionId?: string | null;
  explanation?: string | null;
};
export type LiveQuizReview = {
  testId: string;
  title: string;
  group?: string | null;
  score: number;
  total: number;
  /** Epoch ms. Solutions stay locked until this passes. */
  solutionUnlockAt: number;
  questions: ReviewQuestion[];
};

/** A question is "answered correctly" only when the key is available. */
function statusOf(q: ReviewQuestion, unlocked: boolean): 'correct' | 'wrong' | 'skipped' | 'unknown' {
  if (!q.chosenOptionId) return 'skipped';
  if (!unlocked || !q.correctOptionId) return 'unknown';
  return q.chosenOptionId === q.correctOptionId ? 'correct' : 'wrong';
}

const pad = (n: number) => String(n).padStart(2, '0');
function countdown(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const LiveQuizReviewScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'LiveQuizReview'>>();
  const { testId } = route.params;

  const [data, setData] = useState<LiveQuizReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState<'all' | 'wrong' | 'skipped'>('all');

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await (globalThis as any).UMP_LIVE_QUIZ_fetchReview?.(testId);
        if (cancelled) return;
        if (!res) throw new Error('Review available nahi hai');
        setData(res);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Review load nahi hua');
      }
    })();
    return () => { cancelled = true; };
  }, [testId]);

  const unlocked = !!data && now >= data.solutionUnlockAt;
  const lockLeft = data ? data.solutionUnlockAt - now : 0;

  const counts = useMemo(() => {
    if (!data) return { correct: 0, wrong: 0, skipped: 0 };
    let correct = 0, wrong = 0, skipped = 0;
    data.questions.forEach((q) => {
      const st = statusOf(q, unlocked);
      if (st === 'correct') correct++;
      else if (st === 'wrong') wrong++;
      else if (st === 'skipped') skipped++;
    });
    return { correct, wrong, skipped };
  }, [data, unlocked]);

  const visible = useMemo(() => {
    if (!data) return [];
    if (filter === 'all') return data.questions;
    return data.questions.filter((q) => statusOf(q, unlocked) === filter);
  }, [data, filter, unlocked]);

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
        <Text style={styles.errText}>Solutions load ho rahe hain…</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={colors.inkSoft} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Solutions</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {data.title}{data.group ? ` · ${data.group}` : ''}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ---- score strip ---- */}
        <Card style={styles.scoreCard}>
          <Text style={styles.scoreBig}>{data.score}<Text style={styles.scoreTotal}>/{data.total}</Text></Text>
          <View style={styles.scoreGrid}>
            <View style={styles.scoreCell}>
              <Text style={[styles.scoreVal, { color: colors.success }]}>{counts.correct}</Text>
              <Text style={styles.scoreKey}>CORRECT</Text>
            </View>
            <View style={styles.scoreCell}>
              <Text style={[styles.scoreVal, { color: colors.red }]}>{unlocked ? counts.wrong : '—'}</Text>
              <Text style={styles.scoreKey}>WRONG</Text>
            </View>
            <View style={styles.scoreCell}>
              <Text style={[styles.scoreVal, { color: colors.muted }]}>{counts.skipped}</Text>
              <Text style={styles.scoreKey}>SKIPPED</Text>
            </View>
          </View>
        </Card>

        {/* ---- lock banner ---- */}
        {!unlocked && (
          <View style={styles.lockBanner}>
            <Ionicons name="lock-closed" size={17} color="#8A5A00" />
            <View style={{ flex: 1 }}>
              <Text style={styles.lockTitle}>
                Solutions {countdown(lockLeft)} baad khulenge
              </Text>
              <Text style={styles.lockBody}>
                Quiz window band hone ke baad hi answer key dikhta hai — warna baaki students ko
                answers bhej diye jaate.
              </Text>
            </View>
          </View>
        )}

        {/* ---- filters ---- */}
        {unlocked && (
          <View style={styles.filters}>
            {([['all', 'Sab'], ['wrong', 'Galat'], ['skipped', 'Chhode']] as const).map(([k, label]) => (
              <Pressable
                key={k}
                onPress={() => setFilter(k)}
                style={[styles.filterChip, filter === k && styles.filterChipOn]}
              >
                <Text style={[styles.filterText, filter === k && styles.filterTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* ---- questions ---- */}
        {visible.map((q, i) => {
          const st = statusOf(q, unlocked);
          const idx = data.questions.indexOf(q) + 1;
          return (
            <Card key={q.id} style={styles.qCard}>
              <View style={styles.qHead}>
                <Text style={styles.qIndex}>Q{idx}</Text>
                <View style={[styles.statusPill, st === 'correct' ? styles.pillOk : st === 'wrong' ? styles.pillBad : styles.pillSkip]}>
                  <Ionicons
                    name={st === 'correct' ? 'checkmark-circle' : st === 'wrong' ? 'close-circle' : st === 'skipped' ? 'remove-circle-outline' : 'help-circle-outline'}
                    size={13}
                    color={st === 'correct' ? colors.success : st === 'wrong' ? colors.red : colors.muted}
                  />
                  <Text style={[styles.statusText, st === 'correct' ? { color: colors.success } : st === 'wrong' ? { color: colors.red } : { color: colors.muted }]}>
                    {st === 'correct' ? 'Sahi' : st === 'wrong' ? 'Galat' : st === 'skipped' ? 'Chhoda' : 'Under review'}
                  </Text>
                </View>
              </View>

              <Text style={styles.qPrompt}>{q.prompt}</Text>

              <View style={styles.optList}>
                {q.options.map((o, oi) => {
                  const isChosen = q.chosenOptionId === o.id;
                  const isCorrect = unlocked && q.correctOptionId === o.id;
                  return (
                    <View
                      key={o.id}
                      style={[styles.optRow, isCorrect && styles.optCorrect, isChosen && !isCorrect && styles.optWrong]}
                    >
                      <View style={[styles.optKey, isCorrect && { backgroundColor: colors.success }, isChosen && !isCorrect && { backgroundColor: colors.red }]}>
                        <Text style={[styles.optKeyText, (isCorrect || (isChosen && !isCorrect)) && { color: '#fff' }]}>
                          {'ABCD'[oi]}
                        </Text>
                      </View>
                      <Text style={styles.optText}>{o.text}</Text>
                      {isCorrect && <Ionicons name="checkmark" size={16} color={colors.success} />}
                      {isChosen && !isCorrect && <Ionicons name="close" size={16} color={colors.red} />}
                    </View>
                  );
                })}
              </View>

              {unlocked && q.explanation ? (
                <View style={styles.explainBox}>
                  <Text style={styles.explainLabel}>SOLUTION</Text>
                  <Text style={styles.explainText}>{q.explanation}</Text>
                </View>
              ) : !unlocked ? (
                <View style={styles.explainLocked}>
                  <Ionicons name="lock-closed-outline" size={13} color={colors.muted} />
                  <Text style={styles.explainLockedText}>Solution window band hone par</Text>
                </View>
              ) : null}
            </Card>
          );
        })}
        <View style={{ height: spacing.lg }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xxl },
  errText: { color: colors.muted, fontSize: 12.5, textAlign: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  back: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },

  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },

  scoreCard: { alignItems: 'center', paddingVertical: spacing.lg },
  scoreBig: { color: colors.ink, fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  scoreTotal: { color: colors.muted, fontSize: 16, fontWeight: '800' },
  scoreGrid: { flexDirection: 'row', alignSelf: 'stretch', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  scoreCell: { flex: 1, alignItems: 'center' },
  scoreVal: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  scoreKey: { color: colors.muted, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.3, marginTop: 2 },

  lockBanner: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', backgroundColor: colors.amberSoft, borderWidth: 1, borderColor: '#F3DFAE', borderRadius: radius.md, padding: spacing.md },
  lockTitle: { color: '#8A5A00', fontSize: 12.5, fontWeight: '800' },
  lockBody: { color: '#8A5A00', fontSize: 11, lineHeight: 16, marginTop: 3, opacity: 0.85 },

  filters: { flexDirection: 'row', gap: spacing.sm },
  filterChip: { paddingHorizontal: 15, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterChipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  filterText: { color: colors.inkSoft, fontSize: 12.5, fontWeight: '700' },
  filterTextOn: { color: colors.primaryDark, fontWeight: '800' },

  qCard: { padding: spacing.md, gap: spacing.sm },
  qHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qIndex: { color: colors.inkSoft, fontSize: 12, fontWeight: '900' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, marginLeft: 'auto' },
  pillOk: { backgroundColor: '#E4F8F4' },
  pillBad: { backgroundColor: colors.redSoft },
  pillSkip: { backgroundColor: colors.canvas },
  statusText: { fontSize: 9.5, fontWeight: '800' },

  qPrompt: { color: colors.ink, fontSize: 13.5, fontWeight: '700', lineHeight: 20 },

  optList: { gap: 6 },
  optRow: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm },
  optCorrect: { borderColor: colors.success, backgroundColor: '#F1FBF7' },
  optWrong: { borderColor: colors.red, backgroundColor: '#FEF5F7' },
  optKey: { width: 22, height: 22, borderRadius: 7, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  optKeyText: { fontSize: 10.5, fontWeight: '800', color: colors.inkSoft },
  optText: { flex: 1, fontSize: 12, color: colors.ink, lineHeight: 17 },

  explainBox: { backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: spacing.md },
  explainLabel: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 0.6, marginBottom: 4 },
  explainText: { color: colors.ink, fontSize: 12, lineHeight: 18 },

  explainLocked: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  explainLockedText: { color: colors.muted, fontSize: 11 },
});
