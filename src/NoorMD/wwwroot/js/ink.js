// NoorInk: a vector editor (docs/NOORINK_PLAN.md). The picture is SVG through and through: the page keeps it as a list
// of layers holding objects (paths, text, pictures, groups), draws it as SVG elements (so it stays sharp at any zoom)
// and saves it as plain .svg that other programs open. Paths are kept as subpaths of anchors with cubic handles (see
// NoorInkGeom, inkgeom.js, for the maths: parsing, bounds, hit testing, combining shapes, smoothing freehand lines).
window.NoorInk = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const G = () => window.NoorInkGeom;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v); return e; };
  const ID = [1, 0, 0, 1, 0, 0];
  // Matrices as SVG writes them ([a b c d e f]); mul(a, b) is b first, then a.
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const inv = (m) => { const d = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };

  const TOOLS = [
    ['select', '➤', 'Select (V): move, scale and turn objects; drag on empty space to select several', 'v'],
    ['direct', '⌖', 'Edit points (A): drag anchors and handles; Alt+click an anchor: smooth or corner; Ctrl+click a path: add a point', 'a'],
    ['pen', '✒️', 'Pen (P): click for corners, drag for curves, click the first point to close', 'p'],
    ['pencil', '✏️', 'Pencil (N): draw freely; the line is smoothed into curves', 'n'],
    ['rect', '▭', 'Rectangle (M)', 'm'],
    ['ellipse', '◯', 'Ellipse (L)', 'l'],
    ['polygon', '⬠', 'Polygon', null],
    ['star', '☆', 'Star', null],
    ['line', '╱', 'Line (\\)', '\\'],
    ['text', 'T', 'Text (T): click to write', 't'],
    ['picker', '💧', 'Eyedropper (I): takes an object\'s fill and stroke (and gives them to the selection)', 'i'],
    ['hand', '✋', 'Hand (H; or hold Space)', 'h'],
    ['zoom', '🔍', 'Zoom (Z): click in, Alt+click out', 'z'],
  ];
  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  let doc = null;            // { width, height, background, layers: [{ id, kind: 'layer', name, visible, locked, children }] }
  let file = null;           // { path, name }
  let layerId = null;        // the layer new objects go into
  let selection = [];        // ids of the selected objects
  let points = [];           // with Edit points: [{ id, sub, i }] the selected anchors
  let tool = 'select';
  let style = { fill: { type: 'solid', colour: '#4c8bf5' }, stroke: { colour: '#1d3557', width: 2, dash: 'solid', cap: 'round', join: 'round' }, opacity: 1, blend: 'normal' };
  let opts = { sides: 6, starPoints: 5, inner: 0.5, radius: 0, fitError: 3, snapGrid: false, grid: 20 };
  let view = { zoom: 1, x: 0, y: 0, fitted: true };
  let history = [], future = [], savedAt = null, stamp = 0;
  let drag = null, hover = null, pen = null, typing = null, clip = null;
  let spaceHeld = false;
  let seq = 1;
  const newId = () => 'k' + Date.now().toString(36) + (seq++).toString(36);
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isOpen = () => document.body.classList.contains('ink-open');

  // ---------------------------------------------------------------- the document

  function blank(w = 800, h = 600) {
    const l = { id: newId(), kind: 'layer', name: 'Layer 1', visible: true, locked: false, children: [] };
    layerId = l.id;
    return { width: w, height: h, background: '#ffffff', layers: [l] };
  }
  /** Every object (not layers), depth first, with its parent list. */
  function walk(fn, list = null, parent = null) {
    for (const l of list || doc.layers) {
      if (l.kind !== 'layer') fn(l, parent);
      if (l.children) walk(fn, l.children, l);
    }
  }
  function find(id) { let hit = null; walk((o, p) => { if (o.id === id) hit = { o, parent: p }; }); if (!hit) for (const l of doc.layers) if (l.id === id) hit = { o: l, parent: null }; return hit; }
  const obj = (id) => { const f = find(id); return f ? f.o : null; };
  const siblings = (id) => { const f = find(id); return f ? (f.parent ? f.parent.children : doc.layers) : null; };
  const layerOf = (id) => { let l = null; for (const L of doc.layers) { let inside = false; walk((o) => { if (o.id === id) inside = true; }, L.children); if (inside) l = L; } return l; };
  const currentLayer = () => doc.layers.find((l) => l.id === layerId) || doc.layers[doc.layers.length - 1];
  const sel = () => selection.map(obj).filter(Boolean);
  const dirty = () => stamp !== savedAt;
  const matrixOf = (o) => o.m || ID;
  /** The matrix from an object's own coordinates to the document's (its groups' matrices too). */
  function worldMatrix(id) {
    const chain = [];
    const visit = (list, path) => { for (const o of list) { const p2 = [...path, o]; if (o.id === id) { chain.push(...p2); return true; } if (o.children && visit(o.children, p2)) return true; } return false; };
    visit(doc.layers, []);
    return chain.reduce((m, o) => (o.kind === 'layer' ? m : mul(m, matrixOf(o))), ID);
  }

  // ---------------------------------------------------------------- undo: the document as it was (vector pictures are small)

  function change(label, fn) {
    const before = JSON.stringify({ doc, layerId, selection });
    if (fn() === false) return;
    history.push({ label, state: before, id: ++stamp });
    if (history.length > 150) history.shift();
    future = [];
    afterChange();
  }
  function restoreState(json) { const s = JSON.parse(json); doc = s.doc; layerId = s.layerId; selection = s.selection.filter((id) => find(id)); points = []; }
  function undo() {
    if (!history.length) return;
    finishPen(false); finishTyping(true);
    const h = history.pop();
    future.push({ label: h.label, state: JSON.stringify({ doc, layerId, selection }), id: h.id });
    restoreState(h.state);
    stamp = history.length ? history[history.length - 1].id : 0;
    afterChange();
  }
  function redo() {
    if (!future.length) return;
    const f = future.pop();
    history.push({ label: f.label, state: JSON.stringify({ doc, layerId, selection }), id: f.id });
    restoreState(f.state);
    stamp = f.id;
    afterChange();
  }
  function afterChange() { render(); renderPanels(); renderTitle(); scheduleDraft(); }

  // ---------------------------------------------------------------- drawing it as SVG

  const fmt = (n) => String(Math.round(n * 1000) / 1000);
  const mattr = (m) => (m && m.some((v, i) => v !== ID[i]) ? `matrix(${m.map(fmt).join(' ')})` : null);
  const DASH = { solid: null, dashed: (w) => `${fmt(w * 3)} ${fmt(w * 2)}`, dotted: (w) => `0 ${fmt(w * 2)}` };
  /** A fill or stroke as an SVG paint (gradients go in defs). */
  function paint(f, defs, id, kind) {
    if (!f || f.type === 'none') return 'none';
    if (f.type === 'solid' || !f.type) return f.colour || '#000000';
    const gid = `g-${id}-${kind}`, a = (f.angle || 0) * Math.PI / 180;
    const g = f.type === 'radial' ? svgEl('radialGradient', { id: gid, cx: '0.5', cy: '0.5', r: '0.5' })
      : svgEl('linearGradient', { id: gid, x1: fmt(0.5 - Math.cos(a) / 2), y1: fmt(0.5 - Math.sin(a) / 2), x2: fmt(0.5 + Math.cos(a) / 2), y2: fmt(0.5 + Math.sin(a) / 2) });
    for (const [off, col] of f.stops || [[0, '#000000'], [1, '#ffffff']]) g.append(svgEl('stop', { offset: fmt(off), 'stop-color': col }));
    defs.append(g);
    return `url(#${gid})`;
  }
  /** One object as an SVG element (children for groups). `forFile`: the clean file form (no ids for picking). */
  function toSvgEl(o, defs, forFile) {
    const common = { transform: mattr(o.m), opacity: o.opacity !== undefined && o.opacity !== 1 ? fmt(o.opacity) : null, 'data-id': forFile ? null : o.id, id: forFile ? o.id : null, 'data-name': o.name || null };
    if (o.visible === false) common.display = 'none';
    if (o.blend && o.blend !== 'normal') common.style = `mix-blend-mode:${o.blend}`;
    if (o.kind === 'group' || o.kind === 'layer') {
      const g = svgEl('g', common);
      if (o.kind === 'layer') { g.setAttribute('inkscape:groupmode', 'layer'); g.setAttribute('inkscape:label', o.name); if (o.locked) g.setAttribute('sodipodi:insensitive', 'true'); }
      for (const c of o.children || []) g.append(toSvgEl(c, defs, forFile));
      if (o.clip) {
        // A clipping path (only what is inside its shape shows) or a mask (its lightness is how much shows).
        const cid = `${o.clipKind === 'mask' ? 'm' : 'c'}-${o.id}`, holder = svgEl(o.clipKind === 'mask' ? 'mask' : 'clipPath', { id: cid });
        if (o.clipKind === 'mask') holder.setAttribute('maskUnits', 'userSpaceOnUse'), holder.setAttribute('x', '-100000'), holder.setAttribute('y', '-100000'), holder.setAttribute('width', '200000'), holder.setAttribute('height', '200000');
        const inner = toSvgEl(o.clip, defs, true);
        inner.removeAttribute('id');
        holder.append(inner); defs.append(holder);
        g.setAttribute(o.clipKind === 'mask' ? 'mask' : 'clip-path', `url(#${cid})`);
      }
      return g;
    }
    const strokeAttrs = (s) => (s && s.colour && s.width > 0 ? { stroke: s.colour, 'stroke-width': fmt(s.width), 'stroke-dasharray': DASH[s.dash || 'solid'] ? DASH[s.dash](s.width) : null, 'stroke-linecap': s.cap || 'round', 'stroke-linejoin': s.join || 'round' } : { stroke: 'none' });
    if (o.kind === 'text') {
      const t = svgEl('text', { ...common, x: fmt(o.x), y: fmt(o.y), 'font-family': o.font || 'sans-serif', 'font-size': fmt(o.size || 32), 'font-weight': o.bold ? 'bold' : null, 'font-style': o.italic ? 'italic' : null, 'text-anchor': o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : null, fill: paint(o.fill, defs, o.id, 'f'), ...strokeAttrs(o.stroke), 'xml:space': 'preserve' });
      String(o.text || '').split('\n').forEach((line, i) => t.append(Object.assign(svgEl('tspan', { x: fmt(o.x), dy: i ? fmt((o.size || 32) * (o.lineHeight || 1.2)) : null }), { textContent: line || ' ' })));
      return t;
    }
    if (o.kind === 'image') return svgEl('image', { ...common, x: fmt(o.x), y: fmt(o.y), width: fmt(o.w), height: fmt(o.h), href: o.href, preserveAspectRatio: 'none' });
    return svgEl('path', { ...common, d: G().serialize(o.path || []), fill: paint(o.fill, defs, o.id, 'f'), 'fill-rule': o.rule === 'evenodd' ? 'evenodd' : null, ...strokeAttrs(o.stroke) });
  }
  /** The whole picture as an SVG file. */
  function toFile(d = doc) {
    const prev = doc; doc = d;
    try {
      const root = svgEl('svg', { xmlns: SVGNS, width: fmt(d.width), height: fmt(d.height), viewBox: `0 0 ${fmt(d.width)} ${fmt(d.height)}`, 'data-noorink': '1' });
      root.setAttribute('xmlns:inkscape', 'http://www.inkscape.org/namespaces/inkscape');
      root.setAttribute('xmlns:sodipodi', 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd');
      const defs = svgEl('defs');
      root.append(defs);
      if (d.background) root.append(svgEl('rect', { width: '100%', height: '100%', fill: d.background, 'data-noorink-background': '1' }));
      for (const l of d.layers) root.append(toSvgEl(l, defs, true));
      if (!defs.childNodes.length) defs.remove();
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root).replace(/ xmlns:NS\d+=""/g, '');
    } finally { doc = prev; }
  }

  let frame = 0;
  function render() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paintAll(); }); }
  function stageSize() { const r = $('#ink-stage').getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; }
  const toScreen = (x, y) => ({ x: x * view.zoom + view.x, y: y * view.zoom + view.y });
  const toDoc = (sx, sy) => ({ x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom });
  function fit() {
    if (!doc) return;
    const s = stageSize(), z = Math.min(8, Math.max(0.02, Math.min((s.w - 60) / doc.width, (s.h - 60) / doc.height)));
    view = { zoom: z, x: (s.w - doc.width * z) / 2, y: (s.h - doc.height * z) / 2, fitted: true };
    render();
  }
  function zoomTo(z, at) {
    const s = stageSize(), p = at || { x: s.w / 2, y: s.h / 2 }, before = toDoc(p.x, p.y);
    view.zoom = clamp(z, 0.02, 64); view.fitted = false;
    view.x = p.x - before.x * view.zoom; view.y = p.y - before.y * view.zoom;
    render(); status();
  }

  /** Draws the picture (as live SVG) and the overlay: the selection, handles, the path being drawn. */
  function paintAll() {
    if (!built || !isOpen() || !doc) return;
    const svg = $('#ink-svg'), s = stageSize();
    svg.setAttribute('width', s.w); svg.setAttribute('height', s.h);
    const world = svgEl('g', { id: 'ink-world', transform: `translate(${fmt(view.x)} ${fmt(view.y)}) scale(${view.zoom})` }), defs = svgEl('defs');
    world.append(defs);
    world.append(svgEl('rect', { class: 'ink-board-shadow', x: 0, y: 0, width: doc.width, height: doc.height }));
    world.append(svgEl('rect', { class: 'ink-board', x: 0, y: 0, width: doc.width, height: doc.height, fill: doc.background || 'url(#ink-checker)' }));
    if (!doc.background) {
      const pat = svgEl('pattern', { id: 'ink-checker', width: 16 / view.zoom, height: 16 / view.zoom, patternUnits: 'userSpaceOnUse' });
      pat.append(svgEl('rect', { width: 16 / view.zoom, height: 16 / view.zoom, fill: '#fff' }), svgEl('rect', { width: 8 / view.zoom, height: 8 / view.zoom, fill: '#ddd' }), svgEl('rect', { x: 8 / view.zoom, y: 8 / view.zoom, width: 8 / view.zoom, height: 8 / view.zoom, fill: '#ddd' }));
      defs.append(pat);
    }
    for (const l of doc.layers) world.append(toSvgEl(l, defs, false));
    if (opts.snapGrid) {
      const g = svgEl('g', { class: 'ink-grid' });
      for (let x = opts.grid; x < doc.width; x += opts.grid) g.append(svgEl('line', { x1: x, y1: 0, x2: x, y2: doc.height }));
      for (let y = opts.grid; y < doc.height; y += opts.grid) g.append(svgEl('line', { x1: 0, y1: y, x2: doc.width, y2: y }));
      world.append(g);
    }
    const over = svgEl('g', { id: 'ink-overlay' });
    drawOverlay(over);
    svg.replaceChildren(world, over);
    status();
  }
  /** Object bounds in document coordinates. */
  function boundsOf(o, m = null) {
    m = m || worldMatrix(o.id);
    if (o.kind === 'path') { const p = G().transform(o.path || [], m), b = G().bounds(p); if (!b) return null; const w = o.stroke && o.stroke.colour ? (o.stroke.width || 0) / 2 * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 0; return { x: b.x - w, y: b.y - w, w: b.w + w * 2, h: b.h + w * 2 }; }
    if (o.kind === 'group') {
      let r = null; for (const c of o.children || []) { const b = boundsOf(c, mul(m, matrixOf(c))); if (b) r = r ? unite(r, b) : b; }
      if (r && o.clip) { const c = boundsOf(o.clip, mul(m, matrixOf(o.clip))); if (c) { const x = Math.max(r.x, c.x), y = Math.max(r.y, c.y), x2 = Math.min(r.x + r.w, c.x + c.w), y2 = Math.min(r.y + r.h, c.y + c.h); r = x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null; } }
      return r;
    }
    let box;
    if (o.kind === 'image') box = { x: o.x, y: o.y, w: o.w, h: o.h };
    else if (o.kind === 'text') {
      // Measured from the drawn element when it is on screen; else estimated.
      const e = document.querySelector(`#ink-svg [data-id="${o.id}"]`);
      if (e && e.getBBox) { try { const b = e.getBBox(); box = { x: b.x, y: b.y, w: b.width, h: b.height }; } catch { box = null; } }
      if (!box) { const lines = String(o.text || ' ').split('\n'), size = o.size || 32; box = { x: o.x, y: o.y - size, w: Math.max(...lines.map((s) => s.length)) * size * 0.55, h: size * (1 + (lines.length - 1) * (o.lineHeight || 1.2)) }; }
    } else return null;
    const pts = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]].map(([x, y]) => ap(m, x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const unite = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
  function selBounds() { let r = null; for (const o of sel()) { const b = boundsOf(o); if (b) r = r ? unite(r, b) : b; } return r; }

  // ---------------------------------------------------------------- the overlay: selection, handles, what is being drawn

  function handlesOf(b) {
    const p = (x, y) => toScreen(x, y);
    return [p(b.x, b.y), p(b.x + b.w / 2, b.y), p(b.x + b.w, b.y), p(b.x + b.w, b.y + b.h / 2), p(b.x + b.w, b.y + b.h), p(b.x + b.w / 2, b.y + b.h), p(b.x, b.y + b.h), p(b.x, b.y + b.h / 2)];
  }
  function drawOverlay(over) {
    const rectS = (b, cls) => { const a = toScreen(b.x, b.y); over.append(svgEl('rect', { class: cls, x: a.x, y: a.y, width: b.w * view.zoom, height: b.h * view.zoom })); };
    if (tool === 'direct') {
      for (const o of sel()) if (o.kind === 'path') drawAnchors(over, o);
    } else if (selection.length && !(drag && drag.kind === 'band')) {
      for (const o of sel()) { const b = boundsOf(o); if (b && selection.length > 1) rectS(b, 'ink-sel-each'); }
      const b = selBounds();
      if (b) {
        rectS(b, 'ink-sel');
        if (tool === 'select') for (const h of handlesOf(b)) over.append(svgEl('rect', { class: 'ink-handle', x: h.x - 4, y: h.y - 4, width: 8, height: 8 }));
      }
    }
    if (drag && drag.kind === 'band') rectS(normRect(drag.start, drag.now), 'ink-band');
    if (drag && drag.kind === 'shape') { const pv = shapePath(drag); if (pv) over.append(svgEl('path', { class: 'ink-preview', d: G().serialize(G().transform(pv, [view.zoom, 0, 0, view.zoom, view.x, view.y])) })); }
    if (drag && drag.kind === 'pencil' && drag.pts.length > 1) over.append(svgEl('polyline', { class: 'ink-preview', points: drag.pts.map(([x, y]) => { const s = toScreen(x, y); return `${fmt(s.x)},${fmt(s.y)}`; }).join(' ') }));
    if (pen && pen.pts.length) {
      const sub = { closed: false, pts: pen.pts }, path = G().transform([sub], [view.zoom, 0, 0, view.zoom, view.x, view.y]);
      over.append(svgEl('path', { class: 'ink-preview', d: G().serialize(path) }));
      if (hover) { const last = toScreen(pen.pts[pen.pts.length - 1].ox, pen.pts[pen.pts.length - 1].oy), lp = toScreen(pen.pts[pen.pts.length - 1].x, pen.pts[pen.pts.length - 1].y); over.append(svgEl('path', { class: 'ink-preview ink-faint', d: `M${fmt(lp.x)} ${fmt(lp.y)}C${fmt(last.x)} ${fmt(last.y)} ${fmt(hover.sx)} ${fmt(hover.sy)} ${fmt(hover.sx)} ${fmt(hover.sy)}` })); }
      for (const q of pen.pts) { const s = toScreen(q.x, q.y); over.append(svgEl('rect', { class: 'ink-anchor', x: s.x - 3.5, y: s.y - 3.5, width: 7, height: 7 })); }
    }
  }
  /** Edit points: a path's anchors (filled when chosen) and the handles of the chosen ones. */
  function drawAnchors(over, o) {
    const m = worldMatrix(o.id), sc = (x, y) => { const [a, b] = ap(m, x, y); return toScreen(a, b); };
    over.append(svgEl('path', { class: 'ink-outline', d: G().serialize(G().transform(o.path, mul([view.zoom, 0, 0, view.zoom, view.x, view.y], m))) }));
    (o.path || []).forEach((sub, si) => sub.pts.forEach((q, i) => {
      const on = points.some((p) => p.id === o.id && p.sub === si && p.i === i), a = sc(q.x, q.y);
      if (on || points.length === 0) for (const k of ['i', 'o']) {
        const h = sc(q[k + 'x'], q[k + 'y']);
        if (Math.hypot(h.x - a.x, h.y - a.y) < 0.5) continue;
        over.append(svgEl('line', { class: 'ink-handle-line', x1: a.x, y1: a.y, x2: h.x, y2: h.y }), svgEl('circle', { class: 'ink-handle-dot', cx: h.x, cy: h.y, r: 3.5 }));
      }
      over.append(svgEl('rect', { class: 'ink-anchor' + (on ? ' on' : ''), x: a.x - 3.5, y: a.y - 3.5, width: 7, height: 7 }));
    }));
  }
  const normRect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

  // ---------------------------------------------------------------- picking

  /** The object under the pointer: the whole top-level object of its layer (a group as one), or with `deep` the path itself. */
  function hit(e, deep) {
    const t = e.target && e.target.closest ? e.target.closest('[data-id]') : null;
    if (!t) return null;
    const id = t.getAttribute('data-id'), f = find(id);
    if (!f || f.o.kind === 'layer') return null;
    const l = layerOf(id);
    if (l && (l.locked || l.visible === false)) return null;
    if (f.o.locked) return null;
    if (deep) return f.o;
    let o = f.o;
    for (let guard = 0; guard < 64; guard++) { const pf = find(o.id).parent; if (!pf || pf.kind === 'layer') break; o = pf; }
    return o;
  }
  function pointAt(e) { const r = $('#ink-svg').getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, p = toDoc(sx, sy); return { x: p.x, y: p.y, sx, sy }; }
  const snap = (p) => (opts.snapGrid ? { ...p, x: Math.round(p.x / opts.grid) * opts.grid, y: Math.round(p.y / opts.grid) * opts.grid } : p);
  function handleAt(p) {
    const b = selBounds();
    if (!b || tool !== 'select') return null;
    const hs = handlesOf(b);
    for (let i = 0; i < hs.length; i++) if (Math.abs(hs[i].x - p.sx) <= 6 && Math.abs(hs[i].y - p.sy) <= 6) return { handle: i, box: b };
    const a = toScreen(b.x, b.y), c = toScreen(b.x + b.w, b.y + b.h);
    const inside = p.sx >= a.x && p.sx <= c.x && p.sy >= a.y && p.sy <= c.y;
    if (!inside && [hs[0], hs[2], hs[4], hs[6]].some((h) => Math.hypot(h.x - p.sx, h.y - p.sy) < 24)) return { rotate: true, box: b };
    return null;
  }
  function anchorAt(p) {
    for (const o of sel()) {
      if (o.kind !== 'path') continue;
      const m = worldMatrix(o.id);
      for (let si = 0; si < o.path.length; si++) for (let i = 0; i < o.path[si].pts.length; i++) {
        const q = o.path[si].pts[i];
        for (const part of ['o', 'i', 'a']) {
          const [x, y] = part === 'a' ? ap(m, q.x, q.y) : ap(m, q[part + 'x'], q[part + 'y']), s = toScreen(x, y);
          if (part !== 'a' && Math.hypot(q[part + 'x'] - q.x, q[part + 'y'] - q.y) < 0.01) continue;
          if (Math.hypot(s.x - p.sx, s.y - p.sy) <= 6) return { o, sub: si, i, part, m };
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- the mouse and the pen

  /** Puts objects in the current layer (on top) and selects them, as one step. */
  function addObjects(list, label) {
    change(label, () => {
      const l = currentLayer();
      if (l.locked) l.locked = false;
      l.children.push(...list);
      selection = list.map((o) => o.id);
      points = [];
    });
  }
  function styled(o) { return { ...o, fill: clone(style.fill), stroke: clone(style.stroke), opacity: style.opacity, blend: style.blend }; }
  function shapePath(d) {
    let a = d.start, b = d.now;
    if (d.shift && d.tool !== 'line') { const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); b = { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s }; }
    if (d.tool === 'line') {
      if (d.shift) { const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(b.x - a.x, b.y - a.y); b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len }; }
      return G().line(a.x, a.y, b.x, b.y);
    }
    if (d.alt) a = { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
    const r = normRect(a, b);
    if (r.w < 0.5 || r.h < 0.5) return null;
    if (d.tool === 'rect') return G().rect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) / 2 * clamp(opts.radius / 100, 0, 1));
    if (d.tool === 'ellipse') return G().ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2);
    if (d.tool === 'polygon') return G().polygon(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, opts.sides, 0);
    return G().star(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, opts.starPoints, opts.inner, 0);
  }
  const SHAPE_NAME = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line' };

  function onDown(e) {
    if (!doc || e.button === 2) return;
    const cv = $('#ink-svg'), p = pointAt(e);
    if (typing) { finishTyping(true); if (tool === 'text') return; }
    $('#ink-stage').focus({ preventScroll: true });
    if (e.button === 1 || spaceHeld || tool === 'hand') { drag = { kind: 'pan', sx: p.sx, sy: p.sy, vx: view.x, vy: view.y }; cv.setPointerCapture(e.pointerId); return; }
    cv.setPointerCapture(e.pointerId);
    const before = JSON.stringify({ doc, layerId, selection });
    switch (tool) {
      case 'zoom': zoomTo(view.zoom * (e.altKey ? 1 / 1.5 : 1.5), { x: p.sx, y: p.sy }); return;
      case 'select': {
        const h = handleAt(p);
        if (h) { drag = { kind: h.rotate ? 'rotate' : 'scale', handle: h.handle, box: h.box, start: p, before, orig: origins() }; return; }
        const o = hit(e, e.ctrlKey || e.metaKey);
        if (o) {
          if (e.shiftKey) selection = selection.includes(o.id) ? selection.filter((x) => x !== o.id) : [...selection, o.id];
          else if (!selection.includes(o.id)) selection = [o.id];
          if (e.altKey && selection.length) duplicateInPlace();
          drag = { kind: 'move', start: p, before, orig: origins(), moved: false };
        } else { if (!e.shiftKey) selection = []; drag = { kind: 'band', start: p, now: p, add: e.shiftKey }; }
        renderPanels(); render(); return;
      }
      case 'direct': {
        const a = anchorAt(p);
        if (a && e.altKey && a.part === 'a') { change('Smooth or corner', () => { const q = a.o.path[a.sub].pts[a.i]; const corner = Math.hypot(q.ix - q.x, q.iy - q.y) + Math.hypot(q.ox - q.x, q.oy - q.y) > 0.5; a.o.path = corner ? G().cornerize(a.o.path, a.sub, a.i) : G().smoothCorner(a.o.path, a.sub, a.i); }); return; }
        if (a) {
          if (a.part === 'a') { const key = (x) => x.id === a.o.id && x.sub === a.sub && x.i === a.i; if (e.shiftKey) points = points.some(key) ? points.filter((x) => !key(x)) : [...points, { id: a.o.id, sub: a.sub, i: a.i }]; else if (!points.some(key)) points = [{ id: a.o.id, sub: a.sub, i: a.i }]; }
          drag = { kind: 'point', a, start: p, before, inv: inv(a.m), orig: clone(a.o.path) };
          render(); return;
        }
        const o = hit(e, true);
        if (o && (e.ctrlKey || e.metaKey) && o.kind === 'path' && selection.includes(o.id)) {
          // Ctrl+click on a chosen path: a new anchor there.
          const m = worldMatrix(o.id), [lx, ly] = ap(inv(m), p.x, p.y), n = G().nearest(o.path, lx, ly);
          if (n && n.dist * view.zoom < 10) change('Add a point', () => { o.path = G().split(o.path, n.sub, n.seg, n.t); points = []; });
          return;
        }
        if (o) { selection = [o.id]; points = []; } else { selection = []; points = []; }
        renderPanels(); render(); return;
      }
      case 'pen': {
        const q = snap(p);
        if (!pen) pen = { pts: [] };
        if (pen.pts.length > 2) { const f = toScreen(pen.pts[0].x, pen.pts[0].y); if (Math.hypot(f.x - p.sx, f.y - p.sy) < 8) { finishPen(true); return; } }
        pen.pts.push({ x: q.x, y: q.y, ix: q.x, iy: q.y, ox: q.x, oy: q.y });
        drag = { kind: 'pennew' }; render(); return;
      }
      case 'pencil': drag = { kind: 'pencil', pts: [[p.x, p.y]] }; return;
      case 'rect': case 'ellipse': case 'polygon': case 'star': case 'line': { const q = snap(p); drag = { kind: 'shape', tool, start: q, now: q }; return; }
      case 'text': { const o = hit(e, true); if (o && o.kind === 'text') { selection = [o.id]; startTyping(o, false); } else startTyping(null, false, p); return; }
      case 'picker': {
        const o = hit(e, true);
        if (!o) return;
        style = { ...style, fill: clone(o.fill || style.fill), stroke: clone(o.stroke || style.stroke) };
        if (selection.length && !selection.includes(o.id)) applyStyle({ fill: style.fill, stroke: style.stroke }, 'Take the style');
        renderPanels(); return;
      }
      default: break;
    }
  }
  /** Each selected object's matrix and its parent's (for moving it in document space). */
  function origins() { return sel().map((o) => { const W = worldMatrix(o.id), P = mul(W, inv(matrixOf(o))); return { id: o.id, m: matrixOf(o).slice(), P }; }); }
  /** Applies a document-space transform T to the selection (from where it started). */
  function applyT(orig, T) { for (const r of orig) { const o = obj(r.id); if (o) o.m = mul(inv(r.P), mul(T, mul(r.P, r.m))); } }

  function onMove(e) {
    if (!doc) return;
    const p = pointAt(e);
    hover = { x: p.x, y: p.y, sx: p.sx, sy: p.sy };
    if (!drag) { setCursor(p); if (pen) render(); status(); return; }
    switch (drag.kind) {
      case 'pan': view.x = drag.vx + p.sx - drag.sx; view.y = drag.vy + p.sy - drag.sy; view.fitted = false; break;
      case 'move': {
        let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (opts.snapGrid) { const b = drag.box || (drag.box = selBounds()); if (b) { dx = Math.round((b.x + dx) / opts.grid) * opts.grid - b.x; dy = Math.round((b.y + dy) / opts.grid) * opts.grid - b.y; } }
        drag.moved = drag.moved || Math.hypot(p.sx - toScreen(drag.start.x, drag.start.y).x, p.sy - toScreen(drag.start.x, drag.start.y).y) > 2;
        applyT(drag.orig, [1, 0, 0, 1, dx, dy]);
        break;
      }
      case 'scale': {
        const b = drag.box, h = drag.handle, L = [0, 6, 7].includes(h), R = [2, 3, 4].includes(h), T2 = [0, 1, 2].includes(h), B = [4, 5, 6].includes(h);
        const fx = e.altKey ? b.x + b.w / 2 : L ? b.x + b.w : b.x, fy = e.altKey ? b.y + b.h / 2 : T2 ? b.y + b.h : b.y;
        let sx = L || R ? (p.x - fx) / ((L ? b.x : b.x + b.w) - fx || 1) : 1, sy = T2 || B ? (p.y - fy) / ((T2 ? b.y : b.y + b.h) - fy || 1) : 1;
        if (h % 2 === 0 && !e.shiftKey) { const k = Math.abs(sx) > Math.abs(sy) ? sx : sy; sx = Math.sign(sx || 1) * Math.abs(k); sy = Math.sign(sy || 1) * Math.abs(k); }
        applyT(drag.orig, [sx, 0, 0, sy, fx - sx * fx, fy - sy * fy]);
        break;
      }
      case 'rotate': {
        const b = drag.box, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        let a = Math.atan2(p.y - cy, p.x - cx) - Math.atan2(drag.start.y - cy, drag.start.x - cx);
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        const c = Math.cos(a), s = Math.sin(a);
        applyT(drag.orig, [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]);
        drag.angle = a;
        break;
      }
      case 'band': drag.now = p; break;
      case 'point': {
        const a = drag.a, [lx, ly] = ap(drag.inv, p.x, p.y), [sx0, sy0] = ap(drag.inv, drag.start.x, drag.start.y), dx = lx - sx0, dy = ly - sy0;
        const path = clone(drag.orig);
        if (a.part === 'a') {
          // The chosen anchors move together, with their handles.
          for (const pt of points.length ? points : [{ id: a.o.id, sub: a.sub, i: a.i }]) {
            if (pt.id !== a.o.id) continue;
            const q = path[pt.sub].pts[pt.i];
            for (const k of ['', 'i', 'o']) { q[k + 'x'] = (k ? q[k + 'x'] : q.x) + dx; q[k + 'y'] = (k ? q[k + 'y'] : q.y) + dy; }
          }
        } else {
          const q = path[a.sub].pts[a.i], k = a.part, other = k === 'o' ? 'i' : 'o';
          q[k + 'x'] += dx; q[k + 'y'] += dy;
          if (!e.altKey) { const len = Math.hypot(q[other + 'x'] - q.x, q[other + 'y'] - q.y); if (len > 0.01) { const ang = Math.atan2(q[k + 'y'] - q.y, q[k + 'x'] - q.x) + Math.PI; q[other + 'x'] = q.x + Math.cos(ang) * len; q[other + 'y'] = q.y + Math.sin(ang) * len; } }
        }
        a.o.path = path;
        break;
      }
      case 'pennew': { const q = pen.pts[pen.pts.length - 1]; q.ox = p.x; q.oy = p.y; if (!e.altKey) { q.ix = 2 * q.x - p.x; q.iy = 2 * q.y - p.y; } break; }
      case 'pencil': { const last = drag.pts[drag.pts.length - 1]; if (Math.hypot(p.x - last[0], p.y - last[1]) * view.zoom > 1.5) drag.pts.push([p.x, p.y]); break; }
      case 'shape': drag.now = snap(p); drag.shift = e.shiftKey; drag.alt = e.altKey; break;
      default: break;
    }
    render(); status();
  }

  function onUp(e) {
    const d = drag;
    drag = null;
    if (!d || !doc) return;
    try { $('#ink-svg').releasePointerCapture(e.pointerId); } catch { /* not held */ }
    switch (d.kind) {
      case 'move': if (d.moved) commit(d.before, 'Move'); else render(); break;
      case 'scale': commit(d.before, 'Scale'); break;
      case 'rotate': commit(d.before, 'Rotate'); break;
      case 'point': commit(d.before, 'Move a point'); break;
      case 'band': {
        const r = normRect(d.start, d.now);
        if (r.w * view.zoom > 3 || r.h * view.zoom > 3) {
          const inside = [];
          for (const l of doc.layers) { if (l.locked || l.visible === false) continue; for (const o of l.children) { const b = boundsOf(o); if (b && b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) inside.push(o.id); } }
          selection = d.add ? [...new Set([...selection, ...inside])] : inside;
        }
        renderPanels(); render(); break;
      }
      case 'pencil': {
        if (d.pts.length < 3) break;
        const sub = G().fit(d.pts, opts.fitError / view.zoom);
        if (!sub || !sub.pts || sub.pts.length < 2) break;
        const f = d.pts[0], l = d.pts[d.pts.length - 1];
        if (Math.hypot(f[0] - l[0], f[1] - l[1]) * view.zoom < 10 && d.pts.length > 8) sub.closed = true;
        const o = styled({ id: newId(), kind: 'path', name: 'Drawing', path: [sub] });
        if (!sub.closed) o.fill = { type: 'none' };
        addObjects([o], 'Pencil');
        break;
      }
      case 'shape': {
        const path = shapePath(d);
        if (!path) break;
        const o = styled({ id: newId(), kind: 'path', name: SHAPE_NAME[d.tool], path });
        if (d.tool === 'line') o.fill = { type: 'none' };
        addObjects([o], SHAPE_NAME[d.tool]);
        break;
      }
      default: render(); break;
    }
  }
  /** A step for a change already made while dragging (the state before it given). */
  function commit(before, label) {
    history.push({ label, state: before, id: ++stamp });
    if (history.length > 150) history.shift();
    future = [];
    afterChange();
  }
  function finishPen(closed) {
    if (!pen) return;
    const pts = pen.pts;
    pen = null;
    if (pts.length < 2) { render(); return; }
    const o = styled({ id: newId(), kind: 'path', name: 'Path', path: [{ closed: !!closed, pts }] });
    if (!closed) o.fill = { type: 'none' };
    addObjects([o], 'Pen');
  }
  function onWheel(e) {
    if (!doc) return;
    e.preventDefault();
    const p = pointAt(e);
    if (e.ctrlKey || e.metaKey || e.altKey) { zoomTo(view.zoom * Math.exp(-e.deltaY * 0.0015), { x: p.sx, y: p.sy }); return; }
    view.x -= e.shiftKey ? e.deltaY : e.deltaX; view.y -= e.shiftKey ? 0 : e.deltaY; view.fitted = false;
    render();
  }
  function setCursor(p) {
    const s = $('#ink-svg');
    let c = 'default';
    if (spaceHeld || tool === 'hand') c = drag && drag.kind === 'pan' ? 'grabbing' : 'grab';
    else if (tool === 'select' && p) { const h = handleAt(p); c = h ? (h.rotate ? 'alias' : ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'][h.handle % 4]) : 'default'; }
    else if (tool === 'text') c = 'text';
    else if (tool === 'zoom') c = 'zoom-in';
    else if (tool === 'picker') c = 'copy';
    else if (tool !== 'direct') c = 'crosshair';
    s.style.cursor = c;
  }

  // ---------------------------------------------------------------- objects: group, arrange, duplicate, align, combine

  /** A copy of an object with new ids (its children too). */
  function copyObj(o) { const c = clone(o); const re = (x) => { x.id = newId(); (x.children || []).forEach(re); if (x.clip) re(x.clip); }; re(c); return c; }
  function duplicateInPlace() {
    const copies = sel().map(copyObj);
    for (const [i, o] of sel().entries()) { const list = siblings(o.id); list.splice(list.indexOf(o) + 1, 0, copies[i]); }
    selection = copies.map((c) => c.id);
  }
  const duplicate = () => { if (selection.length) change('Duplicate', () => { duplicateInPlace(); for (const o of sel()) o.m = mul([1, 0, 0, 1, 10, 10], matrixOf(o)); }); };
  function deleteSel() {
    if (tool === 'direct' && points.length) { deletePoints(); return; }
    if (!selection.length) return;
    change('Delete', () => { for (const o of sel()) { const list = siblings(o.id); list.splice(list.indexOf(o), 1); } selection = []; });
  }
  function deletePoints() {
    change('Delete points', () => {
      for (const o of sel()) {
        if (o.kind !== 'path') continue;
        const mine = points.filter((p) => p.id === o.id);
        o.path = o.path.map((sub, si) => ({ ...sub, pts: sub.pts.filter((_, i) => !mine.some((p) => p.sub === si && p.i === i)) })).filter((sub) => sub.pts.length > 1);
      }
      for (const o of sel()) if (o.kind === 'path' && !o.path.length) { const list = siblings(o.id); list.splice(list.indexOf(o), 1); }
      selection = selection.filter((id) => find(id)); points = [];
    });
  }
  function group() {
    if (selection.length < 1) return;
    change('Group', () => {
      const items = sel(), first = items[0], list = siblings(first.id), at = list.indexOf(first);
      const g = { id: newId(), kind: 'group', name: 'Group', m: ID.slice(), children: [] };
      // Kept in their stacking order, each moved into the group (their matrices made relative to it: identity here).
      const ordered = [];
      walk((o) => { if (selection.includes(o.id)) ordered.push(o); });
      for (const o of ordered) { const W = worldMatrix(o.id), sib = siblings(o.id); sib.splice(sib.indexOf(o), 1); o.m = W; g.children.push(o); }
      list.splice(Math.min(at, list.length), 0, g);
      selection = [g.id];
    });
  }
  function ungroup() {
    const gs = sel().filter((o) => o.kind === 'group');
    if (!gs.length) return;
    change('Ungroup', () => {
      const out = [];
      for (const g of gs) {
        const list = siblings(g.id), at = list.indexOf(g);
        if (g.clip) { g.children.push(g.clip); delete g.clip; }
        for (const c of g.children) c.m = mul(matrixOf(g), matrixOf(c));
        list.splice(at, 1, ...g.children);
        out.push(...g.children.map((c) => c.id));
      }
      selection = out;
    });
  }
  /** Up (+1) or down (−1) one place among its neighbours; to the front or back (±2). */
  function arrange(dir) {
    if (!selection.length) return;
    change(dir > 0 ? 'Bring forward' : 'Send backward', () => {
      const items = sel();
      if (dir > 0) items.reverse();
      for (const o of items) {
        const list = siblings(o.id), i = list.indexOf(o);
        list.splice(i, 1);
        const j = dir === 2 ? list.length : dir === -2 ? 0 : clamp(i + dir, 0, list.length);
        list.splice(j, 0, o);
      }
    });
  }
  function transformSel(T, label) {
    if (!selection.length) return;
    change(label, () => applyT(origins(), T));
  }
  function flip(axis) { const b = selBounds(); if (!b) return; const cx = b.x + b.w / 2, cy = b.y + b.h / 2; transformSel(axis === 'h' ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy], axis === 'h' ? 'Flip horizontally' : 'Flip vertically'); }
  function turn(deg) { const b = selBounds(); if (!b) return; const cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); transformSel([c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy], 'Rotate'); }
  function nudge(dx, dy) { transformSel([1, 0, 0, 1, dx, dy], 'Nudge'); }
  /** Align: the selection's edges or middles lined up (with one object: to the page). */
  function align(how) {
    const items = sel();
    if (!items.length) return;
    const all = items.length === 1 || alignToPage ? { x: 0, y: 0, w: doc.width, h: doc.height } : selBounds();
    change('Align', () => {
      for (const o of items) {
        const b = boundsOf(o); if (!b) continue;
        let dx = 0, dy = 0;
        if (how === 'left') dx = all.x - b.x; else if (how === 'hcentre') dx = all.x + all.w / 2 - (b.x + b.w / 2); else if (how === 'right') dx = all.x + all.w - (b.x + b.w);
        else if (how === 'top') dy = all.y - b.y; else if (how === 'vcentre') dy = all.y + all.h / 2 - (b.y + b.h / 2); else if (how === 'bottom') dy = all.y + all.h - (b.y + b.h);
        applyT(origins().filter((r) => r.id === o.id), [1, 0, 0, 1, dx, dy]);
      }
    });
  }
  let alignToPage = false;
  /** Distribute: equal gaps between the objects, across or down. */
  function distribute(axis) {
    const items = sel().map((o) => ({ o, b: boundsOf(o) })).filter((x) => x.b);
    if (items.length < 3) { notice('Choose three or more objects to space out.', 1800); return; }
    const k = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h';
    items.sort((a, b) => a.b[k] - b.b[k]);
    const first = items[0].b, last = items[items.length - 1].b, total = items.reduce((s, x) => s + x.b[size], 0), gap = (last[k] + last[size] - first[k] - total) / (items.length - 1);
    change('Distribute', () => {
      let at = first[k] + first[size] + gap;
      for (const x of items.slice(1, -1)) { const d = at - x.b[k]; applyT(origins().filter((r) => r.id === x.o.id), axis === 'h' ? [1, 0, 0, 1, d, 0] : [1, 0, 0, 1, 0, d]); at += x.b[size] + gap; }
    });
  }
  /** An object as a path in document coordinates (null for text and pictures, which have no outline here). */
  function worldPath(o) {
    if (o.kind === 'path') return G().transform(o.path, worldMatrix(o.id));
    if (o.kind === 'group') return o.children.flatMap((c) => worldPath(c) || []);
    return null;
  }
  /** Path › Unite, Subtract (the front ones out of the back one), Intersect, Exclude. */
  function combine(op) {
    const items = [];
    walk((o) => { if (selection.includes(o.id)) items.push(o); });
    const paths = items.map((o) => ({ o, p: worldPath(o) })).filter((x) => x.p && x.p.length);
    if (paths.length < 2) { notice('Choose two or more shapes (paths) to combine.', 2000); return; }
    let result;
    try {
      if (op === 'subtract') { result = paths[0].p; for (const x of paths.slice(1)) result = G().boolean('subtract', result, x.p, paths[0].o.rule || 'nonzero'); }
      else if (op === 'intersect') { result = paths[0].p; for (const x of paths.slice(1)) result = G().boolean('intersect', result, x.p); }
      else if (op === 'exclude') { result = paths[0].p; for (const x of paths.slice(1)) result = G().boolean('exclude', result, x.p); }
      else { result = paths[0].p; for (const x of paths.slice(1)) result = G().boolean('union', result, x.p); }
    } catch (err) { hooks.showError(err); return; }
    const styleFrom = op === 'subtract' ? paths[0].o : paths[paths.length - 1].o;
    change({ union: 'Unite', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' }[op], () => {
      const keep = paths[paths.length - 1].o, list = siblings(keep.id), at = list.indexOf(keep);
      const o = { id: newId(), kind: 'path', name: { union: 'United', subtract: 'Cut out', intersect: 'Overlap', exclude: 'Excluded' }[op], path: result, m: ID.slice(),
        fill: clone(styleFrom.fill), stroke: clone(styleFrom.stroke), opacity: styleFrom.opacity, blend: styleFrom.blend, rule: 'nonzero' };
      // The new path sits where the frontmost was, in its parent's coordinates.
      const P = mul(worldMatrix(keep.id), inv(matrixOf(keep)));
      o.path = G().transform(result, inv(P));
      list.splice(at + 1, 0, o);
      for (const x of paths) { const l2 = siblings(x.o.id); l2.splice(l2.indexOf(x.o), 1); }
      selection = [o.id];
    });
  }
  /** Object › Clip or Mask: the frontmost selected object cuts (or masks) the others, which become one group. */
  function makeClip(kind) {
    const items = [];
    walk((o) => { if (selection.includes(o.id)) items.push(o); });
    if (items.length < 2) { notice(kind === 'mask' ? 'Choose the objects and, on top of them, the mask (light shows, dark hides).' : 'Choose the objects and, on top of them, the shape to clip them with.', 2400); return; }
    change(kind === 'mask' ? 'Mask' : 'Clip', () => {
      const top = items[items.length - 1], rest = items.slice(0, -1), list = siblings(rest[rest.length - 1].id), at = list.indexOf(rest[rest.length - 1]);
      const g = { id: newId(), kind: 'group', name: kind === 'mask' ? 'Masked' : 'Clipped', m: ID.slice(), children: [], clipKind: kind };
      for (const o of rest) { const W = worldMatrix(o.id), sib = siblings(o.id); sib.splice(sib.indexOf(o), 1); o.m = W; g.children.push(o); }
      { const W = worldMatrix(top.id), sib = siblings(top.id); sib.splice(sib.indexOf(top), 1); top.m = W; g.clip = top; }
      list.splice(Math.min(at, list.length), 0, g);
      selection = [g.id];
    });
  }
  function releaseClip() {
    const gs = sel().filter((o) => o.kind === 'group' && o.clip);
    if (!gs.length) return;
    change('Release', () => { for (const g of gs) { g.children.push(g.clip); delete g.clip; delete g.clipKind; g.name = 'Group'; } });
  }
  function reversePaths() { change('Reverse the direction', () => { for (const o of sel()) if (o.kind === 'path') o.path = G().reverse(o.path); }); }
  /** Path › Simplify: fewer points, the same shape (within a pixel or so). */
  function simplify() {
    change('Simplify', () => {
      for (const o of sel()) {
        if (o.kind !== 'path') continue;
        o.path = o.path.map((sub) => {
          const ring = G().flatten([sub], 0.5)[0] || [];
          if (ring.length < 4) return sub;
          const fitted = G().fit(sub.closed ? [...ring, ring[0]] : ring, 1.5);
          return fitted ? { ...fitted, closed: sub.closed } : sub;
        });
      }
    });
  }
  /** Lock and hide: a locked object can't be picked; Object › Unlock all / Show all bring them back. */
  function setFlag(k, v, label) { change(label, () => { for (const o of sel()) o[k] = v; if (k === 'locked' && v) selection = []; if (k === 'visible' && !v) selection = []; }); }
  function clearFlag(k, v, label) { change(label, () => walk((o) => { if (k === 'locked') delete o.locked; else o.visible = v; })); }

  // ---------------------------------------------------------------- the style: fill, stroke, opacity

  function applyStyle(part, label = 'Style') {
    style = { ...style, ...clone(part) };
    if (!selection.length) { renderPanels(); return; }
    change(label, () => {
      const paintIn = (o) => { if (o.kind === 'group') o.children.forEach(paintIn); else if (o.kind !== 'image') { if (part.fill) o.fill = clone(part.fill); if (part.stroke) o.stroke = clone(part.stroke); } };
      for (const o of sel()) { paintIn(o); if (part.opacity !== undefined) o.opacity = part.opacity; if (part.blend) o.blend = part.blend; }
    });
  }
  /** The style panel shows the first selected object's style (or the one new objects get). */
  function shownStyle() {
    const o = sel()[0];
    const leaf = (x) => (x && x.kind === 'group' ? leaf(x.children[0]) : x);
    const l = leaf(o);
    return l && l.kind !== 'image' ? { fill: l.fill || { type: 'none' }, stroke: l.stroke || { colour: null, width: 1 }, opacity: o.opacity ?? 1, blend: o.blend || 'normal' } : style;
  }

  // ---------------------------------------------------------------- text: typed right on the picture

  function startTyping(o, fresh, at) {
    if (typing) finishTyping(true);
    const before = JSON.stringify({ doc, layerId, selection });
    if (!o) {
      o = { id: newId(), kind: 'text', name: 'Text', x: at.x, y: at.y, text: '', font: settings.font, size: Math.max(12, Math.round(24 / view.zoom)), bold: false, italic: false, align: 'left', lineHeight: 1.2,
        fill: style.fill.type === 'none' ? { type: 'solid', colour: '#000000' } : clone(style.fill), stroke: { colour: null, width: 1 }, opacity: 1, blend: 'normal' };
      currentLayer().children.push(o);
      fresh = true;
    }
    selection = [o.id];
    const box = el('textarea', { class: 'ink-typing', id: 'ink-typing', spellcheck: 'true', 'aria-label': 'Type the text', 'data-noi18n': '', wrap: 'off' });
    box.value = o.text || '';
    typing = { o, fresh, before, old: o.text, box };
    o.typing = true;
    box.addEventListener('input', () => { o.text = box.value; placeTyping(); });
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finishTyping(true); } });
    $('#ink-stage').append(box);
    placeTyping(); render();
    setTimeout(() => { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }, 0);
  }
  function placeTyping() {
    if (!typing) return;
    const { o, box } = typing, z = view.zoom * Math.sqrt(Math.abs(matrixOf(o)[0] * matrixOf(o)[3] - matrixOf(o)[1] * matrixOf(o)[2])), [wx, wy] = ap(worldMatrix(o.id), o.x, o.y), s = toScreen(wx, wy), size = (o.size || 32) * z;
    const c = o.fill && o.fill.type === 'solid' ? o.fill.colour : '#000';
    Object.assign(box.style, { left: `${s.x}px`, top: `${s.y - size}px`, font: `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : ''}${size}px ${o.font || 'sans-serif'}`, lineHeight: `${size * (o.lineHeight || 1.2)}px`, color: c, textAlign: o.align || 'left' });
    box.style.width = '10px'; box.style.width = `${Math.max(size, box.scrollWidth + size * 0.4)}px`;
    box.style.height = '10px'; box.style.height = `${Math.max(size * 1.3, box.scrollHeight)}px`;
  }
  function finishTyping(keep) {
    const t = typing;
    if (!t) return;
    typing = null;
    t.box.remove();
    delete t.o.typing;
    const empty = !String(t.o.text || '').trim();
    if (!keep || empty) {
      if (t.fresh) { const list = siblings(t.o.id); if (list) list.splice(list.indexOf(t.o), 1); selection = []; } else t.o.text = t.old;
      afterChange(); return;
    }
    t.o.name = t.o.text.split('\n')[0].slice(0, 40);
    if (t.fresh || t.old !== t.o.text) commit(t.before, t.fresh ? 'Text' : 'Edit text'); else afterChange();
  }

  // ---------------------------------------------------------------- files

  /** A picture from an SVG file: layers (Inkscape's, or one), shapes as paths, text, pictures, groups, gradients. */
  function fromFile(text) {
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml'), root = parsed.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) throw new Error('That isn\'t an SVG picture.');
    // Put into a blank frame (hidden; no scripts run there, and the app's own styles don't reach it) so the browser
    // works out every element's style: classes, style sheets, inheritance.
    const host = el('iframe', { class: 'ink-import-host', 'aria-hidden': 'true', tabindex: '-1', sandbox: 'allow-same-origin' });
    document.body.append(host);
    const fdoc = host.contentDocument, live = fdoc.importNode(root, true);
    for (const n of live.querySelectorAll('script, foreignObject')) n.remove();
    fdoc.body.append(live);
    const getComputedStyle = (e) => fdoc.defaultView.getComputedStyle(e);
    try {
      const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
      const unit = (v) => { const m = /^\s*([\d.eE+-]+)\s*(px|pt|mm|cm|in|pc)?\s*$/.exec(v || ''); if (!m) return null; return num(m[1]) * ({ pt: 4 / 3, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pc: 16 }[m[2]] || 1); };
      const vb = (live.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number).filter(Number.isFinite);
      const W = vb.length === 4 ? vb[2] : unit(live.getAttribute('width')) || 800, H = vb.length === 4 ? vb[3] : unit(live.getAttribute('height')) || 600;
      const rootM = vb.length === 4 ? [1, 0, 0, 1, -vb[0], -vb[1]] : ID.slice();
      const d = { width: Math.max(1, Math.round(W * 1000) / 1000), height: Math.max(1, Math.round(H * 1000) / 1000), background: null, layers: [] };
      const hex = (c) => { if (!c || c === 'none' || c === 'transparent') return null; const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return c; const [r, g, b, a] = m[1].split(',').map((s) => parseFloat(s)); if (a === 0) return null; return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); };
      const paintOf = (val, opacity) => {
        if (!val || val === 'none') return { type: 'none' };
        const ref = /url\(["']?#([^"')]+)/.exec(val);
        if (ref) {
          const g = live.querySelector(`[id="${CSS.escape(ref[1])}"]`);
          if (g && /gradient$/i.test(g.nodeName)) {
            let src = g, guard = 0;
            while (!src.querySelector('stop') && src.getAttribute('href') && guard++ < 8) src = live.querySelector(`[id="${CSS.escape((src.getAttribute('href') || '').slice(1))}"]`) || src;
            const stops = [...src.querySelectorAll('stop')].map((s) => { const cs = getComputedStyle(s); return [num(s.getAttribute('offset'), 0) * (String(s.getAttribute('offset')).includes('%') ? 0.01 : 1), hex(cs.stopColor) || '#000000']; });
            const x1 = num(g.getAttribute('x1'), 0), y1 = num(g.getAttribute('y1'), 0), x2 = num(g.getAttribute('x2'), 1), y2 = num(g.getAttribute('y2'), 0);
            return { type: g.nodeName.toLowerCase().startsWith('radial') ? 'radial' : 'linear', stops: stops.length ? stops : [[0, '#000000'], [1, '#ffffff']], angle: Math.round(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI), ...(opacity < 1 ? { opacity } : {}) };
          }
          return { type: 'none' };
        }
        const c = hex(val);
        return c ? { type: 'solid', colour: c, ...(opacity < 1 ? { opacity } : {}) } : { type: 'none' };
      };
      const common = (e) => {
        const cs = getComputedStyle(e), m = e.transform && e.transform.baseVal && e.transform.baseVal.numberOfItems ? e.transform.baseVal.consolidate().matrix : null;
        const o = { id: newId(), name: e.getAttribute('data-name') || e.getAttribute('inkscape:label') || e.getAttribute('id') || '', m: m ? [m.a, m.b, m.c, m.d, m.e, m.f] : ID.slice() };
        const op = num(e.getAttribute('opacity'), 1); if (op < 1) o.opacity = op;
        if (e.getAttribute('display') === 'none' || (e.getAttribute('style') || '').includes('display:none')) o.visible = false;
        return { o, cs };
      };
      const shapeStyle = (o, cs) => {
        o.fill = paintOf(cs.fill, num(cs.fillOpacity, 1));
        const sw = num(cs.strokeWidth, 1);
        o.stroke = cs.stroke && cs.stroke !== 'none' ? { colour: hex(cs.stroke) || '#000000', width: sw, dash: cs.strokeDasharray && cs.strokeDasharray !== 'none' ? 'dashed' : 'solid', cap: cs.strokeLinecap || 'butt', join: cs.strokeLinejoin || 'miter', ...(num(cs.strokeOpacity, 1) < 1 ? { opacity: num(cs.strokeOpacity, 1) } : {}) } : { colour: null, width: sw };
        if (cs.fillRule === 'evenodd') o.rule = 'evenodd';
        if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') o.blend = cs.mixBlendMode;
        return o;
      };
      const pointsPath = (s, closed) => { const n = (s || '').trim().split(/[\s,]+/).map(Number); const pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1], ix: n[i], iy: n[i + 1], ox: n[i], oy: n[i + 1] }); return pts.length > 1 ? [{ closed, pts }] : []; };
      let conv = (e) => {
        const tag = e.nodeName.toLowerCase().replace(/^svg:/, '');
        if (['defs', 'title', 'desc', 'metadata', 'style', 'script', 'clippath', 'mask', 'symbol', 'lineargradient', 'radialgradient', 'pattern', 'filter', 'marker'].includes(tag) || tag.includes(':')) return null;
        if (e.getAttribute('data-noorink-background')) { d.background = hex(e.getAttribute('fill')) || '#ffffff'; return null; }
        const { o, cs } = common(e), A = (k) => num(e.getAttribute(k));
        if (tag === 'g' || tag === 'a' || tag === 'switch') { o.kind = 'group'; o.name = o.name || 'Group'; o.children = [...e.children].map(conv).filter(Boolean); return o.children.length ? o : null; }
        if (tag === 'use') { const t = live.querySelector(`[id="${CSS.escape((e.getAttribute('href') || e.getAttribute('xlink:href') || '').slice(1))}"]`); if (!t || t === e) return null; const inner = conv(t); if (!inner) return null; o.kind = 'group'; o.name = o.name || 'Copy'; o.m = mul(o.m, [1, 0, 0, 1, A('x'), A('y')]); o.children = [inner]; return o; }
        if (tag === 'text') {
          const lines = e.querySelectorAll('tspan').length ? [...e.querySelectorAll('tspan')].map((t) => t.textContent) : [e.textContent];
          const first = e.querySelector('tspan') || e;
          Object.assign(o, { kind: 'text', x: num(first.getAttribute('x'), A('x')), y: num(first.getAttribute('y'), A('y')), text: lines.join('\n'), font: (cs.fontFamily || 'sans-serif').replace(/["']/g, ''), size: num(cs.fontSize, 16), bold: num(cs.fontWeight, 400) >= 600 || cs.fontWeight === 'bold', italic: cs.fontStyle === 'italic', align: cs.textAnchor === 'middle' ? 'center' : cs.textAnchor === 'end' ? 'right' : 'left', lineHeight: 1.2 });
          o.name = o.name || o.text.split('\n')[0].slice(0, 40);
          return shapeStyle(o, cs);
        }
        if (tag === 'image') { const href = e.getAttribute('href') || e.getAttribute('xlink:href') || ''; if (!href.startsWith('data:image/')) return null; Object.assign(o, { kind: 'image', x: A('x'), y: A('y'), w: A('width'), h: A('height'), href, name: o.name || 'Picture' }); return o; }
        let path = null;
        if (tag === 'path') path = G().parse(e.getAttribute('d') || '');
        else if (tag === 'rect') { const rx = num(e.getAttribute('rx'), num(e.getAttribute('ry'), 0)); path = G().rect(A('x'), A('y'), A('width'), A('height'), rx); }
        else if (tag === 'circle') path = G().ellipse(A('cx'), A('cy'), A('r'), A('r'));
        else if (tag === 'ellipse') path = G().ellipse(A('cx'), A('cy'), A('rx'), A('ry'));
        else if (tag === 'line') path = G().line(A('x1'), A('y1'), A('x2'), A('y2'));
        else if (tag === 'polyline' || tag === 'polygon') path = pointsPath(e.getAttribute('points'), tag === 'polygon');
        else return null;
        if (!path || !path.length) return null;
        Object.assign(o, { kind: 'path', path, name: o.name || { path: 'Path', rect: 'Rectangle', circle: 'Ellipse', ellipse: 'Ellipse', line: 'Line', polyline: 'Line', polygon: 'Polygon' }[tag] });
        return shapeStyle(o, cs);
      };
      // A clip-path or mask on an element: it goes into a group that carries it (in the element's coordinates).
      const conv0 = conv;
      conv = (e) => {
        const o = conv0(e);
        if (!o || !e.getAttribute) return o;
        for (const [attr, kind] of [['clip-path', 'clip'], ['mask', 'mask']]) {
          const ref = /url\(["']?#([^"')]+)/.exec(e.getAttribute(attr) || (e.getAttribute('style') || '').match(new RegExp(`${attr}\\s*:\\s*([^;]+)`))?.[1] || '');
          const holder = ref && live.querySelector(`[id="${CSS.escape(ref[1])}"]`);
          if (!holder || o.clip) continue;
          const parts = [...holder.children].map(conv0).filter(Boolean);
          if (!parts.length) continue;
          const shape = parts.length === 1 ? parts[0] : { id: newId(), kind: 'group', name: 'Group', m: ID.slice(), children: parts };
          // (The clip is in the element's own coordinates, after its transform: a group's children's.)
          if (o.kind === 'group') return { ...o, clip: shape, clipKind: kind };
          return { id: newId(), kind: 'group', name: kind === 'mask' ? 'Masked' : 'Clipped', m: o.m, children: [{ ...o, m: ID.slice() }], clip: shape, clipKind: kind };
        }
        return o;
      };
      let loose = null;
      for (const e of [...live.children]) {
        const isLayer = e.nodeName.toLowerCase() === 'g' && (e.getAttribute('inkscape:groupmode') === 'layer');
        if (isLayer) {
          const g = conv(e) || { children: [] };
          const l = { id: newId(), kind: 'layer', name: e.getAttribute('inkscape:label') || e.getAttribute('data-name') || `Layer ${d.layers.length + 1}`, visible: g.visible !== false, locked: e.getAttribute('sodipodi:insensitive') === 'true', children: g.children || [] };
          for (const c of l.children) c.m = mul(rootM, mul(g.m || ID, matrixOf(c)));
          d.layers.push(l); loose = null;
        } else {
          const o = conv(e);
          if (!o) continue;
          o.m = mul(rootM, matrixOf(o));
          if (!loose) { loose = { id: newId(), kind: 'layer', name: `Layer ${d.layers.length + 1}`, visible: true, locked: false, children: [] }; d.layers.push(loose); }
          loose.children.push(o);
        }
      }
      if (!d.layers.length) d.layers.push({ id: newId(), kind: 'layer', name: 'Layer 1', visible: true, locked: false, children: [] });
      return d;
    } finally { host.remove(); }
  }
  function setDoc(d, f) {
    finishPen(false); finishTyping(true);
    doc = d; file = f; history = []; future = []; stamp = 0; savedAt = 0; selection = []; points = [];
    layerId = doc.layers[doc.layers.length - 1].id;
    requestAnimationFrame(fit);
    afterChange();
  }
  async function opened(r) {
    if (!r || r.cancelled) return;
    try { setDoc(fromFile(r.svg), { path: r.path, name: r.name }); } catch (err) { hooks.showError(err); return; }
    if (r.notes && r.notes.length) notice(r.notes.join(' '), 4000);
    loadRecent();
  }
  async function confirmLeave() { return !dirty() || NoorUI.confirm('Open another picture?', 'The picture open now has changes not saved.', 'Open'); }
  async function openFile() { if (!await confirmLeave()) return; try { await opened(await req('ink.open')); } catch (err) { hooks.showError(err); } }
  async function openRecent(path) { if (!await confirmLeave()) return; try { await opened(await req('ink.openRecent', { path })); } catch (err) { hooks.showError(err); } }
  async function newDialog() {
    if (!await confirmLeave()) return;
    NoorUI.modal({ label: 'New picture', width: 380 }, (s, closeIt) => {
      const w = el('input', { type: 'number', id: 'ink-new-w', min: '1', max: '20000', value: String(settings.width), 'aria-label': 'Width' });
      const h = el('input', { type: 'number', id: 'ink-new-h', min: '1', max: '20000', value: String(settings.height), 'aria-label': 'Height' });
      const preset = el('select', { 'aria-label': 'Size' }, el('option', { value: '', text: 'Sizes…' }), ...[['Icon 512', 512, 512], ['Square 1080', 1080, 1080], ['Full HD', 1920, 1080], ['A4 (at 96 dpi)', 794, 1123], ['Letter (at 96 dpi)', 816, 1056], ['Poster 18×24 in', 1728, 2304], ['Business card', 336, 192]].map(([n, a, b]) => el('option', { value: `${a}x${b}`, text: `${n} (${a} × ${b})` })));
      preset.addEventListener('change', () => { const [a, b] = preset.value.split('x'); if (b) { w.value = a; h.value = b; } });
      const back = el('select', { 'aria-label': 'Background' }, el('option', { value: 'white', text: 'white' }), el('option', { value: 'none', text: 'see-through' }));
      back.value = settings.background;
      s.append(NoorUI.head('New picture', closeIt), el('div', { class: 'modal-body ink-dlg' }, preset, el('div', { class: 'ink-row' }, el('label', {}, 'Width ', w), el('label', {}, 'Height ', h)), el('label', {}, 'Background ', back)),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ink-new-ok', onclick: () => {
          const W = clamp(Number(w.value) || 800, 1, 20000), H = clamp(Number(h.value) || 600, 1, 20000);
          settings.width = W; settings.height = H; settings.background = back.value; saveSettings();
          const d = blank(W, H); if (back.value === 'none') d.background = null;
          setDoc(d, null); closeIt();
        } }, 'Create'))));
    });
  }
  async function save(as) {
    if (!doc) return;
    finishTyping(true); finishPen(false);
    try {
      const r = await req('ink.save', { svg: toFile(), path: !as && file ? file.path : '', name: file ? file.name : 'drawing' });
      if (!r || r.cancelled) return;
      file = { path: r.path, name: r.name }; savedAt = stamp;
      notice(`Saved ${r.name}`, 1400); renderTitle(); loadRecent();
      req('ink.draft.clear').catch(() => {});
    } catch (err) { hooks.showError(err); }
  }
  /** The picture as a PNG (at a scale; see-through or on its background). */
  async function rasterize(scale, transparent) {
    const d = transparent ? { ...doc, background: null } : doc;
    const url = URL.createObjectURL(new Blob([toFile(d)], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The picture couldn\'t be drawn.')); img.src = url; });
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(doc.width * scale)); c.height = Math.max(1, Math.round(doc.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { data: btoa(s), width: c.width, height: c.height, size: blob.size };
    } finally { URL.revokeObjectURL(url); }
  }
  function exportDialog() {
    NoorUI.modal({ label: 'Export', width: 380 }, (s, closeIt) => {
      const fmtSel = el('select', { id: 'ink-exp-format', 'aria-label': 'Format' }, el('option', { value: 'png', text: 'PNG (a picture of it)' }), el('option', { value: 'svg', text: 'SVG (as a separate copy)' }));
      const sc = el('input', { type: 'number', id: 'ink-exp-scale', min: '10', max: '1600', value: '100', 'aria-label': 'Size (%)' });
      const tr = el('input', { type: 'checkbox', id: 'ink-exp-clear' });
      const info = el('p', { class: 'pref-hint' });
      const upd = () => { const k = clamp(Number(sc.value) || 100, 10, 1600) / 100; info.textContent = fmtSel.value === 'png' ? `${Math.round(doc.width * k)} × ${Math.round(doc.height * k)} pixels` : 'The vector picture, as it is.'; sc.parentElement.hidden = tr.parentElement.hidden = fmtSel.value !== 'png'; };
      for (const i of [fmtSel, sc]) i.addEventListener('input', upd);
      const go = async () => {
        closeIt();
        try {
          if (fmtSel.value === 'svg') { const r = await req('ink.save', { svg: toFile(), path: '', name: (file ? file.name : 'drawing').replace(/\.svg$/i, '') + ' copy' }); if (r && !r.cancelled) notice(`Exported ${r.name}`, 1400); return; }
          const r = await rasterize(clamp(Number(sc.value) || 100, 10, 1600) / 100, tr.checked);
          const res = await req('ink.export', { data: r.data, format: 'png', name: (file ? file.name : 'drawing').replace(/\.svg$/i, '') });
          if (res && !res.cancelled) notice(`Exported ${res.name}`, 1400);
        } catch (err) { hooks.showError(err); }
      };
      s.append(NoorUI.head('Export', closeIt), el('div', { class: 'modal-body ink-dlg' }, el('label', {}, 'Format ', fmtSel), el('label', {}, 'Size ', sc, ' %'), el('label', {}, tr, ' see-through background'), info),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ink-exp-ok', onclick: go }, 'Export…'))));
      upd();
    });
  }
  /** File › To NoorPhoto: the picture opens there as a new picture (pixels). */
  async function toPhoto() {
    try {
      const r = await rasterize(1, !doc.background);
      if (window.NoorPhoto && NoorPhoto.openPng) { await NoorPhoto.openPng((file ? file.name : 'drawing').replace(/\.svg$/i, ''), r.data); }
    } catch (err) { hooks.showError(err); }
  }
  /** File › Place a picture: a picture (PNG, JPEG…) inside the drawing. */
  async function placePicture() {
    try {
      const r = await req('ink.place');
      if (!r || r.cancelled) return;
      const k = Math.min(1, doc.width * 0.8 / r.width, doc.height * 0.8 / r.height), w = r.width * k, h = r.height * k;
      addObjects([{ id: newId(), kind: 'image', name: r.name || 'Picture', x: (doc.width - w) / 2, y: (doc.height - h) / 2, w, h, href: `data:${r.mime};base64,${r.data}`, m: ID.slice() }], 'Place a picture');
    } catch (err) { hooks.showError(err); }
  }
  // Copy and paste: the objects (here) and as SVG text (for other programs); pasting SVG text from elsewhere brings it in.
  async function copy(cut) {
    if (!selection.length) return;
    clip = sel().map(copyObj);
    const d = { width: doc.width, height: doc.height, background: null, layers: [{ id: 'c', kind: 'layer', name: 'Copied', visible: true, locked: false, children: sel().map((o) => ({ ...clone(o), m: worldMatrix(o.id) })) }] };
    try { await navigator.clipboard.writeText(toFile(d)); } catch { /* ours is kept either way */ }
    if (cut) deleteSel();
  }
  async function paste(inPlace) {
    try {
      const t = await navigator.clipboard.readText();
      if (t && /<svg[\s>]/i.test(t) && (!clip || !t.includes('data-noorink'))) {
        const d = fromFile(t), items = d.layers.flatMap((l) => l.children);
        if (items.length) { addObjects(items, 'Paste'); return; }
      }
    } catch { /* no clipboard access: ours */ }
    if (!clip) return;
    const copies = clip.map(copyObj);
    if (!inPlace) for (const o of copies) o.m = mul([1, 0, 0, 1, 10, 10], matrixOf(o));
    clip = copies.map(copyObj);
    addObjects(copies, 'Paste');
  }

  let recentFiles = [];
  async function loadRecent() { try { const r = await req('ink.recent'); recentFiles = (r && r.files) || []; } catch { recentFiles = []; } }
  let draftTimer = 0, draftOffered = false;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { if (doc && dirty()) req('ink.draft.save', { svg: toFile(), name: file ? file.name : 'Untitled', path: file ? file.path : '' }).catch(() => {}); }, 60000);
  }
  async function offerDraft() {
    if (draftOffered) return;
    draftOffered = true;
    try {
      const r = await req('ink.draft.load');
      if (!r || r.none || !r.svg) return;
      const v = await NoorUI.choose('Bring back the unsaved drawing?', [`NoorInk kept “${r.name || 'Untitled'}” before it closed without saving.`], [{ label: 'Throw it away', value: 'drop' }, { label: 'Not now', value: 'later' }, { label: 'Bring it back', value: 'open', primary: true }]);
      if (v === 'open') { setDoc(fromFile(r.svg), r.path ? { path: r.path, name: r.name } : null); savedAt = -1; renderTitle(); }
      if (v === 'drop') await req('ink.draft.clear');
    } catch (err) { console.warn('NoorInk: draft', err); }
  }

  // ---------------------------------------------------------------- the panels

  const SETTINGS_KEY = 'noorink.settings';
  const DEFAULTS = { width: 800, height: 600, background: 'white', font: 'sans-serif' };
  let settings = { ...DEFAULTS };
  try { settings = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}) }; } catch { /* the defaults */ }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* for now only */ } }

  function renderPanels() {
    if (!built || !doc) return;
    renderTools(); renderOptions(); renderStyle(); renderTransform(); renderLayers(); renderHistory();
  }
  function renderTools() {
    $('#ink-tools').replaceChildren(...TOOLS.map(([id, glyph, title]) => el('button', { class: 'ph-tool' + (tool === id ? ' on' : ''), 'data-tool': id, title, 'aria-label': title.replace(/\s*[(:].*$/, ''), 'aria-pressed': tool === id ? 'true' : 'false', onclick: () => setTool(id) }, glyph)));
  }
  function setTool(id) {
    if (tool === 'pen' && id !== 'pen') finishPen(false);
    if (typing && id !== 'text') finishTyping(true);
    if (id !== 'direct') points = [];
    tool = id;
    renderPanels(); setCursor(); render();
  }
  const num = (id, value, min, max, step, onchange, label) => { const i = el('input', { type: 'number', class: 'ph-num', id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label }); i.addEventListener('change', () => onchange(clamp(Number(i.value) || 0, min, max))); return i; };
  /** The bar over the picture: the tool's settings. */
  function renderOptions() {
    const box = $('#ink-options'), items = [];
    const name = (TOOLS.find((t) => t[0] === tool) || [])[2] || '';
    items.push(el('strong', { class: 'ph-optname', text: name.replace(/\s*[(:].*$/, '') }));
    if (tool === 'rect') items.push(el('label', {}, 'Rounded corners ', num('ink-opt-radius', opts.radius, 0, 100, 5, (v) => { opts.radius = v; }, 'Rounded corners (%)'), '%'));
    if (tool === 'polygon') items.push(el('label', {}, 'Sides ', num('ink-opt-sides', opts.sides, 3, 64, 1, (v) => { opts.sides = v; }, 'Sides')));
    if (tool === 'star') items.push(el('label', {}, 'Points ', num('ink-opt-points', opts.starPoints, 3, 64, 1, (v) => { opts.starPoints = v; }, 'Points')), el('label', {}, 'Inner ', num('ink-opt-inner', Math.round(opts.inner * 100), 5, 95, 5, (v) => { opts.inner = v / 100; }, 'Inner size (%)'), '%'));
    if (tool === 'pencil') items.push(el('label', {}, 'Smoothing ', num('ink-opt-smooth', opts.fitError, 0.5, 20, 0.5, (v) => { opts.fitError = v; }, 'Smoothing')));
    if (tool === 'pen') items.push(el('span', { class: 'ph-hint', text: 'Enter or a double-click: finish (open); Esc: cancel' }));
    if (tool === 'direct') items.push(el('span', { class: 'ph-hint', text: 'Shift+click: more points; Del: delete them' }));
    if (tool === 'text') {
      const sel1 = sel()[0], t = sel1 && sel1.kind === 'text' ? sel1 : null;
      const font = el('input', { type: 'text', id: 'ink-opt-font', value: t ? t.font : settings.font, 'aria-label': 'Font', list: 'ink-fonts', 'data-noi18n': '' });
      font.addEventListener('change', () => { const v = font.value.trim() || 'sans-serif'; settings.font = v; saveSettings(); if (t) textProp(t, 'font', v); });
      const size = num('ink-opt-size', t ? t.size : 32, 1, 2000, 1, (v) => { if (t) textProp(t, 'size', v); }, 'Size');
      const b = el('button', { class: 'utility-btn' + (t && t.bold ? ' on' : ''), title: 'Bold', 'aria-label': 'Bold', onclick: () => t && textProp(t, 'bold', !t.bold) }, 'B');
      const it = el('button', { class: 'utility-btn' + (t && t.italic ? ' on' : ''), title: 'Italic', 'aria-label': 'Italic', onclick: () => t && textProp(t, 'italic', !t.italic) }, 'I');
      const al = el('select', { id: 'ink-opt-align', 'aria-label': 'Alignment' }, ...[['left', 'left'], ['center', 'centre'], ['right', 'right']].map(([v, x]) => el('option', { value: v, text: x })));
      al.value = t ? t.align || 'left' : 'left'; al.addEventListener('change', () => t && textProp(t, 'align', al.value));
      items.push(el('label', {}, 'Font ', font), el('label', {}, 'Size ', size), b, it, al, el('datalist', { id: 'ink-fonts' }, ...['sans-serif', 'serif', 'monospace', 'Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Consolas', 'Verdana', 'Trebuchet MS', 'Impact'].map((f) => el('option', { value: f }))));
    }
    items.push(el('label', { class: 'ph-check', title: 'Points snap to a grid' }, el('input', { type: 'checkbox', id: 'ink-opt-snap', checked: opts.snapGrid, onchange: (e) => { opts.snapGrid = e.target.checked; render(); } }), ' snap to the grid'));
    box.replaceChildren(...items);
  }
  function textProp(t, k, v) {
    if (typing && typing.o === t) { t[k] = v; placeTyping(); render(); return; }
    change('Text style', () => { t[k] = v; });
  }
  /** Fill and stroke: the paint (none, a colour, a gradient), the outline's colour, width and dashes; opacity and blending. */
  function renderStyle() {
    const s = shownStyle(), box = $('#ink-style');
    const f = s.fill || { type: 'none' }, st = s.stroke || { colour: null, width: 1 };
    const colourIn = (id, value, label, on) => { const i = el('input', { type: 'color', id, value: value || '#000000', 'aria-label': label }); i.addEventListener('change', () => on(i.value)); return i; };
    const fillType = el('select', { id: 'ink-fill-type', 'aria-label': 'Fill' }, ...[['none', 'none'], ['solid', 'colour'], ['linear', 'linear gradient'], ['radial', 'radial gradient']].map(([v, t]) => el('option', { value: v, text: t })));
    fillType.value = f.type || 'none';
    fillType.addEventListener('change', () => {
      const t = fillType.value, c = f.colour || (f.stops && f.stops[0][1]) || '#4c8bf5';
      applyStyle({ fill: t === 'none' ? { type: 'none' } : t === 'solid' ? { type: 'solid', colour: c } : { type: t, stops: f.stops || [[0, c], [1, '#ffffff']], angle: f.angle || 0 } }, 'Fill');
    });
    const rows = [el('div', { class: 'ink-row' }, el('label', {}, 'Fill ', fillType))];
    if (f.type === 'solid') rows.push(el('div', { class: 'ink-row' }, colourIn('ink-fill', f.colour, 'Fill colour', (c) => applyStyle({ fill: { ...f, colour: c } }, 'Fill colour'))));
    if (f.type === 'linear' || f.type === 'radial') {
      const stops = f.stops || [[0, '#000000'], [1, '#ffffff']];
      rows.push(el('div', { class: 'ink-row' }, colourIn('ink-grad-a', stops[0][1], 'From', (c) => applyStyle({ fill: { ...f, stops: [[0, c], ...stops.slice(1)] } }, 'Gradient')), '→',
        colourIn('ink-grad-b', stops[stops.length - 1][1], 'To', (c) => applyStyle({ fill: { ...f, stops: [...stops.slice(0, -1), [1, c]] } }, 'Gradient')),
        f.type === 'linear' ? el('label', {}, ' angle ', num('ink-grad-angle', f.angle || 0, -360, 360, 15, (v) => applyStyle({ fill: { ...f, angle: v } }, 'Gradient'), 'Angle'), '°') : null));
    }
    const hasStroke = !!st.colour;
    rows.push(el('div', { class: 'ink-row' }, el('label', { class: 'ph-check' }, el('input', { type: 'checkbox', id: 'ink-stroke-on', checked: hasStroke, onchange: (e) => applyStyle({ stroke: { ...st, colour: e.target.checked ? st.lastColour || '#000000' : null, lastColour: st.colour || st.lastColour } }, 'Stroke') }), ' Stroke '),
      hasStroke ? colourIn('ink-stroke', st.colour, 'Stroke colour', (c) => applyStyle({ stroke: { ...st, colour: c } }, 'Stroke colour')) : null,
      hasStroke ? el('label', {}, ' width ', num('ink-stroke-w', st.width ?? 1, 0, 500, 0.5, (v) => applyStyle({ stroke: { ...st, width: v } }, 'Stroke width'), 'Stroke width')) : null));
    if (hasStroke) {
      const dash = el('select', { id: 'ink-stroke-dash', 'aria-label': 'Dashes' }, ...[['solid', 'solid'], ['dashed', 'dashed'], ['dotted', 'dotted']].map(([v, t]) => el('option', { value: v, text: t })));
      dash.value = st.dash || 'solid'; dash.addEventListener('change', () => applyStyle({ stroke: { ...st, dash: dash.value } }, 'Dashes'));
      const cap = el('select', { id: 'ink-stroke-cap', 'aria-label': 'Ends' }, ...[['butt', 'flat ends'], ['round', 'round ends'], ['square', 'square ends']].map(([v, t]) => el('option', { value: v, text: t })));
      cap.value = st.cap || 'butt'; cap.addEventListener('change', () => applyStyle({ stroke: { ...st, cap: cap.value, join: cap.value === 'round' ? 'round' : 'miter' } }, 'Ends'));
      rows.push(el('div', { class: 'ink-row' }, dash, cap));
    }
    const blend = el('select', { id: 'ink-blend', 'aria-label': 'Blend mode' }, ...BLENDS.map((b) => el('option', { value: b, text: b.replace('-', ' ') })));
    blend.value = s.blend || 'normal'; blend.addEventListener('change', () => applyStyle({ blend: blend.value }, 'Blend mode'));
    rows.push(el('div', { class: 'ink-row' }, el('label', {}, 'Opacity ', num('ink-opacity', Math.round((s.opacity ?? 1) * 100), 0, 100, 5, (v) => applyStyle({ opacity: v / 100 }, 'Opacity'), 'Opacity (%)'), '%'), blend));
    box.replaceChildren(...rows);
  }
  /** Where the selection is and how big (document pixels); typing a number moves or scales it. */
  function renderTransform() {
    const box = $('#ink-xform'), b = selBounds();
    if (!b) { box.replaceChildren(el('p', { class: 'ph-propline', text: selection.length ? '' : `Nothing selected · the page is ${fmt(doc.width)} × ${fmt(doc.height)}` })); return; }
    const r = (v) => Math.round(v * 100) / 100;
    const set = (k) => (v) => {
      if (k === 'x') nudge(v - b.x, 0); else if (k === 'y') nudge(0, v - b.y);
      else { const sx = k === 'w' ? Math.max(0.01, v) / (b.w || 1) : 1, sy = k === 'h' ? Math.max(0.01, v) / (b.h || 1) : 1; transformSel([sx, 0, 0, sy, b.x - sx * b.x, b.y - sy * b.y], 'Scale'); }
    };
    box.replaceChildren(
      el('div', { class: 'ink-row' }, el('label', {}, 'X ', num('ink-x', r(b.x), -100000, 100000, 1, set('x'), 'X')), el('label', {}, 'Y ', num('ink-y', r(b.y), -100000, 100000, 1, set('y'), 'Y'))),
      el('div', { class: 'ink-row' }, el('label', {}, 'W ', num('ink-w', r(b.w), 0, 100000, 1, set('w'), 'Width')), el('label', {}, 'H ', num('ink-h', r(b.h), 0, 100000, 1, set('h'), 'Height'))),
      el('div', { class: 'ink-row ink-btns' },
        ...[['⇤', 'Align left', 'left'], ['⇹', 'Centre across', 'hcentre'], ['⇥', 'Align right', 'right'], ['⤒', 'Align top', 'top'], ['⇕', 'Centre down', 'vcentre'], ['⤓', 'Align bottom', 'bottom']].map(([g, t, h]) => el('button', { class: 'utility-btn', title: t, 'aria-label': t, 'data-align': h, onclick: () => align(h) }, g)),
        el('button', { class: 'utility-btn', title: 'Space out across (3 or more)', 'aria-label': 'Distribute across', onclick: () => distribute('h') }, '⋯'),
        el('button', { class: 'utility-btn', title: 'Space out down (3 or more)', 'aria-label': 'Distribute down', onclick: () => distribute('v') }, '⋮')),
      el('label', { class: 'ph-check' }, el('input', { type: 'checkbox', id: 'ink-align-page', checked: alignToPage, onchange: (e) => { alignToPage = e.target.checked; } }), ' align to the page'),
      el('div', { class: 'ink-row ink-btns' },
        el('button', { class: 'utility-btn', title: 'Flip horizontally (Shift+H)', 'aria-label': 'Flip horizontally', onclick: () => flip('h') }, '⇋'),
        el('button', { class: 'utility-btn', title: 'Flip vertically (Shift+V)', 'aria-label': 'Flip vertically', onclick: () => flip('v') }, '⇵'),
        el('button', { class: 'utility-btn', title: 'Turn 90° anticlockwise', 'aria-label': 'Turn left', onclick: () => turn(-90) }, '⟲'),
        el('button', { class: 'utility-btn', title: 'Turn 90° clockwise', 'aria-label': 'Turn right', onclick: () => turn(90) }, '⟳'),
        el('button', { class: 'utility-btn', id: 'ink-unite', title: 'Unite (Ctrl++)', 'aria-label': 'Unite', onclick: () => combine('union') }, '∪'),
        el('button', { class: 'utility-btn', id: 'ink-subtract', title: 'Subtract: the front ones cut out of the back one (Ctrl+-)', 'aria-label': 'Subtract', onclick: () => combine('subtract') }, '∖'),
        el('button', { class: 'utility-btn', id: 'ink-intersect', title: 'Intersect: only where they overlap (Ctrl+*)', 'aria-label': 'Intersect', onclick: () => combine('intersect') }, '∩'),
        el('button', { class: 'utility-btn', id: 'ink-exclude', title: 'Exclude: where they don\'t overlap (Ctrl+^)', 'aria-label': 'Exclude', onclick: () => combine('exclude') }, '⊻')));
  }
  /** Layers and what is in them (top first). Click: select; 👁 and 🔒; double-click: rename. */
  function renderLayers() {
    const list = $('#ink-layers'), items = [];
    const glyph = { path: '〰', text: 'T', image: '🖼', group: '📁' };
    const row = (o, depth, layer) => {
      const isLayer = o.kind === 'layer', on = isLayer ? o.id === layerId : selection.includes(o.id);
      const li = el('li', { class: 'ink-layer' + (isLayer ? ' is-layer' : '') + (on ? ' on' : '') + (o.visible === false ? ' hidden' : ''), 'data-id': o.id, role: 'option', 'aria-selected': on ? 'true' : 'false', style: `padding-left:${4 + depth * 14}px` },
        el('button', { class: 'ph-eye', title: o.visible === false ? 'Show' : 'Hide', 'aria-label': o.visible === false ? 'Show' : 'Hide', onclick: (e) => { e.stopPropagation(); change(o.visible === false ? 'Show' : 'Hide', () => { o.visible = o.visible === false; }); } }, o.visible === false ? '◌' : '👁'),
        el('button', { class: 'ph-eye', title: o.locked ? 'Unlock' : 'Lock', 'aria-label': o.locked ? 'Unlock' : 'Lock', onclick: (e) => { e.stopPropagation(); change(o.locked ? 'Unlock' : 'Lock', () => { o.locked = !o.locked; if (o.locked) selection = selection.filter((id) => !(o.id === id || (o.children && JSON.stringify(o.children).includes(`"${id}"`)))); }); } }, o.locked ? '🔒' : '·'),
        el('span', { class: 'ink-layer-glyph', text: isLayer ? '▤' : glyph[o.kind] || '?' }),
        el('span', { class: 'ink-layer-name', 'data-noi18n': '', text: o.name || (isLayer ? 'Layer' : o.kind) }));
      li.addEventListener('click', (e) => {
        if (isLayer) { layerId = o.id; selection = []; } else if (!layer.locked && !o.locked) { selection = e.shiftKey ? (selection.includes(o.id) ? selection.filter((x) => x !== o.id) : [...selection, o.id]) : [o.id]; layerId = layer.id; }
        renderPanels(); render();
      });
      li.addEventListener('dblclick', () => rename(o));
      items.push(li);
      if (o.children && (isLayer || o.open)) for (const c of [...o.children].reverse()) row(c, depth + 1, layer);
    };
    for (const l of [...doc.layers].reverse()) row(l, 0, l);
    list.replaceChildren(...items);
  }
  async function rename(o) {
    const v = await NoorUI.prompt('Rename', 'Name', o.name || '');
    if (v !== null && v !== undefined && v.trim() && v.trim() !== o.name) change('Rename', () => { o.name = v.trim(); });
  }
  function newLayer() { change('New layer', () => { const l = { id: newId(), kind: 'layer', name: `Layer ${doc.layers.length + 1}`, visible: true, locked: false, children: [] }; const at = doc.layers.indexOf(currentLayer()); doc.layers.splice(at + 1, 0, l); layerId = l.id; selection = []; }); }
  function deleteLayer() {
    if (doc.layers.length < 2) { notice('A picture keeps at least one layer.', 1600); return; }
    change('Delete the layer', () => { const at = doc.layers.indexOf(currentLayer()); doc.layers.splice(at, 1); layerId = doc.layers[Math.max(0, at - 1)].id; selection = []; });
  }
  function moveLayer(dir) { change(dir > 0 ? 'Layer up' : 'Layer down', () => { const l = currentLayer(), i = doc.layers.indexOf(l), j = clamp(i + dir, 0, doc.layers.length - 1); doc.layers.splice(i, 1); doc.layers.splice(j, 0, l); }); }
  /** Selected objects to another layer (the one above or below). */
  function toLayer(dir) {
    if (!selection.length) return;
    const i = doc.layers.indexOf(currentLayer()), target = doc.layers[i + dir];
    if (!target) return;
    change(dir > 0 ? 'To the layer above' : 'To the layer below', () => { for (const o of sel()) { const W = worldMatrix(o.id), list = siblings(o.id); list.splice(list.indexOf(o), 1); o.m = W; target.children.push(o); } layerId = target.id; });
  }
  function renderHistory() {
    const list = $('#ink-history');
    list.replaceChildren(el('li', { class: history.length ? '' : 'on', text: 'Opened' }), ...history.map((h, i) => el('li', { class: i === history.length - 1 ? 'on' : '', text: h.label })), ...[...future].reverse().map((f) => el('li', { class: 'future', text: f.label })));
    $('#ink-undo').disabled = !history.length; $('#ink-redo').disabled = !future.length;
  }
  function renderTitle() {
    if (!built) return;
    $('#ink-file').textContent = doc ? `${file ? file.name : 'Untitled'}${dirty() ? ' •' : ''} · ${fmt(doc.width)} × ${fmt(doc.height)}` : '';
    if (window.NoorChrome && NoorChrome.benchChanged) NoorChrome.benchChanged();
  }
  const appTitle = () => `NoorInk — ${doc ? `${file ? file.name : 'Untitled'}${dirty() ? ' •' : ''}` : ''}`;
  function status() {
    const s = $('#ink-status');
    if (!s || !doc) return;
    const n = selection.length, parts = [`${Math.round(view.zoom * 100)}%`];
    if (hover) parts.push(`${Math.round(hover.x)}, ${Math.round(hover.y)}`);
    if (n === 1) { const o = sel()[0]; parts.push(o ? `${o.name || o.kind}` : ''); } else if (n) parts.push(`${n} objects`);
    if (tool === 'direct' && points.length) parts.push(`${points.length} points`);
    s.textContent = parts.filter(Boolean).join(' · ');
  }

  /** Document › Page size: the page bigger or smaller (objects stay where they are), or fitted to the drawing. */
  function pageDialog() {
    NoorUI.modal({ label: 'Page size', width: 360 }, (s, closeIt) => {
      const w = el('input', { type: 'number', id: 'ink-page-w', min: '1', max: '20000', value: String(doc.width), 'aria-label': 'Width' });
      const h = el('input', { type: 'number', id: 'ink-page-h', min: '1', max: '20000', value: String(doc.height), 'aria-label': 'Height' });
      const back = el('select', { id: 'ink-page-back', 'aria-label': 'Background' }, el('option', { value: 'white', text: 'white' }), el('option', { value: 'none', text: 'see-through' }), el('option', { value: 'colour', text: 'a colour' }));
      const col = el('input', { type: 'color', id: 'ink-page-colour', value: doc.background && doc.background !== '#ffffff' ? doc.background : '#ffffff', 'aria-label': 'Background colour' });
      back.value = !doc.background ? 'none' : doc.background === '#ffffff' ? 'white' : 'colour';
      s.append(NoorUI.head('Page size', closeIt), el('div', { class: 'modal-body ink-dlg' }, el('div', { class: 'ink-row' }, el('label', {}, 'Width ', w), el('label', {}, 'Height ', h)), el('div', { class: 'ink-row' }, el('label', {}, 'Background ', back), col),
        el('button', { class: 'action', onclick: () => { const b = allBounds(); if (b) { w.value = String(Math.ceil(b.w)); h.value = String(Math.ceil(b.h)); w.dataset.fit = '1'; } } }, 'Fit to the drawing')),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'ink-page-ok', onclick: () => {
          const W = clamp(Number(w.value) || doc.width, 1, 20000), H = clamp(Number(h.value) || doc.height, 1, 20000), fitIt = w.dataset.fit === '1', b = fitIt ? allBounds() : null;
          change('Page size', () => {
            doc.width = W; doc.height = H; doc.background = back.value === 'none' ? null : back.value === 'white' ? '#ffffff' : col.value;
            if (b) for (const l of doc.layers) for (const o of l.children) o.m = mul([1, 0, 0, 1, -b.x, -b.y], matrixOf(o));
          });
          closeIt(); requestAnimationFrame(fit);
        } }, 'OK'))));
    });
  }
  function allBounds() { let r = null; walk((o, p) => { if (p && p.kind === 'layer') { const b = boundsOf(o); if (b) r = r ? unite(r, b) : b; } }); return r; }
  function selectAll() {
    if (tool === 'direct' && selection.length) { points = []; for (const o of sel()) if (o.kind === 'path') o.path.forEach((sub, si) => sub.pts.forEach((_, i) => points.push({ id: o.id, sub: si, i }))); render(); return; }
    const l = currentLayer();
    if (l.locked) return;
    selection = l.children.filter((o) => !o.locked && o.visible !== false).map((o) => o.id);
    renderPanels(); render();
  }
  /** Object › Convert to path: text stays text here (browsers can't give its outline), so this is for shapes in groups. */
  function zoomStep(dir) { zoomTo(view.zoom * (dir > 0 ? 1.25 : 0.8)); }

  // ---------------------------------------------------------------- building the bench

  function build() {
    built = true;
    const btn = (id, glyph, title, onclick) => el('button', { class: 'icon-btn', id, title, 'aria-label': title.replace(/\s*\(.*$/, ''), onclick }, glyph);
    const root = el('section', { id: 'inkbench', class: 'photobench inkbench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'NoorInk' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '✒️' }), el('strong', { text: 'NoorInk' }), el('small', { id: 'ink-file' })),
        el('span', { class: 'panel-head-buttons' },
          btn('ink-new', '🆕', 'New drawing (Ctrl+N here)', newDialog), btn('ink-open', '📂', 'Open an SVG (Ctrl+O here)', openFile),
          btn('ink-save', '💾', 'Save as SVG (Ctrl+S here; Ctrl+Shift+S: save as)', () => save(false)), btn('ink-export', '⤓', 'Export: PNG or an SVG copy', exportDialog),
          btn('ink-undo', '↶', 'Undo (Ctrl+Z)', undo), btn('ink-redo', '↷', 'Redo (Ctrl+Y)', redo),
          NoorDock.fullButton('NoorInk'),
          el('button', { class: 'icon-btn', title: 'Where this panel goes', 'aria-label': 'Move NoorInk', onclick: (e) => NoorDock.showMenu('ink', e.currentTarget) }, '⊞'),
          btn('ink-close', '✕', 'Close NoorInk (Ctrl+Alt+U)', close))),
      el('div', { class: 'ph-menubar', id: 'ink-menubar', role: 'menubar', 'aria-label': 'NoorInk menu' }),
      el('div', { class: 'ph-main' },
        el('div', { class: 'ph-left' }, el('div', { class: 'ph-tools', id: 'ink-tools', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' })),
        el('div', { class: 'ph-centre' },
          el('div', { class: 'ph-options', id: 'ink-options' }),
          el('div', { class: 'ph-stage ink-stage', id: 'ink-stage', tabindex: '-1' }, svgEl('svg', { id: 'ink-svg', class: 'ink-svg', role: 'img', 'aria-label': 'The drawing' })),
          el('div', { class: 'ph-status', id: 'ink-status', 'aria-live': 'polite' })),
        el('div', { class: 'ph-right' },
          el('details', { class: 'ph-panel', open: true }, el('summary', { text: 'Fill and stroke' }), el('div', { class: 'ph-props', id: 'ink-style' })),
          el('details', { class: 'ph-panel', open: true }, el('summary', { text: 'Arrange' }), el('div', { class: 'ph-props', id: 'ink-xform' })),
          el('details', { class: 'ph-panel', open: true }, el('summary', { text: 'Layers' }),
            el('ul', { class: 'ph-layers ink-layers', id: 'ink-layers', role: 'listbox', 'aria-label': 'Layers and objects (top first)' }),
            el('div', { class: 'ph-layerbtns' },
              btn('ink-layer-new', '＋', 'New layer', newLayer), btn('ink-layer-up', '▲', 'Layer up', () => moveLayer(1)), btn('ink-layer-down', '▼', 'Layer down', () => moveLayer(-1)),
              btn('ink-group', '📁', 'Group (Ctrl+G)', group), btn('ink-layer-del', '🗑', 'Delete the layer', deleteLayer))),
          el('details', { class: 'ph-panel' }, el('summary', { text: 'History' }), el('ol', { class: 'ph-history', id: 'ink-history', 'aria-label': 'History' })))));
    ($('#app') || document.body).append(root);
    if (window.NoorChrome && NoorChrome.registerBench) NoorChrome.registerBench('ink', { name: 'NoorInk', title: appTitle, menus: appMenus });
    root.addEventListener('keydown', onKey);
    document.addEventListener('keydown', (e) => {
      if (!isOpen() || NoorUI.hasOpenModal() || e.defaultPrevented || (document.activeElement && document.activeElement !== document.body) || !root.offsetParent) return;
      root.focus({ preventScroll: true });
      onKey(e);
    });
    document.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceHeld = false; setCursor(); } }, true);
    window.addEventListener('blur', () => { spaceHeld = false; });
    const sv = $('#ink-svg');
    sv.addEventListener('pointerdown', (e) => { if (!NoorUI.hasOpenModal()) onDown(e); });
    sv.addEventListener('pointermove', onMove);
    sv.addEventListener('pointerup', onUp);
    sv.addEventListener('pointercancel', onUp);
    sv.addEventListener('dblclick', (e) => {
      if (tool === 'pen' && pen) { pen.pts.pop(); finishPen(false); return; }
      if (tool === 'hand') { fit(); return; }
      const o = hit(e, true);
      if (o && o.kind === 'text' && (tool === 'select' || tool === 'direct')) { startTyping(o, false); return; }
      if (o && tool === 'select' && o.kind === 'path') { selection = [o.id]; setTool('direct'); }
    });
    sv.addEventListener('pointerleave', () => { hover = null; status(); });
    sv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!NoorUI.hasOpenModal()) { const o = hit(e, false); if (o && !selection.includes(o.id)) { selection = [o.id]; renderPanels(); render(); } NoorChrome.openMenu({ getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) }, objectItems()); } });
    sv.addEventListener('wheel', onWheel, { passive: false });
    new ResizeObserver(() => { if (view.fitted) fit(); else render(); }).observe($('#ink-stage'));
    renderMenubar();
  }
  function renderMenubar() {
    $('#ink-menubar').replaceChildren(...appMenus().map(([name, , items]) => el('button', { class: 'ph-menu-title', role: 'menuitem', onclick: (e) => NoorChrome.openMenu(e.currentTarget, items()) }, name)));
  }
  const keepFocus = () => { if (isOpen() && !NoorUI.hasOpenModal() && !typing && (!document.activeElement || document.activeElement === document.body)) $('#inkbench').focus({ preventScroll: true }); };

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('ink');
    document.body.classList.add('ink-open');
    $('#inkbench').hidden = false;
    if (!doc) { doc = blank(settings.width, settings.height); if (settings.background === 'none') doc.background = null; savedAt = 0; requestAnimationFrame(fit); }
    afterChange();
    $('#inkbench').focus({ preventScroll: true });
    loadRecent();
    offerDraft();
  }
  async function close() {
    if (!built || !isOpen()) return;
    finishPen(false); finishTyping(true); drag = null;
    document.body.classList.remove('ink-open');
    $('#inkbench').hidden = true;
    if (window.NoorDock) NoorDock.closed('ink');
  }
  const toggle = () => (isOpen() ? close() : open());

  function objectItems() {
    const go = (label, run, keys, more = {}) => ({ label, keys, run: () => { run(); setTimeout(keepFocus, 0); }, ...more });
    const none = () => !selection.length;
    return [
      go('Group', group, 'Ctrl+G', { disabled: none }), go('Ungroup', ungroup, 'Ctrl+Shift+G', { disabled: () => !sel().some((o) => o.kind === 'group') }), '-',
      go('Bring to front', () => arrange(2), 'Ctrl+Shift+]', { disabled: none }), go('Bring forward', () => arrange(1), 'Ctrl+]', { disabled: none }),
      go('Send backward', () => arrange(-1), 'Ctrl+[', { disabled: none }), go('Send to back', () => arrange(-2), 'Ctrl+Shift+[', { disabled: none }), '-',
      go('Flip horizontally', () => flip('h'), 'Shift+H', { disabled: none }), go('Flip vertically', () => flip('v'), 'Shift+V', { disabled: none }),
      go('Turn 90° clockwise', () => turn(90), '', { disabled: none }), go('Turn 90° anticlockwise', () => turn(-90), '', { disabled: none }), '-',
      go('Duplicate', duplicate, 'Ctrl+D', { disabled: none }), go('Delete', deleteSel, 'Del', { disabled: none }), '-',
      go('Clip (the top one clips the others)', () => makeClip('clip'), '', { disabled: () => selection.length < 2 }), go('Mask (the top one masks the others)', () => makeClip('mask'), '', { disabled: () => selection.length < 2 }),
      go('Release the clip or mask', releaseClip, '', { disabled: () => !sel().some((o) => o.kind === 'group' && o.clip) }), '-',
      go('Lock', () => setFlag('locked', true, 'Lock'), '', { disabled: none }), go('Unlock all', () => clearFlag('locked', false, 'Unlock all')),
      go('Hide', () => setFlag('visible', false, 'Hide'), '', { disabled: none }), go('Show all', () => clearFlag('visible', true, 'Show all')), '-',
      go('To the layer above', () => toLayer(1), 'Shift+PgUp', { disabled: none }), go('To the layer below', () => toLayer(-1), 'Shift+PgDn', { disabled: none }),
    ];
  }
  function appMenus() {
    const go = (label, run, keys, more = {}) => ({ label, keys, run: () => { run(); setTimeout(keepFocus, 0); }, ...more });
    const none = () => !selection.length;
    return [
      ['File', 'f', () => [
        go('New…', newDialog, 'Ctrl+N'), go('Open…', openFile, 'Ctrl+O'),
        { label: 'Open recent', sub: () => (recentFiles.length ? recentFiles.map((r) => go(r.name, () => openRecent(r.path), '', { title: r.path })) : [{ label: 'Nothing opened yet', disabled: true }]) },
        go('Place a picture…', placePicture), '-',
        go('Save', () => save(false), 'Ctrl+S'), go('Save as…', () => save(true), 'Ctrl+Shift+S'), go('Export (PNG or an SVG copy)…', exportDialog, 'Ctrl+Shift+E'), '-',
        go('To NoorPhoto (as pixels)', toPhoto), '-',
        { id: 'view.focus', label: 'Back to NoorMD (leave focus mode)' }, go('Close NoorInk', close),
      ]],
      ['Edit', 'e', () => [
        go('Undo', undo, 'Ctrl+Z', { disabled: () => !history.length }), go('Redo', redo, 'Ctrl+Y', { disabled: () => !future.length }), '-',
        go('Cut', () => copy(true), 'Ctrl+X', { disabled: none }), go('Copy', () => copy(false), 'Ctrl+C', { disabled: none }), go('Paste', () => paste(false), 'Ctrl+V'), go('Paste in place', () => paste(true), 'Ctrl+Shift+V'),
        go('Duplicate', duplicate, 'Ctrl+D', { disabled: none }), go('Delete', deleteSel, 'Del', { disabled: none }), '-',
        go('Select all', selectAll, 'Ctrl+A'), go('Select none', () => { selection = []; points = []; renderPanels(); render(); }, 'Esc'),
      ]],
      ['Object', 'o', objectItems],
      ['Path', 'p', () => [
        go('Unite', () => combine('union'), 'Ctrl++', { disabled: () => selection.length < 2 }), go('Subtract', () => combine('subtract'), 'Ctrl+-', { disabled: () => selection.length < 2 }),
        go('Intersect', () => combine('intersect'), 'Ctrl+*', { disabled: () => selection.length < 2 }), go('Exclude', () => combine('exclude'), 'Ctrl+^', { disabled: () => selection.length < 2 }), '-',
        go('Reverse the direction', reversePaths, '', { disabled: none }), go('Simplify', simplify, 'Ctrl+L', { disabled: none }),
      ]],
      ['Document', 'd', () => [
        go('Page size and background…', pageDialog), go('New layer', newLayer), go('Delete the layer', deleteLayer), go('Rename the layer…', () => rename(currentLayer())),
      ]],
      ['View', 'v', () => [
        go('Zoom in', () => zoomStep(1), 'Ctrl+='), go('Zoom out', () => zoomStep(-1), 'Ctrl+-'), go('Fit the page', fit, 'Ctrl+0'), go('Actual size', () => zoomTo(1), 'Ctrl+1'), '-',
        go(opts.snapGrid ? 'Snap to the grid ✓' : 'Snap to the grid', () => { opts.snapGrid = !opts.snapGrid; renderOptions(); render(); }, "Ctrl+'"),
      ]],
    ];
  }

  function onKey(e) {
    if (!doc || NoorUI.hasOpenModal() || typing) return;
    if (e.target && e.target.closest && e.target.closest('input, select, textarea, [contenteditable]')) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.getModifierState && e.getModifierState('AltGraph')) return;
    if (k === ' ' && !ctrl) { handled(); if (!spaceHeld) { spaceHeld = true; setCursor(); } return; }
    if (k === 'Enter' && pen) { handled(); finishPen(false); return; }
    if (k === 'Escape') { if (pen) { handled(); pen = null; render(); return; } if (selection.length || points.length) { handled(); if (points.length) points = []; else selection = []; renderPanels(); render(); } return; }
    if (ctrl && e.altKey) return;
    if (ctrl) {
      const map = e.shiftKey ? {
        s: () => save(true), z: redo, g: ungroup, v: () => paste(true), e: exportDialog, ']': () => arrange(2), '}': () => arrange(2), '[': () => arrange(-2), '{': () => arrange(-2), '+': () => combine('union'), '*': () => combine('intersect'), '^': () => combine('exclude'), '&': () => combine('exclude'),
      } : {
        n: newDialog, o: openFile, s: () => save(false), z: undo, y: redo, a: selectAll, c: () => copy(false), x: () => copy(true), v: () => paste(false), d: duplicate, g: group, l: simplify,
        0: fit, 1: () => zoomTo(1), '=': () => zoomStep(1), '-': () => (selection.length > 1 ? combine('subtract') : zoomStep(-1)), '+': () => (selection.length > 1 ? combine('union') : zoomStep(1)), ']': () => arrange(1), '[': () => arrange(-1),
        '*': () => combine('intersect'), "'": () => { opts.snapGrid = !opts.snapGrid; renderOptions(); render(); },
      };
      const f = map[k];
      if (f) { handled(); f(); }
      return;
    }
    if (k === 'Delete' || k === 'Backspace') { handled(); deleteSel(); return; }
    if (k.startsWith('Arrow') && selection.length) {
      handled(); const s = e.shiftKey ? 10 : 1, dx = k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, dy = k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0;
      if (tool === 'direct' && points.length) { change('Move points', () => { for (const pt of points) { const o = obj(pt.id), q = o && o.path[pt.sub] && o.path[pt.sub].pts[pt.i]; if (!q) continue; const im = inv(worldMatrix(o.id)), [ax, ay] = ap(im, 0, 0), [bx, by] = ap(im, dx, dy), ddx = bx - ax, ddy = by - ay; for (const c of ['', 'i', 'o']) { q[c + 'x'] += ddx; q[c + 'y'] += ddy; } } }); } else nudge(dx, dy);
      return;
    }
    if (e.shiftKey && k === 'PageUp') { handled(); toLayer(1); return; }
    if (e.shiftKey && k === 'PageDown') { handled(); toLayer(-1); return; }
    if (e.shiftKey && k === 'h') { handled(); flip('h'); return; }
    if (e.shiftKey && k === 'v') { handled(); flip('v'); return; }
    const t = TOOLS.find((x) => x[3] === k);
    if (t && !e.shiftKey && !e.altKey) { handled(); setTool(t[0]); }
  }

  // ---------------------------------------------------------------- start

  function init(h) { hooks = { ...hooks, ...h }; }

  return {
    init, open, close, toggle, isOpen,
    _state: () => doc && ({
      width: doc.width, height: doc.height, background: doc.background, file, dirty: dirty(), tool, selection: selection.slice(), points: points.slice(), layer: layerId,
      layers: clone(doc.layers), history: history.map((h) => h.label), future: future.length, view: { ...view }, style: clone(style), opts: { ...opts },
      bounds: selBounds(),
    }),
    /** For tests: where a document point is on the screen. */
    _screen: (x, y) => { const r = $('#ink-svg').getBoundingClientRect(), p = toScreen(x, y); return { x: r.left + p.x, y: r.top + p.y }; },
    _new: (w, h, back = 'white') => { const d = blank(w, h); if (back === 'none') d.background = null; setDoc(d, null); },
    _load: (svg, name) => setDoc(fromFile(svg), name ? { path: '', name } : null),
    _svg: () => toFile(),
    _select: (ids) => { selection = ids.slice(); renderPanels(); render(); },
    _bounds: (id) => { const o = obj(id); return o ? boundsOf(o) : null; },
    _raster: async (scale = 1) => rasterize(scale, false),
  };
})();
