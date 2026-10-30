// Checks for the NoorInk tracer (wwwroot/js/inktrace.js), run in plain Node: node inktrace.test.js
'use strict';
const T = require('../../src/NoorMD/wwwroot/js/inktrace.js');
const G = require('../../src/NoorMD/wwwroot/js/inkgeom.js');

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!ok) failed++;
}

// ---- Synthetic images ----
const hexOf = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
function image(w, h, colourAt) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = colourAt(x + 0.5, y + 0.5, x, y), o = (y * w + x) * 4;
      if (!c) continue; // transparent
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  return { width: w, height: h, data };
}
const WHITE = [255, 255, 255], BLACK = [0, 0, 0], RED = [220, 30, 40], BLUE = [30, 60, 200], GREEN = [20, 160, 70], YELLOW = [240, 200, 20];
const inDisc = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

// Glyph-like shapes from bars and rings: a crude "NOOR" with holes in the Os and the R.
function textLike(x, y) {
  const bar = (x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;
  const ring = (cx, cy, r0, r1) => { const d = Math.hypot(x - cx, y - cy); return d <= r1 && d >= r0; };
  const N = bar(10, 20, 18, 80) || bar(42, 20, 50, 80) || (Math.abs((x - 10) * 60 / 40 - (y - 20)) < 7 && x >= 10 && x < 50);
  const O1 = ring(85, 50, 18, 30), O2 = ring(155, 50, 18, 30);
  const R = bar(200, 20, 208, 80) || (ring(215, 37, 9, 17) && x >= 208) || bar(200, 20, 215, 28) || bar(200, 46, 215, 54) || (Math.abs((x - 208) - (y - 50) * 0.8) < 5 && y >= 50 && y < 80);
  return N || O1 || O2 || R;
}

// ---- Rasterising the traced result (scanline, nonzero, painter's order) ----
function rasterise(layers, w, h) {
  const out = new Array(w * h).fill(null);
  for (const layer of layers) {
    const rings = G.flatten(layer.path, 0.05), edges = [];
    for (const r of rings) for (let i = 0; i < r.length; i++) edges.push([r[i], r[(i + 1) % r.length]]);
    for (let py = 0; py < h; py++) {
      const y = py + 0.5, xs = [];
      for (const [a, b] of edges) {
        if ((a[1] <= y) === (b[1] <= y)) continue;
        xs.push([a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), b[1] > a[1] ? 1 : -1]);
      }
      xs.sort((p, q) => p[0] - q[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k][1];
        if (!wind) continue;
        const xa = Math.max(0, Math.ceil(xs[k][0] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[k + 1][0] - 0.5));
        for (let px = xa; px <= xb; px++) out[py * w + px] = layer.colour;
      }
    }
  }
  return out;
}
// Fraction of pixels whose painted colour equals the input colour (null for transparent), ignoring pixels within
// `margin` of a colour change in the input.
function matchRate(img, layers, margin = 2, colourOf = (o, d) => (d[o + 3] < 128 ? null : hexOf([d[o], d[o + 1], d[o + 2]]))) {
  const { width: w, height: h, data } = img, got = rasterise(layers, w, h), want = new Array(w * h);
  for (let i = 0; i < w * h; i++) want[i] = colourOf(i * 4, data);
  let total = 0, ok = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let edge = false;
      for (let dy = -margin; dy <= margin && !edge; dy++) {
        for (let dx = -margin; dx <= margin; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (want[yy * w + xx] !== want[y * w + x]) { edge = true; break; }
        }
      }
      if (edge) continue;
      total++;
      if (got[y * w + x] === want[y * w + x]) ok++;
    }
  }
  return total ? ok / total : 1;
}
const pct = (v) => (v * 100).toFixed(2) + '%';
const ringAreas = (layer) => G.flatten(layer.path, 0.1).map((r) => G.area(r));

// ---- Two-colour discs on white ----
{
  const img = image(200, 150, (x, y) => (inDisc(x, y, 60, 70, 40) ? RED : inDisc(x, y, 135, 80, 30) ? BLUE : WHITE));
  for (const smooth of [0, 1, 2]) {
    const res = T.trace(img, { smooth });
    const rate = matchRate(img, res);
    check(`discs (smooth ${smooth}): 3 layers, ${pct(rate)} of pixels match`, res.length === 3 && rate >= 0.98, res.map((l) => l.colour).join(' '));
  }
  const res = T.trace(img);
  check('discs: largest colour (white) is at the back', res[0].colour === hexOf(WHITE));
  check('discs: colours are exact for a flat image', res.map((l) => l.colour).sort().join() === [WHITE, RED, BLUE].map(hexOf).sort().join());
  check('discs: smooth curves use cubic handles', res[1].path[0].pts.some((p) => p.ox !== p.x || p.ix !== p.x));
  const poly = T.trace(img, { smooth: 0 });
  check('discs: smooth 0 keeps straight polygons', poly.every((l) => l.path.every((s) => s.pts.every((p) => p.ox === p.x && p.iy === p.y))));
  // The front layer (blue, the smallest) is just its disc; the red layer also covers the blue disc beneath it.
  const layerArea = (l) => G.flatten(l.path, 0.05).reduce((s, r) => s + G.area(r), 0);
  const blueArea = layerArea(res[2]), redArea = layerArea(res[1]);
  check('discs: front (blue) disc area within 2% of pi r^2', res[2].colour === hexOf(BLUE) && Math.abs(blueArea - Math.PI * 900) / (Math.PI * 900) < 0.02, blueArea.toFixed(1));
  check('discs: stacked red layer covers both discs', Math.abs(redArea - Math.PI * 2500) / (Math.PI * 2500) < 0.02, redArea.toFixed(1));
  // Background drop.
  const drop = T.trace(img, { background: 'drop' });
  const dropRate = matchRate(img, drop, 2, (o, d) => (d[o] === 255 && d[o + 1] === 255 ? null : hexOf([d[o], d[o + 1], d[o + 2]])));
  check(`background drop leaves out white, ${pct(dropRate)} match with white as empty`, drop.length === 2 && !drop.some((l) => l.colour === hexOf(WHITE)) && dropRate >= 0.98);
  // Determinism.
  check('trace is deterministic', JSON.stringify(T.trace(img)) === JSON.stringify(T.trace(img)));
}

// ---- A ring with a hole ----
{
  const ring = (x, y) => { const d = Math.hypot(x - 64, y - 64); return d <= 50 && d >= 24; };
  const img = image(128, 128, (x, y) => (ring(x, y) ? GREEN : null)); // transparent background
  const res = T.trace(img);
  const areas = ringAreas(res[0]);
  check('ring on transparent: one layer, outer ring positive, hole negative', res.length === 1 && areas.length === 2 && areas.some((a) => a > 0) && areas.some((a) => a < 0), areas.map((a) => a.toFixed(0)).join(' '));
  const rate = matchRate(img, res);
  check(`ring on transparent: hole stays empty, ${pct(rate)} match`, rate >= 0.98 && !G.contains(res[0].path, 64, 64) && G.contains(res[0].path, 64, 26));
  const net = areas.reduce((s, a) => s + a, 0), want = Math.PI * (50 * 50 - 24 * 24);
  check('ring: net area within 2% of the annulus', Math.abs(net - want) / want < 0.02, `${net.toFixed(0)} vs ${want.toFixed(0)}`);
  const img2 = image(128, 128, (x, y) => (ring(x, y) ? GREEN : inDisc(x, y, 64, 64, 10) ? RED : WHITE));
  const res2 = T.trace(img2), rate2 = matchRate(img2, res2);
  check(`ring with a dot in its hole on white: ${pct(rate2)} match`, res2.length === 3 && rate2 >= 0.98);
}

// ---- Checkerboard ----
{
  const img = image(128, 128, (x, y, px, py) => (((px >> 4) + (py >> 4)) & 1 ? BLACK : WHITE));
  const res = T.trace(img), rate = matchRate(img, res, 1);
  check(`checkerboard 16px: 2 layers, ${pct(rate)} match`, res.length === 2 && rate >= 0.98);
  const poly = T.trace(img, { smooth: 0 }), front = poly[poly.length - 1];
  const corners = front.path.reduce((s, sub) => s + sub.pts.length, 0);
  check('checkerboard polygons keep square corners (4 anchors a square)', poly.length === 2 && corners <= 32 * 4 + 8 && matchRate(img, poly, 1) >= 0.99, `${corners} anchors in the front layer`);
  const fine = image(64, 64, (x, y, px, py) => ((px + py) & 1 ? BLACK : WHITE));
  const fr = T.trace(fine, { minArea: 0 });
  check('1px checkerboard does not crash and gives at most 2 layers', fr.length >= 1 && fr.length <= 2);
}

// ---- Text-like shapes, colour and mono ----
{
  const img = image(240, 100, (x, y) => (textLike(x, y) ? BLACK : WHITE));
  const res = T.trace(img), rate = matchRate(img, res);
  check(`text-like: ${pct(rate)} match`, res.length === 2 && rate >= 0.98);
  const mono = T.trace(img, { colours: 2, mono: true, threshold: 128 });
  check('mono: one black layer', mono.length === 1 && mono[0].colour === '#000000');
  const monoRate = matchRate(img, mono, 2, (o, d) => (d[o] < 128 ? '#000000' : null));
  check(`mono: dark parts only, holes open, ${pct(monoRate)} match`, monoRate >= 0.98 && !G.contains(mono[0].path, 85, 50) && G.contains(mono[0].path, 85, 24));
  const holes = ringAreas(mono[0]).filter((a) => a < 0).length;
  check('mono: the two Os and the R have holes (negative rings)', holes >= 3, String(holes));
  // Mono threshold on a grey ramp: the dark side only.
  const ramp = image(100, 20, (x) => [Math.floor(x * 2.55), Math.floor(x * 2.55), Math.floor(x * 2.55)]);
  const half = T.trace(ramp, { mono: true, threshold: 128 }), b = G.bounds(half[0].path);
  check('mono threshold splits a grey ramp at the threshold', Math.abs(b.x + b.w - 50.2) < 1.5 && b.x < 1, JSON.stringify(b));
  // Semi-transparent colour gives an opacity.
  const translucent = image(60, 60, (x, y) => (inDisc(x, y, 30, 30, 20) ? [200, 0, 0, 160] : WHITE));
  const tr = T.trace(translucent), red = tr.find((l) => l.colour === '#c80000');
  check('semi-transparent colour carries an opacity', red && Math.abs(red.opacity - 160 / 255) < 0.02, red && String(red.opacity));
}

// ---- Colour count ----
{
  const three = image(120, 80, (x, y) => (x < 40 ? RED : x < 80 ? GREEN : BLUE));
  check('three colours with colours: 6 gives 3 layers', T.trace(three, { colours: 6 }).length === 3);
  const five = image(150, 60, (x) => [RED, GREEN, BLUE, YELLOW, BLACK][Math.floor(x / 30)]);
  const r3 = T.trace(five, { colours: 3 });
  check('five colours with colours: 3 gives at most 3 layers', r3.length <= 3 && r3.length >= 2, String(r3.length));
  check('five colours with colours: 5 gives 5 exact colours', T.trace(five, { colours: 5 }).map((l) => l.colour).sort().join() === [RED, GREEN, BLUE, YELLOW, BLACK].map(hexOf).sort().join());
  const r2 = T.trace(five, { colours: 2, smooth: 0 });
  check('stacked layers: the back layer covers the whole picture', r2.length === 2 && G.contains(r2[0].path, 5, 30) && G.contains(r2[0].path, 145, 30));
  check('empty and fully transparent images give no layers', T.trace({ width: 0, height: 0, data: new Uint8ClampedArray(0) }).length === 0 && T.trace(image(10, 10, () => null)).length === 0);
  const tiny = image(40, 40, (x, y, px, py) => (px === 20 && py === 20 ? BLACK : WHITE));
  check('a single stray pixel is dropped by minArea', T.trace(tiny).length === 1 && T.trace(tiny, { minArea: 0 }).length === 2);
}

// ---- Downsampling and timing ----
{
  // A "photo": smooth gradients, a few shapes and deterministic noise.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const photo = (w, h) => image(w, h, (x, y) => {
    const u = x / w, v = y / h, n = (rnd() - 0.5) * 30;
    let c = [40 + 150 * v, 90 + 100 * u, 200 - 120 * u * v];
    if (inDisc(u, v, 0.35, 0.4, 0.2)) c = [230 - 60 * v, 120 + 50 * u, 40];
    if (Math.abs(u - 0.7) < 0.12 && Math.abs(v - 0.65) < 0.2) c = [60, 40 + 40 * v, 90];
    return c.map((k) => Math.max(0, Math.min(255, Math.round(k + n))));
  });
  const p256 = photo(256, 256);
  T.trace(p256, { colours: 8 }); // warm up
  const t0 = Date.now(), res = T.trace(p256, { colours: 8 }), t1 = Date.now();
  const anchors = res.reduce((s, l) => s + l.path.reduce((a, sub) => a + sub.pts.length, 0), 0);
  check(`256x256 photo, 8 colours, under 1.5 s (${t1 - t0} ms)`, t1 - t0 < 1500 && res.length >= 4 && res.length <= 8, `${res.length} layers, ${anchors} anchors`);
  const big = photo(1000, 1000);
  const t2 = Date.now(), rb = T.trace(big, { colours: 8 }), t3 = Date.now();
  const bb = G.bounds(rb[0].path);
  check(`1000x1000 photo downsampled to 512 and scaled back (${t3 - t2} ms)`, t3 - t2 < 10000 && bb.w > 990 && bb.h > 990 && bb.w <= 1001, JSON.stringify(bb));
  const half = image(400, 200, (x, y) => (inDisc(x, y, 200, 100, 80) ? RED : WHITE));
  const hs = T.trace(half, { maxSide: 100 }), red = hs.find((l) => l.colour === hexOf(RED));
  const rbox = G.bounds(red.path);
  check('maxSide: a downsampled disc keeps its place and size', Math.abs(rbox.x - 120) < 4 && Math.abs(rbox.w - 160) < 6 && Math.abs(rbox.y - 20) < 4, JSON.stringify(rbox));
  check(`maxSide 100 disc still matches ${pct(matchRate(half, hs, 5))}`, matchRate(half, hs, 5) >= 0.98);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
