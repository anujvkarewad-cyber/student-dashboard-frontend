import assert from "node:assert/strict";
import test from "node:test";

process.env.MENTOR_API_URL = "https://mentor.example.test";
const { default: handler } = await import("../api/proxy.js");

const request = () => ({
  body: {
    action: "changePassword",
    payload: {
      studentId: "UMP0001",
      currentPassword: "old-password",
      newPassword: "new-password",
    },
  },
  query: {},
});

const response = () => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const withFetch = async (implementation, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
};

test("changePassword returns the backend's rejected-current-password result instead of falling through to 503", async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, "https://mentor.example.test/api/student-auth/change-password");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), {
      studentId: "UMP0001",
      currentPassword: "old-password",
      newPassword: "new-password",
    });
    return new Response(JSON.stringify({
      result: { success: false, code: "wrong_password", message: "Current password is incorrect." },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, async () => {
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      result: { success: false, code: "wrong_password", message: "Current password is incorrect." },
    });
  });
});

test("changePassword returns a successful backend result", async () => {
  await withFetch(async () => new Response(JSON.stringify({
    result: { success: true, message: "Password changed." },
  }), { status: 200, headers: { "Content-Type": "application/json" } }), async () => {
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      result: { success: true, message: "Password changed." },
    });
  });
});
