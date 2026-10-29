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
    ['move', '✥', 'Move (V): the selection, or the layer', 'v'], ['hand', '✋', 'Hand (H; or hold Space)', 'h'],
  ];

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  let doc = null;           // the sprite: { width, height, palette, layers, frames, tags, gridWidth, gridHeight, cels: Map }
  let file = null;          // { path, name } of the file it came from / was saved as
  let layer = 0, frame = 0; // the layer (index, bottom first) and frame being drawn
  let tool = 'pencil';
  let fg = [0, 0, 0, 255], bg = [255, 255, 255, 255];
  let opts = { size: 1, round: false, perfect: true, contiguous: true, tolerance: 0, filled: false, mirrorX: false, mirrorY: false };
  let view = { zoom: 8, panX: 0, panY: 0, grid: false, pixelGrid: true, onion: false, onionBefore: 1, onionAfter: 1, onionAlpha: 0.35 };
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
    const d = { width, height, palette: PALETTES[paletteName].split(' ').map((c) => `#${c}ff`), layers: [], frames: [{ duration: 100 }], tags: [], gridWidth: 16, gridHeight: 16, cels: new Map() };
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
  const snapshot = (d) => ({ ...d, palette: [...d.palette], layers: d.layers.map((l) => ({ ...l })), frames: d.frames.map((f) => ({ ...f })), tags: d.tags.map((t) => ({ ...t })), cels: new Map(d.cels) });

  /** A change: the sprite before it kept for undo (with where we were), then the change made to a fresh snapshot. */
  function change(label, fn) {
    history.push({ label, doc, layer, frame });
    if (history.length > 200) { history.shift(); if (savedAt && !history.includes(savedAt)) savedAt = 'lost'; }
    future = [];
    doc = snapshot(doc);
    fn(doc);
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

  /** The current cel's pixels to draw into: a copy (the old stays with undo), or a new empty one. */
  function editable(d = doc) {
    const k = key(d.layers[layer].id, frame);
    const old = d.cels.get(k);
    const px = old ? new Uint8ClampedArray(old.px) : new Uint8ClampedArray(d.width * d.height * 4);
    d.cels.set(k, { px, opacity: old ? old.opacity : 255 });
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
  function compose(f, d = doc, only = null) {
    const n = d.width * d.height, out = new Uint8ClampedArray(n * 4);
    d.layers.forEach((l, li) => {
      if (only ? !only.includes(li) : !l.visible) return;
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
            el('button', { class: 'icon-btn', title: 'Add the colour to the palette', 'aria-label': 'Add to palette', onclick: addToPalette }, '＋')),
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
    renderTools(); renderColours(); renderPalette(); renderOptions(); renderLayerProps(); renderViewOpts(); renderTimeline();
    fitCanvas(); draw(); drawPreview(); status();
    keepFocus();
  }

  function renderTools() {
    $('#sp-tools').replaceChildren(...TOOLS.map(([id, icon, title]) => el('button', { class: 'icon-btn sp-tool' + (tool === id ? ' on' : ''), 'data-tool': id, title, 'aria-label': title, 'aria-pressed': String(tool === id), onclick: () => setTool(id) }, icon)));
  }

  function setTool(t) { if (t !== 'move') commitFloating(); tool = t; renderTools(); renderOptions(); setCursor(); keepFocus(); }

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
    box.replaceChildren(...doc.palette.map((c, i) => el('button', { class: 'sp-pal' + (c === current ? ' on' : ''), 'data-index': String(i), 'data-colour': c, title: `${c} (click: draw with it; right-click: second colour; Shift+click: remove)`, style: `--c:${c}`,
      onclick: (e) => { if (e.shiftKey) { change('Remove a colour', (d) => { d.palette.splice(i, 1); }); return; } fg = parseHex(c); renderColours(); renderPalette(); keepFocus(); },
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
    if (tool === 'pencil') parts.push(check('perfect', 'pixel-perfect', 'Lines one pixel wide without doubled corners (size 1)'));
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
    cop.addEventListener('change', () => change('Cel opacity', (d) => { const k = key(d.layers[layer].id, frame); const old = d.cels.get(k); if (old) d.cels.set(k, { ...old, opacity: Number(cop.value) }); }));
    const dur = el('input', { type: 'number', min: '1', max: '65535', value: String(doc.frames[frame].duration), class: 'sb-num', id: 'sp-duration', 'aria-label': 'Frame duration (ms)' });
    dur.addEventListener('change', () => { const v = Math.max(1, Math.min(65535, Math.round(Number(dur.value) || 100))); change('Frame duration', (d) => { d.frames[frame].duration = v; }); });
    box.replaceChildren(
      el('h4', { class: 'music-subhead', text: `Layer “${l.name}”` }),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Blend' }), blend),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Opacity' }), op),
      el('label', { class: 'sb-inline', title: 'This frame\'s picture on the layer' }, el('span', { text: 'Cel opacity' }), cop),
      el('h4', { class: 'music-subhead', text: `Frame ${frame + 1}` }),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Shows for (ms)' }), dur));
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
          el('span', { class: 'sp-layername', text: l.name })),
        ...doc.frames.map((_, fi) => {
          const c = doc.cels.get(key(l.id, fi));
          return el('button', { class: 'sp-tl-cel' + (c ? ' full' : '') + (fi === frame && li === layer ? ' on' : ''), 'data-cel': `${li}:${fi}`, title: c ? 'A picture on this frame' : 'Empty', 'aria-label': `${l.name}, frame ${fi + 1}`, onclick: () => { layer = li; goFrame(fi); } });
        }));
    });
    const layerBar = el('div', { class: 'sp-tl-row sp-tl-foot' }, el('div', { class: 'sp-tl-name' },
      el('button', { class: 'icon-btn', id: 'sp-addlayer', title: 'New layer (Shift+N)', 'aria-label': 'New layer', onclick: addLayer }, '＋'),
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

  function addFrame(copy) {
    change(copy ? 'New frame' : 'New empty frame', (d) => {
      const at = frame + 1;
      d.frames.splice(at, 0, { duration: d.frames[frame].duration });
      shiftFrames(d, at, 1);
      if (copy) d.layers.forEach((l) => { const c = d.cels.get(key(l.id, frame)); if (c) d.cels.set(key(l.id, at), c); });
      frame = at;
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
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(o.x - 0.5, o.y - 0.5, W + 1, H + 1);
    // The selection's edge (marching ants).
    if (selection) drawSelection(ctx, o, z);
    // The brush under the cursor.
    if (hover && ['pencil', 'eraser'].includes(tool) && !spaceHeld && !altHeld) {
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
    s.textContent = `${at ? `${at.x}, ${at.y}${colour}` : `${doc.width} × ${doc.height}`} · ${view.zoom * 100}%${sel} · ${doc.layers[layer].name}, frame ${frame + 1}${doc.layers[layer].locked ? ' (locked)' : ''}`;
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
    if (t === 'picker') { pick(p, e.button === 2); drag = { kind: 'picker', right: e.button === 2 }; return; }
    if (['select', 'eselect', 'lasso', 'wand'].includes(t)) { startSelect(t, p, e); return; }
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
      drag = { kind: 'stroke', colour: t === 'eraser' ? [0, 0, 0, 0] : colour, last: [p.x, p.y], preview: base ? new Uint8ClampedArray(base.px) : new Uint8ClampedArray(doc.width * doc.height * 4), original: base ? base.px : null, trail: [] };
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
    for (const [px, py] of brushPoints(x, y)) plot(d.preview, px, py, d.colour);
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
    if (drag.kind === 'stroke') {
      const pts = linePoints(drag.last[0], drag.last[1], p.x, p.y).slice(1);
      for (const [x, y] of pts) stamp(x, y);
      drag.last = [p.x, p.y];
      draw(); status();
      return;
    }
    if (drag.kind === 'shape') { drag.to = [p.x, p.y]; drag.preview = shapePreview(e); draw(); return; }
    if (drag.kind === 'select') { moveSelect(p, e); return; }
    if (drag.kind === 'move') { floating.x = drag.fx + (p.x - drag.px); floating.y = drag.fy + (p.y - drag.py); draw(); }
  }

  function onUp(e) {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === 'stroke') change(d.colour[3] === 0 && tool === 'eraser' ? 'Erase' : 'Draw', (doc2) => { doc2.cels.set(key(doc2.layers[layer].id, frame), { px: d.preview, opacity: (cel() || { opacity: 255 }).opacity }); });
    else if (d.kind === 'shape') change(d.tool === 'line' ? 'Line' : d.tool === 'rect' ? 'Rectangle' : 'Ellipse', (doc2) => { doc2.cels.set(key(doc2.layers[layer].id, frame), { px: shapePreview(e, d), opacity: (cel() || { opacity: 255 }).opacity }); });
    else if (d.kind === 'select') endSelect(d);
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
    change('Move', (d) => { d.cels.set(key(d.layers[layer].id, frame), { px: rest, opacity: c.opacity }); });
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
    doc = snapshot(doc);
    doc.cels.set(k, { px, opacity: old ? old.opacity : 255 });
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

  function setDoc(d, f) {
    stop();
    doc = d; file = f; layer = Math.min(layer, d.layers.length - 1); frame = 0;
    if (layer < 0) layer = 0;
    history = []; future = []; savedAt = null; selection = null; floating = null;
    fitZoom(); renderAll();
  }

  // ---------------------------------------------------------------- files

  /** The sprite as the app takes it: cels cropped to what they hold, pixels as base64. */
  function toWire(d = doc) {
    const cels = [];
    for (const [k, c] of d.cels) {
      const i = k.lastIndexOf(':'), id = k.slice(0, i), f = Number(k.slice(i + 1));
      let x0 = d.width, y0 = d.height, x1 = -1, y1 = -1;
      for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if (c.px[(y * d.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) continue; // empty: no cel
      const w = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) px.set(c.px.subarray(((y0 + y) * d.width + x0) * 4, ((y0 + y) * d.width + x0 + w) * 4), y * w * 4);
      cels.push({ layer: id, frame: f, x: x0, y: y0, width: w, height: h, opacity: c.opacity, data: b64(px) });
    }
    return { version: 1, width: d.width, height: d.height, palette: d.palette, layers: d.layers, frames: d.frames, tags: d.tags, gridWidth: d.gridWidth, gridHeight: d.gridHeight, cels };
  }

  function fromWire(w) {
    const d = { width: w.width, height: w.height, palette: w.palette || [], layers: w.layers.map((l) => ({ ...l })), frames: w.frames.map((f) => ({ ...f })), tags: (w.tags || []).map((t) => ({ ...t })), gridWidth: w.gridWidth || 16, gridHeight: w.gridHeight || 16, cels: new Map() };
    for (const c of w.cels || []) {
      const px = new Uint8ClampedArray(d.width * d.height * 4), src = unb64(c.data);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const tx = c.x + x, ty = c.y + y;
        if (tx < 0 || ty < 0 || tx >= d.width || ty >= d.height) continue;
        px.set(src.subarray((y * c.width + x) * 4, (y * c.width + x) * 4 + 4), (ty * d.width + tx) * 4);
      }
      d.cels.set(key(c.layer, c.frame), { px, opacity: c.opacity ?? 255 });
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
      renderAll();
      notice(`Saved ${r.name}`, 1400);
    } catch (err) { hooks.showError(err); }
  }

  async function importPicture(as) {
    try {
      const r = await req('sprite.picture.pick');
      if (!r || r.cancelled) return;
      const im = r.image, src = unb64(im.data);
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
        el('option', { value: 'frame', text: 'This frame (PNG)' }), el('option', { value: 'frames', text: 'Every frame (PNG files)' }));
      const scale = el('select', { id: 'sp-ex-scale', 'aria-label': 'Scale' }, ...[1, 2, 3, 4, 5, 6, 8, 10].map((n) => el('option', { value: String(n), text: `${n}×` })));
      const layout = el('select', { id: 'sp-ex-layout', 'aria-label': 'Layout' }, el('option', { value: 'row', text: 'a row' }), el('option', { value: 'column', text: 'a column' }), el('option', { value: 'grid', text: 'a grid' }));
      const spacing = el('input', { type: 'number', min: '0', max: '64', value: '0', id: 'sp-ex-spacing', 'aria-label': 'Space between frames' });
      const tag = el('select', { id: 'sp-ex-tag', 'aria-label': 'Frames' }, el('option', { value: '', text: 'every frame' }), ...doc.tags.map((t, i) => el('option', { value: String(i), text: `tag “${t.name}”` })));
      const ok = async () => {
        const t = tag.value === '' ? null : doc.tags[Number(tag.value)];
        const which = kind.value === 'frame' ? [frame] : Array.from({ length: t ? t.to - t.from + 1 : doc.frames.length }, (_, i) => (t ? t.from : 0) + i);
        const frames = which.map((f) => ({ width: doc.width, height: doc.height, duration: doc.frames[f].duration, data: b64(new Uint8Array(compose(f).buffer)) }));
        const tags = t ? [{ ...t, from: 0, to: t.to - t.from }] : doc.tags;
        closeIt();
        try {
          const r = await req('sprite.export', { kind: kind.value, frames, scale: Number(scale.value), layout: layout.value, spacing: Number(spacing.value), name: (file ? file.name.replace(/\.[^.]+$/, '') : 'sprite') + (t ? `-${t.name}` : ''), tags, layers: doc.layers.map((l) => ({ id: l.id, name: l.name, opacity: l.opacity, blend: l.blend })) });
          if (r && !r.cancelled) notice(`Exported ${r.files.join(', ')}`, 2600);
        } catch (err) { hooks.showError(err); }
      };
      s.append(NoorUI.head('Export', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'What ', kind), el('label', {}, 'Frames ', tag), el('label', {}, 'Scale ', scale), el('label', {}, 'Sheet as ', layout), el('label', {}, 'Space between (px) ', spacing),
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
      if (k === 'x') { handled(); copy(true); return; }
      if (k === 'v') { handled(); paste(); return; }
      return;
    }
    if (e.altKey && k === 'n') { handled(); addFrame(true); return; }
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
    }),
    /** For tests: a pixel of a cel (or of the composed frame when layer is null). */
    _pixel: (x, y, l = layer, f = frame) => { const px = l === null ? compose(f) : (doc.cels.get(key(doc.layers[l].id, f)) || { px: new Uint8ClampedArray(doc.width * doc.height * 4) }).px; const i = (y * doc.width + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; },
    /** For tests: where a sprite pixel's middle is on the screen. */
    _screen: (x, y) => { const r = $('#sp-canvas').getBoundingClientRect(), o = origin(); return { x: r.left + o.x + (x + 0.5) * view.zoom, y: r.top + o.y + (y + 0.5) * view.zoom }; },
    _wire: () => toWire(),
    /** For tests: a sprite as the app sends one, opened. */
    _load: (w) => setDoc(fromWire(w), null),
  };
})();
