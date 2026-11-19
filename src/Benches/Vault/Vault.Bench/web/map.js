// The vault's map: notes as dots, links as lines, laid out by a small force simulation (dots push apart, links pull
// together). Drawn on a canvas: wheel to zoom, drag the background to pan, drag a dot to move it, click to open.
// Written for NoorMD (no graph library).

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** A colour per top folder, from the theme's accent turned around the colour wheel. */
function folderColours(folders) {
  const map = new Map();
  folders.forEach((f, i) => map.set(f, `hsl(${Math.round((i * 137.5 + 260) % 360)} 62% 62%)`));
  return map;
}

export function createMap(canvas, { onOpen, onHover } = {}) {
  const ctx2d = canvas.getContext('2d');
  let nodes = [], edges = [], byPath = new Map(), neighbours = new Map();
  let view = { x: 0, y: 0, k: 1 }, center = null, highlight = '', hover = null, drag = null, running = 0, alpha = 0, showMissing = true;
  let colours = new Map(), sized = false, fitted = false;
  /** Frames every note on the map. */
  function fitAll() {
    const r = canvas.getBoundingClientRect(), list = nodes.filter((n) => showMissing || !n.missing);
    if (!r.width || !list.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r + 16); }
    const k = Math.max(0.15, Math.min(1.6, Math.min((r.width - 60) / Math.max(1, x1 - x0), (r.height - 60) / Math.max(1, y1 - y0))));
    view = { k, x: r.width / 2 - ((x0 + x1) / 2) * k, y: r.height / 2 - ((y0 + y1) / 2) * k };
    sized = true;
    draw();
  }

  function setData(graph, { centerPath = null, keepPositions = true } = {}) {
    const old = byPath;
    center = centerPath;
    nodes = graph.nodes.map((n) => {
      const prev = keepPositions && old.get(n.path);
      const angle = Math.random() * Math.PI * 2, r = 40 + Math.random() * 160;
      return { ...n, x: prev ? prev.x : Math.cos(angle) * r, y: prev ? prev.y : Math.sin(angle) * r, vx: 0, vy: 0, r: 4 + Math.sqrt(n.links) * 2.2 };
    });
    byPath = new Map(nodes.map((n) => [n.path, n]));
    if (center && byPath.get(center)) { const c = byPath.get(center); c.x = 0; c.y = 0; c.r += 3; }
    edges = graph.edges.map(([a, b]) => [byPath.get(a), byPath.get(b)]).filter(([a, b]) => a && b);
    neighbours = new Map(nodes.map((n) => [n, new Set()]));
    for (const [a, b] of edges) { neighbours.get(a).add(b); neighbours.get(b).add(a); }
    colours = folderColours([...new Set(nodes.filter((n) => !n.missing).map((n) => n.folder))].sort());
    if (!sized) fit();
    if (!keepPositions || !old.size) fitted = false;
    heat(1);
  }

  // ---------------------------------------------------------------- the simulation
  function heat(a) { alpha = Math.max(alpha, a); if (!running) running = requestAnimationFrame(tick); }
  function step() {
    const list = nodes.filter((n) => showMissing || !n.missing);
    const n = list.length;
    // Repulsion: every pair when small; a sample of others when big (the map stays responsive).
    const sample = n > 700 ? 700 / n : 1;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      for (let j = i + 1; j < n; j++) {
        if (sample < 1 && Math.random() > sample) continue;
        const b = list[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.25; }
        if (d2 > 250000) continue;
        const f = (900 / d2) * alpha / sample;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const [a, b] of edges) {
      if (!showMissing && (a.missing || b.missing)) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 70) * 0.04 * alpha;
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    for (const nd of list) {
      const g = nd.links ? 0.004 : 0.02;   // a gentle pull to the middle (stronger for notes with no links, so they stay in view)
      nd.vx -= nd.x * g * alpha; nd.vy -= nd.y * g * alpha;
      if (drag && drag.node === nd) { nd.vx = nd.vy = 0; continue; }
      if (center && nd.path === center) { nd.x *= 0.8; nd.y *= 0.8; nd.vx = nd.vy = 0; continue; }
      nd.vx *= 0.6; nd.vy *= 0.6;
      nd.x += Math.max(-30, Math.min(30, nd.vx)); nd.y += Math.max(-30, Math.min(30, nd.vy));
    }
    alpha *= 0.985;
    if (!fitted && alpha < 0.08) { fitted = true; fitAll(); }
  }
  function tick() {
    running = 0;
    const steps = nodes.length > 400 ? 1 : 3;
    for (let i = 0; i < steps; i++) step();
    draw();
    if (alpha > 0.02 || drag) running = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- drawing
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return false;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    return true;
  }
  function fit() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    sized = true;
    view = { x: r.width / 2, y: r.height / 2, k: nodes.length > 150 ? 0.6 : 1 };
  }
  const toScreen = (n) => [n.x * view.k + view.x, n.y * view.k + view.y];
  const visible = (n) => showMissing || !n.missing;
  function draw() {
    if (!resize()) return;
    const dpr = window.devicePixelRatio || 1, w = canvas.width / dpr, h = canvas.height / dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);
    const text = css('--text', '#ddd'), muted = css('--muted', '#888'), accent = css('--accent', '#b19aff'), border = css('--border', '#333');
    const focus = hover || (center && byPath.get(center)) || null;
    const near = focus ? neighbours.get(focus) : null;
    const q = highlight.toLowerCase();
    const matches = (n) => q && (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || (n.tags || []).some((t) => ('#' + t).toLowerCase().includes(q)));
    ctx2d.lineWidth = 1;
    for (const [a, b] of edges) {
      if (!visible(a) || !visible(b)) continue;
      const lit = focus && (a === focus || b === focus);
      ctx2d.strokeStyle = lit ? accent : border;
      ctx2d.globalAlpha = lit ? 0.9 : (focus ? 0.35 : 0.7);
      const [ax, ay] = toScreen(a), [bx, by] = toScreen(b);
      ctx2d.beginPath(); ctx2d.moveTo(ax, ay); ctx2d.lineTo(bx, by); ctx2d.stroke();
    }
    ctx2d.globalAlpha = 1;
    const labelAll = view.k > 1.3 || nodes.length < 40;
    for (const n of nodes) {
      if (!visible(n)) continue;
      const [x, y] = toScreen(n);
      if (x < -50 || y < -50 || x > w + 50 || y > h + 50) continue;
      const dim = (focus && n !== focus && !near.has(n)) || (q && !matches(n));
      ctx2d.globalAlpha = dim ? 0.25 : 1;
      const r = n.r * Math.max(0.6, Math.min(1.6, view.k));
      ctx2d.beginPath(); ctx2d.arc(x, y, r, 0, Math.PI * 2);
      if (n.missing) { ctx2d.strokeStyle = muted; ctx2d.setLineDash([2, 2]); ctx2d.stroke(); ctx2d.setLineDash([]); }
      else { ctx2d.fillStyle = n === focus || matches(n) ? accent : colours.get(n.folder) || muted; ctx2d.fill(); }
      if (labelAll || n === focus || (near && near.has(n)) || matches(n) || n.links >= 6) {
        ctx2d.fillStyle = n.missing ? muted : text;
        ctx2d.font = `${n === focus ? 600 : 400} 12px ${css('--font-ui', 'sans-serif')}`;
        ctx2d.textAlign = 'center';
        ctx2d.fillText(n.name, x, y + r + 13);
      }
    }
    ctx2d.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- pointer
  function nodeAt(px, py) {
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      if (!visible(n)) continue;
      const [x, y] = toScreen(n), d = Math.hypot(x - px, y - py), r = n.r * Math.max(0.6, Math.min(1.6, view.k)) + 4;
      if (d < r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = local(e), n = nodeAt(x, y);
    canvas.setPointerCapture(e.pointerId);
    drag = { node: n, sx: x, sy: y, vx: view.x, vy: view.y, moved: false };
    heat(0.3);
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (drag) {
      if (Math.hypot(x - drag.sx, y - drag.sy) > 4) drag.moved = true;
      if (drag.node) { drag.node.x = (x - view.x) / view.k; drag.node.y = (y - view.y) / view.k; heat(0.3); }
      else { view.x = drag.vx + x - drag.sx; view.y = drag.vy + y - drag.sy; draw(); }
      return;
    }
    const n = nodeAt(x, y);
    if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; canvas.title = n ? (n.missing ? `${n.name} (not made yet)` : n.path) : ''; if (onHover) onHover(n); draw(); }
  });
  canvas.addEventListener('pointerup', () => {
    if (drag && !drag.moved && drag.node && onOpen) onOpen(drag.node);
    drag = null;
  });
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; draw(); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e), k = Math.max(0.15, Math.min(4, view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    view.x = x - (x - view.x) * (k / view.k); view.y = y - (y - view.y) * (k / view.k); view.k = k;
    draw();
  }, { passive: false });
  const ro = new ResizeObserver(() => { if (!sized) fit(); draw(); });
  ro.observe(canvas);

  return {
    setData,
    setHighlight(q) { highlight = q || ''; draw(); },
    setShowMissing(v) { showMissing = !!v; heat(0.5); },
    fit() { fitAll(); },
    redraw: draw,
    destroy() { ro.disconnect(); if (running) cancelAnimationFrame(running); running = 0; },
    _nodes: () => nodes,
  };
}
