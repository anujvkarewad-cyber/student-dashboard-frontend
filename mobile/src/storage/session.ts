import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_KEY = 'ump_mobile_session_v1';

export type SavedSession = {
  studentId: string;
  password: string;
};

export const getSavedSession = async (): Promise<SavedSession | null> => {
  try {
    const raw = Platform.OS === 'web'
      ? await AsyncStorage.getItem(SESSION_KEY)
      : await SecureStore.getItemAsync(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    await clearSavedSession();
    return null;
  }
};

export const saveSession = async (session: SavedSession) => {
  const raw = JSON.stringify(session);
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(SESSION_KEY, raw);
  } else {
    await SecureStore.setItemAsync(SESSION_KEY, raw, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
};

export const clearSavedSession = async () => {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(SESSION_KEY);
  } else {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
};
