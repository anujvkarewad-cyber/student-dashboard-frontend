import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getSavedSession, getSessionGeneration } from '../storage/session';
import { bindPushToken } from '../storage/pushBinding';

export type NativePushStatus = 'idle' | 'requesting' | 'enabled' | 'denied' | 'unsupported' | 'configuration-required' | 'error';

const CHANNEL_ID = 'ump-updates';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

const ensureAndroidChannel = async () => {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Mentorship updates',
    description: 'New study material, mentor messages, announcements and reminders.',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 180, 250],
    lightColor: '#3157D5',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
  });
};

export const registerNativePush = async (studentId: string, force = false): Promise<NativePushStatus> => {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';

  const epoch = getSessionGeneration();
  const actor = await getSavedSession();
  const current = () => epoch === getSessionGeneration();
  if (!actor?.password || actor.studentId !== studentId || !current()) return 'error';
  try {
    await ensureAndroidChannel();
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return 'denied';

    let token: string;
    try {
      const nativeToken = await Notifications.getDevicePushTokenAsync();
      token = typeof nativeToken.data === 'string' ? nativeToken.data : '';
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('firebase') || message.includes('default app') || message.includes('google-services')) {
        return 'configuration-required';
      }
      throw error;
    }
    if (!token) return 'configuration-required';

    // Re-register every authenticated session, including A -> B -> A. A
    // per-student cache is not evidence of the server's current token owner.
    if (!current() || !await bindPushToken(actor, token, current)) return 'error';

    return 'enabled';
  } catch {
    return 'error';
  }
};

export const subscribeToNativeTokenChanges = (studentId: string) => {
  const epoch = getSessionGeneration();
  return Notifications.addPushTokenListener(async (next) => {
    if (Platform.OS === 'web' || typeof next.data !== 'string' || !next.data || epoch !== getSessionGeneration()) return;
    const actor = await getSavedSession();
    if (!actor?.password || actor.studentId !== studentId || epoch !== getSessionGeneration()) return;
    try { await bindPushToken(actor, next.data, () => epoch === getSessionGeneration()); }
    catch { /* no successful binding claim; next authenticated session retries */ }
  });
};

export const notificationLink = (notification: Notifications.Notification) => {
  const data = notification.request.content.data || {};
  return String(data.link || data.target || '').trim().toLowerCase();
};
