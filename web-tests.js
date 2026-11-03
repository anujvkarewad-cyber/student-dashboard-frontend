/* Mentor tests — student side (server-side only, no APK rebuild). */
(function () {
  "use strict";

  var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzyfWa8agayMB0XLjkbfhfj2MdIRElAiY2Wnd7-eQKd1zlMl099ky6Cif06TWydzr8D/exec";
  var PYTHON_BACKEND = "https://ujjwal-pathak-app-566076646952.asia-south1.run.app";

  function session() {
    try {
      var raw = JSON.parse(localStorage.getItem("ump_student") || "null") || {};
      var studentId = String(raw.studentId || "").trim().toUpperCase();
      var password = String(raw.password || "");
      if (!studentId || !password) return null;
      return { studentId: studentId, password: password };
    } catch (_) {
      return null;
    }
  }

  // Temporary function because mapTest is needed by load
  function mapTest(item) {
    return {
      id: item.testId,
      testId: item.testId,
      title: item.title,
      subject: item.subject || "",
      durationMin: item.durationMinutes || 0,
      maxMarks: item.maxMarks || 0,
      questionCount: item.questionCount || 0,
      kind: item.kind || "mcq-test",
      hasAnswerSheet: !!item.hasAnswerSheet,
      hasMarkingScheme: !!item.hasMarkingScheme,
      hasPaper: !!item.hasPaper,
      status: item.status || "open",
      attempted: !!item.attempted,
      lastScore: item.lastScore,
      lastTotal: item.lastTotal,
      instructions: item.instructions || "",
      questions: [],
    };
  }

  var state = { tests: [], loadedAt: 0 };

  function load() {
    var current = session();
    if (!current) return Promise.reject(new Error("Login required"));
    
    // We hit the Python backend for listing MongoDB tests
    return fetch(PYTHON_BACKEND + "/api/student-tests/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: current.studentId, password: current.password })
    }).then(r => r.json()).then(data => {
      if(data && data.tests) {
         state.tests = data.tests.map(mapTest);
         state.loadedAt = Date.now();
         window.UMP_WEB_TESTS = state.tests;
         return state.tests;
      }
      return [];
    }).catch(e => {
      console.error(e);
      return [];
    });
  }

  function paper(testId) {
    var current = session();
    return fetch(PYTHON_BACKEND + "/api/student-tests/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: current.studentId, password: current.password, testId: testId })
    }).then(r => r.json());
  }

  function submit(testId, answers, durationSeconds) {
    var current = session();
    return fetch(PYTHON_BACKEND + "/api/student-tests/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: current.studentId, password: current.password, testId: testId, answers: answers || {}, durationSeconds: durationSeconds || 0 })
    }).then(r => r.json());
  }

  function submitMarks(testId, selfMarks, remarks, answerUrl) {
    var current = session();
    var payload = {
      studentId: current.studentId,
      password: current.password,
      testId: testId,
      selfMarks: Number(selfMarks),
      remarks: String(remarks || "").slice(0, 500)
    };
    if (answerUrl) payload.answerUrl = answerUrl;

    return fetch(PYTHON_BACKEND + "/api/student-tests/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(r => r.json()).then(res => {
      if (res.detail || res.error) throw new Error(res.detail || res.error);
      
      // Also push to Google Sheet via Apps Script webhook
      try {
         fetch(APPS_SCRIPT_URL, {
           method: 'POST',
           body: JSON.stringify({
             action: 'student.test.record',
             payload: {
                testId: testId,
                title: res.title || testId,
                studentId: current.studentId,
                score: res.score,
                total: res.total,
                scorePct: res.scorePct,
                remarks: res.remarks || remarks,
                selfMarks: true,
                answerUrl: answerUrl || ""
             }
           })
         });
      } catch (e) {}
      return res;
    });
  }

  window.UMP_TEST_CHANNEL = {
    load: load,
    paper: paper,
    submit: submit,
    submitMarks: submitMarks,
    tests: function () { return state.tests; },
    apiBase: function() { return PYTHON_BACKEND; }
  };
})();
