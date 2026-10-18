import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, SectionHeader } from '../components/ui';
import { useDailyMcq } from '../context/DailyMcqContext';
import { useFocusTimer } from '../context/FocusTimerContext';
import { useMcqPractice } from '../context/McqPracticeContext';
import { getTestHistory, TestHistoryEntry } from '../services/testHistory';
import { colors, radius, spacing } from '../theme';

/**
 * Weekly Report — the full record of one week:
 *   1. STUDY: how much the student studied (hours, sessions, subjects)
 *   2. TESTS GIVEN: mentor tests attempted (MCQ score / paper self-marks)
 *   3. MCQ REPORT: daily challenge + practice accuracy of the week
 * Weeks run Monday → Sunday; ◀ ▶ moves between weeks.
 * An empty week shows the student's own records only.
 */

type DaySession = { subject: string; durationSeconds: number; endedAt: number };
type DayDaily = { date: string; group: string; score: number; total: number; completedAt: number };
type DayPractice = { id: string; config: { subject?: string; group?: string }; score: number; total: number; completedAt: number };

const startOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
};

const fmtRange = (start: Date) => {
  const end = new Date(start.getTime() + 6 * 86400000);
  return `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
};
const fmtHours = (ms: number) => {
  const h = Math.floor(ms / 3600);
  const m = Math.round((ms % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const dayName = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { weekday: 'short' });

export const WeeklyReportScreen = () => {
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week
  const { sessions } = useFocusTimer();
  const { history: dailyHistory } = useDailyMcq();
  const { history: practiceHistory } = useMcqPractice();
  const [testHistory, setTestHistory] = useState<TestHistoryEntry[]>([]);

  useEffect(() => {
    let alive = true;
    getTestHistory().then((h) => { if (alive) setTestHistory(h); });
    return () => { alive = false; };
  }, [weekOffset]);

  const weekStart = useMemo(() => {
    const s = startOfWeek(new Date());
    s.setDate(s.getDate() + weekOffset * 7);
    return s;
  }, [weekOffset]);
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * 86400000), [weekStart]);
  const inWeek = useCallback((ts: number | string) => {
    const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  }, [weekStart, weekEnd]);

  const rawSessions = useMemo(() => sessions.filter((s) => inWeek(s.endedAt)), [sessions, inWeek]);
  const rawTests = useMemo(() => testHistory.filter((t) => inWeek(t.at)), [testHistory, inWeek]);
  const rawDaily = useMemo(() => dailyHistory.filter((a) => a.completedAt && inWeek(a.completedAt) && a.score != null), [dailyHistory, inWeek]);
  const rawPractice = useMemo(() => practiceHistory.filter((p) => p.completedAt && inWeek(p.completedAt) && p.score != null), [practiceHistory, inWeek]);

  const weekSessions: DaySession[] = rawSessions;
  const weekTests = rawTests;
  const weekDaily = rawDaily as DayDaily[];
  const weekPractice = rawPractice as DayPractice[];

  // ---- 1. STUDY ----
  const studySeconds = weekSessions.reduce((acc, s) => acc + s.durationSeconds, 0);
  const activeDays = new Set(weekSessions.map((s) => new Date(s.endedAt).toDateString())).size;
  const subjectTotals = useMemo(() => {
    const map: Record<string, number> = {};
    weekSessions.forEach((s) => { map[s.subject] = (map[s.subject] || 0) + s.durationSeconds; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [weekSessions]);
  const perDay = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekStart.getTime() + i * 86400000);
    const secs = weekSessions
      .filter((s) => new Date(s.endedAt).toDateString() === day.toDateString())
      .reduce((a, s) => a + s.durationSeconds, 0);
    return { label: day.toLocaleDateString('en-IN', { weekday: 'narrow' }), secs };
  }), [weekSessions, weekStart]);
  const maxDaySecs = Math.max(...perDay.map((d) => d.secs), 1);

  // ---- 3. MCQ ----
  const mcqStats = useMemo(() => {
    const all = [...weekDaily, ...weekPractice].map((x) => ({ score: x.score || 0, total: x.total || 0 }));
    const total = all.reduce((a, x) => a + x.total, 0);
    const score = all.reduce((a, x) => a + x.score, 0);
    return { count: all.length, total, score, pct: total ? Math.round((score / total) * 100) : 0 };
  }, [weekDaily, weekPractice]);

  const isCurrent = weekOffset === 0;
  const nothing = !weekSessions.length && !weekTests.length && !mcqStats.count;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* HERO — week picker + week summary */}
        <LinearGradient colors={['#162E61', '#3459CD', '#5575DF']} style={styles.hero}>
          <Text style={styles.eyebrow}>WEEKLY REPORT</Text>
          <View style={styles.weekNavRow}>
            <Pressable style={[styles.navBtn, weekOffset <= -8 && styles.navBtnOff]} onPress={() => setWeekOffset((w) => w - 1)}>
              <Ionicons name="chevron-back" size={17} color="#fff" />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.weekBig}>{isCurrent ? 'This Week' : weekOffset === -1 ? 'Last Week' : fmtRange(weekStart)}</Text>
              <Text style={styles.weekRange}>{fmtRange(weekStart)}</Text>
            </View>
            <Pressable style={[styles.navBtn, isCurrent && styles.navBtnOff]} onPress={() => setWeekOffset((w) => Math.min(0, w + 1))} disabled={isCurrent}>
              <Ionicons name="chevron-forward" size={17} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{fmtHours(studySeconds)}</Text>
              <Text style={styles.heroStatLabel}>STUDIED</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{weekTests.length}</Text>
              <Text style={styles.heroStatLabel}>TESTS GIVEN</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{mcqStats.count ? `${mcqStats.pct}%` : '—'}</Text>
              <Text style={styles.heroStatLabel}>MCQ ACCURACY</Text>
            </View>
          </View>
        </LinearGradient>

        {nothing ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={26} color={colors.muted} />
            <Text style={styles.emptyTitle}>No activity recorded this week</Text>
            <Text style={styles.emptyText}>Study with the Timer, give mentor tests and do MCQ practice — everything is recorded automatically and appears here.</Text>
          </Card>
        ) : (
          <>
            {/* 1 · STUDY */}
            <SectionHeader title="1 · Study — how much you studied" />
            <Card style={styles.card}>
              <View style={styles.studyHead}>
                <View>
                  <Text style={styles.studyBig}>{fmtHours(studySeconds)}</Text>
                  <Text style={styles.studySub}>{weekSessions.length} sessions · {activeDays}/7 days active</Text>
                </View>
                <View style={styles.studyIcon}><Ionicons name="timer-outline" size={24} color={colors.primary} /></View>
              </View>
              <View style={styles.barRow}>
                {perDay.map((d, i) => (
                  <View key={i} style={styles.barCol}>
                    <Text style={styles.barValue}>{d.secs ? fmtHours(d.secs).replace(' ', '') : ''}</Text>
                    <View style={[styles.bar, { height: d.secs ? 10 + (d.secs / maxDaySecs) * 52 : 4, backgroundColor: d.secs ? colors.primary : colors.border }]} />
                    <Text style={styles.barLabel}>{d.label}</Text>
                  </View>
                ))}
              </View>
              {subjectTotals.length ? (
                <View style={styles.chipRow}>
                  {subjectTotals.map(([subject, secs], i) => (
                    <View key={subject} style={[styles.subjectChip, { backgroundColor: i === 0 ? colors.tealSoft : colors.canvas }]}>
                      <Ionicons name="book-outline" size={13} color={i === 0 ? colors.teal : colors.muted} />
                      <Text style={styles.subjectChipText}>{subject} · {fmtHours(secs)}</Text>
                    </View>
                  ))}
                </View>
              ) : <Text style={styles.noData}>No focus sessions this week — use the Timer tab.</Text>}
            </Card>

            {/* 2 · TESTS GIVEN */}
            <SectionHeader title="2 · Tests — tests you gave" />
            <Card style={styles.card}>
              {weekTests.length ? weekTests.map((t) => {
                const pct = t.total && t.score != null ? Math.round((t.score / t.total) * 100) : null;
                const good = pct != null && pct >= 60;
                return (
                  <View key={t.id} style={styles.testRow}>
                    <View style={[styles.testIcon, { backgroundColor: t.kind === 'paper-test' ? colors.purpleSoft : colors.primarySoft }]}>
                      <Ionicons name={t.kind === 'paper-test' ? 'newspaper-outline' : 'document-text'} size={17} color={t.kind === 'paper-test' ? colors.purple : colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.testTitle} numberOfLines={1}>{t.title}</Text>
                      <Text style={styles.testMeta}>
                        {t.subject} · {new Date(t.at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {t.kind === 'paper-test' ? (t.selfMarks ? ' · self evaluation' : ' · answer submitted') : ''}
                      </Text>
                    </View>
                    {t.score != null ? (
                      <View style={[styles.scoreBadge, { backgroundColor: good ? colors.tealSoft : colors.amberSoft }]}>
                        <Text style={[styles.scoreBadgeValue, { color: good ? colors.teal : '#B36A16' }]}>{t.score}{t.total ? `/${t.total}` : ''}</Text>
                        {pct != null ? <Text style={[styles.scoreBadgePct, { color: good ? colors.teal : '#B36A16' }]}>{pct}%</Text> : null}
                      </View>
                    ) : (
                      <View style={[styles.scoreBadge, styles.scoreBadgeDue]}><Text style={styles.scoreBadgeDueText}>marks due</Text></View>
                    )}
                  </View>
                );
              }) : <Text style={styles.noData}>No mentor tests attempted this week.</Text>}
            </Card>

            {/* 3 · MCQ REPORT */}
            <SectionHeader title="3 · MCQ — your MCQ report" />
            <Card style={styles.card}>
              <View style={styles.mcqHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mcqBig}>{mcqStats.count ? `${mcqStats.pct}%` : '—'}</Text>
                  <Text style={styles.studySub}>{mcqStats.score}/{mcqStats.total} correct across {mcqStats.count} sets</Text>
                </View>
                <View style={[styles.studyIcon, { backgroundColor: colors.amberSoft }]}><Ionicons name="bar-chart" size={24} color={colors.amber} /></View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${mcqStats.pct}%`, backgroundColor: mcqStats.pct >= 60 ? colors.teal : colors.amber }]} />
              </View>
              {weekDaily.length ? (
                <View style={styles.listBlock}>
                  <Text style={styles.miniTitle}>Daily MCQ Challenge</Text>
                  {weekDaily.map((a, i) => (
                    <View key={`${a.date}-${i}`} style={styles.listRow}>
                      <Ionicons name="flame" size={14} color={colors.amber} />
                      <Text style={styles.listRowName}>{new Date(a.completedAt).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · {a.group}</Text>
                      <Text style={styles.listRowScore}>{a.score}/{a.total}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {weekPractice.length ? (
                <View style={styles.listBlock}>
                  <Text style={styles.miniTitle}>Unlimited practice</Text>
                  {weekPractice.slice(0, 6).map((p) => (
                    <View key={p.id} style={styles.listRow}>
                      <Ionicons name="barbell" size={14} color={colors.primary} />
                      <Text style={styles.listRowName}>{p.config.subject || p.config.group}</Text>
                      <Text style={styles.listRowScore}>{p.score}/{p.total}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {!weekDaily.length && !weekPractice.length ? <Text style={styles.noData}>No MCQ sets attempted this week.</Text> : null}
            </Card>

            <Text style={styles.footerNote}>Everything you study, test and practice is recorded automatically — your mentor sees the same weekly record.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: 44 },
  // hero
  hero: { borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  eyebrow: { color: 'rgba(255,255,255,0.75)', fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  weekNavRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  navBtn: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  navBtnOff: { opacity: 0.3 },
  weekBig: { color: '#fff', fontSize: 21, fontWeight: '900' },
  weekRange: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  heroStats: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, marginTop: spacing.lg, paddingVertical: spacing.md },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { color: '#fff', fontSize: 16, fontWeight: '900' },
  heroStatLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 7.5, fontWeight: '800', letterSpacing: 0.6, marginTop: 3 },
  heroDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.2)' },
  sampleChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.md, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 10, alignSelf: 'center' },
  sampleChipText: { color: '#fff', fontSize: 8.5, fontWeight: '800', letterSpacing: 0.4 },
  // empty
  emptyCard: { alignItems: 'center', padding: spacing.xl, gap: 8 },
  emptyTitle: { fontSize: 14, fontWeight: '900', color: colors.ink },
  emptyText: { fontSize: 11.5, color: colors.muted, textAlign: 'center', lineHeight: 17 },
  // cards
  card: { padding: spacing.lg, marginBottom: spacing.md, gap: spacing.md },
  studyHead: { flexDirection: 'row', alignItems: 'center' },
  studyBig: { fontSize: 30, fontWeight: '900', color: colors.ink },
  studySub: { fontSize: 11.5, color: colors.muted, marginTop: 3 },
  studyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  // bars
  barRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 100, paddingHorizontal: 2 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  barValue: { fontSize: 7.5, fontWeight: '800', color: colors.inkSoft },
  bar: { width: 16, borderRadius: 7 },
  barLabel: { fontSize: 9, fontWeight: '800', color: colors.muted },
  // subject chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  subjectChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.canvas, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  subjectChipText: { fontSize: 10.5, fontWeight: '800', color: colors.inkSoft },
  // tests
  testRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  testIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  testTitle: { fontSize: 13, fontWeight: '800', color: colors.ink },
  testMeta: { fontSize: 10.5, color: colors.muted, marginTop: 2 },
  scoreBadge: { alignItems: 'center', borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, minWidth: 64 },
  scoreBadgeValue: { fontSize: 13.5, fontWeight: '900' },
  scoreBadgePct: { fontSize: 9, fontWeight: '800', marginTop: 1 },
  scoreBadgeDue: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.border },
  scoreBadgeDueText: { fontSize: 9.5, fontWeight: '800', color: colors.muted },
  // mcq
  mcqHead: { flexDirection: 'row', alignItems: 'center' },
  mcqBig: { fontSize: 30, fontWeight: '900', color: colors.ink },
  progressTrack: { height: 10, borderRadius: 5, backgroundColor: colors.canvas, overflow: 'hidden' },
  progressFill: { height: 10, borderRadius: 5 },
  listBlock: { gap: 7 },
  miniTitle: { fontSize: 9.5, fontWeight: '900', color: colors.muted, letterSpacing: 0.7, textTransform: 'uppercase' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listRowName: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.ink },
  listRowScore: { fontSize: 12.5, fontWeight: '900', color: colors.inkSoft },
  noData: { fontSize: 12, color: colors.muted, fontStyle: 'italic' },
  footerNote: { fontSize: 10.5, color: colors.muted, textAlign: 'center', lineHeight: 16, marginTop: spacing.sm },
});
