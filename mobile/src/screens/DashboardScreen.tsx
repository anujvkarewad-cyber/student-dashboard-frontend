import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, ErrorBanner, InitialsAvatar, PrimaryButton, SectionHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { colors, radius, spacing } from '../theme';

const format = (value?: number, suffix = '') => value == null || Number.isNaN(Number(value)) ? '—' : `${Number(value).toFixed(1).replace('.0', '')}${suffix}`;

const Metric = ({ icon, label, value, tint, soft }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; tint: string; soft: string }) => (
  <Card style={styles.metric}>
    <View style={[styles.metricIcon, { backgroundColor: soft }]}><Ionicons name={icon} size={21} color={tint} /></View>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </Card>
);

const Action = ({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
    <View style={styles.actionIcon}><Ionicons name={icon} size={22} color={colors.primary} /></View>
    <Text style={styles.actionLabel}>{label}</Text>
    <Ionicons name="chevron-forward" size={17} color={colors.muted} />
  </Pressable>
);

export const DashboardScreen = () => {
  const navigation = useNavigation<any>();
  const { student } = useAuth();
  const { data, loading, refreshing, error, refreshAll, dismissFeedback } = useData();
  const [feedbackVisible, setFeedbackVisible] = useState(true);
  const feedback = data.feedback[0];
  const stats = data.stats;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const maxBar = Math.max(...(stats.last7 || [1]), 1);
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const closeFeedback = async () => {
    setFeedbackVisible(false);
    if (feedback) dismissFeedback(feedback.id).catch(() => undefined);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshAll().catch(() => undefined)} colors={[colors.primary]} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>{greeting}</Text>
            <Text style={styles.name}>{student?.studentName?.split(' ')[0] || 'Student'} 👋</Text>
          </View>
          <Pressable style={styles.avatarButton} onPress={() => navigation.navigate('Profile')}>
            <InitialsAvatar name={student?.studentName || 'Student'} size={46} />
            <View style={styles.onlineDot} />
          </Pressable>
        </View>

        {error ? <ErrorBanner message={error} onRetry={() => refreshAll().catch(() => undefined)} /> : null}
        {loading && !stats.totalEntries ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}

        <LinearGradient colors={['#18376C', '#3157D5', '#5D55D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroGlowOne} />
          <View style={styles.heroGlowTwo} />
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroLabel}>THIS WEEK</Text>
              <Text style={styles.heroHours}>{format(stats.weeklyHours)}<Text style={styles.heroUnit}> hrs</Text></Text>
              <Text style={styles.heroMeta}>of {student?.targetHours || 70} hour target</Text>
            </View>
            <View style={styles.streakPill}>
              <Ionicons name="flame" size={18} color="#FFD36D" />
              <Text style={styles.streakText}>{stats.streak || 0} day streak</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, ((stats.weeklyHours || 0) / (student?.targetHours || 70)) * 100)}%` }]} />
          </View>
          <View style={styles.heroBottom}>
            <Text style={styles.heroBottomText}>Keep the momentum going</Text>
            <View style={styles.rankPill}><Ionicons name="trophy" size={14} color="#FFD36D" /><Text style={styles.rankText}>Rank #{stats.rank || '—'}</Text></View>
          </View>
        </LinearGradient>

        <View style={styles.metricGrid}>
          <Metric icon="today-outline" label="Today" value={format(stats.todayHours, 'h')} tint={colors.teal} soft={colors.tealSoft} />
          <Metric icon="calendar-outline" label="This month" value={format(stats.monthlyHours, 'h')} tint={colors.purple} soft={colors.purpleSoft} />
          <Metric icon="time-outline" label="All-time" value={format(stats.totalHours, 'h')} tint={colors.primary} soft={colors.primarySoft} />
          <Metric icon="analytics-outline" label="Daily average" value={format(stats.averageHours, 'h')} tint={colors.amber} soft={colors.amberSoft} />
        </View>

        <SectionHeader title="Quick actions" />
        <Card style={styles.actionsCard}>
          <Action icon="add-circle-outline" label="Log study hours" onPress={() => navigation.navigate('Tracker')} />
          <View style={styles.actionDivider} />
          <Action icon="document-text-outline" label="Weekly reports" onPress={() => navigation.navigate('Reports')} />
          <View style={styles.actionDivider} />
          <Action icon="folder-open-outline" label="Study material" onPress={() => navigation.navigate('Notes')} />
        </Card>

        <SectionHeader title="7-day rhythm" />
        <Card style={styles.chartCard}>
          <View style={styles.chartRow}>
            {(stats.last7 || [0, 0, 0, 0, 0, 0, 0]).map((hours, index) => (
              <View key={`${index}-${hours}`} style={styles.barColumn}>
                <Text style={styles.barValue}>{format(hours)}</Text>
                <View style={styles.barTrack}>
                  <LinearGradient colors={['#6D67E4', colors.primary]} style={[styles.bar, { height: Math.max(7, (hours / maxBar) * 94) }]} />
                </View>
                <Text style={styles.barLabel}>{dayLabels[index]}</Text>
              </View>
            ))}
          </View>
        </Card>

        <SectionHeader title="Announcements" />
        <Card style={styles.listCard}>
          {data.announcements.length ? data.announcements.slice(0, 3).map((item, index) => (
            <View key={`${item.title}-${index}`} style={[styles.newsItem, index < data.announcements.slice(0, 3).length - 1 && styles.newsBorder]}>
              <View style={styles.newsDot} />
              <View style={styles.newsBody}>
                <View style={styles.newsTop}><Text style={styles.newsTitle}>{item.title}</Text><Text style={styles.newsDate}>{item.date}</Text></View>
                <Text style={styles.newsText}>{item.message || item.body}</Text>
              </View>
            </View>
          )) : <Text style={styles.emptyText}>No announcements right now.</Text>}
        </Card>

        <SectionHeader title="Mentor's corner" />
        <Card style={styles.mentorCard}>
          <View style={styles.mentorHeader}>
            <View style={styles.mentorAvatar}><Text style={styles.mentorInitials}>UP</Text></View>
            <View><Text style={styles.mentorName}>Ujjwal Pathak</Text><Text style={styles.mentorRole}>Your mentor</Text></View>
          </View>
          <Ionicons name="chatbox-ellipses" size={25} color={colors.primary} style={styles.quoteIcon} />
          <Text style={styles.mentorText}>{data.mentorNotes[0]?.note || 'Your mentor’s guidance will appear here.'}</Text>
          {data.mentorNotes[0]?.date ? <Text style={styles.mentorDate}>{data.mentorNotes[0].date}</Text> : null}
        </Card>
      </ScrollView>

      <Modal visible={Boolean(feedback && feedbackVisible)} transparent animationType="fade" onRequestClose={closeFeedback}>
        <View style={styles.modalBackdrop}>
          <View style={styles.feedbackCard}>
            <View style={styles.feedbackIcon}><Ionicons name="mail-unread-outline" size={26} color={colors.primary} /></View>
            <Text style={styles.feedbackTitle}>Message from your mentor</Text>
            <Text style={styles.feedbackMeta}>{feedback?.mentor || 'Ujjwal Pathak'} · {feedback?.date}</Text>
            <Text style={styles.feedbackMessage}>{feedback?.message}</Text>
            <PrimaryButton label="Got it" onPress={closeFeedback} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 110 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.lg },
  eyebrow: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  name: { color: colors.ink, fontSize: 25, fontWeight: '900', letterSpacing: -0.6, marginTop: 2 },
  avatarButton: { position: 'relative' },
  onlineDot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: colors.teal, borderWidth: 2, borderColor: colors.canvas, right: 0, bottom: 1 },
  loader: { marginBottom: spacing.md },
  hero: { borderRadius: radius.xl, padding: spacing.xl, overflow: 'hidden', marginBottom: spacing.lg },
  heroGlowOne: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.08)', right: -60, top: -80 },
  heroGlowTwo: { position: 'absolute', width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.06)', left: -30, bottom: -60 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLabel: { color: 'rgba(255,255,255,0.64)', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  heroHours: { color: colors.surface, fontSize: 40, fontWeight: '900', letterSpacing: -1.2, marginTop: 4 },
  heroUnit: { fontSize: 17, fontWeight: '700' },
  heroMeta: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(8,20,52,0.25)', paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill },
  streakText: { color: colors.surface, fontSize: 11, fontWeight: '800' },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)', marginTop: spacing.xl, overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 4, backgroundColor: '#76E6CD' },
  heroBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  heroBottomText: { color: 'rgba(255,255,255,0.68)', fontSize: 11 },
  rankPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rankText: { color: colors.surface, fontSize: 11, fontWeight: '800' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: spacing.xl },
  metric: { width: '48.5%', marginBottom: spacing.md, padding: spacing.md, shadowOpacity: 0.04 },
  metricIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  metricValue: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  metricLabel: { color: colors.muted, fontSize: 12, marginTop: 2, fontWeight: '600' },
  actionsCard: { padding: 0, overflow: 'hidden', marginBottom: spacing.xxl, shadowOpacity: 0.04 },
  action: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  actionPressed: { backgroundColor: colors.primarySoft },
  actionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  actionLabel: { color: colors.ink, fontSize: 14, fontWeight: '800', flex: 1 },
  actionDivider: { height: 1, backgroundColor: colors.border, marginLeft: 70 },
  chartCard: { marginBottom: spacing.xxl, shadowOpacity: 0.04 },
  chartRow: { height: 150, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  barColumn: { flex: 1, alignItems: 'center' },
  barValue: { color: colors.inkSoft, fontSize: 9, fontWeight: '700', marginBottom: 5 },
  barTrack: { height: 96, width: 13, borderRadius: 7, backgroundColor: colors.primarySoft, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: 13, borderRadius: 7 },
  barLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: 7 },
  listCard: { paddingVertical: 4, marginBottom: spacing.xxl, shadowOpacity: 0.04 },
  newsItem: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.lg },
  newsBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  newsDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
  newsBody: { flex: 1 },
  newsTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  newsTitle: { color: colors.ink, fontSize: 14, fontWeight: '800', flex: 1 },
  newsDate: { color: colors.muted, fontSize: 10 },
  newsText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  emptyText: { color: colors.muted, textAlign: 'center', paddingVertical: spacing.xl },
  mentorCard: { backgroundColor: '#F5F2FF', borderColor: '#E3DCFF', marginBottom: spacing.xxl, shadowOpacity: 0 },
  mentorHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mentorAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center' },
  mentorInitials: { color: colors.surface, fontWeight: '900' },
  mentorName: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  mentorRole: { color: colors.muted, fontSize: 11, marginTop: 2 },
  quoteIcon: { marginTop: spacing.lg },
  mentorText: { color: colors.inkSoft, fontSize: 14, lineHeight: 22, fontWeight: '600', marginTop: spacing.sm },
  mentorDate: { color: colors.muted, fontSize: 10, marginTop: spacing.md },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(10,25,49,0.55)', justifyContent: 'center', padding: spacing.xl },
  feedbackCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xxl },
  feedbackIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  feedbackTitle: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  feedbackMeta: { color: colors.muted, fontSize: 12, marginTop: spacing.xs },
  feedbackMessage: { color: colors.inkSoft, fontSize: 15, lineHeight: 23, marginVertical: spacing.xl },
});
