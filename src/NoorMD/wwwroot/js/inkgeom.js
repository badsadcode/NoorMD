// NoorInk geometry: pure maths for the vector editor, no DOM, so the same file runs in the page and in Node tests.
//
// A path is an array of subpaths { closed, pts: [{ x, y, ix, iy, ox, oy }] }: every anchor carries its incoming (ix, iy)
// and outgoing (ox, oy) cubic handle in absolute coordinates, and a corner simply has both handles on the anchor. Segment
// i runs from pts[i] (via its out handle) to pts[i + 1] (via its in handle); a closed subpath also runs last -> first.
// Rings are flattened polygons [[x, y], ...] (implicitly closed). Matrices are [a, b, c, d, e, f] in SVG order.
//
// Orientation convention (used by boolean, the shapes and area): an outer ring has a POSITIVE signed area() (shoelace),
// a hole a negative one. On a y-down screen that means outer rings run clockwise and holes counter-clockwise (in y-up
// maths axes it is the usual counter-clockwise outer). Either way nonzero filling of a boolean result is correct.
//
// Every function returns new data and leaves its input alone.
'use strict';

(typeof window !== 'undefined' ? window : globalThis).NoorInkGeom = (() => {
  const KAPPA = 0.5522847498307936; // handle length of a quarter circle drawn with one cubic
  const RAD = Math.PI / 180;

  // ---- Small helpers ----
  const anchor = (x, y) => ({ x, y, ix: x, iy: y, ox: x, oy: y });
  const clonePt = (p) => ({ x: p.x, y: p.y, ix: p.ix, iy: p.iy, ox: p.ox, oy: p.oy });
  const cloneSub = (s) => ({ closed: !!s.closed, pts: s.pts.map(clonePt) });
  const clone = (path) => (path || []).map(cloneSub);
  const segCount = (s) => (s.closed ? s.pts.length : s.pts.length - 1);
  // The 8 coordinates of segment i: p0, c1, c2, p3.
  function segOf(s, i) {
    const a = s.pts[i], b = s.pts[(i + 1) % s.pts.length];
    return [a.x, a.y, a.ox, a.oy, b.ix, b.iy, b.x, b.y];
  }
  function bezAt(c, t) {
    const mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t;
    return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
  }
  function bezDeriv(c, t) {
    const mt = 1 - t, a = 3 * mt * mt, b = 6 * mt * t, d = 3 * t * t;
    return [a * (c[2] - c[0]) + b * (c[4] - c[2]) + d * (c[6] - c[4]), a * (c[3] - c[1]) + b * (c[5] - c[3]) + d * (c[7] - c[5])];
  }
  // de Casteljau: the two halves of a cubic at t, each as 8 coordinates.
  function bezSplit(c, t) {
    const lerp = (a, b) => a + (b - a) * t;
    const x01 = lerp(c[0], c[2]), y01 = lerp(c[1], c[3]), x12 = lerp(c[2], c[4]), y12 = lerp(c[3], c[5]);
    const x23 = lerp(c[4], c[6]), y23 = lerp(c[5], c[7]);
    const xa = lerp(x01, x12), ya = lerp(y01, y12), xb = lerp(x12, x23), yb = lerp(y12, y23);
    const xm = lerp(xa, xb), ym = lerp(ya, yb);
    return [[c[0], c[1], x01, y01, xa, ya, xm, ym], [xm, ym, xb, yb, x23, y23, c[6], c[7]]];
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  // ---- Parsing SVG path data ----
  const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const CMD = /[MmZzLlHhVvCcSsQqTtAa]/;
  const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };

  // SVG spec F.6.5: endpoint parameterisation -> centre, then pieces of at most 90 degrees, each one cubic.
  function arcToCubics(x1, y1, rx, ry, rot, fa, fs, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
    const phi = rot * RAD, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
    const x1p = cos * dx2 + sin * dy2, y1p = -sin * dx2 + cos * dy2;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; } // radii too small: scale up until the arc fits
    const rx2 = rx * rx, ry2 = ry * ry, den = rx2 * y1p * y1p + ry2 * x1p * x1p;
    let coef = den ? Math.sqrt(Math.max(0, (rx2 * ry2 - den) / den)) : 0;
    if (fa === fs) coef = -coef;
    const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry, vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const t1 = ang(1, 0, ux, uy);
    let dt = ang(ux, uy, vx, vy);
    if (!fs && dt > 0) dt -= 2 * Math.PI;
    if (fs && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), step = dt / n, k = (4 / 3) * Math.tan(step / 4);
    const map = (x, y) => [cx + rx * x * cos - ry * y * sin, cy + rx * x * sin + ry * y * cos];
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = t1 + i * step, b = a + step, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      const p1 = map(ca - k * sa, sa + k * ca), p2 = map(cb + k * sb, sb - k * cb);
      const p3 = i === n - 1 ? [x2, y2] : map(cb, sb);
      out.push([p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]]);
    }
    return out;
  }

  function parse(d) {
    const s = String(d == null ? '' : d), n = s.length, path = [];
    let i = 0, sub = null, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '', prev = '', lcx = 0, lcy = 0;
    const skip = () => { while (i < n && (s[i] === ',' || s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r' || s[i] === '\f')) i++; };
    const num = () => {
      skip();
      NUM.lastIndex = i;
      const m = NUM.exec(s);
      if (!m) return null;
      i = NUM.lastIndex;
      return parseFloat(m[0]);
    };
    // Arc flags are single digits and may be glued to what follows ("a1 1 0 01 1 1").
    const flag = () => { skip(); const c = s[i]; if (c === '0' || c === '1') { i++; return c === '1' ? 1 : 0; } return null; };
    const hasNum = () => { skip(); return i < n && /[0-9.+-]/.test(s[i]); };
    const last = () => sub.pts[sub.pts.length - 1];
    const ensure = () => { if (!sub) { sub = { closed: false, pts: [anchor(cx, cy)] }; path.push(sub); } };
    const lineTo = (x, y) => { ensure(); sub.pts.push(anchor(x, y)); };
    const cubicTo = (x1, y1, x2, y2, x, y) => {
      ensure();
      const p = last();
      p.ox = x1; p.oy = y1;
      sub.pts.push({ x, y, ix: x2, iy: y2, ox: x, oy: y });
    };
    while (true) {
      skip();
      if (i >= n) break;
      const c = s[i];
      if (CMD.test(c)) { cmd = c; i++; } else if (!cmd || !hasNum()) break;
      const up = cmd.toUpperCase(), rel = cmd !== up;
      if (up === 'Z') {
        if (sub) {
          const p = sub.pts;
          // A closing anchor that repeats the start is merged into it; its incoming handle moves to the start.
          if (p.length > 1 && Math.abs(p[p.length - 1].x - p[0].x) < 1e-9 && Math.abs(p[p.length - 1].y - p[0].y) < 1e-9) {
            const q = p.pop();
            p[0].ix = q.ix; p[0].iy = q.iy;
          }
          sub.closed = true;
          sub = null;
        }
        cx = sx; cy = sy; prev = 'Z'; cmd = '';
        continue;
      }
      const a = [];
      let bad = false;
      for (let k = 0; k < ARGS[up]; k++) {
        const v = up === 'A' && (k === 3 || k === 4) ? flag() : num();
        if (v === null) { bad = true; break; }
        a.push(v);
      }
      if (bad) break; // like a browser: render up to the first error
      const ox = rel ? cx : 0, oy = rel ? cy : 0;
      let ncx = lcx, ncy = lcy;
      if (up !== 'M') ensure(); // a drawing command right after Z starts a new subpath at the old start
      if (up === 'M') {
        if (sub && sub.pts.length === 1 && !sub.closed) path.pop();
        cx = a[0] + ox; cy = a[1] + oy; sx = cx; sy = cy;
        sub = { closed: false, pts: [anchor(cx, cy)] };
        path.push(sub);
        cmd = rel ? 'l' : 'L'; // further pairs are implicit linetos
      } else if (up === 'L' || up === 'H' || up === 'V') {
        if (up !== 'V') cx = a[0] + ox;
        if (up === 'L') cy = a[1] + oy; else if (up === 'V') cy = a[0] + oy;
        lineTo(cx, cy);
      } else if (up === 'C' || up === 'S') {
        let x1, y1, x2, y2, x, y;
        if (up === 'C') { x1 = a[0] + ox; y1 = a[1] + oy; x2 = a[2] + ox; y2 = a[3] + oy; x = a[4] + ox; y = a[5] + oy; } else {
          const refl = prev === 'C' || prev === 'S';
          x1 = refl ? 2 * cx - lcx : cx; y1 = refl ? 2 * cy - lcy : cy;
          x2 = a[0] + ox; y2 = a[1] + oy; x = a[2] + ox; y = a[3] + oy;
        }
        cubicTo(x1, y1, x2, y2, x, y);
        ncx = x2; ncy = y2; cx = x; cy = y;
      } else if (up === 'Q' || up === 'T') {
        let qx, qy, x, y;
        if (up === 'Q') { qx = a[0] + ox; qy = a[1] + oy; x = a[2] + ox; y = a[3] + oy; } else {
          const refl = prev === 'Q' || prev === 'T';
          qx = refl ? 2 * cx - lcx : cx; qy = refl ? 2 * cy - lcy : cy;
          x = a[0] + ox; y = a[1] + oy;
        }
        // Degree elevation: a quadratic is exactly the cubic with controls 2/3 of the way to the quadratic control.
        cubicTo(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
        ncx = qx; ncy = qy; cx = x; cy = y;
      } else if (up === 'A') {
        const x = a[5] + ox, y = a[6] + oy;
        for (const c3 of arcToCubics(cx, cy, a[0], a[1], a[2], a[3], a[4], x, y)) cubicTo(...c3);
        if (cx === x && cy === y) ensure();
        cx = x; cy = y;
      }
      lcx = ncx; lcy = ncy; prev = up;
    }
    return path.filter((p) => p.closed || p.pts.length > 1);
  }

  // ---- Serialising ----
  function fmt(v, p) {
    const r = +(+v).toFixed(p);
    return r === 0 || !isFinite(r) ? '0' : String(r);
  }
  function serialize(path, precision = 3) {
    const out = [], f = (v) => fmt(v, precision);
    const straight = (a, b) => f(a.ox) === f(a.x) && f(a.oy) === f(a.y) && f(b.ix) === f(b.x) && f(b.iy) === f(b.y);
    const nums = (arr) => arr.map(f).join(' ').replace(/ -/g, '-');
    for (const s of path || []) {
      const p = s.pts;
      if (!p.length) continue;
      out.push('M' + nums([p[0].x, p[0].y]));
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i];
        out.push(straight(a, b) ? 'L' + nums([b.x, b.y]) : 'C' + nums([a.ox, a.oy, b.ix, b.iy, b.x, b.y]));
      }
      if (s.closed) {
        const a = p[p.length - 1], b = p[0];
        // A curved closing segment is written out to the start; parse merges that repeated anchor back.
        if (!straight(a, b) || p.length === 1) out.push('C' + nums([a.ox, a.oy, b.ix, b.iy, b.x, b.y]));
        out.push('Z');
      }
    }
    return out.join('');
  }

  // ---- Matrices ----
  // multiply(m1, m2) = m1 x m2: applying the result is applying m2 first, then m1 (like nested SVG transforms).
  function multiply(m1, m2) {
    const [a, b, c, d, e, f] = m1, [A, B, C, D, E, F] = m2;
    return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
  }
  function invert(m) {
    const [a, b, c, d, e, f] = m, det = a * d - b * c;
    if (!det) return null;
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  }
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function transform(path, m) {
    return (path || []).map((s) => ({
      closed: !!s.closed,
      pts: s.pts.map((p) => {
        const [x, y] = apply(m, p.x, p.y), [ix, iy] = apply(m, p.ix, p.iy), [ox, oy] = apply(m, p.ox, p.oy);
        return { x, y, ix, iy, ox, oy };
      }),
    }));
  }

  // ---- Bounds ----
  // Parameters in (0, 1) where one coordinate of the cubic has a turning point.
  function extremaT(p0, p1, p2, p3, out) {
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) out.push(-c / b); return; }
    const disc = b * b - 4 * a * c;
    if (disc < 0) return;
    const r = Math.sqrt(disc);
    out.push((-b + r) / (2 * a), (-b - r) / (2 * a));
  }
  function bounds(path) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const s of path || []) {
      if (!s.pts.length) continue;
      add(s.pts[0].x, s.pts[0].y);
      for (let i = 0, n = segCount(s); i < n; i++) {
        const c = segOf(s, i), ts = [];
        add(c[6], c[7]);
        extremaT(c[0], c[2], c[4], c[6], ts);
        extremaT(c[1], c[3], c[5], c[7], ts);
        for (const t of ts) if (t > 0 && t < 1) { const q = bezAt(c, t); add(q[0], q[1]); }
      }
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---- Flattening ----
  function flattenCubic(c, tol, out, depth) {
    const dx = c[6] - c[0], dy = c[7] - c[1], l = Math.hypot(dx, dy);
    let d1, d2;
    if (l < 1e-12) { d1 = Math.hypot(c[2] - c[0], c[3] - c[1]); d2 = Math.hypot(c[4] - c[0], c[5] - c[1]); } else {
      d1 = Math.abs((c[2] - c[0]) * dy - (c[3] - c[1]) * dx) / l;
      d2 = Math.abs((c[4] - c[0]) * dy - (c[5] - c[1]) * dx) / l;
    }
    if (Math.max(d1, d2) <= tol || depth > 18) { out.push([c[6], c[7]]); return; }
    const [a, b] = bezSplit(c, 0.5);
    flattenCubic(a, tol, out, depth + 1);
    flattenCubic(b, tol, out, depth + 1);
  }
  const isLine = (c) => c[2] === c[0] && c[3] === c[1] && c[4] === c[6] && c[5] === c[7];
  function flatten(path, tolerance = 0.25) {
    const rings = [], tol = Math.max(tolerance, 1e-6);
    for (const s of path || []) {
      if (!s.pts.length) continue;
      const ring = [[s.pts[0].x, s.pts[0].y]];
      for (let i = 0, n = segCount(s); i < n; i++) {
        const c = segOf(s, i);
        if (isLine(c)) ring.push([c[6], c[7]]); else flattenCubic(c, tol, ring, 0);
      }
      if (ring.length > 1 && ring[ring.length - 1][0] === ring[0][0] && ring[ring.length - 1][1] === ring[0][1]) ring.pop();
      rings.push(ring);
    }
    return rings;
  }

  // ---- Hit testing ----
  // Winding number with the half-open rule, so a ray through a vertex counts once. Positive inside positive-area rings.
  function windingRings(rings, x, y) {
    let w = 0;
    for (const r of rings) {
      for (let i = 0, n = r.length; i < n; i++) {
        const a = r[i], b = r[(i + 1) % n];
        const side = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
        if (a[1] <= y) { if (b[1] > y && side > 0) w++; } else if (b[1] <= y && side < 0) w--;
      }
    }
    return w;
  }
  const filled = (w, rule) => (rule === 'evenodd' ? (w & 1) !== 0 : w !== 0);
  function contains(path, x, y, rule = 'nonzero') {
    const b = bounds(path);
    if (!b || x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) return false;
    return filled(windingRings(flatten(path, 0.1), x, y), rule);
  }

  function nearest(path, x, y) {
    let best = null;
    for (let si = 0; si < (path || []).length; si++) {
      const s = path[si];
      if (!s.pts.length) continue;
      if (s.pts.length === 1 && !s.closed) {
        const d = Math.hypot(s.pts[0].x - x, s.pts[0].y - y);
        if (!best || d < best.dist) best = { sub: si, seg: 0, t: 0, x: s.pts[0].x, y: s.pts[0].y, dist: d };
        continue;
      }
      for (let i = 0, n = segCount(s); i < n; i++) {
        const c = segOf(s, i);
        if (best) { // the curve lies in its control hull: skip segments whose hull box is already too far
          const bx0 = Math.min(c[0], c[2], c[4], c[6]), bx1 = Math.max(c[0], c[2], c[4], c[6]);
          const by0 = Math.min(c[1], c[3], c[5], c[7]), by1 = Math.max(c[1], c[3], c[5], c[7]);
          if (Math.hypot(Math.max(bx0 - x, 0, x - bx1), Math.max(by0 - y, 0, y - by1)) > best.dist) continue;
        }
        let bt = 0, bd = Infinity;
        const dist = (t) => { const q = bezAt(c, t); return Math.hypot(q[0] - x, q[1] - y); };
        if (isLine(c)) {
          const dx = c[6] - c[0], dy = c[7] - c[1], l2 = dx * dx + dy * dy;
          const u = l2 ? Math.min(1, Math.max(0, ((x - c[0]) * dx + (y - c[1]) * dy) / l2)) : 0;
          bd = Math.hypot(c[0] + u * dx - x, c[1] + u * dy - y);
          // With handles on the anchors the cubic runs at 3t^2 - 2t^3 along the chord, so invert that for t.
          let lo = 0, hi = 1;
          for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (m * m * (3 - 2 * m) < u) lo = m; else hi = m; }
          bt = (lo + hi) / 2;
        } else {
          const N = 16;
          for (let k = 0; k <= N; k++) { const d = dist(k / N); if (d < bd) { bd = d; bt = k / N; } }
          // Refine by a shrinking local search: slower than Newton but it never diverges near cusps.
          for (let h = 1 / N / 2; h > 1e-10; h /= 2) {
            const t0 = Math.max(0, bt - h), t1 = Math.min(1, bt + h), d0 = dist(t0), d1 = dist(t1);
            if (d0 < bd) { bd = d0; bt = t0; } else if (d1 < bd) { bd = d1; bt = t1; }
          }
        }
        if (!best || bd < best.dist) { const q = bezAt(c, bt); best = { sub: si, seg: i, t: bt, x: q[0], y: q[1], dist: bd }; }
      }
    }
    return best;
  }
  function distance(path, x, y) {
    const n = nearest(path, x, y);
    return n ? n.dist : Infinity;
  }

  // ---- Editing ----
  function split(path, sub, seg, t) {
    const out = clone(path), s = out[sub];
    if (!s || seg < 0 || seg >= segCount(s)) return out;
    const n = s.pts.length, a = s.pts[seg], b = s.pts[(seg + 1) % n];
    const [l, r] = bezSplit(segOf(s, seg), t);
    a.ox = l[2]; a.oy = l[3];
    b.ix = r[4]; b.iy = r[5];
    s.pts.splice(seg + 1, 0, { x: l[6], y: l[7], ix: l[4], iy: l[5], ox: r[2], oy: r[3] });
    return out;
  }
  function neighbours(s, i) {
    const n = s.pts.length;
    const prev = i > 0 ? s.pts[i - 1] : s.closed && n > 1 ? s.pts[n - 1] : null;
    const next = i < n - 1 ? s.pts[i + 1] : s.closed && n > 1 ? s.pts[0] : null;
    return [prev, next];
  }
  // Smooth: both handles on one line through the anchor, each a third of the way to its neighbour.
  function smoothCorner(path, sub, i) {
    const out = clone(path), s = out[sub];
    if (!s || !s.pts[i]) return out;
    const p = s.pts[i], [prev, next] = neighbours(s, i);
    let dx = 0, dy = 0;
    if (prev && next) { dx = next.x - prev.x; dy = next.y - prev.y; }
    if (!dx && !dy && next) { dx = next.x - p.x; dy = next.y - p.y; }
    if (!dx && !dy && prev) { dx = p.x - prev.x; dy = p.y - prev.y; }
    const l = Math.hypot(dx, dy);
    if (!l) return out;
    dx /= l; dy /= l;
    if (prev) { const k = Math.hypot(p.x - prev.x, p.y - prev.y) / 3; p.ix = p.x - dx * k; p.iy = p.y - dy * k; }
    if (next) { const k = Math.hypot(next.x - p.x, next.y - p.y) / 3; p.ox = p.x + dx * k; p.oy = p.y + dy * k; }
    return out;
  }
  function cornerize(path, sub, i) {
    const out = clone(path), p = out[sub] && out[sub].pts[i];
    if (p) { p.ix = p.ox = p.x; p.iy = p.oy = p.y; }
    return out;
  }
  // Reverse each subpath; a closed one keeps its first anchor first.
  function reverse(path) {
    return (path || []).map((s) => {
      const p = s.pts.map((q) => ({ x: q.x, y: q.y, ix: q.ox, iy: q.oy, ox: q.ix, oy: q.iy }));
      const r = s.closed && p.length ? [p[0]].concat(p.slice(1).reverse()) : p.reverse();
      return { closed: !!s.closed, pts: r };
    });
  }

  // ---- Measures ----
  function area(ring) {
    let a = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  const GL_X = [-0.906179845938664, -0.538469310105683, 0, 0.538469310105683, 0.906179845938664];
  const GL_W = [0.236926885056189, 0.478628670499366, 0.568888888888889, 0.478628670499366, 0.236926885056189];
  function length(path) {
    let total = 0;
    for (const s of path || []) {
      for (let i = 0, n = segCount(s); i < n; i++) {
        const c = segOf(s, i);
        if (isLine(c)) { total += Math.hypot(c[6] - c[0], c[7] - c[1]); continue; }
        // Gauss-Legendre on 8 sub-intervals: plenty for any cubic an editor draws.
        for (let k = 0; k < 8; k++) {
          for (let j = 0; j < 5; j++) {
            const t = (k + (GL_X[j] + 1) / 2) / 8, d = bezDeriv(c, t);
            total += (GL_W[j] / 16) * Math.hypot(d[0], d[1]);
          }
        }
      }
    }
    return total;
  }

  // ---- Boolean operations ----
  // Everything happens on an integer grid (about 2^23 cells across the inputs), so orientation tests are exact. All edges
  // are split where they cross, touch or overlap (repeating until rounding the crossings creates no new ones), equal edges
  // merge with their counts summed per operand, and each remaining edge learns the winding numbers of A and of B on its
  // two sides. An edge is kept when the result is inside on exactly one side, oriented with the inside on its left, and the
  // kept edges are chained into rings, always taking the sharpest left turn so rings that touch at a vertex stay apart.
  const GRID = 8388608;
  function orient(ax, ay, bx, by, cx, cy) { const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); return v > 0 ? 1 : v < 0 ? -1 : 0; }
  const strictlyOn = (ax, ay, bx, by, px, py) => (px - ax) * (bx - ax) + (py - ay) * (by - ay) > 0 && (px - bx) * (ax - bx) + (py - by) * (ay - by) > 0;

  function findSplits(E) {
    const n = E.length, order = new Array(n), mnx = new Float64Array(n), mxx = new Float64Array(n), mny = new Float64Array(n), mxy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const e = E[i];
      order[i] = i;
      mnx[i] = Math.min(e[0], e[2]); mxx[i] = Math.max(e[0], e[2]); mny[i] = Math.min(e[1], e[3]); mxy[i] = Math.max(e[1], e[3]);
    }
    order.sort((a, b) => mnx[a] - mnx[b]);
    const splits = new Map();
    let count = 0;
    const add = (k, x, y) => {
      const e = E[k];
      if ((x === e[0] && y === e[1]) || (x === e[2] && y === e[3])) return;
      let l = splits.get(k);
      if (!l) splits.set(k, (l = []));
      l.push(x, y);
      count++;
    };
    for (let p = 0; p < n; p++) {
      const i = order[p], e = E[i], ax = e[0], ay = e[1], bx = e[2], by = e[3];
      for (let q = p + 1; q < n; q++) {
        const j = order[q];
        if (mnx[j] > mxx[i]) break;
        if (mny[j] > mxy[i] || mxy[j] < mny[i]) continue;
        const f = E[j], cx = f[0], cy = f[1], dx = f[2], dy = f[3];
        const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy);
        const o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
        if (o1 && o2 && o3 && o4) {
          if (o1 !== o2 && o3 !== o4) {
            const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx), t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
            const x = Math.round(ax + t * (bx - ax)), y = Math.round(ay + t * (by - ay));
            add(i, x, y); add(j, x, y);
          }
          continue;
        }
        // Touching or collinear: split each edge at the other's endpoints that lie inside it.
        if (!o1 && strictlyOn(ax, ay, bx, by, cx, cy)) add(i, cx, cy);
        if (!o2 && strictlyOn(ax, ay, bx, by, dx, dy)) add(i, dx, dy);
        if (!o3 && strictlyOn(cx, cy, dx, dy, ax, ay)) add(j, ax, ay);
        if (!o4 && strictlyOn(cx, cy, dx, dy, bx, by)) add(j, bx, by);
      }
    }
    return count ? splits : null;
  }
  function applySplits(E, splits) {
    const out = [];
    for (let k = 0; k < E.length; k++) {
      const e = E[k], l = splits.get(k);
      if (!l) { out.push(e); continue; }
      const dx = e[2] - e[0], dy = e[3] - e[1], pts = [];
      for (let i = 0; i < l.length; i += 2) pts.push([l[i], l[i + 1], (l[i] - e[0]) * dx + (l[i + 1] - e[1]) * dy]);
      pts.sort((a, b) => a[2] - b[2]);
      let px = e[0], py = e[1];
      for (const p of pts) {
        if (p[0] === px && p[1] === py) continue;
        out.push([px, py, p[0], p[1], e[4], e[5]]);
        px = p[0]; py = p[1];
      }
      if (px !== e[2] || py !== e[3]) out.push([px, py, e[2], e[3], e[4], e[5]]);
    }
    return out;
  }

  function booleanRings(op, ringsA, ringsB, rule = 'nonzero') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of [].concat(ringsA || [], ringsB || [])) {
      for (const p of r) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    }
    if (minX === Infinity) return [];
    const ext = Math.max(maxX - minX, maxY - minY, 1e-9), sc = Math.pow(2, Math.floor(Math.log2(GRID / ext)));
    // Edges: [x0, y0, x1, y1, countA, countB] in grid units.
    let E = [];
    const addRings = (rings, isA) => {
      for (const r of rings || []) {
        if (r.length < 2) continue;
        const q = r.map((p) => [Math.round((p[0] - minX) * sc), Math.round((p[1] - minY) * sc)]);
        for (let k = 0; k < q.length; k++) {
          const a = q[k], b = q[(k + 1) % q.length];
          if (a[0] !== b[0] || a[1] !== b[1]) E.push([a[0], a[1], b[0], b[1], isA ? 1 : 0, isA ? 0 : 1]);
        }
      }
    };
    addRings(ringsA, true);
    addRings(ringsB, false);
    for (let pass = 0; pass < 24; pass++) {
      const sp = findSplits(E);
      if (!sp) break;
      E = applySplits(E, sp);
    }

    // Vertices and merged edges, each stored once in the direction of increasing vertex id.
    const vid = new Map(), VX = [], VY = [];
    const vert = (x, y) => {
      const key = x * 67108864 + y;
      let id = vid.get(key);
      if (id === undefined) { id = VX.length; vid.set(key, id); VX.push(x); VY.push(y); }
      return id;
    };
    const em = new Map(), U = [], V = [], CA = [], CB = [];
    for (const e of E) {
      let u = vert(e[0], e[1]), v = vert(e[2], e[3]), sgn = 1;
      if (u === v) continue;
      if (u > v) { const t = u; u = v; v = t; sgn = -1; }
      const key = u * 67108864 + v;
      let k = em.get(key);
      if (k === undefined) { k = U.length; em.set(key, k); U.push(u); V.push(v); CA.push(0); CB.push(0); }
      CA[k] += sgn * e[4]; CB[k] += sgn * e[5];
    }
    const live = [];
    for (let k = 0; k < U.length; k++) if (CA[k] || CB[k]) live.push(k);
    if (!live.length) return [];

    // Horizontal slabs so each winding query only looks at edges spanning its y.
    let y0 = Infinity, y1 = -Infinity;
    for (const k of live) { y0 = Math.min(y0, VY[U[k]], VY[V[k]]); y1 = Math.max(y1, VY[U[k]], VY[V[k]]); }
    // Slabs about an eighth of the mean edge height, so most edges run through the slabs they touch (see below).
    let sumDy = 0;
    for (const k of live) sumDy += Math.abs(VY[V[k]] - VY[U[k]]);
    const NS = Math.max(1, Math.min(65536, 2 * live.length, Math.ceil(((y1 - y0) * 8 * live.length) / Math.max(sumDy, 1)))), sh = (y1 - y0) / NS || 1;
    const slabs = Array.from({ length: NS }, () => []);
    const slabOf = (y) => Math.min(NS - 1, Math.max(0, Math.floor((y - y0) / sh)));
    for (const k of live) {
      const a = slabOf(Math.min(VY[U[k]], VY[V[k]])), b = slabOf(Math.max(VY[U[k]], VY[V[k]]));
      for (let s = a; s <= b; s++) slabs[s].push(k);
    }
    // Within a slab, an edge that runs through its whole height (with a unit of margin) crosses every query line there,
    // somewhere in a known x interval. Such edges clearly right of a query point add their signed count, so they are
    // sorted by the left end of that interval with suffix sums (and a running maximum of the right ends, to find the
    // few intervals around the point, which get the exact test). Very wide intervals are tested exactly too. Edges that end
    // inside a crowded slab go down into eight thinner sub-slabs, built when first needed, where most of them run through.
    // Horizontal edges never cross a query line. The answer is the same as testing every edge exactly.
    let x0 = Infinity, x1 = -Infinity;
    for (const k of live) { x0 = Math.min(x0, VX[U[k]], VX[V[k]]); x1 = Math.max(x1, VX[U[k]], VX[V[k]]); }
    const wideX = Math.max(64, (x1 - x0) / 32);
    const prepare = (top, bot, list) => {
      const t1 = top - 1, b1 = bot + 1, full = [], exact = [];
      for (const j of list) {
        const px = VX[U[j]], py = VY[U[j]], qx = VX[V[j]], qy = VY[V[j]];
        if (py === qy) continue;
        if (Math.min(py, qy) <= t1 && Math.max(py, qy) > b1) {
          const xa = px + ((qx - px) * (t1 - py)) / (qy - py), xb = px + ((qx - px) * (b1 - py)) / (qy - py);
          const xl = Math.min(xa, xb) - 1, xr = Math.max(xa, xb) + 1;
          if (xr - xl <= wideX) { full.push([xl, xr, j, qy > py ? 1 : -1]); continue; }
        }
        exact.push(j);
      }
      full.sort((p, q) => p[0] - q[0]);
      const n = full.length, FL = new Float64Array(n), FR = new Float64Array(n), FJ = new Int32Array(n), PM = new Float64Array(n);
      const SA = new Float64Array(n + 1), SB = new Float64Array(n + 1);
      for (let i = n - 1; i >= 0; i--) {
        const f = full[i];
        FL[i] = f[0]; FR[i] = f[1]; FJ[i] = f[2];
        SA[i] = SA[i + 1] + f[3] * CA[f[2]]; SB[i] = SB[i + 1] + f[3] * CB[f[2]];
      }
      for (let i = 0, mr = -Infinity; i < n; i++) PM[i] = mr = Math.max(mr, FR[i]);
      const node = { top, bot, FL, FR, FJ, PM, SA, SB, exact, kids: null };
      if (exact.length > 48 && bot - top > 32) {
        const ksh = (bot - top) / 8, lists = [[], [], [], [], [], [], [], []];
        const kid = (y) => Math.min(7, Math.max(0, Math.floor((y - top) / ksh)));
        for (const j of exact) {
          const ya = Math.min(VY[U[j]], VY[V[j]]) - 1, yb = Math.max(VY[U[j]], VY[V[j]]) + 1;
          for (let c = kid(ya), ce = kid(yb); c <= ce; c++) lists[c].push(j);
        }
        node.kids = new Array(8);
        node.kid = kid;
        node.lists = lists;
        node.ksh = ksh;
      }
      return node;
    };
    const slabData = new Array(NS);
    const inside = (wa, wb) => {
      const a = filled(wa, rule), b = filled(wb, rule);
      return op === 'union' ? a || b : op === 'intersect' ? a && b : op === 'subtract' ? a && !b : a !== b;
    };
    const DU = [], DV = [];
    let wa = 0, wb = 0, mx = 0, my = 0;
    const test = (j) => {
      const px = VX[U[j]], py = VY[U[j]], qx = VX[V[j]], qy = VY[V[j]];
      if (py <= my) {
        if (qy > my && (qx - px) * (my - py) - (mx - px) * (qy - py) > 0) { wa += CA[j]; wb += CB[j]; }
      } else if (qy <= my && (qx - px) * (my - py) - (mx - px) * (qy - py) < 0) { wa -= CA[j]; wb -= CB[j]; }
    };
    for (const k of live) {
      const ax = VX[U[k]], ay = VY[U[k]], bx = VX[V[k]], by = VY[V[k]];
      mx = (ax + bx) / 2; my = (ay + by) / 2;
      // Winding of every other edge at the midpoint (exact: the midpoint lies on no other edge).
      wa = 0; wb = 0;
      const si = slabOf(my);
      let nd = slabData[si] || (slabData[si] = prepare(y0 + si * sh, y0 + (si + 1) * sh, slabs[si]));
      while (true) {
        const FL = nd.FL;
        let lo = 0, hi = FL.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (FL[mid] > mx) hi = mid; else lo = mid + 1; }
        wa += nd.SA[lo]; wb += nd.SB[lo];
        for (let t = lo - 1; t >= 0 && nd.PM[t] >= mx; t--) if (nd.FR[t] >= mx && nd.FJ[t] !== k) test(nd.FJ[t]);
        if (!nd.kids) { for (const j of nd.exact) if (j !== k) test(j); break; }
        const c = nd.kid(my);
        nd = nd.kids[c] || (nd.kids[c] = prepare(nd.top + c * nd.ksh, nd.top + (c + 1) * nd.ksh, nd.lists[c]));
      }
      // The half-open rule puts that count on one known side of this edge; its own count separates left from right.
      const dy = by - ay, dx = bx - ax;
      let la = wa, lb = wb, ra = wa, rb = wb;
      if (dy > 0 || (dy === 0 && dx < 0)) { la += CA[k]; lb += CB[k]; } else { ra -= CA[k]; rb -= CB[k]; }
      const L = inside(la, lb), R = inside(ra, rb);
      if (L === R) continue;
      if (L) { DU.push(U[k]); DV.push(V[k]); } else { DU.push(V[k]); DV.push(U[k]); }
    }

    // Chain the kept edges into rings.
    const out = new Map();
    for (let k = 0; k < DU.length; k++) { let l = out.get(DU[k]); if (!l) out.set(DU[k], (l = [])); l.push(k); }
    const used = new Uint8Array(DU.length), rings = [];
    for (let e0 = 0; e0 < DU.length; e0++) {
      if (used[e0]) continue;
      const start = DU[e0], ring = [];
      let cur = e0, ok = true;
      while (true) {
        used[cur] = 1;
        ring.push(DU[cur]);
        const v = DV[cur];
        if (v === start) break;
        const dx = VX[v] - VX[DU[cur]], dy = VY[v] - VY[DU[cur]];
        let best = -1, bestAng = -Infinity;
        for (const o of out.get(v) || []) {
          if (used[o]) continue;
          const ox = VX[DV[o]] - VX[v], oy = VY[DV[o]] - VY[v], ang = Math.atan2(dx * oy - dy * ox, dx * ox + dy * oy);
          if (ang > bestAng) { bestAng = ang; best = o; }
        }
        if (best < 0) { ok = false; break; }
        cur = best;
      }
      if (!ok) continue;
      // Drop vertices in the middle of straight runs.
      let r = ring, changed = true;
      while (changed && r.length >= 3) {
        changed = false;
        const keep = [];
        for (let i = 0; i < r.length; i++) {
          const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
          if (orient(VX[a], VY[a], VX[b], VY[b], VX[c], VY[c]) === 0) changed = true; else keep.push(b);
        }
        r = keep;
      }
      if (r.length < 3) continue;
      const pts = r.map((id) => [VX[id] / sc + minX, VY[id] / sc + minY]);
      if (area(pts) !== 0) rings.push(pts);
    }
    return rings;
  }
  const ringsToPath = (rings) => rings.map((r) => ({ closed: true, pts: r.map((p) => anchor(p[0], p[1])) }));
  function boolean(op, a, b, rule = 'nonzero') {
    return ringsToPath(booleanRings(op, flatten(a, 0.1), flatten(b, 0.1), rule));
  }

  // ---- Simplification ----
  function rdp(points, tol) {
    const n = points.length;
    if (n < 3) return points.map((p) => [p[0], p[1]]);
    const keep = new Uint8Array(n), stack = [[0, n - 1]];
    keep[0] = keep[n - 1] = 1;
    while (stack.length) {
      const [a, b] = stack.pop();
      let md = -1, mi = -1;
      for (let k = a + 1; k < b; k++) {
        const d = segDist(points[k][0], points[k][1], points[a][0], points[a][1], points[b][0], points[b][1]);
        if (d > md) { md = d; mi = k; }
      }
      if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    const out = [];
    for (let k = 0; k < n; k++) if (keep[k]) out.push([points[k][0], points[k][1]]);
    return out;
  }
  // A ring is cut at its first point and the point farthest from it, so both halves are open polylines for rdp.
  function simplifyRings(rings, tol) {
    const out = [];
    for (const r of rings || []) {
      if (r.length < 4) { if (r.length >= 3) out.push(r.map((p) => [p[0], p[1]])); continue; }
      let far = 1, fd = -1;
      for (let k = 1; k < r.length; k++) { const d = Math.hypot(r[k][0] - r[0][0], r[k][1] - r[0][1]); if (d > fd) { fd = d; far = k; } }
      const a = rdp(r.slice(0, far + 1), tol), b = rdp(r.slice(far).concat([r[0]]), tol);
      const ring = a.slice(0, -1).concat(b.slice(0, -1));
      if (ring.length >= 3) out.push(ring);
    }
    return out;
  }

  // ---- Curve fitting (Schneider, "An algorithm for automatically fitting digitized curves", Graphics Gems 1990) ----
  const v2 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1]],
    mul: (a, k) => [a[0] * k, a[1] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1],
    len: (a) => Math.hypot(a[0], a[1]),
    norm: (a) => { const l = Math.hypot(a[0], a[1]); return l ? [a[0] / l, a[1] / l] : [0, 0]; },
  };
  const bz = (b, t) => bezAt([b[0][0], b[0][1], b[1][0], b[1][1], b[2][0], b[2][1], b[3][0], b[3][1]], t);
  function generateBezier(d, first, last, u, t1, t2) {
    const p0 = d[first], p3 = d[last];
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i <= last - first; i++) {
      const t = u[i], mt = 1 - t, b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
      const a0 = v2.mul(t1, b1), a1 = v2.mul(t2, b2);
      c00 += v2.dot(a0, a0); c01 += v2.dot(a0, a1); c11 += v2.dot(a1, a1);
      const tmp = v2.sub(d[first + i], v2.add(v2.mul(p0, b0 + b1), v2.mul(p3, b2 + b3)));
      x0 += v2.dot(a0, tmp); x1 += v2.dot(a1, tmp);
    }
    const det = c00 * c11 - c01 * c01;
    let al = det ? (x0 * c11 - x1 * c01) / det : 0, ar = det ? (c00 * x1 - c01 * x0) / det : 0;
    const segLen = v2.len(v2.sub(p3, p0));
    // A degenerate or negative solution would loop the curve: fall back to the classic third-of-the-chord handles.
    if (al < 1e-6 * segLen || ar < 1e-6 * segLen) al = ar = segLen / 3;
    return [p0, v2.add(p0, v2.mul(t1, al)), v2.add(p3, v2.mul(t2, ar)), p3];
  }
  function newtonRoot(b, p, u) {
    const c = [b[0][0], b[0][1], b[1][0], b[1][1], b[2][0], b[2][1], b[3][0], b[3][1]];
    const q = bezAt(c, u), q1 = bezDeriv(c, u);
    const mt = 1 - u;
    const q2 = [6 * mt * (c[4] - 2 * c[2] + c[0]) + 6 * u * (c[6] - 2 * c[4] + c[2]), 6 * mt * (c[5] - 2 * c[3] + c[1]) + 6 * u * (c[7] - 2 * c[5] + c[3])];
    const dx = q[0] - p[0], dy = q[1] - p[1], num = dx * q1[0] + dy * q1[1], den = q1[0] * q1[0] + q1[1] * q1[1] + dx * q2[0] + dy * q2[1];
    if (!den) return u;
    const r = u - num / den;
    return r < 0 ? 0 : r > 1 ? 1 : r;
  }
  function maxError(d, first, last, b, u) {
    let md = 0, split = Math.floor((last - first + 1) / 2) + first;
    for (let i = first + 1; i < last; i++) {
      const q = bz(b, u[i - first]), dd = Math.hypot(q[0] - d[i][0], q[1] - d[i][1]);
      if (dd >= md) { md = dd; split = i; }
    }
    return [md, split];
  }
  function fitCubic(d, first, last, t1, t2, error, out, depth) {
    if (last - first === 1) {
      const dist = v2.len(v2.sub(d[last], d[first])) / 3;
      out.push([d[first], v2.add(d[first], v2.mul(t1, dist)), v2.add(d[last], v2.mul(t2, dist)), d[last]]);
      return;
    }
    let u = [0];
    for (let i = first + 1; i <= last; i++) u.push(u[i - first - 1] + v2.len(v2.sub(d[i], d[i - 1])));
    const total = u[u.length - 1] || 1;
    u = u.map((v) => v / total);
    let b = generateBezier(d, first, last, u, t1, t2), [err, split] = maxError(d, first, last, b, u);
    if (err < error) { out.push(b); return; }
    if (err < error * 4) {
      for (let it = 0; it < 20; it++) {
        const u2 = u.map((t, i) => newtonRoot(b, d[first + i], t));
        const b2 = generateBezier(d, first, last, u2, t1, t2), [e2, s2] = maxError(d, first, last, b2, u2);
        if (e2 < error) { out.push(b2); return; }
        if (e2 < err) { b = b2; err = e2; split = s2; }
        u = u2;
      }
    }
    if (depth > 40) { out.push(b); return; }
    split = Math.min(last - 1, Math.max(first + 1, split));
    let tc = v2.norm(v2.sub(d[split - 1], d[split + 1]));
    if (!tc[0] && !tc[1]) tc = v2.norm(v2.sub(d[split - 1], d[split]));
    fitCubic(d, first, split, t1, tc, error, out, depth + 1);
    fitCubic(d, split, last, v2.mul(tc, -1), t2, error, out, depth + 1);
  }
  function fit(points, error = 2) {
    const d = [];
    for (const p of points || []) {
      const q = Array.isArray(p) ? [+p[0], +p[1]] : [+p.x, +p.y];
      if (!isFinite(q[0]) || !isFinite(q[1])) continue;
      if (d.length && Math.hypot(q[0] - d[d.length - 1][0], q[1] - d[d.length - 1][1]) < 1e-9) continue;
      d.push(q);
    }
    if (!d.length) return { closed: false, pts: [] };
    if (d.length === 1) return { closed: false, pts: [anchor(d[0][0], d[0][1])] };
    // Corners: the turn between the points about `error` behind and ahead exceeds 60 degrees; keep only the sharpest
    // point of each cluster, so the samples next to a corner don't become corners too.
    const n = d.length, turn = new Float64Array(n), win = Math.max(error, 1e-6), cos60 = Math.cos(60 * RAD);
    for (let i = 1; i < n - 1; i++) {
      let j = i - 1, k = i + 1;
      while (j > 0 && v2.len(v2.sub(d[i], d[j])) < win) j--;
      while (k < n - 1 && v2.len(v2.sub(d[k], d[i])) < win) k++;
      const a = v2.norm(v2.sub(d[i], d[j])), b = v2.norm(v2.sub(d[k], d[i]));
      turn[i] = 1 - v2.dot(a, b); // 0 straight, 2 reversal
    }
    const corners = [0];
    for (let i = 1; i < n - 1; i++) {
      if (turn[i] <= 1 - cos60) continue;
      let max = true;
      for (let k = i - 1; k >= 1 && v2.len(v2.sub(d[i], d[k])) < win * 2; k--) if (turn[k] > turn[i]) max = false;
      for (let k = i + 1; k < n - 1 && v2.len(v2.sub(d[k], d[i])) < win * 2; k++) if (turn[k] >= turn[i]) max = false;
      if (max) corners.push(i);
    }
    corners.push(n - 1);
    const beziers = [];
    for (let c = 0; c < corners.length - 1; c++) {
      const a = corners[c], b = corners[c + 1];
      fitCubic(d, a, b, v2.norm(v2.sub(d[a + 1], d[a])), v2.norm(v2.sub(d[b - 1], d[b])), error, beziers, 0);
    }
    const pts = [anchor(d[0][0], d[0][1])];
    for (const b of beziers) {
      const p = pts[pts.length - 1];
      p.ox = b[1][0]; p.oy = b[1][1];
      pts.push({ x: b[3][0], y: b[3][1], ix: b[2][0], iy: b[2][1], ox: b[3][0], oy: b[3][1] });
    }
    return { closed: false, pts };
  }

  // ---- Shapes (closed ones run with positive area: clockwise on a y-down screen) ----
  function rect(x, y, w, h, r = 0) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (!r) return [{ closed: true, pts: [anchor(x, y), anchor(x + w, y), anchor(x + w, y + h), anchor(x, y + h)] }];
    const k = r * KAPPA, R = x + w, B = y + h, pts = [];
    const p = (px, py, ix, iy, ox, oy) => pts.push({ x: px, y: py, ix, iy, ox, oy });
    p(x + r, y, x + r - k, y, x + r, y); p(R - r, y, R - r, y, R - r + k, y);
    p(R, y + r, R, y + r - k, R, y + r); p(R, B - r, R, B - r, R, B - r + k);
    p(R - r, B, R - r + k, B, R - r, B); p(x + r, B, x + r, B, x + r - k, B);
    p(x, B - r, x, B - r + k, x, B - r); p(x, y + r, x, y + r, x, y + r - k);
    // Where two arcs meet (r is half a side) the straight run between them has zero length: drop the duplicate anchors.
    const out = [];
    for (const q of pts) {
      const l = out[out.length - 1];
      if (l && Math.abs(l.x - q.x) < 1e-12 && Math.abs(l.y - q.y) < 1e-12) { l.ox = q.ox; l.oy = q.oy; } else out.push(q);
    }
    const f = out[0], l = out[out.length - 1];
    if (out.length > 1 && Math.abs(l.x - f.x) < 1e-12 && Math.abs(l.y - f.y) < 1e-12) { f.ix = l.ix; f.iy = l.iy; out.pop(); }
    return [{ closed: true, pts: out }];
  }
  function ellipse(cx, cy, rx, ry) {
    const kx = rx * KAPPA, ky = ry * KAPPA;
    return [{
      closed: true,
      pts: [
        { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ky, ox: cx + rx, oy: cy + ky },
        { x: cx, y: cy + ry, ix: cx + kx, iy: cy + ry, ox: cx - kx, oy: cy + ry },
        { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ky, ox: cx - rx, oy: cy - ky },
        { x: cx, y: cy - ry, ix: cx - kx, iy: cy - ry, ox: cx + kx, oy: cy - ry },
      ],
    }];
  }
  // Rotation is in degrees; with 0 the first vertex points straight up.
  function polygon(cx, cy, rx, ry, sides, rotation = 0) {
    const n = Math.max(3, Math.round(sides)), pts = [];
    for (let i = 0; i < n; i++) {
      const a = (rotation - 90 + (360 * i) / n) * RAD;
      pts.push(anchor(cx + rx * Math.cos(a), cy + ry * Math.sin(a)));
    }
    return [{ closed: true, pts }];
  }
  function star(cx, cy, rx, ry, points, inner = 0.5, rotation = 0) {
    const n = Math.max(2, Math.round(points)), pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (rotation - 90 + (180 * i) / n) * RAD, k = i % 2 ? inner : 1;
      pts.push(anchor(cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)));
    }
    return [{ closed: true, pts }];
  }
  const line = (x0, y0, x1, y1) => [{ closed: false, pts: [anchor(x0, y0), anchor(x1, y1)] }];
  // Archimedean spiral from the centre out to radius r, eight cubic pieces per turn (Hermite handles from the derivative).
  function spiral(cx, cy, r, turns) {
    turns = Math.max(0.25, turns || 1);
    const total = turns * 2 * Math.PI, n = Math.max(2, Math.ceil(turns * 8)), dt = total / n, k = r / total, pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i * dt, rho = k * t, c = Math.cos(t), s = Math.sin(t);
      const x = cx + rho * c, y = cy + rho * s, dx = (k * c - rho * s) * (dt / 3), dy = (k * s + rho * c) * (dt / 3);
      pts.push({ x, y, ix: x - dx, iy: y - dy, ox: x + dx, oy: y + dy });
    }
    pts[0].ix = pts[0].x; pts[0].iy = pts[0].y;
    pts[n].ox = pts[n].x; pts[n].oy = pts[n].y;
    return [{ closed: false, pts }];
  }

  // ---- Stroking and offsetting ----
  // The stroke of a polyline is the union of one quad per segment, a join piece on the outer side of every vertex and a
  // cap at each open end, exactly what a browser fills. All pieces get a positive area and one nonzero boolean union
  // resolves every overlap (short segments, cusps, 180 degree turns, a path crossing itself). Curves are flattened first;
  // the vertices that flattening adds inside a curve get round joins, so the outline follows the true offset curve. Round
  // parts come back as short straight segments whose chord error is at most `tolerance` (default min(0.1, width / 20)).
  const CHUNK = 32;
  function strokeRings(path, width, opts) {
    const o = opts || {}, h = Math.abs(+width || 0) / 2;
    if (!(h > 0) || !isFinite(h)) return [];
    const cap = o.cap === 'round' || o.cap === 'square' ? o.cap : 'butt';
    const join = o.join === 'round' || o.join === 'bevel' ? o.join : 'miter';
    const limit = Math.max(1, +o.miterLimit || 4);
    const tol = o.tolerance > 0 ? Math.min(+o.tolerance, h / 4) : Math.min(0.1, h / 10);
    const astep = 2 * Math.acos(1 - tol / h), eps = 1e-7 * Math.max(1, h);
    const pieces = [];
    const push = (r) => { const a = area(r); if (a < 0) r.reverse(); if (a) pieces.push(r); };
    // Points on the circle of radius h around (cx, cy) from angle a0 turning by delta, without the start point.
    const arc = (cx, cy, a0, delta, out) => {
      const n = Math.max(1, Math.ceil(Math.abs(delta) / astep - 1e-9));
      for (let k = 1; k <= n; k++) { const a = a0 + (delta * k) / n; out.push([cx + h * Math.cos(a), cy + h * Math.sin(a)]); }
      return out;
    };
    // The outer edge of a join at (px, py) between unit directions d1 (in) and d2 (out), from the end of the incoming
    // segment's offset to the start of the outgoing one. The outer side is the one the path turns away from (sign sg: +1
    // is the side of the normal (dy, -dx)); a full reversal turns through the forward direction d1.
    function joinEdge(px, py, d1x, d1y, d2x, d2y, kind, sg, out) {
      const cr = d1x * d2y - d1y * d2x, dt = d1x * d2x + d1y * d2y;
      const n1x = sg * d1y, n1y = -sg * d1x, n2x = sg * d2y, n2y = -sg * d2x;
      if (kind === 'round' && cr !== 0 && dt > 0 && Math.abs(Math.atan2(cr, dt)) <= astep) {
        // A turn so small that its arc is a single chord (the usual case inside a flattened curve): one point on the arc
        // half way round keeps the outline within the tolerance with half the vertices.
        const mx = n1x + n2x, my = n1y + n2y, ml = Math.hypot(mx, my);
        out.push([px + (h * mx) / ml, py + (h * my) / ml]);
        return out;
      }
      out.push([px + h * n1x, py + h * n1y]);
      if (cr === 0 && dt > 0) return out;
      if (kind === 'round') return arc(px, py, Math.atan2(n1y, n1x), cr === 0 ? Math.PI : Math.atan2(cr, dt), out);
      if (kind === 'miter' && 1 + dt > 1e-12 && 2 / (1 + dt) <= limit * limit) {
        const k = h / (1 + dt);
        out.push([px + k * (n1x + n2x), py + k * (n1y + n2y)]);
      }
      out.push([px + h * n2x, py + h * n2y]);
      return out;
    }
    const sideOf = (d1x, d1y, d2x, d2y) => (d1x * d2y - d1y * d2x < 0 ? -1 : 1);
    // Pieces that would only touch along a line (a join wedge and the segment ends next to it, two strips meeting at a
    // break, a cap and its strip) are made to overlap by ov instead: each boolean call rounds to its own grid, and two
    // separately rounded copies of one line can leave a hairline slit between them.
    let ov = 0;
    // A join on its own: the wedge between the vertex and its outer edge, reaching e1 back into the incoming segment and
    // e2 on into the outgoing one.
    function joinPiece(px, py, d1x, d1y, d2x, d2y, kind, e1, e2) {
      const sg = sideOf(d1x, d1y, d2x, d2y), out = [[px - e1 * d1x, py - e1 * d1y], [px + h * sg * d1y - e1 * d1x, py - h * sg * d1x - e1 * d1y]];
      joinEdge(px, py, d1x, d1y, d2x, d2y, kind, sg, out);
      out.push([px + h * sg * d2y + e2 * d2x, py - h * sg * d2x + e2 * d2y], [px + e2 * d2x, py + e2 * d2y]);
      push(out);
    }
    // Cap at an open end (px, py) where the path leaves in unit direction (dx, dy), reaching e back over the segment.
    function capPiece(px, py, dx, dy, e) {
      const nx = dy * h, ny = -dx * h, bx = px - e * dx, by = py - e * dy;
      if (cap === 'square') push([[bx + nx, by + ny], [px + nx + dx * h, py + ny + dy * h], [px - nx + dx * h, py - ny + dy * h], [bx - nx, by - ny]]);
      else if (cap === 'round') { const r = arc(px, py, Math.atan2(ny, nx), Math.PI, [[bx + nx, by + ny], [px + nx, py + ny]]); r.push([bx - nx, by - ny]); push(r); }
    }
    // Flatten every subpath segment by segment, so we know which vertices are real anchors; drop repeated points.
    const subs = [];
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const s of path || []) {
      if (!s || !s.pts || !s.pts.length) continue;
      const P = [], A = [];
      const add = (x, y, isAnchor) => {
        const l = P[P.length - 1];
        if (l && Math.abs(x - l[0]) <= eps && Math.abs(y - l[1]) <= eps) { if (isAnchor) A[A.length - 1] = 1; return; }
        P.push([x, y]); A.push(isAnchor ? 1 : 0);
      };
      add(s.pts[0].x, s.pts[0].y, 1);
      for (let i = 0, n = segCount(s); i < n; i++) {
        const c = segOf(s, i);
        if (isLine(c)) { add(c[6], c[7], 1); continue; }
        const tmp = [];
        flattenCubic(c, tol, tmp, 0);
        for (let k = 0; k < tmp.length; k++) add(tmp[k][0], tmp[k][1], k === tmp.length - 1);
      }
      const closed = !!s.closed;
      if (closed && P.length > 1) {
        const l = P[P.length - 1];
        if (Math.abs(l[0] - P[0][0]) <= eps && Math.abs(l[1] - P[0][1]) <= eps) { P.pop(); A[0] = 1; A.pop(); }
      }
      for (const q of P) { if (q[0] < bx0) bx0 = q[0]; if (q[0] > bx1) bx1 = q[0]; if (q[1] < by0) by0 = q[1]; if (q[1] > by1) by1 = q[1]; }
      subs.push({ P, A, closed });
    }
    if (!subs.length) return [];
    ov = Math.max((32 * (Math.max(bx1 - bx0, by1 - by0) + 2 * h)) / GRID, 1e-6 * h); // 16 cells of the coarsest grid
    for (const { P, A, closed } of subs) {
      const n = P.length;
      if (n === 1) { // a zero-length subpath: a dot for round caps, an axis-aligned square for square caps
        const [px, py] = P[0];
        if (cap === 'round') push(arc(px, py, 0, 2 * Math.PI, []));
        else if (cap === 'square') push([[px - h, py - h], [px + h, py - h], [px + h, py + h], [px - h, py + h]]);
        continue;
      }
      const m = closed ? n : n - 1, DX = new Float64Array(m), DY = new Float64Array(m), L = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        const a = P[i], b = P[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        DX[i] = (b[0] - a[0]) / l; DY[i] = (b[1] - a[1]) / l; L[i] = l;
      }
      // Runs of vertices where the inner offset lines meet in order along each segment become one strip polygon (outer
      // joins on one side, the inner meeting points on the other). Such a strip is a locally one-to-one sweep, so it
      // never winds negatively. Other vertices (sharp turns next to short segments, cusps, tight curves) break the run and
      // get a separate join wedge; the union then sorts out the overlap. The inner lines of vertex i meet h tan(turn / 2)
      // from it; on each segment the two meeting points at its ends must not pass each other when on the same side.
      const brk = new Uint8Array(n), TI = new Float64Array(n), SI = new Int8Array(n);
      if (!closed) brk[0] = brk[n - 1] = 1;
      for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
        const j = (i + m - 1) % m, cr = DX[j] * DY[i] - DY[j] * DX[i], dt = DX[j] * DX[i] + DY[j] * DY[i];
        if (1 + dt < 1e-9) { brk[i] = 1; continue; }
        TI[i] = (h * Math.abs(cr)) / (1 + dt); SI[i] = cr < 0 ? -1 : 1;
        if (TI[i] > Math.min(L[j], L[i])) brk[i] = 1;
      }
      for (let i = closed ? 0 : 1, prev = closed ? n - 1 : 0; i < (closed ? n : n - 1); i++) {
        if (brk[i]) { prev = i; continue; }
        const j = (i + m - 1) % m, before = !brk[prev] && SI[prev] === SI[i] ? TI[prev] : 0;
        if (TI[i] + before > L[j]) brk[i] = 1;
        prev = i;
      }
      // Long runs are cut into chunks too, so the union below can merge neighbours first and drop their shared insides.
      for (let i = 0, run = 0; i < n; i++) { if (brk[i]) run = 0; else if (++run >= CHUNK) { brk[i] = 1; run = 0; } }
      const strip = (a, steps, e0, e1) => { // from vertex a along `steps` segments, reaching e0 back and e1 on at the ends
        const plus = [], minus = [];
        let s = a % m;
        const sx = P[a % n][0] - e0 * DX[s], sy = P[a % n][1] - e0 * DY[s];
        plus.push([sx + h * DY[s], sy - h * DX[s]]);
        minus.push([sx - h * DY[s], sy + h * DX[s]]);
        for (let k = 1; k < steps; k++) {
          const v = (a + k) % n, j = s, i = v % m, px = P[v][0], py = P[v][1];
          const dt = DX[j] * DX[i] + DY[j] * DY[i], sg = sideOf(DX[j], DY[j], DX[i], DY[i]), kk = (sg * h) / (1 + dt);
          const inner = [px - kk * (DY[j] + DY[i]), py + kk * (DX[j] + DX[i])];
          if (sg > 0) { joinEdge(px, py, DX[j], DY[j], DX[i], DY[i], A[v] ? join : 'round', 1, plus); minus.push(inner); } else {
            joinEdge(px, py, DX[j], DY[j], DX[i], DY[i], A[v] ? join : 'round', -1, minus); plus.push(inner);
          }
          s = i;
        }
        const b = (a + steps) % n, ex = P[b][0] + e1 * DX[s], ey = P[b][1] + e1 * DY[s];
        plus.push([ex + h * DY[s], ey - h * DX[s]]);
        minus.push([ex - h * DY[s], ey + h * DX[s]]);
        return [plus, minus];
      };
      const breaks = [];
      for (let i = 0; i < n; i++) if (brk[i]) breaks.push(i);
      if (closed && !breaks.length) {
        // A closed run without breaks: two rings, the outer side forward and the other side backward.
        // Go once round plus one segment so vertex 0 gets its join too, then drop the two points on segment 0's offset.
        const [plus, minus] = strip(0, n + 1, 0, 0);
        const ring = plus.slice(1, -1), back = minus.slice(1, -1).reverse();
        if (area(ring) + area(back) > 0) { pieces.push(ring); pieces.push(back); } else { pieces.push(ring.reverse()); pieces.push(back.reverse()); }
      } else {
        for (let k = 0; k < breaks.length; k++) {
          const a = breaks[k], b = k + 1 < breaks.length ? breaks[k + 1] : closed ? breaks[0] + n : -1;
          if (b < 0) break;
          const inner0 = closed || a > 0, inner1 = closed || b < n - 1;
          const [plus, minus] = strip(a, b - a, inner0 ? Math.min(ov, L[(a + m - 1) % m] / 2) : 0, inner1 ? Math.min(ov, L[b % m] / 2) : 0);
          push(plus.concat(minus.reverse()));
          // The join at the end of this run follows it, keeping the pieces in path order for the union.
          if (inner1) {
            const i = b % n, j = (i + m - 1) % m;
            joinPiece(P[i][0], P[i][1], DX[j], DY[j], DX[i], DY[i], A[i] ? join : 'round', Math.min(ov, L[j] / 2), Math.min(ov, L[i] / 2));
          }
        }
      }
      if (!closed) {
        capPiece(P[0][0], P[0][1], -DX[0], -DY[0], Math.min(ov, L[0] / 2));
        capPiece(P[n - 1][0], P[n - 1][1], DX[m - 1], DY[m - 1], Math.min(ov, L[m - 1] / 2));
      }
    }
    if (o._pieces) return pieces;
    if (!pieces.length) return [];
    // Exact union, merging neighbouring pieces first (pieces are in path order, so neighbours overlap the most), then drop
    // the near-collinear vertices the pieces leave along curved runs.
    const unite = (lo, hi) => {
      if (hi - lo <= 8) return booleanRings('union', pieces.slice(lo, hi), [], 'nonzero');
      const mid = (lo + hi) >> 1;
      return booleanRings('union', unite(lo, mid), unite(mid, hi), 'nonzero');
    };
    return simplifyRings(unite(0, pieces.length), tol / 2).filter((r) => Math.abs(area(r)) > 1e-12);
  }
  function strokeToPath(path, width, opts) {
    return ringsToPath(strokeRings(path, width, opts));
  }

  // Grow (d > 0) or shrink (d < 0) the filled shape by |d|; open subpaths count as closed. `opts` may carry miterLimit
  // and tolerance as for strokeToPath.
  function offset(path, d, join = 'round', opts) {
    const closedPath = (path || []).filter((s) => s && s.pts && s.pts.length).map((s) => ({ closed: true, pts: s.pts }));
    const fill = flatten(closedPath, 0.05);
    d = +d || 0;
    if (!d) return ringsToPath(booleanRings('union', fill, [], 'nonzero'));
    const band = strokeRings(closedPath, 2 * Math.abs(d), Object.assign({}, opts, { join, cap: 'butt' }));
    return ringsToPath(booleanRings(d > 0 ? 'union' : 'subtract', fill, band, 'nonzero'));
  }

  // Round the sharp corners between two straight segments with circular arcs of the given radius (shrunk where the
  // segments are too short to fit it: each arc uses at most half of each neighbouring segment). Corners next to a curve
  // segment and smooth anchors are left alone.
  function roundCorners(path, radius) {
    const r0 = Math.max(0, +radius || 0);
    if (!r0) return clone(path);
    return (path || []).map((s) => {
      const n = s.pts.length, out = [];
      for (let i = 0; i < n; i++) {
        const p = s.pts[i], hasPrev = s.closed || i > 0, hasNext = s.closed || i < n - 1;
        const prev = s.pts[(i + n - 1) % n], next = s.pts[(i + 1) % n];
        const straightIn = hasPrev && isLine([prev.x, prev.y, prev.ox, prev.oy, p.ix, p.iy, p.x, p.y]);
        const straightOut = hasNext && isLine([p.x, p.y, p.ox, p.oy, next.ix, next.iy, next.x, next.y]);
        const l1 = straightIn ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0, l2 = straightOut ? Math.hypot(next.x - p.x, next.y - p.y) : 0;
        if (!l1 || !l2) { out.push(clonePt(p)); continue; }
        const ux = (p.x - prev.x) / l1, uy = (p.y - prev.y) / l1, vx = (next.x - p.x) / l2, vy = (next.y - p.y) / l2;
        const turn = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
        if (turn < 1e-6 || turn > Math.PI - 1e-6) { out.push(clonePt(p)); continue; }
        // Tangent length r tan(turn / 2), limited to half of each neighbour.
        const tl = Math.min(r0 * Math.tan(turn / 2), l1 / 2, l2 / 2), r = tl / Math.tan(turn / 2), k = (4 / 3) * Math.tan(turn / 4) * r;
        const ax = p.x - ux * tl, ay = p.y - uy * tl, bx = p.x + vx * tl, by = p.y + vy * tl;
        out.push({ x: ax, y: ay, ix: ax, iy: ay, ox: ax + ux * k, oy: ay + uy * k });
        out.push({ x: bx, y: by, ix: bx - vx * k, iy: by - vy * k, ox: bx, oy: by });
      }
      // Arcs that meet where a neighbour was used up completely leave two anchors on one spot: merge them.
      const merged = [];
      for (const q of out) {
        const l = merged[merged.length - 1];
        if (l && Math.abs(l.x - q.x) < 1e-9 && Math.abs(l.y - q.y) < 1e-9) { l.ox = q.ox; l.oy = q.oy; } else merged.push(q);
      }
      if (s.closed && merged.length > 1) {
        const f = merged[0], l = merged[merged.length - 1];
        if (Math.abs(l.x - f.x) < 1e-9 && Math.abs(l.y - f.y) < 1e-9) { f.ix = l.ix; f.iy = l.iy; merged.pop(); }
      }
      return { closed: !!s.closed, pts: merged };
    });
  }

  return {
    KAPPA, parse, serialize, transform, multiply, invert, apply, bounds, flatten, contains, distance, nearest, split, boolean, booleanRings,
    simplifyRings, rdp, fit, smoothCorner, cornerize, rect, ellipse, polygon, star, line, spiral, reverse, area, length, clone,
    strokeToPath, offset, roundCorners,
  };
})();

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).NoorInkGeom;
