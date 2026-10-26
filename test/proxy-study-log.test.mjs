import assert from "node:assert/strict";
import test from "node:test";

process.env.MENTOR_API_URL = "https://mentor.example.test";
process.env.APPS_SCRIPT_URL = "https://script.example.test/exec";
const { default: handler } = await import("../api/proxy.js");

const request = () => ({
  headers: {"x-student-id":"UMP0001","x-session-password":"synthetic-local"},
  body: {
    action: "addStudyLog",
    payload: {
      studentId: "UMP0001",
      date: "2026-10-04",
      hours: 7,
      subjects: "Taxation",
      proofUrl: "https://drive.google.com/file/d/proof/view",
    },
  },
  query: {},
});

const response = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  setHeader() { return this; },
  json(body) { this.body = body; return this; },
});

const withFetch = async (implementation, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { await fn(); } finally { globalThis.fetch = original; }
};

test("addStudyLog returns Mongo success without forwarding to the password Apps Script", async () => {
  let calls = 0;
  await withFetch(async (url, init) => {
    calls += 1;
    assert.equal(url, "https://mentor.example.test/api/student-dashboard/write");
    assert.equal(init.method, "POST");
    const sent = JSON.parse(init.body);
    assert.equal(sent.action, "addStudyLog");
    assert.equal(sent.payload.studentId, "UMP0001");
    assert.equal(sent.payload.proofUrl, "https://drive.google.com/file/d/proof/view");
    return new Response(JSON.stringify({ ok: true, success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const res = response();
    await handler(request(), res);
    assert.equal(calls, 1);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { result: { success: true } });
  });
});

test("addStudyLog reports a write failure instead of calling the password Apps Script", async () => {
  let calls = 0;
  await withFetch(async (url) => {
    calls += 1;
    assert.equal(url, "https://mentor.example.test/api/student-dashboard/write");
    return new Response(JSON.stringify({ error: "write rejected" }), { status: 500 });
  }, async () => {
    const res = response();
    await handler(request(), res);
    assert.equal(calls, 1);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, {
      result: { success: false, message: "Save outcome is unknown. Keep this draft and check Study tracker before retrying." },
    });
  });
});

test("zero-hour submission reaches Mongo as numeric zero without attendance or proof calls", async () => {
  let calls = 0;
  await withFetch(async (url, init) => {
    calls += 1;
    assert.equal(url, "https://mentor.example.test/api/student-dashboard/write");
    const sent = JSON.parse(init.body);
    assert.equal(sent.action, "addStudyLog");
    assert.equal(sent.payload.hours, 0);
    assert.equal(typeof sent.payload.hours, "number");
    assert.equal(sent.payload.studiedAsPlanned, "No");
    assert.equal(sent.payload.reason, "Low Motivation");
    assert.equal(sent.payload.proofUrl, "");
    return new Response(JSON.stringify({ ok: true, success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const req = request();
    req.body.payload = {
      studentId: "UMP0001", date: "2026-10-18", hours: 0,
      studiedAsPlanned: "No", reason: "Low Motivation", subjects: "",
      targetCompleted: "", proofUrl: "",
    };
    const res = response();
    await handler(req, res);
    assert.equal(calls, 1);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { result: { success: true } });
  });
});

const unknown = 'Save outcome is unknown. Keep this draft and check Study tracker before retrying.';
async function probeBackend(reply, status = 200, options = {}) {
  let calls = 0;
  let sent;
  await withFetch(async (url, init) => {
    calls++;
    assert.equal(url, 'https://mentor.example.test/api/student-dashboard/write');
    sent = JSON.parse(init.body);
    if (options.throw) throw options.throw;
    return new Response(options.raw ?? JSON.stringify(reply), { status });
  }, async () => {
    const req = request();
    if (options.payload) req.body.payload = options.payload;
    const res = response();
    await handler(req, res);
    assert.equal(calls, 1, 'No retry, readback or legacy provider fallback');
    options.assert(res, sent);
  });
}

test('canonical backend acknowledgement retains proof URL and authoritative stats', async () => {
  const result = { success: true, proofUrl: 'https://example.test/proof', stats: { totalHours: 0.5 } };
  await probeBackend({ ok: true, result }, 200, { assert(res) {
    assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { result });
  } });
});

for (const [name, body] of [
  ['canonical application rejection', { ok: false, result: { success: false } }],
  ['success:false at top level', { ok: true, success: false }],
  ['nested false cannot be overridden by top-level true', { ok: true, success: true, result: { success: false } }],
  ['top-level false cannot be overridden by nested true', { ok: true, success: false, result: { success: true } }],
  ['ok:false cannot be overridden', { ok: false, result: { success: true } }],
  ['nested ok:false cannot be overridden', { ok: true, result: { ok: false, success: true } }],
  ['error cannot coexist with saved success', { ok: true, error: 'upstream failure', result: { success: true } }],
]) test(`HTTP 200: ${name} is never saved`, async () => {
  await probeBackend(body, 200, { assert(res) {
    assert.equal(res.statusCode, 502); assert.equal(res.body.result.success, false);
    assert.match(res.body.result.message, /rejected/);
  } });
});

for (const body of [null, [], {}, 'saved', { ok: true }, { success: true },
  { ok: 'true', result: { success: true } }, { ok: true, result: { success: 'true' } },
  { ok: true, success: 'false', result: { success: true } },
  { ok: true, result: { ok: 'false', success: true } },
  { ok: true, success: true, result: null }]) {
  test(`ambiguous acknowledgement ${JSON.stringify(body)} remains unknown`, async () => {
    await probeBackend(body, 200, { assert(res) {
      assert.equal(res.statusCode, 502); assert.deepEqual(res.body.result, { success: false, message: unknown });
    } });
  });
}
for (const raw of ['<html>Bad gateway</html>', '{"ok":true,', '']) {
  test(`malformed body ${JSON.stringify(raw)} never reports saved`, async () => {
    await probeBackend(null, 200, { raw, assert(res) { assert.equal(res.body.result.success, false); assert.equal(res.body.result.message, unknown); } });
  });
}
for (const status of [400, 401, 403, 422, 429, 408, 500, 502, 503, 202, 206]) {
  test(`HTTP ${status} is not a save acknowledgement even with a success body`, async () => {
    await probeBackend({ ok: true, result: { success: true } }, status, { assert(res) {
      assert.equal(res.statusCode, [401,403].includes(status) ? status : 502); assert.equal(res.body.result.success, false);
      assert.match(res.body.result.message, [401,403].includes(status) ? /session.*draft/ : status >= 400 && status < 500 && status !== 408 ? /rejected/ : /unknown/);
    } });
  });
}
for (const error of [new DOMException('Timed out after possible commit', 'AbortError'), new TypeError('Connection lost')]) {
  test(`${error.name} stays unknown and is not retried`, async () => {
    await probeBackend(null, 200, { throw: error, assert(res) { assert.equal(res.body.result.message, unknown); assert.equal(res.body.result.success, false); } });
  });
}

test('actual 12-second abort produces unknown without a second fetch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  await withFetch(async (url, init) => {
    calls++;
    return await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  }, async () => {
    const res = response(); const pending = handler(request(), res);
    await new Promise(setImmediate); // Let the real handler enter its write branch.
    assert.equal(calls, 1);
    t.mock.timers.tick(12000); await pending;
    assert.equal(calls, 1); assert.equal(res.body.result.message, unknown);
  });
});

test('explicit user retry keeps the original fractional row/date and has one attempt per submission', async () => {
  const payload = { studentId: 'UMP0001', date: '2026-10-04', hours: 0.5, subjects: 'Taxation' };
  let saved;
  let calls = 0;
  await withFetch(async (url, init) => {
    calls++; const received = JSON.parse(init.body).payload;
    assert.deepEqual(received, payload);
    if (!saved) { saved = received; throw new DOMException('Acknowledgement lost after commit', 'AbortError'); }
    assert.deepEqual(saved, received);
    return new Response(JSON.stringify({ ok: true, result: { success: true } }), { status: 200 });
  }, async () => {
    const req = request(); req.body.payload = payload;
    const first = response(); await handler(req, first);
    assert.equal(calls, 1); assert.equal(first.body.result.success, false);
    // This second call models an explicit user decision, NOT an automatic retry.
    const second = response(); await handler(req, second);
    assert.equal(calls, 2); assert.equal(second.body.result.success, true);
  });
});

test('no dormant Study Log provider-success branches remain', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../api/proxy.js', import.meta.url), 'utf8');
  assert.equal((src.match(/await mirrorStudyLogToMongo\(/g) || []).length, 1);
  assert.equal((src.match(/if \(updateAction === "addStudyLog"\)/g) || []).length, 1);
  assert.ok(!src.includes('Sheet retry pending'));
});
