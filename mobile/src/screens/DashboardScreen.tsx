import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { BlurTargetView, BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { useDailyMcq } from '../context/DailyMcqContext';
import { useData } from '../context/DataContext';
import { AppNotification, NotificationType, useNotifications } from '../context/NotificationsContext';
import { useWeatherTheme } from '../hooks/useWeatherTheme';
import { colors, radius, spacing } from '../theme';
import { groupsForStudent } from '../utils/caGroups';

const format = (value?: number, suffix = '') => value == null || Number.isNaN(Number(value)) ? '—' : `${Number(value).toFixed(1).replace('.0', '')}${suffix}`;

const notificationVisual: Record<NotificationType, { icon: keyof typeof Ionicons.glyphMap; tint: string; soft: string }> = {
  announcement: { icon: 'megaphone', tint: colors.primary, soft: colors.primarySoft },
  mentor: { icon: 'chatbubble-ellipses', tint: colors.purple, soft: colors.purpleSoft },
  material: { icon: 'document-text', tint: colors.red, soft: colors.redSoft },
  report: { icon: 'analytics', tint: colors.teal, soft: colors.tealSoft },
  feedback: { icon: 'mail-unread', tint: '#B36A16', soft: colors.amberSoft },
  memory: { icon: 'refresh-circle', tint: colors.purple, soft: colors.purpleSoft },
  mcq: { icon: 'help-circle', tint: colors.primary, soft: colors.primarySoft },
};

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
  const { student, backendMode } = useAuth();
  const { data, loading, refreshing, error, refreshAll, dismissFeedback } = useData();
  const { todayAttempts: dailyMcqAttempts, streakForGroup } = useDailyMcq();
  const mcqGroups = groupsForStudent(student?.group);
  const completedMcqGroups = mcqGroups.filter((group) => dailyMcqAttempts.find((attempt) => attempt.group === group)?.completedAt).length;
  const activeMcq = dailyMcqAttempts.find((attempt) => mcqGroups.includes(attempt.group) && !attempt.completedAt);
  const allMcqComplete = completedMcqGroups === mcqGroups.length;
  const mcqStreak = Math.max(...mcqGroups.map((group) => streakForGroup(group)), 0);
  const { notifications, unreadCount, isRead, markRead, markAllRead } = useNotifications();
  const { weather, theme, loading: weatherLoading, weatherError, refreshWeather, isLive } = useWeatherTheme();
  const [feedbackVisible, setFeedbackVisible] = useState(true);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const heroTarget = useRef<View | null>(null);
  const feedback = data.feedback[0];
  const stats = data.stats;

  const maxBar = Math.max(...(stats.last7 || [1]), 1);
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const closeFeedback = async () => {
    setFeedbackVisible(false);
    if (feedback) dismissFeedback(feedback.id).catch(() => undefined);
  };

  const refreshDashboard = async () => {
    await Promise.allSettled([refreshAll(), refreshWeather()]);
  };

  const openNotification = async (item: AppNotification) => {
    await markRead(item.id);
    setNotificationsVisible(false);
    if (item.target === 'receipt' && item.sessionId) navigation.navigate('StudyReceipt', { sessionId: item.sessionId });
    else if (item.target === 'mcq') navigation.navigate('DailyMcq', item.group ? { group: item.group } : undefined);
    else if (item.target === 'reports') navigation.navigate('Reports');
    else if (item.target === 'notes') navigation.navigate('Notes');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <LinearGradient colors={[...theme.pageGradient]} style={StyleSheet.absoluteFill} />
      <View style={[styles.pageGlow, { backgroundColor: theme.glow }]} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshDashboard} colors={[colors.primary]} />}
      >
        <View style={styles.header}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>UP</Text></View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>UJJWAL PATHAK MENTORSHIP</Text>
            <Text style={styles.dashboardLabel}>Student dashboard</Text>
          </View>
          <Pressable style={styles.notificationButton} onPress={() => setNotificationsVisible(true)} accessibilityLabel="Open notifications popup">
            <Ionicons name="notifications-outline" size={21} color={colors.inkSoft} />
            {unreadCount ? <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text></View> : null}
          </Pressable>
          <Pressable style={styles.avatarButton} onPress={() => navigation.navigate('Profile')}>
            <InitialsAvatar name={student?.studentName || 'Student'} size={46} />
            <View style={styles.onlineDot} />
          </Pressable>
        </View>

        {error ? <ErrorBanner message={error} onRetry={() => refreshAll().catch(() => undefined)} /> : null}
        {loading && !stats.totalEntries ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}

        <View style={styles.hero}>
          <BlurTargetView ref={heroTarget} style={StyleSheet.absoluteFill}>
            <LinearGradient colors={[...theme.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={[styles.heroGlowOne, { backgroundColor: theme.glow }]} />
            <View style={styles.heroGlowTwo} />
            {theme.period === 'night' ? [0, 1, 2, 3, 4, 5, 6].map((star) => (
              <View key={star} style={[styles.star, { left: `${10 + star * 13}%`, top: 24 + (star % 3) * 25, opacity: 0.35 + (star % 2) * 0.3 }]} />
            )) : <View style={[styles.sun, { backgroundColor: theme.accent, shadowColor: theme.accent }]} />}
            <Image source={require('../../assets/cloud-large.png')} style={[styles.cloud, styles.cloudOne, { opacity: theme.kind === 'clear' ? 0.3 : 0.56 }]} />
            <Image source={require('../../assets/cloud-medium.png')} style={[styles.cloud, styles.cloudTwo, { opacity: theme.kind === 'clear' ? 0.22 : 0.48 }]} />
            <Image source={require('../../assets/cloud-small.png')} style={[styles.cloud, styles.cloudThree, { opacity: theme.kind === 'clear' ? 0.18 : 0.42 }]} />
            {(theme.kind === 'rain' || theme.kind === 'storm') ? [0, 1, 2, 3, 4, 5, 6, 7].map((drop) => (
              <View key={drop} style={[styles.rainDrop, { left: `${9 + drop * 12}%`, top: 90 + (drop % 3) * 19 }]} />
            )) : null}
          </BlurTargetView>

          <View style={styles.heroContent}>
            <View style={styles.weatherRow}>
              <Pressable onPress={refreshWeather} disabled={weatherLoading} style={styles.weatherPressable}>
                <BlurView blurTarget={heroTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={45} tint="dark" style={styles.weatherGlass}>
                  {weatherLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name={theme.icon} size={23} color={theme.accent} />}
                  <View style={styles.weatherCopy}>
                    <Text style={styles.temperature}>{weather ? `${Math.round(weather.temperature)}°` : theme.condition}</Text>
                    <Text style={styles.weatherMeta} numberOfLines={1}>{weather ? `${theme.condition} · ${weather.place}` : 'Tap for local weather'}</Text>
                  </View>
                  <Ionicons name="location" size={14} color="rgba(255,255,255,0.72)" />
                </BlurView>
              </Pressable>
              <BlurView blurTarget={heroTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={40} tint="dark" style={styles.livePill}>
                <View style={[styles.liveDot, !isLive && styles.timeDot]} />
                <Text style={styles.liveText}>{isLive ? 'LIVE' : 'TIME'}</Text>
              </BlurView>
            </View>

            <View style={styles.greetingBlock}>
              <Text style={styles.heroGreeting}>{theme.greeting},</Text>
              <Text style={styles.heroName}>{student?.studentName?.split(' ')[0] || 'Student'} 👋</Text>
              <Text style={styles.heroMessage}>{theme.message}</Text>
            </View>

            <BlurView blurTarget={heroTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={50} tint="dark" style={styles.progressGlass}>
              <View style={styles.progressTop}>
                <View>
                  <Text style={styles.heroLabel}>THIS WEEK</Text>
                  <Text style={styles.heroHours}>{format(stats.weeklyHours)}<Text style={styles.heroUnit}> hrs</Text></Text>
                </View>
                <View style={styles.heroStatsRight}>
                  <View style={styles.streakPill}><Ionicons name="flame" size={16} color="#FFD36D" /><Text style={styles.streakText}>{stats.streak || 0} days</Text></View>
                  <View style={styles.rankPill}><Ionicons name="trophy" size={13} color="#FFD36D" /><Text style={styles.rankText}>#{stats.rank || '—'}</Text></View>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(100, ((stats.weeklyHours || 0) / (student?.targetHours || 70)) * 100)}%`, backgroundColor: theme.accent }]} />
              </View>
              <View style={styles.heroBottom}>
                <Text style={styles.heroBottomText}>{student?.targetHours || 70} hour weekly target</Text>
                <Text style={styles.heroBottomText}>{Math.round(Math.min(100, ((stats.weeklyHours || 0) / (student?.targetHours || 70)) * 100))}% complete</Text>
              </View>
            </BlurView>

            {isLive ? <Text style={styles.weatherAttribution}>Weather by Open-Meteo · foreground location only</Text> : null}
            {weatherError && !weather ? <Text style={styles.weatherFallback}>{weatherError}</Text> : null}
          </View>
        </View>

        <View style={styles.metricGrid}>
          <Metric icon="today-outline" label="Today" value={format(stats.todayHours, 'h')} tint={colors.teal} soft={colors.tealSoft} />
          <Metric icon="calendar-outline" label="This month" value={format(stats.monthlyHours, 'h')} tint={colors.purple} soft={colors.purpleSoft} />
          <Metric icon="time-outline" label="All-time" value={format(stats.totalHours, 'h')} tint={colors.primary} soft={colors.primarySoft} />
          <Metric icon="analytics-outline" label="Daily average" value={format(stats.averageHours, 'h')} tint={colors.amber} soft={colors.amberSoft} />
        </View>

        <Pressable onPress={() => navigation.navigate('DailyMcq')} style={({ pressed }) => [styles.dailyChallenge, allMcqComplete && styles.dailyChallengeDone, pressed && styles.dailyChallengePressed]}>
          <View style={styles.dailyAccent} />
          <View style={[styles.dailyChallengeIcon, allMcqComplete && styles.dailyChallengeIconDone]}>
            <Ionicons name={allMcqComplete ? 'checkmark-done' : 'help-circle'} size={25} color={allMcqComplete ? colors.success : colors.primary} />
          </View>
          <View style={styles.dailyChallengeBody}>
            <View style={styles.dailyChallengeTop}>
              <Text style={styles.dailyChallengeEyebrow}>GROUP-WISE DAILY MCQ</Text>
              <View style={[styles.dailyStatus, allMcqComplete && styles.dailyStatusDone]}><Text style={[styles.dailyStatusText, allMcqComplete && styles.dailyStatusTextDone]}>{allMcqComplete ? 'DONE' : activeMcq ? 'IN PROGRESS' : 'READY'}</Text></View>
            </View>
            <Text style={styles.dailyChallengeTitle}>{allMcqComplete ? 'Both group challenges completed' : activeMcq ? `Continue ${activeMcq.group} challenge` : 'Group I & Group II challenges are ready'}</Text>
            <View style={styles.dailyMetaRow}>
              <View style={styles.dailyMeta}><Ionicons name="layers-outline" size={12} color={colors.primary} /><Text style={styles.dailyMetaText}>{completedMcqGroups}/{mcqGroups.length} groups done</Text></View>
              <View style={styles.dailyMeta}><Ionicons name="flame-outline" size={12} color={colors.amber} /><Text style={styles.dailyMetaText}>{mcqStreak} day streak</Text></View>
            </View>
          </View>
          <View style={[styles.dailyArrow, allMcqComplete && styles.dailyArrowDone]}><Ionicons name="arrow-forward" size={18} color={allMcqComplete ? colors.success : colors.primary} /></View>
        </Pressable>

        <SectionHeader title="Quick actions" />
        <Card style={styles.actionsCard}>
          <Action icon="help-circle-outline" label="Start today's Daily MCQ" onPress={() => navigation.navigate('DailyMcq')} />
          <View style={styles.actionDivider} />
          <Action icon="infinite-outline" label="Unlimited MCQ practice" onPress={() => navigation.navigate('McqPractice')} />
          <View style={styles.actionDivider} />
          <Action icon="timer-outline" label="Start focus timer" onPress={() => navigation.navigate('Focus')} />
          <View style={styles.actionDivider} />
          <Action icon={backendMode === 'mock' ? 'add-circle-outline' : 'eye-outline'} label={backendMode === 'mock' ? 'Log study hours' : 'View study history'} onPress={() => navigation.navigate('Tracker')} />
          <View style={styles.actionDivider} />
          <Action icon="trophy-outline" label="View leaderboard" onPress={() => navigation.navigate('Leaderboard')} />
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

      <Modal visible={notificationsVisible} transparent animationType="slide" onRequestClose={() => setNotificationsVisible(false)}>
        <View style={styles.notificationOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setNotificationsVisible(false)} accessibilityLabel="Close notifications popup" />
          <View style={styles.notificationSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View><Text style={styles.sheetTitle}>Notifications</Text><Text style={styles.sheetSubtitle}>{unreadCount ? `${unreadCount} unread update${unreadCount === 1 ? '' : 's'}` : 'You’re all caught up'}</Text></View>
              {unreadCount ? <Pressable onPress={() => markAllRead()} style={styles.sheetMarkAll}><Text style={styles.sheetMarkAllText}>Mark all read</Text></Pressable> : null}
            </View>

            <View style={styles.popupList}>
              {notifications.length ? notifications.slice(0, 5).map((item) => {
                const tone = notificationVisual[item.type];
                const read = isRead(item.id);
                return (
                  <Pressable key={item.id} onPress={() => openNotification(item)} style={({ pressed }) => [styles.popupItem, !read && styles.popupItemUnread, pressed && styles.popupItemPressed]}>
                    <View style={[styles.popupIcon, { backgroundColor: tone.soft }]}><Ionicons name={tone.icon} size={19} color={tone.tint} /></View>
                    <View style={styles.popupBody}>
                      <View style={styles.popupTitleRow}><Text style={[styles.popupTitle, !read && styles.popupTitleUnread]} numberOfLines={1}>{item.title}</Text>{!read ? <View style={styles.popupUnreadDot} /> : null}</View>
                      <Text style={styles.popupText} numberOfLines={2}>{item.body}</Text>
                      <Text style={styles.popupDate}>{item.date}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                  </Pressable>
                );
              }) : <View style={styles.popupEmpty}><Ionicons name="notifications-off-outline" size={28} color={colors.muted} /><Text style={styles.popupEmptyText}>No notifications yet</Text></View>}
            </View>

            <Pressable onPress={() => { setNotificationsVisible(false); navigation.navigate('Notifications'); }} style={styles.viewAllButton}>
              <Text style={styles.viewAllText}>View all notifications</Text><Ionicons name="arrow-forward" size={17} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      </Modal>

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
  pageGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 130, top: 150, right: -150, opacity: 0.34 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 110 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.md },
  brandMark: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)' },
  brandMarkText: { color: colors.primaryDark, fontSize: 13, fontWeight: '900' },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  dashboardLabel: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 2 },
  notificationButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.74)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', position: 'relative' },
  notificationBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.red, borderWidth: 2, borderColor: colors.canvas },
  notificationBadgeText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' },
  avatarButton: { position: 'relative' },
  onlineDot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: colors.teal, borderWidth: 2, borderColor: colors.canvas, right: 0, bottom: 1 },
  loader: { marginBottom: spacing.md },
  hero: { borderRadius: radius.xl, overflow: 'hidden', marginBottom: spacing.lg, minHeight: 370, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.2, shadowRadius: 24, elevation: 8 },
  heroContent: { minHeight: 370, padding: spacing.lg, justifyContent: 'space-between' },
  heroGlowOne: { position: 'absolute', width: 220, height: 220, borderRadius: 110, right: -70, top: -90 },
  heroGlowTwo: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.07)', left: -45, bottom: -70 },
  sun: { position: 'absolute', width: 74, height: 74, borderRadius: 37, right: 29, top: 72, opacity: 0.82, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.58, shadowRadius: 24, elevation: 7 },
  star: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  cloud: { position: 'absolute', resizeMode: 'contain' },
  cloudOne: { width: 215, height: 112, right: -58, top: 96 },
  cloudTwo: { width: 150, height: 82, left: -43, top: 156 },
  cloudThree: { width: 112, height: 63, right: 75, top: 184 },
  rainDrop: { position: 'absolute', width: 2, height: 13, borderRadius: 2, backgroundColor: 'rgba(210,240,255,0.62)', transform: [{ rotate: '14deg' }] },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  weatherPressable: { flex: 1 },
  weatherGlass: { minHeight: 58, borderRadius: 18, overflow: 'hidden', paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: 'rgba(10,25,49,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  weatherCopy: { flex: 1 },
  temperature: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  weatherMeta: { color: 'rgba(255,255,255,0.7)', fontSize: 9, marginTop: 2 },
  livePill: { height: 37, borderRadius: 19, overflow: 'hidden', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(10,25,49,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#6DE7C9' },
  timeDot: { backgroundColor: '#FFD36D' },
  liveText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  greetingBlock: { marginVertical: spacing.xl },
  heroGreeting: { color: 'rgba(255,255,255,0.78)', fontSize: 15, fontWeight: '600' },
  heroName: { color: '#FFFFFF', fontSize: 34, fontWeight: '900', letterSpacing: -1.1, marginTop: 1 },
  heroMessage: { color: 'rgba(255,255,255,0.76)', fontSize: 12, lineHeight: 18, maxWidth: '82%', marginTop: spacing.sm },
  progressGlass: { borderRadius: 20, overflow: 'hidden', padding: spacing.md, backgroundColor: 'rgba(8,20,48,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
  progressTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  heroLabel: { color: 'rgba(255,255,255,0.64)', fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  heroHours: { color: colors.surface, fontSize: 25, fontWeight: '900', letterSpacing: -0.7, marginTop: 2 },
  heroUnit: { fontSize: 12, fontWeight: '700' },
  heroStatsRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(8,20,52,0.2)', paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.pill },
  streakText: { color: colors.surface, fontSize: 9, fontWeight: '800' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: spacing.md, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  heroBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  heroBottomText: { color: 'rgba(255,255,255,0.64)', fontSize: 9 },
  rankPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(8,20,52,0.2)', paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.pill },
  rankText: { color: colors.surface, fontSize: 9, fontWeight: '800' },
  weatherAttribution: { color: 'rgba(255,255,255,0.48)', fontSize: 7, textAlign: 'center', marginTop: 6 },
  weatherFallback: { color: 'rgba(255,255,255,0.68)', fontSize: 8, textAlign: 'center', marginTop: spacing.sm },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: spacing.xl },
  metric: { width: '48.5%', marginBottom: spacing.md, padding: spacing.md, shadowOpacity: 0.04 },
  metricIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  metricValue: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  metricLabel: { color: colors.muted, fontSize: 12, marginTop: 2, fontWeight: '600' },
  dailyChallenge: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.xxl, backgroundColor: '#F0F2FF', borderWidth: 1, borderColor: '#DDE3FF', shadowColor: colors.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 3 },
  dailyChallengeDone: { backgroundColor: '#EBF9F5', borderColor: '#CCEFE5' },
  dailyChallengePressed: { opacity: 0.8, transform: [{ scale: 0.995 }] },
  dailyAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: colors.primary },
  dailyChallengeIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0E6FA', alignItems: 'center', justifyContent: 'center' },
  dailyChallengeIconDone: { backgroundColor: '#FFFFFF', borderColor: '#C7EADF' },
  dailyChallengeBody: { flex: 1, minWidth: 0 },
  dailyChallengeTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dailyChallengeEyebrow: { flex: 1, color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  dailyStatus: { borderRadius: radius.pill, backgroundColor: '#FFFFFF', paddingHorizontal: 7, paddingVertical: 4 },
  dailyStatusDone: { backgroundColor: colors.tealSoft },
  dailyStatusText: { color: colors.primary, fontSize: 6, fontWeight: '900', letterSpacing: 0.7 },
  dailyStatusTextDone: { color: colors.success },
  dailyChallengeTitle: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: '900', marginTop: 3 },
  dailyMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md, marginTop: 6 },
  dailyMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dailyMetaText: { color: colors.muted, fontSize: 8, fontWeight: '700' },
  dailyArrow: { width: 35, height: 35, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dailyArrowDone: { backgroundColor: colors.tealSoft },
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
  notificationOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(9,20,43,0.48)' },
  notificationSheet: { maxHeight: '78%', backgroundColor: 'rgba(248,250,255,0.98)', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl, borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)' },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#CBD3E1', alignSelf: 'center', marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.lg },
  sheetTitle: { color: colors.ink, fontSize: 21, fontWeight: '900', letterSpacing: -0.4 },
  sheetSubtitle: { color: colors.muted, fontSize: 10, marginTop: 3 },
  sheetMarkAll: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 8 },
  sheetMarkAllText: { color: colors.primary, fontSize: 9, fontWeight: '900' },
  popupList: { gap: spacing.sm },
  popupItem: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: 'transparent' },
  popupItemUnread: { backgroundColor: '#FFFFFF', borderColor: '#DCE4FA' },
  popupItemPressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  popupIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  popupBody: { flex: 1 },
  popupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  popupTitle: { flex: 1, color: colors.inkSoft, fontSize: 11, fontWeight: '700' },
  popupTitleUnread: { color: colors.ink, fontWeight: '900' },
  popupUnreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  popupText: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  popupDate: { color: colors.muted, fontSize: 7, fontWeight: '700', marginTop: 4 },
  popupEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
  popupEmptyText: { color: colors.muted, fontSize: 11 },
  viewAllButton: { minHeight: 48, marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primarySoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  viewAllText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(10,25,49,0.55)', justifyContent: 'center', padding: spacing.xl },
  feedbackCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xxl },
  feedbackIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  feedbackTitle: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  feedbackMeta: { color: colors.muted, fontSize: 12, marginTop: spacing.xs },
  feedbackMessage: { color: colors.inkSoft, fontSize: 15, lineHeight: 23, marginVertical: spacing.xl },
});
