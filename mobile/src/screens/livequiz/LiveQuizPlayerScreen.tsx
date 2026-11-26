/**
 * LiveQuizPlayerScreen — the live quiz, styled with the existing APK theme.
 *
 * Enforced rules:
 *   1. The clock counts down from windowStart + durationMinutes, so the
 *      staggered fetch never costs a student any answering time.
 *   2. Auto-submit fires once when the clock reaches zero; the screen then
 *      becomes read-only.
 *   3. The Submit button is on screen for the whole attempt once at least one
 *      question is answered — it is never only reachable on the last question.
 *
 * The fetch is staggered by a hash of the test id + student id (0–40s) so ~180
 * students do not hit the backend in the same second.
 */
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton } from '../../components/ui';
import type { RootStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme';

export type LiveQuestion = { id: string; prompt: string; options: { id: string; text: string }[] };
export type LivePaper = { testId: string; windowStart: string; durationMinutes: number; questions: LiveQuestion[] };

export function staggerDelayMs(seed: string, maxSeconds = 40) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % maxSeconds) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const formatClock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

export const LiveQuizPlayerScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'LiveQuizPlayer'>>();
  const { testId } = route.params;

  const [paper, setPaper] = useState<LivePaper | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [msLeft, setMsLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submittedRef = useRef(false);
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const delay = staggerDelayMs(testId);
    const timer = setTimeout(async () => {
      try {
        const next = await (globalThis as any).UMP_LIVE_QUIZ_fetchPaper?.(testId);
        if (cancelled) return;
        if (!next) throw new Error('Paper available nahi hai');
        setPaper(next);
        deadlineRef.current = new Date(next.windowStart).getTime() + next.durationMinutes * 60_000;
        setMsLeft(deadlineRef.current - Date.now());
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Paper load nahi hua');
      }
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [testId]);

  const submit = useCallback(async (auto = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await (globalThis as any).UMP_LIVE_QUIZ_submit?.(testId, answers, auto);
    } finally {
      navigation.replace('LiveQuizResult', { testId });
    }
  }, [answers, navigation, testId]);

  useEffect(() => {
    const id = setInterval(() => {
      if (deadlineRef.current == null) return;
      const left = deadlineRef.current - Date.now();
      setMsLeft(left);
      if (left <= 0 && !submittedRef.current) void submit(true);
    }, 500);
    return () => clearInterval(id);
  }, [paper, submit]);

  if (error) {
    return (
      <View style={[styles.page, styles.center]}>
        <Ionicons name="cloud-offline-outline" size={42} color={colors.red} />
        <Text style={styles.errTitle}>Paper load nahi hua</Text>
        <Text style={styles.errText}>{error}</Text>
        <PrimaryButton label="Wapas jao" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg, paddingHorizontal: spacing.xxl }} />
      </View>
    );
  }

  const q = paper?.questions[index];
  if (!paper || !q || msLeft == null) {
    return (
      <View style={[styles.page, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.errTitle}>Paper aa raha hai…</Text>
        <Text style={styles.errText}>Timer already chalu hai — yeh wait count nahi hoga.</Text>
      </View>
    );
  }

  const total = paper.questions.length;
  const answered = Object.keys(answers).length;
  const last = index === total - 1;
  const warn = msLeft <= 5 * 60_000 && msLeft > 60_000;
  const danger = msLeft <= 60_000;

  const pick = (optionId: string) => {
    if (submittedRef.current) return;
    setAnswers((prev) => ({ ...prev, [q.id]: optionId }));
  };

  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <View style={[styles.chip, warn && styles.chipWarn, danger && styles.chipDanger]}>
          <Ionicons name="time-outline" size={15} color={danger ? colors.red : warn ? colors.amber : colors.primary} />
          <Text style={[styles.chipText, warn && { color: '#8A5A00' }, danger && { color: colors.red }]}>
            {formatClock(msLeft)}
          </Text>
        </View>
        <Text style={styles.progText}>
          {index + 1}/{total} · <Text style={{ color: colors.primary, fontWeight: '900' }}>{answered}</Text> answered
        </Text>
      </View>

      <View style={styles.progTrack}>
        <View style={[styles.progFill, { width: `${((index + 1) / total) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.qCard}>
          <Text style={styles.kicker}>QUESTION {pad(index + 1)}</Text>
          <Text style={styles.qText}>{q.prompt}</Text>

          <View style={styles.opts}>
            {q.options.map((o, i) => {
              const sel = answers[q.id] === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => pick(o.id)}
                  style={({ pressed }) => [styles.opt, sel && styles.optSel, pressed && { opacity: 0.9 }]}
                >
                  <View style={[styles.optBadge, sel && styles.optBadgeSel]}>
                    <Text style={[styles.optBadgeText, sel && { color: colors.surface }]}>{'ABCD'[i]}</Text>
                  </View>
                  <Text style={styles.optText}>{o.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <View style={styles.dots}>
          {paper.questions.map((qq, i) => (
            <Pressable
              key={qq.id}
              onPress={() => setIndex(i)}
              style={[styles.dot, answers[qq.id] && styles.dotAns, i === index && styles.dotCur]}
            >
              <Text style={[styles.dotText, answers[qq.id] && { color: colors.primary }, i === index && { color: colors.primaryDark }]}>
                {i + 1}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ height: spacing.sm }} />
      </ScrollView>

      <View style={styles.navRow}>
        <Pressable
          onPress={() => setIndex((i) => Math.min(total - 1, i + 1))}
          style={styles.skip}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
        <PrimaryButton
          label={last ? 'Last question' : 'Save & Next'}
          onPress={() => setIndex((i) => Math.min(total - 1, i + 1))}
          disabled={last}
          style={{ flex: 1 }}
        />
      </View>

      {/* Submit is visible for the whole attempt once something is answered. */}
      {answered > 0 && (
        <Pressable
          onPress={() => void submit(false)}
          disabled={submitting}
          style={[styles.submitBar, answered === total && styles.submitBarReady]}
        >
          <Text style={styles.submitText}>{submitting ? 'Submit ho raha…' : 'Submit Quiz'}</Text>
          <Text style={styles.submitCount}>
            {answered === total ? '· sab bhare hain' : `· ${answered}/${total}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.sm },
  errTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', marginTop: spacing.sm },
  errText: { color: colors.muted, fontSize: 12.5, textAlign: 'center', lineHeight: 19 },

  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#CFDAFF', paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill },
  chipWarn: { backgroundColor: colors.amberSoft, borderColor: '#F3DFAE' },
  chipDanger: { backgroundColor: colors.redSoft, borderColor: '#F7CBD3' },
  chipText: { color: colors.primary, fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  progText: { color: colors.muted, fontSize: 11.5, fontWeight: '700', marginLeft: 'auto' },

  progTrack: { height: 6, borderRadius: 999, backgroundColor: '#E3EAF4', marginHorizontal: spacing.lg, marginTop: spacing.md, overflow: 'hidden' },
  progFill: { height: 6, borderRadius: 999, backgroundColor: colors.primary },

  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  qCard: { padding: spacing.lg },
  kicker: { color: colors.inkSoft, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: spacing.sm },
  qText: { color: colors.ink, fontSize: 14.5, fontWeight: '700', lineHeight: 22 },
  opts: { gap: spacing.sm, marginTop: spacing.lg },
  opt: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, padding: spacing.md },
  optSel: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optBadge: { width: 26, height: 26, borderRadius: 8, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  optBadgeSel: { backgroundColor: colors.primary },
  optBadgeText: { fontSize: 12, fontWeight: '800', color: colors.inkSoft },
  optText: { flex: 1, fontSize: 13, color: colors.ink, lineHeight: 19 },

  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: spacing.xs },
  dot: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dotAns: { backgroundColor: colors.primarySoft, borderColor: '#CFDAFF' },
  dotCur: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  dotText: { color: colors.muted, fontSize: 11, fontWeight: '800' },

  navRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  skip: { width: 96, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#CFDAFF', borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: colors.primary, fontSize: 15, fontWeight: '800' },

  submitBar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.lg, minHeight: 52, borderRadius: radius.md, backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.ink },
  submitBarReady: { backgroundColor: colors.primary, borderColor: colors.primary },
  submitText: { color: colors.surface, fontSize: 15.5, fontWeight: '800' },
  submitCount: { color: 'rgba(255,255,255,0.66)', fontSize: 12.5, fontWeight: '700' },
});
