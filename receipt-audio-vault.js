/* Student-private browser recordings. IndexedDB only; no sync or network calls. */
(function (root) {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024, MAX_COUNT = 10;
  let opening;
  function ownerKey(owner) {
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(owner || '')) throw new Error('Sign in before saving private recordings.');
    return owner.toUpperCase();
  }
  function database() {
    if (!root.indexedDB) return Promise.reject(new Error('Private recording storage is unavailable in this browser. Typing still works.'));
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = root.indexedDB.open('ump_private_receipt_audio_v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('clips', { keyPath: ['owner', 'id'] }).createIndex('owner', 'owner');
      request.onerror = () => reject(new Error('Private recording storage could not open.'));
      request.onblocked = () => reject(new Error('Close other app tabs and retry private storage.'));
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function transaction(owner, mode, operation) {
    owner = ownerKey(owner); const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('clips', mode), store = tx.objectStore('clips'); let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(failure || new Error('Storage operation failed. Your existing saved recordings were not deleted.'));
      operation(store, owner, value => { result = value; }, error => { failure = error; tx.abort(); });
    });
  }
  function list(owner) {
    return transaction(owner, 'readonly', (store, key, done) => {
      const request = store.index('owner').getAll(key);
      request.onsuccess = () => done(request.result.map(({ id, bytes, createdAt }) => ({ id, bytes, createdAt })).sort((a, b) => b.createdAt - a.createdAt));
    });
  }
  function save(owner, blob) {
    if (!blob || !Number.isFinite(blob.size) || blob.size <= 0 || blob.size > 2 * 1024 * 1024 || !/^audio\/(webm|mp4|ogg)(;|$)/.test(blob.type)) return Promise.reject(new Error('Use a supported receipt recording up to 2 MB.'));
    return transaction(owner, 'readwrite', (store, key, done, fail) => {
      const request = store.index('owner').getAll(key);
      request.onsuccess = () => {
        const rows = request.result;
        if (rows.length >= MAX_COUNT || rows.reduce((sum, row) => sum + row.bytes, 0) + blob.size > MAX_BYTES) return fail(new Error('Private recordings limit reached (10 clips / 20 MB). Delete a clip yourself before saving another. Nothing was evicted.'));
        const item = { owner: key, id: root.crypto.randomUUID(), createdAt: Date.now(), bytes: blob.size, blob };
        store.add(item); done({ id: item.id, createdAt: item.createdAt, bytes: item.bytes });
      };
    });
  }
  function load(owner, id) {
    return transaction(owner, 'readonly', (store, key, done) => { const request = store.get([key, id]); request.onsuccess = () => done(request.result?.blob || null); });
  }
  function remove(owner, id) { return transaction(owner, 'readwrite', (store, key) => { store.delete([key, id]); }); }
  root.UMP_RECEIPT_AUDIO_VAULT = { list, save, load, remove, MAX_BYTES, MAX_COUNT };
})(window);
