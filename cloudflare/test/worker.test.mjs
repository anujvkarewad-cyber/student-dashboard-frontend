import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { MAX_PROOF_BYTES, safeFileName } from '../src/worker.js';

test('proof limit is exactly 10 MiB', () => assert.equal(MAX_PROOF_BYTES, 10 * 1024 * 1024));
test('Drive filenames cannot contain path traversal', () => {
  const value = safeFileName('UMP39', '../../bad name.pdf');
  assert.match(value, /^UMP39_\d+_bad_name\.pdf$/);
  assert.equal(value.includes('..'), false);
});
test('health endpoint does not need secrets', async () => {
  const response = await worker.fetch(new Request('https://gateway.test/health'), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'upm-emergency-gateway' });
});
test('oversized proof is rejected before authentication', async () => {
  const request = new Request('https://gateway.test/api/proof-upload', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(MAX_PROOF_BYTES + 1) },
    body: new Uint8Array([1]),
  });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 413);
});
