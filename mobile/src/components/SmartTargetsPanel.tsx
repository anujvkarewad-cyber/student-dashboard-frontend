import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, AppState, Pressable, Text, TextInput, View } from 'react-native';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';
import { useFocusTimer } from '../context/FocusTimerContext';
import { smartTargetRequest, type SmartDashboard, type SmartProgress, type SmartBinding, type CloudChapter } from '../services/smartTargets';

const button = { backgroundColor: '#2354B8', padding: 11, borderRadius: 9, marginTop: 8 };
const field = { borderWidth: 1, borderColor: '#CAD2DF', borderRadius: 8, padding: 9, marginTop: 8, color: '#172B4D' };
const title = { fontSize: 18, fontWeight: '700' as const, color: '#172B4D', marginBottom: 6 };
const line = { color: '#41516B', marginTop: 5 };
const Action = ({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[button, disabled && { opacity: 0.45 }]}><Text style={{ color: '#FFF', fontWeight: '600' }}>{label}</Text></Pressable>;

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

function PlanProgress({ progress: p, busy, run, study }: { progress: SmartProgress; busy: boolean; run: (action: string, payload: Record<string, unknown>) => Promise<void>; study: (binding: SmartBinding) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('1');
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
  return <View>
    <Text style={title}>{p.name}</Text>
    <Text style={line}>{p.complete ? 'Plan complete' : `Day ${p.currentDay} of ${p.totalDays}`} · {p.completedDays}/{p.totalDays} days · {p.completedTasks}/{p.totalTasks} tasks</Text>
    <Text style={line}>Started {p.startDate} · {p.progressPercent}% complete</Text>
    <Text style={line}>Backup days: {p.backupDaysUsed} used / {p.includedBackupDays} included · {p.backupDaysRemaining} remaining</Text>
    <Text style={line}>Extensions: {p.extensionDaysUsed} used / {p.approvedExtensionDays} approved · {p.extensionDaysRemaining} remaining</Text>
    <Text style={line}>Deadline {p.deadline} · projected finish {p.projectedFinishDate}</Text>
    {!p.complete && current && <>
      <Text style={line}>Scheduled {current.scheduledDate} · work date {current.projectedDate}</Text>
      {!p.canWork && <Text style={{ color: '#A64817', marginTop: 8 }}>{p.extensionDaysNeeded ? `Extension needed: at least ${p.extensionDaysNeeded} extra day(s). Saved work is unchanged.` : `Next day opens on ${current.scheduledDate} IST. Your revisions below remain open.`}</Text>}
      {current.tasks.map(t => <View key={t.id} style={{ borderTopWidth: 1, borderColor: '#E1E6ED', marginTop: 12, paddingTop: 10 }}>
        <Text style={{ fontWeight: '600', color: '#172B4D' }}>{t.done ? '✓ ' : ''}{t.subject} · {t.topic}</Text>
        <Text style={line}>{t.mandatory ? 'Mandatory' : 'Optional'}{t.hours ? ` · ${t.hours}h planned` : ''}</Text>
        {!t.done && <>
          <Action label="Start / resume on Timer" disabled={busy || !p.canWork} onPress={() => void study({ ownerId: p.studentId, planId: p.planId, taskId: t.id, subject: t.subject, concept: t.topic })} />
          <Action label="Mark complete — self-confirmed" disabled={busy || !p.canWork} onPress={() => void run('complete', { planId: p.planId, taskId: t.id })} />
        </>}
      </View>)}
    </>}
    <Text style={[line, { fontWeight: '600', marginTop: 12 }]}>Sequence & dates</Text>
    {p.days.map(d => <Text key={d.day} style={line}>Day {d.day}: {d.done ? `completed ${d.completedOn}` : d.locked ? 'locked' : 'current'} · scheduled {d.scheduledDate}{d.projectedDate !== d.scheduledDate ? ` → ${d.projectedDate}` : ''}</Text>)}
    {p.extensions.map(e => <Text key={e.id} style={line}>Extension {e.status}: {e.status === 'approved' ? e.approvedDays : e.requestedDays} day(s){e.note ? ` · ${e.note}` : ''}</Text>)}
    {!p.complete && !pending && <View style={{ marginTop: 12 }}>
      <Text style={{ fontWeight: '600' }}>Request extension</Text>
      <TextInput accessibilityLabel="Extension days" value={days} onChangeText={setDays} keyboardType="number-pad" style={field} placeholder={`Days (recommended ${Math.max(1, p.extensionDaysNeeded)})`} />
      <TextInput accessibilityLabel="Extension reason" value={reason} onChangeText={setReason} maxLength={300} style={field} placeholder="Brief reason" />
      <Action label="Send extension request" onPress={() => void request()} disabled={busy || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 60 || reason.trim().length < 3} />
    </View>}
  </View>;
}

export const CloudRevisionList = ({ data, study }: { data: SmartDashboard['revisions']; study: (binding: SmartBinding) => Promise<void> }) => {
  const { student } = useAuth();
  const [showUpcoming, setShowUpcoming] = useState(false);
  const due = data.due;
  const future = data.chapters.filter(c => !due.some(r => r.revisionKey === c.revisionKey));
  const row = (chapter: CloudChapter, dueNow: boolean) => <View key={chapter.revisionKey} style={{ borderTopWidth: 1, borderColor: '#E1E6ED', paddingTop: 9, marginTop: 10 }}>
    <Text style={{ fontWeight: '600', color: '#172B4D' }}>{chapter.subject} · {chapter.concept}</Text>
    <Text style={line}>{chapter.strength === 'average' ? 'Medium' : chapter.strength === 'strong' ? 'Strong' : 'Weak'} · mastery {chapter.accuracy}% · questions {chapter.questionAccuracy == null ? 'not measured' : `${chapter.questionAccuracy}% (${chapter.questionAttemptedTotal} attempted)`}</Text>
    <Text style={line}>Due {chapter.dueOn}{dueNow ? chapter.suggestedToday ? ' · suggested today' : ' · additional due (still accessible)' : ''}</Text>
    <Text style={line}>{chapter.lastAssessmentSource === 'student-reported-question-score' ? 'Latest score: student-reported' : 'Latest score: written grading'}</Text>
    {chapter.lastRevisionCompletedAt && <Text style={line}>Last revision: {chapter.lastRevisionCompletedAt.slice(0, 10)}</Text>}
    {dueNow && student && <Action label="Start revision on Timer" onPress={() => void study({ ownerId: student.studentId, revisionKey: chapter.revisionKey, revisionVersion: chapter.revisionVersion, subject: chapter.subject, concept: chapter.concept })} />}
  </View>;
  return <Card><Text style={title}>Chapter revision plan</Text><Text style={line}>{due.length} due · workload budget {data.budgetMinutes} min · suggested {data.suggestedMinutes} min</Text><Text style={line}>Target locks and extensions never cancel these revisions. Extra due work stays open; it is not automatically postponed.</Text>{due.map(c => row(c, true))}{due.length === 0 && <Text style={line}>No revision due today. Chapter assessments schedule the next review.</Text>}{future.length > 0 && <Action label={`${showUpcoming ? 'Hide' : 'Show'} ${future.length} upcoming chapter dates`} onPress={() => setShowUpcoming(!showUpcoming)} />}{showUpcoming && future.map(c => row(c, false))}</Card>;
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

export const SmartTargetsPanel = () => {
  const { data, error, busy, load, run } = useSmartDashboard();
  const { study, studyError } = useStudyLink();
  return <View style={{ gap: 12 }}>
    {(error || studyError) && <Card><Text style={{ color: '#B3261E' }}>{error || studyError}</Text><Action label="Reload saved progress" onPress={() => void load()} /></Card>}
    {!data && !error && <ActivityIndicator accessibilityLabel="Loading personal targets" />}
    {data?.targetAccessError && <Card><Text style={{ color: '#A64817' }}>{data.targetAccessError} Saved plans are read-only until enrollment is verified. Your revisions remain accessible.</Text><Action label="Retry enrollment check" onPress={() => void load()} /></Card>}
    {data?.plans.map(p => <Card key={p.planId}>{p.progress ? <PlanProgress progress={p.progress} busy={busy} run={run} study={study} /> : <><Text style={title}>{p.name}</Text><Text style={line}>{p.totalDays} study days + {p.includedBackupDays} backup day(s). Day 1 begins when you start, not on the batch calendar.</Text><Action label={p.startAvailableOn > data.today ? `Available ${p.startAvailableOn}` : 'Start My Targets'} disabled={busy || p.startAvailableOn > data.today} onPress={() => void run('start', { planId: p.planId })} /></>}</Card>)}
    {busy && <ActivityIndicator accessibilityLabel="Saving target progress" />}
    {data && <CloudRevisionList data={data.revisions} study={study} />}
    {data && data.history.length > 0 && <Card><Text style={title}>Saved plan history (read-only)</Text>{data.history.map(h => <Text key={h.planId} style={line}>{h.name}: {h.completedDays}/{h.totalDays} days · started {h.startDate}. Plan cancelled or audience changed; progress retained.</Text>)}</Card>}
  </View>;
};

export const SmartRevisionPanel = ({ onCloudChapters }: { onCloudChapters?: (chapters: CloudChapter[]) => void }) => {
  const { data, error, load } = useSmartDashboard();
  const { study, studyError } = useStudyLink();
  useEffect(() => { if (data && onCloudChapters) onCloudChapters(data.revisions.chapters); }, [data, onCloudChapters]);
  return <View style={{ marginVertical: 12 }}>{(error || studyError) && <Card><Text style={{ color: '#B3261E' }}>{error || studyError}</Text><Action label="Retry saved revisions" onPress={() => void load()} /></Card>}{data ? <CloudRevisionList data={data.revisions} study={study} /> : !error && <ActivityIndicator />}</View>;
};


/** Home summary uses the same persisted state, not another checklist. */
export const SmartTargetHomeSummary = () => {
  const { data, error, busy, load, run } = useSmartDashboard();
  const navigation = useNavigation<any>();
  if (!data && !error) return null;
  if (error) return <Card><Text>Personal target status unavailable.</Text><Action label="Retry saved target status" onPress={() => void load()} /></Card>;
  if (!data || (!data.plans.length && !data.revisions.due.length && !data.targetAccessError)) return null;
  return <Card><Text style={title}>My targets & revisions</Text>
    {data.targetAccessError && <Text style={line}>{data.targetAccessError}</Text>}
    {data.plans.map(plan => { const p = plan.progress; const day = p?.days.find(d => d.day === p.currentDay); return <View key={plan.planId} style={{ marginTop: 8 }}>
      <Text style={{ fontWeight: '600' }}>{plan.name}</Text>
      {p ? <>
        <Text style={line}>{p.complete ? 'Complete' : `Day ${p.currentDay} of ${p.totalDays}`} · {p.progressPercent}% · {p.completedTasks}/{p.totalTasks} tasks</Text>
        <Text style={line}>{day && !p.complete ? `${day.tasks.filter(t => !t.done && t.mandatory).length} mandatory task(s) pending · work date ${day.projectedDate}` : 'All mandatory days complete'}</Text>
        <Text style={line}>{p.backupDaysRemaining} backup day(s) left · {p.extensions.filter(e => e.status === 'pending').length} extension request(s) pending</Text>
      </> : <Action label="Start My Targets" disabled={busy || plan.startAvailableOn > data.today} onPress={() => void run('start', { planId: plan.planId })} />}
    </View>; })}
    <Text style={line}>{data.revisions.due.length} revision(s) due today. These stay open even when targets are locked.</Text>
    <Action label="Open / resume my target tracker" onPress={() => navigation.navigate('DailyTarget')} />
    <Action label="Open revisions" onPress={() => navigation.navigate('Main', { screen: 'Revision' })} />
  </Card>;
};
