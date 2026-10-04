import assert from 'node:assert/strict';
import test from 'node:test';

import { handleProofUpload, proofConfig } from '../lib/proof-upload.js';

test('Apps Script proof configuration works without a Drive service-account key', () => {
  const config = proofConfig({
    APPS_SCRIPT_URL: 'https://script.example/exec',
    PROOF_UPLOAD_KEY: 'server-only-key',
  });
  assert.equal(config.appsScriptConfigured, true);
  assert.equal(config.directDriveConfigured, false);
  assert.equal(config.configured, true);
});

test('authenticated proof bytes are forwarded to the owner Apps Script', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/api/student-auth/login')) {
      return new Response(JSON.stringify({ result: { success: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url) === 'https://script.example/exec') {
      return new Response(JSON.stringify({
        result: {
          success: true,
          fileId: 'file-123',
          proofUrl: 'https://drive.google.com/file/d/file-123/view?usp=sharing',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await handleProofUpload({
    method: 'PUT',
    headers: {
      'content-type': 'image/png',
      'content-length': '8',
      'x-student-id': 'UMP0099',
      'x-session-password': 'student-password',
      'x-file-name': 'proof.png',
    },
    readBody: async () => Buffer.from('pngbytes'),
    mentorApiUrl: 'https://mentor.example',
    env: {
      APPS_SCRIPT_URL: 'https://script.example/exec',
      PROOF_UPLOAD_KEY: 'server-only-key',
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.proofUrl, 'https://drive.google.com/file/d/file-123/view?usp=sharing');
  assert.equal(calls.length, 2);

  const forwarded = JSON.parse(calls[1].init.body);
  assert.equal(forwarded.action, 'uploadProof');
  assert.equal(forwarded.payload.uploadKey, 'server-only-key');
  assert.equal(forwarded.payload.studentId, 'UMP0099');
  assert.equal(forwarded.payload.mimeType, 'image/png');
  assert.equal(forwarded.payload.base64, Buffer.from('pngbytes').toString('base64'));
  assert.equal(Object.hasOwn(forwarded.payload, 'password'), false);
});
