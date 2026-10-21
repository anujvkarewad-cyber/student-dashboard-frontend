(function (root) {
  'use strict';
  const MAX_POINTS = 20000, MAX_PAGES = 3, MAX_ANSWER = 12000, MAX_STORAGE = 2 * 1024 * 1024;
  function cleanDraft(input) {
    let count = 0;
    const pages = (Array.isArray(input?.pages) ? input.pages : [[]]).slice(0, MAX_PAGES).map(page => (Array.isArray(page) ? page : []).slice(0, 400).map(stroke => (Array.isArray(stroke) ? stroke : []).filter(p => {
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || count >= MAX_POINTS) return false;
      count++; return true;
    }).map(([x, y]) => [Math.max(0, Math.min(800, x)), Math.max(0, Math.min(1100, y))])).filter(s => s.length));
    return { answer: String(input?.answer || '').slice(0, MAX_ANSWER), pages: pages.length ? pages : [[]], updatedAt: Date.now() };
  }
  function saveDraft(storage, studentId, key, draft) {
    const storeKey = 'ump_workbook_drafts_v1_' + studentId;
    let all; try { all = JSON.parse(storage.getItem(storeKey) || '{}'); } catch (_) { all = {}; }
    if (!all || Array.isArray(all) || typeof all !== 'object') all = {};
    all[key] = cleanDraft(draft);
    // Never silently evict another answer. The student chooses what to clear.
    if (Object.keys(all).length > 20) throw new Error('20 drafts are saved. Clear an old draft before starting another.');
    const text = JSON.stringify(all);
    if (text.length * 2 > MAX_STORAGE) throw new Error('Draft storage is full. Copy/export your answer and clear an old draft.');
    storage.setItem(storeKey, text);
  }
  function loadDraft(storage, studentId, key) {
    try { return cleanDraft(JSON.parse(storage.getItem('ump_workbook_drafts_v1_' + studentId) || '{}')[key]); } catch (_) { return cleanDraft(null); }
  }
  function removeDraft(storage, studentId, key) {
    const storeKey = 'ump_workbook_drafts_v1_' + studentId;
    const all = JSON.parse(storage.getItem(storeKey) || '{}'); delete all[key]; storage.setItem(storeKey, JSON.stringify(all));
  }
  function pdfPreview(value) {
    if (!value) return '';
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['drive.google.com', 'docs.google.com', 'storage.googleapis.com'].includes(u.hostname)) throw new Error('Unsupported PDF reference link');
    const id = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] || (u.hostname === 'drive.google.com' ? u.searchParams.get('id') : '');
    if (id && /^[a-zA-Z0-9_-]+$/.test(id)) return 'https://drive.google.com/file/d/' + id + '/preview';
    return value;
  }
  root.UMP_WORKBOOK_CORE = { cleanDraft, saveDraft, loadDraft, removeDraft, pdfPreview, MAX_POINTS, MAX_PAGES, MAX_ANSWER };
})(typeof window !== 'undefined' ? window : globalThis);
