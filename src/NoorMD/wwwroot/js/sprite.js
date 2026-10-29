// NoorSprite: pixel art and animation (docs/NOORSPRITE_PLAN.md), after the ideas of Aseprite and LibreSprite (no
// code of theirs). A sprite is layers × frames of cels, each cel a full-size straight-alpha RGBA picture (absent when
// empty). Every change makes a new snapshot of the sprite that shares the pictures it didn't touch, so undo is exact
// and cheap. The page draws and composes; the app reads and writes files (.noorsprite, .aseprite, PNG, GIF, sheets).
window.NoorSprite = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);

  const BLENDS = { normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', add: 'Add', difference: 'Difference' };
  const PALETTES = {
    'DawnBringer 32': '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30',
    'PICO-8': '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa',
    'Endesga 32': 'be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569',
    'Sweetie 16': '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57',
    'Game Boy': '0f380f 306230 8bac0f 9bbc0f',
    'NES-like': '7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000 bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888 f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878 fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8',
  };
  const TOOLS = [
    ['pencil', '✏️', 'Pencil (B)', 'b'], ['eraser', '🧽', 'Eraser (E)', 'e'], ['fill', '🪣', 'Fill (G)', 'g'], ['line', '╱', 'Line (L)', 'l'],
    ['rect', '▭', 'Rectangle (U)', 'u'], ['ellipse', '◯', 'Ellipse (O)', 'o'], ['picker', '💧', 'Eyedropper (I; or hold Alt)', 'i'],
    ['select', '⬚', 'Select a rectangle (M)', 'm'], ['eselect', '◌', 'Select an ellipse', null], ['lasso', '➰', 'Lasso (Q)', 'q'], ['wand', '🪄', 'Magic wand (W)', 'w'],
    ['move', '✥', 'Move (V): the selection, or the layer', 'v'], ['slice', '⧉', 'Slices (C): named rectangles — a 9-slice centre, a pivot', 'c'], ['hand', '✋', 'Hand (H; or hold Space)', 'h'],
  ];

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  let doc = null;           // the sprite: { width, height, palette, layers, frames, tags, gridWidth, gridHeight, cels: Map }
  let file = null;          // { path, name } of the file it came from / was saved as
  let layer = 0, frame = 0; // the layer (index, bottom first) and frame being drawn
  let tool = 'pencil';
  let fg = [0, 0, 0, 255], bg = [255, 255, 255, 255];
  let opts = { size: 1, round: false, perfect: true, contiguous: true, tolerance: 0, filled: false, mirrorX: false, mirrorY: false, ink: 'simple', dither: 0, custom: false };
  let brushImage = null;    // a brush cut from the sprite: { px, w, h }
  // Ordered dithering (a 4 × 4 Bayer matrix): a pixel is drawn when its cell is under the level (of 16).
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const DITHERS = [[0, 'solid'], [14, '88%'], [12, '75%'], [8, '50%'], [4, '25%'], [2, '12%']];
  let view = { zoom: 8, panX: 0, panY: 0, grid: false, pixelGrid: true, onion: false, onionBefore: 1, onionAfter: 1, onionAlpha: 0.35, slices: true };
  let selection = null;     // { mask: Uint8Array (W×H), x0, y0, x1, y1 } or null
  let floating = null;      // { px, w, h, x, y, fromKey } a lifted picture being moved
  let clip = null;          // { px, w, h } copied pixels
  let history = [], future = [], savedAt = null;
  let playing = null;       // { timer, tag }
  let drag = null;          // the gesture under way
  let hover = null;         // the pixel under the cursor
  let canvasSize = { w: 0, h: 0 };
  let paletteName = 'DawnBringer 32';

  const isOpen = () => document.body.classList.contains('sprite-open');
  const key = (l, f) => `${l}:${f}`;
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const parseHex = (h) => [1, 3, 5, 7].map((i) => (h.length > i ? parseInt(h.slice(i, i + 2), 16) : 255));
  const newId = () => 'L' + Math.random().toString(36).slice(2, 9);

  function init(h) { hooks = { ...hooks, ...h }; }

  // ---------------------------------------------------------------- the sprite

  function blank(width, height, background) {
    const d = { width, height, palette: PALETTES[paletteName].split(' ').map((c) => `#${c}ff`), layers: [], frames: [{ duration: 100 }], tags: [], slices: [], tilesets: [], gridWidth: 16, gridHeight: 16, cels: new Map() };
    const id = newId();
    d.layers.push({ id, name: background ? 'Background' : 'Layer 1', visible: true, locked: false, opacity: 255, blend: 'normal' });
    if (background) {
      const px = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) px.set(background, i * 4);
      d.cels.set(key(id, 0), { px, opacity: 255 });
    }
    return d;
  }

  /** A new snapshot of the sprite: the pictures are shared until something replaces one. */
  const snapshot = (d) => ({ ...d, palette: [...d.palette], layers: d.layers.map((l) => ({ ...l })), frames: d.frames.map((f) => ({ ...f })), tags: d.tags.map((t) => ({ ...t })), slices: (d.slices || []).map((x) => ({ ...x })), tilesets: (d.tilesets || []).map((t) => ({ ...t, tiles: [...t.tiles] })), cels: new Map(d.cels) });

  /** A change: the sprite before it kept for undo (with where we were), then the change made to a fresh snapshot. */
  function change(label, fn) {
    history.push({ label, doc, layer, frame });
    if (history.length > 200) { history.shift(); if (savedAt && !history.includes(savedAt)) savedAt = 'lost'; }
    future = [];
    const prev = doc;
    doc = snapshot(doc);
    fn(doc);
    normalizeTilemaps(doc, prev);
    layer = Math.max(0, Math.min(doc.layers.length - 1, layer));
    frame = Math.max(0, Math.min(doc.frames.length - 1, frame));
    afterChange();
  }

  function undo(redo) {
    const from = redo ? future : history, to = redo ? history : future;
    if (!from.length) return;
    commitFloating();
    const step = from.pop();
    to.push({ label: step.label, doc, layer, frame });
    doc = step.doc; layer = Math.min(step.layer, doc.layers.length - 1); frame = Math.min(step.frame, doc.frames.length - 1);
    selection = null;
    afterChange();
    notice(`${redo ? 'Redone' : 'Undone'}: ${step.label}`, 1000);
  }

  const dirty = () => (history.length ? history[history.length - 1] : null) !== savedAt;

  function afterChange() { renderAll(); setTimeout(keepFocus, 0); } // (after a dialog that made the change has closed)

  const cel = (l = layer, f = frame) => doc.cels.get(key(doc.layers[l].id, f)) || null;

  /**
   * A cel put in place; a linked cel (one picture on several frames) puts the same picture on every frame it is
   * linked to, so drawing on one draws on all.
   */
  function putCel(d, k, c) {
    const old = d.cels.get(k), link = old && old.link;
    const next = link ? { ...c, link } : c;
    d.cels.set(k, next);
    if (!link) return;
    const lid = k.slice(0, k.lastIndexOf(':'));
    for (const [k2, c2] of d.cels) if (k2 !== k && c2.link === link && k2.slice(0, k2.lastIndexOf(':')) === lid) d.cels.set(k2, { ...next });
  }

  /** How many frames a cel's picture is on (1 when it isn't linked). */
  function linkCount(l = layer, f = frame) {
    const c = cel(l, f);
    if (!c || !c.link) return 1;
    let n = 0;
    for (const [k, c2] of doc.cels) if (c2.link === c.link && k.slice(0, k.lastIndexOf(':')) === doc.layers[l].id) n++;
    return n;
  }

  /** The current cel's pixels to draw into: a copy (the old stays with undo), or a new empty one. */
  function editable(d = doc) {
    const k = key(d.layers[layer].id, frame);
    const old = d.cels.get(k);
    const px = old ? new Uint8ClampedArray(old.px) : new Uint8ClampedArray(d.width * d.height * 4);
    putCel(d, k, { px, opacity: old ? old.opacity : 255 });
    return px;
  }

  // ---------------------------------------------------------------- composing (the same for showing and exporting)

  function blendChannel(mode, b, s) {
    switch (mode) {
      case 'multiply': return (b * s) / 255;
      case 'screen': return b + s - (b * s) / 255;
      case 'overlay': return b < 128 ? (2 * b * s) / 255 : 255 - (2 * (255 - b) * (255 - s)) / 255;
      case 'darken': return Math.min(b, s);
      case 'lighten': return Math.max(b, s);
      case 'add': return Math.min(255, b + s);
      case 'difference': return Math.abs(b - s);
      default: return s;
    }
  }

  /** A frame composed from its visible layers (straight alpha, 0–255); `only` limits it to some layers. */
  /** forExport: without reference layers (shown while drawing, never exported). */
  function compose(f, d = doc, only = null, forExport = false) {
    const n = d.width * d.height, out = new Uint8ClampedArray(n * 4);
    d.layers.forEach((l, li) => {
      if (only ? !only.includes(li) : !l.visible) return;
      if (forExport && l.reference) return;
      const c = d.cels.get(key(l.id, f));
      if (!c) return;
      const k = (l.opacity / 255) * (c.opacity / 255);
      if (k <= 0) return;
      const px = c.px;
      for (let i = 0; i < n; i++) {
        const o = i * 4, sa = (px[o + 3] / 255) * k;
        if (sa <= 0) continue;
        const ba = out[o + 3] / 255;
        const ra = sa + ba * (1 - sa);
        for (let ch = 0; ch < 3; ch++) {
          const s = px[o + ch], b = out[o + ch];
          // The blend shows only over what is there; over nothing the layer's own colour.
          const mixed = l.blend === 'normal' ? s : (1 - ba) * s + ba * blendChannel(l.blend, b, s);
          out[o + ch] = Math.round((mixed * sa + b * ba * (1 - sa)) / ra);
        }
        out[o + 3] = Math.round(ra * 255);
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- building

  function build() {
    built = true;
    const root = el('section', { id: 'spritebench', class: 'spritebench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'NoorSprite' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '👾' }), el('strong', { text: 'NoorSprite' }), el('small', { id: 'sp-file' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'sp-new', title: 'New sprite (Ctrl+N here)', 'aria-label': 'New sprite', onclick: newDialog }, '🆕'),
          el('button', { class: 'icon-btn', id: 'sp-open', title: 'Open a sprite (.noorsprite, .aseprite) or a PNG (Ctrl+O here)', 'aria-label': 'Open', onclick: openFile }, '📂'),
          el('button', { class: 'icon-btn', id: 'sp-save', title: 'Save (Ctrl+S here; Ctrl+Shift+S: save as)', 'aria-label': 'Save', onclick: () => save(false) }, '💾'),
          el('button', { class: 'icon-btn', id: 'sp-export', title: 'Export: PNG, frames, a sprite sheet with JSON, an animated GIF (Ctrl+E here)', 'aria-label': 'Export', onclick: exportDialog }, '⤓'),
          el('button', { class: 'icon-btn', id: 'sp-menu', title: 'Sprite and edit: canvas size, scale, flip, rotate, crop, import a sheet…', 'aria-label': 'More', onclick: (e) => moreMenu(e.currentTarget) }, '☰'),
          NoorDock.fullButton('NoorSprite'),
          el('button', { class: 'icon-btn', title: 'Where this panel goes', 'aria-label': 'Move NoorSprite', onclick: (e) => NoorDock.showMenu('sprite', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+P)', 'aria-label': 'Close NoorSprite', onclick: close }, '✕'))),
      el('div', { class: 'sp-main' },
        el('div', { class: 'sp-left' },
          el('div', { class: 'sp-tools', id: 'sp-tools', role: 'toolbar', 'aria-label': 'Tools' }),
          el('div', { class: 'sp-colors' },
            el('button', { class: 'sp-swatch sp-fg', id: 'sp-fg', title: 'The colour you draw with (click to choose; X swaps)', 'aria-label': 'Foreground colour', onclick: () => pickColour('fg') }),
            el('button', { class: 'sp-swatch sp-bg', id: 'sp-bg', title: 'The second colour (right button draws with it)', 'aria-label': 'Background colour', onclick: () => pickColour('bg') }),
            el('button', { class: 'icon-btn sp-swap', title: 'Swap (X)', 'aria-label': 'Swap colours', onclick: swapColours }, '⇄')),
          el('div', { class: 'sp-palette-head' },
            el('select', { id: 'sp-palette-pick', 'aria-label': 'Palette' }),
            el('button', { class: 'icon-btn', title: 'Add the colour to the palette', 'aria-label': 'Add to palette', onclick: addToPalette }, '＋'),
            el('button', { class: 'icon-btn', id: 'sp-palmenu', title: 'Palette: sort, a ramp, the sprite\'s colours, load and save…', 'aria-label': 'Palette menu', onclick: paletteMenu }, '⋯')),
          el('div', { class: 'sp-palette', id: 'sp-palette', role: 'listbox', 'aria-label': 'Palette (click: draw with it; right-click: second colour; Shift+click: remove)' })),
        el('div', { class: 'sp-centre' },
          el('div', { class: 'sp-options', id: 'sp-options' }),
          el('div', { class: 'sp-stage', id: 'sp-stage' },
            el('canvas', { id: 'sp-canvas', class: 'sp-canvas', role: 'img', 'aria-label': 'The sprite: draw on it' })),
          el('div', { class: 'sp-status', id: 'sp-status', 'aria-live': 'polite' })),
        el('div', { class: 'sp-right' },
          el('div', { class: 'sp-preview-box' }, el('canvas', { id: 'sp-preview', class: 'sp-preview', role: 'img', 'aria-label': 'Preview at real size' }),
            el('small', { class: 'pref-hint', id: 'sp-preview-label' })),
          el('div', { class: 'sp-layerprops', id: 'sp-layerprops' }),
          el('div', { class: 'sp-tileset', id: 'sp-tileset', hidden: true }),
          el('div', { class: 'sp-viewopts', id: 'sp-viewopts' }))),
      el('div', { class: 'sp-timeline', id: 'sp-timeline' }));
    ($('#app') || document.body).append(root);
    root.addEventListener('keydown', onKey);
    // A key with nothing focused (a dialog closed, a redrawn button gone) goes to NoorSprite while it is showing.
    document.addEventListener('keydown', (e) => {
      if (!isOpen() || NoorUI.hasOpenModal() || e.defaultPrevented || (document.activeElement && document.activeElement !== document.body) || !root.offsetParent) return;
      root.focus({ preventScroll: true });
      onKey(e);
    });
    root.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceHeld = false; setCursor(); } if (e.key === 'Alt') { altHeld = false; setCursor(); } });
    const cv = $('#sp-canvas');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', () => { hover = null; draw(); status(); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', onWheel, { passive: false });
    new ResizeObserver(() => { fitCanvas(); draw(); }).observe($('#sp-stage'));
    $('#sp-palette-pick').replaceChildren(...Object.keys(PALETTES).map((p) => el('option', { value: p, text: p })), el('option', { value: '', text: 'The sprite\'s own' }));
    $('#sp-palette-pick').addEventListener('change', (e) => {
      if (!e.target.value) return;
      paletteName = e.target.value;
      const colours = PALETTES[paletteName].split(' ').map((c) => `#${c}ff`);
      change('Palette', (d) => { d.palette = colours; });
    });
  }

  let spaceHeld = false, altHeld = false;

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('sprite');
    document.body.classList.add('sprite-open');
    $('#spritebench').hidden = false;
    if (!doc) { doc = blank(32, 32, null); fitZoom(); }
    renderAll();
    $('#spritebench').focus({ preventScroll: true });
    offerDraft();
  }

  async function close() {
    if (!built || !isOpen()) return;
    stop();
    document.body.classList.remove('sprite-open');
    $('#spritebench').hidden = true;
    if (window.NoorDock) NoorDock.closed('sprite');
  }

  const toggle = () => (isOpen() ? close() : open());

  function renderAll() {
    if (!built || !doc) return;
    $('#sp-file').textContent = `${file ? file.name : 'Untitled'}${dirty() ? ' •' : ''} · ${doc.width} × ${doc.height} · ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'} · ${doc.frames.length} frame${doc.frames.length === 1 ? '' : 's'}`;
    renderTools(); renderColours(); renderPalette(); renderOptions(); renderLayerProps(); renderViewOpts(); renderTimeline(); renderSlicePanel(); renderTileset();
    fitCanvas(); draw(); drawPreview(); status();
    keepFocus();
  }

  function renderTools() {
    $('#sp-tools').replaceChildren(...TOOLS.map(([id, icon, title]) => el('button', { class: 'icon-btn sp-tool' + (tool === id ? ' on' : ''), 'data-tool': id, title, 'aria-label': title, 'aria-pressed': String(tool === id), onclick: () => setTool(id) }, icon)));
  }

  function setTool(t) { if (t !== 'move') commitFloating(); if (tilesOn() && !['pencil', 'eraser', 'fill', 'picker', 'hand', 'slice'].includes(t)) tileMode = false; tool = t; renderTileset(); renderTools(); renderOptions(); renderSlicePanel(); setCursor(); draw(); keepFocus(); }

  function renderColours() {
    $('#sp-fg').style.setProperty('--c', `rgba(${fg[0]},${fg[1]},${fg[2]},${fg[3] / 255})`);
    $('#sp-bg').style.setProperty('--c', `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3] / 255})`);
    $('#sp-fg').title = `The colour you draw with: ${hex(fg)} (click to choose; X swaps)`;
  }

  function swapColours() { [fg, bg] = [bg, fg]; renderColours(); renderPalette(); }

  function renderPalette() {
    const box = $('#sp-palette');
    if (!box) return;
    // The menu names a palette only when the sprite's is that one.
    const named = Object.keys(PALETTES).find((n) => PALETTES[n].split(' ').map((c) => `#${c}ff`).join() === doc.palette.join());
    $('#sp-palette-pick').value = named || '';
    const current = hex(fg);
    box.replaceChildren(...doc.palette.map((c, i) => el('button', { class: 'sp-pal' + (c === current ? ' on' : ''), 'data-index': String(i), 'data-colour': c, title: `${c} (click: draw with it; right-click: second colour; double-click: change it; Shift+click: remove)`, style: `--c:${c}`,
      onclick: (e) => { if (e.shiftKey) { change('Remove a colour', (d) => { d.palette.splice(i, 1); }); return; } fg = parseHex(c); renderColours(); renderPalette(); keepFocus(); },
      ondblclick: () => editSwatch(i),
      oncontextmenu: (e) => { e.preventDefault(); bg = parseHex(c); renderColours(); } })));
  }

  function addToPalette() {
    const c = hex(fg);
    if (doc.palette.includes(c)) { notice('That colour is in the palette already', 1200); return; }
    if (doc.palette.length >= 256) { notice('A palette holds 256 colours', 1500); return; }
    change('Add a colour', (d) => { d.palette.push(c); });
  }

  /** A colour chosen in a small dialog: the picker, hex (with alpha), alpha. */
  function pickColour(which) {
    const cur = which === 'fg' ? fg : bg;
    NoorUI.modal({ label: which === 'fg' ? 'Drawing colour' : 'Second colour', width: 340 }, (s, closeIt) => {
      const picker = el('input', { type: 'color', value: hex(cur).slice(0, 7), 'aria-label': 'Colour' });
      const hexIn = el('input', { type: 'text', value: hex(cur), 'aria-label': 'Hex (#rrggbbaa)', maxlength: '9', spellcheck: 'false' });
      const alpha = el('input', { type: 'range', min: '0', max: '255', value: String(cur[3]), 'aria-label': 'Alpha' });
      const sync = (from) => {
        if (from === 'hex' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hexIn.value)) { const c = parseHex(hexIn.value.toLowerCase()); picker.value = hex(c).slice(0, 7); alpha.value = String(c[3]); }
        else if (from !== 'hex') hexIn.value = picker.value + Number(alpha.value).toString(16).padStart(2, '0');
      };
      picker.addEventListener('input', () => sync('picker')); alpha.addEventListener('input', () => sync('alpha')); hexIn.addEventListener('input', () => sync('hex'));
      const ok = () => {
        const c = parseHex((/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hexIn.value) ? hexIn.value : picker.value + 'ff').toLowerCase());
        if (which === 'fg') fg = c; else bg = c;
        renderColours(); renderPalette(); closeIt();
      };
      s.append(NoorUI.head(which === 'fg' ? 'Drawing colour' : 'Second colour', closeIt),
        el('div', { class: 'modal-body sp-colourdlg' }, el('label', {}, 'Colour ', picker), el('label', {}, 'Hex ', hexIn), el('label', {}, 'Alpha ', alpha)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-colour-ok', onclick: ok }, 'OK'))));
    });
  }

  function renderOptions() {
    const box = $('#sp-options');
    if (!box) return;
    const check = (k, label, title) => { const c = el('input', { type: 'checkbox', checked: opts[k] || undefined, 'data-opt': k }); c.addEventListener('change', () => { opts[k] = c.checked; keepFocus(); }); return el('label', { class: 'sb-inline', title }, c, el('span', { text: label })); };
    const num = (k, label, min, max, title) => {
      const i = el('input', { type: 'number', min: String(min), max: String(max), value: String(opts[k]), class: 'sb-num', 'data-opt': k, 'aria-label': label });
      i.addEventListener('change', () => { opts[k] = Math.max(min, Math.min(max, Math.round(Number(i.value) || min))); i.value = String(opts[k]); keepFocus(); });
      return el('label', { class: 'sb-inline', title }, el('span', { text: label }), i);
    };
    const parts = [];
    if (['pencil', 'eraser', 'line'].includes(tool)) parts.push(num('size', 'Size', 1, 64, 'The brush in pixels ([ and ])'), check('round', 'round', 'A round brush (else square)'));
    if (tool === 'pencil') {
      parts.push(check('perfect', 'pixel-perfect', 'Lines one pixel wide without doubled corners (size 1)'));
      const inkSel = el('select', { 'data-opt': 'ink', 'aria-label': 'Ink', title: 'Shading: each pixel steps along the palette (left click one way, right click the other)' }, el('option', { value: 'simple', text: 'plain' }), el('option', { value: 'shade', text: 'shading' }));
      inkSel.value = opts.ink; inkSel.addEventListener('change', () => { opts.ink = inkSel.value; keepFocus(); });
      const dith = el('select', { 'data-opt': 'dither', 'aria-label': 'Dithering', title: 'Draw only some pixels, in an even pattern (ordered dithering)' }, ...DITHERS.map(([v, l]) => el('option', { value: String(v), text: l })));
      dith.value = String(opts.dither); dith.addEventListener('change', () => { opts.dither = Number(dith.value); keepFocus(); });
      parts.push(el('label', { class: 'sb-inline' }, el('span', { text: 'Ink' }), inkSel), el('label', { class: 'sb-inline' }, el('span', { text: 'Pattern' }), dith));
      if (brushImage) parts.push(check('custom', `the brush cut from the sprite (${brushImage.w} × ${brushImage.h})`, 'Draw with the picture cut with Ctrl+B'));
      else parts.push(el('span', { class: 'pref-hint', text: 'Ctrl+B: a brush from the selection' }));
    }
    if (['pencil', 'eraser', 'line', 'rect', 'ellipse', 'fill'].includes(tool)) parts.push(check('mirrorX', 'mirror ↔', 'Draw the other side too, mirrored left to right'), check('mirrorY', 'mirror ↕', 'Draw the other half too, mirrored top to bottom'));
    if (tool === 'fill' || tool === 'wand') parts.push(check('contiguous', 'touching only', 'Only the area touching the click (else every pixel of that colour)'), num('tolerance', 'Tolerance', 0, 255, 'How different a colour may be and still count as the same'));
    if (tool === 'rect' || tool === 'ellipse') parts.push(check('filled', 'filled', 'Filled (else only the outline); Shift: a square or a circle'));
    if (['select', 'eselect', 'lasso', 'wand'].includes(tool)) parts.push(el('span', { class: 'pref-hint', text: 'Shift: add · Alt: take away · Ctrl+A all · Ctrl+D none · Ctrl+Shift+I turn round' }));
    if (tool === 'move') parts.push(el('span', { class: 'pref-hint', text: 'Drag or use the arrow keys (Shift: 10 px) · Enter puts it down' }));
    $('#sp-options').replaceChildren(el('strong', { text: (TOOLS.find((t) => t[0] === tool) || [])[2] || '' }), ...parts);
  }

  function renderLayerProps() {
    const box = $('#sp-layerprops');
    if (!box) return;
    const l = doc.layers[layer];
    const blend = el('select', { id: 'sp-blend', 'aria-label': 'Blend mode' }, ...Object.entries(BLENDS).map(([k, t]) => el('option', { value: k, text: t })));
    blend.value = l.blend;
    blend.addEventListener('change', () => change('Blend mode', (d) => { d.layers[layer].blend = blend.value; }));
    const op = el('input', { type: 'range', min: '0', max: '255', value: String(l.opacity), id: 'sp-opacity', 'aria-label': 'Layer opacity' });
    op.addEventListener('change', () => change('Layer opacity', (d) => { d.layers[layer].opacity = Number(op.value); }));
    const c = cel();
    const cop = el('input', { type: 'range', min: '0', max: '255', value: String(c ? c.opacity : 255), id: 'sp-celopacity', 'aria-label': 'Cel opacity', disabled: !c || undefined });
    cop.addEventListener('change', () => change('Cel opacity', (d) => { const k = key(d.layers[layer].id, frame); const old = d.cels.get(k); if (old) putCel(d, k, { ...old, opacity: Number(cop.value) }); }));
    const dur = el('input', { type: 'number', min: '1', max: '65535', value: String(doc.frames[frame].duration), class: 'sb-num', id: 'sp-duration', 'aria-label': 'Frame duration (ms)' });
    dur.addEventListener('change', () => { const v = Math.max(1, Math.min(65535, Math.round(Number(dur.value) || 100))); change('Frame duration', (d) => { d.frames[frame].duration = v; }); });
    box.replaceChildren(...[
      el('h4', { class: 'music-subhead', text: `Layer “${l.name}”` }),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Blend' }), blend),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Opacity' }), op),
      (() => { const c2 = el('input', { type: 'checkbox', id: 'sp-reference', checked: l.reference || undefined }); c2.addEventListener('change', () => change(c2.checked ? 'A reference layer' : 'Not a reference layer', (d) => { d.layers[layer].reference = c2.checked; })); return el('label', { class: 'sb-inline', title: 'A picture to draw over or trace: shown here, never exported' }, c2, el('span', { text: 'reference (not exported)' })); })(),
      el('label', { class: 'sb-inline', title: 'This frame\'s picture on the layer' }, el('span', { text: 'Cel opacity' }), cop),
      c && c.link ? el('div', { class: 'sb-row', id: 'sp-linkinfo' }, el('span', { class: 'pref-hint', text: `🔗 on ${linkCount()} frames` }), el('button', { class: 'utility-btn', id: 'sp-unlink', title: 'This frame gets a picture of its own', onclick: unlinkCel }, 'Unlink')) : null,
      el('h4', { class: 'music-subhead', text: `Frame ${frame + 1}` }),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Shows for (ms)' }), dur)].filter(Boolean));
  }

  function renderViewOpts() {
    const box = $('#sp-viewopts');
    if (!box) return;
    const check = (k, label, title) => { const c = el('input', { type: 'checkbox', checked: view[k] || undefined, 'data-view': k }); c.addEventListener('change', () => { view[k] = c.checked; draw(); keepFocus(); }); return el('label', { class: 'sb-inline', title }, c, el('span', { text: label })); };
    const gw = el('input', { type: 'number', min: '1', max: '512', value: String(doc.gridWidth), class: 'sb-num', 'aria-label': 'Grid width' });
    const gh = el('input', { type: 'number', min: '1', max: '512', value: String(doc.gridHeight), class: 'sb-num', 'aria-label': 'Grid height' });
    const setGrid = () => change('Grid size', (d) => { d.gridWidth = Math.max(1, Number(gw.value) || 16); d.gridHeight = Math.max(1, Number(gh.value) || 16); });
    gw.addEventListener('change', setGrid); gh.addEventListener('change', setGrid);
    const nb = el('input', { type: 'number', min: '0', max: '5', value: String(view.onionBefore), class: 'sb-num', 'aria-label': 'Onion skin: frames before' });
    const na = el('input', { type: 'number', min: '0', max: '5', value: String(view.onionAfter), class: 'sb-num', 'aria-label': 'Onion skin: frames after' });
    nb.addEventListener('change', () => { view.onionBefore = Math.max(0, Math.min(5, Number(nb.value) || 0)); draw(); });
    na.addEventListener('change', () => { view.onionAfter = Math.max(0, Math.min(5, Number(na.value) || 0)); draw(); });
    box.replaceChildren(
      el('h4', { class: 'music-subhead', text: 'View' }),
      check('pixelGrid', 'pixel grid', 'Lines between the pixels when zoomed in'),
      check('slices', 'slices', 'The slices\' outlines (always shown with the slice tool)'),
      el('div', { class: 'sb-row' }, check('grid', 'grid', 'A grid of your own (for tiles)'), gw, el('span', { text: '×' }), gh),
      el('div', { class: 'sb-row' }, check('onion', 'onion skin', 'The frames before (red) and after (blue), faint'), nb, el('span', { text: '/' }), na),
      el('div', { class: 'sb-row' },
        el('button', { class: 'icon-btn', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => zoomBy(-1) }, '−'),
        el('span', { id: 'sp-zoom', text: `${view.zoom * 100}%` }),
        el('button', { class: 'icon-btn', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => zoomBy(1) }, '+'),
        el('button', { class: 'utility-btn', title: 'The whole sprite in view (0)', onclick: () => { fitZoom(); draw(); } }, 'Fit')));
  }

  // ---------------------------------------------------------------- the timeline

  function renderTimeline() {
    const box = $('#sp-timeline');
    if (!box) return;
    const head = el('div', { class: 'sp-tl-row sp-tl-head' },
      el('div', { class: 'sp-tl-name' },
        el('button', { class: 'icon-btn', id: 'sp-play', title: 'Play / stop (Enter)', 'aria-label': playing ? 'Stop' : 'Play', onclick: () => (playing ? stop() : play()) }, playing ? '■' : '▶'),
        el('button', { class: 'icon-btn', id: 'sp-addframe', title: 'New frame: a copy of this one (Alt+N)', 'aria-label': 'New frame', onclick: () => addFrame(true) }, '＋'),
        el('button', { class: 'icon-btn', title: 'New empty frame', 'aria-label': 'New empty frame', onclick: () => addFrame(false) }, '□'),
        el('button', { class: 'icon-btn', id: 'sp-addlinked', title: 'New linked frame: the same pictures, drawn once for both (Alt+Shift+N)', 'aria-label': 'New linked frame', onclick: () => addFrame(true, true) }, '🔗'),
        el('button', { class: 'icon-btn', id: 'sp-delframe', title: 'Remove this frame', 'aria-label': 'Remove the frame', disabled: doc.frames.length < 2 || undefined, onclick: removeFrame }, '🗑'),
        el('button', { class: 'icon-btn', title: 'Move the frame earlier', 'aria-label': 'Frame earlier', onclick: () => moveFrame(-1) }, '◀'),
        el('button', { class: 'icon-btn', title: 'Move the frame later', 'aria-label': 'Frame later', onclick: () => moveFrame(1) }, '▶'),
        el('button', { class: 'icon-btn', id: 'sp-addtag', title: 'A tag over frames (an animation: walk, jump…)', 'aria-label': 'New tag', onclick: () => tagDialog(null) }, '🏷')),
      ...doc.frames.map((f, i) => el('button', { class: 'sp-tl-frame' + (i === frame ? ' on' : ''), 'data-frame': String(i), title: `Frame ${i + 1}: ${f.duration} ms (double-click: duration)`, onclick: () => goFrame(i), ondblclick: () => frameDialog(i) },
        el('span', { text: String(i + 1) }), el('small', { text: `${f.duration}` }))));
    const tags = doc.tags.length ? el('div', { class: 'sp-tl-row sp-tl-tags' }, el('div', { class: 'sp-tl-name' }, el('small', { class: 'pref-hint', text: 'Tags' })),
      el('div', { class: 'sp-tl-tagband', style: `grid-template-columns: repeat(${doc.frames.length}, var(--sp-cell))` },
        ...doc.tags.map((t, ti) => el('button', { class: 'sp-tag', 'data-tag': String(ti), style: `grid-column: ${t.from + 1} / ${t.to + 2}; --c:${t.color.slice(0, 7)}`, title: `${t.name}: frames ${t.from + 1}–${t.to + 1}, ${t.direction} (click: play it; double-click: change)`,
          onclick: () => play(ti), ondblclick: () => tagDialog(ti) }, t.name)))) : null;
    const rows = [...doc.layers.keys()].reverse().map((li) => {
      const l = doc.layers[li];
      return el('div', { class: 'sp-tl-row' + (li === layer ? ' on' : ''), 'data-layer': String(li) },
        el('div', { class: 'sp-tl-name', onclick: () => { layer = li; renderAll(); keepFocus(); }, ondblclick: () => renameLayer(li) },
          el('button', { class: 'icon-btn', 'aria-pressed': String(l.visible), title: l.visible ? 'Shown (click to hide)' : 'Hidden', 'aria-label': `Show ${l.name}`, onclick: (e) => { e.stopPropagation(); change(l.visible ? 'Hide a layer' : 'Show a layer', (d) => { d.layers[li].visible = !l.visible; }); } }, l.visible ? '👁' : '◌'),
          el('button', { class: 'icon-btn', 'aria-pressed': String(l.locked), title: l.locked ? 'Locked (click to unlock)' : 'Unlocked', 'aria-label': `Lock ${l.name}`, onclick: (e) => { e.stopPropagation(); change(l.locked ? 'Unlock a layer' : 'Lock a layer', (d) => { d.layers[li].locked = !l.locked; }); } }, l.locked ? '🔒' : '🔓'),
          el('span', { class: 'sp-layername' + (l.reference ? ' ref' : ''), text: (l.reference ? '📌 ' : l.kind === 'tilemap' ? '▦ ' : '') + l.name })),
        ...doc.frames.map((_, fi) => {
          const c = doc.cels.get(key(l.id, fi));
          return el('button', { class: 'sp-tl-cel' + (c ? ' full' : '') + (c && c.link ? ' linked' : '') + (fi === frame && li === layer ? ' on' : ''), 'data-cel': `${li}:${fi}`, title: c ? (c.link ? 'A picture linked to other frames (drawn once for all)' : 'A picture on this frame') : 'Empty', 'aria-label': `${l.name}, frame ${fi + 1}`, onclick: () => { layer = li; goFrame(fi); } });
        }));
    });
    const layerBar = el('div', { class: 'sp-tl-row sp-tl-foot' }, el('div', { class: 'sp-tl-name' },
      el('button', { class: 'icon-btn', id: 'sp-addlayer', title: 'New layer (Shift+N)', 'aria-label': 'New layer', onclick: addLayer }, '＋'),
      el('button', { class: 'icon-btn', id: 'sp-addtilemap', title: 'New tilemap layer: draw with tiles of the grid\'s size', 'aria-label': 'New tilemap layer', onclick: addTilemapLayer }, '▦'),
      el('button', { class: 'icon-btn', title: 'Duplicate the layer', 'aria-label': 'Duplicate the layer', onclick: duplicateLayer }, '⧉'),
      el('button', { class: 'icon-btn', id: 'sp-dellayer', title: 'Remove the layer', 'aria-label': 'Remove the layer', disabled: doc.layers.length < 2 || undefined, onclick: removeLayer }, '🗑'),
      el('button', { class: 'icon-btn', title: 'Layer up', 'aria-label': 'Layer up', onclick: () => moveLayer(1) }, '↑'),
      el('button', { class: 'icon-btn', title: 'Layer down', 'aria-label': 'Layer down', onclick: () => moveLayer(-1) }, '↓'),
      el('button', { class: 'icon-btn', id: 'sp-merge', title: 'Merge down into the layer below', 'aria-label': 'Merge down', disabled: layer === 0 || undefined, onclick: mergeDown }, '⤓')));
    box.replaceChildren(head, ...(tags ? [tags] : []), ...rows, layerBar);
    const on = box.querySelector('.sp-tl-frame.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function goFrame(i) { commitFloating(); frame = Math.max(0, Math.min(doc.frames.length - 1, i)); renderAll(); keepFocus(); }

  /** A new frame after this one: a copy, empty, or linked (the same pictures, drawn on once for both). */
  function addFrame(copy, linked = false) {
    change(linked ? 'New linked frame' : copy ? 'New frame' : 'New empty frame', (d) => {
      const at = frame + 1;
      d.frames.splice(at, 0, { duration: d.frames[frame].duration });
      shiftFrames(d, at, 1);
      if (copy) d.layers.forEach((l) => {
        const c = d.cels.get(key(l.id, frame));
        if (!c) return;
        if (linked) {
          const lc = { ...c, link: c.link || 'k' + Math.random().toString(36).slice(2, 9) };
          d.cels.set(key(l.id, frame), lc); d.cels.set(key(l.id, at), { ...lc });
        } else { const { link, ...plain } = c; void link; d.cels.set(key(l.id, at), plain); }
      });
      frame = at;
    });
  }

  function unlinkCel() {
    change('Unlink', (d) => {
      const lid = d.layers[layer].id, k = key(lid, frame), c = d.cels.get(k);
      if (!c || !c.link) return;
      const { link, ...plain } = c;
      d.cels.set(k, plain);
      // A frame left alone with the link has nothing to be linked to.
      const rest = [...d.cels].filter(([k2, c2]) => c2.link === link && k2.slice(0, k2.lastIndexOf(':')) === lid);
      if (rest.length === 1) { const { link: l2, ...p2 } = rest[0][1]; void l2; d.cels.set(rest[0][0], p2); }
    });
  }

  /** Cels from frame `from` on move by `by` frames (making room, or closing a gap). */
  function shiftFrames(d, from, by) {
    const moved = [];
    for (const [k, c] of d.cels) { const [l, f] = [k.slice(0, k.lastIndexOf(':')), Number(k.slice(k.lastIndexOf(':') + 1))]; if (f >= from) moved.push([l, f, c]); }
    for (const [l, f] of moved) d.cels.delete(key(l, f));
    for (const [l, f, c] of moved) if (f + by >= 0) d.cels.set(key(l, f + by), c);
    d.tags.forEach((t) => { if (t.from >= from) t.from = Math.max(0, t.from + by); if (t.to >= from) t.to = Math.max(t.from, t.to + by); });
  }

  function removeFrame() {
    if (doc.frames.length < 2) return;
    change('Remove a frame', (d) => {
      d.layers.forEach((l) => d.cels.delete(key(l.id, frame)));
      d.frames.splice(frame, 1);
      shiftFrames(d, frame + 1, -1);
      d.tags = d.tags.filter((t) => t.from < d.frames.length).map((t) => ({ ...t, to: Math.min(t.to, d.frames.length - 1) }));
    });
  }

  function moveFrame(by) {
    const to = frame + by;
    if (to < 0 || to >= doc.frames.length) return;
    change('Move a frame', (d) => {
      [d.frames[frame], d.frames[to]] = [d.frames[to], d.frames[frame]];
      d.layers.forEach((l) => { const a = d.cels.get(key(l.id, frame)), b = d.cels.get(key(l.id, to)); d.cels.delete(key(l.id, frame)); d.cels.delete(key(l.id, to)); if (a) d.cels.set(key(l.id, to), a); if (b) d.cels.set(key(l.id, frame), b); });
      frame = to;
    });
  }

  function addLayer() {
    change('New layer', (d) => {
      d.layers.splice(layer + 1, 0, { id: newId(), name: `Layer ${d.layers.length + 1}`, visible: true, locked: false, opacity: 255, blend: 'normal' });
      layer++;
    });
  }

  function duplicateLayer() {
    change('Duplicate a layer', (d) => {
      const src = d.layers[layer], id = newId();
      d.layers.splice(layer + 1, 0, { ...src, id, name: `${src.name} copy` });
      d.frames.forEach((_, f) => { const c = d.cels.get(key(src.id, f)); if (c) d.cels.set(key(id, f), c); });
      layer++;
    });
  }

  function removeLayer() {
    if (doc.layers.length < 2) return;
    change('Remove a layer', (d) => {
      const id = d.layers[layer].id;
      d.frames.forEach((_, f) => d.cels.delete(key(id, f)));
      d.layers.splice(layer, 1);
      layer = Math.max(0, layer - 1);
    });
  }

  function moveLayer(by) {
    const to = layer + by;
    if (to < 0 || to >= doc.layers.length) return;
    change('Move a layer', (d) => { [d.layers[layer], d.layers[to]] = [d.layers[to], d.layers[layer]]; layer = to; });
  }

  function mergeDown() {
    if (layer === 0) return;
    change('Merge down', (d) => {
      const top = d.layers[layer], below = d.layers[layer - 1];
      d.frames.forEach((_, f) => {
        if (!d.cels.get(key(top.id, f))) return;
        const merged = compose(f, { ...d, layers: [{ ...below, visible: true, opacity: 255, blend: 'normal' }, { ...top, visible: true }] });
        const keepBelow = d.cels.get(key(below.id, f));
        // The layer below keeps its own opacity and blend; the cel takes the merge.
        d.cels.set(key(below.id, f), { px: merged, opacity: keepBelow ? 255 : 255 });
        d.cels.delete(key(top.id, f));
      });
      d.layers.splice(layer, 1);
      layer--;
    });
  }

  async function renameLayer(li) {
    const name = await NoorUI.prompt('Rename layer', 'Name:', doc.layers[li].name, { okLabel: 'Rename' });
    if (name && name.trim()) change('Rename a layer', (d) => { d.layers[li].name = name.trim().slice(0, 64); });
  }

  async function frameDialog(i) {
    const v = await NoorUI.prompt(`Frame ${i + 1}`, 'How long it shows (milliseconds):', String(doc.frames[i].duration), { type: 'number', okLabel: 'Set' });
    if (v === undefined || v === null || v === '') return;
    const ms = Math.max(1, Math.min(65535, Math.round(Number(v) || 100)));
    change('Frame duration', (d) => { d.frames[i].duration = ms; });
  }

  function tagDialog(ti) {
    const t = ti === null ? { name: `Tag ${doc.tags.length + 1}`, from: frame, to: frame, direction: 'forward', color: '#3c6ad4ff' } : { ...doc.tags[ti] };
    NoorUI.modal({ label: ti === null ? 'New tag' : 'Tag', width: 380 }, (s, closeIt) => {
      const name = el('input', { type: 'text', value: t.name, maxlength: '64', id: 'sp-tag-name', 'aria-label': 'Name' });
      const from = el('input', { type: 'number', min: '1', max: String(doc.frames.length), value: String(t.from + 1), id: 'sp-tag-from', 'aria-label': 'From frame' });
      const to = el('input', { type: 'number', min: '1', max: String(doc.frames.length), value: String(t.to + 1), id: 'sp-tag-to', 'aria-label': 'To frame' });
      const dir = el('select', { id: 'sp-tag-dir', 'aria-label': 'Direction' }, ...[['forward', 'Forward'], ['reverse', 'Reverse'], ['pingpong', 'Ping-pong']].map(([v, l]) => el('option', { value: v, text: l })));
      dir.value = t.direction;
      const colour = el('input', { type: 'color', value: t.color.slice(0, 7), 'aria-label': 'Colour' });
      const ok = () => {
        const a = Math.max(0, Math.min(doc.frames.length - 1, Number(from.value) - 1)), b = Math.max(a, Math.min(doc.frames.length - 1, Number(to.value) - 1));
        const tag = { name: name.value.trim() || 'Tag', from: a, to: b, direction: dir.value, color: colour.value + 'ff' };
        change(ti === null ? 'New tag' : 'Change a tag', (d) => { if (ti === null) d.tags.push(tag); else d.tags[ti] = tag; });
        closeIt();
      };
      s.append(NoorUI.head(ti === null ? 'New tag' : 'Tag', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'Name ', name), el('label', {}, 'Frames ', from, ' to ', to), el('label', {}, 'Plays ', dir), el('label', {}, 'Colour ', colour)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' },
          ...(ti === null ? [] : [el('button', { class: 'action', id: 'sp-tag-remove', onclick: () => { change('Remove a tag', (d) => { d.tags.splice(ti, 1); }); closeIt(); } }, 'Remove')]),
          el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-tag-ok', onclick: ok }, 'OK'))));
    });
  }

  // ---------------------------------------------------------------- playing

  function play(tagIndex = null) {
    stop();
    const t = tagIndex !== null ? doc.tags[tagIndex] : null;
    const from = t ? t.from : 0, to = t ? t.to : doc.frames.length - 1;
    let dir = t && t.direction === 'reverse' ? -1 : 1;
    if (t) frame = t.direction === 'reverse' ? to : from;
    playing = { tag: tagIndex };
    const step = () => {
      if (!playing) return;
      draw(); drawPreview(); renderTimelineFrameOnly();
      playing.timer = setTimeout(() => {
        if (!playing) return;
        let next = frame + dir;
        if (next > to || next < from) {
          if (t && t.direction === 'pingpong') { dir = -dir; next = frame + dir; if (next > to || next < from) next = frame; }
          else next = dir > 0 ? from : to;
        }
        frame = next;
        step();
      }, doc.frames[frame].duration);
    };
    renderTimeline();
    step();
  }

  function stop() { if (!playing) return; clearTimeout(playing.timer); playing = null; if (built) { renderTimeline(); renderLayerProps(); } }

  function renderTimelineFrameOnly() {
    document.querySelectorAll('#sp-timeline .sp-tl-frame').forEach((b) => b.classList.toggle('on', Number(b.dataset.frame) === frame));
    status();
  }

  // ---------------------------------------------------------------- the view

  function fitCanvas() {
    const stage = $('#sp-stage'), cv = $('#sp-canvas');
    if (!stage || !cv) return;
    const r = stage.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    canvasSize = { w, h };
  }

  function fitZoom() {
    fitCanvas();
    const w = canvasSize.w || 600, h = canvasSize.h || 400;
    view.zoom = Math.max(1, Math.min(64, Math.floor(Math.min((w - 40) / doc.width, (h - 40) / doc.height)) || 1));
    view.panX = 0; view.panY = 0;
  }

  function zoomBy(step, at) {
    const levels = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
    let i = levels.findIndex((z) => z >= view.zoom);
    if (i < 0) i = levels.length - 1;
    const z = levels[Math.max(0, Math.min(levels.length - 1, i + step))];
    if (at) {
      // Keep the pixel under the cursor where it is.
      const o = origin(), px = (at.x - o.x) / view.zoom, py = (at.y - o.y) / view.zoom;
      view.zoom = z;
      const o2 = origin();
      view.panX += at.x - (o2.x + px * z); view.panY += at.y - (o2.y + py * z);
    } else view.zoom = z;
    if ($('#sp-zoom')) $('#sp-zoom').textContent = `${view.zoom * 100}%`;
    draw();
  }

  /** Where the sprite's top-left pixel is on the canvas. */
  const origin = () => ({ x: Math.round(canvasSize.w / 2 - (doc.width * view.zoom) / 2 + view.panX), y: Math.round(canvasSize.h / 2 - (doc.height * view.zoom) / 2 + view.panY) });

  function toPixel(e) {
    const r = $('#sp-canvas').getBoundingClientRect(), o = origin();
    return { x: Math.floor((e.clientX - r.left - o.x) / view.zoom), y: Math.floor((e.clientY - r.top - o.y) / view.zoom), cx: e.clientX - r.left, cy: e.clientY - r.top };
  }

  const scratch = document.createElement('canvas');

  function pixelsToCanvas(px, w, h) {
    scratch.width = w; scratch.height = h;
    const ctx = scratch.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
    return scratch;
  }

  function draw() {
    const cv = $('#sp-canvas');
    if (!cv || !doc) return;
    const ctx = cv.getContext('2d'), z = view.zoom, o = origin(), W = doc.width * z, H = doc.height * z;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = getComputedStyle(cv).getPropertyValue('--sp-back') || '#1d1f24';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // A checkerboard under the transparency.
    const cell = Math.max(4, Math.min(16, z * 2));
    ctx.save(); ctx.beginPath(); ctx.rect(o.x, o.y, W, H); ctx.clip();
    for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) { ctx.fillStyle = ((x / cell + y / cell) & 1) ? '#c9c9c9' : '#f2f2f2'; ctx.fillRect(o.x + x, o.y + y, cell, cell); }
    // Onion skin: earlier frames reddish, later ones bluish, fainter further away.
    if (view.onion && !playing) {
      for (const [f, tint] of [...Array.from({ length: view.onionBefore }, (_, i) => [frame - i - 1, [255, 60, 60]]), ...Array.from({ length: view.onionAfter }, (_, i) => [frame + i + 1, [60, 120, 255]])]) {
        if (f < 0 || f >= doc.frames.length) continue;
        const px = compose(f);
        for (let i = 0; i < px.length; i += 4) { px[i] = (px[i] + tint[0]) / 2; px[i + 1] = (px[i + 1] + tint[1]) / 2; px[i + 2] = (px[i + 2] + tint[2]) / 2; }
        ctx.globalAlpha = view.onionAlpha / (Math.abs(f - frame));
        ctx.drawImage(pixelsToCanvas(px, doc.width, doc.height), o.x, o.y, W, H);
      }
      ctx.globalAlpha = 1;
    }
    const shown = composeShown();
    ctx.drawImage(pixelsToCanvas(shown, doc.width, doc.height), o.x, o.y, W, H);
    ctx.restore();
    // The pixel grid, and a grid of one's own.
    ctx.lineWidth = 1;
    if (view.pixelGrid && z >= 8) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath();
      for (let x = 1; x < doc.width; x++) { ctx.moveTo(o.x + x * z + 0.5, o.y); ctx.lineTo(o.x + x * z + 0.5, o.y + H); }
      for (let y = 1; y < doc.height; y++) { ctx.moveTo(o.x, o.y + y * z + 0.5); ctx.lineTo(o.x + W, o.y + y * z + 0.5); }
      ctx.stroke();
    }
    if (view.grid) {
      ctx.strokeStyle = 'rgba(40,120,255,0.55)'; ctx.beginPath();
      for (let x = doc.gridWidth; x < doc.width; x += doc.gridWidth) { ctx.moveTo(o.x + x * z + 0.5, o.y); ctx.lineTo(o.x + x * z + 0.5, o.y + H); }
      for (let y = doc.gridHeight; y < doc.height; y += doc.gridHeight) { ctx.moveTo(o.x, o.y + y * z + 0.5); ctx.lineTo(o.x + W, o.y + y * z + 0.5); }
      ctx.stroke();
    }
    if (isTilemap()) {
      // The tilemap's cells; in tile mode, the cell under the cursor with the tile that would go there.
      const ts = tilesetOf(), tw = ts.tw * z, th = ts.th * z;
      ctx.strokeStyle = tileMode ? 'rgba(255,170,40,0.6)' : 'rgba(255,170,40,0.25)'; ctx.beginPath();
      for (let x = tw; x < W; x += tw) { ctx.moveTo(o.x + x + 0.5, o.y); ctx.lineTo(o.x + x + 0.5, o.y + H); }
      for (let y = th; y < H; y += th) { ctx.moveTo(o.x, o.y + y + 0.5); ctx.lineTo(o.x + W, o.y + y + 0.5); }
      ctx.stroke();
      const at = tileMode && hover && !drag && cellAt(hover);
      if (at) {
        if (tool === 'pencil' && ts.tiles[tileSel]) { ctx.globalAlpha = 0.6; ctx.drawImage(pixelsToCanvas(ts.tiles[tileSel], ts.tw, ts.th), o.x + at.c * tw, o.y + at.r * th, tw, th); ctx.globalAlpha = 1; }
        ctx.strokeStyle = '#ffaa28'; ctx.lineWidth = 2; ctx.strokeRect(o.x + at.c * tw + 1, o.y + at.r * th + 1, tw - 2, th - 2); ctx.lineWidth = 1;
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(o.x - 0.5, o.y - 0.5, W + 1, H + 1);
    // The selection's edge (marching ants).
    if (selection) drawSelection(ctx, o, z);
    drawSlices(ctx, o, z);
    // The brush under the cursor.
    if (hover && ['pencil', 'eraser'].includes(tool) && !spaceHeld && !altHeld && !tilesOn()) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.setLineDash([]);
      for (const [x, y] of brushPoints(hover.x, hover.y)) ctx.strokeRect(o.x + x * z + 0.5, o.y + y * z + 0.5, z - 1, z - 1);
    }
  }

  /** The current frame as shown: the sprite, a shape being drawn and a lifted selection on top. */
  function composeShown() {
    if (!drag || !drag.preview) {
      if (!floating) return compose(frame);
    }
    const d = snapshot(doc);
    if (drag && drag.preview) {
      const k = key(d.layers[layer].id, frame);
      d.cels.set(k, { px: drag.preview, opacity: (d.cels.get(k) || { opacity: 255 }).opacity });
    }
    const out = compose(frame, d);
    if (floating) {
      const l = d.layers[layer];
      for (let y = 0; y < floating.h; y++) for (let x = 0; x < floating.w; x++) {
        const tx = floating.x + x, ty = floating.y + y;
        if (tx < 0 || ty < 0 || tx >= d.width || ty >= d.height || !l.visible) continue;
        const s = (y * floating.w + x) * 4, t = (ty * d.width + tx) * 4, a = floating.px[s + 3] / 255;
        if (a <= 0) continue;
        const ba = out[t + 3] / 255, ra = a + ba * (1 - a);
        for (let c = 0; c < 3; c++) out[t + c] = Math.round((floating.px[s + c] * a + out[t + c] * ba * (1 - a)) / ra);
        out[t + 3] = Math.round(ra * 255);
      }
    }
    return out;
  }

  function drawSelection(ctx, o, z) {
    const m = selection.mask, W = doc.width;
    const at = (x, y) => x >= 0 && y >= 0 && x < W && y < doc.height && m[y * W + x];
    ctx.save();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = selection.y0; y <= selection.y1; y++) for (let x = selection.x0; x <= selection.x1; x++) {
      if (!at(x, y)) continue;
      const X = o.x + x * z + 0.5, Y = o.y + y * z + 0.5;
      if (!at(x, y - 1)) { ctx.moveTo(X, Y); ctx.lineTo(X + z, Y); }
      if (!at(x, y + 1)) { ctx.moveTo(X, Y + z); ctx.lineTo(X + z, Y + z); }
      if (!at(x - 1, y)) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + z); }
      if (!at(x + 1, y)) { ctx.moveTo(X + z, Y); ctx.lineTo(X + z, Y + z); }
    }
    ctx.strokeStyle = '#000'; ctx.setLineDash([4, 4]); ctx.lineDashOffset = (performance.now() / 60) % 8; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineDashOffset += 4; ctx.stroke();
    ctx.restore();
  }

  function drawPreview() {
    const cv = $('#sp-preview');
    if (!cv || !doc) return;
    const scale = Math.max(1, Math.min(4, Math.floor(128 / Math.max(doc.width, doc.height))));
    cv.width = doc.width * scale; cv.height = doc.height * scale;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(pixelsToCanvas(compose(frame), doc.width, doc.height), 0, 0, cv.width, cv.height);
    $('#sp-preview-label').textContent = `${scale}× · frame ${frame + 1}/${doc.frames.length}${playing ? ' · playing' : ''}`;
  }

  function status() {
    const s = $('#sp-status');
    if (!s || !doc) return;
    const at = hover && hover.x >= 0 && hover.y >= 0 && hover.x < doc.width && hover.y < doc.height ? hover : null;
    let colour = '';
    if (at) { const px = compose(frame); const i = (at.y * doc.width + at.x) * 4; colour = ` · ${hex([px[i], px[i + 1], px[i + 2], px[i + 3]])}`; }
    const sel = selection ? ` · selection ${selection.x1 - selection.x0 + 1} × ${selection.y1 - selection.y0 + 1}` : '';
    let tile = '';
    if (isTilemap()) { const c = at && cellAt(at), n = c ? currentMap()[c.i] : 0; tile = ` · ${tileMode ? 'tiles' : 'pixels'}${c ? ` · cell ${c.c}, ${c.r}: ${n ? `tile ${n}` : 'none'}` : ''}`; }
    s.textContent = `${at ? `${at.x}, ${at.y}${colour}` : `${doc.width} × ${doc.height}`}${tile} · ${view.zoom * 100}%${sel} · ${doc.layers[layer].name}, frame ${frame + 1}${doc.layers[layer].locked ? ' (locked)' : ''}`;
  }

  function setCursor() {
    const cv = $('#sp-canvas');
    if (!cv) return;
    cv.dataset.cursor = spaceHeld || tool === 'hand' ? 'hand' : altHeld || tool === 'picker' ? 'picker' : tool === 'move' ? 'move' : 'cross';
  }

  /** A redrawn part keeps the keyboard in the bench. */
  function keepFocus() { if (isOpen() && !NoorUI.hasOpenModal() && (document.activeElement === document.body || !document.activeElement)) $('#spritebench').focus({ preventScroll: true }); }

  // ---------------------------------------------------------------- drawing

  /** The pixels a brush covers around a point (square or round, of the brush's size), mirrored as asked. */
  function brushPoints(x, y) {
    if (opts.custom && brushImage && tool === 'pencil') {
      const pts = [], ox = x - Math.floor(brushImage.w / 2), oy = y - Math.floor(brushImage.h / 2);
      for (let by = 0; by < brushImage.h; by++) for (let bx = 0; bx < brushImage.w; bx++) if (brushImage.px[(by * brushImage.w + bx) * 4 + 3]) pts.push([ox + bx, oy + by]);
      return mirrored(pts);
    }
    const s = opts.size, r = (s - 1) / 2, pts = [];
    for (let dy = -Math.floor(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.floor(r); dx <= Math.ceil(r); dx++) {
      if (s > 1 && opts.round && (dx - (s % 2 ? 0 : 0.5)) ** 2 + (dy - (s % 2 ? 0 : 0.5)) ** 2 > (s / 2) ** 2 + 0.25) continue;
      pts.push([x + dx - (s % 2 ? 0 : 0), y + dy]);
    }
    return mirrored(pts);
  }

  function mirrored(pts) {
    const out = [...pts];
    if (opts.mirrorX) for (const [x, y] of pts) out.push([doc.width - 1 - x, y]);
    if (opts.mirrorY) for (const [x, y] of [...out]) out.push([x, doc.height - 1 - y]);
    return out;
  }

  const inside = (x, y) => x >= 0 && y >= 0 && x < doc.width && y < doc.height && (!selection || selection.mask[y * doc.width + x]);

  function plot(px, x, y, c) {
    if (!inside(x, y)) return;
    px.set(c, (y * doc.width + x) * 4);
  }

  /** Bresenham: every pixel from a to b. */
  function linePoints(x0, y0, x1, y1) {
    const pts = [];
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (;;) {
      pts.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return pts;
  }

  function rectPoints(x0, y0, x1, y1, filled) {
    const pts = [], [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [c, d] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) if (filled || x === a || x === b || y === c || y === d) pts.push([x, y]);
    return pts;
  }

  /** An ellipse inside a box, pixel by pixel (its outline closed with no gaps, or filled). */
  function ellipsePoints(x0, y0, x1, y1, filled) {
    const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [c, d] = [Math.min(y0, y1), Math.max(y0, y1)];
    const cx = (a + b) / 2, cy = (c + d) / 2, rx = (b - a) / 2 + 0.5, ry = (d - c) / 2 + 0.5;
    const ins = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    const pts = [];
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) {
      if (!ins(x, y)) continue;
      if (filled || !ins(x - 1, y) || !ins(x + 1, y) || !ins(x, y - 1) || !ins(x, y + 1)) pts.push([x, y]);
    }
    return pts;
  }

  /** Flood fill: the pixels like the one clicked (touching it, or anywhere), within a tolerance. */
  function fillPoints(src, x, y, contiguous, tolerance) {
    const W = doc.width, H = doc.height, i0 = (y * W + x) * 4;
    const t = [src[i0], src[i0 + 1], src[i0 + 2], src[i0 + 3]];
    const like = (i) => Math.max(Math.abs(src[i] - t[0]), Math.abs(src[i + 1] - t[1]), Math.abs(src[i + 2] - t[2]), Math.abs(src[i + 3] - t[3])) <= tolerance;
    const pts = [];
    if (!contiguous) { for (let p = 0; p < W * H; p++) if (like(p * 4) && inside(p % W, Math.floor(p / W))) pts.push([p % W, Math.floor(p / W)]); return pts; }
    const seen = new Uint8Array(W * H), stack = [[x, y]];
    while (stack.length) {
      const [px, py] = stack.pop();
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const p = py * W + px;
      if (seen[p] || !like(p * 4) || !inside(px, py)) continue;
      seen[p] = 1; pts.push([px, py]);
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    return pts;
  }

  function canDraw() {
    if (doc.layers[layer].locked) { notice('That layer is locked (🔒 in the timeline)', 1500); return false; }
    if (!doc.layers[layer].visible) { notice('That layer is hidden', 1200); return false; }
    return true;
  }

  function onDown(e) {
    $('#spritebench').focus({ preventScroll: true });
    const p = toPixel(e);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer the browser doesn't know (a test's) */ }
    if (e.button === 1 || spaceHeld || tool === 'hand') { drag = { kind: 'pan', cx: p.cx, cy: p.cy }; return; }
    if (playing) stop();
    const t = altHeld && !['select', 'eselect', 'lasso', 'wand'].includes(tool) ? 'picker' : tool;
    const colour = e.button === 2 ? bg : fg;
    if (tilesOn() && ['pencil', 'eraser', 'fill', 'picker'].includes(t)) { tileDown(t, p, e.button === 2); return; }
    if (t === 'picker') { pick(p, e.button === 2); drag = { kind: 'picker', right: e.button === 2 }; return; }
    if (['select', 'eselect', 'lasso', 'wand'].includes(t)) { startSelect(t, p, e); return; }
    if (t === 'slice') { startSlice(p); return; }
    if (t === 'move') { startMove(p); return; }
    if (!canDraw()) return;
    if (t === 'fill') {
      if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
      const src = (cel() || { px: new Uint8ClampedArray(doc.width * doc.height * 4) }).px;
      const pts = mirrored([[p.x, p.y]]).flatMap(([x, y]) => (x >= 0 && y >= 0 && x < doc.width && y < doc.height ? fillPoints(src, x, y, opts.contiguous, opts.tolerance) : []));
      change('Fill', () => { const px = editable(); for (const [x, y] of pts) plot(px, x, y, colour); });
      return;
    }
    if (t === 'pencil' || t === 'eraser') {
      // The stroke draws into a copy shown as it goes; it becomes one undo step when the button is let go.
      const base = cel();
      drag = { kind: 'stroke', colour: t === 'eraser' ? [0, 0, 0, 0] : colour, last: [p.x, p.y], preview: base ? new Uint8ClampedArray(base.px) : new Uint8ClampedArray(doc.width * doc.height * 4), original: base ? base.px : null, trail: [],
        ink: t === 'pencil' ? opts.ink : 'simple', shadeDir: e.button === 2 ? -1 : 1, shaded: new Set(), custom: t === 'pencil' && opts.custom && brushImage };
      stamp(p.x, p.y);
      draw();
      return;
    }
    if (['line', 'rect', 'ellipse'].includes(t)) {
      const base = cel();
      drag = { kind: 'shape', tool: t, colour, from: [p.x, p.y], to: [p.x, p.y], base: base ? base.px : new Uint8ClampedArray(doc.width * doc.height * 4) };
      drag.preview = shapePreview(e);
      draw();
    }
  }

  /** One dab of the brush (with pixel-perfect corners taken out of one-pixel lines). */
  function stamp(x, y) {
    const d = drag;
    if (opts.perfect && opts.size === 1 && tool === 'pencil') {
      d.trail.push([x, y]);
      const n = d.trail.length;
      if (n >= 3) {
        const [a, b, c] = d.trail.slice(-3);
        // b is an L-corner between a and c: put back what was there.
        if (Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1 && (b[0] === a[0] || b[1] === a[1])) {
          for (const [mx, my] of mirrored([b])) {
            if (!inside(mx, my)) continue;
            const i = (my * doc.width + mx) * 4;
            if (d.original) d.preview.set(d.original.subarray(i, i + 4), i); else d.preview.fill(0, i, i + 4);
          }
          d.trail.splice(n - 2, 1);
        }
      }
    }
    if (d.custom) { stampImage(x, y); return; }
    for (const [px, py] of brushPoints(x, y)) ink(px, py);
  }

  /** One pixel of a stroke by its ink: plain, dithered (some pixels only), or shading (a step along the palette). */
  function ink(x, y) {
    const d = drag;
    if (!inside(x, y)) return;
    if (opts.dither && tool === 'pencil' && BAYER[(y & 3) * 4 + (x & 3)] >= opts.dither) return;
    if (d.ink === 'shade') {
      const i = (y * doc.width + x) * 4;
      if (d.shaded.has(i)) return; // once a stroke
      d.shaded.add(i);
      const c = hex([d.preview[i], d.preview[i + 1], d.preview[i + 2], d.preview[i + 3]]);
      const at = doc.palette.indexOf(c), to = at + d.shadeDir;
      if (at < 0 || to < 0 || to >= doc.palette.length) return;
      d.preview.set(parseHex(doc.palette[to]), i);
      return;
    }
    plot(d.preview, x, y, d.colour);
  }

  /** A brush cut from the sprite, stamped centred on a point (its own colours; mirrored too). */
  function stampImage(x, y) {
    const b = brushImage, ox = x - Math.floor(b.w / 2), oy = y - Math.floor(b.h / 2);
    for (let by = 0; by < b.h; by++) for (let bx = 0; bx < b.w; bx++) {
      const s = (by * b.w + bx) * 4;
      if (!b.px[s + 3]) continue;
      const c = [b.px[s], b.px[s + 1], b.px[s + 2], b.px[s + 3]];
      for (const [mx, my] of mirrored([[ox + bx, oy + by]])) if (inside(mx, my)) plot(drag.preview, mx, my, c);
    }
  }

  /** Ctrl+B: the selection (or the whole cel) becomes the pencil's brush. */
  function brushFromSelection() {
    const c = cel();
    if (!c) { notice('Nothing here to make a brush of', 1200); return; }
    const W = doc.width, s = selection || bounds(new Uint8Array(W * doc.height).fill(1));
    const w = s.x1 - s.x0 + 1, h = s.y1 - s.y0 + 1, px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((s.y0 + y) * W + s.x0 + x) * 4; if (s.mask[(s.y0 + y) * W + s.x0 + x]) px.set(c.px.subarray(i, i + 4), (y * w + x) * 4); }
    if (!px.some((v, i) => i % 4 === 3 && v)) { notice('That part is empty', 1200); return; }
    if (w > 64 || h > 64) { notice('A brush is at most 64 × 64', 1500); return; }
    brushImage = { px, w, h };
    opts.custom = true;
    commitFloating(); selection = null;
    setTool('pencil');
    notice(`A ${w} × ${h} brush from the sprite`, 1400);
  }

  function shapePreview(e, d = drag) {
    const px = new Uint8ClampedArray(d.base);
    let [x1, y1] = d.to;
    const [x0, y0] = d.from;
    if (e && e.shiftKey && d.tool !== 'line') { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
    const pts = d.tool === 'line' ? linePoints(x0, y0, x1, y1).flatMap(([x, y]) => (opts.size > 1 ? brushPoints(x, y) : mirrored([[x, y]])))
      : mirrored(d.tool === 'rect' ? rectPoints(x0, y0, x1, y1, opts.filled) : ellipsePoints(x0, y0, x1, y1, opts.filled));
    for (const [x, y] of pts) plot(px, x, y, d.colour);
    return px;
  }

  function onMove(e) {
    const p = toPixel(e);
    hover = { x: p.x, y: p.y };
    if (!drag) { draw(); status(); return; }
    if (drag.kind === 'pan') { view.panX += p.cx - drag.cx; view.panY += p.cy - drag.cy; drag.cx = p.cx; drag.cy = p.cy; draw(); return; }
    if (drag.kind === 'picker') { pick(p, drag.right); return; }
    if (drag.kind === 'tiles') { tileMove(p); return; }
    if (drag.kind === 'stroke') {
      const pts = linePoints(drag.last[0], drag.last[1], p.x, p.y).slice(1);
      for (const [x, y] of pts) stamp(x, y);
      drag.last = [p.x, p.y];
      draw(); status();
      return;
    }
    if (drag.kind === 'shape') { drag.to = [p.x, p.y]; drag.preview = shapePreview(e); draw(); return; }
    if (drag.kind === 'select') { moveSelect(p, e); return; }
    if (drag.kind === 'slice') { drag.to = [p.x, p.y]; draw(); return; }
    if (drag.kind === 'move') { floating.x = drag.fx + (p.x - drag.px); floating.y = drag.fy + (p.y - drag.py); draw(); }
  }

  function onUp(e) {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === 'stroke') change(d.colour[3] === 0 && tool === 'eraser' ? 'Erase' : d.ink === 'shade' ? 'Shade' : 'Draw', (doc2) => { putCel(doc2, key(doc2.layers[layer].id, frame), { px: d.preview, opacity: (cel() || { opacity: 255 }).opacity }); });
    else if (d.kind === 'shape') change(d.tool === 'line' ? 'Line' : d.tool === 'rect' ? 'Rectangle' : 'Ellipse', (doc2) => { putCel(doc2, key(doc2.layers[layer].id, frame), { px: shapePreview(e, d), opacity: (cel() || { opacity: 255 }).opacity }); });
    else if (d.kind === 'tiles') putTiles(d.value ? 'Place tiles' : 'Take tiles away', d.map);
    else if (d.kind === 'select') endSelect(d);
    else if (d.kind === 'slice') endSlice(d);
    else draw();
  }

  function pick(p, right) {
    if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
    const px = compose(frame), i = (p.y * doc.width + p.x) * 4;
    const c = [px[i], px[i + 1], px[i + 2], px[i + 3]];
    if (right) bg = c; else fg = c;
    renderColours(); renderPalette();
  }

  function onWheel(e) {
    e.preventDefault();
    const r = $('#sp-canvas').getBoundingClientRect();
    if (e.ctrlKey || !e.shiftKey) zoomBy(e.deltaY < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top });
    else { view.panX -= e.deltaY; draw(); }
  }

  // ---------------------------------------------------------------- selections

  function startSelect(t, p, e) {
    const mode = e.shiftKey ? 'add' : e.altKey ? 'sub' : 'new';
    if (t === 'wand') {
      if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
      const src = (cel() || { px: new Uint8ClampedArray(doc.width * doc.height * 4) }).px;
      const keep = selection; selection = null;
      const pts = fillPoints(src, p.x, p.y, opts.contiguous, opts.tolerance);
      selection = keep;
      applySelection(pts, mode);
      return;
    }
    drag = { kind: 'select', tool: t, mode, from: [p.x, p.y], to: [p.x, p.y], path: [[p.x, p.y]], before: selection };
  }

  function moveSelect(p) {
    drag.to = [p.x, p.y];
    if (drag.tool === 'lasso') drag.path.push([p.x, p.y]);
    // Shown as it is drawn: the new shape alone (combined when let go).
    const pts = selectionPoints(drag);
    selection = drag.mode === 'new' ? maskFrom(pts) : combine(drag.before, pts, drag.mode);
    draw();
  }

  function endSelect(d) {
    const pts = selectionPoints(d);
    selection = d.before;
    if (d.mode === 'new' && d.from[0] === d.to[0] && d.from[1] === d.to[1] && d.tool !== 'lasso') { selection = null; draw(); status(); return; } // a click: none
    applySelection(pts, d.mode);
  }

  function selectionPoints(d) {
    const [x0, y0] = d.from, [x1, y1] = d.to;
    if (d.tool === 'select') return rectPoints(x0, y0, x1, y1, true);
    if (d.tool === 'eselect') return ellipsePoints(x0, y0, x1, y1, true);
    // Lasso: the pixels inside the drawn outline (even-odd), and the outline itself.
    const path = d.path;
    if (path.length < 3) return path;
    const xs = path.map((q) => q[0]), ys = path.map((q) => q[1]);
    const pts = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
      let inPoly = false;
      for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        const [xi, yi] = path[i], [xj, yj] = path[j];
        if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inPoly = !inPoly;
      }
      if (inPoly) pts.push([x, y]);
    }
    for (let i = 1; i < path.length; i++) pts.push(...linePoints(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
    return pts;
  }

  function maskFrom(pts) {
    const W = doc.width, H = doc.height, mask = new Uint8Array(W * H);
    for (const [x, y] of pts) if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 1;
    return bounds(mask);
  }

  function combine(before, pts, mode) {
    const W = doc.width, H = doc.height;
    const mask = before ? new Uint8Array(before.mask) : new Uint8Array(W * H);
    for (const [x, y] of pts) if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = mode === 'sub' ? 0 : 1;
    return bounds(mask);
  }

  /** The selection with its bounding box, or null when nothing is in it. */
  function bounds(mask) {
    const W = doc.width;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let i = 0; i < mask.length; i++) if (mask[i]) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { mask, x0, y0, x1, y1 };
  }

  function applySelection(pts, mode) {
    commitFloating();
    selection = mode === 'new' ? maskFrom(pts) : combine(selection, pts, mode);
    draw(); status();
  }

  function selectAll() { commitFloating(); selection = bounds(new Uint8Array(doc.width * doc.height).fill(1)); draw(); status(); }
  function deselect() { commitFloating(); selection = null; draw(); status(); }
  function invertSelection() {
    commitFloating();
    const m = new Uint8Array(doc.width * doc.height);
    for (let i = 0; i < m.length; i++) m[i] = selection && selection.mask[i] ? 0 : 1;
    selection = bounds(m); draw(); status();
  }

  // ---------------------------------------------------------------- moving, copying, pasting

  /** Lifts the selection (or the whole layer) off its cel to move it about. */
  function lift() {
    const c = cel();
    if (!c) return false;
    const W = doc.width, H = doc.height;
    const s = selection || { mask: new Uint8Array(W * H).fill(1), x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
    const w = s.x1 - s.x0 + 1, h = s.y1 - s.y0 + 1, px = new Uint8ClampedArray(w * h * 4);
    const rest = new Uint8ClampedArray(c.px);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = s.x0 + x, sy = s.y0 + y, i = (sy * W + sx) * 4;
      if (!s.mask[sy * W + sx]) continue;
      px.set(c.px.subarray(i, i + 4), (y * w + x) * 4);
      rest.fill(0, i, i + 4);
    }
    change('Move', (d) => { putCel(d, key(d.layers[layer].id, frame), { px: rest, opacity: c.opacity }); });
    floating = { px, w, h, x: s.x0, y: s.y0 };
    selection = null;
    return true;
  }

  function startMove(p) {
    if (!canDraw()) return;
    if (!floating && !lift()) return;
    drag = { kind: 'move', px: p.x, py: p.y, fx: floating.x, fy: floating.y };
  }

  function nudge(dx, dy) {
    if (!floating) { if (!canDraw() || !lift()) return; }
    floating.x += dx; floating.y += dy;
    draw();
  }

  /** Puts a floating picture down into the current cel (its last move joins that undo step). */
  function commitFloating() {
    if (!floating || !doc) return;
    const f = floating;
    floating = null;
    const W = doc.width, H = doc.height;
    const k = key(doc.layers[layer].id, frame), old = doc.cels.get(k);
    const px = old ? new Uint8ClampedArray(old.px) : new Uint8ClampedArray(W * H * 4);
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const tx = f.x + x, ty = f.y + y;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const s = (y * f.w + x) * 4, a = f.px[s + 3];
      if (a === 0) continue;
      const t = (ty * W + tx) * 4, ba = px[t + 3] / 255, sa = a / 255, ra = sa + ba * (1 - sa);
      for (let c = 0; c < 3; c++) px[t + c] = Math.round((f.px[s + c] * sa + px[t + c] * ba * (1 - sa)) / ra);
      px[t + 3] = Math.round(ra * 255);
      mask[ty * W + tx] = 1;
    }
    // No extra undo step: put down with the move it came from.
    const prev = doc;
    doc = snapshot(doc);
    putCel(doc, k, { px, opacity: old ? old.opacity : 255 });
    normalizeTilemaps(doc, prev);
    selection = bounds(mask);
    renderAll();
  }

  function copy(cut) {
    const c = cel();
    if (!c) { notice('Nothing on this layer and frame to copy', 1200); return; }
    const W = doc.width, s = selection || { mask: new Uint8Array(W * doc.height).fill(1), x0: 0, y0: 0, x1: W - 1, y1: doc.height - 1 };
    const w = s.x1 - s.x0 + 1, h = s.y1 - s.y0 + 1, px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((s.y0 + y) * W + s.x0 + x) * 4; if (s.mask[(s.y0 + y) * W + s.x0 + x]) px.set(c.px.subarray(i, i + 4), (y * w + x) * 4); }
    clip = { px, w, h, x: s.x0, y: s.y0 };
    if (cut) clearSelection('Cut');
    notice(cut ? 'Cut' : 'Copied', 800);
  }

  function paste() {
    if (!clip) { notice('Nothing copied yet', 1000); return; }
    if (!canDraw()) return;
    commitFloating();
    // Pasted where it was (or in the middle if that is out of view), floating, to be placed.
    history.push({ label: 'Paste', doc, layer, frame }); future = [];
    doc = snapshot(doc);
    floating = { px: new Uint8ClampedArray(clip.px), w: clip.w, h: clip.h, x: Math.min(clip.x, doc.width - 1), y: Math.min(clip.y, doc.height - 1) };
    selection = null;
    setTool('move');
    renderAll();
  }

  function clearSelection(label = 'Delete') {
    if (floating) { history.push({ label, doc, layer, frame }); floating = null; renderAll(); return; }
    const c = cel();
    if (!c || !canDraw()) return;
    change(label, () => {
      const px = editable();
      for (let i = 0; i < doc.width * doc.height; i++) if (!selection || selection.mask[i]) px.fill(0, i * 4, i * 4 + 4);
    });
  }

  // ---------------------------------------------------------------- transforms

  /** Flips or turns the selection, the layer (every frame) or the whole sprite. */
  function transform(kind, scope) {
    commitFloating();
    const W = doc.width, H = doc.height;
    if (scope === 'selection') {
      if (!selection) { notice('Select something first', 1200); return; }
      const s = selection, w = s.x1 - s.x0 + 1, h = s.y1 - s.y0 + 1;
      if (kind.startsWith('rot') && w !== h) { notice('Turning a selection takes a square one', 1800); return; }
      change(kind === 'flipH' ? 'Flip' : kind === 'flipV' ? 'Flip' : 'Turn', () => {
        const px = editable(), old = new Uint8ClampedArray(px);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const [tx, ty] = kind === 'flipH' ? [w - 1 - x, y] : kind === 'flipV' ? [x, h - 1 - y] : kind === 'rotR' ? [h - 1 - y, x] : [y, w - 1 - x];
          const si = ((s.y0 + y) * W + s.x0 + x) * 4, ti = ((s.y0 + ty) * W + s.x0 + tx) * 4;
          px.set(old.subarray(si, si + 4), ti);
        }
      });
      return;
    }
    const turns = kind === 'rotR' || kind === 'rotL';
    if (turns && scope === 'layer' && W !== H) { notice('Turning one layer takes a square sprite (turn the whole sprite instead)', 2200); return; }
    change(kind.startsWith('flip') ? 'Flip' : 'Turn', (d) => {
      const nw = turns && scope === 'sprite' ? H : W, nh = turns && scope === 'sprite' ? W : H;
      const fn = kind === 'flipH' ? (x, y) => [W - 1 - x, y] : kind === 'flipV' ? (x, y) => [x, H - 1 - y] : kind === 'rotR' ? (x, y) => [H - 1 - y, x] : (x, y) => [y, W - 1 - x];
      const which = scope === 'sprite' ? d.layers.map((l) => l.id) : [d.layers[layer].id];
      for (const [k, c] of [...d.cels]) {
        if (!which.includes(k.slice(0, k.lastIndexOf(':')))) continue;
        const o = new Uint8ClampedArray(nw * nh * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [tx, ty] = fn(x, y); o.set(c.px.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), (ty * nw + tx) * 4); }
        d.cels.set(k, { ...c, px: o });
      }
      d.width = nw; d.height = nh;
    });
    selection = null;
  }

  /** A new canvas size: the pictures kept where the anchor says (cut, or with room added). */
  function resizeCanvas(nw, nh, ax, ay) {
    change('Canvas size', (d) => {
      const ox = Math.round((nw - d.width) * ax), oy = Math.round((nh - d.height) * ay);
      for (const [k, c] of [...d.cels]) {
        const o = new Uint8ClampedArray(nw * nh * 4);
        for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
          const tx = x + ox, ty = y + oy;
          if (tx < 0 || ty < 0 || tx >= nw || ty >= nh) continue;
          o.set(c.px.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 4), (ty * nw + tx) * 4);
        }
        d.cels.set(k, { ...c, px: o });
      }
      d.width = nw; d.height = nh;
    });
    selection = null; fitZoom(); draw();
  }

  /** Every pixel scaled by a whole number up, or down by keeping one in so many (nearest neighbour). */
  function scaleSprite(factor) {
    const nw = Math.max(1, Math.round(doc.width * factor)), nh = Math.max(1, Math.round(doc.height * factor));
    if (nw > 2048 || nh > 2048) { notice('That would be over 2048 pixels a side', 1800); return; }
    change('Scale', (d) => {
      for (const [k, c] of [...d.cels]) {
        const o = new Uint8ClampedArray(nw * nh * 4);
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
          const sx = Math.min(d.width - 1, Math.floor((x * d.width) / nw)), sy = Math.min(d.height - 1, Math.floor((y * d.height) / nh));
          o.set(c.px.subarray((sy * d.width + sx) * 4, (sy * d.width + sx) * 4 + 4), (y * nw + x) * 4);
        }
        d.cels.set(k, { ...c, px: o });
      }
      d.width = nw; d.height = nh;
    });
    selection = null; fitZoom(); draw();
  }

  function cropToSelection() {
    if (!selection) { notice('Select the part to keep first', 1500); return; }
    const s = selection, nw = s.x1 - s.x0 + 1, nh = s.y1 - s.y0 + 1;
    change('Crop', (dd) => {
      for (const [k, c] of [...dd.cels]) {
        const o = new Uint8ClampedArray(nw * nh * 4);
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const i = ((s.y0 + y) * dd.width + s.x0 + x) * 4; o.set(c.px.subarray(i, i + 4), (y * nw + x) * 4); }
        dd.cels.set(k, { ...c, px: o });
      }
      dd.width = nw; dd.height = nh;
    });
    selection = null; fitZoom(); draw();
  }

  function moreMenu(anchor) {
    const items = [
      ['Canvas size…', canvasDialog], ['Scale the sprite…', scaleDialog], ['Crop to the selection', cropToSelection], null,
      ['Flip the sprite left ↔ right', () => transform('flipH', 'sprite')], ['Flip the sprite top ↕ bottom', () => transform('flipV', 'sprite')],
      ['Turn the sprite 90° clockwise', () => transform('rotR', 'sprite')], ['Turn the sprite 90° anticlockwise', () => transform('rotL', 'sprite')], null,
      ['Flip the layer ↔', () => transform('flipH', 'layer')], ['Flip the layer ↕', () => transform('flipV', 'layer')],
      ['Flip the selection ↔', () => transform('flipH', 'selection')], ['Flip the selection ↕', () => transform('flipV', 'selection')], ['Turn the selection 90°', () => transform('rotR', 'selection')], null,
      ['Rotate by any angle (stays crisp)…', rotateDialog], ['Scale 2× (Scale2x: smooth diagonals)', () => scaleSmart(2)], ['Scale 3× (Scale3x)', () => scaleSmart(3)], null,
      ['Replace a colour…', replaceDialog], ['Outline…', outlineDialog], ['A brush from the selection (Ctrl+B)', brushFromSelection], null,
      ['New tilemap layer', addTilemapLayer], ['Make this layer a tilemap (cut into tiles of the grid\'s size)', makeTilemap], ['Export the tilemap for Godot (TileSet and TileMap)…', exportTiles], null,
      ['A picture to trace (a reference layer)…', () => importPicture('reference')],
      ['Import a sprite sheet (cut into frames)…', () => importPicture('sheet')], ['Import a picture as a new layer…', () => importPicture('layer')], null,
      ['Save as…', () => save(true)],
    ];
    NoorUI.modal({ label: 'Sprite', width: 320 }, (s, closeIt) => {
      s.append(NoorUI.head('Sprite and edit', closeIt), el('div', { class: 'modal-body sp-menu' }, ...items.map((it) => (it ? el('button', { class: 'utility-btn', onclick: () => { closeIt(); it[1](); } }, it[0]) : el('hr')))));
    });
    void anchor;
  }

  function canvasDialog() {
    NoorUI.modal({ label: 'Canvas size', width: 360 }, (s, closeIt) => {
      const w = el('input', { type: 'number', min: '1', max: '2048', value: String(doc.width), id: 'sp-cw', 'aria-label': 'Width' });
      const h = el('input', { type: 'number', min: '1', max: '2048', value: String(doc.height), id: 'sp-ch', 'aria-label': 'Height' });
      let anchor = [0.5, 0.5];
      const grid = el('div', { class: 'sp-anchor', role: 'group', 'aria-label': 'Where the picture stays' }, ...[0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) => el('button', { class: 'icon-btn' + (ax === 0.5 && ay === 0.5 ? ' on' : ''), 'aria-label': `Anchor ${ax},${ay}`, onclick: (e) => { anchor = [ax, ay]; grid.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, '·'))));
      s.append(NoorUI.head('Canvas size', closeIt), el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'Width ', w), el('label', {}, 'Height ', h), el('p', { class: 'pref-hint', text: 'Where the picture stays:' }), grid),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'sp-cs-ok', onclick: () => { const nw = Math.max(1, Math.min(2048, Number(w.value) || doc.width)), nh = Math.max(1, Math.min(2048, Number(h.value) || doc.height)); closeIt(); resizeCanvas(nw, nh, anchor[0], anchor[1]); } }, 'OK'))));
    });
  }

  async function scaleDialog() {
    const v = await NoorUI.prompt('Scale the sprite', 'By how much (2 doubles, 0.5 halves; pixels stay sharp):', '2', { okLabel: 'Scale' });
    const f = Number(v);
    if (v && f > 0) scaleSprite(f);
  }

  function newDialog() {
    NoorUI.modal({ label: 'New sprite', width: 380 }, (s, closeIt) => {
      const w = el('input', { type: 'number', min: '1', max: '2048', value: '32', id: 'sp-nw', 'aria-label': 'Width' });
      const h = el('input', { type: 'number', min: '1', max: '2048', value: '32', id: 'sp-nh', 'aria-label': 'Height' });
      const presets = el('div', { class: 'sb-row' }, ...[8, 16, 24, 32, 48, 64, 128, 256].map((n) => el('button', { class: 'utility-btn', onclick: () => { w.value = h.value = String(n); } }, `${n}²`)));
      const back = el('select', { id: 'sp-nbg', 'aria-label': 'Background' }, el('option', { value: 'clear', text: 'Transparent' }), el('option', { value: 'fg', text: 'The drawing colour' }), el('option', { value: 'bg', text: 'The second colour' }), el('option', { value: 'white', text: 'White' }));
      const ok = async () => {
        if (dirty() && !await NoorUI.confirm('Start a new sprite?', 'The sprite open now has changes not saved.', 'New sprite')) return;
        const nw = Math.max(1, Math.min(2048, Number(w.value) || 32)), nh = Math.max(1, Math.min(2048, Number(h.value) || 32));
        const b = back.value === 'clear' ? null : back.value === 'fg' ? fg : back.value === 'bg' ? bg : [255, 255, 255, 255];
        closeIt();
        setDoc(blank(nw, nh, b), null);
      };
      s.append(NoorUI.head('New sprite', closeIt), el('div', { class: 'modal-body sp-dlg' }, presets, el('label', {}, 'Width ', w), el('label', {}, 'Height ', h), el('label', {}, 'Background ', back)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-new-ok', onclick: ok }, 'Create'))));
    });
  }

  function setDoc(d, f, restoring = false) {
    stop();
    if (!restoring) req('sprite.draft.clear').catch(() => {});
    doc = d; file = f; layer = Math.min(layer, d.layers.length - 1); frame = 0;
    if (layer < 0) layer = 0;
    history = []; future = []; savedAt = null; selection = null; floating = null;
    fitZoom(); renderAll();
  }

  // ---------------------------------------------------------------- stage 3: tilemaps

  // A tilemap layer's cel keeps its pixels (px, drawn and composed like any cel) and the grid of tile numbers they
  // are made of (map, cols × rows from the sprite's top left; 0: no tile). A tileset is { name, tw, th, tiles },
  // tiles[n] a tile's pixels for n ≥ 1. Drawing pixels on a tilemap works out its tiles afterwards, as Aseprite's
  // "auto" mode does; drawing tiles places them and the pixels follow.
  let tileMode = false;   // T: drawing tiles (else pixels) on a tilemap layer
  let tileSel = 1;        // the tile drawn with

  const isTilemap = (l = layer, d = doc) => !!d.layers[l] && d.layers[l].kind === 'tilemap';
  const tilesetOf = (l = layer, d = doc) => d.tilesets[d.layers[l].tileset];
  const mapSize = (d, ts) => ({ cols: Math.ceil(d.width / ts.tw), rows: Math.ceil(d.height / ts.th) });
  const tilesOn = () => tileMode && isTilemap();

  /** A grid of tiles drawn as the sprite's pixels. */
  function renderMap(d, ts, map) {
    const W = d.width, H = d.height, px = new Uint8ClampedArray(W * H * 4), { cols, rows } = mapSize(d, ts);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const t = ts.tiles[map[r * cols + c]];
      if (!t) continue;
      const x0 = c * ts.tw, w = Math.min(ts.tw, W - x0);
      for (let y = 0; y < ts.th && r * ts.th + y < H; y++) px.set(t.subarray(y * ts.tw * 4, (y * ts.tw + w) * 4), ((r * ts.th + y) * W + x0) * 4);
    }
    return px;
  }

  /** One cell of a picture as a tile (past the sprite's edge, and wherever alpha is 0, clear). */
  function cellOf(d, ts, px, c, r) {
    const t = new Uint8ClampedArray(ts.tw * ts.th * 4), W = d.width, x0 = c * ts.tw, w = Math.min(ts.tw, W - x0);
    for (let y = 0; y < ts.th && r * ts.th + y < d.height; y++) t.set(px.subarray(((r * ts.th + y) * W + x0) * 4, ((r * ts.th + y) * W + x0 + w) * 4), y * ts.tw * 4);
    for (let i = 0; i < t.length; i += 4) if (!t[i + 3]) t[i] = t[i + 1] = t[i + 2] = 0;
    return t;
  }

  const sameTile = (a, b) => { if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  const clearTile = (t) => { for (let i = 3; i < t.length; i += 4) if (t[i]) return false; return true; };
  const tileHash = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t[i], 16777619); return h >>> 0; };

  /**
   * After a change: every tilemap cel whose pixels changed gets its tiles worked out again — an empty cell is no tile,
   * an unchanged cell keeps its tile, a tile like one already there is that one, a tile used only there is changed in
   * place, else a new tile joins the set; then every map drawing from a changed tileset is drawn again.
   */
  function normalizeTilemaps(d, prev) {
    if (!d.tilesets || !d.tilesets.length) return;
    d.tilesets.forEach((_, ti) => {
      const layerIds = new Set(d.layers.filter((l) => l.kind === 'tilemap' && l.tileset === ti).map((l) => l.id));
      if (!layerIds.size) return;
      const ofSet = [...d.cels].filter(([k]) => layerIds.has(k.slice(0, k.lastIndexOf(':'))));
      const changed = ofSet.filter(([, c]) => !c.map || c.mapPx !== c.px);
      if (!changed.length) return;
      const ts = d.tilesets[ti] = { ...d.tilesets[ti], tiles: [...d.tilesets[ti].tiles] };
      const { cols, rows } = mapSize(d, ts);
      const oldMap = (k, c) => { const m = c.map || (prev && prev.cels.get(k) && prev.cels.get(k).map); return m && m.length === cols * rows ? m : null; };
      // How often each tile is used (a map shared by linked cels counted once).
      const uses = new Map(), counted = new Set();
      for (const [k, c] of ofSet) { const m = oldMap(k, c); if (m && !counted.has(m)) { counted.add(m); for (const n of m) uses.set(n, (uses.get(n) || 0) + 1); } }
      const index = new Map();
      const indexAdd = (n) => { const h = tileHash(ts.tiles[n]); index.set(h, [...(index.get(h) || []), n]); };
      for (let n = 1; n < ts.tiles.length; n++) indexAdd(n);
      const find = (t) => (index.get(tileHash(t)) || []).find((n) => sameTile(ts.tiles[n], t)) || 0;
      let edited = false;
      const done = new Map(); // px → its new map (linked cels share both)
      for (const [k, c] of changed) {
        if (done.has(c.px)) { d.cels.set(k, { ...c, map: done.get(c.px), mapPx: c.px }); continue; }
        const was = oldMap(k, c), map = new Int32Array(cols * rows);
        for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
          const i = r * cols + col, t = cellOf(d, ts, c.px, col, r), old = was ? was[i] : 0;
          let n;
          if (clearTile(t)) n = 0;
          else if (old && sameTile(ts.tiles[old], t)) n = old;
          else if ((n = find(t))) { /* the same as a tile there already */ }
          else if (old && uses.get(old) === 1) {
            const h = tileHash(ts.tiles[old]);
            index.set(h, (index.get(h) || []).filter((x) => x !== old));
            ts.tiles[old] = t; indexAdd(old); n = old; edited = true;
          } else if (ts.tiles.length <= 4096) { n = ts.tiles.length; ts.tiles.push(t); indexAdd(n); }
          else n = 0;
          if (n !== old) { if (old) uses.set(old, uses.get(old) - 1); if (n) uses.set(n, (uses.get(n) || 0) + 1); }
          map[i] = n;
        }
        done.set(c.px, map);
        d.cels.set(k, { ...c, map, mapPx: c.px });
      }
      if (!edited) return;
      // A tile changed in place: wherever else it is drawn, it changes too.
      for (const [k] of ofSet) {
        const c = d.cels.get(k), px = renderMap(d, ts, c.map);
        d.cels.set(k, { ...c, px, mapPx: px });
      }
    });
  }

  function newTileset(d, tw, th) {
    d.tilesets.push({ name: `Tiles ${d.tilesets.length + 1}`, tw, th, tiles: [null] });
    return d.tilesets.length - 1;
  }

  /** A new tilemap layer above this one, its tiles the grid's size. */
  function addTilemapLayer() {
    change('New tilemap layer', (d) => {
      const ts = newTileset(d, d.gridWidth, d.gridHeight);
      d.layers.splice(layer + 1, 0, { id: newId(), name: `Tilemap ${d.layers.filter((l) => l.kind === 'tilemap').length + 1}`, visible: true, locked: false, opacity: 255, blend: 'normal', kind: 'tilemap', tileset: ts });
      layer++;
    });
    tileMode = false; tileSel = 1;
    notice(`A tilemap layer of ${doc.gridWidth} × ${doc.gridHeight} tiles: draw, and the tileset grows (T: place tiles)`, 2600);
  }

  /** This layer becomes a tilemap: its pictures cut into tiles of the grid's size (the same tiles stored once). */
  function makeTilemap() {
    if (isTilemap()) { notice('This layer is a tilemap already', 1200); return; }
    if (doc.layers[layer].reference) { notice('A reference layer can\'t be a tilemap', 1400); return; }
    change('Layer to tilemap', (d) => {
      const ts = newTileset(d, d.gridWidth, d.gridHeight);
      d.layers[layer] = { ...d.layers[layer], kind: 'tilemap', tileset: ts };
    });
    notice(`${tilesetOf().tiles.length - 1} tile${tilesetOf().tiles.length === 2 ? '' : 's'} of ${doc.gridWidth} × ${doc.gridHeight}`, 1800);
  }

  /** A tilemap layer back to a plain picture layer (the tiles stay as pixels). */
  function makeImageLayer() {
    if (!isTilemap()) return;
    change('Tilemap to layer', (d) => {
      const l = { ...d.layers[layer] }; delete l.kind; delete l.tileset;
      d.layers[layer] = l;
      d.frames.forEach((_, f) => { const k = key(l.id, f), c = d.cels.get(k); if (c) { const { map, mapPx, ...rest } = c; void map; void mapPx; d.cels.set(k, rest); } });
    });
    tileMode = false;
  }

  function setTileMode(on) {
    if (on && !isTilemap()) { notice('Tiles are drawn on a tilemap layer (☰ or ▦ in the timeline makes one)', 2000); return; }
    commitFloating();
    tileMode = on;
    if (on && ['line', 'rect', 'ellipse', 'select', 'eselect', 'lasso', 'wand', 'move'].includes(tool)) tool = 'pencil';
    renderAll();
    notice(on ? 'Tiles: the pencil places the chosen tile, the eraser takes tiles away' : 'Pixels: drawing changes the tiles', 1400);
  }

  /** The cell under a sprite pixel, or null off the map. */
  function cellAt(p) {
    const ts = tilesetOf(), { cols, rows } = mapSize(doc, ts), c = Math.floor(p.x / ts.tw), r = Math.floor(p.y / ts.th);
    return p.x < 0 || p.y < 0 || c >= cols || r >= rows ? null : { c, r, i: r * cols + c };
  }

  function currentMap() {
    const ts = tilesetOf(), { cols, rows } = mapSize(doc, ts), c = cel();
    return c && c.map && c.map.length === cols * rows ? c.map : new Int32Array(cols * rows);
  }

  /** A press on the canvas in tile mode: place, take away, fill or pick tiles. */
  function tileDown(t, p, right) {
    const at = cellAt(p);
    if (!at) return;
    const map = currentMap();
    if (t === 'picker') { if (map[at.i]) { tileSel = map[at.i]; renderTileset(); } return; }
    if (!canDraw()) return;
    const n = t === 'eraser' || right ? 0 : tileSel;
    if (n >= tilesetOf().tiles.length) { notice('Choose a tile in the tileset first', 1400); return; }
    const next = new Int32Array(map);
    if (t === 'fill') {
      const { cols, rows } = mapSize(doc, tilesetOf()), from = next[at.i];
      if (from === n) return;
      const stack = [at.i];
      while (stack.length) {
        const i = stack.pop();
        if (next[i] !== from) continue;
        next[i] = n;
        const c = i % cols, r = (i - c) / cols;
        if (c > 0) stack.push(i - 1); if (c < cols - 1) stack.push(i + 1); if (r > 0) stack.push(i - cols); if (r < rows - 1) stack.push(i + cols);
      }
      putTiles(n ? 'Fill with a tile' : 'Take tiles away', next);
      return;
    }
    next[at.i] = n;
    drag = { kind: 'tiles', map: next, value: n, last: at };
    drag.preview = renderMap(doc, tilesetOf(), next);
    draw();
  }

  function tileMove(p) {
    const at = cellAt(p);
    if (!at || (drag.last && drag.last.i === at.i)) return;
    // Every cell between the last and this one, so a quick stroke leaves no gaps.
    for (const [c, r] of linePoints(drag.last ? drag.last.c : at.c, drag.last ? drag.last.r : at.r, at.c, at.r)) drag.map[r * mapSize(doc, tilesetOf()).cols + c] = drag.value;
    drag.last = at;
    drag.preview = renderMap(doc, tilesetOf(), drag.map);
    draw();
  }

  function putTiles(label, map) {
    change(label, (d) => {
      const k = key(d.layers[layer].id, frame), px = renderMap(d, d.tilesets[d.layers[layer].tileset], map);
      const old = d.cels.get(k);
      putCel(d, k, { px, opacity: old ? old.opacity : 255, map, mapPx: px });
    });
  }

  /** The tileset of the layer: its tiles to choose from, and pixels / tiles. */
  function renderTileset() {
    const box = $('#sp-tileset');
    if (!box) return;
    if (!isTilemap()) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    const ts = tilesetOf(), z = Math.max(1, Math.floor(32 / Math.max(ts.tw, ts.th)));
    if (tileSel >= ts.tiles.length) tileSel = Math.max(1, ts.tiles.length - 1);
    const mode = (on, label, title) => el('button', { class: 'utility-btn' + (tileMode === on ? ' on' : ''), 'aria-pressed': String(tileMode === on), 'data-tilemode': on ? 'tiles' : 'pixels', title, onclick: () => setTileMode(on) }, label);
    const tiles = ts.tiles.slice(1).map((t, i) => {
      const cv = el('canvas', { width: String(ts.tw * z), height: String(ts.th * z) });
      const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(pixelsToCanvas(t, ts.tw, ts.th), 0, 0, ts.tw * z, ts.th * z);
      return el('button', { class: 'sp-tile' + (tileSel === i + 1 ? ' on' : ''), 'data-tile': String(i + 1), title: `Tile ${i + 1} (click: draw with it)`, 'aria-label': `Tile ${i + 1}`, 'aria-pressed': String(tileSel === i + 1),
        onclick: () => { tileSel = i + 1; if (!tileMode) setTileMode(true); else renderTileset(); keepFocus(); } }, cv);
    });
    box.replaceChildren(
      el('h4', { class: 'music-subhead', text: `Tileset “${ts.name}”` }),
      el('small', { class: 'pref-hint', id: 'sp-tileinfo', text: `${ts.tiles.length - 1} tile${ts.tiles.length === 2 ? '' : 's'} of ${ts.tw} × ${ts.th}` }),
      el('div', { class: 'sb-row', role: 'group', 'aria-label': 'Draw' }, mode(false, 'Pixels', 'Draw pixels; the tiles follow (T)'), mode(true, 'Tiles', 'Place whole tiles (T)')),
      tiles.length ? el('div', { class: 'sp-tiles', id: 'sp-tiles', role: 'listbox', 'aria-label': 'Tiles' }, ...tiles) : el('p', { class: 'pref-hint', text: 'Draw on the layer and its tiles appear here.' }),
      el('div', { class: 'sb-row' },
        el('button', { class: 'utility-btn', id: 'sp-tiles-godot', title: 'The tiles as a Godot TileSet and the map as a TileMap scene', onclick: exportTiles }, 'Godot TileSet…'),
        el('button', { class: 'utility-btn', title: 'Make it a plain layer again (the tiles stay as pixels)', onclick: makeImageLayer }, 'To a plain layer')));
  }

  async function exportTiles() {
    if (!isTilemap()) return;
    commitFloating();
    try {
      const r = await req('sprite.tiles.export', { sprite: toWire(), layer: doc.layers[layer].id, frame, name: (file ? file.name.replace(/\.[^.]+$/, '') + '-' : '') + doc.layers[layer].name });
      if (r && !r.cancelled) notice(`Exported ${r.files.join(', ')}`, 2600);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- stage 3: slices

  let sliceSel = -1;

  function startSlice(p) {
    const list = doc.slices || [];
    // A click inside a slice picks it; a drag elsewhere makes one.
    const hit = list.findIndex((sl) => p.x >= sl.x && p.y >= sl.y && p.x < sl.x + sl.width && p.y < sl.y + sl.height);
    if (hit >= 0) { sliceSel = hit; renderSlicePanel(); draw(); return; }
    drag = { kind: 'slice', from: [p.x, p.y], to: [p.x, p.y] };
  }

  function endSlice(d) {
    const x0 = Math.max(0, Math.min(d.from[0], d.to[0])), y0 = Math.max(0, Math.min(d.from[1], d.to[1]));
    const x1 = Math.min(doc.width - 1, Math.max(d.from[0], d.to[0])), y1 = Math.min(doc.height - 1, Math.max(d.from[1], d.to[1]));
    if (x1 < x0 || y1 < y0) { draw(); return; }
    const n = (doc.slices || []).length + 1;
    change('New slice', (dd) => { dd.slices = dd.slices || []; dd.slices.push({ name: `Slice ${n}`, x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, color: '#0000ffff', nine: false, centerX: 0, centerY: 0, centerWidth: 1, centerHeight: 1, hasPivot: false, pivotX: 0, pivotY: 0 }); });
    sliceSel = doc.slices.length - 1;
    renderSlicePanel();
  }

  function drawSlices(ctx, o, z) {
    const list = [...(doc.slices || [])];
    if (drag && drag.kind === 'slice') { const [a, b] = drag.from, [c, d2] = drag.to; list.push({ name: '', x: Math.min(a, c), y: Math.min(b, d2), width: Math.abs(c - a) + 1, height: Math.abs(d2 - b) + 1, color: '#0000ffff', drawing: true }); }
    if (!list.length || (tool !== 'slice' && !view.slices)) return;
    ctx.save();
    list.forEach((sl, i) => {
      const col = sl.color ? sl.color.slice(0, 7) : '#0000ff', X = o.x + sl.x * z, Y = o.y + sl.y * z, W = sl.width * z, H = sl.height * z;
      ctx.setLineDash([]); ctx.lineWidth = i === sliceSel && tool === 'slice' ? 3 : 1.5; ctx.strokeStyle = col;
      ctx.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
      if (sl.nine) { ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeRect(X + sl.centerX * z + 0.5, Y + sl.centerY * z + 0.5, sl.centerWidth * z - 1, sl.centerHeight * z - 1); }
      if (sl.hasPivot) { const px2 = X + (sl.pivotX + 0.5) * z, py2 = Y + (sl.pivotY + 0.5) * z; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(px2 - 6, py2); ctx.lineTo(px2 + 6, py2); ctx.moveTo(px2, py2 - 6); ctx.lineTo(px2, py2 + 6); ctx.stroke(); }
      if (sl.name) { ctx.font = '11px sans-serif'; ctx.fillStyle = col; const tw = ctx.measureText(sl.name).width + 6; ctx.fillRect(X, Y - 15, tw, 14); ctx.fillStyle = '#fff'; ctx.fillText(sl.name, X + 3, Y - 4); }
    });
    ctx.restore();
  }

  /** The chosen slice's settings, in the right-hand column while the slice tool is on. */
  function renderSlicePanel() {
    let box = $('#sp-slicepanel');
    if (!box) { box = el('div', { class: 'sp-slicepanel', id: 'sp-slicepanel' }); $('#sp-layerprops').before(box); }
    const sl = (doc.slices || [])[sliceSel];
    box.hidden = tool !== 'slice';
    if (box.hidden) return;
    if (!sl) { box.replaceChildren(el('h4', { class: 'music-subhead', text: 'Slices' }), el('p', { class: 'pref-hint', text: 'Drag a rectangle to make a slice; click one to choose it.' })); return; }
    const num = (k, label, min, max) => {
      const i = el('input', { type: 'number', class: 'sb-num', value: String(sl[k]), min: String(min), max: String(max), 'data-slice': k, 'aria-label': label });
      i.addEventListener('change', () => change('Slice', (d) => { d.slices[sliceSel][k] = Math.round(Number(i.value) || 0); }));
      return el('label', { class: 'sb-inline' }, el('span', { text: label }), i);
    };
    const flag = (k, label) => { const c = el('input', { type: 'checkbox', checked: sl[k] || undefined, 'data-slice': k }); c.addEventListener('change', () => change('Slice', (d) => { const x = d.slices[sliceSel]; x[k] = c.checked; if (k === 'nine' && c.checked && x.centerWidth <= 1) { x.centerX = Math.floor(x.width / 3); x.centerY = Math.floor(x.height / 3); x.centerWidth = Math.max(1, x.width - 2 * x.centerX); x.centerHeight = Math.max(1, x.height - 2 * x.centerY); } if (k === 'hasPivot' && c.checked) { x.pivotX = Math.floor(x.width / 2); x.pivotY = x.height - 1; } })); return el('label', { class: 'sb-inline' }, c, el('span', { text: label })); };
    const name = el('input', { type: 'text', value: sl.name, maxlength: '64', id: 'sp-slice-name', 'aria-label': 'Slice name' });
    name.addEventListener('change', () => change('Rename a slice', (d) => { d.slices[sliceSel].name = name.value.trim() || 'Slice'; }));
    box.replaceChildren(...[
      el('h4', { class: 'music-subhead', text: 'Slice' }), name,
      el('div', { class: 'sp-grid2' }, num('x', 'x', -2048, 2048), num('y', 'y', -2048, 2048), num('width', 'w', 1, 4096), num('height', 'h', 1, 4096)),
      flag('nine', '9-slice centre (stretched part)'),
      sl.nine ? el('div', { class: 'sp-grid2' }, num('centerX', 'x', 0, 4096), num('centerY', 'y', 0, 4096), num('centerWidth', 'w', 1, 4096), num('centerHeight', 'h', 1, 4096)) : null,
      flag('hasPivot', 'pivot (origin)'),
      sl.hasPivot ? el('div', { class: 'sp-grid2' }, num('pivotX', 'x', -2048, 2048), num('pivotY', 'y', -2048, 2048)) : null,
      el('button', { class: 'utility-btn', id: 'sp-slice-del', onclick: () => { change('Remove a slice', (d) => { d.slices.splice(sliceSel, 1); }); sliceSel = -1; renderSlicePanel(); } }, '🗑 Remove the slice')].filter(Boolean));
  }

  // ---------------------------------------------------------------- stage 2: colours, outlines, rotation, upscaling

  const rgbaKey = (px, i) => (px[i] << 24 | px[i + 1] << 16 | px[i + 2] << 8 | px[i + 3]) >>> 0;
  const near = (px, i, c, tol) => Math.max(Math.abs(px[i] - c[0]), Math.abs(px[i + 1] - c[1]), Math.abs(px[i + 2] - c[2]), Math.abs(px[i + 3] - c[3])) <= tol;

  /** The cels a change reaches: this one, the layer's on every frame, or every one. */
  function scopeKeys(d, scope) {
    const keys = [];
    for (const k of d.cels.keys()) {
      const i = k.lastIndexOf(':'), id = k.slice(0, i), f = Number(k.slice(i + 1));
      if (scope === 'sprite' || (scope === 'layer' && id === d.layers[layer].id) || (scope === 'cel' && id === d.layers[layer].id && f === frame)) keys.push(k);
    }
    return keys;
  }

  const scopeSelect = (id) => el('select', { id, 'aria-label': 'Where' }, el('option', { value: 'cel', text: 'this layer, this frame' }), el('option', { value: 'layer', text: 'this layer, every frame' }), el('option', { value: 'sprite', text: 'the whole sprite' }));

  /** Every pixel of one colour (within a tolerance) made another. */
  function replaceColour(from, to, tol, scope) {
    change('Replace colour', (d) => {
      for (const k of scopeKeys(d, scope)) {
        const c = d.cels.get(k), px = new Uint8ClampedArray(c.px);
        let any = false;
        for (let i = 0; i < px.length; i += 4) if ((!selection || selection.mask[i / 4]) && near(px, i, from, tol)) { px.set(to, i); any = true; }
        if (any) d.cels.set(k, { ...c, px });
      }
    });
  }

  function replaceDialog() {
    NoorUI.modal({ label: 'Replace colour', width: 380 }, (s, closeIt) => {
      const from = el('input', { type: 'color', value: hex(bg).slice(0, 7), id: 'sp-rep-from', 'aria-label': 'From' });
      const to = el('input', { type: 'color', value: hex(fg).slice(0, 7), id: 'sp-rep-to', 'aria-label': 'To' });
      const tol = el('input', { type: 'number', min: '0', max: '255', value: '0', id: 'sp-rep-tol', 'aria-label': 'Tolerance' });
      const where = scopeSelect('sp-rep-where');
      s.append(NoorUI.head('Replace colour', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'This colour ', from), el('label', {}, 'becomes ', to), el('label', {}, 'Tolerance ', tol), el('label', {}, 'In ', where),
          el('p', { class: 'pref-hint', text: 'Its alpha is kept from the colours as they are (the second colour, the drawing colour); only inside the selection when there is one.' })),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'sp-rep-ok', onclick: () => { const a = parseHex(from.value + hex(bg).slice(7)), b = parseHex(to.value + hex(fg).slice(7)); closeIt(); replaceColour(a, b, Number(tol.value) || 0, where.value); } }, 'Replace'))));
    });
  }

  /** An outline in the drawing colour: outside the shape (around it) or inside (its edge), 4- or 8-connected. */
  function outline(where, eight, scope) {
    commitFloating();
    change('Outline', (d) => {
      const W = d.width, H = d.height;
      for (const k of scopeKeys(d, scope)) {
        const c = d.cels.get(k), src = c.px, px = new Uint8ClampedArray(src);
        const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src[(y * W + x) * 4 + 3] > 0;
        const nb = eight ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (selection && !selection.mask[y * W + x]) continue;
          const me = solid(x, y);
          if (where === 'outside' ? !me && nb.some(([dx, dy]) => solid(x + dx, y + dy)) : me && nb.some(([dx, dy]) => !solid(x + dx, y + dy))) px.set(fg, (y * W + x) * 4);
        }
        d.cels.set(k, { ...c, px });
      }
    });
  }

  function outlineDialog() {
    NoorUI.modal({ label: 'Outline', width: 360 }, (s, closeIt) => {
      const where = el('select', { id: 'sp-out-where', 'aria-label': 'Where' }, el('option', { value: 'outside', text: 'around the shape' }), el('option', { value: 'inside', text: 'on its edge, inside' }));
      const conn = el('select', { id: 'sp-out-conn', 'aria-label': 'Corners' }, el('option', { value: '4', text: 'sides only (round corners)' }), el('option', { value: '8', text: 'corners too (square)' }));
      const scope = scopeSelect('sp-out-scope');
      s.append(NoorUI.head('Outline', closeIt), el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'Where ', where), el('label', {}, 'Touching ', conn), el('label', {}, 'In ', scope), el('p', { class: 'pref-hint', text: 'In the drawing colour.' })),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'sp-out-ok', onclick: () => { closeIt(); outline(where.value, conn.value === '8', scope.value); } }, 'Outline'))));
    });
  }

  /** Scale2x / Scale3x (EPX): pixel art made 2× or 3× bigger with its diagonals smoothed, not blurred. */
  function scaleXBR(px, w, h, n) {
    const W = w * n, o = new Uint8ClampedArray(W * h * n * 4);
    const at = (x, y) => { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); return rgbaKey(px, (y * w + x) * 4); };
    const put = (x, y, v) => { const i = (y * W + x) * 4; o[i] = v >>> 24; o[i + 1] = (v >>> 16) & 255; o[i + 2] = (v >>> 8) & 255; o[i + 3] = v & 255; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const A = at(x - 1, y - 1), B = at(x, y - 1), C = at(x + 1, y - 1), D = at(x - 1, y), E = at(x, y), F = at(x + 1, y), G = at(x - 1, y + 1), H = at(x, y + 1), I = at(x + 1, y + 1);
      let e;
      if (n === 2) e = B !== H && D !== F ? [D === B ? D : E, B === F ? F : E, D === H ? D : E, H === F ? F : E] : [E, E, E, E];
      else e = B !== H && D !== F ? [
        D === B ? D : E, (D === B && E !== C) || (B === F && E !== A) ? B : E, B === F ? F : E,
        (D === B && E !== G) || (D === H && E !== A) ? D : E, E, (B === F && E !== I) || (H === F && E !== C) ? F : E,
        D === H ? D : E, (D === H && E !== I) || (H === F && E !== G) ? H : E, H === F ? F : E] : Array(9).fill(E);
      for (let k = 0; k < n * n; k++) put(x * n + (k % n), y * n + Math.floor(k / n), e[k]);
    }
    return o;
  }

  function scaleSmart(n) {
    const nw = doc.width * n, nh = doc.height * n;
    if (nw > 2048 || nh > 2048) { notice('That would be over 2048 pixels a side', 1800); return; }
    commitFloating();
    change(`Scale${n}x`, (d) => {
      for (const [k, c] of [...d.cels]) d.cels.set(k, { ...c, px: scaleXBR(c.px, d.width, d.height, n) });
      d.width = nw; d.height = nh;
    });
    selection = null; fitZoom(); draw();
  }

  /**
   * RotSprite-style rotation: the picture made 8× bigger with Scale2x three times (edges stay clean), turned there,
   * and each pixel taken back from the middle of its 8 × 8 — so a turned sprite keeps crisp single-pixel lines.
   */
  function rotsprite(px, w, h, degrees, cx, cy, mask) {
    let big = px, bw = w, bh = h;
    for (let k = 0; k < 3; k++) { big = scaleXBR(big, bw, bh, 2); bw *= 2; bh *= 2; }
    const a = (-degrees * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const o = new Uint8ClampedArray(px.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (mask && !mask[y * w + x]) { o.set(px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + x) * 4); continue; }
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const sx = (cx + dx * ca - dy * sa) * 8, sy = (cy + dx * sa + dy * ca) * 8;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      if (ix < 0 || iy < 0 || ix >= bw || iy >= bh) continue;
      const sxp = Math.floor(ix / 8), syp = Math.floor(iy / 8);
      if (mask && !mask[syp * w + sxp]) continue; // only what was selected turns
      o.set(big.subarray((iy * bw + ix) * 4, (iy * bw + ix) * 4 + 4), (y * w + x) * 4);
    }
    return o;
  }

  function rotateDialog() {
    NoorUI.modal({ label: 'Rotate', width: 360 }, (s, closeIt) => {
      const deg = el('input', { type: 'number', min: '-360', max: '360', value: '15', id: 'sp-rot-deg', 'aria-label': 'Degrees' });
      const scope = scopeSelect('sp-rot-scope');
      s.append(NoorUI.head('Rotate (pixel art stays crisp)', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'Degrees (clockwise) ', deg), el('label', {}, 'In ', scope), el('p', { class: 'pref-hint', text: 'Turns about the middle of the selection, or of the sprite; RotSprite-style, so lines stay one pixel wide.' })),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'sp-rot-ok', onclick: () => { const v = Number(deg.value) || 0; closeIt(); rotate(v, scope.value); } }, 'Rotate'))));
    });
  }

  function rotate(degrees, scope) {
    commitFloating();
    const W = doc.width, H = doc.height, s2 = selection;
    const cx = s2 ? (s2.x0 + s2.x1 + 1) / 2 : W / 2, cy = s2 ? (s2.y0 + s2.y1 + 1) / 2 : H / 2;
    change('Rotate', (d) => { for (const k of scopeKeys(d, scope)) { const c = d.cels.get(k); d.cels.set(k, { ...c, px: rotsprite(c.px, W, H, degrees, cx, cy, s2 && s2.mask) }); } });
  }

  // ---- palettes

  function sortPalette(by) {
    const lum = (c) => { const [r, g, b] = parseHex(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const hue = (c) => { const [r, g, b] = parseHex(c).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn; if (dl < 0.08) return 400 + lum(c) / 255; const h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4; return ((h * 60) + 360) % 360 + lum(c) / 1000; };
    change('Sort the palette', (d) => { d.palette = by === 'reverse' ? [...d.palette].reverse() : [...d.palette].sort((a, b) => (by === 'hue' ? hue(a) - hue(b) : lum(a) - lum(b))); });
  }

  /** A ramp of colours from the drawing colour to the second, added to the palette. */
  async function rampDialog() {
    const v = await NoorUI.prompt('A ramp', 'How many colours from the drawing colour to the second (they are added to the palette):', '6', { type: 'number', okLabel: 'Add' });
    const n = Math.max(2, Math.min(32, Number(v) || 0));
    if (!v) return;
    const cs = Array.from({ length: n }, (_, i) => hex(fg.map((a, k) => Math.round(a + ((bg[k] - a) * i) / (n - 1)))));
    change('A ramp', (d) => { for (const c of cs) if (!d.palette.includes(c) && d.palette.length < 256) d.palette.push(c); });
  }

  /** The sprite's own colours as the palette (up to 256). */
  function paletteFromSprite() {
    const seen = new Set();
    for (const c of doc.cels.values()) for (let i = 0; i < c.px.length; i += 4) if (c.px[i + 3]) { seen.add(hex([c.px[i], c.px[i + 1], c.px[i + 2], c.px[i + 3]])); if (seen.size > 256) break; }
    if (seen.size > 256) { notice('The sprite has more than 256 colours: the first 256 are taken', 2000); }
    change('Palette from the sprite', (d) => { d.palette = [...seen].slice(0, 256); });
  }

  /** Every pixel made the nearest colour of the palette (alpha kept). */
  function snapToPalette() {
    if (!doc.palette.length) return;
    const pal = doc.palette.map(parseHex);
    change('To the palette', (d) => {
      const cache = new Map();
      for (const [k, c] of [...d.cels]) {
        const px = new Uint8ClampedArray(c.px);
        for (let i = 0; i < px.length; i += 4) {
          if (!px[i + 3]) continue;
          const key2 = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
          let best = cache.get(key2);
          if (!best) { let bd = Infinity; for (const p2 of pal) { const dd = (p2[0] - px[i]) ** 2 * 3 + (p2[1] - px[i + 1]) ** 2 * 4 + (p2[2] - px[i + 2]) ** 2 * 2; if (dd < bd) { bd = dd; best = p2; } } cache.set(key2, best); }
          px[i] = best[0]; px[i + 1] = best[1]; px[i + 2] = best[2];
        }
        d.cels.set(k, { ...c, px });
      }
    });
  }

  /** A palette colour changed: with every pixel of the old colour in the sprite changed too (as an indexed sprite would). */
  function editSwatch(i) {
    const old = doc.palette[i];
    NoorUI.modal({ label: 'Palette colour', width: 360 }, (s, closeIt) => {
      const picker = el('input', { type: 'color', value: old.slice(0, 7), id: 'sp-sw-colour', 'aria-label': 'Colour' });
      const alpha = el('input', { type: 'range', min: '0', max: '255', value: String(parseInt(old.slice(7, 9), 16)), 'aria-label': 'Alpha' });
      const recolour = el('input', { type: 'checkbox', checked: true, id: 'sp-sw-recolour' });
      s.append(NoorUI.head(`Palette colour ${i + 1}`, closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'Colour ', picker), el('label', {}, 'Alpha ', alpha), el('label', {}, recolour, ' change the sprite\'s pixels of this colour too')),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'sp-sw-ok', onclick: () => {
            const nc = picker.value + Number(alpha.value).toString(16).padStart(2, '0'), from = parseHex(old), to = parseHex(nc), doPx = recolour.checked;
            closeIt();
            change('Palette colour', (d) => {
              d.palette[i] = nc;
              if (doPx) for (const [k, c] of [...d.cels]) { const px = new Uint8ClampedArray(c.px); let any = false; for (let p2 = 0; p2 < px.length; p2 += 4) if (near(px, p2, from, 0)) { px.set(to, p2); any = true; } if (any) d.cels.set(k, { ...c, px }); }
            });
            if (hex(fg) === old) fg = to;
          } }, 'OK'))));
    });
  }

  async function loadPalette() {
    try {
      const r = await req('sprite.palette.open');
      if (!r || r.cancelled) return;
      change('Load a palette', (d) => { d.palette = r.palette.slice(0, 256); });
      notice(`${r.palette.length} colours from ${r.name}`, 1500);
    } catch (err) { hooks.showError(err); }
  }

  async function savePalette() {
    try { const r = await req('sprite.palette.save', { palette: doc.palette }); if (r && !r.cancelled) notice(`Saved ${r.name}`, 1400); } catch (err) { hooks.showError(err); }
  }

  function paletteMenu() {
    const items = [['Sort by hue', () => sortPalette('hue')], ['Sort by brightness', () => sortPalette('light')], ['Reverse', () => sortPalette('reverse')], null,
      ['A ramp from the drawing colour to the second…', rampDialog], ['The sprite\'s own colours', paletteFromSprite], ['Make every pixel a palette colour', snapToPalette], null,
      ['Load a palette (.gpl, .pal, .hex)…', loadPalette], ['Save the palette…', savePalette]];
    NoorUI.modal({ label: 'Palette', width: 320 }, (s, closeIt) => {
      s.append(NoorUI.head('Palette', closeIt), el('div', { class: 'modal-body sp-menu' }, ...items.map((it) => (it ? el('button', { class: 'utility-btn', onclick: () => { closeIt(); it[1](); } }, it[0]) : el('hr')))));
    });
  }

  // ---- recovery drafts

  let draftedAt = null, draftChecked = false;
  async function saveDraft() {
    if (!built || !doc || !dirty() || drag) return;
    const last = history[history.length - 1];
    if (last === draftedAt) return;
    draftedAt = last;
    try { await req('sprite.draft.save', { sprite: toWire(), name: file ? file.name : '', path: file ? file.path : '' }); } catch { /* next time */ }
  }
  setInterval(saveDraft, 20000);

  /** On first opening: an unsaved sprite from last time, brought back if wanted. */
  async function offerDraft() {
    if (draftChecked) return;
    draftChecked = true;
    try {
      const r = await req('sprite.draft.load');
      if (!r || r.none || !r.sprite) return;
      const when = r.savedUtc ? new Date(r.savedUtc).toLocaleString() : 'earlier';
      if (await NoorUI.confirm('Bring back the sprite?', `NoorSprite has a sprite you hadn't saved (${r.name || 'Untitled'}, ${when}).`, 'Bring it back')) {
        setDoc(fromWire(r.sprite), r.path ? { path: r.path, name: r.name } : null, true);
        history.push({ label: 'Brought back', doc: blank(1, 1, null), layer: 0, frame: 0 }); // unsaved: it shows as changed
        renderAll();
      } else req('sprite.draft.clear').catch(() => {});
    } catch { /* none */ }
  }

  // ---------------------------------------------------------------- files

  /** The sprite as the app takes it: cels cropped to what they hold, pixels as base64. */
  function toWire(d = doc) {
    const cels = [], kinds = new Map(d.layers.map((l) => [l.id, l]));
    for (const [k, c] of d.cels) {
      const i = k.lastIndexOf(':'), id = k.slice(0, i), f = Number(k.slice(i + 1));
      const l = kinds.get(id);
      if (l && l.kind === 'tilemap') {
        // A tilemap cel: its tiles' numbers, row by row (the pixels come from the tileset).
        const { cols, rows } = mapSize(d, d.tilesets[l.tileset]);
        if (!c.map || !c.map.some((n) => n)) continue;
        cels.push({ layer: id, frame: f, x: 0, y: 0, width: cols, height: rows, opacity: c.opacity, tiles: [...c.map], ...(c.link ? { link: c.link } : {}) });
        continue;
      }
      let x0 = d.width, y0 = d.height, x1 = -1, y1 = -1;
      for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if (c.px[(y * d.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) continue; // empty: no cel
      const w = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) px.set(c.px.subarray(((y0 + y) * d.width + x0) * 4, ((y0 + y) * d.width + x0 + w) * 4), y * w * 4);
      cels.push({ layer: id, frame: f, x: x0, y: y0, width: w, height: h, opacity: c.opacity, data: b64(px), ...(c.link ? { link: c.link } : {}) });
    }
    const tilesets = (d.tilesets || []).map((t) => {
      const n = t.tiles.length - 1, strip = new Uint8Array(t.tw * t.th * 4 * n);
      for (let j = 1; j <= n; j++) strip.set(t.tiles[j], (j - 1) * t.tw * t.th * 4);
      return { name: t.name, tileWidth: t.tw, tileHeight: t.th, count: n, ...(n ? { data: b64(strip) } : {}) };
    });
    const layers = d.layers.map((l) => (l.kind === 'tilemap' ? l : (({ kind, tileset, ...rest }) => (void kind, void tileset, rest))(l)));
    return { version: 1, width: d.width, height: d.height, palette: d.palette, layers, frames: d.frames, tags: d.tags, slices: d.slices || [], tilesets, gridWidth: d.gridWidth, gridHeight: d.gridHeight, cels };
  }

  function fromWire(w) {
    const d = { width: w.width, height: w.height, palette: w.palette || [], layers: w.layers.map((l) => ({ ...l })), frames: w.frames.map((f) => ({ ...f })), tags: (w.tags || []).map((t) => ({ ...t })), slices: (w.slices || []).map((x) => ({ ...x })), gridWidth: w.gridWidth || 16, gridHeight: w.gridHeight || 16, cels: new Map() };
    d.tilesets = (w.tilesets || []).map((t) => {
      const size = t.tileWidth * t.tileHeight * 4, strip = t.data ? unb64(t.data) : new Uint8Array(0), tiles = [null];
      for (let j = 0; j < (t.count || 0); j++) tiles.push(new Uint8ClampedArray(strip.subarray(j * size, (j + 1) * size)));
      return { name: t.name || 'Tiles', tw: t.tileWidth, th: t.tileHeight, tiles };
    });
    for (const l of d.layers) if (l.kind !== 'tilemap' || !d.tilesets[l.tileset]) { delete l.kind; delete l.tileset; }
    const kinds = new Map(d.layers.map((l) => [l.id, l]));
    for (const c of w.cels || []) {
      const l = kinds.get(c.layer);
      if (l && l.kind === 'tilemap' && c.tiles) {
        // Tiles at the cel's place on the grid (the app keeps them from the top left).
        const ts = d.tilesets[l.tileset], { cols, rows } = mapSize(d, ts), map = new Int32Array(cols * rows);
        const ox = Math.round((c.x || 0) / ts.tw), oy = Math.round((c.y || 0) / ts.th);
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const tx = ox + x, ty = oy + y, n = c.tiles[y * c.width + x];
          if (tx >= 0 && ty >= 0 && tx < cols && ty < rows && n > 0 && n < ts.tiles.length) map[ty * cols + tx] = n;
        }
        const px = renderMap(d, ts, map);
        d.cels.set(key(c.layer, c.frame), { px, opacity: c.opacity ?? 255, map, mapPx: px, ...(c.link ? { link: c.link } : {}) });
        continue;
      }
      const px = new Uint8ClampedArray(d.width * d.height * 4), src = unb64(c.data);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const tx = c.x + x, ty = c.y + y;
        if (tx < 0 || ty < 0 || tx >= d.width || ty >= d.height) continue;
        px.set(src.subarray((y * c.width + x) * 4, (y * c.width + x) * 4 + 4), (ty * d.width + tx) * 4);
      }
      d.cels.set(key(c.layer, c.frame), { px, opacity: c.opacity ?? 255, ...(c.link ? { link: c.link } : {}) });
    }
    return d;
  }

  function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s); }
  function unb64(s) { const bin = atob(s), o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }

  async function openFile() {
    try {
      if (dirty() && !await NoorUI.confirm('Open another sprite?', 'The sprite open now has changes not saved.', 'Open')) return;
      const r = await req('sprite.open');
      if (!r || r.cancelled) return;
      if (r.sprite) { setDoc(fromWire(r.sprite), { path: r.path, name: r.name }); if (r.notes && r.notes.length) notice(r.notes.join(' '), 4000); }
      else if (r.image) setDoc(pictureSprite(r.image), null);
    } catch (err) { hooks.showError(err); }
  }

  /** A picture as a new one-layer sprite. */
  function pictureSprite(im) {
    const d = blank(im.width, im.height, null);
    d.cels.set(key(d.layers[0].id, 0), { px: new Uint8ClampedArray(unb64(im.data)), opacity: 255 });
    return d;
  }

  async function save(as) {
    commitFloating();
    try {
      const r = await req('sprite.save', { sprite: toWire(), path: as || !file ? null : file.path, name: file ? file.name : 'sprite' });
      if (!r || r.cancelled) return;
      file = { path: r.path, name: r.name };
      savedAt = history.length ? history[history.length - 1] : null;
      req('sprite.draft.clear').catch(() => {});
      renderAll();
      notice(`Saved ${r.name}`, 1400);
    } catch (err) { hooks.showError(err); }
  }

  async function importPicture(as) {
    try {
      const r = await req('sprite.picture.pick');
      if (!r || r.cancelled) return;
      const im = r.image, src = unb64(im.data);
      if (as === 'reference') {
        // Fitted into the sprite (nearest: it is to look at), half see-through, locked, never exported.
        change('A reference picture', (d) => {
          const id = newId(), k2 = Math.min(d.width / im.width, d.height / im.height);
          const w2 = Math.max(1, Math.round(im.width * k2)), h2 = Math.max(1, Math.round(im.height * k2)), ox = Math.floor((d.width - w2) / 2), oy = Math.floor((d.height - h2) / 2);
          const px = new Uint8ClampedArray(d.width * d.height * 4);
          for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) { const sx = Math.min(im.width - 1, Math.floor(x / k2)), sy = Math.min(im.height - 1, Math.floor(y / k2)); px.set(src.subarray((sy * im.width + sx) * 4, (sy * im.width + sx) * 4 + 4), ((oy + y) * d.width + ox + x) * 4); }
          d.layers.splice(0, 0, { id, name: r.name || 'Reference', visible: true, locked: true, opacity: 128, blend: 'normal', reference: true });
          for (let f = 0; f < d.frames.length; f++) d.cels.set(key(id, f), { px, opacity: 255, ...(d.frames.length > 1 ? { link: 'ref' + id } : {}) });
          layer++;
        });
        return;
      }
      if (as === 'layer') {
        change('Import a picture', (d) => {
          const id = newId();
          d.layers.splice(layer + 1, 0, { id, name: r.name || 'Picture', visible: true, locked: false, opacity: 255, blend: 'normal' });
          const px = new Uint8ClampedArray(d.width * d.height * 4);
          for (let y = 0; y < Math.min(im.height, d.height); y++) px.set(src.subarray(y * im.width * 4, (y * im.width + Math.min(im.width, d.width)) * 4), y * d.width * 4);
          d.cels.set(key(id, frame), { px, opacity: 255 });
          layer++;
        });
        return;
      }
      sheetDialog(im, src);
    } catch (err) { hooks.showError(err); }
  }

  /** A sprite sheet cut into frames by a grid: each cell a frame of a new sprite. */
  function sheetDialog(im, src) {
    NoorUI.modal({ label: 'Import a sprite sheet', width: 400 }, (s, closeIt) => {
      const fw = el('input', { type: 'number', min: '1', max: String(im.width), value: String(Math.min(im.width, im.height)), id: 'sp-sw', 'aria-label': 'Frame width' });
      const fh = el('input', { type: 'number', min: '1', max: String(im.height), value: String(Math.min(im.width, im.height)), id: 'sp-sh', 'aria-label': 'Frame height' });
      const gap = el('input', { type: 'number', min: '0', max: '64', value: '0', id: 'sp-sgap', 'aria-label': 'Space between frames' });
      const ok = () => {
        const w = Math.max(1, Number(fw.value)), h = Math.max(1, Number(fh.value)), g = Math.max(0, Number(gap.value));
        const cols = Math.floor((im.width + g) / (w + g)), rows = Math.floor((im.height + g) / (h + g));
        if (cols * rows < 1) { notice('No whole frame fits', 1500); return; }
        const d = blank(w, h, null);
        d.frames = [];
        const id = d.layers[0].id;
        for (let r2 = 0; r2 < rows; r2++) for (let c = 0; c < cols; c++) {
          const px = new Uint8ClampedArray(w * h * 4);
          let any = false;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((r2 * (h + g) + y) * im.width + c * (w + g) + x) * 4; px.set(src.subarray(i, i + 4), (y * w + x) * 4); if (src[i + 3]) any = true; }
          if (!any) continue; // empty cells of the sheet are left out
          d.cels.set(key(id, d.frames.length), { px, opacity: 255 });
          d.frames.push({ duration: 100 });
        }
        if (!d.frames.length) { notice('Every cell is empty', 1500); return; }
        closeIt();
        setDoc(d, null);
        notice(`${d.frames.length} frames from the sheet`, 1500);
      };
      s.append(NoorUI.head('Import a sprite sheet', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: `The picture is ${im.width} × ${im.height}. Each cell of the grid becomes a frame (empty ones are left out).` }),
          el('label', {}, 'Frame width ', fw), el('label', {}, 'Frame height ', fh), el('label', {}, 'Space between ', gap)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-sheet-ok', onclick: ok }, 'Import'))));
    });
  }

  function exportDialog() {
    commitFloating();
    NoorUI.modal({ label: 'Export', width: 420 }, (s, closeIt) => {
      const kind = el('select', { id: 'sp-ex-kind', 'aria-label': 'What' },
        el('option', { value: 'sheet', text: 'A sprite sheet (PNG and JSON)' }), el('option', { value: 'gif', text: 'An animated GIF' }),
        el('option', { value: 'godot', text: 'Godot: SpriteFrames (an animation per tag) and an AnimatedSprite2D scene' }),
        el('option', { value: 'frame', text: 'This frame (PNG)' }), el('option', { value: 'frames', text: 'Every frame (PNG files)' }));
      const form = el('select', { id: 'sp-ex-form', 'aria-label': 'JSON' }, el('option', { value: 'hash', text: 'frames by name (hash)' }), el('option', { value: 'array', text: 'a list of frames (array)' }));
      const scale = el('select', { id: 'sp-ex-scale', 'aria-label': 'Scale' }, ...[1, 2, 3, 4, 5, 6, 8, 10].map((n) => el('option', { value: String(n), text: `${n}×` })));
      const layout = el('select', { id: 'sp-ex-layout', 'aria-label': 'Layout' }, el('option', { value: 'row', text: 'a row' }), el('option', { value: 'column', text: 'a column' }), el('option', { value: 'grid', text: 'a grid' }), el('option', { value: 'packed', text: 'packed (trimmed, the same frames once)' }));
      const spacing = el('input', { type: 'number', min: '0', max: '64', value: '0', id: 'sp-ex-spacing', 'aria-label': 'Space between frames' });
      const tag = el('select', { id: 'sp-ex-tag', 'aria-label': 'Frames' }, el('option', { value: '', text: 'every frame' }), ...doc.tags.map((t, i) => el('option', { value: String(i), text: `tag “${t.name}”` })));
      const ok = async () => {
        const t = tag.value === '' ? null : doc.tags[Number(tag.value)];
        const which = kind.value === 'frame' ? [frame] : Array.from({ length: t ? t.to - t.from + 1 : doc.frames.length }, (_, i) => (t ? t.from : 0) + i);
        const frames = which.map((f) => ({ width: doc.width, height: doc.height, duration: doc.frames[f].duration, data: b64(new Uint8Array(compose(f, doc, null, true).buffer)) }));
        const tags = t ? [{ ...t, from: 0, to: t.to - t.from }] : doc.tags;
        closeIt();
        try {
          const r = await req('sprite.export', { kind: kind.value, frames, scale: Number(scale.value), layout: layout.value, spacing: Number(spacing.value), form: form.value, name: (file ? file.name.replace(/\.[^.]+$/, '') : 'sprite') + (t ? `-${t.name}` : ''), tags, slices: doc.slices || [],
            layers: doc.layers.map((l) => ({ id: l.id, name: l.name, opacity: l.opacity, blend: l.blend, reference: !!l.reference })) });
          if (r && !r.cancelled) notice(`Exported ${r.files.join(', ')}`, 2600);
        } catch (err) { hooks.showError(err); }
      };
      s.append(NoorUI.head('Export', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'What ', kind), el('label', {}, 'Frames ', tag), el('label', {}, 'Scale ', scale), el('label', {}, 'Sheet as ', layout), el('label', {}, 'Space between (px) ', spacing), el('label', {}, 'JSON ', form),
          el('p', { class: 'pref-hint', text: 'The JSON beside a sheet is in Aseprite\'s form (frames, durations, tags), which engines and libraries read.' })),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-ex-ok', onclick: ok }, 'Export…'))));
    });
  }

  // ---------------------------------------------------------------- keys

  function onKey(e) {
    const typing = e.target.closest('input[type=text], input[type=number], select, textarea');
    if (typing) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === ' ' && !ctrl) { spaceHeld = true; setCursor(); handled(); return; }
    if (e.key === 'Alt') { altHeld = true; setCursor(); handled(); return; }
    if (e.key === 'Escape') { handled(); if (floating) { commitFloating(); return; } if (selection) { deselect(); return; } if (!document.body.classList.contains('zen')) close(); return; }
    if (ctrl) {
      if (k === 'z') { handled(); undo(e.shiftKey); return; }
      if (k === 'y') { handled(); undo(true); return; }
      if (k === 's') { handled(); save(e.shiftKey); return; }
      if (k === 'o') { handled(); openFile(); return; }
      if (k === 'n') { handled(); newDialog(); return; }
      if (k === 'e') { handled(); exportDialog(); return; }
      if (k === 'a') { handled(); selectAll(); return; }
      if (k === 'd') { handled(); deselect(); return; }
      if (k === 'i' && e.shiftKey) { handled(); invertSelection(); return; }
      if (k === 'c') { handled(); copy(false); return; }
      if (k === 'b') { handled(); brushFromSelection(); return; }
      if (k === 'x') { handled(); copy(true); return; }
      if (k === 'v') { handled(); paste(); return; }
      return;
    }
    if (e.altKey && k === 'n') { handled(); addFrame(true, e.shiftKey); return; }
    if (e.altKey) return;
    if (e.key === 'Enter') { handled(); if (floating) commitFloating(); else if (playing) stop(); else play(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { handled(); clearSelection(); return; }
    if (e.key.startsWith('Arrow') && (floating || tool === 'move')) { handled(); const s = e.shiftKey ? 10 : 1; nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0); return; }
    if (k === ',' || e.key === 'ArrowLeft') { handled(); goFrame((frame - 1 + doc.frames.length) % doc.frames.length); return; }
    if (k === '.' || e.key === 'ArrowRight') { handled(); goFrame((frame + 1) % doc.frames.length); return; }
    if (e.key === 'ArrowUp') { handled(); layer = Math.min(doc.layers.length - 1, layer + 1); renderAll(); return; }
    if (e.key === 'ArrowDown') { handled(); layer = Math.max(0, layer - 1); renderAll(); return; }
    if (k === 'x') { handled(); swapColours(); return; }
    if (k === '[' || k === ']') { handled(); opts.size = Math.max(1, Math.min(64, opts.size + (k === ']' ? 1 : -1))); renderOptions(); draw(); return; }
    if (k === '+' || k === '=') { handled(); zoomBy(1); return; }
    if (k === '-') { handled(); zoomBy(-1); return; }
    if (k === '0') { handled(); fitZoom(); draw(); return; }
    if (k === 'n' && e.shiftKey) { handled(); addLayer(); return; }
    if (k === 't') { handled(); setTileMode(!tileMode); return; }
    const t = TOOLS.find((x) => x[3] === k);
    if (t) { handled(); setTool(t[0]); }
  }

  // Marching ants march.
  setInterval(() => { if (built && isOpen() && selection && !drag) draw(); }, 120);

  return {
    init, open, close, toggle, isOpen,
    _state: () => doc && ({
      width: doc.width, height: doc.height, layers: doc.layers.map((l) => ({ ...l })), frames: doc.frames.map((f) => ({ ...f })), tags: doc.tags.map((t) => ({ ...t })), palette: [...doc.palette],
      layer, frame, tool, fg: [...fg], bg: [...bg], opts: { ...opts }, view: { ...view }, history: history.length, future: future.length, dirty: dirty(), file,
      selection: selection ? { x0: selection.x0, y0: selection.y0, x1: selection.x1, y1: selection.y1, count: selection.mask.reduce((a, b) => a + b, 0) } : null,
      floating: floating ? { x: floating.x, y: floating.y, w: floating.w, h: floating.h } : null, playing: !!playing,
      cels: [...doc.cels.keys()],
      tilesets: (doc.tilesets || []).map((t) => ({ name: t.name, tw: t.tw, th: t.th, count: t.tiles.length - 1 })), tileMode, tileSel,
    }),
    /** For tests: a tilemap cel's tile numbers (row by row). */
    _tiles: (l = layer, f = frame) => { const c = doc.cels.get(key(doc.layers[l].id, f)); return c && c.map ? [...c.map] : null; },
    /** For tests: a pixel of a cel (or of the composed frame when layer is null). */
    _pixel: (x, y, l = layer, f = frame) => { const px = l === null ? compose(f) : (doc.cels.get(key(doc.layers[l].id, f)) || { px: new Uint8ClampedArray(doc.width * doc.height * 4) }).px; const i = (y * doc.width + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; },
    /** For tests: where a sprite pixel's middle is on the screen. */
    _screen: (x, y) => { const r = $('#sp-canvas').getBoundingClientRect(), o = origin(); return { x: r.left + o.x + (x + 0.5) * view.zoom, y: r.top + o.y + (y + 0.5) * view.zoom }; },
    _wire: () => toWire(),
    _draft: () => saveDraft(),
    /** For tests: a sprite as the app sends one, opened. */
    _load: (w) => setDoc(fromWire(w), null),
  };
})();
