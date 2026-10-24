import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState, type RecordingStatus } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { deleteReceiptAudio, listReceiptAudio, saveReceiptAudio, SavedReceiptAudio } from '../services/receiptAudioVault';
import { PRACTICE_AUDIO_BYTES, PRACTICE_AUDIO_SECONDS } from '../services/practiceTools';
import { transcribeReceiptAudio } from '../services/receiptTranscription';

const TEMP_KEY = 'ump_receipt_temporary_audio_v1';
async function erase(uri: string | null) {
  if (!uri) return;
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
  else await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}
export async function clearAbandonedReceiptAudio() {
  try {
    const uri = await AsyncStorage.getItem(TEMP_KEY);
    await erase(uri); await AsyncStorage.removeItem(TEMP_KEY);
  } finally {
    // Recover from a crash before the URI marker was written. Delete ONLY this
    // feature's filename suffix, never other app audio/cache files.
    if (Platform.OS !== 'web' && FileSystem.cacheDirectory) {
      for (const folder of ['Audio/', 'ExpoAudio/']) {
        const directory = FileSystem.cacheDirectory + folder;
        const names = await FileSystem.readDirectoryAsync(directory).catch(() => [] as string[]);
        await Promise.all(names.filter(name => /^recording-[a-zA-Z0-9-]+\.receipt\.m4a$/.test(name)).map(name => erase(directory + name)));
      }
    }
  }
}
const button = { backgroundColor: '#E9EFFF', borderRadius: 10, padding: 13, marginVertical: 6 };

export function ReceiptRecorder({ owner, onClose, onInsert }: { owner: string; onClose: () => void; onInsert?: (text: string) => void }) {
  const nativeEvent = useRef<(event: RecordingStatus) => void>(() => undefined);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, directory: 'cache', extension: '.receipt.m4a', ios: { ...RecordingPresets.HIGH_QUALITY.ios, extension: '.receipt.m4a' }, numberOfChannels: 1, sampleRate: 22050, bitRate: 64000, web: { mimeType: 'audio/webm', bitsPerSecond: 64000 } }, event => nativeEvent.current(event));
  const state = useAudioRecorderState(recorder, 250);
  const [uri, setUri] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<SavedReceiptAudio[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(true);
  const [uploadState, setUploadState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const transcribing = useRef(false);
  type Phase = 'idle' | 'permission' | 'preparing' | 'recording' | 'stopping' | 'ready' | 'error';
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const [message, setMessage] = useState('Tap Start recording. Nothing is being recorded yet.');
  const transition = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  const starting = useRef(false);
  const nativeError = useRef('');
  const player = useAudioPlayer(uri);
  const alive = useRef(true); const controller = useRef<AbortController | null>(null); const temporaryUri = useRef<string | null>(null);
  const stopping = useRef(false);
  const closing = useRef(false);
  const requestingPermission = useRef(false);
  const wasRecording = useRef(false);
  const clearing = useRef<Promise<void> | null>(null);
  const cleanup = async () => {
    closing.current = true;
    controller.current?.abort(); try { player.pause(); } catch { /* player already released */ }
    try { if (recorder.isRecording || recorder.getStatus().canRecord) await recorder.stop().catch(() => undefined); } catch { /* recorder already released */ }
    let remaining = temporaryUri.current;
    try { remaining = remaining || recorder.uri; } catch { /* released */ }
    await erase(remaining); temporaryUri.current = null;
    await AsyncStorage.removeItem(TEMP_KEY);
    await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false }).catch(() => undefined);
  };
  useEffect(() => {
    alive.current = true; closing.current = false;
    clearing.current = clearAbandonedReceiptAudio().catch(() => undefined);
    void listReceiptAudio(owner).then(items => { if (alive.current) setSaved(items); }).catch(() => undefined);
    const sub = AppState.addEventListener('change', status => {
      // Android's permission activity may report background, not just inactive.
      // The permission-only path NEVER starts capture on completion: a fresh tap
      // while active is required, so ignoring that transient event is safe.
      if (status !== 'active' && !requestingPermission.current) void cleanup().finally(onClose);
    });
    return () => { alive.current = false; sub.remove(); void cleanup(); };
  // Recorder is mounted for one modal session only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stop = async () => {
    if (stopping.current || closing.current) return;
    if (phaseRef.current !== 'recording' && !recorder.isRecording && !nativeError.current) return;
    stopping.current = true; setBusy(true); transition('stopping'); setMessage('Stopping and checking the recording…');
    try {
      if (recorder.isRecording || recorder.getStatus().canRecord) await recorder.stop();
      if (nativeError.current) throw new Error(nativeError.current);
      const next = recorder.uri;
      if (!next) throw new Error('Recording was not saved. Please retry or type instead.');
      if (Platform.OS !== 'web') {
        const info = await FileSystem.getInfoAsync(next);
        if (!info.exists || info.isDirectory || info.size <= 0) throw new Error('No audio was captured. Please record for a few seconds and retry.');
        if (info.size > PRACTICE_AUDIO_BYTES) throw new Error('Recording exceeds 2 MB. Please make a shorter recording.');
      }
      if (!alive.current || closing.current) { await erase(next); return; }
      if (nativeError.current) throw new Error(nativeError.current);
      temporaryUri.current = next;
      await AsyncStorage.setItem(TEMP_KEY, next);
      if (alive.current && !closing.current) { setUri(next); transition('ready'); setMessage('Recording ready. Replay it, then save it on this device if you want to keep it.'); }
    } catch (e) {
      let failed = temporaryUri.current;
      try { failed = failed || recorder.uri; } catch { /* recorder released while closing */ }
      await erase(failed); temporaryUri.current = null;
      await AsyncStorage.removeItem(TEMP_KEY);
      if (alive.current && !closing.current) { setUri(null); transition('error'); setError(e instanceof Error ? e.message : 'Could not stop recording.'); }
    } finally {
      await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false }).catch(() => undefined);
      stopping.current = false; if (alive.current && !closing.current) setBusy(false);
    }
  };
  nativeEvent.current = event => {
    if (!alive.current || closing.current) return;
    if (event.hasError) {
      nativeError.current = event.error || 'The microphone could not record audio. Close other apps using the microphone and retry.';
      setError(nativeError.current); void stop();
    } else if (event.isFinished && phaseRef.current === 'recording') void stop();
  };
  useEffect(() => { const ended = wasRecording.current && !state.isRecording; wasRecording.current = state.isRecording; if (ended && alive.current && phaseRef.current === 'recording') void stop(); }, [state.isRecording]);
  useEffect(() => { if (state.isRecording && state.durationMillis >= PRACTICE_AUDIO_SECONDS * 1000) void stop(); }, [state.durationMillis, state.isRecording]);
  const record = async () => {
    if (starting.current || stopping.current || busy || closing.current || recorder.isRecording) return;
    starting.current = true; setBusy(true); setError(''); nativeError.current = '';
    try {
      await clearing.current;
      if (!alive.current || closing.current) return;
      if (AppState.currentState !== 'active') throw new Error('Return to the app, then tap Start recording.');
      const existing = await AudioModule.getRecordingPermissionsAsync();
      if (!alive.current || closing.current) return;
      if (!existing.granted) {
        transition('permission'); setMessage('Allow microphone access in the Android popup. Recording has not started.');
        requestingPermission.current = true;
        let permission;
        try { permission = await AudioModule.requestRecordingPermissionsAsync(); }
        finally { requestingPermission.current = false; }
        if (!alive.current || closing.current) return;
        if (!permission.granted) throw new Error('Microphone permission was denied. Allow Microphone in this app’s Android permissions, or type instead.');
        // Never auto-start after a system activity or after leaving the app.
        transition('idle'); setMessage('Microphone allowed. Tap Start recording to begin.');
        return;
      }
      if (AppState.currentState !== 'active') throw new Error('Return to the app, then tap Start recording.');
      transition('preparing'); setMessage('Preparing the microphone…');
      // An empty/released playback player must not block microphone capture.
      try { player.pause(); } catch { /* there may be no playback source yet */ }
      await erase(temporaryUri.current); temporaryUri.current = null;
      setUri(null); setSavedId(null); setText(''); setUploadState('idle');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      if (!alive.current || closing.current || AppState.currentState !== 'active') { await cleanup(); return; }
      await recorder.prepareToRecordAsync();
      if (!alive.current || closing.current || AppState.currentState !== 'active') { await cleanup(); return; }
      if (nativeError.current) throw new Error(nativeError.current);
      temporaryUri.current = recorder.uri;
      if (recorder.uri) await AsyncStorage.setItem(TEMP_KEY, recorder.uri);
      if (!alive.current || closing.current || AppState.currentState !== 'active') { await cleanup(); return; }
      recorder.record({ forDuration: PRACTICE_AUDIO_SECONDS });
      if (!recorder.getStatus().isRecording) throw new Error('The microphone did not start. Close other apps using the microphone and retry.');
      transition('recording'); setMessage('Recording on this device. Tap Stop recording when finished.');
    } catch (e) {
      try { if (recorder.isRecording || recorder.getStatus().canRecord) await recorder.stop().catch(() => undefined); } catch { /* released */ }
      await erase(temporaryUri.current); temporaryUri.current = null;
      await AsyncStorage.removeItem(TEMP_KEY);
      await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false }).catch(() => undefined);
      if (alive.current && !closing.current) { transition('error'); setError(e instanceof Error ? e.message : 'Recording is unavailable. Please type instead.'); }
    } finally { starting.current = false; if (alive.current && !closing.current) setBusy(false); }
  };
  const transcribe = async () => {
    if (!uri || transcribing.current || busy || closing.current || phaseRef.current === 'recording') return;
    transcribing.current = true; setBusy(true); setError(''); setUploadState('sending');
    const request = new AbortController(); controller.current = request;
    try {
      const transcript = await transcribeReceiptAudio(owner, uri, request.signal);
      if (alive.current && !closing.current) { setText(transcript); setUploadState('done'); }
    } catch (e) {
      if (alive.current && !closing.current) { setUploadState('error'); setError(e instanceof Error ? e.message : 'Transcription interrupted. Your recording is unchanged. Retry or type instead.'); }
    } finally {
      transcribing.current = false;
      if (controller.current === request) controller.current = null;
      if (alive.current && !closing.current) setBusy(false);
    }
  };

  const keepRecording = async () => {
    if (!uri || savedId || state.isRecording) return;
    setBusy(true); setError('');
    try {
      const entry = await saveReceiptAudio(owner, uri);
      const items = await listReceiptAudio(owner);
      if (alive.current) { setSavedId(entry.id); setSaved(items); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not save recording.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const removeRecording = (entry: SavedReceiptAudio) => Alert.alert('Delete this saved recording?', 'This removes only this recording from this device. Receipt text is unchanged.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
      setBusy(true);
      try {
        if (savedId === entry.id) { player.pause(); setUri(null); setSavedId(null); setText(''); setUploadState('idle'); }
        await deleteReceiptAudio(owner, entry.id);
        const items = await listReceiptAudio(owner); if (alive.current) setSaved(items);
      } catch { if (alive.current) setError('Could not delete recording. Please retry.'); }
      finally { if (alive.current) setBusy(false); }
    })(); } },
  ]);
  const card = { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, marginTop: 14, borderWidth: 1, borderColor: '#E2E8F0' };
  const secondary = { ...button, backgroundColor: '#F1F5F9', borderRadius: 12 };
  const activeCapture = phase === 'recording' || state.isRecording;
  const clipStatus = activeCapture ? 'RECORDING' : uri ? savedId ? 'SAVED ON DEVICE' : 'READY TO REPLAY' : 'NOT RECORDING';
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#F5F7FC' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 22, paddingTop: 55, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <View><Text style={{ color: '#64748B', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }}>PRIVATE STUDY TOOLS</Text><Text style={{ fontSize: 28, color: '#172554', fontWeight: '800', marginTop: 5 }}>Study receipt</Text></View>
      <Text style={{ color: '#3157D5', backgroundColor: '#E9EFFF', borderRadius: 12, padding: 8, fontSize: 12, fontWeight: '700' }}>Voice → text</Text>
    </View>
    <Text style={{ color: '#64748B', marginTop: 8, lineHeight: 21 }}>Speak your answer, check the transcript, then insert it. Nothing is submitted automatically.</Text>
    <View style={{ flexDirection: 'row', marginTop: 18, gap: 7 }}>{['Record', 'Replay', 'Transcribe', 'Review'].map((label, index) => <View key={label} style={{ flex: 1, backgroundColor: (index === 0 && !uri) || (index === 1 && uri && !text && uploadState !== 'sending') || (index === 2 && uploadState === 'sending') || (index === 3 && text) ? '#DBEAFE' : '#EEF2F6', borderRadius: 10, paddingVertical: 9 }}><Text style={{ color: '#334155', textAlign: 'center', fontSize: 11, fontWeight: '700' }}>{index + 1} · {label}</Text></View>)}</View>

    <View style={card}>
      <Text style={{ color: '#64748B', fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>1 / YOUR RECORDING</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}><Text style={{ color: activeCapture ? '#B91C1C' : savedId ? '#047857' : '#3157D5', fontSize: 11, fontWeight: '800' }}>{clipStatus}</Text><Text style={{ color: '#64748B', fontSize: 12 }}>2 min · 2 MB max</Text></View>
      <Text accessibilityLiveRegion="polite" style={{ color: '#172554', marginTop: 12, fontSize: activeCapture ? 26 : 15, fontWeight: '700', lineHeight: activeCapture ? 32 : 22 }}>{activeCapture ? `● Recording · ${Math.floor(state.durationMillis / 1000)}s / 120s` : uri ? savedId ? 'Saved recording selected. Ready to replay or transcribe.' : 'Recording ready. Replay it before transcribing.' : phase === 'error' ? 'Recording is not active. See the message below.' : message}</Text>
      {error && !uri ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', marginTop: 10 }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Start receipt recording" style={{ ...secondary, flex: 1, backgroundColor: !uri && !busy && !activeCapture ? '#3157D5' : '#F1F5F9', opacity: busy || activeCapture ? 0.5 : 1 }} disabled={busy || activeCapture || phase === 'stopping'} onPress={record}><Text style={{ textAlign: 'center', color: !uri && !busy && !activeCapture ? '#FFFFFF' : '#334155', fontWeight: '700' }}>{phase === 'permission' ? 'Waiting for microphone permission…' : phase === 'preparing' ? 'Preparing microphone…' : uri ? 'Re-record' : 'Start recording'}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Stop receipt recording" style={{ ...secondary, flex: 1, backgroundColor: activeCapture ? '#FEE2E2' : '#F1F5F9', opacity: activeCapture ? 1 : 0.45 }} disabled={phase !== 'recording'} onPress={stop}><Text style={{ textAlign: 'center', color: activeCapture ? '#B91C1C' : '#64748B', fontWeight: '700' }}>{phase === 'stopping' ? 'Stopping…' : 'Stop recording'}</Text></Pressable>
      </View>
      {uri && !activeCapture && <><Pressable accessibilityRole="button" style={secondary} disabled={busy} onPress={() => { player.seekTo(0); player.play(); }}><Text style={{ color: '#334155', fontWeight: '600' }}>▶ Replay recording</Text></Pressable><Pressable accessibilityRole="button" style={secondary} disabled={busy || !!savedId} onPress={() => void keepRecording()}><Text style={{ color: savedId ? '#047857' : '#334155', fontWeight: '600' }}>{savedId ? '✓ Saved privately on this device' : 'Save recording on this device'}</Text></Pressable></>}
    </View>

    {uri && !activeCapture && <View style={card}>
      <Text style={{ color: '#64748B', fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>2 / TRANSCRIBE</Text>
      <Text style={{ color: '#334155', lineHeight: 21, marginTop: 10 }}>Only when you tap below, this clip is sent through our server to Groq for transcription.</Text>
      {error ? <View accessibilityRole="alert" style={{ backgroundColor: '#FFF1F2', borderRadius: 12, padding: 14, marginTop: 12 }}><Text style={{ color: '#9F1239', fontWeight: '800', marginBottom: 6 }}>{uploadState === 'error' ? 'Transcription not completed' : 'Recording needs attention'}</Text><Text style={{ color: '#9F1239', lineHeight: 21 }}>{error}</Text><Text style={{ color: '#047857', marginTop: 8, fontWeight: '600' }}>Your selected recording has not been deleted.</Text></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={uploadState === 'error' ? 'Retry receipt transcription' : 'Transcribe receipt recording'} disabled={busy} style={{ ...button, backgroundColor: busy ? '#CBD5E1' : '#3157D5', paddingVertical: 16, borderRadius: 12, marginTop: 14 }} onPress={() => void transcribe()}><Text style={{ color: busy ? '#475569' : '#FFFFFF', textAlign: 'center', fontWeight: '800' }}>{uploadState === 'sending' ? 'Transcribing… Please keep this screen open' : uploadState === 'error' ? 'Retry transcription with Groq' : 'Transcribe with Groq'}</Text></Pressable>
      <Text style={{ color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 4 }}>No automatic retry or submission. You can always close this and type your answer.</Text>
    </View>}

    {text ? <View style={card}><Text style={{ color: '#64748B', fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>3 / REVIEW & INSERT</Text><Text style={{ color: '#334155', lineHeight: 21, marginTop: 10 }}>Check names, numbers, negations and technical terms. Edit anything before inserting.</Text><TextInput accessibilityLabel="Editable voice transcript" value={text} onChangeText={setText} multiline maxLength={12000} style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14, minHeight: 180, textAlignVertical: 'top', marginVertical: 12 }} /><Pressable accessibilityRole="button" disabled={busy || !text.trim() || !onInsert} style={{ ...button, backgroundColor: '#047857', borderRadius: 12 }} onPress={() => { if (!onInsert || closing.current || busy) return; onInsert(text.trim()); void cleanup().finally(onClose); }}><Text style={{ color: '#FFFFFF', textAlign: 'center', fontWeight: '800' }}>{savedId ? 'Insert reviewed text (saved copy stays)' : 'Insert reviewed text & delete recording'}</Text></Pressable><Text style={{ color: '#64748B', fontSize: 12, lineHeight: 18 }}>Insert copies your reviewed words into the receipt. It does not submit your answer.</Text></View> : null}

    <View style={card}><Pressable accessibilityRole="button" accessibilityState={{ expanded: savedOpen }} onPress={() => setSavedOpen(!savedOpen)}><Text style={{ color: '#172554', fontSize: 17, fontWeight: '800' }}>My recordings · {saved.length}/10 {savedOpen ? '−' : '+'}</Text><Text style={{ color: '#64748B', marginTop: 4, fontSize: 12 }}>{(saved.reduce((sum, item) => sum + item.bytes, 0) / 1024 / 1024).toFixed(1)} / 20 MB · Stored on this device only</Text></Pressable>
      {savedOpen && saved.map(entry => <View key={entry.id} style={{ borderTopWidth: 1, borderTopColor: '#E2E8F0', marginTop: 14, paddingTop: 14 }}><Text style={{ color: '#334155', fontWeight: '600' }}>{new Date(entry.createdAt).toLocaleString()}</Text><Text style={{ color: '#64748B', fontSize: 12, marginTop: 3 }}>{Math.ceil(entry.bytes / 1024)} KB{savedId === entry.id ? ' · Selected' : ''}</Text><View style={{ flexDirection: 'row', gap: 10 }}><Pressable accessibilityRole="button" style={{ ...secondary, flex: 1 }} disabled={busy || activeCapture} onPress={() => { player.pause(); setUri(entry.uri); setSavedId(entry.id); setText(''); setError(''); setUploadState('idle'); transition('ready'); setMessage('Saved recording selected.'); }}><Text style={{ color: '#3157D5', textAlign: 'center', fontWeight: '700' }}>Open saved recording</Text></Pressable><Pressable accessibilityRole="button" style={{ ...secondary, backgroundColor: '#FFF1F2' }} disabled={busy || activeCapture} onPress={() => removeRecording(entry)}><Text style={{ color: '#BE123C', fontWeight: '600' }}>Delete</Text></Pressable></View></View>)}
      {savedOpen && !saved.length && <Text style={{ color: '#64748B', lineHeight: 21, marginTop: 12 }}>No saved recordings yet. Record a clip and choose Save recording on this device to keep it.</Text>}
    </View>
    <View style={{ ...card, backgroundColor: '#EEF2F6' }}><Pressable accessibilityRole="button" accessibilityState={{ expanded: privacyOpen }} onPress={() => setPrivacyOpen(!privacyOpen)}><Text style={{ color: '#334155', fontWeight: '700' }}>Privacy & storage {privacyOpen ? '−' : '+'}</Text><Text style={{ color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 5 }}>No mentor access to recordings or transcripts. No app cloud backup of audio.</Text></Pressable>{privacyOpen && <Text style={{ color: '#475569', lineHeight: 21, marginTop: 12 }}>Transcribe sends the selected clip to Groq through our server. There is no server audio archive. Unsaved clips are deleted when you insert text, cancel or leave. Saved copies stay on this device until you delete them. Groq processing follows its own data policy. Only reviewed text goes into the receipt. Clearing app data or uninstalling removes saved recordings; device OS backup settings may apply. Limits: 10 clips / 20 MB. Older clips are never automatically evicted.</Text>}</View>
    <Pressable accessibilityRole="button" disabled={closing.current} style={{ padding: 16, marginTop: 14 }} onPress={() => void cleanup().finally(onClose)}><Text style={{ color: '#475569', textAlign: 'center', fontWeight: '700' }}>{savedId ? 'Close (saved recordings stay)' : 'Cancel & delete temporary recording'}</Text></Pressable>
  </ScrollView></KeyboardAvoidingView>;

}
export function ReceiptVoiceButton({ onInsert, disabled = false }: { onInsert?: (text: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { student } = useAuth();
  return <><Pressable disabled={disabled || !student} style={button} accessibilityRole="button" onPress={() => setOpen(true)}><Text>{onInsert ? '🎙 Speak instead of typing' : 'My private recordings'}</Text></Pressable><Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>{open && student && <ReceiptRecorder key={student.studentId} owner={student.studentId} onClose={() => setOpen(false)} onInsert={onInsert} />}</Modal></>;
}
