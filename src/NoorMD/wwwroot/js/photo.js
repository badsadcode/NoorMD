// NoorPhoto: a layered photo and painting editor (docs/NOORPHOTO_PLAN.md), in the spirit of Photoshop and Affinity
// Photo (no code of anyone's). A document is a list of layers, bottom first: pixel layers (a canvas placed at x, y),
// groups (their children come just before them in the list), fill layers (a colour or a gradient), adjustment layers
// (levels, curves… applied to what is under them) and text layers. Any layer can have a mask, be clipped to the layer
// under it and carry live filters (kept as settings, applied when drawn). The page draws, paints and composes; the app
// opens and saves files (.noorphoto, PSD, pictures). Filters and adjustments are NoorPhotoFx (photofx.js).
window.NoorPhoto = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const Fx = () => window.NoorPhotoFx;
  const MAX_SIDE = 8192;

  // Blend modes: the browser composes the first sixteen itself (on the GPU); the rest are worked out here.
  const BLENDS = [
    ['normal', 'Normal'], ['dissolve', 'Dissolve'], null,
    ['darken', 'Darken'], ['multiply', 'Multiply'], ['color-burn', 'Colour burn'], ['linear-burn', 'Linear burn'], ['darker-color', 'Darker colour'], null,
    ['lighten', 'Lighten'], ['screen', 'Screen'], ['color-dodge', 'Colour dodge'], ['linear-dodge', 'Linear dodge (add)'], ['lighter-color', 'Lighter colour'], null,
    ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['hard-light', 'Hard light'], ['vivid-light', 'Vivid light'], ['linear-light', 'Linear light'], ['pin-light', 'Pin light'], ['hard-mix', 'Hard mix'], null,
    ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['subtract', 'Subtract'], ['divide', 'Divide'], null,
    ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Colour'], ['luminosity', 'Luminosity'],
  ];
  const NATIVE = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'linear-dodge']);

  const TOOLS = [
    ['move', '✥', 'Move (V): the layer, or what is selected', 'v'],
    ['marquee', '⬚', 'Rectangle select (M; again: ellipse). Shift adds, Alt takes away', 'm'],
    ['ellipse', '◌', 'Ellipse select (M twice)', null],
    ['lasso', '➰', 'Lasso (L; again: straight lines)', 'l'],
    ['polygon', '⬠', 'Lasso with straight lines: click the corners, double-click to close', null],
    ['wand', '🪄', 'Magic wand (W): select by colour', 'w'],
    ['crop', '⛶', 'Crop (C): drag the frame, Enter to crop', 'c'],
    ['picker', '💧', 'Eyedropper (I; or hold Alt while painting)', 'i'],
    ['brush', '🖌️', 'Brush (B)', 'b'],
    ['eraser', '🧽', 'Eraser (E)', 'e'],
    ['clone', '⎘', 'Clone stamp (S): Alt+click where to copy from', 's'],
    ['history', '⏮', 'History brush (Y): paints back the picture as it was (choose when with ◎ in History)', 'y'],
    ['heal', '🩹', 'Healing brush (J): like the clone stamp, blended into what is around it', 'j'],
    ['mixer', '🎨', 'Mixer brush (K): wet paint that mixes with the colours under it', 'k'],
    ['smudge', '👆', 'Smudge, blur and sharpen (R)', 'r'],
    ['dodge', '🔆', 'Dodge, burn and sponge (O)', 'o'],
    ['fill', '🪣', 'Paint bucket (G)', 'g'],
    ['gradient', '▤', 'Gradient (G twice): drag across', null],
    ['text', 'T', 'Text (T): click to write', 't'],
    ['shape', '▭', 'Shapes (U): rectangle, ellipse, polygon, star, line; they stay changeable', 'u'],
    ['pen', '✒️', 'Pen (P): click for corners, drag for curves; click the first point to close', 'p'],
    ['assist', '📐', 'Painting guides: a ruler, a vanishing point or an ellipse for the brushes to follow', null],
    ['hand', '✋', 'Hand (H; or hold Space)', 'h'],
    ['zoom', '🔍', 'Zoom (Z): click in, Alt+click out', 'z'],
    ['rotate', '⟲', 'Turn the view (Shift+R; double-click: straight again)', null],
  ];
  const PAINTERS = new Set(['brush', 'eraser', 'clone', 'heal', 'smudge', 'dodge', 'history', 'mixer']);

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  const docs = [];          // the documents open (tabs)
  let D = null;             // the one showing
  let tool = 'brush';
  let fg = '#000000', bg = '#ffffff';
  let recentColours = [];
  let brush = { size: 24, hardness: 0.8, opacity: 1, flow: 1, spacing: 0.15, smoothing: 0, pressureSize: true, pressureOpacity: false, tip: 'round', wetEdges: false, mirror: 'off', sizeJitter: 0, scatter: 0, opacityJitter: 0, hueJitter: 0, brightJitter: 0 };
  let opts = {
    assistType: 'parallel', selMode: 'new', feather: 0, tolerance: 32, contiguous: true, allLayers: false, antiAlias: true,
    gradShape: 'linear', gradTo: 'bg', gradReverse: false, shape: 'rect', shapeFill: true, shapeStroke: 0, shapeDash: 'solid', shapeRadius: 20, shapeSides: 5, starInner: 45, smudgeMode: 'smudge', strength: 0.5,
    dodgeMode: 'dodge', exposure: 0.3, wet: 0.5, load: 0.2, range: 'midtones', cloneAligned: true, cloneAll: false, cropRatio: '', fillAll: false,
  };
  let composite = null, needCompose = true;
  let drag = null;          // the gesture under way
  let hover = null;         // { x, y } in the picture, { sx, sy } on the screen
  let live = null;          // a stroke or a gradient being made: shown in its layer until it is done
  let transform = null;     // free transform under way
  let cropBox = null;       // { x, y, w, h } the crop frame
  let polygon = null;       // the straight-line lasso's corners
  let lastFilter = null;    // { id, params } for Filter › Repeat
  let clip = null;          // copied pixels { canvas, x, y }
  let spaceHeld = false, altHeld = false;
  let antsPhase = 0;

  const isOpen = () => document.body.classList.contains('photo-open');

  // ---------------------------------------------------------------- small helpers

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round = (v) => Math.round(v);
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  const g2 = (c) => c.getContext('2d');
  function copyOf(c) { const n = canvas(c.width, c.height); g2(n).drawImage(c, 0, 0); return n; }
  function imgOf(c, x = 0, y = 0, w = c.width, h = c.height) { const d = g2(c).getImageData(x, y, w, h); return { width: d.width, height: d.height, data: d.data }; }
  function putImg(c, img, x = 0, y = 0) { g2(c).putImageData(new ImageData(img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data), img.width, img.height), x, y); }
  function canvasOfImg(img) { const c = canvas(img.width, img.height); putImg(c, img); return c; }
  const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgbHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const grey = (h) => { const [r, g, b] = hexRgb(h); return round(0.299 * r + 0.587 * g + 0.114 * b); };
  let idSeq = 1;
  const newId = () => 'p' + Date.now().toString(36) + (idSeq++).toString(36);
  /** A rectangle's overlap with another (null when they don't meet). */
  function meet(a, b) {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  const union = (a, b) => { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 }; };
  const intRect = (r) => { const x = Math.floor(r.x), y = Math.floor(r.y); return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y }; };

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  async function pngOf(c, type = 'image/png', quality) {
    const blob = await new Promise((res) => c.toBlob(res, type, quality));
    return b64(new Uint8Array(await blob.arrayBuffer()));
  }
  async function canvasFromBytes(bytes, mime = 'image/png') {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = canvas(bmp.width, bmp.height);
    g2(c).drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  }

  // ---------------------------------------------------------------- documents and layers

  function makeLayer(props) {
    return { id: newId(), name: 'Layer', kind: 'pixel', parent: null, visible: true, locked: false, opacity: 1, blend: 'normal', clip: false, x: 0, y: 0,
      canvas: null, mask: null, fill: null, adjust: null, text: null, shape: null, filters: [], styles: null, fillOpacity: 1, collapsed: false, ver: ++VER, ...props };
  }
  function makeMask(x, y, w, h, background = 255) {
    const c = canvas(w, h);
    if (background) { const x2 = g2(c); x2.fillStyle = '#fff'; x2.fillRect(0, 0, w, h); }
    return { x, y, canvas: c, enabled: true, background, ver: ++VER };
  }
  function newDoc(w, h, background, name) {
    const layers = [];
    if (background !== 'clear') {
      const c = canvas(w, h), x = g2(c);
      x.fillStyle = background === 'bg' ? bg : background === 'black' ? '#000' : '#fff';
      x.fillRect(0, 0, w, h);
      layers.push(makeLayer({ name: 'Background', canvas: c }));
    } else layers.push(makeLayer({ name: 'Layer 1', canvas: canvas(w, h) }));
    return wrapDoc({ width: w, height: h, layers, guides: [] }, null, name);
  }
  function wrapDoc(doc, file, name) {
    const top = doc.layers[doc.layers.length - 1];
    return { doc, file, name: name || (file ? file.name : 'Untitled'), history: [], future: [], at: 0, savedAt: 0, seq: 0, sel: null, selVer: 0, active: top ? top.id : null,
      editMask: false, quickMask: false, view: { zoom: 1, cx: doc.width / 2, cy: doc.height / 2, angle: 0, fitted: true }, showGrid: false, showGuides: true, snap: true };
  }
  const L = () => (D ? D.doc.layers.find((l) => l.id === D.active) || null : null);
  const byId = (id) => D.doc.layers.find((l) => l.id === id) || null;
  const kids = (parent) => D.doc.layers.filter((l) => (l.parent || null) === parent);
  const dirty = (d = D) => !!d && d.at !== d.savedAt;
  function descendants(id) { const out = []; for (const k of kids(id)) { if (k.kind === 'group') out.push(...descendants(k.id)); out.push(k); } return out; }
  /** A layer with everything in it (a group's children come first): one piece of the list. */
  const block = (l) => (l.kind === 'group' ? [...descendants(l.id), l] : [l]);
  /** Puts the list back in order: each group's children just before it, in the order they had. */
  function tidy() {
    const walk = (p) => kids(p).flatMap((l) => (l.kind === 'group' ? [...walk(l.id), l] : [l]));
    const ids = new Set(D.doc.layers.map((l) => l.id));
    for (const l of D.doc.layers) if (l.parent && (!ids.has(l.parent) || byId(l.parent).kind !== 'group')) l.parent = null;
    D.doc.layers = walk(null);
  }
  /** Where the layer is drawn: its picture's rectangle in the document. */
  function boundsOf(l) {
    if (l.kind === 'pixel' && l.canvas) return { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height };
    if (l.kind === 'text') { const t = textCanvas(l); return { x: l.x, y: l.y, w: t.width, h: t.height }; }
    if (l.kind === 'shape') return shapeBounds(l);
    if (l.kind === 'group') return descendants(l.id).filter((k) => k.kind !== 'group').map(boundsOf).reduce((a, b) => (a ? union(a, b) : b), null) || { x: 0, y: 0, w: D.doc.width, h: D.doc.height };
    return { x: 0, y: 0, w: D.doc.width, h: D.doc.height };
  }
  // Versions come from one counter, so a picture put back by undo never looks like one seen before (the caches key on them).
  let VER = 1;
  const touch = (l) => { l.ver = ++VER; needCompose = true; };
  const touchMask = (l) => { if (l.mask) l.mask.ver = ++VER; if (l.id === '__quick') { D.selVer = ++VER; ants = null; } needCompose = true; };

  // ---------------------------------------------------------------- undo: steps that know how to go back

  // A step is { label, undo, redo }. Painting keeps only the rectangle it changed (before and after); changes to the
  // layers keep the list and each layer's settings (pictures are shared, not copied). Old steps go when they pass
  // the limit or the memory kept for them grows too big.
  const MAX_STEPS = 60, MAX_BYTES = 1.2e9;
  function pushStep(label, undo, redo, bytes = 0) {
    D.future = [];
    D.history.push({ label, undo, redo, bytes, id: ++D.seq });
    D.at = D.seq;
    let total = D.history.reduce((a, s) => a + s.bytes, 0);
    while (D.history.length > MAX_STEPS || (total > MAX_BYTES && D.history.length > 1)) { total -= D.history.shift().bytes; }
    afterChange();
  }
  /** Everything about the layers but the pixels (shared): enough to put the document back as it was. */
  function snap() {
    return { width: D.doc.width, height: D.doc.height, guides: D.doc.guides.map((g) => ({ ...g })), active: D.active,
      layers: D.doc.layers.map((l) => ({ ref: l, props: { ...l, mask: l.mask ? { ...l.mask } : null, filters: JSON.parse(JSON.stringify(l.filters || [])), fill: clone(l.fill), adjust: clone(l.adjust), text: clone(l.text), styles: clone(l.styles), shape: clone(l.shape) } })) };
  }
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  function restore(s) {
    D.doc.width = s.width; D.doc.height = s.height; D.doc.guides = s.guides.map((g) => ({ ...g }));
    D.doc.layers = s.layers.map(({ ref, props }) => { Object.assign(ref, props, { mask: props.mask ? { ...props.mask } : null, filters: clone(props.filters), fill: clone(props.fill), adjust: clone(props.adjust), text: clone(props.text), styles: clone(props.styles), shape: clone(props.shape) }); ref.ver = ++VER; if (ref.mask) ref.mask.ver = ++VER; return ref; });
    D.active = s.active && byId(s.active) ? s.active : (D.doc.layers[D.doc.layers.length - 1] || {}).id;
    needCompose = true;
  }
  /** A change to the layers (their list or settings, or a picture replaced by a new one), as one step. */
  function change(label, fn) {
    if (!D) return;
    const before = snap();
    if (fn() === false) return;
    tidy();
    const after = snap();
    pushStep(label, () => restore(before), () => restore(after), 0);
  }
  /** Painting into a layer's picture or mask: keeps the changed rectangle (before and after). */
  function pixelStep(label, l, target, rect, fn) {
    const c = target === 'mask' ? l.mask.canvas : l.canvas;
    const r = meet(intRect(rect), { x: 0, y: 0, w: c.width, h: c.height });
    if (!r) { fn(); return; }
    const before = g2(c).getImageData(r.x, r.y, r.w, r.h);
    fn();
    const after = g2(c).getImageData(r.x, r.y, r.w, r.h);
    const put = (d) => () => { const cc = target === 'mask' ? l.mask && l.mask.canvas : l.canvas; if (cc) g2(cc).putImageData(d, r.x, r.y); if (target === 'mask') touchMask(l); else touch(l); };
    if (target === 'mask') touchMask(l); else touch(l);
    pushStep(label, put(before), put(after), r.w * r.h * 8);
  }
  function undo() {
    if (!D || !D.history.length) return;
    cancelGestures();
    const s = D.history.pop(); s.undo(); D.future.push(s);
    D.at = D.history.length ? D.history[D.history.length - 1].id : 0;
    afterChange();
  }
  function redo() {
    if (!D || !D.future.length) return;
    cancelGestures();
    const s = D.future.pop(); s.redo(); D.history.push(s); D.at = s.id;
    afterChange();
  }
  /** History panel: back (or forward) to just after step i (−1: the start). */
  function goToStep(i) {
    while (D.history.length > i + 1) undo();
    while (D.history.length < i + 1 && D.future.length) redo();
  }
  function afterChange() { scheduleDraft(); needCompose = true; renderLayers(); renderProps(); renderHistory(); renderTitle(); draw(); }

  // ---------------------------------------------------------------- composing the picture

  /** The whole picture, flattened (a canvas the document's size). Layers under the one being edited are kept. */
  let below = null; // { key, canvas, upTo }
  function compose(d = D, { noCache = false } = {}) {
    const prev = D; D = d;
    try {
      const W = d.doc.width, H = d.doc.height, out = canvas(W, H);
      const top = kids(null);
      // Layers under the one being edited (and its clipping set) change rarely: they are composed once and kept.
      let start = 0;
      const act = L();
      if (!noCache && act) {
        let t = act; while (t.parent && byId(t.parent)) t = byId(t.parent);
        start = top.indexOf(t);
        while (start > 0 && top[start].clip && top[start - 1].kind !== 'adjust') start--;
        if (start > 0) {
          const key = `${W}x${H}|` + top.slice(0, start).map(sig).join(';');
          if (!below || below.key !== key || below.doc !== d) {
            const c = canvas(W, H);
            renderItems(top.slice(0, start), c);
            below = { key, canvas: c, doc: d };
          }
          g2(out).drawImage(below.canvas, 0, 0);
        }
      }
      renderItems(top.slice(Math.max(0, start)), out, start > 0 ? top.slice(0, start) : null);
      return out;
    } finally { D = prev; }
  }
  /** Everything that changes how a layer looks, in a few characters. */
  function sig(l) {
    let s = `${l.id}:${l.ver}:${l.visible ? 1 : 0}:${l.opacity}:${l.blend}:${l.clip ? 1 : 0}:${l.x},${l.y}`;
    if (l.mask) s += `:m${l.mask.ver},${l.mask.enabled ? 1 : 0},${l.mask.x},${l.mask.y}`;
    if (l.filters && l.filters.length) s += ':f' + JSON.stringify(l.filters);
    if (l.adjust) s += ':a' + JSON.stringify(l.adjust);
    if (l.fill) s += ':F' + JSON.stringify(l.fill);
    if (l.text) s += ':t' + JSON.stringify(l.text);
    if (l.styles) s += ':s' + JSON.stringify(l.styles);
    if (l.shape) s += ':g' + JSON.stringify(l.shape);
    if (l.fillOpacity !== 1 && l.fillOpacity !== undefined) s += ':o' + l.fillOpacity;
    if (l.kind === 'group') s += '[' + kids(l.id).map(sig).join(';') + ']';
    return s;
  }

  /** Draws layers (bottom first) onto a canvas: each with its mask, clipped layers inside the one under them. */
  function renderItems(items, target, under) {
    void under;
    for (let i = 0; i < items.length; i++) {
      const base = items[i];
      const run = [];
      if (base.kind !== 'adjust') { let j = i + 1; while (j < items.length && items[j].clip) run.push(items[j++]); i = j - 1; }
      if (!base.visible) continue;
      if (base.kind === 'adjust') { applyAdjust(base, target, null); continue; }
      backdropNow = target;
      const own = itemCanvas(base);
      backdropNow = null;
      if (!own) continue;
      let content = own.canvas, dx = own.x, dy = own.y;
      const shown = run.filter((c) => c.visible);
      if (shown.length) {
        // The clipping set: the base's picture, with each clipped layer drawn only where the base has pixels.
        const W = D.doc.width, H = D.doc.height, grp = canvas(W, H), baseFull = canvas(W, H);
        g2(baseFull).drawImage(content, dx, dy);
        g2(grp).drawImage(baseFull, 0, 0);
        for (const c of shown) {
          if (c.kind === 'adjust') { applyAdjust(c, grp, baseFull); continue; }
          const cc = itemCanvas(c);
          if (!cc) continue;
          const t = canvas(W, H), tx = g2(t);
          tx.drawImage(cc.canvas, cc.x, cc.y);
          tx.globalCompositeOperation = 'destination-in';
          tx.drawImage(baseFull, 0, 0);
          drawBlend(grp, t, c.blend, c.opacity, 0, 0);
        }
        content = grp; dx = 0; dy = 0;
      }
      drawBlend(target, content, base.blend, base.opacity, dx, dy);
    }
  }

  /** A layer's own picture as drawn (live filters, mask): { canvas, x, y }, or null when there's nothing to draw. */
  function itemCanvas(l) {
    let c = null, x = 0, y = 0;
    if (l.kind === 'pixel') { const p = layerPixels(l); if (!p) return null; c = p.canvas; x = p.x; y = p.y; }
    else if (l.kind === 'text') { if (l.typing) return null; c = draft && draft.l === l ? draft.canvas : withFilters(l, textCanvas(l)); x = l.x; y = l.y; }
    else if (l.kind === 'fill') { c = draft && draft.l === l ? draft.canvas : withFilters(l, fillCanvas(l)); }
    else if (l.kind === 'shape') { c = transform && transform.l === l ? transform.preview() : draft && draft.l === l ? draft.canvas : withFilters(l, shapeCanvas(l)); }
    else if (l.kind === 'group') { c = canvas(D.doc.width, D.doc.height); renderItems(kids(l.id), c); }
    if (!c) return null;
    let res = { canvas: c, x, y };
    if (l.mask && l.mask.enabled && !(D.editMask && D.showMaskOnly)) {
      const W = D.doc.width, H = D.doc.height, t = canvas(W, H), tx = g2(t);
      tx.drawImage(c, x, y);
      tx.globalCompositeOperation = 'destination-in';
      tx.drawImage(maskFull(l), 0, 0);
      res = { canvas: t, x: 0, y: 0 };
    }
    return styled(l, res);
  }

  const styleCache = new WeakMap();
  let backdropNow = null; // what is under the layer being drawn (for effects in a blend mode)
  /** The layer's styles (shadow, glow, stroke, bevel…) and fill opacity, drawn round its picture. */
  function styled(l, res) {
    const S = window.NoorPhotoStyle;
    if (!S || !(S.any(l.styles) || (l.fillOpacity ?? 1) < 1) || noStyles) return res;
    const back = S.blended && S.blended(l.styles) && backdropNow && backdropNow.width === D.doc.width ? backdropNow : null;
    const changing = (live && live.l === l) || (transform && transform.l === l) || (draft && draft.l === l) || l.kind === 'group' || !!back;
    const key = `${sig(l)}|${D.doc.width}x${D.doc.height}|${D.editMask && D.showMaskOnly ? 1 : 0}`;
    const hit = styleCache.get(l);
    if (!changing && hit && hit.key === key) return hit.res;
    let out;
    try { out = S.render(res, l.styles || {}, l.fillOpacity ?? 1, D.doc.width, D.doc.height, back); } catch (err) { console.warn('NoorPhoto: layer style', err); return res; }
    if (!changing) styleCache.set(l, { key, res: out });
    return out;
  }
  let noStyles = false;

  /** A pixel layer's picture: with the stroke being painted, a transform being made, or its live filters. */
  function layerPixels(l) {
    if (!l.canvas) return null;
    if (transform && transform.l === l && !transform.selection) return { canvas: transform.preview(), x: 0, y: 0 };
    if (live && live.l === l && live.target === 'canvas') return { canvas: live.show(), x: l.x, y: l.y };
    let base = l.canvas;
    if (transform && transform.l === l && transform.selection) {
      base = copyOf(l.canvas);
      const bx = g2(base);
      bx.globalCompositeOperation = 'destination-out'; bx.drawImage(transform.hole, -l.x, -l.y);
      bx.globalCompositeOperation = 'source-over'; bx.drawImage(transform.preview(), -l.x, -l.y);
      return { canvas: base, x: l.x, y: l.y };
    }
    if (draft && draft.l === l && draft.target === 'canvas') return { canvas: draft.canvas, x: l.x, y: l.y };
    return { canvas: withFilters(l, base), x: l.x, y: l.y };
  }

  const fxCache = new WeakMap();
  /** The picture with the layer's live filters applied (kept until the picture or the filters change). */
  function withFilters(l, c) {
    const on = (l.filters || []).filter((f) => f.enabled !== false);
    if (!on.length || !Fx()) return c;
    const key = `${l.ver}|${c.width}x${c.height}|${JSON.stringify(on)}`;
    const hit = fxCache.get(l);
    if (hit && hit.key === key && hit.src === c) return hit.out;
    let img = imgOf(c);
    for (const f of on) { try { img = Fx().apply(f.id, img, f.params || {}, { scale: 1, seed: 1 }); } catch (err) { console.warn('NoorPhoto: filter', f.id, err); } }
    const out = canvasOfImg(img);
    fxCache.set(l, { key, src: c, out });
    return out;
  }

  const maskCache = new WeakMap();
  /** A mask as a canvas the document's size whose alpha is the mask (its background outside its rectangle). */
  function maskFull(l) {
    const m = l.mask, W = D.doc.width, H = D.doc.height, key = `${m.ver}|${m.x},${m.y}|${W}x${H}|${m.background}`;
    const painting = (live && live.l === l && live.target === 'mask') || (draft && draft.l === l && draft.target === 'mask');
    const hit = maskCache.get(m);
    if (!painting && hit && hit.key === key) return hit.canvas;
    const mc = !painting ? m.canvas : live && live.l === l ? live.show() : draft.canvas;
    const c = canvas(W, H), x = g2(c);
    if (m.background) { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.clearRect(m.x, m.y, mc.width, mc.height); }
    x.drawImage(mc, m.x, m.y);
    if (!painting) maskCache.set(m, { key, canvas: c });
    return c;
  }

  const fillCache = new WeakMap();
  /** A fill layer's picture: a colour, or a gradient across the document. */
  function fillCanvas(l) {
    const W = D.doc.width, H = D.doc.height, key = `${W}x${H}|${JSON.stringify(l.fill)}`;
    const hit = fillCache.get(l);
    if (hit && hit.key === key) return hit.canvas;
    const c = canvas(W, H), f = l.fill || { type: 'colour', colour: '#808080' };
    if (f.type === 'gradient') {
      const a = (f.angle || 0) * Math.PI / 180, cx = W / 2, cy = H / 2, half = (Math.abs(Math.cos(a)) * W + Math.abs(Math.sin(a)) * H) / 2 * (f.scale || 100) / 100;
      paintGradient(c, f.shape || 'linear', cx - Math.cos(a) * half, cy - Math.sin(a) * half, cx + Math.cos(a) * half, cy + Math.sin(a) * half, f.stops || ['#000000', '#ffffff'], !!f.reverse, f.shape === 'radial');
    } else if (f.type === 'pattern') {
      const tile = patternTile(f);
      if (!tile) return c; // a picture pattern still being read: drawn when it is ready
      const x = g2(c), pat = x.createPattern(tile, 'repeat');
      pat.setTransform(new DOMMatrix().scale((f.scale || 100) / 100));
      x.fillStyle = pat; x.fillRect(0, 0, W, H);
    } else { const x = g2(c); x.fillStyle = f.colour || '#808080'; x.fillRect(0, 0, W, H); }
    fillCache.set(l, { key, canvas: c });
    return c;
  }

  // Patterns: ready-made ones drawn in two colours, or a picture of your own (Edit › Define a pattern), kept in the
  // fill layer itself so the file carries it.
  const PATTERNS = [['checker', 'checks'], ['stripes', 'stripes'], ['diagonal', 'diagonal stripes'], ['dots', 'dots'], ['grid', 'grid'], ['bricks', 'bricks'], ['zigzag', 'zigzag'], ['hex', 'hexagons'], ['noise', 'noise']];
  const tileCache = new Map(), pictureTiles = new Map();
  function patternTile(f) {
    if (f.image) {
      if (pictureTiles.has(f.image)) return pictureTiles.get(f.image);
      const img = new Image();
      img.onload = () => { const c = canvas(img.naturalWidth, img.naturalHeight); g2(c).drawImage(img, 0, 0); pictureTiles.set(f.image, c); needCompose = true; draw(); renderLayers(); };
      img.src = 'data:image/png;base64,' + f.image;
      pictureTiles.set(f.image, null);
      return null;
    }
    const a = f.a || '#000000', b = f.b || '#ffffff', key = `${f.pattern}|${a}|${b}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const n = 32, c = canvas(n, n), x = g2(c);
    x.fillStyle = b; x.fillRect(0, 0, n, n); x.fillStyle = a; x.strokeStyle = a;
    switch (f.pattern) {
      case 'stripes': x.fillRect(0, 0, n, n / 2); break;
      case 'diagonal': x.lineWidth = n / 4; x.beginPath(); for (const o of [-n, 0, n]) { x.moveTo(o, n); x.lineTo(o + n, 0); } x.stroke(); break;
      case 'dots': x.beginPath(); x.arc(n / 2, n / 2, n / 5, 0, Math.PI * 2); x.fill(); break;
      case 'grid': x.fillRect(0, 0, n, 2); x.fillRect(0, 0, 2, n); break;
      case 'bricks': x.fillRect(0, 0, n, 2); x.fillRect(0, n / 2, n, 2); x.fillRect(n / 2, 0, 2, n / 2); x.fillRect(0, n / 2, 2, n / 2); break;
      case 'zigzag': x.lineWidth = 3; x.beginPath(); x.moveTo(0, n * 0.7); x.lineTo(n / 2, n * 0.3); x.lineTo(n, n * 0.7); x.stroke(); break;
      case 'hex': { x.lineWidth = 2; const r = n / 3.46; x.beginPath(); for (const [cx, cy] of [[n / 2, n / 2], [0, 0], [n, 0], [0, n], [n, n]]) { for (let i = 0; i <= 6; i++) { const t = Math.PI / 3 * i + Math.PI / 6, px2 = cx + Math.cos(t) * r, py2 = cy + Math.sin(t) * r; if (i) x.lineTo(px2, py2); else x.moveTo(px2, py2); } } x.stroke(); break; }
      case 'noise': { const img = x.getImageData(0, 0, n, n), d = img.data, [ar, ag, ab] = hexRgb(a), [br, bg2, bb] = hexRgb(b); let seed = 99; for (let i = 0; i < n * n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const t = (seed >> 8 & 255) / 255; d[i * 4] = br + (ar - br) * t; d[i * 4 + 1] = bg2 + (ag - bg2) * t; d[i * 4 + 2] = bb + (ab - bb) * t; d[i * 4 + 3] = 255; } x.putImageData(img, 0, 0); break; }
      default: x.fillRect(0, 0, n / 2, n / 2); x.fillRect(n / 2, n / 2, n / 2, n / 2);
    }
    tileCache.set(key, c);
    return c;
  }
  const PATTERN_KEY = 'noorphoto.patterns';
  function myPatterns() { try { return JSON.parse(localStorage.getItem(PATTERN_KEY) || '[]') || []; } catch { return []; } }
  /** Edit › Define a pattern: the selection (or the whole picture), at most 512 pixels a side, kept with your patterns. */
  async function definePattern() {
    const l = L(), r = D.sel ? selBounds() : { x: 0, y: 0, w: D.doc.width, h: D.doc.height };
    if (!r) return;
    let c = canvas(r.w, r.h);
    g2(c).drawImage(composite || compose(D), -r.x, -r.y);
    if (c.width > 512 || c.height > 512) { const k = 512 / Math.max(c.width, c.height); c = scaled(c, c.width * k, c.height * k); }
    void l;
    const name = await NoorUI.prompt('Define a pattern', 'Its name', `Pattern ${myPatterns().length + 1}`);
    if (name === undefined) return;
    const list = [...myPatterns(), { name: name.trim() || 'Pattern', image: await pngOf(c) }].slice(-24);
    try { localStorage.setItem(PATTERN_KEY, JSON.stringify(list)); notice('Pattern kept: Layer › New fill layer › Pattern', 2200); } catch { notice('There is no room to keep more patterns.', 2400); }
  }

  const textCache = new WeakMap();
  const textFont = (t) => `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size || 48}px ${/[\s,"']/.test(t.font || '') ? `"${(t.font || '').replace(/"/g, '')}"` : (t.font || 'sans-serif')}, sans-serif`;
  /** A text layer's picture: its lines, measured to fit. */
  function textCanvas(l) {
    const t = l.text || {}, key = JSON.stringify(t);
    const hit = textCache.get(l);
    if (hit && hit.key === key) return hit.canvas;
    const size = t.size || 48, lh = size * (t.lineHeight || 1.25);
    const m = g2(canvas(1, 1));
    m.font = textFont(t);
    if ('letterSpacing' in m) m.letterSpacing = `${t.tracking || 0}px`;
    // Paragraph text (a box): words wrap at its width; point text: each line as long as it is.
    let lines = String(t.text || ' ').split('\n');
    if (t.box > 0) {
      const room = Math.max(1, t.box - size * 0.2);
      lines = lines.flatMap((para) => {
        const out = [];
        let cur = '';
        for (const word of para.split(/(\s+)/)) {
          const next = cur + word;
          if (cur && m.measureText(next.trimEnd()).width > room && word.trim()) { out.push(cur.trimEnd()); cur = word.trimStart(); } else cur = next;
        }
        out.push(cur);
        return out;
      });
    }
    const w = t.box > 0 ? Math.ceil(t.box) : Math.max(1, ...lines.map((s) => Math.ceil(m.measureText(s).width))) + Math.ceil(size * 0.2), h = Math.ceil(lh * lines.length + size * 0.3);
    const c = canvas(w, h), x = g2(c);
    x.font = m.font;
    if ('letterSpacing' in x) x.letterSpacing = `${t.tracking || 0}px`;
    x.fillStyle = t.colour || '#000000';
    x.textBaseline = 'alphabetic';
    x.textAlign = t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left';
    const ax = t.align === 'center' ? w / 2 : t.align === 'right' ? w - size * 0.1 : size * 0.1;
    lines.forEach((s, i) => x.fillText(s, ax, size + i * lh));
    textCache.set(l, { key, canvas: c });
    return c;
  }

  /** An adjustment layer: what is under it (the canvas so far), changed, laid back over through its mask. */
  function applyAdjust(l, target, limit) {
    if (!l.adjust || !Fx()) return;
    const img = imgOf(target);
    let out;
    try { out = Fx().apply(l.adjust.id, img, l.adjust.params || {}, { scale: 1, seed: 1 }); } catch (err) { console.warn('NoorPhoto: adjustment', err); return; }
    const t = canvasOfImg(out), tx = g2(t);
    if (l.mask && l.mask.enabled) { tx.globalCompositeOperation = 'destination-in'; tx.drawImage(maskFull(l), 0, 0); }
    if (limit) { tx.globalCompositeOperation = 'destination-in'; tx.drawImage(limit, 0, 0); }
    drawBlend(target, t, l.blend, l.opacity, 0, 0);
  }

  /** Draws a picture onto a canvas with a blend mode and an opacity. */
  function drawBlend(target, src, blend, opacity, dx, dy) {
    if (opacity <= 0) return;
    if (NATIVE.has(blend)) {
      const x = g2(target);
      x.save();
      x.globalAlpha = opacity;
      x.globalCompositeOperation = blend === 'normal' ? 'source-over' : blend === 'linear-dodge' ? 'lighter' : blend;
      x.drawImage(src, dx, dy);
      x.restore();
      return;
    }
    blendPixels(target, src, blend, opacity, dx, dy);
  }

  // The blend modes the browser doesn't have, per channel on 0…1 (b: what is under, s: the layer).
  const BLEND_FN = {
    'linear-burn': (b, s) => Math.max(0, b + s - 1),
    'vivid-light': (b, s) => (s <= 0.5 ? (s <= 0 ? 0 : Math.max(0, 1 - (1 - b) / (2 * s))) : (s >= 1 ? 1 : Math.min(1, b / (2 * (1 - s))))),
    'linear-light': (b, s) => clamp(b + 2 * s - 1, 0, 1),
    'pin-light': (b, s) => (s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
    'hard-mix': (b, s) => (b + s >= 1 ? 1 : 0),
    subtract: (b, s) => Math.max(0, b - s),
    divide: (b, s) => (s <= 0 ? (b > 0 ? 1 : 0) : Math.min(1, b / s)),
  };
  function blendPixels(target, src, blend, opacity, dx, dy) {
    const r = meet({ x: dx, y: dy, w: src.width, h: src.height }, { x: 0, y: 0, w: target.width, h: target.height });
    if (!r) return;
    const bd = g2(target).getImageData(r.x, r.y, r.w, r.h), sd = g2(src).getImageData(r.x - dx, r.y - dy, r.w, r.h);
    const B = bd.data, S = sd.data, fn = BLEND_FN[blend];
    const lum = (r1, g1, b1) => 0.3 * r1 + 0.59 * g1 + 0.11 * b1;
    let seed = 0x9e3779b9;
    for (let i = 0; i < B.length; i += 4) {
      let as = S[i + 3] / 255 * opacity;
      if (as <= 0) continue;
      if (blend === 'dissolve') {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        if (((seed >>> 0) / 4294967296) >= as) continue;
        B[i] = S[i]; B[i + 1] = S[i + 1]; B[i + 2] = S[i + 2]; B[i + 3] = 255; continue;
      }
      const ab = B[i + 3] / 255;
      const cb = [B[i] / 255, B[i + 1] / 255, B[i + 2] / 255], cs = [S[i] / 255, S[i + 1] / 255, S[i + 2] / 255];
      let mix;
      if (blend === 'darker-color') mix = lum(...cs) < lum(...cb) ? cs : cb;
      else if (blend === 'lighter-color') mix = lum(...cs) > lum(...cb) ? cs : cb;
      else mix = [fn(cb[0], cs[0]), fn(cb[1], cs[1]), fn(cb[2], cs[2])];
      const ao = as + ab * (1 - as);
      for (let k = 0; k < 3; k++) {
        const c2 = (1 - ab) * cs[k] + ab * mix[k];
        B[i + k] = Math.round(((as * c2 + (1 - as) * ab * cb[k]) / ao) * 255);
      }
      B[i + 3] = Math.round(ao * 255);
      void as;
    }
    g2(target).putImageData(bd, r.x, r.y);
  }

  /** Paints a gradient onto a canvas between two points (linear, radial, angle, reflected, diamond). */
  function paintGradient(c, shape, x0, y0, x1, y1, stops, reverse, fromCentre) {
    void fromCentre;
    const x = g2(c), list = reverse ? [...stops].reverse() : stops;
    const add = (gr) => { list.forEach((s, i) => gr.addColorStop(list.length === 1 ? 0 : i / (list.length - 1), s)); return gr; };
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    if (shape === 'linear') { x.fillStyle = add(x.createLinearGradient(x0, y0, x1, y1)); x.fillRect(0, 0, c.width, c.height); return; }
    if (shape === 'radial') { x.fillStyle = add(x.createRadialGradient(x0, y0, 0, x0, y0, len)); x.fillRect(0, 0, c.width, c.height); return; }
    if (shape === 'angle' && x.createConicGradient) { x.fillStyle = add(x.createConicGradient(Math.atan2(y1 - y0, x1 - x0), x0, y0)); x.fillRect(0, 0, c.width, c.height); return; }
    if (shape === 'reflected') {
      const gr = x.createLinearGradient(2 * x0 - x1, 2 * y0 - y1, x1, y1);
      const n = list.length, rev = [...list].reverse();
      [...rev, ...list.slice(1)].forEach((s, i, all) => gr.addColorStop(i / (all.length - 1), s));
      void n;
      x.fillStyle = gr; x.fillRect(0, 0, c.width, c.height); return;
    }
    // A diamond: the distance is the larger of the two along and across the line.
    const W = c.width, H = c.height, img = x.createImageData(W, H), d = img.data;
    const lut = canvas(256, 1), lx = g2(lut);
    lx.fillStyle = add(lx.createLinearGradient(0, 0, 256, 0)); lx.fillRect(0, 0, 256, 1);
    const ld = lx.getImageData(0, 0, 256, 1).data, ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let yy = 0, i = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++, i += 4) {
        const px = xx + 0.5 - x0, py = yy + 0.5 - y0;
        const t = Math.min(255, Math.floor(Math.max(Math.abs(px * ux + py * uy), Math.abs(-px * uy + py * ux)) / len * 255));
        d[i] = ld[t * 4]; d[i + 1] = ld[t * 4 + 1]; d[i + 2] = ld[t * 4 + 2]; d[i + 3] = ld[t * 4 + 3];
      }
    }
    x.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------- the view: where the picture is on the screen

  let frameReq = 0;
  function draw() { if (!frameReq) frameReq = requestAnimationFrame(() => { frameReq = 0; paint(); }); }
  function stageSize() { const r = $('#ph-stage').getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; }
  function toScreen(x, y) {
    const v = D.view, s = stageSize(), a = v.angle * Math.PI / 180, dx = (x - v.cx) * v.zoom, dy = (y - v.cy) * v.zoom;
    return { x: s.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: s.h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
  }
  function toDoc(sx, sy) {
    const v = D.view, s = stageSize(), a = -v.angle * Math.PI / 180, dx = sx - s.w / 2, dy = sy - s.h / 2;
    return { x: v.cx + (dx * Math.cos(a) - dy * Math.sin(a)) / v.zoom, y: v.cy + (dx * Math.sin(a) + dy * Math.cos(a)) / v.zoom };
  }
  function viewTransform(x) {
    const v = D.view, s = stageSize();
    x.translate(s.w / 2, s.h / 2); x.rotate(v.angle * Math.PI / 180); x.scale(v.zoom, v.zoom); x.translate(-v.cx, -v.cy);
  }
  function fit() {
    if (!D) return;
    const s = stageSize();
    D.view.zoom = Math.min(8, Math.max(0.01, Math.min((s.w - 40) / D.doc.width, (s.h - 40) / D.doc.height)));
    D.view.cx = D.doc.width / 2; D.view.cy = D.doc.height / 2; D.view.fitted = true;
    draw(); status();
  }
  function zoomTo(z, at) {
    if (!D) return;
    z = clamp(z, 0.01, 64);
    const s = stageSize(), p = at || { x: s.w / 2, y: s.h / 2 }, before = toDoc(p.x, p.y);
    D.view.zoom = z; D.view.fitted = false;
    const after = toDoc(p.x, p.y);
    D.view.cx += before.x - after.x; D.view.cy += before.y - after.y;
    draw(); status();
  }
  const ZOOMS = [0.01, 0.02, 0.03, 0.05, 0.0625, 0.083, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64];
  const zoomStep = (dir, at) => zoomTo(dir > 0 ? (ZOOMS.find((z) => z > D.view.zoom * 1.001) || 64) : ([...ZOOMS].reverse().find((z) => z < D.view.zoom / 1.001) || 0.01), at);

  let checker = null;
  function paint() {
    const cv = $('#ph-canvas');
    if (!cv || !built || !isOpen()) return;
    const s = stageSize(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(s.w * dpr) || cv.height !== Math.round(s.h * dpr)) { cv.width = Math.round(s.w * dpr); cv.height = Math.round(s.h * dpr); }
    const x = g2(cv);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, s.w, s.h);
    if (!D) return;
    if (needCompose || !composite) { composite = compose(D); needCompose = false; scheduleHisto(); }
    const W = D.doc.width, H = D.doc.height;
    x.save();
    viewTransform(x);
    if (!checker) {
      const t = canvas(16, 16), tx = g2(t);
      tx.fillStyle = '#ffffff'; tx.fillRect(0, 0, 16, 16); tx.fillStyle = '#d6d6d6'; tx.fillRect(0, 0, 8, 8); tx.fillRect(8, 8, 8, 8);
      checker = t;
    }
    x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 12 / D.view.zoom;
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.shadowBlur = 0; x.shadowColor = 'transparent';
    // The checkerboard stays the same size on the screen whatever the zoom.
    const pat = x.createPattern(checker, 'repeat');
    pat.setTransform(new DOMMatrix().scale(1 / D.view.zoom));
    x.fillStyle = pat; x.fillRect(0, 0, W, H);
    x.imageSmoothingEnabled = D.view.zoom < 2;
    x.imageSmoothingQuality = 'high';
    const l = L();
    if (D.editMask && D.showMaskOnly && l && l.mask) {
      const m = maskFull(l), t = canvas(W, H), tx = g2(t);
      tx.fillStyle = '#000'; tx.fillRect(0, 0, W, H); tx.drawImage(m, 0, 0);
      x.drawImage(t, 0, 0);
    } else if (D.wrap) {
      // Wrap around: the picture tiled round itself, so the seams of a tile can be painted across.
      for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) { if (dx || dy) { x.fillStyle = pat; x.fillRect(dx, dy, W, H); } x.drawImage(composite, dx, dy); }
    } else x.drawImage(composite, 0, 0);
    if (D.quickMask && D.sel) {
      // Quick mask: what isn't selected is covered in red.
      const t = canvas(W, H), tx = g2(t), selNow = live && live.l.id === '__quick' ? live.show() : D.sel;
      tx.fillStyle = 'rgba(255,0,0,.5)'; tx.fillRect(0, 0, W, H);
      tx.globalCompositeOperation = 'destination-out'; tx.drawImage(selNow, 0, 0);
      x.drawImage(t, 0, 0);
    }
    if (D.showGrid) drawGrid(x);
    if (D.view.zoom >= 8 && settings.pixelGrid) drawPixelGrid(x);
    x.restore();
    x.lineWidth = 1;
    if (D.showGuides) for (const g of D.doc.guides) {
      const a = g.axis === 'x' ? [toScreen(g.at, -1e5), toScreen(g.at, 1e5)] : [toScreen(-1e5, g.at), toScreen(1e5, g.at)];
      x.strokeStyle = '#19d3ff'; x.beginPath(); x.moveTo(a[0].x, a[0].y); x.lineTo(a[1].x, a[1].y); x.stroke();
    }
    if (D.sel && !D.quickMask) drawAnts(x, s);
    if (polygon) {
      x.strokeStyle = '#fff'; x.setLineDash([4, 4]); x.beginPath();
      polygon.forEach((p, i) => { const q = toScreen(p.x, p.y); if (i) x.lineTo(q.x, q.y); else x.moveTo(q.x, q.y); });
      if (hover) x.lineTo(hover.sx, hover.sy);
      x.stroke(); x.setLineDash([]);
    }
    if (drag && drag.path && (tool === 'lasso')) {
      x.strokeStyle = '#fff'; x.setLineDash([4, 4]); x.beginPath();
      drag.path.forEach((p, i) => { const q = toScreen(p.x, p.y); if (i) x.lineTo(q.x, q.y); else x.moveTo(q.x, q.y); });
      x.stroke(); x.setLineDash([]);
    }
    if (drag && drag.rect && (tool === 'marquee' || tool === 'ellipse' || tool === 'shape' || tool === 'text')) outlineRect(x, drag.rect, tool === 'ellipse' || (tool === 'shape' && opts.shape === 'ellipse'));
    if (drag && drag.line) { const a = toScreen(drag.line.x0, drag.line.y0), b = toScreen(drag.line.x1, drag.line.y1); x.strokeStyle = '#fff'; x.setLineDash([5, 3]); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); x.setLineDash([]); }
    drawAssists(x);
    if (PAINTERS.has(tool) && brush.mirror && brush.mirror !== 'off') {
      x.save(); x.strokeStyle = 'rgba(25,211,255,.6)'; x.setLineDash([6, 4]); x.beginPath();
      if (brush.mirror !== 'v') { const a = toScreen(D.doc.width / 2, 0), b = toScreen(D.doc.width / 2, D.doc.height); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); }
      if (brush.mirror !== 'h') { const a = toScreen(0, D.doc.height / 2), b = toScreen(D.doc.width, D.doc.height / 2); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); }
      x.stroke(); x.restore();
    }
    if (drag && drag.kind === 'assist' && opts.assistType === 'ellipse') { const l2 = drag.line; outlineRect(x, { x: Math.min(l2.x0, l2.x1), y: Math.min(l2.y0, l2.y1), w: Math.abs(l2.x1 - l2.x0), h: Math.abs(l2.y1 - l2.y0) }, true); }
    if (typing) placeTyping();
    if (pen || tool === 'pen') drawPen(x);
    if (cropBox) drawCrop(x, s);
    if (transform) drawTransformBox(x);
    if (D.cloneFrom && (tool === 'clone' || tool === 'heal') && hover) {
      const off = drag && drag.cloneOffset ? drag.cloneOffset : null;
      const at = off ? toScreen(hover.x + off.x, hover.y + off.y) : toScreen(D.cloneFrom.x, D.cloneFrom.y);
      x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(at.x - 6, at.y); x.lineTo(at.x + 6, at.y); x.moveTo(at.x, at.y - 6); x.lineTo(at.x, at.y + 6); x.stroke();
    }
    if (hover && PAINTERS.has(tool) && !spaceHeld && !altHeld) {
      // The brush's size, round the cursor (a thin double ring that shows on light and dark).
      const r = Math.max(1, brush.size / 2 * D.view.zoom);
      x.beginPath(); x.arc(hover.sx, hover.sy, r, 0, Math.PI * 2); x.strokeStyle = 'rgba(0,0,0,.7)'; x.stroke();
      x.beginPath(); x.arc(hover.sx, hover.sy, r + 1, 0, Math.PI * 2); x.strokeStyle = 'rgba(255,255,255,.8)'; x.stroke();
      x.fillStyle = '#fff'; x.fillRect(hover.sx - 0.5, hover.sy - 3, 1, 6); x.fillRect(hover.sx - 3, hover.sy - 0.5, 6, 1);
    }
  }
  function outlineRect(x, r, oval) {
    const pts = [toScreen(r.x, r.y), toScreen(r.x + r.w, r.y), toScreen(r.x + r.w, r.y + r.h), toScreen(r.x, r.y + r.h)];
    for (const [col, dash] of [['#000', []], ['#fff', [4, 4]]]) {
      x.strokeStyle = col; x.setLineDash(dash); x.beginPath();
      if (oval) {
        x.save(); viewTransform(x); x.beginPath(); x.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2); x.restore();
      } else { pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); }
      x.stroke();
    }
    x.setLineDash([]);
  }
  function drawGrid(x) {
    const step = settings.gridSize, W = D.doc.width, H = D.doc.height;
    x.strokeStyle = 'rgba(120,120,255,.45)'; x.lineWidth = 1 / D.view.zoom; x.beginPath();
    for (let gx = step; gx < W; gx += step) { x.moveTo(gx, 0); x.lineTo(gx, H); }
    for (let gy = step; gy < H; gy += step) { x.moveTo(0, gy); x.lineTo(W, gy); }
    x.stroke();
  }
  function drawPixelGrid(x) {
    const s = stageSize(), a = toDoc(0, 0), b = toDoc(s.w, s.h), c2 = toDoc(s.w, 0), d2 = toDoc(0, s.h);
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c2.x, d2.x))), x1 = Math.min(D.doc.width, Math.ceil(Math.max(a.x, b.x, c2.x, d2.x)));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c2.y, d2.y))), y1 = Math.min(D.doc.height, Math.ceil(Math.max(a.y, b.y, c2.y, d2.y)));
    x.strokeStyle = 'rgba(128,128,128,.35)'; x.lineWidth = 1 / D.view.zoom; x.beginPath();
    for (let gx = x0; gx <= x1; gx++) { x.moveTo(gx, y0); x.lineTo(gx, y1); }
    for (let gy = y0; gy <= y1; gy++) { x.moveTo(x0, gy); x.lineTo(x1, gy); }
    x.stroke();
  }

  // Marching ants: the selection's edge found at the screen's own resolution (sharp at any zoom), redrawn with a
  // moving black-and-white dash.
  let ants = null; // { key, canvas }
  function drawAnts(x, s) {
    const key = `${D.selVer}|${D.view.zoom}|${D.view.cx},${D.view.cy}|${D.view.angle}|${s.w}x${s.h}`;
    if (!ants || ants.key !== key || ants.doc !== D) {
      const w = Math.ceil(s.w), h = Math.ceil(s.h), m = canvas(w, h), mx = g2(m);
      mx.save(); viewTransform(mx); mx.imageSmoothingEnabled = D.view.zoom < 1; mx.drawImage(D.sel, 0, 0); mx.restore();
      const src = mx.getImageData(0, 0, w, h).data, out = mx.createImageData(w, h), o = out.data;
      const on = (i) => src[i * 4 + 3] >= 128;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const i = yy * w + xx;
        if (!on(i)) continue;
        if (xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1 || !on(i - 1) || !on(i + 1) || !on(i - w) || !on(i + w)) o[i * 4 + 3] = 255;
      }
      const e = canvas(w, h); g2(e).putImageData(out, 0, 0);
      ants = { key, canvas: e, doc: D };
    }
    const w = ants.canvas.width, h = ants.canvas.height, t = canvas(w, h), tx = g2(t);
    tx.fillStyle = '#000'; tx.fillRect(0, 0, w, h);
    tx.strokeStyle = '#fff'; tx.lineWidth = 3; tx.beginPath();
    for (let d = -h - 8 + (antsPhase % 8); d < w + h; d += 8) { tx.moveTo(d, 0); tx.lineTo(d + h, h); }
    tx.stroke();
    tx.globalCompositeOperation = 'destination-in'; tx.drawImage(ants.canvas, 0, 0);
    x.drawImage(t, 0, 0, s.w, s.h);
  }

  // ---------------------------------------------------------------- the selection: a mask the document's size

  // D.sel is a canvas whose alpha is how much of each pixel is selected (null: nothing selected, everything is
  // worked on). Shapes are drawn into it; Shift adds, Alt takes away, both keep only the overlap.
  function setSel(c, keepLast = true) {
    if (keepLast && D.sel) D.lastSel = D.sel;
    D.sel = c; D.selVer = ++VER; ants = null;
    draw(); status(); renderOptions();
  }
  function shapeMask(drawFn) {
    const c = canvas(D.doc.width, D.doc.height), x = g2(c);
    x.fillStyle = '#fff'; x.strokeStyle = '#fff';
    drawFn(x);
    return c;
  }
  function featherCanvas(c, r) {
    if (!(r > 0)) return c;
    const out = canvas(c.width, c.height), x = g2(out);
    x.filter = `blur(${r / 2}px)`; x.drawImage(c, 0, 0); x.filter = 'none';
    return out;
  }
  function combineSel(shape, mode) {
    shape = featherCanvas(shape, opts.feather);
    if (mode === 'new' || !D.sel) { if (mode === 'subtract') return; setSel(shape); return; }
    const out = copyOf(D.sel), x = g2(out);
    x.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
    x.drawImage(shape, 0, 0);
    setSel(isEmpty(out) ? null : out);
  }
  function isEmpty(c) { const d = g2(c).getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; }
  const selBoundsCache = { ver: -1, r: null };
  /** The selection's rectangle (null: nothing selected). */
  function selBounds() {
    if (!D.sel) return null;
    if (selBoundsCache.ver === D.selVer) return selBoundsCache.r;
    const W = D.sel.width, H = D.sel.height, d = g2(D.sel).getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    selBoundsCache.ver = D.selVer; selBoundsCache.r = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    return selBoundsCache.r;
  }
  const selectAll = () => { if (D) setSel(shapeMask((x) => x.fillRect(0, 0, D.doc.width, D.doc.height))); };
  const deselect = () => { if (D && D.sel) setSel(null); };
  const reselect = () => { if (D && D.lastSel) setSel(D.lastSel); };
  function invertSel() {
    if (!D) return;
    const c = shapeMask((x) => x.fillRect(0, 0, D.doc.width, D.doc.height));
    if (D.sel) { const x = g2(c); x.globalCompositeOperation = 'destination-out'; x.drawImage(D.sel, 0, 0); }
    setSel(c);
  }
  /** Grow (r > 0) or shrink (r < 0) the selection by r pixels (a distance transform, so corners stay true). */
  function growSel(r) {
    if (!D || !D.sel || !r) return;
    const W = D.doc.width, H = D.doc.height, img = g2(D.sel).getImageData(0, 0, W, H), d = img.data, n = W * H;
    const inside = new Uint8Array(n); for (let i = 0; i < n; i++) inside[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    const grow = r > 0, want = grow ? 1 : 0, dist = new Float32Array(n);
    for (let i = 0; i < n; i++) dist[i] = inside[i] === want ? 0 : 1e9;
    const A = 1, B = Math.SQRT2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let v = dist[i];
      if (x > 0) v = Math.min(v, dist[i - 1] + A);
      if (y > 0) { v = Math.min(v, dist[i - W] + A); if (x > 0) v = Math.min(v, dist[i - W - 1] + B); if (x < W - 1) v = Math.min(v, dist[i - W + 1] + B); }
      dist[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; let v = dist[i];
      if (x < W - 1) v = Math.min(v, dist[i + 1] + A);
      if (y < H - 1) { v = Math.min(v, dist[i + W] + A); if (x < W - 1) v = Math.min(v, dist[i + W + 1] + B); if (x > 0) v = Math.min(v, dist[i + W - 1] + B); }
      dist[i] = v;
    }
    const R = Math.abs(r);
    for (let i = 0; i < n; i++) {
      const on = grow ? dist[i] <= R : (inside[i] && dist[i] > R);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = on ? 255 : 0;
    }
    const c = canvas(W, H); g2(c).putImageData(img, 0, 0);
    setSel(isEmpty(c) ? null : c);
  }
  function featherSel(r) { if (D && D.sel && r > 0) setSel(featherCanvas(D.sel, r)); }
  /** Pixels of a layer (or of the whole picture) as the selection: where they aren't see-through. */
  function selFromAlpha(l, mode = 'new') {
    const c = canvas(D.doc.width, D.doc.height), x = g2(c);
    const own = l ? itemCanvas(l) : { canvas: composite || compose(D), x: 0, y: 0 };
    if (!own) return;
    x.drawImage(own.canvas, own.x, own.y);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    const keep = opts.feather; opts.feather = 0; combineSel(c, mode); opts.feather = keep;
  }
  /** The picture the eyedropper, the wand and the bucket look at: the layer, or everything (opts.allLayers). */
  function sampleSource(all) {
    const W = D.doc.width, H = D.doc.height;
    if (all) return g2(composite || compose(D)).getImageData(0, 0, W, H).data;
    const l = L(), c = canvas(W, H);
    if (l) { const own = l.kind === 'group' || l.kind === 'adjust' ? null : itemCanvas(l); if (own) g2(c).drawImage(own.canvas, own.x, own.y); }
    return g2(c).getImageData(0, 0, W, H).data;
  }
  /** Pixels like the one at x, y (within the tolerance): touching it (contiguous) or anywhere. */
  function similar(src, sx, sy, tol, contiguous) {
    const W = D.doc.width, H = D.doc.height, out = new Uint8Array(W * H);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return out;
    const i0 = (sy * W + sx) * 4, r0 = src[i0], g0 = src[i0 + 1], b0 = src[i0 + 2], a0 = src[i0 + 3];
    const near = (p) => Math.max(Math.abs(src[p] - r0), Math.abs(src[p + 1] - g0), Math.abs(src[p + 2] - b0), Math.abs(src[p + 3] - a0)) <= tol;
    if (!contiguous) { for (let i = 0; i < W * H; i++) if (near(i * 4)) out[i] = 1; return out; }
    const stack = [sy * W + sx]; out[sy * W + sx] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !out[j] && near(j * 4)) { out[j] = 1; stack.push(j); }
    }
    return out;
  }
  function maskFromBits(bits) {
    const W = D.doc.width, H = D.doc.height, c = canvas(W, H), x = g2(c), img = x.createImageData(W, H), d = img.data;
    for (let i = 0; i < W * H; i++) if (bits[i]) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 255; }
    x.putImageData(img, 0, 0);
    return c;
  }
  function wand(p, mode) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    combineSel(maskFromBits(similar(sampleSource(opts.allLayers), x, y, opts.tolerance, opts.contiguous)), mode);
  }
  /** Select › Colour range: every pixel near a colour, softly (fuzziness), in the whole picture or the layer. */
  function colourRange(hex, fuzz, all, mode = 'new') {
    const W = D.doc.width, H = D.doc.height, src = sampleSource(all), [r0, g0, b0] = hexRgb(hex);
    const c = canvas(W, H), x = g2(c), img = x.createImageData(W, H), d = img.data;
    for (let i = 0; i < W * H; i++) {
      const p = i * 4, dist = Math.sqrt(((src[p] - r0) ** 2 + (src[p + 1] - g0) ** 2 + (src[p + 2] - b0) ** 2) / 3);
      const v = src[p + 3] ? clamp(1 - (dist - fuzz * 0.5) / Math.max(1, fuzz), 0, 1) : 0;
      d[p] = d[p + 1] = d[p + 2] = 255; d[p + 3] = Math.round(v * 255);
    }
    x.putImageData(img, 0, 0);
    const keep = opts.feather; opts.feather = 0; combineSel(c, mode); opts.feather = keep;
  }
  /**
   * Select › Subject: the main thing in the picture, found without any model: the colours along the border are taken
   * as the background (a few clusters of them); what is clearly unlike them, in one piece with the middle, holes
   * filled, is the subject. Best on a plain or blurred background; refine it after if need be.
   */
  function selectSubject(mode = 'new') {
    const src = composite || compose(D), k = Math.min(1, 384 / Math.max(src.width, src.height));
    const small = k < 1 ? scaled(src, src.width * k, src.height * k) : src, w = small.width, h = small.height, d = imgOf(small).data, n = w * h;
    // The background: k-means (5 clusters) of the pixels round the border.
    const border = [];
    for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) if (y >= 0 && y < h) border.push((y * w + x) * 4);
    for (let y = 2; y < h - 2; y++) for (const x of [0, 1, w - 2, w - 1]) if (x >= 0 && x < w) border.push((y * w + x) * 4);
    const K = 5, cent = [];
    for (let i = 0; i < K; i++) { const p2 = border[Math.floor((i + 0.5) / K * border.length)]; cent.push([d[p2], d[p2 + 1], d[p2 + 2]]); }
    for (let it = 0; it < 8; it++) {
      const sum = cent.map(() => [0, 0, 0, 0]);
      for (const p2 of border) { let best = 0, bd = Infinity; cent.forEach((c, i) => { const dd = (d[p2] - c[0]) ** 2 + (d[p2 + 1] - c[1]) ** 2 + (d[p2 + 2] - c[2]) ** 2; if (dd < bd) { bd = dd; best = i; } }); const s2 = sum[best]; s2[0] += d[p2]; s2[1] += d[p2 + 1]; s2[2] += d[p2 + 2]; s2[3]++; }
      sum.forEach((s2, i) => { if (s2[3]) cent[i] = [s2[0] / s2[3], s2[1] / s2[3], s2[2] / s2[3]]; });
    }
    // How unlike the background each pixel is; Otsu's threshold splits the two.
    const dist = new Float32Array(n);
    let mx = 1;
    for (let i = 0; i < n; i++) { const p2 = i * 4; let bd = Infinity; for (const c of cent) { const dd = (d[p2] - c[0]) ** 2 + (d[p2 + 1] - c[1]) ** 2 + (d[p2 + 2] - c[2]) ** 2; if (dd < bd) bd = dd; } dist[i] = d[p2 + 3] ? Math.sqrt(bd) : 0; if (dist[i] > mx) mx = dist[i]; }
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) hist[Math.min(255, Math.floor(dist[i] / mx * 255))]++;
    let total = 0, sumAll = 0; for (let i = 0; i < 256; i++) { total += hist[i]; sumAll += i * hist[i]; }
    let wb = 0, sb = 0, bestT = 0, bestV = -1;
    for (let t = 0; t < 256; t++) { wb += hist[t]; if (!wb) continue; const wf = total - wb; if (!wf) break; sb += t * hist[t]; const mb = sb / wb, mf = (sumAll - sb) / wf, v = wb * wf * (mb - mf) ** 2; if (v > bestV) { bestV = v; bestT = t; } }
    const thr = Math.max(bestT / 255 * mx, 18);
    const fgBits = new Uint8Array(n);
    for (let i = 0; i < n; i++) fgBits[i] = dist[i] > thr ? 1 : 0;
    // Pieces: keep the biggest, those touching the middle, and any at least a tenth of the biggest.
    const lab = new Int32Array(n), sizes = [0];
    let next = 1;
    for (let i = 0; i < n; i++) {
      if (!fgBits[i] || lab[i]) continue;
      const stack = [i]; lab[i] = next; let count = 0;
      while (stack.length) { const j = stack.pop(), x = j % w, y = (j - x) / w; count++; for (const q of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (q >= 0 && fgBits[q] && !lab[q]) { lab[q] = next; stack.push(q); } }
      sizes.push(count); next++;
    }
    if (next === 1) { notice('No subject stands out from the background here.', 2400); return; }
    const biggest = sizes.reduce((a, b, i) => (b > sizes[a] ? i : a), 1), keep = new Set([biggest]);
    for (let y = Math.floor(h * 0.4); y < h * 0.6; y++) for (let x = Math.floor(w * 0.4); x < w * 0.6; x++) if (lab[y * w + x]) keep.add(lab[y * w + x]);
    sizes.forEach((sz, i) => { if (i && sz >= sizes[biggest] * 0.1) keep.add(i); });
    const subj = new Uint8Array(n);
    for (let i = 0; i < n; i++) subj[i] = keep.has(lab[i]) ? 1 : 0;
    // Holes: whatever the outside can't reach is inside the subject.
    const out = new Uint8Array(n), stack = [];
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const j = y * w + x; if (!subj[j] && !out[j]) { out[j] = 1; stack.push(j); } }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const j = y * w + x; if (!subj[j] && !out[j]) { out[j] = 1; stack.push(j); } }
    while (stack.length) { const j = stack.pop(), x = j % w, y = (j - x) / w; for (const q of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (q >= 0 && !subj[q] && !out[q]) { out[q] = 1; stack.push(q); } }
    const m = canvas(w, h), mx2 = g2(m), img = mx2.createImageData(w, h);
    for (let i = 0; i < n; i++) if (!out[i]) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255; }
    mx2.putImageData(img, 0, 0);
    // Back to full size with a soft, then firmed, edge.
    const full = canvas(D.doc.width, D.doc.height), fx = g2(full);
    fx.imageSmoothingQuality = 'high'; fx.filter = `blur(${Math.max(1, 1 / k)}px)`; fx.drawImage(m, 0, 0, full.width, full.height); fx.filter = 'none';
    const fi = fx.getImageData(0, 0, full.width, full.height), fd = fi.data;
    for (let i = 3; i < fd.length; i += 4) fd[i] = clamp((fd[i] - 128) * 3 + 128, 0, 255);
    fx.putImageData(fi, 0, 0);
    const keepF = opts.feather; opts.feather = 0; combineSel(full, mode); opts.feather = keepF;
    notice('Subject selected: Select › Refine to adjust, Shift+lasso to add, Alt+lasso to take away.', 3000);
  }
  /** Limits a picture (the document's size) to the selection. */
  function limitToSel(c, ox = 0, oy = 0) {
    if (!D.sel) return c;
    const x = g2(c); x.save(); x.globalCompositeOperation = 'destination-in'; x.drawImage(D.sel, -ox, -oy); x.restore();
    return c;
  }

  // ---------------------------------------------------------------- painting

  // A stroke paints into a buffer (alpha builds up with the flow, never past the stroke's opacity), shown in its layer
  // while it goes on and laid down when the button is let go, limited to the selection. Smudging, dodging and their
  // kind change a working copy of the layer instead.
  const stampCache = new Map();
  // Brush tips: round (soft to hard), square, chalk (grainy, broken edges); the spray tip is drawn dot by dot.
  const TIPS = [['round', 'round'], ['square', 'square'], ['chalk', 'chalk'], ['spray', 'spray'], ['bristle', 'bristles']];
  let grain = null;
  function grainTexture() {
    if (grain) return grain;
    const n = 128, c = canvas(n, n), x = g2(c), img = x.createImageData(n, n);
    let seed = 1234567;
    for (let i = 0; i < n * n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const v = (seed >> 8) & 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = v > 90 ? 255 : v * 2; }
    x.putImageData(img, 0, 0);
    return (grain = c);
  }
  function stampOf(size, hardness, colour, tip = 'round', wet = false) {
    const d = Math.max(2, Math.ceil(size) + 2), key = `${d}|${hardness}|${colour}|${tip}|${wet ? 1 : 0}`;
    if (stampCache.has(key)) return stampCache.get(key);
    const c = canvas(d, d), x = g2(c), r = size / 2;
    const [cr, cg, cb] = hexRgb(colour);
    // Wet edges: the paint pools at the rim, as watercolour does (lighter in the middle, darker at the edge).
    const gr = wet ? x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, Math.max(0.5, r)) : x.createRadialGradient(d / 2, d / 2, Math.max(0, r * Math.min(0.999, hardness)), d / 2, d / 2, Math.max(0.5, r));
    if (wet) { gr.addColorStop(0, `rgba(${cr},${cg},${cb},.4)`); gr.addColorStop(Math.max(0.5, Math.min(0.92, 0.6 + hardness * 0.3)), `rgba(${cr},${cg},${cb},.85)`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`); }
    else { gr.addColorStop(0, `rgba(${cr},${cg},${cb},1)`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`); }
    if (tip === 'square') { x.fillStyle = colour; x.fillRect((d - size) / 2, (d - size) / 2, size, size); }
    else { x.fillStyle = gr; x.beginPath(); x.arc(d / 2, d / 2, Math.max(0.5, r), 0, Math.PI * 2); x.fill(); }
    if (tip === 'chalk') { x.globalCompositeOperation = 'destination-in'; x.drawImage(grainTexture(), Math.random() * -64, Math.random() * -64, Math.max(d, 128), Math.max(d, 128)); }
    if (stampCache.size > 64) stampCache.delete(stampCache.keys().next().value);
    stampCache.set(key, c);
    return c;
  }
  /** Makes a layer's picture (or mask) cover the whole document, so paint can go anywhere on it. True when it grew. */
  function cover(l, target) {
    const o = target === 'mask' ? l.mask : l, c = o.canvas, cur = { x: o.x, y: o.y, w: c.width, h: c.height };
    const need = union(cur, { x: 0, y: 0, w: D.doc.width, h: D.doc.height });
    if (need.w === cur.w && need.h === cur.h && need.x === cur.x && need.y === cur.y) return false;
    const n = canvas(need.w, need.h), x = g2(n);
    if (target === 'mask' && o.background) { x.fillStyle = '#fff'; x.fillRect(0, 0, need.w, need.h); x.clearRect(cur.x - need.x, cur.y - need.y, cur.w, cur.h); }
    x.drawImage(c, cur.x - need.x, cur.y - need.y);
    o.canvas = n; o.x = need.x; o.y = need.y;
    return true;
  }
  const originOf = (l, target) => (target === 'mask' ? l.mask : l);
  /** Lays a buffer (in the target's own pixels) onto a canvas: paint, erase, or a mask's grey. */
  function applyPaint(dst, l, target, buf, how) {
    const o = originOf(l, target);
    const lim = (c) => (D.sel && l.id !== '__quick' ? limitToSel(copyOf(c), o.x, o.y) : c);
    const x = g2(dst);
    x.save();
    if (target === 'mask') {
      const cov = lim(how.cover || buf), val = how.valueCanvas ? lim(how.valueCanvas) : cov;
      x.globalAlpha = how.opacity; x.globalCompositeOperation = 'destination-out'; x.drawImage(cov, 0, 0);
      x.globalAlpha = how.opacity * (how.valueCanvas ? 1 : how.value / 255); x.globalCompositeOperation = 'lighter'; x.drawImage(val, 0, 0);
    } else {
      x.globalAlpha = how.opacity;
      x.globalCompositeOperation = how.erase ? 'destination-out' : (l.lockAlpha ? 'source-atop' : 'source-over');
      x.drawImage(lim(buf), 0, 0);
    }
    x.restore();
  }
  /** Where paint goes now: the layer's mask while it is being edited, else its picture (null: it can't be painted). */
  function paintTarget(quiet) {
    const l = L();
    const say = (t) => { if (!quiet) notice(t, 2200); return null; };
    // Quick mask: painting goes to the selection itself (white selects, black leaves out).
    if (D.quickMask && D.sel) return { l: quickLayer(), target: 'mask' };
    if (!l) return say('No layer to paint on.');
    if (!l.visible) return say('That layer is hidden.');
    if (D.editMask && l.mask) return { l, target: 'mask' };
    if (l.locked) return say('That layer is locked.');
    if (l.kind !== 'pixel') return say(l.kind === 'group' ? 'Choose a layer in the group: a group has no pixels of its own.' : 'Paint on a pixel layer (Layer › Rasterize turns this one into pixels), or on its mask.');
    return { l, target: 'canvas' };
  }

  let quick = null;
  function quickLayer() {
    if (!quick || quick.mask.canvas !== D.sel) quick = { id: '__quick', name: 'Quick mask', kind: 'pixel', visible: true, mask: { canvas: D.sel, x: 0, y: 0, background: 0, enabled: true, ver: ++VER } };
    return quick;
  }
  function startStroke(p, e) {
    const t = paintTarget();
    if (!t) return null;
    if (tool === 'history' && !D.histSrc) historySource(t.l);
    const { l, target } = t, before = snap(), grew = cover(l, target), o = originOf(l, target), c = o.canvas;
    const work = tool === 'smudge' || tool === 'dodge' || tool === 'mixer';
    const s = {
      l, target, before: grew ? before : null, kind: work ? 'work' : 'buffer', tool, bbox: null,
      buf: work ? null : canvas(c.width, c.height), work: work ? copyOf(c) : null, origin: { x: o.x, y: o.y },
      last: null, carry: 0, pressure: pressureOf(e), smooth: { x: p.x, y: p.y },
      colour: target === 'mask' ? '#ffffff' : (tool === 'eraser' ? '#000000' : fg),
    };
    if (tool === 'history') {
      const src = historySource(l);
      if (!src) { notice('This layer wasn\'t there at the state chosen for the history brush.', 3000); if (s.before) restore(s.before); return null; }
      s.source = src; s.cloneOffset = { x: 0, y: 0 };
    }
    if (tool === 'clone' || tool === 'heal') {
      if (!D.cloneFrom) { notice('Alt+click where to copy from first.', 2600); if (s.before) restore(s.before); return null; }
      if (!opts.cloneAligned || !D.cloneOffset || D.cloneFresh) { D.cloneOffset = { x: D.cloneFrom.x - p.x, y: D.cloneFrom.y - p.y }; D.cloneFresh = false; }
      s.cloneOffset = D.cloneOffset;
      s.source = canvas(D.doc.width, D.doc.height);
      if (opts.cloneAll) g2(s.source).drawImage(composite || compose(D), 0, 0);
      else { const own = itemCanvas(l); if (own) g2(s.source).drawImage(own.canvas, own.x, own.y); }
    }
    s.show = () => {
      if (s.kind === 'work') {
        if (!D.sel || l.id === '__quick') return s.work;
        const out = copyOf(c), x = g2(out), w = limitToSel(copyOf(s.work), o.x, o.y);
        x.globalCompositeOperation = 'destination-out'; x.drawImage(limitToSel(fullOf(c), o.x, o.y), 0, 0);
        x.globalCompositeOperation = 'lighter'; x.drawImage(w, 0, 0);
        return out;
      }
      const out = copyOf(c);
      applyPaint(out, l, target, s.wet ? wetten(s.buf) : s.buf, { opacity: brush.opacity, erase: s.tool === 'eraser', value: grey(s.tool === 'eraser' ? bg : fg) });
      return out;
    };
    s.assist = assistAt(p); s.anchor = { x: p.x, y: p.y };
    s.wet = brush.wetEdges && tool === 'brush' && target === 'canvas';
    live = s;
    dab(s, p, s.pressure);
    s.last = { ...p };
    return s;
  }
  /** Wet edges: the whole stroke paler inside and darker along its rim, as watercolour dries. */
  function wetten(buf) {
    const out = canvas(buf.width, buf.height), x = g2(out), ring = copyOf(buf), r = g2(ring);
    r.globalCompositeOperation = 'destination-out'; r.filter = `blur(${Math.max(1.5, brush.size / 7)}px)`; r.drawImage(buf, 0, 0); r.filter = 'none';
    x.globalAlpha = 0.45; x.drawImage(buf, 0, 0); x.globalAlpha = 1;
    x.drawImage(ring, 0, 0); x.drawImage(ring, 0, 0);
    return out;
  }
  const fullOf = (c) => { const f = canvas(c.width, c.height), x = g2(f); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); return f; };
  function pressureOf(e) { return e && e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1; }

  /** Moves the stroke on to p, putting dabs along the way (closer together for smaller brushes). */
  function strokeTo(s, p, pressure) {
    let to = p;
    if (brush.smoothing > 0) {
      // A string pulls the brush: it moves only when the cursor is further away than the string is long.
      const len = brush.smoothing / D.view.zoom, dx = p.x - s.smooth.x, dy = p.y - s.smooth.y, d = Math.hypot(dx, dy);
      if (d <= len) return;
      s.smooth = { x: p.x - dx / d * len, y: p.y - dy / d * len };
      to = s.smooth;
    }
    const from = s.last, dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist > 0.5) s.dir = Math.atan2(to.y - from.y, to.x - from.x);
    const spacing = s.kind === 'work' ? (s.tool === 'mixer' ? 0.12 : 0.25) : brush.tip === 'bristle' ? 0.04 : brush.spacing;
    const step = Math.max(0.5, brush.size * spacing * (brush.pressureSize ? Math.max(0.2, pressure) : 1));
    let t = step - s.carry;
    while (t <= dist) {
      const k = t / dist;
      dab(s, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }, s.pressure + (pressure - s.pressure) * k);
      t += step;
    }
    s.carry = dist - (t - step);
    s.last = { ...to }; s.pressure = pressure;
  }

  function dab(s, p, pressure) {
    // Dynamics: each dab a little smaller, further off the line, lighter or of a shifted colour, by chance (the same
    // for its mirrored and wrapped copies, so they match).
    const rnd = Math.random;
    const size = Math.max(1, brush.size * (brush.pressureSize ? Math.max(0.05, pressure) : 1) * (1 - brush.sizeJitter * rnd()));
    if (brush.scatter > 0) p = { x: p.x + (rnd() - 0.5) * 2 * brush.scatter * size, y: p.y + (rnd() - 0.5) * 2 * brush.scatter * size };
    const alpha = brush.flow * (brush.pressureOpacity ? pressure : 1) * (1 - brush.opacityJitter * rnd());
    let colour = s.colour;
    if ((brush.hueJitter > 0 || brush.brightJitter > 0) && s.target !== 'mask' && s.tool !== 'eraser') colour = jitterColour(colour, brush.hueJitter * (rnd() - 0.5) * 360, brush.brightJitter * (rnd() - 0.5) * 2);
    const copies = s.tool === 'smudge' && opts.smudgeMode === 'smudge' ? [p] : dabCopies(p, size / 2);
    for (const q of copies) dabAt(s, q, size, alpha, colour, q !== p && q.mx);
  }
  /** Where a dab also goes: mirrored across the picture's middle, and round the edges when the view wraps around. */
  function dabCopies(p, r) {
    const W = D.doc.width, H = D.doc.height, out = [p];
    if (brush.mirror === 'h' || brush.mirror === 'both') out.push({ x: W - p.x, y: p.y, mx: true });
    if (brush.mirror === 'v' || brush.mirror === 'both') out.push({ x: p.x, y: H - p.y });
    if (brush.mirror === 'both') out.push({ x: W - p.x, y: H - p.y, mx: true });
    if (!D.wrap) return out;
    const more = [];
    for (const q of out) {
      const bx = ((q.x % W) + W) % W, by = ((q.y % H) + H) % H;
      for (const dx of [0, -W, W]) for (const dy of [0, -H, H]) {
        const x = bx + dx, y = by + dy;
        if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
        more.push({ x, y, mx: q.mx });
      }
    }
    return more;
  }
  function dabAt(s, p, size, alpha, colour, mirrored) {
    const rnd = Math.random, r = size / 2;
    const tx = p.x - s.origin.x, ty = p.y - s.origin.y;
    const box = { x: Math.floor(tx - r - 1), y: Math.floor(ty - r - 1), w: Math.ceil(size) + 3, h: Math.ceil(size) + 3 };
    s.bbox = s.bbox ? union(s.bbox, box) : box;
    if (s.kind === 'work') { workDab(s, tx, ty, r, alpha); return; }
    const bx = g2(s.buf);
    if (s.tool === 'clone' || s.tool === 'heal' || s.tool === 'history') {
      const st = stampOf(size, brush.hardness, '#ffffff', brush.tip === 'spray' || brush.tip === 'bristle' ? 'round' : brush.tip), d = st.width, t = canvas(d, d), x = g2(t);
      x.drawImage(s.source, -(p.x + s.cloneOffset.x - d / 2), -(p.y + s.cloneOffset.y - d / 2));
      x.globalCompositeOperation = 'destination-in'; x.drawImage(st, 0, 0);
      bx.globalAlpha = alpha; bx.drawImage(t, tx - d / 2, ty - d / 2); bx.globalAlpha = 1;
      return;
    }
    if (brush.tip === 'spray') {
      // Spray: fine dots scattered over the brush's circle, thicker in the middle.
      bx.fillStyle = colour; bx.globalAlpha = alpha;
      const dots = Math.max(4, Math.round(size * 0.8)), dot = Math.max(0.6, size / 40);
      for (let i = 0; i < dots; i++) { const a = rnd() * Math.PI * 2, d2 = Math.sqrt(rnd()) * r * (rnd() < brush.hardness ? 0.7 : 1); bx.beginPath(); bx.arc(tx + Math.cos(a) * d2, ty + Math.sin(a) * d2, dot, 0, Math.PI * 2); bx.fill(); }
      bx.globalAlpha = 1;
      return;
    }
    if (brush.tip === 'bristle') {
      // Bristles: hairs fixed in the brush for the whole stroke, turned with its direction, each its own strength
      // and shade, so the stroke is streaky like a real brush.
      if (!s.bristles) {
        const n = clamp(Math.round(brush.size * 0.7), 8, 80);
        s.bristles = Array.from({ length: n }, () => { const a = rnd() * Math.PI * 2, d2 = Math.sqrt(rnd()); return { u: Math.cos(a) * d2, v: Math.sin(a) * d2 * 0.35, k: 0.45 + rnd() * 0.55, shade: (rnd() - 0.5) * 0.25, w: 0.6 + rnd() * 0.8 }; });
      }
      const ang = (s.dir || 0) + Math.PI / 2, ca = Math.cos(ang) * (mirrored ? -1 : 1), sa = Math.sin(ang), hair = Math.max(0.5, size / 28);
      for (const b of s.bristles) {
        bx.globalAlpha = alpha * b.k;
        bx.fillStyle = b.shade ? jitterColour(colour, 0, b.shade) : colour;
        const x = tx + (b.u * ca - b.v * sa) * r, y = ty + (b.u * sa + b.v * ca) * r;
        bx.beginPath(); bx.arc(x, y, hair * b.w, 0, Math.PI * 2); bx.fill();
      }
      bx.globalAlpha = 1;
      return;
    }
    const st = stampOf(size, brush.hardness, colour, brush.tip);
    bx.globalAlpha = alpha;
    bx.drawImage(st, tx - st.width / 2, ty - st.height / 2);
    bx.globalAlpha = 1;
  }
  /** A colour with its hue turned (degrees) and its lightness shifted (−1…1). */
  function jitterColour(hex, dh, dl) {
    let [r, g, b] = hexRgb(hex).map((v) => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, sat = 0;
    if (d) { sat = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    h = (h + dh + 360) % 360;
    const L2 = clamp(l + dl * 0.5, 0, 1), C = (1 - Math.abs(2 * L2 - 1)) * sat, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = L2 - C / 2;
    [r, g, b] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  /** Smudge, blur, sharpen, dodge, burn, sponge: worked out on the pixels under the brush. */
  function workDab(s, cx, cy, r, alpha) {
    const c = s.work, x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(c.width, Math.ceil(cx + r) + 1), y1 = Math.min(c.height, Math.ceil(cy + r) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, h = y1 - y0, img = g2(c).getImageData(x0, y0, w, h), d = img.data, hard = brush.hardness;
    const weight = (xx, yy) => { const dist = Math.hypot(xx + x0 + 0.5 - cx, yy + y0 + 0.5 - cy) / r; return dist >= 1 ? 0 : dist <= hard ? 1 : 1 - (dist - hard) / (1 - hard); };
    const strength = opts.strength * alpha;
    if (s.tool === 'mixer') {
      // Wet paint: the brush holds a colour (the foreground to begin with); each dab mixes it with what is under it
      // (wet: how much), lays the mix down, picks some of it up, and is topped up with fresh paint (load).
      let ur = 0, ug = 0, ub = 0, ua = 0;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const k = weight(xx, yy); if (!k) continue; const i = (yy * w + xx) * 4, a = d[i + 3] / 255 * k; ur += d[i] * a; ug += d[i + 1] * a; ub += d[i + 2] * a; ua += a; }
      if (!s.res) { const [r0, g0, b0] = hexRgb(fg); s.res = [r0, g0, b0]; }
      const res = s.res, wet = ua > 0.01 ? opts.wet : 0, under = ua > 0.01 ? [ur / ua, ug / ua, ub / ua] : res;
      const paint = [0, 1, 2].map((ch) => res[ch] * (1 - wet) + under[ch] * wet);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const k = weight(xx, yy) * alpha;
        if (!k) continue;
        const i = (yy * w + xx) * 4;
        for (let ch = 0; ch < 3; ch++) d[i + ch] = d[i + ch] + (paint[ch] - d[i + ch]) * k;
        d[i + 3] = d[i + 3] + (255 - d[i + 3]) * k;
      }
      const [fr, fgr, fb] = hexRgb(fg);
      for (let ch = 0; ch < 3; ch++) res[ch] = paint[ch] + ([fr, fgr, fb][ch] - paint[ch]) * opts.load;
    } else if (s.tool === 'smudge' && opts.smudgeMode === 'smudge') {
      // The paint picked up at the last dab is pushed into this one, and some of this one is picked up.
      if (!s.carryPx || s.carryW !== w || s.carryH !== h) { s.carryPx = Float32Array.from(d); s.carryW = w; s.carryH = h; }
      else {
        const cp = s.carryPx;
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
          const k = weight(xx, yy) * strength;
          if (!k) continue;
          const i = (yy * w + xx) * 4;
          for (let ch = 0; ch < 4; ch++) { const v = d[i + ch] + (cp[i + ch] - d[i + ch]) * k; d[i + ch] = v; cp[i + ch] = cp[i + ch] + (d[i + ch] - cp[i + ch]) * (1 - opts.strength); }
        }
      }
    } else if (s.tool === 'smudge') {
      // Blur or sharpen: towards (or away from) the average of each pixel's neighbours.
      const src = Uint8ClampedArray.from(d), sharpen = opts.smudgeMode === 'sharpen';
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const k = weight(xx, yy) * strength * (sharpen ? 0.5 : 1);
        if (!k) continue;
        const i = (yy * w + xx) * 4;
        for (let ch = 0; ch < 4; ch++) {
          let sum = 0, n = 0;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const X = xx + ox, Y = yy + oy; if (X >= 0 && Y >= 0 && X < w && Y < h) { sum += src[(Y * w + X) * 4 + ch]; n++; } }
          const avg = sum / n, v = src[i + ch];
          d[i + ch] = sharpen ? v + (v - avg) * k * 2 : v + (avg - v) * k;
        }
      }
    } else {
      // Dodge lightens, burn darkens (in the shadows, the midtones or the highlights); the sponge takes colour away or adds it.
      const mode = opts.dodgeMode, ex = opts.exposure * alpha * 0.35;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const wt = weight(xx, yy);
        if (!wt) continue;
        const i = (yy * w + xx) * 4, R = d[i], G = d[i + 1], B = d[i + 2], lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
        const band = opts.range === 'shadows' ? (1 - lum) ** 2 : opts.range === 'highlights' ? lum ** 2 : 1 - Math.abs(lum - 0.5) * 2 * 0.8;
        const k = ex * wt * band;
        if (mode === 'dodge') { d[i] = R + (255 - R) * k; d[i + 1] = G + (255 - G) * k; d[i + 2] = B + (255 - B) * k; }
        else if (mode === 'burn') { d[i] = R * (1 - k); d[i + 1] = G * (1 - k); d[i + 2] = B * (1 - k); }
        else { const L2 = lum * 255, f = mode === 'saturate' ? 1 + k : 1 - k; d[i] = L2 + (R - L2) * f; d[i + 1] = L2 + (G - L2) * f; d[i + 2] = L2 + (B - L2) * f; }
      }
    }
    g2(c).putImageData(img, x0, y0);
  }

  /** Healing: the copied texture keeps its detail but takes the light and colour of where it lands. */
  function healBuffer(s) {
    const b = s.bbox && meet(s.bbox, { x: 0, y: 0, w: s.buf.width, h: s.buf.height });
    if (!b) return;
    const rad = Math.max(3, brush.size / 3), pad = Math.ceil(rad * 2), R = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    const region = (src, ox, oy) => { const c = canvas(R.w, R.h); g2(c).drawImage(src, -(R.x + ox), -(R.y + oy)); return c; };
    const blur = (c) => { const o = canvas(c.width, c.height), x = g2(o); x.filter = `blur(${rad}px)`; x.drawImage(c, 0, 0); x.filter = 'none'; return o; };
    const o = s.origin, srcR = region(s.source, o.x + s.cloneOffset.x - 0, o.y + s.cloneOffset.y);
    const dstR = region(s.l.canvas, 0, 0), srcLow = blur(srcR), dstLow = blur(dstR);
    const a = imgOf(srcR).data, al = imgOf(srcLow).data, dl = imgOf(dstLow).data, out = g2(srcR).createImageData(R.w, R.h), od = out.data;
    for (let i = 0; i < od.length; i += 4) { for (let ch = 0; ch < 3; ch++) od[i + ch] = dl[i + ch] + a[i + ch] - al[i + ch]; od[i + 3] = 255; }
    const healed = canvas(R.w, R.h); g2(healed).putImageData(out, 0, 0);
    const bx = g2(s.buf), cov = canvas(R.w, R.h), cx = g2(cov);
    cx.drawImage(s.buf, -R.x, -R.y);
    cx.globalCompositeOperation = 'source-in'; cx.drawImage(healed, 0, 0);
    bx.clearRect(R.x, R.y, R.w, R.h); bx.drawImage(cov, R.x, R.y);
  }

  // The history brush paints from a state of the picture kept here: each pixel layer as it was then (the document's
  // size). The first state is kept when a picture opens; ◎ in History keeps another.
  function captureState() {
    const layers = new Map(), W = D.doc.width, H = D.doc.height;
    for (const l of D.doc.layers) if (l.kind === 'pixel' && l.canvas) { const c = canvas(W, H); g2(c).drawImage(l.canvas, l.x, l.y); layers.set(l.id, c); }
    return { layers, at: D.history.length, w: W, h: H };
  }
  function historySource(l) {
    if (!D.histSrc) { const here = D.history.length - 1; goToStep(-1); D.histSrc = captureState(); goToStep(here); }
    const src = D.histSrc;
    if (src.w !== D.doc.width || src.h !== D.doc.height) return null;
    return src.layers.get(l.id) || null;
  }
  /** History › ◎: the history brush will paint the picture as it was after step i. */
  function setHistorySource(i) {
    const here = D.history.length - 1;
    goToStep(i); D.histSrc = captureState(); D.histSrc.at = i; goToStep(here);
    setTool('history'); renderHistory();
    notice('The history brush paints from that state now.', 2000);
  }
  const STROKE_LABEL = { brush: 'Brush', mixer: 'Mixer brush', eraser: 'Eraser', clone: 'Clone stamp', heal: 'Healing brush', history: 'History brush', smudge: 'Smudge', dodge: 'Dodge and burn' };
  function endStroke(s) {
    live = null;
    if (!s) return;
    if (s.tool === 'heal') healBuffer(s);
    const label = s.tool === 'mixer' ? 'Mixer brush' : s.tool === 'smudge' ? ({ smudge: 'Smudge', blur: 'Blur brush', sharpen: 'Sharpen brush' }[opts.smudgeMode]) : s.tool === 'dodge' ? ({ dodge: 'Dodge', burn: 'Burn', saturate: 'Sponge', desaturate: 'Sponge' }[opts.dodgeMode]) : STROKE_LABEL[s.tool];
    const o = originOf(s.l, s.target);
    const apply = () => {
      const real = o.canvas;
      if (s.kind === 'work') { const shown = s.show(); const x = g2(real); x.clearRect(0, 0, real.width, real.height); x.drawImage(shown, 0, 0); }
      else applyPaint(real, s.l, s.target, s.wet ? wetten(s.buf) : s.buf, { opacity: brush.opacity, erase: s.tool === 'eraser', value: grey(s.tool === 'eraser' ? bg : fg) });
    };
    commitPixels(label, s.l, s.target, s.before, s.kind === 'work' ? { x: 0, y: 0, w: o.canvas.width, h: o.canvas.height } : (s.bbox || { x: 0, y: 0, w: 1, h: 1 }), apply);
    rememberColour(fg);
  }
  /** One painting step: just the rectangle when the picture stayed the same size, else the whole layer (it grew). */
  function commitPixels(label, l, target, before, rect, apply) {
    if (before) {
      apply();
      if (target === 'mask') touchMask(l); else touch(l);
      const after = snap();
      pushStep(label, () => restore(before), () => restore(after), 0);
    } else pixelStep(label, l, target, rect, apply);
  }

  // ---------------------------------------------------------------- the bucket, gradients, shapes, text

  function bucket(p) {
    const t = paintTarget();
    if (!t) return;
    const { l, target } = t, before = snap(), grew = cover(l, target), o = originOf(l, target), c = o.canvas;
    const bits = similar(sampleSource(opts.allLayers), Math.floor(p.x), Math.floor(p.y), opts.tolerance, opts.contiguous);
    const area = maskFromBits(bits), buf = canvas(c.width, c.height), bx = g2(buf);
    bx.drawImage(area, -o.x, -o.y);
    bx.globalCompositeOperation = 'source-in'; bx.fillStyle = target === 'mask' ? '#ffffff' : fg; bx.fillRect(0, 0, c.width, c.height);
    commitPixels('Paint bucket', l, target, grew ? before : null, { x: 0, y: 0, w: c.width, h: c.height }, () => applyPaint(c, l, target, buf, { opacity: brush.opacity, value: grey(fg) }));
    rememberColour(fg);
  }
  /** Edit › Fill: the selection (or the whole layer) with a colour. */
  function fillWith(colour, label = 'Fill') {
    const t = paintTarget();
    if (!t) return;
    const { l, target } = t, before = snap(), grew = cover(l, target), o = originOf(l, target), c = o.canvas;
    const buf = canvas(c.width, c.height), bx = g2(buf);
    bx.fillStyle = target === 'mask' ? '#ffffff' : colour; bx.fillRect(0, 0, c.width, c.height);
    commitPixels(label, l, target, grew ? before : null, { x: 0, y: 0, w: c.width, h: c.height }, () => applyPaint(c, l, target, buf, { opacity: 1, value: grey(colour) }));
  }
  /** Delete: what is selected goes (see-through on a picture; hidden on a mask). */
  function clearSelected() {
    const t = paintTarget();
    if (!t) return;
    if (!D.sel) { notice('Select something first (Ctrl+A: everything).', 2200); return; }
    const { l, target } = t, o = originOf(l, target), c = o.canvas, buf = fullOf(c);
    pixelStep('Delete', l, target, { x: 0, y: 0, w: c.width, h: c.height }, () => applyPaint(c, l, target, buf, { opacity: 1, erase: true, value: 0 }));
  }

  /** The gradient tool: a gradient across the drag, shown as it goes. */
  function startGradient(p) {
    const t = paintTarget();
    if (!t) return null;
    const { l, target } = t, before = snap(), grew = cover(l, target), o = originOf(l, target), c = o.canvas;
    const s = { l, target, before: grew ? before : null, line: { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, buf: canvas(c.width, c.height) };
    const stops = () => {
      const a = fg, b = opts.gradTo === 'clear' ? fg + '00' : bg;
      return opts.gradTo === 'clear' ? [a, b] : [a, b];
    };
    s.render = () => {
      const b = s.buf, x = g2(b);
      x.clearRect(0, 0, b.width, b.height);
      x.save(); x.translate(-o.x, -o.y);
      const big = canvas(D.doc.width, D.doc.height);
      paintGradient(big, opts.gradShape, s.line.x0, s.line.y0, s.line.x1, s.line.y1, stops(), opts.gradReverse);
      x.drawImage(big, 0, 0);
      x.restore();
      if (target === 'mask') {
        // On a mask the gradient's grey is the value; it covers everywhere (in the selection).
        const img = x.getImageData(0, 0, b.width, b.height), d = img.data;
        for (let i = 0; i < d.length; i += 4) { const v = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3] / 255; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = v; }
        x.putImageData(img, 0, 0);
      }
    };
    s.how = () => (target === 'mask' ? { opacity: brush.opacity, cover: fullOf(c), valueCanvas: s.buf } : { opacity: brush.opacity });
    s.show = () => { const out = copyOf(c); applyPaint(out, l, target, s.buf, s.how()); return out; };
    s.target = target;
    live = s;
    return s;
  }
  function endGradient(s) {
    live = null;
    if (!s) return;
    if (Math.hypot(s.line.x1 - s.line.x0, s.line.y1 - s.line.y0) < 1) { if (s.before) restore(s.before); needCompose = true; draw(); return; }
    const c = originOf(s.l, s.target).canvas;
    commitPixels('Gradient', s.l, s.target, s.before, { x: 0, y: 0, w: c.width, h: c.height }, () => applyPaint(c, s.l, s.target, s.buf, s.how()));
  }

  /** Text: a new text layer where you clicked, or the text layer clicked on edited. */
  /** The text layer under a point (the active one first), or null. */
  function textUnder(p) {
    const inside = (k) => { const b = boundsOf(k); return p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h; };
    const l = L();
    if (l && l.kind === 'text' && inside(l)) return l;
    return [...D.doc.layers].reverse().find((k) => k.kind === 'text' && k.visible && !k.locked && inside(k)) || null;
  }
  /** Text: typed right on the picture. A click starts a line (point text), a drag a box the words wrap in. */
  function textAt(p, box) {
    const hit = box ? null : textUnder(p);
    if (hit) { D.active = hit.id; startTyping(hit, false); return; }
    const size = Math.max(12, Math.round(Math.min(D.doc.width, D.doc.height) / 12));
    const t = { text: '', font: settings.font, size, colour: fg, bold: false, italic: false, align: 'left', lineHeight: 1.25, tracking: 0 };
    if (box) t.box = Math.round(box.w);
    const before = snap(), a = L();
    const l = makeLayer({ kind: 'text', name: 'Text', text: t, x: Math.round(box ? box.x : p.x - size * 0.1), y: Math.round(box ? box.y : p.y - size * 1.05), parent: a ? a.parent : null });
    D.doc.layers.splice(a ? D.doc.layers.indexOf(a) + 1 : D.doc.layers.length, 0, l);
    tidy(); D.active = l.id;
    startTyping(l, true, before);
  }

  // Typing: a text box over the picture where the layer is (the layer itself hidden meanwhile), the same font, size
  // and colour at the view's zoom. Esc, Ctrl+Enter, ✓ or a click elsewhere finishes; ✕ in the bar throws it away.
  let typing = null; // { l, fresh, before, old, box }
  function startTyping(l, fresh, before) {
    if (typing) finishTyping(true);
    const box = el('textarea', { class: 'ph-typing', id: 'ph-typing', spellcheck: 'true', 'aria-label': 'Type the text', 'data-noi18n': '', wrap: l.text.box ? 'soft' : 'off' });
    box.value = l.text.text || '';
    typing = { l, fresh, before: before || snap(), old: clone(l.text), box };
    l.typing = true; touch(l);
    box.addEventListener('input', () => { l.text = { ...l.text, text: box.value }; placeTyping(); });
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finishTyping(true); }
    });
    $('#ph-stage').append(box);
    placeTyping();
    renderOptions(); renderLayers(); draw();
    setTimeout(() => { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }, 0);
  }
  function placeTyping() {
    if (!typing) return;
    const { l, box } = typing, t = l.text, z = D.view.zoom, at = toScreen(l.x, l.y), size = t.size || 48;
    Object.assign(box.style, {
      left: `${at.x}px`, top: `${at.y + size * 0.2 * z}px`, font: textFont({ ...t, size: size * z }), lineHeight: `${size * (t.lineHeight || 1.25) * z}px`,
      letterSpacing: `${(t.tracking || 0) * z}px`, color: t.colour || '#000', textAlign: t.align || 'left', paddingLeft: `${size * 0.1 * z}px`, paddingRight: `${size * 0.1 * z}px`,
      transform: D.view.angle ? `rotate(${D.view.angle}deg)` : '', transformOrigin: '0 0',
    });
    if (t.box) box.style.width = `${t.box * z}px`;
    else { box.style.width = '10px'; box.style.width = `${Math.max(size * z, box.scrollWidth + size * 0.3 * z)}px`; }
    box.style.height = '10px'; box.style.height = `${Math.max(size * 1.3 * z, box.scrollHeight)}px`;
  }
  function finishTyping(keep) {
    const tp = typing;
    if (!tp) return;
    typing = null;
    tp.box.remove();
    const l = tp.l;
    delete l.typing;
    const empty = !String(l.text.text || '').trim();
    if (!keep || empty) {
      if (tp.fresh) { D.doc.layers = D.doc.layers.filter((k) => k !== l); D.active = tp.before.active; }
      else l.text = tp.old;
      touch(l); afterChange(); renderOptions();
      return;
    }
    l.name = l.text.text.split('\n')[0].slice(0, 40) || 'Text';
    touch(l);
    if (tp.fresh || JSON.stringify(tp.old) !== JSON.stringify(l.text)) {
      const after = snap();
      pushStep(tp.fresh ? 'Text' : 'Edit text', () => restore(tp.before), () => restore(after));
    } else afterChange();
    rememberColour(l.text.colour);
    renderOptions();
    $('#ph-canvas').focus({ preventScroll: true });
  }
  /** While typing, the bar's font settings change the text being typed. */
  function setTypingStyle(k, v) {
    if (!typing) return;
    typing.l.text = { ...typing.l.text, [k]: v };
    placeTyping();
    typing.box.focus();
  }
  function textDialog(l, at) {
    const t = l ? { ...l.text } : { text: '', font: settings.font, size: Math.max(12, Math.round(Math.min(D.doc.width, D.doc.height) / 12)), colour: fg, bold: false, italic: false, align: 'left', lineHeight: 1.25, tracking: 0 };
    NoorUI.modal({ label: 'Text', width: 520 }, (s, closeIt) => {
      const area = el('textarea', { id: 'ph-text-input', rows: '4', 'aria-label': 'The text', spellcheck: 'true', 'data-noi18n': '' });
      area.value = t.text;
      const font = el('input', { type: 'text', id: 'ph-text-font', value: t.font, list: 'ph-fonts', 'aria-label': 'Font' });
      const fonts = el('datalist', { id: 'ph-fonts' }, ...['sans-serif', 'serif', 'monospace', 'Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Courier New', 'Consolas', 'Bahnschrift', 'Cambria', 'Calibri'].map((f) => el('option', { value: f })));
      const size = el('input', { type: 'number', id: 'ph-text-size', min: '4', max: '2000', value: String(t.size), 'aria-label': 'Size' });
      const colour = el('input', { type: 'color', id: 'ph-text-colour', value: t.colour, 'aria-label': 'Colour' });
      const bold = el('input', { type: 'checkbox', checked: t.bold || undefined }), italic = el('input', { type: 'checkbox', checked: t.italic || undefined });
      const align = el('select', { 'aria-label': 'Alignment' }, el('option', { value: 'left', text: 'left' }), el('option', { value: 'center', text: 'centred' }), el('option', { value: 'right', text: 'right' }));
      align.value = t.align;
      const lh = el('input', { type: 'number', min: '0.5', max: '4', step: '0.05', value: String(t.lineHeight), 'aria-label': 'Line height' });
      const track = el('input', { type: 'number', min: '-50', max: '200', step: '1', value: String(t.tracking), 'aria-label': 'Letter spacing' });
      const read = () => ({ text: area.value, font: font.value.trim() || 'sans-serif', size: clamp(Number(size.value) || 48, 4, 2000), colour: colour.value, bold: bold.checked, italic: italic.checked, align: align.value, lineHeight: clamp(Number(lh.value) || 1.25, 0.5, 4), tracking: clamp(Number(track.value) || 0, -50, 200) });
      const ok = () => {
        const v = read();
        if (!v.text.trim()) { closeIt(); return; }
        if (l) change('Edit text', () => { l.text = v; l.name = v.text.split('\n')[0].slice(0, 40); touch(l); });
        else addLayerAbove(makeLayer({ kind: 'text', name: v.text.split('\n')[0].slice(0, 40), text: v, x: Math.round(at.x), y: Math.round(at.y - v.size * 1.05) }), 'Text');
        settings.font = v.font; saveSettings();
        closeIt();
      };
      s.append(NoorUI.head(l ? 'Edit the text' : 'New text', closeIt),
        el('div', { class: 'modal-body ph-dlg' }, area, fonts,
          el('div', { class: 'ph-row' }, el('label', {}, 'Font ', font), el('label', {}, 'Size ', size, ' px'), el('label', {}, 'Colour ', colour)),
          el('div', { class: 'ph-row' }, el('label', {}, bold, ' bold'), el('label', {}, italic, ' italic'), el('label', {}, 'Align ', align)),
          el('div', { class: 'ph-row' }, el('label', {}, 'Line height ', lh), el('label', {}, 'Letter spacing ', track, ' px'))),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-text-ok', onclick: ok }, 'OK'))));
      setTimeout(() => area.focus(), 0);
    });
  }

  // ---------------------------------------------------------------- shape layers and the pen

  // A shape layer keeps its geometry (a rectangle, an ellipse, a polygon, a star, a line or a pen path), its fill and
  // its stroke, so it stays sharp and changeable: it is drawn afresh whenever it is shown. l.shape.m is the transform
  // free transform gave it; l.x, l.y move it.
  function shapePath(sh) {
    const p = new Path2D();
    if (sh.type === 'line') { p.moveTo(sh.x0, sh.y0); p.lineTo(sh.x1, sh.y1); return p; }
    if (sh.type === 'path') {
      const pts = sh.points || [];
      if (!pts.length) return p;
      p.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) p.bezierCurveTo(pts[i - 1].ox, pts[i - 1].oy, pts[i].ix, pts[i].iy, pts[i].x, pts[i].y);
      if (sh.closed && pts.length > 2) { const a = pts[pts.length - 1], b = pts[0]; p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y); p.closePath(); }
      return p;
    }
    const { x, y, w, h } = sh, cx = x + w / 2, cy = y + h / 2;
    if (sh.type === 'ellipse') { p.ellipse(cx, cy, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); return p; }
    if (sh.type === 'rounded') { p.roundRect(x, y, w, h, Math.min(Math.abs(w), Math.abs(h)) / 2 * clamp((sh.radius ?? 20) / 100, 0, 1)); return p; }
    if (sh.type === 'polygon' || sh.type === 'star') {
      const n = clamp(Math.round(sh.sides || 5), 3, 64), pts = sh.type === 'star' ? n * 2 : n;
      for (let i = 0; i < pts; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / pts, k = sh.type === 'star' && i % 2 ? clamp((sh.inner ?? 45) / 100, 0.05, 1) : 1;
        const px2 = cx + Math.cos(a) * w / 2 * k, py2 = cy + Math.sin(a) * h / 2 * k;
        if (i) p.lineTo(px2, py2); else p.moveTo(px2, py2);
      }
      p.closePath(); return p;
    }
    p.rect(x, y, w, h);
    return p;
  }
  const shapeMatrix = (l) => { const m = l.shape && l.shape.m ? new DOMMatrix(l.shape.m) : new DOMMatrix(); return new DOMMatrix().translate(l.x || 0, l.y || 0).multiply(m); };
  const DASHES = { solid: null, dashed: (w) => [w * 3, w * 2], dotted: (w) => [0.001, w * 2] };
  const shapeCache = new WeakMap();
  function shapeCanvas(l) {
    const W = D.doc.width, H = D.doc.height, key = `${W}x${H}|${l.x},${l.y}|${JSON.stringify(l.shape)}`;
    const hit = shapeCache.get(l);
    if (hit && hit.key === key) return hit.canvas;
    const c = canvas(W, H), x = g2(c), sh = l.shape || {}, path = shapePath(sh);
    x.setTransform(shapeMatrix(l));
    if (sh.fill && sh.type !== 'line' && (sh.type !== 'path' || sh.closed)) { x.fillStyle = sh.fill; x.fill(path, 'nonzero'); }
    if (sh.stroke && sh.stroke.width > 0) {
      const w = sh.stroke.width, dash = DASHES[sh.stroke.dash || 'solid'];
      x.strokeStyle = sh.stroke.colour || '#000000'; x.lineWidth = w; x.lineJoin = 'round'; x.lineCap = sh.stroke.dash === 'dotted' || sh.type === 'line' || (sh.type === 'path' && !sh.closed) ? 'round' : 'butt';
      x.setLineDash(dash ? dash(w) : []);
      x.stroke(path);
    }
    shapeCache.set(l, { key, canvas: c });
    return c;
  }
  /** Where a shape is: its geometry's corners through its transform, grown by half its stroke. */
  function shapeBounds(l) {
    const sh = l.shape || {}, M = shapeMatrix(l);
    let pts;
    if (sh.type === 'line') pts = [[sh.x0, sh.y0], [sh.x1, sh.y1]];
    else if (sh.type === 'path') pts = (sh.points || []).flatMap((q) => [[q.x, q.y], [q.ix, q.iy], [q.ox, q.oy]]);
    else pts = [[sh.x, sh.y], [sh.x + sh.w, sh.y], [sh.x + sh.w, sh.y + sh.h], [sh.x, sh.y + sh.h]];
    if (!pts.length) return { x: 0, y: 0, w: 1, h: 1 };
    const tp = pts.map(([a, b]) => M.transformPoint(new DOMPoint(a, b))), pad = (sh.stroke ? sh.stroke.width / 2 : 0) + 1;
    const xs = tp.map((q) => q.x), ys = tp.map((q) => q.y);
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  const SHAPE_NAMES = { rect: 'Rectangle', rounded: 'Rounded rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line', path: 'Path' };
  /** The shape tool: a shape layer of its own, filled with the foreground colour (stroke: the background colour). */
  function makeShape(r, line) {
    const sh = line ? { type: 'line', x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 } : { type: opts.shape, x: r.x, y: r.y, w: r.w, h: r.h, radius: opts.shapeRadius, sides: opts.shapeSides, inner: opts.starInner };
    sh.fill = !line && opts.shapeFill ? fg : null;
    const sw = line ? Math.max(1, opts.shapeStroke || Math.max(2, Math.round(brush.size / 4))) : opts.shapeStroke;
    sh.stroke = sw > 0 || !sh.fill ? { colour: line || !sh.fill ? fg : bg, width: Math.max(1, sw || 2), dash: opts.shapeDash } : null;
    const name = uniqueName(SHAPE_NAMES[sh.type] || 'Shape');
    addLayerAbove(makeLayer({ kind: 'shape', name, shape: sh }), name);
    rememberColour(fg);
  }
  /** A selection from the shape layer's outline (filled). */
  function selFromShape(l = L()) {
    if (!l || l.kind !== 'shape') { notice('Choose a shape layer.', 1600); return; }
    const path = shapePath(l.shape), M = shapeMatrix(l);
    combineSel(shapeMask((x) => { x.setTransform(M); x.fill(path); }), 'new');
  }

  // The pen: click for corners, drag for curves, click the first point to close, Enter (or double-click) to finish
  // an open path. With a path layer chosen, its points and handles can be dragged.
  let pen = null; // { points: [{ x, y, ix, iy, ox, oy }] } being drawn (document pixels)
  function penHit(sp) {
    const l = L();
    if (!l || l.kind !== 'shape' || l.shape.type !== 'path' || pen) return null;
    const M = shapeMatrix(l), pts = l.shape.points || [];
    for (let i = 0; i < pts.length; i++) for (const part of ['o', 'i', 'a']) {
      const q = part === 'a' ? pts[i] : { x: pts[i][part + 'x'], y: pts[i][part + 'y'] }, d = M.transformPoint(new DOMPoint(q.x, q.y)), s = toScreen(d.x, d.y);
      if (Math.hypot(s.x - sp.x, s.y - sp.y) <= 7 && (part === 'a' || Math.hypot(q.x - pts[i].x, q.y - pts[i].y) > 0.5)) return { l, i, part, inv: M.inverse() };
    }
    return null;
  }
  function penDown(p, e) {
    const hit = penHit(p);
    if (hit) return { kind: 'penedit', ...hit, before: snap() };
    if (!pen) pen = { points: [] };
    const pts = pen.points;
    if (pts.length > 2) { const f = toScreen(pts[0].x, pts[0].y); if (Math.hypot(f.x - p.sx, f.y - p.sy) < 8) { finishPen(true); return null; } }
    pts.push({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y });
    void e;
    return { kind: 'pennew' };
  }
  function penDrag(d, p, e) {
    if (d.kind === 'pennew') {
      const q = pen.points[pen.points.length - 1];
      q.ox = p.x; q.oy = p.y;
      // Alt: a corner with one handle; else the handle on the other side mirrors it.
      if (!e.altKey) { q.ix = 2 * q.x - p.x; q.iy = 2 * q.y - p.y; }
      return;
    }
    const sh = d.l.shape, q = sh.points[d.i], lp = d.inv.transformPoint(new DOMPoint(p.x, p.y));
    if (d.part === 'a') { const dx = lp.x - q.x, dy = lp.y - q.y; Object.assign(q, { x: q.x + dx, y: q.y + dy, ix: q.ix + dx, iy: q.iy + dy, ox: q.ox + dx, oy: q.oy + dy }); }
    else {
      q[d.part + 'x'] = lp.x; q[d.part + 'y'] = lp.y;
      if (!e.altKey) { const o = d.part === 'o' ? 'i' : 'o', len = Math.hypot(q[o + 'x'] - q.x, q[o + 'y'] - q.y), a = Math.atan2(lp.y - q.y, lp.x - q.x) + Math.PI; if (len > 0.5) { q[o + 'x'] = q.x + Math.cos(a) * len; q[o + 'y'] = q.y + Math.sin(a) * len; } }
    }
    touch(d.l);
  }
  function penUp(d) {
    if (d.kind !== 'penedit') return;
    const after = snap();
    pushStep('Edit path', () => restore(d.before), () => restore(after));
  }
  function finishPen(closed) {
    const pts = pen ? pen.points : [];
    pen = null;
    if (pts.length < 2) { draw(); return; }
    const sh = { type: 'path', points: pts.map((q) => ({ ...q })), closed: !!closed, fill: closed && opts.shapeFill ? fg : null };
    sh.stroke = !sh.fill || opts.shapeStroke > 0 ? { colour: sh.fill ? bg : fg, width: Math.max(1, opts.shapeStroke || 2), dash: opts.shapeDash } : null;
    addLayerAbove(makeLayer({ kind: 'shape', name: uniqueName('Path'), shape: sh }), 'Pen path');
  }
  function drawPen(x) {
    const l = L(), pts = pen ? pen.points : l && l.kind === 'shape' && l.shape.type === 'path' && tool === 'pen' ? l.shape.points : null;
    if (!pts || !pts.length) return;
    const M = pen ? new DOMMatrix() : shapeMatrix(l), sc = (q) => { const d = M.transformPoint(new DOMPoint(q.x, q.y)); return toScreen(d.x, d.y); };
    x.save();
    if (pen) {
      x.strokeStyle = '#19d3ff'; x.lineWidth = 1.5; x.beginPath();
      pts.forEach((q, i) => { const s = sc(q); if (!i) { x.moveTo(s.x, s.y); return; } const a = sc({ x: pts[i - 1].ox, y: pts[i - 1].oy }), b = sc({ x: q.ix, y: q.iy }); x.bezierCurveTo(a.x, a.y, b.x, b.y, s.x, s.y); });
      if (hover) { const last = pts[pts.length - 1], a = sc({ x: last.ox, y: last.oy }); x.bezierCurveTo(a.x, a.y, hover.sx, hover.sy, hover.sx, hover.sy); }
      x.stroke();
    }
    for (const q of pts) {
      const s = sc(q), i = sc({ x: q.ix, y: q.iy }), o = sc({ x: q.ox, y: q.oy });
      x.strokeStyle = 'rgba(25,211,255,.8)'; x.lineWidth = 1; x.beginPath(); x.moveTo(i.x, i.y); x.lineTo(o.x, o.y); x.stroke();
      for (const h of [i, o]) if (Math.hypot(h.x - s.x, h.y - s.y) > 1) { x.beginPath(); x.arc(h.x, h.y, 3, 0, Math.PI * 2); x.fillStyle = '#19d3ff'; x.fill(); }
      x.fillStyle = '#fff'; x.strokeStyle = '#19d3ff'; x.fillRect(s.x - 3.5, s.y - 3.5, 7, 7); x.strokeRect(s.x - 3.5, s.y - 3.5, 7, 7);
    }
    x.restore();
  }

  // ---------------------------------------------------------------- moving, cropping and free transform

  /** The move tool: the layer (a group with all in it), or the selected pixels lifted and moved. */
  function startMove(p) {
    const l = L();
    if (!l) return null;
    if (l.locked) { notice('That layer is locked.', 2000); return null; }
    if (D.sel && l.kind === 'pixel' && !D.editMask) {
      startTransform(true);
      if (!transform) return null;
      return { kind: 'tmove', start: p, corners: transform.corners.map((c) => ({ ...c })), autoCommit: true };
    }
    const moving = l.kind === 'group' ? descendants(l.id) : [l];
    return { kind: 'move', start: p, before: snap(), moving: moving.map((k) => ({ k, x: k.x, y: k.y, mx: k.mask ? k.mask.x : 0, my: k.mask ? k.mask.y : 0 })), groupMask: l.kind === 'group' && l.mask ? { m: l.mask, x: l.mask.x, y: l.mask.y } : null };
  }
  function moveBy(d, dx, dy) {
    for (const m of d.moving) { m.k.x = m.x + dx; m.k.y = m.y + dy; if (m.k.mask) { m.k.mask.x = m.mx + dx; m.k.mask.y = m.my + dy; } touch(m.k); }
    if (d.groupMask) { d.groupMask.m.x = d.groupMask.x + dx; d.groupMask.m.y = d.groupMask.y + dy; touchMask(L()); }
  }
  /** Arrow keys with the move tool: a pixel (Shift: ten). */
  function nudge(dx, dy) {
    const l = L();
    if (!l || l.locked) return;
    const d = startMove({ x: 0, y: 0 });
    if (!d) return;
    if (d.kind === 'tmove') { transform.corners = transform.corners.map((c) => ({ x: c.x + dx, y: c.y + dy })); commitTransform('Move'); return; }
    moveBy(d, dx, dy);
    const after = snap();
    pushStep('Move', () => restore(d.before), () => restore(after));
  }

  function cropHandles() {
    const r = cropBox;
    return [[r.x, r.y], [r.x + r.w / 2, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h / 2], [r.x + r.w, r.y + r.h], [r.x + r.w / 2, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + r.h / 2]];
  }
  function drawCrop(x, s) {
    const r = cropBox, pts = [toScreen(r.x, r.y), toScreen(r.x + r.w, r.y), toScreen(r.x + r.w, r.y + r.h), toScreen(r.x, r.y + r.h)];
    x.save();
    x.fillStyle = 'rgba(0,0,0,.5)'; x.beginPath(); x.rect(0, 0, s.w, s.h);
    pts.slice().reverse().forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill('evenodd');
    x.strokeStyle = '#fff'; x.lineWidth = 1; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.stroke();
    // Thirds, to compose by.
    x.strokeStyle = 'rgba(255,255,255,.4)'; x.beginPath();
    for (const k of [1 / 3, 2 / 3]) { const a = toScreen(r.x + r.w * k, r.y), b = toScreen(r.x + r.w * k, r.y + r.h), c2 = toScreen(r.x, r.y + r.h * k), d2 = toScreen(r.x + r.w, r.y + r.h * k); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.moveTo(c2.x, c2.y); x.lineTo(d2.x, d2.y); }
    x.stroke();
    x.fillStyle = '#fff'; x.strokeStyle = '#000';
    for (const [hx, hy] of cropHandles()) { const q = toScreen(hx, hy); x.fillRect(q.x - 4, q.y - 4, 8, 8); x.strokeRect(q.x - 4, q.y - 4, 8, 8); }
    x.restore();
  }
  function cropHit(sp) {
    const hs = cropHandles();
    for (let i = 0; i < hs.length; i++) { const q = toScreen(hs[i][0], hs[i][1]); if (Math.abs(q.x - sp.x) <= 7 && Math.abs(q.y - sp.y) <= 7) return i; }
    const p = toDoc(sp.x, sp.y), r = cropBox;
    return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h ? 'in' : null;
  }
  const RATIOS = { '': null, '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '3:4': 3 / 4, '2:3': 2 / 3, '9:16': 9 / 16 };
  /** Image › Crop (Enter with the crop tool): the canvas becomes the frame; layers keep what falls outside it. */
  function applyCrop(r = cropBox) {
    if (!r) return;
    const R = intRect({ x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) });
    cropBox = null;
    if (R.w < 1 || R.h < 1) { draw(); return; }
    if (R.w > MAX_SIDE || R.h > MAX_SIDE) { notice(`A picture is at most ${MAX_SIDE} pixels a side.`, 2600); draw(); return; }
    change('Crop', () => {
      for (const l of D.doc.layers) { if (l.kind === 'pixel' || l.kind === 'text' || l.kind === 'shape') { l.x -= R.x; l.y -= R.y; } if (l.mask) { l.mask.x -= R.x; l.mask.y -= R.y; } touch(l); }
      D.doc.guides = D.doc.guides.map((g) => ({ ...g, at: g.at - (g.axis === 'x' ? R.x : R.y) }));
      D.doc.width = R.w; D.doc.height = R.h;
    });
    D.sel = null; D.selVer = ++VER;
    fit(); renderAll();
  }

  // Free transform: the layer (or the selected pixels) between four corners you drag. Corners keep the shape (Shift:
  // freely), sides stretch, outside a corner turns it, Ctrl+corner moves one corner alone (perspective).
  function startTransform(selection) {
    if (transform) return;
    const l = L();
    if (!l) return;
    if (l.locked) { notice('That layer is locked.', 2000); return; }
    if (l.kind !== 'pixel' && l.kind !== 'shape') { notice(l.kind === 'text' ? 'Text layers move with the move tool; Layer › Rasterize to transform them freely.' : 'Transform works on pixel and shape layers.', 3200); return; }
    const sel = selection && D.sel && l.kind === 'pixel' ? selBounds() : null;
    let src, rect, hole = null;
    if (l.kind === 'shape') {
      // A shape: its picture is shown moving; when laid down the shape's own transform changes (it stays a shape).
      rect = intRect(shapeBounds(l));
      src = canvas(rect.w, rect.h); g2(src).drawImage(shapeCanvas(l), -rect.x, -rect.y);
    } else if (sel) {
      // The selected pixels, lifted (with a hole left where they were).
      src = canvas(sel.w, sel.h);
      const x = g2(src);
      x.drawImage(l.canvas, l.x - sel.x, l.y - sel.y);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(D.sel, -sel.x, -sel.y);
      hole = canvas(D.doc.width, D.doc.height); g2(hole).drawImage(D.sel, 0, 0);
      rect = sel;
    } else { src = l.canvas; rect = { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height }; }
    transform = {
      l, src, hole, selection: !!sel, rect, before: snap(),
      corners: [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }],
    };
    transform.preview = () => warp(transform.src, transform.corners, D.doc.width, D.doc.height, { x: 0, y: 0 });
    needCompose = true; draw(); renderOptions();
  }
  // Transform again: the last transform (moved, scaled, turned, skewed) once more on the layer, so a turn of 15°
  // twice is 30° about the same point.
  let lastTransform = null;
  function transformAgain() {
    if (!lastTransform) { notice('Transform something first (Ctrl+T), then this does it again.', 2400); return; }
    if (transform) commitTransform();
    startTransform(true);
    if (!transform) return;
    transform.corners = transform.corners.map((c) => { const p2 = lastTransform.transformPoint(new DOMPoint(c.x, c.y)); return { x: p2.x, y: p2.y }; });
    const keep = lastTransform;
    commitTransform('Transform again');
    lastTransform = keep;
  }
  function cancelTransform() { if (!transform) return; transform = null; needCompose = true; draw(); renderOptions(); }
  /** Draws a picture into a canvas so its corners land on four points (affine when it can, else a fine mesh). */
  function warp(src, q, w, h, origin) {
    const out = canvas(w, h), x = g2(out);
    x.imageSmoothingQuality = 'high';
    const [a, b, , d] = q, c = q[2];
    const affine = Math.abs((a.x + c.x) - (b.x + d.x)) < 0.01 && Math.abs((a.y + c.y) - (b.y + d.y)) < 0.01;
    if (affine) {
      x.setTransform((b.x - a.x) / src.width, (b.y - a.y) / src.width, (d.x - a.x) / src.height, (d.y - a.y) / src.height, a.x - origin.x, a.y - origin.y);
      x.drawImage(src, 0, 0);
      return out;
    }
    // Perspective: the homography from the picture's square to the four corners, drawn as small triangles.
    const H = homography(src.width, src.height, q), N = 16;
    const at = (u, v) => { const X = H[0] * u + H[1] * v + H[2], Y = H[3] * u + H[4] * v + H[5], Z = H[6] * u + H[7] * v + 1; return { x: X / Z - origin.x, y: Y / Z - origin.y }; };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u0 = src.width * i / N, u1 = src.width * (i + 1) / N, v0 = src.height * j / N, v1 = src.height * (j + 1) / N;
      const p00 = at(u0, v0), p10 = at(u1, v0), p01 = at(u0, v1), p11 = at(u1, v1);
      tri(x, src, [u0, v0, u1, v0, u0, v1], [p00, p10, p01]);
      tri(x, src, [u1, v0, u1, v1, u0, v1], [p10, p11, p01]);
    }
    return out;
  }
  function tri(x, src, s, d) {
    const [u0, v0, u1, v1, u2, v2] = s, [p0, p1, p2] = d;
    // Grown by half a pixel from its middle, so neighbouring triangles leave no hairline gaps.
    const mx = (p0.x + p1.x + p2.x) / 3, my = (p0.y + p1.y + p2.y) / 3, grow = (p) => { const dx = p.x - mx, dy = p.y - my, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * 0.6, y: p.y + dy / l * 0.6 }; };
    const q0 = grow(p0), q1 = grow(p1), q2 = grow(p2);
    x.save(); x.beginPath(); x.moveTo(q0.x, q0.y); x.lineTo(q1.x, q1.y); x.lineTo(q2.x, q2.y); x.closePath(); x.clip();
    const den = u0 * (v2 - v1) - u1 * v2 + u2 * v1 + (u1 - u2) * v0;
    if (Math.abs(den) < 1e-9) { x.restore(); return; }
    const m11 = -(v0 * (p2.x - p1.x) - v1 * p2.x + v2 * p1.x + (v1 - v2) * p0.x) / den, m12 = (v1 * p2.y + v0 * (p1.y - p2.y) - v2 * p1.y + (v2 - v1) * p0.y) / den;
    const m21 = (u0 * (p2.x - p1.x) - u1 * p2.x + u2 * p1.x + (u1 - u2) * p0.x) / den, m22 = -(u1 * p2.y + u0 * (p1.y - p2.y) - u2 * p1.y + (u2 - u1) * p0.y) / den;
    const dx = (u0 * (v2 * p1.x - v1 * p2.x) + v0 * (u1 * p2.x - u2 * p1.x) + (u2 * v1 - u1 * v2) * p0.x) / den, dy = (u0 * (v2 * p1.y - v1 * p2.y) + v0 * (u1 * p2.y - u2 * p1.y) + (u2 * v1 - u1 * v2) * p0.y) / den;
    x.transform(m11, m12, m21, m22, dx, dy);
    x.drawImage(src, 0, 0);
    x.restore();
  }
  /** The 3×3 matrix (as 8 numbers) taking (0,0), (w,0), (w,h), (0,h) to the four corners. */
  function homography(w, h, q) {
    const src = [[0, 0], [w, 0], [w, h], [0, h]], A = [], B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], X = q[i].x, Y = q[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); B.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); B.push(Y);
    }
    // Gaussian elimination with partial pivoting.
    for (let c = 0; c < 8; c++) {
      let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
      for (let r = 0; r < 8; r++) { if (r === c || !A[c][c]) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
    }
    return B.map((b, i) => b / (A[i][i] || 1));
  }
  function transformHandles() {
    const q = transform.corners, mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    return [q[0], mid(q[0], q[1]), q[1], mid(q[1], q[2]), q[2], mid(q[2], q[3]), q[3], mid(q[3], q[0])];
  }
  function drawTransformBox(x) {
    const pts = transform.corners.map((c) => toScreen(c.x, c.y));
    x.save(); x.strokeStyle = '#19d3ff'; x.lineWidth = 1; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.stroke();
    x.fillStyle = '#fff'; x.strokeStyle = '#19d3ff';
    for (const h of transformHandles()) { const q = toScreen(h.x, h.y); x.fillRect(q.x - 4, q.y - 4, 8, 8); x.strokeRect(q.x - 4, q.y - 4, 8, 8); }
    const c = centreOf(transform.corners), cs = toScreen(c.x, c.y);
    x.beginPath(); x.arc(cs.x, cs.y, 4, 0, Math.PI * 2); x.stroke();
    x.restore();
  }
  const centreOf = (q) => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });
  function transformHit(sp) {
    const hs = transformHandles();
    for (let i = 0; i < hs.length; i++) { const q = toScreen(hs[i].x, hs[i].y); if (Math.abs(q.x - sp.x) <= 7 && Math.abs(q.y - sp.y) <= 7) return { handle: i }; }
    const p = toDoc(sp.x, sp.y);
    if (inQuad(p, transform.corners)) return { inside: true };
    for (const c of transform.corners) { const q = toScreen(c.x, c.y); if (Math.hypot(q.x - sp.x, q.y - sp.y) < 28) return { rotate: true }; }
    return { rotate: true };
  }
  function inQuad(p, q) {
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) if ((q[i].y > p.y) !== (q[j].y > p.y) && p.x < (q[j].x - q[i].x) * (p.y - q[i].y) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
    return inside;
  }
  function dragTransform(d, p, e) {
    const q0 = d.corners, t = transform;
    if (d.inside) { const dx = p.x - d.start.x, dy = p.y - d.start.y; t.corners = q0.map((c) => ({ x: c.x + dx, y: c.y + dy })); return; }
    if (d.rotate) {
      const c = centreOf(q0), a0 = Math.atan2(d.start.y - c.y, d.start.x - c.x);
      let a = Math.atan2(p.y - c.y, p.x - c.x) - a0;
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      const cos = Math.cos(a), sin = Math.sin(a);
      t.corners = q0.map((k) => ({ x: c.x + (k.x - c.x) * cos - (k.y - c.y) * sin, y: c.y + (k.x - c.x) * sin + (k.y - c.y) * cos }));
      return;
    }
    const h = d.handle, corner = h % 2 === 0, ci = h / 2;
    if (corner && (e.ctrlKey || e.metaKey)) { t.corners = q0.map((k, i) => (i === ci ? { x: k.x + p.x - d.start.x, y: k.y + p.y - d.start.y } : { ...k })); return; }
    // Scaling in the box's own frame (it may be turned): the opposite side or corner stays put (Alt: the middle).
    const ux = { x: q0[1].x - q0[0].x, y: q0[1].y - q0[0].y }, vy = { x: q0[3].x - q0[0].x, y: q0[3].y - q0[0].y };
    const W0 = Math.hypot(ux.x, ux.y) || 1, H0 = Math.hypot(vy.x, vy.y) || 1, U = { x: ux.x / W0, y: ux.y / W0 }, V = { x: vy.x / H0, y: vy.y / H0 };
    const local = (pt) => ({ u: (pt.x - q0[0].x) * U.x + (pt.y - q0[0].y) * U.y, v: (pt.x - q0[0].x) * V.x + (pt.y - q0[0].y) * V.y });
    const m = local(p);
    let u0 = 0, v0 = 0, u1 = W0, v1 = H0;
    const sides = [[1, 1, 0, 0], [0, 1, 0, 0], [0, 1, 1, 0], [0, 0, 1, 0], [0, 0, 1, 1], [0, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 0]][h]; // [left, top, right, bottom] moved
    if (sides[0]) u0 = m.u; if (sides[2]) u1 = m.u; if (sides[1]) v0 = m.v; if (sides[3]) v1 = m.v;
    if (e.altKey) { if (sides[0]) u1 = W0 - u0; if (sides[2]) u0 = W0 - u1; if (sides[1]) v1 = H0 - v0; if (sides[3]) v0 = H0 - v1; }
    if (corner && !e.shiftKey) {
      // Corners keep the proportions unless Shift is held.
      const sx = (u1 - u0) / W0, sy = (v1 - v0) / H0, s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
      const nw = W0 * s * Math.sign(sx || 1) * Math.sign(s || 1), nh = H0 * s * Math.sign(sy || 1) * Math.sign(s || 1);
      if (sides[0]) u0 = u1 - nw; else u1 = u0 + nw;
      if (sides[1]) v0 = v1 - nh; else v1 = v0 + nh;
    }
    const P = (u, v) => ({ x: q0[0].x + U.x * u + V.x * v, y: q0[0].y + U.y * u + V.y * v });
    t.corners = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  }
  /** Lays the transformed picture down: the layer gets a new picture just big enough for it. */
  function commitTransform(label = 'Free transform') {
    const t = transform;
    if (!t) return;
    transform = null;
    const q = t.corners, xs = q.map((c) => c.x), ys = q.map((c) => c.y);
    const r = intRect({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    if (r.w < 1 || r.h < 1 || r.w > 16384 || r.h > 16384) { notice('That is too small or too big to lay down.', 2400); needCompose = true; draw(); return; }
    const before = t.before, l = t.l;
    if (l.kind === 'shape') {
      const R = t.rect, a = (q[1].x - q[0].x) / R.w, b = (q[1].y - q[0].y) / R.w, c = (q[3].x - q[0].x) / R.h, d = (q[3].y - q[0].y) / R.h;
      const A = new DOMMatrix([a, b, c, d, q[0].x - a * R.x - c * R.y, q[0].y - b * R.x - d * R.y]), M = A.multiply(shapeMatrix(l));
      if (Math.abs((q[0].x + q[2].x) - (q[1].x + q[3].x)) > 0.5 || Math.abs((q[0].y + q[2].y) - (q[1].y + q[3].y)) > 0.5) notice('A shape keeps straight sides: perspective needs a pixel layer (Layer › Rasterize).', 3200);
      l.shape = { ...l.shape, m: [M.a, M.b, M.c, M.d, M.e, M.f] }; l.x = 0; l.y = 0;
      lastTransform = A;
      touch(l);
      const after = snap();
      pushStep(label, () => restore(before), () => restore(after));
      renderOptions();
      return;
    }
    const R0 = t.rect;
    if (Math.abs((q[0].x + q[2].x) - (q[1].x + q[3].x)) < 0.5 && Math.abs((q[0].y + q[2].y) - (q[1].y + q[3].y)) < 0.5) {
      const a = (q[1].x - q[0].x) / R0.w, b = (q[1].y - q[0].y) / R0.w, c = (q[3].x - q[0].x) / R0.h, d = (q[3].y - q[0].y) / R0.h;
      lastTransform = new DOMMatrix([a, b, c, d, q[0].x - a * R0.x - c * R0.y, q[0].y - b * R0.x - d * R0.y]);
    } else lastTransform = null;
    const moved = warp(t.src, q, r.w, r.h, r);
    let pic;
    if (t.selection) {
      const all = union({ x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height }, r);
      pic = canvas(all.w, all.h);
      const x = g2(pic);
      x.drawImage(l.canvas, l.x - all.x, l.y - all.y);
      x.globalCompositeOperation = 'destination-out'; x.drawImage(t.hole, -all.x, -all.y);
      x.globalCompositeOperation = 'source-over'; x.drawImage(moved, r.x - all.x, r.y - all.y);
      l.canvas = pic; l.x = all.x; l.y = all.y;
      // The selection goes where the pixels went.
      const sel = canvas(D.doc.width, D.doc.height), sx = g2(sel), lifted = canvas(t.rect.w, t.rect.h);
      g2(lifted).drawImage(t.hole, -t.rect.x, -t.rect.y);
      sx.drawImage(warp(lifted, q, D.doc.width, D.doc.height, { x: 0, y: 0 }), 0, 0);
      D.sel = sel; D.selVer = ++VER; ants = null;
    } else { l.canvas = moved; l.x = r.x; l.y = r.y; }
    touch(l);
    const after = snap();
    pushStep(label, () => restore(before), () => restore(after));
    renderOptions();
  }
  function cancelGestures() { if (typing) finishTyping(true); if (transform) cancelTransform(); cropBox = null; polygon = null; pen = null; live = null; drag = null; }

  // ---------------------------------------------------------------- the mouse and the pen

  function pointAt(e) {
    const r = $('#ph-canvas').getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, p = toDoc(sx, sy);
    return { x: p.x, y: p.y, sx, sy };
  }
  function selModeOf(e) { return e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : opts.selMode; }

  function onDown(e) {
    if (!D) return;
    const cv = $('#ph-canvas');
    cv.focus({ preventScroll: true });
    const p = pointAt(e);
    if (e.button === 1 || spaceHeld || tool === 'hand' || (e.button === 0 && tool === 'zoom' && false)) {
      drag = { kind: 'pan', sx: p.sx, sy: p.sy, cx: D.view.cx, cy: D.view.cy };
      cv.setPointerCapture(e.pointerId); setCursor(); return;
    }
    if (e.button === 2) return;
    if (typing) { finishTyping(true); if (tool === 'text') return; }
    cv.setPointerCapture(e.pointerId);
    if (transform) {
      const hit = transformHit(p);
      drag = { kind: 'transform', start: p, corners: transform.corners.map((c) => ({ ...c })), ...hit };
      return;
    }
    if (tool === 'crop') {
      const hit = cropBox && cropHit(p);
      if (hit === 'in') drag = { kind: 'cropmove', start: p, box: { ...cropBox } };
      else if (hit !== null && hit !== undefined && hit !== false) drag = { kind: 'cropsize', handle: hit, box: { ...cropBox } };
      else { cropBox = { x: p.x, y: p.y, w: 0, h: 0 }; drag = { kind: 'cropnew', start: p }; }
      return;
    }
    if (tool === 'rotate') { drag = { kind: 'rotate', start: p, angle: D.view.angle, a0: Math.atan2(p.sy - stageSize().h / 2, p.sx - stageSize().w / 2) }; return; }
    if (tool === 'zoom') { zoomStep(e.altKey ? -1 : 1, { x: p.sx, y: p.sy }); return; }
    if ((altHeld || e.altKey) && (tool === 'clone' || tool === 'heal')) { D.cloneFrom = { x: p.x, y: p.y }; D.cloneFresh = true; notice('Copying from here.', 1200); draw(); return; }
    if (tool === 'picker' || ((altHeld || e.altKey) && (PAINTERS.has(tool) || tool === 'fill' || tool === 'gradient' || tool === 'shape' || tool === 'text'))) { pick(p, e.button === 0 && e.shiftKey); drag = { kind: 'pick' }; return; }
    switch (tool) {
      case 'move': { const d = startMove(p); if (d) drag = d; return; }
      case 'marquee': case 'ellipse': drag = { kind: 'rect', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 }, mode: selModeOf(e), shiftAtStart: e.shiftKey }; return;
      case 'lasso': drag = { kind: 'lasso', path: [{ x: p.x, y: p.y }], mode: selModeOf(e) }; return;
      case 'polygon': {
        if (!polygon) { polygon = [{ x: p.x, y: p.y }]; polygon.mode = selModeOf(e); }
        else {
          const f = toScreen(polygon[0].x, polygon[0].y);
          if (polygon.length > 2 && Math.hypot(f.x - p.sx, f.y - p.sy) < 8) closePolygon();
          else polygon.push({ x: p.x, y: p.y });
        }
        draw(); return;
      }
      case 'wand': wand(p, selModeOf(e)); return;
      case 'fill': bucket(p); return;
      case 'gradient': { const s = startGradient(p); if (s) drag = { kind: 'gradient', s, line: s.line }; return; }
      case 'shape': drag = { kind: 'shape', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 }, line: opts.shape === 'line' ? { x0: p.x, y0: p.y, x1: p.x, y1: p.y } : null }; if (drag.line) drag.rect = null; return;
      case 'text': { const hit = textUnder(p); if (hit) { textAt(p); return; } drag = { kind: 'textbox', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } }; return; }
      case 'pen': { const d = penDown(p, e); if (d) drag = d; draw(); return; }
      case 'assist':
        if (opts.assistType === 'vanish') { addAssist({ type: 'vanish', x: p.x, y: p.y }); return; }
        drag = { kind: 'assist', start: p, line: { x0: p.x, y0: p.y, x1: p.x, y1: p.y } }; return;
      default:
        if (PAINTERS.has(tool)) {
          const s = startStroke(p, e);
          if (s) { drag = { kind: 'stroke', s, cloneOffset: s.cloneOffset }; if (e.shiftKey && D.lastPaint) { strokeLine(s, D.lastPaint, p); } needCompose = true; draw(); }
        }
    }
  }
  /** Shift+click with a painting tool: a straight line from where the last stroke ended. */
  function strokeLine(s, from, to) { s.last = { ...from }; s.carry = 0; s.smooth = { ...to }; const keep = brush.smoothing; brush.smoothing = 0; strokeTo(s, to, s.pressure); brush.smoothing = keep; }

  function onMove(e) {
    if (!D) return;
    const p = pointAt(e);
    hover = { x: p.x, y: p.y, sx: p.sx, sy: p.sy };
    if (!drag) { status(); if (PAINTERS.has(tool) || polygon || pen || tool === 'clone' || tool === 'heal') draw(); setCursor(p); return; }
    switch (drag.kind) {
      case 'pan': { const a = -D.view.angle * Math.PI / 180, dx = (p.sx - drag.sx) / D.view.zoom, dy = (p.sy - drag.sy) / D.view.zoom; D.view.cx = drag.cx - (dx * Math.cos(a) - dy * Math.sin(a)); D.view.cy = drag.cy - (dx * Math.sin(a) + dy * Math.cos(a)); D.view.fitted = false; break; }
      case 'rotate': { const s = stageSize(), a = Math.atan2(p.sy - s.h / 2, p.sx - s.w / 2); let ang = drag.angle + (a - drag.a0) * 180 / Math.PI; if (e.shiftKey) ang = Math.round(ang / 15) * 15; D.view.angle = ((ang % 360) + 540) % 360 - 180; break; }
      case 'move': { let dx = Math.round(p.x - drag.start.x), dy = Math.round(p.y - drag.start.y); if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } moveBy(drag, dx, dy); break; }
      case 'tmove': { const dx = Math.round(p.x - drag.start.x), dy = Math.round(p.y - drag.start.y); transform.corners = drag.corners.map((c) => ({ x: c.x + dx, y: c.y + dy })); needCompose = true; break; }
      case 'transform': dragTransform(drag, p, e); needCompose = true; break;
      case 'assist': drag.line.x1 = p.x; drag.line.y1 = p.y; break;
      case 'textbox': drag.rect = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) }; break;
      case 'rect': case 'shape': {
        if (drag.line) { drag.line.x1 = p.x; drag.line.y1 = p.y; if (e.shiftKey) { const a = Math.round(Math.atan2(p.y - drag.start.y, p.x - drag.start.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(p.x - drag.start.x, p.y - drag.start.y); drag.line.x1 = drag.start.x + Math.cos(a) * len; drag.line.y1 = drag.start.y + Math.sin(a) * len; } break; }
        let w = p.x - drag.start.x, h = p.y - drag.start.y;
        if (e.shiftKey && !drag.shiftAtStart) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        let x0 = drag.start.x, y0 = drag.start.y;
        if (e.altKey && drag.mode !== 'subtract' && drag.mode !== 'intersect') { x0 -= w; y0 -= h; w *= 2; h *= 2; }
        drag.rect = { x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), w: Math.abs(w), h: Math.abs(h) };
        break;
      }
      case 'lasso': drag.path.push({ x: p.x, y: p.y }); break;
      case 'pennew': case 'penedit': penDrag(drag, p, e); break;
      case 'gradient': {
        let x1 = p.x, y1 = p.y;
        if (e.shiftKey) { const a = Math.round(Math.atan2(y1 - drag.line.y0, x1 - drag.line.x0) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x1 - drag.line.x0, y1 - drag.line.y0); x1 = drag.line.x0 + Math.cos(a) * len; y1 = drag.line.y0 + Math.sin(a) * len; }
        drag.line.x1 = x1; drag.line.y1 = y1; drag.s.render(); needCompose = true; break;
      }
      case 'stroke': {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of (evs.length ? evs : [e])) { const q = snapPoint(drag.s, pointAt(ev)); strokeTo(drag.s, q, pressureOf(ev)); }
        needCompose = true; break;
      }
      case 'cropnew': { let w = p.x - drag.start.x, h = p.y - drag.start.y; const ratio = RATIOS[opts.cropRatio] || (e.shiftKey ? 1 : null); if (ratio) h = Math.sign(h || 1) * Math.abs(w) / ratio; cropBox = { x: Math.min(drag.start.x, drag.start.x + w), y: Math.min(drag.start.y, drag.start.y + h), w: Math.abs(w), h: Math.abs(h) }; break; }
      case 'cropmove': cropBox = { ...drag.box, x: drag.box.x + p.x - drag.start.x, y: drag.box.y + p.y - drag.start.y }; break;
      case 'cropsize': {
        const b = drag.box, h = drag.handle;
        let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
        if ([0, 6, 7].includes(h)) x0 = p.x; if ([2, 3, 4].includes(h)) x1 = p.x; if ([0, 1, 2].includes(h)) y0 = p.y; if ([4, 5, 6].includes(h)) y1 = p.y;
        const ratio = RATIOS[opts.cropRatio];
        if (ratio && h % 2 === 0) { const w = Math.abs(x1 - x0), hh = w / ratio; if ([0, 2].includes(h)) y0 = y1 - hh; else y1 = y0 + hh; }
        cropBox = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        break;
      }
      default: break;
    }
    draw(); status();
  }

  function onUp(e) {
    const d = drag;
    drag = null;
    if (!d || !D) return;
    try { $('#ph-canvas').releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    const p = pointAt(e);
    switch (d.kind) {
      case 'move': {
        const after = snap();
        if (after.layers.some((x, i) => x.props.x !== d.before.layers[i].props.x || x.props.y !== d.before.layers[i].props.y || (x.props.mask && d.before.layers[i].props.mask && (x.props.mask.x !== d.before.layers[i].props.mask.x || x.props.mask.y !== d.before.layers[i].props.mask.y))))
          pushStep('Move', () => restore(d.before), () => restore(after));
        break;
      }
      case 'tmove': if (d.autoCommit) commitTransform('Move the selection'); break;
      case 'penedit': penUp(d); break;
      case 'assist': {
        const l2 = d.line, len = Math.hypot(l2.x1 - l2.x0, l2.y1 - l2.y0);
        if (len < 3) break;
        if (opts.assistType === 'ellipse') addAssist({ type: 'ellipse', cx: (l2.x0 + l2.x1) / 2, cy: (l2.y0 + l2.y1) / 2, rx: Math.max(2, Math.abs(l2.x1 - l2.x0) / 2), ry: Math.max(2, Math.abs(l2.y1 - l2.y0) / 2), angle: 0 });
        else addAssist({ type: 'parallel', ...l2 });
        break;
      }
      case 'textbox': if (d.rect.w > 12) textAt(d.start, d.rect); else textAt(d.start); break;
      case 'rect': {
        const r = d.rect;
        if (r.w < 1 || r.h < 1) { if (d.mode === 'new') deselect(); break; }
        combineSel(shapeMask((x) => { x.beginPath(); if (tool === 'ellipse') x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); else x.rect(r.x, r.y, r.w, r.h); x.fill(); }), d.mode);
        break;
      }
      case 'lasso': if (d.path.length > 2) combineSel(shapeMask((x) => { x.beginPath(); d.path.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); x.closePath(); x.fill(); }), d.mode); else if (d.mode === 'new') deselect(); break;
      case 'gradient': endGradient(d.s); break;
      case 'shape': if (d.line) { if (Math.hypot(d.line.x1 - d.line.x0, d.line.y1 - d.line.y0) >= 1) makeShape(null, d.line); } else if (d.rect.w >= 1 && d.rect.h >= 1) makeShape(d.rect); break;
      case 'stroke': D.lastPaint = { x: d.s.last.x, y: d.s.last.y }; if (brush.smoothing > 0) { const keep = brush.smoothing; brush.smoothing = 0; strokeTo(d.s, snapPoint(d.s, p), d.s.pressure); brush.smoothing = keep; } endStroke(d.s); break;
      case 'cropnew': if (!cropBox || cropBox.w < 2 || cropBox.h < 2) cropBox = null; renderOptions(); break;
      default: break;
    }
    needCompose = true; draw(); setCursor(p); status();
  }
  function closePolygon() {
    const pts = polygon; polygon = null;
    if (pts && pts.length > 2) combineSel(shapeMask((x) => { x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); x.closePath(); x.fill(); }), pts.mode || 'new');
    draw();
  }
  function onWheel(e) {
    if (!D) return;
    e.preventDefault();
    const p = pointAt(e);
    if (e.ctrlKey || e.metaKey || e.altKey || settings.wheelZooms) { zoomTo(D.view.zoom * Math.exp(-e.deltaY * 0.0015), { x: p.sx, y: p.sy }); return; }
    const a = -D.view.angle * Math.PI / 180, dx = (e.shiftKey ? e.deltaY : e.deltaX) / D.view.zoom, dy = (e.shiftKey ? 0 : e.deltaY) / D.view.zoom;
    D.view.cx += dx * Math.cos(a) - dy * Math.sin(a); D.view.cy += dx * Math.sin(a) + dy * Math.cos(a); D.view.fitted = false;
    draw();
  }
  /** The eyedropper: the colour of the picture (or the layer) under the cursor. Shift: the second colour. */
  function pick(p, second) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= D.doc.width || y >= D.doc.height) return;
    let d;
    if (opts.allLayers || settings.pickAll !== false) d = g2(composite || compose(D)).getImageData(x, y, 1, 1).data;
    else { const l = L(), own = l && itemCanvas(l); d = own ? g2(own.canvas).getImageData(x - own.x, y - own.y, 1, 1).data : [0, 0, 0, 0]; }
    if (!d[3]) return;
    const h = rgbHex(d[0], d[1], d[2]);
    if (second) bg = h; else fg = h;
    renderColours();
  }
  function setCursor(p) {
    const cv = $('#ph-canvas');
    if (!cv) return;
    let c = 'default';
    if (spaceHeld || tool === 'hand' || (drag && drag.kind === 'pan')) c = drag && drag.kind === 'pan' ? 'grabbing' : 'grab';
    else if (transform) { const h = p ? transformHit(p) : {}; c = h.handle !== undefined ? 'nwse-resize' : h.inside ? 'move' : 'alias'; }
    else if (PAINTERS.has(tool)) c = altHeld ? 'copy' : 'none';
    else if (tool === 'picker' || (altHeld && (tool === 'fill' || tool === 'gradient'))) c = 'copy';
    else if (tool === 'move') c = 'move';
    else if (tool === 'zoom') c = altHeld ? 'zoom-out' : 'zoom-in';
    else if (tool === 'text') c = 'text';
    else c = 'crosshair';
    cv.style.cursor = c;
  }

  // ---------------------------------------------------------------- layers

  function uniqueName(base) { const names = new Set(D.doc.layers.map((l) => l.name)); if (!names.has(base)) return base; let i = 2; while (names.has(`${base} ${i}`)) i++; return `${base} ${i}`; }
  /** Puts a new layer just above the active one (in the same group). */
  function addLayerAbove(l, label = 'New layer') {
    change(label, () => {
      const a = L();
      l.parent = a ? (a.kind === 'group' && !a.collapsed && label !== 'Group' ? a.id : a.parent) : null;
      if (l.kind === 'pixel' && !l.canvas) l.canvas = canvas(D.doc.width, D.doc.height);
      const list = D.doc.layers, i = a ? list.indexOf(a) : list.length - 1;
      // Into an open group: at its top (just under the group's own entry).
      list.splice(a && a.kind === 'group' && l.parent === a.id ? i : i + 1, 0, l);
      D.active = l.id;
    });
  }
  const newLayer = () => addLayerAbove(makeLayer({ name: uniqueName('Layer') }));
  function duplicateLayer() {
    const a = L();
    if (!a) return;
    change('Duplicate layer', () => {
      const map = new Map();
      const copies = block(a).map((l) => {
        const c = makeLayer({ ...l, id: newId(), name: l === a ? `${l.name} copy` : l.name, canvas: l.canvas ? copyOf(l.canvas) : null, mask: l.mask ? { ...l.mask, canvas: copyOf(l.mask.canvas), ver: ++VER } : null, fill: clone(l.fill), adjust: clone(l.adjust), text: clone(l.text), styles: clone(l.styles), shape: clone(l.shape), filters: clone(l.filters) || [] });
        map.set(l.id, c.id);
        return c;
      });
      for (const c of copies) if (map.has(c.parent)) c.parent = map.get(c.parent);
      const i = D.doc.layers.indexOf(a);
      D.doc.layers.splice(i + 1, 0, ...copies);
      D.active = copies[copies.length - 1].id;
    });
  }
  function deleteLayer() {
    const a = L();
    if (!a) return;
    if (D.doc.layers.length - block(a).length < 1) { notice('A picture keeps at least one layer.', 2000); return; }
    change('Delete layer', () => {
      const gone = new Set(block(a).map((l) => l.id)), i = D.doc.layers.indexOf(a);
      D.doc.layers = D.doc.layers.filter((l) => !gone.has(l.id));
      const next = D.doc.layers[Math.min(i - gone.size + 1, D.doc.layers.length - 1)] || D.doc.layers[D.doc.layers.length - 1];
      D.active = next ? next.id : null;
    });
  }
  /** Layer › Group (Ctrl+G): the active layer goes into a new group. */
  function groupLayer() {
    const a = L();
    if (!a) return;
    change('Group', () => {
      const g = makeLayer({ kind: 'group', name: uniqueName('Group'), parent: a.parent });
      a.parent = g.id;
      D.doc.layers.splice(D.doc.layers.indexOf(a) + 1, 0, g);
      D.active = g.id;
    });
  }
  function ungroup() {
    const g = L();
    if (!g || g.kind !== 'group') { notice('Choose a group first.', 1800); return; }
    change('Ungroup', () => {
      for (const k of kids(g.id)) { k.parent = g.parent; if (g.opacity < 1) k.opacity *= g.opacity; }
      const first = kids(g.id)[0];
      D.doc.layers = D.doc.layers.filter((l) => l !== g);
      D.active = first ? first.id : (D.doc.layers[0] || {}).id;
    });
  }
  /** Up (+1) or down (−1) one place among its neighbours; or to the top / bottom (±2). */
  function arrange(dir) {
    const a = L();
    if (!a) return;
    change(dir > 0 ? 'Bring forward' : 'Send backward', () => {
      const sib = kids(a.parent || null), i = sib.indexOf(a);
      const j = dir === 2 ? sib.length - 1 : dir === -2 ? 0 : i + dir;
      if (j < 0 || j >= sib.length || j === i) return false;
      const mine = block(a), rest = D.doc.layers.filter((l) => !mine.includes(l)), other = sib[j];
      const at = dir > 0 ? rest.indexOf(other) + 1 : rest.indexOf(block(other)[0]);
      rest.splice(at, 0, ...mine);
      D.doc.layers = rest;
      return undefined;
    });
  }
  /** Drag and drop in the layers panel: above or below another layer, or into a group. */
  function dropLayer(id, targetId, where) {
    const a = byId(id), t = byId(targetId);
    if (!a || !t || a === t || (a.kind === 'group' && descendants(a.id).includes(t))) return;
    change('Move layer', () => {
      const mine = block(a);
      let rest = D.doc.layers.filter((l) => !mine.includes(l));
      if (where === 'into' && t.kind === 'group') { a.parent = t.id; rest.splice(rest.indexOf(t), 0, ...mine); }
      else if (where === 'above') { a.parent = t.parent; rest.splice(rest.indexOf(t) + 1, 0, ...mine); }
      else { a.parent = t.parent; rest.splice(rest.indexOf(block(t)[0]), 0, ...mine); }
      D.doc.layers = rest;
    });
  }
  /** The layer (or the group with all in it) as one pixel layer, the way it looks. */
  function rasterOf(l) {
    const W = D.doc.width, H = D.doc.height, c = canvas(W, H);
    if (l.kind === 'adjust') return null;
    const own = itemCanvas(l);
    if (own) g2(c).drawImage(own.canvas, own.x, own.y);
    return c;
  }
  function rasterize() {
    const l = L();
    if (!l || (l.kind === 'pixel' && !(l.filters || []).length && !l.mask && !(window.NoorPhotoStyle && NoorPhotoStyle.any(l.styles)) && (l.fillOpacity ?? 1) === 1)) { notice('That layer is pixels already.', 1600); return; }
    if (l.kind === 'adjust') { notice('An adjustment layer has no pixels: merge it down instead.', 2400); return; }
    change('Rasterize', () => {
      const c = rasterOf(l);
      for (const k of l.kind === 'group' ? descendants(l.id) : []) D.doc.layers.splice(D.doc.layers.indexOf(k), 1);
      Object.assign(l, { kind: 'pixel', canvas: c, x: 0, y: 0, mask: null, fill: null, text: null, shape: null, filters: [], adjust: null, styles: null, fillOpacity: 1 });
      touch(l);
    });
  }
  /** Ctrl+E: the layer onto the one under it (an adjustment layer changes the pixels under it). */
  function mergeDown() {
    const a = L();
    if (!a) return;
    const sib = kids(a.parent || null), i = sib.indexOf(a), under = sib[i - 1];
    if (!under) { notice('There is no layer under this one to merge into.', 2200); return; }
    if (under.kind === 'adjust') { notice('The layer under this one is an adjustment layer: move it or merge that one down first.', 3000); return; }
    change('Merge down', () => {
      const W = D.doc.width, H = D.doc.height, c = rasterOf(under) || canvas(W, H);
      renderItems([{ ...a, clip: false, visible: a.visible }], c);
      for (const k of a.kind === 'group' ? descendants(a.id) : []) D.doc.layers.splice(D.doc.layers.indexOf(k), 1);
      for (const k of under.kind === 'group' ? descendants(under.id) : []) D.doc.layers.splice(D.doc.layers.indexOf(k), 1);
      D.doc.layers.splice(D.doc.layers.indexOf(a), 1);
      Object.assign(under, { kind: 'pixel', canvas: c, x: 0, y: 0, mask: null, fill: null, text: null, shape: null, adjust: null, filters: [], styles: null, fillOpacity: 1 });
      touch(under);
      D.active = under.id;
    });
  }
  /** Merge visible (Ctrl+Shift+E) or flatten (everything into one, hidden layers dropped). */
  function flatten(visibleOnly) {
    change(visibleOnly ? 'Merge visible' : 'Flatten', () => {
      const c = compose(D, { noCache: true });
      const l = makeLayer({ name: visibleOnly ? 'Merged' : 'Background', canvas: c });
      if (visibleOnly) {
        const hidden = D.doc.layers.filter((k) => !k.visible && !k.parent);
        const keep = new Set(hidden.flatMap(block));
        D.doc.layers = [...D.doc.layers.filter((k) => keep.has(k)), l];
      } else {
        const back = canvas(D.doc.width, D.doc.height), x = g2(back);
        x.fillStyle = '#fff'; x.fillRect(0, 0, back.width, back.height); x.drawImage(c, 0, 0);
        l.canvas = back;
        D.doc.layers = [l];
      }
      D.active = l.id;
    });
  }
  function setProp(l, label, fn) { change(label, () => { fn(l); touch(l); }); }

  // Masks: white shows the layer, black hides it. While a mask is being edited painting goes to it.
  function addMask(fromSel, hideAll) {
    const l = L();
    if (!l) return;
    if (l.mask) { notice('This layer has a mask already.', 1800); return; }
    change('Add mask', () => {
      const W = D.doc.width, H = D.doc.height, m = makeMask(0, 0, W, H, hideAll ? 0 : 255);
      if (fromSel && D.sel) { const x = g2(m.canvas); x.clearRect(0, 0, W, H); x.drawImage(D.sel, 0, 0); m.background = 0; }
      l.mask = m;
      D.editMask = true;
    });
    if (fromSel && D.sel) setSel(null);
  }
  function deleteMask(applyIt) {
    const l = L();
    if (!l || !l.mask) return;
    if (applyIt && l.kind !== 'pixel') { notice('Only a pixel layer\'s mask can be applied (Rasterize first).', 2400); return; }
    change(applyIt ? 'Apply mask' : 'Delete mask', () => {
      if (applyIt) {
        const W = D.doc.width, H = D.doc.height, c = canvas(W, H), x = g2(c);
        x.drawImage(l.canvas, l.x, l.y); x.globalCompositeOperation = 'destination-in'; x.drawImage(maskFull(l), 0, 0);
        l.canvas = c; l.x = 0; l.y = 0;
      }
      l.mask = null; D.editMask = false; D.showMaskOnly = false;
      touch(l);
    });
  }
  function toggleMaskOn() { const l = L(); if (l && l.mask) setProp(l, l.mask.enabled ? 'Mask off' : 'Mask on', () => { l.mask.enabled = !l.mask.enabled; l.mask.ver = ++VER; }); }
  function invertMask() {
    const l = L();
    if (!l || !l.mask) return;
    change('Invert mask', () => {
      const m = l.mask, c = canvas(m.canvas.width, m.canvas.height), x = g2(c);
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'destination-out'; x.drawImage(m.canvas, 0, 0);
      m.canvas = c; m.background = 255 - m.background; m.ver = ++VER;
    });
  }
  function toggleClip() { const l = L(); if (l) setProp(l, l.clip ? 'Release clipping' : 'Clip to the layer under', () => { l.clip = !l.clip; }); }

  /** Fill layers: a colour or a gradient over everything (a mask from the selection, if there is one). */
  function newFillLayer(type) {
    const fill = type === 'gradient' ? { type: 'gradient', stops: [fg, bg], angle: 90, shape: 'linear', scale: 100, reverse: false } : type === 'pattern' ? { type: 'pattern', pattern: 'checker', a: fg, b: bg, scale: 100 } : { type: 'colour', colour: fg };
    const l = makeLayer({ kind: 'fill', name: uniqueName(type === 'gradient' ? 'Gradient fill' : type === 'pattern' ? 'Pattern fill' : 'Colour fill'), fill });
    if (D.sel) { l.mask = makeMask(0, 0, D.doc.width, D.doc.height, 0); g2(l.mask.canvas).drawImage(D.sel, 0, 0); }
    addLayerAbove(l, 'New fill layer');
    if (D.sel) setSel(null);
    fillDialog(l, true);
  }
  /** Adjustment layers: levels, curves… over what is under them, kept as settings (a mask from the selection). */
  function newAdjustLayer(id) {
    const a = Fx().ADJUSTMENTS.find((x) => x.id === id);
    if (!a) return;
    const l = makeLayer({ kind: 'adjust', name: uniqueName(a.name), adjust: { id, params: Fx().defaults(id) } });
    if (D.sel) { l.mask = makeMask(0, 0, D.doc.width, D.doc.height, 0); g2(l.mask.canvas).drawImage(D.sel, 0, 0); }
    addLayerAbove(l, 'New adjustment layer');
    if (D.sel) setSel(null);
    effectDialog({ id, adjust: true, layer: l, fresh: true });
  }

  // ---------------------------------------------------------------- copy, paste, layer via copy

  /** The selected pixels of the layer (all of it without a selection): { canvas, x, y }. */
  function selectedPixels(l, all) {
    const r = D.sel ? selBounds() : { x: 0, y: 0, w: D.doc.width, h: D.doc.height };
    if (!r) return null;
    const c = canvas(r.w, r.h), x = g2(c);
    if (all) x.drawImage(composite || compose(D), -r.x, -r.y);
    else { const own = itemCanvas(l); if (own) x.drawImage(own.canvas, own.x - r.x, own.y - r.y); }
    if (D.sel) { x.globalCompositeOperation = 'destination-in'; x.drawImage(D.sel, -r.x, -r.y); }
    return { canvas: c, x: r.x, y: r.y };
  }
  async function copy(cut, merged) {
    const l = L();
    if (!l) return;
    const px = selectedPixels(l, merged);
    if (!px) return;
    clip = px;
    try { const blob = await new Promise((res) => px.canvas.toBlob(res, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch { /* the copy is kept here either way */ }
    if (cut && !merged) clearSelected();
    notice(cut ? 'Cut' : merged ? 'Copied (everything you see)' : 'Copied', 1000);
  }
  async function paste() {
    // A picture copied elsewhere (newer than ours) comes first; else ours.
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const c = await canvasFromBytes(new Uint8Array(await (await it.getType(type)).arrayBuffer()), type);
        if (!clip || c.width !== clip.canvas.width || c.height !== clip.canvas.height) { pasteCanvas(c, null); return; }
      }
    } catch { /* no access to the clipboard: ours */ }
    if (clip) pasteCanvas(copyOf(clip.canvas), clip);
  }
  function pasteCanvas(c, at) {
    const x = at ? at.x : Math.round((D.doc.width - c.width) / 2), y = at ? at.y : Math.round((D.doc.height - c.height) / 2);
    addLayerAbove(makeLayer({ name: uniqueName('Pasted'), canvas: c, x, y }), 'Paste');
  }
  /** Ctrl+J / Ctrl+Shift+J: the selected pixels (or the whole layer) on a new layer, copied or cut. */
  function layerVia(cut) {
    const l = L();
    if (!l) return;
    if (!D.sel) { duplicateLayer(); return; }
    if (l.kind !== 'pixel') { notice('Choose a pixel layer.', 1800); return; }
    const px = selectedPixels(l, false);
    if (!px) return;
    const before = snap();
    // A cut changes the layer's pixels: it gets a new picture, so the step can put the old one back.
    if (cut) { const c = copyOf(l.canvas), x = g2(c); x.globalCompositeOperation = 'destination-out'; x.drawImage(D.sel, -l.x, -l.y); l.canvas = c; touch(l); }
    const n = makeLayer({ name: uniqueName(cut ? 'Cut' : 'Copied'), canvas: px.canvas, x: px.x, y: px.y, parent: l.parent });
    D.doc.layers.splice(D.doc.layers.indexOf(l) + 1, 0, n);
    D.active = n.id;
    const after = snap();
    pushStep(cut ? 'Layer via cut' : 'Layer via copy', () => restore(before), () => restore(after));
  }

  // ---------------------------------------------------------------- painting helpers: the pop-up palette, guides, references

  /** Right-click on the picture: a ring of colours used lately and an inner ring of brushes, right at the cursor. */
  function popupPalette(cx, cy) {
    closePopup();
    const base = ['#000000', '#ffffff', '#e03131', '#f08c00', '#fcc419', '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#868e96', '#5c3b1e', '#f3d9b1'];
    const colours = [...new Set([...recentColours, ...base])].slice(0, 12), brushes = allBrushes().slice(0, 8);
    const box = el('div', { class: 'ph-popup', id: 'ph-popup', tabindex: '-1', role: 'dialog', 'aria-label': 'Colours and brushes', style: `left:${cx - 110}px;top:${cy - 110}px` });
    colours.forEach((c, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / colours.length; box.append(el('button', { class: 'ph-pop-colour', title: c, 'aria-label': c, style: `background:${c};left:${110 + Math.cos(a) * 92 - 13}px;top:${110 + Math.sin(a) * 92 - 13}px`, onclick: () => { fg = c; renderColours(); closePopup(); } })); });
    brushes.forEach((b, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / brushes.length; box.append(el('button', { class: 'ph-pop-brush', title: b.name, 'aria-label': b.name, style: `left:${110 + Math.cos(a) * 52 - 17}px;top:${110 + Math.sin(a) * 52 - 12}px`, onclick: () => { applyPreset(b); closePopup(); } }, b.name.split(/[\s(]/)[0])); });
    box.append(el('button', { class: 'ph-pop-centre', title: 'Swap the colours', 'aria-label': 'Swap the colours', style: `background:linear-gradient(135deg, ${fg} 50%, ${bg} 50%)`, onclick: () => { swapColours(); closePopup(); } }));
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopup(); } });
    document.body.append(box);
    box.focus();
    setTimeout(() => document.addEventListener('pointerdown', popupAway, true), 0);
  }
  function popupAway(e) { if (!e.target.closest('#ph-popup')) closePopup(); }
  function closePopup() { const b = $('#ph-popup'); if (b) b.remove(); document.removeEventListener('pointerdown', popupAway, true); }

  // Painting guides (assistants): a ruler (strokes run parallel to it), a vanishing point (strokes run towards it) or
  // an ellipse (strokes follow it, larger or smaller). The last one placed (or the one chosen) guides the brushes
  // while "follow the guide" is on.
  function assistAt(p) {
    const a = D.assists && D.assists[D.assistActive ?? D.assists.length - 1];
    if (!a || !D.snapAssist) return null;
    return a;
  }
  function snapPoint(s, q) {
    const a = s.assist;
    if (!a) return q;
    const o = s.anchor;
    if (a.type === 'ellipse') {
      const cos = Math.cos(-a.angle), sin = Math.sin(-a.angle), loc = (pt) => { const dx = pt.x - a.cx, dy = pt.y - a.cy; return { x: (dx * cos - dy * sin) / a.rx, y: (dx * sin + dy * cos) / a.ry }; };
      const lo = loc(o), lq = loc(q), k = Math.hypot(lo.x, lo.y) || 1, t = Math.atan2(lq.y, lq.x);
      const ux = Math.cos(t) * k * a.rx, uy = Math.sin(t) * k * a.ry;
      return { x: a.cx + ux * Math.cos(a.angle) - uy * Math.sin(a.angle), y: a.cy + ux * Math.sin(a.angle) + uy * Math.cos(a.angle) };
    }
    let dx, dy;
    if (a.type === 'vanish') { dx = o.x - a.x; dy = o.y - a.y; } else { dx = a.x1 - a.x0; dy = a.y1 - a.y0; }
    const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, t = (q.x - o.x) * ux + (q.y - o.y) * uy;
    return { x: o.x + ux * t, y: o.y + uy * t };
  }
  function drawAssists(x) {
    if (!D.assists || !D.assists.length) return;
    x.save(); x.lineWidth = 1;
    D.assists.forEach((a, i) => {
      const on = i === (D.assistActive ?? D.assists.length - 1);
      x.strokeStyle = on ? 'rgba(255,79,216,.9)' : 'rgba(255,79,216,.35)';
      if (a.type === 'vanish') {
        const c = toScreen(a.x, a.y);
        x.beginPath(); x.arc(c.x, c.y, 6, 0, Math.PI * 2); x.stroke();
        x.setLineDash([3, 5]); x.beginPath();
        for (let k = 0; k < 16; k++) { const t = k * Math.PI / 8; x.moveTo(c.x, c.y); x.lineTo(c.x + Math.cos(t) * 2000, c.y + Math.sin(t) * 2000); }
        x.stroke(); x.setLineDash([]);
      } else if (a.type === 'ellipse') {
        x.save(); viewTransform(x); x.lineWidth = 1 / D.view.zoom;
        for (const k of [1, 0.66, 1.33]) { x.globalAlpha = k === 1 ? 1 : 0.4; x.beginPath(); x.ellipse(a.cx, a.cy, a.rx * k, a.ry * k, a.angle, 0, Math.PI * 2); x.stroke(); }
        x.restore();
      } else {
        const p0 = toScreen(a.x0, a.y0), p1 = toScreen(a.x1, a.y1), dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
        x.beginPath(); x.moveTo(p0.x - dx / len * 3000, p0.y - dy / len * 3000); x.lineTo(p0.x + dx / len * 3000, p0.y + dy / len * 3000); x.stroke();
        for (const q of [p0, p1]) { x.beginPath(); x.arc(q.x, q.y, 4, 0, Math.PI * 2); x.stroke(); }
      }
    });
    x.restore();
  }
  function addAssist(a) {
    D.assists = [...(D.assists || []), a]; D.assistActive = D.assists.length - 1; D.snapAssist = true;
    renderOptions(); draw();
  }
  function clearAssists() { D.assists = []; D.assistActive = null; renderOptions(); draw(); }

  // Reference pictures: floating over the canvas (not part of the picture), moved by their bar, sized by their corner,
  // made fainter; the eyedropper (or Alt+click) takes colours from them.
  let refSeq = 0;
  async function addReference() {
    try {
      const r = await req('photo.place');
      if (!r || r.cancelled || !r.picture) return;
      const c = r.picture.png ? await canvasFromBytes(unb64(r.picture.png)) : await canvasFromBytes(unb64(r.picture.data), r.picture.mime);
      showReference(c, r.name || 'Reference');
    } catch (err) { hooks.showError(err); }
  }
  function showReference(c, name) {
    const id = `ph-ref-${++refSeq}`, k = Math.min(1, 280 / c.width, 220 / c.height);
    const img = c; img.className = 'ph-ref-img';
    const op = el('input', { type: 'range', min: '10', max: '100', value: '100', 'aria-label': 'Opacity', title: 'Opacity' });
    const box = el('div', { class: 'ph-ref', id, style: `left:${20 + (refSeq % 5) * 24}px;top:${20 + (refSeq % 5) * 24}px;width:${Math.round(c.width * k)}px;height:${Math.round(c.height * k) + 26}px` },
      el('div', { class: 'ph-ref-bar' }, el('span', { 'data-noi18n': '', text: name }), op, el('button', { class: 'ph-ref-x', 'aria-label': 'Close the reference', title: 'Close', onclick: () => box.remove() }, '×')), img);
    op.addEventListener('input', () => { img.style.opacity = String(Number(op.value) / 100); });
    const bar = box.querySelector('.ph-ref-bar');
    bar.addEventListener('pointerdown', (e) => {
      if (e.target !== bar && e.target.tagName !== 'SPAN') return;
      const sx = e.clientX - box.offsetLeft, sy = e.clientY - box.offsetTop;
      bar.setPointerCapture(e.pointerId);
      const mv = (ev) => { box.style.left = `${ev.clientX - sx}px`; box.style.top = `${ev.clientY - sy}px`; };
      const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
    });
    img.addEventListener('pointerdown', (e) => {
      if (tool !== 'picker' && !e.altKey) return;
      const r = img.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * c.width), y = Math.floor((e.clientY - r.top) / r.height * c.height);
      const d = g2(c).getImageData(clamp(x, 0, c.width - 1), clamp(y, 0, c.height - 1), 1, 1).data;
      if (e.shiftKey) bg = rgbHex(d[0], d[1], d[2]); else fg = rgbHex(d[0], d[1], d[2]);
      renderColours(); e.preventDefault();
    });
    $('#ph-stage').append(box);
  }

  // ---------------------------------------------------------------- the image: size, canvas, turning

  /** Scales a picture smoothly (big reductions in halves, so nothing shimmers). */
  function scaled(src, w, h, smooth = true) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let cur = src;
    if (smooth) while (cur.width / 2 >= w && cur.height / 2 >= h) { const half = canvas(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2)), x = g2(half); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, half.width, half.height); cur = half; }
    const out = canvas(w, h), x = g2(out);
    x.imageSmoothingEnabled = smooth; x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, w, h);
    return out;
  }
  function imageSize(w, h, smooth) {
    const sx = w / D.doc.width, sy = h / D.doc.height;
    change('Image size', () => {
      for (const l of D.doc.layers) {
        if (l.canvas) { l.canvas = scaled(l.canvas, l.canvas.width * sx, l.canvas.height * sy, smooth); }
        l.x = Math.round(l.x * sx); l.y = Math.round(l.y * sy);
        if (l.mask) { l.mask = { ...l.mask, canvas: scaled(l.mask.canvas, l.mask.canvas.width * sx, l.mask.canvas.height * sy, smooth), x: Math.round(l.mask.x * sx), y: Math.round(l.mask.y * sy), ver: ++VER }; }
        if (l.text) l.text = { ...l.text, size: Math.max(1, Math.round(l.text.size * Math.min(sx, sy))) };
        if (l.shape) { const M = new DOMMatrix().scale(sx, sy).multiply(shapeMatrix({ ...l, x: l.x / sx, y: l.y / sy })); l.shape = { ...l.shape, m: [M.a, M.b, M.c, M.d, M.e, M.f] }; l.x = 0; l.y = 0; }
        touch(l);
      }
      D.doc.guides = D.doc.guides.map((g) => ({ ...g, at: g.at * (g.axis === 'x' ? sx : sy) }));
      D.doc.width = w; D.doc.height = h;
    });
    D.sel = null; D.selVer = ++VER; fit(); renderAll();
  }
  function canvasSize(w, h, ax, ay) {
    const dx = Math.round((w - D.doc.width) * ax), dy = Math.round((h - D.doc.height) * ay);
    change('Canvas size', () => {
      for (const l of D.doc.layers) { if (l.kind === 'pixel' || l.kind === 'text' || l.kind === 'shape') { l.x += dx; l.y += dy; } if (l.mask) { l.mask.x += dx; l.mask.y += dy; l.mask.ver = ++VER; } touch(l); }
      D.doc.guides = D.doc.guides.map((g) => ({ ...g, at: g.at + (g.axis === 'x' ? dx : dy) }));
      D.doc.width = w; D.doc.height = h;
    });
    D.sel = null; D.selVer = ++VER; fit(); renderAll();
  }
  /** Turns or flips the whole picture: every layer's picture and mask, and where it sits. */
  function turnImage(kind) {
    const W = D.doc.width, H = D.doc.height, swap = kind === 'cw' || kind === 'ccw';
    const map = (c, x, y) => {
      const w = c.width, h = c.height, out = canvas(swap ? h : w, swap ? w : h), t = g2(out);
      if (kind === 'cw') { t.translate(h, 0); t.rotate(Math.PI / 2); }
      else if (kind === 'ccw') { t.translate(0, w); t.rotate(-Math.PI / 2); }
      else if (kind === '180') { t.translate(w, h); t.rotate(Math.PI); }
      else if (kind === 'h') { t.translate(w, 0); t.scale(-1, 1); }
      else { t.translate(0, h); t.scale(1, -1); }
      t.drawImage(c, 0, 0);
      const nx = kind === 'cw' ? H - y - h : kind === 'ccw' ? y : kind === '180' || kind === 'h' ? W - x - w : x;
      const ny = kind === 'cw' ? x : kind === 'ccw' ? W - x - w : kind === '180' || kind === 'v' ? H - y - h : y;
      return { canvas: out, x: nx, y: ny };
    };
    const label = { cw: 'Turn 90° clockwise', ccw: 'Turn 90° anticlockwise', 180: 'Turn 180°', h: 'Flip horizontally', v: 'Flip vertically' }[kind];
    change(label, () => {
      for (const l of D.doc.layers) {
        if (l.kind === 'text') { const r = map(textCanvas(l), l.x, l.y); Object.assign(l, { kind: 'pixel', canvas: r.canvas, x: r.x, y: r.y, text: null }); }
        else if (l.kind === 'shape') { const M = turnMatrix(kind, W, H).multiply(shapeMatrix(l)); l.shape = { ...l.shape, m: [M.a, M.b, M.c, M.d, M.e, M.f] }; l.x = 0; l.y = 0; }
        else if (l.canvas) { const r = map(l.canvas, l.x, l.y); l.canvas = r.canvas; l.x = r.x; l.y = r.y; }
        if (l.mask) { const r = map(l.mask.canvas, l.mask.x, l.mask.y); l.mask = { ...l.mask, canvas: r.canvas, x: r.x, y: r.y, ver: ++VER }; }
        if (l.fill && l.fill.type === 'gradient') l.fill = { ...l.fill, angle: ((l.fill.angle || 0) + (kind === 'cw' ? 90 : kind === 'ccw' ? -90 : kind === '180' ? 180 : 0) + (kind === 'h' ? 180 - 2 * (l.fill.angle || 0) : kind === 'v' ? -2 * (l.fill.angle || 0) : 0)) % 360 };
        touch(l);
      }
      if (swap) { D.doc.width = H; D.doc.height = W; }
      D.doc.guides = [];
    });
    D.sel = null; D.selVer = ++VER; fit(); renderAll();
  }
  /** The matrix turning or flipping the whole picture (for shape layers, which keep their geometry). */
  function turnMatrix(kind, W, H) {
    const m = new DOMMatrix();
    if (kind === 'cw') return m.translate(H, 0).rotate(90);
    if (kind === 'ccw') return m.translate(0, W).rotate(-90);
    if (kind === '180') return m.translate(W, H).rotate(180);
    if (kind === 'h') return m.translate(W, 0).scale(-1, 1);
    return m.translate(0, H).scale(1, -1);
  }
  /** Flips or turns just the active layer (around its own middle). */
  function turnLayer(kind) {
    const l = L();
    if (!l || l.kind !== 'pixel') { notice('Choose a pixel layer.', 1800); return; }
    change(kind === 'h' ? 'Flip the layer horizontally' : kind === 'v' ? 'Flip the layer vertically' : 'Turn the layer', () => {
      const c = l.canvas, w = c.width, h = c.height, swap = kind === 'cw' || kind === 'ccw', out = canvas(swap ? h : w, swap ? w : h), t = g2(out);
      if (kind === 'cw') { t.translate(h, 0); t.rotate(Math.PI / 2); } else if (kind === 'ccw') { t.translate(0, w); t.rotate(-Math.PI / 2); }
      else if (kind === 'h') { t.translate(w, 0); t.scale(-1, 1); } else { t.translate(0, h); t.scale(1, -1); }
      t.drawImage(c, 0, 0);
      const cx = l.x + w / 2, cy = l.y + h / 2;
      l.canvas = out; l.x = Math.round(cx - out.width / 2); l.y = Math.round(cy - out.height / 2);
      touch(l);
    });
  }
  /** Image › Trim: the canvas shrinks to where there are pixels. */
  function trim() {
    const c = composite || compose(D), d = g2(c).getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { notice('The picture is empty.', 1600); return; }
    applyCrop({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }

  // ---------------------------------------------------------------- filters and adjustments: one dialog for all

  // While the dialog is open the picture shows the result (worked out on a smaller copy first for big pictures, then
  // in full when you stop moving the sliders). A filter can be applied to the pixels (in the selection), or kept on
  // the layer as a live filter; an adjustment can be applied, or kept as an adjustment layer.
  let draft = null;          // { l, target, canvas } shown in place of a layer's picture (or its mask)
  let pointPick = null;      // a dialog's 'point' setting, placed by clicking the picture
  const effectOf = (id) => Fx().FILTERS.find((f) => f.id === id) || Fx().ADJUSTMENTS.find((f) => f.id === id) || null;
  /** A mask as a grey picture (the filters' language) and back. */
  function maskImg(c) { const img = imgOf(c), d = img.data; for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = d[i + 3]; d[i + 3] = 255; } return img; }
  function maskFromImg(img) { const d = img.data; for (let i = 0; i < d.length; i += 4) { const v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = v; } return canvasOfImg(img); }
  /** Runs a list of effects ([{ id, params }]) on a picture. */
  function runChain(img, chain, scale) {
    for (const f of chain) img = Fx().apply(f.id, img, f.params || {}, { scale, seed: 1 });
    return img;
  }
  /** The filtered picture limited to the selection: the rest keeps the original. */
  function throughSel(orig, result, ox, oy) {
    if (!D.sel) return result;
    const out = copyOf(orig), x = g2(out);
    x.globalCompositeOperation = 'destination-out'; x.drawImage(D.sel, -ox, -oy);
    x.globalCompositeOperation = 'lighter'; x.drawImage(limitToSel(copyOf(result), ox, oy), 0, 0);
    return out;
  }

  /**
   * spec: { id, adjust } an effect for the layer's pixels (or mask); with { layer } an adjustment layer's settings;
   * with { live: index } a live filter on the layer (index −1: a new one).
   */
  function effectDialog(spec) {
    if (!Fx()) { notice('The filters aren\'t loaded.', 2000); return; }
    const fx = effectOf(spec.id);
    if (!fx) return;
    const l = spec.layer || L();
    if (!l) return;
    const isAdjLayer = !!spec.layer && l.kind === 'adjust';
    const isLive = spec.live !== undefined;
    let target = 'canvas';
    if (!isAdjLayer && !isLive) {
      if (D.editMask && l.mask) target = 'mask';
      else if (l.kind !== 'pixel') { notice(l.kind === 'group' ? 'Choose a layer in the group: filters work on pixels.' : 'Filters work on pixels: Layer › Rasterize first, or add it as a live filter.', 3200); return; }
      else if (l.locked) { notice('That layer is locked.', 1800); return; }
    }
    if (isLive && l.kind !== 'pixel' && l.kind !== 'text' && l.kind !== 'fill') { notice('Live filters go on pixel, text and fill layers.', 2400); return; }
    const oldAdjust = isAdjLayer ? clone(l.adjust) : null, oldFilters = clone(l.filters || []);
    let params = spec._params ? clone(spec._params) : isAdjLayer ? { ...Fx().defaults(spec.id), ...clone(l.adjust.params || {}) } : isLive && spec.live >= 0 ? { ...Fx().defaults(spec.id), ...clone(l.filters[spec.live].params) } : (lastFilter && lastFilter.id === spec.id ? clone(lastFilter.params) : Fx().defaults(spec.id));
    const o = target === 'mask' ? l.mask : l;
    // What the effect works on (for pixel changes and live filters): the layer's picture, its live filters before this one.
    const source = isAdjLayer ? null : target === 'mask' ? o.canvas : (l.kind === 'pixel' ? l.canvas : l.kind === 'text' ? textCanvas(l) : fillCanvas(l));
    const chainBefore = isLive ? (l.filters || []).slice(0, spec.live >= 0 ? spec.live : undefined).filter((f) => f.enabled !== false) : [];
    const chainAfter = isLive && spec.live >= 0 ? l.filters.slice(spec.live + 1).filter((f) => f.enabled !== false) : [];
    const PREVIEW_PX = 1.6e6;
    const big = source ? source.width * source.height : 0, s0 = big > PREVIEW_PX ? Math.sqrt(PREVIEW_PX / big) : 1;
    const toImg = (c) => (target === 'mask' ? maskImg(c) : imgOf(c));
    const small = source && s0 < 1 ? toImg(scaled(source, source.width * s0, source.height * s0)) : null;
    const thumbScale = source ? Math.min(1, 280 / source.width, 190 / source.height) : 1;
    const thumbSrc = source ? toImg(scaled(source, Math.max(1, source.width * thumbScale), Math.max(1, source.height * thumbScale))) : null;
    let fullTimer = 0, showOn = true, closed = false;

    const result = (img, scale) => runChain(runChain(runChain(img, chainBefore, scale), [{ id: spec.id, params }], scale), chainAfter, scale);
    const toCanvas = (img) => (target === 'mask' ? maskFromImg(img) : canvasOfImg(img));
    function update(fullNow) {
      if (closed) return;
      if (isAdjLayer) { l.adjust = { id: spec.id, params: clone(params) }; touch(l); draw(); drawThumb(); return; }
      drawThumb();
      if (!showOn) { draft = null; needCompose = true; draw(); return; }
      const finish = () => {
        if (closed) return;
        try {
          const out = toCanvas(result(toImg(source), 1));
          draft = { l, target, canvas: isLive ? out : throughSel(source, out, o.x, o.y) };
        } catch (err) { hooks.showError(err); }
        needCompose = true; draw();
      };
      clearTimeout(fullTimer);
      if (!small || fullNow) { finish(); return; }
      const out = scaled(toCanvas(result(small, s0)), source.width, source.height);
      draft = { l, target, canvas: isLive ? out : throughSel(source, out, o.x, o.y) };
      needCompose = true; draw();
      fullTimer = setTimeout(finish, 650);
    }
    const thumb = el('canvas', { class: 'ph-fx-thumb', id: 'ph-fx-thumb', role: 'img', 'aria-label': 'Preview' });
    function drawThumb() {
      if (!thumbSrc) { thumb.hidden = true; return; }
      let img;
      try { img = result({ width: thumbSrc.width, height: thumbSrc.height, data: Uint8ClampedArray.from(thumbSrc.data) }, thumbScale); } catch (err) { console.warn(err); return; }
      thumb.width = img.width; thumb.height = img.height;
      const x = g2(thumb);
      x.clearRect(0, 0, img.width, img.height);
      x.drawImage(target === 'mask' ? maskFromImg(img) : canvasOfImg(img), 0, 0);
      for (const p of fx.params.filter((q) => q.type === 'point')) {
        const v = params[p.key] || { x: 0.5, y: 0.5 }, px = v.x * img.width, py = v.y * img.height;
        x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, 6, 0, Math.PI * 2); x.stroke();
        x.strokeStyle = '#000'; x.lineWidth = 1; x.beginPath(); x.arc(px, py, 7.5, 0, Math.PI * 2); x.stroke();
        if (spec.id === 'tiltshift') {
          // The focus band, so it can be placed by eye.
          const a = (params.angle || 0) * Math.PI / 180, half = (params.width ?? 20) / 100 * img.height / 2, len = img.width + img.height;
          x.strokeStyle = 'rgba(255,255,255,.8)'; x.setLineDash([4, 3]);
          for (const k of [-1, 1]) { const ox = -Math.sin(a) * half * k, oy = Math.cos(a) * half * k; x.beginPath(); x.moveTo(px + ox - Math.cos(a) * len, py + oy - Math.sin(a) * len); x.lineTo(px + ox + Math.cos(a) * len, py + oy + Math.sin(a) * len); x.stroke(); }
          x.setLineDash([]);
        }
      }
    }
    const pointParam = fx.params.find((q) => q.type === 'point');
    const setPoint = (fxp, fyp) => { if (!pointParam) return; params[pointParam.key] = { x: clamp(fxp, 0, 1), y: clamp(fyp, 0, 1) }; schedule(); };
    let pending = 0;
    const schedule = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; update(false); }); };
    thumb.addEventListener('pointerdown', (e) => {
      if (!pointParam) return;
      const r = thumb.getBoundingClientRect(), mv = (ev) => setPoint((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
      mv(e); thumb.setPointerCapture(e.pointerId);
      const up = () => { thumb.removeEventListener('pointermove', mv); thumb.removeEventListener('pointerup', up); };
      thumb.addEventListener('pointermove', mv); thumb.addEventListener('pointerup', up);
    });
    // A point can also be placed on the picture itself (the dialog sits to the side).
    pointPick = pointParam ? (p) => { const b = isLive || !source ? { x: 0, y: 0, w: D.doc.width, h: D.doc.height } : { x: o.x, y: o.y, w: source.width, h: source.height }; setPoint((p.x - b.x) / b.w, (p.y - b.y) / b.h); } : null;

    const controls = fx.params.map((p) => paramControl(p, () => params[p.key], (v) => { params[p.key] = v; schedule(); }, () => (source ? (isLive ? imgOf(source) : toImg(source)) : imgOf(compose(D, { noCache: true })))));
    const title = isAdjLayer ? `${fx.name} (adjustment layer)` : isLive ? `${fx.name} (live filter)` : fx.name;
    const handle = NoorUI.modal({ label: title, width: 380, onClose: (r) => { closed = true; clearTimeout(fullTimer); pointPick = null; if (r !== 'ok' && r !== 'reset') revert(); draft = null; needCompose = true; draw(); renderAll(); } }, (s, closeIt) => {
      const prev = el('input', { type: 'checkbox', id: 'ph-fx-preview', checked: true });
      prev.addEventListener('change', () => { showOn = prev.checked; if (isAdjLayer) { l.visible = showOn; touch(l); draw(); } else update(true); });
      const reset = el('button', { class: 'action', id: 'ph-fx-reset', onclick: () => { params = Fx().defaults(spec.id); if (isAdjLayer) { l.adjust = oldAdjust; touch(l); } closeIt('reset'); effectDialog({ ...spec, _params: params }); } }, 'Reset');
      const asLive = !isAdjLayer && !isLive && !spec.adjust && target === 'canvas' ? el('button', { class: 'action', id: 'ph-fx-live', title: 'Keep it on the layer as settings you can change later (the pixels stay as they are)', onclick: () => { closeIt('live'); addLiveFilter(l, spec.id, params); } }, 'As a live filter') : null;
      const asLayer = spec.adjust && !isAdjLayer ? el('button', { class: 'action', id: 'ph-fx-layer', title: 'Keep it as an adjustment layer you can change later', onclick: () => { closeIt('layer'); const nl = makeLayer({ kind: 'adjust', name: uniqueName(fx.name), adjust: { id: spec.id, params: clone(params) } }); addLayerAbove(nl, 'New adjustment layer'); } }, 'As a layer') : null;
      s.append(NoorUI.head(title, closeIt),
        el('div', { class: 'modal-body ph-dlg ph-fx', id: 'ph-fx' },
          fx.about ? el('p', { class: 'pref-hint', text: fx.about }) : null,
          thumb, pointParam ? el('p', { class: 'pref-hint', text: 'Click the preview (or the picture) to place the centre.' }) : null,
          ...controls,
          el('label', { class: 'ph-check' }, prev, ' preview')),
        el('div', { class: 'modal-foot' }, reset, asLive, asLayer, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-fx-ok', onclick: () => { ok(); closeIt('ok'); } }, 'OK'))));
    });
    handle.element.parentElement.classList.add('ph-side');
    update(false);

    function revert() {
      if (isAdjLayer) {
        l.visible = true;
        if (spec.fresh) { undo(); D.future.pop(); renderAll(); return; }
        l.adjust = oldAdjust; touch(l);
      }
    }
    function ok() {
      clearTimeout(fullTimer);
      if (isAdjLayer) {
        l.visible = true;
        const now = { id: spec.id, params: clone(params) };
        l.adjust = oldAdjust;
        if (spec.fresh) { l.adjust = now; touch(l); D.history[D.history.length - 1].redo = ((after) => () => { restore(after); })(snap()); return; }
        setProp(l, `${fx.name} settings`, () => { l.adjust = now; });
        return;
      }
      if (isLive) {
        const list = clone(oldFilters);
        if (spec.live >= 0) list[spec.live] = { ...list[spec.live], params: clone(params) }; else list.push({ id: spec.id, params: clone(params), enabled: true });
        setProp(l, spec.live >= 0 ? `${fx.name} (live) settings` : `Live filter: ${fx.name}`, () => { l.filters = list; });
        return;
      }
      lastFilter = { id: spec.id, params: clone(params), adjust: !!spec.adjust };
      const out = toCanvas(result(toImg(source), 1)), final = throughSel(source, out, o.x, o.y);
      draft = null;
      pixelStep(fx.name, l, target, { x: 0, y: 0, w: source.width, h: source.height }, () => { const x = g2(source); x.clearRect(0, 0, source.width, source.height); x.drawImage(final, 0, 0); });
    }
  }
  function addLiveFilter(l, id, params) {
    if (l.kind !== 'pixel' && l.kind !== 'text' && l.kind !== 'fill') { notice('Live filters go on pixel, text and fill layers.', 2400); return; }
    setProp(l, `Live filter: ${effectOf(id).name}`, () => { l.filters = [...(l.filters || []), { id, params: clone(params), enabled: true }]; });
  }
  /** Filter › Repeat (Ctrl+F): the last filter again, with the same settings. */
  function repeatFilter() {
    if (!lastFilter) { notice('No filter used yet.', 1600); return; }
    const l = L(), t = paintTarget(true);
    if (!t) { notice('Choose a pixel layer.', 1600); return; }
    const o = originOf(l, t.target), src = o.canvas, img = t.target === 'mask' ? maskImg(src) : imgOf(src);
    const out = Fx().apply(lastFilter.id, img, lastFilter.params, { scale: 1, seed: 1 });
    const final = throughSel(src, t.target === 'mask' ? maskFromImg(out) : canvasOfImg(out), o.x, o.y);
    pixelStep(effectOf(lastFilter.id).name, l, t.target, { x: 0, y: 0, w: src.width, h: src.height }, () => { const x = g2(src); x.clearRect(0, 0, src.width, src.height); x.drawImage(final, 0, 0); });
  }
  /** Auto tone: levels set from the picture itself (the darkest and lightest tenth of a percent clipped). */
  function autoTone() {
    const t = paintTarget();
    if (!t || t.target !== 'canvas') return;
    const l = t.l, params = Fx().autoLevels(imgOf(l.canvas));
    const out = Fx().apply('levels', imgOf(l.canvas), params, { scale: 1 }), final = throughSel(l.canvas, canvasOfImg(out), l.x, l.y);
    pixelStep('Auto tone', l, 'canvas', { x: 0, y: 0, w: l.canvas.width, h: l.canvas.height }, () => { const x = g2(l.canvas); x.clearRect(0, 0, l.canvas.width, l.canvas.height); x.drawImage(final, 0, 0); });
  }

  /** One setting's control: a slider with a number, a list, a tick, a colour, a curve, a gradient. */
  function paramControl(p, get, set, histogramOf) {
    const id = `ph-p-${p.key}`;
    if (p.type === 'range') {
      const range = el('input', { type: 'range', id, min: String(p.min), max: String(p.max), step: String(p.step || 1), value: String(get()), 'aria-label': p.label });
      const num = el('input', { type: 'number', class: 'ph-num', min: String(p.min), max: String(p.max), step: String(p.step || 1), value: String(get()), 'aria-label': p.label });
      range.addEventListener('input', () => { num.value = range.value; set(Number(range.value)); });
      num.addEventListener('input', () => { if (num.value === '' || !Number.isFinite(Number(num.value))) return; const v = clamp(Number(num.value), p.min, p.max); range.value = String(v); set(v); });
      return el('label', { class: 'ph-param' }, el('span', { text: p.label }), range, num, p.unit ? el('small', { text: p.unit }) : null);
    }
    if (p.type === 'select') {
      const s = el('select', { id, 'aria-label': p.label }, ...p.options.map(([v, t]) => el('option', { value: String(v), text: t })));
      s.value = String(get());
      s.addEventListener('change', () => { const v = p.options.find(([x]) => String(x) === s.value); set(v ? v[0] : s.value); });
      return el('label', { class: 'ph-param' }, el('span', { text: p.label }), s);
    }
    if (p.type === 'check') {
      const c = el('input', { type: 'checkbox', id, checked: get() || undefined });
      c.addEventListener('change', () => set(c.checked));
      return el('label', { class: 'ph-param ph-check' }, c, ' ', p.label);
    }
    if (p.type === 'colour') {
      const c = el('input', { type: 'color', id, value: get() || '#808080', 'aria-label': p.label });
      c.addEventListener('input', () => set(c.value));
      return el('label', { class: 'ph-param' }, el('span', { text: p.label }), c);
    }
    if (p.type === 'gradient') {
      const cur = [...(get() || ['#000000', '#ffffff'])];
      const three = el('input', { type: 'checkbox', checked: cur.length > 2 || undefined });
      const inputs = [0, 1, 2].map((i) => el('input', { type: 'color', value: cur[i] || '#808080', 'aria-label': ['Shadows', 'Highlights', 'Midtones'][i] }));
      const read = () => { const a = inputs[0].value, b = inputs[1].value, m = inputs[2].value; set(three.checked ? [a, m, b] : [a, b]); inputs[2].hidden = !three.checked; };
      if (cur.length > 2) { inputs[0].value = cur[0]; inputs[2].value = cur[1]; inputs[1].value = cur[2]; }
      inputs.forEach((i) => i.addEventListener('input', read)); three.addEventListener('change', read);
      inputs[2].hidden = !three.checked;
      return el('div', { class: 'ph-param' }, el('span', { text: p.label }), inputs[0], inputs[2], inputs[1], el('label', {}, three, ' three colours'));
    }
    if (p.type === 'curve') return curveEditor(p, get, set, histogramOf);
    if (p.type === 'point') {
      const reset = el('button', { class: 'utility-btn', onclick: () => set({ x: 0.5, y: 0.5 }) }, 'Middle');
      return el('div', { class: 'ph-param' }, el('span', { text: p.label }), reset);
    }
    return null;
  }

  /** Curves: drag points on the line; click to add one, double-click (or drag it off) to take it away. */
  function curveEditor(p, get, set, histogramOf) {
    const value = clone(get()) || { rgb: [[0, 0], [255, 255]] };
    let channel = 'rgb';
    const cv = el('canvas', { class: 'ph-curve', id: 'ph-curve', width: '256', height: '256', role: 'img', 'aria-label': 'Curve' });
    const chan = el('select', { 'aria-label': 'Channel', id: 'ph-curve-channel' }, ...[['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map(([v, t]) => el('option', { value: v, text: t })));
    let hist = null;
    try { hist = Fx().histogram(histogramOf()); } catch { hist = null; }
    const pts = () => (value[channel] && value[channel].length ? value[channel] : (value[channel] = [[0, 0], [255, 255]]));
    function paintCurve() {
      const x = g2(cv);
      x.clearRect(0, 0, 256, 256);
      x.fillStyle = '#1b1d22'; x.fillRect(0, 0, 256, 256);
      if (hist) {
        const h = hist[channel === 'rgb' ? 'l' : channel], max = Math.max(1, ...h);
        x.fillStyle = 'rgba(255,255,255,.18)';
        for (let i = 0; i < 256; i++) { const v = Math.sqrt(h[i] / max) * 250; x.fillRect(i, 256 - v, 1, v); }
      }
      x.strokeStyle = 'rgba(255,255,255,.15)'; x.beginPath();
      for (const k of [64, 128, 192]) { x.moveTo(k, 0); x.lineTo(k, 256); x.moveTo(0, k); x.lineTo(256, k); }
      x.moveTo(0, 256); x.lineTo(256, 0); x.stroke();
      const lut = Fx().curveLut(pts());
      x.strokeStyle = { rgb: '#fff', r: '#ff5050', g: '#50ff70', b: '#5090ff' }[channel]; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < 256; i++) { const y = 255 - lut[i]; if (i) x.lineTo(i + 0.5, y + 0.5); else x.moveTo(0.5, y + 0.5); }
      x.stroke(); x.lineWidth = 1;
      x.fillStyle = '#fff';
      for (const [px, py] of pts()) { x.beginPath(); x.arc(px, 255 - py, 4, 0, Math.PI * 2); x.fill(); }
    }
    const at = (e) => { const r = cv.getBoundingClientRect(); return [clamp(Math.round((e.clientX - r.left) / r.width * 255), 0, 255), clamp(Math.round(255 - (e.clientY - r.top) / r.height * 255), 0, 255)]; };
    cv.addEventListener('pointerdown', (e) => {
      const [x0, y0] = at(e), list = pts();
      let i = list.findIndex(([px, py]) => Math.abs(px - x0) < 8 && Math.abs(py - y0) < 8);
      if (i < 0) { list.push([x0, y0]); list.sort((a, b) => a[0] - b[0]); i = list.findIndex(([px, py]) => px === x0 && py === y0); }
      let off = false;
      cv.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const [x1, y1] = at(ev), r = cv.getBoundingClientRect(), outside = ev.clientX < r.left - 20 || ev.clientX > r.right + 20 || ev.clientY < r.top - 20 || ev.clientY > r.bottom + 20;
        const lo = i > 0 ? list[i - 1][0] + 1 : 0, hi = i < list.length - 1 ? list[i + 1][0] - 1 : 255;
        off = outside && list.length > 2 && i > 0 && i < list.length - 1;
        list[i] = [i === 0 ? Math.min(x1, hi) : i === list.length - 1 ? Math.max(x1, lo) : clamp(x1, lo, hi), y1];
        paintCurve(); set(clone(value));
      };
      const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); if (off) { list.splice(i, 1); paintCurve(); set(clone(value)); } };
      cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
      paintCurve(); set(clone(value));
    });
    cv.addEventListener('dblclick', (e) => { const [x0, y0] = at(e), list = pts(), i = list.findIndex(([px, py]) => Math.abs(px - x0) < 8 && Math.abs(py - y0) < 8); if (i > 0 && i < list.length - 1) { list.splice(i, 1); paintCurve(); set(clone(value)); } });
    chan.addEventListener('change', () => { channel = chan.value; paintCurve(); });
    const presets = el('select', { 'aria-label': 'Curve presets' }, el('option', { value: '', text: 'Presets…' }), ...[['s', 'More contrast (S)'], ['soft', 'Less contrast'], ['bright', 'Brighter'], ['dark', 'Darker'], ['invert', 'Negative'], ['fade', 'Faded film']].map(([v, t]) => el('option', { value: v, text: t })));
    presets.addEventListener('change', () => {
      const P = { s: [[0, 0], [64, 48], [192, 208], [255, 255]], soft: [[0, 0], [64, 80], [192, 176], [255, 255]], bright: [[0, 0], [128, 168], [255, 255]], dark: [[0, 0], [128, 92], [255, 255]], invert: [[0, 255], [255, 0]], fade: [[0, 36], [128, 132], [255, 236]] }[presets.value];
      if (P) { value[channel] = P.map((q) => [...q]); paintCurve(); set(clone(value)); }
      presets.value = '';
    });
    setTimeout(paintCurve, 0);
    return el('div', { class: 'ph-param ph-curvebox' }, el('div', { class: 'ph-row' }, chan, presets), cv);
  }

  /** A fill layer's colour or gradient. */
  function fillDialog(l, fresh) {
    const old = clone(l.fill);
    let f = clone(l.fill);
    NoorUI.modal({ label: 'Fill layer', width: 360, onClose: (r) => { if (r !== 'ok') { if (fresh) { undo(); D.future.pop(); } else { l.fill = old; touch(l); } } renderAll(); } }, (s, closeIt) => {
      const kind = el('select', { id: 'ph-fill-kind', 'aria-label': 'Fill' }, el('option', { value: 'colour', text: 'a colour' }), el('option', { value: 'gradient', text: 'a gradient' }), el('option', { value: 'pattern', text: 'a pattern' }));
      const mine = myPatterns();
      const pattern = el('select', { id: 'ph-fill-pattern', 'aria-label': 'Pattern' }, ...PATTERNS.map(([v, t]) => el('option', { value: v, text: t })), ...mine.map((m, i) => el('option', { value: `mine:${i}`, text: `${m.name} (yours)` })));
      pattern.value = f.image ? (mine.findIndex((m) => m.image === f.image) >= 0 ? `mine:${mine.findIndex((m) => m.image === f.image)}` : PATTERNS[0][0]) : (f.pattern || 'checker');
      const pa = el('input', { type: 'color', value: f.a || fg, 'aria-label': 'First colour' }), pb = el('input', { type: 'color', value: f.b || bg, 'aria-label': 'Second colour' });
      const pscale = el('input', { type: 'number', min: '10', max: '1000', value: String(f.type === 'pattern' ? f.scale || 100 : 100), 'aria-label': 'Scale' });
      const pat = el('div', {}, el('div', { class: 'ph-row' }, el('label', {}, 'Pattern ', pattern)), el('div', { class: 'ph-row' }, el('label', {}, 'Colours ', pa, pb), el('label', {}, 'Scale ', pscale, '%')));
      kind.value = f.type;
      const colour = el('input', { type: 'color', id: 'ph-fill-colour', value: f.colour || fg, 'aria-label': 'Colour' });
      const a = el('input', { type: 'color', value: (f.stops || [fg])[0], 'aria-label': 'From' }), b = el('input', { type: 'color', value: (f.stops || [fg, bg])[1] || bg, 'aria-label': 'To' });
      const shape = el('select', { 'aria-label': 'Shape' }, ...[['linear', 'linear'], ['radial', 'radial'], ['angle', 'angle'], ['reflected', 'reflected'], ['diamond', 'diamond']].map(([v, t]) => el('option', { value: v, text: t })));
      shape.value = f.shape || 'linear';
      const angle = el('input', { type: 'number', min: '-360', max: '360', value: String(f.angle ?? 90), 'aria-label': 'Angle' });
      const scale = el('input', { type: 'number', min: '10', max: '400', value: String(f.scale ?? 100), 'aria-label': 'Scale' });
      const rev = el('input', { type: 'checkbox', checked: f.reverse || undefined });
      const grad = el('div', {}, el('div', { class: 'ph-row' }, el('label', {}, 'From ', a), el('label', {}, 'to ', b), el('label', {}, rev, ' reversed')), el('div', { class: 'ph-row' }, el('label', {}, 'Shape ', shape), el('label', {}, 'Angle ', angle, '°'), el('label', {}, 'Scale ', scale, '%')));
      const read = () => {
        const m = pattern.value.startsWith('mine:') ? mine[Number(pattern.value.slice(5))] : null;
        f = kind.value === 'gradient' ? { type: 'gradient', stops: [a.value, b.value], shape: shape.value, angle: Number(angle.value) || 0, scale: clamp(Number(scale.value) || 100, 10, 400), reverse: rev.checked }
          : kind.value === 'pattern' ? { type: 'pattern', ...(m ? { image: m.image } : { pattern: pattern.value, a: pa.value, b: pb.value }), scale: clamp(Number(pscale.value) || 100, 10, 1000) } : { type: 'colour', colour: colour.value };
        grad.hidden = kind.value !== 'gradient'; pat.hidden = kind.value !== 'pattern'; colour.parentElement.hidden = kind.value !== 'colour';
        pa.parentElement.hidden = !!m;
        l.fill = f; touch(l); draw();
      };
      for (const i of [kind, colour, a, b, shape, angle, scale, rev, pattern, pa, pb, pscale]) i.addEventListener('input', read);
      s.append(NoorUI.head('Fill layer', closeIt), el('div', { class: 'modal-body ph-dlg' }, el('label', {}, 'Fill with ', kind), el('label', {}, 'Colour ', colour), grad, pat),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-fill-ok', onclick: () => {
          if (!fresh) { l.fill = old; setProp(l, 'Fill settings', () => { l.fill = f; }); } else { D.history[D.history.length - 1].redo = ((after) => () => restore(after))(snap()); }
          closeIt('ok');
        } }, 'OK'))));
      setTimeout(read, 0);
    }).element.parentElement.classList.add('ph-side');
  }

  // ---------------------------------------------------------------- layer styles

  const STYLE_LABELS = { colour: 'Colour', opacity: 'Opacity', angle: 'Angle', distance: 'Distance', size: 'Size', spread: 'Spread', choke: 'Choke', blend: 'Blend', source: 'From', style: 'Style', depth: 'Depth', soften: 'Soften', altitude: 'Light height', highlight: 'Highlight', highlightOpacity: 'Highlight opacity', shadow: 'Shadow', shadowOpacity: 'Shadow opacity', direction: 'Direction', from: 'From', to: 'To', shape: 'Shape', reverse: 'Reversed', position: 'Position' };
  const STYLE_CHOICES = {
    source: [['edge', 'the edge'], ['centre', 'the middle']], style: [['inner', 'inner bevel'], ['outer', 'outer bevel'], ['emboss', 'emboss']], direction: [['up', 'up'], ['down', 'down']],
    shape: [['linear', 'linear'], ['radial', 'radial']], position: [['outside', 'outside'], ['inside', 'inside'], ['centre', 'centred']],
  };
  const STYLE_RANGE = { distance: [0, 300, 'px'], size: [0, 250, 'px'], spread: [0, 100, '%'], choke: [0, 100, '%'], depth: [1, 1000, '%'], soften: [0, 16, 'px'], angle: [-180, 180, '°'], altitude: [0, 90, '°'] };
  /** Layer › Layer style: the effects listed on the left (ticked: on), the chosen one's settings on the right; the picture shows them as you go. */
  function styleDialog(l = L(), first, addFirst) {
    const S = window.NoorPhotoStyle;
    if (!S || !l) return;
    if (l.kind === 'adjust') { notice('An adjustment layer has no pixels to style.', 2000); return; }
    const old = clone(l.styles), oldFill = l.fillOpacity ?? 1;
    let cur = clone(l.styles) || {}, fill = oldFill, chosen = first || (S.EFFECTS.find((e) => cur[e.id] && cur[e.id].on) || S.EFFECTS[0]).id;
    const apply = () => { l.styles = clone(cur); l.fillOpacity = fill; touch(l); draw(); };
    if (addFirst && first && !cur[first]) { cur[first] = S.defaults(first); apply(); }
    NoorUI.modal({ label: 'Layer style', width: 560, onClose: (r) => { if (r !== 'ok') { l.styles = old; l.fillOpacity = oldFill; touch(l); } renderAll(); } }, (s, closeIt) => {
      const list = el('div', { class: 'ph-stylelist', id: 'ph-stylelist', role: 'listbox', 'aria-label': 'Effects' }), pane = el('div', { class: 'ph-stylepane', id: 'ph-stylepane' });
      const renderList = () => list.replaceChildren(...S.EFFECTS.map((e) => {
        const tick = el('input', { type: 'checkbox', checked: (cur[e.id] && cur[e.id].on) || undefined, 'aria-label': e.name, 'data-effect': e.id });
        tick.addEventListener('change', () => { cur[e.id] = { ...(cur[e.id] || S.defaults(e.id)), on: tick.checked }; chosen = e.id; apply(); renderList(); renderPane(); });
        return el('div', { class: 'ph-styleitem' + (chosen === e.id ? ' on' : ''), role: 'option', 'aria-selected': chosen === e.id ? 'true' : 'false', onclick: (ev) => { if (ev.target === tick) return; chosen = e.id; renderList(); renderPane(); } }, tick, el('span', { text: e.name }));
      }));
      const renderPane = () => {
        const e = S.EFFECTS.find((x) => x.id === chosen), v = { ...S.defaults(chosen), ...(cur[chosen] || {}) };
        const set = (k, val) => { cur[chosen] = { ...v, ...(cur[chosen] || {}), [k]: val, on: true }; v[k] = val; apply(); renderList(); };
        const rows = Object.keys(v).filter((k) => k !== 'on').map((k) => {
          const val = v[k], label = STYLE_LABELS[k] || k, id = `ph-st-${k}`;
          if (k === 'blend') { const sel = el('select', { id, 'aria-label': label }, ...BLENDS.filter(Boolean).map(([b, t]) => el('option', { value: b, text: t }))); sel.value = val; sel.addEventListener('change', () => set(k, sel.value)); return el('label', { class: 'ph-param' }, el('span', { text: label }), sel); }
          if (STYLE_CHOICES[k]) { const sel = el('select', { id, 'aria-label': label }, ...STYLE_CHOICES[k].map(([a, t]) => el('option', { value: a, text: t }))); sel.value = val; sel.addEventListener('change', () => set(k, sel.value)); return el('label', { class: 'ph-param' }, el('span', { text: label }), sel); }
          if (typeof val === 'boolean') { const c = el('input', { type: 'checkbox', id, checked: val || undefined }); c.addEventListener('change', () => set(k, c.checked)); return el('label', { class: 'ph-param ph-check' }, c, ' ', label); }
          if (typeof val === 'string' && val.startsWith('#')) { const c = el('input', { type: 'color', id, value: val, 'aria-label': label }); c.addEventListener('input', () => set(k, c.value)); return el('label', { class: 'ph-param' }, el('span', { text: label }), c); }
          const pct = /opacity/i.test(k), [min, max, unit] = pct ? [0, 100, '%'] : (STYLE_RANGE[k] || [0, 100, '']);
          return paramControl({ key: `st-${k}`, label, type: 'range', min, max, step: 1, unit, value: pct ? Math.round(val * 100) : val }, () => (pct ? Math.round(v[k] * 100) : v[k]), (x) => set(k, pct ? x / 100 : x));
        });
        pane.replaceChildren(el('h4', { class: 'ph-subhead', text: e.name }), ...rows);
      };
      const fillCtl = paramControl({ key: 'fillop', label: 'Fill opacity', type: 'range', min: 0, max: 100, step: 1, unit: '%', value: Math.round(fill * 100) }, () => Math.round(fill * 100), (x) => { fill = x / 100; apply(); });
      const presets = el('select', { id: 'ph-style-preset', 'aria-label': 'Ready-made styles' }, el('option', { value: '', text: 'Ready-made…' }), ...S.PRESETS.map((p, i) => el('option', { value: String(i), text: p.name })));
      presets.addEventListener('change', () => { const p = S.PRESETS[Number(presets.value)]; if (p) { cur = clone(p.styles); chosen = Object.keys(cur)[0]; apply(); renderList(); renderPane(); } presets.value = ''; });
      s.append(NoorUI.head('Layer style', closeIt),
        el('div', { class: 'modal-body ph-dlg ph-fx' },
          el('p', { class: 'pref-hint', text: 'Shadows, glows, a stroke, a bevel and overlays, drawn from the layer\'s shape; they stay changeable and follow the layer as it changes.' }),
          el('div', { class: 'ph-row' }, presets, el('button', { class: 'action', id: 'ph-style-clear', onclick: () => { cur = {}; fill = 1; apply(); renderList(); renderPane(); } }, 'Clear all')),
          fillCtl, el('div', { class: 'ph-stylebox' }, list, pane)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-style-ok', onclick: () => {
          const now = clone(cur), nowFill = fill;
          l.styles = old; l.fillOpacity = oldFill;
          setProp(l, 'Layer style', () => { l.styles = Object.keys(now).length ? now : null; l.fillOpacity = nowFill; });
          closeIt('ok');
        } }, 'OK'))));
      renderList(); renderPane();
    }).element.parentElement.classList.add('ph-side');
  }
  let copiedStyle = null;
  function copyStyle() { const l = L(); if (!l || !l.styles) { notice('This layer has no style to copy.', 1600); return; } copiedStyle = { styles: clone(l.styles), fillOpacity: l.fillOpacity ?? 1 }; notice('Style copied', 900); }
  function pasteStyle() { const l = L(); if (!l || !copiedStyle) return; setProp(l, 'Paste layer style', () => { l.styles = clone(copiedStyle.styles); l.fillOpacity = copiedStyle.fillOpacity; }); }
  function clearStyle() { const l = L(); if (l && (l.styles || (l.fillOpacity ?? 1) !== 1)) setProp(l, 'Clear layer style', () => { l.styles = null; l.fillOpacity = 1; }); }
  function styleItems() {
    const S = window.NoorPhotoStyle;
    return [
      { label: 'Layer style…', run: () => styleDialog() },
      ...(S ? S.EFFECTS.map((e) => ({ label: `${e.name}…`, run: () => { const l = L(); if (l) styleDialog(l, e.id, true); } })) : []), '-',
      { label: 'Ready-made', sub: () => (S ? S.PRESETS.map((p) => ({ label: p.name, run: () => { const l = L(); if (l) setProp(l, `Layer style: ${p.name}`, () => { l.styles = clone(p.styles); }); } })) : []) }, '-',
      { label: 'Copy the style', run: copyStyle }, { label: 'Paste the style', run: pasteStyle, disabled: () => !copiedStyle }, { label: 'Clear the style', run: clearStyle },
    ];
  }

  // ---------------------------------------------------------------- building the bench

  const SETTINGS_KEY = 'noorphoto.settings';
  const DEFAULTS = { width: 1920, height: 1080, background: 'white', font: 'sans-serif', gridSize: 64, pixelGrid: true, wheelZooms: false, pickAll: true };
  let settings = { ...DEFAULTS };
  try { settings = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}) }; } catch { /* the defaults */ }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* for now only */ } }

  function build() {
    built = true;
    const btn = (id, glyph, title, onclick) => el('button', { class: 'icon-btn', id, title, 'aria-label': title.replace(/\s*\(.*$/, ''), onclick }, glyph);
    const root = el('section', { id: 'photobench', class: 'photobench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'NoorPhoto' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🖼️' }), el('strong', { text: 'NoorPhoto' }), el('small', { id: 'ph-file' })),
        el('span', { class: 'panel-head-buttons' },
          btn('ph-new', '🆕', 'New picture (Ctrl+N here)', newDialog), btn('ph-open', '📂', 'Open a picture, a PSD or a .noorphoto (Ctrl+O here)', openFile),
          btn('ph-save', '💾', 'Save (Ctrl+S here; Ctrl+Shift+S: save as, also PSD)', () => save(false)), btn('ph-export', '⤓', 'Export: PNG, JPEG, WebP, TIFF', exportDialog),
          btn('ph-undo', '↶', 'Undo (Ctrl+Z)', undo), btn('ph-redo', '↷', 'Redo (Ctrl+Y)', redo),
          NoorDock.fullButton('NoorPhoto'),
          el('button', { class: 'icon-btn', title: 'Where this panel goes', 'aria-label': 'Move NoorPhoto', onclick: (e) => NoorDock.showMenu('photo', e.currentTarget) }, '⊞'),
          btn('ph-close', '✕', 'Close NoorPhoto (Ctrl+Alt+J)', close))),
      el('div', { class: 'ph-menubar', id: 'ph-menubar', role: 'menubar', 'aria-label': 'NoorPhoto menu' }),
      el('div', { class: 'ph-tabs', id: 'ph-tabs', role: 'tablist', 'aria-label': 'Pictures open' }),
      el('div', { class: 'ph-main' },
        el('div', { class: 'ph-left' },
          el('div', { class: 'ph-tools', id: 'ph-tools', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' }),
          el('div', { class: 'ph-colours' },
            el('button', { class: 'ph-swatch ph-fg', id: 'ph-fg', title: 'Foreground colour: painting (click to choose)', 'aria-label': 'Foreground colour', onclick: () => pickColour('fg') }),
            el('button', { class: 'ph-swatch ph-bg', id: 'ph-bg', title: 'Background colour (click to choose)', 'aria-label': 'Background colour', onclick: () => pickColour('bg') }),
            el('button', { class: 'icon-btn ph-swap', title: 'Swap (X)', 'aria-label': 'Swap colours', onclick: swapColours }, '⇄'),
            el('button', { class: 'icon-btn ph-default', title: 'Black and white (D)', 'aria-label': 'Default colours', onclick: defaultColours }, '◩')),
          el('div', { class: 'ph-recent', id: 'ph-recent', 'aria-label': 'Colours used lately' })),
        el('div', { class: 'ph-centre' },
          el('div', { class: 'ph-options', id: 'ph-options' }),
          el('div', { class: 'ph-stage', id: 'ph-stage' }, el('canvas', { id: 'ph-canvas', class: 'ph-canvas', tabindex: '0', role: 'img', 'aria-label': 'The picture: paint on it' })),
          el('div', { class: 'ph-status', id: 'ph-status', 'aria-live': 'polite' })),
        el('div', { class: 'ph-right' },
          el('details', { class: 'ph-panel', open: true },
            el('summary', { text: 'Layers' }),
            el('div', { class: 'ph-layerbar' },
              el('select', { id: 'ph-blend', 'aria-label': 'Blend mode', title: 'How the layer mixes with what is under it' }),
              el('label', { class: 'ph-opacity', title: 'Opacity' }, el('input', { type: 'number', id: 'ph-opacity', min: '0', max: '100', step: '1', 'aria-label': 'Opacity (%)' }), '%')),
            el('div', { class: 'ph-layerbar ph-locks' },
              el('button', { class: 'utility-btn', id: 'ph-lock', title: 'Lock the layer (no painting or moving)', 'aria-label': 'Lock', onclick: () => { const l = L(); if (l) setProp(l, l.locked ? 'Unlock' : 'Lock', () => { l.locked = !l.locked; }); } }, '🔒'),
              el('button', { class: 'utility-btn', id: 'ph-lockalpha', title: 'Keep its see-through parts: paint only where it has pixels', 'aria-label': 'Lock transparency', onclick: () => { const l = L(); if (l) setProp(l, 'Lock transparency', () => { l.lockAlpha = !l.lockAlpha; }); } }, '▦'),
              el('button', { class: 'utility-btn', id: 'ph-clip', title: 'Clip to the layer under it (show only where that one has pixels)', 'aria-label': 'Clip', onclick: toggleClip }, '↳')),
            el('ul', { class: 'ph-layers', id: 'ph-layers', role: 'listbox', 'aria-label': 'Layers (top first)' }),
            el('div', { class: 'ph-layerbtns' },
              btn('ph-layer-new', '＋', 'New layer (Ctrl+Shift+N)', newLayer), btn('ph-layer-group', '📁', 'Group (Ctrl+G)', groupLayer),
              btn('ph-layer-mask', '🎭', 'Add a mask (from the selection, if there is one)', () => addMask(true)),
              btn('ph-layer-adjust', '🎚️', 'New adjustment layer', (e) => NoorChrome.openMenu(e.currentTarget, adjustLayerItems())),
              btn('ph-layer-fill', '▧', 'New fill layer', (e) => NoorChrome.openMenu(e.currentTarget, [{ label: 'Colour…', run: () => newFillLayer('colour') }, { label: 'Gradient…', run: () => newFillLayer('gradient') }, { label: 'Pattern…', run: () => newFillLayer('pattern') }])),
              btn('ph-layer-style', '✦', 'Layer style: shadow, glow, stroke, bevel…', (e) => NoorChrome.openMenu(e.currentTarget, styleItems())),
              btn('ph-layer-fx', 'ƒx', 'Add a live filter', (e) => NoorChrome.openMenu(e.currentTarget, filterItems(true))),
              btn('ph-layer-dup', '⧉', 'Duplicate (Ctrl+J)', duplicateLayer), btn('ph-layer-del', '🗑', 'Delete the layer', deleteLayer))),
          el('details', { class: 'ph-panel', open: true }, el('summary', { text: 'Properties' }), el('div', { class: 'ph-props', id: 'ph-props' })),
          el('details', { class: 'ph-panel', id: 'ph-histo-panel', ontoggle: () => scheduleHisto() }, el('summary', { text: 'Histogram' }),
            el('div', { class: 'ph-histo' }, el('select', { id: 'ph-histo-chan', 'aria-label': 'Channel', onchange: () => scheduleHisto() }, ...[['rgb', 'colours'], ['l', 'luminosity'], ['r', 'red'], ['g', 'green'], ['b', 'blue']].map(([v, t]) => el('option', { value: v, text: t }))),
              el('canvas', { id: 'ph-histo', class: 'ph-histo-canvas', width: '240', height: '96', role: 'img', 'aria-label': 'Histogram' }), el('small', { id: 'ph-histo-stats', class: 'ph-propline' }))),
          el('details', { class: 'ph-panel', open: true }, el('summary', { text: 'History' }), el('ol', { class: 'ph-history', id: 'ph-history', 'aria-label': 'History (click a step to go back to it)' })))));
    ($('#app') || document.body).append(root);
    if (window.NoorChrome && NoorChrome.registerBench) NoorChrome.registerBench('photo', { name: 'NoorPhoto', title: appTitle, menus: appMenus });
    $('#ph-blend').replaceChildren(...BLENDS.map((b) => (b ? el('option', { value: b[0], text: b[1] }) : el('option', { disabled: true, text: '──────' }))));
    $('#ph-blend').addEventListener('change', (e) => { const l = L(); if (l) setProp(l, 'Blend mode', () => { l.blend = e.target.value; }); });
    $('#ph-opacity').addEventListener('change', (e) => { const l = L(); if (l) { const v = clamp(Number(e.target.value) || 0, 0, 100) / 100; if (v !== l.opacity) setProp(l, 'Opacity', () => { l.opacity = v; }); } });
    root.addEventListener('keydown', onKey);
    document.addEventListener('keydown', (e) => {
      if (!isOpen() || NoorUI.hasOpenModal() || e.defaultPrevented || (document.activeElement && document.activeElement !== document.body) || !root.offsetParent) return;
      root.focus({ preventScroll: true });
      onKey(e);
    });
    document.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceHeld = false; setCursor(); } if (e.key === 'Alt') { altHeld = false; setCursor(); draw(); } }, true);
    window.addEventListener('blur', () => { spaceHeld = false; altHeld = false; });
    const cv = $('#ph-canvas');
    cv.addEventListener('pointerdown', (e) => {
      if (NoorUI.hasOpenModal()) { if (pointPick && D) pointPick(pointAt(e)); return; }
      onDown(e);
    });
    cv.addEventListener('pointermove', (e) => { if (NoorUI.hasOpenModal()) { if (pointPick && e.buttons) pointPick(pointAt(e)); return; } onMove(e); });
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('dblclick', () => { if (tool === 'pen' && pen) { pen.points.pop(); finishPen(false); } else if (tool === 'polygon' && polygon) closePolygon(); else if (tool === 'rotate' && D) { D.view.angle = 0; draw(); } else if (tool === 'hand') fit(); else if (tool === 'crop' && cropBox) applyCrop(); });
    cv.addEventListener('pointerleave', () => { hover = null; draw(); });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (D && !NoorUI.hasOpenModal()) popupPalette(e.clientX, e.clientY); });
    cv.addEventListener('wheel', onWheel, { passive: false });
    new ResizeObserver(() => { if (D && D.view.fitted) fit(); else draw(); }).observe($('#ph-stage'));
    renderMenubar();
  }

  function renderMenubar() {
    const bar = $('#ph-menubar');
    bar.replaceChildren(...appMenus().map(([name, , items]) => el('button', { class: 'ph-menu-title', role: 'menuitem', onclick: (e) => NoorChrome.openMenu(e.currentTarget, items()) }, name)));
  }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('photo');
    document.body.classList.add('photo-open');
    $('#photobench').hidden = false;
    if (!docs.length) { const d = newDoc(settings.width, settings.height, settings.background); docs.push(d); D = d; requestAnimationFrame(fit); }
    renderAll();
    $('#photobench').focus({ preventScroll: true });
    loadRecent();
    offerDraft();
  }
  async function close() {
    if (!built || !isOpen()) return;
    cancelGestures();
    document.body.classList.remove('photo-open');
    $('#photobench').hidden = true;
    if (window.NoorDock) NoorDock.closed('photo');
  }
  const toggle = () => (isOpen() ? close() : open());

  function renderAll() {
    if (!built) return;
    renderTabs(); renderTools(); renderColours(); renderOptions(); renderLayers(); renderProps(); renderHistory(); renderTitle();
    needCompose = true; draw(); status();
  }
  function renderTitle() {
    if (!built) return;
    $('#ph-file').textContent = D ? `${D.name}${dirty() ? ' •' : ''} · ${D.doc.width} × ${D.doc.height}` : '';
    $('#ph-undo').disabled = !D || !D.history.length; $('#ph-redo').disabled = !D || !D.future.length;
    renderTabs();
    if (window.NoorChrome && NoorChrome.benchChanged) NoorChrome.benchChanged();
  }
  const appTitle = () => `NoorPhoto — ${D ? `${D.name}${dirty() ? ' •' : ''} · ${D.doc.width} × ${D.doc.height}` : ''}`;

  function renderTabs() {
    const t = $('#ph-tabs');
    if (!t) return;
    t.replaceChildren(...docs.map((d, i) => el('div', { class: 'ph-tab' + (d === D ? ' on' : ''), role: 'tab', 'aria-selected': d === D ? 'true' : 'false', title: d.file ? d.file.path || d.file.name : d.name },
      el('button', { class: 'ph-tab-name', 'data-noi18n': '', onclick: () => switchTo(d) }, `${d.name}${dirty(d) ? ' •' : ''}`),
      el('button', { class: 'ph-tab-x', 'aria-label': 'Close this picture', title: 'Close this picture', onclick: () => closeDoc(i) }, '×'))),
    el('button', { class: 'ph-tab-add', title: 'New picture', 'aria-label': 'New picture', onclick: newDialog }, '+'));
  }
  function switchTo(d) { cancelGestures(); D = d; composite = null; needCompose = true; ants = null; renderAll(); }
  async function closeDoc(i) {
    const d = docs[i];
    if (dirty(d) && !await NoorUI.confirm('Close this picture?', `“${d.name}” has changes not saved.`, 'Close it')) return;
    docs.splice(i, 1);
    if (!docs.length) { const n = newDoc(settings.width, settings.height, settings.background); docs.push(n); }
    if (D === d) switchTo(docs[Math.min(i, docs.length - 1)]); else renderTabs();
    if (D && D.view.fitted) requestAnimationFrame(fit);
  }
  function addDoc(d) { docs.push(d); switchTo(d); requestAnimationFrame(fit); }

  function renderTools() {
    const box = $('#ph-tools');
    if (!box) return;
    box.replaceChildren(...TOOLS.map(([id, glyph, title]) => el('button', { class: 'ph-tool' + (tool === id ? ' on' : ''), 'data-tool': id, title, 'aria-label': title.replace(/\s*[(:].*$/, ''), 'aria-pressed': tool === id ? 'true' : 'false', onclick: () => setTool(id) }, glyph)));
  }
  function setTool(id) {
    if (tool === 'polygon' && id !== 'polygon') polygon = null;
    if (tool === 'pen' && id !== 'pen' && pen) finishPen(false);
    if (typing && id !== 'text') finishTyping(true);
    if (tool === 'crop' && id !== 'crop') cropBox = null;
    tool = id;
    renderTools(); renderOptions(); setCursor(); draw();
  }

  function renderColours() {
    if (!built) return;
    $('#ph-fg').style.background = fg; $('#ph-bg').style.background = bg;
    $('#ph-fg').dataset.colour = fg; $('#ph-bg').dataset.colour = bg;
    $('#ph-recent').replaceChildren(...recentColours.map((c) => el('button', { class: 'ph-chip', style: `background:${c}`, title: `${c} (right-click: background colour)`, 'aria-label': c, onclick: () => { fg = c; renderColours(); }, oncontextmenu: (e) => { e.preventDefault(); bg = c; renderColours(); } })));
  }
  function rememberColour(c) { recentColours = [c, ...recentColours.filter((x) => x !== c)].slice(0, 12); renderColours(); }
  const swapColours = () => { [fg, bg] = [bg, fg]; renderColours(); };
  const defaultColours = () => { fg = '#000000'; bg = '#ffffff'; renderColours(); };
  function pickColour(which) {
    const cur = which === 'fg' ? fg : bg;
    NoorUI.modal({ label: which === 'fg' ? 'Foreground colour' : 'Background colour', width: 340 }, (s, closeIt) => {
      const picker = el('input', { type: 'color', value: cur, 'aria-label': 'Colour', id: 'ph-colour-picker' });
      const hexIn = el('input', { type: 'text', value: cur, 'aria-label': 'Hex', maxlength: '7', spellcheck: 'false', id: 'ph-colour-hex' });
      picker.addEventListener('input', () => { hexIn.value = picker.value; });
      hexIn.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hexIn.value)) picker.value = hexIn.value.toLowerCase(); });
      const ok = () => { const v = /^#[0-9a-f]{6}$/i.test(hexIn.value) ? hexIn.value.toLowerCase() : picker.value; if (which === 'fg') fg = v; else bg = v; renderColours(); closeIt(); };
      s.append(NoorUI.head(which === 'fg' ? 'Foreground colour' : 'Background colour', closeIt),
        el('div', { class: 'modal-body ph-dlg' }, el('label', {}, 'Colour ', picker), el('label', {}, 'Hex ', hexIn)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-colour-ok', onclick: ok }, 'OK'))));
    });
  }

  /** The bar over the picture: the tool's settings. */
  function renderOptions() {
    const box = $('#ph-options');
    if (!box) return;
    const num = (key, obj, label, min, max, step = 1, scale = 1, unit = '') => {
      const i = el('input', { type: 'number', class: 'ph-num', id: `ph-opt-${key}`, min: String(min), max: String(max), step: String(step), value: String(Math.round(obj[key] * scale * 100) / 100), 'aria-label': label });
      i.addEventListener('change', () => { obj[key] = clamp(Number(i.value) || 0, min, max) / scale; draw(); });
      return el('label', { class: 'ph-opt' }, label + ' ', i, unit);
    };
    const pick = (key, obj, label, list) => {
      const s = el('select', { id: `ph-opt-${key}`, 'aria-label': label }, ...list.map(([v, t]) => el('option', { value: v, text: t })));
      s.value = String(obj[key]);
      s.addEventListener('change', () => { obj[key] = s.value; renderOptions(); draw(); });
      return el('label', { class: 'ph-opt' }, label ? label + ' ' : '', s);
    };
    const tick = (key, obj, label) => { const c = el('input', { type: 'checkbox', id: `ph-opt-${key}`, checked: obj[key] || undefined }); c.addEventListener('change', () => { obj[key] = c.checked; }); return el('label', { class: 'ph-opt' }, c, ' ', label); };
    const selModes = () => el('span', { class: 'ph-selmodes', role: 'group', 'aria-label': 'Selection' }, ...[['new', '▢', 'New selection'], ['add', '⊞', 'Add to it (Shift)'], ['subtract', '⊟', 'Take away from it (Alt)'], ['intersect', '⧈', 'Keep the overlap (Shift+Alt)']].map(([v, g, t]) => el('button', { class: 'utility-btn' + (opts.selMode === v ? ' on' : ''), title: t, 'aria-label': t, 'aria-pressed': opts.selMode === v ? 'true' : 'false', onclick: () => { opts.selMode = v; renderOptions(); } }, g)));
    const snapTick = () => (D && D.assists && D.assists.length ? tick('snapAssist', D, 'follow the guide') : null);
    const brushRow = (extra = []) => [snapTick(), num('size', brush, 'Size', 1, 2000, 1, 1, 'px'), num('hardness', brush, 'Hardness', 0, 100, 1, 100, '%'), num('opacity', brush, 'Opacity', 1, 100, 1, 100, '%'), num('flow', brush, 'Flow', 1, 100, 1, 100, '%'), ...extra];
    let items = [];
    if (transform) {
      items = [el('span', { class: 'ph-hint', text: 'Drag the corners to scale (Shift: freely), outside to turn, Ctrl+corner for perspective.' }),
        el('button', { class: 'action', onclick: () => flipTransform('h') }, 'Flip ↔'), el('button', { class: 'action', onclick: () => flipTransform('v') }, 'Flip ↕'), el('button', { class: 'action', onclick: () => turnTransform(90) }, 'Turn 90°'),
        el('button', { class: 'action', id: 'ph-tf-cancel', onclick: cancelTransform }, 'Cancel (Esc)'), el('button', { class: 'action primary', id: 'ph-tf-ok', onclick: () => commitTransform() }, 'Apply (Enter)')];
    } else switch (tool) {
      case 'brush': case 'eraser':
        items = brushRow([presetPicker(), pick('tip', brush, 'Tip', TIPS), tick('wetEdges', brush, 'wet edges'), pick('mirror', brush, 'Mirror', [['off', 'off'], ['h', '↔'], ['v', '↕'], ['both', '↔ ↕']]), el('button', { class: 'action', id: 'ph-dynamics', title: 'Size, place, opacity and colour varying from dab to dab', onclick: dynamicsDialog }, 'Dynamics…'), num('spacing', brush, 'Spacing', 1, 200, 1, 100, '%'), pick('smoothing', brush, 'Smoothing', [['0', 'off'], ['12', 'a little'], ['30', 'some'], ['60', 'a lot'], ['120', 'very much']]), tick('pressureSize', brush, 'pen: size'), tick('pressureOpacity', brush, 'pen: opacity')]);
        break;
      case 'assist': items = [pick('assistType', opts, '', [['parallel', 'Ruler (strokes run parallel)'], ['vanish', 'Vanishing point'], ['ellipse', 'Ellipse']]),
        el('span', { class: 'ph-hint', text: opts.assistType === 'vanish' ? 'Click where the lines meet.' : opts.assistType === 'ellipse' ? 'Drag the ellipse\'s box.' : 'Drag along the direction.' }),
        D && D.assists && D.assists.length ? tick('snapAssist', D, 'brushes follow the guide') : null,
        D && D.assists && D.assists.length > 1 ? el('label', { class: 'ph-opt' }, 'Use ', (() => { const sel = el('select', { id: 'ph-opt-assist', 'aria-label': 'Guide' }, ...D.assists.map((a, i) => el('option', { value: String(i), text: `${i + 1}: ${{ parallel: 'ruler', vanish: 'vanishing point', ellipse: 'ellipse' }[a.type]}` }))); sel.value = String(D.assistActive ?? D.assists.length - 1); sel.addEventListener('change', () => { D.assistActive = Number(sel.value); draw(); }); return sel; })()) : null,
        D && D.assists && D.assists.length ? el('button', { class: 'action', id: 'ph-assist-clear', onclick: clearAssists }, 'Clear the guides') : null]; break;
      case 'history': items = brushRow([el('span', { class: 'ph-hint', text: D && D.histSrc ? 'Paints back the chosen state (◎ in History).' : 'Paints back the picture as it was when it opened (◎ in History: another state).' })]); break;
      case 'clone': case 'heal': items = brushRow([tick('cloneAligned', opts, 'aligned'), tick('cloneAll', opts, 'from all layers'), el('span', { class: 'ph-hint', text: D && D.cloneFrom ? 'Alt+click: copy from somewhere else' : 'Alt+click where to copy from' })]); break;
      case 'mixer': items = [presetPicker(), num('size', brush, 'Size', 1, 2000, 1, 1, 'px'), num('hardness', brush, 'Hardness', 0, 100, 1, 100, '%'), num('flow', brush, 'Flow', 1, 100, 1, 100, '%'), num('wet', opts, 'Wet', 0, 100, 1, 100, '%'), num('load', opts, 'Paint load', 0, 100, 1, 100, '%'), pick('mirror', brush, 'Mirror', [['off', 'off'], ['h', '↔'], ['v', '↕'], ['both', '↔ ↕']]), tick('pressureSize', brush, 'pen: size'), el('span', { class: 'ph-hint', text: 'Wet: how much it mixes with what is under it; load 0 smears without adding paint.' })]; break;
      case 'smudge': items = [pick('smudgeMode', opts, '', [['smudge', 'Smudge'], ['blur', 'Blur'], ['sharpen', 'Sharpen']]), num('size', brush, 'Size', 1, 2000, 1, 1, 'px'), num('hardness', brush, 'Hardness', 0, 100, 1, 100, '%'), num('strength', opts, 'Strength', 1, 100, 1, 100, '%')]; break;
      case 'dodge': items = [pick('dodgeMode', opts, '', [['dodge', 'Dodge (lighter)'], ['burn', 'Burn (darker)'], ['desaturate', 'Sponge: less colour'], ['saturate', 'Sponge: more colour']]), pick('range', opts, 'Range', [['shadows', 'shadows'], ['midtones', 'midtones'], ['highlights', 'highlights']]), num('exposure', opts, 'Exposure', 1, 100, 1, 100, '%'), num('size', brush, 'Size', 1, 2000, 1, 1, 'px'), num('hardness', brush, 'Hardness', 0, 100, 1, 100, '%')]; break;
      case 'marquee': case 'ellipse': case 'lasso': case 'polygon':
        items = [selModes(), num('feather', opts, 'Feather', 0, 500, 1, 1, 'px'), tool === 'polygon' ? el('span', { class: 'ph-hint', text: 'Click the corners; double-click or click the first one to close.' }) : null, D && D.sel ? el('button', { class: 'action', onclick: refineDialog }, 'Refine…') : null];
        break;
      case 'wand': items = [selModes(), num('tolerance', opts, 'Tolerance', 0, 255), tick('contiguous', opts, 'touching only'), tick('allLayers', opts, 'all layers')]; break;
      case 'fill': items = [num('tolerance', opts, 'Tolerance', 0, 255), tick('contiguous', opts, 'touching only'), tick('allLayers', opts, 'all layers'), num('opacity', brush, 'Opacity', 1, 100, 1, 100, '%')]; break;
      case 'gradient': items = [pick('gradShape', opts, '', [['linear', 'Linear'], ['radial', 'Radial'], ['angle', 'Angle'], ['reflected', 'Reflected'], ['diamond', 'Diamond']]), pick('gradTo', opts, 'To', [['bg', 'the background colour'], ['clear', 'see-through']]), tick('gradReverse', opts, 'reversed'), num('opacity', brush, 'Opacity', 1, 100, 1, 100, '%')]; break;
      case 'crop': items = [pick('cropRatio', opts, 'Ratio', Object.keys(RATIOS).map((k) => [k, k || 'free'])), cropBox ? el('button', { class: 'action primary', id: 'ph-crop-ok', onclick: () => applyCrop() }, 'Crop (Enter)') : null, cropBox ? el('button', { class: 'action', onclick: () => { cropBox = null; renderOptions(); draw(); } }, 'Cancel') : el('span', { class: 'ph-hint', text: 'Drag the frame (it can go past the edges to make the canvas bigger).' })]; break;
      case 'shape': case 'pen': items = [tool === 'shape' ? pick('shape', opts, '', [['rect', 'Rectangle'], ['rounded', 'Rounded rectangle'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon'], ['star', 'Star'], ['line', 'Line']]) : el('span', { class: 'ph-hint', text: pen ? 'Enter or double-click: finish; click the first point: close; Esc: drop it.' : 'Click for corners, drag for curves (Alt: one handle). Drag the points of a chosen path to change it.' }),
        tick('shapeFill', opts, 'filled'), num('shapeStroke', opts, 'Outline', 0, 500, 1, 1, 'px'), pick('shapeDash', opts, '', [['solid', 'solid'], ['dashed', 'dashed'], ['dotted', 'dotted']]),
        tool === 'shape' && opts.shape === 'rounded' ? num('shapeRadius', opts, 'Corners', 0, 100, 1, 1, '%') : null, tool === 'shape' && (opts.shape === 'polygon' || opts.shape === 'star') ? num('shapeSides', opts, opts.shape === 'star' ? 'Points' : 'Sides', 3, 64) : null,
        tool === 'shape' && opts.shape === 'star' ? num('starInner', opts, 'Inner', 5, 100, 1, 1, '%') : null, tool === 'shape' ? el('span', { class: 'ph-hint', text: 'Shift: square or circle; each shape is a layer that stays changeable.' }) : null]; break;
      case 'text': {
        const t = typing ? typing.l.text : { font: settings.font, size: 48, colour: fg, bold: false, italic: false, align: 'left' };
        if (!typing) { items = [el('span', { class: 'ph-hint', text: 'Click to write a line, drag for a box the words wrap in; click a text to change it.' })]; break; }
        const font = el('input', { type: 'text', id: 'ph-type-font', value: t.font, list: 'ph-fonts2', 'aria-label': 'Font', class: 'ph-fontin' });
        const fonts = el('datalist', { id: 'ph-fonts2' }, ...['sans-serif', 'serif', 'monospace', 'Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Courier New', 'Consolas', 'Bahnschrift', 'Cambria', 'Calibri'].map((f) => el('option', { value: f })));
        font.addEventListener('change', () => { settings.font = font.value.trim() || 'sans-serif'; saveSettings(); setTypingStyle('font', settings.font); });
        const size = el('input', { type: 'number', id: 'ph-type-size', class: 'ph-num', min: '4', max: '2000', value: String(t.size), 'aria-label': 'Size' });
        size.addEventListener('change', () => setTypingStyle('size', clamp(Number(size.value) || 48, 4, 2000)));
        const colour = el('input', { type: 'color', id: 'ph-type-colour', value: t.colour, 'aria-label': 'Colour' });
        colour.addEventListener('input', () => setTypingStyle('colour', colour.value));
        const toggle = (k, glyph, title) => el('button', { class: 'utility-btn' + (t[k] ? ' on' : ''), title, 'aria-label': title, 'aria-pressed': t[k] ? 'true' : 'false', onclick: (e) => { setTypingStyle(k, !typing.l.text[k]); e.currentTarget.classList.toggle('on'); } }, glyph);
        const align = el('select', { id: 'ph-type-align', 'aria-label': 'Alignment' }, el('option', { value: 'left', text: 'left' }), el('option', { value: 'center', text: 'centred' }), el('option', { value: 'right', text: 'right' }));
        align.value = t.align || 'left';
        align.addEventListener('change', () => setTypingStyle('align', align.value));
        items = [el('label', { class: 'ph-opt' }, font, fonts), el('label', { class: 'ph-opt' }, size, 'px'), colour, toggle('bold', 'B', 'Bold'), toggle('italic', 'I', 'Italic'), align,
          el('button', { class: 'action primary', id: 'ph-type-ok', title: 'Done (Esc or Ctrl+Enter)', onclick: () => finishTyping(true) }, '✓ Done'), el('button', { class: 'action', id: 'ph-type-cancel', onclick: () => finishTyping(false) }, '✕')];
        break;
      }
      case 'picker': items = [tick('pickAll', settings, 'from everything you see'), el('span', { class: 'ph-hint', text: 'Shift+click: the background colour' })]; break;
      case 'move': items = [el('span', { class: 'ph-hint', text: D && D.sel ? 'Drag: moves the selected pixels. Arrow keys nudge.' : 'Drag: moves the layer (a group with all in it). Arrow keys nudge.' }), el('button', { class: 'action', title: 'Ctrl+T', onclick: () => startTransform(true) }, 'Free transform…')]; break;
      default: items = [el('button', { class: 'action', onclick: fit }, 'Fit (Ctrl+0)'), el('button', { class: 'action', onclick: () => zoomTo(1) }, '100% (Ctrl+1)'), D && D.view.angle ? el('button', { class: 'action', onclick: () => { D.view.angle = 0; draw(); renderOptions(); } }, 'Straighten the view') : null];
    }
    box.replaceChildren(...items.filter(Boolean));
  }
  // Brush presets: ready-made brushes (and your own, kept here) that set the tool, the tip, size, flow and dynamics.
  const BRUSH_BASE = { hardness: 0.8, opacity: 1, flow: 1, spacing: 0.15, smoothing: 0, pressureSize: true, pressureOpacity: false, tip: 'round', wetEdges: false, sizeJitter: 0, scatter: 0, opacityJitter: 0, hueJitter: 0, brightJitter: 0 };
  const BRUSH_PRESETS = [
    { name: 'Pencil', tool: 'brush', b: { size: 3, hardness: 1, spacing: 0.08, pressureOpacity: true } },
    { name: 'Ink pen', tool: 'brush', b: { size: 6, hardness: 0.95, spacing: 0.05, smoothing: 30 } },
    { name: 'Soft airbrush', tool: 'brush', b: { size: 90, hardness: 0, flow: 0.08 } },
    { name: 'Chalk', tool: 'brush', b: { size: 30, tip: 'chalk', hardness: 0.6, flow: 0.8 } },
    { name: 'Watercolour', tool: 'brush', b: { size: 60, hardness: 0.5, flow: 0.35, opacity: 0.85, wetEdges: true, spacing: 0.1 } },
    { name: 'Oil bristles', tool: 'brush', b: { size: 40, tip: 'bristle', flow: 0.9 } },
    { name: 'Spray can', tool: 'brush', b: { size: 70, tip: 'spray', hardness: 0.5, flow: 0.6 } },
    { name: 'Foliage', tool: 'brush', b: { size: 22, sizeJitter: 0.6, scatter: 1.2, hueJitter: 0.08, brightJitter: 0.3, spacing: 0.6 } },
    { name: 'Stars', tool: 'brush', b: { size: 10, hardness: 0.3, sizeJitter: 0.8, scatter: 4, opacityJitter: 0.7, spacing: 2.5 } },
    { name: 'Wet paint (mixer)', tool: 'mixer', b: { size: 40, hardness: 0.6, flow: 0.8 }, o: { wet: 0.6, load: 0.15 } },
    { name: 'Blender (no paint)', tool: 'mixer', b: { size: 50, hardness: 0.3, flow: 0.6 }, o: { wet: 1, load: 0 } },
  ];
  const MY_BRUSHES = 'noorphoto.brushes';
  const myBrushes = () => { try { return JSON.parse(localStorage.getItem(MY_BRUSHES) || '[]') || []; } catch { return []; } };
  function applyPreset(pr) {
    Object.assign(brush, BRUSH_BASE, pr.b);
    if (pr.o) Object.assign(opts, pr.o);
    settings.lastPreset = pr.name; saveSettings();
    setTool(pr.tool || 'brush');
    notice(pr.name, 900);
  }
  async function saveBrushPreset() {
    const name = await NoorUI.prompt('Save the brush', 'Its name', `My brush ${myBrushes().length + 1}`);
    if (name === undefined || !name.trim()) return;
    const b = {}; for (const k of [...Object.keys(BRUSH_BASE), 'size']) b[k] = brush[k];
    const list = [...myBrushes().filter((x) => x.name !== name.trim()), { name: name.trim(), tool: tool === 'mixer' ? 'mixer' : 'brush', b, o: tool === 'mixer' ? { wet: opts.wet, load: opts.load } : undefined }].slice(-40);
    try { localStorage.setItem(MY_BRUSHES, JSON.stringify(list)); } catch { /* full */ }
    notice(`Brush kept: ${name.trim()}`, 1400); renderOptions();
  }
  function allBrushes() { return [...BRUSH_PRESETS, ...myBrushes().map((x) => ({ ...x, mine: true }))]; }
  function presetPicker() {
    const sel = el('select', { id: 'ph-opt-preset', 'aria-label': 'Brush presets' }, el('option', { value: '', text: 'Brushes…' }),
      ...allBrushes().map((pr, i) => el('option', { value: String(i), text: pr.mine ? `${pr.name} (yours)` : pr.name })), el('option', { value: 'save', text: 'Save this brush…' }));
    sel.addEventListener('change', () => { if (sel.value === 'save') saveBrushPreset(); else if (sel.value) applyPreset(allBrushes()[Number(sel.value)]); sel.value = ''; });
    return sel;
  }

  /** Brush dynamics: how much each dab may vary. */
  function dynamicsDialog() {
    NoorUI.modal({ label: 'Brush dynamics', width: 360 }, (s, closeIt) => {
      const rows = [['sizeJitter', 'Size varies'], ['scatter', 'Scatter'], ['opacityJitter', 'Opacity varies'], ['hueJitter', 'Hue varies'], ['brightJitter', 'Lightness varies']]
        .map(([k, label]) => paramControl({ key: `dyn-${k}`, label, type: 'range', min: 0, max: k === 'scatter' ? 200 : 100, step: 1, unit: '%', value: Math.round(brush[k] * 100) }, () => Math.round(brush[k] * 100), (v) => { brush[k] = v / 100; }));
      s.append(NoorUI.head('Brush dynamics', closeIt), el('div', { class: 'modal-body ph-dlg ph-fx' }, el('p', { class: 'pref-hint', text: 'Each dab of the brush can come out a little different: for foliage, grass, stars, texture.' }), ...rows),
        el('div', { class: 'modal-foot' }, el('button', { class: 'action', onclick: () => { for (const k of ['sizeJitter', 'scatter', 'opacityJitter', 'hueJitter', 'brightJitter']) brush[k] = 0; closeIt(); } }, 'None'), el('div', { class: 'modal-buttons' }, el('button', { class: 'action primary', id: 'ph-dyn-ok', onclick: () => closeIt() }, 'Done'))));
    });
  }
  function flipTransform(axis) {
    const q = transform.corners;
    transform.corners = axis === 'h' ? [q[1], q[0], q[3], q[2]] : [q[3], q[2], q[1], q[0]];
    needCompose = true; draw();
  }
  function turnTransform(deg) {
    const c = centreOf(transform.corners), a = deg * Math.PI / 180;
    transform.corners = transform.corners.map((k) => ({ x: c.x + (k.x - c.x) * Math.cos(a) - (k.y - c.y) * Math.sin(a), y: c.y + (k.x - c.x) * Math.sin(a) + (k.y - c.y) * Math.cos(a) }));
    needCompose = true; draw();
  }

  function status() {
    const s = $('#ph-status');
    if (!s || !D) return;
    const parts = [`${Math.round(D.view.zoom * 1000) / 10}%`];
    if (D.view.angle) parts.push(`${Math.round(D.view.angle)}°`);
    if (hover) parts.push(`x ${Math.floor(hover.x)}, y ${Math.floor(hover.y)}`);
    const b = selBounds();
    if (b) parts.push(`selection ${b.w} × ${b.h}`);
    if (drag && drag.rect) parts.push(`${Math.round(drag.rect.w)} × ${Math.round(drag.rect.h)}`);
    if (cropBox) parts.push(`crop ${Math.round(cropBox.w)} × ${Math.round(cropBox.h)}`);
    const l = L();
    if (l) parts.push(`${l.name}${D.editMask && l.mask ? ' (mask)' : ''}`);
    s.textContent = parts.join(' · ');
  }

  // The histogram: how many pixels of each brightness the picture has (on a smaller copy, a moment after it changes),
  // with the mean, the spread and the middle value.
  let histoTimer = 0;
  function scheduleHisto() {
    const panel = $('#ph-histo-panel');
    if (!panel || !panel.open) return;
    clearTimeout(histoTimer);
    histoTimer = setTimeout(drawHisto, 200);
  }
  function drawHisto() {
    const cv = $('#ph-histo');
    if (!cv || !D || !composite || !Fx()) return;
    const k = Math.min(1, Math.sqrt(250000 / (composite.width * composite.height)));
    const src = k < 1 ? scaled(composite, composite.width * k, composite.height * k) : composite;
    const h = Fx().histogram(imgOf(src)), chan = $('#ph-histo-chan').value, x = g2(cv), W = cv.width, H = cv.height;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 0, W, H);
    const draw1 = (arr, colour, mode) => {
      const max = Math.max(1, ...arr);
      x.fillStyle = colour; x.globalCompositeOperation = mode;
      for (let i = 0; i < 256; i++) { const v = Math.sqrt(arr[i] / max) * (H - 2); x.fillRect(i * W / 256, H - v, W / 256 + 0.5, v); }
      x.globalCompositeOperation = 'source-over';
    };
    if (chan === 'rgb') { draw1(h.r, 'rgba(255,60,60,.8)', 'lighter'); draw1(h.g, 'rgba(60,255,60,.8)', 'lighter'); draw1(h.b, 'rgba(70,110,255,.8)', 'lighter'); }
    else draw1(h[chan], chan === 'r' ? '#ff5050' : chan === 'g' ? '#50ff70' : chan === 'b' ? '#5090ff' : '#d8d8d8', 'source-over');
    const arr = chan === 'rgb' ? h.l : h[chan];
    let n = 0, sum = 0, sq = 0;
    for (let i = 0; i < 256; i++) { n += arr[i]; sum += arr[i] * i; sq += arr[i] * i * i; }
    let acc = 0, median = 0;
    for (let i = 0; i < 256; i++) { acc += arr[i]; if (acc >= n / 2) { median = i; break; } }
    const mean = n ? sum / n : 0, sd = n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0;
    $('#ph-histo-stats').textContent = n ? `Mean ${mean.toFixed(1)} · spread ${sd.toFixed(1)} · middle ${median}` : 'Nothing to show (all see-through)';
  }

  // ---------------------------------------------------------------- the layers, properties and history panels

  const KIND_GLYPH = { group: '📁', fill: '▧', adjust: '🎚️', text: 'T' };
  function thumbOf(src, w = 40, h = 30, x0 = 0, y0 = 0, full = null) {
    const c = el('canvas', { class: 'ph-thumb', width: String(w), height: String(h) }), x = g2(c);
    const W = full ? full.w : src.width, H = full ? full.h : src.height, k = Math.min(w / W, h / H);
    x.imageSmoothingQuality = 'high';
    x.translate((w - W * k) / 2, (h - H * k) / 2); x.scale(k, k);
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#d6d6d6';
    const sq = Math.max(1, Math.round(4 / k));
    for (let yy = 0; yy < H; yy += sq) for (let xx = (yy / sq) % 2 ? sq : 0; xx < W; xx += sq * 2) x.fillRect(xx, yy, sq, sq);
    x.drawImage(src, x0, y0);
    return c;
  }
  function renderLayers() {
    const ul = $('#ph-layers');
    if (!ul || !D) return;
    const a = L();
    $('#ph-blend').value = a ? a.blend : 'normal';
    $('#ph-opacity').value = a ? String(Math.round(a.opacity * 100)) : '100';
    $('#ph-blend').disabled = $('#ph-opacity').disabled = !a;
    for (const [id, on] of [['ph-lock', a && a.locked], ['ph-lockalpha', a && a.lockAlpha], ['ph-clip', a && a.clip]]) { $('#' + id).classList.toggle('on', !!on); $('#' + id).setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const rows = [];
    const full = { w: D.doc.width, h: D.doc.height };
    const walk = (parent, depth) => {
      for (const l of [...kids(parent)].reverse()) {
        rows.push(layerRow(l, depth, full));
        if (l.kind === 'group' && !l.collapsed) walk(l.id, depth + 1);
      }
    };
    walk(null, 0);
    ul.replaceChildren(...rows);
    void a;
  }
  function layerRow(l, depth, full) {
    const on = l.id === D.active;
    let pic;
    if (l.kind === 'pixel' && l.canvas) pic = thumbOf(l.canvas, 40, 30, l.x, l.y, full);
    else if (l.kind === 'text') pic = thumbOf(textCanvas(l), 40, 30, l.x, l.y, full);
    else if (l.kind === 'fill') pic = thumbOf(fillCanvas(l), 40, 30);
    else pic = el('span', { class: 'ph-thumb ph-kind', text: KIND_GLYPH[l.kind] || '' });
    pic.classList.toggle('editing', on && !D.editMask);
    pic.title = 'The layer\'s picture (click to paint on it; Ctrl+click: select its pixels)';
    pic.addEventListener('click', (e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) { selFromAlpha(l, e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'new'); return; } D.active = l.id; D.editMask = false; D.showMaskOnly = false; afterChange(); });
    let maskPic = null;
    if (l.mask) {
      const m = canvas(full.w, full.h), mx = g2(m);
      mx.fillStyle = '#000'; mx.fillRect(0, 0, full.w, full.h); mx.drawImage(maskFull(l), 0, 0);
      maskPic = thumbOf(m, 40, 30);
      maskPic.classList.add('ph-maskthumb');
      maskPic.classList.toggle('editing', on && D.editMask);
      maskPic.classList.toggle('off', !l.mask.enabled);
      maskPic.title = 'The mask: white shows, black hides (click to paint on it; Alt+click: see only the mask; Shift+click: turn it off or on)';
      maskPic.addEventListener('click', (e) => {
        e.stopPropagation();
        D.active = l.id;
        if (e.shiftKey) { toggleMaskOn(); return; }
        if (e.altKey) { D.editMask = true; D.showMaskOnly = !D.showMaskOnly; } else { D.editMask = true; D.showMaskOnly = false; }
        afterChange();
      });
    }
    const eye = el('button', { class: 'ph-eye', title: l.visible ? 'Hide' : 'Show', 'aria-label': l.visible ? 'Hide' : 'Show', 'aria-pressed': l.visible ? 'true' : 'false', onclick: (e) => { e.stopPropagation(); setProp(l, l.visible ? 'Hide layer' : 'Show layer', () => { l.visible = !l.visible; }); } }, l.visible ? '👁' : '·');
    const name = el('span', { class: 'ph-lname', 'data-noi18n': '', text: l.name, title: 'Double-click to rename' });
    name.addEventListener('dblclick', (e) => { e.stopPropagation(); renameLayer(l); });
    const badges = el('span', { class: 'ph-badges' },
      l.clip ? el('span', { title: 'Clipped to the layer under it', text: '↳' }) : null,
      (l.filters || []).length ? el('span', { title: 'Live filters', text: 'ƒx' }) : null,
      window.NoorPhotoStyle && NoorPhotoStyle.any(l.styles) ? el('span', { class: 'ph-stylebadge', title: 'Layer style (double-click the layer to change it)', text: '✦' }) : null,
      l.locked ? el('span', { title: 'Locked', text: '🔒' }) : null,
      l.lockAlpha ? el('span', { title: 'Transparency locked', text: '▦' }) : null,
      l.blend !== 'normal' ? el('span', { class: 'ph-blendtag', title: 'Blend mode', text: (BLENDS.find((b) => b && b[0] === l.blend) || [0, ''])[1] }) : null);
    const twisty = l.kind === 'group' ? el('button', { class: 'ph-twisty', 'aria-label': l.collapsed ? 'Open the group' : 'Close the group', onclick: (e) => { e.stopPropagation(); l.collapsed = !l.collapsed; renderLayers(); } }, l.collapsed ? '▸' : '▾') : null;
    const li = el('li', { class: 'ph-layer' + (on ? ' on' : '') + (l.visible ? '' : ' hidden-layer') + (l.clip ? ' clipped' : ''), role: 'option', 'aria-selected': on ? 'true' : 'false', 'data-id': l.id, draggable: 'true', style: `padding-left:${4 + depth * 14}px` },
      eye, twisty, pic, maskPic, name, badges);
    li.addEventListener('click', () => { if (D.active !== l.id) { D.active = l.id; D.editMask = D.editMask && !!l.mask; D.showMaskOnly = false; afterChange(); } });
    li.addEventListener('dblclick', () => { if (l.kind === 'adjust') effectDialog({ id: l.adjust.id, layer: l }); else if (l.kind === 'fill') fillDialog(l, false); else if (l.kind === 'text') textDialog(l); else styleDialog(l); });
    li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-noorphoto-layer', l.id); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-noorphoto-layer')) return;
      e.preventDefault();
      const r = li.getBoundingClientRect(), k = (e.clientY - r.top) / r.height;
      li.dataset.drop = l.kind === 'group' && k > 0.3 && k < 0.7 ? 'into' : k < 0.5 ? 'above' : 'below';
    });
    li.addEventListener('dragleave', () => { delete li.dataset.drop; });
    li.addEventListener('drop', (e) => { e.preventDefault(); const where = li.dataset.drop; delete li.dataset.drop; dropLayer(e.dataTransfer.getData('text/x-noorphoto-layer'), l.id, where); });
    return li;
  }
  async function renameLayer(l) {
    const v = await NoorUI.prompt('Rename the layer', 'Name', l.name);
    if (v !== undefined && v.trim() && v.trim() !== l.name) setProp(l, 'Rename layer', () => { l.name = v.trim().slice(0, 120); });
  }

  /** Properties: what the active layer is made of (its adjustment, fill, text, live filters, mask). */
  function renderProps() {
    const box = $('#ph-props');
    if (!box || !D) return;
    const l = L();
    if (!l) { box.replaceChildren(); return; }
    const out = [];
    const b = (label, run, id) => el('button', { class: 'action', id, onclick: run }, label);
    if (l.kind === 'adjust') { const fx = effectOf(l.adjust.id); out.push(el('p', { class: 'ph-propline', text: fx ? fx.name : l.adjust.id }), b('Change the settings…', () => effectDialog({ id: l.adjust.id, layer: l }), 'ph-prop-edit')); }
    if (l.kind === 'fill') out.push(el('p', { class: 'ph-propline', text: l.fill.type === 'gradient' ? 'A gradient' : l.fill.type === 'pattern' ? 'A pattern' : 'A colour' }), b('Change the fill…', () => fillDialog(l, false), 'ph-prop-edit'));
    if (l.kind === 'text') out.push(el('p', { class: 'ph-propline', 'data-noi18n': '', text: `“${(l.text.text || '').slice(0, 60)}” · ${l.text.font} ${l.text.size}px` }), b('Type in it', () => { setTool('text'); startTyping(l, false); }, 'ph-prop-edit'), b('Font and spacing…', () => textDialog(l), 'ph-prop-font'));
    if (l.kind === 'pixel' && l.canvas) out.push(el('p', { class: 'ph-propline', text: `Pixels: ${l.canvas.width} × ${l.canvas.height} at ${l.x}, ${l.y}` }));
    if (l.kind === 'group') out.push(el('p', { class: 'ph-propline', text: `A group of ${kids(l.id).length}` }));
    if (l.kind === 'shape') {
      // The shape's fill and stroke, changed in place (each change a step).
      const sh = l.shape, upd = (label, f) => setProp(l, label, () => { l.shape = { ...l.shape, ...f(l.shape) }; });
      const fillOn = el('input', { type: 'checkbox', id: 'ph-sh-fillon', checked: !!sh.fill || undefined, disabled: sh.type === 'line' || (sh.type === 'path' && !sh.closed) || undefined });
      const fillC = el('input', { type: 'color', id: 'ph-sh-fill', value: sh.fill || fg, 'aria-label': 'Fill colour' });
      const strokeOn = el('input', { type: 'checkbox', id: 'ph-sh-strokeon', checked: !!sh.stroke || undefined });
      const strokeC = el('input', { type: 'color', id: 'ph-sh-stroke', value: (sh.stroke && sh.stroke.colour) || bg, 'aria-label': 'Stroke colour' });
      const strokeW = el('input', { type: 'number', id: 'ph-sh-width', class: 'ph-num', min: '1', max: '500', value: String((sh.stroke && sh.stroke.width) || 2), 'aria-label': 'Stroke width' });
      const dash = el('select', { id: 'ph-sh-dash', 'aria-label': 'Line' }, ...[['solid', 'solid'], ['dashed', 'dashed'], ['dotted', 'dotted']].map(([v, t]) => el('option', { value: v, text: t })));
      dash.value = (sh.stroke && sh.stroke.dash) || 'solid';
      const stroke = () => ({ stroke: strokeOn.checked ? { colour: strokeC.value, width: clamp(Number(strokeW.value) || 1, 1, 500), dash: dash.value } : null });
      fillOn.addEventListener('change', () => upd('Shape fill', () => ({ fill: fillOn.checked ? fillC.value : null })));
      fillC.addEventListener('change', () => upd('Shape fill', () => ({ fill: fillC.value })));
      for (const i of [strokeOn, strokeC, strokeW, dash]) i.addEventListener('change', () => upd('Shape stroke', stroke));
      out.push(el('p', { class: 'ph-propline', text: `${SHAPE_NAMES[sh.type] || 'Shape'}${sh.type === 'path' ? (sh.closed ? ', closed' : ', open') : ''}` }),
        el('div', { class: 'ph-row' }, el('label', {}, fillOn, ' fill '), fillC),
        el('div', { class: 'ph-row' }, el('label', {}, strokeOn, ' stroke '), strokeC, strokeW, 'px', dash));
      if (sh.type === 'rounded' || sh.type === 'polygon' || sh.type === 'star') {
        const k = sh.type === 'rounded' ? 'radius' : 'sides', n = el('input', { type: 'number', id: 'ph-sh-' + k, class: 'ph-num', min: sh.type === 'rounded' ? '0' : '3', max: sh.type === 'rounded' ? '100' : '64', value: String(sh[k] ?? (k === 'radius' ? 20 : 5)), 'aria-label': k });
        n.addEventListener('change', () => upd('Shape', () => ({ [k]: Number(n.value) })));
        out.push(el('label', {}, sh.type === 'rounded' ? 'Corners ' : sh.type === 'star' ? 'Points ' : 'Sides ', n, sh.type === 'rounded' ? ' %' : ''));
      }
      out.push(el('div', { class: 'ph-row' }, b('Select its outline', () => selFromShape(l)), b('Rasterize', rasterize)));
    }
    if (l.kind !== 'adjust' && window.NoorPhotoStyle) {
      out.push(el('h4', { class: 'ph-subhead', text: 'Layer style' }));
      const st = l.styles || {}, ons = NoorPhotoStyle.EFFECTS.filter((e) => st[e.id]);
      if (!ons.length && (l.fillOpacity ?? 1) === 1) out.push(el('p', { class: 'pref-hint', text: 'None. ✦ under the layers adds a shadow, a glow, a stroke…' }));
      for (const e of ons) {
        const tick = el('input', { type: 'checkbox', checked: st[e.id].on || undefined, 'aria-label': 'On' });
        tick.addEventListener('change', () => setProp(l, 'Layer style on or off', () => { l.styles = { ...l.styles, [e.id]: { ...l.styles[e.id], on: tick.checked } }; }));
        out.push(el('div', { class: 'ph-fxrow' }, tick, el('span', { text: e.name }), el('button', { class: 'utility-btn', title: 'Change', 'aria-label': 'Change', onclick: () => styleDialog(l, e.id) }, '✎')));
      }
      if ((l.fillOpacity ?? 1) !== 1) out.push(el('p', { class: 'ph-propline', text: `Fill opacity ${Math.round(l.fillOpacity * 100)}%` }));
      out.push(b('Layer style…', () => styleDialog(l), 'ph-prop-style'));
    }
    if (l.kind !== 'group' && l.kind !== 'adjust') {
      const list = l.filters || [];
      out.push(el('h4', { class: 'ph-subhead', text: 'Live filters' }));
      if (!list.length) out.push(el('p', { class: 'pref-hint', text: 'None. A live filter stays changeable: ƒx under the layers, or “As a live filter” in a filter\'s dialog.' }));
      list.forEach((f, i) => {
        const fx = effectOf(f.id);
        const tick = el('input', { type: 'checkbox', checked: f.enabled !== false || undefined, 'aria-label': 'On' });
        tick.addEventListener('change', () => setProp(l, 'Live filter on or off', () => { l.filters = l.filters.map((x, j) => (j === i ? { ...x, enabled: tick.checked } : x)); }));
        out.push(el('div', { class: 'ph-fxrow' }, tick, el('span', { text: fx ? fx.name : f.id }),
          el('button', { class: 'utility-btn', title: 'Change', 'aria-label': 'Change', onclick: () => effectDialog({ id: f.id, live: i, layer: l }) }, '✎'),
          el('button', { class: 'utility-btn', title: 'Earlier', 'aria-label': 'Earlier', disabled: i === 0 || undefined, onclick: () => setProp(l, 'Order of live filters', () => { const x = [...l.filters]; [x[i - 1], x[i]] = [x[i], x[i - 1]]; l.filters = x; }) }, '↑'),
          el('button', { class: 'utility-btn', title: 'Remove', 'aria-label': 'Remove', onclick: () => setProp(l, 'Remove live filter', () => { l.filters = l.filters.filter((_, j) => j !== i); }) }, '✕')));
      });
    }
    if (l.mask) {
      out.push(el('h4', { class: 'ph-subhead', text: 'Mask' }),
        el('div', { class: 'ph-row' },
          b(D.editMask ? 'Paint on the picture' : 'Paint on the mask', () => { D.editMask = !D.editMask; D.showMaskOnly = false; afterChange(); }, 'ph-mask-edit'),
          b(l.mask.enabled ? 'Turn off' : 'Turn on', toggleMaskOn, 'ph-mask-toggle'), b('Invert', invertMask), b('Apply', () => deleteMask(true), 'ph-mask-apply'), b('Delete', () => deleteMask(false), 'ph-mask-delete')));
    }
    box.replaceChildren(...out);
  }

  function renderHistory() {
    const ol = $('#ph-history');
    if (!ol || !D) return;
    const src = (i) => el('button', { class: 'ph-histsrc' + (D.histSrc && D.histSrc.at === i ? ' on' : ''), title: 'Paint from this state with the history brush', 'aria-label': 'History brush source', onclick: (e) => { e.stopPropagation(); setHistorySource(i); } }, '◎');
    const items = [el('li', { class: D.history.length ? '' : 'on', onclick: () => goToStep(-1) }, src(-1), 'Start')];
    D.history.forEach((s, i) => items.push(el('li', { class: i === D.history.length - 1 ? 'on' : '', onclick: () => goToStep(i) }, src(i), s.label)));
    [...D.future].reverse().forEach((s, i) => items.push(el('li', { class: 'future', onclick: () => goToStep(D.history.length + i) }, s.label)));
    ol.replaceChildren(...items);
    const on = ol.querySelector('li.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- files

  /** The document as the app reads it: every picture a PNG (masks grey), and the flattened picture. */
  async function toWire(d, withComposite = true) {
    const prev = D; D = d;
    try {
      const layers = [];
      for (const l of d.doc.layers) {
        const w = { id: l.id, name: l.name, kind: l.kind, parent: l.parent || null, visible: l.visible, locked: l.locked, lockAlpha: !!l.lockAlpha, opacity: l.opacity, blend: l.blend, clip: l.clip, x: l.x, y: l.y, collapsed: !!l.collapsed };
        if (l.styles) w.styles = l.styles;
        if ((l.fillOpacity ?? 1) !== 1) w.fillOpacity = l.fillOpacity;
        let pic = null;
        if (l.kind === 'pixel') pic = l.canvas;
        else if (l.kind === 'text') pic = textCanvas(l);
        else if (l.kind === 'fill') { pic = fillCanvas(l); w.x = 0; w.y = 0; }
        else if (l.kind === 'shape') { const M = shapeMatrix(l); pic = shapeCanvas(l); w.shape = { ...l.shape, m: [M.a, M.b, M.c, M.d, M.e, M.f] }; w.x = 0; w.y = 0; }
        if (pic) { w.width = pic.width; w.height = pic.height; w.png = await pngOf(pic); }
        if (l.fill) w.fill = l.fill;
        if (l.adjust) w.adjust = l.adjust;
        if (l.text) w.text = l.text;
        if ((l.filters || []).length) {
          w.filters = l.filters;
          // The pixels with the live filters applied: what a PSD gets (it has no live filters).
          if (pic && l.filters.some((f) => f.enabled !== false)) w.baked = await pngOf(withFilters(l, pic));
        }
        if (l.mask) {
          const m = l.mask, gc = canvas(m.canvas.width, m.canvas.height), gx = g2(gc);
          gx.fillStyle = '#000'; gx.fillRect(0, 0, gc.width, gc.height); gx.drawImage(m.canvas, 0, 0);
          w.mask = { x: m.x, y: m.y, width: gc.width, height: gc.height, png: await pngOf(gc), enabled: m.enabled, background: m.background ? 255 : 0 };
        }
        if (pic && window.NoorPhotoStyle && (NoorPhotoStyle.any(l.styles) || (l.fillOpacity ?? 1) < 1)) {
          // A PSD gets the layer as it looks (styles, filters and mask applied), the document's size.
          const r = itemCanvas(l), c = canvas(d.doc.width, d.doc.height);
          if (r) g2(c).drawImage(r.canvas, r.x, r.y);
          Object.assign(w, { baked: await pngOf(c), bakedX: 0, bakedY: 0, bakedWidth: c.width, bakedHeight: c.height });
        }
        layers.push(w);
      }
      const out = { version: 1, width: d.doc.width, height: d.doc.height, guides: d.doc.guides, layers };
      if (withComposite) out.composite = await pngOf(compose(d, { noCache: true }));
      return out;
    } finally { D = prev; }
  }
  /** A document from the app's wire (pictures decoded). */
  async function fromWire(w, file, name) {
    const layers = [];
    for (const x of w.layers || []) {
      const l = makeLayer({ id: x.id || newId(), name: x.name || 'Layer', kind: x.kind || 'pixel', parent: x.parent || null, visible: x.visible !== false, locked: !!x.locked, lockAlpha: !!x.lockAlpha, opacity: x.opacity ?? 1, blend: x.blend || 'normal', clip: !!x.clip, x: x.x || 0, y: x.y || 0, collapsed: !!x.collapsed, fill: x.fill || null, adjust: x.adjust || null, text: x.text || null, shape: x.shape || null, filters: x.filters || [], styles: x.styles || null, fillOpacity: x.fillOpacity ?? 1 });
      if (l.kind === 'pixel') l.canvas = x.png ? await canvasFromBytes(unb64(x.png)) : canvas(Math.max(1, x.width || w.width), Math.max(1, x.height || w.height));
      if ((l.kind === 'shape' && !l.shape) || (l.kind === 'text' && !l.text) || (l.kind === 'fill' && !l.fill) || (l.kind === 'adjust' && !l.adjust)) { l.kind = 'pixel'; l.canvas = x.png ? await canvasFromBytes(unb64(x.png)) : canvas(w.width, w.height); }
      if (x.mask) {
        const mw = Math.max(1, x.mask.width || w.width), mh = Math.max(1, x.mask.height || w.height), bgv = x.mask.background ? 255 : 0;
        const m = makeMask(x.mask.x || 0, x.mask.y || 0, mw, mh, bgv);
        if (x.mask.png) {
          const grey = await canvasFromBytes(unb64(x.mask.png)), img = imgOf(grey), dd = img.data;
          for (let i = 0; i < dd.length; i += 4) { const v = dd[i]; dd[i] = dd[i + 1] = dd[i + 2] = 255; dd[i + 3] = v; }
          m.canvas = canvasOfImg(img);
        }
        m.enabled = x.mask.enabled !== false;
        l.mask = m;
      }
      layers.push(l);
    }
    if (!layers.length) layers.push(makeLayer({ name: 'Layer 1', canvas: canvas(w.width, w.height) }));
    const d = wrapDoc({ width: w.width, height: w.height, layers, guides: (w.guides || []).map((g) => ({ axis: g.axis === 'y' ? 'y' : 'x', at: Number(g.at) || 0 })) }, file, name);
    const prev = D; D = d; tidy(); D = prev;
    return d;
  }
  async function pictureDoc(pic, name, file) {
    const c = pic.png ? await canvasFromBytes(unb64(pic.png)) : await canvasFromBytes(unb64(pic.data), pic.mime || 'image/png');
    if (c.width > MAX_SIDE || c.height > MAX_SIDE) throw new Error(`A picture is at most ${MAX_SIDE} pixels a side; that one is ${c.width} × ${c.height}.`);
    return wrapDoc({ width: c.width, height: c.height, layers: [makeLayer({ name: 'Background', canvas: c })], guides: [] }, file, name);
  }
  async function opened(r) {
    if (!r || r.cancelled) return;
    if (r.photo) addDoc(await fromWire(r.photo, { path: r.path, name: r.name }, r.name));
    else if (r.picture) addDoc(await pictureDoc(r.picture, r.name, r.path && /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(r.path) ? { path: r.path, name: r.name, picture: true } : null));
    if (r.notes && r.notes.length) notice(r.notes.join(' '), 5000);
    loadRecent();
  }
  async function openFile() { try { await opened(await req('photo.open')); } catch (err) { hooks.showError(err); } }
  /** File › Place: a picture as a new layer, in the middle. */
  async function placePicture() {
    try {
      const r = await req('photo.place');
      if (!r || r.cancelled || !r.picture) return;
      const c = r.picture.png ? await canvasFromBytes(unb64(r.picture.png)) : await canvasFromBytes(unb64(r.picture.data), r.picture.mime);
      addLayerAbove(makeLayer({ name: uniqueName(r.name || 'Placed'), canvas: c, x: Math.round((D.doc.width - c.width) / 2), y: Math.round((D.doc.height - c.height) / 2) }), 'Place');
      if (c.width > D.doc.width || c.height > D.doc.height) { startTransform(false); notice('Bigger than the picture: drag a corner to scale it, then Enter.', 3200); }
    } catch (err) { hooks.showError(err); }
  }
  /** Save (a .noorphoto keeps everything; a PSD for other programs). A picture opened from a PNG or JPEG asks where. */
  async function save(as) {
    if (!D) return;
    const d = D;
    try {
      const path = !as && d.file && d.file.path && !d.file.picture ? d.file.path : '';
      busy(true);
      const photo = await toWire(d);
      const r = await req('photo.save', { photo, path, name: d.name.replace(/\.[^.]+$/, '') });
      if (!r || r.cancelled) return;
      d.file = { path: r.path, name: r.name }; d.name = r.name; d.savedAt = d.at;
      if (r.notes && r.notes.length) notice(r.notes.join(' '), 5000); else notice(`Saved ${r.name}`, 1400);
      renderTitle(); loadRecent();
      req('photo.draft.clear').catch(() => {});
    } catch (err) { hooks.showError(err); } finally { busy(false); }
  }
  function busy(on) { const b = $('#photobench'); if (b) b.classList.toggle('ph-busy', !!on); }

  /** The flattened picture as the chosen file: { blob, data (base64), width, height }. */
  async function encodeExport(format, quality, k, background) {
    let c = compose(D, { noCache: true });
    if (k !== 1) c = scaled(c, D.doc.width * k, D.doc.height * k);
    if (format === 'jpeg') { const f = canvas(c.width, c.height), x = g2(f); x.fillStyle = background; x.fillRect(0, 0, f.width, f.height); x.drawImage(c, 0, 0); c = f; }
    const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', tiff: 'image/png' }[format];
    const blob = await new Promise((res) => c.toBlob(res, mime, quality));
    return { blob, width: c.width, height: c.height, data: b64(new Uint8Array(await blob.arrayBuffer())) };
  }
  const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  /** Export: the format, quality and size, with a preview of the file as it will be and how big it is. */
  function exportDialog() {
    if (!D) return;
    NoorUI.modal({ label: 'Export', width: 460 }, (s, closeIt) => {
      const fmt = el('select', { id: 'ph-exp-format', 'aria-label': 'Format' }, ...[['png', 'PNG (exact, see-through kept)'], ['jpeg', 'JPEG (photos, smaller)'], ['webp', 'WebP (smaller, see-through kept)'], ['tiff', 'TIFF (print, exact)']].map(([v, t]) => el('option', { value: v, text: t })));
      fmt.value = settings.exportFormat || 'png';
      const q = el('input', { type: 'number', id: 'ph-exp-quality', min: '1', max: '100', value: String(settings.exportQuality || 90), 'aria-label': 'Quality' });
      const sc = el('input', { type: 'number', id: 'ph-exp-scale', min: '1', max: '400', value: '100', 'aria-label': 'Size (%)' });
      const back = el('input', { type: 'color', value: '#ffffff', 'aria-label': 'Background for JPEG' });
      const info = el('p', { class: 'pref-hint', id: 'ph-exp-info' });
      const preview = el('img', { class: 'ph-exp-preview', id: 'ph-exp-preview', alt: 'How the file will look' });
      let made = null, wanted = '', timer = 0, gen = 0;
      const read = () => ({ k: clamp(Number(sc.value) || 100, 1, 400) / 100, format: fmt.value, quality: clamp(Number(q.value) || 90, 1, 100) / 100, background: back.value });
      // The file is made as the settings change (a moment after the last change), so its size is exact and Export uses it.
      const upd = () => {
        const o = read();
        q.parentElement.hidden = !['jpeg', 'webp'].includes(o.format); back.parentElement.hidden = o.format !== 'jpeg';
        wanted = JSON.stringify(o);
        info.textContent = `${Math.round(D.doc.width * o.k)} × ${Math.round(D.doc.height * o.k)} pixels · working out the size…`;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const mine = ++gen, key = wanted;
          try {
            const r = await encodeExport(o.format, o.quality, o.k, o.background);
            if (mine !== gen) return;
            made = { key, ...r };
            if (preview.src) URL.revokeObjectURL(preview.src);
            preview.src = URL.createObjectURL(r.blob);
            info.textContent = `${r.width} × ${r.height} pixels · about ${sizeText(r.blob.size)}${o.format === 'jpeg' ? ' · see-through parts get the background colour' : ''}${o.format === 'tiff' ? ' (as PNG; the TIFF is a little bigger)' : ''}`;
          } catch (err) { info.textContent = String(err.message || err); }
        }, 250);
      };
      for (const i of [fmt, sc, q, back]) i.addEventListener('input', upd);
      const go = async () => {
        const o = read();
        settings.exportFormat = o.format; settings.exportQuality = Math.round(o.quality * 100); saveSettings();
        closeIt();
        try {
          busy(true);
          const r = made && made.key === JSON.stringify(o) ? made : await encodeExport(o.format, o.quality, o.k, o.background);
          const res = await req('photo.export', { data: r.data, format: o.format, name: D.name.replace(/\.[^.]+$/, '') });
          if (res && !res.cancelled) notice(`Exported ${res.name}`, 1600);
        } catch (err) { hooks.showError(err); } finally { busy(false); if (preview.src) URL.revokeObjectURL(preview.src); }
      };
      s.append(NoorUI.head('Export', closeIt), el('div', { class: 'modal-body ph-dlg' },
        el('label', {}, 'Format ', fmt), el('label', {}, 'Quality ', q, ' %'), el('label', {}, 'Size ', sc, ' %'), el('label', {}, 'Background ', back), preview, info,
        el('p', { class: 'pref-hint', text: 'Export makes a flat picture; Save keeps the layers (.noorphoto or PSD).' })),
      el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-exp-ok', onclick: go }, 'Export…'))));
      upd();
    });
  }
  /** File › Quick export as PNG: the whole picture, at its size, no questions but where. */
  async function quickExport() {
    try { busy(true); const r = await encodeExport('png', 1, 1, '#ffffff'); const res = await req('photo.export', { data: r.data, format: 'png', name: D.name.replace(/\.[^.]+$/, '') }); if (res && !res.cancelled) notice(`Exported ${res.name}`, 1600); }
    catch (err) { hooks.showError(err); } finally { busy(false); }
  }
  /** The picture to NoorMaterial (a new material from it, as a photo layer). */
  async function toMaterial() {
    try {
      const c = compose(D, { noCache: true }), r = await req('photo.toTexture', { name: D.name.replace(/\.[^.]+$/, ''), png: await pngOf(c) });
      if (window.NoorTexture && NoorTexture.fromPictures) { await NoorTexture.open(); await NoorTexture.fromPictures([r], 'new'); }
    } catch (err) { hooks.showError(err); }
  }

  let recentFiles = [];
  async function loadRecent() { try { const r = await req('photo.recent'); recentFiles = (r && r.files) || []; } catch { recentFiles = []; } }
  async function openRecent(path) { try { await opened(await req('photo.openRecent', { path })); } catch (err) { hooks.showError(err); } }
  /** Opens a picture from NoorGallery (by its id there). */
  async function openFromGallery(ids) {
    try {
      if (!isOpen()) await open();
      for (const id of [].concat(ids).slice(0, 8)) await opened(await req('photo.openGallery', { id }));
    } catch (err) { hooks.showError(err); }
  }

  // Crash recovery: the picture open now is kept in the app's own folder every few minutes while it has changes.
  let draftTimer = null, draftOffered = false;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
      if (!D || !dirty()) return;
      try { await req('photo.draft.save', { photo: await toWire(D, false), name: D.name, path: D.file ? D.file.path || '' : '' }); } catch { /* next time */ }
    }, 120000);
  }
  async function offerDraft() {
    if (draftOffered) return;
    draftOffered = true;
    try {
      const r = await req('photo.draft.load');
      if (!r || r.none || !r.photo) return;
      const when = r.savedUtc ? new Date(r.savedUtc).toLocaleString() : '';
      const v = await NoorUI.choose('Bring back the unsaved picture?', [`NoorPhoto kept “${r.name || 'Untitled'}” (${when}) before it closed without saving.`], [{ label: 'Throw it away', value: 'drop' }, { label: 'Not now', value: 'later' }, { label: 'Bring it back', value: 'open', primary: true }]);
      if (v === 'open') { const d = await fromWire(r.photo, r.path ? { path: r.path, name: r.name } : null, r.name || 'Recovered'); d.savedAt = -1; addDoc(d); }
      if (v === 'drop') await req('photo.draft.clear');
    } catch (err) { console.warn('NoorPhoto: draft', err); }
  }

  // ---------------------------------------------------------------- dialogs

  const PRESETS = [['Full HD', 1920, 1080], ['4K', 3840, 2160], ['Square', 2048, 2048], ['A4 at 300 dpi', 2480, 3508], ['Photo 3:2', 3000, 2000], ['Portrait 4:5', 1080, 1350], ['Phone 9:16', 1080, 1920], ['Texture 1024', 1024, 1024], ['Texture 2048', 2048, 2048], ['Texture 4096', 4096, 4096], ['Icon 512', 512, 512]];
  function sizeFields(w0, h0) {
    const w = el('input', { type: 'number', id: 'ph-size-w', min: '1', max: String(MAX_SIDE), value: String(w0), 'aria-label': 'Width' });
    const h = el('input', { type: 'number', id: 'ph-size-h', min: '1', max: String(MAX_SIDE), value: String(h0), 'aria-label': 'Height' });
    const read = () => ({ w: clamp(Math.round(Number(w.value)) || 1, 1, MAX_SIDE), h: clamp(Math.round(Number(h.value)) || 1, 1, MAX_SIDE) });
    return { w, h, read };
  }
  function newDialog() {
    NoorUI.modal({ label: 'New picture', width: 420 }, (s, closeIt) => {
      const f = sizeFields(settings.width, settings.height);
      const preset = el('select', { id: 'ph-new-preset', 'aria-label': 'Size' }, el('option', { value: '', text: 'Sizes…' }), ...PRESETS.map(([n, w, h], i) => el('option', { value: String(i), text: `${n} (${w} × ${h})` })));
      preset.addEventListener('change', () => { const p = PRESETS[Number(preset.value)]; if (p) { f.w.value = String(p[1]); f.h.value = String(p[2]); } });
      const back = el('select', { id: 'ph-new-back', 'aria-label': 'Background' }, el('option', { value: 'white', text: 'white' }), el('option', { value: 'clear', text: 'see-through' }), el('option', { value: 'black', text: 'black' }), el('option', { value: 'bg', text: 'the background colour' }));
      back.value = settings.background;
      const fromClip = el('button', { class: 'action', title: 'A picture copied elsewhere, as a new picture', onclick: async () => {
        try {
          for (const it of await navigator.clipboard.read()) { const t = it.types.find((x) => x.startsWith('image/')); if (!t) continue; const c = await canvasFromBytes(new Uint8Array(await (await it.getType(t)).arrayBuffer()), t); closeIt(); addDoc(wrapDoc({ width: c.width, height: c.height, layers: [makeLayer({ name: 'Background', canvas: c })], guides: [] }, null, 'Pasted')); return; }
          notice('There is no picture to paste.', 1800);
        } catch { if (clip) { closeIt(); const c = copyOf(clip.canvas); addDoc(wrapDoc({ width: c.width, height: c.height, layers: [makeLayer({ name: 'Background', canvas: c })], guides: [] }, null, 'Pasted')); } else notice('There is no picture to paste.', 1800); }
      } }, 'From the clipboard');
      const ok = () => { const { w, h } = f.read(); settings.width = w; settings.height = h; settings.background = back.value; saveSettings(); closeIt(); addDoc(newDoc(w, h, back.value)); };
      s.append(NoorUI.head('New picture', closeIt), el('div', { class: 'modal-body ph-dlg' },
        preset, el('div', { class: 'ph-row' }, el('label', {}, 'Width ', f.w, ' px'), el('label', {}, 'Height ', f.h, ' px')), el('label', {}, 'Background ', back)),
      el('div', { class: 'modal-foot' }, fromClip, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-new-ok', onclick: ok }, 'Create'))));
    });
  }
  function imageSizeDialog() {
    NoorUI.modal({ label: 'Image size', width: 400 }, (s, closeIt) => {
      const f = sizeFields(D.doc.width, D.doc.height), keep = el('input', { type: 'checkbox', checked: true }), pct = el('input', { type: 'number', min: '1', max: '1000', value: '100', 'aria-label': 'Percent' });
      const smooth = el('select', { 'aria-label': 'Resampling' }, el('option', { value: '1', text: 'smooth (photos)' }), el('option', { value: '0', text: 'nearest (pixel art)' }));
      const ratio = D.doc.width / D.doc.height;
      f.w.addEventListener('input', () => { if (keep.checked) f.h.value = String(Math.max(1, Math.round(Number(f.w.value) / ratio))); });
      f.h.addEventListener('input', () => { if (keep.checked) f.w.value = String(Math.max(1, Math.round(Number(f.h.value) * ratio))); });
      pct.addEventListener('input', () => { const k = Number(pct.value) / 100; f.w.value = String(Math.max(1, Math.round(D.doc.width * k))); f.h.value = String(Math.max(1, Math.round(D.doc.height * k))); });
      s.append(NoorUI.head('Image size', closeIt), el('div', { class: 'modal-body ph-dlg' },
        el('div', { class: 'ph-row' }, el('label', {}, 'Width ', f.w), el('label', {}, 'Height ', f.h)), el('label', {}, keep, ' keep the proportions'), el('label', {}, 'Or ', pct, ' %'), el('label', {}, 'Resampling ', smooth)),
      el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-isize-ok', onclick: () => { const { w, h } = f.read(); closeIt(); if (w !== D.doc.width || h !== D.doc.height) imageSize(w, h, smooth.value === '1'); } }, 'OK'))));
    });
  }
  function canvasSizeDialog() {
    NoorUI.modal({ label: 'Canvas size', width: 400 }, (s, closeIt) => {
      const f = sizeFields(D.doc.width, D.doc.height);
      let anchor = [0.5, 0.5];
      const grid = el('div', { class: 'ph-anchor', role: 'group', 'aria-label': 'Where the picture stays' });
      const paintGrid = () => grid.replaceChildren(...[0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) => el('button', { class: 'utility-btn' + (anchor[0] === ax && anchor[1] === ay ? ' on' : ''), 'aria-label': `Anchor ${ax} ${ay}`, onclick: () => { anchor = [ax, ay]; paintGrid(); } }, anchor[0] === ax && anchor[1] === ay ? '●' : '·'))));
      paintGrid();
      s.append(NoorUI.head('Canvas size', closeIt), el('div', { class: 'modal-body ph-dlg' },
        el('div', { class: 'ph-row' }, el('label', {}, 'Width ', f.w), el('label', {}, 'Height ', f.h)), el('p', { class: 'pref-hint', text: 'The picture stays where the dot is; layers keep what falls outside.' }), grid),
      el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-csize-ok', onclick: () => { const { w, h } = f.read(); closeIt(); canvasSize(w, h, anchor[0], anchor[1]); } }, 'OK'))));
    });
  }
  /** Select › Refine: grow, shrink, feather, smooth the edge. */
  function refineDialog() {
    if (!D.sel) { notice('Select something first.', 1600); return; }
    NoorUI.modal({ label: 'Refine the selection', width: 360 }, (s, closeIt) => {
      const n = (id, label, v) => el('label', {}, label + ' ', el('input', { type: 'number', id, min: '0', max: '500', value: String(v), 'aria-label': label }), ' px');
      s.append(NoorUI.head('Refine the selection', closeIt), el('div', { class: 'modal-body ph-dlg' },
        n('ph-ref-grow', 'Grow by', 0), n('ph-ref-shrink', 'Shrink by', 0), n('ph-ref-feather', 'Feather', 0)),
      el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-ref-ok', onclick: () => {
        const v = (id) => clamp(Number($('#' + id).value) || 0, 0, 500);
        const g = v('ph-ref-grow'), sh = v('ph-ref-shrink'), fe = v('ph-ref-feather');
        closeIt();
        if (g) growSel(g); if (sh) growSel(-sh); if (fe) featherSel(fe);
      } }, 'OK'))));
    });
  }
  function colourRangeDialog() {
    NoorUI.modal({ label: 'Colour range', width: 360 }, (s, closeIt) => {
      const c = el('input', { type: 'color', id: 'ph-cr-colour', value: fg, 'aria-label': 'Colour' }), fz = el('input', { type: 'range', id: 'ph-cr-fuzz', min: '1', max: '200', value: '40', 'aria-label': 'Fuzziness' });
      const all = el('input', { type: 'checkbox', checked: true });
      s.append(NoorUI.head('Colour range', closeIt), el('div', { class: 'modal-body ph-dlg' },
        el('p', { class: 'pref-hint', text: 'Selects every pixel near a colour (softly, by how near). The eyedropper picks the colour from the picture.' }),
        el('label', {}, 'Colour ', c), el('label', {}, 'Fuzziness ', fz), el('label', {}, all, ' from everything you see')),
      el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-cr-ok', onclick: () => { closeIt(); colourRange(c.value, Number(fz.value), all.checked); } }, 'Select'))));
    });
  }
  async function newGuide() {
    const v = await NoorUI.prompt('New guide', 'Where: a number for a line across (y), or x=… for a line down', `y=${Math.round(D.doc.height / 2)}`);
    if (v === undefined) return;
    const m = /^\s*([xy])\s*=\s*(-?\d+(\.\d+)?)\s*$/i.exec(v) || /^\s*()(-?\d+(\.\d+)?)\s*$/.exec(v);
    if (!m) { notice('Write it like y=300 or x=120.', 2000); return; }
    change('New guide', () => { D.doc.guides.push({ axis: (m[1] || 'y').toLowerCase(), at: Number(m[2]) }); });
  }
  function settingsDialog() {
    NoorUI.modal({ label: 'NoorPhoto settings', width: 420 }, (s, closeIt) => {
      const grid = el('input', { type: 'number', id: 'ph-set-grid', min: '2', max: '2000', value: String(settings.gridSize), 'aria-label': 'Grid' });
      const pg = el('input', { type: 'checkbox', checked: settings.pixelGrid || undefined }), wz = el('input', { type: 'checkbox', id: 'ph-set-wheel', checked: settings.wheelZooms || undefined });
      s.append(NoorUI.head('NoorPhoto settings', closeIt), el('div', { class: 'modal-body ph-dlg' },
        el('label', {}, 'Grid every ', grid, ' px'), el('label', {}, pg, ' the pixel grid when zoomed in close'), el('label', {}, wz, ' the mouse wheel zooms (else it scrolls; Ctrl+wheel zooms)'),
        el('p', { class: 'pref-hint', text: 'A new picture\'s size and background are remembered from the New dialog.' })),
      el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ph-set-ok', onclick: () => {
        settings.gridSize = clamp(Number(grid.value) || 64, 2, 2000); settings.pixelGrid = pg.checked; settings.wheelZooms = wz.checked; saveSettings(); closeIt(); draw();
      } }, 'OK'))));
    });
  }
  function shortcutsDialog() {
    const rows = [
      ...TOOLS.filter((t) => t[3]).map((t) => [t[2].replace(/\s*\(.*$/, ''), t[3].toUpperCase()]),
      ['Pan while held', 'Space'], ['Eyedropper while painting', 'Alt'], ['Brush smaller / bigger', '[ / ]'], ['Softer / harder', 'Shift+[ / Shift+]'], ['Opacity 10…100%', '1 … 0'],
      ['Swap colours · black and white', 'X · D'], ['Quick mask', 'Q'], ['Zoom in / out · fit · 100%', 'Ctrl+= / Ctrl+− · Ctrl+0 · Ctrl+1'],
      ['New · open · save · save as', 'Ctrl+N · Ctrl+O · Ctrl+S · Ctrl+Shift+S'], ['Undo · redo', 'Ctrl+Z · Ctrl+Y'], ['Cut · copy · copy merged · paste', 'Ctrl+X · Ctrl+C · Ctrl+Shift+C · Ctrl+V'],
      ['Select all · nothing · again · invert', 'Ctrl+A · Ctrl+D · Ctrl+Shift+D · Ctrl+Shift+I'], ['Free transform', 'Ctrl+T'], ['Layer via copy · via cut', 'Ctrl+J · Ctrl+Shift+J'],
      ['New layer · group · ungroup', 'Ctrl+Shift+N · Ctrl+G · Ctrl+Shift+G'], ['Merge down · merge visible', 'Ctrl+E · Ctrl+Shift+E'], ['Bring forward · send backward', 'Ctrl+] · Ctrl+['],
      ['Levels · curves · hue and saturation · colour balance', 'Ctrl+L · Ctrl+M · Ctrl+U · Ctrl+B'], ['Invert · desaturate', 'Ctrl+I · Ctrl+Shift+U'], ['Repeat the last filter', 'Ctrl+F'],
      ['Fill with the foreground · background colour', 'Alt+Backspace · Ctrl+Backspace'], ['Delete what is selected', 'Delete'], ['Focus mode (NoorPhoto as an app)', 'F11'],
    ];
    NoorUI.modal({ label: 'NoorPhoto shortcuts', width: 560 }, (s, closeIt) => {
      s.append(NoorUI.head('NoorPhoto shortcuts', closeIt), el('div', { class: 'modal-body ph-dlg' }, el('table', { class: 'sp-keys', id: 'ph-keys' }, ...rows.map(([a, b]) => el('tr', {}, el('td', { text: a }), el('td', {}, el('kbd', { text: b })))))),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action primary', onclick: () => closeIt() }, 'Done'))));
    });
  }

  // ---------------------------------------------------------------- menus

  const ADJ_KEYS = { levels: 'Ctrl+L', curves: 'Ctrl+M', huesat: 'Ctrl+U', balance: 'Ctrl+B', invert: 'Ctrl+I', desaturate: 'Ctrl+Shift+U' };
  /** Image › Adjustments: applied to the pixels (instant ones without a dialog). */
  function adjustItems() {
    if (!Fx()) return [];
    return Fx().ADJUSTMENTS.map((a) => ({ label: a.params.length ? `${a.name}…` : a.name, keys: ADJ_KEYS[a.id], run: () => (a.params.length ? effectDialog({ id: a.id, adjust: true }) : applyInstant(a.id)) }));
  }
  function applyInstant(id) {
    const t = paintTarget();
    if (!t) return;
    const l = t.l, o = originOf(l, t.target), src = o.canvas, img = t.target === 'mask' ? maskImg(src) : imgOf(src);
    const out = Fx().apply(id, img, Fx().defaults(id), { scale: 1 }), final = throughSel(src, t.target === 'mask' ? maskFromImg(out) : canvasOfImg(out), o.x, o.y);
    pixelStep(effectOf(id).name, l, t.target, { x: 0, y: 0, w: src.width, h: src.height }, () => { const x = g2(src); x.clearRect(0, 0, src.width, src.height); x.drawImage(final, 0, 0); });
  }
  const adjustLayerItems = () => (Fx() ? Fx().ADJUSTMENTS.map((a) => ({ label: `${a.name}…`, run: () => newAdjustLayer(a.id) })) : []);
  /** The Filter menu: a submenu per kind. As live filters they go on the layer as settings. */
  function filterItems(asLive) {
    if (!Fx()) return [];
    const groups = [...new Set(Fx().FILTERS.map((f) => f.group))];
    return groups.map((g) => ({ label: g, sub: () => Fx().FILTERS.filter((f) => f.group === g).map((f) => ({ label: `${f.name}…`, title: f.about, run: () => (asLive ? effectDialog({ id: f.id, live: -1 }) : effectDialog({ id: f.id })) })) }));
  }

  function appMenus() {
    const go = (label, run, keys, more = {}) => ({ label, keys, run: () => { run(); setTimeout(keepFocus, 0); }, ...more });
    const has = () => !!D;
    return [
      ['File', 'f', () => [
        go('New…', newDialog, 'Ctrl+N'), go('Open…', openFile, 'Ctrl+O'),
        { label: 'Open recent', sub: () => (recentFiles.length ? recentFiles.map((r) => go(r.name, () => openRecent(r.path), '', { title: r.path })) : [{ label: 'Nothing opened yet', disabled: true }]) },
        go('Place a picture as a layer…', placePicture), go('Reference picture (to look at while painting)…', addReference), '-',
        go('Save', () => save(false), 'Ctrl+S'), go('Save as… (.noorphoto or PSD)', () => save(true), 'Ctrl+Shift+S'), go('Export (PNG, JPEG, WebP, TIFF)…', exportDialog, 'Ctrl+Alt+Shift+S'), go('Quick export as PNG', quickExport), '-',
        go('To NoorMaterial (a new material)', toMaterial), '-',
        go('Close this picture', () => closeDoc(docs.indexOf(D))), { id: 'view.focus', label: 'Back to NoorMD (leave focus mode)' }, go('Close NoorPhoto', close),
      ]],
      ['Edit', 'e', () => [
        go('Undo', undo, 'Ctrl+Z', { disabled: () => !D || !D.history.length }), go('Redo', redo, 'Ctrl+Y', { disabled: () => !D || !D.future.length }), '-',
        go('Cut', () => copy(true), 'Ctrl+X'), go('Copy', () => copy(false), 'Ctrl+C'), go('Copy merged', () => copy(false, true), 'Ctrl+Shift+C'), go('Paste', paste, 'Ctrl+V'), go('Delete what is selected', clearSelected, 'Del'), '-',
        go('Fill with the foreground colour', () => fillWith(fg), 'Alt+Backspace'), go('Fill with the background colour', () => fillWith(bg), 'Ctrl+Backspace'), go('Define a pattern (from the selection)…', definePattern), '-',
        go('Free transform', () => startTransform(true), 'Ctrl+T'), go('Transform again', transformAgain, 'Ctrl+Shift+T', { disabled: () => !lastTransform }),
        { label: 'Transform the layer', sub: () => [go('Flip horizontally', () => turnLayer('h')), go('Flip vertically', () => turnLayer('v')), go('Turn 90° clockwise', () => turnLayer('cw')), go('Turn 90° anticlockwise', () => turnLayer('ccw'))] }, '-',
        go('NoorPhoto settings…', settingsDialog), go('Keyboard shortcuts…', shortcutsDialog),
      ]],
      ['Image', 'i', () => [
        { label: 'Adjustments', sub: adjustItems }, go('Auto tone', autoTone, 'Ctrl+Shift+L'), '-',
        go('Image size…', imageSizeDialog), go('Canvas size…', canvasSizeDialog),
        { label: 'Turn and flip', sub: () => [go('90° clockwise', () => turnImage('cw')), go('90° anticlockwise', () => turnImage('ccw')), go('180°', () => turnImage('180')), '-', go('Flip horizontally', () => turnImage('h')), go('Flip vertically', () => turnImage('v'))] },
        go('Crop to the selection', () => { const b = selBounds(); if (b) applyCrop(b); else notice('Select something first.', 1600); }, '', { disabled: () => !D || !D.sel }), go('Trim (to the pixels)', trim), '-',
        go('Duplicate the picture', duplicateDoc),
      ]],
      ['Layer', 'l', () => [
        go('New layer', newLayer, 'Ctrl+Shift+N'), go('Duplicate', duplicateLayer), go('Delete', deleteLayer), go('Rename…', () => { const l = L(); if (l) renameLayer(l); }), '-',
        { label: 'New adjustment layer', sub: adjustLayerItems }, { label: 'New fill layer', sub: () => [go('Colour…', () => newFillLayer('colour')), go('Gradient…', () => newFillLayer('gradient')), go('Pattern…', () => newFillLayer('pattern'))] }, '-',
        { label: 'Mask', sub: () => [go('Reveal all', () => addMask(false, false)), go('Hide all', () => addMask(false, true)), go('From the selection', () => addMask(true), '', { disabled: () => !D || !D.sel }), '-', go('Turn off / on', toggleMaskOn), go('Invert', invertMask), go('Apply', () => deleteMask(true)), go('Delete', () => deleteMask(false))] },
        go('Clip to the layer under it', toggleClip, '', { checked: () => !!(L() && L().clip) }), '-',
        { label: 'Layer style', sub: styleItems }, { label: 'Live filters', sub: () => filterItems(true) }, '-',
        go('Layer via copy', () => layerVia(false), 'Ctrl+J'), go('Layer via cut', () => layerVia(true), 'Ctrl+Shift+J'), '-',
        go('Group', groupLayer, 'Ctrl+G'), go('Ungroup', ungroup, 'Ctrl+Shift+G'),
        { label: 'Arrange', sub: () => [go('Bring to front', () => arrange(2), 'Ctrl+Shift+]'), go('Bring forward', () => arrange(1), 'Ctrl+]'), go('Send backward', () => arrange(-1), 'Ctrl+['), go('Send to back', () => arrange(-2), 'Ctrl+Shift+[')] }, '-',
        go('Rasterize (into plain pixels)', rasterize), go('Merge down', mergeDown, 'Ctrl+E'), go('Merge visible', () => flatten(true), 'Ctrl+Shift+E'), go('Flatten the picture', () => flatten(false)),
      ]],
      ['Select', 's', () => [
        go('All', selectAll, 'Ctrl+A'), go('Nothing', deselect, 'Ctrl+D'), go('Again (the last one)', reselect, 'Ctrl+Shift+D'), go('Invert', invertSel, 'Ctrl+Shift+I'), '-',
        go('Subject (the main thing in the picture)', () => selectSubject()), go('Colour range…', colourRangeDialog), go('The layer\'s pixels', () => selFromAlpha(L())), go('The shape\'s outline', () => selFromShape(), '', { disabled: () => !L() || L().kind !== 'shape' }), '-',
        go('Refine (grow, shrink, feather)…', refineDialog, '', { disabled: () => !D || !D.sel }), go('Quick mask (paint the selection)', toggleQuickMask, 'Q', { checked: () => !!(D && D.quickMask) }),
      ]],
      ['Filter', 't', () => [go(lastFilter ? `Again: ${effectOf(lastFilter.id).name}` : 'Again (the last filter)', repeatFilter, 'Ctrl+F', { disabled: () => !lastFilter }), '-', ...filterItems(false)]],
      ['View', 'v', () => [
        go('Zoom in', () => zoomStep(1), 'Ctrl+='), go('Zoom out', () => zoomStep(-1), 'Ctrl+−'), go('Fit on screen', fit, 'Ctrl+0'), go('Actual pixels (100%)', () => zoomTo(1), 'Ctrl+1'), go('Straighten the view', () => { if (D) { D.view.angle = 0; draw(); } }), '-',
        { label: 'Grid', checked: () => !!(D && D.showGrid), run: () => { if (D) { D.showGrid = !D.showGrid; draw(); } } },
        { label: 'Guides', checked: () => !!(D && D.showGuides), run: () => { if (D) { D.showGuides = !D.showGuides; draw(); } } },
        { label: 'Wrap around (paint seamless tiles)', checked: () => !!(D && D.wrap), run: () => { if (D) { D.wrap = !D.wrap; draw(); } } },
        go('Painting guides (ruler, vanishing point, ellipse)', () => setTool('assist')), go('Clear the painting guides', clearAssists, '', { disabled: () => !D || !(D.assists || []).length }),
        go('New guide…', newGuide), go('Clear the guides', () => change('Clear guides', () => { D.doc.guides = []; }), '', { disabled: () => !D || !D.doc.guides.length }),
      ]],
    ].map((m) => [m[0], m[1], () => (has() ? m[2]() : [{ label: 'No picture open', disabled: true }])]);
  }
  function duplicateDoc() {
    const d = D, layers = d.doc.layers.map((l) => ({ ...l, canvas: l.canvas ? copyOf(l.canvas) : null, mask: l.mask ? { ...l.mask, canvas: copyOf(l.mask.canvas) } : null, fill: clone(l.fill), adjust: clone(l.adjust), text: clone(l.text), styles: clone(l.styles), shape: clone(l.shape), filters: clone(l.filters) }));
    addDoc(wrapDoc({ width: d.doc.width, height: d.doc.height, layers, guides: clone(d.doc.guides) }, null, `${d.name.replace(/\.[^.]+$/, '')} copy`));
  }
  function toggleQuickMask() {
    if (!D) return;
    // Quick mask on: the selection becomes a mask to paint (white selects); off: it is the selection again.
    if (!D.quickMask) {
      const l = makeLayer({ id: '__quick', name: 'Quick mask', kind: 'pixel' });
      void l;
      D.quickMask = true;
      if (!D.sel) setSel(shapeMask(() => {}));
      notice('Quick mask: paint white to select, black to leave out. Q again to finish.', 3000);
    } else { D.quickMask = false; if (D.sel && isEmpty(D.sel)) setSel(null); }
    ants = null; draw(); renderOptions();
  }
  function keepFocus() { if (isOpen() && !NoorUI.hasOpenModal() && (document.activeElement === document.body || !document.activeElement)) $('#photobench').focus({ preventScroll: true }); }

  // ---------------------------------------------------------------- keys

  function onKey(e) {
    if (!D || NoorUI.hasOpenModal()) return;
    if (e.target && e.target.closest && e.target.closest('input, select, textarea, [contenteditable]')) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.getModifierState && e.getModifierState('AltGraph')) return;
    if (k === ' ' && !ctrl) { handled(); if (!spaceHeld) { spaceHeld = true; setCursor(); } return; }
    if (k === 'Alt') { altHeld = true; setCursor(); draw(); return; }
    if (k === 'Enter') { if (transform) { handled(); commitTransform(); return; } if (cropBox) { handled(); applyCrop(); return; } if (polygon) { handled(); closePolygon(); return; } if (pen) { handled(); finishPen(false); return; } }
    if (k === 'Escape') { if (transform) { handled(); cancelTransform(); return; } if (cropBox) { handled(); cropBox = null; renderOptions(); draw(); return; } if (polygon) { handled(); polygon = null; draw(); return; } if (pen) { handled(); pen = null; draw(); return; } return; }
    if (ctrl && e.altKey && e.shiftKey && k === 's') { handled(); exportDialog(); return; }
    if (ctrl && e.altKey) return;
    if (ctrl) {
      const map = e.shiftKey ? {
        s: () => save(true), z: redo, d: reselect, t: transformAgain, i: invertSel, n: newLayer, j: () => layerVia(true), g: ungroup, e: () => flatten(true), c: () => copy(false, true),
        u: () => applyInstant('desaturate'), l: autoTone, ']': () => arrange(2), '}': () => arrange(2), '[': () => arrange(-2), '{': () => arrange(-2),
      } : {
        n: newDialog, o: openFile, s: () => save(false), z: undo, y: redo, a: selectAll, d: deselect, c: () => copy(false), x: () => copy(true), v: paste,
        t: () => startTransform(true), j: () => layerVia(false), g: groupLayer, e: mergeDown, f: repeatFilter, i: () => applyInstant('invert'),
        l: () => effectDialog({ id: 'levels', adjust: true }), m: () => effectDialog({ id: 'curves', adjust: true }), u: () => effectDialog({ id: 'huesat', adjust: true }), b: () => effectDialog({ id: 'balance', adjust: true }),
        0: fit, 1: () => zoomTo(1), '=': () => zoomStep(1), '+': () => zoomStep(1), '-': () => zoomStep(-1), ']': () => arrange(1), '[': () => arrange(-1), Backspace: () => fillWith(bg),
      };
      const f = map[k];
      if (f) { handled(); f(); }
      return;
    }
    if (e.altKey && k === 'Backspace') { handled(); fillWith(fg); return; }
    if (k === 'Delete' || k === 'Backspace') { handled(); clearSelected(); return; }
    if (tool === 'move' && k.startsWith('Arrow')) { handled(); const s = e.shiftKey ? 10 : 1; nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0); return; }
    if (k === '[' || k === '{') { handled(); if (e.shiftKey) brush.hardness = clamp(brush.hardness - 0.25, 0, 1); else brush.size = Math.max(1, Math.round(brush.size / 1.2)); renderOptions(); draw(); return; }
    if (k === ']' || k === '}') { handled(); if (e.shiftKey) brush.hardness = clamp(brush.hardness + 0.25, 0, 1); else brush.size = Math.min(2000, Math.round(brush.size * 1.2) + 1); renderOptions(); draw(); return; }
    if (/^[0-9]$/.test(k) && !e.altKey) { handled(); brush.opacity = k === '0' ? 1 : Number(k) / 10; renderOptions(); notice(`Opacity ${Math.round(brush.opacity * 100)}%`, 700); return; }
    if (k === 'x' && !e.shiftKey) { handled(); swapColours(); return; }
    if (k === 'd' && !e.shiftKey) { handled(); defaultColours(); return; }
    if (k === 'q' && !e.shiftKey) { handled(); toggleQuickMask(); return; }
    if (k === 'r' && e.shiftKey) { handled(); setTool('rotate'); return; }
    // A tool's letter; pressed again it cycles to the tool's other kind (M: rectangle / ellipse, L: lasso / straight, G: bucket / gradient).
    const pairs = { m: ['marquee', 'ellipse'], l: ['lasso', 'polygon'], g: ['fill', 'gradient'] };
    if (pairs[k] && !e.shiftKey) { handled(); const [a, b] = pairs[k]; setTool(tool === a ? b : a); return; }
    const t = TOOLS.find((x) => x[3] === k);
    if (t && !e.shiftKey) { handled(); setTool(t[0]); }
  }

  // ---------------------------------------------------------------- start

  function init(h) { hooks = { ...hooks, ...h }; }
  setInterval(() => { if (built && isOpen() && D && D.sel && !D.quickMask && !drag) { antsPhase = (antsPhase + 1) % 8; draw(); } }, 140);

  return {
    init, open, close, toggle, isOpen, openFromGallery,
    /** A PNG (base64) opened as a new picture, one layer (NoorInk's File › To NoorPhoto). */
    openPng: async (name, png) => {
      await open();
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('That picture can\'t be read.')); img.src = `data:image/png;base64,${png}`; });
      addDoc(await fromWire({ version: 1, width: img.naturalWidth, height: img.naturalHeight, layers: [{ id: 'l1', name: name || 'Drawing', kind: 'pixel', visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight, png }] }, null, name || 'Drawing'));
    },
    _state: () => D && ({
      width: D.doc.width, height: D.doc.height, name: D.name, file: D.file, dirty: dirty(), docs: docs.length, tool, fg, bg, brush: { ...brush }, opts: { ...opts },
      active: D.active, editMask: D.editMask, quickMask: D.quickMask, history: D.history.map((s) => s.label), future: D.future.length,
      layers: D.doc.layers.map((l) => ({ id: l.id, name: l.name, kind: l.kind, parent: l.parent, visible: l.visible, locked: l.locked, opacity: l.opacity, blend: l.blend, clip: l.clip, x: l.x, y: l.y,
        width: l.canvas ? l.canvas.width : 0, height: l.canvas ? l.canvas.height : 0, mask: l.mask ? { enabled: l.mask.enabled, background: l.mask.background } : null, filters: clone(l.filters), adjust: clone(l.adjust), fill: clone(l.fill), text: clone(l.text), shape: clone(l.shape), styles: clone(l.styles), fillOpacity: l.fillOpacity })),
      selection: selBounds(), transform: !!transform, crop: cropBox ? { ...cropBox } : null, view: { ...D.view },
    }),
    /** For tests: a pixel of the picture as shown (layer null) or of a layer's own picture (in document coordinates). */
    _pixel: (x, y, layerId = null) => {
      if (layerId === null) { const c = compose(D, { noCache: true }); return [...g2(c).getImageData(x, y, 1, 1).data]; }
      const l = byId(layerId);
      if (!l || !l.canvas) return null;
      return [...g2(l.canvas).getImageData(x - l.x, y - l.y, 1, 1).data];
    },
    /** For tests: how much of a pixel is selected (0…255), or of a layer's mask. */
    _sel: (x, y) => (D.sel ? g2(D.sel).getImageData(x, y, 1, 1).data[3] : null),
    _mask: (x, y, layerId) => { const l = byId(layerId || D.active); return l && l.mask ? g2(maskFull(l)).getImageData(x, y, 1, 1).data[3] : null; },
    /** For tests: where a picture point is on the screen. */
    _screen: (x, y) => { const r = $('#ph-canvas').getBoundingClientRect(), p = toScreen(x, y); return { x: r.left + p.x, y: r.top + p.y }; },
    _setColour: (which, c) => { if (which === 'bg') bg = c; else fg = c; renderColours(); },
    _wire: () => toWire(D),
    _load: async (w, name) => addDoc(await fromWire(w, null, name || 'Test')),
    _new: (w, h, back = 'white') => addDoc(newDoc(w, h, back)),
    _select: (x, y, w, h, mode = 'new') => combineSel(shapeMask((c) => c.fillRect(x, y, w, h)), mode),
    _activate: (id) => { D.active = id; D.editMask = false; afterChange(); },
    _editMask: (on) => { D.editMask = !!on; afterChange(); },
    _flush: () => { needCompose = true; paint(); },
    _goTo: goToStep,
  };
})();
