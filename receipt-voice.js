/* Receipt-only audio. Optional student-private IndexedDB copy; no server archive or autosubmit. */
(function () {
  'use strict';
  let closeCurrent = null;
  function close() { closeCurrent?.(); }
  function open(field, libraryOnly = false) {
    close();
    if (!field?.isConnected) return;
    const vault = window.UMP_RECEIPT_AUDIO_VAULT;
    const owner = (() => { try { return JSON.parse(localStorage.getItem('ump_student') || '{}').studentId; } catch { return null; } })();
    const sameOwner = () => { try { return JSON.parse(localStorage.getItem('ump_student') || '{}').studentId === owner; } catch { return false; } };
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'max-width:560px;width:calc(100% - 28px);border:0;border-radius:18px;padding:24px;color:#14233b;background:#f5f7fc';
    dialog.innerHTML = `<h2>Speak your study receipt</h2><p>Up to 2 minutes / 2 MB. Record, replay, transcribe, then edit and confirm.</p><p>Transcribe sends this clip to Groq via our server. No server audio archive is kept. Groq has its own processing policy. Closing deletes the unsaved temporary clip; an explicitly saved private copy stays in this browser. Your existing typed answer is unchanged until you insert reviewed text.</p><button type="button" data-action="record">Start recording</button> <button type="button" data-action="stop" disabled>Stop</button><p data-status role="status"></p><audio controls hidden style="width:100%"></audio><button type="button" data-action="transcribe" disabled>Send temporary audio & transcribe</button><button type="button" data-action="keep" disabled>Save recording on this device</button><section data-library><h3>My private recordings</h3><p>Up to 10 clips / 20 MB. No app cloud sync or mentor access. Clearing site data can remove them.</p><div data-library-list></div></section><label style="display:block;margin-top:14px">Check numbers, negations and technical terms<textarea aria-label="Editable voice transcript" maxlength="12000" style="display:block;min-height:150px;width:100%;padding:12px;margin-top:8px"></textarea></label><p data-error role="alert" style="color:#b91c1c"></p><button type="button" data-action="insert" disabled>Insert reviewed text & delete recording</button> <button type="button" data-action="cancel">Cancel & delete</button>`;
    document.body.appendChild(dialog);
    const recordButton = dialog.querySelector('[data-action=record]'); const stopButton = dialog.querySelector('[data-action=stop]');
    const sendButton = dialog.querySelector('[data-action=transcribe]'); const insertButton = dialog.querySelector('[data-action=insert]');
    const text = dialog.querySelector('textarea'); const audio = dialog.querySelector('audio');
    const keepButton = dialog.querySelector('[data-action=keep]');
    const library = dialog.querySelector('[data-library-list]');
    let savedId = null, libraryBusy = false;
    const status = dialog.querySelector('[data-status]'); const error = dialog.querySelector('[data-error]');
    async function refreshLibrary() {
      if (!vault || !owner) { library.textContent = 'Sign in to save recordings privately on this device.'; return; }
      const rows = await vault.list(owner); if (disposed || !sameOwner()) return;
      library.replaceChildren();
      const usage = document.createElement('p'); usage.textContent = `${rows.length}/10 clips · ${(rows.reduce((n, item) => n + item.bytes, 0) / 1024 / 1024).toFixed(1)}/20 MB`; library.append(usage);
      for (const row of rows) {
        const line = document.createElement('div'), label = document.createElement('span'), open = document.createElement('button'), remove = document.createElement('button');
        label.textContent = new Date(row.createdAt).toLocaleString() + ' '; open.type = remove.type = 'button'; open.textContent = 'Open saved recording'; remove.textContent = 'Delete saved recording';
        open.onclick = async () => {
          if (libraryBusy || recorder?.state === 'recording' || !sameOwner()) return;
          try {
            const value = await vault.load(owner, row.id); if (disposed || !sameOwner() || !value) return;
            audio.pause(); if (objectUrl) URL.revokeObjectURL(objectUrl);
            blob = value; savedId = row.id; objectUrl = URL.createObjectURL(blob); audio.src = objectUrl; audio.hidden = false;
            text.value = ''; insertButton.disabled = true; sendButton.disabled = false; keepButton.disabled = true;
            insertButton.textContent = 'Insert reviewed text (saved copy stays)'; dialog.querySelector('[data-action=cancel]').textContent = 'Close (saved recordings stay)';
            status.textContent = 'Saved recording opened. Replay it or explicitly transcribe.';
          } catch (e) { if (!disposed) error.textContent = e.message; }
        };
        remove.onclick = async () => {
          if (libraryBusy || recorder?.state === 'recording' || !sameOwner() || !window.confirm('Delete this recording from this device? Receipt text will not change.')) return;
          libraryBusy = true;
          try {
            await vault.remove(owner, row.id);
            if (savedId === row.id) { audio.pause(); audio.removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; blob = null; savedId = null; text.value = ''; keepButton.disabled = sendButton.disabled = insertButton.disabled = true; }
            await refreshLibrary();
          } catch (e) { if (!disposed) error.textContent = e.message; }
          finally { libraryBusy = false; }
        };
        line.append(label, open, remove); library.append(line);
      }
    }
    let observer, background;
    let stream, recorder, objectUrl, blob, chunks = [], timer, clock, aborter, disposed = false, bytes = 0, started = 0, overflow = false;
    function release() { stream?.getTracks().forEach(t => t.stop()); clearTimeout(timer); clearInterval(clock); }
    function cleanup() {
      if (disposed) return; disposed = true; aborter?.abort(); observer?.disconnect();
      if (background) document.removeEventListener('visibilitychange', background);
      if (recorder?.state === 'recording') recorder.stop();
      release(); audio.pause(); audio.removeAttribute('src');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      blob = null; chunks = []; dialog.remove(); closeCurrent = null;
    }
    closeCurrent = cleanup;
    observer = new MutationObserver(() => { if (!field.isConnected) { observer.disconnect(); cleanup(); } });
    observer.observe(document.body, { childList: true, subtree: true });
    dialog.addEventListener('close', () => { observer.disconnect(); cleanup(); });
    dialog.addEventListener('cancel', e => { e.preventDefault(); observer.disconnect(); cleanup(); });
    background = () => { if (document.hidden) { observer.disconnect(); cleanup(); } };
    document.addEventListener('visibilitychange', background);
    recordButton.onclick = async () => {
      if (libraryBusy || !sameOwner()) return;
      savedId = null; libraryBusy = true; keepButton.disabled = true; insertButton.textContent = 'Insert reviewed text & delete recording';
      error.textContent = ''; insertButton.disabled = true; text.value = ''; sendButton.disabled = true; recordButton.disabled = true;
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Recording is unavailable here. Use HTTPS Chrome or type your answer.');
        audio.pause(); audio.removeAttribute('src');
        if (objectUrl) URL.revokeObjectURL(objectUrl); audio.hidden = true; blob = null; chunks = []; bytes = 0; overflow = false;
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
        if (disposed) { release(); return; }
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
        if (!mime) throw new Error('This browser has no supported recording format. Please type instead.');
        recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
        recorder.ondataavailable = e => { if (!disposed && e.data.size) { bytes += e.data.size; if (bytes > 2 * 1024 * 1024) { overflow = true; if (recorder.state === 'recording') recorder.stop(); } else chunks.push(e.data); } };
        recorder.onstop = () => {
          release(); if (disposed) return;
          stopButton.disabled = true; recordButton.disabled = false;
          if (overflow) { chunks = []; error.textContent = 'Recording exceeded 2 MB. Please record a shorter clip.'; return; }
          blob = new Blob(chunks, { type: recorder.mimeType }); chunks = [];
          objectUrl = URL.createObjectURL(blob); audio.src = objectUrl; audio.hidden = false; sendButton.disabled = !blob.size; keepButton.disabled = !blob.size || !owner || !vault;
          status.textContent = 'Replay your clip, then choose Transcribe. Nothing has been submitted.';
        };
        recorder.onerror = () => { release(); error.textContent = 'Recording failed. You can still type.'; recordButton.disabled = false; };
        recorder.start(250); libraryBusy = false; started = Date.now(); stopButton.disabled = false;
        timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 120000);
        clock = setInterval(() => { status.textContent = `Recording ${Math.floor((Date.now() - started) / 1000)}s / 120s`; }, 250);
      } catch (e) { libraryBusy = false; release(); if (!disposed) { error.textContent = e.message || 'Microphone permission was denied. Typing is still available.'; recordButton.disabled = false; } }
    };
    stopButton.onclick = () => { if (recorder?.state === 'recording') recorder.stop(); };
    sendButton.onclick = async () => {
      if (!blob || libraryBusy || !sameOwner()) return; libraryBusy = true; keepButton.disabled = true; sendButton.disabled = true; recordButton.disabled = true; error.textContent = ''; aborter = new AbortController(); status.textContent = 'Transcribing…';
      try {
        const result = await window.UMP_PRACTICE.request('/receipt/transcribe', blob, blob.type.split(';')[0], aborter.signal);
        if (disposed || !sameOwner()) return;
        text.value = result.text; insertButton.disabled = !text.value.trim(); status.textContent = 'Review and edit the transcript. Insert only when it matches what you meant.';
      } catch (e) { if (!disposed) error.textContent = e.message || 'Transcription failed; retry or type.'; }
      finally { libraryBusy = false; if (!disposed) { sendButton.disabled = false; recordButton.disabled = false; keepButton.disabled = !!savedId || !owner || !vault; } }
    };
    keepButton.onclick = async () => {
      if (!blob || savedId || libraryBusy || !sameOwner() || !vault) return;
      libraryBusy = true; keepButton.disabled = true; recordButton.disabled = true; sendButton.disabled = true;
      try {
        const item = await vault.save(owner, blob); if (disposed || !sameOwner()) return;
        savedId = item.id; insertButton.textContent = 'Insert reviewed text (saved copy stays)'; dialog.querySelector('[data-action=cancel]').textContent = 'Close (saved recordings stay)';
        status.textContent = 'Saved privately on this device. Closing does not delete the saved copy.'; await refreshLibrary();
      } catch (e) { if (!disposed) error.textContent = e.message; }
      finally { libraryBusy = false; if (!disposed) { recordButton.disabled = false; sendButton.disabled = false; keepButton.disabled = !!savedId; } }
    };
    text.oninput = () => { insertButton.disabled = !text.value.trim(); };
    insertButton.onclick = () => {
      if (libraryOnly || !field.isConnected || !text.value.trim() || !sameOwner()) return;
      field.value = window.UMP_PRACTICE.appendReviewed(field.value, text.value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      close();
    };
    dialog.querySelector('[data-action=cancel]').onclick = close;
    if (libraryOnly) insertButton.hidden = true;
    dialog.showModal();
    void refreshLibrary().catch(e => { if (!disposed) error.textContent = e.message; });
  }
  function attach(root) {
    root?.querySelectorAll('[data-receipt-library]').forEach(button => { button.onclick = () => open(button, true); });
    root?.querySelectorAll('[data-recall-id], #memory-response').forEach(field => {
      if (field.nextElementSibling?.dataset.receiptVoice === 'true') return;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.receiptVoice = 'true';
      button.textContent = '🎙 Speak instead of typing'; button.style.cssText = 'border:1px solid #b9c9ef;border-radius:10px;padding:10px;margin:8px 0;background:#edf2ff;color:#244998';
      button.onclick = () => open(field); field.after(button);
    });
  }
  window.addEventListener('pagehide', close);
  window.UMP_RECEIPT_VOICE = { attach, close };
})();
