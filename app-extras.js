/* UMP App Parity Extras — classic browser script (no ESM).
 *
 * Ports the four features the Android app had that this web app was missing:
 *   1. Official Daily MCQ Challenge (server-issued 10-question set)
 *   2. Written Answer evaluation (ICAI-style AI marking, feeds revision plan)
 *   3. Revision Planner dashboard (weak/average/strong chapter schedule)
 *   4. Reminders (WhatsApp number + test reminder + on-page daily reminders)
 *
 * Transport:
 *   action calls   → POST /api/proxy {action, payload}  (session headers)
 *   direct backend → /api/mentor/api/<backend path>     (gateway catch-all)
 * Session: localStorage 'ump_student' = { studentId, password, ... }.
 */
(function () {
  'use strict';

  // ---------------- shared helpers ----------------
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function actor() {
    try {
      var raw = JSON.parse(localStorage.getItem('ump_student') || 'null') || {};
      var sid = String(raw.studentId || '').trim().toUpperCase();
      var pwd = String(raw.password || '');
      if (!sid || !pwd) return null;
      raw.studentId = sid; raw.password = pwd;
      return raw;
    } catch (_) { return null; }
  }
  function mentorPost(path, body) {
    return fetch('/api/mentor' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(async function (r) {
      var data = {}; try { data = await r.json(); } catch (_) {}
      if (!r.ok) {
        var detail = data && (data.detail || data.error || data.message);
        if (Array.isArray(detail)) detail = (detail[0] && detail[0].msg) || 'Invalid request';
        var err = new Error(detail || ('Request failed (' + r.status + ')'));
        err.status = r.status;
        throw err;
      }
      return data;
    });
  }
  function actionCall(action, payload) {
    var a = actor();
    if (!a) return Promise.reject(new Error('Sign in first.'));
    return fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Student-Id': a.studentId,
        'X-Session-Password': a.password
      },
      body: JSON.stringify({ action: action, payload: payload || {} })
    }).then(async function (r) {
      var data = {}; try { data = await r.json(); } catch (_) {}
      if (!r.ok) throw new Error((data && (data.error || data.message)) || ('Request failed (' + r.status + ')'));
      if (data && data.success === false && data.message) throw new Error(data.message);
      return data;
    });
  }
  function unwrap(data) {
    // Some actions wrap payloads as {result: {...}}; some return directly.
    if (data && typeof data === 'object' && data.result && typeof data.result === 'object') return data.result;
    return data;
  }
  function istTodayKey() {
    try {
      var now = new Date(Date.now() + (330 * 60000));
      return now.toISOString().slice(0, 10);
    } catch (_) { return ''; }
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) { return iso; }
  }
  function normalizeGroup(raw) {
    var g = String(raw || '').trim();
    if (/^(group\s*)?(1|i)$/i.test(g)) return 'Group I';
    if (/^(group\s*)?(2|ii)$/i.test(g)) return 'Group II';
    if (/^both$/i.test(g)) return 'Both';
    return '';
  }
  function storeKey(name) {
    var a = actor();
    return 'ump_extras_' + name + '_' + (a ? a.studentId : 'anon');
  }
  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (_) { return fallback; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  // ================================================================
  // 1. OFFICIAL DAILY MCQ CHALLENGE
  // ================================================================
  var dcState = { set: null, answers: {}, idx: 0, startedAt: 0, timer: null };

  function dcClearTimer() {
    if (dcState.timer) { clearInterval(dcState.timer); dcState.timer = null; }
  }
  function dcTick(el) {
    if (!el || !el.isConnected) { dcClearTimer(); return; }
    var secs = Math.max(0, Math.floor((Date.now() - dcState.startedAt) / 1000));
    var m = Math.floor(secs / 60), s = secs % 60;
    el.textContent = m + ':' + String(s).padStart(2, '0');
  }

  function renderDailyChallenge(host, student) {
    if (!host) return;
    dcClearTimer();
    dcState.set = null; dcState.answers = {}; dcState.idx = 0;

    var todayKey = istTodayKey();
    var doneStore = loadJson(storeKey('daily_done'), {});
    var doneToday = null;
    Object.keys(doneStore).forEach(function (k) {
      if (doneStore[k] && doneStore[k].date === todayKey) doneToday = doneStore[k];
    });

    var myGroup = normalizeGroup(student && student.group);
    host.innerHTML =
      '<div class="card ex-dc-card">' +
        '<div class="ex-dc-head">' +
          '<div class="ex-dc-icon">🎯</div>' +
          '<div class="ex-dc-title-wrap">' +
            '<div class="ex-dc-title">Official Daily MCQ Challenge</div>' +
            '<div class="ex-dc-sub">10 CA-level questions · same set for whole batch · result syncs to mentor</div>' +
          '</div>' +
        '</div>' +
        '<div class="ex-dc-body" id="ex-dc-body"></div>' +
      '</div>';

    var body = host.querySelector('#ex-dc-body');

    if (doneToday) {
      body.innerHTML =
        '<div class="ex-dc-done">' +
          '<div class="ex-dc-done-score">' + doneToday.score + '/' + doneToday.total + '</div>' +
          '<div class="ex-dc-done-text">Today\'s challenge complete (' + esc(doneToday.group || '') + '). ' +
          'New set drops at midnight IST.</div>' +
        '</div>';
      return;
    }

    body.innerHTML =
      '<div class="ex-dc-start">' +
        (myGroup !== 'Group I' && myGroup !== 'Group II'
          ? '<label class="ex-label">Choose your group<select id="ex-dc-group" class="ex-select">' +
              '<option value="Group I">Group I (Accounts · Law · Tax)</option>' +
              '<option value="Group II">Group II (Costing · Audit · FM/SM)</option>' +
            '</select></label>'
          : '<div class="ex-dc-group-pill">' + esc(myGroup) + '</div>') +
        '<button class="btn-primary ex-btn" id="ex-dc-start" type="button">Get today\'s 10 questions</button>' +
        '<div class="ex-msg" id="ex-dc-msg"></div>' +
        '<div class="ex-dc-tips">7 direct questions + 3 case-study · answer all 10 to submit · you can attempt once per day</div>' +
      '</div>';

    host.querySelector('#ex-dc-start').addEventListener('click', function () {
      var a = actor();
      if (!a) { msg('Sign in first.'); return; }
      var sel = host.querySelector('#ex-dc-group');
      var group = myGroup || (sel ? sel.value : 'Group I');
      var btn = this;
      btn.disabled = true; btn.textContent = 'Issuing your set…';
      mentorPost('/api/student-attempts/daily-set', { studentId: a.studentId, password: a.password, group: group })
        .then(function (set) {
          btn.disabled = false;
          if (!set || !Array.isArray(set.questions) || set.questions.length !== 10) {
            msg('Set is not ready yet — please try again in a few minutes.');
            btn.textContent = 'Get today\'s 10 questions';
            return;
          }
          dcState.set = set; dcState.answers = {}; dcState.idx = 0;
          dcState.startedAt = Date.now();
          renderDcQuiz(body, set);
        })
        .catch(function (e) {
          btn.disabled = false; btn.textContent = 'Get today\'s 10 questions';
          if (e.status === 503) msg('Daily challenge is being prepared — try again shortly.');
          else if (e.status === 403) msg('This group is not linked to your account. Pick your own group.');
          else if (e.status === 401) msg('Session expired — sign in again.');
          else msg(e.message || 'Could not load the set.');
        });

      function msg(t) {
        var m = host.querySelector('#ex-dc-msg');
        if (m) { m.textContent = t; m.className = 'ex-msg ex-err'; }
      }
    });
  }

  function renderDcQuiz(body, set) {
    var q = dcState.set.questions[dcState.idx];
    var answered = Object.keys(dcState.answers).length;

    var palette = set.questions.map(function (qq, i) {
      var cls = 'ex-qp';
      if (dcState.answers[qq.id] != null) cls += ' done';
      if (i === dcState.idx) cls += ' current';
      return '<button type="button" class="' + cls + '" data-dc-jump="' + i + '">' + (i + 1) + '</button>';
    }).join('');

    var options = (q.options || []).map(function (opt, oi) {
      var sel = dcState.answers[q.id] === oi ? ' selected' : '';
      return '<button type="button" class="ex-opt' + sel + '" data-dc-opt="' + oi + '">' +
        '<span class="ex-opt-key">' + String.fromCharCode(65 + oi) + '</span>' +
        '<span class="ex-opt-text">' + esc(opt) + '</span></button>';
    }).join('');

    body.innerHTML =
      '<div class="ex-dc-quiz">' +
        '<div class="ex-dc-quiz-head">' +
          '<span class="ex-dc-count">Question ' + (dcState.idx + 1) + ' of 10' +
            (q.kind === 'case-study' ? ' · Case study' : '') + '</span>' +
          '<span class="ex-dc-timer" id="ex-dc-timer">0:00</span>' +
        '</div>' +
        '<div class="ex-dc-palette">' + palette + '</div>' +
        (q.caseStudy && q.caseStudy.passage
          ? '<div class="ex-case">' + esc(q.caseStudy.passage) + '</div>'
          : (q.scenario ? '<div class="ex-case">' + esc(q.scenario) + '</div>' : '')) +
        '<div class="ex-q-subject">' + esc(q.subject || '') + (q.chapter ? ' · ' + esc(q.chapter) : '') + '</div>' +
        '<div class="ex-q-prompt">' + esc(q.prompt) + '</div>' +
        '<div class="ex-opts">' + options + '</div>' +
        '<div class="ex-dc-nav">' +
          '<button type="button" class="ex-btn-ghost" id="ex-dc-prev"' + (dcState.idx === 0 ? ' disabled' : '') + '>← Prev</button>' +
          '<span class="ex-dc-progress-text">' + answered + '/10 answered</span>' +
          (dcState.idx === 9
            ? '<button type="button" class="btn-primary ex-btn" id="ex-dc-submit"' + (answered < 10 ? ' disabled' : '') + '>Submit challenge</button>'
            : '<button type="button" class="ex-btn-ghost" id="ex-dc-next">Next →</button>') +
        '</div>' +
        '<div class="ex-msg" id="ex-dc-quiz-msg"></div>' +
      '</div>';

    dcClearTimer();
    dcState.timer = setInterval(function () { dcTick(body.querySelector('#ex-dc-timer')); }, 1000);
    dcTick(body.querySelector('#ex-dc-timer'));

    body.querySelectorAll('[data-dc-opt]').forEach(function (b) {
      b.addEventListener('click', function () {
        dcState.answers[q.id] = Number(b.dataset.dcOpt);
        renderDcQuiz(body, set);
      });
    });
    body.querySelectorAll('[data-dc-jump]').forEach(function (b) {
      b.addEventListener('click', function () {
        dcState.idx = Number(b.dataset.dcJump);
        renderDcQuiz(body, set);
      });
    });
    var prev = body.querySelector('#ex-dc-prev');
    var next = body.querySelector('#ex-dc-next');
    if (prev) prev.addEventListener('click', function () { dcState.idx--; renderDcQuiz(body, set); });
    if (next) next.addEventListener('click', function () { dcState.idx++; renderDcQuiz(body, set); });
    var submit = body.querySelector('#ex-dc-submit');
    if (submit) submit.addEventListener('click', function () { submitDcAttempt(body, set); });
  }

  function submitDcAttempt(body, set) {
    var a = actor();
    if (!a) return;
    var btn = body.querySelector('#ex-dc-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    var score = set.questions.reduce(function (n, q) {
      return n + (dcState.answers[q.id] === q.answer ? 1 : 0);
    }, 0);
    var completedAt = Date.now();
    var attempt = {
      attemptId: 'web-' + set.officialSetId,
      kind: 'daily',
      bankRevision: set.bankRevision,
      date: set.date,
      group: set.group,
      officialSetId: set.officialSetId,
      questionIds: set.questionIds,
      answers: dcState.answers,
      startedAt: dcState.startedAt,
      completedAt: completedAt,
      score: score,
      total: 10,
      durationSeconds: Math.max(1, Math.floor((completedAt - dcState.startedAt) / 1000))
    };

    mentorPost('/api/student-attempts/sync', { studentId: a.studentId, password: a.password, attempts: [attempt] })
      .then(function () {
        dcClearTimer();
        var doneStore = loadJson(storeKey('daily_done'), {});
        doneStore[set.officialSetId] = {
          date: set.date, score: score, total: 10, group: set.group,
          answers: dcState.answers, questions: set.questions.map(function (q) {
            return { id: q.id, prompt: q.prompt, options: q.options, answer: q.answer, explanation: q.explanation, subject: q.subject, kind: q.kind };
          })
        };
        saveJson(storeKey('daily_done'), doneStore);
        renderDcResult(body, set, score, dcState.answers);
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Submit challenge'; }
        var m = body.querySelector('#ex-dc-quiz-msg');
        if (m) { m.textContent = e.message || 'Submit failed — try again.'; m.className = 'ex-msg ex-err'; }
      });
  }

  function renderDcResult(body, set, score, answers) {
    var pct = Math.round((score / 10) * 100);
    var verdict = pct >= 80 ? 'Outstanding — you are exam-sharp today.'
      : pct >= 60 ? 'Good work — review the misses below.'
      : pct >= 40 ? 'Fair — the explanations below are your revision list.'
      : 'Tough set — read every explanation carefully today.';

    var review = set.questions.map(function (q, i) {
      var mine = answers[q.id], correct = q.answer;
      var ok = mine === correct;
      var opts = (q.options || []).map(function (o, oi) {
        var cls = 'ex-ro';
        if (oi === correct) cls += ' right';
        else if (oi === mine) cls += ' wrong';
        return '<div class="' + cls + '">' + String.fromCharCode(65 + oi) + '. ' + esc(o) + '</div>';
      }).join('');
      return '<details class="ex-dc-review' + (ok ? ' ok' : ' miss') + '">' +
        '<summary><span class="ex-rv-mark">' + (ok ? '✓' : '✗') + '</span> Q' + (i + 1) + '. ' + esc(String(q.prompt || '').slice(0, 90)) + '…</summary>' +
        '<div class="ex-rv-body">' + opts +
        (q.explanation ? '<div class="ex-rv-exp"><b>Explanation:</b> ' + esc(q.explanation) + '</div>' : '') +
        '</div></details>';
    }).join('');

    body.innerHTML =
      '<div class="ex-dc-result">' +
        '<div class="ex-dc-score-ring"><b>' + score + '/10</b><span>' + pct + '%</span></div>' +
        '<div class="ex-dc-verdict">' + esc(verdict) + ' Result synced to mentor.</div>' +
        '<div class="ex-dc-review-list"><div class="ex-sec-title">Answer review</div>' + review + '</div>' +
      '</div>';
  }

  // ================================================================
  // 2. WRITTEN ANSWER EVALUATION
  // ================================================================
  // -------- Written tab state --------
  var wrState = { question: '', caseFacts: null, marks: 6, chapterId: '', concept: '', manual: false, busy: false };

  function wrChapters() {
    try {
      var ld = window.UMP_LEARNING_DATA || {};
      var list = Array.isArray(ld.officialMcqChapterCatalog) ? ld.officialMcqChapterCatalog
        : (Array.isArray(ld.chapters) ? ld.chapters : []);
      return list.filter(function (c) { return c && (c.displayTitle || c.officialTitle || c.title || c.chapterTitle); })
        .map(function (c) {
          return {
            chapterId: c.id || c.chapterId || '',
            subject: c.subject || '',
            chapterTitle: c.displayTitle || c.officialTitle || c.title || c.chapterTitle || '',
            chapter: 'Module ' + (c.module || '1') + ' · Chapter ' + (c.chapterNumber || '?') + ': ' +
              (c.displayTitle || c.officialTitle || c.title || c.chapterTitle || '')
          };
        });
    } catch (_) { return []; }
  }
  function wrSubjects(chapters) {
    var seen = {};
    chapters.forEach(function (c) { if (c.subject) seen[c.subject] = true; });
    return Object.keys(seen).sort();
  }
  function wrEscapeId(v) { return esc(String(v == null ? '' : v)).replace(/"/g, '&quot;'); }

  function renderWritten(root) {
    if (!root) return;
    var history = loadJson(storeKey('written'), []);
    wrState = { question: '', caseFacts: null, marks: 6, chapterId: '', concept: '', manual: false, busy: false };

    var chapters = wrChapters();
    var subjects = wrSubjects(chapters);
    var subjectOpts = ['<option value="">Any subject</option>']
      .concat(subjects.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; })).join('');
    var chapterOpts = ['<option value="">Any chapter</option>']
      .concat(chapters.map(function (c) {
        var label = c.chapter || (c.chapterTitle || '');
        return '<option value="' + wrEscapeId(c.chapterId) + '" data-subject="' + esc(c.subject || '') + '" data-title="' + esc(c.chapterTitle || c.chapter || '') + '">' + esc(String(label).replace(/^Module \d+ · /, '')) + '</option>';
      })).join('');

    root.innerHTML =
      '<div class="view" data-testid="view-written">' +
        '<div class="card ex-card">' +
          '<h3><i class="fa-solid fa-pen-to-square"></i> Written Answer Practice</h3>' +
          '<p class="ex-hint">Your question appears automatically — you only write the answer. Marking follows the ICAI examiner style, and a weak answer schedules your next revision automatically.</p>' +

          '<div class="ex-field"><span class="ex-label">Need to revise? Click one of your weak spots</span>' +
            '<div class="ex-chips" id="ex-w-weak"><span class="ex-hint">Loading your weak spots…</span></div></div>' +

          '<div class="ex-grid2">' +
            '<div class="ex-field"><span class="ex-label">Subject</span>' +
              '<select id="ex-w-subject" class="ex-select">' + subjectOpts + '</select></div>' +
            '<div class="ex-field"><span class="ex-label">Chapter</span>' +
              '<select id="ex-w-chapter" class="ex-select">' + chapterOpts + '</select></div>' +
          '</div>' +
          '<div class="ex-grid2">' +
            '<div class="ex-field"><span class="ex-label">Concept (optional)</span>' +
              '<input id="ex-w-concept" class="ex-input" maxlength="160" placeholder="e.g. Ind-AS 115 — revenue recognition"></div>' +
            '<div class="ex-field"><span class="ex-label">Marks</span>' +
              '<select id="ex-w-marks" class="ex-select">' +
                '<option value="4">4 marks (short)</option>' +
                '<option value="6" selected>6 marks (standard)</option>' +
                '<option value="8">8 marks (long)</option>' +
                '<option value="10">10 marks (full)</option>' +
              '</select></div>' +
          '</div>' +
          '<button class="btn-primary ex-btn" id="ex-w-getq" type="button">Get me a question</button>' +
          '<div class="ex-msg" id="ex-w-getqmsg"></div>' +
        '</div>' +

        '<div class="card ex-card" id="ex-w-qcard" hidden>' +
          '<div class="ex-q-subject" id="ex-w-qmeta"></div>' +
          '<div class="ex-q-prompt" id="ex-w-qtext"></div>' +
          '<div class="ex-case" id="ex-w-qcase" hidden></div>' +
          '<div class="ex-hint" id="ex-w-qnote"></div>' +
          '<div class="ex-field" style="margin-top:14px"><span class="ex-label">Your answer *</span>' +
            '<textarea id="ex-w-answer" class="ex-textarea" rows="8" maxlength="8000" placeholder="Write your complete exam answer here — headings, workings, conclusion…"></textarea>' +
            '<div class="ex-count" id="ex-w-count">0 / 8000</div></div>' +
          '<div class="ex-field"><span class="ex-label">How confident were you?</span>' +
            '<div class="ex-chips">' +
              '<label class="ex-chip"><input type="radio" name="ex-w-conf" value="low"> Guessing</label>' +
              '<label class="ex-chip"><input type="radio" name="ex-w-conf" value="medium" checked> Okay</label>' +
              '<label class="ex-chip"><input type="radio" name="ex-w-conf" value="high"> Very sure</label>' +
            '</div></div>' +
          '<div class="ex-wa-row">' +
            '<button class="btn-primary ex-btn" id="ex-w-submit" type="button">Mark my answer</button>' +
            '<button class="ex-btn-ghost" id="ex-w-newq" type="button">New question</button>' +
          '</div>' +
          '<div class="ex-msg" id="ex-w-msg"></div>' +
        '</div>' +

        '<div id="ex-w-result"></div>' +
        '<div class="card ex-card"><h3><i class="fa-solid fa-clock-rotate-left"></i> My recent markings</h3><div id="ex-w-history"></div></div>' +
      '</div>';

    // -- weak spots chips (revision plan) --
    (function () {
      var a = actor();
      var box = root.querySelector('#ex-w-weak');
      if (!a) { box.innerHTML = '<span class="ex-hint">Sign in to see weak spots.</span>'; return; }
      actionCall('revision.plan', { studentId: a.studentId }).then(function (data) {
        var plan = unwrap(data) || {};
        var weak = (plan.chapters || []).filter(function (c) { return c.strength === 'weak'; }).slice(0, 4);
        var due = (plan.due || []).filter(function (c) { return c.strength !== 'weak'; }).slice(0, 2);
        var chips = weak.concat(due);
        if (!chips.length) { box.innerHTML = '<span class="ex-hint">No weak spots — nice! Pick a chapter and get a question.</span>'; return; }
        box.innerHTML = chips.map(function (c) {
          return '<button type="button" class="ex-chip" data-wk-concept="' + esc(c.concept || '') + '" data-wk-chapter="' + esc(c.chapterId || '') + '" data-wk-subject="' + esc(c.subject || '') + '">⚠️ ' + esc(String(c.concept || 'Chapter').slice(0, 42)) + '</button>';
        }).join('');
        box.querySelectorAll('[data-wk-concept]').forEach(function (b) {
          b.addEventListener('click', function () {
            root.querySelector('#ex-w-concept').value = b.dataset.wkConcept || '';
            if (b.dataset.wkSubject) root.querySelector('#ex-w-subject').value = b.dataset.wkSubject;
            fetchWrQuestion(root);
          });
        });
      }).catch(function () { box.innerHTML = '<span class="ex-hint">Weak spots could not be loaded — continue by choosing a chapter.</span>'; });
    })();

    // -- subject filter narrows chapters --
    root.querySelector('#ex-w-subject').addEventListener('change', function () {
      var subj = this.value;
      root.querySelectorAll('#ex-w-chapter option').forEach(function (o) {
        o.hidden = !!(subj && o.dataset.subject && o.dataset.subject !== subj);
      });
      var sel = root.querySelector('#ex-w-chapter');
      if (sel.selectedOptions.length && sel.selectedOptions[0].hidden) sel.value = '';
    });

    root.querySelector('#ex-w-getq').addEventListener('click', function () { fetchWrQuestion(root); });

    var answerEl = root.querySelector('#ex-w-answer');
    answerEl.addEventListener('input', function () {
      root.querySelector('#ex-w-count').textContent = answerEl.value.length + ' / 8000';
    });

    root.querySelector('#ex-w-newq').addEventListener('click', function () {
      wrState.question = '';
      root.querySelector('#ex-w-qcard').hidden = true;
      root.querySelector('#ex-w-result').innerHTML = '';
      fetchWrQuestion(root);
    });

    root.querySelector('#ex-w-submit').addEventListener('click', function () {
      var a = actor();
      var ans = answerEl.value.trim();
      var conf = (root.querySelector('input[name="ex-w-conf"]:checked') || {}).value || 'medium';
      var msgEl = root.querySelector('#ex-w-msg');
      if (!a) { msgEl.textContent = 'Sign in first.'; msgEl.className = 'ex-msg ex-err'; return; }
      if (ans.length < 10) { msgEl.textContent = 'Write a fuller answer before marking.'; msgEl.className = 'ex-msg ex-err'; return; }
      var btn = this;
      btn.disabled = true; btn.textContent = 'Marking like an ICAI examiner… (up to ~45s)';
      msgEl.textContent = ''; msgEl.className = 'ex-msg';

      actionCall('ai.evaluate', {
        studentId: a.studentId, question: wrState.question, studentAnswer: ans,
        concept: wrState.concept, chapterId: wrState.chapterId || undefined, confidence: conf
      }).then(function (data) {
        btn.disabled = false; btn.textContent = 'Mark my answer';
        var r = unwrap(data);
        if (!r || r.ok !== true) {
          msgEl.textContent = (r && r.error) || 'Could not grade right now — please retry once.';
          msgEl.className = 'ex-msg ex-err'; return;
        }
        var entry = {
          at: new Date().toISOString(), question: wrState.question, concept: wrState.concept,
          score: r.score, subject: r.subject || '', revision: r.revision || null
        };
        history.unshift(entry); history = history.slice(0, 15);
        saveJson(storeKey('written'), history);
        renderWrittenResult(root, r, wrState.question, ans);
        renderWrittenHistory(root, history);
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'Mark my answer';
        msgEl.textContent = e.message || 'Marking failed — retry once.';
        msgEl.className = 'ex-msg ex-err';
      });
    });

    renderWrittenHistory(root, history);
  }

  function fetchWrQuestion(root) {
    var a = actor();
    var msgEl = root.querySelector('#ex-w-getqmsg');
    if (!a) { msgEl.textContent = 'Sign in first.'; msgEl.className = 'ex-msg ex-err'; return; }
    if (wrState.busy) return;
    wrState.busy = true;
    var btn = root.querySelector('#ex-w-getq');
    btn.disabled = true; btn.textContent = 'Setting your question…';
    msgEl.textContent = ''; msgEl.className = 'ex-msg';

    var chapterSel = root.querySelector('#ex-w-chapter');
    var chapterOpt = chapterSel.selectedOptions[0] || {};
    var concept = root.querySelector('#ex-w-concept').value.trim() || (chapterOpt.dataset ? chapterOpt.dataset.title : '') || '';
    var marks = Number(root.querySelector('#ex-w-marks').value || 6);

    mentorPost('/api/ai/practice-question', {
      studentId: a.studentId, password: a.password,
      subject: root.querySelector('#ex-w-subject').value || (chapterOpt.dataset ? chapterOpt.dataset.subject : '') || undefined,
      chapterId: chapterSel.value || undefined,
      concept: concept || undefined,
      marks: marks
    }).then(function (r) {
      wrState.busy = false;
      btn.disabled = false; btn.textContent = 'Get me a question';
      if (!r || r.ok !== true || !r.question) {
        msgEl.textContent = 'The question could not be generated — please try once more.';
        msgEl.className = 'ex-msg ex-err'; return;
      }
      wrState.question = r.question;
      wrState.caseFacts = r.caseFacts || null;
      wrState.marks = r.marks || marks;
      wrState.chapterId = r.chapterId || chapterSel.value || '';
      wrState.concept = r.concept || concept;

      root.querySelector('#ex-w-qmeta').textContent =
        (r.subject || 'CA Inter') + ' · ' + wrState.marks + ' marks' + (r.sourceHint ? ' · ' + r.sourceHint : '');
      root.querySelector('#ex-w-qtext').textContent = r.question;
      var caseEl = root.querySelector('#ex-w-qcase');
      if (r.caseFacts) { caseEl.textContent = r.caseFacts; caseEl.hidden = false; } else { caseEl.hidden = true; }
      root.querySelector('#ex-w-qnote').textContent = r.examinerNote ? ('Examiner expects: ' + r.examinerNote) : '';
      root.querySelector('#ex-w-answer').value = '';
      root.querySelector('#ex-w-count').textContent = '0 / 8000';
      root.querySelector('#ex-w-result').innerHTML = '';
      root.querySelector('#ex-w-qcard').hidden = false;
      root.querySelector('#ex-w-qcard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) {
      wrState.busy = false;
      btn.disabled = false; btn.textContent = 'Get me a question';
      msgEl.textContent = e.message || 'The question service is busy right now — try again shortly.';
      msgEl.className = 'ex-msg ex-err';
    });
  }

  function listLines(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return '<ul class="ex-list">' + items.map(function (i) { return '<li>' + esc(typeof i === 'string' ? i : (i.text || i.point || JSON.stringify(i))) + '</li>'; }).join('') + '</ul>';
  }

  function renderWrittenResult(root, r, question, answer) {
    var host = root.querySelector('#ex-w-result');
    if (!host) return;
    var score = (r.score != null ? r.score : '—');
    var pct = typeof r.score === 'number' ? Math.round(r.score * 10) : 0;
    var rev = r.revision || {};
    var band = pct >= 85 ? 'ex-band strong' : pct >= 70 ? 'ex-band good' : pct >= 40 ? 'ex-band avg' : 'ex-band weak';
    var bandText = pct >= 85 ? 'Strong' : pct >= 70 ? 'Good' : pct >= 40 ? 'Average' : 'Weak';

    host.innerHTML =
      '<div class="card ex-card ex-w-result">' +
        '<div class="ex-w-score-row">' +
          '<div class="ex-dc-score-ring"><b>' + score + '/10</b><span>' + pct + '%</span></div>' +
          '<div>' +
            '<span class="' + band + '">' + bandText + '</span>' +
            (r.subject ? '<div class="ex-hint">Subject: ' + esc(r.subject) + '</div>' : '') +
            (rev.dueOn
              ? '<div class="ex-rev-next"><i class="fa-solid fa-rotate"></i> Next revision: <b>' + fmtDate(rev.dueOn) + '</b>' +
                (rev.intervalDays != null ? ' (' + rev.intervalDays + ' day' + (rev.intervalDays === 1 ? '' : 's') + ')' : '') +
                '</div>'
              : '') +
          '</div>' +
        '</div>' +
        (r.missing ? '<div class="ex-block"><div class="ex-block-title ex-red">What was missing</div>' + listLines(r.missing) + '</div>' : '') +
        (r.wrong ? '<div class="ex-block"><div class="ex-block-title ex-orange">What was wrong</div>' + listLines(r.wrong) + '</div>' : '') +
        (r.keyTerms ? '<div class="ex-block"><div class="ex-block-title ex-blue">Key terms examiners look for</div>' + listLines(r.keyTerms) + '</div>' : '') +
        (r.modelAnswer ? '<details class="ex-block" open><summary class="ex-block-title ex-green">Model answer (exam format)</summary><div class="ex-model">' + esc(r.modelAnswer) + '</div></details>' : '') +
        (r.fix ? '<div class="ex-block"><div class="ex-block-title">What to fix before the next attempt</div>' + (Array.isArray(r.fix) ? listLines(r.fix) : '<p>' + esc(r.fix) + '</p>') + '</div>' : '') +
      '</div>';
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderWrittenHistory(root, history) {
    var host = root.querySelector('#ex-w-history');
    if (!host) return;
    if (!history.length) {
      host.innerHTML = '<p class="ex-hint">No written answers marked yet on this device.</p>';
      return;
    }
    host.innerHTML = history.map(function (h) {
      var pct = typeof h.score === 'number' ? Math.round(h.score * 10) : 0;
      var cls = pct >= 70 ? 'strong' : pct >= 40 ? 'avg' : 'weak';
      return '<div class="ex-hrow">' +
        '<span class="ex-badge ' + cls + '">' + (h.score != null ? h.score + '/10' : '—') + '</span>' +
        '<div class="ex-hrow-main"><b>' + esc(h.concept || String(h.question || '').slice(0, 60)) + '</b>' +
        '<small>' + (h.subject ? esc(h.subject) + ' · ' : '') + fmtDate(String(h.at || '').slice(0, 10)) +
        (h.revision && h.revision.dueOn ? ' · revise ' + fmtDate(h.revision.dueOn) : '') + '</small></div>' +
      '</div>';
    }).join('');
  }

  // ================================================================
  // 3. REVISION PLANNER DASHBOARD
  // ================================================================
  function renderRevision(root) {
    if (!root) return;
    root.innerHTML =
      '<div class="view" data-testid="view-revision">' +
        '<div class="card ex-card">' +
          '<h3><i class="fa-solid fa-rotate"></i> Revision Planner</h3>' +
          '<p class="ex-hint">Every written answer you get marked sets a chapter\'s strength and next revision date. Weak chapters come back in 1 day, average in 3, strong in 7–14, mastered in 21.</p>' +
          '<div class="ex-kpis" id="ex-r-kpis"></div>' +
        '</div>' +
        '<div class="card ex-card" id="ex-r-due-wrap"><h3>Due now</h3><div id="ex-r-due"></div></div>' +
        '<div class="card ex-card" id="ex-r-all-wrap"><h3>All tracked chapters</h3><div id="ex-r-all"></div></div>' +
      '</div>';

    var a = actor();
    if (!a) {
      root.querySelector('#ex-r-kpis').innerHTML = '<p class="ex-hint">Sign in to load your revision plan.</p>';
      return;
    }
    root.querySelector('#ex-r-kpis').innerHTML = '<p class="ex-hint">Loading your plan…</p>';

    actionCall('revision.plan', { studentId: a.studentId })
      .then(function (data) {
        var plan = unwrap(data) || {};
        var chapters = plan.chapters || [];
        var due = plan.due || [];
        var weak = chapters.filter(function (c) { return c.strength === 'weak'; }).length;
        var strong = chapters.filter(function (c) { return c.strength === 'strong'; }).length;
        var avg = chapters.length - weak - strong;

        root.querySelector('#ex-r-kpis').innerHTML =
          '<div class="ex-kpi"><b>' + due.length + '</b><span>Due today</span></div>' +
          '<div class="ex-kpi ex-red-bg"><b>' + weak + '</b><span>Weak</span></div>' +
          '<div class="ex-kpi ex-amber-bg"><b>' + avg + '</b><span>Average</span></div>' +
          '<div class="ex-kpi ex-green-bg"><b>' + strong + '</b><span>Strong</span></div>';

        var dueHost = root.querySelector('#ex-r-due');
        if (!due.length) {
          dueHost.innerHTML = '<p class="ex-hint">Nothing due right now. 🎉 Mark a written answer in the Written tab to grow your plan.</p>';
        } else {
          dueHost.innerHTML = due.map(chapterRow).join('');
        }

        var allHost = root.querySelector('#ex-r-all');
        if (!chapters.length) {
          allHost.innerHTML =
            '<p class="ex-hint">No chapters tracked yet. Your plan builds itself: go to <b>Written</b>, get an answer marked, and the next revision date appears here automatically.</p>';
        } else {
          allHost.innerHTML = chapters.map(chapterRow).join('');
        }
      })
      .catch(function (e) {
        root.querySelector('#ex-r-kpis').innerHTML = '<p class="ex-msg ex-err">' + esc(e.message) + '</p>';
        root.querySelector('#ex-r-due').innerHTML = '';
        root.querySelector('#ex-r-all').innerHTML = '';
      });
  }

  function chapterRow(c) {
    var today = istTodayKey();
    var overdue = c.dueOn && c.dueOn < today;
    var dueToday = c.dueOn === today;
    var when = overdue ? 'Overdue since ' + fmtDate(c.dueOn)
      : dueToday ? 'Due today' : 'Next: ' + fmtDate(c.dueOn);
    return '<div class="ex-hrow">' +
      '<span class="ex-badge ' + esc(c.strength || 'weak') + '">' + esc((c.strength || 'weak').toUpperCase()) + '</span>' +
      '<div class="ex-hrow-main"><b>' + esc(c.concept || 'Chapter') + '</b>' +
      '<small>' + (c.subject ? esc(c.subject) + ' · ' : '') +
      'accuracy ' + (c.accuracy != null ? c.accuracy + '%' : '—') + ' · ' + (c.attempts || 0) + ' attempt' + (c.attempts === 1 ? '' : 's') + ' · ' +
      '<b class="' + (overdue || dueToday ? 'ex-red' : '') + '">' + when + '</b></small></div></div>';
  }

  // ================================================================
  // 4. REMINDERS (Profile section)
  // ================================================================
  var reminderTimers = [];

  function renderReminders(host, student) {
    if (!host) return;
    var saved = loadJson(storeKey('reminders'), { times: [], whatsappDone: false });

    host.innerHTML =
      '<div class="card ex-card" id="ex-rem-card">' +
        '<h3><i class="fa-solid fa-bell"></i> Reminders</h3>' +
        '<p class="ex-hint">Get nudged to study — on WhatsApp and (while this site is open) via browser notifications.</p>' +
        '<div class="ex-field"><span class="ex-label">WhatsApp number (10 digits)</span>' +
          '<div class="ex-wa-row">' +
            '<input id="ex-wa-number" class="ex-input" inputmode="numeric" maxlength="10" placeholder="e.g. 98765 43210">' +
            '<button class="btn-primary ex-btn" id="ex-wa-save" type="button">Save</button>' +
          '</div>' +
          '<div class="ex-msg" id="ex-wa-msg"></div>' +
        '</div>' +
        '<div class="ex-field"><span class="ex-label">Quick check</span>' +
          '<button class="ex-btn-ghost" id="ex-wa-test" type="button">Send test reminder on WhatsApp</button>' +
        '</div>' +
        '<div class="ex-field"><span class="ex-label">Daily study reminders (browser)</span>' +
          '<div id="ex-rem-list"></div>' +
          '<div class="ex-wa-row">' +
            '<input id="ex-rem-time" class="ex-input" type="time">' +
            '<input id="ex-rem-text" class="ex-input" maxlength="80" placeholder="e.g. Morning Accounts slot">' +
            '<button class="ex-btn-ghost" id="ex-rem-add" type="button">Add</button>' +
          '</div>' +
          '<div class="ex-hint">Browser reminders fire while this site is open. For always-on reminders, keep WhatsApp enabled.</div>' +
        '</div>' +
      '</div>';

    var numEl = host.querySelector('#ex-wa-number');
    var msgEl = host.querySelector('#ex-wa-msg');

    host.querySelector('#ex-wa-save').addEventListener('click', function () {
      var a = actor();
      var num = String(numEl.value || '').replace(/\D/g, '');
      if (num.length === 12 && num.slice(0, 2) === '91') num = num.slice(2);
      if (!a) { fail('Sign in first.'); return; }
      if (!/^[6-9]\d{9}$/.test(num)) { fail('Enter a valid 10-digit Indian mobile number.'); return; }
      var btn = this;
      btn.disabled = true;
      mentorPost('/api/student-auth/whatsapp', { studentId: a.studentId, number: num })
        .then(function (r) {
          btn.disabled = false;
          var res = unwrap(r) || {};
          if (res.success) { ok('Saved. Reminders can now reach you on WhatsApp.'); }
          else fail(res.message || 'Could not save.');
        })
        .catch(function (e) { btn.disabled = false; fail(e.message); });
      function ok(t) { msgEl.textContent = t; msgEl.className = 'ex-msg ex-ok'; }
      function fail(t) { msgEl.textContent = t; msgEl.className = 'ex-msg ex-err'; }
    });

    host.querySelector('#ex-wa-test').addEventListener('click', function () {
      var a = actor();
      if (!a) { msgEl.textContent = 'Sign in first.'; msgEl.className = 'ex-msg ex-err'; return; }
      var btn = this;
      btn.disabled = true; btn.textContent = 'Sending…';
      mentorPost('/api/student-auth/reminder-notify', { studentId: a.studentId, text: 'Time to open your study plan. Log today\'s session and tick today\'s targets.' })
        .then(function (r) {
          btn.disabled = false; btn.textContent = 'Send test reminder on WhatsApp';
          var res = unwrap(r) || {};
          msgEl.textContent = res.success ? 'Test reminder sent to your WhatsApp.' : (res.message || 'Save a WhatsApp number first.');
          msgEl.className = 'ex-msg ' + (res.success ? 'ex-ok' : 'ex-err');
        })
        .catch(function (e) {
          btn.disabled = false; btn.textContent = 'Send test reminder on WhatsApp';
          msgEl.textContent = e.message; msgEl.className = 'ex-msg ex-err';
        });
    });

    function drawTimes() {
      var list = host.querySelector('#ex-rem-list');
      if (!saved.times.length) {
        list.innerHTML = '<p class="ex-hint">No browser reminders set.</p>';
      } else {
        list.innerHTML = saved.times.map(function (t, i) {
          return '<div class="ex-hrow"><span class="ex-badge avg">' + esc(t.time) + '</span>' +
            '<div class="ex-hrow-main"><b>' + esc(t.text || 'Study time') + '</b><small>Daily, while site is open</small></div>' +
            '<button class="ex-icon-btn" data-rem-del="' + i + '" title="Remove">✕</button></div>';
        }).join('');
      }
      list.querySelectorAll('[data-rem-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          saved.times.splice(Number(b.dataset.remDel), 1);
          saveJson(storeKey('reminders'), saved);
          drawTimes(); armTimers();
        });
      });
    }

    function armTimers() {
      reminderTimers.forEach(clearTimeout); reminderTimers = [];
      if (!saved.times.length) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      saved.times.forEach(function (t) {
        var parts = String(t.time || '').split(':');
        if (parts.length < 2) return;
        var next = new Date();
        next.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
        if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
        reminderTimers.push(setTimeout(function () {
          try { new Notification('UMP Study Reminder', { body: t.text || 'Time to study — open your plan.' }); } catch (_) {}
        }, next.getTime() - Date.now()));
      });
    }

    host.querySelector('#ex-rem-add').addEventListener('click', function () {
      var time = host.querySelector('#ex-rem-time').value;
      var text = host.querySelector('#ex-rem-text').value.trim();
      if (!time) return;
      saved.times.push({ time: time, text: text });
      saved.times.sort(function (x, y) { return x.time < y.time ? -1 : 1; });
      saveJson(storeKey('reminders'), saved);
      host.querySelector('#ex-rem-text').value = '';
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(function () { armTimers(); });
      drawTimes(); armTimers();
    });

    drawTimes();
    if ('Notification' in window && Notification.permission === 'default' && saved.times.length) {
      Notification.requestPermission().then(function () { armTimers(); });
    } else {
      armTimers();
    }
  }

  window.UMP_EXTRAS = {
    renderDailyChallenge: renderDailyChallenge,
    renderWritten: renderWritten,
    renderRevision: renderRevision,
    renderReminders: renderReminders
  };
})();
