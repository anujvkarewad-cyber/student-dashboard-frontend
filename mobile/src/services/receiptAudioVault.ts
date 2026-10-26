import * as FS from 'expo-file-system/legacy';

export const RECEIPT_VAULT_BYTES = 20 * 1024 * 1024;
export const RECEIPT_VAULT_COUNT = 10;
export type SavedReceiptAudio = { id: string; uri: string; bytes: number; createdAt: number };
let queue: Promise<unknown> = Promise.resolve();
const locked = <T>(action: () => Promise<T>): Promise<T> => {
  const next = queue.then(action, action); queue = next.catch(() => undefined); return next;
};
function directory(owner: string) {
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(owner) || !FS.documentDirectory) throw new Error('Private audio storage is unavailable on this device.');
  return `${FS.documentDirectory}receipt-audio-v1/${owner.toUpperCase()}/`;
}
const owned = /^clip-(\d{13})-[a-z0-9]+\.m4a$/;
export async function listReceiptAudio(owner: string): Promise<SavedReceiptAudio[]> {
  const dir = directory(owner);
  const info = await FS.getInfoAsync(dir);
  if (!info.exists) return [];
  const names = await FS.readDirectoryAsync(dir);
  const entries = await Promise.all(names.filter(name => owned.test(name)).map(async id => {
    const file = await FS.getInfoAsync(dir + id);
    return file.exists && !file.isDirectory ? { id, uri: dir + id, bytes: file.size, createdAt: Number(owned.exec(id)![1]) } : null;
  }));
  return entries.filter((entry): entry is SavedReceiptAudio => entry !== null).sort((a, b) => b.createdAt - a.createdAt);
}
export function saveReceiptAudio(owner: string, uri: string): Promise<SavedReceiptAudio> {
  return locked(async () => {
    // Never fetch a URL or copy arbitrary documents into the personal library.
    if (!FS.cacheDirectory || !uri.startsWith(FS.cacheDirectory) || !/\.receipt\.m4a$/.test(uri) || uri.includes('/../')) throw new Error('Only a new temporary receipt recording can be saved.');
    const info = await FS.getInfoAsync(uri);
    if (!info.exists || info.isDirectory || info.size <= 0 || info.size > 2 * 1024 * 1024) throw new Error('Recording must be between 1 byte and 2 MB.');
    const entries = await listReceiptAudio(owner);
    if (entries.length >= RECEIPT_VAULT_COUNT || entries.reduce((sum, item) => sum + item.bytes, 0) + info.size > RECEIPT_VAULT_BYTES) throw new Error('Private recordings limit reached (10 clips / 20 MB). Delete a recording yourself before saving another; nothing was evicted.');
    const dir = directory(owner); await FS.makeDirectoryAsync(dir, { intermediates: true });
    const createdAt = Date.now(), id = `clip-${createdAt}-${Math.random().toString(36).slice(2, 12)}.m4a`;
    const destination = dir + id;
    if ((await FS.getInfoAsync(destination)).exists) throw new Error('Please retry saving the recording.');
    try {
      await FS.copyAsync({ from: uri, to: destination });
      const saved = await FS.getInfoAsync(destination);
      if (!saved.exists || saved.isDirectory || saved.size !== info.size) throw new Error('Recording could not be copied completely.');
      return { id, uri: destination, bytes: info.size, createdAt };
    } catch (error) { await FS.deleteAsync(destination, { idempotent: true }).catch(() => undefined); throw error; }
  });
}
export function deleteReceiptAudio(owner: string, id: string): Promise<void> {
  return locked(async () => {
    if (!owned.test(id)) throw new Error('Invalid private recording.');
    await FS.deleteAsync(directory(owner) + id, { idempotent: true });
  });
}
