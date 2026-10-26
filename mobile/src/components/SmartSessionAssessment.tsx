import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';
import type { FocusSession } from '../context/FocusTimerContext';
import { smartTargetRequest } from '../services/smartTargets';

/** Explicit aggregate sharing; receipt responses/audio never leave this component. */
export const SmartSessionAssessment = ({ session, onShared }: { session: FocusSession; onShared: () => Promise<void> }) => {
  const { student, backendMode } = useAuth();
  const [attempted, setAttempted] = useState('');
  const [correct, setCorrect] = useState('');
  const [confidence, setConfidence] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const binding = session.smartTarget;
  const owner = useRef(student?.studentId);
  owner.current = student?.studentId;
  useEffect(() => {
    let active = true;
    setResult(null); setError(''); setAttempted(''); setCorrect(''); setLoading(true); setPending(false);
    const sid = student?.studentId;
    if (!sid || binding?.ownerId !== sid) { setLoading(false); return; }
    smartTargetRequest(sid, 'session', { sessionId: session.id }).then(data => {
      if (!active) return;
      if (data.summary?.status === 'pending') {
        setAttempted(String(data.summary.attempted)); setCorrect(String(data.summary.correct));
        setConfidence(data.summary.confidence || 'Medium'); setPending(true);
        setError('This saved summary is pending. Retry the same counts to finish scheduling; it will not be counted twice.');
      }
      if (data.summary?.status === 'complete') {
        setResult(data.summary.assessment); setAttempted(String(data.summary.attempted)); setCorrect(String(data.summary.correct));
        void onShared().catch(() => undefined);
      }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not read saved assessment.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // onShared is deliberately not an effect trigger: marking the local receipt
    // must not recursively fetch/save again.
  }, [student?.studentId, session.id, binding?.ownerId]);
  if (!binding || binding.ownerId !== student?.studentId) return null;
  const a = Number(attempted), c = Number(correct);
  const valid = attempted.trim() !== '' && correct.trim() !== '' && Number.isInteger(a) && Number.isInteger(c) && a > 0 && a <= 1000 && c >= 0 && c <= a;
  const send = async () => {
    const sid = student?.studentId;
    if (!valid || !sid || busy) return;
    setBusy(true); setError('');
    try {
      const response = await smartTargetRequest(sid, 'assessment', {
        eventId: `session:${session.id}`, sessionId: session.id, attempted: a, correct: c,
        durationSeconds: session.durationSeconds, confidence, shareSummary: true,
        ...(binding.planId ? { planId: binding.planId, taskId: binding.taskId } : { revisionKey: binding.revisionKey, revisionVersion: binding.revisionVersion }),
      }, backendMode === 'live');
      if (owner.current !== sid) return;
      setResult(response.assessment);
      await onShared();
    } catch (e) { if (owner.current === sid) setError(e instanceof Error ? e.message : 'Summary not saved. Please retry.'); }
    finally { if (owner.current === sid) setBusy(false); }
  };
  const inputStyle = { borderWidth: 1, borderColor: '#CAD2DF', padding: 10, borderRadius: 8, marginTop: 8, color: '#172B4D' };
  return <Card><Text style={{ fontWeight: '700', fontSize: 17 }}>Chapter assessment summary</Text><Text style={{ marginTop: 8 }}>{binding.subject} · {binding.concept}</Text><Text style={{ marginTop: 8 }}>After answering chapter questions and checking your answers, enter the counts. This score is self-reported, not a verified exam result. Sharing saves only counts, confidence, chapter and session duration for mastery/revisions. Your receipt text and audio stay private.</Text>
    {result ? <View>{result.scheduledRevisionRetained && <Text style={{ marginTop: 10 }}>Your existing chapter revision date has been kept. A target assessment does not complete that scheduled revision.</Text>}<Text style={{ marginTop: 10 }}>Saved · mastery {result.accuracy}% · {result.strength === 'average' ? 'Medium' : result.strength} · next revision {result.dueOn}. This does not tick your target; return to Targets to confirm completion.</Text></View> : <>
      <TextInput accessibilityLabel="Questions attempted" style={inputStyle} value={attempted} onChangeText={setAttempted} keyboardType="number-pad" placeholder="Questions attempted" editable={!busy && !loading && !pending} />
      <TextInput accessibilityLabel="Correct answers" style={inputStyle} value={correct} onChangeText={setCorrect} keyboardType="number-pad" placeholder="Correct answers (zero is valid)" editable={!busy && !loading && !pending} />
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>{(['Low', 'Medium', 'High'] as const).map(v => <Pressable key={v} disabled={busy || pending} onPress={() => setConfidence(v)}><Text style={{ fontWeight: confidence === v ? '800' : '400' }}>{v} confidence</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" disabled={!valid || busy || loading} onPress={() => void send()} style={{ opacity: valid && !busy && !loading ? 1 : 0.45, padding: 12, backgroundColor: '#2354B8', borderRadius: 8, marginTop: 12 }}><Text style={{ color: '#FFF' }}>{busy ? 'Saving summary…' : loading ? 'Checking saved summary…' : pending ? 'Retry pending summary' : 'Share question-score summary & schedule revision'}</Text></Pressable>
    </>}{error && <Text style={{ color: '#B3261E', marginTop: 8 }}>{error}</Text>}</Card>;
};
