import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('student web test-channel maps the per-student mentor remark from the backend', async () => {
  const session = { studentId: 'UMP0001', password: 'student-password' };
  let request;
  const sandbox = {
    console: { error() {} },
    localStorage: { getItem: (key) => key === 'ump_student' ? JSON.stringify(session) : null },
    fetch: async (url, options) => {
      request = { url, options };
      return {
        json: async () => ({
          tests: [{
            testId: 'TEST-1', title: 'Audit paper', kind: 'paper-test',
            mentorRemark: 'Review your answer to Q3.',
          }],
        }),
      };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('web-tests.js'), sandbox, { filename: 'web-tests.js' });

  const tests = await sandbox.UMP_TEST_CHANNEL.load();
  assert.equal(request.url.endsWith('/api/student-tests/list'), true);
  assert.deepEqual(JSON.parse(request.options.body), session);
  assert.equal(tests[0].testId, 'TEST-1');
  assert.equal(tests[0].mentorRemark, 'Review your answer to Q3.');
});

test('student web displays remarks in the list and test detail as escaped text', () => {
  const app = read('app.js');
  assert.match(app, /function renderMentorRemark\(value\)/);
  assert.match(app, /escapeHtml\(remark\)/);
  assert.match(app, /renderMentorRemark\(test\.mentorRemark\)/);
  assert.match(app, /renderMentorRemark\(meta\.mentorRemark \|\| test\.mentorRemark\)/);
  assert.match(app, /\$\{mentorRemarkHtml\}/);
});
