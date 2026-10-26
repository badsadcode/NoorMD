// NoorMD Video Bench: local videos grouped by folder into series, played in episode order with resume, sidecar
// subtitles (SRT/ASS/VTT, converted by the host), playback speed, timestamped notes and a pop-out player that can stay
// on top of other windows. The page refers to videos only by library id; files are served from /_video/{id}.
window.NoorVideo = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  let hooks = { showError: (e) => console.error(e), onPlay: () => {} };
  let built = false;
  let status = { folders: [], series: [], resume: [] };
  let seriesKey = null;
  let episodes = [];
  let current = null;        // { video, subtitles, notes, next }
  let poppedOut = null;      // id playing in the pop-out window
  let saveTimer = 0, lastSaved = 0;
  let countdown = null;
  let search = '';
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.controls = true;
  video.id = 'vb-video';
  video.setAttribute('playsinline', '');

  const fmt = (s) => { if (!Number.isFinite(s) || s < 0) return '0:00'; s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const isOpen = () => document.body.classList.contains('video-open');
  const resumeAfter = (duration) => (duration > 0 ? Math.min(5, duration * 0.1) : 5); // same rule as VideoLibrary.ResumeAfter

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('video.scanned', (p) => { if (built) { refresh(); notice(`Video library updated: ${p.found} videos${p.added ? `, ${p.added} new` : ''}${p.missing ? `, ${p.missing} missing` : ''}`, 3000); } });
    NoorBridge.on('video.popin', (p) => onPopIn(p));
    NoorBridge.on('video.notes', (p) => { if (current && current.video.id === p.id) reloadCurrent(false); });
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('pause', () => savePosition(true));
    video.addEventListener('play', () => { hideCountdown(); hooks.onPlay(); });
    video.addEventListener('ended', onEnded);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', () => {
      if (!video.getAttribute('src')) return;
      const code = video.error ? video.error.code : 0;
      showPlayerMessage(code === 4 ? 'This video’s format or codec can’t be played here. MP4 (H.264/AAC) and WebM play best; you can still open it in another player with “Show in Explorer”.' : 'The video could not be read. It may have been moved or deleted — try Rescan.');
    });
  }

  // ------------------------------------------------------------------ open / close

  async function open() {
    if (!built) build();
    if (window.NoorMusic && NoorMusic.isOpen()) NoorMusic.togglePanel(false); // both live on the right; the music keeps playing
    document.body.classList.add('video-open');
    $('#videobench').hidden = false;
    await refresh();
    if (!current && status.resume.length) await select(status.resume[0].id, { autoplay: false });
    else if (!seriesKey && status.series.length) await showSeries(status.series[0].key);
    $('#videobench').focus({ preventScroll: true });
  }

  function close() {
    if (!built) return;
    savePosition(true);
    video.pause();
    hideCountdown();
    document.body.classList.remove('video-open');
    $('#videobench').hidden = true;
    saveSession();
  }

  function toggle() { if (isOpen()) close(); else open(); }

  async function refresh() {
    try { status = await req('video.status'); } catch (err) { hooks.showError(err); return; }
    renderSide();
    if (seriesKey) await loadEpisodes(seriesKey);
    renderEmpty();
  }

  // ------------------------------------------------------------------ layout

  let pane = 'episodes';
  const WIDTH_KEY = 'noormd.video.width';

  /** A side panel like the Music Bench: the player on top, then Episodes / Library / Notes. "Wide" makes it bigger. */
  function build() {
    built = true;
    const tab = (id, label) => el('button', { role: 'tab', 'data-vbpane': id, onclick: () => setPane(id) }, label);
    const root = el('section', { id: 'videobench', class: 'videobench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'Video Bench' },
      el('div', { class: 'vb-resizer', id: 'vb-resizer', title: 'Drag to resize', 'aria-hidden': 'true' }),
      el('header', { class: 'vb-head' },
        el('strong', { class: 'vb-title' }, '🎬 Video'),
        el('span', { class: 'sd-spacer' }),
        el('button', { class: 'icon-btn', id: 'vb-wide', title: 'Wide / narrow', 'aria-label': 'Wide or narrow panel', 'aria-pressed': 'false', onclick: () => setWide(!document.body.classList.contains('video-wide')) }, '⤢'),
        el('button', { class: 'icon-btn', title: 'Video folders', 'aria-label': 'Video folders', onclick: showFolders }, '📁'),
        el('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close Video Bench', onclick: close }, '✕')),
      el('div', { class: 'vb-stage', id: 'vb-stage' }, video, el('div', { class: 'vb-message', id: 'vb-message', hidden: true }), el('div', { class: 'vb-countdown', id: 'vb-countdown', hidden: true })),
      el('div', { class: 'vb-info', id: 'vb-info' }),
      el('div', { class: 'vb-controls', id: 'vb-controls' }),
      el('div', { class: 'vb-empty', id: 'vb-empty', hidden: true }),
      el('div', { class: 'music-tabs vb-tabs', role: 'tablist' }, tab('episodes', 'Episodes'), tab('library', 'Library'), tab('notes', 'Notes')),
      el('div', { class: 'vb-pane', 'data-pane': 'episodes' },
        el('input', { type: 'search', id: 'vb-search', placeholder: 'Search videos…', 'aria-label': 'Search videos', autocomplete: 'off', spellcheck: 'false' }),
        el('div', { class: 'vb-episodes', id: 'vb-episodes', role: 'list', 'aria-label': 'Episodes' })),
      el('div', { class: 'vb-pane', 'data-pane': 'library' }, el('div', { class: 'vb-side', id: 'vb-side', 'aria-label': 'Series' })),
      el('div', { class: 'vb-pane', 'data-pane': 'notes' }, el('div', { class: 'vb-notes', id: 'vb-notes', 'aria-label': 'Notes' })));
    document.body.append(root);
    root.addEventListener('keydown', onKey);
    let t;
    $('#vb-search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { search = e.target.value.trim(); renderSearch(); }, 180); });
    try { const w = Number(localStorage.getItem(WIDTH_KEY)); if (w >= 360) document.documentElement.style.setProperty('--video-w', w + 'px'); } catch { /* per-viewer convenience */ }
    const rz = $('#vb-resizer');
    rz.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      rz.setPointerCapture(e.pointerId);
      const move = (ev) => document.documentElement.style.setProperty('--video-w', Math.min(window.innerWidth - 200, Math.max(360, window.innerWidth - ev.clientX)) + 'px');
      const up = () => {
        rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up);
        try { localStorage.setItem(WIDTH_KEY, String(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--video-w'), 10))); } catch { /* ignore */ }
      };
      rz.addEventListener('pointermove', move); rz.addEventListener('pointerup', up);
    });
    setPane('episodes');
  }

  function setPane(id) {
    pane = id;
    document.querySelectorAll('[data-vbpane]').forEach((b) => { b.classList.toggle('active', b.dataset.vbpane === id); b.setAttribute('aria-selected', String(b.dataset.vbpane === id)); });
    document.querySelectorAll('#videobench .vb-pane').forEach((p) => { p.hidden = p.dataset.pane !== id; });
  }

  function setWide(on) {
    document.body.classList.toggle('video-wide', on);
    $('#vb-wide').setAttribute('aria-pressed', String(on));
  }

  function renderEmpty() {
    const empty = $('#vb-empty');
    const none = !status.folders.length;
    empty.hidden = !none;
    $('#vb-stage').hidden = none;
    if (none) empty.replaceChildren(el('h2', { text: 'Your videos, in order' }),
      el('p', { text: 'Add a folder with tutorials, recordings or a series. Each subfolder becomes a series, played in episode order; NoorMD remembers where you stopped. Videos are only read, never changed.' }),
      el('button', { class: 'action primary', onclick: addFolder }, '📁 Add a video folder…'));
  }

  function renderSide() {
    const side = $('#vb-side');
    const resume = status.resume.map((v) => el('button', { class: 'vb-item resume' + (current && current.video.id === v.id ? ' active' : ''), onclick: () => select(v.id, { autoplay: true }) },
      el('span', { class: 'vb-item-title', text: v.title }),
      el('small', { text: `${v.series} · ${fmt(v.position)} / ${fmt(v.duration)}` }),
      el('span', { class: 'vb-bar' }, el('span', { style: `width:${v.duration ? Math.min(100, (v.position / v.duration) * 100) : 0}%` }))));
    const series = status.series.map((s) => el('button', { class: 'vb-item' + (s.key === seriesKey ? ' active' : ''), 'data-series': s.key, onclick: () => showSeries(s.key) },
      el('span', { class: 'vb-item-title', text: s.name }),
      el('small', { text: `${s.watched}/${s.count} watched` }),
      el('span', { class: 'vb-bar' }, el('span', { style: `width:${s.count ? (s.watched / s.count) * 100 : 0}%` }))));
    side.replaceChildren(
      ...(resume.length ? [el('h4', { text: 'Continue watching' }), ...resume] : []),
      el('h4', { text: 'Series' }),
      ...(series.length ? series : [el('p', { class: 'music-none', text: 'No videos yet.' })]));
  }

  async function showSeries(key) {
    seriesKey = key;
    await loadEpisodes(key);
    renderSide();
    const s = status.series.find((x) => x.key === key);
    if (!current && s && s.resumeId) await select(s.resumeId, { autoplay: false });
  }

  async function loadEpisodes(key) {
    try { episodes = await req('video.episodes', { key }); } catch (err) { hooks.showError(err); episodes = []; }
    renderEpisodes();
  }

  function renderEpisodes(list = episodes, heading = null) {
    const box = $('#vb-episodes');
    box.replaceChildren(
      ...(heading ? [el('h4', { text: heading })] : []),
      ...list.map((v, i) => el('div', { class: 'vb-ep' + (current && current.video.id === v.id ? ' playing' : '') + (v.watched ? ' watched' : ''), role: 'listitem', 'data-id': String(v.id) },
        el('span', { class: 'vb-ep-n', text: v.episode != null ? (v.season != null ? `S${v.season}E${v.episode}` : `E${v.episode}`) : String(i + 1) }),
        el('button', { class: 'vb-ep-title linkish', onclick: () => select(v.id, { autoplay: true }) }, v.title),
        el('small', { class: 'vb-ep-meta', text: [fmt(v.duration), v.notes ? `📝 ${v.notes}` : null, v.watched ? '✓ watched' : v.position > resumeAfter(v.duration) ? `▶ ${fmt(v.position)}` : null].filter(Boolean).join(' · ') }),
        el('button', { class: 'icon-btn', title: v.watched ? 'Mark as not watched' : 'Mark as watched', 'aria-label': v.watched ? 'Mark as not watched' : 'Mark as watched', onclick: () => markWatched([v.id], !v.watched) }, v.watched ? '↺' : '✓'))));
    if (!list.length && !heading) box.replaceChildren(el('p', { class: 'music-none', text: 'Choose a series on the left.' }));
  }

  async function renderSearch() {
    if (!search) { renderEpisodes(); return; }
    try { renderEpisodes(await req('video.search', { text: search }), `Search: ${search}`); } catch (err) { hooks.showError(err); }
  }

  // ------------------------------------------------------------------ playing

  async function select(id, { autoplay = false, at = null } = {}) {
    if (current && current.video.id !== id) savePosition(true);
    let d;
    try { d = await req('video.get', { id }); } catch (err) { hooks.showError(err); return; }
    current = d;
    hideCountdown();
    showPlayerMessage(null);
    if (poppedOut === id) { renderCurrent(); showPlayerMessage('Playing in the pop-out player.', [['Bring it back here', () => req('video.popout.close').catch(() => {})]]); return; }
    if (seriesKey !== d.video.seriesKey) { seriesKey = d.video.seriesKey; await loadEpisodes(seriesKey); renderSide(); }
    video.replaceChildren(...d.subtitles.map((s) => el('track', { kind: 'subtitles', label: s.label, srclang: s.lang === 'und' ? 'en' : s.lang, src: `_sub/${id}/${s.index}` })));
    video.src = `_video/${id}`;
    video.dataset.resume = String(at != null ? at : !d.video.watched && d.video.position > resumeAfter(d.video.duration) ? d.video.position : 0);
    video.dataset.autoplay = autoplay ? '1' : '';
    renderCurrent();
    renderEpisodes();
    renderSide();
    if (!d.exists) showPlayerMessage('This file is missing on disk. Rescan the folder or reconnect the drive.');
    saveSession();
  }

  async function reloadCurrent(rerender = true) {
    if (!current) return;
    try { const d = await req('video.get', { id: current.video.id }); current = { ...current, notes: d.notes, next: d.next, video: d.video }; } catch { return; }
    renderNotes();
    if (rerender) renderEpisodes();
  }

  function onLoaded() {
    const at = Number(video.dataset.resume || 0);
    if (at > 0 && at < video.duration - 2) {
      video.currentTime = at;
      notice(`Resumed at ${fmt(at)}`, 2500);
      showResumeHint(at);
    }
    if (video.dataset.autoplay) video.play().catch(() => {});
    // Show the first subtitle track by default when the video has one (the player menu can switch or hide it).
    const tracks = [...video.textTracks];
    tracks.forEach((t, i) => { t.mode = i === 0 && current && current.subtitles.length ? 'showing' : 'disabled'; });
    renderControls();
  }

  function showResumeHint(at) {
    const info = $('#vb-resume');
    if (!info) return;
    info.replaceChildren(el('span', { text: `Continued from ${fmt(at)} · ` }), el('button', { class: 'linkish', onclick: () => { video.currentTime = 0; info.replaceChildren(); } }, 'Start over'));
  }

  function onTime() {
    const now = Date.now();
    if (!video.paused && now - lastSaved > 5000) savePosition(false);
    const ts = $('#vb-note-time');
    if (ts && !$('#vb-note-input').value) ts.textContent = fmt(video.currentTime);
  }

  function savePosition(force) {
    if (!current || !video.getAttribute('src') || !Number.isFinite(video.duration) || poppedOut === current.video.id) return;
    const id = current.video.id;
    if (!force && Date.now() - lastSaved < 5000) return;
    lastSaved = Date.now();
    clearTimeout(saveTimer);
    req('video.position', { id, position: video.currentTime, duration: video.duration }).then((row) => {
      if (!row) return;
      const i = episodes.findIndex((e) => e.id === id);
      if (i >= 0) episodes[i] = row;
      if (current && current.video.id === id) current.video = row;
    }).catch(() => {});
  }

  async function onEnded() {
    if (!current) return;
    await req('video.position', { id: current.video.id, position: video.duration, duration: video.duration }).catch(() => {});
    await refresh();
    const next = current.next;
    if (!next) { notice('That was the last episode of this series ✓', 3000); return; }
    let n = 6;
    const box = $('#vb-countdown');
    box.hidden = false;
    const draw = () => box.replaceChildren(el('div', { text: `Next: ${next.title}` }), el('div', { class: 'vb-count', text: `in ${n} s` }),
      el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: hideCountdown }, 'Cancel'), el('button', { class: 'action primary', onclick: () => select(next.id, { autoplay: true }) }, 'Play now')));
    draw();
    countdown = setInterval(() => { n--; if (n <= 0) { hideCountdown(); select(next.id, { autoplay: true }); } else draw(); }, 1000);
  }

  function hideCountdown() { clearInterval(countdown); countdown = null; const b = $('#vb-countdown'); if (b) b.hidden = true; }

  function showPlayerMessage(text, actions = []) {
    const m = $('#vb-message');
    if (!m) return;
    m.hidden = !text;
    if (text) m.replaceChildren(el('p', { text }), ...actions.map(([label, fn]) => el('button', { class: 'action', onclick: fn }, label)));
  }

  function renderCurrent() {
    const v = current && current.video;
    $('#vb-info').replaceChildren(...(v ? [
      el('div', { class: 'vb-now', text: v.title }),
      el('small', { text: [v.series, v.episode != null ? (v.season != null ? `Season ${v.season}, episode ${v.episode}` : `Episode ${v.episode}`) : null, v.width ? `${v.width}×${v.height}` : null].filter(Boolean).join(' · ') }),
      el('small', { id: 'vb-resume', class: 'vb-resume' })] : [el('div', { class: 'vb-now muted', text: 'Nothing playing' })]));
    renderControls();
    renderNotes();
  }

  function renderControls() {
    const box = $('#vb-controls');
    if (!box) return;
    if (!current) { box.replaceChildren(); return; }
    const i = episodes.findIndex((e) => e.id === current.video.id);
    const prev = i > 0 ? episodes[i - 1] : null;
    const speed = el('select', { id: 'vb-speed', 'aria-label': 'Playback speed', title: 'Speed ([ and ])' }, ...SPEEDS.map((s) => el('option', { value: String(s), text: s === 1 ? 'Normal speed' : `${s}×` })));
    speed.value = String(video.playbackRate);
    speed.addEventListener('change', () => { video.playbackRate = Number(speed.value); saveSession(); });
    const subs = el('select', { id: 'vb-subs', 'aria-label': 'Subtitles', title: 'Subtitles (C)' }, el('option', { value: '-1', text: current.subtitles.length ? 'Subtitles off' : 'No subtitles found' }),
      ...current.subtitles.map((s) => el('option', { value: String(s.index), text: s.label })));
    const showing = [...video.textTracks].findIndex((t) => t.mode === 'showing');
    subs.value = String(showing);
    subs.disabled = !current.subtitles.length;
    subs.addEventListener('change', () => setSubtitle(Number(subs.value)));
    box.replaceChildren(
      el('button', { class: 'utility-btn', disabled: !prev || undefined, onclick: () => prev && select(prev.id, { autoplay: true }), title: 'Previous episode' }, '⏮ Previous'),
      el('button', { class: 'utility-btn', disabled: !current.next || undefined, onclick: () => current.next && select(current.next.id, { autoplay: true }), title: 'Next episode' }, 'Next ⏭'),
      speed, subs,
      el('button', { class: 'utility-btn', id: 'vb-popout', onclick: popOut, title: 'Open in a small window that stays on top of other programs' }, '⧉ Pop out'),
      el('button', { class: 'utility-btn', onclick: () => markWatched([current.video.id], !current.video.watched) }, current.video.watched ? '↺ Not watched' : '✓ Watched'),
      el('button', { class: 'utility-btn', onclick: () => req('video.reveal', { id: current.video.id }).catch(hooks.showError) }, 'Show in Explorer'));
  }

  function setSubtitle(index) {
    [...video.textTracks].forEach((t, i) => { t.mode = i === index ? 'showing' : 'disabled'; });
    const sel = $('#vb-subs');
    if (sel) sel.value = String(index);
  }

  async function markWatched(ids, value) {
    try { await req('video.watched', { ids, value }); } catch (err) { hooks.showError(err); return; }
    await refresh();
    if (current && ids.includes(current.video.id)) await reloadCurrent();
    renderControls();
  }

  // ------------------------------------------------------------------ notes

  function renderNotes() {
    const box = $('#vb-notes');
    if (!box) return;
    const tabBtn = document.querySelector('[data-vbpane="notes"]');
    if (tabBtn) tabBtn.textContent = current && current.notes.length ? `Notes (${current.notes.length})` : 'Notes';
    if (!current) { box.replaceChildren(el('h4', { text: 'Notes' }), el('p', { class: 'music-none', text: 'Notes are tied to a moment in the video. Play something, then press N.' })); return; }
    const input = el('textarea', { id: 'vb-note-input', rows: '2', placeholder: 'Note at this moment… (Enter adds, Shift+Enter new line)', 'aria-label': 'New note' });
    let at = null;
    input.addEventListener('input', () => { if (at == null && input.value) { at = video.currentTime; $('#vb-note-time').textContent = fmt(at); } if (!input.value) at = null; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(input.value, at ?? video.currentTime); at = null; }
      if (e.key === 'Escape') { e.stopPropagation(); input.value = ''; at = null; $('#vb-stage video').focus(); }
    });
    box.replaceChildren(
      el('div', { class: 'vb-notes-head' }, el('h4', { text: `Notes (${current.notes.length})` }),
        el('button', { class: 'utility-btn', disabled: !current.notes.length || undefined, onclick: insertNotes, title: 'Insert the notes into the open document as a list with timestamps' }, '⇩ Into document')),
      el('div', { class: 'vb-note-new' }, el('span', { class: 'vb-stamp', id: 'vb-note-time', text: fmt(video.currentTime) }), input),
      el('ol', { class: 'vb-note-list', id: 'vb-note-list' }, ...current.notes.map((n) => el('li', { class: 'vb-note', 'data-note': String(n.id) },
        el('button', { class: 'vb-stamp linkish', title: 'Jump to this moment', onclick: () => { video.currentTime = n.time; video.play().catch(() => {}); } }, n.stamp),
        el('span', { class: 'vb-note-text', text: n.text, title: 'Double-click to edit', ondblclick: (e) => editNote(n, e.currentTarget) }),
        el('button', { class: 'icon-btn', title: 'Delete note', 'aria-label': 'Delete note', onclick: () => deleteNote(n) }, '✕')))));
  }

  async function addNote(text, time) {
    if (!text.trim() || !current) return;
    try {
      const r = await req('video.note.add', { id: current.video.id, time, text });
      current.notes = r.notes;
      renderNotes();
      const i = episodes.findIndex((e) => e.id === current.video.id);
      if (i >= 0) { episodes[i] = { ...episodes[i], notes: r.notes.length }; renderEpisodes(); }
      $('#vb-note-input')?.focus();
    } catch (err) { hooks.showError(err); }
  }

  function editNote(n, span) {
    const ta = el('textarea', { class: 'vb-note-edit', rows: '2', 'aria-label': 'Edit note' });
    ta.value = n.text;
    span.replaceWith(ta);
    ta.focus();
    const done = async (save) => {
      if (save && ta.value.trim() && ta.value !== n.text) {
        try { current.notes = await req('video.note.update', { id: current.video.id, noteId: n.id, text: ta.value }); } catch (err) { hooks.showError(err); }
      }
      renderNotes();
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
    ta.addEventListener('blur', () => done(true));
  }

  async function deleteNote(n) {
    try { current.notes = await req('video.note.delete', { id: current.video.id, noteId: n.id }); renderNotes(); } catch (err) { hooks.showError(err); }
  }

  async function insertNotes() {
    try { const r = await req('video.note.insert', { id: current.video.id }); notice(`Notes inserted into “${r.document}”`, 2500); } catch (err) { hooks.showError(err); }
  }

  // ------------------------------------------------------------------ pop-out

  async function popOut() {
    if (!current) return;
    const id = current.video.id, time = video.currentTime || current.video.position || 0, paused = video.paused;
    savePosition(true);
    try { await req('video.popout', { id, time, paused }); } catch (err) { hooks.showError(err); return; }
    poppedOut = id;
    video.pause();
    video.removeAttribute('src');
    video.load();
    showPlayerMessage('Playing in the pop-out player. It stays on top of other windows; close it to continue here.');
  }

  async function onPopIn(p) {
    poppedOut = null;
    if (!built) return;
    showPlayerMessage(null);
    await refresh();
    if (current && current.video.id === p.id) await select(p.id, { autoplay: isOpen(), at: p.time });
  }

  // ------------------------------------------------------------------ folders, keys, session

  async function addFolder() {
    try { const r = await req('video.addFolder'); if (r && !r.cancelled) await refresh(); } catch (err) { hooks.showError(err); }
  }

  function showFolders() {
    NoorUI.modal({ label: 'Video folders', width: 560 }, (s, closeModal) => {
      const draw = () => s.querySelector('.modal-body').replaceChildren(
        ...(status.folders.length ? status.folders.map((f) => el('div', { class: 'qitem' }, el('span', { class: 'qtitle', text: f.path }), el('small', { text: `${f.count} videos` }),
          el('button', { class: 'icon-btn', title: 'Remove from the library (files stay on disk)', 'aria-label': 'Remove folder', onclick: async () => {
            if (!await NoorUI.confirm('Remove this folder?', `“${f.path}” is removed from the Video Bench, with its positions and notes. The videos stay on disk.`, 'Remove')) return;
            await req('video.removeFolder', { id: f.id }).catch(hooks.showError);
            if (current && current.video.folder.startsWith(f.path)) { current = null; video.removeAttribute('src'); video.load(); renderCurrent(); }
            seriesKey = null; episodes = [];
            await refresh(); draw();
          } }, '✕'))) : [el('p', { class: 'music-none', text: 'No folders yet.' })]));
      s.append(NoorUI.head('📁 Video folders', closeModal), el('div', { class: 'modal-body' }),
        el('div', { class: 'modal-foot' }, el('span', { text: 'Subfolders are included. Files are only read.' }),
          el('div', { class: 'modal-buttons' },
            el('button', { class: 'action', onclick: async () => { await req('video.rescan').catch(hooks.showError); await refresh(); draw(); } }, 'Rescan'),
            el('button', { class: 'action primary', onclick: async () => { await addFolder(); draw(); } }, 'Add folder…'))));
      draw();
    });
  }

  function onKey(e) {
    const typing = e.target.closest('input, textarea, select');
    if (e.key === 'Escape' && !typing) { if (document.fullscreenElement) return; e.preventDefault(); e.stopPropagation(); close(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !current) return;
    const k = e.key;
    const seek = (d) => { video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + d)); };
    if (k === ' ' || k === 'k' || k === 'K') { if (e.target === video) return; e.preventDefault(); if (video.paused) video.play().catch(() => {}); else video.pause(); }
    else if (k === 'j' || k === 'J') { e.preventDefault(); seek(-10); }
    else if (k === 'l' || k === 'L') { e.preventDefault(); seek(10); }
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.target !== video) { e.preventDefault(); seek(k === 'ArrowLeft' ? -5 : 5); }
    else if (k === 'f' || k === 'F') { e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else video.requestFullscreen().catch(() => {}); }
    else if (k === 'n' || k === 'N') { e.preventDefault(); setPane('notes'); const i = $('#vb-note-input'); if (i) { i.focus(); i.dispatchEvent(new Event('input')); } }
    else if (k === '[' || k === ']') {
      e.preventDefault();
      const i = SPEEDS.indexOf(video.playbackRate);
      video.playbackRate = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + (k === ']' ? 1 : -1)))];
      notice(`Speed ${video.playbackRate}×`, 900);
      renderControls();
    } else if (k === 'c' || k === 'C') {
      e.preventDefault();
      const n = video.textTracks.length;
      if (!n) { notice('No subtitles for this video.'); return; }
      const cur = [...video.textTracks].findIndex((t) => t.mode === 'showing');
      const next = cur + 1 >= n ? -1 : cur + 1;
      setSubtitle(next);
      notice(next < 0 ? 'Subtitles off' : `Subtitles: ${video.textTracks[next].label}`, 1200);
    }
  }

  function saveSession() {
    const json = JSON.stringify({ v: 1, id: current ? current.video.id : null, series: seriesKey, speed: video.playbackRate });
    req('video.session.save', { json }).catch(() => {});
  }

  return {
    init, open, close, toggle, isOpen, select, addFolder,
    _state: () => ({ open: isOpen(), current: current ? { id: current.video.id, title: current.video.title, notes: current.notes.length, subtitles: current.subtitles.length } : null, seriesKey, episodes: episodes.map((e) => e.id), time: video.currentTime, paused: video.paused, rate: video.playbackRate, poppedOut, tracks: [...video.textTracks].map((t) => t.mode) }),
  };
})();
