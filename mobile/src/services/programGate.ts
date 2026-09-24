import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDailyTarget } from '../api/reformApi';

const welcomeKey = (studentId: string) => `ump_welcome_once_${studentId}`;

export const WELCOME_TITLE = 'Welcome';
export const WELCOME_BODY = 'Welcome to Ujjwal Pathak Mentorship. Your study material is here. Daily targets and reminders will start when your mentor publishes them. This message is shown once.';

/** True only the first time this student opens the app. Later opens stay quiet. */
export async function takeWelcomeOnce(studentId: string): Promise<boolean> {
  const key = welcomeKey(studentId);
  try {
    if (await AsyncStorage.getItem(key) === 'yes') return false;
    await AsyncStorage.setItem(key, 'yes');
    return true;
  } catch {
    return false;
  }
}

/** A mentor-published target is the switch. Until then the daily system stays off. */
export async function targetsHaveStarted(studentId: string): Promise<boolean> {
  const remote = await fetchDailyTarget(studentId);
  return Boolean(remote && Array.isArray(remote.tasks) && remote.tasks.length);
}
