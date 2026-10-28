import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { PrivateProofViewer } from '../components/PrivateProofViewer';
import { isPrivateProofLink, loadPrivateProof, type PrivateProof } from '../services/privateProof';
import { Alert, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, EmptyState, ErrorBanner } from '../components/ui';
import { LeaveAbsentCard } from '../components/LeaveAbsentCard';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { colors, radius, spacing } from '../theme';
import { api } from '../api/client';
import type { AttendanceStatus, StudyLog } from '../types';

/** A real study-log row, or a self-reported absent day (owner spec 28-Oct-2026: students
 * must see their absent marks in Recent sessions and be able to remove them). */
type TrackerRow = ({ kind: 'log' } & StudyLog) | { kind: 'absent'; date: string; reason: string };

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

const LogRow = ({ item, canDelete, onDelete, onView }: { item: StudyLog; canDelete: boolean; onDelete: () => void; onView: () => void }) => (
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
      <Pressable onPress={onView} hitSlop={10}><Ionicons name="open-outline" size={20} color={colors.primary} /></Pressable>
    ) : null}
    {canDelete ? (
      <Pressable onPress={onDelete} hitSlop={10} style={styles.deleteBtn}>
        <Ionicons name="trash-outline" size={18} color={colors.red} />
      </Pressable>
    ) : null}
  </Card>
);

/** Self-reported absent day as a Recent-sessions row. The trash button un-marks it
 * (attendance.cancelLeave with a date) so a wrong tap can be undone by the student. */
const AbsentRow = ({ date, reason, onRemove, removing }: { date: string; reason: string; onRemove: () => void; removing: boolean }) => (
  <Card style={[styles.logCard, styles.absentCard]}>
    <View style={[styles.dateTile, styles.absentTile]}>
      <Text style={[styles.dateDay, styles.absentTileText]}>{new Date(`${date}T00:00:00`).getDate() || '—'}</Text>
      <Text style={[styles.dateMonth, styles.absentTileText]}>{new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}</Text>
    </View>
    <View style={styles.logBody}>
      <Text style={styles.absentLabel}>Absent</Text>
      <Text style={styles.logDate}>{niceDate(date)}{reason ? ` · ${reason}` : ''}</Text>
      <Text style={styles.absentHint}>Marked by you — your mentor sees this day as "Absent"</Text>
    </View>
    <Pressable onPress={onRemove} hitSlop={10} style={styles.deleteBtn} disabled={removing} accessibilityLabel="Remove absent mark">
      <Ionicons name="trash-outline" size={18} color={colors.red} />
    </Pressable>
  </Card>
);

export const TrackerScreen = () => {
  const navigation = useNavigation<any>();
  const { backendMode, student } = useAuth();
  const [proof,setProof]=useState<PrivateProof|null>(null);
  useEffect(()=>{setProof(null);},[student?.studentId]);
  const viewProof=async(value:string)=>{
    try {
      if(isPrivateProofLink(value)){setProof(await loadPrivateProof(value));return;}
      const url=new URL(value);if(url.protocol!=='https:' || url.username || url.password) throw Error('Invalid proof link.');
      await Linking.openURL(url.toString()); // Legacy public records unchanged; no credentials sent.
    }catch{Alert.alert('Proof unavailable','Sign in again or ask your mentor to check access.');}
  };
  const { data, error, refreshing, refreshTracker, deleteStudyLog } = useData();
  const stats = data.stats;
  const canSubmit = backendMode !== 'live-readonly';

  // Self-reported absent marks also appear as rows in this list,
  // and the student can remove them with the trash button (owner spec 28-Oct-2026).
  const [attendance, setAttendance] = useState<AttendanceStatus | null>(null);
  const [removingAbsent, setRemovingAbsent] = useState(false);
  const loadAttendance = React.useCallback(async () => {
    if (backendMode !== 'live' || !student?.studentId) { setAttendance(null); return; }
    try { setAttendance(await api.getAttendanceStatus(student.studentId)); }
    catch { /* status card handles its own error; list keeps showing logs */ }
  }, [backendMode, student?.studentId]);
  useEffect(() => { void loadAttendance(); }, [loadAttendance, data.studyLog.length]);
  // Card se mark/remove karne ke turant baad bhi list sync rahe.
  useFocusEffect(React.useCallback(() => { void loadAttendance(); }, [loadAttendance]));

  const absentRows: TrackerRow[] = (attendance?.recentAbsent || [])
    .map((row) => ({ kind: 'absent' as const, date: row.date, reason: row.reason }));
  const rows: TrackerRow[] = [
    ...data.studyLog.map((log) => ({ kind: 'log' as const, ...log })),
    ...absentRows,
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const removeAbsent = (date: string) => {
    if (!student?.studentId) return;
    Alert.alert('Remove absent mark?', `The absent mark for ${niceDate(date)} will be removed — your mentor will see this day as normal again.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setRemovingAbsent(true);
        try {
          await api.removeAbsent(student.studentId, date);
          await loadAttendance();
        } catch (err) {
          Alert.alert('Could not remove', err instanceof Error ? err.message : 'Try again.');
        } finally { setRemovingAbsent(false); }
      }},
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={rows}
        keyExtractor={(item, index) => `${item.kind}-${item.date}-${index}`}
        renderItem={({ item }) => item.kind === 'absent' ? (
          <AbsentRow
            date={item.date}
            reason={item.reason}
            removing={removingAbsent}
            onRemove={() => removeAbsent(item.date)}
          />
        ) : (
          <LogRow
            item={item}
            canDelete={canSubmit}
            onView={()=>void viewProof(item.proof!)}
            onDelete={() => {
              Alert.alert('Delete this entry?', `${niceDate(item.date)} · ${format(item.hours)}h`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => deleteStudyLog({ date: item.date, hours: item.hours, topic: item.topic || '' }).catch((err) => {
                    Alert.alert('Could not delete', err instanceof Error ? err.message : 'Try again.');
                  }),
                },
              ]);
            }}
          />
        )}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshTracker().catch(() => undefined)} colors={[colors.primary]} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View><Text style={styles.eyebrow}>CONSISTENCY HUB</Text><Text style={styles.title}>Study tracker</Text></View>
              {canSubmit ? <Pressable style={styles.addTop} onPress={() => navigation.navigate('AddStudyLog')}>
                <Ionicons name="add" size={25} color={colors.surface} />
              </Pressable> : <View style={styles.readOnlyPill}><Ionicons name="lock-closed" size={12} color={colors.success} /><Text style={styles.readOnlyPillText}>READ ONLY</Text></View>}
            </View>
            {error ? <ErrorBanner message={error} onRetry={() => refreshTracker().catch(() => undefined)} /> : null}
            {backendMode === 'live-readonly' ? <View style={styles.readOnlyBanner}><Ionicons name="shield-checkmark-outline" size={18} color={colors.success} /><Text style={styles.readOnlyBannerText}>Real tracker history is visible, but adding or changing backend records is disabled.</Text></View> : null}
            <Card style={styles.summaryCard}>
              <Summary icon="checkmark-done-outline" label="Sessions" value={String(stats.totalEntries ?? '—')} />
              <View style={styles.divider} />
              <Summary icon="time-outline" label="Total hrs" value={format(stats.totalHours)} />
              <View style={styles.divider} />
              <Summary icon="trending-up-outline" label="Average" value={format(stats.averageHours)} />
            </Card>
            {canSubmit ? <LeaveAbsentCard onChanged={() => void loadAttendance()} /> : null}
            <View style={styles.listHeader}><Text style={styles.listTitle}>Recent sessions</Text><Text style={styles.listCount}>{rows.length} entries</Text></View>
          </>
        }
        ListEmptyComponent={<EmptyState icon="book-outline" title="No study sessions yet" message="Log your first focused session and start building your consistency streak." />}
        ListFooterComponent={<View style={styles.footerSpace} />}
      />
      {canSubmit ? <Pressable style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.96 }] }]} onPress={() => navigation.navigate('AddStudyLog')}>
        <Ionicons name="add" size={25} color={colors.surface} /><Text style={styles.fabText}>Log hours</Text>
      </Pressable> : null}
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
  readOnlyPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.tealSoft, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 7 },
  readOnlyPillText: { color: colors.success, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  readOnlyBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.tealSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  readOnlyBannerText: { flex: 1, color: colors.inkSoft, fontSize: 9, lineHeight: 14 },
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
  deleteBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  absentCard: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  absentTile: { backgroundColor: colors.redSoft || '#FEE2E2' },
  absentTileText: { color: colors.red },
  absentLabel: { fontSize: 14, fontWeight: '900', color: colors.red },
  absentHint: { fontSize: 11, color: colors.muted, marginTop: 2 },
  footerSpace: { height: 40 },
  fab: { position: 'absolute', right: spacing.lg, bottom: 22, height: 54, borderRadius: 27, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primary, shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 7 },
  fabText: { color: colors.surface, fontWeight: '900', fontSize: 14 },
});
