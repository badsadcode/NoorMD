// Checks for the NoorPhoto filter library (wwwroot/js/photofx.js), run in plain Node: node photofx.test.js
'use strict';
const Fx = require('../../src/NoorMD/wwwroot/js/photofx.js');

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!ok) failed++;
}
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randomImg(w, h, seed, opaque) {
  const r = rng(seed), d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i++) d[i] = opaque && i % 4 === 3 ? 255 : Math.floor(r() * 256);
  return { width: w, height: h, data: d };
}
function flat(w, h, rgba) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) d.set(rgba, i);
  return { width: w, height: h, data: d };
}
const same = (a, b) => a.width === b.width && a.height === b.height && a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
function firstDiff(a, b) { for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return `byte ${i}: ${a.data[i]} vs ${b.data[i]}`; return ''; }

const ALL = [...Fx.FILTERS, ...Fx.ADJUSTMENTS];
const GROUPS = ['Blur', 'Sharpen', 'Noise', 'Stylize', 'Distort', 'Render'];

// ---- Catalogue ----
check('ids are unique', new Set(ALL.map((d) => d.id)).size === ALL.length);
check('every filter has a known group', Fx.FILTERS.every((f) => GROUPS.includes(f.group)));
check('every entry has a name and an about', ALL.every((d) => d.name && d.about && Array.isArray(d.params)));
check('every param has a key, label and type', ALL.every((d) => d.params.every((p) => p.key && p.label && p.type)));

// ---- Every operation runs on a random, a 1×1 and a fully transparent picture ----
const samples = { random: randomImg(24, 17, 7), single: randomImg(1, 1, 3), transparent: flat(9, 6, [0, 0, 0, 0]) };
for (const d of ALL) {
  let ok = true, why = '';
  for (const [name, img] of Object.entries(samples)) {
    const before = new Uint8ClampedArray(img.data);
    try {
      const out = Fx.apply(d.id, img, Fx.defaults(d.id), { scale: 1, seed: 1 });
      if (out.width !== img.width || out.height !== img.height) { ok = false; why = name + ': size changed'; }
      if (!(out.data instanceof Uint8ClampedArray) || out.data.length !== img.data.length) { ok = false; why = name + ': bad data'; }
      if (out.data === img.data) { ok = false; why = name + ': returned the input'; }
      if (!before.every((v, i) => v === img.data[i])) { ok = false; why = name + ': changed the input'; }
    } catch (e) { ok = false; why = name + ': ' + e.message; }
  }
  check(`${d.id} runs (random, 1×1, transparent)`, ok, why);
}

// ---- Neutral settings return identical pixels ----
const NEUTRAL = {
  gaussian: { radius: 0 }, motion: { distance: 0 }, radial: { amount: 0 }, spin: { angle: 0 }, lens: { radius: 0 }, surface: { radius: 0 },
  median: { radius: 0 }, tiltshift: { blur: 0, saturation: 0, contrast: 0 }, iris: { blur: 0 }, unsharp: { amount: 0 }, sharpen: { amount: 0 },
  clarity: { amount: 0 }, noise: { amount: 0 }, grain: { amount: 0 }, denoise: { strength: 0 }, dust: { radius: 0 }, glow: { strength: 0 },
  orton: { strength: 0 }, oil: { radius: 0 }, pixelate: { cell: 1 }, vignette: { amount: 0 }, chromatic: { amount: 0 }, glitch: { amount: 0, shift: 0 },
  solarize: { threshold: 255 }, offset: { x: 0, y: 0 }, twirl: { angle: 0 }, pinch: { amount: 0 }, ripple: { amplitude: 0 },
  lens_distort: { amount: 0, zoom: 100 }, flare: { brightness: 0 },
  brightness: {}, levels: {}, curves: {}, exposure: {}, huesat: {}, vibrance: {}, balance: {}, photofilter: { density: 0 }, temperature: {},
  shadows: { shadows: 0 }, channelmix: {},
};
const rnd = samples.random;
for (const [id, params] of Object.entries(NEUTRAL)) {
  const out = Fx.apply(id, rnd, params);
  check(`${id} at its neutral setting is an identity`, same(out, rnd), firstDiff(out, rnd));
}
// Exposure's linear-light round trip is exact even without the shortcut.
check('exposure +0 stops with gamma 1.0000001 keeps pixels', same(Fx.apply('exposure', rnd, { gamma: 1.0000001 }), rnd));

// ---- Colour adjustments keep alpha ----
for (const a of Fx.ADJUSTMENTS) {
  const out = Fx.apply(a.id, rnd, Fx.defaults(a.id));
  check(`${a.id} keeps alpha`, out.data.every((v, i) => i % 4 !== 3 || v === rnd.data[i]));
}

// ---- Gaussian blur ----
const teal = flat(40, 30, [20, 140, 200, 255]);
check('gaussian of a flat colour is the same flat colour', same(Fx.apply('gaussian', teal, { radius: 7 }), teal));
const red = flat(40, 40, [255, 0, 0, 0]);
for (let y = 12; y < 28; y++) for (let x = 12; x < 28; x++) red.data[(y * 40 + x) * 4 + 3] = 255;
const redBlur = Fx.apply('gaussian', red, { radius: 5 });
let fringe = 0, spread = 0;
for (let i = 0; i < redBlur.data.length; i += 4) {
  if (redBlur.data[i + 3] > 0 && redBlur.data[i] < 250) fringe++;
  if (redBlur.data[i + 3] > 0 && red.data[i + 3] === 0) spread++;
}
check('gaussian keeps a transparent-edged red square red (no dark fringe)', fringe === 0 && spread > 0, `${fringe} dark pixels, ${spread} spread`);
const a10 = Fx.apply('gaussian', rnd, { radius: 10 }, { scale: 0.5 }), a5 = Fx.apply('gaussian', rnd, { radius: 5 });
check('opts.scale halves px params (radius 10 at 0.5 = radius 5)', same(a10, a5));

// ---- Exact round trips ----
const even = randomImg(32, 20, 11);
const half = Fx.apply('offset', Fx.apply('offset', even, { x: 16, y: 10 }), { x: 16, y: 10 });
check('offset by half the size twice gives the original', same(half, even));
check('offset by a negative amount undoes a positive one', same(Fx.apply('offset', Fx.apply('offset', even, { x: 5, y: -3 }), { x: -5, y: 3 }), even));
check('invert twice is the original', same(Fx.apply('invert', Fx.apply('invert', rnd, {}), {}), rnd));
check('levels 0/1/255 is an identity', same(Fx.apply('levels', rnd, { inLow: 0, inHigh: 255, gamma: 1, outLow: 0, outHigh: 255 }), rnd));
const idCurve = { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
check('curves identity', same(Fx.apply('curves', rnd, { curve: idCurve }), rnd));
const lut = Fx.curveLut([[0, 0], [128, 200], [255, 255]]);
check('curveLut passes through a known point', lut[128] === 200, `got ${lut[128]}`);
check('curveLut through increasing points is monotone', lut.every((v, i) => i === 0 || v >= lut[i - 1]));
const flatEnds = Fx.curveLut([[60, 30], [200, 220]]);
check('curveLut is flat beyond its ends', flatEnds[0] === 30 && flatEnds[59] === 30 && flatEnds[255] === 220);
check('unsharp at amount 0 is identical', same(Fx.apply('unsharp', rnd, { amount: 0, radius: 3 }), rnd));
const auto = Fx.autoLevels(rnd);
check('autoLevels returns levels params', auto.channel === 'rgb' && auto.inLow < auto.inHigh && auto.gamma === 1);
const hist = Fx.histogram(rnd);
check('histogram counts pixels with alpha > 0', hist.l.reduce((s, v) => s + v, 0) === rnd.data.filter((v, i) => i % 4 === 3 && v > 0).length);

// ---- Black and white uses the right weight for each colour ----
const prim = { width: 3, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 0, 255, 0, 255, 255, 255]) };
const bwOut = Fx.apply('bw', prim, {}).data;
check('black and white weighs red 40%, yellow 60%, cyan 60%', bwOut[0] === 102 && bwOut[4] === 153 && bwOut[8] === 153, `${bwOut[0]} ${bwOut[4]} ${bwOut[8]}`);

// ---- Determinism ----
for (const id of ['noise', 'grain', 'glitch', 'clouds']) {
  const p = Fx.defaults(id);
  check(`${id} is deterministic`, same(Fx.apply(id, rnd, p, { seed: 5 }), Fx.apply(id, rnd, p, { seed: 5 })));
}
check('noise depends on the seed', !same(Fx.apply('noise', rnd, {}, { seed: 1 }), Fx.apply('noise', rnd, {}, { seed: 2 })));

// ---- Tilt-shift ----
const big = randomImg(64, 64, 21, true);
const ts = Fx.apply('tiltshift', big, { width: 10, transition: 20, blur: 6, saturation: 0, contrast: 0, angle: 0, centre: { x: 0.5, y: 0.5 } });
let rowSame = true;
for (let x = 0; x < 64; x++) for (let c = 0; c < 4; c++) { const i = (32 * 64 + x) * 4 + c; if (ts.data[i] !== big.data[i]) rowSame = false; }
let edgeDiff = 0;
for (let i = 0; i < 64 * 4; i++) edgeDiff += Math.abs(ts.data[i] - big.data[i]);
check('tiltshift keeps the focus line sharp', rowSame);
check('tiltshift blurs the edges', edgeDiff / 256 > 20, `mean change ${(edgeDiff / 256).toFixed(1)}`);

// ---- Timing ----
const huge = randomImg(2000, 2000, 5, true);
let t0 = Date.now();
Fx.apply('gaussian', huge, { radius: 50 });
const tg = (Date.now() - t0) / 1000;
check('gaussian radius 50 on 2000×2000 is fast', tg < 10, `${tg.toFixed(2)} s (target under ~3 s)`);
t0 = Date.now();
Fx.apply('tiltshift', huge, {});
const tt = (Date.now() - t0) / 1000;
check('tiltshift on 2000×2000 finishes', tt < 20, `${tt.toFixed(2)} s`);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
