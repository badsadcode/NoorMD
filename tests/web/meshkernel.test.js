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

// ================================================================ Edit Mode operations
const ok = (m) => K.check(m);
const topFace = (m) => m.f.findIndex((f) => K.faceNormal(m, f).n[2] > 0.99);
{
  // Selection modes and flushing.
  const c = K.cube(2), top = topFace(c);
  const sv = K.selectionFromFaces(c, [top], 'vert');
  check('a face selected is its 4 vertices in vertex mode', sv.verts.size === 4);
  const fl = K.flush(c, sv);
  check('…and 4 edges and that face, flushed', fl.edges.size === 4 && fl.faces.size === 1 && fl.faces.has(top));
  const two = K.selectionFromFaces(c, [top, c.f.findIndex((f) => K.faceNormal(c, f).n[2] < -0.99)], 'face');
  check('two opposite faces in face mode stay two faces (not all six)', K.flush(c, two).faces.size === 2 && K.flush(c, two).verts.size === 8);
  check('…turned into vertex mode they are all 8 vertices (and so every face)', K.flush(c, K.convertSelection(c, two, 'vert')).faces.size === 6);
  const e = K.convertSelection(c, sv, 'edge');
  check('vertex → edge mode: the 4 edges', e.mode === 'edge' && e.edges.size === 4);
}
{
  // Extrude a face of a cube: still closed, 4 more faces, the region on top of new vertices.
  const c = K.cube(2), top = topFace(c);
  const r = K.extrudeFaces(c, new Set([top]));
  check('extrude the top face: closed, 10 faces, 12 vertices (its 4 walls flat until it is moved, as in Blender)', ok(r.mesh).closed && ok(r.mesh).flipped === 0 && ok(r.mesh).degenerate === 4 && r.mesh.f.length === 10 && K.vertexCount(r.mesh) === 12, ok(r.mesh));
  check('…the region keeps its index, its normal is up, its 4 new vertices returned', r.faces[0] === top && r.normal[2] > 0.99 && r.verts.length === 4);
  const moved = K.transformVerts(r.mesh, r.verts, K.compose([0, 0, 1], [0, 0, 0], [1, 1, 1]));
  check('…moved up 1 m: a box 3 m tall, still pointing out', Math.abs(K.bounds(moved).max[2] - 2) < 1e-9 && Math.abs(K.volume(moved) - 12) < 1e-6 && ok(moved).ok);
  // Two adjacent faces extruded as one region: no wall between them.
  const c2 = K.cube(2), side = c2.f.findIndex((f) => K.faceNormal(c2, f).n[0] > 0.99);
  const r2 = K.extrudeFaces(c2, new Set([topFace(c2), side]));
  const r2up = K.transformVerts(r2.mesh, r2.verts, K.compose([0.3, 0, 0.3], [0, 0, 0], [1, 1, 1]));
  check('extrude two neighbouring faces as one region: 6 walls (none between them), closed and valid once moved', r2.mesh.f.length === 12 && ok(r2up).closed && ok(r2up).ok, ok(r2up));
  // A plane extruded: a box open at the bottom.
  const pl = K.plane(2), rp = K.extrudeFaces(pl, new Set([0]));
  const up = K.transformVerts(rp.mesh, rp.verts, K.compose([0, 0, 1], [0, 0, 0], [1, 1, 1]));
  check('extrude a plane up: 5 faces, open at the bottom (4 border edges), all valid', up.f.length === 5 && ok(up).open === 4 && ok(up).ok, ok(up));
}
{
  // Extrude border edges of a plane: a new face beside each, turned to match.
  const pl = K.plane(2), keys = K.faceEdgeKeys(pl.f[0]);
  const r = K.extrudeEdges(pl, [keys[0]]);
  const rOut = K.transformVerts(r.mesh, r.verts, K.compose([0, -1, 0], [0, 0, 0], [1, 1, 1]));
  check('extrude one border edge of a plane: a second face, valid once moved (no flipped edge)', r.mesh.f.length === 2 && ok(rOut).ok && ok(rOut).flipped === 0 && r.verts.length === 2 && r.edges.length === 1, ok(rOut));
  const inner = K.extrudeEdges(K.cube(2), [K.faceEdgeKeys(K.cube(2).f[0])[0]]);
  check('…an edge between two faces is not extruded (no fins)', inner.mesh.f.length === 6);
}
{
  // Inset the top face of a cube by 0.25: 5 faces in its place, still closed, the inner face 1.5 m across.
  const c = K.cube(2), top = topFace(c);
  const r = K.insetFaces(c, new Set([top]), 0.25);
  const f = r.mesh.f[r.faces[0]], b = K.bounds({ v: f.v.flatMap((v) => [r.mesh.v[v * 3], r.mesh.v[v * 3 + 1], r.mesh.v[v * 3 + 2]]), f: [] });
  check('inset the top by 0.25 m: 10 faces, closed, valid', r.mesh.f.length === 10 && ok(r.mesh).closed && ok(r.mesh).ok, ok(r.mesh));
  check('…the inner face is 1.5 m across, on top, facing up', near(b.max[0] - b.min[0], 1.5) && near(b.max[2], 1) && K.faceNormal(r.mesh, f).n[2] > 0.99);
  const d = K.insetFaces(c, new Set([top]), 0.25, 0.5);
  check('…with depth 0.5 the inner face rises', near(Math.max(...d.mesh.f[d.faces[0]].v.map((v) => d.mesh.v[v * 3 + 2])), 1.5) && ok(d.mesh).ok);
}
{
  const c = K.cube(2), top = topFace(c);
  const fv = K.selectionFromFaces(c, [top], 'vert');
  check('delete vertices of the top face: only the bottom face is left (4 vertices)', (() => { const m = K.deleteElements(c, fv, 'verts'); return m.f.length === 1 && K.vertexCount(m) === 4 && ok(m).ok; })());
  check('delete the top face: an open box (5 faces, 8 vertices)', (() => { const m = K.deleteElements(c, K.selectionFromFaces(c, [top], 'face'), 'faces'); return m.f.length === 5 && K.vertexCount(m) === 8 && ok(m).open === 4; })());
  const e = K.convertSelection(c, K.selectionFromFaces(c, [top], 'face'), 'edge');
  e.edges = new Set([[...e.edges][0]]);
  check('delete one edge: the two faces on it go', K.deleteElements(c, e, 'edges').f.length === 4);
  check('delete only faces: the vertices stay', (() => { const m = K.deleteElements(c, K.selectionFromFaces(c, [top], 'face'), 'only-faces'); return m.f.length === 5 && K.vertexCount(m) === 8; })());
}
{
  // Dissolve: two quads of a grid into one face; an edge between them; a vertex in the middle of 4 quads.
  const g = K.grid(2, 2, 2); // 4 quads, 9 vertices
  const fsel = K.selectionFromFaces(g, [0, 1], 'face');
  const d = K.dissolve(g, fsel);
  check('dissolve two neighbouring faces: one face for both (3 faces left), its middle vertex gone from it', d.f.length === 3 && ok(d).ok, d.f.map((f) => f.v.length));
  const mid = 4; // the grid's centre vertex
  const dv = K.dissolve(g, { mode: 'vert', verts: new Set([mid]), edges: new Set(), faces: new Set() });
  check('dissolve the centre vertex of a 2×2 grid: one face, 8 corners, the vertex gone', dv.f.length === 1 && dv.f[0].v.length === 8 && K.vertexCount(dv) === 8 && ok(dv).ok, dv.f.map((f) => f.v.length));
  const k = K.edgeKey(1, 4);
  const de = K.dissolve(g, { mode: 'edge', verts: new Set(), edges: new Set([k]), faces: new Set() });
  check('dissolve the edge between two quads: 3 faces, the joined one a 5-gon (the border vertex taken out, the centre kept: it joins 3 edges, as in Blender)', de.f.length === 3 && ok(de).ok && de.f.some((f) => f.v.length === 5 && near(K.faceNormal(de, f).area, 2)), de.f.map((f) => f.v.length));
  const c = K.cube(2);
  const dc = K.dissolve(c, K.selectionFromFaces(c, c.f.map((_, i) => i), 'face'));
  check('dissolving every face of a cube does nothing (their border is not one loop)', dc.f.length === 6 && ok(dc).ok);
}
{
  // Merge at the centre: the top face's vertices to one point: a pyramid.
  const c = K.cube(2), top = topFace(c), verts = new Set(c.f[top].v);
  const r = K.mergeVerts(c, verts, [0, 0, 1]);
  check('merge the top 4 vertices at their centre: a pyramid (5 vertices, 5 faces, closed)', K.vertexCount(r.mesh) === 5 && r.mesh.f.length === 5 && ok(r.mesh).closed && ok(r.mesh).ok, ok(r.mesh));
  // Merge by distance: two cubes' touching… a grid duplicated on itself.
  const g = K.grid(2, 2, 2), n = K.vertexCount(g), doubled = { v: [...g.v, ...g.v], f: [...g.f, ...g.f.map((f) => ({ ...f, v: f.v.map((v) => v + n) }))], e: {} };
  const md = K.mergeByDistance(doubled, 0.001);
  check('merge by distance: a grid lying on its own copy welds back to 9 vertices', K.vertexCount(md.mesh) === 9 && md.removed === 9);
}
{
  // Make face: fill the hole of an open box.
  const c = K.cube(2), top = topFace(c), loop = c.f[top].v.slice();
  const open = K.deleteElements(c, K.selectionFromFaces(c, [top], 'face'), 'only-faces');
  const r = K.makeFace(open, loop.slice().reverse());
  check('F on the 4 vertices round a hole fills it, turned to match (closed again, pointing out)', r.face >= 0 && ok(r.mesh).closed && ok(r.mesh).ok && K.volume(r.mesh) > 0, ok(r.mesh));
  check('F with 2 vertices makes nothing', K.makeFace(c, [0, 1]).face === -1);
}
{
  const c = K.cube(2), top = topFace(c);
  const flipped = K.flipFaces(c, new Set([top]));
  check('flip one face: the mesh reports it turned the wrong way', ok(flipped).flipped === 4);
  const fixed = K.recalcOutside(flipped);
  check('recalculate outside: consistent and pointing out again', ok(fixed).ok && K.volume(fixed) > 0);
  const inside = K.flipFaces(c, new Set(c.f.map((_, i) => i)));
  check('…even when every face points in', K.volume(K.recalcOutside(inside)) > 0);
  const sm = K.setSmooth(c, new Set([top]), true);
  check('shade smooth one face', sm.f[top].s && !sm.f[(top + 1) % 6].s);
}
{
  // Loops on a UV sphere (quads round the middle) and a grid's border.
  const s = K.uvSphere(1, 12, 6), mid = 1 + 2 * 12; // a vertex on the ring between rows 2 and 3
  const loop = K.edgeLoop(s, mid, mid + 1);
  check('edge loop round a sphere\'s ring: 12 edges', loop.size === 12, loop.size);
  const g = K.grid(2, 3, 3);
  check('edge loop along a grid\'s border: the whole border (12 edges)', K.edgeLoop(g, 0, 1).size === 12, K.edgeLoop(g, 0, 1).size);
  const fl = K.faceLoop(s, mid, mid + 12);
  check('face loop across a sphere\'s vertical edge: the 12 quads round its band', fl.size === 12, fl.size);
  const lv = K.linkedVerts(K.cube(2), [0]);
  check('linked: every vertex of a cube from one', lv.size === 8);
  const gg = K.grid(2, 4, 4), centre = 12;
  check('shrink a whole 4×4 grid: its border goes (9 inner vertices left)', K.shrinkVerts(gg, new Set([...Array(25).keys()])).size === 9);
  check('grow from the centre of a grid: 9; shrink back: 1', K.growVerts(gg, new Set([centre])).size === 9 && K.shrinkVerts(gg, K.growVerts(gg, new Set([centre]))).size === 1);
}

{
  const c = K.cube(2), top = topFace(c), d = K.duplicateFaces(c, new Set([top]));
  check('duplicate a face: a copy with 4 vertices of its own (the cube untouched)', d.mesh.f.length === 7 && K.vertexCount(d.mesh) === 12 && d.faces.length === 1 && d.verts.length === 4);
}


{
  // Region inset (as Blender's I): two neighbouring faces of a cube's top inset together — one ring, the edge between them kept.
  const g = K.grid(2, 2, 1), all = new Set([0, 1]);
  const r = K.insetRegion(g, all, 0.1);
  check('region inset of two neighbouring faces: one ring of 6 quads (not 8), 2+6 faces', r.mesh.f.length === 8, r.mesh.f.length);
  check('…6 new vertices round the border, the region still 2 faces', K.vertexCount(r.mesh) === 12 && r.faces.length === 2, K.vertexCount(r.mesh));
  check('…no problems', K.check(r.mesh).ok, K.check(r.mesh).problems);
  const c = K.cube(2), top = topFace(c);
  const sides = new Set(c.f.map((f, i) => i).filter((i) => i !== top && Math.abs(K.faceNormal(c, c.f[i]).n[2]) < 0.5));
  const band = K.insetRegion(c, sides, 0.2);
  check('region inset of a cube\'s four sides: two rings (top and bottom), closed and consistent', band.mesh.f.length === 6 + 8 && K.check(band.mesh).closed && K.check(band.mesh).flipped === 0, [band.mesh.f.length, K.check(band.mesh)]);
  const lifted = K.insetRegion(c, new Set([top]), 0.2, 0.5);
  check('…with depth: the region lifted along its normal (the top at z 1.5)', lifted.verts.every((v) => Math.abs(lifted.mesh.v[v * 3 + 2] - 1.5) < 1e-9), lifted.verts.map((v) => lifted.mesh.v[v * 3 + 2]));
  const whole = K.insetRegion(c, new Set(c.f.map((_, i) => i)), 0.2);
  check('…a whole closed mesh has no border: unchanged', whole.mesh.f.length === 6);
}
{
  // Loop cut (Ctrl+R): round a cube, across a cylinder's sides, at a grid's open ends.
  const c = K.cube(2), top = topFace(c), [a, b] = [c.f[top].v[0], c.f[top].v[1]];
  const ring = K.loopRing(c, a, b);
  check('loop ring from a cube\'s top edge: 4 faces, 4 edges', ring.faces.size === 4 && ring.ring.size === 4, [ring.faces.size, ring.ring.size]);
  const cut = K.loopCut(c, a, b);
  check('loop cut round a cube: 10 faces, 12 vertices, a loop of 4 new edges', cut.mesh.f.length === 10 && K.vertexCount(cut.mesh) === 12 && cut.edges.length === 4, [cut.mesh.f.length, K.vertexCount(cut.mesh), cut.edges.length]);
  check('…closed and consistent (no problems)', K.check(cut.mesh).ok && K.check(cut.mesh).closed && K.check(cut.mesh).flipped === 0, K.check(cut.mesh));
  check('…the same volume', Math.abs(K.volume(cut.mesh) - 8) < 1e-9, K.volume(cut.mesh));
  const three = K.loopCut(c, a, b, 3);
  check('three cuts: 12 new vertices, 3 loops (12 edges), 6 + 4·3 faces', K.vertexCount(three.mesh) === 20 && three.edges.length === 12 && three.mesh.f.length === 18 && K.check(three.mesh).ok);
  const slid = K.loopCut(c, a, b, 1, 0.9), pa = K.vec.sub([c.v[a * 3], c.v[a * 3 + 1], c.v[a * 3 + 2]], [0, 0, 0]);
  const nv = slid.verts.find((v) => true), pn = [slid.mesh.v[nv * 3], slid.mesh.v[nv * 3 + 1], slid.mesh.v[nv * 3 + 2]];
  const pb = [c.v[b * 3], c.v[b * 3 + 1], c.v[b * 3 + 2]];
  check('slid to 0.9: the first new vertex 90% of the way from a to b', K.vec.len(K.vec.sub(pn, K.vec.add(pa, K.vec.scale(K.vec.sub(pb, pa), 0.9)))) < 1e-6, pn);
  const cy = K.cylinder(1, 2, 8), side = cy.f.findIndex((f) => f.v.length === 4);
  const sv = cy.f[side].v;
  // The side quad's vertical edge: the one whose ends differ in Z.
  let ve = null; for (let k = 0; k < 4; k++) { const x = sv[k], y = sv[(k + 1) % 4]; if (Math.abs(cy.v[x * 3 + 2] - cy.v[y * 3 + 2]) > 1) ve = [x, y]; }
  const cc = K.loopCut(cy, ve[0], ve[1]);
  check('loop cut round a cylinder: the 8 sides split, the 8-sided caps untouched, still closed', cc.mesh.f.length === cy.f.length + 8 && cc.edges.length === 8 && K.check(cc.mesh).closed && K.check(cc.mesh).ok, [cc.mesh.f.length, K.check(cc.mesh)]);
  const cy2 = K.loopCut(cy, sv[0], sv[1].valueOf ? sv[1] : sv[1]);
  void cy2;
  const g = K.grid(2, 3, 1);
  const ge = K.loopCut(g, 0, 4);
  check('a grid strip cut along: 3 quads into 6, open at both ends (4 new vertices)', ge.mesh.f.length === 6 && ge.verts.length === 4 && K.check(ge.mesh).ok, [ge.mesh.f.length, ge.verts.length]);
  const tri = { v: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0.5, 0], f: [{ v: [0, 1, 2, 3], uv: null, m: 0, s: false }, { v: [1, 4, 2], uv: null, m: 0, s: false }], e: {} };
  const tc = K.loopCut(tri, 3, 0);
  check('a triangle at the loop\'s end gets the new vertex in its edge (a quad then)', tc.mesh.f.length === 3 && tc.mesh.f[1].v.length === 4 && K.check(tc.mesh).ok, tc.mesh.f.map((f) => f.v));
}
{
  // Bridge edge loops: an open box's rim to a lid's border (closed after), two separate faces (a tube), mismatched counts.
  const c = K.cube(2), top = topFace(c);
  const box = K.deleteElements(c, K.selectionFromFaces(c, [top], 'face'), 'only-faces');
  const lid = K.grid(2, 1, 1);
  const join = (m1, m2, dz) => ({ v: [...m1.v, ...m2.v.map((x, i) => (i % 3 === 2 ? x + dz : x))], f: [...m1.f, ...m2.f.map((f) => ({ ...f, v: f.v.map((v) => v + m1.v.length / 3) }))], e: {} });
  const boxLid = join(box, lid, 3);
  const borders = [...K.edgeFaces(boxLid)].filter(([, fs]) => fs.length === 1).map(([k]) => k);
  check('an open box and a lid above it: 8 open edges', borders.length === 8);
  const br = K.bridgeLoops(boxLid, { mode: 'edge', verts: new Set(), edges: new Set(borders), faces: new Set() });
  // The lid's four edges all selected select its face too, so (as in Blender) it goes: a taller open box.
  check('bridging the rim to the lid\'s border: 4 walls the same way round as the box (the lid\'s face gone, as in Blender)', !br.error && br.faces.length === 4 && br.mesh.f.length === 9 && K.check(br.mesh).ok && K.check(br.mesh).open === 4 && K.check(br.mesh).flipped === 0, [br.error, br.mesh && K.check(br.mesh)]);
  const two = join(lid, lid, 2);
  const bf = K.bridgeLoops(two, K.selectionFromFaces(two, [0, 1], 'face'));
  const ctr = [0, 0, 1];
  check('bridging two selected faces: they go, a tube of 4 faces pointing outwards', !bf.error && bf.mesh.f.length === 4 && K.check(bf.mesh).nonManifold === 0 && bf.mesh.f.every((f) => K.vec.dot(K.faceNormal(bf.mesh, f).n, K.vec.sub(K.faceCentre(bf.mesh, f), ctr)) > 0), [bf.error, bf.mesh && bf.mesh.f.length]);
  const tube = box;
  const one = K.bridgeLoops(tube, { mode: 'edge', verts: new Set(), edges: new Set(borders.slice(0, 1)), faces: new Set() });
  check('one run of edges: not two loops', one.error === 'two');
  const g = K.grid(2, 2, 1), g2 = K.grid(2, 3, 1);
  const both = { v: [...g.v, ...g2.v.map((x, i) => (i % 3 === 2 ? x + 1 : x))], f: [...g.f, ...g2.f.map((f) => ({ ...f, v: f.v.map((v) => v + g.v.length / 3) }))], e: {} };
  const bord = [...K.edgeFaces(both)].filter(([, fs]) => fs.length === 1).map(([k]) => k);
  const mis = K.bridgeLoops(both, { mode: 'edge', verts: new Set(), edges: new Set(bord), faces: new Set() });
  check('loops of different lengths: refused (counts)', mis.error === 'counts', mis.error);
  const chains = K.edgeChains(['0_1', '1_2', '5_6']);
  check('edge chains: an open run of 3 vertices and one of 2', chains.length === 2 && chains.some((c2) => c2.verts.length === 3 && !c2.closed));
}


{
  // Bevel (Ctrl+B): one cube edge, all twelve, rounded, vertices.
  const c = K.cube(2), top = topFace(c), [a, b] = [c.f[top].v[0], c.f[top].v[1]];
  const one = K.bevel(c, { mode: 'edge', verts: new Set(), edges: new Set([K.edgeKey(a, b)]), faces: new Set() }, 0.2);
  check('bevel one cube edge: 7 faces, 10 vertices, closed and sound', one.mesh.f.length === 7 && K.vertexCount(one.mesh) === 10 && K.check(one.mesh).ok && K.check(one.mesh).closed, [one.mesh.f.length, K.vertexCount(one.mesh), K.check(one.mesh)]);
  check('…the volume a little less (a corner of the cube cut off along the edge)', K.volume(one.mesh) < 8 && K.volume(one.mesh) > 7.9, K.volume(one.mesh));
  const round = K.bevel(c, { mode: 'edge', verts: new Set(), edges: new Set([K.edgeKey(a, b)]), faces: new Set() }, 0.3, 3);
  check('…3 segments: 3 strips, still closed and sound (the end faces take the rounded points)', round.faces.length === 3 && K.check(round.mesh).ok && K.check(round.mesh).closed && K.check(round.mesh).flipped === 0, [round.faces.length, K.check(round.mesh)]);
  const all = K.selectionFromVerts(c, [...Array(8).keys()], 'edge');
  const full = K.bevel(c, all, 0.2);
  check('bevel every edge: 6 + 12 strips + 8 corner triangles = 26 faces, 24 vertices, closed, consistent', full.mesh.f.length === 26 && K.vertexCount(full.mesh) === 24 && K.check(full.mesh).ok && K.check(full.mesh).closed && K.check(full.mesh).flipped === 0, [full.mesh.f.length, K.vertexCount(full.mesh), K.check(full.mesh)]);
  check('…pointing out (positive volume)', K.volume(full.mesh) > 7.5 && K.volume(full.mesh) < 8, K.volume(full.mesh));
  const fullR = K.bevel(c, all, 0.2, 2);
  check('…2 segments everywhere: closed and sound', K.check(fullR.mesh).ok && K.check(fullR.mesh).closed && K.check(fullR.mesh).flipped === 0, K.check(fullR.mesh));
  const two = K.bevel(c, { mode: 'edge', verts: new Set(), edges: new Set([K.edgeKey(c.f[top].v[0], c.f[top].v[1]), K.edgeKey(c.f[top].v[1], c.f[top].v[2])]), faces: new Set() }, 0.2, 2);
  check('two edges meeting at a corner, 2 segments: closed and sound', K.check(two.mesh).ok && K.check(two.mesh).closed && K.check(two.mesh).flipped === 0, K.check(two.mesh));
  const vb = K.bevel(c, { mode: 'vert', verts: new Set([0]), edges: new Set(), faces: new Set() }, 0.3, 1, true);
  check('bevel a vertex: the corner cut off (a triangle), 7 faces, 10 vertices, closed', vb.mesh.f.length === 7 && K.vertexCount(vb.mesh) === 10 && K.check(vb.mesh).ok && K.check(vb.mesh).closed && K.check(vb.mesh).flipped === 0, [vb.mesh.f.length, K.check(vb.mesh)]);
  const wide = K.bevel(c, all, 50);
  check('a width far too big is held back (no overlap): still sound', K.check(wide.mesh).ok && K.volume(wide.mesh) > 0, K.check(wide.mesh));
}
{
  // Knife: across the cube's top face from one edge to the opposite one.
  const c = K.cube(2), top = topFace(c), v = c.f[top].v;
  const cut = K.knifeCut(c, [{ a: v[0], b: v[1], t: 0.5 }, { a: v[2], b: v[3], t: 0.5 }]);
  check('knife across a face: 2 new vertices, the face split (7 faces), closed and sound', K.vertexCount(cut.mesh) === 10 && cut.mesh.f.length === 7 && cut.edges.length === 1 && K.check(cut.mesh).ok && K.check(cut.mesh).closed, [K.vertexCount(cut.mesh), cut.mesh.f.length, K.check(cut.mesh)]);
  const g = K.grid(2, 2, 1);
  const across = K.knifeCut(g, [{ a: 0, b: 3, t: 0.5 }, { a: 1, b: 4, t: 0.5 }, { a: 2, b: 5, t: 0.5 }]);
  check('knife across two faces: 3 new vertices, 4 faces, sound', K.vertexCount(across.mesh) === 9 && across.mesh.f.length === 4 && K.check(across.mesh).ok, [K.vertexCount(across.mesh), across.mesh.f.length, K.check(across.mesh)]);
  const corner = K.knifeCut(c, [{ v: v[0] }, { v: v[2] }]);
  check('knife from corner to corner: the face split by its diagonal', corner.mesh.f.length === 7 && K.vertexCount(corner.mesh) === 8 && K.check(corner.mesh).ok);
}
{
  // Slide: an edge loop round a cut cube slides between its neighbours.
  const c = K.cube(2), top = topFace(c), [a, b] = [c.f[top].v[0], c.f[top].v[1]];
  const cut = K.loopCut(c, a, b);
  const sides = K.slideSides(cut.mesh, { mode: 'edge', verts: new Set(), edges: new Set(cut.edges), faces: new Set() });
  check('slide sides for a loop round a cube: each of its 4 vertices with a neighbour on both sides', sides.size === 4 && [...sides.values()].every((s2) => s2.a !== undefined && s2.b !== undefined && s2.a !== s2.b), [...sides.values()]);
  const one = K.slideSides(c, { mode: 'vert', verts: new Set([0]), edges: new Set(), faces: new Set() });
  check('one vertex: its 3 neighbours to slide along', one.get(0).all.length === 3);
  // Auto merge: a vertex moved onto another.
  const g = K.grid(2, 1, 1), moved = K.clone(g);
  moved.v[0] = g.v[3]; moved.v[1] = g.v[4]; moved.v[2] = g.v[5];
  const am = K.autoMerge(moved, [0], 0.001);
  check('auto merge: a vertex moved onto its neighbour is merged (3 left, the quad a triangle)', am.merged === 1 && K.vertexCount(am.mesh) === 3 && am.mesh.f[0].v.length === 3 && am.map[0] === am.map[1], [am.merged, K.vertexCount(am.mesh)]);
  const none = K.autoMerge(g, [0], 0.001);
  check('…nothing near: nothing merged', none.merged === 0 && none.mesh === g);
}


{
  // Knife over the surface: from the top's back edge, through a point inside the top, over the front edge, down to the
  // front's bottom edge; and round three faces of a cube from one corner region to another.
  const c = K.cube(2), n = (i) => K.faceNormal(c, c.f[i]).n;
  const top = c.f.findIndex((_, i) => n(i)[2] > 0.9), front = c.f.findIndex((_, i) => n(i)[1] < -0.9);
  const at = (p) => { for (let i = 0; i < 8; i++) if (K.vec.len(K.vec.sub([c.v[i * 3], c.v[i * 3 + 1], c.v[i * 3 + 2]], p)) < 1e-9) return i; return -1; };
  const backEdge = { a: at([-1, 1, 1]), b: at([1, 1, 1]), t: 0.5 }, mid = { f: top, p: [0.2, 0, 1] }, bottom = { a: at([-1, -1, -1]), b: at([1, -1, -1]), t: 0.5 };
  const eye = [0, -10, 8];
  const w1 = K.knifeWalk(c, backEdge, mid, eye), w2 = K.knifeWalk(c, mid, bottom, eye);
  check('knife walk inside one face: just the two points', w1.length === 2);
  check('…over an edge to the next face: the front-top edge crossed on the way', w2.length === 3 && w2[1].a !== undefined && [w2[1].a, w2[1].b].sort().join() === [at([-1, -1, 1]), at([1, -1, 1])].sort().join(), w2);
  const cut = K.knifePath(c, [...w1, ...w2.slice(1)]);
  check('knife path: the top and the front each split (8 faces), 3 vertices on edges + 1 inside, closed and sound', cut.mesh.f.length === 8 && K.vertexCount(cut.mesh) === 12 && K.check(cut.mesh).ok && K.check(cut.mesh).closed && K.check(cut.mesh).flipped === 0, [cut.mesh.f.length, K.vertexCount(cut.mesh), K.check(cut.mesh)]);
  check('…the volume unchanged', Math.abs(K.volume(cut.mesh) - 8) < 1e-9);
  const hang = K.knifePath(c, [{ f: top, p: [0, 0, 1] }, ...K.knifeWalk(c, { f: top, p: [0, 0, 1] }, { f: front, p: [0, -1, 0] }, eye).slice(1)]);
  check('…ends left hanging inside faces are dropped (nothing cut, no loose vertices)', hang.mesh.f.length === 6 && K.vertexCount(hang.mesh) === 8 && K.check(hang.mesh).ok);
  // Round a corner: from the front's left edge across the front, over to the right side, then to the top.
  const right = c.f.findIndex((_, i) => n(i)[0] > 0.9);
  const A = { a: at([-1, -1, -1]), b: at([-1, -1, 1]), t: 0.5 }, B = { f: right, p: [1, 0, 0.3] }, C = { a: at([-1, 1, 1]), b: at([-1, -1, 1]), t: 0.5 };
  const pts = [...K.knifeWalk(c, A, B, [4, -10, 3]), ...K.knifeWalk(c, B, C, [4, -6, 10]).slice(1)];
  const r2 = K.knifePath(c, pts);
  check('a cut over three faces (front, right, top): each split, closed and sound', r2.mesh.f.length === 9 && K.check(r2.mesh).ok && K.check(r2.mesh).closed && K.check(r2.mesh).flipped === 0, [r2.mesh.f.length, K.check(r2.mesh), pts]);
  const vtx = K.knifePath(c, [{ v: at([-1, -1, 1]) }, { v: at([1, -1, -1]) }]);
  check('corner to corner of one face: split by the diagonal', vtx.mesh.f.length === 7 && K.check(vtx.mesh).ok);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
