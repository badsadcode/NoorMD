// NoorSketch — a small raster sketchpad in its own window.
// The image lives in an exact straight-alpha RGBA buffer (not in the canvas, which premultiplies alpha); the canvas
// only displays it. Strokes are rasterised into the buffer with anti-aliased round stamps; undo stores the 64×64
// tiles a stroke touched (before and after), so memory follows what was drawn, not the canvas size.
window.NoorSketch = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const bridge = NoorBridge;
  const TILE = 64;
  const PRESETS = [[1280, 720], [1920, 1080], [2048, 2048], [4096, 4096]];
  const SWATCHES = ['#1d1b26', '#ffffff', '#9b8cff', '#e05d5d', '#f0a35a', '#f2d35b', '#5fbf8a', '#4fa3e0', '#c770c9', '#8a6a4f', '#7d7d8c', '#2f6b4f'];
  const MAX_UNDO_BYTES = 384 * 1024 * 1024;
  const MAX_SIDE = 8192, MAX_PIXELS = 4096 * 4096;

  let W = 0, H = 0, buf = null, background = 'white';
  let img = null; // ImageData sharing buf
  let ctx = null;
  let tool = 'brush', size = 8, color = [29, 27, 38];
  let zoom = 1, panX = 0, panY = 0;
  let undo = [], redo = [], undoBytes = 0, savedMarker = null, docPath = null, docName = 'Untitled sketch';
  let stroke = null, panning = null, spaceDown = false, dirtyRect = null, rafPending = false;
  // Painting for a material (opened from NoorMaterial): the material shows underneath, strokes wrap around the
  // edges (so the painting tiles), and saving applies it to the material.
  let texture = null; // { material, under: { width, height, rgba } | null, show }

  // ---------------------------------------------------------------- canvas model

  function newCanvas(w, h, bg) {
    W = w; H = h; background = bg;
    buf = new Uint8ClampedArray(W * H * 4);
    if (bg === 'white') buf.fill(255);
    attachBuffer();
    undo = []; redo = []; undoBytes = 0; savedMarker = null; docPath = null; docName = 'Untitled sketch';
    fit();
    changed();
  }

  function attachBuffer() {
    const c = $('#sketch-canvas');
    c.width = W; c.height = H;
    ctx = c.getContext('2d', { willReadFrequently: false });
    img = new ImageData(buf, W, H);
    ctx.putImageData(img, 0, 0);
    $('#sketch-size').textContent = `${W} × ${H}${background === 'transparent' ? ' · transparent' : ''}`;
  }

  function markDirty(x0, y0, x1, y1) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    if (x1 <= x0 || y1 <= y0) return;
    dirtyRect = dirtyRect ? [Math.min(dirtyRect[0], x0), Math.min(dirtyRect[1], y0), Math.max(dirtyRect[2], x1), Math.max(dirtyRect[3], y1)] : [x0, y0, x1, y1];
    if (!rafPending) { rafPending = true; requestAnimationFrame(flushRender); }
  }

  function flushRender() {
    rafPending = false;
    if (!dirtyRect) return;
    const [x0, y0, x1, y1] = dirtyRect;
    dirtyRect = null;
    ctx.putImageData(img, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  const tilesX = () => Math.ceil(W / TILE);
  function tileRect(i) { const tx = i % tilesX(), ty = Math.floor(i / tilesX()); const x = tx * TILE, y = ty * TILE; return [x, y, Math.min(TILE, W - x), Math.min(TILE, H - y)]; }
  function copyOut(x, y, w, h) { const out = new Uint8ClampedArray(w * h * 4); for (let r = 0; r < h; r++) out.set(buf.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4); return out; }
  function copyIn(data, x, y, w, h) { for (let r = 0; r < h; r++) buf.set(data.subarray(r * w * 4, (r + 1) * w * 4), ((y + r) * W + x) * 4); markDirty(x, y, x + w, y + h); }

  // ---------------------------------------------------------------- drawing

  function beginStroke(p) {
    stroke = { tiles: new Map(), last: p, erase: tool === 'eraser', color: color.slice(), r: size / 2 };
    stampWrapped(p.x, p.y);
  }

  function tileFor(i) {
    let t = stroke.tiles.get(i);
    if (!t) {
      const [x, y, w, h] = tileRect(i);
      t = { x, y, w, h, before: copyOut(x, y, w, h), mask: new Uint8Array(w * h) };
      stroke.tiles.set(i, t);
    }
    return t;
  }

  /** One anti-aliased round stamp. Within a stroke each pixel keeps its highest coverage, so overlapping stamps don't darken. */
  function stamp(cx, cy) {
    const r = stroke.r;
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(W, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(H, Math.ceil(cy + r + 1));
    const [cr, cg, cb] = stroke.color;
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        let cov = r + 0.5 - d;
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        const c8 = Math.round(cov * 255);
        const i = Math.floor(y / TILE) * tilesX() + Math.floor(x / TILE);
        const t = tileFor(i);
        const local = (y - t.y) * t.w + (x - t.x);
        if (c8 <= t.mask[local]) continue;
        t.mask[local] = c8;
        const b = local * 4, o = (y * W + x) * 4, a = c8 / 255;
        const bR = t.before[b], bG = t.before[b + 1], bB = t.before[b + 2], bA = t.before[b + 3] / 255;
        if (stroke.erase) {
          const outA = Math.round(t.before[b + 3] * (1 - a));
          buf[o + 3] = outA;
          if (outA === 0) { buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; } else { buf[o] = bR; buf[o + 1] = bG; buf[o + 2] = bB; }
        } else {
          const outA = a + bA * (1 - a);
          buf[o] = Math.round((cr * a + bR * bA * (1 - a)) / outA);
          buf[o + 1] = Math.round((cg * a + bG * bA * (1 - a)) / outA);
          buf[o + 2] = Math.round((cb * a + bB * bA * (1 - a)) / outA);
          buf[o + 3] = Math.round(outA * 255);
        }
      }
    }
    markDirty(x0, y0, x1, y1);
  }

  /** A stamp, and for a material's painting its copies across the edges too, so strokes carry on at the other side. */
  function stampWrapped(cx, cy) {
    stamp(cx, cy);
    if (!texture) return;
    const r = stroke.r + 1;
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
      if (!ox && !oy) continue;
      const x = cx + ox, y = cy + oy;
      if (x + r > 0 && x - r < W && y + r > 0 && y - r < H) stamp(x, y);
    }
  }

  /** Stamps along the segment, spaced well under the radius, so fast strokes have no gaps. */
  function strokeTo(p) {
    const { last, r } = stroke;
    const dx = p.x - last.x, dy = p.y - last.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(0.5, r * 0.3);
    const n = Math.floor(dist / step);
    for (let k = 1; k <= n; k++) stampWrapped(last.x + (dx * k * step) / dist, last.y + (dy * k * step) / dist);
    if (n === 0 || dist - n * step > 0.01) stampWrapped(p.x, p.y);
    stroke.last = p;
  }

  function endStroke(cancel) {
    if (!stroke) return;
    const s = stroke;
    stroke = null;
    if (cancel) { for (const t of s.tiles.values()) copyIn(t.before, t.x, t.y, t.w, t.h); return; }
    if (!s.tiles.size) return;
    const tiles = [];
    for (const t of s.tiles.values()) tiles.push({ x: t.x, y: t.y, w: t.w, h: t.h, before: t.before, after: copyOut(t.x, t.y, t.w, t.h) });
    push({ kind: 'tiles', tiles, bytes: tiles.reduce((a, t) => a + t.before.length * 2, 0), label: s.erase ? 'Erase' : 'Brush stroke' });
  }

  // ---------------------------------------------------------------- undo

  function push(entry) {
    undo.push(entry);
    undoBytes += entry.bytes;
    for (const r of redo) undoBytes -= r.bytes;
    redo = [];
    while (undoBytes > MAX_UNDO_BYTES && undo.length > 1) { const old = undo.shift(); undoBytes -= old.bytes; if (savedMarker === old) savedMarker = 'lost'; }
    changed();
  }

  function apply(entry, which) {
    if (entry.kind === 'tiles') { for (const t of entry.tiles) copyIn(t[which], t.x, t.y, t.w, t.h); return; }
    const s = entry[which]; // full canvas (clear / resize)
    W = s.W; H = s.H; background = s.bg; buf = new Uint8ClampedArray(s.buf); attachBuffer();
  }

  function doUndo() { endStroke(false); const e = undo.pop(); if (!e) return; apply(e, 'before'); redo.push(e); changed(); notice('Undo: ' + e.label, 900); }
  function doRedo() { const e = redo.pop(); if (!e) return; apply(e, 'after'); undo.push(e); changed(); notice('Redo: ' + e.label, 900); }

  function fullState() { return { W, H, bg: background, buf: buf.slice() }; }

  function clearCanvas() {
    const before = fullState();
    if (background === 'white') buf.fill(255); else buf.fill(0);
    markDirty(0, 0, W, H);
    push({ kind: 'full', before, after: fullState(), bytes: before.buf.length * 2, label: 'Clear canvas' });
    notice('Canvas cleared — Ctrl+Z brings it back', 2000);
  }

  /** Changes the canvas size without resampling: the picture keeps its pixels, anchored top-left. */
  function resizeCanvas(w, h) {
    const before = fullState();
    const next = new Uint8ClampedArray(w * h * 4);
    if (background === 'white') next.fill(255);
    const cw = Math.min(w, W), ch = Math.min(h, H);
    for (let y = 0; y < ch; y++) next.set(buf.subarray(y * W * 4, (y * W + cw) * 4), y * w * 4);
    W = w; H = h; buf = next; attachBuffer();
    push({ kind: 'full', before, after: fullState(), bytes: (before.buf.length + buf.length), label: 'Resize canvas' });
    fit();
  }

  const isDirty = () => (undo.length ? undo[undo.length - 1] : null) !== savedMarker;
  let lastPostedDirty = null;
  function changed() {
    const d = isDirty();
    document.title = (d ? '● ' : '') + docName + ' — NoorSketch';
    $('#sketch-undo').disabled = !undo.length;
    $('#sketch-redo').disabled = !redo.length;
    if (d !== lastPostedDirty) { lastPostedDirty = d; bridge.post('sketch.dirty', { dirty: d, name: docName }); }
  }

  // ---------------------------------------------------------------- view: zoom & pan

  function applyView() {
    const c = $('#sketch-canvas');
    c.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    c.classList.toggle('pixelated', zoom >= 2);
    $('#sketch-zoom').textContent = Math.round(zoom * 100) + '%';
    updateCursor();
  }

  function fit() {
    const v = $('#sketch-viewport').getBoundingClientRect();
    zoom = Math.min(1, Math.max(0.02, Math.min((v.width - 40) / W, (v.height - 40) / H)));
    if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;
    panX = (v.width - W * zoom) / 2; panY = (v.height - H * zoom) / 2;
    applyView();
  }

  function actualSize() {
    const v = $('#sketch-viewport').getBoundingClientRect();
    zoomAt(1, v.width / 2, v.height / 2);
  }

  function zoomAt(z, vx, vy) {
    const nz = Math.min(32, Math.max(0.02, z));
    // Keep the canvas point under (vx, vy) where it is.
    const cx = (vx - panX) / zoom, cy = (vy - panY) / zoom;
    zoom = nz;
    panX = vx - cx * zoom; panY = vy - cy * zoom;
    applyView();
  }

  function toCanvas(e) {
    const v = $('#sketch-viewport').getBoundingClientRect();
    return { x: (e.clientX - v.left - panX) / zoom, y: (e.clientY - v.top - panY) / zoom };
  }

  let lastPointer = null;
  function updateCursor(e) {
    const ring = $('#sketch-brush');
    if (e) lastPointer = e;
    if (!lastPointer || tool === 'hand' || spaceDown) { ring.hidden = true; return; }
    const v = $('#sketch-viewport').getBoundingClientRect();
    const d = Math.max(4, size * zoom);
    ring.hidden = false;
    ring.style.width = ring.style.height = d + 'px';
    ring.style.left = (lastPointer.clientX - v.left - d / 2) + 'px';
    ring.style.top = (lastPointer.clientY - v.top - d / 2) + 'px';
    ring.classList.toggle('erase', tool === 'eraser');
  }

  // ---------------------------------------------------------------- pointer input

  function setupPointer() {
    const vp = $('#sketch-viewport');
    vp.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 0 && (tool === 'hand' || spaceDown))) {
        e.preventDefault();
        vp.setPointerCapture(e.pointerId);
        panning = { x: e.clientX, y: e.clientY, px: panX, py: panY };
        vp.classList.add('panning');
        return;
      }
      if (e.button !== 0 || NoorUI.hasOpenModal()) return;
      e.preventDefault();
      if (e.altKey) { pickColor(toCanvas(e)); return; }
      vp.setPointerCapture(e.pointerId);
      beginStroke(toCanvas(e));
    });
    vp.addEventListener('pointermove', (e) => {
      updateCursor(e);
      if (panning) { panX = panning.px + e.clientX - panning.x; panY = panning.py + e.clientY - panning.y; applyView(); return; }
      if (!stroke) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (events.length ? events : [e])) strokeTo(toCanvas(ev));
    });
    const up = () => { if (panning) { panning = null; vp.classList.remove('panning'); } endStroke(false); };
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);
    vp.addEventListener('lostpointercapture', up);
    vp.addEventListener('pointerleave', () => { $('#sketch-brush').hidden = true; });
    window.addEventListener('blur', up);
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const v = vp.getBoundingClientRect();
      if (e.shiftKey) { panX -= e.deltaY; applyView(); return; }
      zoomAt(zoom * Math.pow(1.0015, -e.deltaY), e.clientX - v.left, e.clientY - v.top);
    }, { passive: false });
    vp.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => applyView());
  }

  /** Alt+click: the colour under the pointer (for a material's painting, the painting over the material). */
  function pickColor(p) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4, a = buf[o + 3] / 255;
    let base = background === 'white' ? [255, 255, 255] : [0, 0, 0];
    if (texture && texture.under && texture.show) {
      const u = texture.under, ux = Math.floor((x / W) * u.width), uy = Math.floor((y / H) * u.height), q = (uy * u.width + ux) * 4;
      base = [u.rgba[q], u.rgba[q + 1], u.rgba[q + 2]];
    } else if (background === 'transparent' && a === 0) return;
    const c = [0, 1, 2].map((k) => Math.round(buf[o + k] * a + base[k] * (1 - a)));
    setColor('#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''));
    notice('Colour picked', 700);
  }

  // ---------------------------------------------------------------- material painting

  async function setUnderlay(b64, material) {
    texture.material = material || texture.material;
    const c = $('#sketch-canvas');
    c.style.backgroundImage = `url("data:image/png;base64,${b64}")`;
    try { texture.under = await NoorPng.decode(NoorPng.fromBase64(b64)); } catch { texture.under = null; }
    $('#sketch-material').textContent = `Painting for “${texture.material}”`;
  }

  function showUnderlay(on) {
    texture.show = on;
    document.body.classList.toggle('sk-hide-material', !on);
  }

  async function enterTextureMode(t) {
    texture = { material: t.material, under: null, show: true };
    document.body.classList.add('sk-texture');
    for (const id of ['sketch-new', 'sketch-open', 'sketch-insert', 'sketch-resize']) $('#' + id).hidden = true;
    $('#sketch-with-source').closest('label').hidden = true;
    const apply = $('#sketch-save');
    apply.textContent = 'Apply to material';
    apply.classList.add('primary');
    apply.title = 'Apply to the material (Ctrl+S): NoorMaterial shows it at once';
    apply.setAttribute('aria-label', apply.title);
    const show = el('input', { type: 'checkbox', id: 'sketch-show-material', checked: true });
    show.addEventListener('change', () => showUnderlay(show.checked));
    $('#sketch-file').append(el('span', { class: 'sk-label', id: 'sketch-material' }),
      el('label', { class: 'inline sk-small', title: 'Show the material under your painting (it is not part of the painting)' }, show, 'show the material'));
    $('#sketch-hint').textContent = 'Strokes carry on across the edges, so the painting tiles · Alt+click picks a colour · Wheel zooms · [ ] brush size';
    await setUnderlay(t.underlay, t.material);
  }

  // ---------------------------------------------------------------- toolbar

  function setTool(t) {
    tool = t;
    document.querySelectorAll('[data-tool]').forEach((b) => { const on = b.dataset.tool === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('#sketch-viewport').dataset.tool = t;
    updateCursor();
  }

  function setSize(n) {
    size = Math.min(100, Math.max(1, Math.round(Number(n) || 1)));
    $('#sketch-brush-size').value = String(size);
    $('#sketch-brush-num').value = String(size);
    updateCursor();
  }

  function setColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return false;
    const v = parseInt(m[1], 16);
    color = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    const h = '#' + m[1].toLowerCase();
    $('#sketch-color').value = h;
    $('#sketch-hex').value = h;
    $('#sketch-current').style.background = h;
    document.querySelectorAll('.sk-swatch').forEach((s) => s.classList.toggle('on', s.dataset.color === h));
    if (tool === 'eraser' || tool === 'hand') setTool('brush');
    return true;
  }

  // ---------------------------------------------------------------- files

  async function pngBase64() { return NoorPng.toBase64(await NoorPng.encode(buf, W, H)); }

  async function save(saveAs) {
    endStroke(false);
    try {
      const r = await bridge.request('sketch.save', { png: await pngBase64(), background, saveAs: !!saveAs });
      if (!r || r.cancelled) return false;
      docPath = r.path; docName = r.name || docName;
      savedMarker = undo.length ? undo[undo.length - 1] : null;
      lastPostedDirty = null;
      changed();
      notice(r.applied ? `Applied to “${texture ? texture.material : 'the material'}” ✓` : 'Saved ✓ ' + docName, 1600);
      return true;
    } catch (err) { showError(err); return false; }
  }

  async function confirmDiscard(what) {
    if (!isDirty()) return true;
    const choice = await NoorUI.choose(`Save changes to “${docName}”?`, `Your drawing will be lost if you ${what} without saving.`,
      [{ label: 'Cancel', value: 'cancel' }, { label: 'Don’t save', value: 'discard' }, { label: 'Save', value: 'save', primary: true }]);
    if (choice === 'save') return save(false);
    return choice === 'discard';
  }

  async function load(file) {
    const { width, height, rgba } = await NoorPng.decode(NoorPng.fromBase64(file.png));
    W = width; H = height; background = file.background === 'transparent' ? 'transparent' : 'white';
    buf = rgba;
    attachBuffer();
    undo = []; redo = []; undoBytes = 0; savedMarker = null; docPath = file.path || null; docName = file.name || 'Sketch';
    lastPostedDirty = null;
    fit();
    changed();
  }

  async function open() {
    if (!await confirmDiscard('open another sketch')) return;
    try {
      const r = await bridge.request('sketch.open');
      if (r && r.png) await load(r);
    } catch (err) { showError(err); }
  }

  async function exportPng() {
    try {
      const r = await bridge.request('sketch.exportPng', { png: await pngBase64(), name: docName });
      if (r && r.path) notice('PNG exported to ' + r.path, 3000);
    } catch (err) { showError(err); }
  }

  async function insertIntoDocument() {
    endStroke(false);
    try {
      const r = await bridge.request('sketch.insert', { png: await pngBase64(), background, withSource: $('#sketch-with-source').checked, name: docName });
      if (r && r.inserted) notice('Inserted into “' + r.document + '” as ' + r.link, 3200);
    } catch (err) { showError(err); }
  }

  function showNew() {
    NoorUI.modal({ label: 'New sketch', width: 460 }, (s, close) => {
      const preset = el('select', { id: 'sk-preset', 'aria-label': 'Canvas size' },
        ...PRESETS.map(([w, h]) => el('option', { value: `${w}x${h}`, selected: w === 1920 || undefined }, `${w} × ${h}`)), el('option', { value: 'custom' }, 'Custom…'));
      const wIn = el('input', { type: 'number', id: 'sk-w', min: '1', max: String(MAX_SIDE), value: '1920', 'aria-label': 'Width in pixels' });
      const hIn = el('input', { type: 'number', id: 'sk-h', min: '1', max: String(MAX_SIDE), value: '1080', 'aria-label': 'Height in pixels' });
      const bg = el('select', { id: 'sk-bg', 'aria-label': 'Background' }, el('option', { value: 'white' }, 'White'), el('option', { value: 'transparent' }, 'Transparent'));
      const err = el('p', { class: 'pack-warn', role: 'alert' });
      preset.addEventListener('change', () => { if (preset.value !== 'custom') { const [w, h] = preset.value.split('x'); wIn.value = w; hIn.value = h; } });
      for (const i of [wIn, hIn]) i.addEventListener('input', () => { preset.value = 'custom'; });
      const ok = async () => {
        const w = Math.floor(Number(wIn.value)), h = Math.floor(Number(hIn.value));
        const problem = !(w >= 1 && h >= 1) ? 'Enter a width and height of at least 1 pixel.' : w > MAX_SIDE || h > MAX_SIDE ? `Each side can be at most ${MAX_SIDE} pixels.` : w * h > MAX_PIXELS ? 'That is too many pixels (at most 4096 × 4096 in total).' : null;
        if (problem) { err.textContent = problem; return; }
        close();
        if (!await confirmDiscard('start a new sketch')) return;
        newCanvas(w, h, bg.value);
      };
      s.append(NoorUI.head('New sketch', close), el('div', { class: 'modal-body' },
        el('div', { class: 'pref-grid' }, el('label', { for: 'sk-preset', text: 'Size' }), preset,
          el('label', { for: 'sk-w', text: 'Width × height' }), el('div', { class: 'inline' }, wIn, ' × ', hIn, ' px'),
          el('label', { for: 'sk-bg', text: 'Background' }), bg), err),
      el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => close() }, 'Cancel'), el('button', { class: 'action primary', id: 'sk-create', onclick: ok }, 'Create'))));
    });
  }

  function showResize() {
    NoorUI.modal({ label: 'Canvas size', width: 420 }, (s, close) => {
      const wIn = el('input', { type: 'number', id: 'sk-rw', min: '1', max: String(MAX_SIDE), value: String(W), 'aria-label': 'Width' });
      const hIn = el('input', { type: 'number', id: 'sk-rh', min: '1', max: String(MAX_SIDE), value: String(H), 'aria-label': 'Height' });
      const err = el('p', { class: 'pack-warn', role: 'alert' });
      const ok = () => {
        const w = Math.floor(Number(wIn.value)), h = Math.floor(Number(hIn.value));
        if (!(w >= 1 && h >= 1) || w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) { err.textContent = 'Choose 1–8192 pixels per side, at most 4096 × 4096 in total.'; return; }
        close();
        if (w !== W || h !== H) resizeCanvas(w, h);
      };
      s.append(NoorUI.head('Canvas size', close), el('div', { class: 'modal-body' },
        el('div', { class: 'pref-grid' }, el('label', { for: 'sk-rw', text: 'Width × height' }), el('div', { class: 'inline' }, wIn, ' × ', hIn, ' px')),
        el('p', { class: 'pref-hint', text: 'The drawing keeps its pixels (anchored top-left): nothing is stretched or blurred. Undo restores the previous size.' }), err),
      el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => close() }, 'Cancel'), el('button', { class: 'action primary', onclick: ok }, 'Apply'))));
    });
  }

  function showError(err) {
    console.error(err);
    NoorUI.choose('Something went wrong', (err && err.message) || String(err), [{ label: 'OK', value: true, primary: true }]);
  }

  // ---------------------------------------------------------------- keyboard (scoped to this window)

  function onKey(e) {
    if (NoorUI.hasOpenModal()) { if (e.key === 'Escape') { e.preventDefault(); NoorUI.closeTop(); } return; }
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.target.matches && e.target.matches('input, select, textarea') && !ctrl) return;
    let handled = true;
    if (k === 'Escape') { if (stroke) endStroke(true); else handled = false; }
    else if (k === ' ' && !ctrl) { spaceDown = true; $('#sketch-viewport').classList.add('can-pan'); updateCursor(); }
    else if (ctrl && k === 'z' && !e.shiftKey) doUndo();
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) doRedo();
    else if (ctrl && k === 's') save(e.shiftKey && !texture);
    else if (ctrl && k === 'o') { if (!texture) open(); }
    else if (ctrl && k === 'n') { if (!texture) showNew(); }
    else if (ctrl && k === 'e') exportPng();
    else if (ctrl && k === 'Enter') { if (!texture) insertIntoDocument(); }
    else if (ctrl && k === '0') fit();
    else if (ctrl && k === '1') actualSize();
    else if (ctrl && (k === '=' || k === '+')) { const v = $('#sketch-viewport').getBoundingClientRect(); zoomAt(zoom * 1.25, v.width / 2, v.height / 2); }
    else if (ctrl && k === '-') { const v = $('#sketch-viewport').getBoundingClientRect(); zoomAt(zoom / 1.25, v.width / 2, v.height / 2); }
    else if (!ctrl && !e.altKey && k === 'b') setTool('brush');
    else if (!ctrl && !e.altKey && k === 'e') setTool('eraser');
    else if (!ctrl && !e.altKey && k === 'h') setTool('hand');
    else if (!ctrl && k === '[') setSize(size - (size > 20 ? 5 : 1));
    else if (!ctrl && k === ']') setSize(size + (size >= 20 ? 5 : 1));
    else if (!ctrl && k === 'Delete') clearCanvas();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  // ---------------------------------------------------------------- startup

  async function start() {
    const btn = (id, label, title, fn, cls = '') => { const b = el('button', { class: 'tb-btn ' + cls, id, title, 'aria-label': title }, label); b.addEventListener('click', fn); return b; };
    $('#sketch-file').append(
      btn('sketch-new', 'New', 'New sketch (Ctrl+N)', showNew), btn('sketch-open', 'Open', 'Open a .noorsketch file (Ctrl+O)', open),
      btn('sketch-save', 'Save', 'Save (Ctrl+S) · Save as: Ctrl+Shift+S', () => save(false)), btn('sketch-export', 'PNG', 'Export PNG (Ctrl+E)', exportPng),
      btn('sketch-insert', 'Insert into document', 'Insert into the document open in NoorMD (Ctrl+Enter)', insertIntoDocument, 'primary'),
      el('label', { class: 'inline sk-small', title: 'Also save the editable .noorsketch next to the PNG' }, el('input', { type: 'checkbox', id: 'sketch-with-source', checked: true }), 'keep editable copy'));
    $('#sketch-tools').append(
      btn('tool-brush', '✎ Brush', 'Brush (B)', () => setTool('brush')), btn('tool-eraser', '⌫ Eraser', 'Eraser — makes pixels transparent (E)', () => setTool('eraser')),
      btn('tool-hand', '✋', 'Pan (H, or hold Space, or middle mouse)', () => setTool('hand')));
    $('#tool-brush').dataset.tool = 'brush'; $('#tool-eraser').dataset.tool = 'eraser'; $('#tool-hand').dataset.tool = 'hand';
    const range = el('input', { type: 'range', id: 'sketch-brush-size', min: '1', max: '100', value: String(size), 'aria-label': 'Brush size' });
    const num = el('input', { type: 'number', id: 'sketch-brush-num', min: '1', max: '100', value: String(size), 'aria-label': 'Brush size in pixels' });
    range.addEventListener('input', () => setSize(range.value));
    num.addEventListener('change', () => setSize(num.value));
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setSize(num.value); num.blur(); } }); // back to drawing shortcuts (B, E, [ ])
    range.addEventListener('change', () => range.blur());
    $('#sketch-sizes').append(el('span', { class: 'sk-label', text: 'Size' }), range, num, el('span', { class: 'sk-label', text: 'px' }));
    const colorIn = el('input', { type: 'color', id: 'sketch-color', value: '#1d1b26', 'aria-label': 'Choose any colour' });
    const hex = el('input', { id: 'sketch-hex', value: '#1d1b26', maxlength: '7', 'aria-label': 'Colour as hex', spellcheck: 'false' });
    colorIn.addEventListener('input', () => setColor(colorIn.value));
    hex.addEventListener('change', () => { if (!setColor(hex.value)) hex.value = '#' + color.map((c) => c.toString(16).padStart(2, '0')).join(''); });
    $('#sketch-colors').append(el('span', { class: 'sk-current', id: 'sketch-current', 'aria-hidden': 'true' }),
      ...SWATCHES.map((c) => { const s = el('button', { class: 'sk-swatch', 'data-color': c, title: c, 'aria-label': 'Colour ' + c, style: `background:${c}` }); s.addEventListener('click', () => setColor(c)); return s; }), colorIn, hex);
    $('#sketch-history').append(btn('sketch-undo', '↶', 'Undo (Ctrl+Z)', doUndo), btn('sketch-redo', '↷', 'Redo (Ctrl+Y)', doRedo),
      btn('sketch-clear', 'Clear', 'Clear the canvas (Delete) — undoable', clearCanvas), btn('sketch-resize', 'Canvas…', 'Change the canvas size', showResize));
    $('#sketch-view').append(btn('sketch-zoom-out', '−', 'Zoom out (Ctrl+−)', () => { const v = $('#sketch-viewport').getBoundingClientRect(); zoomAt(zoom / 1.25, v.width / 2, v.height / 2); }),
      el('span', { id: 'sketch-zoom', class: 'sk-zoom', text: '100%' }),
      btn('sketch-zoom-in', '+', 'Zoom in (Ctrl+=)', () => { const v = $('#sketch-viewport').getBoundingClientRect(); zoomAt(zoom * 1.25, v.width / 2, v.height / 2); }),
      btn('sketch-fit', 'Fit', 'Fit to window (Ctrl+0)', fit), btn('sketch-100', '100%', 'Actual pixels (Ctrl+1)', actualSize));
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; $('#sketch-viewport').classList.remove('can-pan'); updateCursor(); } });
    bridge.on('sketch.saveAndClose', async () => { if (await save(false)) bridge.post('sketch.closeNow'); });
    bridge.on('sketch.load', (p) => load(p).catch(showError));
    bridge.on('sketch.underlay', (p) => { if (texture) setUnderlay(p.underlay, p.material); });
    setupPointer();
    setTool('brush');
    setColor('#1d1b26');
    setSize(8);
    let ready = {};
    try { ready = bridge.available ? (await bridge.request('sketch.ready')) || {} : {}; } catch (err) { showError(err); }
    if (ready.file) await load(ready.file).catch((err) => { newCanvas(1920, 1080, 'white'); showError(err); });
    if (ready.texture) await enterTextureMode(ready.texture);
    else newCanvas(ready.width || 1920, ready.height || 1080, ready.background || 'white');
  }

  start();

  return {
    isDirty, save,
    // test hooks
    _state: () => ({ W, H, background, zoom, tool, size, color, undo: undo.length, redo: redo.length, dirty: isDirty(), path: docPath, name: docName, texture: texture ? { material: texture.material, show: texture.show, under: !!texture.under } : null }),
    _pixel: (x, y) => Array.from(buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)),
    _toClient: (x, y) => { const v = document.querySelector('#sketch-viewport').getBoundingClientRect(); return { x: v.left + panX + x * zoom, y: v.top + panY + y * zoom }; },
    _encode: pngBase64,
    _hash: () => { let h = 2166136261; for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ':' + buf.length; },
    _partialAlpha: () => { let n = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0 && buf[i] < 255) n++; return n; },
    _newCanvas: newCanvas,
  };
})();
