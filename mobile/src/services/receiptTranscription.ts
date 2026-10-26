// Receipt-only native XHR transport: no automatic audio retries or background sends.
// Keeps the original file/draft untouched on network failure, timeout or cancellation.
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { getSavedSession } from '../storage/session';
import { practiceUrl, PRACTICE_AUDIO_BYTES } from './practiceTools';

function xhrJson(url: string, body: string | ArrayBuffer, headers: Record<string, string>, timeoutMs: number, signal: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Transcription cancelled. Your recording is unchanged.')); return; }
    const xhr = new XMLHttpRequest(); let settled = false;
    const release = () => signal.removeEventListener('abort', cancel);
    const fail = (message: string) => { if (settled) return; settled = true; release(); reject(new Error(message)); };
    const cancel = () => { fail('Transcription cancelled. Your recording is unchanged.'); xhr.abort(); };
    xhr.open('POST', url, true); xhr.timeout = timeoutMs;
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.onerror = () => fail('Connection interrupted. Your recording is unchanged. Retry transcription when connected.');
    xhr.ontimeout = () => fail('The transcription service took too long. Your recording is unchanged. You can retry or type.');
    xhr.onabort = () => fail('Request interrupted. Your recording is unchanged. You can retry transcription.');
    xhr.onload = () => {
      if (settled) return;
      let data: any;
      try { data = JSON.parse(String(xhr.responseText || '')); }
      catch { fail('The service returned an unreadable response. Your recording is unchanged.'); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        const detail = typeof data?.detail === 'string' ? data.detail : '';
        fail(xhr.status === 401 || xhr.status === 403
          ? 'Transcription access could not be verified. Sign in again; your recording is unchanged.'
          : detail ? `${detail} Your recording is unchanged.` : 'Transcription was not completed. Your recording is unchanged. Retry or type.');
        return;
      }
      settled = true; release(); resolve(data);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try { if (signal.aborted) cancel(); else xhr.send(body); }
    catch { fail('Could not start the request. Your recording is unchanged. Retry transcription.'); }
  });
}

export async function transcribeReceiptAudio(owner: string, uri: string, signal: AbortSignal): Promise<string> {
  if (owner !== 'UMP0000') throw new Error('Cloud transcription is currently limited to the private owner test. You can still type.');
  const initial = await getSavedSession();
  if (!initial?.password || initial.studentId !== owner) throw new Error('Please sign in again. Your recording is unchanged.');
  const assertOwner = async () => {
    const active = await getSavedSession();
    if (signal.aborted) throw new Error('Transcription cancelled. Your recording is unchanged.');
    if (active?.studentId !== owner || active.password !== initial.password) throw new Error('Account changed. No transcript will be inserted.');
  };
  // Binary native upload, not multipart; server's existing bounded audio contract.
  const file = Platform.OS === 'web' ? await (await fetch(uri)).blob() : new File(uri);
  if (file.size <= 0 || file.size > PRACTICE_AUDIO_BYTES) throw new Error('Choose a recording between 1 byte and 2 MB. Your saved files are unchanged.');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > PRACTICE_AUDIO_BYTES) throw new Error('Recording size could not be verified. Your saved files are unchanged.');
  await assertOwner();
  const session = await xhrJson(practiceUrl('/session'), JSON.stringify({ studentId: owner, password: initial.password }), { 'Content-Type': 'application/json' }, 20000, signal);
  await assertOwner();
  if (session.studentId !== owner || typeof session.token !== 'string' || !session.token.trim()) throw new Error('Transcription identity could not be verified. Your recording is unchanged.');
  const result = await xhrJson(practiceUrl('/receipt/transcribe'), bytes, { 'Content-Type': Platform.OS === 'web' ? (file.type || 'audio/webm') : 'audio/mp4', 'X-Practice-Token': session.token }, 60000, signal);
  await assertOwner();
  if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 12000) throw new Error('No usable transcript was returned. Replay your recording, retry, or type instead.');
  return result.text.trim();
}
