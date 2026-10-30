// NoorPhoto layer styles: drop shadow, outer glow, inner shadow, inner glow, bevel and emboss, satin-free overlays
// (colour, gradient) and stroke, live on any layer (text too). They are drawn from the layer's own shape (its alpha,
// mask applied): shadows and glows are blurred copies of it, the stroke and the bevel come from an exact distance
// map of its edge. Nothing here changes the layer; the result is drawn in its place.
window.NoorPhotoStyle = (() => {
  'use strict';

  const EFFECTS = [
    { id: 'shadow', name: 'Drop shadow', defaults: { on: true, colour: '#000000', opacity: 0.6, angle: 120, distance: 8, size: 12, spread: 0, blend: 'multiply' } },
    { id: 'outerGlow', name: 'Outer glow', defaults: { on: true, colour: '#ffffbe', opacity: 0.75, size: 16, spread: 0, blend: 'screen' } },
    { id: 'innerShadow', name: 'Inner shadow', defaults: { on: true, colour: '#000000', opacity: 0.6, angle: 120, distance: 5, size: 8, choke: 0, blend: 'multiply' } },
    { id: 'innerGlow', name: 'Inner glow', defaults: { on: true, colour: '#ffffbe', opacity: 0.75, size: 10, choke: 0, source: 'edge', blend: 'screen' } },
    { id: 'bevel', name: 'Bevel and emboss', defaults: { on: true, style: 'inner', depth: 100, size: 8, soften: 1, angle: 120, altitude: 35, highlight: '#ffffff', highlightOpacity: 0.75, shadow: '#000000', shadowOpacity: 0.6, direction: 'up' } },
    { id: 'colourOverlay', name: 'Colour overlay', defaults: { on: true, colour: '#e04040', opacity: 1, blend: 'normal' } },
    { id: 'gradientOverlay', name: 'Gradient overlay', defaults: { on: true, from: '#000000', to: '#ffffff', angle: 90, opacity: 1, blend: 'normal', shape: 'linear', reverse: false } },
    { id: 'stroke', name: 'Stroke', defaults: { on: true, colour: '#000000', size: 3, position: 'outside', opacity: 1, blend: 'normal' } },
  ];
  // The order they are drawn in, bottom first (the layer's own pixels go in after the glows).
  const BELOW = ['shadow', 'outerGlow'], ABOVE = ['innerShadow', 'innerGlow', 'bevel', 'stroke'];
  const NATIVE = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'linear-dodge']);
  const gco = (b) => (b === 'normal' || !NATIVE.has(b) ? 'source-over' : b === 'linear-dodge' ? 'lighter' : b);

  const defaults = (id) => JSON.parse(JSON.stringify((EFFECTS.find((e) => e.id === id) || { defaults: {} }).defaults));
  const on = (styles, id) => !!(styles && styles[id] && styles[id].on);
  const any = (styles) => !!styles && EFFECTS.some((e) => on(styles, e.id));
  /** How far past the layer's pixels the effects reach (pixels). */
  function margin(s) {
    let m = 0;
    if (on(s, 'shadow')) m = Math.max(m, s.shadow.distance + s.shadow.size * 1.6 + 2);
    if (on(s, 'outerGlow')) m = Math.max(m, s.outerGlow.size * 1.6 + 2);
    if (on(s, 'stroke') && s.stroke.position !== 'inside') m = Math.max(m, s.stroke.size + 2);
    if (on(s, 'bevel') && s.bevel.style !== 'inner') m = Math.max(m, s.bevel.size + 2);
    return Math.ceil(m);
  }

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
  const g2 = (c) => c.getContext('2d');
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /** Exact Euclidean distance (Felzenszwalb and Huttenlocher) from every pixel to the nearest pixel where `isFeature`. */
  function distance(alpha, w, h, isFeature) {
    const INF = 1e20, n = w * h, f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h)), v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
    const grid = new Float64Array(n);
    for (let i = 0; i < n; i++) grid[i] = isFeature(alpha[i]) ? 0 : INF;
    const pass = (len, get, set) => {
      for (let q = 0; q < len; q++) f[q] = get(q);
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s;
        do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k]) k--; else break; } while (k >= 0);
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
      for (let q = 0; q < len; q++) set(q, d[q]);
    };
    for (let x = 0; x < w; x++) pass(h, (y) => grid[y * w + x], (y, val) => { grid[y * w + x] = val; });
    for (let y = 0; y < h; y++) pass(w, (x) => grid[y * w + x], (x, val) => { grid[y * w + x] = val; });
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.sqrt(grid[i]);
    return out;
  }

  /** A canvas whose alpha is given (0…1 per pixel) and whose colour is `hex`. */
  function alphaCanvas(a, w, h, hex) {
    const c = canvas(w, h), x = g2(c), img = x.createImageData(w, h), d = img.data;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    for (let i = 0; i < w * h; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = Math.round(clamp01(a[i]) * 255); }
    x.putImageData(img, 0, 0);
    return c;
  }
  function blurred(src, px) {
    if (!(px > 0)) return src;
    const c = canvas(src.width, src.height), x = g2(c);
    x.filter = `blur(${px}px)`; x.drawImage(src, 0, 0); x.filter = 'none';
    return c;
  }
  function draw(dst, src, opacity, blend, dx = 0, dy = 0) {
    const x = g2(dst);
    x.save(); x.globalAlpha = opacity; x.globalCompositeOperation = gco(blend); x.drawImage(src, dx, dy); x.restore();
  }
  const clipTo = (c, shape, invert) => { const x = g2(c); x.save(); x.globalCompositeOperation = invert ? 'destination-out' : 'destination-in'; x.drawImage(shape, 0, 0); x.restore(); return c; };

  /**
   * The layer's picture with its styles: content is { canvas, x, y } in document pixels; returns { canvas, x, y }
   * covering the picture and what its effects reach (limited to the document's rectangle).
   */
  function render(content, styles, fillOpacity, docW, docH) {
    const m = margin(styles), cw = content.canvas.width, ch = content.canvas.height;
    const x0 = Math.max(0, Math.floor(content.x - m)), y0 = Math.max(0, Math.floor(content.y - m));
    const x1 = Math.min(docW, Math.ceil(content.x + cw + m)), y1 = Math.min(docH, Math.ceil(content.y + ch + m));
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const shape = canvas(w, h);
    g2(shape).drawImage(content.canvas, content.x - x0, content.y - y0);
    const px = g2(shape).getImageData(0, 0, w, h).data, n = w * h, alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) alpha[i] = px[i * 4 + 3] / 255;
    let dOut = null, dIn = null;
    const outside = () => dOut || (dOut = distance(alpha, w, h, (a) => a >= 0.5));
    const inside = () => dIn || (dIn = distance(alpha, w, h, (a) => a < 0.5));
    const out = canvas(w, h);
    const solid = (hex) => { const c = canvas(w, h), x = g2(c); x.drawImage(shape, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = hex; x.fillRect(0, 0, w, h); return c; };
    /** The shape grown by r pixels (soft edged). */
    const grown = (r) => { if (!(r > 0)) return null; const d = outside(), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.max(alpha[i], clamp01(r - d[i] + 0.5)); return a; };
    const offset = (angle, dist) => { const t = angle * Math.PI / 180; return { dx: -Math.cos(t) * dist, dy: Math.sin(t) * dist }; };

    for (const id of BELOW) {
      if (!on(styles, id)) continue;
      const s = styles[id], spread = (s.spread || 0) / 100 * s.size, g = grown(spread);
      const base = g ? alphaCanvas(g, w, h, s.colour) : solid(s.colour);
      const soft = blurred(base, Math.max(0, s.size - spread) / 2);
      const o = id === 'shadow' ? offset(s.angle, s.distance) : { dx: 0, dy: 0 };
      draw(out, soft, s.opacity, s.blend, o.dx, o.dy);
    }

    // The layer's own pixels, with the overlays on them, at the fill opacity.
    const body = canvas(w, h);
    g2(body).drawImage(shape, 0, 0);
    if (on(styles, 'gradientOverlay')) {
      const s = styles.gradientOverlay, t = canvas(w, h), x = g2(t), a = s.angle * Math.PI / 180;
      const cx = (content.x - x0) + cw / 2, cy = (content.y - y0) + ch / 2, half = (Math.abs(Math.cos(a)) * cw + Math.abs(Math.sin(a)) * ch) / 2;
      const stops = s.reverse ? [s.to, s.from] : [s.from, s.to];
      const gr = s.shape === 'radial' ? x.createRadialGradient(cx, cy, 0, cx, cy, Math.max(cw, ch) / 2) : x.createLinearGradient(cx - Math.cos(a) * half, cy + Math.sin(a) * half, cx + Math.cos(a) * half, cy - Math.sin(a) * half);
      gr.addColorStop(0, stops[0]); gr.addColorStop(1, stops[1]);
      x.fillStyle = gr; x.fillRect(0, 0, w, h);
      clipTo(t, shape);
      draw(body, t, s.opacity, s.blend);
    }
    if (on(styles, 'colourOverlay')) { const s = styles.colourOverlay; draw(body, solid(s.colour), s.opacity, s.blend); }
    clipTo(body, shape);
    draw(out, body, fillOpacity ?? 1, 'normal');

    for (const id of ABOVE) {
      if (!on(styles, id)) continue;
      const s = styles[id];
      if (id === 'innerShadow' || id === 'innerGlow') {
        // From the edge inwards: the shape turned inside out, blurred, kept inside the shape.
        const inv = new Float32Array(n), choke = (s.choke || 0) / 100 * s.size;
        if (choke > 0) { const d = inside(); for (let i = 0; i < n; i++) inv[i] = Math.max(1 - alpha[i], clamp01(choke - d[i] + 0.5)); }
        else for (let i = 0; i < n; i++) inv[i] = 1 - alpha[i];
        // Drawn on a bigger canvas filled with the colour round it, so an offset never uncovers a gap at the border.
        const o = id === 'innerShadow' ? offset(s.angle, s.distance) : { dx: 0, dy: 0 }, pad = Math.ceil(Math.abs(o.dx) + Math.abs(o.dy) + s.size * 2 + 2);
        const big = canvas(w + pad * 2, h + pad * 2), bx = g2(big);
        bx.fillStyle = s.colour; bx.fillRect(0, 0, big.width, big.height); bx.clearRect(pad, pad, w, h); bx.drawImage(alphaCanvas(inv, w, h, s.colour), pad, pad);
        let soft = blurred(big, Math.max(0, s.size - choke) / 2);
        if (id === 'innerGlow' && s.source === 'centre') {
          // From the middle outwards: the opposite of the edge glow.
          const c = canvas(soft.width, soft.height), x = g2(c); x.fillStyle = s.colour; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'destination-out'; x.drawImage(soft, 0, 0); soft = c;
        }
        const t = canvas(w, h); g2(t).drawImage(soft, o.dx - pad, o.dy - pad);
        draw(out, clipTo(t, shape), s.opacity, s.blend);
      } else if (id === 'bevel') bevel(out, s, alpha, w, h, inside, outside);
      else if (id === 'stroke') {
        const a = new Float32Array(n), r = s.size;
        const dO = s.position === 'inside' ? null : outside(), dI = s.position === 'outside' ? null : inside();
        for (let i = 0; i < n; i++) {
          if (s.position === 'outside') a[i] = clamp01(r - dO[i] + 0.5) * (1 - alpha[i]);
          else if (s.position === 'inside') a[i] = clamp01(r - dI[i] + 0.5) * alpha[i];
          else a[i] = clamp01(r / 2 - dO[i] + 0.5) * (1 - alpha[i]) + clamp01(r / 2 - dI[i] + 0.5) * alpha[i];
        }
        draw(out, alphaCanvas(a, w, h, s.colour), s.opacity, s.blend);
      }
    }
    return { canvas: out, x: x0, y: y0 };
  }

  /** Bevel and emboss: a height from the distance to the edge, lit from an angle; highlights and shadows drawn over. */
  function bevel(out, s, alpha, w, h, inside, outside) {
    const n = w * h, size = Math.max(1, s.size), H = new Float32Array(n);
    const dI = s.style === 'outer' ? null : inside(), dO = s.style === 'inner' ? null : outside();
    for (let i = 0; i < n; i++) {
      if (s.style === 'inner') H[i] = alpha[i] >= 0.5 ? clamp01(dI[i] / size) : 0;
      else if (s.style === 'outer') H[i] = alpha[i] >= 0.5 ? 1 : 1 - clamp01(dO[i] / size);
      else H[i] = alpha[i] >= 0.5 ? 0.5 + 0.5 * clamp01(dI[i] / size) : 0.5 - 0.5 * clamp01(dO[i] / size);
    }
    // Smooth it a little (and more with soften), so the slope has no steps.
    const passes = 1 + Math.round(s.soften || 0);
    const tmp = new Float32Array(n);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let sum = 0, c = 0; for (let k = -1; k <= 1; k++) { const xx = x + k; if (xx >= 0 && xx < w) { sum += H[y * w + xx]; c++; } } tmp[y * w + x] = sum / c; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let sum = 0, c = 0; for (let k = -1; k <= 1; k++) { const yy = y + k; if (yy >= 0 && yy < h) { sum += tmp[yy * w + x]; c++; } } H[y * w + x] = sum / c; }
    }
    const az = s.angle * Math.PI / 180, alt = s.altitude * Math.PI / 180, up = s.direction === 'down' ? -1 : 1;
    const Lx = Math.cos(alt) * Math.cos(az), Ly = -Math.cos(alt) * Math.sin(az), Lz = Math.sin(alt), k = (s.depth / 100) * size * up;
    const hi = new Float32Array(n), lo = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, nx = -(H[i + 1] - H[i - 1]) / 2 * k, ny = -(H[i + w] - H[i - w]) / 2 * k, len = Math.hypot(nx, ny, 1);
      const shade = (nx * Lx + ny * Ly + Lz) / len - Lz;
      const where = s.style === 'inner' ? alpha[i] : s.style === 'outer' ? 1 - alpha[i] : 1;
      if (shade > 0) hi[i] = clamp01(shade * 2.2) * where; else lo[i] = clamp01(-shade * 2.2) * where;
    }
    draw(out, alphaCanvas(hi, w, h, s.highlight), s.highlightOpacity, 'screen');
    draw(out, alphaCanvas(lo, w, h, s.shadow), s.shadowOpacity, 'multiply');
  }

  // Ready-made styles to start from.
  const PRESETS = [
    { name: 'Soft shadow', styles: { shadow: { ...defaults('shadow'), opacity: 0.45, distance: 6, size: 18 } } },
    { name: 'Hard shadow', styles: { shadow: { ...defaults('shadow'), opacity: 0.8, distance: 6, size: 0, blend: 'normal' } } },
    { name: 'Neon glow', styles: { outerGlow: { ...defaults('outerGlow'), colour: '#3cf0ff', size: 22, opacity: 0.9 }, innerGlow: { ...defaults('innerGlow'), colour: '#ffffff', size: 4, opacity: 0.7 } } },
    { name: 'Outlined', styles: { stroke: { ...defaults('stroke'), size: 4 } } },
    { name: 'Sticker', styles: { stroke: { ...defaults('stroke'), colour: '#ffffff', size: 8 }, shadow: { ...defaults('shadow'), opacity: 0.35, distance: 4, size: 10 } } },
    { name: 'Embossed', styles: { bevel: { ...defaults('bevel'), size: 6, depth: 140 } } },
    { name: 'Pressed in', styles: { innerShadow: { ...defaults('innerShadow'), distance: 3, size: 6 }, bevel: { ...defaults('bevel'), direction: 'down', size: 3 } } },
    { name: 'Gold', styles: { gradientOverlay: { ...defaults('gradientOverlay'), from: '#8a5a12', to: '#ffe38a', angle: 90 }, bevel: { ...defaults('bevel'), size: 5, depth: 160, highlight: '#fff6d0' }, shadow: { ...defaults('shadow'), opacity: 0.4, distance: 3, size: 6 } } },
  ];

  return { EFFECTS, PRESETS, defaults, any, margin, render, _distance: distance };
})();
