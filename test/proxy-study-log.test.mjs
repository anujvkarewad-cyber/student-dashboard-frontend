import assert from "node:assert/strict";
import test from "node:test";

process.env.MENTOR_API_URL = "https://mentor.example.test";
process.env.APPS_SCRIPT_URL = "https://script.example.test/exec";
const { default: handler } = await import("../api/proxy.js");

const request = () => ({
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
      result: { success: false, message: "Could not save your study log. Please try again." },
    });
  });
});
