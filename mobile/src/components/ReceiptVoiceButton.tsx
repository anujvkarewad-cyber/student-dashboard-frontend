import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState, type RecordingStatus } from 'expo-audio';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { fetch as expoFetch } from 'expo/fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { deleteReceiptAudio, listReceiptAudio, saveReceiptAudio, SavedReceiptAudio } from '../services/receiptAudioVault';
import { practiceSession, practiceUrl, PRACTICE_AUDIO_BYTES, PRACTICE_AUDIO_SECONDS } from '../services/practiceTools';

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
      setUri(null); setSavedId(null); setText('');
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
    if (!uri) return;
    setBusy(true); setError(''); controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 60000);
    try {
      const data = Platform.OS === 'web' ? await (await fetch(uri)).blob() : new File(uri);
      if (data.size > PRACTICE_AUDIO_BYTES) throw new Error('Recording exceeds 2 MB. Please make a shorter recording.');
      const session = await practiceSession();
      if (!alive.current || closing.current) return;
      const r = await expoFetch(practiceUrl('/receipt/transcribe'), { method: 'POST', body: data, headers: { 'Content-Type': Platform.OS === 'web' ? (data.type || 'audio/webm') : 'audio/mp4', 'X-Practice-Token': session.token }, signal: controller.current.signal });
      const result = await r.json();
      if (!r.ok || !result.text) throw new Error(typeof result.detail === 'string' ? result.detail : 'Could not transcribe. Replay/retry or type instead.');
      if (alive.current) setText(String(result.text));
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Transcription failed. Your typed answer is unchanged.'); }
    finally { clearTimeout(timer); if (alive.current) setBusy(false); }
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
        if (savedId === entry.id) { player.pause(); setUri(null); setSavedId(null); setText(''); }
        await deleteReceiptAudio(owner, entry.id);
        const items = await listReceiptAudio(owner); if (alive.current) setSaved(items);
      } catch { if (alive.current) setError('Could not delete recording. Please retry.'); }
      finally { if (alive.current) setBusy(false); }
    })(); } },
  ]);
  return <View style={{ flex: 1, backgroundColor: '#F5F7FC', padding: 22, paddingTop: 55 }}><ScrollView keyboardShouldPersistTaps="handled">
    <Text style={{ fontSize: 23, fontWeight: '800', marginBottom: 12 }}>Speak your study receipt</Text>
    <Text accessibilityLiveRegion="polite" style={{ marginVertical: 8, fontWeight: '600' }}>{phase === 'recording' ? `● Recording · ${Math.floor(state.durationMillis / 1000)}s / 120s` : phase === 'error' ? 'Recording is not active. See the message below.' : message}</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', marginVertical: 10 }}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Start receipt recording" style={{ ...button, backgroundColor: busy || phase === 'recording' ? '#CBD5E1' : '#3157D5' }} disabled={busy || phase === 'recording' || phase === 'stopping'} onPress={record}><Text style={{ color: busy || phase === 'recording' ? '#334155' : 'white', fontWeight: '700' }}>{phase === 'permission' ? 'Waiting for microphone permission…' : phase === 'preparing' ? 'Preparing microphone…' : uri ? '🎙 Re-record' : '🎙 Start recording'}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Stop receipt recording" style={{ ...button, backgroundColor: phase === 'recording' ? '#B91C1C' : '#E2E8F0' }} disabled={phase !== 'recording'} onPress={stop}><Text style={{ color: phase === 'recording' ? 'white' : '#64748B', fontWeight: '700' }}>{phase === 'stopping' ? 'Stopping recording…' : '■ Stop recording'}</Text></Pressable>
    <Text>Up to 2 minutes / 2 MB. Record → replay → transcribe → edit → insert. Your answer is never submitted automatically.</Text>
    <Text style={{ marginVertical: 12, color: '#475569' }}>Transcribe sends this clip to Groq through our server. There is no server audio archive. Unsaved clips are deleted when you insert text, cancel or leave. Use Save on this device to keep a private copy; saved clips are not deleted on closing. Groq processing follows its own data policy. Only confirmed text goes into the receipt.</Text>
    {uri && !state.isRecording && <><Pressable style={button} disabled={busy} onPress={() => { player.seekTo(0); player.play(); }}><Text>Replay recording</Text></Pressable><Pressable style={button} disabled={busy} onPress={() => void transcribe()}><Text>{busy ? 'Transcribing…' : 'Send temporary audio to Groq & transcribe'}</Text></Pressable></>}
    {uri && !state.isRecording && <Pressable accessibilityRole="button" style={button} disabled={busy || !!savedId} onPress={() => void keepRecording()}><Text>{savedId ? 'Saved privately on this device' : 'Save recording on this device'}</Text></Pressable>}
    <Text style={{ fontWeight: '700', marginTop: 16 }}>My recordings · {saved.length}/10 · {(saved.reduce((sum, item) => sum + item.bytes, 0) / 1024 / 1024).toFixed(1)}/20 MB</Text>
    <Text>No mentor access or app cloud sync. Clearing app data/uninstalling removes these files. Device OS backup settings may apply. Older clips are never automatically evicted.</Text>
    {saved.map(entry => <View key={entry.id} style={{ marginTop: 6 }}><Text>{new Date(entry.createdAt).toLocaleString()} · {Math.ceil(entry.bytes / 1024)} KB</Text><Pressable accessibilityRole="button" style={button} disabled={busy || state.isRecording || phase === 'recording'} onPress={() => { player.pause(); setUri(entry.uri); setSavedId(entry.id); setText(''); }}><Text>Open saved recording</Text></Pressable><Pressable accessibilityRole="button" disabled={busy || state.isRecording || phase === 'recording'} onPress={() => removeRecording(entry)}><Text>Delete this saved recording</Text></Pressable></View>)}
    {text ? <><Text>Check the transcript, especially numbers, negations and technical terms.</Text><TextInput accessibilityLabel="Editable voice transcript" value={text} onChangeText={setText} multiline maxLength={12000} style={{ backgroundColor: 'white', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14, minHeight: 180, textAlignVertical: 'top', marginVertical: 10 }} /><Pressable disabled={busy || !text.trim() || !onInsert} style={button} onPress={() => { if (!onInsert) return; onInsert(text.trim()); void cleanup().finally(onClose); }}><Text>{savedId ? 'Insert reviewed text (saved copy stays)' : 'Insert reviewed text & delete recording'}</Text></Pressable></> : null}
    <Pressable style={button} onPress={() => void cleanup().finally(onClose)}><Text>{savedId ? 'Close (saved recordings stay)' : 'Cancel & delete temporary recording'}</Text></Pressable>
  </ScrollView></View>;
}
export function ReceiptVoiceButton({ onInsert, disabled = false }: { onInsert?: (text: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { student } = useAuth();
  return <><Pressable disabled={disabled || !student} style={button} accessibilityRole="button" onPress={() => setOpen(true)}><Text>{onInsert ? '🎙 Speak instead of typing' : 'My private recordings'}</Text></Pressable><Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>{open && student && <ReceiptRecorder key={student.studentId} owner={student.studentId} onClose={() => setOpen(false)} onInsert={onInsert} />}</Modal></>;
}
