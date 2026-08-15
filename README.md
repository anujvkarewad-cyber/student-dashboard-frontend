# Ujjwal Pathak Mentorship — Student Dashboard

Web/PWA student dashboard backed by the existing Apps Script API.

## APK-parity learning tools

The web client includes the same device-local learning flows as the native APK:

- Focus Room with subject/target selection, a persistent pause/resume timer, daily goal and local session history
- Study Receipts with three closed-book recall prompts, recall-effort scoring and a 24-hour memory check
- Separate Group I and Group II Daily MCQ Challenges (7 normal + 3 case-study questions, 10-minute timer, results and streaks)
- Unlimited MCQ Practice with group, subject, official ICAI chapter, question-type, difficulty and session-size filters
- Answer review, explanations, ICAI chapter references and incorrect-answer retry

Focus, receipt and MCQ state is stored per student in browser local storage, matching the APK's current device-local behavior. It does not write these flows to the mentorship backend.

The web question bundle is generated from the APK's canonical TypeScript bank and chapter taxonomy. After changing native MCQ data, rebuild the web bundle with:

```bash
node scripts/build-web-learning-data.js
```

## Static files

The production entry point is `index.html`. `service-worker.js` provides PWA caching and Firebase background-message handling. The Apps Script proxy is exposed through `api/proxy.js` on Vercel.
