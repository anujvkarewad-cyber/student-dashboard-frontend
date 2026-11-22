import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, TextInput, View, ScrollView } from 'react-native';
import { Card, PrimaryButton } from './ui';
import { useAuth } from '../context/AuthContext';
import { useFocusTimer } from '../context/FocusTimerContext';
import { smartTargetRequest, type SmartDashboard, type SmartProgress, type SmartDay, type SmartBinding, type CloudChapter } from '../services/smartTargets';
import { fetchTargetPlanDays, type PlanDay } from '../api/reformApi';
import { colors, radius, spacing } from '../theme';

const Action = ({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.action, disabled && { opacity: 0.45 }]}>
    <Text style={styles.actionText}>{label}</Text>
  </Pressable>
);

/** A finished day whose completion landed on a later date than nominally planned consumed a backup day. */
const isBackupDay = (d: SmartDay) => Boolean(d.completedOn && d.completedOn.slice(0, 10) !== d.nominalDate);

function useSmartDashboard() {
  const { student, backendMode } = useAuth();
  const [data, setData] = useState<SmartDashboard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = useRef(student?.studentId);
  owner.current = student?.studentId;
  const load = useCallback(async () => {
    const id = student?.studentId;
    if (!id) return;
    try {
      const result = await smartTargetRequest<SmartDashboard>(id, 'dashboard');
      if (owner.current === id) { setData(result); setError(''); }
    } catch (e) { if (owner.current === id) setError(e instanceof Error ? e.message : 'Saved progress unavailable.'); }
  }, [student?.studentId]);
  useFocusEffect(useCallback(() => {
    setData(null); setError(''); setBusy(false); void load();
    const istDay = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
    let lastDay = istDay();
    const clock = setInterval(() => { const day = istDay(); if (day !== lastDay) { lastDay = day; void load(); } }, 30000);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { clearInterval(clock); foreground.remove(); };
  }, [load]));
  const run = async (action: string, payload: Record<string, unknown>) => {
    const id = student?.studentId;
    if (!id || busy) return;
    setBusy(true); setError('');
    try { await smartTargetRequest(id, action, payload, backendMode === 'live'); await load(); }
    catch (e) { if (owner.current === id) setError(e instanceof Error ? e.message : 'Not saved. Please retry.'); }
    finally { if (owner.current === id) setBusy(false); }
  };
  return { data: data?.studentId === student?.studentId ? data : null, error, busy, load, run, student, backendMode };
}

const DayChip = ({ d, isCurrent, isViewed, onPress }: { d: SmartDay; isCurrent: boolean; isViewed: boolean; onPress: () => void }) => {
  const state = d.done ? 'done' : isCurrent ? 'current' : 'locked';
  const backup = isBackupDay(d);
  const label = state === 'done'
    ? `Day ${d.day} complete`
    : state === 'current'
      ? `Day ${d.day} — today's target`
      : `Day ${d.day} is locked`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.dayChip, state === 'done' && styles.dayChipDone, state === 'current' && styles.dayChipCurrent, backup && styles.dayChipBackup, isViewed && styles.dayChipViewed]}
    >
      {backup ? <View style={styles.dayChipDot} /> : null}
      {state === 'done' ? <Ionicons name="checkmark" size={11} color="#FFF" style={styles.dayChipIcon} /> : null}
      {state === 'locked' ? <Ionicons name="lock-closed" size={10} color={colors.muted} style={styles.dayChipIcon} /> : null}
      <Text style={[styles.dayChipNum, state !== 'locked' && { color: '#FFF' }]}>{d.day}</Text>
      {state === 'current' ? <Text style={styles.dayChipCaption}>Today</Text> : null}
    </Pressable>
  );
};

const TaskRow = ({ task: t, actions }: { task: SmartDay['tasks'][number]; actions?: React.ReactNode }) => (
  <View style={styles.taskRow}>
    <View style={[styles.check, t.done && styles.checkDone]}>
      {t.done ? <Ionicons name="checkmark" size={15} color="#FFF" /> : null}
    </View>
    <View style={styles.taskCopy}>
      <Text style={[styles.taskLabel, t.done && styles.taskLabelDone]}>{t.subject} · {t.topic}</Text>
      <Text style={styles.taskDetail}>{t.mandatory ? 'Mandatory' : 'Optional'}{t.hours ? ` · ${t.hours}h planned` : ''}</Text>
      {actions ? <View style={styles.taskActions}>{actions}</View> : null}
    </View>
  </View>
);

const Nudge = ({ icon, title, text, tone = 'amber' }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string; tone?: 'amber' | 'teal' }) => (
  <View style={[styles.nudge, tone === 'teal' && styles.nudgeTeal]}>
    <Ionicons name={icon} size={20} color={tone === 'teal' ? colors.success : colors.amber} />
    <View style={{ flex: 1 }}>
      <Text style={styles.nudgeTitle}>{title}</Text>
      <Text style={styles.nudgeText}>{text}</Text>
    </View>
  </View>
);

function PlanProgress({ progress: p, busy, run, study }: { progress: SmartProgress; busy: boolean; run: (action: string, payload: Record<string, unknown>) => Promise<void>; study: (binding: SmartBinding) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('1');
  const [extOpen, setExtOpen] = useState(false);
  const [viewed, setViewed] = useState<number | null>(null);
  const [gateDay, setGateDay] = useState<number | null>(null);
  const pending = p.extensions.some(e => e.status === 'pending');
  const retry = useRef<{ fingerprint: string; id: string } | null>(null);
  const request = async () => {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 60 || reason.trim().length < 3) return;
    const fingerprint = `${n}:${reason.trim()}`;
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, id: `extension-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` };
    await run('extension', { planId: p.planId, days: n, reason: reason.trim(), requestId: retry.current.id });
  };

  const current = p.days.find(d => d.day === p.currentDay);
  const fallback = current ?? p.days[p.days.length - 1];
  const selected = viewed == null ? fallback : p.days.find(d => d.day === viewed) ?? fallback;
  const viewingPast = Boolean(selected && selected.done && selected.day !== p.currentDay);
  const onChipPress = (d: SmartDay) => {
    setGateDay(null);
    if (d.done || d.day === p.currentDay) setViewed(d.day);
    else setGateDay(d.day);
  };

  return <View>
    <Text style={styles.planTitle}>{p.name}</Text>
    <Text style={styles.planSub}>{p.complete ? 'Plan complete' : `Day ${p.currentDay} of ${p.totalDays}`} · {p.completedDays}/{p.totalDays} days · {p.completedTasks}/{p.totalTasks} tasks</Text>
    <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${p.progressPercent}%` }]} /></View>
    <Text style={styles.progressLabel}>{p.progressPercent}% complete</Text>
    <Text style={styles.planMeta}>Started {p.startDate} · Deadline {p.deadline}</Text>

    {p.backupDaysUsed > 0 && (
      <Nudge icon="information-circle" title={`${p.backupDaysUsed} backup day(s) used`}
        text={`${p.backupDaysRemaining} of ${p.includedBackupDays} are still left — the plan shifted, nothing was lost.`} />
    )}
    {!p.complete && current && !p.canWork && (
      <Nudge icon="time" title={p.extensionDaysNeeded ? 'Extension needed' : 'Closed for today'}
        text={p.extensionDaysNeeded
          ? `At least ${p.extensionDaysNeeded} extra day(s). Saved work is unchanged.`
          : `Next day opens on ${current.scheduledDate} IST. Your revisions below remain open.`} />
    )}
    {p.complete && (
      <Nudge tone="teal" icon="trophy" title="Plan complete"
        text={`You worked ${p.completedDays} days in total. Early finish or backup — both are a win.`} />
    )}

    {p.days.length > 0 && !p.complete && <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
        {p.days.map(d => (
          <DayChip key={d.day} d={d} isCurrent={d.day === p.currentDay} isViewed={viewed === d.day && viewingPast} onPress={() => onChipPress(d)} />
        ))}
      </ScrollView>

      {gateDay != null && (
        <Nudge icon="lock-closed" title={`Day ${gateDay} is locked`}
          text={`Finish Day ${p.currentDay} first — Day ${gateDay} unlocks only after that.`} />
      )}

      {selected && <>
        <Text style={styles.selectedTitle}>
          {viewingPast ? `Day ${selected.day} · Done` : `Day ${selected.day} · Today's targets`}
        </Text>
        {viewingPast && (
          <Nudge tone="teal" icon="checkmark-circle"
            title={`${selected.tasks.filter(t => t.done).length}/${selected.tasks.length} done`}
            text={isBackupDay(selected) ? 'A backup day was used — that is why the date shifted.' : `Completed ${selected.completedOn ? selected.completedOn.slice(0, 10) : ''}`} />
        )}
        {selected.tasks.map(t => (
          <TaskRow key={t.id} task={t} actions={!t.done && !viewingPast && selected.day === p.currentDay ? <>
            <PrimaryButton label="Start on Timer" variant="secondary" icon="timer-outline" disabled={busy || !p.canWork} onPress={() => void study({ ownerId: p.studentId, planId: p.planId, taskId: t.id, subject: t.subject, concept: t.topic })} style={styles.miniBtn} />
            <PrimaryButton label="Mark complete" disabled={busy || !p.canWork} onPress={() => void run('complete', { planId: p.planId, taskId: t.id })} style={styles.miniBtn} />
          </> : undefined} />
        ))}
        {viewingPast && <Text style={styles.readOnlyNote}>This day is done — view only.</Text>}
      </>}
    </>}

    {p.extensions.length > 0 && (
      <View style={{ marginTop: spacing.sm }}>
        {p.extensions.map(e => <Text key={e.id} style={styles.extLine}>Extension {e.status}: {e.status === 'approved' ? e.approvedDays : e.requestedDays} day(s){e.note ? ` · ${e.note}` : ''}</Text>)}
      </View>
    )}

    {!p.complete && !pending && (
      extOpen ? (
        <View style={styles.extBox}>
          <Text style={styles.extTitle}>Request extension</Text>
          <TextInput accessibilityLabel="Extension days" value={days} onChangeText={setDays} keyboardType="number-pad" style={styles.field} placeholder={`Days (recommended ${Math.max(1, p.extensionDaysNeeded)})`} placeholderTextColor={colors.muted} />
          <TextInput accessibilityLabel="Extension reason" value={reason} onChangeText={setReason} maxLength={300} style={styles.field} placeholder="Brief reason" placeholderTextColor={colors.muted} />
          <View style={styles.taskActions}>
            <PrimaryButton label="Send request" disabled={busy || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 60 || reason.trim().length < 3} onPress={() => void request()} style={styles.miniBtn} />
            <PrimaryButton label="Cancel" variant="secondary" onPress={() => setExtOpen(false)} style={styles.miniBtn} />
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setExtOpen(true)} style={styles.extToggle}>
          <Ionicons name="time-outline" size={14} color={colors.primary} />
          <Text style={styles.extToggleText}>Need more time? Send an extension request</Text>
        </Pressable>
      )
    )}
  </View>;
}

export const CloudRevisionList = ({ data, study }: { data: SmartDashboard['revisions']; study: (binding: SmartBinding) => Promise<void> }) => {
  const { student } = useAuth();
  const [showUpcoming, setShowUpcoming] = useState(false);
  const due = data.due;
  const future = data.chapters.filter(c => !due.some(r => r.revisionKey === c.revisionKey));
  const row = (chapter: CloudChapter, dueNow: boolean) => <View key={chapter.revisionKey} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 9, marginTop: 10 }}>
    <Text style={{ fontWeight: '600', color: colors.ink }}>{chapter.subject} · {chapter.concept}</Text>
    <Text style={styles.line}>{chapter.strength === 'average' ? 'Medium' : chapter.strength === 'strong' ? 'Strong' : 'Weak'} · mastery {chapter.accuracy}% · questions {chapter.questionAccuracy == null ? 'not measured' : `${chapter.questionAccuracy}% (${chapter.questionAttemptedTotal} attempted)`}</Text>
    <Text style={styles.line}>Due {chapter.dueOn}{dueNow ? chapter.suggestedToday ? ' · suggested today' : ' · additional due (still accessible)' : ''}</Text>
    <Text style={styles.line}>{chapter.lastAssessmentSource === 'student-reported-question-score' ? 'Latest score: student-reported' : 'Latest score: written grading'}</Text>
    {chapter.lastRevisionCompletedAt && <Text style={styles.line}>Last revision: {chapter.lastRevisionCompletedAt.slice(0, 10)}</Text>}
    {dueNow && student && <Action label="Start revision on Timer" onPress={() => void study({ ownerId: student.studentId, revisionKey: chapter.revisionKey, revisionVersion: chapter.revisionVersion, subject: chapter.subject, concept: chapter.concept })} />}
  </View>;
  return <Card><Text style={styles.title}>Chapter revision plan</Text><Text style={styles.line}>{due.length} due · workload budget {data.budgetMinutes} min · suggested {data.suggestedMinutes} min</Text><Text style={styles.line}>Target locks and extensions never cancel these revisions. Extra due work stays open; it is not automatically postponed.</Text>{due.map(c => row(c, true))}{due.length === 0 && <Text style={styles.line}>No revision due today. Chapter assessments schedule the next review.</Text>}{future.length > 0 && <Action label={`${showUpcoming ? 'Hide' : 'Show'} ${future.length} upcoming chapter dates`} onPress={() => setShowUpcoming(!showUpcoming)} />}{showUpcoming && future.map(c => row(c, false))}</Card>;
};

function useStudyLink() {
  const timer = useFocusTimer();
  const navigation = useNavigation<any>();
  const [studyError, setStudyError] = useState('');
  const study = async (binding: SmartBinding) => {
    try { await timer.bindTarget(binding); setStudyError(''); navigation.navigate('Main', { screen: 'Timer' }); }
    catch (e) { setStudyError(e instanceof Error ? e.message : 'Could not start timer.'); }
  };
  return { study, studyError };
}

/**
 * Mentor-published (calendar) plans, as a day strip.
 *
 * The "Smart Targets" dashboard above only ever loads plans published in
 * `personal` mode, and every live plan is published in `calendar` mode - so this
 * panel was blank for every student even though the mentor had a full day-wise
 * plan for their batch. Those plans live on /api/ai/target-plan-days, the same
 * endpoint DailyTargetScreen uses, so both screens always agree.
 *
 * Read-only here on purpose: ticking is owned by DailyTargetScreen, which knows
 * today's task list and posts to /api/targets/complete. This card's job is to
 * make the plan (and its sequential unlock) visible instead of silent.
 */
const CalendarPlanCard = () => {
  const navigation = useNavigation<any>();
  const [days, setDays] = useState<PlanDay[] | null>(null);
  const [error, setError] = useState('');
  const { student } = useAuth();

  const load = useCallback(async () => {
    if (!student?.studentId) return;
    const plan = await fetchTargetPlanDays(student.studentId);
    if (!plan) { setDays([]); return; }
    setDays(plan.days || []);
    setError('');
  }, [student?.studentId]);

  useFocusEffect(useCallback(() => {
    setError('');
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load your plan.'));
  }, [load]));

  if (error) return <Card><Text style={{ color: colors.red }}>{error}</Text><Action label="Reload mentor plan" onPress={() => void load()} /></Card>;
  if (!days) return <Card><ActivityIndicator accessibilityLabel="Loading mentor plan" /></Card>;
  if (!days.length) return null;   // no published plan: say nothing rather than show an empty shell

  const todayIso = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const isDayDone = (d: PlanDay) => d.tasks.length > 0 && d.tasks.every((t) => t.done);
  const doneCount = days.filter(isDayDone).length;
  const current = days.find((d) => d.isToday) || days.find((d) => d.date >= todayIso) || days[days.length - 1];

  // Sequential gate: a future day stays locked until every task of the day
  // before it is complete. Today and past days always open.
  const lockedIndexes = new Set<number>();
  days.forEach((d, i) => {
    if (d.isToday || d.date <= todayIso) return;
    const prev = days[i - 1];
    if (prev && !isDayDone(prev)) lockedIndexes.add(i);
  });

  return (
    <Card>
      <Text style={styles.title}>{current.planName || 'Mentor plan'}</Text>
      <Text style={styles.planSub}>
        {doneCount} of {days.length} days complete · day-wise plan for your batch
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.dayRow, { paddingTop: 4 }]}>
        {days.map((d, i) => {
          const done = isDayDone(d);
          const locked = lockedIndexes.has(i);
          const isCurrent = d.date === current.date;
          return (
            <View key={`${d.planId}|${d.day}|${d.date}`}
              style={[styles.dayChip,
                done && styles.dayChipDone,
                isCurrent && !done && styles.dayChipCurrent,
                locked && { opacity: 0.45 }]}>
              {locked ? <Ionicons name="lock-closed" size={10} color={colors.muted} style={styles.dayChipIcon} /> : null}
              {done ? <Ionicons name="checkmark" size={11} color="#FFF" style={styles.dayChipIcon} /> : null}
              <Text style={[styles.dayChipNum, (done || isCurrent) && { color: '#FFF' }]}>
                {d.day != null ? d.day : '—'}
              </Text>
              <Text style={[styles.dayChipCaption, { color: done || isCurrent ? '#FFF' : colors.muted }]}>
                {d.isToday ? 'Today' : new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </Text>
            </View>
          );
        })}
      </ScrollView>
      {current.tasks.length ? (
        <View style={{ marginTop: 2 }}>
          <Text style={styles.line}>
            {current.isToday ? "Today's checklist" : `Day ${current.day} checklist`} · {current.tasks.filter((t) => t.done).length}/{current.tasks.length} done
          </Text>
          {current.tasks.map((t) => (
            <View key={t.id} style={styles.dayRow}>
              <View style={[styles.check, t.done && { backgroundColor: colors.success, borderColor: colors.success }]}>
                {t.done ? <Ionicons name="checkmark" size={14} color="#FFF" /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.line, t.done && { textDecorationLine: 'line-through', color: colors.muted }]}>{t.label}</Text>
                {t.detail ? <Text style={styles.planMeta}>{t.detail}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <Action label="Open today's target to tick tasks" onPress={() => navigation.navigate('DailyTarget')} />
    </Card>
  );
};

export const SmartTargetsPanel = () => {
  const { data, error, busy, load, run } = useSmartDashboard();
  const { study, studyError } = useStudyLink();
  return <View style={{ gap: 12 }}>
    {(error || studyError) && <Card><Text style={{ color: colors.red }}>{error || studyError}</Text><Action label="Reload saved progress" onPress={() => void load()} /></Card>}
    {!data && !error && <ActivityIndicator accessibilityLabel="Loading personal targets" />}
    {data?.targetAccessError && <Card><Text style={{ color: colors.inkSoft }}>{data.targetAccessError} Saved plans are read-only until enrollment is verified. Your revisions remain accessible.</Text><Action label="Retry enrollment check" onPress={() => void load()} /></Card>}
    {data?.plans.map(p => <Card key={p.planId}>{p.progress ? <PlanProgress progress={p.progress} busy={busy} run={run} study={study} /> : <><Text style={styles.title}>{p.name}</Text><Text style={styles.line}>{p.totalDays} study days + {p.includedBackupDays} backup day(s). Day 1 begins when you start, not on the batch calendar.</Text><Action label={p.startAvailableOn > data.today ? `Available ${p.startAvailableOn}` : 'Start My Targets'} disabled={busy || p.startAvailableOn > data.today} onPress={() => void run('start', { planId: p.planId })} /></>}</Card>)}
    {/* Mentor-published calendar plans: the ones that actually exist for every batch. */}
    <CalendarPlanCard />
    {busy && <ActivityIndicator accessibilityLabel="Saving target progress" />}
    {data && data.history.length > 0 && <Card><Text style={styles.title}>Saved plan history (read-only)</Text>{data.history.map(h => <Text key={h.planId} style={styles.line}>{h.name}: {h.completedDays}/{h.totalDays} days · started {h.startDate}. Plan cancelled or audience changed; progress retained.</Text>)}</Card>}
  </View>;
};

export const SmartRevisionPanel = ({ onCloudChapters }: { onCloudChapters?: (chapters: CloudChapter[]) => void }) => {
  const { data, error, load } = useSmartDashboard();
  const { study, studyError } = useStudyLink();
  useEffect(() => { if (data && onCloudChapters) onCloudChapters(data.revisions.chapters); }, [data, onCloudChapters]);
  return <View style={{ marginVertical: 12 }}>{(error || studyError) && <Card><Text style={{ color: colors.red }}>{error || studyError}</Text><Action label="Retry saved revisions" onPress={() => void load()} /></Card>}{data ? <CloudRevisionList data={data.revisions} study={study} /> : !error && <ActivityIndicator />}</View>;
};


/** Home summary uses the same persisted state, not another checklist. */
export const SmartTargetHomeSummary = () => {
  const { data, error, busy, load, run } = useSmartDashboard();
  const navigation = useNavigation<any>();
  if (!data && !error) return null;
  if (error) return <Card><Text>Personal target status unavailable.</Text><Action label="Retry saved target status" onPress={() => void load()} /></Card>;
  if (!data || (!data.plans.length && !data.revisions.due.length && !data.targetAccessError)) return null;
  return <Card><Text style={styles.title}>My targets & revisions</Text>
    {data.targetAccessError && <Text style={styles.line}>{data.targetAccessError}</Text>}
    {data.plans.map(plan => { const p = plan.progress; const day = p?.days.find(d => d.day === p.currentDay); return <View key={plan.planId} style={{ marginTop: 8 }}>
      <Text style={{ fontWeight: '600', color: colors.ink }}>{plan.name}</Text>
      {p ? <>
        <Text style={styles.line}>{p.complete ? 'Complete' : `Day ${p.currentDay} of ${p.totalDays}`} · {p.progressPercent}% · {p.completedTasks}/{p.totalTasks} tasks</Text>
        <Text style={styles.line}>{day && !p.complete ? `${day.tasks.filter(t => !t.done && t.mandatory).length} mandatory task(s) pending · work date ${day.projectedDate}` : 'All mandatory days complete'}</Text>
        <Text style={styles.line}>{p.backupDaysRemaining} backup day(s) left · {p.extensions.filter(e => e.status === 'pending').length} extension request(s) pending</Text>
      </> : <Action label="Start My Targets" disabled={busy || plan.startAvailableOn > data.today} onPress={() => void run('start', { planId: plan.planId })} />}
    </View>; })}
    <Text style={styles.line}>{data.revisions.due.length} revision(s) due today. These stay open even when targets are locked.</Text>
    <Action label="Open / resume my target tracker" onPress={() => navigation.navigate('DailyTarget')} />
    <Action label="Open revisions" onPress={() => navigation.navigate('Main', { screen: 'Revision' })} />
  </Card>;
};

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800', color: colors.ink, letterSpacing: -0.25, marginBottom: 6 },
  line: { color: colors.inkSoft, fontSize: 13, lineHeight: 18, marginTop: 5 },
  action: { backgroundColor: colors.primary, padding: 11, borderRadius: radius.sm, marginTop: 8 },
  actionText: { color: '#FFF', fontWeight: '600' },
  field: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 9, marginTop: 8, color: colors.ink },

  planTitle: { fontSize: 19, fontWeight: '800', color: colors.ink, letterSpacing: -0.25 },
  planSub: { fontSize: 13, color: colors.inkSoft, marginTop: 4 },
  planMeta: { fontSize: 12, color: colors.muted, marginTop: 8 },
  progressBar: { height: 8, borderRadius: radius.pill, backgroundColor: colors.primarySoft, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.success },
  progressLabel: { fontSize: 11.5, fontWeight: '800', color: colors.success, marginTop: 4 },

  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2, marginTop: 10, gap: 8 },
  dayChip: {
    width: 54, height: 54, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dayChipDone: { backgroundColor: colors.success, borderColor: colors.success },
  dayChipCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipBackup: { borderStyle: 'dashed', borderWidth: 1.5 },
  dayChipViewed: { borderWidth: 2.5, borderColor: colors.primary, borderStyle: 'solid' },
  dayChipNum: { fontSize: 19, fontWeight: '800', color: colors.ink },
  dayChipCaption: { fontSize: 8, fontWeight: '700', color: '#FFF', marginTop: -2 },
  dayChipIcon: { position: 'absolute', top: 5, right: 5 },
  dayChipDot: { position: 'absolute', top: 5, left: 5, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.amber },

  selectedTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 12, marginBottom: 2 },
  taskRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8 },
  check: { width: 26, height: 26, borderRadius: 9, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: colors.success, borderColor: colors.success },
  taskCopy: { flex: 1 },
  taskLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },
  taskLabelDone: { textDecorationLine: 'line-through', color: colors.muted },
  taskDetail: { fontSize: 12, color: colors.muted, marginTop: 2 },
  taskActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  miniBtn: { minHeight: 40, borderRadius: radius.sm, paddingHorizontal: spacing.md, flex: 0 },
  readOnlyNote: { fontSize: 12, color: colors.muted, marginTop: 8, fontStyle: 'italic' },

  nudge: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.amberSoft, borderColor: colors.amber, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  nudgeTeal: { backgroundColor: colors.tealSoft, borderColor: colors.success },
  nudgeTitle: { fontSize: 13.5, fontWeight: '900', color: colors.ink },
  nudgeText: { fontSize: 12, color: colors.inkSoft, marginTop: 2, lineHeight: 17 },

  extLine: { fontSize: 12, color: colors.muted, marginTop: 4 },
  extToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  extToggleText: { color: colors.primary, fontSize: 12.5, fontWeight: '700' },
  extBox: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  extTitle: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
});
