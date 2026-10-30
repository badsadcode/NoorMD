// NoorPhoto filters and adjustments: pure computation on straight-alpha RGBA pictures ({ width, height, data }), no DOM,
// so the same file runs in the page and in Node tests. Every operation returns a new picture and leaves its input alone.
//
// Anything that averages neighbours works on premultiplied alpha in floats, so a transparent edge never bleeds a dark
// fringe into the colours next to it. Gaussian blur is three running-sum box blurs, so its cost doesn't depend on the
// radius. Randomness comes from a seeded generator: the same settings always give the same pixels (a preview matches
// the final result). Previews run on a reduced copy: opts.scale multiplies every px parameter so they look the same.
'use strict';

(typeof window !== 'undefined' ? window : globalThis).NoorPhotoFx = (() => {
  // ---- Small helpers ----
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const smooth = (t) => t * t * (3 - 2 * t);
  const mod = (a, n) => ((a % n) + n) % n;
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const RAD = Math.PI / 180;

  function img8(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  function copy(img) { return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }; }
  function hexRgb(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
    const n = m ? parseInt(m[1], 16) : 0;
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }

  // mulberry32: tiny, fast and good enough for noise; never Math.random, so results repeat exactly.
  function rng(seed) {
    let a = seed | 0;
    return () => {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function normal(rand) { return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()); }

  // ---- Premultiplied float buffers ----
  function toPre(img) {
    const d = img.data, f = new Float32Array(d.length);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3];
    }
    return f;
  }
  function fromPre(f, w, h) {
    const out = img8(w, h), d = out.data;
    for (let i = 0; i < f.length; i += 4) {
      const a = f[i + 3];
      if (a > 1e-4) { const k = 255 / a; d[i] = f[i] * k; d[i + 1] = f[i + 1] * k; d[i + 2] = f[i + 2] * k; d[i + 3] = a; }
    }
    return out;
  }
  function lumMap(img) {
    const d = img.data, n = img.width * img.height, L = new Float32Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) L[p] = lum(d[i], d[i + 1], d[i + 2]);
    return L;
  }

  // ---- Gaussian blur: three box blurs with running sums, O(n) for any radius ----
  function boxesForGauss(sigma, n) {
    const wIdeal = Math.sqrt(12 * sigma * sigma / n + 1);
    let wl = Math.floor(wIdeal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    const sizes = [];
    for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
    return sizes;
  }
  function boxH(src, dst, w, h, ch, r) {
    const inv = 1 / (2 * r + 1), row = w * ch, last = (w - 1) * ch;
    for (let y = 0; y < h; y++) {
      const o = y * row;
      for (let c = 0; c < ch; c++) {
        const first = src[o + c], lastV = src[o + last + c];
        let s = first * (r + 1);
        for (let i = 1; i <= r; i++) s += src[o + Math.min(i, w - 1) * ch + c];
        for (let x = 0; x < w; x++) {
          dst[o + x * ch + c] = s * inv;
          const add = x + r + 1, sub = x - r;
          s += (add < w ? src[o + add * ch + c] : lastV) - (sub > 0 ? src[o + sub * ch + c] : first);
        }
      }
    }
  }
  // Vertical pass walks rows with one accumulator per column, so memory is read in order (cache friendly).
  function boxV(src, dst, w, h, ch, r) {
    const row = w * ch, inv = 1 / (2 * r + 1), acc = new Float64Array(row);
    for (let i = 0; i < row; i++) acc[i] = src[i] * (r + 1);
    for (let k = 1; k <= r; k++) { const o = Math.min(k, h - 1) * row; for (let i = 0; i < row; i++) acc[i] += src[o + i]; }
    for (let y = 0; y < h; y++) {
      const o = y * row, ao = Math.min(y + r + 1, h - 1) * row, so = Math.max(y - r, 0) * row;
      for (let i = 0; i < row; i++) { dst[o + i] = acc[i] * inv; acc[i] += src[ao + i] - src[so + i]; }
    }
  }
  /** Blurs a float buffer of `ch` interleaved channels in place (one temporary buffer of the same size). */
  function blurBuf(buf, w, h, ch, sigma, tmp) {
    if (!(sigma > 0)) return buf;
    tmp = tmp || new Float32Array(buf.length);
    for (const size of boxesForGauss(sigma, 3)) {
      const r = (size - 1) >> 1;
      if (r < 1) continue;
      boxH(buf, tmp, w, h, ch, r);
      boxV(tmp, buf, w, h, ch, r);
    }
    return buf;
  }
  function gaussImg(img, sigma) {
    if (!(sigma > 0)) return copy(img);
    const pre = toPre(img);
    blurBuf(pre, img.width, img.height, 4, sigma);
    return fromPre(pre, img.width, img.height);
  }

  // ---- Sampling ----
  // Adds the bilinear premultiplied sample at (x, y) (pixel-index coordinates) to acc[o..o+3].
  function sampleAdd(buf, w, h, x, y, acc, o, wrapX, wrapY) {
    if (x !== x || y !== y) return;
    let x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    let x1 = x0 + 1, y1 = y0 + 1;
    if (wrapX) { x0 = mod(x0, w); x1 = mod(x1, w); } else { x0 = clamp(x0, 0, w - 1); x1 = clamp(x1, 0, w - 1); }
    if (wrapY) { y0 = mod(y0, h); y1 = mod(y1, h); } else { y0 = clamp(y0, 0, h - 1); y1 = clamp(y1, 0, h - 1); }
    const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, e = (y1 * w + x1) * 4;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    for (let k = 0; k < 4; k++) acc[o + k] += buf[a + k] * w00 + buf[b + k] * w10 + buf[c + k] * w01 + buf[e + k] * w11;
  }
  // One straight channel, bilinear, clamped to the edge.
  function sampleCh(d, w, h, x, y, ch) {
    const x0 = clamp(Math.floor(x), 0, w - 1), y0 = clamp(Math.floor(y), 0, h - 1);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const fx = clamp(x - x0, 0, 1), fy = clamp(y - y0, 0, 1);
    const top = d[(y0 * w + x0) * 4 + ch] * (1 - fx) + d[(y0 * w + x1) * 4 + ch] * fx;
    const bot = d[(y1 * w + x0) * 4 + ch] * (1 - fx) + d[(y1 * w + x1) * 4 + ch] * fx;
    return top * (1 - fy) + bot * fy;
  }
  function sampleF(L, w, h, x, y) {
    const x0 = clamp(Math.floor(x), 0, w - 1), y0 = clamp(Math.floor(y), 0, h - 1);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const fx = clamp(x - x0, 0, 1), fy = clamp(y - y0, 0, 1);
    return (L[y0 * w + x0] * (1 - fx) + L[y0 * w + x1] * fx) * (1 - fy) + (L[y1 * w + x0] * (1 - fx) + L[y1 * w + x1] * fx) * fy;
  }
  /** Inverse mapping: map(x, y, pt) gets an output pixel centre and sets pt to the source point (continuous coords). */
  function warp(img, map, wrapX, wrapY) {
    const w = img.width, h = img.height, pre = toPre(img), out = new Float32Array(pre.length), pt = [0, 0];
    for (let y = 0, o = 0; y < h; y++) {
      for (let x = 0; x < w; x++, o += 4) {
        map(x + 0.5, y + 0.5, pt);
        sampleAdd(pre, w, h, pt[0] - 0.5, pt[1] - 0.5, out, o, wrapX, wrapY);
      }
    }
    return fromPre(out, w, h);
  }
  // acc += src shifted by (ox, oy), bilinear and clamped; the shift is the same for every pixel so weights are shared.
  function shiftAdd(src, acc, w, h, ox, oy) {
    const ix = Math.floor(ox), iy = Math.floor(oy), fx = ox - ix, fy = oy - iy;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    const c0 = new Int32Array(w), c1 = new Int32Array(w);
    for (let x = 0; x < w; x++) { c0[x] = clamp(x + ix, 0, w - 1) * 4; c1[x] = clamp(x + ix + 1, 0, w - 1) * 4; }
    for (let y = 0; y < h; y++) {
      const r0 = clamp(y + iy, 0, h - 1) * w * 4, r1 = clamp(y + iy + 1, 0, h - 1) * w * 4, o = y * w * 4;
      for (let x = 0; x < w; x++) {
        const a = r0 + c0[x], b = r0 + c1[x], c = r1 + c0[x], e = r1 + c1[x], q = o + x * 4;
        for (let k = 0; k < 4; k++) acc[q + k] += src[a + k] * w00 + src[b + k] * w10 + src[c + k] * w01 + src[e + k] * w11;
      }
    }
  }

  // ---- Per-pixel helpers for adjustments (alpha untouched) ----
  function lutOf(fn) { const l = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) l[v] = fn(v); return l; }
  function withLuts(img, lr, lg, lb) {
    const out = copy(img), d = out.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; }
    return out;
  }
  function perPixel(img, fn) {
    const out = copy(img), d = out.data, c = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      c[0] = d[i]; c[1] = d[i + 1]; c[2] = d[i + 2];
      fn(c, i);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    return out;
  }
  function toHsl(r, g, b, out) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    out[0] = h; out[1] = s; out[2] = l;
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function fromHsl(h, s, l, out) {
    if (s <= 0) { out[0] = out[1] = out[2] = l * 255; return; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    out[0] = hue2rgb(p, q, h + 1 / 3) * 255; out[1] = hue2rgb(p, q, h) * 255; out[2] = hue2rgb(p, q, h - 1 / 3) * 255;
  }
  // Moves a pixel's colour to a new luminance while keeping its hue and saturation as far as possible.
  function setLum(c, target) {
    const d = target - lum(c[0], c[1], c[2]);
    c[0] += d; c[1] += d; c[2] += d;
  }
  function satContrast(img, sat, con) {
    if (!sat && !con) return img;
    const d = img.data, s = 1 + sat / 100, k = 1 + con / 100;
    for (let i = 0; i < d.length; i += 4) {
      const L = lum(d[i], d[i + 1], d[i + 2]);
      for (let c = 0; c < 3; c++) d[i + c] = ((L + (d[i + c] - L) * s) - 128) * k + 128;
    }
    return img;
  }

  // ---- Blur filters ----
  function motion(img, p) {
    const dist = p.distance;
    if (!(dist >= 1)) return copy(img);
    const w = img.width, h = img.height, pre = toPre(img), acc = new Float32Array(pre.length);
    const n = Math.min(256, Math.ceil(dist) + 1), ux = Math.cos(p.angle * RAD), uy = -Math.sin(p.angle * RAD);
    for (let k = 0; k < n; k++) { const t = (k / (n - 1) - 0.5) * dist; shiftAdd(pre, acc, w, h, t * ux, t * uy); }
    for (let i = 0; i < acc.length; i++) acc[i] /= n;
    return fromPre(acc, w, h);
  }

  // Zoom and spin: each pixel averages samples along a line towards the centre or along an arc around it.
  function along(img, p, step) {
    const w = img.width, h = img.height, pre = toPre(img), acc = new Float32Array(pre.length);
    const cx = p.centre.x * w, cy = p.centre.y * h, pt = [0, 0];
    for (let y = 0, o = 0; y < h; y++) {
      for (let x = 0; x < w; x++, o += 4) {
        const vx = x + 0.5 - cx, vy = y + 0.5 - cy, n = step(vx, vy, -1, pt);
        for (let k = 0; k < n; k++) { step(vx, vy, n > 1 ? k / (n - 1) : 0, pt); sampleAdd(pre, w, h, cx + pt[0] - 0.5, cy + pt[1] - 0.5, acc, o); }
        for (let c = 0; c < 4; c++) acc[o + c] /= n;
      }
    }
    return fromPre(acc, w, h);
  }
  function radial(img, p) {
    const s = p.amount / 100 * 0.5;
    if (s <= 0) return copy(img);
    return along(img, p, (vx, vy, t, pt) => {
      if (t < 0) return clamp(Math.ceil(Math.hypot(vx, vy) * s), 1, 64);
      const f = 1 - s * t;
      pt[0] = vx * f; pt[1] = vy * f;
      return 0;
    });
  }
  function spin(img, p) {
    const a = Math.abs(p.angle) * RAD;
    if (a <= 0) return copy(img);
    return along(img, p, (vx, vy, t, pt) => {
      if (t < 0) return clamp(Math.ceil(Math.hypot(vx, vy) * a), 1, 64);
      const phi = (t - 0.5) * a, cs = Math.cos(phi), sn = Math.sin(phi);
      pt[0] = vx * cs - vy * sn; pt[1] = vx * sn + vy * cs;
      return 0;
    });
  }

  // Disc (bokeh) blur: each row inside the disc is one span, read from row prefix sums kept for only 2r+1 rows.
  function discBlur(src, w, h, r) {
    const out = new Float32Array(src.length), rows = 2 * r + 1, W = (w + 1) * 4;
    const ring = new Float64Array(rows * W), held = new Int32Array(rows).fill(-1), span = [];
    let total = 0;
    for (let dy = -r; dy <= r; dy++) { const s = Math.floor(Math.sqrt((r + 0.5) * (r + 0.5) - dy * dy)); span.push(s); total += 2 * s + 1; }
    const prefix = (row) => {
      const slot = row % rows, base = slot * W;
      if (held[slot] !== row) {
        held[slot] = row;
        const o = row * w * 4;
        for (let c = 0; c < 4; c++) ring[base + c] = 0;
        for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) ring[base + (x + 1) * 4 + c] = ring[base + x * 4 + c] + src[o + x * 4 + c];
      }
      return base;
    };
    for (let y = 0; y < h; y++) {
      const oy = y * w * 4;
      for (let k = 0; k < rows; k++) {
        const row = clamp(y + k - r, 0, h - 1), base = prefix(row), s = span[k], ro = row * w * 4, rl = ro + (w - 1) * 4;
        for (let x = 0; x < w; x++) {
          const lo = x - s, hi = x + s, l = lo < 0 ? 0 : lo, hh = hi >= w ? w - 1 : hi, exL = l - lo, exR = hi - hh, o = oy + x * 4;
          for (let c = 0; c < 4; c++) {
            out[o + c] += ring[base + (hh + 1) * 4 + c] - ring[base + l * 4 + c] + exL * src[ro + c] + exR * src[rl + c];
          }
        }
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }
  function lens(img, p) {
    const r = Math.round(p.radius);
    if (r < 1) return copy(img);
    const w = img.width, h = img.height, pre = toPre(img), th = p.threshold, gain = p.brightness / 100 * 8;
    // Highlights are made much brighter than white before the blur, so after it they still clip: bright discs.
    if (gain > 0) {
      for (let i = 0; i < pre.length; i += 4) {
        const a = pre[i + 3];
        if (!a) continue;
        const l = lum(pre[i], pre[i + 1], pre[i + 2]) * 255 / a;
        if (l > th) { const k = 1 + gain * Math.pow((l - th) / Math.max(1, 255 - th), 2); pre[i] *= k; pre[i + 1] *= k; pre[i + 2] *= k; }
      }
    }
    return fromPre(discBlur(pre, w, h, r), w, h);
  }

  // Surface blur: neighbours count only as much as they look alike, so edges stay crisp (sparse taps for big radii).
  function surface(img, p) {
    const r = Math.round(p.radius), t = p.threshold;
    if (r < 1 || t <= 0) return copy(img);
    const w = img.width, h = img.height, pre = toPre(img), out = new Float32Array(pre.length), lim = 2.5 * t;
    const st = Math.max(1, Math.floor(r / 6)), from = -Math.floor(r / st) * st, ws = [0, 0, 0, 0], vs = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        ws.fill(0); vs.fill(0);
        for (let dy = from; dy <= r; dy += st) {
          const qy = clamp(y + dy, 0, h - 1) * w;
          for (let dx = from; dx <= r; dx += st) {
            const q = (qy + clamp(x + dx, 0, w - 1)) * 4;
            for (let c = 0; c < 4; c++) {
              const wt = 1 - Math.abs(pre[q + c] - pre[o + c]) / lim;
              if (wt > 0) { ws[c] += wt; vs[c] += wt * pre[q + c]; }
            }
          }
        }
        for (let c = 0; c < 4; c++) out[o + c] = ws[c] > 0 ? vs[c] / ws[c] : pre[o + c];
      }
    }
    return fromPre(out, w, h);
  }

  // Median per channel with a sliding histogram (Huang): adding and removing one column per step.
  function median8(src, w, h, r) {
    const out = new Uint8Array(src.length), N = (2 * r + 1) * (2 * r + 1), half = N >> 1;
    const hist = new Int32Array(256 * 4);
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      const med = [0, 0, 0, 0], lt = [0, 0, 0, 0];
      const col = (cx, sign) => {
        const x = clamp(cx, 0, w - 1);
        for (let dy = -r; dy <= r; dy++) {
          const q = (clamp(y + dy, 0, h - 1) * w + x) * 4;
          for (let c = 0; c < 4; c++) { const v = src[q + c]; hist[c * 256 + v] += sign; if (v < med[c]) lt[c] += sign; }
        }
      };
      for (let dx = -r; dx <= r; dx++) col(dx, 1);
      for (let x = 0; x < w; x++) {
        if (x > 0) { col(x - r - 1, -1); col(x + r, 1); }
        for (let c = 0; c < 4; c++) {
          const H = c * 256;
          let m = med[c], l = lt[c];
          while (l > half) { m--; l -= hist[H + m]; }
          while (l + hist[H + m] <= half) { l += hist[H + m]; m++; }
          med[c] = m; lt[c] = l;
          out[(y * w + x) * 4 + c] = m;
        }
      }
    }
    return out;
  }
  function medianImg(img, radius) {
    const r = clamp(Math.round(radius), 0, 10), d = img.data, w = img.width, h = img.height;
    if (r < 1) return copy(img);
    // Premultiplied bytes, so transparent pixels don't vote with their (meaningless) colour.
    const pre = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      pre[i] = Math.round(d[i] * a); pre[i + 1] = Math.round(d[i + 1] * a); pre[i + 2] = Math.round(d[i + 2] * a); pre[i + 3] = d[i + 3];
    }
    const m = median8(pre, w, h, r), out = img8(w, h), o = out.data;
    for (let i = 0; i < m.length; i += 4) {
      const a = m[i + 3];
      if (a) { const k = 255 / a; o[i] = m[i] * k; o[i + 1] = m[i + 1] * k; o[i + 2] = m[i + 2] * k; o[i + 3] = a; }
    }
    return out;
  }

  // Tilt-shift and iris: five blur levels (sharp + 4 gaussians); each pixel blends the two nearest to its blur amount.
  function levelBlend(img, maxR, amountAt) {
    if (!(maxR > 0)) return copy(img);
    const w = img.width, h = img.height, src = img.data, levels = [src], pre = toPre(img), tmp = new Float32Array(pre.length);
    // Each level blurs the previous one a little more (gaussians add up in quadrature), reusing one float buffer.
    for (let k = 1, prev = 0; k <= 4; k++) {
      const s = maxR * k / 4;
      blurBuf(pre, w, h, 4, Math.sqrt(s * s - prev * prev), tmp);
      levels.push(fromPre(pre, w, h).data);
      prev = s;
    }
    const out = img8(w, h), d = out.data;
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        const t = clamp(amountAt(x + 0.5, y + 0.5), 0, 1) * 4;
        if (t <= 0) { d[i] = src[i]; d[i + 1] = src[i + 1]; d[i + 2] = src[i + 2]; d[i + 3] = src[i + 3]; continue; }
        const k = Math.min(3, Math.floor(t)), f = t - k, A = levels[k], B = levels[k + 1];
        const a0 = A[i + 3] * (1 - f), a1 = B[i + 3] * f, a = a0 + a1;
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++) d[i + c] = (A[i + c] * a0 + B[i + c] * a1) / a;
        d[i + 3] = a;
      }
    }
    return out;
  }
  function tiltshift(img, p) {
    const w = img.width, h = img.height, cx = p.centre.x * w, cy = p.centre.y * h, a = p.angle * RAD;
    const sn = Math.sin(a), cs = Math.cos(a), half = p.width / 200 * h, tr = Math.max(1, p.transition / 100 * h);
    const out = levelBlend(img, p.blur, (x, y) => smooth(clamp((Math.abs(-(x - cx) * sn + (y - cy) * cs) - half) / tr, 0, 1)));
    return satContrast(out, p.saturation, p.contrast);
  }
  function iris(img, p) {
    const w = img.width, h = img.height, cx = p.centre.x * w, cy = p.centre.y * h;
    const R = Math.max(1, p.size / 100 * Math.min(w, h) / 2), asp = Math.max(0.05, p.aspect / 100), tr = Math.max(0.01, p.transition / 100);
    return levelBlend(img, p.blur, (x, y) => {
      const e = Math.hypot((x - cx) / (R * asp), (y - cy) / R);
      return smooth(clamp((e - 1) / tr, 0, 1));
    });
  }

  // ---- Sharpen ----
  function unsharp(img, p) {
    const amt = p.amount / 100;
    if (amt === 0 || !(p.radius > 0)) return copy(img);
    const b = gaussImg(img, p.radius).data, out = copy(img), d = out.data, s = img.data, th = p.threshold;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) { const diff = s[i + c] - b[i + c]; if (Math.abs(diff) >= th) d[i + c] = s[i + c] + diff * amt; }
    }
    return out;
  }
  function sharpen(img, p) {
    const k = p.amount / 100;
    if (k === 0) return copy(img);
    const w = img.width, h = img.height, s = img.data, out = copy(img), d = out.data;
    for (let y = 0; y < h; y++) {
      const up = Math.max(y - 1, 0) * w, dn = Math.min(y + 1, h - 1) * w, row = y * w;
      for (let x = 0; x < w; x++) {
        const l = Math.max(x - 1, 0), r = Math.min(x + 1, w - 1), i = (row + x) * 4;
        for (let c = 0; c < 3; c++) {
          const nb = s[(up + x) * 4 + c] + s[(dn + x) * 4 + c] + s[(row + l) * 4 + c] + s[(row + r) * 4 + c];
          d[i + c] = s[i + c] * (1 + 4 * k) - k * nb;
        }
      }
    }
    return out;
  }
  function highpass(img, p) {
    const b = gaussImg(img, p.radius).data, out = copy(img), d = out.data, s = img.data;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = 128 + s[i + c] - b[i + c];
    return out;
  }
  // Clarity: local contrast from a wide blur of luminance, strongest in the midtones so blacks and whites don't clip.
  function clarity(img, p) {
    const amt = p.amount / 100;
    if (amt === 0) return copy(img);
    const w = img.width, h = img.height, L = lumMap(img), B = blurBuf(new Float32Array(L), w, h, 1, Math.max(1, 0.025 * Math.hypot(w, h)));
    return perPixel(img, (c, i) => {
      const q = i >> 2, l = L[q] / 255, wt = 1 - (2 * l - 1) * (2 * l - 1), delta = amt * (L[q] - B[q]) * wt * 1.5;
      c[0] += delta; c[1] += delta; c[2] += delta;
    });
  }

  // ---- Noise ----
  function noise(img, p, o) {
    const amt = p.amount / 100 * 127;
    if (amt <= 0) return copy(img);
    const rand = rng(o.seed * 2654435761), gauss = p.distribution === 'gaussian';
    const one = () => (gauss ? normal(rand) * 0.5 : rand() * 2 - 1) * amt;
    return perPixel(img, (c) => {
      if (p.monochrome) { const n = one(); c[0] += n; c[1] += n; c[2] += n; } else { c[0] += one(); c[1] += one(); c[2] += one(); }
    });
  }
  function grain(img, p, o) {
    const amt = p.amount / 100;
    if (amt <= 0) return copy(img);
    const w = img.width, h = img.height, n = w * h, rand = rng(o.seed * 40503 + 7), f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = normal(rand);
    const sigma = Math.max(0, (p.size - 1) / 2);
    if (sigma > 0) {
      blurBuf(f, w, h, 1, sigma);
      let ss = 0;
      for (let i = 0; i < n; i++) ss += f[i] * f[i];
      const k = ss > 0 ? 1 / Math.sqrt(ss / n) : 0;
      for (let i = 0; i < n; i++) f[i] *= k;
    }
    return perPixel(img, (c, i) => {
      const l = lum(c[0], c[1], c[2]) / 255, v = f[i >> 2] * amt * 40 * (0.25 + 3 * l * (1 - l));
      c[0] += v; c[1] += v; c[2] += v;
    });
  }
  // Bilateral filter on a 5×5 window: smooths flat areas, leaves real edges (colour jumps) alone.
  function denoise(img, p) {
    const st = p.strength;
    if (st <= 0) return copy(img);
    const w = img.width, h = img.height, s = img.data, out = copy(img), d = out.data;
    const rs = 2 + st * 0.6 * (1 - p.preserve / 100 * 0.7), inv2r = 1 / (2 * rs * rs), sw = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sw.push(Math.exp(-(dx * dx + dy * dy) / (2 * 1.5 * 1.5)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let W = 0, r = 0, g = 0, b = 0, k = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const qy = clamp(y + dy, 0, h - 1) * w;
          for (let dx = -2; dx <= 2; dx++, k++) {
            const q = (qy + clamp(x + dx, 0, w - 1)) * 4, dr = s[q] - s[i], dg = s[q + 1] - s[i + 1], db = s[q + 2] - s[i + 2];
            const wt = sw[k] * Math.exp(-(dr * dr + dg * dg + db * db) * inv2r / 3) * s[q + 3];
            W += wt; r += wt * s[q]; g += wt * s[q + 1]; b += wt * s[q + 2];
          }
        }
        if (W > 0) { d[i] = r / W; d[i + 1] = g / W; d[i + 2] = b / W; }
      }
    }
    return out;
  }
  function dust(img, p) {
    if (Math.round(p.radius) < 1) return copy(img);
    const m = medianImg(img, p.radius).data, s = img.data, out = copy(img), d = out.data, th = p.threshold;
    for (let i = 0; i < d.length; i += 4) {
      const diff = Math.max(Math.abs(s[i] - m[i]), Math.abs(s[i + 1] - m[i + 1]), Math.abs(s[i + 2] - m[i + 2]), Math.abs(s[i + 3] - m[i + 3]));
      if (diff > th) { d[i] = m[i]; d[i + 1] = m[i + 1]; d[i + 2] = m[i + 2]; d[i + 3] = m[i + 3]; }
    }
    return out;
  }

  // ---- Stylize ----
  function emboss(img, p) {
    const w = img.width, h = img.height, L = lumMap(img), ox = Math.cos(p.angle * RAD) * p.height, oy = -Math.sin(p.angle * RAD) * p.height;
    const k = p.amount / 100;
    return perPixel(img, (c, i) => {
      const q = i >> 2, x = q % w, y = (q - x) / w;
      const v = 128 + (sampleF(L, w, h, x - ox, y - oy) - sampleF(L, w, h, x + ox, y + oy)) * k;
      c[0] = c[1] = c[2] = v;
    });
  }
  function edges(img) {
    const w = img.width, h = img.height, s = img.data;
    return perPixel(img, (c, i) => {
      const q = i >> 2, x = q % w, y = (q - x) / w, xl = Math.max(x - 1, 0), xr = Math.min(x + 1, w - 1);
      const yu = Math.max(y - 1, 0) * w, yd = Math.min(y + 1, h - 1) * w, ym = y * w;
      for (let ch = 0; ch < 3; ch++) {
        const v = (xx, yy) => s[(yy + xx) * 4 + ch];
        const gx = v(xr, yu) + 2 * v(xr, ym) + v(xr, yd) - v(xl, yu) - 2 * v(xl, ym) - v(xl, yd);
        const gy = v(xl, yd) + 2 * v(x, yd) + v(xr, yd) - v(xl, yu) - 2 * v(x, yu) - v(xr, yu);
        c[ch] = 255 - Math.min(255, Math.hypot(gx, gy) * 0.5);
      }
    });
  }
  function screenOver(img, layer, strength) {
    const out = copy(img), d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) { const b = Math.min(255, layer[i + c] * strength); d[i + c] = 255 - (255 - d[i + c]) * (255 - b) / 255; }
    }
    return out;
  }
  function glow(img, p) {
    const s = p.strength / 100;
    if (s <= 0) return copy(img);
    const w = img.width, h = img.height, src = img.data, pre = new Float32Array(src.length), th = p.threshold;
    for (let i = 0; i < src.length; i += 4) {
      const l = lum(src[i], src[i + 1], src[i + 2]), k = th >= 255 ? 0 : Math.max(0, (l - th) / (255 - th)), a = src[i + 3] / 255;
      pre[i] = src[i] * k * a; pre[i + 1] = src[i + 1] * k * a; pre[i + 2] = src[i + 2] * k * a; pre[i + 3] = src[i + 3];
    }
    blurBuf(pre, w, h, 4, p.radius);
    // The glow is light, so its premultiplied colour is screened on as is (it spreads past the bright parts).
    return screenOver(img, pre, s);
  }
  function orton(img, p) {
    const s = p.strength / 100;
    if (s <= 0) return copy(img);
    const scr = perPixel(img, (c) => { for (let k = 0; k < 3; k++) c[k] = 255 - (255 - c[k]) * (255 - c[k]) / 255; });
    const b = gaussImg(scr, p.blur).data, out = copy(img), d = out.data, sc = scr.data;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (1 - s) + (sc[i + c] * b[i + c] / 255) * s;
    return out;
  }
  // Kuwahara: of the four quadrants around a pixel, take the mean of the calmest one (least luminance variance).
  function oil(img, p) {
    const r = clamp(Math.round(p.radius), 0, 12);
    if (r < 1) return copy(img);
    const w = img.width, h = img.height, n = w * h, s = img.data, ch = 6, buf = new Float32Array(n * ch);
    for (let q = 0; q < n; q++) {
      const i = q * 4, o = q * ch, a = s[i + 3] / 255, pr = s[i] * a, pg = s[i + 1] * a, pb = s[i + 2] * a, l = lum(pr, pg, pb);
      buf[o] = pr; buf[o + 1] = pg; buf[o + 2] = pb; buf[o + 3] = s[i + 3]; buf[o + 4] = l; buf[o + 5] = l * l;
    }
    // Trailing box sums: T(x, y) = sum over [x-r..x] × [y-r..y], edges clamped.
    const tmp = new Float32Array(buf.length), row = w * ch;
    for (let y = 0; y < h; y++) {
      const o = y * row;
      for (let c = 0; c < ch; c++) {
        const first = buf[o + c];
        let sum = first * (r + 1);
        for (let x = 0; x < w; x++) {
          if (x > 0) sum += buf[o + x * ch + c] - (x - r - 1 > 0 ? buf[o + (x - r - 1) * ch + c] : first);
          tmp[o + x * ch + c] = sum;
        }
      }
    }
    const acc = new Float64Array(row);
    for (let i = 0; i < row; i++) acc[i] = tmp[i] * (r + 1);
    for (let y = 0; y < h; y++) {
      const o = y * row;
      if (y > 0) { const so = Math.max(y - r - 1, 0) * row; for (let i = 0; i < row; i++) acc[i] += tmp[o + i] - tmp[so + i]; }
      for (let i = 0; i < row; i++) buf[o + i] = acc[i];
    }
    const cnt = (r + 1) * (r + 1), out = new Float32Array(n * 4);
    for (let y = 0; y < h; y++) {
      const yb = Math.min(y + r, h - 1);
      for (let x = 0; x < w; x++) {
        const xr = Math.min(x + r, w - 1), quads = [(y * w + x) * ch, (y * w + xr) * ch, (yb * w + x) * ch, (yb * w + xr) * ch];
        let best = quads[0], bv = Infinity;
        for (const q of quads) { const m = buf[q + 4] / cnt, v = buf[q + 5] / cnt - m * m; if (v < bv) { bv = v; best = q; } }
        const o = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) out[o + c] = buf[best + c] / cnt;
      }
    }
    return fromPre(out, w, h);
  }
  function pixelate(img, p) {
    const cell = Math.max(1, Math.round(p.cell));
    if (cell <= 1) return copy(img);
    const w = img.width, h = img.height, s = img.data, out = img8(w, h), d = out.data;
    for (let by = 0; by < h; by += cell) {
      for (let bx = 0; bx < w; bx += cell) {
        const ey = Math.min(by + cell, h), ex = Math.min(bx + cell, w);
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4, al = s[i + 3];
          r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; n++;
        }
        const k = a > 0 ? 1 / a : 0;
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          d[i] = r * k; d[i + 1] = g * k; d[i + 2] = b * k; d[i + 3] = a / n;
        }
      }
    }
    return out;
  }
  // Halftone: a rotated grid of dots per ink (C, M, Y at classic screen angles, or one black screen); dot area ∝ ink.
  function halftone(img, p) {
    const size = Math.max(2, p.size), w = img.width, h = img.height, b = gaussImg(img, size / 3).data, s = img.data;
    const mono = p.mode === 'mono', base = p.angle * RAD;
    const screens = mono ? [[base + 45 * RAD, -1]] : [[base + 15 * RAD, 0], [base + 75 * RAD, 1], [base, 2]];
    const out = copy(img), d = out.data;
    for (const [ang, ch] of screens) {
      const cs = Math.cos(ang), sn = Math.sin(ang);
      for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i += 4) {
          const px = x + 0.5, py = y + 0.5, u = (px * cs + py * sn) / size, v = (-px * sn + py * cs) / size;
          const cu = (Math.floor(u) + 0.5) * size, cv = (Math.floor(v) + 0.5) * size, gx = cu * cs - cv * sn, gy = cu * sn + cv * cs;
          const val = ch < 0
            ? lum(sampleCh(b, w, h, gx - 0.5, gy - 0.5, 0), sampleCh(b, w, h, gx - 0.5, gy - 0.5, 1), sampleCh(b, w, h, gx - 0.5, gy - 0.5, 2))
            : sampleCh(b, w, h, gx - 0.5, gy - 0.5, ch);
          const ink = 1 - val / 255, rad = size * Math.SQRT1_2 * Math.sqrt(Math.max(0, ink));
          const cover = clamp(rad - Math.hypot(px - gx, py - gy) + 0.5, 0, 1), v8 = 255 * (1 - cover);
          if (ch < 0) { d[i] = d[i + 1] = d[i + 2] = v8; } else d[i + ch] = v8;
        }
      }
    }
    for (let i = 3; i < d.length; i += 4) d[i] = s[i];
    return out;
  }
  function vignette(img, p) {
    const amt = p.amount / 100;
    if (amt === 0) return copy(img);
    const w = img.width, h = img.height, round = p.roundness / 100, inner = p.size / 100, feather = Math.max(0.01, p.feather / 100);
    const m = Math.min(w, h);
    // Roundness 0 follows the picture's shape (an ellipse), 100 is a true circle.
    const sx = (w / 2) * (1 - round) + (m / 2) * round, sy = (h / 2) * (1 - round) + (m / 2) * round;
    return perPixel(img, (c, i) => {
      const q = i >> 2, x = q % w, y = (q - x) / w, r = Math.hypot((x + 0.5 - w / 2) / sx, (y + 0.5 - h / 2) / sy);
      const t = smooth(clamp((r - inner) / feather, 0, 1)) * Math.abs(amt);
      for (let k = 0; k < 3; k++) c[k] = amt < 0 ? c[k] * (1 - t) : c[k] + (255 - c[k]) * t;
    });
  }
  function chromatic(img, p) {
    const a = p.amount, w = img.width, h = img.height;
    if (a === 0) return copy(img);
    const s = img.data, cx = w / 2, cy = h / 2, R = Math.max(1, Math.hypot(w, h) / 2), kr = 1 / (1 + a / R), kb = 1 / (1 - a / R);
    return perPixel(img, (c, i) => {
      const q = i >> 2, x = q % w, y = (q - x) / w, dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      c[0] = sampleCh(s, w, h, cx + dx * kr - 0.5, cy + dy * kr - 0.5, 0);
      c[2] = sampleCh(s, w, h, cx + dx * kb - 0.5, cy + dy * kb - 0.5, 2);
    });
  }
  function glitch(img, p, o) {
    const sh = Math.round(p.shift), w = img.width, h = img.height;
    if (p.amount <= 0 && sh === 0) return copy(img);
    const rand = rng(o.seed * 9301 + 49297), tmp = new Uint8ClampedArray(img.data), rowBuf = new Uint8ClampedArray(w * 4);
    const n = p.amount > 0 ? Math.round(p.slices) : 0;
    for (let k = 0; k < n; k++) {
      const y0 = Math.floor(rand() * h), hh = 1 + Math.floor(rand() * h * 0.12 * p.amount / 100);
      const off = Math.round((rand() * 2 - 1) * w * 0.3 * p.amount / 100);
      for (let y = y0; y < Math.min(h, y0 + hh); y++) {
        const ro = y * w * 4;
        rowBuf.set(tmp.subarray(ro, ro + w * 4));
        for (let x = 0; x < w; x++) { const si = mod(x - off, w) * 4, di = ro + x * 4; for (let c = 0; c < 4; c++) tmp[di + c] = rowBuf[si + c]; }
      }
    }
    const out = img8(w, h), d = out.data;
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        d[i] = tmp[(y * w + mod(x - sh, w)) * 4]; d[i + 1] = tmp[i + 1]; d[i + 2] = tmp[(y * w + mod(x + sh, w)) * 4 + 2]; d[i + 3] = tmp[i + 3];
      }
    }
    return out;
  }
  function solarize(img, p) {
    const t = p.threshold, lut = lutOf((v) => (v > t ? 255 - v : v));
    return withLuts(img, lut, lut, lut);
  }
  // Pencil sketch: colour-dodge the greyscale with its blurred negative; flat areas go white, edges stay as strokes.
  function sketch(img, p) {
    const w = img.width, h = img.height, L = lumMap(img), B = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) B[i] = 255 - L[i];
    blurBuf(B, w, h, 1, Math.max(0.5, p.width));
    const ex = 1 + p.darkness / 50;
    return perPixel(img, (c, i) => {
      const q = i >> 2, v = B[q] >= 255 ? 255 : Math.min(255, L[q] * 255 / (255 - B[q]));
      c[0] = c[1] = c[2] = 255 * Math.pow(v / 255, ex);
    });
  }

  // ---- Distort ----
  function offset(img, p) {
    const w = img.width, h = img.height, ox = mod(Math.round(p.x), w), oy = mod(Math.round(p.y), h);
    if (!ox && !oy) return copy(img);
    const s = img.data, out = img8(w, h), d = out.data;
    for (let y = 0; y < h; y++) {
      const sy = mod(y - oy, h);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, j = (sy * w + mod(x - ox, w)) * 4;
        d[i] = s[j]; d[i + 1] = s[j + 1]; d[i + 2] = s[j + 2]; d[i + 3] = s[j + 3];
      }
    }
    return out;
  }
  function twirl(img, p) {
    const w = img.width, h = img.height, ang = p.angle * RAD, R = p.radius / 100 * Math.min(w, h) / 2;
    if (ang === 0 || R <= 0) return copy(img);
    const cx = p.centre.x * w, cy = p.centre.y * h;
    return warp(img, (x, y, pt) => {
      const dx = x - cx, dy = y - cy, dd = Math.hypot(dx, dy);
      if (dd >= R) { pt[0] = x; pt[1] = y; return; }
      const a = ang * (1 - dd / R) * (1 - dd / R), cs = Math.cos(a), sn = Math.sin(a);
      pt[0] = cx + dx * cs - dy * sn; pt[1] = cy + dx * sn + dy * cs;
    });
  }
  function pinch(img, p) {
    const w = img.width, h = img.height, a = p.amount / 100, R = p.radius / 100 * Math.min(w, h) / 2;
    if (a === 0 || R <= 0) return copy(img);
    const cx = p.centre.x * w, cy = p.centre.y * h, e = a > 0 ? 1 - a * 0.5 : 1 - a;
    return warp(img, (x, y, pt) => {
      const dx = x - cx, dy = y - cy, dd = Math.hypot(dx, dy);
      if (dd >= R || dd === 0) { pt[0] = x; pt[1] = y; return; }
      // Pinch looks further out (dn^e > dn), bloat looks nearer; easing back to dn keeps the rim seamless.
      const dn = dd / R, s = Math.pow(dn, e), f = (s + (dn - s) * dn * dn) / dn;
      pt[0] = cx + dx * f; pt[1] = cy + dy * f;
    });
  }
  function ripple(img, p) {
    const A = p.amplitude, L = Math.max(1, p.wavelength), k = 2 * Math.PI / L;
    if (A === 0) return copy(img);
    const hz = p.direction !== 'vertical', vt = p.direction !== 'horizontal';
    return warp(img, (x, y, pt) => { pt[0] = hz ? x + A * Math.sin(y * k) : x; pt[1] = vt ? y + A * Math.sin(x * k) : y; });
  }
  function lensDistort(img, p) {
    const k = p.amount / 100 * 0.5, z = Math.max(0.01, p.zoom / 100), w = img.width, h = img.height;
    if (k === 0 && z === 1) return copy(img);
    const cx = w / 2, cy = h / 2, R2 = Math.max(1, (w * w + h * h) / 4);
    return warp(img, (x, y, pt) => {
      const dx = x - cx, dy = y - cy, f = (1 + k * (dx * dx + dy * dy) / R2) / z;
      pt[0] = cx + dx * f; pt[1] = cy + dy * f;
    });
  }
  function polar(img, p) {
    const w = img.width, h = img.height, cx = w / 2, cy = h / 2, R = Math.max(1e-6, Math.min(w, h) / 2), TAU = 2 * Math.PI;
    if (p.mode === 'from_polar') {
      return warp(img, (x, y, pt) => { const t = x / w * TAU, r = y / h * R; pt[0] = cx + r * Math.sin(t); pt[1] = cy - r * Math.cos(t); });
    }
    // To polar: the rectangle is wrapped into a disc, its top edge at the centre; wraps across the seam.
    return warp(img, (x, y, pt) => {
      const dx = x - cx, dy = y - cy;
      pt[0] = mod(Math.atan2(dx, -dy), TAU) / TAU * w; pt[1] = Math.hypot(dx, dy) / R * h;
    }, true, false);
  }

  // ---- Render ----
  function clouds(img, p, o) {
    const w = img.width, h = img.height, out = img8(w, h), d = out.data, A = hexRgb(p.a), B = hexRgb(p.b);
    const seed = Math.imul(Math.round(p.seed), 7919) + Math.imul(o.seed | 0, 104729) | 0, inv = 1 / Math.max(1, p.scale);
    const oct = clamp(Math.round(p.detail), 1, 10);
    const hash = (x, y) => {
      let t = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed | 0;
      t = Math.imul(t ^ (t >>> 13), 1274126177);
      return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
    };
    const vnoise = (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), e = hash(x0 + 1, y0 + 1);
      return (a + (b - a) * sx) * (1 - sy) + (c + (e - c) * sx) * sy;
    };
    let norm = 0;
    for (let k = 0, amp = 1; k < oct; k++, amp *= 0.5) norm += amp;
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        let v = 0;
        for (let k = 0, amp = 1, f = inv; k < oct; k++, amp *= 0.5, f *= 2) v += amp * vnoise((x + 0.5) * f + k * 31.7, (y + 0.5) * f + k * 17.3);
        const t = clamp((v / norm - 0.5) * 1.6 + 0.5, 0, 1);
        d[i] = A[0] + (B[0] - A[0]) * t; d[i + 1] = A[1] + (B[1] - A[1]) * t; d[i + 2] = A[2] + (B[2] - A[2]) * t; d[i + 3] = 255;
      }
    }
    return out;
  }
  // Lens flare: a hot core with a soft halo and a horizontal streak, plus ghosts on the line through the picture centre.
  const GHOSTS = [
    [0.35, 0.02, [255, 190, 120], false], [0.6, 0.045, [120, 255, 160], false], [0.85, 0.03, [140, 170, 255], false],
    [1.25, 0.07, [255, 120, 200], true], [1.6, 0.11, [120, 200, 255], true], [1.9, 0.04, [255, 230, 150], false],
  ];
  function flare(img, p) {
    const k = p.brightness / 100;
    if (k <= 0) return copy(img);
    const w = img.width, h = img.height, fx = p.centre.x * w, fy = p.centre.y * h, S = Math.max(1, Math.hypot(w, h));
    const g = GHOSTS.map(([t, rf, col, ring]) => [fx + (w / 2 - fx) * t, fy + (h / 2 - fy) * t, rf * S, col, ring]);
    const light = new Float32Array(w * h * 4);
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        const dx = x + 0.5 - fx, dy = y + 0.5 - fy, dd = Math.hypot(dx, dy);
        const streak = Math.exp(-Math.abs(dy) / (0.004 * S)) * Math.exp(-Math.abs(dx) / (0.3 * S));
        const core = Math.exp(-((dd / (0.035 * S)) ** 2)) + 0.35 * Math.exp(-dd / (0.12 * S)) + 0.5 * streak;
        let r = 255 * core, gg = 245 * core, b = 220 * core;
        for (const [gx, gy, rr, col, ring] of g) {
          const dg = Math.hypot(x + 0.5 - gx, y + 0.5 - gy);
          const v = ring ? 0.25 * Math.exp(-(((dg - rr) / (rr * 0.08 + 0.5)) ** 2)) : 0.18 * clamp((rr - dg) / (rr * 0.3 + 0.5), 0, 1);
          r += col[0] * v; gg += col[1] * v; b += col[2] * v;
        }
        light[i] = r; light[i + 1] = gg; light[i + 2] = b;
      }
    }
    return screenOver(img, light, k);
  }

  // ---- Adjustments ----
  function brightness(img, p) {
    const b = p.brightness, c = p.contrast / 100;
    if (!b && !c) return copy(img);
    // Brightness bends a gamma curve (ends stay put, nothing clips); contrast pulls towards an S-curve or towards grey.
    const g = Math.pow(2, -b / 75);
    const lut = lutOf((v) => {
      let x = Math.pow(v / 255, g);
      if (c > 0) x += (smooth(x) - x) * c * 1.5; else if (c < 0) x = 0.5 + (x - 0.5) * (1 + c * 0.75);
      return clamp(x, 0, 1) * 255;
    });
    return withLuts(img, lut, lut, lut);
  }
  function levelsLut(p) {
    const lo = clamp(p.inLow, 0, 254), hi = Math.max(clamp(p.inHigh, 1, 255), lo + 1), g = clamp(p.gamma, 0.01, 99);
    return lutOf((v) => p.outLow + Math.pow(clamp((v - lo) / (hi - lo), 0, 1), 1 / g) * (p.outHigh - p.outLow));
  }
  function levels(img, p) {
    const lut = levelsLut(p), id = lutOf((v) => v), ch = p.channel;
    return withLuts(img, ch === 'rgb' || ch === 'r' ? lut : id, ch === 'rgb' || ch === 'g' ? lut : id, ch === 'rgb' || ch === 'b' ? lut : id);
  }
  /** Monotone cubic (Fritsch–Carlson) through the points; flat beyond the first and last point. */
  function curveLut(points) {
    const pts = [];
    for (const pt of Array.isArray(points) ? points : []) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const x = clamp(Number(pt[0]) || 0, 0, 255), y = clamp(Number(pt[1]) || 0, 0, 255);
      const same = pts.findIndex((q) => q[0] === x);
      if (same >= 0) pts[same] = [x, y]; else pts.push([x, y]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    const n = pts.length, lut = new Uint8Array(256);
    if (!n) { for (let v = 0; v < 256; v++) lut[v] = v; return lut; }
    if (n === 1) return lut.fill(Math.round(pts[0][1]));
    const del = [], t = new Array(n);
    for (let i = 0; i < n - 1; i++) del.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
    t[0] = del[0]; t[n - 1] = del[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = del[i - 1] * del[i] <= 0 ? 0 : (del[i - 1] + del[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (del[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / del[i], b = t[i + 1] / del[i], s = a * a + b * b;
      if (s > 9) { const tau = 3 / Math.sqrt(s); t[i] = tau * a * del[i]; t[i + 1] = tau * b * del[i]; }
    }
    let seg = 0;
    for (let v = 0; v < 256; v++) {
      let y;
      if (v <= pts[0][0]) y = pts[0][1];
      else if (v >= pts[n - 1][0]) y = pts[n - 1][1];
      else {
        while (v > pts[seg + 1][0]) seg++;
        const x0 = pts[seg][0], hh = pts[seg + 1][0] - x0, u = (v - x0) / hh, u2 = u * u, u3 = u2 * u;
        y = (2 * u3 - 3 * u2 + 1) * pts[seg][1] + (u3 - 2 * u2 + u) * hh * t[seg] + (-2 * u3 + 3 * u2) * pts[seg + 1][1] + (u3 - u2) * hh * t[seg + 1];
      }
      lut[v] = clamp(Math.round(y), 0, 255);
    }
    return lut;
  }
  function curves(img, p) {
    const c = p.curve || {}, all = curveLut(c.rgb || [[0, 0], [255, 255]]);
    const one = (pts) => { const l = curveLut(pts || [[0, 0], [255, 255]]); return lutOf((v) => all[l[v]]); };
    return withLuts(img, one(c.r), one(c.g), one(c.b));
  }
  const toLin = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const toSrgb = (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
  function exposure(img, p) {
    if (!p.exposure && !p.offset && p.gamma === 1) return copy(img);
    const m = Math.pow(2, p.exposure), g = clamp(p.gamma, 0.01, 99);
    const lut = lutOf((v) => 255 * toSrgb(Math.pow(Math.max(0, toLin(v / 255) * m + p.offset), 1 / g)));
    return withLuts(img, lut, lut, lut);
  }
  function lightness(c, l) {
    for (let k = 0; k < 3; k++) c[k] = l > 0 ? c[k] + (255 - c[k]) * l : c[k] * (1 + l);
  }
  function huesat(img, p) {
    const dh = p.hue / 360, s = p.saturation / 100, l = p.lightness / 100, hsl = [0, 0, 0];
    if (!p.colorize && !dh && !s && !l) return copy(img);
    return perPixel(img, (c) => {
      toHsl(c[0], c[1], c[2], hsl);
      if (p.colorize) fromHsl(mod(p.hue, 360) / 360, (s + 1) / 2 * 0.5, hsl[2], c);
      else if (dh || s) fromHsl(mod(hsl[0] + dh, 1), clamp(hsl[1] * (1 + s), 0, 1), hsl[2], c);
      if (l) lightness(c, l);
    });
  }
  function vibrance(img, p) {
    const vb = p.vibrance / 100, s = p.saturation / 100;
    if (!vb && !s) return copy(img);
    return perPixel(img, (c) => {
      const max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]), L = lum(c[0], c[1], c[2]);
      // Muted colours get more; warm orange-ish tones (where faces live) get half, so skin doesn't turn orange.
      const skin = c[0] > c[1] && c[1] > c[2] && (c[1] - c[2]) > 0.15 * (c[0] - c[2]);
      const k = vb > 0 ? vb * (1 - (max - min) / 255) * (skin ? 0.5 : 1) * 1.5 : vb, f = (1 + k) * (1 + s);
      for (let j = 0; j < 3; j++) c[j] = L + (c[j] - L) * f;
    });
  }
  const BAL = ['s', 'm', 'h'];
  function balance(img, p) {
    const v = BAL.map((r) => [p[r + 'CR'], p[r + 'MG'], p[r + 'YB']].map((x) => x / 100 * 64));
    if (v.every((r) => r.every((x) => !x))) return copy(img);
    return perPixel(img, (c) => {
      const L0 = lum(c[0], c[1], c[2]), l = L0 / 255, ws = 1 - smooth(clamp(l * 2, 0, 1)), wh = smooth(clamp(l * 2 - 1, 0, 1)), wm = 1 - ws - wh;
      for (let k = 0; k < 3; k++) c[k] += v[0][k] * ws + v[1][k] * wm + v[2][k] * wh;
      if (p.preserve) setLum(c, L0);
    });
  }
  // Black & white: grey = min + (max − mid)·weight(primary) + (mid − min)·weight(the mix of the two top channels).
  function bw(img, p) {
    const W = { r: p.reds / 100, g: p.greens / 100, b: p.blues / 100, gr: p.yellows / 100, bg: p.cyans / 100, br: p.magentas / 100 };
    const T = hexRgb(p.tintColour), TL = lum(T[0], T[1], T[2]);
    return perPixel(img, (c) => {
      const names = ['r', 'g', 'b'], ord = [0, 1, 2].sort((x, y) => c[y] - c[x]);
      const max = c[ord[0]], mid = c[ord[1]], min = c[ord[2]], two = [names[ord[0]], names[ord[1]]].sort().join('');
      const grey = min + (max - mid) * W[names[ord[0]]] + (mid - min) * W[two];
      if (p.tint) {
        const k = 1 - Math.abs(clamp(grey, 0, 255) / 127.5 - 1);
        c[0] = grey + (T[0] - TL) * k; c[1] = grey + (T[1] - TL) * k; c[2] = grey + (T[2] - TL) * k;
      } else c[0] = c[1] = c[2] = grey;
    });
  }
  function photofilter(img, p) {
    const dn = p.density / 100, F = hexRgb(p.colour);
    if (dn <= 0) return copy(img);
    return perPixel(img, (c) => {
      const L0 = lum(c[0], c[1], c[2]);
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - dn) + (c[k] * F[k] / 255) * dn;
      if (p.preserve) setLum(c, L0);
    });
  }
  function temperature(img, p) {
    const t = p.temperature / 100, n = p.tint / 100;
    if (!t && !n) return copy(img);
    const mk = (k) => lutOf((v) => 255 * toSrgb(Math.min(1, toLin(v / 255) * k)));
    return withLuts(img, mk((1 + 0.3 * t) * (1 + 0.1 * n)), mk(1 - 0.2 * n), mk((1 - 0.3 * t) * (1 + 0.1 * n)));
  }
  function shadows(img, p) {
    const s = p.shadows / 100, hl = p.highlights / 100;
    if (!s && !hl) return copy(img);
    const w = img.width, h = img.height, L = lumMap(img), M = blurBuf(new Float32Array(L), w, h, 1, p.radius);
    return perPixel(img, (c, i) => {
      const q = i >> 2, l = L[q] / 255, m = clamp(M[q] / 255, 0, 1);
      let l2 = l;
      if (s) l2 = Math.pow(l2, 1 / (1 + 2 * s * (1 - m) * (1 - m)));
      if (hl) l2 = 1 - Math.pow(1 - l2, 1 / (1 + 2 * hl * m * m));
      if (l > 1e-4) { const k = l2 / l; for (let j = 0; j < 3; j++) c[j] *= k; } else setLum(c, l2 * 255);
    });
  }
  function invert(img) { const lut = lutOf((v) => 255 - v); return withLuts(img, lut, lut, lut); }
  function posterize(img, p) {
    const n = clamp(Math.round(p.levels), 2, 255), lut = lutOf((v) => Math.round(v / 255 * (n - 1)) / (n - 1) * 255);
    return withLuts(img, lut, lut, lut);
  }
  function threshold(img, p) {
    return perPixel(img, (c) => { c[0] = c[1] = c[2] = lum(c[0], c[1], c[2]) >= p.level ? 255 : 0; });
  }
  function gradientmap(img, p) {
    const cols = (Array.isArray(p.gradient) && p.gradient.length >= 2 ? p.gradient : ['#000000', '#ffffff']).slice(0, 3).map(hexRgb);
    const seg = cols.length - 1, lut = [0, 1, 2].map((k) => lutOf((v) => {
      const t = v / 255 * seg, j = Math.min(seg - 1, Math.floor(t)), f = t - j;
      return cols[j][k] + (cols[j + 1][k] - cols[j][k]) * f;
    }));
    return perPixel(img, (c) => { const l = clamp(Math.round(lum(c[0], c[1], c[2])), 0, 255); c[0] = lut[0][l]; c[1] = lut[1][l]; c[2] = lut[2][l]; });
  }
  // Selective colour: cyan, magenta, yellow and black added to (or taken from) one family of colours, the more the
  // more a pixel belongs to it; relative scales with what is there, absolute adds the same everywhere in it.
  const RANGES = {
    reds: (r, g, b) => (r >= g && r >= b ? r - Math.max(g, b) : 0), yellows: (r, g, b) => (b <= r && b <= g ? Math.min(r, g) - b : 0),
    greens: (r, g, b) => (g >= r && g >= b ? g - Math.max(r, b) : 0), cyans: (r, g, b) => (r <= g && r <= b ? Math.min(g, b) - r : 0),
    blues: (r, g, b) => (b >= r && b >= g ? b - Math.max(r, g) : 0), magentas: (r, g, b) => (g <= r && g <= b ? Math.min(r, b) - g : 0),
    whites: (r, g, b) => Math.max(0, Math.min(r, g, b) - 128) * 2, blacks: (r, g, b) => Math.max(0, 128 - Math.max(r, g, b)) * 2,
    neutrals: (r, g, b) => Math.max(0, 255 - (Math.abs(Math.max(r, g, b) - 128) + Math.abs(Math.min(r, g, b) - 128))),
  };
  function selective(img, p) {
    const f = RANGES[p.range] || RANGES.reds, rel = p.method !== 'absolute', adj = [p.cyan / 100, p.magenta / 100, p.yellow / 100], k = p.black / 100;
    if (!adj[0] && !adj[1] && !adj[2] && !k) return copy(img);
    return perPixel(img, (c) => {
      const w = f(c[0], c[1], c[2]) / 255;
      if (!w) return;
      for (let ch = 0; ch < 3; ch++) {
        const ink = 1 - c[ch] / 255, base = rel ? ink : 1;
        c[ch] = (1 - clamp(ink + base * (adj[ch] + k) * w, 0, 1)) * 255;
      }
    });
  }
  // A box blur: every pixel the plain average of a square round it.
  function boxImg(img, p) {
    const r = Math.round(p.radius);
    if (r < 1) return copy(img);
    const pre = toPre(img), tmp = new Float32Array(pre.length);
    boxH(pre, tmp, img.width, img.height, 4, r);
    boxV(tmp, pre, img.width, img.height, 4, r);
    return fromPre(pre, img.width, img.height);
  }
  function desaturate(img) { return perPixel(img, (c) => { c[0] = c[1] = c[2] = lum(c[0], c[1], c[2]); }); }
  const MIX = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'];
  function channelmix(img, p) {
    const m = MIX.map((k) => p[k] / 100);
    if (!p.monochrome && m.every((v, i) => v === (i % 4 === 0 ? 1 : 0))) return copy(img);
    return perPixel(img, (c) => {
      const [r, g, b] = c;
      c[0] = r * m[0] + g * m[1] + b * m[2];
      if (p.monochrome) { c[1] = c[2] = c[0]; return; }
      c[1] = r * m[3] + g * m[4] + b * m[5];
      c[2] = r * m[6] + g * m[7] + b * m[8];
    });
  }

  // ---- Parameters ----
  const range = (key, label, min, max, value, more) => ({ key, label, type: 'range', min, max, step: 1, value, ...more });
  const px = (key, label, min, max, value, more) => range(key, label, min, max, value, { unit: 'px', px: true, ...more });
  const pct = (key, label, min, max, value) => range(key, label, min, max, value, { unit: '%' });
  const deg = (key, label, min, max, value) => range(key, label, min, max, value, { unit: '°' });
  const select = (key, label, options, value) => ({ key, label, type: 'select', options, value });
  const check = (key, label, value) => ({ key, label, type: 'check', value });
  const colour = (key, label, value) => ({ key, label, type: 'colour', value });
  const centre = () => ({ key: 'centre', label: 'Centre', type: 'point', value: { x: 0.5, y: 0.5 } });

  const FILTERS = [
    { id: 'gaussian', name: 'Gaussian blur', group: 'Blur', run: (i, p) => gaussImg(i, p.radius),
      about: 'Softens the picture evenly; the radius sets how far each pixel spreads.',
      params: [px('radius', 'Radius', 0, 250, 4, { step: 0.1 })] },
    { id: 'box', name: 'Box blur', group: 'Blur', run: boxImg,
      about: 'Averages each pixel with a square round it: a flat, even blur (good for masks and backgrounds).',
      params: [px('radius', 'Radius', 0, 250, 5)] },
    { id: 'motion', name: 'Motion blur', group: 'Blur', run: motion,
      about: 'Smears the picture along a direction, like a camera moving during the shot.',
      params: [deg('angle', 'Angle', -180, 180, 0), px('distance', 'Distance', 0, 200, 20)] },
    { id: 'radial', name: 'Zoom blur', group: 'Blur', run: radial,
      about: 'Streaks rush out from a centre, like zooming during the exposure.',
      params: [centre(), pct('amount', 'Amount', 0, 100, 30)] },
    { id: 'spin', name: 'Spin blur', group: 'Blur', run: spin,
      about: 'Blurs in circles around a centre, like a spinning wheel.',
      params: [centre(), deg('angle', 'Angle', 0, 90, 10)] },
    { id: 'lens', name: 'Lens blur', group: 'Blur', run: lens,
      about: 'A camera-like out-of-focus blur: bright spots bloom into round discs (bokeh).',
      params: [px('radius', 'Radius', 0, 60, 8), pct('brightness', 'Highlight brightness', 0, 100, 40), range('threshold', 'Highlight threshold', 0, 255, 200)] },
    { id: 'surface', name: 'Surface blur', group: 'Blur', run: surface,
      about: 'Smooths flat areas while keeping edges sharp; the threshold sets how different an edge must be.',
      params: [px('radius', 'Radius', 0, 25, 5), range('threshold', 'Threshold', 0, 255, 15)] },
    { id: 'median', name: 'Median', group: 'Blur', run: (i, p) => medianImg(i, p.radius),
      about: 'Replaces each pixel with the middle value around it: removes specks, rounds off detail.',
      params: [px('radius', 'Radius', 0, 10, 2)] },
    { id: 'tiltshift', name: 'Tilt-shift', group: 'Blur', run: tiltshift,
      about: 'Keeps a band sharp and blurs more with distance from it, so scenes look like miniatures.',
      params: [centre(), deg('angle', 'Angle', -90, 90, 0), pct('width', 'Focus width', 0, 100, 20), pct('transition', 'Transition', 1, 100, 25),
        px('blur', 'Blur', 0, 60, 12), pct('saturation', 'Saturation boost', 0, 100, 20), pct('contrast', 'Contrast boost', 0, 100, 10)] },
    { id: 'iris', name: 'Iris blur', group: 'Blur', run: iris,
      about: 'Keeps an oval area sharp and blurs everything outside it more and more.',
      params: [centre(), pct('size', 'Focus size', 0, 200, 40), pct('transition', 'Transition', 1, 200, 50), px('blur', 'Blur', 0, 60, 12),
        pct('aspect', 'Aspect', 25, 400, 100)] },

    { id: 'unsharp', name: 'Unsharp mask', group: 'Sharpen', run: unsharp,
      about: 'Sharpens by boosting the difference from a blurred copy; the threshold leaves smooth areas alone.',
      params: [pct('amount', 'Amount', 0, 500, 100), px('radius', 'Radius', 0.1, 100, 1.5, { step: 0.1 }), range('threshold', 'Threshold', 0, 255, 0)] },
    { id: 'sharpen', name: 'Sharpen', group: 'Sharpen', run: sharpen,
      about: 'A quick, fine sharpen of the smallest details.',
      params: [pct('amount', 'Amount', 0, 200, 50)] },
    { id: 'highpass', name: 'High pass', group: 'Sharpen', run: highpass,
      about: 'Keeps only the detail, on mid grey; blend it with Overlay to sharpen.',
      params: [px('radius', 'Radius', 0.1, 250, 10, { step: 0.1 })] },
    { id: 'clarity', name: 'Clarity', group: 'Sharpen', run: clarity,
      about: 'Adds punch to midtones through local contrast without changing the darkest and brightest parts.',
      params: [pct('amount', 'Amount', -100, 100, 30)] },

    { id: 'noise', name: 'Add noise', group: 'Noise', run: noise,
      about: 'Sprinkles random noise over the picture.',
      params: [pct('amount', 'Amount', 0, 100, 10), select('distribution', 'Distribution', [['uniform', 'Uniform'], ['gaussian', 'Gaussian']], 'gaussian'),
        check('monochrome', 'Monochrome', false)] },
    { id: 'grain', name: 'Film grain', group: 'Noise', run: grain,
      about: 'Soft film-like grain, strongest in the midtones.',
      params: [pct('amount', 'Amount', 0, 100, 25), px('size', 'Size', 1, 10, 1.5, { step: 0.1 })] },
    { id: 'denoise', name: 'Reduce noise', group: 'Noise', run: denoise,
      about: 'Smooths noise while keeping edges; preserve details holds on to fine texture.',
      params: [range('strength', 'Strength', 0, 100, 40), pct('preserve', 'Preserve details', 0, 100, 50)] },
    { id: 'dust', name: 'Dust and scratches', group: 'Noise', run: dust,
      about: 'Removes specks and scratches: pixels that stand out from their surroundings are replaced.',
      params: [px('radius', 'Radius', 0, 10, 2), range('threshold', 'Threshold', 0, 255, 20)] },

    { id: 'emboss', name: 'Emboss', group: 'Stylize', run: emboss,
      about: 'Turns the picture into a grey relief lit from one side.',
      params: [deg('angle', 'Angle', -180, 180, 135), px('height', 'Height', 1, 10, 3), pct('amount', 'Amount', 0, 500, 100)] },
    { id: 'edges', name: 'Find edges', group: 'Stylize', run: edges,
      about: 'Draws the edges as dark lines on white.',
      params: [] },
    { id: 'glow', name: 'Glow', group: 'Stylize', run: glow,
      about: 'Bright parts glow softly over their surroundings.',
      params: [range('threshold', 'Threshold', 0, 254, 170), px('radius', 'Radius', 1, 100, 20), pct('strength', 'Strength', 0, 200, 80)] },
    { id: 'orton', name: 'Dreamy glow', group: 'Stylize', run: orton,
      about: 'The Orton effect: a bright, soft, glowing copy layered over the sharp picture.',
      params: [px('blur', 'Blur', 1, 100, 15), pct('strength', 'Strength', 0, 100, 50)] },
    { id: 'oil', name: 'Oil paint', group: 'Stylize', run: oil,
      about: 'Flattens areas into smooth brush strokes while keeping edges.',
      params: [px('radius', 'Brush size', 0, 12, 4)] },
    { id: 'pixelate', name: 'Pixelate', group: 'Stylize', run: pixelate,
      about: 'Turns the picture into big square blocks of average colour.',
      params: [px('cell', 'Cell size', 1, 200, 10)] },
    { id: 'halftone', name: 'Halftone', group: 'Stylize', run: halftone,
      about: 'Rebuilds the picture from printing dots.',
      params: [px('size', 'Dot size', 2, 50, 8), deg('angle', 'Angle', -90, 90, 0),
        select('mode', 'Colours', [['colour', 'Colour'], ['mono', 'Black and white']], 'colour')] },
    { id: 'vignette', name: 'Vignette', group: 'Stylize', run: vignette,
      about: 'Darkens (or lightens) the corners to draw the eye to the middle.',
      params: [pct('amount', 'Amount', -100, 100, -50), pct('size', 'Size', 0, 150, 60), pct('roundness', 'Roundness', 0, 100, 50),
        pct('feather', 'Feather', 1, 100, 50)] },
    { id: 'chromatic', name: 'Chromatic aberration', group: 'Stylize', run: chromatic,
      about: 'Splits red and blue apart towards the edges, like a cheap lens.',
      params: [px('amount', 'Amount', -50, 50, 5, { step: 0.1 })] },
    { id: 'glitch', name: 'Glitch', group: 'Stylize', run: glitch,
      about: 'Digital glitches: shifted slices and split colour channels.',
      params: [pct('amount', 'Amount', 0, 100, 40), range('slices', 'Slices', 1, 60, 12), px('shift', 'RGB shift', -100, 100, 6)] },
    { id: 'solarize', name: 'Solarize', group: 'Stylize', run: solarize,
      about: 'Inverts tones above the threshold, like film briefly exposed to light.',
      params: [range('threshold', 'Threshold', 0, 255, 128)] },
    { id: 'sketch', name: 'Pencil sketch', group: 'Stylize', run: sketch,
      about: 'Turns the picture into a pencil drawing.',
      params: [px('width', 'Stroke width', 0.5, 50, 6, { step: 0.5 }), pct('darkness', 'Darkness', 0, 100, 30)] },

    { id: 'offset', name: 'Offset', group: 'Distort', run: offset,
      about: 'Slides the picture, wrapping around the edges; shift by half to fix seams in a tile.',
      params: [px('x', 'Horizontal', -4096, 4096, 0), px('y', 'Vertical', -4096, 4096, 0)] },
    { id: 'twirl', name: 'Twirl', group: 'Distort', run: twirl,
      about: 'Swirls the picture around a centre, most strongly in the middle.',
      params: [centre(), deg('angle', 'Angle', -720, 720, 90), pct('radius', 'Radius', 1, 200, 100)] },
    { id: 'pinch', name: 'Pinch', group: 'Distort', run: pinch,
      about: 'Squeezes towards the centre, or bloats outwards with a negative amount.',
      params: [centre(), pct('amount', 'Amount', -100, 100, 50), pct('radius', 'Radius', 1, 200, 100)] },
    { id: 'ripple', name: 'Ripple', group: 'Distort', run: ripple,
      about: 'Waves across the picture, like a reflection in water.',
      params: [px('amplitude', 'Amplitude', 0, 100, 5), px('wavelength', 'Wavelength', 2, 500, 40),
        select('direction', 'Direction', [['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['both', 'Both']], 'both')] },
    { id: 'lens_distort', name: 'Lens distortion', group: 'Distort', run: lensDistort,
      about: 'Bulges the picture outwards (barrel) or pulls the corners out (pincushion), or corrects either.',
      params: [pct('amount', 'Amount', -100, 100, 20), pct('zoom', 'Zoom', 25, 400, 100)] },
    { id: 'polar', name: 'Polar coordinates', group: 'Distort', run: polar,
      about: 'Wraps the picture into a circle, or unrolls a circle into a strip.',
      params: [select('mode', 'Mode', [['to_polar', 'Rectangular to polar'], ['from_polar', 'Polar to rectangular']], 'to_polar')] },

    { id: 'clouds', name: 'Clouds', group: 'Render', run: clouds,
      about: 'Fills the layer with soft fractal clouds between two colours.',
      params: [px('scale', 'Scale', 4, 2000, 128), range('detail', 'Detail', 1, 10, 6), colour('a', 'Colour A', '#000000'), colour('b', 'Colour B', '#ffffff'),
        range('seed', 'Seed', 1, 9999, 1)] },
    { id: 'flare', name: 'Lens flare', group: 'Render', run: flare,
      about: 'Adds a bright light source with glints along the line through the middle.',
      params: [centre(), pct('brightness', 'Brightness', 0, 300, 100)] },
  ];

  const balParams = [];
  for (const [r, name] of [['s', 'Shadows'], ['m', 'Midtones'], ['h', 'Highlights']]) {
    balParams.push(range(r + 'CR', name + ': cyan–red', -100, 100, 0), range(r + 'MG', name + ': magenta–green', -100, 100, 0),
      range(r + 'YB', name + ': yellow–blue', -100, 100, 0));
  }
  const MIX_LABEL = { r: 'Red', g: 'Green', b: 'Blue' };
  const mixParams = MIX.map((k) => pct(k, MIX_LABEL[k[0]] + ' from ' + MIX_LABEL[k[1]].toLowerCase(), -200, 200, k[0] === k[1] ? 100 : 0));
  const line = () => [[0, 0], [255, 255]];
  const curveParam = { key: 'curve', label: 'Curve', type: 'curve', value: { rgb: line(), r: line(), g: line(), b: line() } };

  const ADJUSTMENTS = [
    { id: 'brightness', name: 'Brightness and contrast', run: brightness,
      about: 'Lightens or darkens and adds or removes contrast, without clipping the ends.',
      params: [range('brightness', 'Brightness', -150, 150, 0), range('contrast', 'Contrast', -100, 100, 0)] },
    { id: 'levels', name: 'Levels', run: levels,
      about: 'Sets the black point, white point and midtone brightness.',
      params: [select('channel', 'Channel', [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], 'rgb'), range('inLow', 'Input black', 0, 254, 0),
        range('inHigh', 'Input white', 1, 255, 255), range('gamma', 'Midtones', 0.1, 9.99, 1, { step: 0.01 }), range('outLow', 'Output black', 0, 255, 0),
        range('outHigh', 'Output white', 0, 255, 255)] },
    { id: 'curves', name: 'Curves', run: curves,
      about: 'Reshapes the tones with a curve, for all channels or each one.',
      params: [curveParam] },
    { id: 'exposure', name: 'Exposure', run: exposure,
      about: 'Changes exposure in stops like a camera, working in linear light.',
      params: [range('exposure', 'Exposure', -5, 5, 0, { step: 0.01 }), range('offset', 'Offset', -0.5, 0.5, 0, { step: 0.001 }),
        range('gamma', 'Gamma', 0.1, 9.99, 1, { step: 0.01 })] },
    { id: 'huesat', name: 'Hue and saturation', run: huesat,
      about: 'Shifts hues, makes colours stronger or weaker, or tints the whole picture.',
      params: [deg('hue', 'Hue', -180, 180, 0), range('saturation', 'Saturation', -100, 100, 0), range('lightness', 'Lightness', -100, 100, 0),
        check('colorize', 'Colorize', false)] },
    { id: 'vibrance', name: 'Vibrance', run: vibrance,
      about: 'Boosts dull colours more than strong ones and goes easy on skin tones.',
      params: [range('vibrance', 'Vibrance', -100, 100, 0), range('saturation', 'Saturation', -100, 100, 0)] },
    { id: 'balance', name: 'Colour balance', run: balance,
      about: 'Shifts the colour of shadows, midtones and highlights separately.',
      params: [...balParams, check('preserve', 'Preserve luminosity', true)] },
    { id: 'bw', name: 'Black and white', run: bw,
      about: 'Converts to grey, choosing how bright each colour becomes; can tint the result.',
      params: [pct('reds', 'Reds', -200, 300, 40), pct('yellows', 'Yellows', -200, 300, 60), pct('greens', 'Greens', -200, 300, 40),
        pct('cyans', 'Cyans', -200, 300, 60), pct('blues', 'Blues', -200, 300, 20), pct('magentas', 'Magentas', -200, 300, 80),
        check('tint', 'Tint', false), colour('tintColour', 'Tint colour', '#c8a878')] },
    { id: 'photofilter', name: 'Photo filter', run: photofilter,
      about: 'Warms or cools the picture like a coloured lens filter.',
      params: [colour('colour', 'Colour', '#ec8a00'), pct('density', 'Density', 0, 100, 25), check('preserve', 'Preserve luminosity', true)] },
    { id: 'temperature', name: 'White balance', run: temperature,
      about: 'Makes the light warmer or cooler, greener or more magenta.',
      params: [range('temperature', 'Temperature', -100, 100, 0), range('tint', 'Tint', -100, 100, 0)] },
    { id: 'shadows', name: 'Shadows and highlights', run: shadows,
      about: 'Brings out detail in dark areas and recovers bright ones.',
      params: [pct('shadows', 'Shadows', 0, 100, 35), pct('highlights', 'Highlights', 0, 100, 0), px('radius', 'Radius', 1, 200, 30)] },
    { id: 'invert', name: 'Invert', run: invert,
      about: 'Turns the picture into its negative.',
      params: [] },
    { id: 'posterize', name: 'Posterize', run: posterize,
      about: 'Reduces each channel to a few flat tones.',
      params: [range('levels', 'Levels', 2, 255, 4)] },
    { id: 'threshold', name: 'Threshold', run: threshold,
      about: 'Pure black and white: lighter than the level becomes white.',
      params: [range('level', 'Level', 1, 255, 128)] },
    { id: 'gradientmap', name: 'Gradient map', run: gradientmap,
      about: 'Recolours by brightness: shadows take the first colour, highlights the last.',
      params: [{ key: 'gradient', label: 'Gradient', type: 'gradient', value: ['#000000', '#ffffff'] }] },
    { id: 'desaturate', name: 'Desaturate', run: desaturate,
      about: 'Removes all colour, keeping brightness.',
      params: [] },
    { id: 'selective', name: 'Selective colour', run: selective,
      about: 'Adds or takes away cyan, magenta, yellow and black in one family of colours (the reds, the blues, the whites…).',
      params: [select('range', 'Colours', [['reds', 'Reds'], ['yellows', 'Yellows'], ['greens', 'Greens'], ['cyans', 'Cyans'], ['blues', 'Blues'], ['magentas', 'Magentas'], ['whites', 'Whites'], ['neutrals', 'Neutrals'], ['blacks', 'Blacks']], 'reds'),
        range('cyan', 'Cyan', -100, 100, 0, { unit: '%' }), range('magenta', 'Magenta', -100, 100, 0, { unit: '%' }), range('yellow', 'Yellow', -100, 100, 0, { unit: '%' }), range('black', 'Black', -100, 100, 0, { unit: '%' }),
        select('method', 'Method', [['relative', 'Relative'], ['absolute', 'Absolute']], 'relative')] },
    { id: 'channelmix', name: 'Channel mixer', run: channelmix,
      about: 'Builds each output channel from a mix of red, green and blue.',
      params: [...mixParams, check('monochrome', 'Monochrome', false)] },
  ];

  const BY_ID = new Map();
  for (const f of FILTERS) BY_ID.set(f.id, f);
  for (const a of ADJUSTMENTS) BY_ID.set(a.id, a);

  const cloneValue = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
  function defaults(id) {
    const def = BY_ID.get(id);
    if (!def) throw new Error('Unknown filter: ' + id);
    const out = {};
    for (const p of def.params) out[p.key] = cloneValue(p.value);
    return out;
  }

  /** Runs a filter or adjustment; returns a new picture. opts.scale shrinks px parameters for reduced-size previews. */
  function apply(id, img, params, opts) {
    const def = BY_ID.get(id);
    if (!def) throw new Error('Unknown filter: ' + id);
    if (!img || !(img.width > 0) || !(img.height > 0) || !img.data || img.data.length !== img.width * img.height * 4) throw new Error('Not a picture');
    const scale = opts && opts.scale > 0 ? opts.scale : 1, seed = opts && Number.isFinite(opts.seed) ? opts.seed : 1;
    const p = defaults(id);
    for (const prm of def.params) {
      if (params && params[prm.key] !== undefined) p[prm.key] = cloneValue(params[prm.key]);
      if (prm.type === 'range') { p[prm.key] = Number(p[prm.key]); if (!Number.isFinite(p[prm.key])) p[prm.key] = prm.value; }
      if (prm.px && scale !== 1) p[prm.key] *= scale;
      if (prm.type === 'point' && !(p[prm.key] && Number.isFinite(p[prm.key].x) && Number.isFinite(p[prm.key].y))) p[prm.key] = cloneValue(prm.value);
    }
    const src = { width: img.width, height: img.height, data: img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data) };
    const out = def.run(src, p, { scale, seed });
    return out === src ? copy(src) : out;
  }

  function histogram(img) {
    const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++; l[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++;
    }
    return { r, g, b, l };
  }
  function autoLevels(img) {
    const { l } = histogram(img);
    let total = 0;
    for (let v = 0; v < 256; v++) total += l[v];
    const clip = total * 0.001;
    let lo = 0, hi = 255, acc = 0;
    for (; lo < 255; lo++) { acc += l[lo]; if (acc > clip) break; }
    acc = 0;
    for (; hi > 0; hi--) { acc += l[hi]; if (acc > clip) break; }
    if (!total || hi <= lo) { lo = 0; hi = 255; }
    return { channel: 'rgb', inLow: lo, inHigh: hi, gamma: 1, outLow: 0, outHigh: 255 };
  }

  return { FILTERS, ADJUSTMENTS, apply, defaults, histogram, curveLut, autoLevels };
})();

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).NoorPhotoFx;
