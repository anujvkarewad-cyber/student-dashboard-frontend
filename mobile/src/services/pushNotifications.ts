import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api/client';

export type NativePushStatus = 'idle' | 'requesting' | 'enabled' | 'denied' | 'unsupported' | 'configuration-required' | 'error';

const CHANNEL_ID = 'ump-updates';
const TOKEN_KEY_PREFIX = 'ump_native_fcm_v1_';
const TOKEN_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

type StoredToken = { token: string; savedAt: number };

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

    const key = `${TOKEN_KEY_PREFIX}${studentId}`;
    let saved: StoredToken | null = null;
    try {
      const raw = await AsyncStorage.getItem(key);
      saved = raw ? JSON.parse(raw) as StoredToken : null;
    } catch { saved = null; }

    if (force || saved?.token !== token || Date.now() - Number(saved?.savedAt || 0) >= TOKEN_REFRESH_MS) {
      const result = await api.saveDeviceToken(studentId, token);
      if (!result?.success) throw new Error(result?.message || 'The notification token could not be registered.');
      await AsyncStorage.setItem(key, JSON.stringify({ token, savedAt: Date.now() } satisfies StoredToken));
    }

    return 'enabled';
  } catch {
    return 'error';
  }
};

export const subscribeToNativeTokenChanges = (studentId: string) => Notifications.addPushTokenListener(async (next) => {
  if (Platform.OS === 'web' || typeof next.data !== 'string' || !next.data) return;
  try {
    const result = await api.saveDeviceToken(studentId, next.data);
    if (result?.success) {
      await AsyncStorage.setItem(`${TOKEN_KEY_PREFIX}${studentId}`, JSON.stringify({ token: next.data, savedAt: Date.now() } satisfies StoredToken));
    }
  } catch { /* the weekly refresh retries a failed rotation */ }
});

export const notificationLink = (notification: Notifications.Notification) => {
  const data = notification.request.content.data || {};
  return String(data.link || data.target || '').trim().toLowerCase();
};
