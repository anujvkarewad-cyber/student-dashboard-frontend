/**
 * Notifications the app owes the student every day, whether or not it is open.
 *
 * The target unlocks at 00:00, so the message announcing it has to be waiting at
 * 00:00 — an in-app row is useless if the student never opens the app that night.
 * These are scheduled with the OS, so they arrive with the phone locked.
 *
 * Only notifications the student cannot do without live here. The elective ones
 * (study reminders) are added by the student on the Reminders screen, which
 * starts empty: a stream of reminders nobody asked for is how people learn to
 * ignore the ones that matter.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const TARGET_KEY = 'ump_sched_target_unlock_v1';

const canSchedule = Platform.OS !== 'web';

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return Boolean(asked.granted);
  } catch {
    return false;
  }
}

async function scheduleDaily(key: string, content: { title: string; body: string }, hour: number, minute = 0) {
  if (!canSchedule) return;
  if (!(await ensureNotificationPermission())) return;

  // Re-scheduling the same reminder every launch would stack duplicates, so the
  // previous id is cancelled first.
  try {
    const previous = await AsyncStorage.getItem(key);
    if (previous) await Notifications.cancelScheduledNotificationAsync(previous).catch(() => undefined);
  } catch {
    /* no previous schedule */
  }

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, sound: true },
      trigger: { hour, minute, repeats: true } as never,
    });
    await AsyncStorage.setItem(key, id).catch(() => undefined);
  } catch {
    /* best effort - a missing notification must never break the app */
  }
}

/**
 * 00:00 - the moment the day's target opens. The student is told the target is
 * waiting and that finishing late is fine, because the students who study past
 * midnight are the ones this app is for.
 */
export const scheduleTargetUnlock = () => scheduleDaily(
  TARGET_KEY,
  {
    title: 'Today\'s target is open',
    body: 'Open the app and see today\'s three tasks. Night owl? It stays open - finish whenever you sit down.',
  },
  0,
  0,
);

/** Called once after login, and again whenever the student changes reminders. */
export const syncDailyNotifications = async () => {
  await scheduleTargetUnlock();
};

/**
 * Show a notification right now. Used for a mentor reply, which is only worth
 * anything while the student is not already looking at the app.
 */
export const notifyNow = async (title: string, body: string) => {
  if (!canSchedule) return;
  if (!(await ensureNotificationPermission())) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body: body.slice(0, 160), sound: true },
      trigger: null,
    });
  } catch {
    /* best effort */
  }
};
