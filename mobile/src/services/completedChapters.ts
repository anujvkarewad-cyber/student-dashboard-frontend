import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'ump_completed_chapters_v1';

/**
 * v1.11.0 — chapters the student has finished reading.
 * The AI Assistant unlocks ONLY these chapters (reform policy:
 * "AI assistant for students — only played will work on it till now").
 * A chapter counts finished when its AI quiz + short-answer round is done,
 * or when the student self-marks it as read.
 */
export const getCompletedChapters = async (): Promise<string[]> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const setChapterCompleted = async (chapterId: string, done: boolean): Promise<string[]> => {
  const list = await getCompletedChapters();
  const next = done ? Array.from(new Set([...list, chapterId])) : list.filter((id) => id !== chapterId);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full/unavailable — non fatal */
  }
  return next;
};
