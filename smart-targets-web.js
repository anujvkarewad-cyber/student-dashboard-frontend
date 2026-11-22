/* Smart targets on the web dashboard — day strip, checklist, sequential unlock.
 *
 * This file is the missing half of the "Today's targets" card that index.html
 * has been rendering since the 3-Nov sync (492a417). That commit added the
 * card's markup and a <script src="smart-targets-web.js"> tag, but the file
 * itself was never committed, so the card sat on "Loading targets..." for every
 * student on the web app ever since.
 *
 * Data comes from GET /api/ai/target-plan-days — the same endpoint the Android
 * app's Daily Target screen uses, so web and app can never disagree about the
 * plan. That endpoint already returns, per published day: the plan id/name, the
 * day number, the date, whether it is today, and its tasks with a `done` flag.
 *
 * Unlock rule (matches the app's DailyTargetScreen):
 *   - today and every past day     -> open, read-only for the past
 *   - a future day                 -> locked until every task of the day before
 *                                     it is complete
 * Ticking always happens on today's card; it posts /api/targets/complete.
 *
 * Transport: same-origin /api/mentor/* through the Cloud Run server (server.js
 * reverse-proxies to FastAPI). Session = localStorage 'ump_student'.
 */
(function () {
  'use strict';

  var MOUNTED = false;
  var STATE = null;          // last /api/ai/target-plan-days payload
  var SELECTED = '';         // date of the day the student is looking at
  var BUSY = false;

  // ---------------- shared helpers ----------------
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** The signed-in student, from the same store app.js uses. */
  function actor() {
    try {
      var raw = JSON.parse(localStorage.getItem('ump_student') || 'null') || {};
      var sid = String(raw.studentId || '').trim().toUpperCase();
      var pwd = String(raw.password || '');
      if (!sid || !pwd) return null;
      return { studentId: sid, password: pwd };
    } catch (e) {
      return null;
    }
  }

  /** Server truth: never show a tick the server has not confirmed. */
  function api(path, opts) {
    var who = actor();
    if (!who) return Promise.reject(new Error('Please sign in again.'));
    var options = opts || {};
    return fetch('/api/mentor' + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Student-Id': who.studentId,
        'X-Session-Password': who.password
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var detail = (data && (data.detail || data.message)) || '';
          throw new Error(typeof detail === 'string' && detail ? detail : 'HTTP ' + res.status);
        }
        return data;
      });
    });
  }

  /**
   * Local calendar day, in IST — the server works in Asia/Kolkata, so the web
   * app must not compare against a UTC date or the "today" card flips at the
   * wrong time (the Android app had exactly that bug).
   */
  function istDay(offset) {
    var shifted = new Date(Date.now() + 19800000 - (offset || 0) * 86400000);
    return shifted.toISOString().slice(0, 10);
  }

  function shortDate(iso) {
    var parts = String(iso || '').slice(0, 10).split('-');
    if (parts.length !== 3) return esc(iso || '');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var month = months[Number(parts[1]) - 1] || parts[1];
    return Number(parts[2]) + ' ' + month;
  }

  function longDate(iso) {
    var parts = String(iso || '').slice(0, 10).split('-');
    if (parts.length !== 3) return esc(iso || '');
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return days[d.getDay()] + ', ' + Number(parts[2]) + ' ' + (months[Number(parts[1]) - 1] || '');
  }

  // ---------------- day state ----------------
  function dayDone(day) {
    var tasks = (day && day.tasks) || [];
    return tasks.length > 0 && tasks.every(function (t) { return t.done; });
  }

  /** Where the card opens: today if the plan has one, else the first open day. */
  function landingIndex(days) {
    for (var t = 0; t < days.length; t += 1) {
      if (days[t].isToday) return t;
    }
    var today = istDay();
    for (var i = 0; i < days.length; i += 1) {
      if (!dayDone(days[i]) && days[i].date <= today) return i;
    }
    for (var j = 0; j < days.length; j += 1) {
      if (days[j].date >= today) return j;
    }
    return days.length - 1;
  }

  /**
   * A day is locked when it is in the future AND the day before it is not
   * complete. Today + every past day stay open; the app behaves the same way.
   */
  function isLocked(index) {
    var days = (STATE && STATE.days) || [];
    var day = days[index];
    if (!day) return true;
    if (day.isToday || day.date <= istDay()) return false;
    var prev = days[index - 1];
    if (!prev) return false;
    return !dayDone(prev);
  }

  // ---------------- rendering ----------------
  function renderStrip() {
    var root = document.getElementById('st-days');
    var days = (STATE && STATE.days) || [];
    if (!root) return;
    if (!days.length) { root.innerHTML = ''; return; }

    var todayIndex = -1;
    for (var t = 0; t < days.length; t += 1) { if (days[t].isToday) { todayIndex = t; break; } }

    root.innerHTML = days.map(function (day, i) {
      var locked = isLocked(i);
      var done = dayDone(day);
      var isToday = !!day.isToday;
      var viewing = day.date === SELECTED;
      var classes = ['st-chip'];
      if (done) classes.push('st-done');
      else if (isToday) classes.push('st-current');
      if (locked) classes.push('st-future');
      if (viewing) classes.push('st-viewing');
      var label = day.day != null ? 'Day ' + day.day : '—';
      // Chip reads: day number on top-left of the caption, date underneath.
      // The status word only appears when it adds something the colour does not.
      var caption = isToday ? 'TODAY' : esc(shortDate(day.date));
      return '<button type="button" class="' + classes.join(' ') + '"' +
        ' data-st-date="' + esc(day.date) + '"' +
        (locked ? ' disabled aria-disabled="true"' : '') +
        ' title="' + (locked ? 'Finish the day before to unlock ' + esc(label) : esc(label)) + '">' +
        '<span class="st-chip-top">' + caption + '</span>' +
        '<span class="st-chip-num">' + esc(day.day != null ? String(day.day) : '—') + '</span>' +
        '<span class="st-chip-sub">' + (done ? 'done' : locked ? 'locked' : '&nbsp;') + '</span>' +
        '</button>';
    }).join('');

    // Today's chip should be the one the student sees first without scrolling.
    var todayChip = root.querySelector('.st-current') || root.querySelector('.st-chip');
    if (todayChip && typeof todayChip.scrollIntoView === 'function') {
      try { todayChip.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* older browsers */ }
    }

    root.querySelectorAll('[data-st-date]').forEach(function (node) {
      node.addEventListener('click', function () {
        var date = node.getAttribute('data-st-date');
        if (!date) return;
        SELECTED = date;
        renderStrip();
        renderBody();
      });
    });
  }

  function renderBody() {
    var root = document.getElementById('st-body');
    var sub = document.getElementById('st-sub');
    var days = (STATE && STATE.days) || [];
    if (!root) return;

    if (!days.length) {
      if (sub) sub.textContent = 'Day-wise plan from your mentor';
      root.className = 'muted';
      root.innerHTML = 'No target has been published for your batch yet. ' +
        'Your mentor publishes the day-wise plan — it will appear here on its own.';
      return;
    }

    var index = -1;
    for (var i = 0; i < days.length; i += 1) { if (days[i].date === SELECTED) { index = i; break; } }
    if (index < 0) {
      index = landingIndex(days);
      SELECTED = days[index].date;
    }
    var day = days[index];
    var today = istDay();

    if (sub) {
      var doneCount = days.filter(dayDone).length;
      sub.textContent = doneCount + ' of ' + days.length + ' days complete';
    }

    if (isLocked(index)) {
      var prev = days[index - 1];
      root.className = '';
      root.innerHTML =
        '<div class="st-daytitle">' +
          (day.day != null ? 'Day ' + esc(day.day) : 'This day') + ' — locked</div>' +
        '<div class="st-ro">This day opens only after ' +
          esc(prev && prev.day != null ? 'Day ' + prev.day : 'the previous day') +
          ' is fully complete. The plan moves forward one day at a time.</div>';
      return;
    }

    var isPast = day.date < today;
    var isToday = !!day.isToday;

    // Today's checklist is the only one that ticks; other days stay read-only.
    var rows = (day.tasks || []).map(function (task) {
      var label = task.label || 'Study task';
      var detail = task.detail || '';
      if (isToday) {
        return '<button type="button" class="st-row' + (task.done ? ' st-row-done' : '') + '"' +
          ' data-st-task="' + esc(task.id || '') + '"' +
          ' aria-pressed="' + (task.done ? 'true' : 'false') + '"' +
          (BUSY ? ' disabled' : '') + '>' +
          '<span class="st-cb">' + (task.done ? '&#10003;' : '') + '</span>' +
          '<span class="st-tasktext"><b>' + esc(label) + '</b>' +
            (detail ? '<span class="muted" style="display:block">' + esc(detail) + '</span>' : '') +
          '</span></button>';
      }
      return '<div class="st-row st-row-ro">' +
        '<span class="st-cb"' + (task.done ? ' style="background:#3157d5"' : ' style="border-color:#cfd8e6"') + '>' +
          (task.done ? '&#10003;' : '') + '</span>' +
        '<span class="st-tasktext"><b' + (isPast && task.done ? ' style="text-decoration:line-through;color:#718198"' : '') + '>' +
          esc(label) + '</b>' +
          (detail ? '<span class="muted" style="display:block">' + esc(detail) + '</span>' : '') +
        '</span></div>';
    }).join('');

    var doneTasks = (day.tasks || []).filter(function (t) { return t.done; }).length;
    var totalTasks = (day.tasks || []).length;

    root.className = '';
    root.innerHTML =
      '<div class="st-daytitle">' +
        (day.day != null ? 'Day ' + esc(day.day) : 'This day') + ' · ' + esc(longDate(day.date)) +
        (isToday ? ' · today' : isPast ? ' · <span class="st-ro">view only</span>' : ' · unlocked') +
      '</div>' +
      (rows || '<div class="muted">No tasks on this day.</div>') +
      '<div class="st-ro" style="margin-top:8px">' + doneTasks + '/' + totalTasks + ' complete</div>' +
      (isToday
        ? '<div class="st-ro" style="margin-top:4px">Tick a task once it is finished — the next day unlocks when every task here is done.</div>'
        : isPast
          ? '<div class="st-ro" style="margin-top:4px">This day has passed — view only.</div>'
          : '<div class="st-ro" style="margin-top:4px">Ticking always happens on today\'s card.</div>');

    if (isToday) {
      root.querySelectorAll('[data-st-task]').forEach(function (node) {
        node.addEventListener('click', function () {
          var taskId = node.getAttribute('data-st-task');
          if (taskId) tick(taskId);
        });
      });
    }
  }

  // ---------------- actions ----------------
  function paint() { renderStrip(); renderBody(); }

  function tick(taskId) {
    var who = actor();
    if (!who || BUSY) return;
    BUSY = true;
    paint();
    api('/api/targets/complete', {
      method: 'POST',
      body: { studentId: who.studentId, taskId: taskId }
    }).then(function () {
      return load();
    }).catch(function (err) {
      BUSY = false;
      paint();
      var root = document.getElementById('st-body');
      if (root) {
        var note = document.createElement('div');
        note.className = 'st-ro';
        note.style.color = '#b42318';
        note.style.marginTop = '8px';
        note.textContent = 'Could not save that tick: ' + (err && err.message ? err.message : 'please retry') +
          '. Nothing was changed.';
        root.appendChild(note);
      }
    });
  }

  function load() {
    var who = actor();
    if (!who) return Promise.resolve();
    return api('/api/ai/target-plan-days?studentId=' + encodeURIComponent(who.studentId))
      .then(function (data) {
        STATE = data && Array.isArray(data.days) ? data : { days: [] };
        BUSY = false;
        if (!SELECTED && STATE.days.length) {
          SELECTED = STATE.days[landingIndex(STATE.days)].date;
        }
        paint();
        return STATE;
      })
      .catch(function (err) {
        BUSY = false;
        var root = document.getElementById('st-body');
        var sub = document.getElementById('st-sub');
        if (sub) sub.textContent = 'Day-wise plan from your mentor';
        if (root) {
          root.className = 'muted';
          root.textContent = 'Targets could not be loaded: ' +
            (err && err.message ? err.message : 'please refresh') + '. Please try again in a moment.';
        }
        return null;
      });
  }

  // ---------------- public surface ----------------
  function mount() {
    if (!document.getElementById('st-body')) return;
    MOUNTED = true;
    load();
  }

  window.UMP_SMART_TARGETS = { mount: mount, reload: load };

  // renderTutor() calls mount() on every navigation to the tutor view; a first
  // mount is also attempted here so the card fills even before that runs.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { if (!MOUNTED) mount(); });
  } else {
    setTimeout(function () { if (!MOUNTED) mount(); }, 0);
  }
})();
