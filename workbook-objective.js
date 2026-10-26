/* Objective workbook controls. No answer keys, scoring, provider calls or auto-submit. */
(function (root) {
  'use strict';
  function render(container, question, saved, changed) {
    const kind = question.format, spec = question.objective;
    if (!['mcq', 'blanks', 'matching'].includes(kind) || !spec || typeof spec !== 'object') throw new Error('Unsupported workbook format. Your saved draft is unchanged.');
    if (['correctOptionId', 'acceptedAnswers', 'matches'].some(k => Object.prototype.hasOwnProperty.call(spec, k))) throw new Error('Invalid student workbook descriptor.');
    const items = kind === 'mcq' ? spec.options : kind === 'blanks' ? spec.slots : spec.left;
    const validItems = list => Array.isArray(list) && list.length >= (kind === 'blanks' ? 1 : 2) && list.length <= 20 && list.every(v => v && /^[a-zA-Z0-9_-]{1,40}$/.test(v.id) && typeof v.text === 'string' && v.text.trim() && v.text.length <= 500 && Object.keys(v).every(k => ['id','text'].includes(k))) && new Set(list.map(v => v.id)).size === list.length;
    if (!validItems(items) || (kind === 'matching' && (!validItems(spec.right) || spec.right.length !== items.length))) throw new Error('Invalid objective items. Your saved draft is unchanged.');
    let previous = {};
    if (saved && saved.trim()) {
      try { previous = JSON.parse(saved); } catch (_) { throw new Error('The saved answer uses a different format. Copy it before changing formats.'); }
      if (!previous || typeof previous !== 'object' || Array.isArray(previous) || Object.keys(previous).some(k => k !== (kind === 'mcq' ? 'choice' : 'responses'))) throw new Error('Saved answer format does not match this question.');
      if (kind !== 'mcq' && (typeof previous.responses !== 'object' || previous.responses === null || Array.isArray(previous.responses) || Object.keys(previous.responses).some(k => !items.some(item => item.id === k)))) throw new Error('Saved response items do not match this question.');
    }
    if (kind === 'mcq' && previous.choice !== undefined && (typeof previous.choice !== 'string' || (previous.choice && !items.some(o => o.id === previous.choice)))) throw new Error('Saved option no longer exists; your original draft is preserved.');
    const doc = container.ownerDocument, controls = [];
    const fieldset = doc.createElement('fieldset');
    const legend = doc.createElement('legend'); legend.textContent = kind === 'mcq' ? 'Choose one option' : kind === 'blanks' ? 'Complete each blank' : 'Match each item once'; fieldset.append(legend);
    function notify() { try { changed(serialize()); } catch (e) { changed(null, e); } }
    for (const item of items) {
      const label = doc.createElement('label'); label.style.display = 'block'; label.style.margin = '12px 0';
      if (kind === 'mcq') {
        const input = doc.createElement('input'); input.type = 'radio'; input.name = 'workbook-objective-choice'; input.value = item.id;
        if (previous.choice && !items.some(o => o.id === previous.choice)) throw new Error('Saved option no longer exists; your original draft is preserved.');
        input.checked = previous.choice === item.id; input.addEventListener('change', notify); label.append(input, doc.createTextNode(' ' + item.text)); controls.push(input);
      } else {
        const input = doc.createElement(kind === 'blanks' ? 'input' : 'select'); input.dataset.item = item.id;
        if (kind === 'blanks') { input.type = 'text'; input.maxLength = 500; input.autocomplete = 'off'; input.style.width = '100%'; }
        else { const empty = doc.createElement('option'); empty.value = ''; empty.textContent = 'Choose a match…'; input.append(empty); for (const option of spec.right) { const opt = doc.createElement('option'); opt.value = option.id; opt.textContent = option.text; input.append(opt); } }
        const value = previous.responses?.[item.id] ?? '';
        if (typeof value !== 'string' || value.length > 500 || (kind === 'matching' && value && !spec.right.some(o => o.id === value))) throw new Error('Invalid saved response; your original draft is preserved.');
        input.value = value; input.addEventListener(kind === 'blanks' ? 'input' : 'change', notify);
        label.append(doc.createTextNode(item.text + ' '), input); controls.push(input);
      }
      fieldset.append(label);
    }
    function serialize() {
      const value = kind === 'mcq' ? { choice: controls.find(c => c.checked)?.value || '' } : { responses: Object.fromEntries(controls.map(c => [c.dataset.item, c.value])) };
      const text = JSON.stringify(value);
      if (text.length > 12000) throw new Error('This answer exceeds draft limits. Shorten a response; no text was truncated.');
      return text;
    }
    function isComplete() {
      try { serialize(); } catch (_) { return false; }
      if (kind === 'mcq') return controls.some(c => c.checked);
      return controls.every(c => c.value.trim() && !c.value.toLowerCase().includes('[unclear]')) && (kind !== 'matching' || new Set(controls.map(c => c.value)).size === controls.length);
    }
    container.replaceChildren(fieldset);
    return { serialize, isComplete, setDisabled(value) { fieldset.disabled = value; }, reset() { controls.forEach(c => { if (kind === 'mcq') c.checked = false; else c.value = ''; }); } };
  }
  root.UMP_WORKBOOK_OBJECTIVE = { render };
})(typeof window !== 'undefined' ? window : globalThis);
