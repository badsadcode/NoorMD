// NoorSequencer: a friendly composer for loops, jingles and simple game soundtracks. A song is tracks × bars: each
// track has numbered patterns (one bar of notes each) and the song grid says which pattern each track plays in each
// bar, as in BeepBox. The app renders the song (the same code for listening and exporting); this page edits it and
// plays the rendered sound. Export writes the mix, a seamless loop, stems and MIDI with the song beside them.
window.NoorSequencer = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const noteName = (p) => NOTE_NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);
  const SCALE_STEPS = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    'harmonic-minor': [0, 2, 3, 5, 7, 8, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], 'major-pentatonic': [0, 2, 4, 7, 9], 'minor-pentatonic': [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  const SCALE_LABEL = {
    major: 'Major (bright, happy)', minor: 'Minor (sad, serious)', dorian: 'Dorian (hopeful minor)', mixolydian: 'Mixolydian (bluesy major)',
    'harmonic-minor': 'Harmonic minor (dark, exotic)', phrygian: 'Phrygian (tense, Spanish)', 'major-pentatonic': 'Major pentatonic (can\'t go wrong)',
    'minor-pentatonic': 'Minor pentatonic (rock, folk)', blues: 'Blues', chromatic: 'Chromatic (every note)',
  };
  const KIT = ['Kick', 'Snare', 'Clap', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Rim'];
  const KIND_ICON = { synth: '🎹', drums: '🥁', sample: '🎙' };
  const KIND_LABEL = { synth: 'Synth', drums: 'Drum kit', sample: 'Sample (your WAV)' };
  const WAVES = [['sine', 'Sine (soft, pure)'], ['triangle', 'Triangle (flute, soft lead)'], ['square', 'Square (retro, hollow)'], ['pulse', 'Pulse (nasal, chiptune)'], ['saw', 'Saw (bright, strings, brass)'], ['noise', 'Noise (wind, hiss)']];
  const SYNTH = [['octave', 'Octave', -3, 3, 1, 'num'], ['detune', 'Second voice detune (0 = one voice)', 0, 50, 0.5, 'cents'], ['attack', 'Attack', 0.001, 5, 0.001, 's'], ['decay', 'Decay', 0.001, 5, 0.001, 's'],
    ['sustain', 'Sustain', 0, 1, 0.01, 'pct'], ['release', 'Release', 0.001, 8, 0.001, 's'], ['cutoff', 'Filter cutoff', 40, 20000, 1, 'hz'], ['resonance', 'Filter resonance', 0.5, 10, 0.1, 'num'],
    ['filterEnvelope', 'Filter follows the envelope (octaves)', -4, 6, 0.1, 'num'], ['vibrato', 'Vibrato depth', 0, 100, 1, 'cents'], ['vibratoRate', 'Vibrato speed', 0.1, 15, 0.1, 'rate']];
  const DRUMS = [['drumTune', 'Tune (semitones)', -24, 24, 0.5, 'num'], ['drumDecay', 'Decay (longer ↔ shorter)', 0.2, 4, 0.05, 'x'], ['drumTone', 'Tone (dark ↔ bright)', 0, 1, 0.01, 'pct']];
  const SAMPLE = [['octave', 'Octave', -3, 3, 1, 'num'], ['attack', 'Attack', 0.001, 5, 0.001, 's'], ['decay', 'Decay', 0.001, 5, 0.001, 's'], ['sustain', 'Sustain', 0, 1, 0.01, 'pct'], ['release', 'Release', 0.001, 8, 0.001, 's']];
  const NEW_TRACK = {
    synth: { name: 'Synth', kind: 'synth', gain: -10, instrument: { wave: 'triangle', detune: 6, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2, cutoff: 8000, resonance: 0.7 } },
    drums: { name: 'Drums', kind: 'drums', gain: -8, instrument: { drumTune: 0, drumDecay: 1, drumTone: 0.5 } },
    sample: { name: 'Sample', kind: 'sample', gain: -6, instrument: { rootNote: 60, attack: 0.002, decay: 0.3, sustain: 1, release: 0.15 } },
  };
  const MAX_TRACKS = 12, MAX_PATTERNS = 32, MAX_BARS = 128;

  let hooks = { showError: (e) => console.error(e), onPlay: () => {} };
  let built = false;
  let lists = { templates: [], mine: [] };
  let song = null;
  let sel = { track: 0, bar: 0 };
  let tab = 'notes';
  let playFrom = 0;
  let loopMode = (() => { try { return localStorage.getItem('noormd.seq.loop') === 'on'; } catch { return false; } })();
  let scaleLock = (() => { try { return localStorage.getItem('noormd.seq.lock') !== 'off'; } catch { return true; } })();
  let volume = (() => { try { const v = Number(localStorage.getItem('noormd.seq.volume')); return localStorage.getItem('noormd.seq.volume') != null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8; } catch { return 0.8; } })();
  let newVelocity = 0.8;
  let newLength = 2;
  let render = null; // { url, fromBar, toBar, barSeconds, loop, seconds }
  let renderGen = 0, renderTimer = null, renderStale = true;
  let where = null;
  const history = []; let future = [];
  let lastSnapshot = null, snapTimer = null;
  const audio = new Audio(); audio.preload = 'auto';
  const noteAudio = new Audio();
  let roll = null; // the piano roll's state while the Notes tab shows a melodic track
  let listenLayer = ''; // an adaptive layer to listen to ('' = the whole song)
  const audition = new Audio(); // a transition or the loop's seam, played on its own

  const isOpen = () => document.body.classList.contains('seq-open');
  const track = () => (song && song.tracks[sel.track]) || null;

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('seq.openSong', async (p) => { await open(); setSong(p.song, true); notice(`Opened “${p.song.name}” from the Vault`, 1600); });
    NoorBridge.on('seq.exportProgress', (p) => { const s = $('#seq-export-status'); if (s) s.textContent = `Rendering ${p.done} of ${p.total}…`; });
    audio.addEventListener('play', () => { renderTransport(); tick(); });
    audio.addEventListener('pause', renderTransport);
    audio.addEventListener('ended', () => { renderTransport(); showPlayhead(-1); });
  }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('sequencer');
    document.body.classList.add('seq-open');
    $('#seqbench').hidden = false;
    if (!lists.templates.length) {
      try { lists = await req('seq.templates'); } catch (err) { hooks.showError(err); return; }
      renderTemplates();
    }
    if (!song) await loadTemplate('cozy');
    $('#seqbench').focus({ preventScroll: true });
  }

  function close() {
    if (!built || !isOpen()) return;
    audio.pause();
    document.body.classList.remove('seq-open');
    $('#seqbench').hidden = true;
    if (window.NoorDock) NoorDock.closed('sequencer');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  // ---------------------------------------------------------------- song, history

  async function loadTemplate(id) {
    try { setSong(await req('seq.template', { id }), true); } catch (err) { hooks.showError(err); }
  }

  function setSong(s, fresh) {
    if (!fresh && song) pushHistory();
    song = s;
    if (fresh) { history.length = 0; future = []; sel = { track: 0, bar: 0 }; playFrom = 0; audio.pause(); }
    fixSelection();
    lastSnapshot = JSON.stringify(song);
    renderAll();
    stale();
  }

  function fixSelection() {
    sel.track = Math.max(0, Math.min(song.tracks.length - 1, sel.track));
    sel.bar = Math.max(0, Math.min(song.bars - 1, sel.bar));
    playFrom = Math.max(0, Math.min(song.bars - 1, playFrom));
  }

  /** Something changed: keep the step for undo once it settles, and render again (now if playing, else on Play). */
  function changed(what) {
    if (what === 'grid' || what === 'all') renderGrid();
    if (what === 'all') renderPane();
    if (what === 'pane') renderPane();
    renderHeader();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(pushHistory, 600);
    stale();
  }

  function pushHistory() {
    const now = JSON.stringify(song);
    if (lastSnapshot && lastSnapshot !== now) { history.push(lastSnapshot); if (history.length > 100) history.shift(); future = []; }
    lastSnapshot = now;
  }

  function undo(redo) {
    clearTimeout(snapTimer);
    pushHistory();
    const from = redo ? future : history, to = redo ? history : future;
    if (!from.length) return;
    to.push(JSON.stringify(song));
    song = JSON.parse(from.pop());
    lastSnapshot = JSON.stringify(song);
    fixSelection();
    renderAll();
    stale();
  }

  // ---------------------------------------------------------------- listening

  /** The song changed: what plays is out of date. While playing, render again shortly and carry on from the same spot. */
  function stale() {
    renderStale = true;
    if (!audio.paused) { clearTimeout(renderTimer); renderTimer = setTimeout(() => preview(true), 350); }
  }

  async function preview(keepPlaying) {
    const gen = ++renderGen;
    const wasAt = currentBarPosition();
    setStatus('Rendering…');
    try {
      if (listenLayer && !(song.layers || []).some((l) => l.id === listenLayer)) listenLayer = '';
      const out = await req('seq.render', { song, loop: loopMode, fromBar: loopMode ? song.loopStart : playFrom, layer: listenLayer || undefined });
      if (gen !== renderGen) return false;
      render = out;
      renderStale = false;
      audio.loop = out.loop;
      audio.src = out.url;
      audio.volume = volume;
      const loaded = await new Promise((resolve) => {
        audio.addEventListener('loadedmetadata', () => resolve(true), { once: true });
        audio.addEventListener('error', () => resolve(false), { once: true });
      });
      if (!loaded) { setStatus('The rendered song could not be played.'); return false; }
      // Keep listening from the same place in the song (if it is inside what was rendered).
      if (keepPlaying && wasAt != null && wasAt >= out.fromBar && wasAt < out.toBar) audio.currentTime = Math.min((wasAt - out.fromBar) * out.barSeconds, Math.max(0, audio.duration - 0.05));
      setStatus(`${loopMode ? `Loop: bars ${out.fromBar + 1}–${out.toBar}` : `From bar ${out.fromBar + 1}`} · ${out.seconds.toFixed(1)} s · peak ${out.peakDb} dB${out.cut ? ` · plays up to bar ${out.toBar} (a few minutes at once)` : ''}${out.warnings && out.warnings.length ? ' · ⚠ ' + out.warnings.join('; ') : ''}`);
      return true;
    } catch (err) { if (gen === renderGen) setStatus(err && err.message ? err.message : String(err)); return false; }
  }

  /** Where the playhead is, in bars from the song's start (fractional), or null. */
  function currentBarPosition() {
    if (!render || audio.paused || !Number.isFinite(audio.currentTime)) return null;
    const bars = audio.currentTime / render.barSeconds;
    return render.loop ? render.fromBar + (bars % (render.toBar - render.fromBar)) : render.fromBar + bars;
  }

  async function playStop() {
    if (!song) return;
    if (!audio.paused) { audio.pause(); showPlayhead(-1); return; }
    hooks.onPlay();
    const wanted = loopMode ? song.loopStart : playFrom;
    audition.pause();
    if (renderStale || !render || render.loop !== loopMode || render.fromBar !== wanted || (render.layer || '') !== listenLayer) { if (!(await preview(false))) return; } else audio.currentTime = 0;
    audio.play().catch((err) => setStatus(err.message));
  }

  function setLoopMode(on) {
    loopMode = !!on;
    try { localStorage.setItem('noormd.seq.loop', loopMode ? 'on' : 'off'); } catch { /* private storage off */ }
    const b = $('#seq-loop');
    if (b) { b.setAttribute('aria-pressed', String(loopMode)); b.classList.toggle('active', loopMode); b.title = loopMode ? 'Playing the loop (bars marked above the grid) over and over: click to play the song (L)' : 'Playing the song from the marked bar: click to play the loop over and over (L)'; }
    if (!audio.paused) { audio.pause(); playStop(); }
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('noormd.seq.volume', String(volume)); } catch { /* private storage off */ }
    audio.volume = volume; noteAudio.volume = volume;
    const s = $('#seq-volume');
    if (s) { s.value = String(Math.round(volume * 100)); s.title = `Listening volume: ${Math.round(volume * 100)}% (only here; the song and its export are not changed)`; }
  }

  /** A note as it will sound, when it is placed (or a drum row's name is clicked). */
  async function hear(trackIndex, pitch, velocity) {
    try {
      const r = await req('seq.note', { song, track: trackIndex, ...(Array.isArray(pitch) ? { pitches: pitch } : { pitch }), velocity: velocity || newVelocity });
      noteAudio.src = r.url; noteAudio.volume = volume;
      noteAudio.play().catch(() => {});
    } catch { /* a note that can't sound (a missing sample) stays silent */ }
  }

  function renderTransport() {
    const b = $('#seq-play');
    if (!b) return;
    b.textContent = audio.paused ? '▶' : '■';
    b.setAttribute('aria-label', audio.paused ? 'Play' : 'Stop');
  }

  function tick() {
    const at = currentBarPosition();
    showPlayhead(at == null ? -1 : at);
    if (!audio.paused) requestAnimationFrame(tick);
  }

  /** The playing bar lit in the grid, and a line in the piano roll when it shows the pattern playing. */
  function showPlayhead(at) {
    const bar = at < 0 ? -1 : Math.floor(at);
    const grid = $('#seq-grid');
    if (grid && grid.dataset.playing !== String(bar)) {
      grid.dataset.playing = String(bar);
      grid.querySelectorAll('.seq-playing').forEach((c) => c.classList.remove('seq-playing'));
      if (bar >= 0) grid.querySelectorAll(`[data-bar="${bar}"]`).forEach((c) => c.classList.add('seq-playing'));
    }
    if (roll) { roll.playhead = bar >= 0 && song.tracks[sel.track] && song.tracks[sel.track].sequence[bar] === currentPattern() && currentPattern() > 0 ? (at - bar) * song.beatsPerBar * 4 : -1; drawRoll(); }
    const drums = $('#seq-drums');
    if (drums) {
      const step = bar >= 0 && song.tracks[sel.track] && song.tracks[sel.track].sequence[bar] === currentPattern() && currentPattern() > 0 ? Math.floor((at - bar) * song.beatsPerBar * 4) : -1;
      if (drums.dataset.step !== String(step)) {
        drums.dataset.step = String(step);
        drums.querySelectorAll('.seq-now').forEach((c) => c.classList.remove('seq-now'));
        if (step >= 0) drums.querySelectorAll(`[data-step="${step}"]`).forEach((c) => c.classList.add('seq-now'));
      }
    }
  }

  function setStatus(t) { const s = $('#seq-status'); if (s) s.textContent = t; }

  // ---------------------------------------------------------------- building

  function build() {
    built = true;
    const num = (id, label, min, max, title) => el('label', { class: 'sb-inline', title }, el('span', { text: label }), el('input', { type: 'number', id, min: String(min), max: String(max), step: '1', class: 'seq-num' }));
    const root = el('section', { id: 'seqbench', class: 'soundbench seqbench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'NoorSequencer' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🎼' }), el('strong', { text: 'NoorSequencer' }), el('small', { id: 'seq-family' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'seq-open', title: 'Open a song (.noorsong.json)', 'aria-label': 'Open a song', onclick: openSong }, '📂'),
          el('button', { class: 'icon-btn', id: 'seq-dock', title: 'Where this panel goes', 'aria-label': 'Move NoorSequencer', onclick: (e) => NoorDock.showMenu('sequencer', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+Q)', 'aria-label': 'Close NoorSequencer', onclick: close }, '✕'))),
      el('div', { class: 'seq-top' },
        el('button', { class: 'radio-play', id: 'seq-play', title: 'Play / stop (Space)', 'aria-label': 'Play', onclick: playStop }, '▶'),
        el('button', { class: 'icon-btn sb-repeat', id: 'seq-loop', 'aria-label': 'Play the loop over and over', 'aria-pressed': 'false', onclick: () => setLoopMode(!loopMode) }, '🔁'),
        el('input', { type: 'range', class: 'sb-volume', id: 'seq-volume', min: '0', max: '100', step: '1', 'aria-label': 'Listening volume' }),
        el('input', { type: 'text', id: 'seq-name', 'aria-label': 'Name of the song', spellcheck: 'false', maxlength: '80' }),
        el('label', { class: 'sb-inline' }, el('span', { text: 'New' }), el('select', { id: 'seq-template', 'aria-label': 'Start a new song from a template', title: 'Start a new song from a mood template, an empty song or one of yours' })),
        el('select', { id: 'seq-listenlayer', 'aria-label': 'Listen to', title: 'Listen to the whole song, or one of its adaptive layers (as a game would play it)', hidden: true }),
        el('button', { class: 'utility-btn', id: 'seq-exportbtn', title: 'Export the song: WAV or OGG, a seamless loop, layers, stems, MIDI', onclick: () => { tab = 'song'; renderPane(); const b = $('#seq-export'); if (b) { b.scrollIntoView({ block: 'center' }); b.focus({ preventScroll: true }); } } }, '⤓ Export'),
        el('button', { class: 'utility-btn', id: 'seq-undo', title: 'Undo (Ctrl+Z)', onclick: () => undo(false) }, '↶'),
        el('button', { class: 'utility-btn', id: 'seq-redo', title: 'Redo (Ctrl+Y)', onclick: () => undo(true) }, '↷')),
      el('div', { class: 'seq-top seq-settings' },
        num('seq-tempo', 'Tempo', 30, 300, 'Beats per minute'),
        el('label', { class: 'sb-inline' }, el('span', { text: 'Beats' }), el('select', { id: 'seq-beats', 'aria-label': 'Beats per bar', title: 'Beats in a bar (4 is most music, 3 a waltz)' }, ...[2, 3, 4, 5, 6, 7].map((n) => el('option', { value: String(n), text: `${n}/4` })))),
        el('label', { class: 'sb-inline', title: 'Swing: the offbeats come a little later, for a shuffle or a lazy feel' }, el('span', { text: 'Swing' }), el('input', { type: 'range', id: 'seq-swing', min: '0', max: '50', step: '1', 'aria-label': 'Swing' })),
        el('label', { class: 'sb-inline' }, el('span', { text: 'Key' }), el('select', { id: 'seq-key', 'aria-label': 'Key' }, ...NOTE_NAMES.map((n, i) => el('option', { value: String(i), text: n })))),
        el('select', { id: 'seq-scale', 'aria-label': 'Scale', title: 'The notes that belong to the song: highlighted in the piano roll (and the only ones offered with the scale lock)' },
          ...Object.keys(SCALE_STEPS).map((k) => el('option', { value: k, text: SCALE_LABEL[k] }))),
        num('seq-bars', 'Bars', 1, MAX_BARS, 'How long the song is'),
        num('seq-loopstart', 'Loop', 1, MAX_BARS, 'The loop starts at this bar'),
        num('seq-loopend', 'to', 1, MAX_BARS, 'The loop ends with this bar')),
      el('p', { class: 'pref-hint sb-status', id: 'seq-status', 'aria-live': 'polite' }),
      el('div', { class: 'seq-gridwrap' }, el('div', { class: 'seq-grid', id: 'seq-grid', role: 'grid', 'aria-label': 'Song: which pattern each track plays in each bar' })),
      el('div', { class: 'seq-patternbar', id: 'seq-patternbar' }),
      el('div', { class: 'music-tabs sb-tabs', role: 'tablist' }, ...[['notes', 'Notes'], ['instrument', 'Instrument & effects'], ['song', 'Song & export']].map(([id, label]) =>
        el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', onclick: () => { tab = id; renderPane(); } }, label))),
      el('div', { class: 'sb-pane seq-pane', id: 'seq-pane' }));
    ($('#app') || document.body).append(root);
    $('#seq-volume').addEventListener('input', (e) => setVolume(Number(e.target.value) / 100));
    setVolume(volume);
    setLoopMode(loopMode);
    $('#seq-name').addEventListener('input', (e) => { song.name = e.target.value; changed(); });
    $('#seq-listenlayer').addEventListener('change', (e) => { listenLayer = e.target.value; renderGrid(); stale(); if (!audio.paused) { audio.pause(); playStop(); } });
    $('#seq-template').addEventListener('change', (e) => { const id = e.target.value; e.target.value = ''; if (id) newFrom(id); });
    const bindNum = (id, apply) => $(id).addEventListener('change', (e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) apply(v); renderHeader(); });
    bindNum('#seq-tempo', (v) => { song.tempo = Math.max(30, Math.min(300, v)); changed(); });
    bindNum('#seq-bars', (v) => setBars(Math.max(1, Math.min(MAX_BARS, v))));
    bindNum('#seq-loopstart', (v) => { song.loopStart = Math.max(0, Math.min(song.bars - 1, v - 1)); song.loopEnd = Math.max(song.loopStart + 1, song.loopEnd); changed('grid'); });
    bindNum('#seq-loopend', (v) => { song.loopEnd = Math.max(1, Math.min(song.bars, v)); song.loopStart = Math.min(song.loopStart, song.loopEnd - 1); changed('grid'); });
    $('#seq-beats').addEventListener('change', (e) => setBeats(Number(e.target.value)));
    $('#seq-swing').addEventListener('input', (e) => { song.swing = Number(e.target.value) / 100; changed(); });
    $('#seq-key').addEventListener('change', (e) => { song.key = Number(e.target.value); changed('pane'); });
    $('#seq-scale').addEventListener('change', (e) => { song.scale = e.target.value; changed('pane'); });
    new ResizeObserver(() => { root.classList.toggle('wide', root.clientWidth >= 820); if (roll) sizeRoll(); }).observe(root);
    root.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    const typing = e.target.closest('input[type=text], input[type=number], select, textarea');
    if (e.key === 'Escape' && !typing) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (typing) return;
    const k = e.key.toLowerCase();
    if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); playStop(); }
    else if (k === 'z' && e.ctrlKey) { e.preventDefault(); undo(e.shiftKey); }
    else if (k === 'y' && e.ctrlKey) { e.preventDefault(); undo(true); }
    else if (k === 'l' && !e.ctrlKey && !e.altKey) { e.preventDefault(); setLoopMode(!loopMode); }
    else if (e.target.closest('.seq-cell')) cellKey(e);
  }

  function renderAll() {
    if (!built || !song) return;
    renderHeader();
    renderGrid();
    renderPane();
  }

  function renderTemplates() {
    const s = $('#seq-template');
    if (!s) return;
    s.replaceChildren(el('option', { value: '', text: 'New song from…' }),
      el('optgroup', { label: 'Templates' }, ...lists.templates.map((t) => el('option', { value: t.id, text: t.name, title: t.description }))),
      ...(lists.mine.length ? [el('optgroup', { label: 'My songs' }, ...lists.mine.map((t) => el('option', { value: t.id, text: t.name, title: t.description })))] : []));
  }

  async function newFrom(id) {
    if (history.length && !(await NoorUI.confirm('Start a new song?', 'The song open now is replaced (save it first under Song & export if you want to keep it).', 'Start new'))) return;
    await loadTemplate(id);
  }

  function renderHeader() {
    if (!built || !song) return;
    const set = (id, v) => { const e = $(id); if (e && document.activeElement !== e) e.value = String(v); };
    set('#seq-name', song.name);
    set('#seq-tempo', Math.round(song.tempo));
    set('#seq-beats', song.beatsPerBar);
    set('#seq-swing', Math.round(song.swing * 100));
    $('#seq-swing').title = `Swing ${Math.round(song.swing * 100)}%`;
    set('#seq-key', song.key);
    set('#seq-scale', song.scale);
    set('#seq-bars', song.bars);
    set('#seq-loopstart', song.loopStart + 1);
    set('#seq-loopend', song.loopEnd);
    $('#seq-family').textContent = `${song.family || 'Custom'} · ${NOTE_NAMES[song.key]} ${(SCALE_LABEL[song.scale] || song.scale).split(' (')[0].toLowerCase()} · ${Math.round(song.tempo)} BPM`;
    const lp = $('#seq-listenlayer');
    const layers = song.layers || [];
    if (listenLayer && !layers.some((l) => l.id === listenLayer)) listenLayer = '';
    lp.hidden = !layers.length;
    const want = ['', ...layers.map((l) => l.id)].join('|') + layers.map((l) => l.name).join('|');
    if (lp.dataset.list !== want) { lp.dataset.list = want; lp.replaceChildren(el('option', { value: '', text: '🎧 Whole song' }), ...layers.map((l) => el('option', { value: l.id, text: `🎧 ${l.name}` }))); }
    lp.value = listenLayer;
    $('#seq-undo').disabled = !history.length && lastSnapshot === JSON.stringify(song);
    $('#seq-redo').disabled = !future.length;
  }

  /** Length: the sequences grow with rests or are cut; the loop stays inside. */
  function setBars(n) {
    song.bars = n;
    for (const t of song.tracks) { while (t.sequence.length < n) t.sequence.push(0); t.sequence.length = n; }
    song.loopEnd = Math.max(1, Math.min(n, song.loopEnd));
    song.loopStart = Math.min(song.loopStart, song.loopEnd - 1);
    fixSelection();
    changed('all');
  }

  /** Beats per bar: notes past the new bar's end are dropped (undo brings them back). */
  function setBeats(n) {
    song.beatsPerBar = n;
    const steps = n * 4;
    for (const t of song.tracks) for (const p of t.patterns) p.notes = p.notes.filter((x) => x.step < steps);
    changed('all');
  }

  // ---------------------------------------------------------------- song grid

  function renderGrid() {
    const grid = $('#seq-grid');
    if (!grid || !song) return;
    grid.style.setProperty('--bars', String(song.bars));
    const head = el('div', { class: 'seq-row seq-barsrow', role: 'row' },
      el('div', { class: 'seq-trackhead', role: 'columnheader' }, el('small', { text: 'Bar ▸ click to play from there' })),
      ...Array.from({ length: song.bars }, (_, b) => {
        const inLoop = b >= song.loopStart && b < song.loopEnd;
        return el('button', { class: 'seq-barnum' + (inLoop ? ' in-loop' : '') + (b === playFrom ? ' from' : ''), role: 'columnheader', 'data-barnum': String(b),
          title: `Bar ${b + 1}${inLoop ? ' (in the loop)' : ''}: play from here. Shift+click: make the loop end here; Alt+click: start here.`,
          onclick: (e) => barClick(b, e) }, String(b + 1));
      }));
    const layerName = (id) => ((song.layers || []).find((l) => l.id === id) || {}).name || id;
    const offLayer = (t) => !!listenLayer && (t.inLayers || []).length > 0 && !(t.inLayers || []).includes(listenLayer);
    const rows = song.tracks.map((t, i) => el('div', { class: 'seq-row' + (i === sel.track ? ' selected' : '') + (t.mute ? ' muted' : '') + (offLayer(t) ? ' off-layer' : ''), role: 'row', 'data-track': String(i) },
      el('div', { class: 'seq-trackhead', role: 'rowheader' },
        el('button', { class: 'seq-trackname', title: `${KIND_LABEL[t.kind]}: show its notes and instrument`, onclick: () => select(i, sel.bar) }, `${KIND_ICON[t.kind]} ${t.name}`),
        (t.inLayers || []).length ? el('small', { class: 'seq-layerbadge', title: 'Plays in: ' + t.inLayers.map(layerName).join(', '), text: t.inLayers.map((id) => layerName(id)[0]).join('') }) : null,
        el('button', { class: 'icon-btn seq-ms' + (t.mute ? ' on' : ''), 'aria-pressed': String(!!t.mute), title: 'Mute', 'aria-label': `Mute ${t.name}`, onclick: () => { t.mute = !t.mute; changed('grid'); } }, 'M'),
        el('button', { class: 'icon-btn seq-ms' + (t.solo ? ' on' : ''), 'aria-pressed': String(!!t.solo), title: 'Solo (only the soloed tracks play)', 'aria-label': `Solo ${t.name}`, onclick: () => { t.solo = !t.solo; changed('grid'); } }, 'S')),
      ...t.sequence.map((n, b) => el('button', {
        class: 'seq-cell' + (n ? ' has' : '') + (i === sel.track && b === sel.bar ? ' sel' : '') + (b >= song.loopStart && b < song.loopEnd ? ' in-loop' : ''),
        role: 'gridcell', 'data-bar': String(b), 'data-track': String(i), 'data-pattern': String(n), tabindex: i === sel.track && b === sel.bar ? '0' : '-1',
        style: n ? `--hue:${(n * 47) % 360}` : null,
        title: n ? `Pattern ${n} (wheel or + − to change; 0 or Delete for a rest; N for a new pattern)` : 'A rest (click, then a number, + or N for a new pattern)',
        'aria-label': `${t.name}, bar ${b + 1}: ${n ? 'pattern ' + n : 'rest'}`,
        onclick: () => select(i, b),
        oncontextmenu: (e) => { e.preventDefault(); setCell(i, b, 0); },
        onwheel: (e) => { e.preventDefault(); select(i, b, true); setCell(i, b, Math.max(0, Math.min(t.patterns.length, n + (e.deltaY > 0 ? -1 : 1)))); },
      }, n ? String(n) : ''))));
    const add = el('div', { class: 'seq-row seq-addrow' }, el('div', { class: 'seq-trackhead' },
      el('select', { id: 'seq-addtrack', 'aria-label': 'Add a track', disabled: song.tracks.length >= MAX_TRACKS || undefined, onchange: (e) => { const k = e.target.value; e.target.value = ''; if (k) addTrack(k); } },
        el('option', { value: '', text: song.tracks.length >= MAX_TRACKS ? 'Twelve tracks is the most' : '＋ Add a track…' }),
        ...Object.keys(KIND_LABEL).map((k) => el('option', { value: k, text: `${KIND_ICON[k]} ${KIND_LABEL[k]}` })))));
    const had = grid.contains(document.activeElement) && document.activeElement.getAttribute('title');
    grid.replaceChildren(head, ...rows, add);
    delete grid.dataset.playing;
    keepFocus(grid, had);
    renderPatternBar();
  }

  function barClick(b, e) {
    if (e.shiftKey) { song.loopEnd = b + 1; song.loopStart = Math.min(song.loopStart, b); changed('grid'); return; }
    if (e.altKey) { song.loopStart = b; song.loopEnd = Math.max(song.loopEnd, b + 1); changed('grid'); return; }
    playFrom = b;
    sel.bar = b;
    renderGrid(); renderPane();
    if (!audio.paused && !loopMode) { audio.pause(); playStop(); }
  }

  function select(i, b, quiet) {
    const trackChanged = i !== sel.track;
    sel = { track: i, bar: b };
    if (quiet) return;
    renderGrid();
    if (trackChanged || tab === 'notes') renderPane();
    const cell = $(`#seq-grid .seq-cell[data-track="${i}"][data-bar="${b}"]`);
    if (cell) cell.focus({ preventScroll: true });
  }

  function setCell(i, b, n) {
    const t = song.tracks[i];
    t.sequence[b] = Math.max(0, Math.min(t.patterns.length, n));
    sel = { track: i, bar: b };
    changed('grid');
    renderPane();
    const cell = $(`#seq-grid .seq-cell[data-track="${i}"][data-bar="${b}"]`);
    if (cell) cell.focus({ preventScroll: true });
  }

  /** Keys on a cell: digits pick a pattern, + − step, N a new one, arrows move, Delete a rest. */
  function cellKey(e) {
    const t = track();
    const n = t.sequence[sel.bar];
    const move = (dt, db) => { e.preventDefault(); select(Math.max(0, Math.min(song.tracks.length - 1, sel.track + dt)), Math.max(0, Math.min(song.bars - 1, sel.bar + db))); };
    if (e.key === 'ArrowRight') move(0, 1);
    else if (e.key === 'ArrowLeft') move(0, -1);
    else if (e.key === 'ArrowDown') move(1, 0);
    else if (e.key === 'ArrowUp') move(-1, 0);
    else if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      // Two digits typed quickly make a number above 9.
      const now = Date.now();
      const typed = cellKey.last && now - cellKey.last.at < 700 && cellKey.last.bar === sel.bar && cellKey.last.track === sel.track ? cellKey.last.value * 10 + Number(e.key) : Number(e.key);
      const v = typed <= t.patterns.length ? typed : Number(e.key);
      cellKey.last = { at: now, bar: sel.bar, track: sel.track, value: v };
      if (v <= t.patterns.length) setCell(sel.track, sel.bar, v);
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); setCell(sel.track, sel.bar, Math.min(t.patterns.length, n + 1)); }
    else if (e.key === '-') { e.preventDefault(); setCell(sel.track, sel.bar, Math.max(0, n - 1)); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setCell(sel.track, sel.bar, 0); }
    else if (e.key.toLowerCase() === 'n' && !e.ctrlKey) { e.preventDefault(); newPattern(false); }
  }

  const currentPattern = () => { const t = track(); return t ? t.sequence[sel.bar] || 0 : 0; };

  function renderPatternBar() {
    const bar = $('#seq-patternbar');
    const t = track();
    if (!bar) return;
    if (!t) { bar.replaceChildren(); return; }
    const n = t.sequence[sel.bar];
    const used = n ? t.sequence.map((x, b) => (x === n ? b + 1 : 0)).filter(Boolean) : [];
    const pick = el('select', { id: 'seq-patternpick', 'aria-label': 'Pattern in this bar' },
      el('option', { value: '0', text: 'Rest (nothing)' }), ...t.patterns.map((_, k) => el('option', { value: String(k + 1), text: `Pattern ${k + 1}${t.patterns[k].notes.length ? '' : ' (empty)'}` })));
    pick.value = String(n);
    pick.addEventListener('change', () => setCell(sel.track, sel.bar, Number(pick.value)));
    bar.replaceChildren(
      el('strong', { text: `${KIND_ICON[t.kind]} ${t.name} · bar ${sel.bar + 1}` }),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Plays' }), pick),
      el('button', { class: 'utility-btn', id: 'seq-newpattern', title: 'A new empty pattern in this bar (N)', disabled: t.patterns.length >= MAX_PATTERNS || undefined, onclick: () => newPattern(false) }, '＋ New pattern'),
      el('button', { class: 'utility-btn', id: 'seq-copypattern', title: 'A copy of this pattern as a new number, to change without changing the other bars', disabled: !n || t.patterns.length >= MAX_PATTERNS || undefined, onclick: () => newPattern(true) }, '⧉ Copy as new'),
      el('button', { class: 'utility-btn', id: 'seq-vary', title: 'A variation of this pattern as a new number: the same idea with a few notes changed (the original stays as it is)', disabled: !n || t.patterns.length >= MAX_PATTERNS || undefined, onclick: varyPattern }, '🎲 Variation'),
      el('button', { class: 'utility-btn', id: 'seq-fill', title: 'Play this pattern in every bar of the track that is a rest', disabled: !n || undefined, onclick: () => { t.sequence = t.sequence.map((x) => x || n); changed('grid'); } }, '⇥ Fill rests'),
      el('small', { class: 'pref-hint', text: n ? (used.length > 1 ? `Also plays in bars ${used.filter((b) => b !== sel.bar + 1).join(', ')}: changing it changes them too.` : 'Only in this bar.') : 'This bar is a rest for this track.' }));
  }

  function newPattern(copy) {
    const t = track();
    if (t.patterns.length >= MAX_PATTERNS) return;
    const n = t.sequence[sel.bar];
    t.patterns.push(copy && n ? clone(t.patterns[n - 1]) : { notes: [] });
    t.sequence[sel.bar] = t.patterns.length;
    tab = 'notes';
    changed('all');
  }

  /**
   * Chords for the song: a progression from the key, written into a track (this one or a new one) from the selected
   * bar on, a chord every bar or two, in a style; optionally a bass line playing the chords' roots on its own track.
   */
  function progressionDialog() {
    const prefs = (() => { try { return { progression: 'hopeful', style: 'held', per: 1, into: 'new', bass: true, ...JSON.parse(localStorage.getItem('noormd.seq.progression') || '{}') }; } catch { return { progression: 'hopeful', style: 'held', per: 1, into: 'new', bass: true }; } })();
    NoorUI.modal({ label: 'Chords for the song', width: 560 }, (s, close) => {
      const select = (id, label, options, value) => {
        const e = el('select', { id, 'aria-label': label }, ...options.map(([v, t]) => el('option', { value: String(v), text: t })));
        e.value = String(value);
        return [e, el('label', { class: 'sb-inline seq-dlgrow' }, el('span', { text: label }), e)];
      };
      const minor = NoorSeqHelp.isMinorKey(song.scale);
      const progs = [...NoorSeqHelp.PROGRESSIONS].sort((a, b) => (/minor keys/.test(a.mood) === minor ? -1 : 0) - (/minor keys/.test(b.mood) === minor ? -1 : 0));
      const [prog, progRow] = select('seq-prog', 'Progression', progs.map((p) => [p.id, `${p.name} — ${p.mood}`]), prefs.progression);
      const [style, styleRow] = select('seq-progstyle', 'Played as', [['held', 'Held chords (pads, strings)'], ['beats', 'Struck on each beat (piano, guitar)'], ['offbeat', 'Between the beats (reggae, ska)'], ['arp', 'An arpeggio (up)']], prefs.style);
      const [per, perRow] = select('seq-progper', 'Each chord lasts', [[1, 'one bar'], [2, 'two bars']], prefs.per);
      const melodic = track() && track().kind !== 'drums';
      const [into, intoRow] = select('seq-proginto', 'Into', [['new', 'a new track'], ...(melodic ? [['this', `this track (${track().name})`]] : [])], melodic ? prefs.into : 'new');
      const bass = el('input', { type: 'checkbox', id: 'seq-progbass', checked: prefs.bass || undefined });
      const from = sel.bar;
      const preview = el('p', { class: 'pref-hint', id: 'seq-progpreview' });
      const show = () => {
        const p = NoorSeqHelp.PROGRESSIONS.find((x) => x.id === prog.value);
        preview.textContent = `${p.degrees.map((d) => NoorSeqHelp.chord(song.key, song.scale, d).name).join(' → ')}, from bar ${from + 1} to the end (${song.bars - from} bars), repeating.`;
      };
      [prog, style, per, into].forEach((e) => e.addEventListener('change', show));
      show();
      s.append(NoorUI.head('✨ Chords for the song', close), el('div', { class: 'modal-body' },
        el('p', { class: 'pref-hint', text: `In ${song.key >= 0 ? ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][song.key] : ''} ${song.scale.replace('-', ' ')}: these chords belong to the key, so they fit the melodies the piano roll offers.` }),
        progRow, styleRow, perRow, intoRow,
        el('label', { class: 'sb-inline seq-dlcheck' }, bass, el('span', { text: 'Also a bass line (the chords\' roots, on its own track)' })),
        preview),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => close() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'seq-progok', onclick: () => {
            const choice = { progression: prog.value, style: style.value, per: Number(per.value), into: into.value, bass: bass.checked };
            try { localStorage.setItem('noormd.seq.progression', JSON.stringify(choice)); } catch { /* private storage off */ }
            writeProgression(choice, from);
            close();
          } }, 'Write the chords'))));
    });
  }

  function writeProgression(choice, from) {
    const p = NoorSeqHelp.PROGRESSIONS.find((x) => x.id === choice.progression) || NoorSeqHelp.PROGRESSIONS[0];
    const steps = song.beatsPerBar * 4;
    const room = MAX_TRACKS - song.tracks.length;
    const newTrack = (kind, name, preset) => {
      const base = clone(NEW_TRACK[kind]);
      const taken = new Set(song.tracks.map((x) => x.name));
      let unique = name;
      for (let k = 2; taken.has(unique); k++) unique = `${name} ${k}`;
      const t = { id: '', ...base, name: unique, pan: 0, mute: false, solo: false, effects: [], patterns: [], sequence: Array.from({ length: song.bars }, () => 0) };
      if (preset) NoorSeqHelp.applyPreset(t.instrument, preset);
      song.tracks.push(t);
      return t;
    };
    const target = choice.into === 'this' && track() && track().kind !== 'drums' ? track() : room > 0 ? newTrack('synth', 'Chords', choice.style === 'held' ? 'pad' : choice.style === 'arp' ? 'pluck' : 'piano') : null;
    if (!target) { notice('Twelve tracks is the most: remove one first.'); return; }
    if (choice.style === 'arp') { target.instrument.arp = 'up'; target.instrument.arpRate = 2; }
    // One pattern per chord of the progression (shared where a chord comes back).
    const write = (t, style) => {
      const byDegree = new Map();
      for (let b = from, k = 0; b < song.bars; b++, k++) {
        const degree = p.degrees[Math.floor(k / choice.per) % p.degrees.length];
        if (!byDegree.has(degree)) {
          if (t.patterns.length >= MAX_PATTERNS) break;
          t.patterns.push(NoorSeqHelp.chordBar(NoorSeqHelp.chord(song.key, song.scale, degree), style === 'arp' ? 'held' : style, steps));
          byDegree.set(degree, t.patterns.length);
        }
        t.sequence[b] = byDegree.get(degree);
      }
    };
    write(target, choice.style);
    if (choice.bass && song.tracks.length < MAX_TRACKS) write(newTrack('synth', 'Bass', 'synthbass'), 'bass');
    sel.track = song.tracks.indexOf(target);
    tab = 'notes';
    changed('all');
  }

  function varyPattern() {
    const t = track();
    const n = t.sequence[sel.bar];
    if (!n || t.patterns.length >= MAX_PATTERNS) return;
    t.patterns.push(NoorSeqHelp.vary(t.patterns[n - 1], t.kind, song.key, song.scale, song.beatsPerBar * 4, Math.floor(Math.random() * 2 ** 31)));
    t.sequence[sel.bar] = t.patterns.length;
    tab = 'notes';
    changed('all');
  }

  function addTrack(kind) {
    if (song.tracks.length >= MAX_TRACKS) return;
    const base = clone(NEW_TRACK[kind]);
    const same = song.tracks.filter((t) => t.kind === kind).length;
    song.tracks.push({ id: '', ...base, name: same ? `${base.name} ${same + 1}` : base.name, pan: 0, mute: false, solo: false, effects: [], patterns: [{ notes: [] }], sequence: Array.from({ length: song.bars }, (_, b) => (b === sel.bar ? 1 : 0)) });
    sel.track = song.tracks.length - 1;
    tab = kind === 'sample' ? 'instrument' : 'notes';
    changed('all');
  }

  // ---------------------------------------------------------------- the editor tabs

  function renderPane() {
    const pane = $('#seq-pane');
    if (!pane || !song) return;
    document.querySelectorAll('#seqbench .sb-tabs [role=tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    roll = null;
    renderPatternBar();
    const t = track();
    if (tab === 'song') pane.replaceChildren(...songPane());
    else if (!t) pane.replaceChildren(el('p', { class: 'pref-hint', text: 'Add a track to start.' }));
    else if (tab === 'instrument') pane.replaceChildren(...instrumentPane(t));
    else pane.replaceChildren(...notesPane(t));
    if (roll) { sizeRoll(); scrollRollToNotes(); }
    if (document.activeElement === document.body && isOpen()) $('#seqbench').focus({ preventScroll: true });
  }

  /** A re-drawn part keeps the keyboard inside the bench (Space, Ctrl+Z): the same button again, or the bench. */
  function keepFocus(part, title) {
    if (document.activeElement !== document.body || !isOpen()) return;
    const again = title && [...part.querySelectorAll('button')].find((b) => b.getAttribute('title') === title && b.closest('.seq-row') && b.closest('.seq-row').dataset.track === String(sel.track));
    (again || $('#seqbench')).focus({ preventScroll: true });
  }

  function notesPane(t) {
    const n = t.sequence[sel.bar];
    if (!n) {
      return [el('div', { class: 'seq-empty' },
        el('p', { text: `Bar ${sel.bar + 1} is a rest for ${t.name}.` }),
        el('button', { class: 'action primary', id: 'seq-startpattern', onclick: () => newPattern(false) }, '＋ Write a new pattern here'),
        t.patterns.length ? el('p', { class: 'pref-hint', text: 'Or choose one of the track\'s patterns above (Plays), or click its cell and type its number.' }) : null)];
    }
    const pattern = t.patterns[n - 1];
    const velocity = el('input', { type: 'range', id: 'seq-velocity', min: '5', max: '100', step: '1', value: String(Math.round(newVelocity * 100)), 'aria-label': 'Velocity of new notes' });
    velocity.addEventListener('input', () => { newVelocity = Number(velocity.value) / 100; velocity.title = `${velocity.value}%`; });
    const clear = el('button', { class: 'utility-btn', id: 'seq-clearpattern', title: 'Remove every note of this pattern', disabled: !pattern.notes.length || undefined, onclick: () => { pattern.notes = []; changed('all'); } }, '🧹 Clear');
    if (t.kind === 'drums') {
      const rhythm = el('select', { id: 'seq-rhythm', 'aria-label': 'Fill this pattern with a rhythm' },
        el('option', { value: '', text: '🥁 A rhythm…' }), ...NoorSeqHelp.RHYTHMS.map((r) => el('option', { value: r.id, text: r.name + (r.beats !== song.beatsPerBar ? ` (${r.beats}/4)` : '') })));
      rhythm.addEventListener('change', () => {
        if (!rhythm.value) return;
        pattern.notes = NoorSeqHelp.rhythmBar(rhythm.value, song.beatsPerBar).notes;
        changed('all');
      });
      return [el('div', { class: 'sb-row' }, el('label', { class: 'sb-inline', title: 'How hard new hits are. Shift+click a step for a soft hit.' }, el('span', { text: 'Velocity' }), velocity), clear,
        el('label', { class: 'sb-inline', title: 'Replaces this pattern\'s hits with a common rhythm (Ctrl+Z brings them back)' }, rhythm),
        el('small', { class: 'pref-hint', text: 'Click a step to add or remove a hit; Shift+click for a soft one. Click a drum\'s name to hear it.' })), drumGrid(t, pattern)];
    }
    const lock = el('input', { type: 'checkbox', id: 'seq-lock', checked: scaleLock || undefined });
    lock.addEventListener('change', () => { scaleLock = lock.checked; try { localStorage.setItem('noormd.seq.lock', scaleLock ? 'on' : 'off'); } catch { /* private storage off */ } renderPane(); });
    const len = el('select', { id: 'seq-length', 'aria-label': 'Length of new notes' }, ...[[1, '1/16'], [2, '1/8'], [4, '1/4 (a beat)'], [8, '1/2'], [16, 'a bar']].map(([v, l]) => el('option', { value: String(v), text: l })));
    len.value = String(newLength);
    len.addEventListener('change', () => { newLength = Number(len.value); });
    const canvas = el('canvas', { class: 'seq-roll', id: 'seq-roll', tabindex: '0', role: 'img', 'aria-label': `Piano roll of pattern ${n}: ${pattern.notes.length} notes` });
    roll = { canvas, track: t, pattern, rows: [], rowH: 14, keyW: 46, stepW: 24, playhead: -1, drag: null, cursor: 0 };
    setupRoll(roll);
    const ti = sel.track;
    const chordRow = el('div', { class: 'sb-row seq-chords', id: 'seq-chords' },
      el('span', { class: 'sb-inline', title: 'The chords of the song\'s key: they all sound right together. Click one to put it in the pattern where you last clicked (or at the start), as long as new notes.' }, 'Chords'),
      ...NoorSeqHelp.chords(song.key, song.scale).map((c) => el('button', {
        class: 'utility-btn seq-chord', 'data-degree': String(c.degree), title: `${c.name}: ${c.mood}`,
        onclick: () => {
          const at = roll ? roll.cursor || 0 : 0;
          for (const p of c.notes) if (!pattern.notes.some((x) => x.step === at && x.pitch === p)) pattern.notes.push({ step: at, length: newLength, pitch: p, velocity: newVelocity });
          pattern.notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch);
          if (roll) { roll.cursor = Math.min(song.beatsPerBar * 4 - 1, at + newLength); }
          hear(ti, c.notes, newVelocity);
          changed('grid'); drawRoll();
        },
      }, el('strong', { text: c.numeral }), ' ', el('small', { text: c.name }))),
      el('button', { class: 'utility-btn', id: 'seq-progression', title: 'Write a chord progression across the song, with a mood you choose', onclick: progressionDialog }, '✨ Chords for the song…'));
    return [el('div', { class: 'sb-row' },
      el('label', { class: 'sb-inline', title: 'Only the notes of the key and scale are shown (they always sound right together)' }, lock, el('span', { text: 'Scale lock' })),
      el('label', { class: 'sb-inline' }, el('span', { text: 'New notes' }), len),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Velocity' }), velocity), clear,
      el('small', { class: 'pref-hint', text: 'Click to add a note, drag to lengthen; drag a note to move it, its right end to resize; click or right-click a note to remove it.' })),
    chordRow,
    el('div', { class: 'seq-rollwrap', id: 'seq-rollwrap' }, canvas)];
  }

  function drumGrid(t, pattern) {
    const steps = song.beatsPerBar * 4;
    const ti = song.tracks.indexOf(t);
    const rows = KIT.map((name, row) => el('div', { class: 'seq-drumrow', role: 'row' },
      el('button', { class: 'seq-drumname', title: `Hear the ${name.toLowerCase()}`, onclick: () => hear(ti, row, newVelocity) }, name),
      ...Array.from({ length: steps }, (_, s) => {
        const hit = pattern.notes.find((x) => x.pitch === row && x.step === s);
        return el('button', {
          class: 'seq-step' + (hit ? ' on' : '') + (s % 4 === 0 ? ' beat' : ''), 'data-row': String(row), 'data-step': String(s), 'aria-pressed': String(!!hit),
          'aria-label': `${name}, step ${s + 1}`, style: hit ? `--v:${hit.velocity}` : null,
          onclick: (e) => {
            const at = pattern.notes.findIndex((x) => x.pitch === row && x.step === s);
            if (at >= 0) pattern.notes.splice(at, 1);
            else { const v = e.shiftKey ? 0.45 : newVelocity; pattern.notes.push({ step: s, length: 1, pitch: row, velocity: v }); hear(ti, row, v); }
            pattern.notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch);
            changed('grid');
            const g = $('#seq-drums'); if (g) g.replaceWith(drumGrid(t, pattern));
          },
        });
      })));
    return el('div', { class: 'seq-drums', id: 'seq-drums', role: 'grid', 'aria-label': 'Drum pattern', style: `--steps:${steps}` }, ...rows);
  }

  // ---------------------------------------------------------------- piano roll

  function rollRows() {
    const steps = SCALE_STEPS[song.scale] || SCALE_STEPS.minor;
    const inScale = (p) => steps.includes((((p - song.key) % 12) + 12) % 12);
    const rows = [];
    for (let p = 96; p >= 24; p--) if (!scaleLock || inScale(p)) rows.push(p);
    // Notes outside the scale stay visible (and editable) with the lock on.
    if (scaleLock) for (const x of roll.pattern.notes) if (!rows.includes(x.pitch)) rows.push(x.pitch);
    return rows.sort((a, b) => b - a);
  }

  function sizeRoll() {
    if (!roll) return;
    const wrap = $('#seq-rollwrap');
    if (!wrap) return;
    roll.rows = rollRows();
    const steps = song.beatsPerBar * 4;
    roll.stepW = Math.max(16, Math.floor((wrap.clientWidth - roll.keyW - 2) / steps));
    roll.rowH = scaleLock ? 16 : 13;
    const dpr = window.devicePixelRatio || 1;
    const w = roll.keyW + roll.stepW * steps, h = roll.rowH * roll.rows.length;
    roll.canvas.style.width = `${w}px`; roll.canvas.style.height = `${h}px`;
    roll.canvas.width = Math.round(w * dpr); roll.canvas.height = Math.round(h * dpr);
    drawRoll();
  }

  function scrollRollToNotes() {
    const wrap = $('#seq-rollwrap');
    if (!wrap || !roll) return;
    const pitches = roll.pattern.notes.map((x) => x.pitch);
    const centre = pitches.length ? (Math.max(...pitches) + Math.min(...pitches)) / 2 : 60 + song.key;
    let row = roll.rows.findIndex((p) => p <= centre);
    if (row < 0) row = roll.rows.length - 1;
    wrap.scrollTop = Math.max(0, row * roll.rowH - wrap.clientHeight / 2);
  }

  function drawRoll() {
    if (!roll || !roll.canvas.isConnected) return;
    const c = roll.canvas, g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const css = getComputedStyle(document.body);
    const accent = css.getPropertyValue('--accent').trim() || '#7c5cff';
    const text = css.getPropertyValue('--text').trim() || '#ddd';
    const border = css.getPropertyValue('--border').trim() || '#444';
    const steps = song.beatsPerBar * 4;
    const scale = SCALE_STEPS[song.scale] || SCALE_STEPS.minor;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const { rowH, keyW, stepW, rows } = roll;
    rows.forEach((p, r) => {
      const deg = (((p - song.key) % 12) + 12) % 12;
      const y = r * rowH;
      const black = [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
      g.fillStyle = deg === 0 ? 'rgba(124,92,255,0.16)' : scale.includes(deg) ? 'rgba(127,127,127,0.10)' : 'rgba(0,0,0,0.12)';
      g.fillRect(keyW, y, stepW * steps, rowH);
      g.fillStyle = black ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)';
      g.fillRect(0, y, keyW - 2, rowH - 1);
      g.fillStyle = black ? '#eee' : '#222';
      g.font = `${Math.min(11, rowH - 3)}px system-ui, sans-serif`;
      g.textBaseline = 'middle';
      if (deg === 0 || scaleLock || p % 12 === 0) g.fillText(noteName(p), 4, y + rowH / 2);
      g.fillStyle = border; g.globalAlpha = 0.35; g.fillRect(keyW, y + rowH - 1, stepW * steps, 1); g.globalAlpha = 1;
    });
    for (let s = 0; s <= steps; s++) {
      g.fillStyle = border;
      g.globalAlpha = s % 4 === 0 ? 0.9 : 0.3;
      g.fillRect(keyW + s * stepW - (s === steps ? 1 : 0), 0, 1, rows.length * rowH);
    }
    g.globalAlpha = 1;
    for (const x of roll.pattern.notes) {
      const r = rows.indexOf(x.pitch);
      if (r < 0) continue;
      const y = r * rowH;
      const w = Math.min(x.length, steps - x.step) * stepW;
      g.fillStyle = accent;
      g.globalAlpha = 0.45 + 0.55 * x.velocity;
      g.fillRect(keyW + x.step * stepW + 1, y + 1, w - 2, rowH - 2);
      g.globalAlpha = 1;
      g.fillStyle = text;
      g.fillRect(keyW + x.step * stepW + w - 4, y + 3, 2, rowH - 6);
      // Rings on past the bar's end (it carries into the next bar).
      if (x.step + x.length > steps) { g.fillStyle = accent; g.fillText('›', keyW + steps * stepW - 8, y + rowH / 2); }
    }
    if (roll.playhead >= 0) { g.fillStyle = text; g.fillRect(keyW + roll.playhead * stepW, 0, 2, rows.length * rowH); }
  }

  function setupRoll(r) {
    const at = (e) => {
      const b = r.canvas.getBoundingClientRect();
      const x = e.clientX - b.left, y = e.clientY - b.top;
      return { x, step: Math.floor((x - r.keyW) / r.stepW), pitch: r.rows[Math.floor(y / r.rowH)], inKeys: x < r.keyW };
    };
    const steps = () => song.beatsPerBar * 4;
    const hit = (pos) => r.pattern.notes.find((n) => n.pitch === pos.pitch && pos.step >= n.step && pos.step < n.step + n.length);
    const ti = () => song.tracks.indexOf(r.track);
    r.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const n = hit(at(e));
      if (n) { r.pattern.notes.splice(r.pattern.notes.indexOf(n), 1); changed('grid'); drawRoll(); }
    });
    r.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const pos = at(e);
      if (pos.pitch == null) return;
      if (pos.inKeys) { hear(ti(), pos.pitch, newVelocity); return; }
      if (pos.step < 0 || pos.step >= steps()) return;
      e.preventDefault();
      const n = hit(pos);
      if (n) {
        const endX = r.keyW + (n.step + n.length) * r.stepW;
        r.drag = { note: n, mode: pos.x > endX - 7 ? 'resize' : 'move', from: pos, start: { step: n.step, pitch: n.pitch, length: n.length }, moved: false };
      } else {
        r.cursor = pos.step;
        const note = { step: pos.step, length: Math.min(newLength, steps() * 8), pitch: pos.pitch, velocity: newVelocity };
        r.pattern.notes.push(note);
        r.drag = { note, mode: 'resize', from: pos, start: { step: note.step, pitch: note.pitch, length: note.length }, moved: true, fresh: true };
        hear(ti(), note.pitch, note.velocity);
        drawRoll();
      }
      const move = (ev) => {
        const p = at(ev);
        const d = r.drag;
        if (!d) return;
        if (d.mode === 'resize') {
          const len = Math.max(1, p.step - d.note.step + 1);
          if (len !== d.note.length && (len !== d.start.length || d.moved)) { d.note.length = Math.min(len, steps() * 8); d.moved = true; }
        } else {
          const ds = p.step - d.from.step;
          const rowFrom = r.rows.indexOf(d.from.pitch), rowNow = r.rows.indexOf(p.pitch ?? d.from.pitch);
          const pitch = r.rows[Math.max(0, Math.min(r.rows.length - 1, r.rows.indexOf(d.start.pitch) + (rowNow - rowFrom)))];
          const step = Math.max(0, Math.min(steps() - 1, d.start.step + ds));
          if (step !== d.note.step || pitch !== d.note.pitch) {
            d.moved = true;
            if (pitch !== d.note.pitch) hear(ti(), pitch, d.note.velocity);
            d.note.step = step; d.note.pitch = pitch;
          }
        }
        drawRoll();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        const d = r.drag;
        r.drag = null;
        if (!d) return;
        // A click on a note (no drag) removes it.
        if (!d.moved && !d.fresh) r.pattern.notes.splice(r.pattern.notes.indexOf(d.note), 1);
        else if (d.mode === 'resize') newLength = Math.min(16, d.note.length);
        r.pattern.notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch);
        changed('grid');
        drawRoll();
        const l = $('#seq-length'); if (l && [...l.options].some((o) => o.value === String(newLength))) l.value = String(newLength);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    r.canvas.addEventListener('mousemove', (e) => {
      if (r.drag) return;
      const pos = at(e);
      const n = pos.pitch != null ? hit(pos) : null;
      r.canvas.style.cursor = pos.inKeys ? 'pointer' : n && pos.x > r.keyW + (n.step + n.length) * r.stepW - 7 ? 'ew-resize' : n ? 'move' : 'crosshair';
      r.canvas.title = pos.pitch != null ? noteName(pos.pitch) + (n ? ` · ${n.length}/16 · velocity ${Math.round(n.velocity * 100)}%` : '') : '';
    });
  }

  // ---------------------------------------------------------------- instrument & effects

  const UNIT = { db: ['dB', 1], pct: ['%', 100], hz: ['Hz', 1], ms: ['ms', 1], s: ['s', 1], pan: ['', 1], rate: ['Hz', 1], num: ['', 1], cents: ['cents', 1], x: ['×', 1], q: ['', 1], count: ['', 1], sl: ['s', 1] };

  /** A slider bound to obj[key] with an exact number box (Hz, times and speeds logarithmic on the slider). */
  function slider(obj, [key, label, min, max, step, kind], after) {
    const log = (kind === 'hz' || kind === 'ms' || kind === 'rate' || kind === 's' || kind === 'q' || kind === 'x' || kind === 'sl') && min > 0;
    const toPos = (v) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
    const fromPos = (p) => (log ? min * Math.pow(max / min, p / 1000) : p);
    const [unit, factor] = UNIT[kind] || ['', 1];
    const clamp = (v) => Math.max(min, Math.min(max, v));
    const value = Number(obj[key]) || 0;
    const shown = (v) => String(Number((v * factor).toFixed(log ? 3 : 2)));
    const box = el('input', { type: 'number', class: 'sb-num', value: shown(value), step: 'any', 'aria-label': `${label} (${unit || 'value'})`, 'data-num': key });
    const input = el('input', { type: 'range', min: String(log ? 0 : min), max: String(log ? 1000 : max), step: String(log ? 1 : step), value: String(toPos(log ? clamp(value) || min : clamp(value))), 'aria-label': label, 'data-key': key });
    input.addEventListener('input', () => {
      let v = fromPos(Number(input.value));
      if (!log) v = Math.round(v / step) * step;
      obj[key] = Number(v.toFixed(4));
      box.value = shown(obj[key]);
      changed(); if (after) after();
    });
    box.addEventListener('change', () => {
      const typed = Number(box.value);
      if (!Number.isFinite(typed)) { box.value = shown(obj[key]); return; }
      obj[key] = Number(clamp(typed / factor).toFixed(6));
      box.value = shown(obj[key]);
      input.value = String(toPos(obj[key]));
      changed(); if (after) after();
    });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.dispatchEvent(new Event('change')); } });
    return el('label', { class: 'sb-slider' }, el('span', { text: label }), input, el('span', { class: 'sb-numwrap' }, box, unit ? el('small', { text: unit }) : null));
  }

  function instrumentPane(t) {
    const ins = t.instrument;
    const i = sel.track;
    const name = el('input', { type: 'text', id: 'seq-trackname', value: t.name, maxlength: '40', spellcheck: 'false', 'aria-label': 'Track name' });
    name.addEventListener('input', () => { t.name = name.value; changed(); const b = $(`#seq-grid .seq-row[data-track="${i}"] .seq-trackname`); if (b) b.textContent = `${KIND_ICON[t.kind]} ${t.name}`; });
    const move = (d) => { const j = i + d; if (j < 0 || j >= song.tracks.length) return; [song.tracks[i], song.tracks[j]] = [song.tracks[j], song.tracks[i]]; sel.track = j; changed('all'); };
    const out = [
      el('div', { class: 'sb-row' },
        el('label', { class: 'sb-inline' }, el('span', { text: KIND_ICON[t.kind] + ' ' + KIND_LABEL[t.kind] }), name),
        el('button', { class: 'utility-btn', title: 'Hear a note of this track', onclick: () => hear(i, t.kind === 'drums' ? 0 : 60 + song.key, newVelocity) }, '🔈 Hear'),
        el('button', { class: 'icon-btn', title: 'Move the track up', 'aria-label': 'Move up', disabled: i === 0 || undefined, onclick: () => move(-1) }, '↑'),
        el('button', { class: 'icon-btn', title: 'Move the track down', 'aria-label': 'Move down', disabled: i === song.tracks.length - 1 || undefined, onclick: () => move(1) }, '↓'),
        el('button', { class: 'utility-btn', id: 'seq-duptrack', title: 'A copy of this track (its patterns, instrument and effects)', disabled: song.tracks.length >= MAX_TRACKS || undefined,
          onclick: () => { const c = clone(t); c.id = ''; c.name = `${t.name} copy`.slice(0, 40); song.tracks.splice(i + 1, 0, c); sel.track = i + 1; changed('all'); } }, '⧉ Duplicate'),
        el('button', { class: 'utility-btn', id: 'seq-removetrack', title: 'Remove this track (Ctrl+Z brings it back)', onclick: () => { song.tracks.splice(i, 1); fixSelection(); changed('all'); } }, '✕ Remove')),
      el('div', { class: 'sb-fields' }, slider(t, ['gain', 'Level', -60, 12, 0.5, 'db']), slider(t, ['pan', 'Pan (left ↔ right)', -1, 1, 0.05, 'pan'])),
    ];
    if (t.kind === 'synth') {
      const wave = el('select', { id: 'seq-wave', 'aria-label': 'Waveform' }, ...WAVES.map(([v, l]) => el('option', { value: v, text: l })));
      wave.value = ins.wave;
      wave.addEventListener('change', () => { ins.wave = wave.value; changed('pane'); hear(i, 60 + song.key); });
      const preset = el('select', { id: 'seq-preset', 'aria-label': 'Instrument preset' },
        el('option', { value: '', text: '★ A preset…' }), ...NoorSeqHelp.PRESETS.map((p) => el('option', { value: p.id, text: p.name })));
      preset.addEventListener('change', () => {
        if (!NoorSeqHelp.applyPreset(ins, preset.value)) return;
        changed('pane');
        hear(i, NoorSeqHelp.PRESETS.find((p) => p.id === preset.value).ins.octave < 0 ? 48 + song.key : 60 + song.key);
      });
      const lfo = el('select', { id: 'seq-lfo', 'aria-label': 'LFO moves' }, ...[['off', 'Nothing'], ['pitch', 'Pitch (vibrato, sirens)'], ['filter', 'Filter (wah, wobble)'], ['volume', 'Volume (tremolo)']].map(([v, t]) => el('option', { value: v, text: t })));
      lfo.value = ins.lfo || 'off';
      lfo.addEventListener('change', () => { ins.lfo = lfo.value; changed('pane'); });
      out.push(el('h4', { class: 'music-subhead', text: 'Sound' }), el('div', { class: 'sb-row' }, el('label', { class: 'sb-inline' }, el('span', { text: 'Wave' }), wave), preset),
        el('div', { class: 'sb-fields' }, ...(ins.wave === 'pulse' ? [slider(ins, ['pulseWidth', 'Pulse width', 0.05, 0.5, 0.01, 'pct'])] : []), ...SYNTH.map((f) => slider(ins, f))),
        el('h4', { class: 'music-subhead', text: 'Movement' }),
        el('div', { class: 'sb-row' }, el('label', { class: 'sb-inline', title: 'A slow wave that moves part of the sound, in time with the song' }, el('span', { text: 'LFO moves' }), lfo)),
        el('div', { class: 'sb-fields' }, ...(ins.lfo && ins.lfo !== 'off' ? [slider(ins, ['lfoRate', 'LFO speed', 0.05, 20, 0.01, 'rate']), slider(ins, ['lfoDepth', 'LFO depth', 0, 1, 0.01, 'pct'])] : []),
          ...(ins.wave === 'sine' ? [slider(ins, ['fmDepth', 'FM depth (bells, electric piano; 0 = off)', 0, 10, 0.05, 'num']), slider(ins, ['fmRatio', 'FM ratio (whole numbers sound musical)', 0.25, 16, 0.25, 'num'])] : [])));
    } else if (t.kind === 'drums') {
      out.push(el('h4', { class: 'music-subhead', text: 'Kit' }), el('div', { class: 'sb-fields' }, ...DRUMS.map((f) => slider(ins, f))));
    } else {
      const root = el('input', { type: 'number', id: 'seq-rootnote', min: '0', max: '127', step: '1', value: String(ins.rootNote ?? 60), class: 'seq-num', 'aria-label': 'The pitch the sample was recorded at (MIDI note)' });
      const rootName = el('small', { text: noteName(ins.rootNote ?? 60) });
      root.addEventListener('change', () => { ins.rootNote = Math.max(0, Math.min(127, Math.round(Number(root.value) || 60))); root.value = String(ins.rootNote); rootName.textContent = noteName(ins.rootNote); changed(); });
      const loop = el('input', { type: 'checkbox', id: 'seq-sampleloop', checked: ins.loop || undefined });
      loop.addEventListener('change', () => { ins.loop = loop.checked; changed(); });
      out.push(el('h4', { class: 'music-subhead', text: 'Sample' }),
        el('div', { class: 'sb-row' },
          el('span', { class: 'sb-file', id: 'seq-samplename', title: ins.path || '', text: '🎙 ' + (ins.sampleName || 'no sound chosen yet') }),
          el('button', { class: 'utility-btn', id: 'seq-pick', onclick: pickSample }, ins.path ? 'Choose another…' : 'Choose a WAV…'),
          el('button', { class: 'utility-btn', id: 'seq-fromsound', title: 'A sound from the Sound Bench (a preset or one of yours), rendered as this instrument', onclick: () => sampleFromBench('sound') }, '🔊 From the Sound Bench…'),
          el('button', { class: 'utility-btn', id: 'seq-fromlibrary', title: 'A WAV file from your Music Bench library', onclick: () => sampleFromBench('library') }, '♫ From the Music Bench…'),
          el('label', { class: 'sb-inline', title: 'The note the sample sounds as played as is: other notes play it faster or slower' }, el('span', { text: 'Recorded as' }), root, rootName),
          el('label', { class: 'sb-inline', title: 'Loop the sample for as long as the note is held (for pads and drones)' }, loop, el('span', { text: 'Loop while held' }))),
        el('div', { class: 'sb-fields' }, ...SAMPLE.map((f) => slider(ins, f))));
    }
    if (t.kind !== 'drums') {
      const arp = el('select', { id: 'seq-arp', 'aria-label': 'Arpeggiator' }, ...[['off', 'Off'], ['up', 'Up'], ['down', 'Down'], ['updown', 'Up and down'], ['random', 'Random'], ['chord', 'Chord, again and again']].map(([v, tx]) => el('option', { value: v, text: tx })));
      arp.value = ins.arp || 'off';
      arp.addEventListener('change', () => { ins.arp = arp.value; changed('pane'); });
      const rate = el('select', { id: 'seq-arprate', 'aria-label': 'Arpeggio speed' }, ...[[1, '1/16'], [2, '1/8'], [4, '1/4']].map(([v, tx]) => el('option', { value: String(v), text: tx })));
      rate.value = String(ins.arpRate || 2);
      rate.addEventListener('change', () => { ins.arpRate = Number(rate.value); changed(); });
      const octs = el('select', { id: 'seq-arpoct', 'aria-label': 'Arpeggio octaves' }, ...[1, 2, 3].map((v) => el('option', { value: String(v), text: `${v} octave${v > 1 ? 's' : ''}` })));
      octs.value = String(ins.arpOctaves || 1);
      octs.addEventListener('change', () => { ins.arpOctaves = Number(octs.value); changed(); });
      out.push(el('div', { class: 'sb-row' },
        el('label', { class: 'sb-inline', title: 'Notes held together are played one after another: write a chord, hear an arpeggio' }, el('span', { text: 'Arpeggiator' }), arp),
        ...(ins.arp && ins.arp !== 'off' ? [el('label', { class: 'sb-inline' }, el('span', { text: 'Speed' }), rate), octs] : [])));
    }
    out.push(el('div', { class: 'sb-fields' }, slider(t, ['humanize', 'Humanize (a little early or late, softer or harder, as a person plays)', 0, 1, 0.01, 'pct'])),
      el('h4', { class: 'music-subhead', text: 'Over the song' }),
      automationLane(t, 'gainAutomation', 'Level', -48, 12, 'dB'),
      ...(t.kind === 'synth' ? [automationLane(t, 'filterAutomation', 'Filter', -6, 6, 'oct')] : []));
    out.push(el('h4', { class: 'music-subhead', text: 'Effects on this track' }), effectsRack(t.effects ||= [], 'track'));
    return out;
  }

  /**
   * An automation lane across the song's bars: click to add a point, drag it, right-click (or double-click) to
   * remove it. Between points the value moves in a straight line; no points means no change.
   */
  function automationLane(t, key, label, min, max, unit) {
    const points = (t[key] ||= []);
    const c = el('canvas', { class: 'seq-lane', 'data-lane': key, tabindex: '0', role: 'img', 'aria-label': `${label} over the song: ${points.length} points` });
    const H = 64;
    const geo = () => { const w = c.clientWidth || 600; return { w, x: (bar) => 8 + (bar / song.bars) * (w - 16), bar: (x) => Math.max(0, Math.min(song.bars, ((x - 8) / (w - 16)) * song.bars)), y: (v) => 6 + (1 - (v - min) / (max - min)) * (H - 12), v: (y) => Math.max(min, Math.min(max, min + (1 - (y - 6) / (H - 12)) * (max - min))) }; };
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const { w, x, y } = geo();
      c.width = Math.round(w * dpr); c.height = Math.round(H * dpr); c.style.height = `${H}px`;
      const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(document.body);
      const accent = css.getPropertyValue('--accent').trim() || '#7c5cff', muted = css.getPropertyValue('--muted').trim() || '#888';
      g.clearRect(0, 0, w, H);
      g.fillStyle = muted; g.globalAlpha = 0.25;
      for (let b = 0; b <= song.bars; b++) g.fillRect(Math.round(x(b)), 0, 1, H);
      g.fillRect(0, Math.round(y(0)), w, 1);
      g.globalAlpha = 1;
      g.fillStyle = muted; g.font = '10px system-ui, sans-serif'; g.fillText(`${label}${points.length ? '' : ' — no change (click to add a point)'}`, 12, 14);
      if (!points.length) return;
      g.strokeStyle = accent; g.lineWidth = 2; g.beginPath();
      g.moveTo(x(0), y(points[0].value));
      points.forEach((p) => g.lineTo(x(p.bar), y(p.value)));
      g.lineTo(x(song.bars), y(points[points.length - 1].value));
      g.stroke();
      g.fillStyle = accent;
      points.forEach((p) => { g.beginPath(); g.arc(x(p.bar), y(p.value), 4, 0, Math.PI * 2); g.fill(); });
    };
    const near = (e) => { const r = c.getBoundingClientRect(); const { x, y } = geo(); const mx = e.clientX - r.left, my = e.clientY - r.top; return points.findIndex((p) => Math.hypot(x(p.bar) - mx, y(p.value) - my) < 8); };
    const sortPoints = () => points.sort((a, b) => a.bar - b.bar);
    const remove = (e) => { e.preventDefault(); const k = near(e); if (k >= 0) { points.splice(k, 1); changed(); draw(); } };
    c.addEventListener('contextmenu', remove);
    c.addEventListener('dblclick', remove);
    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const r = c.getBoundingClientRect();
      let k = near(e);
      if (k < 0) {
        const { bar, v } = geo();
        points.push({ bar: Math.round(bar(e.clientX - r.left) * 4) / 4, value: Math.round(v(e.clientY - r.top) * 2) / 2 });
        sortPoints(); k = points.findIndex((p) => p.bar === Math.round(geo().bar(e.clientX - r.left) * 4) / 4);
        changed(); draw();
      }
      const p = points[k];
      const move = (ev) => { const { bar, v } = geo(); p.bar = Math.round(bar(ev.clientX - r.left) * 4) / 4; p.value = Math.round(v(ev.clientY - r.top) * 2) / 2; sortPoints(); c.title = `bar ${(p.bar + 1).toFixed(2)}: ${p.value} ${unit}`; draw(); };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); changed(); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
    requestAnimationFrame(draw);
    return el('div', { class: 'seq-lanewrap' }, c,
      el('button', { class: 'icon-btn', title: `No ${label.toLowerCase()} changes over the song`, 'aria-label': `Clear the ${label.toLowerCase()} lane`, disabled: !points.length || undefined, onclick: () => { points.length = 0; changed('pane'); } }, '✕'));
  }

  async function pickSample() {
    try {
      const f = await req('seq.sample.pick');
      if (!f || f.cancelled) return;
      const ins = track().instrument;
      ins.path = f.path; ins.sampleName = f.name;
      changed('pane');
    } catch (err) { hooks.showError(err); }
  }

  /** A sample from another bench: a Sound Bench sound (rendered) or a WAV in the Music Bench's library. */
  function sampleFromBench(source) {
    NoorUI.modal({ label: source === 'sound' ? 'A sound from the Sound Bench' : 'A WAV from the Music Bench', width: 560 }, (s, close) => {
      const list = el('div', { class: 'seq-picklist', id: 'seq-picklist' }, el('p', { class: 'pref-hint', text: 'Loading…' }));
      const choose = async (payload, type) => {
        try {
          const f = await req(type, payload);
          const ins = track().instrument;
          ins.path = f.path; ins.sampleName = f.name;
          close();
          changed('pane');
          hear(sel.track, ins.rootNote ?? 60, newVelocity);
        } catch (err) { hooks.showError(err); }
      };
      const search = el('input', { type: 'search', id: 'seq-picksearch', placeholder: 'Search', 'aria-label': 'Search', hidden: source === 'sound' || undefined });
      const fill = async () => {
        try {
          if (source === 'sound') {
            const p = await req('sound.presets');
            const items = [...p.mine.map((x) => ({ ...x, family: 'Mine' })), ...p.builtIn];
            list.replaceChildren(...items.map((x) => el('button', { class: 'utility-btn seq-pick', 'data-id': x.id, title: x.description || '', onclick: () => choose({ id: x.id }, 'seq.sample.fromSound') }, `${x.family} · ${x.name}`)));
          } else {
            const r = await req('seq.sample.library', { search: search.value });
            list.replaceChildren(...(r.tracks.length ? r.tracks.map((x) => el('button', { class: 'utility-btn seq-pick', 'data-id': String(x.id), onclick: () => choose({ id: x.id }, 'seq.sample.fromLibrary') }, `${x.title}${x.artist ? ' — ' + x.artist : ''} (${x.seconds} s)`))
              : [el('p', { class: 'pref-hint', text: 'No WAV files in the Music Bench’s library' + (search.value ? ' match.' : ' (only WAV files can be played as an instrument).') })]));
          }
        } catch (err) { list.replaceChildren(el('p', { class: 'pref-hint', text: err && err.message ? err.message : String(err) })); }
      };
      let t = 0;
      search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(fill, 200); });
      s.append(NoorUI.head(source === 'sound' ? '🔊 A sound from the Sound Bench' : '♫ A WAV from the Music Bench', close), el('div', { class: 'modal-body' }, search, list));
      fill();
    });
  }

  /** An effects chain with the Sound Bench's effects (built-in spaces only for convolution here). */
  function effectsRack(chain, where) {
    const F = NoorSound.fx;
    const cards = chain.map((fx, i) => {
      const choices = (F.FX_CHOICES[fx.type] || []).map(([key, label, opts]) => {
        const pairs = opts.map((o) => (Array.isArray(o) ? o : [o, o])).filter(([v]) => v !== 'file' || fx[key] === 'file');
        const s = el('select', { 'aria-label': label, 'data-fx': key }, ...pairs.map(([v, tx]) => el('option', { value: v, text: tx })));
        s.value = fx[key] || pairs[0][0];
        s.addEventListener('change', () => { fx[key] = s.value; changed(); });
        return el('label', { class: 'sb-inline' }, el('span', { text: label }), s);
      });
      const checks = (F.FX_CHECKS[fx.type] || []).map(([key, label]) => {
        const c = el('input', { type: 'checkbox', checked: fx[key] || undefined, 'data-fx': key });
        c.addEventListener('change', () => { fx[key] = c.checked; changed(); });
        return el('label', { class: 'sb-inline' }, c, el('span', { text: label }));
      });
      const moveFx = (d) => { const j = i + d; if (j < 0 || j >= chain.length) return; [chain[i], chain[j]] = [chain[j], chain[i]]; changed('pane'); };
      return el('div', { class: 'sb-fx' + (fx.bypass ? ' off' : ''), 'data-fx-index': String(i), 'data-fx-type': fx.type },
        el('div', { class: 'sb-fx-head' },
          el('button', { class: 'icon-btn sb-ms' + (fx.bypass ? '' : ' on'), title: fx.bypass ? 'Off (click to switch it on)' : 'On (click to bypass)', 'aria-pressed': String(!fx.bypass), 'aria-label': 'On', onclick: () => { fx.bypass = !fx.bypass; changed('pane'); } }, '⏻'),
          el('strong', { text: F.FX_LABEL[fx.type] || fx.type }),
          el('span', { class: 'sb-fx-space' }),
          el('button', { class: 'icon-btn', title: 'Earlier in the chain', 'aria-label': 'Move up', disabled: i === 0 || undefined, onclick: () => moveFx(-1) }, '↑'),
          el('button', { class: 'icon-btn', title: 'Later in the chain', 'aria-label': 'Move down', disabled: i === chain.length - 1 || undefined, onclick: () => moveFx(1) }, '↓'),
          el('button', { class: 'icon-btn', title: 'Remove this effect', 'aria-label': 'Remove this effect', onclick: () => { chain.splice(i, 1); changed('pane'); } }, '✕')),
        ...(choices.length || checks.length ? [el('div', { class: 'sb-choices' }, ...choices, ...checks)] : []),
        el('div', { class: 'sb-fields' }, ...(F.FX_FIELDS[fx.type] || []).map((f) => slider(fx, f)),
          slider(fx, ['mix', 'Mix (dry ↔ wet)', 0, 1, 0.01, 'pct']), slider(fx, ['out', 'Output', -40, 24, 0.5, 'db'])));
    });
    const add = el('select', { class: 'sb-addfx', 'aria-label': 'Add an effect', 'data-addfx': where },
      el('option', { value: '', text: chain.length >= 8 ? 'Eight effects is the most' : '＋ Add an effect…' }), ...(chain.length >= 8 ? [] : Object.keys(F.FX_LABEL).map((k) => el('option', { value: k, text: F.FX_LABEL[k] }))));
    add.addEventListener('change', () => {
      const k = add.value;
      if (!k) return;
      chain.push({ type: k, bypass: false, mix: 1, out: 0, ...clone(F.NEW_FX[k]) });
      changed('pane');
    });
    return el('div', { class: 'sb-rack', 'data-rack': where }, ...cards, add);
  }

  // ---------------------------------------------------------------- song & export

  const EXPORT_DEFAULTS = { sampleRate: 48000, bits: 16, mix: true, loop: true, layers: true, stems: false, midi: false, format: 'wav', oggQuality: 0.5, vault: false, musicBench: false };
  function exportPrefs() { try { return { ...EXPORT_DEFAULTS, ...JSON.parse(localStorage.getItem('noormd.seq.export') || '{}') }; } catch { return { ...EXPORT_DEFAULTS }; } }
  function saveExportPrefs(p) { try { localStorage.setItem('noormd.seq.export', JSON.stringify(p)); } catch { /* private storage off */ } }

  function songPane() {
    const prefs = exportPrefs();
    const sel2 = (id, label, options, value, key) => {
      const s = el('select', { id, 'aria-label': label }, ...options.map(([v, tx]) => el('option', { value: String(v), text: tx })));
      s.value = String(value);
      s.addEventListener('change', () => { saveExportPrefs({ ...exportPrefs(), [key]: Number.isFinite(Number(s.value)) ? Number(s.value) : s.value }); where.refresh(); if (key === 'format') renderPane(); });
      return el('label', { class: 'sb-inline' }, el('span', { text: label }), s);
    };
    const part = (key, label, title) => {
      const c = el('input', { type: 'checkbox', id: `seq-part-${key}`, checked: prefs[key] || undefined });
      c.addEventListener('change', () => { saveExportPrefs({ ...exportPrefs(), [key]: c.checked }); where.refresh(); });
      return el('label', { class: 'sb-inline', title }, c, el('span', { text: label }));
    };
    const hasLayers = (song.layers || []).length > 0;
    const parts = () => { const p = exportPrefs(); return { mix: !!p.mix, loop: !!p.loop, layers: !!p.layers && hasLayers, stems: !!p.stems, midi: !!p.midi }; };
    const fmtName = { wav: 'WAV', ogg: 'OGG', both: 'WAV + OGG' }[prefs.format] || 'WAV';
    const vault = el('input', { type: 'checkbox', id: 'seq-vault', checked: prefs.vault || undefined });
    vault.addEventListener('change', () => saveExportPrefs({ ...exportPrefs(), vault: vault.checked }));
    const musicBench = el('input', { type: 'checkbox', id: 'seq-musicbench', checked: prefs.musicBench || undefined });
    musicBench.addEventListener('change', () => saveExportPrefs({ ...exportPrefs(), musicBench: musicBench.checked }));
    const family = el('input', { type: 'text', id: 'seq-familyname', value: song.family || '', maxlength: '40', spellcheck: 'false', 'aria-label': 'Kind of music (for folders)', placeholder: 'e.g. Exploration' });
    family.addEventListener('input', () => { song.family = family.value; changed(); where.refresh(); });
    const seed = el('input', { type: 'number', id: 'seq-seed', min: '0', max: '2147483647', step: '1', value: String(song.seed ?? 1), class: 'seq-num' });
    seed.addEventListener('change', () => { song.seed = Math.max(0, Math.min(2147483647, Math.round(Number(seed.value) || 0))); changed(); });
    where = NoorExportWhere.panel('music', () => ({ name: song.name, family: song.family || '', parts: parts(), format: exportPrefs().format, layers: (song.layers || []).map((l) => l.name) }), hooks.showError);
    const mine = lists.mine.map((m) => el('div', { class: 'seq-mine' },
      el('button', { class: 'utility-btn', 'data-song': m.id, title: m.description, onclick: () => newFrom(m.id) }, `🎼 ${m.name}`),
      el('small', { text: m.description }),
      el('button', { class: 'icon-btn', title: 'Delete this song from My songs', 'aria-label': `Delete ${m.name}`, onclick: () => deleteSong(m) }, '✕')));
    return [
      el('div', { class: 'sb-row' },
        el('label', { class: 'sb-inline', title: 'Used by layouts that sort music into folders' }, el('span', { text: 'Kind' }), family),
        el('label', { class: 'sb-inline', title: 'The random seed of noise in drums and synths: the same seed gives the same song' }, el('span', { text: 'Seed' }), seed)),
      el('div', { class: 'sb-fields' }, slider(song, ['masterGain', 'Master level', -24, 12, 0.5, 'db'])),
      el('h4', { class: 'music-subhead', text: 'Master effects (on the whole mix)' }),
      effectsRack(song.masterEffects ||= [], 'master'),
      ...layersSection(),
      ...loopSection(),
      el('h4', { class: 'music-subhead', text: 'Export' }),
      el('div', { class: 'sb-row' },
        part('mix', `The song (${fmtName})`, 'The whole song with its last notes ringing out'),
        part('loop', `A seamless loop (${fmtName})`, 'The loop bars, with what rings over the end folded into the start: it repeats without a gap or a click (for game music)'),
        ...(hasLayers ? [part('layers', `Each layer as a loop (${fmtName})`, 'Every adaptive layer as its own seamless loop, all the same length and at one shared level, for a game to crossfade')] : []),
        part('stems', 'Stems', 'Each track on its own in a folder, at the same level as in the mix, so they line up'),
        part('midi', 'MIDI', 'The notes, one track per track, drums on channel 10: to continue in another music program')),
      el('div', { class: 'sb-row' },
        sel2('seq-rate', 'Sample rate', [[48000, '48 kHz'], [44100, '44.1 kHz']], prefs.sampleRate, 'sampleRate'),
        sel2('seq-bits', 'Bits (WAV)', [[16, '16-bit'], [24, '24-bit']], prefs.bits, 'bits'),
        sel2('seq-format', 'Format', [['wav', 'WAV'], ['ogg', 'OGG (smaller, for games)'], ['both', 'WAV and OGG']], prefs.format, 'format'),
        ...(prefs.format !== 'wav' ? [sel2('seq-oggq', 'OGG quality', [[0.3, 'Small (about 110 kbit/s)'], [0.5, 'Good (about 160 kbit/s)'], [0.7, 'High (about 220 kbit/s)'], [0.9, 'Best (about 320 kbit/s)']], prefs.oggQuality, 'oggQuality')] : [])),
      el('div', { class: 'sb-row' },
        el('label', { class: 'sb-inline', title: 'The song (.noorsong.json) and an OGG to listen to, in the Music folder of the Vault that is open: find it, link it from notes, open it again' }, vault, el('span', { text: 'Also keep the song in my Vault' })),
        el('label', { class: 'sb-inline', title: 'The song, loop and layer files in the Music Bench (playlist “Made in NoorMD”), to audition, rate and tag them' }, musicBench, el('span', { text: 'Also add the files to the Music Bench' }))),
      where.node,
      el('div', { class: 'sb-row' },
        el('button', { class: 'action primary', id: 'seq-export', onclick: exportSong }, '⤓ Export…'),
        el('button', { class: 'action', id: 'seq-save', onclick: saveSong }, '★ Save to My songs')),
      el('p', { class: 'pref-hint', id: 'seq-export-status', text: 'The song (.noorsong.json) is saved with the files: open it later (📂) to change it.' }),
      el('h4', { class: 'music-subhead', text: 'My songs' }),
      ...(mine.length ? mine : [el('p', { class: 'pref-hint', text: 'Songs you save appear here (and under New song from…).' })]),
    ];
  }

  /**
   * Adaptive layers: versions of the song for a game to switch between (exploration, danger, combat…), each a choice
   * of the song's tracks, all the same tempo and loop. Tracks with no layer ticked play in every layer.
   */
  function layersSection() {
    const layers = (song.layers ||= []);
    const add = el('button', { class: 'utility-btn', id: 'seq-addlayer', disabled: layers.length >= 4 || undefined, title: 'A new layer (up to four)',
      onclick: () => {
        const names = ['Exploration', 'Danger', 'Combat', 'Victory'];
        const name = names.find((n) => !layers.some((l) => l.name === n)) || `Layer ${layers.length + 1}`;
        let k = 1; while (layers.some((l) => l.id === `L${k}`)) k++;
        layers.push({ id: `L${k}`, name });
        changed('all');
      } }, '＋ Add a layer');
    const out = [el('h4', { class: 'music-subhead', text: 'Adaptive layers (game music that changes with the action)' })];
    if (!layers.length) {
      out.push(el('div', { class: 'sb-row' }, add, el('small', { class: 'pref-hint', text: 'Make versions of the loop for a game to switch between, such as exploration, danger and combat: each plays some of the tracks, all in time. Try the “Adaptive adventure” template.' })));
      return out;
    }
    const head = el('div', { class: 'seq-layerrow seq-layerhead' }, el('span', { text: 'Track plays in →' }),
      ...layers.map((l, k) => {
        const name = el('input', { type: 'text', value: l.name, maxlength: '40', spellcheck: 'false', 'data-layername': l.id, 'aria-label': 'Layer name' });
        name.addEventListener('change', () => { l.name = name.value.trim() || 'Layer'; changed('grid'); renderHeader(); });
        return el('span', { class: 'seq-layercol' }, name,
          el('button', { class: 'icon-btn', title: 'Remove this layer (its tracks stay in the song)', 'aria-label': `Remove the layer ${l.name}`,
            onclick: () => { layers.splice(k, 1); song.tracks.forEach((t) => { t.inLayers = (t.inLayers || []).filter((x) => x !== l.id); }); if (listenLayer === l.id) listenLayer = ''; changed('all'); } }, '✕'));
      }));
    const rows = song.tracks.map((t, i) => el('div', { class: 'seq-layerrow' }, el('span', { text: `${KIND_ICON[t.kind]} ${t.name}`, title: (t.inLayers || []).length ? '' : 'In every layer (nothing ticked)' }),
      ...layers.map((l) => {
        const c = el('input', { type: 'checkbox', 'data-track': String(i), 'data-layer': l.id, checked: (t.inLayers || []).includes(l.id) || undefined, 'aria-label': `${t.name} plays in ${l.name}` });
        c.addEventListener('change', () => { const set = new Set(t.inLayers || []); if (c.checked) set.add(l.id); else set.delete(l.id); t.inLayers = layers.map((x) => x.id).filter((x) => set.has(x)); changed('grid'); });
        return el('span', { class: 'seq-layercol' }, c);
      })));
    const pick = (id, value) => { const s = el('select', { id, 'aria-label': id === 'seq-tfrom' ? 'From layer' : 'To layer' }, ...layers.map((l) => el('option', { value: l.id, text: l.name }))); s.value = value; return s; };
    const from = pick('seq-tfrom', layers[0].id), to = pick('seq-tto', (layers[1] || layers[0]).id);
    const fade = el('select', { id: 'seq-tfade', 'aria-label': 'Fade length' }, ...[[0, 'at once'], [0.5, 'over half a bar'], [1, 'over a bar'], [2, 'over two bars'], [4, 'over four bars']].map(([v, tx]) => el('option', { value: String(v), text: tx })));
    fade.value = '1';
    const status = el('small', { class: 'pref-hint', id: 'seq-tstatus' });
    const hearChange = async () => {
      try {
        status.textContent = 'Rendering…';
        const r = await req('seq.transition', { song, from: from.value, to: to.value, fadeBars: Number(fade.value) });
        audio.pause();
        hooks.onPlay();
        audition.src = r.url; audition.volume = volume; audition.currentTime = 0;
        audition.play().catch(() => {});
        status.textContent = `${layers.find((l) => l.id === from.value).name} for one loop, then ${layers.find((l) => l.id === to.value).name} from ${r.switchAt.toFixed(1)} s (${r.seconds.toFixed(1)} s in all).`;
      } catch (err) { status.textContent = ''; hooks.showError(err); }
    };
    out.push(el('div', { class: 'seq-layers', id: 'seq-layers' }, head, ...rows),
      el('div', { class: 'sb-row' }, add, el('small', { class: 'pref-hint', text: 'A track with nothing ticked plays in every layer. 🎧 at the top listens to one layer.' })),
      el('div', { class: 'sb-row' }, el('span', { class: 'sb-inline', text: 'Hear the change from' }), from, el('span', { class: 'sb-inline', text: 'to' }), to, fade,
        el('button', { class: 'utility-btn', id: 'seq-thear', onclick: hearChange }, '▶ Hear the change'), el('button', { class: 'icon-btn', title: 'Stop', 'aria-label': 'Stop', onclick: () => audition.pause() }, '■')),
      status);
    return out;
  }

  /** The loop inspector: how the loop wraps (a click? how much rings over? the same level at both ends?) and the seam to listen to. */
  function loopSection() {
    const box = el('div', { class: 'sb-meters', id: 'seq-loopreport' });
    const check = async () => {
      try {
        box.replaceChildren(el('span', { class: 'pref-hint', text: 'Checking…' }));
        const r = await req('seq.loopcheck', { song, layer: listenLayer || undefined });
        const chip = (key, text, title, warn) => el('span', { class: 'sb-meter' + (warn ? ' warn' : ''), 'data-check': key, title }, text);
        box.replaceChildren(
          chip('length', `${r.seconds.toFixed(2)} s (bars ${song.loopStart + 1}–${song.loopEnd})`, 'The loop\'s exact length'),
          chip('seam', r.seamJump > 1.5 ? '⚠ a jump at the seam' : '✓ no click at the seam', `The step where it wraps, against the largest anywhere else: ${r.seamJump}`, r.seamJump > 1.5),
          chip('tail', `${r.tailPercent.toFixed(1)} % rings over (folded in)`, 'Releases and echoes past the loop\'s end, added to its start so nothing is cut'),
          chip('ends', `start ${r.startDb} dB · end ${r.endDb} dB`, 'The level of the first and last half second'),
          ...r.checks.map((c) => chip('check', '⚠ ' + c, c, true)),
          el('button', { class: 'utility-btn', id: 'seq-hearseam', title: 'The loop\'s last two seconds, then its first two: the moment it wraps, at ' + r.seamAt.toFixed(1) + ' s',
            onclick: () => { audio.pause(); hooks.onPlay(); audition.src = r.seamUrl; audition.volume = volume; audition.currentTime = 0; audition.play().catch(() => {}); } }, '▶ Hear the seam'));
      } catch (err) { box.replaceChildren(); hooks.showError(err); }
    };
    return [el('h4', { class: 'music-subhead', text: 'Loop check' }),
      el('div', { class: 'sb-row' }, el('button', { class: 'utility-btn', id: 'seq-loopcheck', title: 'How well the loop repeats' + (listenLayer ? ' (the layer you are listening to)' : ''), onclick: check }, '🔎 Check the loop'),
        el('small', { class: 'pref-hint', text: `Bars ${song.loopStart + 1} to ${song.loopEnd}${listenLayer ? `, layer ${(song.layers.find((l) => l.id === listenLayer) || {}).name}` : ''}.` })), box];
  }

  async function exportSong() {
    const p = exportPrefs();
    const status = $('#seq-export-status');
    try {
      status.textContent = 'Rendering…';
      const r = await req('seq.export', { song, parts: { mix: !!p.mix, loop: !!p.loop, layers: !!p.layers && (song.layers || []).length > 0, stems: !!p.stems, midi: !!p.midi }, sampleRate: p.sampleRate, bits: p.bits, format: p.format, oggQuality: p.oggQuality, vault: !!p.vault, musicBench: !!p.musicBench, ...where.payload() });
      if (!r || r.cancelled) { status.textContent = 'Export cancelled.'; return; }
      const files = [...r.files, ...(r.stems ? [r.stems + '/'] : []), r.recipe];
      status.replaceChildren(`Saved ${files.join(', ')} in ${r.project ? `🎮 ${r.project}/${r.relative}` : r.folder}${r.vault ? ` · kept in the Vault as ${r.vault}` : ''}${r.music ? ' · added to the Music Bench' : ''}${[...(r.warnings || []), ...(r.notes || [])].length ? ' · ⚠ ' + [...(r.warnings || []), ...(r.notes || [])].join('; ') : ''} `,
        el('button', { class: 'utility-btn', id: 'seq-reveal', onclick: () => req('seq.reveal', { folder: r.folder }).catch(hooks.showError) }, 'Show in folder'));
    } catch (err) { status.textContent = ''; hooks.showError(err); }
  }

  async function saveSong() {
    try {
      const r = await req('seq.save', { song });
      lists.mine = r.mine;
      renderTemplates();
      notice(r.replaced ? `“${song.name}” updated in My songs` : `“${song.name}” saved to My songs`);
      if (tab === 'song') renderPane();
    } catch (err) { hooks.showError(err); }
  }

  async function deleteSong(m) {
    if (!(await NoorUI.confirm(`Delete “${m.name}”?`, 'It is removed from My songs (exported files are not touched).', 'Delete'))) return;
    try { lists.mine = (await req('seq.delete', { id: m.id })).mine; renderTemplates(); renderPane(); } catch (err) { hooks.showError(err); }
  }

  async function openSong() {
    try {
      const r = await req('seq.open');
      if (!r || r.cancelled) return;
      if (!isOpen()) await open();
      setSong(r.song, true);
    } catch (err) { hooks.showError(err); }
  }

  return {
    init, open, close, toggle, isOpen,
    /** Another player started: the song stops. */
    stopForOther: () => { if (!audio.paused) audio.pause(); noteAudio.pause(); audition.pause(); },
    _state: () => ({ song: song ? clone(song) : null, sel: { ...sel }, tab, playFrom, loopMode, scaleLock, playing: !audio.paused, src: audio.getAttribute('src'), render: render ? { ...render } : null, history: history.length, future: future.length, volume, noteSrc: noteAudio.getAttribute('src'), listenLayer, audition: audition.getAttribute('src'), roll: roll ? { rows: roll.rows.length, rowH: roll.rowH, keyW: roll.keyW, stepW: roll.stepW, top: roll.rows[0] } : null }),
  };
})();
