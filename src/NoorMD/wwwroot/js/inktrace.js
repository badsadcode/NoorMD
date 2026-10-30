// NoorInk tracer: turns a bitmap (RGBA, like ImageData) into filled vector paths, no DOM, so the same file runs in the
// page and in Node tests. Uses NoorInkGeom (inkgeom.js) for simplification and curve fitting.
//
// trace({ width, height, data }, options) -> [{ colour: '#rrggbb', opacity?, path }], back to front.
//   colours     number of colours to reduce to (default 6); deterministic median cut refined by a few k-means rounds
//   detail      > 1 keeps more detail, < 1 simplifies harder (default 1)
//   smooth      0 keeps straight polygons; 1 (default) or more fits curves, larger is smoother
//   minArea     regions (and holes) smaller than this many pixels are dropped (default 4)
//   background  'keep' (default) or 'drop': leave out the most common colour along the border
//   mono        true: only the dark parts (luminance < threshold, default 128) as one black path
//   maxSide     larger images are box-filtered down to this size first and the paths scaled back up (default 512)
//
// Pixels with alpha < 128 count as empty. Paths are in pixel units of the input image (pixel (x, y) covers x..x+1,
// y..y+1) and fill correctly with the nonzero rule: outer rings have a positive area() and holes a negative one.
//
// Layers are stacked: the colours are ordered by pixel count, largest first, and each layer covers its own pixels plus
// those of every later layer. So each layer lies under the ones drawn after it and no hairline gaps can show between
// neighbouring colours (a seam only ever shows the colour beneath, which is the one that is really there).
'use strict';

(typeof window !== 'undefined' ? window : globalThis).NoorInkTrace = (() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const G = root.NoorInkGeom || (typeof require === 'function' ? require('./inkgeom.js') : null);

  // ---- Downsampling (box filter, alpha weighted) ----
  function downsample(img, maxSide) {
    const W = img.width, H = img.height, src = img.data, f = maxSide / Math.max(W, H);
    if (!(f < 1)) return img;
    const w = Math.max(1, Math.round(W * f)), h = Math.max(1, Math.round(H * f)), out = new Uint8ClampedArray(w * h * 4);
    const sx = W / w, sy = H / h;
    for (let y = 0; y < h; y++) {
      const ya = Math.floor(y * sy), yb = Math.max(ya + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < w; x++) {
        const xa = Math.floor(x * sx), xb = Math.max(xa + 1, Math.floor((x + 1) * sx));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = ya; yy < yb; yy++) {
          for (let xx = xa, i = (yy * W + xa) * 4; xx < xb; xx++, i += 4) {
            const al = src[i + 3];
            r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; n++;
          }
        }
        const o = (y * w + x) * 4;
        if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
        out[o + 3] = a / n;
      }
    }
    return { width: w, height: h, data: out };
  }

  // ---- Colour quantisation ----
  // Median cut on a 5-bit-per-channel histogram (boxes split at the weighted median of their widest channel, the box
  // with the most pixels times width first), then k-means rounds over the histogram cells. Fully deterministic.
  function quantise(data, n, k) {
    const cnt = new Float64Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (data[o + 3] < 128) continue;
      const r = data[o], g = data[o + 1], b = data[o + 2], key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      cnt[key]++; sr[key] += r; sg[key] += g; sb[key] += b;
    }
    const cells = [];
    for (let key = 0; key < 32768; key++) if (cnt[key]) cells.push(key);
    if (!cells.length) return [];
    const mean = (key) => [sr[key] / cnt[key], sg[key] / cnt[key], sb[key] / cnt[key]];
    const cellColour = cells.map(mean);
    const boxOf = (idx) => {
      const lo = [255, 255, 255], hi = [0, 0, 0];
      let total = 0;
      for (const c of idx) {
        const col = cellColour[c];
        for (let ch = 0; ch < 3; ch++) { if (col[ch] < lo[ch]) lo[ch] = col[ch]; if (col[ch] > hi[ch]) hi[ch] = col[ch]; }
        total += cnt[cells[c]];
      }
      const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], ch = span[0] >= span[1] && span[0] >= span[2] ? 0 : span[1] >= span[2] ? 1 : 2;
      return { idx, total, ch, span: span[ch] };
    };
    const boxes = [boxOf(cells.map((_, i) => i))];
    while (boxes.length < k) {
      let bi = -1, best = 0;
      for (let i = 0; i < boxes.length; i++) {
        const s = boxes[i].span * Math.sqrt(boxes[i].total);
        if (boxes[i].idx.length > 1 && boxes[i].span > 0 && s > best) { best = s; bi = i; }
      }
      if (bi < 0) break;
      const bx = boxes[bi], ch = bx.ch, idx = bx.idx.slice().sort((a, b) => cellColour[a][ch] - cellColour[b][ch] || a - b);
      let acc = 0, cut = 1;
      for (let i = 0; i < idx.length - 1; i++) {
        acc += cnt[cells[idx[i]]];
        if (acc >= bx.total / 2) { cut = i + 1; break; }
        cut = i + 1;
      }
      // Never split between two cells of the same value on the split channel.
      while (cut < idx.length && cut > 0 && cellColour[idx[cut]][ch] === cellColour[idx[cut - 1]][ch]) cut++;
      if (cut >= idx.length) { cut = idx.length - 1; while (cut > 0 && cellColour[idx[cut]][ch] === cellColour[idx[cut - 1]][ch]) cut--; }
      if (cut <= 0) { bx.span = 0; continue; }
      boxes.splice(bi, 1, boxOf(idx.slice(0, cut)), boxOf(idx.slice(cut)));
    }
    const centre = (idx) => {
      let r = 0, g = 0, b = 0, t = 0;
      for (const c of idx) { const key = cells[c]; r += sr[key]; g += sg[key]; b += sb[key]; t += cnt[key]; }
      return [r / t, g / t, b / t];
    };
    let pal = boxes.map((b) => centre(b.idx));
    const nearest = (col, p) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < p.length; i++) {
        const dr = col[0] - p[i][0], dg = col[1] - p[i][1], db = col[2] - p[i][2], d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (d < bd) { bd = d; bi = i; }
      }
      return bi;
    };
    for (let it = 0; it < 6; it++) {
      const groups = pal.map(() => []);
      for (let c = 0; c < cells.length; c++) groups[nearest(cellColour[c], pal)].push(c);
      const next = groups.filter((g) => g.length).map(centre);
      const moved = next.length !== pal.length || next.some((p, i) => Math.abs(p[0] - pal[i][0]) + Math.abs(p[1] - pal[i][1]) + Math.abs(p[2] - pal[i][2]) > 0.5);
      pal = next;
      if (!moved) break;
    }
    return pal.map((p) => p.map((v) => Math.max(0, Math.min(255, Math.round(v)))));
  }

  // Each opaque pixel's nearest palette entry (perceptually weighted), -1 for empty pixels.
  function labelPixels(data, n, pal) {
    const labels = new Int16Array(n).fill(-1), cache = new Map();
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (data[o + 3] < 128) continue;
      const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
      let l = cache.get(key);
      if (l === undefined) {
        let bd = Infinity;
        l = 0;
        for (let p = 0; p < pal.length; p++) {
          const dr = data[o] - pal[p][0], dg = data[o + 1] - pal[p][1], db = data[o + 2] - pal[p][2], d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
          if (d < bd) { bd = d; l = p; }
        }
        cache.set(key, l);
      }
      labels[i] = l;
    }
    return labels;
  }

  // ---- Boundary tracing ----
  // The boundary of a pixel mask runs along pixel edges ("cracks"). Each crack is directed with the mask on its right
  // on screen (y down), which makes outer rings come out with a positive area and holes with a negative one. Where two
  // mask pixels touch only at a corner the walk turns left, joining them (8-connected regions). The ring that marching
  // squares draws through the pixel centres is the ring of the crack midpoints, so that is what is returned.
  // Rings enclosing fewer than minArea pixels are dropped.
  function traceMask(mask, w, h, minArea) {
    const VW = w + 1, nV = VW * (h + 1), out = new Uint8Array(nV); // per vertex: outgoing cracks, bits E=1 S=2 W=4 N=8
    const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    for (let y = 0; y <= h; y++) {
      for (let x = 0; x <= w; x++) {
        const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x - 1, y), d = at(x, y); // NW NE SW SE of vertex (x, y)
        let bits = 0;
        if (d && !b) bits |= 1; // top crack of SE pixel, mask below: going east
        if (c && !d) bits |= 2; // between SW (mask) and SE: going south
        if (a && !c) bits |= 4; // between NW (mask, above) and SW: going west
        if (b && !a) bits |= 8; // between NE (mask) and NW: going north
        out[y * VW + x] = bits;
      }
    }
    const dirIndex = { 1: 0, 2: 1, 4: 2, 8: 3 }, bitOf = [1, 2, 4, 8], ddx = [1, 0, -1, 0], ddy = [0, 1, 0, -1];
    const rings = [];
    const walk = (v0) => {
      let x = v0 % VW, y = (v0 - x) / VW, d = dirIndex[out[v0] & -out[v0]], twice = 0;
      const pts = [];
      while (true) {
        out[y * VW + x] &= ~bitOf[d];
        pts.push(x + ddx[d] * 0.5, y + ddy[d] * 0.5); // midpoint of this crack
        twice += x * ddy[d] - y * ddx[d];
        x += ddx[d]; y += ddy[d];
        const nb = out[y * VW + x];
        if (!nb) break;
        // Prefer a left turn, then straight on, then right; at a corner-touch the left turn joins the two pixels.
        const left = (d + 3) & 3, right = (d + 1) & 3;
        if (nb & bitOf[left]) d = left; else if (!(nb & bitOf[d])) { if (nb & bitOf[right]) d = right; else break; }
      }
      // twice is twice the signed pixel area enclosed by the cracks: positive outer, negative hole.
      if (Math.abs(twice / 2) < minArea || pts.length < 6) return;
      const ring = [];
      for (let i = 0; i < pts.length; i += 2) ring.push([pts[i], pts[i + 1]]);
      rings.push({ ring, areaPx: twice / 2 });
    };
    // Start only at vertices with a single crack, so a walk ends exactly where it began (every ring has one: its first
    // vertex in reading order is a plain corner); a second sweep is only a safety net.
    for (let v0 = 0; v0 < nV; v0++) while (out[v0] && (out[v0] & (out[v0] - 1)) === 0) walk(v0);
    for (let v0 = 0; v0 < nV; v0++) while (out[v0]) walk(v0);
    return rings;
  }

  // ---- Simplification and smoothing ----
  // Put back the corners that the midpoint ring cuts off: a short diagonal step between two long edges that meet at a
  // clear angle becomes the corner where those edges' lines cross.
  function restoreCorners(r) {
    const n = r.length;
    if (n < 4) return r;
    const out = [];
    const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const skip = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (skip[i]) continue;
      const p = r[(i + n - 1) % n], a = r[i], b = r[(i + 1) % n], q = r[(i + 2) % n];
      if (len(a, b) <= 1.01 && len(p, a) >= 1.5 && len(b, q) >= 1.5 && !skip[(i + 1) % n] && (i + 1) % n !== 0) {
        const ux = a[0] - p[0], uy = a[1] - p[1], vx = q[0] - b[0], vy = q[1] - b[1], den = ux * vy - uy * vx;
        const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
        if (Math.abs(den) > 1e-9 && cos < 0.5) {
          const t = ((b[0] - p[0]) * vy - (b[1] - p[1]) * vx) / den, c = [p[0] + ux * t, p[1] + uy * t];
          if (len(c, a) <= 1 && len(c, b) <= 1) { out.push(c); skip[(i + 1) % n] = 1; continue; }
        }
      }
      out.push(a);
    }
    return out.length >= 3 ? out : r;
  }
  const turnAt = (r, i) => {
    const n = r.length, p = r[(i + n - 1) % n], a = r[i], b = r[(i + 1) % n];
    const ux = a[0] - p[0], uy = a[1] - p[1], vx = b[0] - a[0], vy = b[1] - a[1];
    return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
  };
  // Fit a closed ring with cubics: start at its sharpest corner so the seam is a real corner (or smooth it out after).
  function fitRing(r, err) {
    const n = r.length;
    let start = 0, best = -1;
    for (let i = 0; i < n; i++) { const t = turnAt(r, i); if (t > best) { best = t; start = i; } }
    const pts = r.slice(start).concat(r.slice(0, start));
    pts.push(pts[0]);
    const sub = G.fit(pts, err);
    const p = sub.pts;
    if (p.length < 3) return null;
    const last = p.pop(), f = p[0];
    f.ix = last.ix; f.iy = last.iy;
    if (best < Math.PI / 3) { // no real corner: make the seam smooth
      const ax = f.x - f.ix, ay = f.y - f.iy, bx = f.ox - f.x, by = f.oy - f.y, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > 1e-9 && lb > 1e-9) {
        let dx = ax / la + bx / lb, dy = ay / la + by / lb;
        const dl = Math.hypot(dx, dy);
        if (dl > 1e-9) { dx /= dl; dy /= dl; f.ix = f.x - dx * la; f.iy = f.y - dy * la; f.ox = f.x + dx * lb; f.oy = f.y + dy * lb; }
      }
    }
    return { closed: true, pts: p };
  }
  function ringsToPath(rings, opt, sx, sy) {
    const path = [];
    for (const { ring } of rings) {
      let r = G.simplifyRings([ring], opt.smooth > 0 ? 0.3 / opt.detail : 0.55 / opt.detail)[0];
      if (!r || r.length < 3) continue;
      r = restoreCorners(r);
      let sub = null;
      if (opt.smooth > 0 && r.length >= 4) sub = fitRing(r, (0.35 + 0.35 * opt.smooth) / opt.detail);
      if (!sub) sub = { closed: true, pts: r.map((q) => ({ x: q[0], y: q[1], ix: q[0], iy: q[1], ox: q[0], oy: q[1] })) };
      if (sx !== 1 || sy !== 1) {
        for (const q of sub.pts) { q.x *= sx; q.ix *= sx; q.ox *= sx; q.y *= sy; q.iy *= sy; q.oy *= sy; }
      }
      path.push(sub);
    }
    return path;
  }

  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

  function trace(img, options) {
    const o = options || {};
    const opt = {
      colours: Math.max(1, Math.min(64, Math.round(o.colours || 6))),
      detail: o.detail > 0 ? +o.detail : 1,
      smooth: o.smooth === undefined ? 1 : Math.max(0, +o.smooth || 0),
      minArea: o.minArea === undefined ? 4 : Math.max(0, +o.minArea || 0),
      background: o.background === 'drop' ? 'drop' : 'keep',
      mono: !!o.mono,
      threshold: o.threshold === undefined ? 128 : +o.threshold,
      maxSide: o.maxSide > 0 ? Math.round(o.maxSide) : 512,
    };
    if (!img || !(img.width > 0) || !(img.height > 0) || !img.data) return [];
    const small = downsample(img, opt.maxSide), w = small.width, h = small.height, n = w * h, data = small.data;
    const sx = img.width / w, sy = img.height / h;
    // Areas are counted on the traced grid; minArea is in input pixels.
    const minA = opt.minArea / (sx * sy);

    if (opt.mono) {
      const mask = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const k = i * 4;
        if (data[k + 3] >= 128 && 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2] < opt.threshold) mask[i] = 1;
      }
      const path = ringsToPath(traceMask(mask, w, h, minA), opt, sx, sy);
      return path.length ? [{ colour: '#000000', path }] : [];
    }

    const pal = quantise(data, n, opt.colours);
    if (!pal.length) return [];
    const labels = labelPixels(data, n, pal), count = new Float64Array(pal.length), alpha = new Float64Array(pal.length);
    for (let i = 0; i < n; i++) if (labels[i] >= 0) { count[labels[i]]++; alpha[labels[i]] += data[i * 4 + 3]; }
    let order = pal.map((_, i) => i).filter((i) => count[i] > 0).sort((a, b) => count[b] - count[a] || a - b);
    if (opt.background === 'drop') {
      const border = new Float64Array(pal.length);
      const add = (x, y) => { const l = labels[y * w + x]; if (l >= 0) border[l]++; };
      for (let x = 0; x < w; x++) { add(x, 0); if (h > 1) add(x, h - 1); }
      for (let y = 1; y < h - 1; y++) { add(0, y); if (w > 1) add(w - 1, y); }
      let bg = -1, bc = 0;
      for (let i = 0; i < pal.length; i++) if (border[i] > bc) { bc = border[i]; bg = i; }
      if (bg >= 0) {
        for (let i = 0; i < n; i++) if (labels[i] === bg) labels[i] = -1;
        order = order.filter((i) => i !== bg);
      }
    }
    // rank[label] = position in the stacking order; layer k covers every pixel whose rank is k or more.
    const rank = new Int16Array(pal.length).fill(-1);
    order.forEach((l, k) => { rank[l] = k; });
    const pixRank = new Int16Array(n);
    for (let i = 0; i < n; i++) pixRank[i] = labels[i] >= 0 ? rank[labels[i]] : -1;
    const layers = [], mask = new Uint8Array(n);
    for (let k = 0; k < order.length; k++) {
      for (let i = 0; i < n; i++) mask[i] = pixRank[i] >= k ? 1 : 0;
      const path = ringsToPath(traceMask(mask, w, h, minA), opt, sx, sy);
      if (!path.length) continue;
      const l = order[k], layer = { colour: hex(pal[l]), path }, a = alpha[l] / count[l] / 255;
      if (a < 0.98) layer.opacity = Math.round(a * 100) / 100;
      layers.push(layer);
    }
    return layers;
  }

  return { trace };
})();

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).NoorInkTrace;
