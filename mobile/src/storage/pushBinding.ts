import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../config';

type Actor = { studentId: string; password: string };
const key = (id: string) => `ump_native_fcm_v1_${id}`;
const pending = new Map<string, Set<Promise<unknown>>>();
const known = new Map<string, Set<string>>();

async function post(actor: Actor, token: string, remove = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${config.mentorApiUrl}/api/push/device-token${remove ? '/remove' : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Student-Id': actor.studentId, 'X-Session-Password': actor.password },
      body: JSON.stringify({ studentId: actor.studentId, token }), signal: controller.signal,
    });
    const data = await response.json();
    return response.ok && data?.result?.success === true;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

export function bindPushToken(actor: Actor, token: string, current: () => boolean): Promise<boolean> {
  if (!current()) return Promise.resolve(false);
  const tokens = known.get(actor.studentId) || new Set<string>();
  tokens.add(token); known.set(actor.studentId, tokens);
  const work = (async () => {
    // Remember a possible server binding even if acknowledgement is lost.
    await AsyncStorage.setItem(key(actor.studentId), JSON.stringify({ token, savedAt: 0 }));
    if (!current()) return false;
    const ok = await post(actor, token);
    if (!current()) return false;
    if (ok) await AsyncStorage.setItem(key(actor.studentId), JSON.stringify({ token, savedAt: Date.now() }));
    return ok;
  })();
  const jobs = pending.get(actor.studentId) || new Set<Promise<unknown>>();
  jobs.add(work); pending.set(actor.studentId, jobs);
  void work.finally(() => { jobs.delete(work); if (!jobs.size) pending.delete(actor.studentId); }).catch(() => undefined);
  return work;
}

export async function retirePushBinding(actor: Actor | null) {
  if (!actor) return;
  // Drain requests started by the old account before removing that binding.
  await Promise.allSettled([...(pending.get(actor.studentId) || [])]);
  const tokens = new Set(known.get(actor.studentId) || []);
  try {
    const raw = await AsyncStorage.getItem(key(actor.studentId));
    const token = raw ? JSON.parse(raw)?.token : null;
    if (typeof token === 'string' && token) tokens.add(token);
  } catch { /* malformed local record is not authority */ }
  // Best effort only: offline/expired credentials cannot certify remote revoke.
  await Promise.all([...tokens].map(token => post(actor, token, true)));
  known.delete(actor.studentId);
  await AsyncStorage.removeItem(key(actor.studentId)).catch(() => undefined);
}
