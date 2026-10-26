import { retirePushBinding } from './pushBinding';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Student } from '../types';

const SESSION_KEY = 'ump_mobile_session_v1';
let generation = 0;
let pendingMutation: Promise<void> = Promise.resolve();
const invalidated = new Set<() => void>();
export const getSessionGeneration = () => generation;
export const subscribeSessionInvalidation = (listener: () => void) => {
  invalidated.add(listener);
  return () => { invalidated.delete(listener); };
};
export type SavedSession = {
  studentId: string;
  password: string;
  /** Profile snapshot is not authority to reveal private data offline. */
  student?: Student;
};
const readRaw = () => Platform.OS === 'web'
  ? AsyncStorage.getItem(SESSION_KEY) : SecureStore.getItemAsync(SESSION_KEY);
const purgeDashboard = async (studentId?: string) => {
  if (!studentId) return;
  await Promise.all(['live', 'live-readonly', 'mock'].map(mode =>
    AsyncStorage.removeItem(`ump_mobile_cache_${mode}_${studentId}`).catch(() => undefined)));
};
const serialize = (operation: () => Promise<void>) => {
  const next = pendingMutation.then(operation);
  pendingMutation = next.catch(() => undefined);
  return next;
};
export const getSavedSession = async (): Promise<SavedSession | null> => {
  await pendingMutation;
  try {
    const raw = await readRaw();
    return raw ? JSON.parse(raw) as SavedSession : null;
  } catch {
    await clearSavedSession();
    return null;
  }
};
export const saveSession = async (session: SavedSession) => {
  const epoch = ++generation;
  await serialize(async () => {
    let previous: SavedSession | null = null;
    try { const raw = await readRaw(); previous = raw ? JSON.parse(raw) : null; } catch { /* replace malformed session */ }
    await retirePushBinding(previous).catch(() => undefined);
    await purgeDashboard(previous?.studentId);
    if (epoch !== generation) throw new Error('Student session changed.');
    const raw = JSON.stringify(session);
    if (Platform.OS === 'web') await AsyncStorage.setItem(SESSION_KEY, raw);
    else await SecureStore.setItemAsync(SESSION_KEY, raw, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  });
  if (epoch !== generation) throw new Error('Student session changed.');
};
export const clearSavedSession = async () => {
  generation += 1;
  invalidated.forEach(listener => listener());
  await serialize(async () => {
    try {
      const raw = await readRaw();
      const previous = raw ? JSON.parse(raw) as SavedSession : null;
      await retirePushBinding(previous).catch(() => undefined);
      await purgeDashboard(previous?.studentId);
    } catch { /* still remove malformed session */ }
    if (Platform.OS === 'web') await AsyncStorage.removeItem(SESSION_KEY);
    else await SecureStore.deleteItemAsync(SESSION_KEY);
  });
};
