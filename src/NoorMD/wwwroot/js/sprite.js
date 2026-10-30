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
    ['rect', '▭', 'Rectangle (U)', 'u'], ['ellipse', '◯', 'Ellipse (O)', 'o'], ['isobox', '⬢', 'Isometric box (Y): drag a rectangle and a box fills it (Shift: a cube)', 'y'], ['picker', '💧', 'Eyedropper (I; or hold Alt)', 'i'], ['curve', '⌒', 'Curve (J): drag the line, then move to bend it and click', 'j'], ['gradient', '◐', 'Gradient (D): drag from the drawing colour to the second', 'd'],
    ['select', '⬚', 'Select a rectangle (M)', 'm'], ['eselect', '◌', 'Select an ellipse', null], ['lasso', '➰', 'Lasso (Q)', 'q'], ['wand', '🪄', 'Magic wand (W)', 'w'],
    ['move', '✥', 'Move (V): the selection, or the layer', 'v'], ['slice', '⧉', 'Slices (C): named rectangles — a 9-slice centre, a pivot', 'c'], ['bone', '🦴', 'Bones (K): a skeleton that layers move with; pose it frame by frame', 'k'], ['hand', '✋', 'Hand (H; or hold Space)', 'h'],
  ];

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  let doc = null;           // the sprite: { width, height, palette, layers, frames, tags, gridWidth, gridHeight, cels: Map }
  let file = null;          // { path, name } of the file it came from / was saved as
  let layer = 0, frame = 0; // the layer (index, bottom first) and frame being drawn
  let tool = 'pencil';
  let fg = [0, 0, 0, 255], bg = [255, 255, 255, 255];
  let opts = { size: 1, round: false, perfect: true, contiguous: true, tolerance: 0, filled: false, mirrorX: false, mirrorY: false, radial: 0, axisX: null, axisY: null, ink: 'simple', dither: 0, custom: false, stabilize: 0, pressure: false, gradShape: 'linear', gradBlend: 'dither', pattern: 'solid' };
  let brushImage = null;    // a brush cut from the sprite: { px, w, h }
  // Ordered dithering (a 4 × 4 Bayer matrix): a pixel is drawn when its cell is under the level (of 16).
  // The stabilizer: the brush hangs on a string this long (screen pixels) behind the cursor, so lines come out smooth.
  const STABILIZERS = [[0, 'off'], [16, 'gentle'], [32, 'medium'], [64, 'strong'], [112, 'very strong']];
  // Fill patterns: where the first colour goes (else the second).
  const PATTERNS = {
    solid: ['solid', () => true], checker: ['checkers', (x, y) => ((x + y) & 1) === 0], dots: ['dots', (x, y) => (x & 1) === 0 && (y & 1) === 0],
    hlines: ['lines across', (x, y) => (y & 1) === 0], vlines: ['lines down', (x) => (x & 1) === 0], diag: ['diagonals', (x, y) => ((x + y) & 3) === 0],
    bricks: ['bricks', (x, y) => (y & 3) === 3 || ((x + ((y >> 2) & 1) * 4) & 7) === 0], b25: ['25 %', (x, y) => BAYER[(y & 3) * 4 + (x & 3)] < 4], b75: ['75 %', (x, y) => BAYER[(y & 3) * 4 + (x & 3)] < 12],
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const DITHERS = [[0, 'solid'], [14, '88%'], [12, '75%'], [8, '50%'], [4, '25%'], [2, '12%']];
  let view = { zoom: 8, panX: 0, panY: 0, grid: false, pixelGrid: true, onion: false, onionBefore: 1, onionAfter: 1, onionAlpha: 0.35, slices: true, tiled: '', path: false, onionTag: false, onionOutline: false, thumbs: false, seen: '', bones: false, lit: false, jaggies: false, fontGuide: false, isoGrid: false, collision: false, collisionTol: 1, previewScale: 0 };
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
    normalizeIndexed(doc, prev);
    normalizeTilemaps(doc, prev);
    normalizeBones(doc, prev);
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

  // ---------------------------------------------------------------- layer groups

  // A group is a layer of kind 'group' with no pictures; the layers in it name it as their parent and come right after
  // it in the list (the group first, then what is in it, bottom first — as Aseprite keeps them).
  const isGroup = (l) => !!l && l.kind === 'group';
  /** The layers a layer is in, nearest first. */
  function ancestors(d, l) {
    const out = [];
    for (let p = l.parent, n = 0; p && n < 64; n++) { const g = d.layers.find((x) => x.id === p); if (!g) break; out.push(g); p = g.parent; }
    return out;
  }
  const shown = (d, l) => l.visible && ancestors(d, l).every((g) => g.visible);
  const lockedLayer = (d, l) => l.locked || ancestors(d, l).some((g) => g.locked);
  /** The index of the last layer inside group gi (gi itself when it is empty or not a group). */
  function blockEnd(d, gi) {
    const id = d.layers[gi].id;
    let e = gi;
    while (e + 1 < d.layers.length && ancestors(d, d.layers[e + 1]).some((g) => g.id === id)) e++;
    return e;
  }

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
      if (isGroup(l)) return;
      if (only ? !only.includes(li) : !shown(d, l)) return;
      if (forExport && (l.reference || l.normals)) return;
      const c = d.cels.get(key(l.id, f));
      if (!c) return;
      const k = (l.opacity / 255) * (c.opacity / 255) * (only ? 1 : ancestors(d, l).reduce((m, g) => m * g.opacity / 255, 1));
      if (k <= 0) return;
      const px = l.outline ? outlined(c.px, d.width, d.height, l.outline) : c.px;
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
          el('button', { class: 'icon-btn', id: 'sp-share', title: 'Share: a GIF or a video, bigger with sharp pixels', 'aria-label': 'Share', onclick: shareDialog }, '📤'),
          el('button', { class: 'icon-btn', id: 'sp-export', title: 'Export: PNG, frames, a sprite sheet with JSON, an animated GIF (Ctrl+E here)', 'aria-label': 'Export', onclick: exportDialog }, '⤓'),
          el('button', { class: 'icon-btn', id: 'sp-cmd', title: 'Find a command (Ctrl+K here); give any a shortcut of your own', 'aria-label': 'Commands', onclick: commandSearch }, '⌕'),
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
            el('button', { class: 'icon-btn', id: 'sp-cycle', title: 'Colour cycling: play / stop (an indexed sprite\'s palette colours turning round)', 'aria-label': 'Colour cycling', onclick: toggleCycling }, '🌈'),
            el('button', { class: 'icon-btn', id: 'sp-palmenu', title: 'Palette: sort, a ramp, the sprite\'s colours, load and save…', 'aria-label': 'Palette menu', onclick: paletteMenu }, '⋯')),
          el('div', { class: 'sp-palette', id: 'sp-palette', role: 'listbox', 'aria-label': 'Palette (click: draw with it; right-click: second colour; Shift+click: remove)' })),
        el('div', { class: 'sp-centre' },
          el('div', { class: 'sp-options', id: 'sp-options' }),
          el('div', { class: 'sp-stage', id: 'sp-stage' },
            el('canvas', { id: 'sp-canvas', class: 'sp-canvas', role: 'img', 'aria-label': 'The sprite: draw on it' })),
          el('div', { class: 'sp-status', id: 'sp-status', 'aria-live': 'polite' })),
        el('div', { class: 'sp-right' },
          el('div', { class: 'sp-preview-box' }, el('canvas', { id: 'sp-preview', class: 'sp-preview', role: 'img', 'aria-label': 'Preview at real size', title: 'Click: 1×, 2×, 3×, 4× or fitted — the size it will be in the game', onclick: () => { view.previewScale = (view.previewScale + 1) % 5; drawPreview(); } }),
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
    // Keys let go anywhere (focus may have moved to a menu or a redrawn button), or the window left: nothing stays held.
    document.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceHeld = false; setCursor(); } if (e.key === 'Alt') { altHeld = false; setCursor(); } }, true);
    window.addEventListener('blur', () => { spaceHeld = false; altHeld = false; setCursor(); });
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
    $('#sp-file').textContent = `${file ? file.name : 'Untitled'}${dirty() ? ' •' : ''} · ${doc.width} × ${doc.height} · ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'} · ${doc.frames.length} frame${doc.frames.length === 1 ? '' : 's'}${doc.indexed ? ' · indexed' : ''}`;
    renderTools(); renderColours(); renderPalette(); renderOptions(); renderLayerProps(); renderViewOpts(); renderTimeline(); renderSlicePanel(); renderBonePanel(); renderTileset();
    fitCanvas(); setCursor(); draw(); drawPreview(); status();
    keepFocus();
  }

  function renderTools() {
    $('#sp-tools').replaceChildren(...TOOLS.map(([id, icon, title]) => el('button', { class: 'icon-btn sp-tool' + (tool === id ? ' on' : ''), 'data-tool': id, title, 'aria-label': title, 'aria-pressed': String(tool === id), onclick: () => setTool(id) }, icon)));
  }

  function setTool(t) { if (t !== 'move') commitFloating(); curve = null; if (tilesOn() && !['pencil', 'eraser', 'fill', 'picker', 'hand', 'slice'].includes(t)) tileMode = false; tool = t; renderTileset(); renderBonePanel(); renderTools(); renderOptions(); renderSlicePanel(); setCursor(); draw(); keepFocus(); }

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
    const cb = $('#sp-cycle');
    if (cb) { cb.hidden = !doc.indexed; cb.classList.toggle('on', !!cycling); }
    box.classList.toggle('indexed', !!doc.indexed);
    box.replaceChildren(...doc.palette.map((c, i) => el('button', { class: 'sp-pal' + (c === current ? ' on' : ''), 'data-index': String(i), 'data-colour': c, title: `${c} (click: draw with it; right-click: second colour; double-click: change it; Shift+click: remove)`, style: `--c:${c}`,
      onclick: (e) => { if (e.shiftKey) { change('Remove a colour', (d) => { const old = d.palette; d.palette = old.filter((_, j) => j !== i); remapIndices(d, old.map((_, j) => (j < i ? j : j === i ? -1 : j - 1)), old); }); return; } fg = parseHex(c); renderColours(); renderPalette(); keepFocus(); },
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
    const check = (k, label, title) => { const c = el('input', { type: 'checkbox', checked: opts[k] || undefined, 'data-opt': k }); c.addEventListener('change', () => { opts[k] = c.checked; if (k.startsWith('mirror')) { renderOptions(); draw(); } keepFocus(); }); return el('label', { class: 'sb-inline', title }, c, el('span', { text: label })); };
    const num = (k, label, min, max, title) => {
      const i = el('input', { type: 'number', min: String(min), max: String(max), value: String(opts[k]), class: 'sb-num', 'data-opt': k, 'aria-label': label });
      i.addEventListener('change', () => { opts[k] = Math.max(min, Math.min(max, Math.round(Number(i.value) || min))); i.value = String(opts[k]); keepFocus(); });
      return el('label', { class: 'sb-inline', title }, el('span', { text: label }), i);
    };
    const parts = [];
    if (['pencil', 'eraser', 'line'].includes(tool)) parts.push(num('size', 'Size', 1, 64, 'The brush in pixels ([ and ])'), check('round', 'round', 'A round brush (else square)'));
    if (tool === 'pencil' || tool === 'eraser') parts.push(check('pressure', 'pen pressure', 'With a pen: pressing lightly draws thinner (up to the size)'));
    if (tool === 'pencil') {
      parts.push(check('perfect', 'pixel-perfect', 'Lines one pixel wide without doubled corners (size 1)'));
      const inkSel = el('select', { 'data-opt': 'ink', 'aria-label': 'Ink', title: 'Shading: each pixel steps along the palette (left click one way, right click the other)' }, el('option', { value: 'simple', text: 'plain' }), el('option', { value: 'shade', text: 'shading' }));
      inkSel.value = opts.ink; inkSel.addEventListener('change', () => { opts.ink = inkSel.value; keepFocus(); });
      const dith = el('select', { 'data-opt': 'dither', 'aria-label': 'Dithering', title: 'Draw only some pixels, in an even pattern (ordered dithering)' }, ...DITHERS.map(([v, l]) => el('option', { value: String(v), text: l })));
      dith.value = String(opts.dither); dith.addEventListener('change', () => { opts.dither = Number(dith.value); keepFocus(); });
      parts.push(el('label', { class: 'sb-inline' }, el('span', { text: 'Ink' }), inkSel), el('label', { class: 'sb-inline' }, el('span', { text: 'Pattern' }), dith));
    }
    if (tool === 'pencil' || tool === 'eraser') {
      const stab = el('select', { 'data-opt': 'stabilize', id: 'sp-stabilize', 'aria-label': 'Stabilizer', title: 'Smooth lines: the brush follows the cursor on a string, so wobbles even out into round curves (S cycles)' }, ...STABILIZERS.map(([v, l]) => el('option', { value: String(v), text: l })));
      stab.value = String(opts.stabilize); stab.addEventListener('change', () => { opts.stabilize = Number(stab.value); keepFocus(); });
      parts.push(el('label', { class: 'sb-inline' }, el('span', { text: 'Smooth' }), stab));
    }
    if (tool === 'pencil') {
      if (brushImage) parts.push(check('custom', `the brush cut from the sprite (${brushImage.w} × ${brushImage.h})`, 'Draw with the picture cut with Ctrl+B'));
      else parts.push(el('span', { class: 'pref-hint', text: 'Ctrl+B: a brush from the selection' }));
    }
    if (['pencil', 'eraser', 'line', 'rect', 'ellipse', 'fill'].includes(tool)) {
      const axis = (k, label) => {
        const i = el('input', { type: 'number', step: '0.5', min: '0', max: String(k === 'axisX' ? doc.width : doc.height), value: String(k === 'axisX' ? axisX() : axisY()), class: 'sb-num', 'data-opt': k, 'aria-label': label, title: `${label} (in pixels; .5 is a pixel's middle)` });
        i.addEventListener('change', () => { const v = Math.round(Number(i.value) * 2) / 2; opts[k] = Number.isFinite(v) ? v : null; draw(); keepFocus(); });
        return i;
      };
      const radial = el('select', { 'data-opt': 'radial', id: 'sp-radial', 'aria-label': 'Radial symmetry', title: 'Copies turned round where the axes cross (a star, a flower, a wheel)' }, el('option', { value: '0', text: 'none' }), ...[2, 3, 4, 5, 6, 8].map((n) => el('option', { value: String(n), text: `${n}×` })));
      radial.value = String(opts.radial); radial.addEventListener('change', () => { opts.radial = Number(radial.value); renderOptions(); draw(); keepFocus(); });
      parts.push(check('mirrorX', 'mirror ↔', 'Draw the other side too, mirrored about the vertical axis'), check('mirrorY', 'mirror ↕', 'Draw the other half too, mirrored about the horizontal axis'),
        el('label', { class: 'sb-inline' }, el('span', { text: 'Radial' }), radial));
      if (opts.mirrorX || opts.mirrorY || opts.radial) parts.push(el('label', { class: 'sb-inline' }, el('span', { text: 'Axes' }), axis('axisX', 'Vertical axis at x'), axis('axisY', 'Horizontal axis at y')),
        el('button', { class: 'utility-btn', id: 'sp-axes-middle', title: 'The axes back in the middle', onclick: () => { opts.axisX = opts.axisY = null; renderOptions(); draw(); } }, 'Middle'));
    }
    if (tool === 'fill' && !tilesOn()) {
      const pat = el('select', { 'data-opt': 'pattern', id: 'sp-pattern', 'aria-label': 'Pattern', title: 'Fill with a pattern of the two colours (right click swaps them)' }, ...Object.entries(PATTERNS).map(([v, [l]]) => el('option', { value: v, text: l })));
      pat.value = opts.pattern; pat.addEventListener('change', () => { opts.pattern = pat.value; keepFocus(); });
      parts.push(el('label', { class: 'sb-inline' }, el('span', { text: 'Pattern' }), pat));
    }
    if (tool === 'gradient') {
      const shape = el('select', { 'data-opt': 'gradShape', id: 'sp-gradshape', 'aria-label': 'Gradient shape' }, el('option', { value: 'linear', text: 'straight' }), el('option', { value: 'radial', text: 'round' }));
      shape.value = opts.gradShape; shape.addEventListener('change', () => { opts.gradShape = shape.value; keepFocus(); });
      const blend = el('select', { 'data-opt': 'gradBlend', id: 'sp-gradblend', 'aria-label': 'Gradient blend', title: 'Dithered: only the two colours, mixed in an even pattern (pixel art); smooth: every colour between' }, el('option', { value: 'dither', text: 'dithered' }), el('option', { value: 'smooth', text: 'smooth' }));
      blend.value = opts.gradBlend; blend.addEventListener('change', () => { opts.gradBlend = blend.value; keepFocus(); });
      parts.push(el('label', { class: 'sb-inline' }, el('span', { text: 'Shape' }), shape), el('label', { class: 'sb-inline' }, el('span', { text: 'Blend' }), blend),
        el('span', { class: 'pref-hint', text: 'Inside the selection when there is one' }));
    }
    if (tool === 'fill' || tool === 'wand') parts.push(check('contiguous', 'touching only', 'Only the area touching the click (else every pixel of that colour)'), num('tolerance', 'Tolerance', 0, 255, 'How different a colour may be and still count as the same'));
    if (tool === 'isobox') parts.push(el('span', { class: 'pref-hint', text: 'Its top lighter and its right wall darker than the colour · Shift: a cube · the line tool with Shift draws 2:1 lines · View › diamonds: an isometric grid' }));
    if (tool === 'rect' || tool === 'ellipse') parts.push(check('filled', 'filled', 'Filled (else only the outline); Shift: a square or a circle'));
    if (['select', 'eselect', 'lasso', 'wand'].includes(tool)) parts.push(el('span', { class: 'pref-hint', text: 'Shift: add · Alt: take away · Ctrl+A all · Ctrl+D none · Ctrl+Shift+I turn round' }));
    if (tool === 'move') parts.push(el('span', { class: 'pref-hint', text: 'Drag or use the arrow keys (Shift: 10 px) · Enter puts it down' }));
    $('#sp-options').replaceChildren(el('strong', { text: (TOOLS.find((t) => t[0] === tool) || [])[2] || '' }), ...parts);
  }

  /** The frame's sound: its name, choose one, take it away. */
  function soundRow() {
    const snd = doc.frames[frame].sound;
    return el('div', { class: 'sb-row', id: 'sp-sound' },
      el('span', { class: 'pref-hint', text: snd ? `♪ ${snd.name}` : 'No sound' }),
      el('button', { class: 'utility-btn', id: 'sp-sound-pick', title: 'A sound this frame plays when it comes (footsteps, a swing): exported with Godot animations', onclick: () => frameSound(false) }, snd ? 'Another…' : 'A sound…'),
      snd ? el('button', { class: 'icon-btn', id: 'sp-sound-clear', title: 'No sound', 'aria-label': 'Take the sound away', onclick: () => frameSound(true) }, '✕') : null);
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
    // Which group the layer is in (not itself or a group inside it).
    const inside = new Set(doc.layers.slice(layer, blockEnd(doc, layer) + 1).map((x) => x.id));
    const groupsTo = doc.layers.filter((g) => isGroup(g) && !inside.has(g.id));
    const ingroup = groupsTo.length || l.parent ? (() => {
      const sel = el('select', { id: 'sp-ingroup', 'aria-label': 'In group' }, el('option', { value: '', text: 'no group' }), ...groupsTo.map((g) => el('option', { value: g.id, text: g.name })));
      sel.value = l.parent || '';
      sel.addEventListener('change', () => moveIntoGroup(sel.value || null));
      return el('label', { class: 'sb-inline', title: 'Put the layer in a group (at its top), or take it out' }, el('span', { text: 'In' }), sel);
    })() : null;
    if (isGroup(l)) {
      box.replaceChildren(...[
        el('h4', { class: 'music-subhead', text: `Group “${l.name}”` }),
        el('label', { class: 'sb-inline' }, el('span', { text: 'Opacity' }), op),
        ingroup,
        el('div', { class: 'sb-row' }, el('button', { class: 'utility-btn', id: 'sp-ungroup', title: 'The layers stay; the group goes', onclick: ungroup }, 'Ungroup')),
        el('h4', { class: 'music-subhead', text: `Frame ${frame + 1}` }),
        el('label', { class: 'sb-inline' }, el('span', { text: 'Shows for (ms)' }), dur), soundRow()].filter(Boolean));
      return;
    }
    box.replaceChildren(...[
      el('h4', { class: 'music-subhead', text: `Layer “${l.name}”` }),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Blend' }), blend),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Opacity' }), op),
      ingroup,
      (() => {
        const o = l.outline, on = el('input', { type: 'checkbox', id: 'sp-liveoutline', checked: o || undefined });
        const set = (patch) => change('Live outline', (d) => { const x = { ...d.layers[layer] }; x.outline = { color: '#000000ff', where: 'outside', eight: false, ...(x.outline || {}), ...patch }; d.layers[layer] = x; });
        on.addEventListener('change', () => (on.checked ? set({}) : change('No live outline', (d) => { const x = { ...d.layers[layer] }; delete x.outline; d.layers[layer] = x; })));
        const colour = el('input', { type: 'color', value: o ? o.color.slice(0, 7) : '#000000', id: 'sp-liveoutline-colour', 'aria-label': 'Outline colour', disabled: !o || undefined });
        colour.addEventListener('change', () => set({ color: colour.value + 'ff' }));
        const where = el('select', { id: 'sp-liveoutline-where', 'aria-label': 'Where', disabled: !o || undefined }, el('option', { value: 'outside', text: 'around' }), el('option', { value: 'inside', text: 'on the edge' }));
        where.value = o ? o.where : 'outside'; where.addEventListener('change', () => set({ where: where.value }));
        return el('div', { class: 'sb-row', title: 'An outline drawn round the layer wherever it shows or is exported — its pixels stay as they are' }, el('label', { class: 'sb-inline' }, on, el('span', { text: 'live outline' })), colour, where);
      })(),
      (() => { const c2 = el('input', { type: 'checkbox', id: 'sp-normals', checked: l.normals || undefined }); c2.addEventListener('change', () => change(c2.checked ? 'A normals layer' : 'Not a normals layer', (d) => { const x = { ...d.layers[layer] }; if (c2.checked) x.normals = true; else delete x.normals; d.layers[layer] = x; })); return el('label', { class: 'sb-inline', title: 'Its pixels are normal-map colours that paint over the made normal map (never exported as colour)' }, c2, el('span', { text: 'normals (paints the normal map)' })); })(),
      l.normals ? el('div', { class: 'sb-row sp-normal-swatches', role: 'group', 'aria-label': 'Normal colours' }, ...NORMAL_SWATCHES.map(([name, c]) => el('button', { class: 'sp-swatch-mini', 'data-normal': name, title: `Facing ${name}`, style: `background:${hex(c).slice(0, 7)}`, onclick: () => { fg = [...c]; renderColours(); keepFocus(); } }))) : null,
      (() => { const c2 = el('input', { type: 'checkbox', id: 'sp-reference', checked: l.reference || undefined }); c2.addEventListener('change', () => change(c2.checked ? 'A reference layer' : 'Not a reference layer', (d) => { d.layers[layer].reference = c2.checked; })); return el('label', { class: 'sb-inline', title: 'A picture to draw over or trace: shown here, never exported' }, c2, el('span', { text: 'reference (not exported)' })); })(),
      el('label', { class: 'sb-inline', title: 'This frame\'s picture on the layer' }, el('span', { text: 'Cel opacity' }), cop),
      c && c.link ? el('div', { class: 'sb-row', id: 'sp-linkinfo' }, el('span', { class: 'pref-hint', text: `🔗 on ${linkCount()} frames` }), el('button', { class: 'utility-btn', id: 'sp-unlink', title: 'This frame gets a picture of its own', onclick: unlinkCel }, 'Unlink')) : null,
      el('h4', { class: 'music-subhead', text: `Frame ${frame + 1}` }),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Shows for (ms)' }), dur), soundRow()].filter(Boolean));
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
      check('bones', 'bones', 'The skeleton (always shown with the bone tool)'),
      check('jaggies', 'doubled corners', 'Marks doubled corners in one-pixel lines on this layer (☰ › Clean doubled corners takes them out)'),
      check('lit', 'lit (light at the cursor)', 'The sprite lit by a light at the cursor, through its normal map: as a game\'s 2D lights will'),
      (() => {
        const t = el('select', { id: 'sp-tiled', 'aria-label': 'Tiled', title: 'The sprite repeated around itself, and drawing that wraps round the edges: for seamless tiles and textures' },
          el('option', { value: '', text: 'not tiled' }), el('option', { value: 'both', text: 'tiled both ways' }), el('option', { value: 'x', text: 'tiled across' }), el('option', { value: 'y', text: 'tiled down' }));
        t.value = view.tiled; t.addEventListener('change', () => { view.tiled = t.value; draw(); keepFocus(); });
        return el('label', { class: 'sb-inline' }, el('span', { text: 'Tiling' }), t);
      })(),
      (() => {
        const t = el('select', { id: 'sp-seen', 'aria-label': 'Seen as', title: 'The sprite as people with colour blindness see it, or in grey: do its colours still read apart?' },
          el('option', { value: '', text: 'as it is' }), el('option', { value: 'protanopia', text: 'protanopia (red-blind)' }), el('option', { value: 'deuteranopia', text: 'deuteranopia (green-blind)' }), el('option', { value: 'tritanopia', text: 'tritanopia (blue-blind)' }), el('option', { value: 'grey', text: 'in grey (values)' }), el('option', { value: 'silhouette', text: 'silhouette (does the shape read?)' }));
        t.value = view.seen; t.addEventListener('change', () => { view.seen = t.value; draw(); drawPreview(); keepFocus(); });
        return el('label', { class: 'sb-inline' }, el('span', { text: 'Seen' }), t);
      })(),
      el('div', { class: 'sb-row' }, check('grid', 'grid', 'A grid of your own (for tiles)'), gw, el('span', { text: '×' }), gh, check('isoGrid', 'diamonds', 'The grid as isometric diamonds: the grid size is a diamond\'s width × height (like 32 × 16)')),
      check('collision', 'collision shape', 'The polygon traced around this frame\'s solid pixels: what Export › Godot › collision shape writes'),
      el('div', { class: 'sb-row' }, check('onion', 'onion skin', 'The frames before (red) and after (blue), faint'), nb, el('span', { text: '/' }), na),
      el('div', { class: 'sb-row' }, check('onionTag', 'this tag only', 'Onion skin from the frames of the tag you are in, not past it'), check('onionOutline', 'outlines', 'Onion skin as outlines (easier to see through)')),
      el('div', { class: 'sb-row' }, check('path', 'motion path', 'The layer\'s path through the frames (its picture\'s middle on each); with the move tool, drag a point to move that frame\'s picture'),
        (() => { const c = el('input', { type: 'checkbox', checked: view.thumbs || undefined, 'data-view': 'thumbs' }); c.addEventListener('change', () => { view.thumbs = c.checked; renderTimeline(); keepFocus(); }); return el('label', { class: 'sb-inline', title: 'Small pictures in the timeline' }, c, el('span', { text: 'thumbnails' })); })()),
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
    // Thumbnails while the timeline is small enough for them to be quick.
    const thumbs = view.thumbs && doc.frames.length * (doc.layers.length + 1) <= 600 && doc.width * doc.height <= 256 * 256;
    box.classList.toggle('thumbs', thumbs);
    const head = el('div', { class: 'sp-tl-row sp-tl-head' },
      el('div', { class: 'sp-tl-name' },
        el('button', { class: 'icon-btn', id: 'sp-play', title: 'Play / stop (Enter)', 'aria-label': playing ? 'Stop' : 'Play', onclick: () => (playing ? stop() : play()) }, playing ? '■' : '▶'),
        el('button', { class: 'icon-btn', id: 'sp-addframe', title: 'New frame: a copy of this one (Alt+N)', 'aria-label': 'New frame', onclick: () => addFrame(true) }, '＋'),
        el('button', { class: 'icon-btn', title: 'New empty frame', 'aria-label': 'New empty frame', onclick: () => addFrame(false) }, '□'),
        el('button', { class: 'icon-btn', id: 'sp-addlinked', title: 'New linked frame: the same pictures, drawn once for both (Alt+Shift+N)', 'aria-label': 'New linked frame', onclick: () => addFrame(true, true) }, '🔗'),
        el('button', { class: 'icon-btn', id: 'sp-delframe', title: 'Remove this frame', 'aria-label': 'Remove the frame', disabled: doc.frames.length < 2 || undefined, onclick: removeFrame }, '🗑'),
        el('button', { class: 'icon-btn', title: 'Move the frame earlier', 'aria-label': 'Frame earlier', onclick: () => moveFrame(-1) }, '◀'),
        el('button', { class: 'icon-btn', title: 'Move the frame later', 'aria-label': 'Frame later', onclick: () => moveFrame(1) }, '▶'),
        el('button', { class: 'icon-btn', id: 'sp-audio', title: doc.audio ? `The sound to animate to: ${doc.audio.name} (click: another)` : 'A sound to animate to: its waveform under the frames, played along', 'aria-label': 'A sound to animate to', onclick: pickAudio }, '🎵'),
        el('button', { class: 'icon-btn', id: 'sp-tween', title: 'In-betweens: frames in which this layer moves to where it is on a later frame', 'aria-label': 'In-betweens', onclick: tweenDialog }, '⇢'),
        el('button', { class: 'icon-btn', id: 'sp-timing', title: 'Frame timing: scale or set the durations', 'aria-label': 'Frame timing', onclick: timingDialog }, '⏱'),
        el('button', { class: 'icon-btn', id: 'sp-addtag', title: 'A tag over frames (an animation: walk, jump…)', 'aria-label': 'New tag', onclick: () => tagDialog(null) }, '🏷')),
      ...doc.frames.map((f, i) => el('button', { class: 'sp-tl-frame' + (i === frame ? ' on' : ''), 'data-frame': String(i), draggable: 'true', title: `Frame ${i + 1}: ${f.duration} ms (double-click: duration; drag: move it, Ctrl+drag: copy it)`, onclick: () => goFrame(i), ondblclick: () => frameDialog(i),
        ondragstart: (e) => { e.dataTransfer.setData('text/x-noorsprite-frame', String(i)); e.dataTransfer.effectAllowed = 'copyMove'; },
        ondragover: (e) => { if ([...e.dataTransfer.types].includes('text/x-noorsprite-frame')) { e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'; } },
        ondrop: (e) => { const from = Number(e.dataTransfer.getData('text/x-noorsprite-frame')); if (!Number.isInteger(from)) return; e.preventDefault(); moveFrameTo(from, i, e.ctrlKey); } },
        thumbs ? thumbOf(compose(i), 36) : null, el('span', { text: String(i + 1) + (f.sound ? '♪' : '') }), el('small', { text: `${f.duration}` }))));
    const tags = doc.tags.length ? el('div', { class: 'sp-tl-row sp-tl-tags' }, el('div', { class: 'sp-tl-name' }, el('small', { class: 'pref-hint', text: 'Tags' })),
      el('div', { class: 'sp-tl-tagband', style: `grid-template-columns: repeat(${doc.frames.length}, var(--sp-cell))` },
        ...doc.tags.map((t, ti) => el('button', { class: 'sp-tag', 'data-tag': String(ti), style: `grid-column: ${t.from + 1} / ${t.to + 2}; --c:${t.color.slice(0, 7)}`, title: `${t.name}: frames ${t.from + 1}–${t.to + 1}, ${t.direction}${t.mirror ? `, mirrored from ${t.mirror}` : ''} (click: play it; double-click: change)`,
          onclick: () => play(ti), ondblclick: () => tagDialog(ti) }, t.mirror ? `↔ ${t.name}` : t.name)))) : null;
    // Top first, a group's row above its layers (folded groups hide them).
    const order = [];
    const walk = (pid, depth) => {
      const kids = [];
      doc.layers.forEach((l, i) => { if ((l.parent || null) === pid) kids.push(i); });
      for (const i of kids.reverse()) { order.push([i, depth]); if (isGroup(doc.layers[i]) && !doc.layers[i].collapsed) walk(doc.layers[i].id, depth + 1); }
    };
    walk(null, 0);
    const rows = order.map(([li, depth]) => {
      const l = doc.layers[li];
      if (isGroup(l)) {
        return el('div', { class: 'sp-tl-row sp-tl-group' + (li === layer ? ' on' : ''), 'data-layer': String(li) },
          el('div', { class: 'sp-tl-name', style: `padding-left:${4 + depth * 12}px`, onclick: () => { layer = li; renderAll(); keepFocus(); }, ondblclick: () => renameLayer(li) },
            el('button', { class: 'icon-btn', 'aria-expanded': String(!l.collapsed), title: l.collapsed ? 'Unfold the group' : 'Fold the group', 'aria-label': `Fold ${l.name}`, 'data-fold': String(li), onclick: (e) => { e.stopPropagation(); toggleCollapsed(li); } }, l.collapsed ? '▸' : '▾'),
            el('button', { class: 'icon-btn', 'aria-pressed': String(l.visible), title: l.visible ? 'Shown (click to hide the group)' : 'Hidden', 'aria-label': `Show ${l.name}`, onclick: (e) => { e.stopPropagation(); change(l.visible ? 'Hide a group' : 'Show a group', (d) => { d.layers[li].visible = !l.visible; }); } }, l.visible ? '👁' : '◌'),
            el('button', { class: 'icon-btn', 'aria-pressed': String(l.locked), title: l.locked ? 'Locked (click to unlock)' : 'Unlocked', 'aria-label': `Lock ${l.name}`, onclick: (e) => { e.stopPropagation(); change(l.locked ? 'Unlock a group' : 'Lock a group', (d) => { d.layers[li].locked = !l.locked; }); } }, l.locked ? '🔒' : '🔓'),
            el('span', { class: 'sp-layername sp-groupname', text: `📁 ${l.name}` })),
          ...doc.frames.map(() => el('span', { class: 'sp-tl-cel sp-tl-none', 'aria-hidden': 'true' })));
      }
      return el('div', { class: 'sp-tl-row' + (li === layer ? ' on' : ''), 'data-layer': String(li) },
        el('div', { class: 'sp-tl-name', style: depth ? `padding-left:${4 + depth * 12}px` : null, onclick: () => { layer = li; renderAll(); keepFocus(); }, ondblclick: () => renameLayer(li) },
          el('button', { class: 'icon-btn', 'aria-pressed': String(l.visible), title: l.visible ? 'Shown (click to hide)' : 'Hidden', 'aria-label': `Show ${l.name}`, onclick: (e) => { e.stopPropagation(); change(l.visible ? 'Hide a layer' : 'Show a layer', (d) => { d.layers[li].visible = !l.visible; }); } }, l.visible ? '👁' : '◌'),
          el('button', { class: 'icon-btn', 'aria-pressed': String(l.locked), title: l.locked ? 'Locked (click to unlock)' : 'Unlocked', 'aria-label': `Lock ${l.name}`, onclick: (e) => { e.stopPropagation(); change(l.locked ? 'Unlock a layer' : 'Lock a layer', (d) => { d.layers[li].locked = !l.locked; }); } }, l.locked ? '🔒' : '🔓'),
          el('span', { class: 'sp-layername' + (l.reference ? ' ref' : ''), text: (l.reference ? '📌 ' : l.kind === 'tilemap' ? '▦ ' : '') + l.name })),
        ...doc.frames.map((_, fi) => {
          const c = doc.cels.get(key(l.id, fi));
          return el('button', { class: 'sp-tl-cel' + (c ? ' full' : '') + (c && c.link ? ' linked' : '') + (fi === frame && li === layer ? ' on' : '') + (thumbs && c ? ' pic' : ''), 'data-cel': `${li}:${fi}`, title: c ? (c.link ? 'A picture linked to other frames (drawn once for all)' : 'A picture on this frame') : 'Empty', 'aria-label': `${l.name}, frame ${fi + 1}`, onclick: () => { layer = li; goFrame(fi); } },
            thumbs && c ? thumbOf(c.px, 36) : null);
        }));
    });
    const layerBar = el('div', { class: 'sp-tl-row sp-tl-foot' }, el('div', { class: 'sp-tl-name' },
      el('button', { class: 'icon-btn', id: 'sp-addlayer', title: 'New layer (Shift+N)', 'aria-label': 'New layer', onclick: addLayer }, '＋'),
      el('button', { class: 'icon-btn', id: 'sp-addgroup', title: 'New group holding this layer (Ctrl+G here)', 'aria-label': 'New group', onclick: addGroup }, '📁'),
      el('button', { class: 'icon-btn', id: 'sp-addtilemap', title: 'New tilemap layer: draw with tiles of the grid\'s size', 'aria-label': 'New tilemap layer', onclick: addTilemapLayer }, '▦'),
      el('button', { class: 'icon-btn', title: 'Duplicate the layer', 'aria-label': 'Duplicate the layer', onclick: duplicateLayer }, '⧉'),
      el('button', { class: 'icon-btn', id: 'sp-dellayer', title: 'Remove the layer', 'aria-label': 'Remove the layer', disabled: doc.layers.length < 2 || undefined, onclick: removeLayer }, '🗑'),
      el('button', { class: 'icon-btn', title: 'Layer up', 'aria-label': 'Layer up', onclick: () => moveLayer(1) }, '↑'),
      el('button', { class: 'icon-btn', title: 'Layer down', 'aria-label': 'Layer down', onclick: () => moveLayer(-1) }, '↓'),
      el('button', { class: 'icon-btn', id: 'sp-merge', title: 'Merge down into the layer below', 'aria-label': 'Merge down', disabled: layer === 0 || undefined, onclick: mergeDown }, '⤓')));
    if (doc.audio && audio.path !== doc.audio.path && !audio.loading) loadAudio();
    const audioRow = doc.audio ? el('div', { class: 'sp-tl-row sp-tl-audio', id: 'sp-audiorow' },
      el('div', { class: 'sp-tl-name' }, el('small', { class: 'pref-hint', text: `🎵 ${doc.audio.name}` }),
        (() => { const i = el('input', { type: 'number', class: 'sb-num', value: String(doc.audio.offset || 0), step: '10', 'aria-label': 'Sound starts at (ms)', title: 'Where in the sound frame 1 starts (ms)', id: 'sp-audio-offset' }); i.addEventListener('change', () => change('The sound\'s start', (d) => { d.audio = { ...d.audio, offset: Math.round(Number(i.value) || 0) }; })); return i; })(),
        el('button', { class: 'icon-btn', title: 'No sound', 'aria-label': 'Take the sound away', onclick: () => { change('No sound to animate to', (d) => { delete d.audio; }); audio = { ...audio, path: null, buffer: null }; } }, '✕')),
      ...doc.frames.map((_, f) => el('span', { class: 'sp-tl-cel sp-tl-wave', 'data-wave': String(f) }, audio.buffer ? waveCell(f) : null))) : null;
    box.replaceChildren(head, ...(tags ? [tags] : []), ...(audioRow ? [audioRow] : []), ...rows, layerBar);
    const on = box.querySelector('.sp-tl-frame.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** A small picture of the sprite's pixels, fitted in a square. */
  function thumbOf(px, size) {
    const cv = el('canvas', { width: String(size), height: String(size), class: 'sp-thumb', 'aria-hidden': 'true' }), ctx = cv.getContext('2d');
    const k = Math.min(size / doc.width, size / doc.height), w = Math.max(1, Math.round(doc.width * k)), h = Math.max(1, Math.round(doc.height * k));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pixelsToCanvas(px, doc.width, doc.height), Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
    return cv;
  }

  /** A frame dragged to another place in the timeline (with its pictures), or copied there. */
  function moveFrameTo(from, to, copy) {
    if (from === to && !copy) return;
    change(copy ? 'Copy a frame' : 'Move a frame', (d) => {
      if (copy) {
        d.frames.splice(to, 0, { ...d.frames[from] });
        const src = from >= to ? from + 1 : from;
        shiftFrames(d, to, 1);
        d.layers.forEach((l) => { const c = d.cels.get(key(l.id, src)); if (c) { const { link, ...plain } = c; void link; d.cels.set(key(l.id, to), plain); } });
        frame = to;
        return;
      }
      // The frames in their new order: old index for each new place.
      const order = d.frames.map((_, i) => i);
      order.splice(from, 1); order.splice(to, 0, from);
      const cels = new Map();
      for (const [k, c] of d.cels) { const i = k.lastIndexOf(':'), f = Number(k.slice(i + 1)); cels.set(key(k.slice(0, i), order.indexOf(f)), c); }
      d.cels = cels;
      d.frames = order.map((i) => d.frames[i]);
      frame = to;
    });
  }

  function goFrame(i) { commitFloating(); frame = Math.max(0, Math.min(doc.frames.length - 1, i)); renderAll(); keepFocus(); }

  /** A new frame after this one: a copy, empty, or linked (the same pictures, drawn on once for both). */
  function addFrame(copy, linked = false) {
    change(linked ? 'New linked frame' : copy ? 'New frame' : 'New empty frame', (d) => {
      const at = frame + 1;
      d.frames.splice(at, 0, { duration: d.frames[frame].duration, ...(copy && d.frames[frame].pose ? { pose: d.frames[frame].pose } : {}) });
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

  /** A new layer above this one (in its group; on a group, at the top inside it). */
  function addLayer() {
    change('New layer', (d) => {
      const cur = d.layers[layer], inGroup = isGroup(cur), at = (inGroup ? blockEnd(d, layer) : isGroup(cur) ? layer : blockEnd(d, layer)) + 1;
      const parent = inGroup ? cur.id : cur.parent;
      d.layers.splice(at, 0, { id: newId(), name: `Layer ${d.layers.filter((l) => !isGroup(l)).length + 1}`, visible: true, locked: false, opacity: 255, blend: 'normal', ...(parent ? { parent } : {}) });
      layer = at;
    });
  }

  /** A new group holding this layer (or this group). */
  function addGroup() {
    change('New group', (d) => {
      const cur = d.layers[layer], id = newId();
      d.layers.splice(layer, 0, { id, name: `Group ${d.layers.filter(isGroup).length + 1}`, visible: true, locked: false, opacity: 255, blend: 'normal', kind: 'group', ...(cur.parent ? { parent: cur.parent } : {}) });
      d.layers[layer + 1] = { ...cur, parent: id };
    });
  }

  /** The group's layers out of it, the group gone. */
  function ungroup() {
    const g = doc.layers[layer];
    if (!isGroup(g)) return;
    change('Ungroup', (d) => {
      const gid = d.layers[layer].id, up = d.layers[layer].parent;
      d.layers = d.layers.filter((l) => l.id !== gid).map((l) => (l.parent === gid ? (up ? { ...l, parent: up } : (({ parent, ...rest }) => (void parent, rest))(l)) : l));
      layer = Math.min(layer, d.layers.length - 1);
    });
  }

  /** This layer (with what is in it) into a group, at the top inside it — or out of every group (gid null). */
  function moveIntoGroup(gid) {
    const cur = doc.layers[layer];
    if ((cur.parent || null) === gid) return;
    change(gid ? 'Into a group' : 'Out of the group', (d) => {
      const s0 = layer, e0 = blockEnd(d, layer), block = d.layers.slice(s0, e0 + 1);
      if (gid && block.some((l) => l.id === gid)) return; // not into itself
      d.layers.splice(s0, e0 - s0 + 1);
      const head = gid ? { ...block[0], parent: gid } : (({ parent, ...rest }) => (void parent, rest))(block[0]);
      const gi = gid ? d.layers.findIndex((l) => l.id === gid) : -1;
      const at = gid ? blockEnd(d, gi) + 1 : d.layers.length;
      d.layers.splice(at, 0, head, ...block.slice(1));
      layer = at;
    });
  }

  function toggleCollapsed(li) {
    change(doc.layers[li].collapsed ? 'Unfold a group' : 'Fold a group', (d) => { d.layers[li] = { ...d.layers[li], collapsed: !d.layers[li].collapsed }; });
  }

  function duplicateLayer() {
    change('Duplicate a layer', (d) => {
      // The layer (a group with everything in it), new ids, just above it.
      const e = blockEnd(d, layer), block = d.layers.slice(layer, e + 1), ids = new Map(block.map((l) => [l.id, newId()]));
      const copies = block.map((l, i) => ({ ...l, id: ids.get(l.id), name: i === 0 ? `${l.name} copy` : l.name, ...(l.parent && ids.has(l.parent) ? { parent: ids.get(l.parent) } : {}) }));
      d.layers.splice(e + 1, 0, ...copies);
      for (const l of block) d.frames.forEach((_, f) => { const c = d.cels.get(key(l.id, f)); if (c) d.cels.set(key(ids.get(l.id), f), c); });
      layer = e + 1;
    });
  }

  function removeLayer() {
    const e = blockEnd(doc, layer);
    if (doc.layers.filter((l, i) => !isGroup(l) && (i < layer || i > e)).length < 1) { notice('A sprite keeps at least one layer', 1400); return; }
    change(isGroup(doc.layers[layer]) ? 'Remove a group' : 'Remove a layer', (d) => {
      for (const l of d.layers.slice(layer, e + 1)) d.frames.forEach((_, f) => d.cels.delete(key(l.id, f)));
      d.layers.splice(layer, e - layer + 1);
      layer = Math.max(0, Math.min(d.layers.length - 1, layer - 1));
    });
  }

  /**
   * Up or down past the next layer (or group, whole) beside it in its group; at the group's edge, out of the group
   * (above it or below it).
   */
  function moveLayer(by) {
    const d0 = doc, s0 = layer, e0 = blockEnd(d0, s0), me = d0.layers[s0], parent = me.parent || null;
    let target = null; // [insert index after removing the block, new parent]
    if (by > 0) {
      const n = e0 + 1;
      if (n < d0.layers.length && (d0.layers[n].parent || null) === parent) target = [blockEnd(d0, n) - (e0 - s0), parent];
      else if (parent) { const gi = d0.layers.findIndex((l) => l.id === parent); target = [blockEnd(d0, gi) - (e0 - s0), d0.layers[gi].parent || null]; }
    } else {
      // The sibling just below: the start of the block that ends right before us.
      let p = s0 - 1;
      if (p >= 0 && d0.layers[p].id === parent) { target = [p, d0.layers[p].parent || null]; } // at the group's bottom: out, below the group
      else if (p >= 0) { while (p >= 0 && (d0.layers[p].parent || null) !== parent) p--; if (p >= 0) target = [p, parent]; }
    }
    if (!target) return;
    change('Move a layer', (d) => {
      const block = d.layers.splice(s0, e0 - s0 + 1);
      const head = target[1] ? { ...block[0], parent: target[1] } : (({ parent: _p, ...rest }) => (void _p, rest))(block[0]);
      d.layers.splice(target[0], 0, head, ...block.slice(1));
      layer = target[0];
    });
  }

  function mergeDown() {
    if (layer === 0) return;
    const top0 = doc.layers[layer], below0 = doc.layers[layer - 1];
    if (isGroup(top0) || isGroup(below0) || (top0.parent || null) !== (below0.parent || null)) { notice('Merge down joins two layers side by side in the same group', 1800); return; }
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
        const tag = { ...(t.mirror ? { mirror: t.mirror } : {}), name: name.value.trim() || 'Tag', from: a, to: b, direction: dir.value, color: colour.value + 'ff' };
        change(ti === null ? 'New tag' : 'Change a tag', (d) => { if (ti === null) d.tags.push(tag); else d.tags[ti] = tag; });
        closeIt();
      };
      s.append(NoorUI.head(ti === null ? 'New tag' : 'Tag', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'Name ', name), el('label', {}, 'Frames ', from, ' to ', to), el('label', {}, 'Plays ', dir), el('label', {}, 'Colour ', colour),
          ...(t.mirror ? [el('p', { class: 'pref-hint', text: `A mirror of “${t.mirror}” (☰ › Update the mirrored tags makes it again).` })] : [])),
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
    const forward = !t || t.direction === 'forward';
    const step = () => {
      if (!playing) return;
      // The sound plays along, from the frame the run starts at (going forwards).
      if (forward && frame === from) audioStart(from);
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

  function stop() { if (!playing) return; clearTimeout(playing.timer); playing = null; audioStop(); if (built) { renderTimeline(); renderLayerProps(); } }

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
    const fx = (e.clientX - r.left - o.x) / view.zoom, fy = (e.clientY - r.top - o.y) / view.zoom;
    return { x: Math.floor(fx), y: Math.floor(fy), fx, fy, cx: e.clientX - r.left, cy: e.clientY - r.top };
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
        const tg = view.onionTag && doc.tags.find((t) => frame >= t.from && frame <= t.to);
        if (tg && (f < tg.from || f > tg.to)) continue; // only this tag's frames
        const px = view.onionOutline ? outlineOf(compose(f), doc.width, doc.height, tint) : compose(f);
        if (!view.onionOutline) for (let i = 0; i < px.length; i += 4) { px[i] = (px[i] + tint[0]) / 2; px[i + 1] = (px[i + 1] + tint[1]) / 2; px[i + 2] = (px[i + 2] + tint[2]) / 2; }
        ctx.globalAlpha = view.onionAlpha / (Math.abs(f - frame));
        ctx.drawImage(pixelsToCanvas(px, doc.width, doc.height), o.x, o.y, W, H);
      }
      ctx.globalAlpha = 1;
    }
    // Lit: the sprite's colours as exported (no normals or reference layers), shaded by its normal map.
    const shown = seenAs(view.lit ? litView(compose(frame, doc, null, true)) : composeShown());
    ctx.drawImage(pixelsToCanvas(shown, doc.width, doc.height), o.x, o.y, W, H);
    ctx.restore();
    if (view.tiled) {
      // The sprite repeated around itself, fainter, to see that it joins up.
      const sc = pixelsToCanvas(shown, doc.width, doc.height), tx = view.tiled !== 'y', ty = view.tiled !== 'x';
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 0.6;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (dx && !tx) || (dy && !ty)) continue;
        ctx.drawImage(sc, o.x + dx * W, o.y + dy * H, W, H);
      }
      ctx.restore();
    }
    // The pixel grid, and a grid of one's own.
    ctx.lineWidth = 1;
    if (view.pixelGrid && z >= 8) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath();
      for (let x = 1; x < doc.width; x++) { ctx.moveTo(o.x + x * z + 0.5, o.y); ctx.lineTo(o.x + x * z + 0.5, o.y + H); }
      for (let y = 1; y < doc.height; y++) { ctx.moveTo(o.x, o.y + y * z + 0.5); ctx.lineTo(o.x + W, o.y + y * z + 0.5); }
      ctx.stroke();
    }
    if (view.grid && view.isoGrid) drawIsoGrid(ctx, o, z);
    else if (view.grid) {
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
        if (tool === 'pencil' && terrainSel < 0 && ts.tiles[tileSel]) { ctx.globalAlpha = 0.6; ctx.drawImage(pixelsToCanvas(turnedTile(ts, tileSel | tileFlags), ts.tw, ts.th), o.x + at.c * tw, o.y + at.r * th, tw, th); ctx.globalAlpha = 1; }
        ctx.strokeStyle = '#ffaa28'; ctx.lineWidth = 2; ctx.strokeRect(o.x + at.c * tw + 1, o.y + at.r * th + 1, tw - 2, th - 2); ctx.lineWidth = 1;
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(o.x - 0.5, o.y - 0.5, W + 1, H + 1);
    if (['pencil', 'eraser', 'line', 'rect', 'ellipse', 'fill'].includes(tool) && (opts.mirrorX || opts.mirrorY || opts.radial > 1)) {
      // The symmetry axes.
      ctx.save(); ctx.strokeStyle = 'rgba(255,60,200,0.8)'; ctx.setLineDash([6, 4]); ctx.beginPath();
      if (opts.mirrorX || opts.radial > 1) { const x = Math.round(o.x + axisX() * z) + 0.5; ctx.moveTo(x, o.y); ctx.lineTo(x, o.y + H); }
      if (opts.mirrorY || opts.radial > 1) { const y = Math.round(o.y + axisY() * z) + 0.5; ctx.moveTo(o.x, y); ctx.lineTo(o.x + W, y); }
      ctx.stroke(); ctx.restore();
    }
    // The selection's edge (marching ants).
    if (selection) drawSelection(ctx, o, z);
    drawSlices(ctx, o, z);
    if (view.path && !playing) drawPath(ctx, o, z);
    drawBones(ctx, o, z);
    drawFontGuide(ctx, o, z);
    if (view.collision) drawCollision(ctx, o, z);
    if (view.jaggies) {
      const c = cel();
      if (c) { ctx.save(); ctx.strokeStyle = '#ff2a55'; ctx.lineWidth = 2; for (const i of jaggies(c.px, doc.width, doc.height)) ctx.strokeRect(o.x + (i % doc.width) * z + 1, o.y + Math.floor(i / doc.width) * z + 1, z - 2, z - 2); ctx.restore(); }
    }
    // The stabilizer's string, from the brush to the cursor.
    if (drag && drag.kind === 'stroke' && drag.lazy) {
      const L = drag.lazy, bx = o.x + L.x * z, by = o.y + L.y * z;
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(L.cx, L.cy); ctx.stroke();
      ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(bx, by, opts.stabilize, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // The brush under the cursor.
    // The brush's own shape is the cursor (the system's is hidden over the canvas): the pencil's filled faintly with
    // the drawing colour, both outlined black and white so it shows on any colour.
    if (hover && ['pencil', 'eraser'].includes(tool) && !spaceHeld && !altHeld && !tilesOn()) {
      const pts = drag && drag.kind === 'stroke' && drag.lazy ? brushPoints(Math.floor(drag.lazy.x), Math.floor(drag.lazy.y)) : brushPoints(hover.x, hover.y);
      const set = new Set(pts.map(([x, y]) => `${x},${y}`));
      ctx.save(); ctx.setLineDash([]);
      if (tool === 'pencil') { ctx.fillStyle = `rgba(${fg[0]},${fg[1]},${fg[2]},0.55)`; for (const [x, y] of pts) ctx.fillRect(o.x + x * z, o.y + y * z, z, z); }
      const edges = new Path2D();
      for (const [x, y] of pts) {
        const X = o.x + x * z, Y = o.y + y * z;
        if (!set.has(`${x},${y - 1}`)) { edges.moveTo(X, Y); edges.lineTo(X + z, Y); }
        if (!set.has(`${x},${y + 1}`)) { edges.moveTo(X, Y + z); edges.lineTo(X + z, Y + z); }
        if (!set.has(`${x - 1},${y}`)) { edges.moveTo(X, Y); edges.lineTo(X, Y + z); }
        if (!set.has(`${x + 1},${y}`)) { edges.moveTo(X + z, Y); edges.lineTo(X + z, Y + z); }
      }
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.stroke(edges);
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#fff'; ctx.stroke(edges);
      ctx.restore();
    }
  }

  /** Only the edge of a picture (its pixels next to clear ones), in one colour: onion skin as outlines. */
  function outlineOf(px, W, H, c) {
    const out = new Uint8ClampedArray(px.length), a = (x, y) => x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] > 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a(x, y) && (!a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1) || !a(x, y + 1))) out.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
    return out;
  }

  // ---------------------------------------------------------------- the motion path

  const boxCache = new WeakMap();
  /** The middle of what a frame's cel on this layer shows (null when nothing). */
  function celMiddle(f) {
    const c = cel(layer, f);
    if (!c) return null;
    let b = boxCache.get(c.px);
    if (b === undefined) { b = drawnBox(c.px, doc.width, doc.height); boxCache.set(c.px, b); }
    return b && { x: (b.x0 + b.x1 + 1) / 2, y: (b.y0 + b.y1 + 1) / 2 };
  }

  /** The layer's path through the frames: where its picture's middle is on each, joined. */
  function drawPath(ctx, o, z) {
    const pts = doc.frames.map((_, f) => { const m = celMiddle(f); return m && drag && drag.kind === 'pathnode' && f === frame ? { x: m.x + drag.dx, y: m.y + drag.dy } : m; });
    ctx.save();
    ctx.strokeStyle = 'rgba(255,200,40,0.85)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    pts.forEach((pt) => { if (!pt) { started = false; return; } const X = o.x + pt.x * z, Y = o.y + pt.y * z; if (started) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); started = true; } });
    ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center';
    pts.forEach((pt, f) => {
      if (!pt) return;
      const X = o.x + pt.x * z, Y = o.y + pt.y * z, r = f === frame ? 6 : 4;
      ctx.fillStyle = f === frame ? '#ffc828' : 'rgba(255,200,40,0.7)'; ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(String(f + 1), X, Y - r - 3);
    });
    ctx.restore();
  }

  /** A press on a path's point (with the move tool): that frame's picture is dragged along. */
  function pathNodeAt(p) {
    if (!view.path || tool !== 'move') return -1;
    let best = -1, bd = 9;
    doc.frames.forEach((_, f) => { const m = celMiddle(f); if (!m) return; const o = origin(), d = Math.hypot(o.x + m.x * view.zoom - p.cx, o.y + m.y * view.zoom - p.cy); if (d < bd) { bd = d; best = f; } });
    return best;
  }

  /** The current frame as shown: the sprite, a shape being drawn and a lifted selection on top. */
  function composeShown() {
    const live = (drag && drag.preview) || (curve && curve.preview);
    if (!live) {
      if (!floating) return composeCycled(frame) || compose(frame);
    }
    const d = snapshot(doc);
    if (live) {
      const k = key(d.layers[layer].id, frame);
      d.cels.set(k, { px: live, opacity: (d.cels.get(k) || { opacity: 255 }).opacity });
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
    // Auto (fits 128 pixels), or the size chosen by clicking it: 1×, 2×, 3×, 4×.
    const scale = view.previewScale || Math.max(1, Math.min(4, Math.floor(128 / Math.max(doc.width, doc.height))));
    cv.width = doc.width * scale; cv.height = doc.height * scale;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(pixelsToCanvas(seenAs(composeCycled(frame) || compose(frame)), doc.width, doc.height), 0, 0, cv.width, cv.height);
    $('#sp-preview-label').textContent = `${scale}×${view.previewScale ? '' : ' (fits)'} · frame ${frame + 1}/${doc.frames.length}${playing ? ' · playing' : ''}`;
  }

  function status() {
    const s = $('#sp-status');
    if (!s || !doc) return;
    const at = hover && hover.x >= 0 && hover.y >= 0 && hover.x < doc.width && hover.y < doc.height ? hover : null;
    let colour = '';
    if (at) { const px = compose(frame); const i = (at.y * doc.width + at.x) * 4; colour = ` · ${hex([px[i], px[i + 1], px[i + 2], px[i + 3]])}`; const ix = indexAt(at.x, at.y); if (ix !== null) colour += ` · index ${ix < 0 ? 'clear' : ix + 1}`; }
    const sel = selection ? ` · selection ${selection.x1 - selection.x0 + 1} × ${selection.y1 - selection.y0 + 1}` : '';
    let tile = '';
    if (isTilemap()) { const c = at && cellAt(at), n = c ? currentMap()[c.i] : 0; tile = ` · ${tileMode ? 'tiles' : 'pixels'}${c ? ` · cell ${c.c}, ${c.r}: ${n ? `tile ${n}` : 'none'}` : ''}`; }
    s.textContent = `${at ? `${at.x}, ${at.y}${colour}` : `${doc.width} × ${doc.height}`}${tile} · ${view.zoom * 100}%${sel} · ${doc.layers[layer].name}, frame ${frame + 1}${doc.layers[layer].locked ? ' (locked)' : ''}`;
  }

  function setCursor() {
    const cv = $('#sp-canvas');
    if (!cv) return;
    cv.dataset.cursor = spaceHeld || tool === 'hand' ? 'hand' : altHeld || tool === 'picker' ? 'picker' : tool === 'move' ? 'move'
      : ['pencil', 'eraser'].includes(tool) && !tilesOn() ? 'brush' : 'cross';
  }

  /** A redrawn part keeps the keyboard in the bench. */
  function keepFocus() { if (isOpen() && !NoorUI.hasOpenModal() && (document.activeElement === document.body || !document.activeElement)) $('#spritebench').focus({ preventScroll: true }); }

  // ---------------------------------------------------------------- drawing

  /** The pixels a brush covers around a point (square or round, of the brush's size), mirrored as asked. */
  function brushPoints(x, y, size = opts.size) {
    if (opts.custom && brushImage && tool === 'pencil') {
      const pts = [], ox = x - Math.floor(brushImage.w / 2), oy = y - Math.floor(brushImage.h / 2);
      for (let by = 0; by < brushImage.h; by++) for (let bx = 0; bx < brushImage.w; bx++) if (brushImage.px[(by * brushImage.w + bx) * 4 + 3]) pts.push([ox + bx, oy + by]);
      return mirrored(pts);
    }
    const s = size, r = (s - 1) / 2, pts = [];
    for (let dy = -Math.floor(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.floor(r); dx <= Math.ceil(r); dx++) {
      if (s > 1 && opts.round && (dx - (s % 2 ? 0 : 0.5)) ** 2 + (dy - (s % 2 ? 0 : 0.5)) ** 2 > (s / 2) ** 2 + 0.25) continue;
      pts.push([x + dx - (s % 2 ? 0 : 0), y + dy]);
    }
    return mirrored(pts);
  }

  /** Where symmetry turns about: an axis of one's own, or the middle (on a pixel's edge or its middle: halves). */
  const axisX = () => (opts.axisX === null ? doc.width / 2 : opts.axisX);
  const axisY = () => (opts.axisY === null ? doc.height / 2 : opts.axisY);

  /** Points with their mirror images (about the axes) and radial copies (turned about where the axes cross). */
  function mirrored(pts) {
    const out = [...pts], ax = axisX(), ay = axisY();
    if (opts.mirrorX) for (const [x, y] of pts) out.push([Math.round(2 * ax - 1 - x), y]);
    if (opts.mirrorY) for (const [x, y] of [...out]) out.push([x, Math.round(2 * ay - 1 - y)]);
    if (opts.radial > 1) {
      const base = [...out];
      for (let k = 1; k < opts.radial; k++) {
        const a = (k * 2 * Math.PI) / opts.radial, cs = Math.cos(a), sn = Math.sin(a);
        for (const [x, y] of base) { const dx = x + 0.5 - ax, dy = y + 0.5 - ay; out.push([Math.round(ax + dx * cs - dy * sn - 0.5), Math.round(ay + dx * sn + dy * cs - 0.5)]); }
      }
    }
    return out;
  }

  /** Tiled drawing: what goes off one edge comes back on the other. */
  const wrapX = (x) => (view.tiled === 'both' || view.tiled === 'x' ? ((x % doc.width) + doc.width) % doc.width : x);
  const wrapY = (y) => (view.tiled === 'both' || view.tiled === 'y' ? ((y % doc.height) + doc.height) % doc.height : y);

  const inside = (x, y) => x >= 0 && y >= 0 && x < doc.width && y < doc.height && (!selection || selection.mask[y * doc.width + x]);

  function plot(px, x, y, c) {
    x = wrapX(x); y = wrapY(y);
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
    if (isGroup(doc.layers[layer])) { notice('A group has no picture of its own: choose a layer in it', 1600); return false; }
    if (lockedLayer(doc, doc.layers[layer])) { notice('That layer is locked (🔒 in the timeline)', 1500); return false; }
    if (!shown(doc, doc.layers[layer])) { notice('That layer is hidden', 1200); return false; }
    return true;
  }

  function onDown(e) {
    $('#spritebench').focus({ preventScroll: true });
    // Alt is read from the press itself: a key-up the menus took can't leave every tool an eyedropper.
    if (altHeld !== e.altKey) { altHeld = e.altKey; setCursor(); }
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
    if (t === 'bone') { boneDown(p, e); return; }
    const node = t === 'move' && !floating ? pathNodeAt(p) : -1;
    if (node >= 0) {
      if (node !== frame) { frame = node; renderAll(); }
      if (!canDraw()) return;
      const c = cel();
      drag = { kind: 'pathnode', px: p.x, py: p.y, base: c.px, dx: 0, dy: 0, preview: c.px };
      return;
    }
    if (t === 'move') { startMove(p); return; }
    if (!canDraw()) return;
    if (t === 'fill') {
      if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
      const src = (cel() || { px: new Uint8ClampedArray(doc.width * doc.height * 4) }).px;
      const pts = mirrored([[p.x, p.y]]).flatMap(([x, y]) => (x >= 0 && y >= 0 && x < doc.width && y < doc.height ? fillPoints(src, x, y, opts.contiguous, opts.tolerance) : []));
      const [c1, c2] = e.button === 2 ? [bg, fg] : [fg, bg], pf = (PATTERNS[opts.pattern] || PATTERNS.solid)[1];
      change(opts.pattern === 'solid' ? 'Fill' : 'Pattern fill', () => { const px = editable(); for (const [x, y] of pts) plot(px, x, y, pf(x, y) ? c1 : c2); });
      return;
    }
    if (t === 'pencil' || t === 'eraser') {
      // The stroke draws into a copy shown as it goes; it becomes one undo step when the button is let go.
      const base = cel();
      drag = { kind: 'stroke', colour: t === 'eraser' ? [0, 0, 0, 0] : colour, last: [p.x, p.y], preview: base ? new Uint8ClampedArray(base.px) : new Uint8ClampedArray(doc.width * doc.height * 4), original: base ? base.px : null, trail: [],
        ink: t === 'pencil' ? opts.ink : 'simple', shadeDir: e.button === 2 ? -1 : 1, shaded: new Set(), custom: t === 'pencil' && opts.custom && brushImage,
        lazy: opts.stabilize ? { x: p.fx, y: p.fy, cx: p.cx, cy: p.cy } : null, pen: e.pointerType === 'pen', pressure: e.pressure || 0.5 };
      stamp(p.x, p.y);
      draw();
      return;
    }
    if (t === 'curve') {
      if (curve) { const c0 = curve; curve = null; change('Curve', (doc2) => { putCel(doc2, key(doc2.layers[layer].id, frame), { px: c0.preview, opacity: (cel() || { opacity: 255 }).opacity }); }); return; }
      const base = cel();
      drag = { kind: 'curve-line', from: [p.x, p.y], to: [p.x, p.y], colour, base: base ? base.px : new Uint8ClampedArray(doc.width * doc.height * 4) };
      drag.preview = new Uint8ClampedArray(drag.base);
      return;
    }
    if (t === 'gradient') {
      const base = cel();
      drag = { kind: 'gradient', from: [p.fx, p.fy], to: [p.fx, p.fy], c1: e.button === 2 ? bg : fg, c2: e.button === 2 ? fg : bg, base: base ? base.px : new Uint8ClampedArray(doc.width * doc.height * 4) };
      drag.preview = gradientPixels(drag);
      draw();
      return;
    }
    if (['line', 'rect', 'ellipse', 'isobox'].includes(t)) {
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
    // A pen pressed lightly draws thinner (size × pressure).
    const size = opts.pressure && d.pen ? Math.max(1, Math.round(opts.size * Math.max(0.05, d.pressure))) : opts.size;
    for (const [px, py] of brushPoints(x, y, size)) ink(px, py);
  }

  /** One pixel of a stroke by its ink: plain, dithered (some pixels only), or shading (a step along the palette). */
  function ink(x, y) {
    const d = drag;
    x = wrapX(x); y = wrapY(y);
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
      for (const [mx, my] of mirrored([[ox + bx, oy + by]])) plot(drag.preview, mx, my, c);
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

  /** A gradient from one colour to the other along the drag (straight) or out from where it began (round). */
  function gradientPixels(d) {
    const px = new Uint8ClampedArray(d.base), W = doc.width, H = doc.height;
    const [x0, y0] = d.from, [x1, y1] = d.to, dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const cx = x + 0.5, cy = y + 0.5;
      let t = opts.gradShape === 'radial' ? Math.hypot(cx - x0, cy - y0) / len : ((cx - x0) * dx + (cy - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const o = (y * W + x) * 4;
      if (opts.gradBlend === 'dither') px.set(t * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5 ? d.c2 : d.c1, o);
      else for (let k = 0; k < 4; k++) px[o + k] = Math.round(d.c1[k] + (d.c2[k] - d.c1[k]) * t);
    }
    return px;
  }

  // Pixel-art slopes: runs of the same length (1:1, 2:1, 3:1, 4:1 and the steep ones), never ragged.
  const SLOPES = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [3, 1], [1, 3], [4, 1], [1, 4]];

  /** A line from a point towards another along the nearest clean slope, in even runs. */
  function slopePoints(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1, ang = Math.atan2(Math.abs(dy), Math.abs(dx));
    let best = SLOPES[0], bd = Infinity;
    for (const sl of SLOPES) { const a2 = Math.atan2(sl[1], sl[0]), dd = Math.abs(a2 - ang); if (dd < bd) { bd = dd; best = sl; } }
    const [a, b] = best, pts = [];
    if (!b) { for (let i = 0; i <= Math.abs(dx); i++) pts.push([x0 + sx * i, y0]); return pts; }
    if (!a) { for (let i = 0; i <= Math.abs(dy); i++) pts.push([x0, y0 + sy * i]); return pts; }
    // Steps of `a` across and `b` down (one of them is 1), as many as reach furthest.
    const k = Math.max(1, Math.round(Math.max(Math.abs(dx) / a, Math.abs(dy) / b)));
    let x = x0, y = y0;
    for (let i = 0; i < k; i++) {
      if (a >= b) { for (let j = 0; j < a; j++) { pts.push([x, y]); x += sx; } y += sy; x -= 0; }
      else { for (let j = 0; j < b; j++) { pts.push([x, y]); y += sy; } x += sx; }
    }
    return pts;
  }

  /** Points of a quadratic curve from p0 to p1 bent towards c: one pixel wide, no doubled corners. */
  function curvePoints(p0, p1, c) {
    const len = Math.hypot(c[0] - p0[0], c[1] - p0[1]) + Math.hypot(p1[0] - c[0], p1[1] - c[1]), n = Math.max(2, Math.ceil(len * 3)), raw = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      raw.push([Math.round(u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0]), Math.round(u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1])]);
    }
    const pts = [];
    for (const q of raw) {
      const last = pts[pts.length - 1];
      if (last && last[0] === q[0] && last[1] === q[1]) continue;
      if (last && (Math.abs(last[0] - q[0]) > 1 || Math.abs(last[1] - q[1]) > 1)) pts.push(...linePoints(last[0], last[1], q[0], q[1]).slice(1, -1));
      pts.push(q);
      // Pixel-perfect: the corner of an L between two diagonal neighbours goes.
      const m = pts.length;
      if (m >= 3) { const [a, b, c2] = pts.slice(-3); if (Math.abs(a[0] - c2[0]) === 1 && Math.abs(a[1] - c2[1]) === 1 && (b[0] === a[0] || b[1] === a[1])) pts.splice(m - 2, 1); }
    }
    return pts;
  }

  // The curve tool: drag the line, then move to bend it and click to draw it (Esc lets it go).
  let curve = null; // { from, to, ctrl, colour, base, preview }
  function curvePreview() {
    const px = new Uint8ClampedArray(curve.base);
    for (const [x, y] of curvePoints(curve.from, curve.to, curve.ctrl).flatMap(([x, y]) => (opts.size > 1 ? brushPoints(x, y) : mirrored([[x, y]])))) plot(px, x, y, curve.colour);
    curve.preview = px;
  }

  function shapePreview(e, d = drag) {
    const px = new Uint8ClampedArray(d.base);
    let [x1, y1] = d.to;
    const [x0, y0] = d.from;
    if (e && e.shiftKey && d.tool !== 'line') { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
    if (d.tool === 'isobox') { for (const [x, y, c] of isoBoxPoints(x0, y0, x1, y1, d.colour)) plot(px, x, y, c); return px; }
    const linePts = d.tool === 'line' && e && e.shiftKey ? slopePoints(x0, y0, x1, y1) : linePoints(x0, y0, x1, y1);
    const pts = d.tool === 'line' ? linePts.flatMap(([x, y]) => (opts.size > 1 ? brushPoints(x, y) : mirrored([[x, y]])))
      : mirrored(d.tool === 'rect' ? rectPoints(x0, y0, x1, y1, opts.filled) : ellipsePoints(x0, y0, x1, y1, opts.filled));
    for (const [x, y] of pts) plot(px, x, y, d.colour);
    return px;
  }

  function onMove(e) {
    if (altHeld !== e.altKey) { altHeld = e.altKey; setCursor(); }
    const p = toPixel(e);
    hover = { x: p.x, y: p.y };
    if (!drag && curve) { curve.ctrl = [p.fx - 0.5, p.fy - 0.5]; curvePreview(); draw(); return; }
    if (!drag) { draw(); status(); return; }
    if (drag.kind === 'pan') { view.panX += p.cx - drag.cx; view.panY += p.cy - drag.cy; drag.cx = p.cx; drag.cy = p.cy; draw(); return; }
    if (drag.kind === 'picker') { pick(p, drag.right); return; }
    if (drag.kind === 'tiles') { tileMove(p); return; }
    if (drag.kind === 'stroke') {
      if (drag.pen) drag.pressure = e.pressure || drag.pressure;
      let to = [p.x, p.y];
      if (drag.lazy) {
        // The brush is pulled along only when the cursor is further away than the string is long.
        const L = drag.lazy, R = opts.stabilize / view.zoom, dx = p.fx - L.x, dy = p.fy - L.y, dist = Math.hypot(dx, dy);
        if (dist > R) { L.x += (dx / dist) * (dist - R); L.y += (dy / dist) * (dist - R); }
        L.cx = p.cx; L.cy = p.cy;
        to = [Math.floor(L.x), Math.floor(L.y)];
        if (to[0] === drag.last[0] && to[1] === drag.last[1]) { draw(); return; }
      }
      const pts = linePoints(drag.last[0], drag.last[1], to[0], to[1]).slice(1);
      for (const [x, y] of pts) stamp(x, y);
      drag.last = to;
      draw(); status();
      return;
    }
    if (drag.kind === 'shape') { drag.to = [p.x, p.y]; drag.preview = shapePreview(e); draw(); return; }
    if (drag.kind === 'pathnode') {
      const dx = p.x - drag.px, dy = p.y - drag.py;
      if (dx !== drag.dx || dy !== drag.dy) { drag.dx = dx; drag.dy = dy; drag.preview = shifted(drag.base, doc.width, doc.height, dx, dy); draw(); }
      return;
    }
    if (drag.kind === 'curve-line') { drag.to = [p.x, p.y]; drag.preview = new Uint8ClampedArray(drag.base); for (const [x, y] of linePoints(drag.from[0], drag.from[1], p.x, p.y)) plot(drag.preview, x, y, drag.colour); draw(); return; }
    if (drag.kind === 'gradient') { drag.to = [p.fx, p.fy]; drag.preview = gradientPixels(drag); draw(); return; }
    if (drag.kind === 'select') { moveSelect(p, e); return; }
    if (drag.kind === 'slice') { drag.to = [p.x, p.y]; draw(); return; }
    if (drag.kind === 'bone-new' || drag.kind === 'bone-pose') { boneMove(p); return; }
    if (drag.kind === 'move') { floating.x = drag.fx + (p.x - drag.px); floating.y = drag.fy + (p.y - drag.py); draw(); }
  }

  function onUp(e) {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === 'stroke') change(d.colour[3] === 0 && tool === 'eraser' ? 'Erase' : d.ink === 'shade' ? 'Shade' : 'Draw', (doc2) => { putCel(doc2, key(doc2.layers[layer].id, frame), { px: d.preview, opacity: (cel() || { opacity: 255 }).opacity }); });
    else if (d.kind === 'shape') change(d.tool === 'line' ? 'Line' : d.tool === 'rect' ? 'Rectangle' : d.tool === 'isobox' ? 'Box' : 'Ellipse', (doc2) => { putCel(doc2, key(doc2.layers[layer].id, frame), { px: shapePreview(e, d), opacity: (cel() || { opacity: 255 }).opacity }); });
    else if (d.kind === 'curve-line') { curve = { from: d.from, to: d.to, ctrl: [(d.from[0] + d.to[0]) / 2, (d.from[1] + d.to[1]) / 2], colour: d.colour, base: d.base }; curvePreview(); draw(); notice('Move to bend it, click to draw it (Esc: none)', 1500); }
    else if (d.kind === 'pathnode') { if (d.dx || d.dy) change(`Move frame ${frame + 1}'s picture`, (doc2) => { putCel(doc2, key(doc2.layers[layer].id, frame), { px: d.preview, opacity: (cel() || { opacity: 255 }).opacity }); }); else draw(); }
    else if (d.kind === 'gradient') change('Gradient', (doc2) => { putCel(doc2, key(doc2.layers[layer].id, frame), { px: d.preview, opacity: (cel() || { opacity: 255 }).opacity }); });
    else if (d.kind === 'tiles') putTiles(d.terrain ? (d.on ? 'Draw a terrain' : 'Take a terrain away') : d.value ? 'Place tiles' : 'Take tiles away', d.map);
    else if (d.kind === 'select') endSelect(d);
    else if (d.kind === 'slice') endSlice(d);
    else if (d.kind === 'bone-new' || d.kind === 'bone-pose') boneUp(d);
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
    normalizeIndexed(doc, prev);
    normalizeTilemaps(doc, prev);
    normalizeBones(doc, prev);
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
    const items = moreItems();
    NoorUI.modal({ label: 'Sprite', width: 320 }, (s2, closeIt) => {
      s2.append(NoorUI.head('Sprite and edit', closeIt), el('div', { class: 'modal-body sp-menu' }, ...items.map((it) => (it ? el('button', { class: 'utility-btn', onclick: () => { closeIt(); it[1](); } }, it[0]) : el('hr')))));
    });
    void anchor;
  }

  /** The ☰ menu's items (also found by the command search). */
  function moreItems() {
    return [
      ['Canvas size…', canvasDialog], ['Scale the sprite…', scaleDialog], ['Crop to the selection', cropToSelection], null,
      ['Flip the sprite left ↔ right', () => transform('flipH', 'sprite')], ['Flip the sprite top ↕ bottom', () => transform('flipV', 'sprite')],
      ['Turn the sprite 90° clockwise', () => transform('rotR', 'sprite')], ['Turn the sprite 90° anticlockwise', () => transform('rotL', 'sprite')], null,
      ['Flip the layer ↔', () => transform('flipH', 'layer')], ['Flip the layer ↕', () => transform('flipV', 'layer')],
      ['Flip the selection ↔', () => transform('flipH', 'selection')], ['Flip the selection ↕', () => transform('flipV', 'selection')], ['Turn the selection 90°', () => transform('rotR', 'selection')], null,
      ['Rotate by any angle (stays crisp)…', rotateDialog], ['Scale 2× (Scale2x: smooth diagonals)', () => scaleSmart(2)], ['Scale 3× (Scale3x)', () => scaleSmart(3)], null,
      ['Replace a colour…', replaceDialog], ['Outline…', outlineDialog], ['Clean doubled corners (jaggies) on this layer', cleanJaggies], ['Motion (bob, breathe, jump, shake, float, sway)…', motionDialog], ['Auto shade (light from a side, a palette ramp)…', autoShadeDialog], ['A brush from the selection (Ctrl+B)', brushFromSelection], null,
      ['Facing the other way (a tag mirrored)…', mirrorTagDialog], ['Directions (4 or 8 from one tag)…', directionsDialog], ['Update the mirrored tags', updateMirrors], null,
      ['In-betweens (this layer moving to a later frame)…', tweenDialog], ['Frame timing (scale or set durations)…', timingDialog], null,
      ['New tilemap layer', addTilemapLayer], ['Make this layer a tilemap (cut into tiles of the grid\'s size)', makeTilemap], ['Export the tilemap for Godot (TileSet and TileMap)…', exportTiles], null,
      ['Share: a GIF or a video…', shareDialog], ['An atlas of many sprites (one sheet, JSON and Godot)…', packAtlas], null,
      ['Normal maps (for lit sprites)…', normalsDialog], ['A bitmap font (letters in the grid\'s cells)…', fontDialog], null,
      ['Check the colours (too close, barely used)…', colourCheck], ['Take out lone pixels', removeLonePixels], ['Fewer colours (in the selection or the layer)…', reduceColours], ['A picture made pixel art (a start to draw over)…', pictureToPixels], null,
      ['A picture to trace (a reference layer)…', () => importPicture('reference')], ['A floating reference picture (a window to look at)…', floatingReference], null,
      ['This frame to NoorForge (a decal to stamp on a model)', toForge], ['This frame to the Texture Bench (a material; on a tilemap layer, its tiles)', toTexture], ['A sound for this frame…', () => frameSound(false)],
      ['Import a sprite sheet (cut into frames)…', () => importPicture('sheet')], ['Import a picture as a new layer…', () => importPicture('layer')], null,
      ['Save as…', () => save(true)],
    ];
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

  // ---------------------------------------------------------------- indexed colour

  // An indexed sprite: each cel keeps the palette index of every pixel (idx; −1 clear) beside its pixels, which are
  // always drawn from it. Drawing works out the indices afterwards (an unchanged pixel keeps its index, else the
  // palette's colour, else the nearest); changing a palette colour changes every pixel of that index.
  const palDist = (p, r, g, b, a) => (p[0] - r) ** 2 * 3 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 2 + (p[3] - a) ** 2 * 2;

  function renderIndexed(idx, pal) {
    const px = new Uint8ClampedArray(idx.length * 4);
    for (let i = 0; i < idx.length; i++) { const c = pal[idx[i]]; if (c) px.set(c, i * 4); }
    return px;
  }

  function normalizeIndexed(d, prev) {
    if (!d.indexed || !d.palette.length) return;
    const pal = d.palette.map(parseHex), palChanged = !prev || !prev.indexed || prev.palette.join() !== d.palette.join();
    const exact = new Map(), near = new Map();
    pal.forEach((c, i) => { const k = rgbaKey(c, 0); if (!exact.has(k)) exact.set(k, i); });
    const nearest = (r, g, b, a) => {
      const k = ((r << 24 | g << 16 | b << 8 | a) >>> 0);
      let n = exact.get(k);
      if (n !== undefined) return n;
      n = near.get(k);
      if (n !== undefined) return n;
      let bd = Infinity; n = 0;
      pal.forEach((p2, i) => { if (!p2[3]) return; const dd = palDist(p2, r, g, b, a); if (dd < bd) { bd = dd; n = i; } });
      near.set(k, n);
      return n;
    };
    const refs = new Set(d.layers.filter((l) => l.reference).map((l) => l.id));
    const done = new Map();
    for (const [k, c] of [...d.cels]) {
      if (refs.has(k.slice(0, k.lastIndexOf(':')))) continue;
      const pxChanged = !c.idx || c.idxPx !== c.px;
      if (!pxChanged && !palChanged) continue;
      if (done.has(c.px)) { const r = done.get(c.px); d.cels.set(k, { ...c, ...r }); continue; }
      const n = d.width * d.height, idx = new Int16Array(n);
      if (!pxChanged) {
        // The palette changed: each pixel keeps its index (one past the end takes the nearest colour left).
        for (let i = 0; i < n; i++) { const v = c.idx[i]; idx[i] = v < pal.length ? v : (c.px[i * 4 + 3] ? nearest(c.px[i * 4], c.px[i * 4 + 1], c.px[i * 4 + 2], c.px[i * 4 + 3]) : -1); }
      } else {
        const was = c.idx || (prev && prev.cels.get(k) && prev.cels.get(k).idx);
        for (let i = 0, o = 0; i < n; i++, o += 4) {
          if (!c.px[o + 3]) { idx[i] = -1; continue; }
          const v = was && was.length === n ? was[i] : -1, pc = v >= 0 && pal[v];
          // A pixel still the colour its index had keeps the index (two entries of one colour stay apart).
          idx[i] = pc && v < pal.length && pc[0] === c.px[o] && pc[1] === c.px[o + 1] && pc[2] === c.px[o + 2] && pc[3] === c.px[o + 3] ? v : nearest(c.px[o], c.px[o + 1], c.px[o + 2], c.px[o + 3]);
        }
      }
      const px = renderIndexed(idx, pal), r = { px, idx, idxPx: px };
      done.set(c.px, r);
      d.cels.set(k, { ...c, ...r });
    }
  }

  /** Palette entries moved or removed in an indexed sprite: every pixel's index follows its colour (`to[i]`: −1 gone). */
  function remapIndices(d, to, oldPal) {
    if (!d.indexed) return;
    const pal = d.palette.map(parseHex), done = new Map();
    for (const [k, c] of [...d.cels]) {
      if (!c.idx) continue;
      if (!done.has(c.idx)) {
        const idx = new Int16Array(c.idx.length);
        for (let i = 0; i < idx.length; i++) {
          const v = c.idx[i];
          if (v < 0) { idx[i] = -1; continue; }
          let n = to[v];
          if (n === undefined || n < 0) { const oc = parseHex(oldPal[v]); let bd = Infinity; n = 0; pal.forEach((p2, j) => { const dd = palDist(p2, ...oc); if (dd < bd) { bd = dd; n = j; } }); }
          idx[i] = n;
        }
        done.set(c.idx, idx);
      }
      d.cels.set(k, { ...c, idx: done.get(c.idx), idxPx: c.px });
    }
  }

  function setIndexed(on) {
    if (on === !!doc.indexed) return;
    if (on && !doc.palette.length) { notice('An indexed sprite needs a palette first', 1600); return; }
    change(on ? 'Indexed colour' : 'RGB colour', (d) => {
      d.indexed = on;
      if (!on) for (const [k, c] of [...d.cels]) { const { idx, idxPx, ...rest } = c; void idx; void idxPx; d.cels.set(k, rest); }
    });
    notice(on ? 'Indexed: every pixel is a palette colour; changing a colour changes its pixels' : 'RGB: any colour', 1800);
  }

  /** The palette index under a sprite pixel on the current layer (or null). */
  function indexAt(x, y) {
    const c = cel();
    return doc.indexed && c && c.idx ? c.idx[y * doc.width + x] : null;
  }

  // Colour cycling: palette entries from…to turn round, shown while it plays.
  let cycling = null; // { timer, phase }

  function cyclePalette(phase) {
    const cy = doc.cycle, pal = doc.palette.map(parseHex);
    if (!cy) return pal;
    const len = cy.to - cy.from + 1, out = [...pal];
    for (let i = 0; i < len; i++) if (cy.from + i < pal.length) out[cy.from + i] = pal[cy.from + ((i - phase) % len + len) % len];
    return out;
  }

  /** A frame composed with the palette turned `cycling.phase` steps (indexed sprites with a cycle). */
  function composeCycled(f, d = doc) {
    if (!cycling || !d.indexed || !d.cycle) return null;
    const pal = cyclePalette(cycling.phase), d2 = snapshot(d);
    for (const [k, c] of d2.cels) if (c.idx) d2.cels.set(k, { ...c, px: renderIndexed(c.idx, pal) });
    return compose(f, d2);
  }

  function toggleCycling() {
    if (cycling) { clearInterval(cycling.timer); cycling = null; draw(); drawPreview(); renderPalette(); return; }
    if (!doc.indexed || !doc.cycle) { cycleDialog(); return; }
    cycling = { phase: 0, timer: setInterval(() => { if (!isOpen() || !doc.indexed || !doc.cycle) { toggleCycling(); return; } cycling.phase++; draw(); drawPreview(); }, 1000 / doc.cycle.fps) };
    renderPalette();
  }

  function cycleDialog() {
    if (!doc.indexed) { notice('Colour cycling turns palette colours round: make the sprite indexed first (palette ⋯)', 2200); return; }
    const cy = doc.cycle || { from: 0, to: Math.min(doc.palette.length - 1, 3), fps: 8 };
    NoorUI.modal({ label: 'Colour cycling', width: 380 }, (s, closeIt) => {
      const from = el('input', { type: 'number', min: '1', max: String(doc.palette.length), value: String(cy.from + 1), id: 'sp-cy-from', 'aria-label': 'From colour' });
      const to = el('input', { type: 'number', min: '1', max: String(doc.palette.length), value: String(cy.to + 1), id: 'sp-cy-to', 'aria-label': 'To colour' });
      const fps = el('input', { type: 'number', min: '1', max: '60', value: String(cy.fps), id: 'sp-cy-fps', 'aria-label': 'Steps a second' });
      const ok = (clear) => {
        const a = Math.max(0, Math.min(doc.palette.length - 1, Number(from.value) - 1)), b = Math.max(a, Math.min(doc.palette.length - 1, Number(to.value) - 1));
        closeIt();
        if (cycling) toggleCycling();
        change(clear ? 'No colour cycling' : 'Colour cycling', (d) => { d.cycle = clear || a === b ? null : { from: a, to: b, fps: Math.max(1, Math.min(60, Math.round(Number(fps.value) || 8))) }; });
        if (!clear && doc.cycle) toggleCycling();
      };
      s.append(NoorUI.head('Colour cycling', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: 'Palette colours that turn round, as water, fire or lights in old games: every pixel of those colours moves along.' }),
          el('label', {}, 'Colours ', from, ' to ', to), el('label', {}, 'Steps a second ', fps)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' },
          ...(doc.cycle ? [el('button', { class: 'action', onclick: () => ok(true) }, 'No cycling')] : []),
          el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-cy-ok', onclick: () => ok(false) }, 'Play it'))));
    });
  }

  // ---------------------------------------------------------------- stage 3: animation helpers

  const EASES = { linear: (t) => t, in: (t) => t * t, out: (t) => 1 - (1 - t) * (1 - t), inout: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)) };

  /** Where a picture's drawn pixels are: their box, or null when there are none. */
  function drawnBox(px, W, H) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  function shifted(px, W, H, dx, dy) {
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= H) continue;
      for (let x = 0; x < W; x++) { const sx = x - dx; if (sx >= 0 && sx < W) out.set(px.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4); }
    }
    return out;
  }

  /**
   * In-betweens: `count` new frames before frame `to`, in which this layer's picture on frame `from` moves (eased)
   * towards where it is on frame `to`; the other layers keep frame `from`'s pictures.
   */
  /** A picture scaled (nearest) about a point: sx across, sy down. */
  function scaledAbout(px, W, H, cx, cy, sx, sy) {
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const qx = Math.floor(cx + (x + 0.5 - cx) / sx), qy = Math.floor(cy + (y + 0.5 - cy) / sy);
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      out.set(px.subarray((qy * W + qx) * 4, (qy * W + qx) * 4 + 4), (y * W + x) * 4);
    }
    return out;
  }

  /** b under a: where a is clear, b shows. */
  function under(a, b) {
    const out = new Uint8ClampedArray(a);
    for (let i = 0; i < out.length; i += 4) if (!out[i + 3] && b[i + 3]) out.set(b.subarray(i, i + 4), i);
    return out;
  }

  function tween(from, to, count, ease, style = 'move') {
    const lid = doc.layers[layer].id, a = doc.cels.get(key(lid, from)), b = doc.cels.get(key(lid, to));
    const W = doc.width, H = doc.height, ba = a && drawnBox(a.px, W, H), bb = b && drawnBox(b.px, W, H);
    if (!ba || !bb) { notice('This layer needs a picture on both frames to move between', 2000); return false; }
    // The move: the middles of what is drawn on each frame.
    const dx = (bb.x0 + bb.x1 - ba.x0 - ba.x1) / 2, dy = (bb.y0 + bb.y1 - ba.y0 - ba.y1) / 2, f = EASES[ease] || EASES.linear;
    change(`${count} in-between${count === 1 ? '' : 's'}`, (d) => {
      const dur = d.frames[from].duration;
      d.frames.splice(to, 0, ...Array.from({ length: count }, () => ({ duration: dur })));
      shiftFrames(d, to, count);
      for (let i = 1; i <= count; i++) {
        const t = f(i / (count + 1)), at = to + i - 1;
        d.layers.forEach((l) => {
          const c = d.cels.get(key(l.id, from));
          if (!c) return;
          const { link, ...plain } = c; void link;
          if (l.id !== lid) { d.cels.set(key(l.id, at), plain); return; }
          const ox = Math.round(dx * t), oy = Math.round(dy * t);
          let px = shifted(c.px, W, H, ox, oy);
          if (style === 'squash') {
            // Stretched along the move (most in the middle of it), thinner across, about the picture's middle.
            const k = 1 + 0.35 * Math.sin(Math.PI * (i / (count + 1))), across = Math.abs(dx) >= Math.abs(dy);
            const mx = (ba.x0 + ba.x1 + 1) / 2 + ox, my = (ba.y0 + ba.y1 + 1) / 2 + oy;
            px = scaledAbout(px, W, H, mx, my, across ? k : 1 / k, across ? 1 / k : k);
          } else if (style === 'smear') {
            // Copies trailing back towards where it was a frame before, under the picture.
            const pt = f((i - 1) / (count + 1)), px0 = Math.round(dx * pt), py0 = Math.round(dy * pt);
            for (const q of [0.25, 0.5, 0.75]) px = under(px, shifted(c.px, W, H, Math.round(px0 + (ox - px0) * q), Math.round(py0 + (oy - py0) * q)));
          }
          d.cels.set(key(l.id, at), { ...plain, px });
        });
      }
      frame = to;
    });
    return true;
  }

  function tweenDialog() {
    commitFloating();
    if (frame >= doc.frames.length - 1) { notice('In-betweens go from this frame to a later one: add a frame first', 2000); return; }
    NoorUI.modal({ label: 'In-betweens', width: 400 }, (s, closeIt) => {
      const to = el('input', { type: 'number', min: String(frame + 2), max: String(doc.frames.length), value: String(frame + 2), id: 'sp-tw-to', 'aria-label': 'To frame' });
      const count = el('input', { type: 'number', min: '1', max: '30', value: '3', id: 'sp-tw-count', 'aria-label': 'How many frames' });
      const ease = el('select', { id: 'sp-tw-ease', 'aria-label': 'Easing' }, ...[['linear', 'evenly'], ['inout', 'slow – fast – slow'], ['in', 'speeding up'], ['out', 'slowing down']].map(([v, l]) => el('option', { value: v, text: l })));
      const style = el('select', { id: 'sp-tw-style', 'aria-label': 'How it moves' }, ...[['move', 'as it is'], ['squash', 'squash and stretch'], ['smear', 'with a smear behind']].map(([v, l]) => el('option', { value: v, text: l })));
      const ok = () => {
        const b = Math.max(frame + 1, Math.min(doc.frames.length - 1, Number(to.value) - 1)), n = Math.max(1, Math.min(30, Math.round(Number(count.value) || 1)));
        closeIt();
        tween(frame, b, n, ease.value, style.value);
      };
      s.append(NoorUI.head('In-betweens', closeIt),
        el('div', { class: 'modal-body sp-dlg' },
          el('p', { class: 'pref-hint', text: `The layer “${doc.layers[layer].name}” moves from frame ${frame + 1} to where it is on the frame you choose; new frames go in between.` }),
          el('label', {}, 'To frame ', to), el('label', {}, 'New frames ', count), el('label', {}, 'Moving ', ease), el('label', {}, 'Looks ', style)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-tw-ok', onclick: ok }, 'Make them'))));
    });
  }

  /** Frame timing: durations scaled, or set, for every frame, a tag's or this one on. */
  function timing(which, how, value) {
    const t = typeof which === 'number' ? doc.tags[which] : null;
    const [a, b] = t ? [t.from, t.to] : which === 'here' ? [frame, doc.frames.length - 1] : [0, doc.frames.length - 1];
    change(how === 'scale' ? 'Scale durations' : 'Set durations', (d) => {
      for (let i = a; i <= b; i++) d.frames[i].duration = Math.max(1, Math.min(65535, Math.round(how === 'scale' ? d.frames[i].duration * value / 100 : how === 'total' ? value / (b - a + 1) : value)));
    });
  }

  function timingDialog() {
    NoorUI.modal({ label: 'Frame timing', width: 400 }, (s, closeIt) => {
      const which = el('select', { id: 'sp-tm-which', 'aria-label': 'Which frames' }, el('option', { value: 'all', text: 'every frame' }), el('option', { value: 'here', text: `frame ${frame + 1} on` }), ...doc.tags.map((t, i) => el('option', { value: String(i), text: `tag “${t.name}”` })));
      const how = el('select', { id: 'sp-tm-how', 'aria-label': 'How' }, el('option', { value: 'scale', text: 'scale by (%)' }), el('option', { value: 'set', text: 'each lasts (ms)' }), el('option', { value: 'total', text: 'all together last (ms)' }));
      const value = el('input', { type: 'number', min: '1', max: '65535', value: '50', id: 'sp-tm-value', 'aria-label': 'Value' });
      const total = () => doc.frames.reduce((n, f) => n + f.duration, 0);
      how.addEventListener('change', () => { value.value = how.value === 'scale' ? '50' : how.value === 'set' ? '100' : String(total()); });
      const ok = () => {
        const v = Number(value.value);
        if (!(v > 0)) return;
        closeIt();
        timing(which.value === 'all' || which.value === 'here' ? which.value : Number(which.value), how.value, v);
      };
      s.append(NoorUI.head('Frame timing', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: `Now ${doc.frames.length} frame${doc.frames.length === 1 ? '' : 's'}, ${total()} ms in all. 50 % plays twice as fast.` }),
          el('label', {}, 'Frames ', which), el('label', {}, 'How ', how), el('label', {}, 'Value ', value)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-tm-ok', onclick: ok }, 'OK'))));
    });
  }

  // ---------------------------------------------------------------- stage 3: tilemaps

  // A tilemap layer's cel keeps its pixels (px, drawn and composed like any cel) and the grid of tile numbers they
  // are made of (map, cols × rows from the sprite's top left; 0: no tile). A tileset is { name, tw, th, tiles },
  // tiles[n] a tile's pixels for n ≥ 1. Drawing pixels on a tilemap works out its tiles afterwards, as Aseprite's
  // "auto" mode does; drawing tiles places them and the pixels follow.
  let tileMode = false;   // T: drawing tiles (else pixels) on a tilemap layer
  let tileSel = 1;        // the tile drawn with
  let tileFlags = 0;      // how it is turned: the bits below
  let terrainSel = -1;    // drawing with a terrain (autotiling) instead of one tile

  // Autotiling by sides: a terrain names the tile for each way its neighbours join (1 up, 2 right, 4 down, 8 left).
  const SIDE_UP = 1, SIDE_RIGHT = 2, SIDE_DOWN = 4, SIDE_LEFT = 8;

  /** Cells of a terrain take the tile for how their neighbours of the same terrain join them. */
  function terrainFix(map, cols, rows, ter, cells) {
    const isT = (i) => { const id = tileId(map[i]); return id > 0 && ter.tiles.includes(id); };
    for (const i of cells) {
      if (i < 0 || i >= map.length || !isT(i)) continue;
      const c = i % cols, r = (i - c) / cols;
      let m = 0;
      if (r > 0 && isT(i - cols)) m |= SIDE_UP;
      if (c < cols - 1 && isT(i + 1)) m |= SIDE_RIGHT;
      if (r < rows - 1 && isT(i + cols)) m |= SIDE_DOWN;
      if (c > 0 && isT(i - 1)) m |= SIDE_LEFT;
      map[i] = ter.tiles[m] || ter.tiles[15] || ter.tiles.find(Boolean) || 0;
    }
  }

  /** A cell made part of the terrain (or taken out), it and its neighbours fitted again. */
  function placeTerrain(map, i, on, ter) {
    const { cols, rows } = mapSize(doc, tilesetOf()), c = i % cols;
    map[i] = on ? (ter.tiles[15] || ter.tiles.find(Boolean) || 0) : 0;
    terrainFix(map, cols, rows, ter, [i, i - cols, i + cols, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1]);
  }

  // A tile in a map: its number in the low 29 bits, then flipped across (bit 29), flipped down (30) and turned on
  // its diagonal (31) — as Aseprite keeps them; the diagonal first, then the flips.
  const TILE_ID = 0x1fffffff, FLIP_X = 0x20000000, FLIP_Y = 0x40000000, FLIP_D = 0x80000000 | 0;
  const tileId = (v) => v & TILE_ID;
  const tileBits = (v) => v & ~TILE_ID;

  /** A tile's pixels turned as its bits say (square tiles only turn on the diagonal). */
  function turnedTile(ts, v) {
    const t = ts.tiles[tileId(v)], f = tileBits(v);
    if (!t || !f) return t;
    const w = ts.tw, h = ts.th, out = new Uint8ClampedArray(t.length), d = (f & FLIP_D) && w === h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sx = x, sy = y;
      if (f & FLIP_X) sx = w - 1 - sx;
      if (f & FLIP_Y) sy = h - 1 - sy;
      if (d) [sx, sy] = [sy, sx];
      out.set(t.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
    }
    return out;
  }

  /** Turning a tile a quarter clockwise, or flipping it, as bits (the turn composed with what is there). */
  function turnBits(f, how) {
    // As a matrix on the tile's middle: the diagonal (swap), then flips; compose, then read back.
    let m = [[1, 0], [0, 1]];
    const mul = (a, b) => [[a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]], [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]]];
    if (f & FLIP_D) m = mul([[0, 1], [1, 0]], m);
    if (f & FLIP_X) m = mul([[-1, 0], [0, 1]], m);
    if (f & FLIP_Y) m = mul([[1, 0], [0, -1]], m);
    m = mul(how === 'x' ? [[-1, 0], [0, 1]] : how === 'y' ? [[1, 0], [0, -1]] : [[0, -1], [1, 0]], m);
    let out = 0;
    if (m[0][0] === 0) { out |= FLIP_D; m = mul(m, [[0, 1], [1, 0]]); }
    if (m[0][0] < 0) out |= FLIP_X;
    if (m[1][1] < 0) out |= FLIP_Y;
    return out;
  }

  function turnTileToPlace(how) {
    const ts = isTilemap() && tilesetOf();
    if (how === 'r' && ts && ts.tw !== ts.th) { notice('Only square tiles can be turned', 1400); return; }
    tileFlags = turnBits(tileFlags, how);
    renderTileset(); draw();
  }

  const isTilemap = (l = layer, d = doc) => !!d.layers[l] && d.layers[l].kind === 'tilemap';
  const tilesetOf = (l = layer, d = doc) => d.tilesets[d.layers[l].tileset];
  const mapSize = (d, ts) => ({ cols: Math.ceil(d.width / ts.tw), rows: Math.ceil(d.height / ts.th) });
  const tilesOn = () => tileMode && isTilemap();

  /** A grid of tiles drawn as the sprite's pixels. */
  function renderMap(d, ts, map) {
    const W = d.width, H = d.height, px = new Uint8ClampedArray(W * H * 4), { cols, rows } = mapSize(d, ts);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const t = turnedTile(ts, map[r * cols + c]);
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
      for (const [k, c] of ofSet) { const m = oldMap(k, c); if (m && !counted.has(m)) { counted.add(m); for (const v of m) { const n = tileId(v); uses.set(n, (uses.get(n) || 0) + 1); } } }
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
          const i = r * cols + col, t = cellOf(d, ts, c.px, col, r), oldV = was ? was[i] : 0, old = tileId(oldV);
          let n;
          if (clearTile(t)) n = 0;
          else if (old && sameTile(turnedTile(ts, oldV), t)) n = oldV; // unchanged, turned as it was
          else if ((n = find(t))) { /* the same as a tile there already */ }
          else if (old && uses.get(old) === 1) {
            const h = tileHash(ts.tiles[old]);
            index.set(h, (index.get(h) || []).filter((x) => x !== old));
            ts.tiles[old] = t; indexAdd(old); n = old; edited = true;
          } else if (ts.tiles.length <= 4096) { n = ts.tiles.length; ts.tiles.push(t); indexAdd(n); }
          else n = 0;
          const nid = tileId(n);
          if (nid !== old) { if (old) uses.set(old, uses.get(old) - 1); if (nid) uses.set(nid, (uses.get(nid) || 0) + 1); }
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
    d.tilesets.push({ name: `Tiles ${d.tilesets.length + 1}`, tw, th, tiles: [null], terrains: [] });
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
    if (t === 'picker') { if (map[at.i]) { tileSel = tileId(map[at.i]); tileFlags = tileBits(map[at.i]); renderTileset(); } return; }
    if (!canDraw()) return;
    const ter = terrainSel >= 0 && (tilesetOf().terrains || [])[terrainSel];
    if (ter) {
      if (!ter.tiles.some(Boolean)) { notice('That terrain has no tiles yet (✎ to give it some)', 1600); return; }
      const next = new Int32Array(map), on = !(t === 'eraser' || right);
      if (t === 'fill') {
        const { cols, rows } = mapSize(doc, tilesetOf()), from = tileId(next[at.i]), stack = [at.i], seen = new Set();
        while (stack.length) {
          const i = stack.pop();
          if (seen.has(i) || tileId(next[i]) !== from) continue;
          seen.add(i); next[i] = on ? (ter.tiles[15] || ter.tiles.find(Boolean)) : 0;
          const c = i % cols, r = (i - c) / cols;
          if (c > 0) stack.push(i - 1); if (c < cols - 1) stack.push(i + 1); if (r > 0) stack.push(i - cols); if (r < rows - 1) stack.push(i + cols);
        }
        terrainFix(next, cols, rows, ter, next.map((_, i) => i));
        putTiles(on ? 'Fill with a terrain' : 'Take a terrain away', next);
        return;
      }
      placeTerrain(next, at.i, on, ter);
      drag = { kind: 'tiles', map: next, value: on ? 1 : 0, last: at, terrain: ter, on };
      drag.preview = renderMap(doc, tilesetOf(), next);
      draw();
      return;
    }
    if (!(t === 'eraser' || right) && tileSel >= tilesetOf().tiles.length) { notice('Choose a tile in the tileset first', 1400); return; }
    const n = t === 'eraser' || right ? 0 : (tileSel | tileFlags);
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
    for (const [c, r] of linePoints(drag.last ? drag.last.c : at.c, drag.last ? drag.last.r : at.r, at.c, at.r)) {
      const i = r * mapSize(doc, tilesetOf()).cols + c;
      if (drag.terrain) placeTerrain(drag.map, i, drag.on, drag.terrain); else drag.map[i] = drag.value;
    }
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
        onclick: () => { tileSel = i + 1; terrainSel = -1; if (!tileMode) setTileMode(true); else renderTileset(); keepFocus(); } }, cv);
    });
    box.replaceChildren(
      el('h4', { class: 'music-subhead', text: `Tileset “${ts.name}”` }),
      el('small', { class: 'pref-hint', id: 'sp-tileinfo', text: `${ts.tiles.length - 1} tile${ts.tiles.length === 2 ? '' : 's'} of ${ts.tw} × ${ts.th}` }),
      el('div', { class: 'sb-row', role: 'group', 'aria-label': 'Draw' }, mode(false, 'Pixels', 'Draw pixels; the tiles follow (T)'), mode(true, 'Tiles', 'Place whole tiles (T)')),
      el('div', { class: 'sb-row', role: 'group', 'aria-label': 'Turn the tile' },
        el('button', { class: 'icon-btn' + (tileFlags & FLIP_X ? ' on' : ''), id: 'sp-tile-fx', title: 'Place it flipped left ↔ right (Shift+X in tile mode)', 'aria-label': 'Flip the tile across', onclick: () => turnTileToPlace('x') }, '⇋'),
        el('button', { class: 'icon-btn' + (tileFlags & FLIP_Y ? ' on' : ''), id: 'sp-tile-fy', title: 'Place it flipped top ↕ bottom (Shift+Y in tile mode)', 'aria-label': 'Flip the tile down', onclick: () => turnTileToPlace('y') }, '⇵'),
        el('button', { class: 'icon-btn' + (tileFlags & FLIP_D ? ' on' : ''), id: 'sp-tile-rot', title: 'Place it turned a quarter clockwise (R in tile mode)', 'aria-label': 'Turn the tile', onclick: () => turnTileToPlace('r') }, '⟳'),
        tileFlags ? el('button', { class: 'utility-btn', title: 'Upright again', onclick: () => { tileFlags = 0; renderTileset(); draw(); } }, 'upright') : null),
      tiles.length ? el('div', { class: 'sp-tiles', id: 'sp-tiles', role: 'listbox', 'aria-label': 'Tiles' }, ...tiles) : el('p', { class: 'pref-hint', text: 'Draw on the layer and its tiles appear here.' }),
      el('h4', { class: 'music-subhead', text: 'Terrains (autotiling)' }),
      el('div', { class: 'sb-row sp-terrains', role: 'group', 'aria-label': 'Terrains' },
        ...(ts.terrains || []).map((tr, i) => el('span', { class: 'sp-terrain' + (terrainSel === i ? ' on' : '') },
          el('button', { class: 'utility-btn', 'data-terrain': String(i), style: `--c:${tr.color.slice(0, 7)}`, 'aria-pressed': String(terrainSel === i), title: `Draw ${tr.name}: each cell takes the tile for how its neighbours join it`, onclick: () => { terrainSel = terrainSel === i ? -1 : i; if (terrainSel >= 0 && !tileMode) setTileMode(true); else { renderTileset(); draw(); } } }, tr.name),
          el('button', { class: 'icon-btn', 'data-terrain-edit': String(i), title: 'Its tiles', 'aria-label': `Edit ${tr.name}`, onclick: () => terrainDialog(i) }, '✎'))),
        el('button', { class: 'icon-btn', id: 'sp-addterrain', title: 'A terrain: the tile for every way neighbours join (16 shapes)', 'aria-label': 'New terrain', onclick: () => terrainDialog(null) }, '＋')),
      (() => {
        const c = el('input', { type: 'checkbox', id: 'sp-tiles-iso', checked: ts.iso || undefined });
        c.addEventListener('change', () => { const ti = doc.layers[layer].tileset, on = c.checked; change(on ? 'Isometric tiles' : 'Square tiles', (d) => { d.tilesets[ti] = { ...d.tilesets[ti], iso: on }; if (!on) delete d.tilesets[ti].iso; }); });
        return el('label', { class: 'sb-inline', title: 'For Godot: an isometric TileSet (diamonds as wide as a tile and half as high; taller tiles stand up from them). The map is laid out in Godot\'s diamond grid, cell for cell' }, c, el('span', { text: 'isometric (Godot)' }));
      })(),
      el('div', { class: 'sb-row' },
        el('button', { class: 'utility-btn', id: 'sp-tiles-godot', title: 'The tiles as a Godot TileSet and the map as a TileMap scene', onclick: exportTiles }, 'Godot TileSet…'),
        el('button', { class: 'utility-btn', id: 'sp-tiles-godot-all', title: 'Every tilemap layer in one Godot scene (each with its TileSet)', onclick: () => exportTiles(true) }, 'All map layers…'),
        el('button', { class: 'utility-btn', title: 'Make it a plain layer again (the tiles stay as pixels)', onclick: makeImageLayer }, 'To a plain layer')));
  }

  /** Which tile goes with each way the neighbours join: 16 shapes, a tile for each. */
  function terrainDialog(ti) {
    const ts = tilesetOf(), tsi = doc.layers[layer].tileset;
    if (ts.tiles.length < 2) { notice('Draw some tiles first: a terrain is made of them', 1600); return; }
    const tr = ti === null ? { name: `Terrain ${(ts.terrains || []).length + 1}`, color: '#4caf50ff', tiles: Array(16).fill(0) } : { ...ts.terrains[ti], tiles: [...ts.terrains[ti].tiles] };
    let slot = 0;
    NoorUI.modal({ label: 'Terrain', width: 520 }, (s, closeIt) => {
      const name = el('input', { type: 'text', value: tr.name, maxlength: '64', id: 'sp-ter-name', 'aria-label': 'Name' });
      const colour = el('input', { type: 'color', value: tr.color.slice(0, 7), 'aria-label': 'Colour' });
      const slots = el('div', { class: 'sp-ter-slots', role: 'listbox', 'aria-label': 'Shapes' });
      const tileCanvas = (n) => { const cv = el('canvas', { width: '24', height: '24' }); const c = cv.getContext('2d'); c.imageSmoothingEnabled = false; if (n && ts.tiles[n]) c.drawImage(pixelsToCanvas(ts.tiles[n], ts.tw, ts.th), 0, 0, 24, 24); return cv; };
      // A shape: the middle and the sides that join, drawn small.
      const shape = (m) => el('span', { class: 'sp-ter-shape', 'aria-hidden': 'true' }, el('i', { class: 'c' }), ...[[SIDE_UP, 'u'], [SIDE_RIGHT, 'r'], [SIDE_DOWN, 'd'], [SIDE_LEFT, 'l']].filter(([b]) => m & b).map(([, k]) => el('i', { class: k })));
      const draw2 = () => slots.replaceChildren(...tr.tiles.map((n, m) => el('button', { class: 'sp-ter-slot' + (m === slot ? ' on' : ''), 'data-slot': String(m), title: `Joined: ${[[SIDE_UP, 'up'], [SIDE_RIGHT, 'right'], [SIDE_DOWN, 'down'], [SIDE_LEFT, 'left']].filter(([b]) => m & b).map(([, k]) => k).join(', ') || 'nothing'} — ${n ? `tile ${n}` : 'no tile'}`, onclick: () => { slot = m; draw2(); } }, shape(m), tileCanvas(n))));
      const pick = el('div', { class: 'sp-tiles', role: 'listbox', 'aria-label': 'Tiles' }, ...ts.tiles.slice(1).map((_, i) => el('button', { class: 'sp-tile', 'data-pick': String(i + 1), title: `Tile ${i + 1}: put it in the chosen shape`, onclick: () => { tr.tiles[slot] = i + 1; slot = (slot + 1) % 16; draw2(); } }, tileCanvas(i + 1))));
      draw2();
      const ok = () => {
        const t2 = { name: name.value.trim() || 'Terrain', color: colour.value + 'ff', tiles: tr.tiles };
        closeIt();
        change(ti === null ? 'New terrain' : 'Change a terrain', (d) => { const t0 = d.tilesets[tsi], list = [...(t0.terrains || [])]; if (ti === null) list.push(t2); else list[ti] = t2; d.tilesets[tsi] = { ...t0, terrains: list }; });
        terrainSel = ti === null ? (tilesetOf().terrains.length - 1) : ti;
        if (!tileMode) setTileMode(true); else renderTileset();
      };
      s.append(NoorUI.head(ti === null ? 'New terrain' : 'Terrain', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'Name ', name), el('label', {}, 'Colour ', colour),
          el('p', { class: 'pref-hint', text: 'Choose a shape, then the tile for it (the next shape is chosen for you). A cell of the terrain takes the tile for how its neighbours of the same terrain join it.' }),
          slots, pick,
          el('div', { class: 'sb-row' }, el('button', { class: 'utility-btn', id: 'sp-ter-inorder', title: 'Tiles 1 to 16 in the shapes\' order', onclick: () => { tr.tiles = tr.tiles.map((_, m) => (m + 1 < ts.tiles.length ? m + 1 : 0)); draw2(); } }, 'Tiles 1–16 in order'))),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' },
          ...(ti === null ? [] : [el('button', { class: 'action', onclick: () => { closeIt(); change('Remove a terrain', (d) => { const t0 = d.tilesets[tsi]; d.tilesets[tsi] = { ...t0, terrains: t0.terrains.filter((_, j) => j !== ti) }; }); terrainSel = -1; renderTileset(); } }, 'Remove')]),
          el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-ter-ok', onclick: ok }, 'OK'))));
    });
  }

  async function exportTiles(all = false) {
    if (!isTilemap()) return;
    commitFloating();
    try {
      const r = await req('sprite.tiles.export', { sprite: toWire(), layer: doc.layers[layer].id, frame, all, name: all ? (file ? file.name.replace(/\.[^.]+$/, '') : 'level') : (file ? file.name.replace(/\.[^.]+$/, '') + '-' : '') + doc.layers[layer].name });
      if (r && !r.cancelled) notice(`Exported ${r.files.join(', ')}`, 2600);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- stage 3: slices

  let sliceSel = -1;

  /** Where a slice is on frame f: its own place, or its key's from that frame on (a slice that moves: a hitbox). */
  function sliceAt(sl, f = frame) {
    const k = (sl.keys || []).filter((k2) => k2.frame <= f).pop();
    return k ? { ...sl, x: k.x, y: k.y, width: k.width, height: k.height } : sl;
  }

  function startSlice(p) {
    const list = (doc.slices || []).map((sl) => sliceAt(sl));
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
    const list = (doc.slices || []).map((sl) => sliceAt(sl));
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
    const moves = !!(sl.keys && sl.keys.length), here = sliceAt(sl);
    const num = (k, label, min, max) => {
      const place = ['x', 'y', 'width', 'height'].includes(k);
      const i = el('input', { type: 'number', class: 'sb-num', value: String(place ? here[k] : sl[k]), min: String(min), max: String(max), 'data-slice': k, 'aria-label': label });
      i.addEventListener('change', () => change('Slice', (d) => {
        const v = Math.round(Number(i.value) || 0), x = d.slices[sliceSel];
        if (!place || !moves) { x[k] = v; return; }
        // A slice that moves: this frame gets its own place (from here on, till the next key).
        const at = sliceAt(x, frame), keys = (x.keys || []).filter((k2) => k2.frame !== frame);
        keys.push({ frame, x: at.x, y: at.y, width: at.width, height: at.height, [k]: v });
        x.keys = keys.sort((a, b) => a.frame - b.frame);
      }));
      return el('label', { class: 'sb-inline' }, el('span', { text: label }), i);
    };
    const movesBox = (() => {
      const c = el('input', { type: 'checkbox', checked: moves || undefined, 'data-slice': 'moves' });
      c.addEventListener('change', () => change(c.checked ? 'A slice that moves' : 'A slice that stays', (d) => { const x = d.slices[sliceSel]; x.keys = c.checked ? [{ frame: 0, x: x.x, y: x.y, width: x.width, height: x.height }] : []; }));
      return el('label', { class: 'sb-inline', title: 'A hitbox: its place can differ on each frame (set it on a frame: it holds from there on)' }, c, el('span', { text: 'moves with the frames (a hitbox)' }));
    })();
    const ownKey = moves && sl.keys.some((k2) => k2.frame === frame && frame > 0);
    const flag = (k, label) => { const c = el('input', { type: 'checkbox', checked: sl[k] || undefined, 'data-slice': k }); c.addEventListener('change', () => change('Slice', (d) => { const x = d.slices[sliceSel]; x[k] = c.checked; if (k === 'nine' && c.checked && x.centerWidth <= 1) { x.centerX = Math.floor(x.width / 3); x.centerY = Math.floor(x.height / 3); x.centerWidth = Math.max(1, x.width - 2 * x.centerX); x.centerHeight = Math.max(1, x.height - 2 * x.centerY); } if (k === 'hasPivot' && c.checked) { x.pivotX = Math.floor(x.width / 2); x.pivotY = x.height - 1; } })); return el('label', { class: 'sb-inline' }, c, el('span', { text: label })); };
    const name = el('input', { type: 'text', value: sl.name, maxlength: '64', id: 'sp-slice-name', 'aria-label': 'Slice name' });
    name.addEventListener('change', () => change('Rename a slice', (d) => { d.slices[sliceSel].name = name.value.trim() || 'Slice'; }));
    box.replaceChildren(...[
      el('h4', { class: 'music-subhead', text: 'Slice' }), name,
      movesBox,
      moves ? el('small', { class: 'pref-hint', id: 'sp-slice-keyinfo', text: `Frame ${frame + 1}: ${ownKey ? 'its own place' : 'as on the frame before'}` }) : null,
      el('div', { class: 'sp-grid2' }, num('x', 'x', -2048, 2048), num('y', 'y', -2048, 2048), num('width', 'w', 1, 4096), num('height', 'h', 1, 4096)),
      ownKey ? el('button', { class: 'utility-btn', id: 'sp-slice-unkey', title: 'This frame takes the place of the frame before', onclick: () => change('Slice', (d) => { const x = d.slices[sliceSel]; x.keys = x.keys.filter((k2) => k2.frame !== frame); }) }, 'As the frame before') : null,
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
    change('Sort the palette', (d) => {
      const old = d.palette, order = old.map((_, i) => i);
      if (by === 'reverse') order.reverse(); else order.sort((a, b) => (by === 'hue' ? hue(old[a]) - hue(old[b]) : lum(old[a]) - lum(old[b])));
      d.palette = order.map((i) => old[i]);
      const to = []; order.forEach((oi, ni) => { to[oi] = ni; });
      remapIndices(d, to, old); // an indexed sprite looks the same
    });
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
    change('Palette from the sprite', (d) => {
      d.palette = [...seen].slice(0, 256);
      // Indexed: each pixel finds its colour in the new palette.
      for (const [k, c] of [...d.cels]) if (c.idx) { const { idx, idxPx, ...rest } = c; void idx; void idxPx; d.cels.set(k, rest); }
    });
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
            const nc = picker.value + Number(alpha.value).toString(16).padStart(2, '0'), from = parseHex(old), to = parseHex(nc), doPx = recolour.checked && !doc.indexed; // indexed: the index does it
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
    const items = paletteItems();
    NoorUI.modal({ label: 'Palette', width: 320 }, (s2, closeIt) => {
      s2.append(NoorUI.head('Palette', closeIt), el('div', { class: 'modal-body sp-menu' }, ...items.map((it) => (it ? el('button', { class: 'utility-btn', onclick: () => { closeIt(); it[1](); } }, it[0]) : el('hr')))));
    });
  }

  /** The palette menu's items (also found by the command search). */
  function paletteItems() {
    return [['A hue-shifted ramp from the drawing colour…', hueRampDialog], ['From Lospec (by name)…', lospecPalette], null, ['Sort by hue', () => sortPalette('hue')], ['Sort by brightness', () => sortPalette('light')], ['Reverse', () => sortPalette('reverse')], null,
      ['Check the colours (too close, barely used)…', colourCheck], ['A ramp from the drawing colour to the second…', rampDialog], ['The sprite\'s own colours', paletteFromSprite], ['Make every pixel a palette colour', snapToPalette], null,
      ['Load a palette (.gpl, .pal, .hex)…', loadPalette], ['Save the palette…', savePalette], null,
      [doc.indexed ? 'RGB colour (any colour; leave indexed)' : 'Indexed colour (every pixel a palette colour)', () => setIndexed(!doc.indexed)], ['Colour cycling…', cycleDialog]];
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
      return { name: t.name, tileWidth: t.tw, tileHeight: t.th, count: n, ...(n ? { data: b64(strip) } : {}), ...(t.terrains && t.terrains.length ? { terrains: t.terrains } : {}), ...(t.iso ? { isometric: true } : {}) };
    });
    const layers = d.layers.map((l) => (l.kind === 'tilemap' || l.kind === 'group' ? (l.kind === 'group' ? (({ tileset, ...rest }) => (void tileset, rest))(l) : l) : (({ kind, tileset, ...rest }) => (void kind, void tileset, rest))(l)));
    return { version: 1, width: d.width, height: d.height, palette: d.palette, layers, frames: d.frames, tags: d.tags, slices: d.slices || [], tilesets, gridWidth: d.gridWidth, gridHeight: d.gridHeight, colorMode: d.indexed ? 'indexed' : 'rgba', ...(d.cycle ? { cycle: d.cycle } : {}), ...(d.normals ? { normals: d.normals } : {}), ...(d.audio ? { audio: d.audio } : {}), ...(d.exportLink ? { exportLink: d.exportLink } : {}), ...(d.font ? { font: d.font } : {}), ...(d.bones && d.bones.length ? { bones: d.bones } : {}), cels };
  }

  function fromWire(w) {
    const d = { width: w.width, height: w.height, palette: w.palette || [], layers: w.layers.map((l) => ({ ...l })), frames: w.frames.map((f) => ({ ...f })), tags: (w.tags || []).map((t) => ({ ...t })), slices: (w.slices || []).map((x) => ({ ...x })), gridWidth: w.gridWidth || 16, gridHeight: w.gridHeight || 16, cels: new Map() };
    d.tilesets = (w.tilesets || []).map((t) => {
      const size = t.tileWidth * t.tileHeight * 4, strip = t.data ? unb64(t.data) : new Uint8Array(0), tiles = [null];
      for (let j = 0; j < (t.count || 0); j++) tiles.push(new Uint8ClampedArray(strip.subarray(j * size, (j + 1) * size)));
      return { name: t.name || 'Tiles', tw: t.tileWidth, th: t.tileHeight, tiles, terrains: (t.terrains || []).map((x) => ({ name: x.name, color: x.color, tiles: [...x.tiles] })), ...(t.isometric ? { iso: true } : {}) };
    });
    for (const l of d.layers) {
      if (l.kind === 'group') { delete l.tileset; continue; }
      if (l.kind !== 'tilemap' || !d.tilesets[l.tileset]) { delete l.kind; delete l.tileset; }
    }
    for (const l of d.layers) if (!l.parent) delete l.parent;
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
    d.bones = (w.bones || []).map((b) => ({ id: b.id, name: b.name, parent: b.parent || null, x: b.x, y: b.y, tipX: b.tipX, tipY: b.tipY }));
    for (const f of d.frames) if (!f.pose) delete f.pose;
    for (const l of d.layers) { if (!l.bone) delete l.bone; if (!l.normals) delete l.normals; }
    if (w.normals) d.normals = { ...w.normals };
    if (w.audio) d.audio = { ...w.audio };
    if (w.exportLink) d.exportLink = { ...w.exportLink };
    if (w.font) d.font = { ...w.font };
    d.indexed = w.colorMode === 'indexed';
    d.cycle = w.cycle && w.cycle.to > w.cycle.from ? { from: w.cycle.from, to: w.cycle.to, fps: w.cycle.fps || 8 } : null;
    normalizeIndexed(d, null);
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
      // A live link: exported again to the game project, the same way.
      if (doc.exportLink) {
        try { const x = await runExport(doc.exportLink); if (x && !x.cancelled) notice(`Saved ${r.name}, and exported again: ${x.files.join(', ')}`, 2200); } catch (err) { hooks.showError(err); }
      }
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
        el('option', { value: 'unity', text: 'Unity: the sheet, its .meta (sprites, pivot, 9-slice) and an animation per tag' }),
        el('option', { value: 'paper2d', text: 'Unreal Paper2D: the sheet and its JSON' }),
        el('option', { value: 'frame', text: 'This frame (PNG)' }), el('option', { value: 'frames', text: 'Every frame (PNG files)' }));
      const form = el('select', { id: 'sp-ex-form', 'aria-label': 'JSON' }, el('option', { value: 'hash', text: 'frames by name (hash)' }), el('option', { value: 'array', text: 'a list of frames (array)' }));
      const scale = el('select', { id: 'sp-ex-scale', 'aria-label': 'Scale' }, ...[1, 2, 3, 4, 5, 6, 8, 10].map((n) => el('option', { value: String(n), text: `${n}×` })));
      const layout = el('select', { id: 'sp-ex-layout', 'aria-label': 'Layout' }, el('option', { value: 'row', text: 'a row' }), el('option', { value: 'column', text: 'a column' }), el('option', { value: 'grid', text: 'a grid' }), el('option', { value: 'packed', text: 'packed (trimmed, the same frames once)' }));
      const spacing = el('input', { type: 'number', min: '0', max: '64', value: '0', id: 'sp-ex-spacing', 'aria-label': 'Space between frames' });
      const hitboxes = el('input', { type: 'checkbox', id: 'sp-ex-hitboxes', checked: (doc.slices || []).some((sl) => sl.keys && sl.keys.length) || undefined });
      const ppu = el('input', { type: 'number', min: '1', max: '4096', value: String(doc.gridWidth || 16), id: 'sp-ex-ppu', 'aria-label': 'Pixels per unit (Unity)' });
      const tag = el('select', { id: 'sp-ex-tag', 'aria-label': 'Frames' }, el('option', { value: '', text: 'every frame' }), ...doc.tags.map((t, i) => el('option', { value: String(i), text: `tag “${t.name}”` })));
      const link = el('input', { type: 'checkbox', id: 'sp-ex-link', checked: doc.exportLink || undefined });
      const collision = el('input', { type: 'checkbox', id: 'sp-ex-collision' });
      const ctol = el('input', { type: 'number', min: '0', max: '8', step: '0.5', value: String(view.collisionTol), id: 'sp-ex-ctol', class: 'sb-num', 'aria-label': 'Collision shape: how closely it follows (pixels)' });
      const ok = async () => {
        const o = { kind: kind.value, tag: tag.value === '' ? null : Number(tag.value), scale: Number(scale.value), layout: layout.value, spacing: Number(spacing.value), form: form.value, hitboxes: hitboxes.checked, pixelsPerUnit: Number(ppu.value) || 16, collision: collision.checked, collisionTol: Math.max(0, Number(ctol.value) || 0) };
        closeIt();
        try {
          const r = await runExport({ ...o, link: link.checked && ['sheet', 'godot', 'unity', 'paper2d'].includes(o.kind) });
          if (r && !r.cancelled) {
            notice(`Exported ${r.files.join(', ')}`, 2600);
            if (link.checked && r.path) change('A live export', (d) => { d.exportLink = { ...o, path: r.path }; });
            else if (!link.checked && doc.exportLink) change('No live export', (d) => { delete d.exportLink; });
          }
        } catch (err) { hooks.showError(err); }
      };
      s.append(NoorUI.head('Export', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'What ', kind), el('label', {}, 'Frames ', tag), el('label', {}, 'Scale ', scale), el('label', {}, 'Sheet as ', layout), el('label', {}, 'Space between (px) ', spacing), el('label', {}, 'JSON ', form),
          el('label', { title: 'Godot: an Area2D for each slice, moved with the frames by an AnimationPlayer' }, hitboxes, ' slices as hitboxes (Godot)'), el('label', { title: 'Godot: a CollisionPolygon2D traced around the solid pixels of each frame (the biggest piece), changed with the frames by an AnimationPlayer' }, collision, ' collision shape (Godot), within ', ctol, ' px'),
          el('label', {}, 'Pixels per unit (Unity) ', ppu),
          el('label', { title: 'Each Ctrl+S exports here again the same way: point it into your Godot (or Unity) project and the engine picks the changes up' }, link, ' export here again on every save (a live link to a game project)'),
          el('p', { class: 'pref-hint', text: 'The JSON beside a sheet is in Aseprite\'s form (frames, durations, tags), which engines and libraries read.' })),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-ex-ok', onclick: ok }, 'Export…'))));
      if (doc.exportLink) { const L = doc.exportLink; kind.value = L.kind; scale.value = String(L.scale); layout.value = L.layout; spacing.value = String(L.spacing); form.value = L.form; hitboxes.checked = !!L.hitboxes; collision.checked = !!L.collision; ctol.value = String(L.collisionTol ?? 1); ppu.value = String(L.pixelsPerUnit || 16); tag.value = L.tag === null || L.tag === undefined ? '' : String(L.tag); }
    });
  }

  /** An export with these settings (from the dialog, or a live link's again: o.path skips the dialog). */
  async function runExport(o) {
    const t = o.tag === null || o.tag === undefined ? null : doc.tags[o.tag] || null;
    const which = o.kind === 'frame' ? [frame] : Array.from({ length: t ? t.to - t.from + 1 : doc.frames.length }, (_, i) => (t ? t.from : 0) + i);
    const frames = which.map((f) => ({ width: doc.width, height: doc.height, duration: doc.frames[f].duration, data: b64(new Uint8Array(compose(f, doc, null, true).buffer)) }));
    const tags = t ? [{ ...t, from: 0, to: t.to - t.from }] : doc.tags;
    const sounds = which.map((f, i) => (doc.frames[f].sound ? { frame: i, path: doc.frames[f].sound.path } : null)).filter(Boolean);
    const collision = o.collision && o.kind === 'godot' ? which.map((f) => collisionOf(compose(f, doc, null, true), doc.width, doc.height, o.collisionTol ?? 1)) : undefined;
    const normals = normalSettings().export && ['sheet', 'godot', 'unity'].includes(o.kind) ? which.map((f) => b64(new Uint8Array(normalMap(f).buffer))) : undefined;
    return req('sprite.export', { kind: o.kind, frames, sounds, normals, collision, scale: o.scale, layout: o.layout, spacing: o.spacing, form: o.form, hitboxes: o.hitboxes, pixelsPerUnit: o.pixelsPerUnit, path: o.path || null, link: !!o.link, name: (file ? file.name.replace(/\.[^.]+$/, '') : 'sprite') + (t ? `-${t.name}` : ''), tags,
      // One tag's frames start at 0: a moving slice's keys follow them.
      slices: (doc.slices || []).map((sl) => {
        if (!t || !(sl.keys && sl.keys.length)) return sl;
        const b = sliceAt(sl, t.from);
        return { ...sl, x: b.x, y: b.y, width: b.width, height: b.height, keys: [{ frame: 0, x: b.x, y: b.y, width: b.width, height: b.height }, ...sl.keys.filter((k) => k.frame > t.from && k.frame <= t.to).map((k) => ({ ...k, frame: k.frame - t.from }))] };
      }),
      layers: doc.layers.map((l) => ({ id: l.id, name: l.name, opacity: l.opacity, blend: l.blend, reference: !!l.reference, ...(isGroup(l) ? { kind: 'group' } : {}), ...(l.parent ? { parent: l.parent } : {}) })), ...(doc.indexed ? { palette: doc.palette } : {}) });
  }

  // ---------------------------------------------------------------- sharing: a GIF or a video, an atlas of many sprites

  const videoType = () => (window.MediaRecorder ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) : null);

  /** The frames played on a canvas and recorded (MediaRecorder): a video as a Blob, `plays` times through. */
  async function recordVideo(frames, scale, background, plays, mime) {
    const W = doc.width * scale, H = doc.height * scale, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const paint = (px) => { ctx.fillStyle = background; ctx.fillRect(0, 0, W, H); ctx.drawImage(pixelsToCanvas(px, doc.width, doc.height), 0, 0, W, H); };
    paint(frames[0].px);
    const stream = cv.captureStream(30), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 }), chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start(250);
    for (let p2 = 0; p2 < plays; p2++) for (const f of frames) { paint(f.px); await new Promise((r) => setTimeout(r, f.duration)); }
    rec.stop(); stream.getTracks().forEach((t) => t.stop());
    await done;
    return new Blob(chunks, { type: mime.split(';')[0] });
  }

  function shareDialog() {
    commitFloating();
    const vt = videoType(), longest = Math.max(doc.width, doc.height);
    NoorUI.modal({ label: 'Share', width: 420 }, (s2, closeIt) => {
      const fmt = el('select', { id: 'sp-sh-format', 'aria-label': 'As' }, el('option', { value: 'gif', text: 'an animated GIF' }), ...(vt ? [el('option', { value: 'video', text: vt.includes('mp4') ? 'a video (MP4)' : 'a video (WebM)' })] : []));
      const scale = el('input', { type: 'number', min: '1', max: '32', value: String(Math.max(1, Math.min(32, Math.floor(480 / longest) || 1))), id: 'sp-sh-scale', 'aria-label': 'Bigger by' });
      const clear = el('input', { type: 'checkbox', id: 'sp-sh-clear', checked: true });
      const bgc = el('input', { type: 'color', value: '#1d1f24', id: 'sp-sh-bg', 'aria-label': 'Background' });
      const plays = el('input', { type: 'number', min: '1', max: '20', value: '3', id: 'sp-sh-plays', 'aria-label': 'Times through (video)' });
      const tag = el('select', { id: 'sp-sh-tag', 'aria-label': 'Frames' }, el('option', { value: '', text: 'every frame' }), ...doc.tags.map((t, i) => el('option', { value: String(i), text: `tag “${t.name}”` })));
      const size = el('small', { class: 'pref-hint', id: 'sp-sh-size' });
      const showSize = () => { const k = Math.max(1, Number(scale.value) || 1); size.textContent = `${doc.width * k} × ${doc.height * k} pixels, every pixel a ${k} × ${k} square`; };
      scale.addEventListener('input', showSize); showSize();
      const ok = async () => {
        const k = Math.max(1, Math.min(32, Number(scale.value) || 1)), t = tag.value === '' ? null : doc.tags[Number(tag.value)];
        const order = t ? GODOT_ORDER(t) : doc.frames.map((_, i) => i);
        const bg = parseHex(bgc.value + 'ff'), fill = (px) => { if (fmt.value === 'gif' && clear.checked) return px; const o = new Uint8ClampedArray(px); for (let i = 0; i < o.length; i += 4) { const a = o[i + 3] / 255; for (let c = 0; c < 3; c++) o[i + c] = Math.round(o[i + c] * a + bg[c] * (1 - a)); o[i + 3] = 255; } return o; };
        const frames = order.map((f) => ({ px: fill(compose(f, doc, null, true)), duration: doc.frames[f].duration }));
        const name = (file ? file.name.replace(/\.[^.]+$/, '') : 'sprite') + (t ? `-${t.name}` : '');
        closeIt();
        try {
          if (fmt.value === 'gif') {
            const r = await req('sprite.export', { kind: 'gif', frames: frames.map((f) => ({ width: doc.width, height: doc.height, duration: f.duration, data: b64(new Uint8Array(f.px.buffer)) })), scale: Math.min(10, k) === k ? k : 10, name, tags: [], slices: [], layers: [] });
            if (r && !r.cancelled) notice(`Shared as ${r.files.join(', ')}`, 2400);
            return;
          }
          notice('Recording the video (it plays through as it records)…', 2000);
          const blob = await recordVideo(frames, k, bgc.value, Math.max(1, Math.min(20, Number(plays.value) || 1)), vt);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const r = await req('sprite.video.save', { data: b64(bytes), ext: vt.includes('mp4') ? '.mp4' : '.webm', name });
          if (r && !r.cancelled) notice(`Shared as ${r.files.join(', ')}`, 2400);
        } catch (err) { hooks.showError(err); }
      };
      s2.append(NoorUI.head('Share', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: 'Bigger by whole steps (sharp pixels), for a post or a message.' }),
          el('label', {}, 'As ', fmt), el('label', {}, 'Frames ', tag), el('label', {}, 'Bigger by ', scale), size, el('label', {}, clear, ' see-through (a GIF; else this background) '), el('label', {}, 'Background ', bgc), el('label', {}, 'Times through (a video) ', plays)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-sh-ok', onclick: ok }, 'Share…'))));
    });
  }

  /** A tag's frames in the order it plays (reverse turned round, ping-pong there and back). */
  function GODOT_ORDER(t) {
    const run = Array.from({ length: t.to - t.from + 1 }, (_, i) => t.from + i);
    if (t.direction === 'reverse') run.reverse();
    else if (t.direction === 'pingpong' && run.length > 2) run.push(...run.slice(1, -1).reverse());
    return run;
  }

  async function packAtlas() {
    try {
      const r = await req('sprite.atlas.pack');
      if (!r || r.cancelled) return;
      notice(`An atlas of ${r.frames} frames: ${r.files.join(', ')}${r.skipped && r.skipped.length ? ` (couldn't read: ${r.skipped.join(', ')})` : ''}`, 3200);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- a sound to animate to

  // doc.audio = { path, name, offset (ms) }: a sound under the timeline, its waveform in each frame's cell, played
  // with the animation (from the frame it starts at).
  let audio = { path: null, buffer: null, ctx: null, source: null, loading: false };

  async function loadAudio() {
    if (!doc.audio || audio.loading || (audio.path === doc.audio.path && audio.buffer)) return;
    audio.loading = true;
    try {
      const r = await req('sprite.audio.load', { path: doc.audio.path });
      audio.ctx = audio.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const bytes = unb64(r.data);
      audio.buffer = await audio.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      audio.path = doc.audio.path;
      renderTimeline();
    } catch (err) { notice(`The sound couldn't be read: ${err.message || err}`, 2400); } finally { audio.loading = false; }
  }

  async function pickAudio() {
    try {
      const r = await req('sprite.sound.pick');
      if (!r || r.cancelled) return;
      change('A sound to animate to', (d) => { d.audio = { path: r.path, name: r.name, offset: 0 }; });
      audio.buffer = null; await loadAudio();
    } catch (err) { hooks.showError(err); }
  }

  const frameStart = (f) => doc.frames.slice(0, f).reduce((n, fr) => n + fr.duration, 0);

  /** The loudness of the sound over a time (ms), 0–1 in `n` steps: a frame's piece of the waveform. */
  function peaks(fromMs, toMs, n) {
    const b = audio.buffer, out = new Float32Array(n);
    if (!b) return out;
    const ch = b.getChannelData(0), sr = b.sampleRate, off = (doc.audio.offset || 0) / 1000;
    for (let i = 0; i < n; i++) {
      const a = Math.floor((fromMs / 1000 + off + ((toMs - fromMs) / 1000) * (i / n)) * sr), z = Math.floor((fromMs / 1000 + off + ((toMs - fromMs) / 1000) * ((i + 1) / n)) * sr);
      let m = 0;
      for (let k = Math.max(0, a); k < Math.min(ch.length, z); k++) m = Math.max(m, Math.abs(ch[k]));
      out[i] = m;
    }
    return out;
  }

  function waveCell(f) {
    const cv = el('canvas', { width: '26', height: '22', class: 'sp-wave', 'aria-hidden': 'true' }), ctx = cv.getContext('2d');
    const t0 = frameStart(f), pk = peaks(t0, t0 + doc.frames[f].duration, 26);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent') || '#7c6cf0';
    for (let i = 0; i < 26; i++) { const h = Math.max(1, pk[i] * 20); ctx.fillRect(i, 11 - h / 2, 1, h); }
    return cv;
  }

  function audioStart(f) {
    audioStop();
    if (!audio.buffer || !audio.ctx || !doc.audio) return;
    const at = (frameStart(f) + (doc.audio.offset || 0)) / 1000;
    if (at >= audio.buffer.duration) return;
    const src = audio.ctx.createBufferSource();
    src.buffer = audio.buffer; src.connect(audio.ctx.destination);
    try { src.start(0, Math.max(0, at)); audio.source = src; } catch { /* not playable now */ }
  }
  function audioStop() { if (audio.source) { try { audio.source.stop(); } catch { /* stopped */ } audio.source = null; } }

  // ---------------------------------------------------------------- a bitmap font

  const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
  const fontSettings = () => ({ characters: ASCII, cellWidth: doc.gridWidth || 8, cellHeight: doc.gridHeight || 8, proportional: true, spacing: 1, baseline: 0, ...(doc.font || {}) });

  function fontDialog() {
    const f0 = fontSettings();
    NoorUI.modal({ label: 'Bitmap font', width: 460 }, (s2, closeIt) => {
      const chars = el('textarea', { id: 'sp-font-chars', rows: '3', 'aria-label': 'Characters, in the cells\' order' }); chars.value = f0.characters;
      const cw = el('input', { type: 'number', min: '1', max: '256', value: String(f0.cellWidth), id: 'sp-font-cw', 'aria-label': 'Cell width' });
      const ch = el('input', { type: 'number', min: '1', max: '256', value: String(f0.cellHeight), id: 'sp-font-ch', 'aria-label': 'Cell height' });
      const prop = el('input', { type: 'checkbox', id: 'sp-font-prop', checked: f0.proportional || undefined });
      const spacing = el('input', { type: 'number', min: '0', max: '16', value: String(f0.spacing), id: 'sp-font-spacing', 'aria-label': 'Space after each letter' });
      const guide = el('input', { type: 'checkbox', id: 'sp-font-guide', checked: view.fontGuide || undefined });
      const settings = () => ({ characters: chars.value || ASCII, cellWidth: Math.max(1, Number(cw.value) || 8), cellHeight: Math.max(1, Number(ch.value) || 8), proportional: prop.checked, spacing: Math.max(0, Number(spacing.value) || 0), baseline: 0 });
      const keep = () => { const v = settings(); change('Bitmap font', (d) => { d.font = v; }); view.fontGuide = guide.checked; draw(); };
      s2.append(NoorUI.head('Bitmap font', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: 'Draw a letter in each cell of the grid, in this order (left to right, row by row). Exported as a BMFont (.fnt) with its picture — Godot and most engines read it.' }),
          el('label', {}, 'Characters ', chars), el('label', {}, 'Cells ', cw, ' × ', ch), el('label', {}, prop, ' each letter as wide as drawn'), el('label', {}, 'Space after each (px) ', spacing),
          el('label', {}, guide, ' show each cell\'s letter while drawing')),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action', id: 'sp-font-keep', onclick: () => { keep(); closeIt(); } }, 'Keep'),
          el('button', { class: 'action primary', id: 'sp-font-ok', onclick: async () => {
            keep(); closeIt();
            try {
              const r = await req('sprite.font.export', { width: doc.width, height: doc.height, data: b64(new Uint8Array(compose(frame, doc, null, true).buffer)), font: settings(), name: file ? file.name.replace(/\.[^.]+$/, '') : 'font' });
              if (r && !r.cancelled) notice(`Exported ${r.files.join(', ')} (${r.glyphs} letters)`, 2400);
            } catch (err) { hooks.showError(err); }
          } }, 'Export…'))));
    });
  }

  function drawFontGuide(ctx, o, z) {
    if (!view.fontGuide) return;
    const f = fontSettings(), cols = Math.max(1, Math.floor(doc.width / f.cellWidth)), chars = [...f.characters];
    ctx.save(); ctx.fillStyle = 'rgba(120,140,255,0.55)'; ctx.font = `${Math.max(9, Math.min(f.cellHeight * z * 0.6, 28))}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(120,140,255,0.35)';
    chars.forEach((c, i) => {
      const x = (i % cols) * f.cellWidth, y = Math.floor(i / cols) * f.cellHeight;
      if (y + f.cellHeight > doc.height) return;
      ctx.strokeRect(o.x + x * z + 0.5, o.y + y * z + 0.5, f.cellWidth * z - 1, f.cellHeight * z - 1);
      ctx.fillText(c === ' ' ? '␣' : c, o.x + (x + f.cellWidth / 2) * z, o.y + (y + f.cellHeight / 2) * z);
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- clean-up passes, a picture made pixel art

  /** Lone pixels (drawn, but nothing drawn round them) taken out, in the selection or the layer. */
  function removeLonePixels() {
    const c = cel();
    if (!c) return;
    const W = doc.width, H = doc.height, on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && c.px[(y * W + x) * 4 + 3] > 0, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!on(x, y) || (selection && !selection.mask[y * W + x])) continue;
      let alone = true;
      for (let dy = -1; dy <= 1 && alone; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && on(x + dx, y + dy)) { alone = false; break; }
      if (alone) list.push(y * W + x);
    }
    if (!list.length) { notice('No lone pixels on this layer and frame', 1400); return; }
    change('Lone pixels out', (d) => { const px = editable(d); for (const i of list) px.fill(0, i * 4, i * 4 + 4); });
    notice(`${list.length} lone pixel${list.length === 1 ? '' : 's'} taken out`, 1400);
  }

  /** Median cut: at most n colours that stand for these (RGB; alpha kept apart). */
  function medianCut(colours, n) {
    let boxes = [colours];
    while (boxes.length < n) {
      let bi = -1, bestRange = -1, bestCh = 0;
      boxes.forEach((b, i) => { if (b.length < 2) return; for (let ch = 0; ch < 3; ch++) { let lo = 255, hi = 0; for (const c of b) { lo = Math.min(lo, c[ch]); hi = Math.max(hi, c[ch]); } if (hi - lo > bestRange) { bestRange = hi - lo; bi = i; bestCh = ch; } } });
      if (bi < 0 || bestRange <= 0) break;
      const b = boxes[bi].slice().sort((p2, q) => p2[bestCh] - q[bestCh]), m = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
    }
    return boxes.map((b) => [0, 1, 2].map((ch) => Math.round(b.reduce((sum, c) => sum + c[ch], 0) / b.length)).concat([255]));
  }

  const nearestOf = (pal, r, g, b) => { let best = pal[0], bd = Infinity; for (const p2 of pal) { const dd = palDist(p2, r, g, b, 255); if (dd < bd) { bd = dd; best = p2; } } return best; };

  /** The selection's (or layer's) colours brought down to n. */
  async function reduceColours() {
    const v = await NoorUI.prompt('Fewer colours', 'Bring the colours down to (in the selection, or the layer on this frame):', '8', { type: 'number', okLabel: 'Reduce' });
    const n = Math.max(2, Math.min(256, Math.round(Number(v) || 0)));
    if (!v) return;
    const c = cel();
    if (!c) return;
    const W = doc.width, idx = [];
    for (let i = 0; i < W * doc.height; i++) if (c.px[i * 4 + 3] && (!selection || selection.mask[i])) idx.push(i);
    const pal = medianCut(idx.map((i) => [c.px[i * 4], c.px[i * 4 + 1], c.px[i * 4 + 2]]), n);
    change('Fewer colours', (d) => { const px = editable(d); for (const i of idx) { const q = nearestOf(pal, px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); px[i * 4] = q[0]; px[i * 4 + 1] = q[1]; px[i * 4 + 2] = q[2]; } });
  }

  /**
   * A picture made a pixel-art sketch: shrunk into the sprite (each pixel the average of what it covers), its colours
   * the palette's (or a few of its own), on a new layer — a start to draw over, not the drawing.
   */
  async function pictureToPixels() {
    try {
      const r = await req('sprite.picture.pick');
      if (!r || r.cancelled) return;
      const im = r.image, src = unb64(im.data), W = doc.width, H = doc.height, k = Math.min(W / im.width, H / im.height);
      const w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k)), ox = Math.floor((W - w) / 2), oy = Math.floor((H - h) / 2);
      const small = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.floor((x + 1) / k)), y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.floor((y + 1) / k));
        let rr = 0, gg = 0, bb = 0, aa = 0, n = 0;
        for (let sy = y0; sy < Math.min(y1, im.height); sy++) for (let sx = x0; sx < Math.min(x1, im.width); sx++) { const o = (sy * im.width + sx) * 4, al = src[o + 3]; rr += src[o] * al; gg += src[o + 1] * al; bb += src[o + 2] * al; aa += al; n++; }
        small.push(aa ? [rr / aa, gg / aa, bb / aa, aa / n] : [0, 0, 0, 0]);
      }
      const solid = small.filter((c) => c[3] >= 128);
      const pal = doc.palette.length >= 2 ? doc.palette.map(parseHex) : medianCut(solid.map((c) => c.slice(0, 3)), 16);
      change('A picture as pixels', (d) => {
        const id = newId(), px = new Uint8ClampedArray(W * H * 4);
        small.forEach((c, i) => { if (c[3] < 128) return; const q = nearestOf(pal, c[0], c[1], c[2]); const x = i % w, y = (i - x) / w; px.set([q[0], q[1], q[2], 255], ((oy + y) * W + ox + x) * 4); });
        d.layers.splice(layer + 1, 0, { id, name: `${r.name || 'Picture'} (pixels)`, visible: true, locked: false, opacity: 255, blend: 'normal' });
        d.cels.set(key(id, frame), { px, opacity: 255 });
        layer++;
      });
      notice(doc.palette.length >= 2 ? 'In the palette\'s colours: a start to draw over' : 'In 16 colours of its own: a start to draw over', 2000);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- line clean-up, a live outline, motion

  /**
   * Doubled corners in one-pixel lines (jaggies): a pixel joining two others that touch at a corner, making an L —
   * the pixel pixel-perfect drawing leaves out. Returns their indices.
   */
  function jaggies(px, W, H) {
    // Found one at a time, each left out before looking on (two corners of one step are one jaggy, not two).
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = px[i * 4 + 3] > 0 ? 1 : 0;
    const out = [], on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      let n8 = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && on(x + dx, y + dy)) n8++;
      if (n8 < 2 || n8 > 3) continue; // a thin line only
      // A neighbour across and one up or down, touching each other at a corner: this pixel doubles the corner.
      for (const [hx, vy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (on(x + hx, y) && on(x, y + vy) && !on(x + hx, y + vy)) { out.push(y * W + x); mask[y * W + x] = 0; break; }
    }
    return out;
  }

  function cleanJaggies() {
    const c = cel();
    if (!c) return;
    const list = jaggies(c.px, doc.width, doc.height).filter((i) => !selection || selection.mask[i]);
    if (!list.length) { notice('No doubled corners on this layer and frame', 1400); return; }
    change('Clean doubled corners', (d) => { const px = editable(d); for (const i of list) px.fill(0, i * 4, i * 4 + 4); });
    notice(`${list.length} doubled corner${list.length === 1 ? '' : 's'} taken out`, 1400);
  }

  // A live outline: a layer drawn with an outline round it (or on its edge) wherever it is shown or exported,
  // without changing its pixels — draw on, and the outline follows.
  const outlineCache = new WeakMap();
  function outlined(px, W, H, o) {
    const k = `${o.color}|${o.where}|${o.eight}`;
    let m = outlineCache.get(px);
    if (m && m.has(k)) return m.get(k);
    const c = parseHex(o.color), out = new Uint8ClampedArray(px), solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] > 0;
    const nb = o.eight ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const me = solid(x, y);
      if (o.where === 'inside' ? me && nb.some(([dx, dy]) => !solid(x + dx, y + dy)) : !me && nb.some(([dx, dy]) => solid(x + dx, y + dy))) out.set(c, (y * W + x) * 4);
    }
    if (!m) { m = new Map(); outlineCache.set(px, m); }
    m.set(k, out);
    return out;
  }

  // Motion templates: offsets that make a layer bob, breathe, jump, shake, float or sway over frames.
  const MOTIONS = {
    bob: ['bob (a walk\'s up and down, twice a cycle)', (t, A) => [0, -Math.round((A * (1 - Math.cos(4 * Math.PI * t))) / 2)]],
    breathe: ['breathe (a slow rise and fall)', (t, A) => [0, -Math.round((A * (1 - Math.cos(2 * Math.PI * t))) / 2)]],
    jump: ['jump (an arc up and down)', (t, A, last) => [0, -Math.round(A * 4 * last * (1 - last))]],
    float: ['float (up and down, smoothly)', (t, A) => [0, Math.round(A * Math.sin(2 * Math.PI * t))]],
    sway: ['sway (side to side)', (t, A) => [Math.round(A * Math.sin(2 * Math.PI * t)), 0]],
    shake: ['shake (a hit)', (t, A, last, i) => (i === 0 || last >= 1 ? [0, 0] : [((i * 7919) % (2 * A + 1)) - A, ((i * 104729) % (2 * A + 1)) - A])],
  };

  function motionDialog() {
    NoorUI.modal({ label: 'Motion', width: 420 }, (s2, closeIt) => {
      const kind = el('select', { id: 'sp-mo-kind', 'aria-label': 'Motion' }, ...Object.entries(MOTIONS).map(([v, [l]]) => el('option', { value: v, text: l })));
      const amount = el('input', { type: 'number', min: '1', max: '64', value: '2', id: 'sp-mo-amount', 'aria-label': 'How far (pixels)' });
      const which = el('select', { id: 'sp-mo-frames', 'aria-label': 'Frames' }, el('option', { value: '', text: 'every frame' }), ...doc.tags.map((t, i) => el('option', { value: String(i), text: `tag “${t.name}”` })));
      s2.append(NoorUI.head('Motion', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: `The layer “${doc.layers[layer].name}” moves over the frames (its pictures shifted, one undo). With in-betweens and bones, a rough animation in a few clicks.` }),
          el('label', {}, 'Motion ', kind), el('label', {}, 'How far (px) ', amount), el('label', {}, 'Frames ', which)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'sp-mo-ok', onclick: () => { closeIt(); applyMotion(kind.value, Math.max(1, Math.min(64, Number(amount.value) || 2)), which.value === '' ? null : doc.tags[Number(which.value)]); } }, 'Move it'))));
    });
  }

  function applyMotion(kind, A, tag) {
    const f0 = tag ? tag.from : 0, f1 = tag ? tag.to : doc.frames.length - 1, n = f1 - f0 + 1, fn = MOTIONS[kind][1], lid = doc.layers[layer].id, W = doc.width, H = doc.height;
    if (n < 2) { notice('A motion needs two frames or more', 1400); return; }
    change(`Motion: ${kind}`, (d) => {
      for (let i = 0; i < n; i++) {
        const k = key(lid, f0 + i), c = d.cels.get(k);
        if (!c) continue;
        const [dx, dy] = fn(i / n, A, i / (n - 1), i);
        if (!dx && !dy) continue;
        const { link, ...plain } = c; void link;
        d.cels.set(k, { ...plain, px: shifted(c.px, W, H, dx, dy) });
      }
    });
  }

  // ---------------------------------------------------------------- normal maps

  // A normal map says which way each pixel faces, so a game's 2D lights shade the sprite. NoorSprite makes one from
  // the shape (edges round over `bevel` pixels, optionally bumped by brightness); a "normals" layer paints over it
  // where you want (its pixels are normal colours, never exported as colour).
  const normalSettings = (d = doc) => ({ bevel: 3, strength: 2, brightness: 0, export: false, ...(d.normals || {}) });

  /** A frame's normal map (RGBA; clear where the sprite is clear), OpenGL style: green is up. */
  function normalMap(f, d = doc) {
    const W = d.width, H = d.height, ns = normalSettings(d), col = compose(f, d, null, true), n = W * H;
    const dist = new Float32Array(n).fill(-1), queue = [];
    const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && col[(y * W + x) * 4 + 3] > 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (solid(x, y) && (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))) { dist[y * W + x] = 0; queue.push(y * W + x); }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % W, y = (i - x) / W;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (solid(nx, ny) && dist[ny * W + nx] < 0) { dist[ny * W + nx] = dist[i] + 1; queue.push(ny * W + nx); }
    }
    // Height: rising over the bevel from the edge (a rounded rim), plus brightness if asked.
    const h = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (dist[i] < 0) continue;
      const t = Math.min(1, (dist[i] + 0.5) / Math.max(1, ns.bevel));
      const lum = (0.299 * col[i * 4] + 0.587 * col[i * 4 + 1] + 0.114 * col[i * 4 + 2]) / 255;
      h[i] = Math.sin((t * Math.PI) / 2) + ns.brightness * (lum - 0.5);
    }
    const H2 = (x, y) => (solid(x, y) ? h[y * W + x] : 0), out = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (dist[i] < 0) continue;
      let nx = -(H2(x + 1, y) - H2(x - 1, y)) * ns.strength, ny = (H2(x, y + 1) - H2(x, y - 1)) * ns.strength, nz = 1;
      const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
      out.set([Math.round((nx * 0.5 + 0.5) * 255), Math.round((ny * 0.5 + 0.5) * 255), Math.round((nz * 0.5 + 0.5) * 255), 255], i * 4);
    }
    // Painted normals win where they are.
    d.layers.forEach((l) => {
      if (!l.normals || !shown(d, l)) return;
      const c = d.cels.get(key(l.id, f));
      if (!c) return;
      for (let i = 0; i < n; i++) if (c.px[i * 4 + 3] && col[i * 4 + 3]) out.set([c.px[i * 4], c.px[i * 4 + 1], c.px[i * 4 + 2], 255], i * 4);
    });
    return out;
  }

  /** The frame lit by a light at the cursor (above the sprite), from its normal map: to see what a game will. */
  function litView(shownPx) {
    const W = doc.width, H = doc.height, nm = normalMap(frame), out = new Uint8ClampedArray(shownPx);
    const lx = hover ? hover.x + 0.5 : W * 0.25, ly = hover ? hover.y + 0.5 : H * 0.25, lz = Math.max(W, H) * 0.35;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!nm[i + 3]) continue;
      const nx = nm[i] / 127.5 - 1, nyUp = nm[i + 1] / 127.5 - 1, nz = nm[i + 2] / 127.5 - 1;
      let dx = lx - (x + 0.5), dyUp = (y + 0.5) - ly, dz = lz; const L = Math.hypot(dx, dyUp, dz); dx /= L; dyUp /= L; dz /= L;
      const k = 0.3 + 0.9 * Math.max(0, nx * dx + nyUp * dyUp + nz * dz);
      for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, shownPx[i + c] * k);
    }
    return out;
  }

  /** The nine normal colours (flat, and facing each way) for painting a normals layer. */
  const NORMAL_SWATCHES = [['flat', 0, 0], ['up', 0, 1], ['up right', 1, 1], ['right', 1, 0], ['down right', 1, -1], ['down', 0, -1], ['down left', -1, -1], ['left', -1, 0], ['up left', -1, 1]].map(([name, x, y]) => {
    const tilt = 0.6, nx = x * tilt / Math.hypot(x || 1e-9, y || 1e-9) * (x || y ? 1 : 0), ny = y * tilt / Math.hypot(x || 1e-9, y || 1e-9) * (x || y ? 1 : 0), nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    return [name, [Math.round((nx * 0.5 + 0.5) * 255), Math.round((ny * 0.5 + 0.5) * 255), Math.round((nz * 0.5 + 0.5) * 255), 255]];
  });

  function normalsDialog() {
    const ns = normalSettings();
    NoorUI.modal({ label: 'Normal maps', width: 420 }, (s2, closeIt) => {
      const bevel = el('input', { type: 'number', min: '1', max: '16', value: String(ns.bevel), id: 'sp-nm-bevel', 'aria-label': 'Rounded over (pixels)' });
      const strength = el('input', { type: 'number', min: '0.2', max: '8', step: '0.1', value: String(ns.strength), id: 'sp-nm-strength', 'aria-label': 'Strength' });
      const bright = el('input', { type: 'number', min: '0', max: '2', step: '0.1', value: String(ns.brightness), id: 'sp-nm-bright', 'aria-label': 'Bumps from brightness' });
      const exp = el('input', { type: 'checkbox', id: 'sp-nm-export', checked: ns.export || undefined });
      s2.append(NoorUI.head('Normal maps', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: 'Made from the sprite\'s shape: its edges round over a few pixels. A "normals" layer (in the layer\'s settings) paints over it where you want. View › lit shows it with a light at the cursor.' }),
          el('label', {}, 'Edges rounded over (px) ', bevel), el('label', {}, 'Strength ', strength), el('label', {}, 'Bumps from brightness ', bright),
          el('label', {}, exp, ' export a normal map with sheets (…_n.png; Godot and Unity use it)')),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'sp-nm-ok', onclick: () => { const v = { bevel: Math.max(1, Math.min(16, Number(bevel.value) || 3)), strength: Math.max(0.2, Math.min(8, Number(strength.value) || 2)), brightness: Math.max(0, Math.min(2, Number(bright.value) || 0)), export: exp.checked }; closeIt(); change('Normal maps', (d) => { d.normals = v; }); } }, 'OK'))));
    });
  }

  // ---------------------------------------------------------------- bones (cutout animation)

  // A skeleton: bones { id, name, parent, x, y (the pivot), tipX, tipY } at rest. A layer can move with a bone: its
  // picture on frame 1 (the rest pose) is turned (crisply, RotSprite) and moved on every other frame as that frame's
  // pose says — frames[f].pose[boneId] = { a (degrees, clockwise), dx, dy } — with its parents carrying it along.
  let boneSel = -1;
  const bones = (d = doc) => d.bones || [];
  const bigCache = new WeakMap(); // a rest picture grown 8× once (RotSprite's first step), for every frame's turn

  /** Where a bone puts things on frame f: a turn by `a` and a move, as { a, c, s, tx, ty } (p → R(a)p + t). */
  function boneWorld(d, id, f, depth = 0) {
    const b = bones(d).find((x) => x.id === id);
    if (!b || depth > 64) return { a: 0, c: 1, s: 0, tx: 0, ty: 0 };
    const pose = (d.frames[f] && d.frames[f].pose && d.frames[f].pose[id]) || { a: 0, dx: 0, dy: 0 };
    const r = (pose.a * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
    // Local: turned about its pivot, then moved.
    const local = { a: pose.a, c, s: sn, tx: b.x - (c * b.x - sn * b.y) + (pose.dx || 0), ty: b.y - (sn * b.x + c * b.y) + (pose.dy || 0) };
    if (!b.parent) return local;
    const P = boneWorld(d, b.parent, f, depth + 1);
    return { a: P.a + local.a, c: P.c * local.c - P.s * local.s, s: P.s * local.c + P.c * local.s, tx: P.c * local.tx - P.s * local.ty + P.tx, ty: P.s * local.tx + P.c * local.ty + P.ty };
  }
  const apply = (T, x, y) => [T.c * x - T.s * y + T.tx, T.s * x + T.c * y + T.ty];

  /** A layer's rest picture posed as its bone is on frame f. */
  function posedPicture(d, l, f, rest) {
    const b = bones(d).find((x) => x.id === l.bone), T = boneWorld(d, l.bone, f), W = d.width, H = d.height;
    const [px2, py2] = apply(T, b.x, b.y), mx = Math.round(px2 - b.x), my = Math.round(py2 - b.y);
    const turn = ((T.a % 360) + 360) % 360;
    let pic = rest;
    if (Math.abs(turn) > 0.01 && Math.abs(turn - 360) > 0.01) {
      let big = bigCache.get(rest);
      if (!big) { let g = rest, bw = W, bh = H; for (let k = 0; k < 3; k++) { g = scaleXBR(g, bw, bh, 2); bw *= 2; bh *= 2; } big = g; bigCache.set(rest, big); }
      pic = turnBig(big, W, H, T.a, b.x + 0.5, b.y + 0.5);
    }
    return mx || my ? shifted(pic, W, H, mx, my) : pic;
  }

  /** RotSprite's turn from a picture already grown 8×. */
  function turnBig(big, w, h, degrees, cx, cy) {
    const a = (-degrees * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), bw = w * 8, bh = h * 8, o = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, ix = Math.floor((cx + dx * ca - dy * sa) * 8), iy = Math.floor((cy + dx * sa + dy * ca) * 8);
      if (ix < 0 || iy < 0 || ix >= bw || iy >= bh) continue;
      o.set(big.subarray((iy * bw + ix) * 4, (iy * bw + ix) * 4 + 4), (y * w + x) * 4);
    }
    return o;
  }

  /**
   * After a change: layers that move with bones are posed again where something they hang on changed — their rest
   * picture (frame 1: every frame), a frame's pose (that frame), the bones (every frame).
   */
  function normalizeBones(d, prev) {
    const boned = d.layers.filter((l) => l.bone && !isGroup(l) && bones(d).some((b) => b.id === l.bone));
    if (!boned.length) return;
    const allFrames = !prev || prev.bones !== d.bones;
    for (const l of boned) {
      const rest = d.cels.get(key(l.id, 0)), prevRest = prev && prev.cels.get(key(l.id, 0)), prevL = prev && prev.layers.find((x) => x.id === l.id);
      const restChanged = allFrames || !prevL || prevL.bone !== l.bone || (rest && rest.px) !== (prevRest && prevRest.px);
      for (let f = 1; f < d.frames.length; f++) {
        if (!restChanged && prev && prev.frames[f] && prev.frames[f].pose === d.frames[f].pose) continue;
        if (!rest) { d.cels.delete(key(l.id, f)); continue; }
        d.cels.set(key(l.id, f), { px: posedPicture(d, l, f, rest.px), opacity: rest.opacity });
      }
    }
  }

  /** A bone's pivot and tip as posed on frame f. */
  function bonePosed(d, b, f) {
    const P = b.parent ? boneWorld(d, b.parent, f) : { c: 1, s: 0, tx: 0, ty: 0 };
    const T = boneWorld(d, b.id, f);
    const pose = (d.frames[f] && d.frames[f].pose && d.frames[f].pose[b.id]) || { dx: 0, dy: 0 };
    const pv = apply(P, b.x + (pose.dx || 0), b.y + (pose.dy || 0));
    return { pivot: pv, tip: apply(T, b.tipX, b.tipY) };
  }

  function drawBones(ctx, o, z) {
    if (tool !== 'bone' && !view.bones) return;
    ctx.save();
    bones().forEach((b, i) => {
      const { pivot, tip } = bonePosed(doc, b, frame), X = (p2) => o.x + (p2[0] + 0.5) * z, Y = (p2) => o.y + (p2[1] + 0.5) * z;
      ctx.lineWidth = i === boneSel ? 4 : 2.5; ctx.strokeStyle = i === boneSel ? '#ffd23c' : 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.moveTo(X(pivot), Y(pivot)); ctx.lineTo(X(tip), Y(tip)); ctx.stroke();
      ctx.fillStyle = i === boneSel ? '#ffd23c' : '#fff'; ctx.beginPath(); ctx.arc(X(pivot), Y(pivot), 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(X(tip), Y(tip), 3, 0, Math.PI * 2); ctx.fill();
    });
    if (drag && drag.kind === 'bone-new') { ctx.strokeStyle = '#ffd23c'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(o.x + (drag.from[0] + 0.5) * z, o.y + (drag.from[1] + 0.5) * z); ctx.lineTo(o.x + (drag.to[0] + 0.5) * z, o.y + (drag.to[1] + 0.5) * z); ctx.stroke(); }
    ctx.restore();
  }

  /** The bone under a point (its pivot, tip or along it), as posed on this frame; -1 for none. */
  function boneAt(p) {
    let best = -1, bd = 1.6;
    bones().forEach((b, i) => {
      const { pivot, tip } = bonePosed(doc, b, frame), vx = tip[0] - pivot[0], vy = tip[1] - pivot[1], L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((p.fx - 0.5 - pivot[0]) * vx + (p.fy - 0.5 - pivot[1]) * vy) / L2));
      const dd = Math.hypot(p.fx - 0.5 - (pivot[0] + vx * t), p.fy - 0.5 - (pivot[1] + vy * t));
      if (dd < bd) { bd = dd; best = i; }
    });
    return best;
  }

  /** The bone tool: on frame 1 drag a new bone (from its tip, a child of it); elsewhere drag a bone to turn it (Shift: move). */
  function boneDown(p, e) {
    const hit = boneAt(p);
    if (frame === 0) {
      if (hit >= 0 && !e.altKey) {
        // A bone's tip starts a child; elsewhere on it, choose it.
        const b = bones()[hit];
        if (Math.hypot(p.fx - 0.5 - b.tipX, p.fy - 0.5 - b.tipY) > 1.5) { boneSel = hit; renderBonePanel(); draw(); return; }
        drag = { kind: 'bone-new', from: [b.tipX, b.tipY], to: [p.x, p.y], parent: b.id };
        return;
      }
      drag = { kind: 'bone-new', from: [p.x, p.y], to: [p.x, p.y], parent: boneSel >= 0 && e.shiftKey ? bones()[boneSel].id : null };
      return;
    }
    if (hit < 0) { notice('Bones are made on frame 1 (the rest pose); on other frames drag one to pose it', 2200); return; }
    boneSel = hit; renderBonePanel();
    const b = bones()[hit], { pivot } = bonePosed(doc, b, frame), pose = (doc.frames[frame].pose && doc.frames[frame].pose[b.id]) || { a: 0, dx: 0, dy: 0 };
    drag = { kind: 'bone-pose', bone: b.id, pivot, start: Math.atan2(p.fy - 0.5 - pivot[1], p.fx - 0.5 - pivot[0]), from: [p.fx, p.fy], pose: { ...pose }, move: e.shiftKey, now: { ...pose } };
  }

  function boneMove(p) {
    if (drag.kind === 'bone-new') { drag.to = [p.x, p.y]; draw(); return; }
    const d0 = drag;
    if (d0.move) d0.now = { ...d0.pose, dx: Math.round(d0.pose.dx + p.fx - d0.from[0]), dy: Math.round(d0.pose.dy + p.fy - d0.from[1]) };
    else d0.now = { ...d0.pose, a: Math.round(d0.pose.a + ((Math.atan2(p.fy - 0.5 - d0.pivot[1], p.fx - 0.5 - d0.pivot[0]) - d0.start) * 180) / Math.PI) };
    // Shown as it goes: the bones at once (the pictures when let go).
    const keep = doc.frames[frame].pose;
    doc.frames[frame].pose = { ...(keep || {}), [d0.bone]: d0.now };
    draw();
    doc.frames[frame].pose = keep;
  }

  function boneUp(d0) {
    if (d0.kind === 'bone-new') {
      const [x0, y0] = d0.from, [x1, y1] = d0.to;
      if (x0 === x1 && y0 === y1) { boneSel = -1; renderBonePanel(); draw(); return; }
      change('New bone', (d) => { d.bones = [...bones(d), { id: 'B' + Math.random().toString(36).slice(2, 9), name: `Bone ${bones(d).length + 1}`, parent: d0.parent, x: x0, y: y0, tipX: x1, tipY: y1 }]; });
      boneSel = bones().length - 1; renderBonePanel();
      return;
    }
    if (d0.now.a !== d0.pose.a || d0.now.dx !== d0.pose.dx || d0.now.dy !== d0.pose.dy) setPose(d0.bone, d0.now); else draw();
  }

  function setPose(boneId, pose) {
    change('Pose', (d) => { d.frames[frame] = { ...d.frames[frame], pose: { ...(d.frames[frame].pose || {}), [boneId]: { a: pose.a || 0, dx: pose.dx || 0, dy: pose.dy || 0 } } }; });
  }

  /** The chosen bone: its name, parent, the layers that move with it, and its pose on this frame. */
  function renderBonePanel() {
    let box = $('#sp-bonepanel');
    if (!box) { box = el('div', { class: 'sp-slicepanel', id: 'sp-bonepanel' }); $('#sp-layerprops').before(box); }
    box.hidden = tool !== 'bone';
    if (box.hidden) return;
    const b = bones()[boneSel];
    if (!b) { box.replaceChildren(el('h4', { class: 'music-subhead', text: 'Bones' }), el('p', { class: 'pref-hint', text: 'On frame 1 (the rest pose) drag to make a bone — from a bone\'s tip for a child. Then let layers move with it, and pose it on the other frames: drag to turn, Shift+drag to move.' })); return; }
    const name = el('input', { type: 'text', value: b.name, maxlength: '64', id: 'sp-bone-name', 'aria-label': 'Bone name' });
    name.addEventListener('change', () => change('Rename a bone', (d) => { d.bones = bones(d).map((x) => (x.id === b.id ? { ...x, name: name.value.trim() || 'Bone' } : x)); }));
    const parent = el('select', { id: 'sp-bone-parent', 'aria-label': 'Parent' }, el('option', { value: '', text: 'no parent' }), ...bones().filter((x) => x.id !== b.id).map((x) => el('option', { value: x.id, text: x.name })));
    parent.value = b.parent || '';
    parent.addEventListener('change', () => change('A bone\'s parent', (d) => { d.bones = bones(d).map((x) => (x.id === b.id ? { ...x, parent: parent.value || null } : x)); }));
    const layersBox = el('div', { class: 'sp-bone-layers' }, ...doc.layers.map((l, li) => (isGroup(l) || l.reference || l.kind === 'tilemap' ? null : (() => {
      const c = el('input', { type: 'checkbox', 'data-bonelayer': String(li), checked: l.bone === b.id || undefined });
      c.addEventListener('change', () => change(c.checked ? 'Moves with a bone' : 'Moves on its own', (d) => { const x = { ...d.layers[li] }; if (c.checked) x.bone = b.id; else delete x.bone; d.layers[li] = x; }));
      return el('label', { class: 'sb-inline' }, c, el('span', { text: l.name }));
    })())).filter(Boolean));
    const pose = (doc.frames[frame].pose && doc.frames[frame].pose[b.id]) || { a: 0, dx: 0, dy: 0 };
    const num = (k, label) => { const i = el('input', { type: 'number', class: 'sb-num', value: String(pose[k] || 0), 'data-pose': k, 'aria-label': label, disabled: frame === 0 || undefined }); i.addEventListener('change', () => setPose(b.id, { ...pose, [k]: Number(i.value) || 0 })); return el('label', { class: 'sb-inline' }, el('span', { text: label }), i); };
    const before = frame > 0 && doc.frames[frame - 1].pose && doc.frames[frame - 1].pose[b.id];
    box.replaceChildren(...[
      el('h4', { class: 'music-subhead', text: 'Bone' }), name,
      el('label', { class: 'sb-inline' }, el('span', { text: 'Parent' }), parent),
      el('small', { class: 'pref-hint', text: 'Layers that move with it (their picture on frame 1):' }), layersBox,
      el('h4', { class: 'music-subhead', text: frame === 0 ? 'Frame 1: the rest pose' : `Pose on frame ${frame + 1}` }),
      el('div', { class: 'sp-grid2' }, num('a', 'turn °'), num('dx', 'move x'), num('dy', 'move y')),
      frame > 0 ? el('div', { class: 'sb-row' },
        el('button', { class: 'utility-btn', title: 'Back to the rest pose on this frame', onclick: () => setPose(b.id, { a: 0, dx: 0, dy: 0 }) }, 'Rest'),
        before ? el('button', { class: 'utility-btn', title: 'As on the frame before', onclick: () => setPose(b.id, before) }, 'As before') : null) : null,
      el('button', { class: 'utility-btn', id: 'sp-bone-del', onclick: () => { change('Remove a bone', (d) => { d.bones = bones(d).filter((x) => x.id !== b.id).map((x) => (x.parent === b.id ? { ...x, parent: b.parent || null } : x)); d.layers = d.layers.map((l) => (l.bone === b.id ? (({ bone, ...rest }) => (void bone, rest))(l) : l)); }); boneSel = -1; renderBonePanel(); } }, '🗑 Remove the bone')].filter(Boolean));
  }

  // ---------------------------------------------------------------- shading helpers: hue-shifted ramps, auto shading, seeing colours

  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s2 = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s2, l];
  }
  function fromHsl(h, s2, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s2, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v + m)) * 255));
  }
  /** A hue moved towards another by up to `amt` degrees (the short way round). */
  const towards = (h, target, amt) => { const diff = ((target - h + 540) % 360) - 180; return (h + Math.sign(diff) * Math.min(Math.abs(diff), amt) + 360) % 360; };

  /**
   * A ramp the way pixel artists shade: darker steps turn towards blue-violet and lose a little saturation, lighter
   * ones towards warm yellow — not just darker and lighter of one hue.
   */
  function hueRamp(base, n, shift, lo, hi) {
    const [h, s2] = toHsl(base);
    return Array.from({ length: n }, (_, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1), l = lo + (hi - lo) * t;
      const hue = t < 0.5 ? towards(h, 245, shift * (0.5 - t) * 2) : towards(h, 55, shift * (t - 0.5) * 2);
      const sat = Math.max(0, Math.min(1, s2 * (1 - 0.35 * Math.abs(t - 0.5) * 2) + 0.08 * (1 - Math.abs(t - 0.5) * 2)));
      return [...fromHsl(hue, sat, l), 255];
    });
  }

  function hueRampDialog() {
    NoorUI.modal({ label: 'A hue-shifted ramp', width: 420 }, (s2, closeIt) => {
      const n = el('input', { type: 'number', min: '2', max: '12', value: '7', id: 'sp-hr-n', 'aria-label': 'Colours' });
      const shift = el('input', { type: 'range', min: '0', max: '60', value: '25', id: 'sp-hr-shift', 'aria-label': 'Hue shift' });
      const lo = el('input', { type: 'range', min: '0', max: '45', value: '12', 'aria-label': 'Darkest' });
      const hi = el('input', { type: 'range', min: '55', max: '100', value: '88', 'aria-label': 'Lightest' });
      const strip = el('div', { class: 'sp-hr-strip', id: 'sp-hr-strip' });
      const make = () => hueRamp(fg, Math.max(2, Math.min(12, Number(n.value) || 7)), Number(shift.value), Number(lo.value) / 100, Number(hi.value) / 100);
      const show = () => strip.replaceChildren(...make().map((c) => el('span', { class: 'sp-hr-swatch', style: `background:${hex(c).slice(0, 7)}`, title: hex(c) })));
      [n, shift, lo, hi].forEach((i) => i.addEventListener('input', show));
      show();
      s2.append(NoorUI.head('A hue-shifted ramp', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: 'From the drawing colour: shadows lean towards blue-violet, highlights towards warm yellow.' }),
          el('label', {}, 'Colours ', n), el('label', {}, 'Hue shift ', shift), el('label', {}, 'Darkest ', lo), el('label', {}, 'Lightest ', hi), strip),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'sp-hr-ok', onclick: () => { const cs = make().map(hex); closeIt(); change('A hue-shifted ramp', (d) => { for (const c of cs) if (!d.palette.includes(c) && d.palette.length < 256) d.palette.push(c); }); } }, 'Add to the palette'))));
    });
  }

  const LIGHTS = { tl: [-1, -1], t: [0, -1], tr: [1, -1], r: [1, 0], br: [1, 1], b: [0, 1], bl: [-1, 1], l: [-1, 0] };

  /**
   * Auto shading: the pixels drawn in a palette ramp's colours (in the selection, or the whole cel) shaded by where
   * they face — towards the light a step or two lighter, away a step or two darker, strongest near the edge; the far
   * edge can take the darkest colour as an outline. A start to touch up, not the end.
   */
  function autoShade(from, to, light, band, outlineEdge) {
    const c = cel();
    if (!c) { notice('Nothing on this layer and frame to shade', 1400); return; }
    const W = doc.width, H = doc.height, ramp = doc.palette.slice(Math.min(from, to), Math.max(from, to) + 1).map(parseHex);
    if (ramp.length < 2) { notice('A ramp is two palette colours or more', 1400); return; }
    const idxOf = (i) => ramp.findIndex((r) => r[0] === c.px[i] && r[1] === c.px[i + 1] && r[2] === c.px[i + 2] && r[3] === c.px[i + 3]);
    const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && c.px[(y * W + x) * 4 + 3] > 0;
    // How far each drawn pixel is from the edge (steps to a clear one).
    const dist = new Int16Array(W * H).fill(-1), queue = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (solid(x, y) && (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))) { dist[y * W + x] = 0; queue.push(y * W + x); }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % W, y = (i - x) / W;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (solid(nx, ny) && dist[ny * W + nx] < 0) { dist[ny * W + nx] = dist[i] + 1; queue.push(ny * W + nx); }
    }
    const [lx, ly] = LIGHTS[light] || LIGHTS.tl, ll = Math.hypot(lx, ly), D = (x, y) => (solid(x, y) ? dist[y * W + x] : -1);
    change('Auto shade', (d) => {
      const px = editable(d);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4;
        if (dist[i] < 0 || (selection && !selection.mask[i])) continue;
        const k = idxOf(o);
        if (k < 0) continue;
        // The way out of the shape here: from deeper to shallower.
        const gx = D(x - 1, y) - D(x + 1, y), gy = D(x, y - 1) - D(x, y + 1), gl = Math.hypot(gx, gy);
        if (!gl) continue;
        const facing = (gx * lx + gy * ly) / (gl * ll), near = Math.max(0, 1 - dist[i] / band);
        let step = Math.round(facing * near * 2);
        let n = Math.max(0, Math.min(ramp.length - 1, k + step));
        if (outlineEdge && dist[i] === 0 && facing < -0.3) n = 0;
        px.set(ramp[n], o);
      }
    });
  }

  function autoShadeDialog() {
    const fi = doc.palette.indexOf(hex(fg)), start = Math.max(0, fi < 0 ? 0 : fi - 2);
    NoorUI.modal({ label: 'Auto shade', width: 420 }, (s2, closeIt) => {
      const from = el('input', { type: 'number', min: '1', max: String(doc.palette.length), value: String(start + 1), id: 'sp-as-from', 'aria-label': 'Ramp from colour' });
      const to = el('input', { type: 'number', min: '1', max: String(doc.palette.length), value: String(Math.min(doc.palette.length, start + 5)), id: 'sp-as-to', 'aria-label': 'Ramp to colour' });
      const light = el('select', { id: 'sp-as-light', 'aria-label': 'Light from' }, ...[['tl', 'top left'], ['t', 'above'], ['tr', 'top right'], ['r', 'the right'], ['br', 'bottom right'], ['b', 'below'], ['bl', 'bottom left'], ['l', 'the left']].map(([v, l]) => el('option', { value: v, text: l })));
      const band = el('input', { type: 'number', min: '1', max: '8', value: '2', id: 'sp-as-band', 'aria-label': 'How far in' });
      const edge = el('input', { type: 'checkbox', id: 'sp-as-edge', checked: true });
      s2.append(NoorUI.head('Auto shade', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: 'Pixels in the ramp\'s colours (dark to light, in palette order) are shaded by where they face: a start to touch up. In the selection, or the whole layer on this frame.' }),
          el('label', {}, 'Ramp: colours ', from, ' to ', to), el('label', {}, 'Light from ', light), el('label', {}, 'Pixels in from the edge ', band), el('label', {}, edge, ' the far edge darkest (an outline)')),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'sp-as-ok', onclick: () => { closeIt(); autoShade(Number(from.value) - 1, Number(to.value) - 1, light.value, Math.max(1, Number(band.value) || 2), edge.checked); } }, 'Shade'))));
    });
  }

  // Seeing the sprite as people with colour blindness do (or in grey), to check its colours read apart.
  const SEEN = {
    protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
    deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
    tritanopia: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
    grey: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
  };
  function seenAs(px) {
    if (view.seen === 'silhouette') { const out = new Uint8ClampedArray(px); for (let i = 0; i < out.length; i += 4) { out[i] = out[i + 1] = out[i + 2] = 0; out[i + 3] = out[i + 3] ? 255 : 0; } return out; }
    const m = SEEN[view.seen];
    if (!m) return px;
    const out = new Uint8ClampedArray(px);
    for (let i = 0; i < out.length; i += 4) { const r = px[i], g = px[i + 1], b = px[i + 2]; out[i] = m[0] * r + m[1] * g + m[2] * b; out[i + 1] = m[3] * r + m[4] * g + m[5] * b; out[i + 2] = m[6] * r + m[7] * g + m[8] * b; }
    return out;
  }

  /** A palette from Lospec's list, by its name there (e.g. "endesga-32"): fetched only when asked. */
  async function lospecPalette() {
    const slug = await NoorUI.prompt('A palette from Lospec', 'Its name on lospec.com/palette-list (like endesga-32 or resurrect-64):', '', { okLabel: 'Load' });
    if (!slug || !slug.trim()) return;
    try {
      const r = await req('sprite.palette.lospec', { slug: slug.trim().toLowerCase() });
      change('A Lospec palette', (d) => { d.palette = r.palette.slice(0, 256); });
      notice(`${r.palette.length} colours: ${r.name}`, 1600);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- to other benches

  /** This frame as a NoorForge decal: its shape (where it is drawn) in white, grown by whole steps to be crisp. */
  async function toForge() {
    if (!window.NoorForge || !NoorForge.addPicture) { notice('NoorForge isn\'t here', 1500); return; }
    const px = compose(frame, doc, null, true), W = doc.width, H = doc.height;
    const k = Math.max(1, Math.min(Math.floor(1024 / Math.max(W, H)), Math.floor(256 / Math.max(W, H)) || 1));
    const w = W * k, h = H * k, g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = px[((Math.floor(y / k)) * W + Math.floor(x / k)) * 4 + 3];
    if (!g.some(Boolean)) { notice('Nothing drawn on this frame', 1400); return; }
    await NoorForge.addPicture({ name: `${file ? file.name.replace(/\.[^.]+$/, '') : 'Sprite'} ${frame + 1}`, width: w, height: h, data: b64(g) });
  }

  /** This frame (or a tilemap layer's tileset) into the Texture Bench, as a photo layer of a new material. */
  async function toTexture() {
    if (!window.NoorTexture) { notice('The Texture Bench isn\'t here', 1500); return; }
    let w = doc.width, h = doc.height, px = compose(frame, doc, null, true), name = file ? file.name.replace(/\.[^.]+$/, '') : 'sprite';
    if (isTilemap()) {
      // The tileset in a row, to make a material of the tiles.
      const ts = tilesetOf(), n = ts.tiles.length - 1;
      if (n > 0) { w = ts.tw * n; h = ts.th; px = new Uint8ClampedArray(w * h * 4); for (let i = 1; i <= n; i++) for (let y = 0; y < h; y++) px.set(ts.tiles[i].subarray(y * ts.tw * 4, (y + 1) * ts.tw * 4), (y * w + (i - 1) * ts.tw) * 4); name = `${name}-${ts.name}`; }
    }
    try {
      const r = await req('sprite.toTexture', { name, width: w, height: h, data: b64(new Uint8Array(px.buffer)) });
      await NoorTexture.fromPictures([r], 'new');
    } catch (err) { hooks.showError(err); }
  }

  /** A sound for this frame (played when it comes, in engine exports); none takes it away. */
  async function frameSound(clear = false) {
    if (clear) { change('No sound', (d) => { d.frames[frame] = { duration: d.frames[frame].duration }; }); return; }
    try {
      const r = await req('sprite.sound.pick');
      if (!r || r.cancelled) return;
      change('A sound', (d) => { d.frames[frame] = { ...d.frames[frame], sound: { path: r.path, name: r.name } }; });
    } catch (err) { hooks.showError(err); }
  }

  /** A sprite or a picture handed over (the Gallery's "Open in NoorSprite"). */
  async function openFrom(r) {
    await open();
    if (dirty() && !await NoorUI.confirm('Open another sprite?', 'The sprite open now has changes not saved.', 'Open')) return;
    if (r.sprite) { setDoc(fromWire(r.sprite), { path: r.path, name: r.name }); if (r.notes && r.notes.length) notice(r.notes.join(' '), 4000); }
    else if (r.image) setDoc(pictureSprite(r.image), null);
  }

  // ---------------------------------------------------------------- the command search and shortcuts of one's own

  /** Everything NoorSprite does, by name: what the search finds and what a shortcut of one's own can run. */
  // ---------------------------------------------------------------- turn-arounds: facing the other way, 4 or 8 directions

  // A tag named …_left, …_up_right (and so on) faces that way; a mirrored tag (tag.mirror: the tag it is the mirror
  // of) is that tag's frames flipped left ↔ right, made again by ☰ › Update the mirrored tags.
  const OTHER_SIDE = { left: 'right', right: 'left', up_left: 'up_right', up_right: 'up_left', down_left: 'down_right', down_right: 'down_left' };
  const DIRS = { 4: ['down', 'left', 'right', 'up'], 8: ['down', 'down_left', 'left', 'up_left', 'up', 'up_right', 'right', 'down_right'] };
  const LEFT_SIDE = ['left', 'up_left', 'down_left'];

  /** A tag's name split into its stem and the way it faces (null when it names none). */
  function faceOf(name) {
    const m = /[_ -](down_left|down_right|up_left|up_right|down|up|left|right)$/i.exec(name);
    return m ? { stem: name.slice(0, m.index), face: m[1].toLowerCase() } : null;
  }

  function flippedPx(px, W, H) {
    const o = new Uint8ClampedArray(px.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = (y * W + x) * 4; o.set(px.subarray(s, s + 4), (y * W + W - 1 - x) * 4); }
    return o;
  }

  /** Frames from…to copied to the end (flipped left ↔ right, or as they are): where the copies begin. */
  function copyFrames(d, from, to, flip) {
    const at = d.frames.length;
    for (let f = from; f <= to; f++) {
      const n = d.frames.length;
      d.frames.push({ ...d.frames[f] });
      for (const l of d.layers) {
        const c = d.cels.get(key(l.id, f));
        if (!c) continue;
        const { link, ...plain } = c; void link;
        // A tilemap's cells stay as they are (its tiles would need flipped twins).
        d.cels.set(key(l.id, n), flip && l.kind !== 'tilemap' ? { opacity: c.opacity, px: flippedPx(c.px, d.width, d.height) } : plain);
      }
    }
    return at;
  }

  /** The frames of a mirrored tag made again from the tag it mirrors (when both have as many frames). */
  function refreshMirror(d, m) {
    const src = d.tags.find((t) => t.name === m.mirror);
    if (!src || src.to - src.from !== m.to - m.from) return false;
    for (let i = 0; i <= m.to - m.from; i++) {
      const f = src.from + i, g = m.from + i;
      d.frames[g] = { ...d.frames[f] };
      for (const l of d.layers) {
        const c = d.cels.get(key(l.id, f));
        if (l.kind === 'tilemap' || isGroup(l)) continue;
        if (c) d.cels.set(key(l.id, g), { opacity: c.opacity, px: flippedPx(c.px, d.width, d.height) }); else d.cels.delete(key(l.id, g));
      }
    }
    return true;
  }

  function updateMirrors() {
    const mirrored = doc.tags.filter((t) => t.mirror);
    if (!mirrored.length) { notice('No mirrored tags (☰ › Facing the other way makes one)', 1800); return; }
    let done = 0;
    const skipped = [];
    change('Update the mirrored tags', (d) => { for (const t of d.tags) if (t.mirror) { if (refreshMirror(d, t)) done++; else skipped.push(t.name); } });
    notice(`${done} mirrored tag${done === 1 ? '' : 's'} made again${skipped.length ? ` (not ${skipped.join(', ')}: its frames don't match the one it mirrors, or that one is gone)` : ''}`, 2600);
  }

  const tagSelect = (id) => el('select', { id, 'aria-label': 'Tag' }, ...doc.tags.map((t, i) => el('option', { value: String(i), text: `“${t.name}” (frames ${t.from + 1}–${t.to + 1})` })));

  /** A tag's frames flipped left ↔ right as a new tag at the end: a walk to the right becomes one to the left. */
  function mirrorTagDialog() {
    commitFloating();
    if (!doc.tags.length) { notice('Tag the frames first (the timeline\'s 🏷 button), then mirror the tag', 2200); return; }
    NoorUI.modal({ label: 'Facing the other way', width: 420 }, (s2, closeIt) => {
      const which = tagSelect('sp-mir-tag');
      which.value = String(Math.max(0, doc.tags.findIndex((t) => frame >= t.from && frame <= t.to)));
      const name = el('input', { type: 'text', id: 'sp-mir-name', maxlength: '64', 'aria-label': 'Name' });
      const keep = el('input', { type: 'checkbox', id: 'sp-mir-keep', checked: true });
      const suggest = () => { const t = doc.tags[Number(which.value)], f = faceOf(t.name); name.value = f && OTHER_SIDE[f.face] ? `${f.stem}_${OTHER_SIDE[f.face]}` : `${t.name}_mirrored`; };
      which.addEventListener('change', suggest); suggest();
      const ok = () => {
        const ti = Number(which.value), t = doc.tags[ti], nm = name.value.trim() || `${t.name}_mirrored`;
        if (doc.tags.some((x) => x.name === nm)) { notice(`There is a tag “${nm}” already`, 1600); return; }
        closeIt();
        change('Facing the other way', (d) => {
          const at = copyFrames(d, t.from, t.to, true);
          const { mirror, ...plain } = t; void mirror;
          d.tags.push({ ...plain, name: nm, from: at, to: at + t.to - t.from, ...(keep.checked ? { mirror: t.name } : {}) });
          frame = at;
        });
        notice(`“${nm}”: ${t.to - t.from + 1} frame${t.to === t.from ? '' : 's'} facing the other way${doc.layers.some((l) => l.bone) ? ' (layers on bones follow their poses, not mirrored)' : ''}`, 2400);
      };
      s2.append(NoorUI.head('Facing the other way', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: 'The tag\'s frames flipped left ↔ right, as a new tag after the last frame.' }),
          el('label', {}, 'Tag ', which), el('label', {}, 'New tag ', name),
          el('label', { title: 'Its frames stay a mirror: ☰ › Update the mirrored tags makes them again after you change the first' }, keep, ' keep it mirrored (update it from the first)')),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-mir-ok', onclick: ok }, 'Mirror'))));
    });
  }

  /** 4 or 8 directions from one tag: a tag for each (…_down, …_up_left …), copies to draw over, the left ones mirrored. */
  function directionsDialog() {
    commitFloating();
    if (!doc.tags.length) { notice('Tag the frames first (the timeline\'s 🏷 button): one animation, then its directions', 2200); return; }
    NoorUI.modal({ label: 'Directions', width: 440 }, (s2, closeIt) => {
      const which = tagSelect('sp-dir-tag');
      which.value = String(Math.max(0, doc.tags.findIndex((t) => frame >= t.from && frame <= t.to)));
      const faces = el('select', { id: 'sp-dir-face', 'aria-label': 'It faces' }, ...DIRS[8].map((f) => el('option', { value: f, text: f.replace('_', ' ') })));
      const count = el('select', { id: 'sp-dir-count', 'aria-label': 'How many' }, el('option', { value: '4', text: '4 (down, left, right, up)' }), el('option', { value: '8', text: '8 (and the diagonals)' }));
      const mirror = el('input', { type: 'checkbox', id: 'sp-dir-mirror', checked: true });
      const guess = () => { const f = faceOf(doc.tags[Number(which.value)].name); faces.value = f ? f.face : 'down'; };
      which.addEventListener('change', guess); guess();
      const ok = () => {
        const t = doc.tags[Number(which.value)], face = faces.value, f = faceOf(t.name), stem = f ? f.stem : t.name;
        const dirs = DIRS[count.value].includes(face) ? DIRS[count.value] : [...DIRS[count.value], face];
        closeIt();
        const made = [];
        change(`${count.value} directions`, (d) => {
          const base = d.tags.find((x) => x.from === t.from && x.to === t.to && x.name === t.name);
          base.name = `${stem}_${face}`;
          const has = (dir) => d.tags.some((x) => x.name === `${stem}_${dir}`);
          const { mirror: m0, ...plain } = base; void m0;
          const add = (dir, from, to, flip, of) => { const at = copyFrames(d, from, to, flip); d.tags.push({ ...plain, name: `${stem}_${dir}`, from: at, to: at + to - from, ...(of ? { mirror: of } : {}) }); made.push(`${stem}_${dir}`); };
          // Mirrored: the side of a pair the drawn one isn't on (the left ones, unless the tag faces left).
          const mirrored = (dir) => mirror.checked && OTHER_SIDE[dir] && (OTHER_SIDE[dir] === face || (LEFT_SIDE.includes(dir) && dirs.includes(OTHER_SIDE[dir])));
          for (const dir of dirs) if (dir !== face && !has(dir) && !mirrored(dir)) add(dir, base.from, base.to, false, null);
          for (const dir of dirs) {
            if (dir === face || has(dir) || !mirrored(dir)) continue;
            const src = d.tags.find((x) => x.name === `${stem}_${OTHER_SIDE[dir]}`);
            if (src) add(dir, src.from, src.to, true, src.name);
          }
        });
        notice(made.length ? `${made.join(', ')}: copies to draw over${mirror.checked ? ' (the mirrored ones follow with ☰ › Update the mirrored tags)' : ''}` : 'Every direction has its tag already', 3200);
      };
      s2.append(NoorUI.head('Directions', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('p', { class: 'pref-hint', text: 'A tag for each direction (each exports as its own animation), each a copy of this one to draw over.' }),
          el('label', {}, 'Tag ', which), el('label', {}, 'It faces ', faces), el('label', {}, 'Directions ', count),
          el('label', { title: 'Draw the right-facing ones; the left-facing ones are them flipped' }, mirror, ' the left-facing ones mirrored from the right-facing ones')),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'sp-dir-ok', onclick: ok }, 'Make them'))));
    });
  }

  // ---------------------------------------------------------------- isometric: diamonds, boxes

  /** The isometric box filling a rectangle: a 2:1 diamond on top (lighter), the left wall, the right wall (darker). */
  function isoBoxPoints(x0, y0, x1, y1, c) {
    const l = Math.min(x0, x1), t = Math.min(y0, y1), W = Math.abs(x1 - x0) + 1, H = Math.abs(y1 - y0) + 1;
    const d = Math.ceil(W / 2), h = Math.max(0, H - d), mid = (d - 1) / 2;
    const mix = (to, k) => [0, 1, 2].map((i) => Math.round(c[i] + (to - c[i]) * k)).concat(c[3]);
    const top = mix(255, 0.35), right = mix(0, 0.35), out = [];
    for (let x = 0; x < W; x++) {
      const k = Math.floor(Math.min(x, W - 1 - x) / 2), a = Math.max(0, Math.floor(mid) - k), b = Math.min(Math.max(d, 1) - 1, Math.ceil(mid) + k);
      for (let y = a; y <= b; y++) out.push([l + x, t + y, top]);
      for (let y = b + 1; y <= b + h && y < H; y++) out.push([l + x, t + y, x < W / 2 ? c : right]);
    }
    return out;
  }

  /** Isometric grid lines: diamonds the grid's size (its width × height, like 32 × 16). */
  function drawIsoGrid(ctx, o, z) {
    const gw = doc.gridWidth, gh = doc.gridHeight, W = doc.width, H = doc.height;
    ctx.save(); ctx.beginPath(); ctx.rect(o.x, o.y, W * z, H * z); ctx.clip();
    ctx.strokeStyle = 'rgba(40,120,255,0.55)'; ctx.lineWidth = 1; ctx.beginPath();
    const n = Math.ceil(W / gw + H / gh) + 1;
    for (let i = -n; i <= n; i++) {
      // x/gw + y/gh = i, and x/gw − y/gh = i: from the top edge to the bottom.
      ctx.moveTo(o.x + i * gw * z, o.y); ctx.lineTo(o.x + (i * gw - (H / gh) * gw) * z, o.y + H * z);
      ctx.moveTo(o.x + i * gw * z, o.y); ctx.lineTo(o.x + (i * gw + (H / gh) * gw) * z, o.y + H * z);
    }
    ctx.stroke(); ctx.restore();
  }

  // ---------------------------------------------------------------- collision shapes

  /**
   * The outline of a picture's solid pixels (alpha at least half) as a polygon along the pixels' edges: the biggest
   * piece's outside, simplified to within `tol` pixels. Points are pixel corners; [] when nothing is solid.
   */
  function collisionOf(px, W, H, tol = 1) {
    const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] >= 128;
    // Edges with the solid on their right, going round each pixel's open sides.
    const from = new Map(), P = (x, y) => y * (W + 1) + x;
    const addEdge = (ax, ay, bx, by) => { const k = P(ax, ay); if (!from.has(k)) from.set(k, []); from.get(k).push({ ax, ay, bx, by, used: false }); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!solid(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!solid(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!solid(x - 1, y)) addEdge(x, y + 1, x, y);
    }
    let best = null, bestArea = 0;
    for (const list of from.values()) for (const e0 of list) {
      if (e0.used) continue;
      const loop = [];
      let e = e0;
      while (e && !e.used) {
        e.used = true;
        loop.push([e.ax, e.ay]);
        const next = (from.get(P(e.bx, e.by)) || []).filter((n) => !n.used);
        // Where two pieces touch at a corner, turn right: each piece keeps its own outline.
        const dx = e.bx - e.ax, dy = e.by - e.ay;
        e = next.find((n) => n.bx - n.ax === -dy && n.by - n.ay === dx) || next[0] || null;
      }
      let area = 0;
      for (let i = 0; i < loop.length; i++) { const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length]; area += ax * by - bx * ay; }
      if (area > bestArea) { bestArea = area; best = loop; }
    }
    if (!best) return [];
    // Straight runs to their ends, then simplified (Douglas–Peucker, the loop split at its far point).
    const pts = best.filter((p, i) => { const a = best[(i - 1 + best.length) % best.length], b = best[(i + 1) % best.length]; return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0; });
    if (tol <= 0 || pts.length <= 4) return pts;
    const simplify = (run) => {
      if (run.length < 3) return run;
      const [ax, ay] = run[0], [bx, by] = run[run.length - 1], len = Math.hypot(bx - ax, by - ay) || 1;
      let far = 0, fi = 0;
      for (let i = 1; i < run.length - 1; i++) { const dd = Math.abs((bx - ax) * (ay - run[i][1]) - (ax - run[i][0]) * (by - ay)) / len; if (dd > far) { far = dd; fi = i; } }
      return far <= tol ? [run[0], run[run.length - 1]] : [...simplify(run.slice(0, fi + 1)).slice(0, -1), ...simplify(run.slice(fi))];
    };
    let fi = 0, fd = 0;
    pts.forEach((p, i) => { const dd = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (dd > fd) { fd = dd; fi = i; } });
    const out = [...simplify(pts.slice(0, fi + 1)).slice(0, -1), ...simplify([...pts.slice(fi), pts[0]]).slice(0, -1)];
    return out.length >= 3 ? out : pts;
  }

  function drawCollision(ctx, o, z) {
    const poly = collisionOf(compose(frame, doc, null, true), doc.width, doc.height, view.collisionTol);
    if (poly.length < 3) return;
    ctx.save(); ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(o.x + x * z, o.y + y * z) : ctx.moveTo(o.x + x * z, o.y + y * z)));
    ctx.closePath(); ctx.fillStyle = 'rgba(0,220,255,0.15)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#00dcff'; ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const [x, y] of poly) ctx.fillRect(o.x + x * z - 2, o.y + y * z - 2, 4, 4);
    ctx.restore();
  }

  // ---------------------------------------------------------------- readability: colours too close, colours barely used

  /** How far apart two colours look (0 the same; about 30 is hard to tell apart in a small sprite). */
  const colourGap = (a, b) => Math.sqrt(palDist(a, b[0], b[1], b[2], b[3]) / 11);

  /** The sprite's colours (every frame as exported) with how many pixels each covers, most first. */
  function usedColours() {
    const counts = new Map();
    for (let f = 0; f < doc.frames.length; f++) {
      const px = compose(f, doc, null, true);
      for (let i = 0; i < px.length; i += 4) if (px[i + 3]) { const k = rgbaKey(px, i); counts.set(k, (counts.get(k) || 0) + 1); }
    }
    return [...counts].map(([k, n]) => ({ c: [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255], n })).sort((a, b) => b.n - a.n);
  }

  function colourCheck() {
    commitFloating();
    const cols = usedColours();
    NoorUI.modal({ label: 'Check the colours', width: 480 }, (s2, closeIt) => {
      const gap = el('input', { type: 'range', min: '5', max: '80', value: '24', id: 'sp-cc-gap', 'aria-label': 'How close counts as too close' });
      const rare = el('input', { type: 'number', min: '1', max: '50', value: '2', id: 'sp-cc-rare-n', class: 'sb-num', 'aria-label': 'Barely used: at most this many pixels' });
      const body = el('div', { class: 'sp-cc' });
      const sw = (c) => el('span', { class: 'sp-cc-sw', style: `background:${hex(c).slice(0, 7)}`, title: hex(c) });
      const merge = (a, b) => { closeIt(); replaceColour(a.c, b.c, 0, 'sprite'); notice(`${hex(a.c)} is ${hex(b.c)} now`, 1600); };
      const render = () => {
        const g = Number(gap.value), r = Number(rare.value) || 1, close = [];
        for (let i = 0; i < cols.length && close.length < 30; i++) for (let j = i + 1; j < cols.length && close.length < 30; j++) if (colourGap(cols[i].c, cols[j].c) < g) close.push([cols[i], cols[j]]);
        const few = cols.length > 1 ? cols.filter((x) => x.n <= r).slice(0, 30) : [];
        const nearestOther = (x) => cols.filter((y) => y !== x && y.n > r).sort((a, b) => colourGap(x.c, a.c) - colourGap(x.c, b.c))[0];
        body.replaceChildren(
          el('p', { class: 'pref-hint', text: `${cols.length} colour${cols.length === 1 ? '' : 's'} in the sprite (every frame).` }),
          el('h4', { class: 'music-subhead', text: `Too close to tell apart (${close.length})` }),
          el('div', { id: 'sp-cc-close' }, ...(close.length ? close.map(([a, b]) => el('div', { class: 'sb-row sp-cc-row' }, sw(a.c), sw(b.c), el('small', { text: `${a.n} and ${b.n} pixels` }),
            el('button', { class: 'utility-btn sp-cc-merge', title: 'Every pixel of the less used one becomes the other', onclick: () => merge(b, a) }, 'One colour'))) : [el('small', { class: 'pref-hint', text: 'None: every colour reads apart.' })])),
          el('h4', { class: 'music-subhead', text: `Barely used (${few.length})` }),
          el('div', { id: 'sp-cc-rare' }, ...(few.length ? few.map((x) => { const to = nearestOther(x); return el('div', { class: 'sb-row sp-cc-row' }, sw(x.c), el('small', { text: `${x.n} pixel${x.n === 1 ? '' : 's'}` }),
            el('button', { class: 'utility-btn', title: 'Draw with it (to find it)', onclick: () => { fg = [...x.c]; renderColours(); renderPalette(); } }, 'Pick'),
            ...(to ? [el('button', { class: 'utility-btn sp-cc-fold', title: `Make it ${hex(to.c)}, the nearest colour used more`, onclick: () => merge(x, to) }, '→ ', sw(to.c))] : [])); }) : [el('small', { class: 'pref-hint', text: 'None.' })])));
      };
      gap.addEventListener('input', render); rare.addEventListener('change', render);
      s2.append(NoorUI.head('Check the colours', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('label', {}, 'Too close under ', gap), el('label', {}, 'Barely used: ', rare, ' pixels or fewer'), body,
          el('p', { class: 'pref-hint', text: 'Also: View › Seen › silhouette (does the shape read?), and click the preview for 1×, 2×, 3× (the size it will be in the game).' })),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action primary', onclick: () => closeIt() }, 'Done'))));
      render();
    });
  }

  function commands() {
    const flip = (k, label) => [`view.${k}`, `${view[k] ? 'Hide' : 'Show'} ${label}`, () => { view[k] = !view[k]; renderAll(); }];
    const list = [
      ...TOOLS.map(([id, , title]) => [`tool.${id}`, `Tool: ${title}`, () => setTool(id)]),
      ['file.new', 'New sprite…', newDialog], ['file.open', 'Open a sprite…', openFile], ['file.save', 'Save', () => save(false)], ['file.saveas', 'Save as…', () => save(true)], ['file.export', 'Export…', exportDialog],
      ['edit.undo', 'Undo', () => undo(false)], ['edit.redo', 'Redo', () => undo(true)], ['edit.copy', 'Copy', () => copy(false)], ['edit.cut', 'Cut', () => copy(true)], ['edit.paste', 'Paste', paste],
      ['edit.all', 'Select all', selectAll], ['edit.none', 'Select nothing', deselect], ['edit.invert', 'Turn the selection round', invertSelection], ['edit.delete', 'Delete what is selected', () => clearSelection()],
      ['frame.new', 'New frame (a copy)', () => addFrame(true)], ['frame.empty', 'New empty frame', () => addFrame(false)], ['frame.linked', 'New linked frame', () => addFrame(true, true)], ['frame.remove', 'Remove the frame', removeFrame],
      ['frame.earlier', 'Move the frame earlier', () => moveFrame(-1)], ['frame.later', 'Move the frame later', () => moveFrame(1)], ['frame.tween', 'In-betweens…', tweenDialog], ['frame.timing', 'Frame timing…', timingDialog],
      ['frame.tag', 'New tag…', () => tagDialog(null)], ['frame.play', 'Play / stop', () => (playing ? stop() : play())],
      ['layer.new', 'New layer', addLayer], ['layer.group', 'New group', addGroup], ['layer.ungroup', 'Ungroup', ungroup], ['layer.tilemap', 'New tilemap layer', addTilemapLayer], ['layer.duplicate', 'Duplicate the layer', duplicateLayer],
      ['layer.remove', 'Remove the layer', removeLayer], ['layer.merge', 'Merge down', mergeDown], ['layer.up', 'Layer up', () => moveLayer(1)], ['layer.down', 'Layer down', () => moveLayer(-1)],
      ['tiles.mode', 'Tiles / pixels (tilemap layer)', () => setTileMode(!tileMode)], ['brush.smooth', 'Smooth lines: stronger (round to off)', () => cycleSmooth()],
      flip('pixelGrid', 'the pixel grid'), flip('grid', 'the grid'), flip('onion', 'onion skin'), flip('slices', 'slices'), flip('path', 'the motion path'), flip('thumbs', 'thumbnails'), flip('isoGrid', 'isometric diamonds (with the grid)'), flip('collision', 'the collision shape'),
      ['view.tiled', 'Tiling: both ways / off', () => { view.tiled = view.tiled ? '' : 'both'; renderAll(); }], ['view.in', 'Zoom in', () => zoomBy(1)], ['view.out', 'Zoom out', () => zoomBy(-1)], ['view.fit', 'Fit the sprite in view', () => { fitZoom(); draw(); }],
      ['view.reference', 'A floating reference picture…', floatingReference],
      ...moreItems().filter(Boolean).map(([name, fn]) => [`sprite.${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, name, fn]),
      ...paletteItems().filter(Boolean).map(([name, fn]) => [`palette.${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, `Palette: ${name}`, fn]),
    ];
    return list.map(([id, name, run]) => ({ id, name, run }));
  }

  // Shortcuts of one's own: a key (with Ctrl, Alt, Shift) for any command, kept in this browser's storage.
  let myKeys = {};
  try { myKeys = JSON.parse(localStorage.getItem('noorsprite.shortcuts') || '{}') || {}; } catch { myKeys = {}; }
  const saveKeys = () => { try { localStorage.setItem('noorsprite.shortcuts', JSON.stringify(myKeys)); } catch { /* kept for now only */ } };
  const comboOf = (e) => `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.key.length === 1 ? e.key.toUpperCase() : e.key}`;
  const keysFor = (id) => Object.keys(myKeys).filter((k) => myKeys[k] === id);

  function cycleSmooth() {
    const i = STABILIZERS.findIndex(([v]) => v === opts.stabilize);
    opts.stabilize = STABILIZERS[(i + 1) % STABILIZERS.length][0];
    renderOptions();
    notice(`Smooth lines: ${STABILIZERS.find(([v]) => v === opts.stabilize)[1]}`, 1000);
  }

  /** Ctrl+K: find a command by name and run it; ⌨ gives it a shortcut of one's own. */
  function commandSearch() {
    const all = commands();
    NoorUI.modal({ label: 'NoorSprite commands', width: 520 }, (s2, closeIt) => {
      const input = el('input', { type: 'text', id: 'sp-cmd-input', placeholder: 'What to do… (Enter runs the first)', 'aria-label': 'Find a command' });
      const list = el('div', { class: 'sp-cmd-list', id: 'sp-cmd-list', role: 'listbox' });
      let shown = [], pick = 0, capturing = null;
      const run = (c) => { closeIt(); setTimeout(() => { c.run(); keepFocus(); }, 0); };
      const render = () => {
        const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
        shown = all.filter((c) => words.every((w) => c.name.toLowerCase().includes(w))).slice(0, 60);
        pick = Math.min(pick, Math.max(0, shown.length - 1));
        list.replaceChildren(...shown.map((c, i) => el('div', { class: 'sp-cmd' + (i === pick ? ' on' : ''), role: 'option', 'data-cmd': c.id, 'aria-selected': String(i === pick) },
          el('button', { class: 'utility-btn sp-cmd-run', onclick: () => run(c) }, c.name),
          el('span', { class: 'sp-cmd-keys', text: capturing === c.id ? 'press the keys…' : keysFor(c.id).join(', ') }),
          el('button', { class: 'icon-btn', 'data-setkey': c.id, title: 'A shortcut of your own for this (press it; Backspace takes it away)', 'aria-label': `Shortcut for ${c.name}`, onclick: () => { capturing = c.id; render(); input.focus(); } }, '⌨'))));
      };
      input.addEventListener('input', () => { pick = 0; render(); });
      // Keys: arrows choose, Enter runs; while a shortcut is being set, the next key is it.
      s2.addEventListener('keydown', (e) => {
        if (capturing) {
          if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          for (const k of keysFor(capturing)) delete myKeys[k];
          if (e.key !== 'Backspace' && e.key !== 'Escape') myKeys[comboOf(e)] = capturing;
          capturing = null; saveKeys(); render();
          return;
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); pick = Math.min(shown.length - 1, pick + 1); render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); pick = Math.max(0, pick - 1); render(); }
        else if (e.key === 'Enter' && shown[pick]) { e.preventDefault(); run(shown[pick]); }
      }, true);
      s2.append(NoorUI.head('Commands', closeIt), el('div', { class: 'modal-body sp-dlg' }, input, list));
      render();
      setTimeout(() => input.focus(), 0);
    });
  }

  // A floating reference picture: a picture to look at while drawing, in a window of its own over NoorSprite.
  async function floatingReference() {
    try {
      const r = await req('sprite.picture.pick');
      if (!r || r.cancelled) return;
      const im = r.image, cv = el('canvas', { width: String(im.width), height: String(im.height), class: 'sp-ref-canvas' });
      cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(unb64(im.data)), im.width, im.height), 0, 0);
      $('#sp-refwin')?.remove();
      const head = el('div', { class: 'sp-ref-head' }, el('span', { text: `📌 ${r.name || 'Reference'}` }),
        el('input', { type: 'range', min: '0.1', max: '1', step: '0.05', value: '1', 'aria-label': 'See-through', title: 'How see-through', oninput: (e) => { win.style.opacity = e.target.value; } }),
        el('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close the reference', onclick: () => win.remove() }, '✕'));
      const win = el('div', { class: 'sp-refwin', id: 'sp-refwin', role: 'dialog', 'aria-label': 'Reference picture' }, head, el('div', { class: 'sp-ref-body' }, cv));
      $('#spritebench').append(win);
      // Dragged by its title; resized from its corner (the picture fits).
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, input')) return;
        const sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
        const mv = (ev) => { win.style.left = `${ev.clientX - sx}px`; win.style.top = `${ev.clientY - sy}px`; };
        const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
      });
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- keys

  function onKey(e) {
    const typing = e.target.closest('input[type=text], input[type=number], select, textarea');
    if (typing) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    // A shortcut of one's own goes first.
    const mine = myKeys[comboOf(e)];
    if (mine) { const c = commands().find((x) => x.id === mine); if (c) { handled(); c.run(); return; } }
    if (ctrl && k === 'k' && !e.shiftKey) { handled(); commandSearch(); return; }
    if (e.key === ' ' && !ctrl) { spaceHeld = true; setCursor(); handled(); return; }
    if (e.key === 'Alt') { altHeld = true; setCursor(); handled(); return; }
    if (e.key === 'Escape' && curve) { handled(); curve = null; draw(); return; }
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
      if (k === 'g') { handled(); if (e.shiftKey) ungroup(); else addGroup(); return; }
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
    if (tilesOn() && e.shiftKey && (k === 'x' || k === 'y')) { handled(); turnTileToPlace(k); return; }
    if (tilesOn() && k === 'r') { handled(); turnTileToPlace('r'); return; }
    if (k === 'x') { handled(); swapColours(); return; }
    if (k === '[' || k === ']') { handled(); opts.size = Math.max(1, Math.min(64, opts.size + (k === ']' ? 1 : -1))); renderOptions(); draw(); return; }
    if (k === '+' || k === '=') { handled(); zoomBy(1); return; }
    if (k === '-') { handled(); zoomBy(-1); return; }
    if (k === '0') { handled(); fitZoom(); draw(); return; }
    if (k === 'n' && e.shiftKey) { handled(); addLayer(); return; }
    if (k === 't') { handled(); setTileMode(!tileMode); return; }
    if (k === 's') { handled(); cycleSmooth(); return; }
    const t = TOOLS.find((x) => x[3] === k);
    if (t) { handled(); setTool(t[0]); }
  }

  // Marching ants march.
  setInterval(() => { if (built && isOpen() && selection && !drag) draw(); }, 120);

  return {
    init, open, close, toggle, isOpen, openFrom,
    _state: () => doc && ({
      width: doc.width, height: doc.height, layers: doc.layers.map((l) => ({ ...l })), frames: doc.frames.map((f) => ({ ...f })), tags: doc.tags.map((t) => ({ ...t })), palette: [...doc.palette],
      layer, frame, tool, fg: [...fg], bg: [...bg], opts: { ...opts }, view: { ...view }, history: history.length, future: future.length, dirty: dirty(), file,
      selection: selection ? { x0: selection.x0, y0: selection.y0, x1: selection.x1, y1: selection.y1, count: selection.mask.reduce((a, b) => a + b, 0) } : null,
      floating: floating ? { x: floating.x, y: floating.y, w: floating.w, h: floating.h } : null, playing: !!playing, curving: !!curve,
      cels: [...doc.cels.keys()],
      tilesets: (doc.tilesets || []).map((t) => ({ name: t.name, tw: t.tw, th: t.th, count: t.tiles.length - 1 })), tileMode, tileSel,
      indexed: !!doc.indexed, cycle: doc.cycle || null, cycling: !!cycling,
    }),
    /** For tests: a frame's normal map pixel. */
    _normal: (x, y, f = frame) => { const nm = normalMap(f); const i = (y * doc.width + x) * 4; return [nm[i], nm[i + 1], nm[i + 2], nm[i + 3]]; },
    /** For tests: how many doubled corners this cel has. */
    _jaggies: () => { const c = cel(); return c ? jaggies(c.px, doc.width, doc.height).length : 0; },
    /** For tests: the drawing colour. */
    _setColour: (c) => { fg = [...c]; renderColours(); renderPalette(); },
    /** For tests: the palette index of a cel's pixel (indexed sprites). */
    _index: (x, y, l = layer, f = frame) => { const c = doc.cels.get(key(doc.layers[l].id, f)); return c && c.idx ? c.idx[y * doc.width + x] : null; },
    /** For tests: the frame as shown (with colour cycling). */
    _shown: (x, y) => { const px = composeShown(); const i = (y * doc.width + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; },
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
