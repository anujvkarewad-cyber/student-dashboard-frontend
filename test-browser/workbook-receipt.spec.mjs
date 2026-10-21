import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const id = 'a'.repeat(24);
const sampleBook = { id, title: 'Synthetic Audit workbook — test only', subject: 'Audit', sourceUrl: 'https://drive.google.com/file/d/fixture123456789/view', questions: [{ id: 'q1', prompt: 'Explain independence in an audit engagement.', maxMarks: 4, page: 2, workbookPage: 1 }] };
async function fixture(page, { gradeFailure = false } = {}) {
  const calls = []; const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('ump_student', JSON.stringify({ studentId: 'UMP9001', password: 'browser-test-only' })); window.__streams = []; const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async opts => { const stream = await original(opts); window.__streams.push(stream); return stream; }; });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== 'https://practice.test') return route.abort();
    if (url.pathname.startsWith('/api/mentor/api/practice')) {
      calls.push({ path: url.pathname, body: req.postData() });
      const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname.endsWith('/session')) return send({ token: 'local-browser-fixture', studentId: 'UMP9001' });
      if (url.pathname.endsWith('/workbooks')) return send({ workbooks: [sampleBook] });
      if (url.pathname.endsWith('/pdf')) return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync(path.join(root, 'test-browser/workbook-fixture.pdf')) });
      if (url.pathname.endsWith('/handwriting/read')) return send({ text: 'Auditor should use independent judgement and avoid conflicts.', requiresConfirmation: true });
      if (url.pathname.endsWith('/receipt/transcribe')) { fs.writeFileSync('/home/user/workbook-receipts/browser-capture.webm', req.postDataBuffer()); return send({ text: 'Independent judgement aur conflicts avoid karna.', audioStored: false, requiresConfirmation: true }); }
      if (url.pathname.endsWith('/grade')) return gradeFailure ? send({ detail: 'Marker unavailable. Your draft is safe.' }, 503) : send({ status: 'graded', provisional: true, understoodMeaning: 'Independent judgement and avoidance of conflicts.', score: 4, maxMarks: 4, points: [{ awarded: 4, maxMarks: 4, concept: 'Independence', quote: 'independent judgement', reason: 'Equivalent meaning is accepted.' }], improvement: ['Give an example.'], modelAnswer: 'Use independent judgement and avoid conflicts of interest.', referenceLabel: 'Synthetic rubric, not real checking', page: 2 });
      return route.abort();
    }
    if (url.pathname === '/receipt-library-fixture.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><h1>Existing private receipt</h1><button type="button" data-receipt-library>My private recordings</button><script src="receipt-audio-vault.js"></script><script src="receipt-voice.js"></script><script>UMP_RECEIPT_VOICE.attach(document.body)</script>' });
    if (url.pathname === '/receipt-fixture.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><form><textarea data-recall-id="q1">Existing typed answer.</textarea><button id="submit">Save receipt</button></form><script src="practice-client.js"></script><script src="receipt-audio-vault.js"></script><script src="receipt-voice.js"></script><script>window.__submits=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.__submits++};UMP_RECEIPT_VOICE.attach(document.body)</script>' });
    const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (!['workbook.html','workbook.js','workbook-core.js','practice-client.js','receipt-voice.js','receipt-audio-vault.js'].includes(relative) && !relative.startsWith('practice-vendor/')) return route.abort();
    const file = path.resolve(root, relative); if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
    const type = relative.endsWith('.mjs') || relative.endsWith('.js') ? 'application/javascript' : relative.endsWith('.wasm') ? 'application/wasm' : relative.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
  });
  return { calls, errors };
}
test('PDF rendering, on-page ink, draft recovery and explicit meaning-based feedback', async ({ page }) => {
  const { calls, errors } = await fixture(page);
  await page.goto('https://practice.test/workbook.html'); await page.getByRole('button', { name: 'Open workbook', exact: true }).click();
  await page.locator('#writing summary').click();
  await expect(page.locator('#pdfState')).toHaveText('Workbook PDF page 1', { timeout: 30000 });
  await page.locator('#pad').evaluate(el => { el.parentElement.scrollTop = 0; el.scrollIntoView({ block: 'start' }); });
  const pad = await page.locator('#pad').boundingBox(); await page.mouse.move(pad.x + 100, pad.y + 150); await page.mouse.down(); await page.mouse.move(pad.x + 220, pad.y + 185, { steps: 15 }); await page.mouse.up();
  await expect(page.locator('#saved')).toHaveText('Draft saved on this device.');
  expect(calls.filter(c => c.path.endsWith('/grade'))).toHaveLength(0);
  await page.locator('#read').click(); await expect(page.locator('#answer')).toHaveValue(/independent judgement/);
  await expect(page.locator('#grade')).toBeDisabled(); await page.locator('#confirmed').check(); await page.locator('#grade').click();
  await expect(page.locator('#feedback')).toContainText('4 / 4'); await expect(page.locator('#feedback')).toContainText('What the checker understood');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('ump_workbook_drafts_v1_UMP9001')));
  expect(before[id + ':q1'].pages[0].length).toBeGreaterThan(0);
  await page.screenshot({ path: '/home/user/workbook-receipts/workbook-browser-check.png', fullPage: true });
  await page.reload(); await page.getByRole('button', { name: 'Open workbook', exact: true }).click(); await expect(page.locator('#answer')).toHaveValue(/independent judgement/);
  expect(calls.some(c => /publish|push|student-attempts|revision/.test(c.path))).toBe(false); expect(errors).toEqual([]);
});
test('AI outage never invents a score and preserves typed draft', async ({ page }) => {
  await fixture(page, { gradeFailure: true }); await page.goto('https://practice.test/workbook.html'); await page.getByRole('button', { name: 'Open workbook', exact: true }).click();
  await page.locator('#answer').fill('My independent judgement answer stays saved.'); await page.locator('#confirmed').check(); await page.locator('#grade').click();
  await expect(page.locator('#error')).toContainText('Marker unavailable'); await expect(page.locator('#feedback')).toBeHidden(); await expect(page.locator('#answer')).toHaveValue('My independent judgement answer stays saved.');
});
test('real browser MediaRecorder with fake microphone: no autosubmit, editable transcript, cleanup', async ({ page, context }) => {
  await context.grantPermissions(['microphone'], { origin: 'https://practice.test' }); const { calls, errors } = await fixture(page);
  await page.goto('https://practice.test/receipt-fixture.html'); await page.getByRole('button', { name: /Speak instead/ }).click(); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled(); await page.waitForTimeout(700); await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(calls.filter(c => c.path.endsWith('/receipt/transcribe'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Send temporary audio & transcribe', exact: true }).click();
  await expect(page.getByLabel('Editable voice transcript')).toHaveValue(/Independent judgement/);
  await expect(page.locator('[data-recall-id]')).toHaveValue('Existing typed answer.');
  await page.getByLabel('Editable voice transcript').fill('Reviewed voice text, not automatically submitted.');
  await page.getByRole('button', { name: 'Insert reviewed text & delete recording' }).click();
  await expect(page.locator('[data-recall-id]')).toHaveValue('Existing typed answer.\nReviewed voice text, not automatically submitted.');
  expect(await page.evaluate(() => window.__submits)).toBe(0);
  expect(await page.evaluate(() => window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['ump_student']); expect(errors).toEqual([]);
});


test('native bridge hides browser-only navigation/download actions', async ({ page }) => {
  const { errors } = await fixture(page);
  await page.addInitScript(() => {
    window.ReactNativeWebView = { postMessage: message => {
      if (JSON.parse(message).type === 'practice-ready') setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'practice-session', token: 'local-native-fixture', studentId: 'UMP9001', expiresAt: Date.now() + 600000 }) })), 0);
    } };
  });
  await page.goto('https://practice.test/workbook.html');
  await page.getByRole('button', { name: 'Open workbook', exact: true }).click();
  await page.locator('#writing summary').click();
  await expect(page.locator('#dashboardBack')).toBeHidden();
  await expect(page.locator('#download')).toBeHidden();
  await expect(page.locator('#nativeDownloadNote')).toBeVisible();
  expect(errors).toEqual([]);
});

test('private saved recording survives modal close, stays account-isolated and deletes explicitly', async ({ page, context }) => {
  await context.grantPermissions(['microphone'], { origin: 'https://practice.test' });
  const { calls, errors } = await fixture(page);
  await page.goto('https://practice.test/receipt-fixture.html');
  await page.getByRole('button', { name: /Speak instead/ }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.waitForTimeout(500); await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Save recording on this device', exact: true }).click();
  await expect(page.locator('[data-status]')).toContainText('Saved privately');
  expect(calls.filter(c => c.path.endsWith('/receipt/transcribe'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Close (saved recordings stay)', exact: true }).click();
  await page.goto('https://practice.test/receipt-library-fixture.html'); await page.getByRole('button', { name: 'My private recordings', exact: true }).click();
  await expect(page.locator('[data-library-list]')).toContainText('1/10 clips');
  await page.getByRole('button', { name: 'Open saved recording', exact: true }).click();
  await expect(page.locator('audio')).toBeVisible();
  expect(await page.evaluate(async () => (await UMP_RECEIPT_AUDIO_VAULT.list('UMP9002')).length)).toBe(0);
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Delete saved recording', exact: true }).click();
  await expect(page.locator('[data-library-list]')).toContainText('0/10 clips');
  await expect(page.locator('[data-action=insert]')).toBeHidden(); expect(errors).toEqual([]);
});

test('browser private storage enforces concurrent cap and rejects oversize without eviction', async ({ page }) => {
  await fixture(page); await page.goto('https://practice.test/receipt-fixture.html');
  const result = await page.evaluate(async () => {
    const vault = UMP_RECEIPT_AUDIO_VAULT;
    const jobs = await Promise.allSettled(Array.from({ length: 11 }, () => vault.save('UMP9001', new Blob(['audio fixture'], { type: 'audio/webm' }))));
    const oversized = await vault.save('UMP9002', new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'audio/webm' })).then(() => false, () => true);
    return { saved: jobs.filter(r => r.status === 'fulfilled').length, refused: jobs.filter(r => r.status === 'rejected').length, count: (await vault.list('UMP9001')).length, oversized };
  });
  expect(result).toEqual({ saved: 10, refused: 1, count: 10, oversized: true });
});
