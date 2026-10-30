// Checks for the NoorInk geometry library (wwwroot/js/inkgeom.js), run in plain Node: node inkgeom.test.js
'use strict';
const G = require('../../src/NoorMD/wwwroot/js/inkgeom.js');

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!ok) failed++;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const boxNear = (b, x, y, w, h, eps = 1e-6) => !!b && near(b.x, x, eps) && near(b.y, y, eps) && near(b.w, w, eps) && near(b.h, h, eps);
const fmtBox = (b) => (b ? `${b.x.toFixed(4)},${b.y.toFixed(4)} ${b.w.toFixed(4)}x${b.h.toFixed(4)}` : 'null');
const ringsArea = (rings) => rings.reduce((s, r) => s + G.area(r), 0);
const pathArea = (p, tol = 0.25) => ringsArea(G.flatten(p, tol));
const anchors = (p) => p.map((s) => s.pts.map((q) => [+q.x.toFixed(6), +q.y.toFixed(6)]));
const sq = (x, y, s) => G.rect(x, y, s, s);

// ---- parse ----
{
  const p = G.parse('M10 20 L30 40 H50 V60 Z');
  check('parse M L H V Z', p.length === 1 && p[0].closed && JSON.stringify(anchors(p)) === '[[[10,20],[30,40],[50,40],[50,60]]]');
  const r = G.parse('m10 20 l20 20 h20 v20 z m5 5 l1 1');
  check('parse relative m l h v z, m after z is relative to the start', r.length === 2 && JSON.stringify(anchors(r)[1]) === '[[15,25],[16,26]]');
  const im = G.parse('M0 0 10 0 10 10');
  check('parse implicit lineto after M', JSON.stringify(anchors(im)) === '[[[0,0],[10,0],[10,10]]]');
  const imr = G.parse('m1 1 2 0 0 2');
  check('parse implicit lineto after m is relative', JSON.stringify(anchors(imr)) === '[[[1,1],[3,1],[3,3]]]');
  const nums = G.parse('M.5.5L-1-2l1e1 1E-1');
  check('parse odd number formats (.5.5, -1-2, 1e1, 1E-1)', JSON.stringify(anchors(nums)) === '[[[0.5,0.5],[-1,-2],[9,-1.9]]]');
  const c = G.parse('M0 0C10 0 20 10 20 20c0 10 -10 20 -20 20');
  const a = c[0].pts;
  check('parse C and relative c', a.length === 3 && a[0].ox === 10 && a[1].ix === 20 && a[1].iy === 10 && a[1].ox === 20 && a[1].oy === 30 && a[2].ix === 10 && a[2].iy === 40 && a[2].x === 0);
  const cc = G.parse('M0 0C1 1 2 2 3 3 4 4 5 5 6 6');
  check('parse implicit repeated C', cc[0].pts.length === 3 && cc[0].pts[2].x === 6);
  const s = G.parse('M0 0C0 10 10 10 10 0S20 -10 20 0s10 10 10 0');
  const sp = s[0].pts;
  check('parse S and s reflect the previous control', sp[1].ox === 10 && sp[1].oy === -10 && sp[2].ox === 20 && sp[2].oy === 10 && sp[3].x === 30);
  const s0 = G.parse('M0 0S10 10 20 0');
  check('parse S without previous curve uses the current point', s0[0].pts[0].ox === 0 && s0[0].pts[0].oy === 0);
  const q = G.parse('M0 0Q10 10 20 0');
  const qp = q[0].pts;
  check('parse Q raised to a cubic', near(qp[0].ox, 20 / 3) && near(qp[0].oy, 20 / 3) && near(qp[1].ix, 40 / 3) && near(qp[1].iy, 20 / 3));
  const t = G.parse('M0 0Q10 10 20 0T40 0t20 0');
  const tp = t[0].pts;
  check('parse T and t reflect the quadratic control', tp.length === 4 && near(tp[1].ox, 20 + 20 / 3) && near(tp[1].oy, -20 / 3) && tp[3].x === 60);
  const qr = G.parse('M10 10q10 10 20 0');
  check('parse relative q', near(qr[0].pts[1].x, 30) && near(qr[0].pts[0].ox, 10 + 20 / 3));
  const arc = G.parse('M0 0A10 10 0 0 1 20 0');
  check('parse A: half circle bounds', boxNear(G.bounds(arc), 0, -10, 20, 10, 1e-9), fmtBox(G.bounds(arc)));
  const arcRel = G.parse('M0 0a10 10 0 0 0 20 0');
  check('parse a (relative, sweep 0) goes the other way', boxNear(G.bounds(arcRel), 0, 0, 20, 10, 1e-9), fmtBox(G.bounds(arcRel)));
  const flags = G.parse('M0 0a1 1 0 01 1 1');
  check('parse arc flags without separators', flags[0].pts.length >= 2 && near(flags[0].pts[flags[0].pts.length - 1].x, 1) && near(flags[0].pts[flags[0].pts.length - 1].y, 1));
  const flags2 = G.parse('M0 0a1 1 0 1110 0');
  check('parse glued arc flags with a large arc', near(flags2[0].pts[flags2[0].pts.length - 1].x, 10), JSON.stringify(anchors(flags2)));
  const small = G.parse('M0 0A1 1 0 0 1 20 0');
  check('parse A with radii too small scales them up', boxNear(G.bounds(small), 0, -10, 20, 10, 1e-9), fmtBox(G.bounds(small)));
  const big = G.parse('M0 0A10 10 0 1 0 0 0.0001');
  check('parse A large arc nearly full circle', G.bounds(big).w > 19.9);
  const zmerge = G.parse('M0 0C10 0 10 10 0 10C-10 10 -10 0 0 0Z');
  check('parse Z merges a repeated start anchor and keeps its handle', zmerge[0].pts.length === 2 && zmerge[0].pts[0].ix === -10 && zmerge[0].pts[0].iy === 0);
  const zl = G.parse('M0 0L10 0L10 10Z L5 5');
  check('parse drawing after Z starts a new subpath at the start', zl.length === 2 && zl[1].pts[0].x === 0 && zl[1].pts[1].x === 5);
  check('parse empty and junk', G.parse('').length === 0 && G.parse('hello').length === 0);
  const bad = G.parse('M0 0L10 0L5');
  check('parse stops at the first error', bad[0].pts.length === 2);
}

// ---- serialize ----
{
  const d = 'M10 10L50 10C60 10 70 20 70 30Q70 50 40 50A20 20 0 0 1 10 30Z M100 100h10v10z';
  const p = G.parse(d), s = G.serialize(p), p2 = G.parse(s);
  check('serialize round trip keeps bounds', boxNear(G.bounds(p), G.bounds(p2).x, G.bounds(p2).y, G.bounds(p2).w, G.bounds(p2).h, 1e-2), s);
  check('serialize round trip keeps anchor counts', p.length === p2.length && p.every((sp, i) => sp.pts.length === p2[i].pts.length));
  check('serialize uses L for straight segments, strips zeros', G.serialize(G.rect(0, 0, 10.5, 20)) === 'M0 0L10.5 0L10.5 20L0 20Z', G.serialize(G.rect(0, 0, 10.5, 20)));
  check('serialize rounds to the precision', G.serialize(G.line(1 / 3, -2 / 3, 1, 2), 2) === 'M0.33-0.67L1 2', G.serialize(G.line(1 / 3, -2 / 3, 1, 2), 2));
  const e = G.ellipse(0, 0, 10, 5), e2 = G.parse(G.serialize(e, 6));
  check('serialize closed curve round trip', e2[0].pts.length === 4 && e2[0].closed && boxNear(G.bounds(e2), -10, -5, 20, 10, 1e-5));
}

// ---- arcs, bounds ----
{
  const r = 50, circle = G.parse(`M${r} 0A${r} ${r} 0 0 1 ${-r} 0A${r} ${r} 0 0 1 ${r} 0Z`);
  const b = G.bounds(circle);
  check('arc circle: bounds within 0.01 of r', boxNear(b, -r, -r, 2 * r, 2 * r, 0.01), fmtBox(b));
  const rot = G.parse('M0 0A50 50 0 0 1 100 0A50 50 0 0 1 0 0Z');
  check('arc circle: every arc piece is at most 90 degrees', rot[0].pts.length === 4, String(rot[0].pts.length));
  const area = pathArea(circle);
  check('arc circle: area close to pi r^2', near(area, Math.PI * r * r, Math.PI * r * r * 0.002), area.toFixed(2));
  const cubic = G.parse('M0 0C0 -100 100 -100 100 0');
  check('bounds of a cubic with an extremum inside (not the handles)', boxNear(G.bounds(cubic), 0, -75, 100, 75, 1e-9), fmtBox(G.bounds(cubic)));
  const s = G.parse('M0 0C100 100 -50 100 50 0');
  const bs = G.bounds(s), fl = G.flatten(s, 0.001)[0];
  const fx0 = Math.min(...fl.map((p) => p[0])), fx1 = Math.max(...fl.map((p) => p[0])), fy1 = Math.max(...fl.map((p) => p[1]));
  check('bounds match a fine flattening for an S curve', near(bs.x, fx0, 0.01) && near(bs.x + bs.w, fx1, 0.01) && near(bs.y + bs.h, fy1, 0.01), fmtBox(bs));
  check('bounds of empty is null', G.bounds([]) === null);
}

// ---- contains, distance, nearest ----
{
  const sqr = sq(0, 0, 100);
  check('contains inside', G.contains(sqr, 50, 50));
  check('contains outside', !G.contains(sqr, 150, 50) && !G.contains(sqr, -1, 50));
  const outer = G.ellipse(0, 0, 100, 100), inner = G.ellipse(0, 0, 50, 50);
  const same = outer.concat(inner), opposite = outer.concat(G.reverse(inner));
  check('donut evenodd: hole is outside', !G.contains(same, 0, 0, 'evenodd') && G.contains(same, 75, 0, 'evenodd'));
  check('donut nonzero, same direction: hole is filled', G.contains(same, 0, 0, 'nonzero'));
  check('donut nonzero, opposite hole: hole is outside', !G.contains(opposite, 0, 0) && G.contains(opposite, 0, 75));
  check('distance to a square outline', near(G.distance(sqr, 50, -10), 10, 1e-9) && near(G.distance(sqr, 50, 40), 40, 1e-9));
  const circ = G.ellipse(0, 0, 50, 50), n = G.nearest(circ, 100, 0.001);
  check('nearest on a curve', n && near(n.x, 50, 0.05) && near(n.dist, 50, 0.05), JSON.stringify(n));
  const n2 = G.nearest(circ, 30, 40);
  check('distance to a circle from inside', near(n2.dist, 0, 0.05) && near(G.distance(circ, 0, 0), 50, 0.05), String(G.distance(circ, 0, 0)));
}

// ---- split, transform, reverse, editing ----
{
  const p = G.parse('M0 0C0 -100 100 -100 100 0C100 50 50 80 0 50Z');
  const b0 = G.bounds(p), s = G.split(p, 0, 0, 0.3), b1 = G.bounds(s);
  check('split inserts one anchor', s[0].pts.length === 4);
  check('split does not change bounds', boxNear(b1, b0.x, b0.y, b0.w, b0.h, 1e-9), fmtBox(b1));
  const s2 = G.split(p, 0, 1, 0.5);
  check('split the closing segment', s2[0].pts.length === 4 && boxNear(G.bounds(s2), b0.x, b0.y, b0.w, b0.h, 1e-9));
  const mid = G.nearest(s, 30, -80);
  check('split point lies on the old curve', G.distance(p, s[0].pts[1].x, s[0].pts[1].y) < 1e-6 && mid.dist >= 0);
  const m = G.multiply([2, 0.5, -0.3, 1.5, 10, -20], [Math.cos(0.7), Math.sin(0.7), -Math.sin(0.7), Math.cos(0.7), 3, 4]);
  const back = G.transform(G.transform(p, m), G.invert(m));
  const maxErr = Math.max(...back[0].pts.map((q, i) => { const o = p[0].pts[i]; return Math.max(...['x', 'y', 'ix', 'iy', 'ox', 'oy'].map((k) => Math.abs(q[k] - o[k]))); }));
  check('transform then inverse returns the original', maxErr < 1e-9, String(maxErr));
  const tr = G.transform(sq(0, 0, 10), [2, 0, 0, 3, 5, 6]);
  check('transform scales and translates', boxNear(G.bounds(tr), 5, 6, 20, 30));
  const ap = G.apply(G.multiply([1, 0, 0, 1, 10, 0], [2, 0, 0, 2, 0, 0]), 1, 1);
  check('multiply applies the right matrix first', ap[0] === 12 && ap[1] === 2);
  const rv = G.reverse(sq(0, 0, 10));
  check('reverse flips the signed area', near(pathArea(rv), -100) && near(pathArea(sq(0, 0, 10)), 100));
  const open = G.parse('M0 0L10 0L20 10');
  const sm = G.smoothCorner(open, 0, 1), h = sm[0].pts[1];
  const cross = (h.x - h.ix) * (h.oy - h.y) - (h.y - h.iy) * (h.ox - h.x);
  check('smoothCorner aligns the handles', near(cross, 0, 1e-9) && h.ix < h.x && h.ox > h.x);
  check('smoothCorner handle length is a third of the neighbour distance', near(Math.hypot(h.x - h.ix, h.y - h.iy), 10 / 3, 1e-9));
  const cz = G.cornerize(sm, 0, 1)[0].pts[1];
  check('cornerize puts the handles on the anchor', cz.ix === cz.x && cz.oy === cz.y);
  check('editing returns new paths', open[0].pts[1].ix === 10);
  check('length of a square and a circle', near(G.length(sq(0, 0, 10)), 40) && near(G.length(G.ellipse(0, 0, 10, 10)), 2 * Math.PI * 10, 0.02), String(G.length(G.ellipse(0, 0, 10, 10))));
}

// ---- shapes ----
{
  check('rect bounds', boxNear(G.bounds(G.rect(1, 2, 30, 40)), 1, 2, 30, 40));
  check('rounded rect bounds', boxNear(G.bounds(G.rect(1, 2, 30, 40, 5)), 1, 2, 30, 40, 1e-9) && G.rect(1, 2, 30, 40, 5)[0].pts.length === 8);
  check('rounded rect with r = half the side has no duplicate anchors', G.rect(0, 0, 20, 40, 100)[0].pts.length === 6);
  check('rounded rect area', near(pathArea(G.rect(0, 0, 100, 100, 10), 0.001), 10000 - (4 - Math.PI) * 100, 0.5), String(pathArea(G.rect(0, 0, 100, 100, 10), 0.001)));
  check('ellipse bounds', boxNear(G.bounds(G.ellipse(10, 20, 30, 15)), -20, 5, 60, 30, 1e-9));
  const pg = G.bounds(G.polygon(0, 0, 100, 100, 6));
  check('hexagon bounds (vertex up)', boxNear(pg, -100 * Math.cos(30 * Math.PI / 180), -100, 200 * Math.cos(30 * Math.PI / 180), 200, 1e-9), fmtBox(pg));
  const tri = G.bounds(G.polygon(0, 0, 10, 10, 4, 45));
  check('square polygon rotated 45 is axis aligned', boxNear(tri, -10 / Math.SQRT2, -10 / Math.SQRT2, 20 / Math.SQRT2, 20 / Math.SQRT2, 1e-9), fmtBox(tri));
  const st = G.star(0, 0, 100, 100, 5, 0.4), sb = G.bounds(st), c18 = Math.cos(18 * Math.PI / 180), s54 = Math.sin(54 * Math.PI / 180);
  check('star bounds', st[0].pts.length === 10 && boxNear(sb, -100 * c18, -100, 200 * c18, 100 + 100 * s54, 1e-9), fmtBox(sb));
  check('shapes are outer rings (positive area)', pathArea(G.star(0, 0, 10, 10, 5)) > 0 && pathArea(G.polygon(0, 0, 10, 10, 5)) > 0 && pathArea(G.ellipse(0, 0, 5, 5)) > 0);
  const ln = G.line(0, 0, 10, 5);
  check('line', !ln[0].closed && boxNear(G.bounds(ln), 0, 0, 10, 5));
  const sp = G.spiral(0, 0, 100, 3), spEnd = sp[0].pts[sp[0].pts.length - 1];
  check('spiral ends on radius r', near(Math.hypot(spEnd.x, spEnd.y), 100, 1e-9) && sp[0].pts[0].x === 0);
  const spb = G.bounds(sp);
  check('spiral stays within r', spb.x >= -100.5 && spb.x + spb.w <= 100.5, fmtBox(spb));
}

// ---- boolean ----
{
  const A = sq(0, 0, 100), B = sq(50, 50, 100);
  const u = G.boolean('union', A, B), i = G.boolean('intersect', A, B), sub = G.boolean('subtract', A, B), x = G.boolean('exclude', A, B);
  check('union of overlapping squares: area', near(pathArea(u), 17500, 1e-6) && u.length === 1, String(pathArea(u)));
  check('union of overlapping squares: 8 vertices', u[0] && u[0].pts.length === 8, u[0] && String(u[0].pts.length));
  check('intersect of overlapping squares', near(pathArea(i), 2500, 1e-6) && i.length === 1);
  check('subtract makes a notch (6 vertices)', near(pathArea(sub), 7500, 1e-6) && sub.length === 1 && sub[0].pts.length === 6);
  check('exclude area = union - intersect', near(pathArea(x), 17500 - 2500, 1e-6), String(pathArea(x)));
  check('boolean results are closed', [u, i, sub, x].every((p) => p.every((s) => s.closed)));
  const far = sq(300, 300, 50);
  check('intersect of disjoint shapes is empty', G.boolean('intersect', A, far).length === 0);
  const ud = G.boolean('union', A, far);
  check('union of disjoint shapes gives 2 rings', ud.length === 2 && near(pathArea(ud), 12500, 1e-6));
  const hole = G.boolean('subtract', A, sq(25, 25, 50)), hr = G.flatten(hole);
  check('subtract inner square leaves a hole', hole.length === 2 && near(ringsArea(hr), 10000 - 2500, 1e-6), String(ringsArea(hr)));
  check('outer ring positive, hole negative', hr.some((r) => G.area(r) > 0) && hr.some((r) => G.area(r) < 0));
  check('the hole is not filled', !G.contains(hole, 50, 50) && G.contains(hole, 10, 10));
  check('b inside a: union is a', near(pathArea(G.boolean('union', A, sq(25, 25, 50))), 10000, 1e-6) && G.boolean('union', A, sq(25, 25, 50)).length === 1);
  check('b inside a: intersect is b', near(pathArea(G.boolean('intersect', A, sq(25, 25, 50))), 2500, 1e-6));
  const su = G.boolean('union', A, sq(0, 0, 100));
  check('identical shapes: union is the shape', su.length === 1 && near(pathArea(su), 10000) && su[0].pts.length === 4);
  check('identical shapes: subtract is empty', G.boolean('subtract', A, sq(0, 0, 100)).length === 0);
  check('identical shapes: intersect is the shape', near(pathArea(G.boolean('intersect', A, sq(0, 0, 100))), 10000));
  const touch = G.boolean('union', A, sq(100, 0, 100));
  check('squares sharing an edge unite into one rectangle', touch.length === 1 && touch[0].pts.length === 4 && near(pathArea(touch), 20000), JSON.stringify(anchors(touch)));
  const partial = G.boolean('union', A, sq(100, 50, 100));
  check('squares sharing part of an edge', partial.length === 1 && near(pathArea(partial), 20000) && partial[0].pts.length === 8, String(partial[0] && partial[0].pts.length));
  const corner = G.boolean('union', A, sq(100, 100, 100));
  check('squares touching at a corner stay two rings', corner.length === 2 && near(pathArea(corner), 20000));
  const cross = G.boolean('union', G.rect(0, 40, 100, 20), G.rect(40, 0, 20, 100));
  check('a plus sign from two bars', cross.length === 1 && cross[0].pts.length === 12 && near(pathArea(cross), 3600));
  // Donut operand: a ring with an oppositely wound hole.
  const donut = G.ellipse(0, 0, 100, 100).concat(G.reverse(G.ellipse(0, 0, 50, 50)));
  const dsq = G.boolean('intersect', donut, G.rect(-10, -200, 20, 400));
  check('intersect a bar with a donut gives two pieces', dsq.length === 2, String(dsq.length));
  const dfill = G.boolean('union', donut, G.ellipse(0, 0, 10, 10));
  check('union with a dot inside the hole keeps the hole', dfill.length === 3 && !G.contains(dfill, 30, 0) && G.contains(dfill, 0, 0) && G.contains(dfill, 75, 0));
  const evenodd = G.boolean('union', G.ellipse(0, 0, 100, 100).concat(G.ellipse(0, 0, 50, 50)), [], 'evenodd');
  check('evenodd input with a same-direction hole', evenodd.length === 2 && !G.contains(evenodd, 0, 0));
  // Bow tie: self-intersecting, resolved by the fill rule.
  const bow = G.boolean('union', G.parse('M0 0L100 100L100 0L0 100Z'), []);
  check('self-intersecting bow tie becomes two triangles', bow.length === 2 && near(pathArea(bow), 5000, 1e-6), String(pathArea(bow)));
  const pent = G.parse('M50 0L79.39 90.45L2.45 34.55L97.55 34.55L20.61 90.45Z');
  const pn = G.boolean('union', pent, []), pe = G.boolean('union', pent, [], 'evenodd');
  check('pentagram: nonzero fills the centre, evenodd does not', pn.length === 1 && pe.length === 5 && G.contains(pn, 50, 50) && !G.contains(pe, 50, 50), `${pn.length} ${pe.length}`);
  // Circles: compare with the analytic lens area.
  const r = 50, dd = 60, c1 = G.ellipse(0, 0, r, r), c2 = G.ellipse(dd, 0, r, r);
  const lens = 2 * r * r * Math.acos(dd / (2 * r)) - (dd / 2) * Math.sqrt(4 * r * r - dd * dd), exact = 2 * Math.PI * r * r - lens;
  const cu = pathArea(G.boolean('union', c1, c2));
  check('union of circles within 0.5% of the analytic area', Math.abs(cu - exact) / exact < 0.005, `${cu.toFixed(1)} vs ${exact.toFixed(1)}`);
  const ci = pathArea(G.boolean('intersect', c1, c2));
  check('intersect of circles within 0.5% of the lens', Math.abs(ci - lens) / lens < 0.005, `${ci.toFixed(1)} vs ${lens.toFixed(1)}`);
  // Coincident vertices and collinear overlaps all over: a grid of squares unioned one by one.
  let grid = [];
  for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < 4; gy++) if ((gx + gy) % 2 === 0) grid = G.boolean('union', grid, sq(gx * 10, gy * 10, 10));
  check('checkerboard union keeps area', near(pathArea(grid), 800, 1e-6), String(pathArea(grid)));
  let full = grid;
  for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < 4; gy++) if ((gx + gy) % 2) full = G.boolean('union', full, sq(gx * 10, gy * 10, 10));
  check('filling the checkerboard gives one square', full.length === 1 && full[0].pts.length === 4 && near(pathArea(full), 1600), String(full.length));
  // Nearly coincident edges (tiny offsets) must not break anything.
  const nearSame = G.boolean('union', A, G.rect(1e-9, -1e-9, 100, 100));
  check('nearly identical squares unite cleanly', nearSame.length === 1 && near(pathArea(nearSame), 10000, 1e-3));
  const rot = G.transform(sq(-50, -50, 100), [Math.cos(0.3), Math.sin(0.3), -Math.sin(0.3), Math.cos(0.3), 0, 0]);
  const rx = G.boolean('exclude', rot, sq(-50, -50, 100));
  check('exclude of a rotated square: area = union - intersect', near(pathArea(rx), pathArea(G.boolean('union', rot, sq(-50, -50, 100))) - pathArea(G.boolean('intersect', rot, sq(-50, -50, 100))), 1e-6));

  // Random polygon soup against brute-force sampling.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let okAll = true, info = '';
  for (let trial = 0; trial < 6 && okAll; trial++) {
    const poly = (n) => [{ closed: true, pts: Array.from({ length: n }, () => ({ x: rnd() * 100, y: rnd() * 100, ix: 0, iy: 0, ox: 0, oy: 0 })).map((p) => ({ ...p, ix: p.x, iy: p.y, ox: p.x, oy: p.y })) }];
    const pa = poly(12), pb = poly(12);
    for (const op of ['union', 'intersect', 'subtract', 'exclude']) {
      for (const rule of ['nonzero', 'evenodd']) {
        const res = G.boolean(op, pa, pb, rule);
        for (let k = 0; k < 300; k++) {
          const px = rnd() * 100, py = rnd() * 100;
          if (G.distance(pa, px, py) < 1e-3 || G.distance(pb, px, py) < 1e-3 || G.distance(res, px, py) < 1e-3) continue;
          const ia = G.contains(pa, px, py, rule), ib = G.contains(pb, px, py, rule);
          const want = op === 'union' ? ia || ib : op === 'intersect' ? ia && ib : op === 'subtract' ? ia && !ib : ia !== ib;
          if (G.contains(res, px, py) !== want) { okAll = false; info = `${op} ${rule} at ${px.toFixed(2)},${py.toFixed(2)}`; break; }
        }
        if (!okAll) break;
      }
      if (!okAll) break;
    }
  }
  check('random self-intersecting polygons match point sampling (all ops, both rules)', okAll, info);

  // Timing: two 1000-vertex wiggly rings with many crossings.
  const wiggle = (cx, ph) => [Array.from({ length: 1000 }, (_, k) => { const t = (k / 1000) * 2 * Math.PI, rr = 100 + 15 * Math.sin(37 * t + ph); return [cx + rr * Math.cos(t), rr * Math.sin(t)]; })];
  const wa = wiggle(0, 0), wb = wiggle(60, 1);
  const t0 = Date.now();
  const wu = G.booleanRings('union', wa, wb);
  const t1 = Date.now();
  const wi = G.booleanRings('intersect', wa, wb);
  const t2 = Date.now();
  check('2000-point boolean: union - intersect area sum is consistent', near(ringsArea(wu) + ringsArea(wi), ringsArea(wa) + ringsArea(wb), 0.05), `union ${t1 - t0} ms, intersect ${t2 - t1} ms`);
}

// ---- rdp, simplify ----
{
  const pts = [[0, 0], [1, 0.1], [2, -0.1], [3, 5], [4, 6], [5, 7], [6, 8.1], [7, 9]];
  check('rdp keeps the ends and the sharp bend', JSON.stringify(G.rdp(pts, 0.5)) === '[[0,0],[2,-0.1],[3,5],[7,9]]', JSON.stringify(G.rdp(pts, 0.5)));
  const ring = G.flatten(G.ellipse(0, 0, 100, 100), 0.01)[0], simp = G.simplifyRings([ring], 1)[0];
  const err = Math.max(...ring.map((p) => G.distance([{ closed: true, pts: simp.map((q) => ({ x: q[0], y: q[1], ix: q[0], iy: q[1], ox: q[0], oy: q[1] })) }], p[0], p[1])));
  check('simplifyRings stays within tolerance with fewer points', simp.length < ring.length && err <= 1 + 1e-9, `${ring.length} -> ${simp.length}, err ${err.toFixed(3)}`);
}

// ---- fit ----
{
  const sine = [];
  for (let k = 0; k <= 200; k++) sine.push([k * 2, 50 * Math.sin((k * 2 * 2 * Math.PI) / 200)]);
  sine.splice(10, 0, sine[10].slice()); // a duplicate to drop
  const f = G.fit(sine, 2), fp = [f];
  const worst = Math.max(...sine.map((p) => G.distance(fp, p[0], p[1])));
  check('fit sine: every sample within the error', worst <= 2, `max ${worst.toFixed(3)}, ${f.pts.length} anchors`);
  check('fit sine: few anchors, open', !f.closed && f.pts.length < 20 && f.pts.length >= 3, String(f.pts.length));
  const smooth = f.pts.slice(1, -1).every((p) => {
    const ax = p.x - p.ix, ay = p.y - p.iy, bx = p.ox - p.x, by = p.oy - p.y;
    return Math.abs(ax * by - ay * bx) <= 1e-6 * Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-9 && ax * bx + ay * by > 0;
  });
  check('fit sine: inner anchors are smooth', smooth);
  const square = [];
  const side = (x0, y0, x1, y1) => { for (let k = 0; k < 20; k++) square.push([x0 + ((x1 - x0) * k) / 20, y0 + ((y1 - y0) * k) / 20]); };
  side(50, 0, 100, 0); side(100, 0, 100, 100); side(100, 100, 0, 100); side(0, 100, 0, 0); side(0, 0, 50, 0);
  square.push([50, 0]);
  const fs = G.fit(square, 2);
  const turnAt = (p, q) => {
    const a = Math.atan2(p.y - p.iy, p.x - p.ix), b = Math.atan2(p.oy - p.y, p.ox - p.x);
    let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
    return d;
  };
  const corners = fs.pts.slice(1, -1).filter((p) => turnAt(p) > Math.PI / 4);
  check('fit square keeps 4 corners', corners.length === 4 && corners.every((c) => [0, 100].includes(Math.round(c.x)) && [0, 100].includes(Math.round(c.y))), `${corners.length} corners of ${fs.pts.length} anchors`);
  const sqWorst = Math.max(...square.map((p) => G.distance([fs], p[0], p[1])));
  check('fit square stays within the error', sqWorst <= 2, sqWorst.toFixed(3));
  check('fit with one point', G.fit([[1, 1], [1, 1]]).pts.length === 1);
}

// ---- strokeToPath ----
{
  const fine = { tolerance: 0.001 };
  const ln = G.line(0, 0, 100, 0);
  const butt = G.strokeToPath(ln, 10);
  check('stroke a line, butt caps: the 100x10 rectangle', butt.length === 1 && butt[0].closed && butt[0].pts.length === 4 && near(pathArea(butt), 1000, 1e-9) && boxNear(G.bounds(butt), 0, -5, 100, 10, 1e-9), JSON.stringify(anchors(butt)));
  const round = pathArea(G.strokeToPath(ln, 10, { cap: 'round', ...fine }), 0.001);
  check('round caps add pi 25', near(round, 1000 + Math.PI * 25, 0.05), round.toFixed(3));
  const roundDefault = pathArea(G.strokeToPath(ln, 10, { cap: 'round' }), 0.001);
  check('round caps at the default tolerance are within 0.5%', Math.abs(roundDefault - 1000 - Math.PI * 25) < 0.005 * (1000 + Math.PI * 25), roundDefault.toFixed(3));
  check('square caps add half the width at each end', near(pathArea(G.strokeToPath(ln, 10, { cap: 'square' })), 1100, 1e-9));
  check('the result is positive (outer ring area > 0)', G.area(G.flatten(butt)[0]) > 0);
  const ring = G.strokeToPath(sq(0, 0, 100), 10), rr = G.flatten(ring).map((r) => G.area(r));
  check('closed square: a ring, area outer minus inner', ring.length === 2 && near(pathArea(ring), 110 * 110 - 90 * 90, 1e-6) && rr.some((a) => a > 0) && rr.some((a) => a < 0), rr.join(' '));
  check('closed square: no caps, miter corners reach the outer square', boxNear(G.bounds(ring), -5, -5, 110, 110, 1e-6));
  const bevelSq = pathArea(G.strokeToPath(sq(0, 0, 100), 10, { join: 'bevel' }));
  check('closed square, bevel joins cut 4 corner triangles', near(bevelSq, 4000 - 4 * 12.5, 1e-6), String(bevelSq));
  const zig = G.parse('M0 0L20 40L40 0L60 40L80 0');
  const zm = pathArea(G.strokeToPath(zig, 10, { join: 'miter' })), zr = pathArea(G.strokeToPath(zig, 10, { join: 'round' })), zb = pathArea(G.strokeToPath(zig, 10, { join: 'bevel' }));
  check('zig-zag: miter > round > bevel', zm > zr && zr > zb && zb > 0, `${zm.toFixed(1)} ${zr.toFixed(1)} ${zb.toFixed(1)}`);
  const zl = pathArea(G.strokeToPath(zig, 10, { join: 'miter', miterLimit: 1.5 }));
  check('miter past the limit falls back to bevel', near(zl, zb, 1e-6), `${zl.toFixed(3)} vs ${zb.toFixed(3)}`);
  const turn = pathArea(G.strokeToPath(G.parse('M0 0L100 0L50 0'), 10));
  check('a 180 degree turn with miter join adds nothing past the turn', near(turn, 1000, 1e-6), String(turn));
  const turnR = pathArea(G.strokeToPath(G.parse('M0 0L100 0L50 0'), 10, { join: 'round', ...fine }), 0.001);
  check('a 180 degree turn with round join adds a half disc', near(turnR, 1000 + Math.PI * 12.5, 0.05), turnR.toFixed(3));
  const dot = G.strokeToPath(G.parse('M5 5L5 5'), 10, { cap: 'round', ...fine });
  check('a zero-length subpath with round caps is a dot', dot.length === 1 && near(pathArea(dot, 0.001), Math.PI * 25, 0.05));
  check('a zero-length subpath with butt caps is nothing', G.strokeToPath(G.parse('M5 5L5 5'), 10).length === 0);
  check('square cap dot is an axis-aligned square', near(pathArea(G.strokeToPath(G.parse('M5 5L5 5'), 10, { cap: 'square' })), 100, 1e-9));
  check('zero width gives nothing', G.strokeToPath(ln, 0).length === 0 && G.strokeToPath([], 5).length === 0);
  const rep = G.strokeToPath(G.parse('M0 0L50 0L50 0L50 0L100 0'), 10);
  check('repeated points do not add anything', rep.length === 1 && rep[0].pts.length === 4 && near(pathArea(rep), 1000, 1e-6), JSON.stringify(anchors(rep)));
  const shortSeg = G.strokeToPath(G.parse('M0 0L50 0L50.001 0.001L100 0'), 10);
  check('a very short segment in a straight line leaves it nearly a rectangle', shortSeg.length === 1 && Math.abs(pathArea(shortSeg) - 1000) < 0.1, String(pathArea(shortSeg)));

  // Point sampling against an independent distance-to-polyline test: with round joins and round caps the stroke is
  // exactly the set of points within width / 2 of the (flattened) path.
  const flatDist = (path, x, y) => {
    let best = Infinity;
    for (const [i, r] of G.flatten(path, 0.001).entries()) {
      const n = r.length, segs = path[i].closed ? n : n - 1;
      if (n === 1) best = Math.min(best, Math.hypot(x - r[0][0], y - r[0][1]));
      for (let k = 0; k < segs; k++) {
        const a = r[k], b = r[(k + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
      }
    }
    return best;
  };
  const windingOf = (rings, x, y) => {
    let w = 0;
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length], s = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
        if (a[1] <= y) { if (b[1] > y && s > 0) w++; } else if (b[1] <= y && s < 0) w--;
      }
    }
    return w;
  };
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const shapes = [
    ['zig-zag', zig, 10],
    ['cubic loop', G.parse('M0 0C100 100 0 100 100 0'), 30],
    ['cusp-like cubic', G.parse('M0 0C100 0 0 0 100 100'), 20],
    ['tight sine', G.parse('M0 100' + Array.from({ length: 30 }, (_, i) => ` S${i * 8 + 4} ${i % 2 ? 160 : 40} ${i * 8 + 8} 100`).join('')), 14],
    ['hairpin with repeated points', G.parse('M0 0L60 0L60 0L60 0.5L0 1L30 30L30 30'), 8],
    ['closed curve thicker than its size', G.ellipse(0, 0, 10, 6), 30],
    ['closed self-crossing star', G.star(0, 0, 50, 50, 5, 0.3), 6],
    ['random polyline', [{ closed: false, pts: Array.from({ length: 15 }, () => { const x = rnd() * 100, y = rnd() * 100; return { x, y, ix: x, iy: y, ox: x, oy: y }; }) }], 9],
  ];
  for (const [name, path, w] of shapes) {
    const out = G.strokeToPath(path, w, { join: 'round', cap: 'round', tolerance: 0.005 }), rings = G.flatten(out), b = G.bounds(out);
    let bad = 0, tested = 0, maxW = 0, info = '';
    for (let k = 0; k < 1500; k++) {
      const x = b.x - 2 + rnd() * (b.w + 4), y = b.y - 2 + rnd() * (b.h + 4), d = flatDist(path, x, y);
      if (Math.abs(d - w / 2) < 0.03) continue;
      tested++;
      const wn = windingOf(rings, x, y);
      maxW = Math.max(maxW, Math.abs(wn));
      if ((wn !== 0) !== d < w / 2) { bad++; if (!info) info = `${x.toFixed(2)},${y.toFixed(2)} d=${d.toFixed(3)}`; }
    }
    check(`stroke matches distance sampling: ${name}`, bad === 0 && tested > 1000, `${bad}/${tested} wrong ${info}`);
    check(`stroke has no self-overlap (winding 0 or 1): ${name}`, maxW <= 1, String(maxW));
  }
  // Miter joins: everything within w/2 is inside, nothing beyond w/2 * miterLimit is.
  {
    const path = G.parse('M0 0L40 60L45 0L90 50L95 45L140 60'), w = 10, out = G.flatten(G.strokeToPath(path, w, { join: 'miter', miterLimit: 4, cap: 'round' })), b = G.bounds(G.strokeToPath(path, w));
    let bad = 0;
    for (let k = 0; k < 2000; k++) {
      const x = b.x - 5 + rnd() * (b.w + 10), y = b.y - 5 + rnd() * (b.h + 10), d = flatDist(path, x, y), wn = windingOf(out, x, y);
      if ((d < w / 2 - 0.01 && wn !== 1) || (d > w * 2 + 0.01 && wn !== 0)) bad++;
    }
    check('miter stroke: covers the round stroke and stays within the miter limit', bad === 0, String(bad));
  }

  // Timing: a 200-anchor smooth wandering path.
  const walkPts = [];
  let wx = 0, wy = 0, wa = 0;
  for (let k = 0; k < 200; k++) { wa += (rnd() - 0.5) * 1.6; wx += 25 * Math.cos(wa); wy += 25 * Math.sin(wa); walkPts.push(wx, wy); }
  let walk = [{ closed: false, pts: Array.from({ length: 200 }, (_, k) => ({ x: walkPts[2 * k], y: walkPts[2 * k + 1], ix: walkPts[2 * k], iy: walkPts[2 * k + 1], ox: walkPts[2 * k], oy: walkPts[2 * k + 1] })) }];
  for (let k = 0; k < 200; k++) walk = G.smoothCorner(walk, 0, k);
  G.strokeToPath(walk, 8, { join: 'round', cap: 'round' }); // warm up
  const times = [];
  for (const [w, join] of [[2, 'miter'], [8, 'round'], [20, 'bevel'], [40, 'miter']]) {
    const t0 = Date.now(), out = G.strokeToPath(walk, w, { join, cap: 'round' });
    times.push(`w${w} ${join} ${Date.now() - t0} ms (${out.reduce((s, sub) => s + sub.pts.length, 0)} pts)`);
  }
  const worst = Math.max(...times.map((t) => +t.split(' ')[2]));
  check('200-anchor curvy path strokes quickly (target 150 ms)', worst < 400, times.join(', '));
}

// ---- offset ----
{
  const s = 100, A = sq(0, 0, s);
  const grow = pathArea(G.offset(A, 5, 'round', { tolerance: 0.001 }), 0.001);
  check('offset +5 round: (s+10)^2 - (4 - pi) 25', near(grow, (s + 10) ** 2 - (4 - Math.PI) * 25, 0.1), grow.toFixed(3));
  check('offset +5 round at the default tolerance within 0.05%', Math.abs(pathArea(G.offset(A, 5)) - ((s + 10) ** 2 - (4 - Math.PI) * 25)) < 6);
  check('offset +5 miter: (s+10)^2', near(pathArea(G.offset(A, 5, 'miter')), (s + 10) ** 2, 1e-6));
  check('offset +5 bevel cuts the corners', near(pathArea(G.offset(A, 5, 'bevel')), (s + 10) ** 2 - 4 * 12.5, 1e-6));
  const shrink = G.offset(A, -5);
  check('offset -5: (s-10)^2, one positive ring', shrink.length === 1 && near(pathArea(shrink), (s - 10) ** 2, 1e-6) && boxNear(G.bounds(shrink), 5, 5, 90, 90, 1e-6));
  check('offset shrinking past nothing is empty', G.offset(A, -50.5).length === 0 && G.offset(A, -80).length === 0);
  const revd = G.offset(G.reverse(A), 5, 'miter');
  check('offset ignores the input winding direction', near(pathArea(revd), (s + 10) ** 2, 1e-6));
  const donut = G.ellipse(0, 0, 50, 50).concat(G.reverse(G.ellipse(0, 0, 20, 20)));
  const dg = G.flatten(G.offset(donut, 5)).map((r) => G.area(r));
  const want = Math.PI * (55 * 55 - 15 * 15);
  check('offset a donut: the hole shrinks while the outside grows', dg.length === 2 && Math.abs(dg[0] + dg[1] - want) / want < 0.005, `${(dg[0] + dg[1]).toFixed(0)} vs ${want.toFixed(0)}`);
  const dn = G.offset(donut, -16);
  check('shrink a donut until its wall is gone', dn.length === 0, String(dn.length));
  const open = G.offset(G.parse('M0 0L100 0L100 100L0 100'), 5, 'miter');
  check('offset treats an open subpath as closed', near(pathArea(open), 110 * 110, 1e-6));
  const circ = pathArea(G.offset(G.ellipse(0, 0, 40, 40), 10, 'round', { tolerance: 0.001 }), 0.001);
  check('offset a circle: a circle 10 larger', Math.abs(circ - Math.PI * 2500) / (Math.PI * 2500) < 0.001, circ.toFixed(1));
  check('offset by 0 normalises the fill', near(pathArea(G.offset(G.reverse(A), 0)), s * s, 1e-6));
}

// ---- roundCorners ----
{
  const rc = G.roundCorners(sq(0, 0, 100), 10);
  check('roundCorners on a square: 8 anchors, the rounded-rect area', rc[0].pts.length === 8 && near(pathArea(rc, 0.001), 10000 - (4 - Math.PI) * 100, 0.2), String(pathArea(rc, 0.001)));
  const big = G.roundCorners(sq(0, 0, 100), 500);
  check('roundCorners with a huge radius makes a circle-like shape (4 anchors)', big[0].pts.length === 4 && near(pathArea(big, 0.001), Math.PI * 2500, 10), String(pathArea(big, 0.001)));
  const openL = G.roundCorners(G.parse('M0 0L50 0L50 50'), 10);
  check('roundCorners keeps open ends and rounds the inner corner', openL[0].pts.length === 4 && openL[0].pts[0].x === 0 && openL[0].pts[3].y === 50);
  const curvy = G.roundCorners(G.ellipse(0, 0, 10, 10), 5);
  check('roundCorners leaves curves alone', JSON.stringify(curvy) === JSON.stringify(G.ellipse(0, 0, 10, 10)));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
