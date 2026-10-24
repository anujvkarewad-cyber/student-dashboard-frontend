import { test, expect } from '@playwright/test';
// Actual browser -> student gateway -> backend/auth/memory Mongo -> fake provider.
// Not run by the offline route-mocked browser suite. Requires explicit local QA servers.
test('real gateway/API: mentor authoring, assigned real PDF, grading cache and private receipt no-persistence', async ({ page, request }) => {
  const base = '/api/mentor/api';
  const login = await request.post(base + '/auth/login', { data: { email: 'mentor@test.local', password: 'local-mentor-test-only' } });
  expect(login.ok()).toBeTruthy(); const mentor = { Authorization: 'Bearer ' + (await login.json()).token };
  const create = await request.post(base + '/practice/mentor/workbooks', { headers: mentor, data: {
    title: 'LOCAL QA ONLY — actual Aura workbook, illustrative test weights', subject: 'Audit', groups: ['Group 2'], batches: ['Local QA'],
    sourceUrl: 'https://drive.google.com/file/d/1wcmkQfWDz_Iv2g6FXstYi44h08eyAXt1/view',
    questions: [{ id: 'q2', prompt: 'CA N, engagement partner of LPS & Associates, wants to ensure compliance with independence requirements. How shall he form a conclusion?',
      modelAnswer: 'Obtain relevant information to identify threats; evaluate breaches; eliminate threats or reduce them with safeguards, or withdraw where legally permitted; promptly report unresolved matters to the firm.',
      referenceLabel: 'Aura RTP Sep 24 Q1 / PDF pages 3–4; weights are local test fixtures, not approved marks', page: 3, workbookPage: 2, maxMarks: 4, sourceVerified: true,
      rubric: [{ id: 'r1', concept: 'Identify threats, evaluate breaches, act appropriately and report unresolved matters', marks: 4 }] }]
  } });
  expect(create.ok()).toBeTruthy(); const id = (await create.json()).id;
  expect((await request.post(base + '/practice/mentor/workbooks/' + id + '/publish', { headers: mentor })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.setItem('ump_student', JSON.stringify({ studentId: 'UMP9001', password: 'local-student-test-only' })));
  await page.goto('/workbook.html'); await page.getByRole('button', { name: 'Open workbook', exact: true }).click();
  await page.locator('#writing summary').click(); await expect(page.locator('#pdfState')).toHaveText('Workbook PDF page 2');
  await page.locator('#answer').fill('Get firm information about threats, assess breaches, apply safeguards or legally withdraw, and promptly report unresolved issues.');
  await expect(page.locator('#grade')).toBeDisabled(); await page.locator('#confirmed').check(); await page.locator('#grade').click();
  await expect(page.locator('#feedback')).toContainText('4 / 4'); await expect(page.locator('#feedback')).toContainText('QA fixture response');
  await page.locator('#grade').click(); await expect(page.locator('#feedback')).toContainText('4 / 4');
  const session = await request.post(base + '/practice/session', { data: { studentId: 'UMP9001', password: 'local-student-test-only' } });
  const student = { 'X-Practice-Token': (await session.json()).token };
  const listing = await request.get(base + '/practice/workbooks', { headers: student });
  expect(JSON.stringify(await listing.json())).not.toContain('modelAnswer');
  expect((await request.get(base + '/practice/workbooks/' + id + '/pdf')).status()).toBe(401);
  const pdf = await request.get(base + '/practice/workbooks/' + id + '/pdf', { headers: student });
  expect(pdf.headers()['cache-control']).toBe('no-store'); expect((await pdf.body()).length).toBe(57722);
  const feedback = await request.post(base + '/practice/receipt/evaluate', { headers: student, data: { question: 'Explain auditor independence in your own words.', studentAnswer: 'Auditors must exercise independent judgement and avoid conflicts of interest.', confirmed: true } });
  expect(feedback.ok()).toBeTruthy(); expect(await feedback.json()).toMatchObject({ receiptStored: false, scoreStored: false, score: 7 });
  const summary = await request.get('/api/mentor/qa/summary');
  expect(await summary.json()).toMatchObject({ localOnly: true, providerMocked: true, gradeProvider: 1, receiptProvider: 1, revisionWrites: 0, revisionCount: 0, feedbackCount: 1 });
});
