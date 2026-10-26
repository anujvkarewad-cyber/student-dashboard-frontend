(async function () {
  'use strict';
  const $ = id => document.getElementById(id), api = window.UMP_PRACTICE, core = window.UMP_WORKBOOK_CORE;
  if (window.ReactNativeWebView?.postMessage) {
    $('dashboardBack').classList.add('hidden'); $('download').classList.add('hidden'); $('nativeDownloadNote').classList.remove('hidden');
  }
  let pdfDocument = null, pdfLoading = null, pdfGeneration = 0, pdfAbort = null;
  const backgrounds = new Map();
  let studentId, books = [], book, question, draft, page = 0, busy = false, stroke = null, saveTimer;
  let objectiveController = null, formatBlocked = false;
  const answerReady = () => !formatBlocked && (objectiveController ? objectiveController.isComplete() : $('answer').value.trim().length >= 8);
  const canvas = $('pad'), ctx = canvas.getContext('2d');
  const key = () => book.id + ':' + question.id;
  const error = e => { $('error').textContent = e?.message || String(e || ''); };
  const textNode = (tag, text, parent, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; parent.appendChild(node); return node; };
  function save() {
    clearTimeout(saveTimer); if (!draft || !studentId) return;
    try {
      if (objectiveController) $('answer').value = objectiveController.serialize();
      draft.answer = $('answer').value;
      core.saveDraft(localStorage, studentId, key(), draft); $('saved').textContent = 'Draft saved on this device.';
    } catch (e) { $('saved').textContent = 'Draft NOT saved: ' + e.message; }
  }
  function changed() { $('confirmed').checked = false; $('grade').disabled = true; $('feedback').classList.add('hidden'); clearTimeout(saveTimer); saveTimer = setTimeout(save, 350); }
  function draw() {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 1100);
    const paper = backgrounds.get((question.workbookPage || 1) + page);
    if (paper) ctx.drawImage(paper, 0, 0);
    ctx.strokeStyle = paper ? 'transparent' : '#e2e8f0'; ctx.lineWidth = 1;
    for (let y = 44; y < 1100; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(800, y); ctx.stroke(); }
    ctx.strokeStyle = '#182d4b'; ctx.lineWidth = 2.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const line of draft.pages[page]) {
      if (!line.length) continue; ctx.beginPath(); ctx.moveTo(...line[0]);
      if (line.length === 1) ctx.lineTo(line[0][0] + .1, line[0][1]);
      for (const point of line.slice(1)) ctx.lineTo(...point); ctx.stroke();
    }
  }
  function inkImage(lines) {
    const c = document.createElement('canvas'); c.width = 800; c.height = 1100; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 1100); x.strokeStyle = '#182d4b'; x.lineWidth = 2.7; x.lineCap = 'round'; x.lineJoin = 'round';
    for (const line of lines) { if (!line.length) continue; x.beginPath(); x.moveTo(...line[0]); for (const p of line.slice(1)) x.lineTo(...p); if (line.length === 1) x.lineTo(line[0][0] + .1, line[0][1]); x.stroke(); }
    return c.toDataURL('image/png');
  }
  async function loadPdf(generation, id, signal) {
    $('pdfState').textContent = 'Loading original workbook pages…';
    try {
      const pdfjs = await import('./practice-vendor/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/practice-vendor/pdf.worker.mjs';
      const data = await api.pdf(id, signal);
      if (signal.aborted) return;
      const loading = pdfjs.getDocument({ data, isEvalSupported: false, maxImageSize: 12000000, canvasMaxAreaInBytes: 16777216, cMapUrl: '/practice-vendor/cmaps/', cMapPacked: true, standardFontDataUrl: '/practice-vendor/standard_fonts/', wasmUrl: '/practice-vendor/wasm/', enableXfa: false });
      const doc = await loading.promise;
      if (generation !== pdfGeneration) { await doc.destroy(); return; }
      if (doc.numPages > 400) { await doc.destroy(); throw new Error('Split this workbook into chapter PDFs of up to 400 pages.'); }
      pdfDocument = doc; $('pdfState').textContent = doc.numPages + ' PDF pages ready';
    } catch (e) { if (generation === pdfGeneration) { error(e); $('pdfState').textContent = 'PDF unavailable; your answer and ink stay saved.'; } }
  }
  async function renderPaper() {
    const generation = pdfGeneration; await pdfLoading;
    if (!pdfDocument || !question || generation !== pdfGeneration) return;
    const number = (question.workbookPage || 1) + page;
    try {
      if (number > pdfDocument.numPages) { $('pdfState').textContent = 'Extra blank answer page'; draw(); return; }
      if (!backgrounds.has(number)) {
        const pdfPage = await pdfDocument.getPage(number); const original = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: Math.min(800 / original.width, 1100 / original.height) });
        const image = document.createElement('canvas'); image.width = 800; image.height = 1100;
        await pdfPage.render({ canvasContext: image.getContext('2d'), viewport, background: '#ffffff' }).promise;
        if (generation !== pdfGeneration) return;
        if (backgrounds.size >= 3) backgrounds.delete(backgrounds.keys().next().value);
        backgrounds.set(number, image); pdfPage.cleanup();
      }
      if (number === (question.workbookPage || 1) + page) { $('pdfState').textContent = 'Workbook PDF page ' + number; draw(); }
    } catch (e) { if (generation === pdfGeneration) error(e); }
  }
  function pageOptions() { $('page').replaceChildren(); draft.pages.forEach((_, i) => { const o = document.createElement('option'); o.value = i; o.textContent = 'Writing page ' + (i + 1); $('page').append(o); }); $('page').value = page; $('addPage').disabled = draft.pages.length >= 3 || busy; }
  function point(e) { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(800, (e.clientX - r.left) / r.width * 800)), Math.max(0, Math.min(1100, (e.clientY - r.top) / r.height * 1100))]; }
  canvas.onpointerdown = e => {
    if (busy || !draft || !$('drawMode').checked) return;
    if (draft.pages.flat(2).length >= core.MAX_POINTS || draft.pages[page].length >= 400) { error('Writing limit reached. Save/download your pages and continue with typed text.'); return; }
    canvas.setPointerCapture(e.pointerId); stroke = [point(e)]; draft.pages[page].push(stroke); draw(); changed();
  };
  canvas.onpointermove = e => { if (!stroke || stroke.length >= 500) return; const next = point(e), last = stroke[stroke.length - 1]; if (Math.hypot(next[0] - last[0], next[1] - last[1]) >= 2 && draft.pages.flat(2).length < core.MAX_POINTS) { stroke.push(next); draw(); } };
  const endStroke = () => { stroke = null; if (draft) save(); };
  canvas.onpointerup = endStroke; canvas.onpointercancel = endStroke;
  $('page').onchange = () => { page = Number($('page').value); draw(); void renderPaper(); };
  $('zoom').onchange = () => { canvas.style.width = $('zoom').value + '%'; };
  $('drawMode').onchange = () => { canvas.style.touchAction = $('drawMode').checked ? 'none' : 'pan-x pan-y'; };
  $('addPage').onclick = () => { if (draft.pages.length < 3) { draft.pages.push([]); page = draft.pages.length - 1; pageOptions(); draw(); void renderPaper(); changed(); } };
  $('undo').onclick = () => { draft.pages[page].pop(); draw(); changed(); };
  $('clearPad').onclick = () => { if (confirm('Clear only this handwriting page?')) { draft.pages[page] = []; draw(); changed(); } };
  $('download').onclick = () => { const a = document.createElement('a'); a.download = 'workbook-' + question.id + '-page-' + (page + 1) + '.png'; a.href = canvas.toDataURL('image/png'); a.click(); };
  $('answer').oninput = changed;
  $('confirmed').onchange = () => { $('grade').disabled = busy || !$('confirmed').checked || !answerReady(); };
  function selectQuestion(id) {
    if (draft) save(); question = book.questions.find(q => q.id === id); page = 0;
    draft = core.loadDraft(localStorage, studentId, key()); $('answer').value = draft.answer;
    objectiveController = null; formatBlocked = false; error('');
    const kind = question.format || 'written', objective = kind !== 'written';
    $('answer').classList.toggle('hidden', objective); $('writing').classList.toggle('hidden', objective);
    $('objectiveAnswer').classList.toggle('hidden', !objective); $('objectiveAnswer').replaceChildren();
    if (objective) {
      try {
        objectiveController = window.UMP_WORKBOOK_OBJECTIVE.render($('objectiveAnswer'), question, draft.answer, (value, problem) => {
          if (problem) { error(problem); $('saved').textContent = 'Draft NOT saved: ' + problem.message; $('confirmed').checked = false; $('grade').disabled = true; return; }
          $('answer').value = value; error(''); changed();
        });
      } catch (e) { formatBlocked = true; error(e); }
    }

    $('title').textContent = book.title; $('prompt').textContent = question.prompt; $('marks').textContent = `${question.maxMarks} practice marks · reference page ${question.page}`;
    $('feedback').classList.add('hidden'); $('confirmed').checked = false; $('grade').disabled = true; $('saved').textContent = draft.answer || draft.pages.some(p => p.length) ? 'Restored your saved draft.' : 'Not saved yet.';
    pageOptions(); draw(); void renderPaper();
  }
  function openBook(selected) {
    pdfGeneration++; pdfAbort?.abort(); pdfAbort = new AbortController(); backgrounds.clear(); pdfDocument?.destroy(); pdfDocument = null;
    book = selected; draft = null;
    pdfLoading = book.sourceUrl ? loadPdf(pdfGeneration, book.id, pdfAbort.signal) : null; $('books').classList.add('hidden'); $('workspace').classList.remove('hidden'); $('question').replaceChildren();
    book.questions.forEach((q, i) => { const o = document.createElement('option'); o.value = q.id; o.textContent = `Question ${i + 1} · ${q.maxMarks} marks`; $('question').append(o); });
    $('pdfBox').classList.toggle('hidden', !book.sourceUrl); $('pdf').src = 'about:blank'; $('pdfBox').open = false; selectQuestion(book.questions[0].id);
  }
  $('pdfBox').ontoggle = () => { $('pdf').src = $('pdfBox').open && book.sourceUrl ? core.pdfPreview(book.sourceUrl) : 'about:blank'; };
  $('question').onchange = () => selectQuestion($('question').value);
  $('back').onclick = () => { save(); $('workspace').classList.add('hidden'); $('books').classList.remove('hidden'); };
  function lock(value) {
    busy = value; objectiveController?.setDisabled(value); ['question','page','back','read','undo','clearPad','clearDraft','addPage'].forEach(id => { $(id).disabled = value; }); $('answer').disabled = value; $('confirmed').disabled = value;
    $('grade').disabled = value || !$('confirmed').checked || !answerReady();
    if (!value) pageOptions();
  }
  $('read').onclick = async () => {
    if ((question?.format || 'written') !== 'written') return;
    save(); lock(true); error(''); const originalPage = page;
    try {
      const parts = [];
      for (let i = 0; i < draft.pages.length; i++) {
        if (!draft.pages[i].length) continue;
        const image = inkImage(draft.pages[i]);
        if (image.length > 2800000) throw new Error('Writing image is too large. Use shorter pages.');
        $('status').textContent = `Reading writing page ${i + 1}…`;
        const result = await api.request('/handwriting/read', { image }); parts.push(result.text);
      }
      if (!parts.length) throw new Error('Write an answer on the pad first.');
      // Never replace an existing typed answer or submit an unreviewed OCR result.
      const combined = api.appendReviewed($('answer').value, parts.join('\n\n'));
      if (combined.length > 12000) throw new Error('Combined answer exceeds 12,000 characters. Split/edit your answer; no text has been truncated.');
      $('answer').value = combined;
      changed(); save(); $('status').textContent = 'Review the editable text. Correct [unclear] words before asking for marks.';
    } catch (e) { error(e); } finally { page = originalPage; draw(); lock(false); }
  };
  $('grade').onclick = async () => {
    if (!$('confirmed').checked || !answerReady()) return; save(); lock(true); error(''); $('status').textContent = objectiveController ? 'Checking your selections against the mentor-approved answer key…' : 'Checking intended meaning against the mentor-approved model answer…';
    try {
      const result = await api.request('/grade', { workbookId: book.id, questionId: question.id, answer: $('answer').value.trim(), confirmed: true });
      const box = $('feedback'); box.replaceChildren(); box.classList.remove('hidden');
      textNode('span', result.assessmentMode === 'deterministic-approved-key' ? 'Practice feedback · approved answer key' : 'Provisional AI practice feedback', box, 'badge');
      textNode('h2', 'What the checker understood', box); textNode('p', result.understoodMeaning, box);
      if (result.status === 'clarification') { textNode('h3', 'Clarification needed — no score yet', box); textNode('p', result.clarification, box); }
      else {
        textNode('p', `${result.score} / ${result.maxMarks}`, box, 'score');
        for (const p of result.points || []) { textNode('h3', `${p.awarded}/${p.maxMarks} · ${p.concept}`, box); textNode('p', p.reason, box); if (p.quote) textNode('blockquote', p.quote, box); }
        textNode('h3', 'How to improve', box); (result.improvement || []).forEach(s => textNode('p', '• ' + s, box));
        textNode('h3', 'Supplied model answer', box); textNode('p', result.modelAnswer, box, 'result'); textNode('small', `${result.referenceLabel} · page ${result.page}`, box);
      }
      textNode('p', 'If the AI misunderstood you, edit your answer or ask your mentor. This does not change leaderboard marks.', box, 'muted');
      $('status').textContent = 'Feedback ready. Your draft remains saved.';
    } catch (e) { error(e); $('status').textContent = 'No score was invented. Your draft remains available.'; } finally { lock(false); }
  };
  $('clearDraft').onclick = () => {
    if (!confirm('Delete this question’s local draft? Download/copy it first if needed.')) return;
    clearTimeout(saveTimer); core.removeDraft(localStorage, studentId, key()); draft = core.cleanDraft(null); objectiveController?.reset(); $('answer').value = ''; page = 0; pageOptions(); draw(); $('confirmed').checked = false; $('grade').disabled = true; $('feedback').classList.add('hidden'); $('saved').textContent = 'Draft deleted.';
  };
  window.addEventListener('pagehide', () => { if (draft && (draft.answer || draft.pages.some(p => p.length))) save(); });
  try {
    const session = await api.session(); studentId = session.studentId;
    const data = await api.request('/workbooks'); books = data.workbooks || [];
    $('status').textContent = books.length ? 'Choose a workbook assigned by your mentor.' : 'No reviewed workbook is assigned yet. No sample workbook or invented marks are shown.';
    for (const b of books) { const card = textNode('article', '', $('books'), 'card'); textNode('h2', b.title, card); textNode('p', `${b.subject} · ${b.questions.length} questions`, card); const button = textNode('button', 'Open workbook', card, 'primary'); button.onclick = () => openBook(b); }
  } catch (e) { error(e); $('status').textContent = 'Your existing study features are unchanged.'; }
})();
