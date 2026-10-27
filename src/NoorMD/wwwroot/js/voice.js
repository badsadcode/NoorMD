// NoorMD voice notes: a small recorder in a dock panel. Record (with a level meter and pause), listen to the take,
// then save it next to your notes (Opus in WebM — small — or WAV, which every player opens) and, if you like, put a
// link to it into the document. NoorMD asks Windows for the microphone only when you press Record.
window.NoorVoice = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const FORMAT_KEY = 'noormd.voice.format', INSERT_KEY = 'noormd.voice.insert', DEVICE_KEY = 'noormd.voice.device';
  const CHUNK = 512 * 1024;

  let hooks = { showError: (e) => console.error(e), insertMarkdown: () => false, hasDocument: () => false };
  let built = false;
  let status = { folder: '', recordings: [] };
  let rec = null;      // { stream, recorder, chunks, ctx, analyser, started, pausedFor, pausedAt, raf }
  let take = null;     // { blob, url, seconds }
  let playing = null;  // Audio for the list
  const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* per-viewer convenience */ } };

  const isOpen = () => document.body.classList.contains('voice-open');
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const elapsed = () => (rec ? ((rec.pausedAt || performance.now()) - rec.started - rec.pausedFor) / 1000 : 0);

  function init(h) { hooks = { ...hooks, ...h }; }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('voice');
    document.body.classList.add('voice-open');
    $('#voicedesk').hidden = false;
    await refresh();
  }

  function close() {
    if (!built || !isOpen()) return;
    document.body.classList.remove('voice-open');
    $('#voicedesk').hidden = true;
    if (playing) { playing.pause(); playing = null; }
    if (window.NoorDock) NoorDock.closed('voice');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  async function refresh() {
    try { status = await req('voice.status'); } catch (err) { hooks.showError(err); return; }
    renderList();
  }

  function build() {
    built = true;
    const fmtSel = el('select', { id: 'voice-format', 'aria-label': 'Format' },
      el('option', { value: 'webm', text: 'Opus (small)' }), el('option', { value: 'wav', text: 'WAV (plays everywhere)' }));
    fmtSel.value = pref(FORMAT_KEY, 'webm');
    fmtSel.addEventListener('change', () => setPref(FORMAT_KEY, fmtSel.value));
    const insert = el('input', { type: 'checkbox', id: 'voice-insert' });
    insert.checked = pref(INSERT_KEY, '1') === '1';
    insert.addEventListener('change', () => setPref(INSERT_KEY, insert.checked ? '1' : '0'));
    const root = el('section', { id: 'voicedesk', class: 'voicedesk', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'Voice notes' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🎙' }), el('strong', { text: 'Voice notes' }), el('small', { id: 'voice-count' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'voice-dock', title: 'Where this panel goes (left, right, bottom) and layouts', 'aria-label': 'Move the voice notes panel', onclick: (e) => NoorDock.showMenu('voice', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close voice notes', onclick: close }, '✕'))),
      el('section', { class: 'nowplaying voice-card', 'aria-label': 'Recorder' },
        el('div', { class: 'voice-row' },
          el('button', { class: 'tp play voice-rec', id: 'voice-rec', title: 'Record (Ctrl+Alt+D)', 'aria-label': 'Record', onclick: () => (rec ? stop() : start()) }, '●'),
          el('button', { class: 'tp', id: 'voice-pause', title: 'Pause / continue', 'aria-label': 'Pause', disabled: true, onclick: pause }, '❚❚'),
          el('div', { class: 'voice-meter', 'aria-hidden': 'true' }, el('span', { id: 'voice-level' })),
          el('span', { class: 'voice-time', id: 'voice-time', text: '0:00' })),
        el('div', { class: 'voice-status', id: 'voice-status', 'aria-live': 'polite', text: 'Press ● to record. The microphone is used only while recording.' }),
        el('div', { class: 'voice-take', id: 'voice-take', hidden: true })),
      el('div', { class: 'voice-options' },
        el('label', { class: 'inline' }, el('span', { text: 'Format' }), fmtSel),
        el('label', { class: 'inline' }, insert, 'Put a link into the document')),
      el('div', { class: 'music-viewbar voice-folder', id: 'voice-folder' }),
      el('div', { class: 'voice-list', id: 'voice-list', role: 'list', 'aria-label': 'Recordings' }));
    ($('#app') || document.body).append(root);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.target.closest('input, select')) { e.preventDefault(); e.stopPropagation(); close(); } });
  }

  function setStatus(text) { const s = $('#voice-status'); if (s) s.textContent = text; }

  // ------------------------------------------------------------------ recording

  async function start() {
    if (rec) return;
    if (!isOpen()) await open();
    if (take) discardTake();
    try {
      await req('voice.arm'); // the host allows the microphone for this one request
      const device = pref(DEVICE_KEY, '');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: device ? { deviceId: { ideal: device } } : true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 96000 });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      rec = { stream, recorder, chunks: [], ctx, analyser, started: performance.now(), pausedFor: 0, pausedAt: 0, raf: 0 };
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      recorder.onstop = finished;
      recorder.start(1000);
      document.body.classList.add('voice-recording');
      $('#voice-rec').textContent = '■'; $('#voice-rec').setAttribute('aria-label', 'Stop'); $('#voice-rec').title = 'Stop (Ctrl+Alt+D)';
      $('#voice-pause').disabled = false;
      setStatus('Recording…');
      meter();
      if (window.NoorMusic && NoorMusic.pauseForVideo) NoorMusic.pauseForVideo(); // your music would be in the recording
    } catch (err) {
      cleanup();
      hooks.showError(new Error(err && err.name === 'NotAllowedError' ? 'The microphone is not available. Check Windows Settings › Privacy › Microphone (desktop apps).' : (err && err.message) || String(err)));
    }
  }

  function meter() {
    if (!rec) return;
    const data = new Float32Array(rec.analyser.fftSize);
    rec.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    const lvl = $('#voice-level');
    if (lvl) { lvl.style.width = `${Math.min(100, Math.round(Math.sqrt(peak) * 100))}%`; lvl.classList.toggle('hot', peak > 0.9); }
    $('#voice-time').textContent = fmt(elapsed());
    rec.raf = requestAnimationFrame(meter);
  }

  function pause() {
    if (!rec) return;
    if (rec.recorder.state === 'recording') { rec.recorder.pause(); rec.pausedAt = performance.now(); setStatus('Paused'); $('#voice-pause').textContent = '▶'; }
    else if (rec.recorder.state === 'paused') { rec.pausedFor += performance.now() - rec.pausedAt; rec.pausedAt = 0; rec.recorder.resume(); setStatus('Recording…'); $('#voice-pause').textContent = '❚❚'; }
  }

  function stop() {
    if (!rec) return;
    rec.seconds = elapsed();
    if (rec.recorder.state !== 'inactive') rec.recorder.stop(); else finished();
  }

  function cleanup() {
    if (rec) {
      cancelAnimationFrame(rec.raf);
      rec.stream.getTracks().forEach((t) => t.stop()); // the microphone is released at once
      rec.ctx.close().catch(() => {});
    }
    rec = null;
    document.body.classList.remove('voice-recording');
    const b = $('#voice-rec');
    if (b) { b.textContent = '●'; b.setAttribute('aria-label', 'Record'); b.title = 'Record (Ctrl+Alt+D)'; }
    const p = $('#voice-pause');
    if (p) { p.disabled = true; p.textContent = '❚❚'; }
    const l = $('#voice-level');
    if (l) l.style.width = '0%';
  }

  function finished() {
    if (!rec) return;
    const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || 'audio/webm' });
    const seconds = rec.seconds ?? elapsed();
    cleanup();
    if (!blob.size) { setStatus('Nothing was recorded.'); return; }
    take = { blob, url: URL.createObjectURL(blob), seconds };
    showTake();
  }

  function showTake() {
    const box = $('#voice-take');
    const name = el('input', { type: 'text', id: 'voice-name', placeholder: 'Name (optional)', 'aria-label': 'Name of the recording' });
    const canInsert = hooks.hasDocument();
    box.hidden = false;
    box.replaceChildren(
      el('audio', { controls: true, src: take.url, id: 'voice-take-audio' }),
      name,
      el('div', { class: 'modal-buttons' },
        el('button', { class: 'action', id: 'voice-discard', onclick: () => { discardTake(); setStatus('Discarded.'); } }, 'Discard'),
        el('button', { class: 'action primary', id: 'voice-save', onclick: () => save(name.value) }, $('#voice-insert').checked && canInsert ? 'Save and link' : 'Save')));
    setStatus(`Take: ${fmt(take.seconds)}. Listen, then save or discard.`);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(name.value); } });
  }

  function discardTake() {
    if (take) URL.revokeObjectURL(take.url);
    take = null;
    const box = $('#voice-take');
    if (box) { box.hidden = true; box.replaceChildren(); }
  }

  /** WAV (16-bit PCM) from the recording, for players that don't open Opus. */
  async function toWav(blob) {
    const ctx = new OfflineAudioContext(1, 1, 48000);
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = Math.min(2, audio.numberOfChannels), rate = audio.sampleRate, n = audio.length;
    const buf = new ArrayBuffer(44 + n * ch * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const chans = [...Array(ch).keys()].map((c) => audio.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Blob([buf], { type: 'audio/wav' });
  }

  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  async function save(name) {
    if (!take) return;
    const wav = $('#voice-format').value === 'wav';
    const btn = $('#voice-save');
    if (btn) btn.disabled = true;
    let token = null;
    try {
      setStatus('Saving…');
      const blob = wav ? await toWav(take.blob) : take.blob;
      token = (await req('voice.begin', { name, ext: wav ? '.wav' : '.webm' })).token;
      for (let i = 0; i < blob.size; i += CHUNK) await req('voice.chunk', { token, data: await toBase64(blob.slice(i, i + CHUNK)) });
      const r = await req('voice.finish', { token, seconds: take.seconds });
      token = null;
      status = r.status;
      const linked = $('#voice-insert').checked && hooks.hasDocument() && hooks.insertMarkdown(' ' + r.link + ' ');
      discardTake();
      renderList();
      setStatus(`Saved “${r.name}”${linked ? ' and linked in the document' : ''}.`);
      notice(`🎙 Saved “${r.name}”`, 2000);
    } catch (err) {
      if (token) req('voice.cancel', { token }).catch(() => {});
      if (btn) btn.disabled = false;
      setStatus('Not saved.');
      hooks.showError(err);
    }
  }

  // ------------------------------------------------------------------ recordings

  function renderList() {
    if (!built) return;
    const list = status.recordings || [];
    $('#voice-count').textContent = list.length ? String(list.length) : '';
    $('#voice-folder').replaceChildren(el('span', { text: '📁 ' + status.folder, title: status.inVault ? 'In the Vault’s attachments folder' : 'No Vault open: Documents' }));
    $('#voice-list').replaceChildren(...(list.length ? list.map((r) => el('div', { class: 'qitem voice-item', role: 'listitem', 'data-file': r.file },
      el('button', { class: 'icon-btn', title: 'Play', 'aria-label': 'Play ' + r.name, onclick: (e) => play(r, e.currentTarget) }, '▶'),
      el('span', { class: 'qtitle', text: r.name, title: r.file }),
      el('small', { text: r.size >= 1024 * 1024 ? `${(r.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(r.size / 1024))} KB` }),
      el('span', { class: 'qactions' },
        el('button', { class: 'icon-btn', title: 'Put a link into the document', 'aria-label': 'Link in document', disabled: !hooks.hasDocument() || undefined, onclick: async () => { try { const x = await req('voice.link', { file: r.file }); hooks.insertMarkdown(' ' + x.link + ' '); notice('Linked', 1200); } catch (err) { hooks.showError(err); } } }, '⇩'),
        el('button', { class: 'icon-btn', title: 'Show in Explorer', 'aria-label': 'Show in Explorer', onclick: () => req('voice.reveal', { file: r.file }).catch(hooks.showError) }, '📁'),
        el('button', { class: 'icon-btn', title: 'Delete (to the Recycle Bin)', 'aria-label': 'Delete ' + r.name, onclick: async () => {
          if (!await NoorUI.confirm('Delete this recording?', `“${r.name}” goes to the Windows Recycle Bin. Links to it in your notes stop working.`, 'Delete')) return;
          try { status = await req('voice.delete', { file: r.file }); renderList(); } catch (err) { hooks.showError(err); }
        } }, '✕'))))
      : [el('p', { class: 'music-none', text: 'No recordings yet.' })]));
  }

  function play(r, button) {
    if (playing && playing.dataset.file === r.file) { playing.paused ? playing.play() : playing.pause(); return; }
    if (playing) playing.pause();
    playing = new Audio(r.url);
    playing.dataset.file = r.file;
    playing.play().catch((err) => hooks.showError(err));
    document.querySelectorAll('.voice-item .icon-btn[aria-label^="Play"]').forEach((b) => { b.textContent = '▶'; });
    button.textContent = '❚❚';
    playing.addEventListener('ended', () => { button.textContent = '▶'; });
    playing.addEventListener('pause', () => { button.textContent = '▶'; });
    playing.addEventListener('play', () => { button.textContent = '❚❚'; });
  }

  /** Ctrl+Alt+D: start recording (opening the panel), or stop. */
  function quickRecord() { if (rec) stop(); else start(); }

  return {
    init, open, close, toggle, isOpen, quickRecord, refresh,
    _state: () => ({ open: isOpen(), recording: !!rec, paused: !!(rec && rec.pausedAt), take: take && { seconds: take.seconds, size: take.blob.size, type: take.blob.type }, files: (status.recordings || []).map((r) => r.file) }),
  };
})();
