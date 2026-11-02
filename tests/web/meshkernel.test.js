// Checks for NoorMesh's geometry kernel (wwwroot/js/meshkernel.js), run in plain Node: node meshkernel.test.js
'use strict';
const K = require('../../src/NoorMD/wwwroot/js/meshkernel.js');

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra !== undefined && !ok ? ' — ' + JSON.stringify(extra) : ''));
  if (!ok) failed++;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- every primitive: valid, closed where it should be, outward, the right shape
{
  const closed = { cube: [K.cube(2), 8, 8], uvsphere: [K.uvSphere(1, 32, 16), 4 / 3 * Math.PI, 0.05], icosphere: [K.icoSphere(1, 3), 4 / 3 * Math.PI, 0.05],
    cylinder: [K.cylinder(1, 2, 32), 2 * Math.PI, 0.03], cone: [K.cone(1, 2, 32), 2 * Math.PI / 3, 0.03], torus: [K.torus(1, 0.25, 48, 12), 2 * Math.PI * Math.PI * 1 * 0.0625, 0.05] };
  for (const [name, [m, vol, tol]] of Object.entries(closed)) {
    const c = K.check(m);
    check(`${name}: no problems`, c.ok, c.problems);
    check(`${name}: closed and manifold`, c.closed && c.nonManifold === 0 && c.flipped === 0, c);
    check(`${name}: Euler characteristic ${name === 'torus' ? 0 : 2}`, c.euler === (name === 'torus' ? 0 : 2), c.euler);
    const v = K.volume(m);
    check(`${name}: faces point outwards and enclose the right volume`, v > 0 && Math.abs(v - vol) / vol <= tol, [v, vol]);
    check(`${name}: every corner has a UV`, m.f.every((f) => f.uv && f.uv.length === f.v.length * 2 && f.uv.every(Number.isFinite)));
  }
  const g = K.grid(2, 4, 3), cg = K.check(g);
  check('grid: valid and open (a border of 14 edges), on the floor facing +Z', cg.ok && cg.open === 14 && g.f.every((f) => K.faceNormal(g, f).n[2] > 0.99) && K.bounds(g).max[2] === 0, cg);
  check('grid: 4 × 3 quads, 20 vertices', g.f.length === 12 && K.vertexCount(g) === 20);
  const p = K.plane(3), bp = K.bounds(p);
  check('plane: one quad, 3 m across on the floor', p.f.length === 1 && near(bp.max[0] - bp.min[0], 3) && near(bp.max[1] - bp.min[1], 3) && near(bp.max[2], 0));
  const cube = K.cube(2);
  check('cube: 6 quads, 8 vertices, 12 triangles', cube.f.length === 6 && K.vertexCount(cube) === 8 && K.check(cube).triangles === 12);
  check('cube: each face points along its axis', cube.f.every((f) => Math.max(...K.faceNormal(cube, f).n.map(Math.abs)) > 0.999));
  check('cylinder: smooth sides, flat caps with sharp rims', K.cylinder(1, 2, 8).f.filter((f) => f.s).length === 8 && Object.keys(K.cylinder(1, 2, 8).e).length === 16);
  for (const [id, prim] of Object.entries(K.PRIMITIVES)) check(`PRIMITIVES.${id} makes a valid mesh from its defaults`, K.check(prim.make(prim.params)).ok);
}

check('Z is up, as in Blender: the sphere\'s poles, the cylinder\'s and the torus\'s axes are on Z', near(K.bounds(K.uvSphere(1, 8, 4)).max[2], 1) && near(K.bounds(K.cylinder(0.5, 4, 8)).max[2], 2) && near(K.bounds(K.torus(1, 0.25)).max[2], 0.25, 1e-3));
check('the cube\'s top face points up (+Z) and its front (−Y) is the middle of the UV cross', (() => { const c = K.cube(2); const top = c.f.find((f) => K.faceNormal(c, f).n[2] > 0.99), front = c.f.find((f) => K.faceNormal(c, f).n[1] < -0.99); return top && front && front.uv[0] === 0.25 && near(front.uv[1], 1 / 3); })());

// ---- triangulation: n-gons, concave faces
{
  // A concave L-shaped hexagon on the XZ plane, facing +Y.
  const L = { v: [0, 0, 0, 0, 0, -2, 1, 0, -2, 1, 0, -1, 2, 0, -1, 2, 0, 0].map(Number), f: [{ v: [0, 5, 4, 3, 2, 1], uv: null, m: 0, s: false }], e: {} };
  const tris = K.triangulateFace(L, L.f[0]);
  const area = tris.reduce((s, t) => {
    const p = t.map((k) => [L.v[L.f[0].v[k] * 3], L.v[L.f[0].v[k] * 3 + 1], L.v[L.f[0].v[k] * 3 + 2]]);
    return s + K.vec.len(K.vec.cross(K.vec.sub(p[1], p[0]), K.vec.sub(p[2], p[0]))) / 2;
  }, 0);
  check('a concave hexagon: 4 triangles covering its area (3 m²)', tris.length === 4 && near(area, 3), [tris.length, area]);
  check('…each turned the face\'s way', tris.every((t) => {
    const p = t.map((k) => [L.v[L.f[0].v[k] * 3], L.v[L.f[0].v[k] * 3 + 1], L.v[L.f[0].v[k] * 3 + 2]]);
    return K.vec.cross(K.vec.sub(p[1], p[0]), K.vec.sub(p[2], p[0]))[1] > 0;
  }));
  check('the L face\'s normal is +Y and its area 3', near(K.faceNormal(L, L.f[0]).n[1], 1) && near(K.faceNormal(L, L.f[0]).area, 3));
  const sphere = K.uvSphere(1, 12, 6);
  check('triangles of a sphere: 2 per quad, 1 per pole triangle', K.triangles(sphere).length === 12 * 2 + 12 * 4 * 2);
}

// ---- drawing buffers
{
  const cube = K.cube(2), b = K.buffers(cube);
  check('cube buffers: 36 corners, flat normals along the axes, UVs carried', b.triangles === 12 && b.positions.length === 108 && Math.abs(b.normals[0]) + Math.abs(b.normals[1]) + Math.abs(b.normals[2]) > 0.999 && b.uvs.some((x) => x > 0));
  check('…12 edges as lines, every triangle knows its face', b.lines.length === 12 * 6 && [...b.faceOfTriangle].every((f) => f >= 0 && f < 6));
  const s = K.buffers(K.uvSphere(1, 16, 8));
  let maxDev = 0;
  for (let i = 0; i < s.positions.length; i += 3) {
    const p = [s.positions[i], s.positions[i + 1], s.positions[i + 2]], n = [s.normals[i], s.normals[i + 1], s.normals[i + 2]];
    maxDev = Math.max(maxDev, 1 - K.vec.dot(K.vec.norm(p), n));
  }
  check('a smooth sphere\'s normals point out from its centre', maxDev < 0.02, maxDev);
  const moved = K.buffers(cube, K.compose([5, 0, 0], [0, 0, 0], [1, 1, 1]));
  check('a matrix moves the drawn mesh', moved.positions[0] > 3);
}

// ---- transforms
{
  const m = K.compose([1, 2, 3], [0, 90, 0], [2, 2, 2]);
  const p = K.transformPoint(m, [1, 0, 0]);
  check('compose: scale 2, turn 90° about Y, then move', near(p[0], 1) && near(p[1], 2) && near(p[2], 1), p);
  const r = K.rotation(90, 0, 0), q = K.transformPoint(r, [0, 1, 0]);
  check('rotation about X turns +Y towards +Z', near(q[2], 1) && near(q[1], 0), q);
  const z = K.transformPoint(K.rotation(0, 0, 90), [1, 0, 0]);
  check('rotation about Z turns +X towards +Y', near(z[1], 1), z);
  const xyz = K.transformPoint(K.rotation(90, 90, 0), [0, 1, 0]);
  check('XYZ order: X first, then Y', near(xyz[0], 1) && near(xyz[1], 0) && near(xyz[2], 0), xyz);
  const sq = K.compose([0, 0, 0], [0, 0, 0], [2, 1, 1]), nm = K.normalMatrix(sq);
  // A plane tilted 45° in XY, stretched along X: its normal tilts towards +Y.
  const n = K.vec.norm([nm[0] * 1 + nm[3] * 1, nm[1] * 1 + nm[4] * 1, 0]);
  check('normal matrix: a stretched surface\'s normal leans the right way', n[1] > n[0], n);
  const flipped = K.applyMatrix(K.cube(2), K.compose([0, 0, 0], [0, 0, 0], [-1, 1, 1]));
  check('applying a mirroring matrix keeps the faces pointing out', K.volume(flipped) > 0 && K.check(flipped).ok);
  const big = K.applyMatrix(K.cube(2), K.compose([0, 1, 0], [0, 0, 0], [2, 2, 2]));
  check('applying a scale and move', near(K.volume(big), 64) && near(K.bounds(big).min[1], -1));
}

// ---- decompose: back to location, rotation, scale
{
  const cases = [[[1, 2, 3], [10, 20, 30], [1, 2, 3]], [[0, 0, 0], [-45, 80, 170], [0.5, 0.5, 0.5]], [[5, -1, 0], [0, 0, 0], [-1, 1, 1]], [[0, 0, 0], [30, 90, 0], [1, 1, 1]]];
  for (const [t, r, sc] of cases) {
    const m = K.compose(t, r, sc), d = K.decompose(m), m2 = K.compose(d.t, d.r, d.s);
    check(`decompose ${JSON.stringify([t, r, sc])} gives the same matrix back`, m.every((x, i) => near(x, m2[i], 1e-6)), [d, m, m2]);
  }
  const d = K.decompose(K.compose([1, 2, 3], [10, 20, 30], [1, 2, 3]));
  check('…and the same numbers when they are unambiguous', d.t.every((x, i) => near(x, [1, 2, 3][i])) && d.r.every((x, i) => near(x, [10, 20, 30][i], 1e-6)) && d.s.every((x, i) => near(x, [1, 2, 3][i])), d);
  const ra = K.rotationAbout([0, 1, 0], 90, [1, 0, 0]), q = K.transformPoint(ra, [2, 0, 0]);
  check('rotation about a vertical axis through (1, 0, 0): (2, 0, 0) goes to (1, 0, −1)', near(q[0], 1) && near(q[2], -1), q);
  const same = K.rotationAbout([0, 1, 0], 90), viaEuler = K.rotation(0, 90, 0);
  check('rotation about an axis agrees with the Euler rotation', same.every((x, i) => near(x, viaEuler[i])));
}

// ---- checks catch broken meshes
{
  const bad = K.cube(2); bad.f[0].v[0] = 99;
  check('check: a face pointing at a missing vertex', !K.check(bad).ok);
  const open = K.cube(2); open.f.pop();
  const co = K.check(open);
  check('check: an open box has a border of 4 edges and is not closed', co.ok && co.open === 4 && !co.closed, co);
  const turned = K.cube(2); K.flipFace(turned.f[0]);
  check('check: a face turned the wrong way', !K.check(turned).ok && K.check(turned).flipped === 4);
  const three = K.cube(2); three.f.push({ v: [4, 5, 6], uv: null, m: 0, s: false });
  check('check: an edge with three faces is non-manifold', K.check(three).nonManifold >= 1);
  const deg = K.cube(2); deg.f.push({ v: [0, 0, 1], uv: null, m: 0, s: false });
  check('check: a degenerate face', K.check(deg).degenerate >= 1);
  check('check: loose vertices are counted, not counted against Euler', (() => { const m = K.cube(2); m.v.push(9, 9, 9); const c = K.check(m); return c.loose === 1 && c.euler === 2; })());
}

// ---- picking
{
  const b = K.buffers(K.cube(2));
  const hit = K.rayHit(b, [0, 0, 5], [0, 0, -1]);
  check('a ray from the front meets the front face 4 m away', hit && near(hit.t, 4) && K.faceNormal(K.cube(2), K.cube(2).f[hit.face]).n[2] > 0.99, hit);
  check('a ray that misses meets nothing', K.rayHit(b, [5, 5, 5], [0, 0, -1]) === null);
}

// ---- clone is deep
{
  const a = K.cube(2), b = K.clone(a);
  b.v[0] = 42; b.f[0].v[0] = 3; b.f[0].uv[0] = 9;
  check('clone copies positions, faces and UVs', a.v[0] !== 42 && a.f[0].v[0] !== 3 && a.f[0].uv[0] !== 9);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
