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
    if (fresh) { history.length = 0; future = []; pinned = null; listening = 'B'; }
    lastSnapshot = JSON.stringify(recipe);
    renderEditor();
    schedule(0);
  }

  /** Something changed: keep the step for undo (once the change settles) and render again shortly. */
  function changed(rebuild) {
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
          el('div', { class: 'music-tabs sb-tabs', role: 'tablist' }, ...[['quick', 'Quick'], ['layers', 'Layers'], ['output', 'Output & export']].map(([id, label]) =>
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
    pane.replaceChildren(...(tab === 'quick' ? quickPane() : tab === 'layers' ? layersPane() : outputPane()));
    pane.scrollTop = keep;
  }

  /** A slider bound to obj[key]; kinds make Hz and times logarithmic and show units. */
  function slider(obj, [key, label, min, max, step, kind], rebuild) {
    const log = (kind === 'hz' || kind === 'ms' || kind === 'rate' || kind === 'q') && min > 0;
    const toPos = (v) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
    const fromPos = (p) => (log ? min * Math.pow(max / min, p / 1000) : p);
    const show = (v) => kind === 'db' ? `${v > 0 ? '+' : ''}${v.toFixed(1)} dB` : kind === 'pct' ? `${Math.round(v * 100)}%` : kind === 'hz' || kind === 'hz0' ? (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`)
      : kind === 'ms' ? `${v.toFixed(v < 10 ? 1 : 0)} ms` : kind === 's' ? `${v.toFixed(v < 1 ? 3 : 2)} s` : kind === 'pan' ? (Math.abs(v) < 0.03 ? 'centre' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'L' : 'R'}`)
        : kind === 'count' ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
    const value = Number(obj[key]) || 0;
    const out = el('output', { text: show(value) });
    const input = el('input', { type: 'range', min: String(log ? 0 : min), max: String(log ? 1000 : max), step: String(log ? 1 : step), value: String(toPos(Math.max(min, Math.min(max, value)) || min)), 'aria-label': label, 'data-key': key });
    input.addEventListener('input', () => {
      let v = fromPos(Number(input.value));
      if (!log) v = Math.round(v / step) * step;
      obj[key] = Number(v.toFixed(4));
      out.textContent = show(obj[key]);
      changed(rebuild);
    });
    input.addEventListener('dblclick', () => { notice(`${label}: ${show(obj[key])}`, 900); });
    return el('label', { class: 'sb-slider' }, el('span', { text: label }), input, out);
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
    return [
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
          el('button', { class: 'icon-btn', title: 'Remove this layer', 'aria-label': 'Remove this layer', onclick: () => { recipe.layers.splice(i, 1); changed(true); } }, '✕')),
        el('div', { class: 'sb-choices' }, ...(l.type === 'noise' ? [choice('color'), choice('filter')]
          : l.type === 'synth' ? [choice('wave'), check('useFilter', 'Filter'), choice('filter')]
            : l.type === 'sample' ? [el('span', { class: 'sb-file', title: l.path || '', text: '🎵 ' + (l.sampleName || 'no file') }),
              el('button', { class: 'utility-btn', onclick: async () => { const f = await pickSample(); if (f) { l.path = f.path; l.sampleName = f.name; l.name = l.name === 'Sample' ? f.name.replace(/\.wav$/i, '') : l.name; changed(true); } } }, 'Change file…'),
              check('reverse', 'Backwards'), check('loopSample', 'Loop it'), check('useFilter', 'Filter'), choice('filter')] : [])),
        el('div', { class: 'sb-fields' }, ...fields.map((f) => slider(l, f, false))));
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
