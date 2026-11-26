/**
 * LiveQuizLobbyScreen — 5 minute waiting room for a scheduled live quiz.
 *
 * Styled with the EXISTING APK theme (src/theme.ts): light canvas, white cards
 * with the shared shadow, navy ink and the blue primary. No new palette.
 *
 * Rules enforced here:
 *   1. Join opens JOIN_LEAD_MS before window_start and closes at window_end.
 *   2. The countdown uses the SERVER clock (list response carries serverNow), so
 *      a phone with a wrong time cannot open the lobby early.
 *   3. The quiz clock runs from window_start, never from when Join was pressed —
 *      a late joiner gets no extra time.
 */
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/ui';
import type { RootStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme';

export const JOIN_LEAD_MS = 5 * 60 * 1000;

type Phase = 'too-early' | 'joining' | 'starting' | 'closed';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatCountdown(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function phaseFor(now: number, start: number, end: number): Phase {
  if (now > end) return 'closed';
  if (now >= start) return 'starting';
  if (now >= start - JOIN_LEAD_MS) return 'joining';
  return 'too-early';
}

export const LiveQuizLobbyScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'LiveQuizLobby'>>();
  const cfg = route.params;

  const start = useMemo(() => new Date(cfg.windowStart).getTime(), [cfg.windowStart]);
  const end = useMemo(() => new Date(cfg.windowEnd).getTime(), [cfg.windowEnd]);

  // serverNow - Date.now() at mount, applied to every tick.
  const skew = useMemo(() => (cfg.serverNow ? cfg.serverNow - Date.now() : 0), [cfg.serverNow]);
  const skewRef = useRef(skew);
  skewRef.current = skew;

  const [now, setNow] = useState(() => Date.now() + skew);
  const [phase, setPhase] = useState<Phase>(() => phaseFor(Date.now() + skew, start, end));

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now() + skewRef.current;
      setNow(t);
      setPhase(phaseFor(t, start, end));
    }, 500);
    return () => clearInterval(id);
  }, [start, end]);

  const join = useCallback(
    () => navigation.navigate('LiveQuizPlayer', { testId: cfg.testId }),
    [navigation, cfg.testId],
  );

  const msToStart = start - now;
  const warning = msToStart <= 60_000 && msToStart > 0;
  const startLabel = new Date(start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={colors.inkSoft} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Daily Live Quiz</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {cfg.group || 'All Groups'} · {cfg.questionCount} questions
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ---- hero ---- */}
        <Card style={styles.hero}>
          <View style={[styles.pill, phase === 'starting' && styles.pillLive]}>
            <View style={[styles.pillDot, phase === 'starting' && styles.pillDotLive]} />
            <Text style={[styles.pillText, phase === 'starting' && { color: colors.primary }]}>
              {phase === 'starting' ? 'QUIZ LIVE' : phase === 'closed' ? 'CLOSED' : 'JOINING OPEN'}
            </Text>
          </View>

          <Text style={styles.heroTitle} numberOfLines={2}>{cfg.title}</Text>
          <Text style={styles.heroMeta}>{startLabel} sharp · {cfg.durationMinutes} min</Text>

          <Text
            style={[
              styles.countdown,
              warning && { color: colors.amber },
              phase === 'closed' && { color: colors.muted },
            ]}
          >
            {phase === 'closed' ? '--:--' : phase === 'starting' ? '00:00' : formatCountdown(msToStart)}
          </Text>
          <Text style={styles.countdownLabel}>
            {phase === 'starting' ? 'QUIZ CHALU HAI' : phase === 'closed' ? 'WINDOW BAND' : 'QUIZ SHURU HONE MEIN'}
          </Text>
        </Card>

        {/* ---- who joined ---- */}
        {typeof cfg.joiningCount === 'number' && (
          <Card style={styles.joinCard}>
            <View style={styles.avatarRow}>
              {['A', 'R', 'S'].map((ch) => (
                <View key={ch} style={styles.avatar}><Text style={styles.avatarText}>{ch}</Text></View>
              ))}
              <View style={[styles.avatar, styles.avatarMore]}>
                <Text style={styles.avatarText}>+{Math.max(0, (cfg.joiningCount ?? 0) - 3)}</Text>
              </View>
            </View>
            <Text style={styles.joinText}>
              <Text style={{ color: colors.primary, fontWeight: '800' }}>{cfg.joiningCount} students</Text> ne join kiya
            </Text>
          </Card>
        )}

        {/* ---- rules ---- */}
        <View style={styles.rules}>
          <Rule icon="time-outline" color={colors.primary} text={`${startLabel} baje sharp start. Uske baad paper khulega.`} />
          <Rule icon="lock-closed-outline" color={colors.red} text="Ek baar start kiya to wapas nahi aa sakte — network gaya to attempt khatam." />
          <Rule icon="bar-chart-outline" color={colors.teal} text="Quiz ke baad turant leaderboard." />
        </View>

        <View style={{ flex: 1, minHeight: spacing.xl }} />

        {/* ---- CTA ---- */}
        {phase === 'too-early' ? (
          <>
            <View style={[styles.cta, styles.ctaOff]}>
              <Text style={styles.ctaOffText}>Join {formatCountdown(msToStart - JOIN_LEAD_MS)} baad khulega</Text>
            </View>
            <Text style={styles.hint}>Lobby quiz se 5 minute pehle khulti hai.</Text>
          </>
        ) : phase === 'closed' ? (
          <View style={[styles.cta, styles.ctaOff]}>
            <Text style={styles.ctaOffText}>Quiz band ho gaya</Text>
          </View>
        ) : (
          <Pressable
            onPress={join}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.86, transform: [{ scale: 0.99 }] }]}
          >
            <Ionicons name="play-circle" size={19} color={colors.surface} />
            <Text style={styles.ctaText}>
              {phase === 'starting' ? 'Quiz shuru — Join karo' : 'Join Quiz'}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
};

function Rule({ icon, color, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; text: string }) {
  return (
    <View style={styles.rule}>
      <Ionicons name={icon} size={16} color={color} style={{ marginTop: 1 }} />
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md },
  back: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },

  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },

  hero: { alignItems: 'center', paddingVertical: spacing.xxl, gap: 0 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.amberSoft, paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill },
  pillLive: { backgroundColor: colors.primarySoft },
  pillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.amber },
  pillDotLive: { backgroundColor: colors.primary },
  pillText: { color: '#8A5A00', fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },

  heroTitle: { color: colors.ink, fontSize: 21, fontWeight: '900', textAlign: 'center', marginTop: spacing.lg, letterSpacing: -0.3 },
  heroMeta: { color: colors.muted, fontSize: 12, marginTop: 6 },
  countdown: { color: colors.primary, fontSize: 54, fontWeight: '900', letterSpacing: -2, marginTop: spacing.xl, fontVariant: ['tabular-nums'] },
  countdownLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginTop: 6 },

  joinCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  avatarRow: { flexDirection: 'row' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginLeft: -9 },
  avatarMore: {},
  avatarText: { color: colors.primaryDark, fontSize: 10.5, fontWeight: '900' },
  joinText: { color: colors.inkSoft, fontSize: 12.5 },

  rules: { gap: spacing.md, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  rule: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  ruleText: { flex: 1, color: colors.inkSoft, fontSize: 12.5, lineHeight: 19 },

  cta: { flexDirection: 'row', gap: spacing.sm, minHeight: 54, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  ctaText: { color: colors.surface, fontSize: 16, fontWeight: '800' },
  ctaOff: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#CFDAFF' },
  ctaOffText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  hint: { color: colors.muted, fontSize: 11.5, textAlign: 'center', marginTop: spacing.sm },
});
