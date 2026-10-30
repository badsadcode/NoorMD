// The pop-out video player (video.html), hosted by VideoWindow.cs. It plays one video by library id, reports the
// position for resume, can add timestamped notes, and toggles "always on top".
(() => {
  'use strict';
  const { $, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const v = $('#pv');
  let id = null, next = null, lastSaved = 0, noteAt = 0, topmost = true;
  let pauseOnNote = true, resumeAfterNote = false; // NoorVideo's setting: pause while writing, continue after
  let notes = [];
  const notesOnVideo = (() => { try { return localStorage.getItem('noormd.video.notesOnVideo') !== 'off'; } catch { return true; } })();
  const stage = $('#pv-stage');
  const toggleFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else stage.requestFullscreen().catch(() => {}); };
  // NoorMD's own controls (timeline, play, next, volume, ⚙ speed / subtitles / sound, full screen): they show on mouse move.
  const controls = NoorPlayerControls.attach(stage, v, {
    onNext: () => { if (next) { save(true); load({ id: next.id, time: 0, paused: false }); } },
    hasNext: () => !!next,
    onFullscreen: toggleFullscreen,
  });
  v.addEventListener('click', () => { if (v.paused) v.play().catch(() => {}); else v.pause(); });
  v.addEventListener('dblclick', toggleFullscreen);
  let shownNote;
  const renderNotePop = () => {
    // Notes on the video, as in NoorVideo (the same 💬 setting).
    const t = v.currentTime;
    const n = notesOnVideo ? notes.filter((x) => t >= x.time && t < x.time + 6).sort((a, b) => b.time - a.time)[0] : null;
    const key = n ? n.id + ':' + n.text : null;
    if (key === shownNote) return;
    shownNote = key;
    const pop = $('#pv-note-pop');
    pop.hidden = !n;
    if (n) { pop.replaceChildren(Object.assign(document.createElement('b'), { textContent: fmt(n.time) }), document.createTextNode(n.text)); }
  };
  for (const ev of ['timeupdate', 'seeked', 'loadeddata']) v.addEventListener(ev, renderNotePop);
  const fmt = (s) => { s = Math.floor(Math.max(0, s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };

  async function load(p) {
    let d;
    try { d = await req('video.get', { id: p.id }); } catch (err) { notice(err.message, 5000); return; }
    id = p.id; next = d.next; notes = d.notes || []; shownNote = undefined;
    pauseOnNote = p.pauseOnNote !== false;
    $('#pv-title').textContent = d.video.title;
    req('video.title', { title: d.video.title }).catch(() => {});
    $('#pv-next').disabled = !next;
    controls.refresh();
    v.replaceChildren(...d.subtitles.map((s, i) => Object.assign(document.createElement('track'), { kind: 'subtitles', label: s.label, srclang: s.lang === 'und' ? 'en' : s.lang, src: `/_sub/${p.id}/${s.index}`, default: i === 0 })));
    v.src = `/_video/${p.id}`;
    v.addEventListener('loadedmetadata', () => {
      if (p.time > 0 && p.time < v.duration - 2) v.currentTime = p.time;
      if (!p.paused) v.play().catch(() => {});
    }, { once: true });
  }

  function save(force) {
    if (id == null || !Number.isFinite(v.duration)) return;
    if (!force && Date.now() - lastSaved < 2000) return;
    lastSaved = Date.now();
    req('video.position', { id, position: v.currentTime, duration: v.duration }).catch(() => {});
  }

  function openNote() {
    noteAt = v.currentTime;
    if (pauseOnNote && !v.paused) { v.pause(); resumeAfterNote = true; }
    $('#pv-stamp').textContent = fmt(noteAt);
    $('#pv-noteform').hidden = false;
    $('#pv-notetext').focus();
  }

  function continueAfterNote() {
    if (resumeAfterNote) { resumeAfterNote = false; v.play().catch(() => {}); }
  }

  async function saveNote() {
    const text = $('#pv-notetext').value.trim();
    $('#pv-noteform').hidden = true;
    $('#pv-notetext').value = '';
    continueAfterNote();
    if (!text || id == null) return;
    try { const r = await req('video.note.add', { id, time: noteAt, text }); if (r && r.notes) notes = r.notes; notice(`Note added at ${fmt(noteAt)}`, 1500); } catch (err) { notice(err.message, 4000); }
  }

  async function setTop(on) {
    try { const r = await req('video.topmost', { value: on }); topmost = r.topmost; } catch { return; }
    $('#pv-top').classList.toggle('on', topmost);
    $('#pv-top').setAttribute('aria-pressed', String(topmost));
    notice(topmost ? 'Always on top' : 'Not on top', 1000);
  }

  NoorBridge.on('video.load', load);
  v.addEventListener('timeupdate', () => save(false));
  v.addEventListener('pause', () => { save(true); document.body.classList.add('paused'); });
  v.addEventListener('play', () => document.body.classList.remove('paused'));
  v.addEventListener('ended', async () => {
    save(true);
    if (next) { notice(`Next: ${next.title}`, 2500); await load({ id: next.id, time: 0, paused: false }); }
  });
  $('#pv-top').addEventListener('click', () => setTop(!topmost));
  $('#pv-note').addEventListener('click', openNote);
  $('#pv-next').addEventListener('click', () => { if (next) { save(true); load({ id: next.id, time: 0, paused: false }); } });
  $('#pv-close').addEventListener('click', () => { save(true); req('video.close').catch(() => {}); });
  $('#pv-noteform').addEventListener('submit', (e) => { e.preventDefault(); saveNote(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) { if (e.key === 'Escape') { $('#pv-noteform').hidden = true; continueAfterNote(); v.focus(); } return; }
    const k = e.key.toLowerCase();
    if (k === 'escape' && !document.fullscreenElement) { save(true); req('video.close').catch(() => {}); }
    else if (k === 'n') { e.preventDefault(); openNote(); }
    else if (k === 't') { e.preventDefault(); setTop(!topmost); }
    else if (k === ' ' && e.target !== v) { e.preventDefault(); if (v.paused) v.play().catch(() => {}); else v.pause(); }
    else if (k === 'f') { e.preventDefault(); toggleFullscreen(); }
    else if (k === 'm') { e.preventDefault(); v.muted = !v.muted; }
    else if (k === 'arrowright' || k === 'arrowleft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime + (k === 'arrowright' ? 5 : -5)); controls.show(); }
    else if (k === 'j' || k === 'l') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime + (k === 'l' ? 10 : -10)); }
  });
  window.addEventListener('beforeunload', () => save(true));
  req('video.ready').catch(() => {});
})();
