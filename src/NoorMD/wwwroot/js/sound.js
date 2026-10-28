// NoorMD Sound Bench: procedural sound effects and ambiences (wind, rain, fire, water, thunder, UI sounds). The page
// edits a recipe; the app renders it (the same recipe and seed always give the same sound) and the preview plays here,
// re-rendered a moment after each change, from the same spot. Export writes WAV files and the recipe next to them.
window.NoorSound = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);

  // Sliders: [key, label, min, max, step, kind] — kind 'hz' and 'ms' and 's' are logarithmic where it helps.
  const MACROS = [['intensity', 'Gentle', 'Violent'], ['gust', 'Calm', 'Gusty'], ['brightness', 'Soft', 'Sharp'], ['distance', 'Near', 'Distant'], ['shelter', 'Outdoors', 'Indoors']];
  const COMMON = [['gain', 'Level', -60, 12, 0.5, 'db'], ['pan', 'Pan', -1, 1, 0.05, 'pan'], ['width', 'Stereo width', 0, 1, 0.05, 'pct'], ['gustAmount', 'Follows gusts', 0, 1, 0.05, 'pct']];
  const SHOT = [['start', 'Start', 0, 30, 0.01, 's'], ['attack', 'Attack', 0, 5, 0.001, 's'], ['release', 'Release (0 = continuous)', 0, 20, 0.01, 's']];
  const GRIT = [['drive', 'Drive (grit)', 0, 1, 0.05, 'pct'], ['crush', 'Crush (retro)', 0, 1, 0.05, 'pct']];
  const FILTERED = [['freq', 'Filter frequency', 20, 20000, 1, 'hz'], ['freqEnd', 'Filter at the end (0 = stays)', 0, 20000, 1, 'hz0'], ['q', 'Filter sharpness (Q)', 0.1, 60, 0.1, 'q']];
  const FIELDS = {
    noise: [...COMMON, ...FILTERED, ['gustFilter', 'Filter opens with gusts', 0, 1, 0.05, 'pct'],
      ['drift', 'Drift (a moving whistle)', 0, 1, 0.05, 'pct'], ['wobble', 'Wobble', 0, 1, 0.05, 'pct'], ['wobbleRate', 'Wobble speed', 0.05, 20, 0.05, 'rate'], ...SHOT, ['hold', 'Hold', 0, 10, 0.001, 's'], ...GRIT],
    events: [...COMMON, ['density', 'Events per second', 0, 3000, 1, 'count'], ['rhythm', 'Random ↔ evenly spaced', 0, 1, 0.05, 'pct'], ['burst', 'Hits per event (clusters)', 1, 40, 1, 'count'],
      ['burstSpread', 'Cluster spread', 0, 1000, 1, 'ms'], ['decay', 'Ring time', 0.5, 500, 0.5, 'ms'], ['pitch', 'Pitch', 30, 12000, 1, 'hz'],
      ['pitchSpread', 'Pitch spread (octaves)', 0, 3, 0.05, 'num'], ['tone', 'Click ↔ ring', 0, 1, 0.05, 'pct'], ['gainSpread', 'Loudness spread', 0, 30, 0.5, 'db'], ...SHOT, ...GRIT],
    synth: [...COMMON, ['pitch', 'Pitch', 30, 12000, 1, 'hz'], ['pitchEnd', 'Pitch at the end (0 = steady)', 0, 12000, 1, 'hz0'], ['arp', 'Pitch jump (semitones)', -24, 24, 1, 'num'], ['arpTime', '…after', 0.001, 2, 0.001, 's'],
      ['attack', 'Attack', 0, 2, 0.001, 's'], ['hold', 'Hold', 0, 10, 0.001, 's'], ['release', 'Decay', 0.001, 10, 0.001, 's'], ['duty', 'Pulse width (square)', 0.05, 0.95, 0.01, 'pct'],
      ['fmRatio', 'FM ratio (0 = off)', 0, 16, 0.01, 'num'], ['fmDepth', 'FM depth', 0, 20, 0.05, 'num'], ['vibrato', 'Vibrato (5 = siren)', 0, 5, 0.01, 'num'], ['vibratoRate', 'Vibrato speed', 0.1, 30, 0.1, 'rate'],
      ['start', 'Start', 0, 30, 0.01, 's'], ['repeat', 'Repeat every (0 = once)', 0, 10, 0.01, 's'], ...FILTERED, ...GRIT],
    sample: [...COMMON.filter(([k]) => k !== 'gustAmount'), ['semitones', 'Pitch (semitones, like tape)', -24, 24, 0.1, 'num'], ['trimStart', 'Use from', 0, 60, 0.001, 's'], ['trimEnd', '…to (0 = the end)', 0, 60, 0.001, 's'],
      ['start', 'Start', 0, 30, 0.01, 's'], ['attack', 'Fade in', 0, 5, 0.001, 's'], ['hold', 'Hold', 0, 30, 0.01, 's'], ['release', 'Fade out (0 = none)', 0, 20, 0.01, 's'],
      ['repeat', 'Repeat every (0 = once)', 0, 10, 0.01, 's'], ...FILTERED, ...GRIT],
  };
  const CHOICES = { color: ['white', 'pink', 'brown'], filter: ['lowpass', 'highpass', 'bandpass', 'none'], wave: ['sine', 'square', 'saw', 'triangle', 'noise'] };
  const TYPE_LABEL = { noise: 'Noise bed', events: 'Events (drops, crackles, steps)', synth: 'Synth voice', sample: 'Sample (your WAV)' };
  const NEW_LAYER = {
    noise: { type: 'noise', name: 'Noise bed', gain: -18, color: 'pink', filter: 'lowpass', freq: 1000, q: 0.7, width: 0.8 },
    events: { type: 'events', name: 'Events', gain: -24, density: 30, decay: 10, pitch: 3000, pitchSpread: 0.7, tone: 0.3, gainSpread: 6, width: 0.9 },
    synth: { type: 'synth', name: 'Synth voice', gain: -12, wave: 'sine', pitch: 440, pitchEnd: 0, attack: 0.005, hold: 0, release: 0.3, width: 0 },
    sample: { type: 'sample', name: 'Sample', gain: -6, width: 1, semitones: 0, trimStart: 0, trimEnd: 0, release: 0 },
  };
  const MASTER = [['gain', 'Level', -40, 24, 0.5, 'db'], ['highPass', 'Low cut', 10, 5000, 1, 'hz'], ['lowPass', 'High cut', 200, 20000, 1, 'hz'], ['width', 'Stereo width', 0, 2, 0.05, 'pct'],
    ['reverb', 'Room sound', 0, 1, 0.05, 'pct'], ['room', 'Room size', 0, 1, 0.05, 'pct'], ['ceiling', 'Ceiling', -24, 0, 0.5, 'db']];
  const GUST = [['rate', 'Gusts per minute', 0.5, 60, 0.5, 'num'], ['depth', 'Gust strength', 0, 1, 0.05, 'pct'], ['base', 'Level between gusts', 0, 1, 0.05, 'pct']];

  let hooks = { showError: (e) => console.error(e), onPlay: () => {} };
  let built = false;
  let presets = { builtIn: [], mine: [], categories: [] };
  let presetFilter = '';
  let genCategory = 'pickup';
  let recipe = null;
  let family = null;
  let tab = 'quick';
  let render = null; // the last preview: { url, seconds, peaks, peakDb, rmsDb, cut }
  let renderGen = 0, renderTimer = null;
  let pinned = null; // A/B: { recipe }
  let listening = 'B';
  const history = []; let future = [];
  let lastSnapshot = null, snapTimer = null;
  const audio = new Audio();
  audio.preload = 'auto';

  const isOpen = () => document.body.classList.contains('sound-open');
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('sound.exportProgress', (p) => { const s = $('#sb-export-status'); if (s) s.textContent = `Rendering ${p.done} of ${p.total}…`; });
    audio.addEventListener('play', () => { renderTransport(); tickPlayhead(); });
    audio.addEventListener('pause', renderTransport);
    audio.addEventListener('ended', renderTransport);
  }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('sound');
    document.body.classList.add('sound-open');
    $('#soundbench').hidden = false;
    if (!presets.builtIn.length) {
      try { presets = await req('sound.presets'); } catch (err) { hooks.showError(err); return; }
      renderPresets();
    }
    if (!recipe) await loadPreset(presets.builtIn[0].id);
    $('#soundbench').focus({ preventScroll: true });
  }

  function close() {
    if (!built || !isOpen()) return;
    audio.pause();
    document.body.classList.remove('sound-open');
    $('#soundbench').hidden = true;
    if (window.NoorDock) NoorDock.closed('sound');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  // ---------------------------------------------------------------- recipe, preview, history

  async function loadPreset(id) {
    try {
      const r = await req('sound.preset', { id });
      setRecipe(r, true);
      family = r.family;
      renderPresets();
    } catch (err) { hooks.showError(err); }
  }

  function setRecipe(r, fresh) {
    if (!fresh && recipe) pushHistory();
    recipe = r;
    ensureIds(recipe);
    if (fresh) { history.length = 0; future = []; pinned = null; listening = 'B'; }
    lastSnapshot = JSON.stringify(recipe);
    renderEditor();
    schedule(0);
  }

  /** Something changed: keep the step for undo (once the change settles) and render again shortly. */
  function changed(rebuild) {
    ensureIds(recipe);
    if (rebuild) renderEditor(); else renderHeader();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(pushHistory, 600);
    listening = 'B';
    schedule(220);
  }

  function pushHistory() {
    const now = JSON.stringify(recipe);
    if (lastSnapshot && lastSnapshot !== now) { history.push(lastSnapshot); if (history.length > 100) history.shift(); future = []; }
    lastSnapshot = now;
  }

  function undo(redo) {
    clearTimeout(snapTimer);
    pushHistory();
    const from = redo ? future : history;
    const to = redo ? history : future;
    if (!from.length) { notice(redo ? 'Nothing to redo' : 'Nothing to undo', 900); return; }
    to.push(JSON.stringify(recipe));
    recipe = JSON.parse(from.pop());
    ensureIds(recipe);
    lastSnapshot = JSON.stringify(recipe);
    renderEditor();
    schedule(0);
  }

  function schedule(ms) { clearTimeout(renderTimer); renderTimer = setTimeout(() => preview(listening === 'A' && pinned ? pinned.recipe : recipe), ms); }

  async function preview(r) {
    const gen = ++renderGen;
    setStatus('Rendering…');
    try {
      const out = await req('sound.render', { recipe: r });
      if (gen !== renderGen) return;
      render = out;
      const wasPlaying = !audio.paused;
      const at = audio.currentTime || 0;
      audio.loop = !!r.loop;
      audio.src = out.url;
      // Keep listening from the same spot (wrapped into the new length).
      audio.addEventListener('loadedmetadata', () => {
        if (at > 0 && Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = r.loop ? at % audio.duration : Math.min(at, audio.duration);
        if (wasPlaying) audio.play().catch(() => {});
      }, { once: true });
      drawWave();
      setStatus(`${listening === 'A' ? 'A (pinned) · ' : ''}${out.seconds.toFixed(out.seconds < 2 ? 2 : 1)} s · peak ${out.peakDb} dB · RMS ${out.rmsDb} dB${out.cut ? ' · preview: first 30 s' : ''}${out.warnings && out.warnings.length ? ' · ⚠ ' + out.warnings.join('; ') : ''}`);
    } catch (err) { if (gen === renderGen) setStatus(err && err.message ? err.message : String(err)); }
  }

  function setStatus(t) { const s = $('#sb-status'); if (s) s.textContent = t; }

  function playStop() {
    if (!render) return;
    if (audio.paused) { hooks.onPlay(); if (!recipe.loop && audio.ended) audio.currentTime = 0; audio.play().catch((err) => setStatus(err.message)); } else audio.pause();
  }

  function renderTransport() {
    const b = $('#sb-play');
    if (!b) return;
    b.textContent = audio.paused ? '▶' : '■';
    b.setAttribute('aria-label', audio.paused ? 'Play' : 'Stop');
  }

  function tickPlayhead() {
    drawWave();
    if (!audio.paused) requestAnimationFrame(tickPlayhead);
  }

  function drawWave() {
    const c = $('#sb-wave');
    if (!c || !render) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(c);
    const n = render.peaks.length / 2;
    g.fillStyle = cs.getPropertyValue('--sb-wave') || '#9b87f5';
    for (let i = 0; i < n; i++) {
      const lo = render.peaks[i * 2], hi = render.peaks[i * 2 + 1];
      const x = (i / n) * w;
      g.fillRect(x, h / 2 - hi * h / 2, Math.max(1, w / n), Math.max(1, (hi - lo) * h / 2));
    }
    if (audio.duration > 0) {
      g.fillStyle = cs.getPropertyValue('--sb-head') || '#fff';
      g.fillRect((audio.currentTime / audio.duration) * w, 0, 2, h);
    }
  }

  // ---------------------------------------------------------------- panel

  function build() {
    built = true;
    const root = el('section', { id: 'soundbench', class: 'soundbench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'Sound Bench' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🔊' }), el('strong', { text: 'Sound Bench' }), el('small', { id: 'sb-family' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'sb-open', title: 'Open a recipe (.noorsound.json)', 'aria-label': 'Open a recipe', onclick: openRecipe }, '📂'),
          el('button', { class: 'icon-btn', id: 'sb-dock', title: 'Where this panel goes', 'aria-label': 'Move the Sound Bench', onclick: (e) => NoorDock.showMenu('sound', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+K)', 'aria-label': 'Close the Sound Bench', onclick: close }, '✕'))),
      el('div', { class: 'sb-main' },
        el('nav', { class: 'sb-presets', id: 'sb-presets', 'aria-label': 'Presets' }),
        el('div', { class: 'sb-editor' },
          el('div', { class: 'sb-top' },
            el('button', { class: 'radio-play', id: 'sb-play', title: 'Play / stop (Space)', 'aria-label': 'Play', onclick: playStop }, '▶'),
            el('input', { type: 'text', id: 'sb-name', 'aria-label': 'Name of the sound', spellcheck: 'false', maxlength: '80' }),
            el('label', { class: 'sb-seed', title: 'The random seed: the same seed gives the same sound' }, el('span', { text: 'Seed' }), el('input', { type: 'number', id: 'sb-seed', min: '0', max: '2147483647', step: '1' })),
            el('button', { class: 'utility-btn', id: 'sb-vary', title: 'A new variation: same recipe, another seed (V)', onclick: newVariation }, '🎲 Variation'),
            el('button', { class: 'utility-btn', id: 'sb-pin', title: 'Keep this version as A, to compare while you change things', onclick: pin }, '📌 Pin as A'),
            el('button', { class: 'utility-btn', id: 'sb-ab', title: 'Listen to A (pinned) or B (now) (B)', hidden: true, onclick: flipAB }, 'A/B: B')),
          el('canvas', { class: 'sb-wave', id: 'sb-wave', 'aria-label': 'Waveform (click to jump)', role: 'img' }),
          el('p', { class: 'pref-hint sb-status', id: 'sb-status', 'aria-live': 'polite' }),
          el('div', { class: 'music-tabs sb-tabs', role: 'tablist' }, ...[['quick', 'Quick'], ['layers', 'Layers'], ['mod', 'Modulation'], ['output', 'Output & export']].map(([id, label]) =>
            el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', onclick: () => { tab = id; renderEditor(); } }, label))),
          el('div', { class: 'sb-pane', id: 'sb-pane' }))));
    ($('#app') || document.body).append(root);
    $('#sb-name').addEventListener('input', (e) => { recipe.name = e.target.value; changed(false); });
    $('#sb-seed').addEventListener('change', (e) => { recipe.seed = Math.max(0, Math.min(2147483647, Math.round(Number(e.target.value) || 0))); changed(false); });
    $('#sb-wave').addEventListener('click', (e) => { if (audio.duration > 0) { const r = e.currentTarget.getBoundingClientRect(); audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration; drawWave(); } });
    new ResizeObserver(() => { root.classList.toggle('wide', root.clientWidth >= 820); drawWave(); }).observe(root);
    root.addEventListener('keydown', (e) => {
      const typing = e.target.closest('input[type=text], input[type=number], select, textarea');
      if (e.key === 'Escape' && !typing) { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (typing) return;
      if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); playStop(); }
      else if (e.key.toLowerCase() === 'z' && e.ctrlKey) { e.preventDefault(); undo(e.shiftKey); }
      else if (e.key.toLowerCase() === 'y' && e.ctrlKey) { e.preventDefault(); undo(true); }
      else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.altKey) { e.preventDefault(); newVariation(); }
      else if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.altKey && pinned) { e.preventDefault(); flipAB(); }
    });
  }

  function renderPresets() {
    const nav = $('#sb-presets');
    if (!nav) return;
    const q = presetFilter.toLowerCase();
    const match = (p) => !q || `${p.name} ${p.family} ${p.description}`.toLowerCase().includes(q);
    const shownBuiltIn = presets.builtIn.filter(match);
    const families = [...new Set(shownBuiltIn.map((p) => p.family))];
    const item = (p) => el('button', { class: 'gnav-item' + (recipe && recipe.name === p.name ? ' active' : ''), 'data-preset': p.id, title: p.description,
      onclick: () => loadPreset(p.id),
      oncontextmenu: (e) => { if (!p.id.startsWith('user:')) return; e.preventDefault(); NoorChrome.openMenu(null, [{ label: 'Delete this preset…', run: () => deletePreset(p) }], { x: e.clientX, y: e.clientY }); } },
    el('span', { class: 'gnav-label', text: p.name }));
    const keepFocus = document.activeElement && document.activeElement.id === 'sb-filter';
    const gen = el('select', { id: 'sb-gen-kind', 'aria-label': 'Kind of sound to generate' }, ...presets.categories.map((c) => el('option', { value: c.id, text: c.name, title: c.description })));
    gen.value = genCategory;
    gen.addEventListener('change', () => { genCategory = gen.value; });
    const filter = el('input', { type: 'search', id: 'sb-filter', placeholder: 'Find a preset…', value: presetFilter, 'aria-label': 'Find a preset', spellcheck: 'false' });
    filter.addEventListener('input', () => { presetFilter = filter.value; renderPresets(); });
    const mine = presets.mine.filter(match);
    nav.replaceChildren(
      el('div', { class: 'sb-generate' }, el('div', { class: 'gnav-head' }, el('span', { text: 'Generate' })),
        el('div', { class: 'sb-genrow' }, gen, el('button', { class: 'action primary', id: 'sb-generate', title: 'A new sound of this kind each time', onclick: generate }, '🎲'))),
      filter,
      ...families.flatMap((f) => [el('div', { class: 'gnav-head' }, el('span', { text: f })), ...shownBuiltIn.filter((p) => p.family === f).map(item)]),
      el('div', { class: 'gnav-head' }, el('span', { text: 'My presets' })),
      ...(mine.length ? mine.map(item) : [el('p', { class: 'pref-hint sb-none', text: q ? 'None match.' : 'Save a sound you like with “Save as my preset”.' })]));
    if (keepFocus) { const f = $('#sb-filter'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }

  function renderHeader() {
    if (!recipe) return;
    $('#sb-family').textContent = recipe.family || '';
    if (document.activeElement !== $('#sb-name')) $('#sb-name').value = recipe.name;
    $('#sb-seed').value = String(recipe.seed);
    const ab = $('#sb-ab');
    ab.hidden = !pinned;
    ab.textContent = `A/B: ${listening}`;
    ab.classList.toggle('on', listening === 'A');
  }

  function renderEditor() {
    if (!built || !recipe) return;
    renderHeader();
    document.querySelectorAll('#soundbench .sb-tabs button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    const pane = $('#sb-pane');
    const keep = pane.scrollTop;
    pane.replaceChildren(...(tab === 'quick' ? quickPane() : tab === 'layers' ? layersPane() : tab === 'mod' ? modPane() : outputPane()));
    pane.scrollTop = keep;
  }

  /** A slider bound to obj[key]; kinds make Hz and times logarithmic and show units. */
  /** The unit a number box is typed in, and the factor from the stored value (percentages are typed 0–100). */
  const UNIT = { db: ['dB', 1], pct: ['%', 100], hz: ['Hz', 1], hz0: ['Hz', 1], ms: ['ms', 1], s: ['s', 1], pan: ['', 1], count: ['', 1], rate: ['Hz', 1], q: ['', 1], num: ['', 1], st: ['st', 1], oct: ['oct', 1], spct: ['%', 100], x: ['×', 1] };

  /**
   * A slider bound to obj[key], with a number box beside it for exact values (Hz, dB, ms, semitones…).
   * Kinds make Hz, times and Q logarithmic on the slider; the number box is always linear and exact.
   */
  function slider(obj, [key, label, min, max, step, kind], rebuild) {
    const log = (kind === 'hz' || kind === 'ms' || kind === 'rate' || kind === 'q') && min > 0;
    const toPos = (v) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
    const fromPos = (p) => (log ? min * Math.pow(max / min, p / 1000) : p);
    const [unit, factor] = UNIT[kind] || ['', 1];
    const clamp = (v) => Math.max(min, Math.min(max, v));
    const value = Number(obj[key]) || 0;
    const shown = (v) => String(Number((v * factor).toFixed(kind === 'count' ? 0 : log || kind === 'hz0' ? 1 : 3)));
    const box = el('input', { type: 'number', class: 'sb-num', value: shown(value), step: 'any', 'aria-label': `${label} (${unit || 'value'})`, 'data-num': key });
    const input = el('input', { type: 'range', min: String(log ? 0 : min), max: String(log ? 1000 : max), step: String(log ? 1 : step), value: String(toPos(clamp(value) || min)), 'aria-label': label, 'data-key': key });
    input.addEventListener('input', () => {
      let v = fromPos(Number(input.value));
      if (!log) v = Math.round(v / step) * step;
      obj[key] = Number(v.toFixed(4));
      box.value = shown(obj[key]);
      changed(rebuild);
    });
    box.addEventListener('change', () => {
      const typed = Number(box.value);
      if (!Number.isFinite(typed)) { box.value = shown(obj[key]); return; }
      obj[key] = Number(clamp(typed / factor).toFixed(6));
      box.value = shown(obj[key]);
      input.value = String(toPos(obj[key]) || 0);
      changed(rebuild);
    });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.dispatchEvent(new Event('change')); } });
    return el('label', { class: 'sb-slider' }, el('span', { text: label }), input, el('span', { class: 'sb-numwrap' }, box, unit ? el('small', { text: unit }) : null));
  }

  // ---------------------------------------------------------------- effects racks (per layer and master)

  const FX_LABEL = { eq: 'EQ band', compressor: 'Compressor', gate: 'Gate', saturate: 'Saturation', crush: 'Bit-crusher', delay: 'Delay', chorus: 'Chorus', flanger: 'Flanger', phaser: 'Phaser', tremolo: 'Tremolo / auto-pan', reverb: 'Reverb', width: 'Stereo width' };
  const FX_FIELDS = {
    eq: [['freq', 'Frequency', 20, 20000, 1, 'hz'], ['q', 'Width (Q)', 0.1, 30, 0.1, 'q'], ['gain', 'Boost / cut', -36, 36, 0.5, 'db']],
    compressor: [['threshold', 'Threshold', -80, 0, 0.5, 'db'], ['ratio', 'Ratio', 1, 40, 0.1, 'num'], ['attack', 'Attack', 0.05, 500, 0.05, 'ms'], ['release', 'Release', 1, 5000, 1, 'ms']],
    gate: [['threshold', 'Threshold', -80, 0, 0.5, 'db'], ['range', 'Closes by', 0, 90, 1, 'db'], ['attack', 'Attack', 0.05, 500, 0.05, 'ms'], ['release', 'Release', 1, 5000, 1, 'ms']],
    saturate: [['drive', 'Drive', 0, 1, 0.01, 'pct']],
    crush: [['bits', 'Bits', 1, 16, 1, 'count'], ['downsample', 'Downsample ×', 1, 64, 1, 'count']],
    delay: [['time', 'Time', 1, 2000, 1, 'ms'], ['feedback', 'Feedback', 0, 0.95, 0.01, 'pct'], ['tone', 'Echo brightness', 200, 20000, 1, 'hz']],
    chorus: [['rate', 'Speed', 0.01, 20, 0.01, 'rate'], ['depth', 'Depth', 0, 1, 0.01, 'pct']],
    flanger: [['rate', 'Speed', 0.01, 20, 0.01, 'rate'], ['depth', 'Depth', 0, 1, 0.01, 'pct'], ['feedback', 'Feedback', 0, 0.95, 0.01, 'pct']],
    phaser: [['rate', 'Speed', 0.01, 20, 0.01, 'rate'], ['depth', 'Depth', 0, 1, 0.01, 'pct'], ['feedback', 'Feedback', 0, 0.95, 0.01, 'pct']],
    tremolo: [['rate', 'Speed', 0.01, 20, 0.01, 'rate'], ['depth', 'Depth', 0, 1, 0.01, 'pct']],
    reverb: [['size', 'Size', 0, 1, 0.01, 'pct'], ['damping', 'Damping (darker)', 0, 1, 0.01, 'pct'], ['preDelay', 'Pre-delay', 0, 250, 1, 'ms']],
    width: [['width', 'Width (100% = as is)', 0, 2, 0.01, 'pct']],
  };
  const FX_CHOICES = { eq: [['kind', 'Type', ['peak', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch']]], saturate: [['shape', 'Shape', ['soft', 'hard', 'fold']]] };
  const FX_CHECKS = { delay: [['pingPong', 'Ping-pong (left, right)']], tremolo: [['pan', 'Auto-pan (side to side)']] };
  const NEW_FX = {
    eq: { kind: 'peak', freq: 1000, q: 0.7, gain: 3 }, compressor: { threshold: -18, ratio: 4, attack: 10, release: 120 }, gate: { threshold: -40, range: 40, attack: 1, release: 80 },
    saturate: { drive: 0.4, shape: 'soft' }, crush: { bits: 8, downsample: 4 }, delay: { time: 250, feedback: 0.35, tone: 6000, mix: 0.35 }, chorus: { rate: 0.8, depth: 0.5, mix: 0.7 },
    flanger: { rate: 0.3, depth: 0.7, feedback: 0.5 }, phaser: { rate: 0.5, depth: 0.7, feedback: 0.4 }, tremolo: { rate: 5, depth: 0.5 }, reverb: { size: 0.5, damping: 0.5, preDelay: 10, mix: 0.3 }, width: { width: 1.5 },
  };

  /** An effects chain: each effect with on/off, ↑ ↓, remove, its settings, wet/dry mix and output level. */
  function effectsRack(chain, where, owner) {
    const cards = chain.map((fx, i) => {
      const choices = (FX_CHOICES[fx.type] || []).map(([key, label, opts]) => {
        const sel = el('select', { 'aria-label': label, 'data-fx': key }, ...opts.map((o) => el('option', { value: o, text: o })));
        sel.value = fx[key] || opts[0];
        sel.addEventListener('change', () => { fx[key] = sel.value; changed(false); });
        return el('label', { class: 'sb-inline' }, el('span', { text: label }), sel);
      });
      const checks = (FX_CHECKS[fx.type] || []).map(([key, label]) => {
        const c = el('input', { type: 'checkbox', checked: fx[key] || undefined, 'data-fx': key });
        c.addEventListener('change', () => { fx[key] = c.checked; changed(false); });
        return el('label', { class: 'sb-inline' }, c, el('span', { text: label }));
      });
      const move = (d) => { const j = i + d; if (j < 0 || j >= chain.length) return; [chain[i], chain[j]] = [chain[j], chain[i]]; changed(true); };
      return el('div', { class: 'sb-fx' + (fx.bypass ? ' off' : ''), 'data-fx-index': String(i), 'data-fx-type': fx.type },
        el('div', { class: 'sb-fx-head' },
          el('button', { class: 'icon-btn sb-ms' + (fx.bypass ? '' : ' on'), title: fx.bypass ? 'Off (click to switch it on)' : 'On (click to bypass)', 'aria-pressed': String(!fx.bypass), 'aria-label': 'On', onclick: () => { fx.bypass = !fx.bypass; changed(true); } }, '⏻'),
          el('strong', { text: FX_LABEL[fx.type] || fx.type }),
          el('span', { class: 'sb-fx-space' }),
          el('button', { class: 'icon-btn', title: 'Earlier in the chain', 'aria-label': 'Move up', disabled: i === 0 || undefined, onclick: () => move(-1) }, '↑'),
          el('button', { class: 'icon-btn', title: 'Later in the chain', 'aria-label': 'Move down', disabled: i === chain.length - 1 || undefined, onclick: () => move(1) }, '↓'),
          el('button', { class: 'icon-btn', title: 'Remove this effect', 'aria-label': 'Remove this effect', onclick: () => { dropRoutes((t) => t.startsWith(`${owner}/${fx.id}:`)); chain.splice(i, 1); changed(true); } }, '✕')),
        ...(choices.length || checks.length ? [el('div', { class: 'sb-choices' }, ...choices, ...checks)] : []),
        el('div', { class: 'sb-fields' }, ...(FX_FIELDS[fx.type] || []).map((f) => slider(fx, f, false)),
          slider(fx, ['mix', 'Mix (dry ↔ wet)', 0, 1, 0.01, 'pct'], false), slider(fx, ['out', 'Output', -40, 24, 0.5, 'db'], false)));
    });
    const add = el('select', { class: 'sb-addfx', 'aria-label': 'Add an effect', 'data-addfx': where },
      el('option', { value: '', text: chain.length >= 8 ? 'Eight effects is the most' : '＋ Add an effect…' }), ...(chain.length >= 8 ? [] : Object.keys(FX_LABEL).map((t) => el('option', { value: t, text: FX_LABEL[t] }))));
    add.addEventListener('change', () => {
      const t = add.value;
      if (!t) return;
      chain.push({ type: t, bypass: false, mix: 1, out: 0, ...clone(NEW_FX[t]) });
      changed(true);
    });
    return el('div', { class: 'sb-rack' }, ...cards, add);
  }

  function quickPane() {
    const m = recipe.macros;
    const macro = ([key, left, right]) => {
      const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(m[key]), 'aria-label': `${left} to ${right}`, 'data-macro': key });
      input.addEventListener('input', () => { m[key] = Number(input.value); changed(false); });
      return el('div', { class: 'sb-macro' }, el('span', { text: left }), input, el('span', { text: right }));
    };
    const dur = el('input', { type: 'number', id: 'sb-duration', min: '0.05', max: '600', step: '0.05', value: String(recipe.duration), 'aria-label': 'Length in seconds' });
    dur.addEventListener('change', () => { recipe.duration = Math.max(0.05, Math.min(600, Number(dur.value) || 1)); changed(false); });
    const loop = el('input', { type: 'checkbox', id: 'sb-loop', checked: recipe.loop || undefined });
    loop.addEventListener('change', () => { recipe.loop = loop.checked; changed(false); });
    const knobs = (recipe.knobs || []).map((k) => {
      const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(k.value), 'aria-label': k.name, 'data-knob': k.id });
      const shown = el('span', { text: `${Math.round(k.value * 100)}%` });
      input.addEventListener('input', () => { k.value = Number(input.value); shown.textContent = `${Math.round(k.value * 100)}%`; changed(false); });
      return el('div', { class: 'sb-macro sb-knob' }, el('span', { text: k.name, title: routesFrom(k.id).map((r) => targetLabel(r.target)).join(', ') || 'Not connected yet (Modulation tab)' }), input, shown);
    });
    return [
      ...(knobs.length ? [el('h4', { class: 'music-subhead', text: 'Controls of this sound' }), el('div', { class: 'sb-macros', id: 'sb-knobs' }, ...knobs), el('h4', { class: 'music-subhead', text: 'Character' })] : []),
      el('div', { class: 'sb-macros' }, ...MACROS.map(macro)),
      el('div', { class: 'sb-row' },
        el('label', { class: 'sb-inline' }, el('span', { text: 'Length (s)' }), dur),
        el('label', { class: 'sb-inline' }, loop, el('span', { text: 'Seamless loop (otherwise a one-shot)' })),
        el('button', { class: 'utility-btn', onclick: () => { for (const [k] of MACROS) m[k] = k === 'distance' || k === 'shelter' ? 0 : 0.5; changed(true); } }, 'Reset')),
      el('p', { class: 'pref-hint', text: 'Pick a preset on the left, then shape it. 🎲 Variation makes another take of the same sound; 📌 Pin as A lets you compare (B). The Layers tab shows how it is built.' }),
    ];
  }

  function layersPane() {
    const g = recipe.gust;
    const cards = recipe.layers.map((l, i) => {
      const fields = FIELDS[l.type] || FIELDS.noise;
      const name = el('input', { type: 'text', value: l.name, 'aria-label': 'Layer name', spellcheck: 'false', maxlength: '60' });
      name.addEventListener('input', () => { l.name = name.value; changed(false); });
      const choice = (key) => {
        const s = el('select', { 'aria-label': key }, ...CHOICES[key].map((c) => el('option', { value: c, text: c })));
        s.value = l[key];
        s.addEventListener('change', () => { l[key] = s.value; changed(false); });
        return el('label', { class: 'sb-inline' }, el('span', { text: key === 'color' ? 'Noise' : key === 'filter' ? 'Filter' : 'Wave' }), s);
      };
      const check = (key, label) => {
        const c = el('input', { type: 'checkbox', checked: l[key] || undefined, 'data-key': key });
        c.addEventListener('change', () => { l[key] = c.checked; changed(false); });
        return el('label', { class: 'sb-inline' }, c, el('span', { text: label }));
      };
      const toggleBtn = (key, label, title) => el('button', { class: 'icon-btn sb-ms' + (l[key] ? ' on' : ''), title, 'aria-pressed': String(!!l[key]), onclick: () => { l[key] = !l[key]; changed(true); } }, label);
      return el('section', { class: 'sb-layer' + (l.mute ? ' muted' : ''), 'data-index': String(i) },
        el('div', { class: 'sb-layer-head' },
          el('span', { class: 'sb-type', text: TYPE_LABEL[l.type] || l.type }), name,
          toggleBtn('mute', 'M', 'Mute this layer'), toggleBtn('solo', 'S', 'Solo: hear only the soloed layers'),
          el('button', { class: 'icon-btn', title: 'Copy this layer', 'aria-label': 'Copy this layer', onclick: () => { recipe.layers.splice(i + 1, 0, { ...clone(l), name: l.name + ' copy', solo: false }); changed(true); } }, '⧉'),
          el('button', { class: 'icon-btn', title: 'Remove this layer', 'aria-label': 'Remove this layer', onclick: () => { dropRoutes((t) => t.startsWith(l.id + ':') || t.startsWith(l.id + '/')); recipe.layers.splice(i, 1); changed(true); } }, '✕')),
        el('div', { class: 'sb-choices' }, ...(l.type === 'noise' ? [choice('color'), choice('filter')]
          : l.type === 'synth' ? [choice('wave'), check('useFilter', 'Filter'), choice('filter')]
            : l.type === 'sample' ? [el('span', { class: 'sb-file', title: l.path || '', text: '🎵 ' + (l.sampleName || 'no file') }),
              el('button', { class: 'utility-btn', onclick: async () => { const f = await pickSample(); if (f) { l.path = f.path; l.sampleName = f.name; l.name = l.name === 'Sample' ? f.name.replace(/\.wav$/i, '') : l.name; changed(true); } } }, 'Change file…'),
              check('reverse', 'Backwards'), check('loopSample', 'Loop it'), check('useFilter', 'Filter'), choice('filter')] : [])),
        el('div', { class: 'sb-fields' }, ...fields.map((f) => slider(l, f, false))),
        el('details', { class: 'sb-fxgroup', open: (l.effects || []).length > 0 || undefined }, el('summary', { text: `Effects${(l.effects || []).length ? ` (${l.effects.length})` : ''}` }), effectsRack(l.effects ||= [], 'layer-' + i, l.id)));
    });
    return [
      el('details', { class: 'sb-group', open: true }, el('summary', { text: 'Gusts (the slow movement layers can follow)' }), el('div', { class: 'sb-fields' }, ...GUST.map((f) => slider(g, f, false)))),
      ...cards,
      el('div', { class: 'sb-row' }, el('span', { text: 'Add:' }), ...Object.keys(NEW_LAYER).map((t) => el('button', { class: 'utility-btn', 'data-add': t, onclick: () => {
        if (recipe.layers.length >= 16) { notice('Sixteen layers is the most.', 1500); return; }
        if (t === 'sample') {
          pickSample().then((f) => { if (!f) return; recipe.layers.push({ ...clone(NEW_LAYER.sample), path: f.path, sampleName: f.name, name: f.name.replace(/\.wav$/i, '') }); changed(true); });
          return;
        }
        recipe.layers.push(clone(NEW_LAYER[t])); changed(true);
      } }, '＋ ' + TYPE_LABEL[t]))),
    ];
  }


  // ---------------------------------------------------------------- modulation (knobs, modulators and routes)

  /**
   * Gives layers, effects, modulators and knobs the ids routes refer to, the same way the app does: an item keeps a
   * valid id (the first of repeats keeps it); the others get the lowest free number ("L3", "F1", "M2", "K1").
   */
  function ensureIds(r) {
    if (!r) return;
    const valid = (id, p) => typeof id === 'string' && id.length > 1 && id.length <= 8 && id[0] === p && /^\d+$/.test(id.slice(1));
    const assign = (items, p, used = new Set()) => {
      // Two passes, so a copy placed before its original never takes an id a later item already has.
      const keep = items.map((it) => valid(it.id, p) && !used.has(it.id) && !!used.add(it.id));
      items.forEach((it, i) => { if (keep[i]) return; let n = 1; while (used.has(p + n)) n++; it.id = p + n; used.add(it.id); });
      return used;
    };
    r.layers ||= []; r.master ||= {}; r.modulators ||= []; r.knobs ||= []; r.routes ||= [];
    assign(r.layers, 'L');
    for (const l of r.layers) assign(l.effects ||= [], 'F');
    assign(r.master.effects ||= [], 'F');
    assign(r.knobs, 'K', assign(r.modulators, 'M'));
  }

  const routesFrom = (source) => (recipe.routes || []).filter((r) => r.source === source);
  function dropRoutes(match) { recipe.routes = (recipe.routes || []).filter((r) => !match(r.target)); }

  // What each target is called, its unit (a slider kind), the amount range and a sensible first amount.
  const LAYER_TARGETS = { gain: ['Level', 'db', -48, 48, 6], pan: ['Pan', 'pan', -2, 2, 0.5], pitch: ['Pitch', 'st', -48, 48, 12], freq: ['Filter', 'oct', -6, 6, 1], density: ['Events per second', 'oct', -6, 6, 1] };
  const FX_TARGETS = { mix: ['Mix', 'spct', -1, 1, 0.5], freq: ['Frequency', 'oct', -6, 6, 1], gain: ['Boost / cut', 'db', -36, 36, 6], drive: ['Drive', 'spct', -1, 1, 0.5] };
  const MASTER_TARGETS = { gain: ['Level', 'db', -48, 48, 6], lowpass: ['High cut', 'oct', -6, 6, -2] };

  /** Every target in this recipe: [target, label, spec]. */
  function targets() {
    const out = [];
    const fxTargets = (owner, ownerName, chain) => chain.forEach((fx, j) => {
      const params = ['mix', ...(fx.type === 'eq' ? ['freq', 'gain'] : fx.type === 'saturate' ? ['drive'] : [])];
      for (const p of params) out.push([`${owner}/${fx.id}:${p}`, `${ownerName} › ${j + 1}. ${FX_LABEL[fx.type] || fx.type} › ${FX_TARGETS[p][0]}`, FX_TARGETS[p]]);
    });
    for (const l of recipe.layers) {
      const params = ['gain', 'pan', ...(l.type === 'noise' ? [] : ['pitch']), 'freq', ...(l.type === 'events' ? ['density'] : [])];
      for (const p of params) out.push([`${l.id}:${p}`, `${l.name || l.id} › ${LAYER_TARGETS[p][0]}`, LAYER_TARGETS[p]]);
      fxTargets(l.id, l.name || l.id, l.effects || []);
    }
    for (const p of Object.keys(MASTER_TARGETS)) out.push([`master:${p}`, `Master › ${MASTER_TARGETS[p][0]}`, MASTER_TARGETS[p]]);
    fxTargets('master', 'Master', recipe.master.effects || []);
    return out;
  }
  const targetLabel = (t) => (targets().find(([id]) => id === t) || [t, `${t} (missing)`])[1];
  function targetSpec(t) {
    const param = t.slice(t.lastIndexOf(':') + 1);
    return (t.includes('/') ? FX_TARGETS[param] : t.startsWith('master:') ? MASTER_TARGETS[param] : LAYER_TARGETS[param]) || ['Amount', 'num', -1, 1, 0.5];
  }

  /** The routes from one source, and a picker to add another. */
  function routeList(source) {
    const all = targets();
    const rows = routesFrom(source).map((r) => {
      const [, kind, lo, hi] = targetSpec(r.target);
      const known = all.some(([id]) => id === r.target);
      const sel = el('select', { 'aria-label': 'Target', 'data-route-target': '' }, ...(known ? [] : [el('option', { value: r.target, text: `${r.target} (missing)` })]),
        ...all.map(([id, label]) => el('option', { value: id, text: label })));
      sel.value = r.target;
      sel.addEventListener('change', () => { r.target = sel.value; const spec = targetSpec(r.target); r.amount = Math.max(spec[2], Math.min(spec[3], r.amount)); changed(true); });
      const off = el('button', { class: 'icon-btn sb-ms' + (r.off ? '' : ' on'), title: r.off ? 'Off (click to switch it on)' : 'On (click to switch it off)', 'aria-pressed': String(!r.off), 'aria-label': 'Route on', onclick: () => { r.off = !r.off; changed(true); } }, '⏻');
      const remove = el('button', { class: 'icon-btn', title: 'Remove this connection', 'aria-label': 'Remove this connection', onclick: () => { recipe.routes.splice(recipe.routes.indexOf(r), 1); changed(true); } }, '✕');
      return el('div', { class: 'sb-route' + (r.off ? ' off' : '') + (known ? '' : ' missing'), 'data-route': r.target },
        el('div', { class: 'sb-route-head' }, off, el('span', { text: '→' }), sel, remove),
        el('div', { class: 'sb-fields' }, slider(r, ['amount', 'Amount', lo, hi, kind === 'db' || kind === 'st' ? 0.5 : 0.01, kind], false),
          slider(r, ['curve', 'Response (1 = straight, >1 slow start)', 0.25, 4, 0.05, 'x'], false)));
    });
    const used = new Set(routesFrom(source).map((r) => r.target));
    const add = el('select', { class: 'sb-addroute', 'aria-label': 'Connect to', 'data-addroute': source },
      el('option', { value: '', text: (recipe.routes || []).length >= 48 ? 'Forty-eight connections is the most' : '＋ Connect to…' }),
      ...((recipe.routes || []).length >= 48 ? [] : all.filter(([id]) => !used.has(id)).map(([id, label]) => el('option', { value: id, text: label }))));
    add.addEventListener('change', () => {
      if (!add.value) return;
      recipe.routes.push({ source, target: add.value, amount: targetSpec(add.value)[4], curve: 1, off: false });
      changed(true);
    });
    return el('div', { class: 'sb-routes' }, ...rows, add);
  }

  const MOD_LABEL = { lfo: 'LFO (repeats)', envelope: 'Envelope (rises and falls once)', random: 'Random drift', steps: 'Steps (a pattern)', curve: 'Drawn curve (over the length)' };
  const MOD_FIELDS = {
    lfo: [['rate', 'Speed', 0.01, 50, 0.01, 'rate'], ['phase', 'Start phase', 0, 1, 0.01, 'pct']],
    envelope: [['start', 'Starts at', 0, 60, 0.01, 's'], ['attack', 'Attack', 0, 30, 0.01, 's'], ['hold', 'Hold', 0, 30, 0.01, 's'], ['decay', 'Decay', 0, 30, 0.01, 's'], ['sustain', 'Then stays at', 0, 1, 0.01, 'pct']],
    random: [['rate', 'Changes per second', 0.01, 50, 0.01, 'rate'], ['smooth', 'Jumps ↔ glides', 0, 1, 0.01, 'pct']],
    steps: [['rate', 'Steps per second', 0.01, 50, 0.01, 'rate'], ['smooth', 'Jumps ↔ glides', 0, 1, 0.01, 'pct']],
    curve: [],
  };
  const NEW_MOD = {
    lfo: { shape: 'sine', rate: 1, phase: 0 }, envelope: { start: 0, attack: 0.5, hold: 0, decay: 1, sustain: 0.3 }, random: { rate: 1, smooth: 1 },
    steps: { rate: 4, smooth: 0, steps: [1, 0.25, 0.5, 0.25] }, curve: { points: [[0, 0], [0.5, 1], [1, 0]] },
  };
  const CURVE_SHAPES = { 'Rise': [[0, 0], [1, 1]], 'Fall': [[0, 1], [1, 0]], 'Up and down': [[0, 0], [0.5, 1], [1, 0]], 'Swell at the end': [[0, 0], [0.7, 0.1], [1, 1]] };

  /** A drawn curve: click to add a point, drag to move one, double-click (or right-click) a point to remove it. */
  function curveEditor(m) {
    const c = el('canvas', { class: 'sb-curve', role: 'img', 'aria-label': 'Drawn curve: click to add a point, drag to move, double-click to remove' });
    const pts = () => m.points;
    const draw = () => {
      const w = c.clientWidth || 300, h = c.clientHeight || 90, d = devicePixelRatio || 1;
      c.width = w * d; c.height = h * d;
      const g = c.getContext('2d');
      g.scale(d, d);
      const css = getComputedStyle(c);
      g.strokeStyle = css.borderColor; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.strokeStyle = css.color; g.lineWidth = 2; g.beginPath();
      const p = pts();
      g.moveTo(0, (1 - p[0][1]) * h);
      for (const [x, y] of p) g.lineTo(x * w, (1 - y) * h);
      g.lineTo(w, (1 - p[p.length - 1][1]) * h); g.stroke();
      g.fillStyle = css.color;
      for (const [x, y] of p) { g.beginPath(); g.arc(x * w, (1 - y) * h, 4, 0, Math.PI * 2); g.fill(); }
    };
    const at = (e) => { const r = c.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)), r]; };
    const near = (e) => { const [x, y, r] = at(e); return pts().findIndex(([px, py]) => Math.hypot((px - x) * r.width, (py - y) * r.height) < 9); };
    let drag = -1;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = near(e);
      if (drag < 0) { if (pts().length >= 64) return; const [x, y] = at(e); pts().push([x, y]); pts().sort((a, b) => a[0] - b[0]); drag = near(e); }
      c.setPointerCapture(e.pointerId); draw();
    });
    c.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const [x, y] = at(e);
      const p = pts();
      const lo = drag > 0 ? p[drag - 1][0] : 0, hi = drag < p.length - 1 ? p[drag + 1][0] : 1;
      p[drag] = [Number(Math.max(lo, Math.min(hi, x)).toFixed(4)), Number(y.toFixed(4))];
      draw();
    });
    const end = () => { if (drag >= 0) { drag = -1; changed(false); } };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    const removeAt = (e) => { const i = near(e); if (i >= 0 && pts().length > 1) { e.preventDefault(); pts().splice(i, 1); draw(); changed(false); } };
    c.addEventListener('dblclick', removeAt); c.addEventListener('contextmenu', removeAt);
    requestAnimationFrame(draw);
    new ResizeObserver(draw).observe(c);
    const shapes = el('div', { class: 'sb-choices' }, ...Object.entries(CURVE_SHAPES).map(([name, p]) => el('button', { class: 'utility-btn', onclick: () => { m.points = clone(p); changed(true); } }, name)));
    return el('div', { class: 'sb-curvewrap' }, c, shapes);
  }

  /** Steps: one small vertical slider per step, and buttons to add or remove steps. */
  function stepsEditor(m) {
    const bars = m.steps.map((v, i) => {
      const s = el('input', { type: 'range', class: 'sb-step', min: '0', max: '1', step: '0.01', value: String(v), 'aria-label': `Step ${i + 1}`, 'data-step': String(i) });
      s.addEventListener('input', () => { m.steps[i] = Number(s.value); changed(false); });
      return s;
    });
    return el('div', { class: 'sb-steps' }, ...bars,
      el('button', { class: 'icon-btn', title: 'Remove the last step', 'aria-label': 'Fewer steps', disabled: m.steps.length <= 1 || undefined, onclick: () => { m.steps.pop(); changed(true); } }, '−'),
      el('button', { class: 'icon-btn', title: 'Add a step', 'aria-label': 'More steps', disabled: m.steps.length >= 16 || undefined, onclick: () => { m.steps.push(m.steps[m.steps.length - 1] ?? 0.5); changed(true); } }, '＋'));
  }

  function modPane() {
    const name = (obj, label) => {
      const n = el('input', { type: 'text', value: obj.name, 'aria-label': label, spellcheck: 'false', maxlength: '40' });
      n.addEventListener('input', () => { obj.name = n.value; changed(false); });
      return n;
    };
    const removeSource = (list, obj) => { recipe.routes = recipe.routes.filter((r) => r.source !== obj.id); list.splice(list.indexOf(obj), 1); changed(true); };
    const knobCards = recipe.knobs.map((k) => el('section', { class: 'sb-layer sb-modcard', 'data-knob-card': k.id },
      el('div', { class: 'sb-layer-head' }, el('span', { class: 'sb-type', text: '🎚 Control' }), name(k, 'Control name'),
        el('button', { class: 'icon-btn', title: 'Remove this control and its connections', 'aria-label': 'Remove this control', onclick: () => removeSource(recipe.knobs, k) }, '✕')),
      el('div', { class: 'sb-fields' }, slider(k, ['value', 'Position', 0, 1, 0.01, 'pct'], false)),
      routeList(k.id)));
    const modCards = recipe.modulators.map((m) => {
      const type = el('select', { 'aria-label': 'Kind of modulator', 'data-modtype': '' }, ...Object.entries(MOD_LABEL).map(([v, t]) => el('option', { value: v, text: t })));
      type.value = m.type;
      type.addEventListener('change', () => { Object.assign(m, clone(NEW_MOD[type.value]), { type: type.value }); changed(true); });
      const shape = el('select', { 'aria-label': 'Shape' }, ...['sine', 'triangle', 'square', 'saw', 'hold'].map((v) => el('option', { value: v, text: v === 'hold' ? 'random steps' : v })));
      shape.value = m.shape || 'sine';
      shape.addEventListener('change', () => { m.shape = shape.value; changed(false); });
      return el('section', { class: 'sb-layer sb-modcard', 'data-mod-card': m.id },
        el('div', { class: 'sb-layer-head' }, el('span', { class: 'sb-type', text: '〰 ' + m.id }), name(m, 'Modulator name'),
          el('button', { class: 'icon-btn', title: 'Remove this modulator and its connections', 'aria-label': 'Remove this modulator', onclick: () => removeSource(recipe.modulators, m) }, '✕')),
        el('div', { class: 'sb-choices' }, el('label', { class: 'sb-inline' }, el('span', { text: 'Kind' }), type),
          ...(m.type === 'lfo' ? [el('label', { class: 'sb-inline' }, el('span', { text: 'Shape' }), shape)] : [])),
        ...(m.type === 'curve' ? [curveEditor(m)] : m.type === 'steps' ? [stepsEditor(m)] : []),
        el('div', { class: 'sb-fields' }, ...MOD_FIELDS[m.type].map((f) => slider(m, f, false))),
        routeList(m.id));
    });
    return [
      el('p', { class: 'pref-hint', text: 'Controls are your own sliders for the Quick tab ("Motor RPM", "Rain amount"); modulators move things by themselves over time. Connect either to as many settings as you like, each with its own amount and response.' }),
      el('h4', { class: 'music-subhead', text: 'Controls' }),
      ...knobCards,
      el('div', { class: 'sb-row' }, el('button', { class: 'utility-btn', id: 'sb-addknob', disabled: recipe.knobs.length >= 8 || undefined, onclick: () => { recipe.knobs.push({ name: `Control ${recipe.knobs.length + 1}`, value: 0.5 }); changed(true); } }, '＋ Control')),
      el('h4', { class: 'music-subhead', text: 'Modulators' }),
      ...modCards,
      el('div', { class: 'sb-row' }, el('span', { text: 'Add:' }), ...Object.keys(MOD_LABEL).map((t) => el('button', { class: 'utility-btn', 'data-addmod': t, disabled: recipe.modulators.length >= 8 || undefined, onclick: () => {
        recipe.modulators.push({ name: MOD_LABEL[t].replace(/ \(.*/, ''), type: t, ...clone(NEW_MOD[t]) }); changed(true);
      } }, '＋ ' + MOD_LABEL[t].replace(/ \(.*/, '')))),
    ];
  }

  function outputPane() {
    const m = recipe.master;
    const norm = el('input', { type: 'checkbox', id: 'sb-normalize', checked: m.normalize || undefined });
    norm.addEventListener('change', () => { m.normalize = norm.checked; changed(false); });
    const prefs = exportPrefs();
    const sel = (id, label, options, value, key) => {
      const s = el('select', { id, 'aria-label': label }, ...options.map(([v, t]) => el('option', { value: String(v), text: t })));
      s.value = String(value);
      s.addEventListener('change', () => saveExportPrefs({ ...exportPrefs(), [key]: Number(s.value) }));
      return el('label', { class: 'sb-inline' }, el('span', { text: label }), s);
    };
    return [
      el('div', { class: 'sb-fields' }, ...MASTER.map((f) => slider(m, f, false))),
      el('label', { class: 'sb-inline' }, norm, el('span', { text: 'Bring the loudest peak to the ceiling (good for one-shots)' })),
      el('h4', { class: 'music-subhead', text: 'Master effects (on the whole sound)' }),
      effectsRack(m.effects ||= [], 'master', 'master'),
      el('h4', { class: 'music-subhead', text: 'Export' }),
      el('div', { class: 'sb-row' },
        sel('sb-variations', 'Files', [1, 2, 3, 4, 5, 8, 10].map((n) => [n, n === 1 ? 'Just this one' : `${n} variations`]), prefs.variations, 'variations'),
        sel('sb-rate', 'Sample rate', [[48000, '48 kHz'], [44100, '44.1 kHz']], prefs.sampleRate, 'sampleRate'),
        sel('sb-bits', 'Bits', [[16, '16-bit'], [24, '24-bit']], prefs.bits, 'bits')),
      el('div', { class: 'sb-row' },
        el('button', { class: 'action primary', id: 'sb-export', onclick: exportSound }, '⤓ Export WAV…'),
        el('button', { class: 'action', id: 'sb-save', onclick: savePreset }, '★ Save as my preset…')),
      el('p', { class: 'pref-hint', id: 'sb-export-status', text: 'Variations use the next seeds, so each file is a different take of the same sound. The recipe (.noorsound.json) is saved with them: open it later to make more or change it.' }),
    ];
  }

  function exportPrefs() { try { return { variations: 1, sampleRate: 48000, bits: 16, ...JSON.parse(localStorage.getItem('noormd.sound.export') || '{}') }; } catch { return { variations: 1, sampleRate: 48000, bits: 16 }; } }
  function saveExportPrefs(p) { try { localStorage.setItem('noormd.sound.export', JSON.stringify(p)); } catch { /* private storage off */ } }

  // ---------------------------------------------------------------- actions

  async function generate() {
    try {
      const r = await req('sound.generate', { category: genCategory, seed: Math.floor(Math.random() * 2147483646) + 1 });
      setRecipe(r, true);
      family = r.family;
      renderPresets();
    } catch (err) { hooks.showError(err); }
  }

  async function pickSample() {
    try { const f = await req('sound.sample.pick'); return f && !f.cancelled ? f : null; } catch (err) { hooks.showError(err); return null; }
  }

  function newVariation() {
    if (!recipe) return;
    recipe.seed = (recipe.seed + 1 + Math.floor(Math.random() * 100000)) % 2147483647;
    changed(false);
    notice(`Variation (seed ${recipe.seed})`, 900);
  }

  function pin() {
    if (!recipe) return;
    pinned = { recipe: clone(recipe) };
    listening = 'B';
    renderHeader();
    notice('Pinned as A. Change things, then press B (or A/B) to compare.', 2200);
  }

  function flipAB() {
    if (!pinned) return;
    listening = listening === 'A' ? 'B' : 'A';
    renderHeader();
    schedule(0);
  }

  async function exportSound() {
    const p = exportPrefs();
    const status = $('#sb-export-status');
    try {
      const r = await req('sound.export', { recipe, variations: p.variations, sampleRate: p.sampleRate, bits: p.bits });
      if (!r || r.cancelled) return;
      if (status) {
        status.replaceChildren(el('span', { text: `Saved ${r.files.length} file${r.files.length === 1 ? '' : 's'} and the recipe in ${r.folder}. ` }),
          el('button', { class: 'utility-btn', id: 'sb-reveal', onclick: () => req('sound.reveal', { folder: r.folder }).catch(hooks.showError) }, '📁 Open the folder'));
      }
      notice(`Exported ${r.files.join(', ')}`, 2600);
    } catch (err) { hooks.showError(err); }
  }

  async function savePreset() {
    const name = await NoorUI.prompt('Save as my preset', 'Name of the preset:', recipe.name, { okLabel: 'Save' });
    if (!name || !name.trim()) return;
    try {
      const r = await req('sound.save', { recipe: { ...recipe, name: name.trim() } });
      recipe.name = name.trim();
      presets.mine = r.mine;
      renderPresets(); renderHeader();
      notice(r.replaced ? 'Preset updated' : 'Saved in My presets', 1600);
    } catch (err) { hooks.showError(err); }
  }

  async function deletePreset(p) {
    if (!await NoorUI.confirm(`Delete “${p.name}”?`, 'Only the preset is deleted; sounds you exported stay.', 'Delete')) return;
    try { presets.mine = (await req('sound.delete', { id: p.id })).mine; renderPresets(); } catch (err) { hooks.showError(err); }
  }

  async function openRecipe() {
    try {
      const r = await req('sound.open');
      if (!r || r.cancelled) return;
      if (!isOpen()) await open();
      setRecipe(r.recipe, true);
      family = r.recipe.family;
      renderPresets();
    } catch (err) { hooks.showError(err); }
  }

  return {
    init, open, close, toggle, isOpen,
    /** Another player started: the preview stops. */
    stopForOther: () => { if (!audio.paused) audio.pause(); },
    _state: () => ({ recipe: recipe ? clone(recipe) : null, render: render ? { ...render, peaks: render.peaks.length } : null, playing: !audio.paused, src: audio.getAttribute('src'), history: history.length, future: future.length, pinned: !!pinned, listening, tab }),
  };
})();
