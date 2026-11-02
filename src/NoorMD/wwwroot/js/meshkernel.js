/* NoorMesh's geometry kernel: the editable polygon mesh and what is done to it. Pure functions, no DOM (tested in
   plain Node: tests/web/meshkernel.test.js).

   A mesh: { v: [x, y, z, x, y, z, …] (metres, +Z up as in Blender; exports turn it to glTF's +Y up), f: [face…], e?: { 'a_b': { seam, sharp } } } where a face is
   { v: [vertex indices, counter-clockwise seen from outside], uv: [u, v per corner] | null, m: material slot,
   s: smooth (true) or flat }. Faces have 3 or more corners (n-gons are kept for modelling and triangulated only to draw
   and export). UVs belong to the corners, so a seam is two corners of one vertex with different UVs. Edges are not
   stored: they come from the faces (their flags are kept by the pair of vertex indices, smaller first). */
(() => {
  'use strict';

  // ---------------------------------------------------------------- small vector maths
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vert = (mesh, i) => [mesh.v[i * 3], mesh.v[i * 3 + 1], mesh.v[i * 3 + 2]];

  // ---------------------------------------------------------------- the mesh
  const empty = () => ({ v: [], f: [], e: {} });
  const clone = (mesh) => ({ v: mesh.v.slice(), f: mesh.f.map((f) => ({ v: f.v.slice(), uv: f.uv ? f.uv.slice() : null, m: f.m || 0, s: !!f.s })), e: JSON.parse(JSON.stringify(mesh.e || {})) });
  const vertexCount = (mesh) => mesh.v.length / 3;
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  /** A face's normal and area (Newell's method: right for any planar or nearly planar polygon, concave too). */
  function faceNormal(mesh, face) {
    let nx = 0, ny = 0, nz = 0;
    const n = face.v.length;
    for (let k = 0; k < n; k++) {
      const a = face.v[k] * 3, b = face.v[(k + 1) % n] * 3, v = mesh.v;
      nx += (v[a + 1] - v[b + 1]) * (v[a + 2] + v[b + 2]);
      ny += (v[a + 2] - v[b + 2]) * (v[a] + v[b]);
      nz += (v[a] - v[b]) * (v[a + 1] + v[b + 1]);
    }
    const l = Math.hypot(nx, ny, nz);
    return { n: l > 0 ? [nx / l, ny / l, nz / l] : [0, 1, 0], area: l / 2 };
  }

  function faceCentre(mesh, face) {
    const c = [0, 0, 0];
    for (const i of face.v) { c[0] += mesh.v[i * 3]; c[1] += mesh.v[i * 3 + 1]; c[2] += mesh.v[i * 3 + 2]; }
    return scale(c, 1 / face.v.length);
  }

  /** Every edge once: [{ a, b, faces: [face indices], dir: [+1 / -1 per face: a→b or b→a in that face] }]. */
  function edges(mesh) {
    const map = new Map();
    mesh.f.forEach((face, fi) => {
      const n = face.v.length;
      for (let k = 0; k < n; k++) {
        const a = face.v[k], b = face.v[(k + 1) % n];
        const key = edgeKey(a, b);
        let e = map.get(key);
        if (!e) map.set(key, (e = { a: Math.min(a, b), b: Math.max(a, b), faces: [], dir: [] }));
        e.faces.push(fi); e.dir.push(a < b ? 1 : -1);
      }
    });
    return [...map.values()];
  }

  /**
   * What is wrong with a mesh, if anything: indices out of range, faces with fewer than 3 distinct corners, an edge
   * used by more than two faces (non-manifold), two faces turned opposite ways across an edge, and the counts.
   */
  function check(mesh) {
    const problems = [];
    const nv = vertexCount(mesh);
    if (mesh.v.length % 3 !== 0) problems.push('positions are not in threes');
    if (mesh.v.some((x) => !Number.isFinite(x))) problems.push('a position is not a number');
    let degenerate = 0;
    mesh.f.forEach((f, fi) => {
      if (!f.v || f.v.length < 3) { problems.push(`face ${fi} has fewer than 3 corners`); return; }
      if (f.v.some((i) => !Number.isInteger(i) || i < 0 || i >= nv)) problems.push(`face ${fi} points at a missing vertex`);
      if (new Set(f.v).size !== f.v.length) degenerate++;
      else if (faceNormal(mesh, f).area < 1e-12) degenerate++;
      if (f.uv && f.uv.length !== f.v.length * 2) problems.push(`face ${fi} has UVs for some corners only`);
    });
    if (problems.length) return { ok: false, problems, vertices: nv, faces: mesh.f.length };
    const es = edges(mesh);
    const nonManifold = es.filter((e) => e.faces.length > 2).length;
    const open = es.filter((e) => e.faces.length === 1).length;
    const flipped = es.filter((e) => e.faces.length === 2 && e.dir[0] === e.dir[1]).length;
    if (degenerate) problems.push(`${degenerate} degenerate face${degenerate === 1 ? '' : 's'}`);
    if (nonManifold) problems.push(`${nonManifold} non-manifold edge${nonManifold === 1 ? '' : 's'}`);
    if (flipped) problems.push(`${flipped} edge${flipped === 1 ? '' : 's'} between faces turned opposite ways`);
    const used = new Set(); mesh.f.forEach((f) => f.v.forEach((i) => used.add(i)));
    const loose = nv - used.size;
    return {
      ok: problems.length === 0, problems, vertices: nv, faces: mesh.f.length, edges: es.length,
      triangles: mesh.f.reduce((s, f) => s + f.v.length - 2, 0), open, nonManifold, flipped, degenerate, loose,
      closed: open === 0 && nonManifold === 0, euler: nv - loose - es.length + mesh.f.length,
    };
  }

  /** The volume enclosed (positive when the faces point outwards); meaningful for closed meshes. */
  function volume(mesh) {
    let vol = 0;
    for (const t of triangles(mesh)) {
      const a = vert(mesh, t[0]), b = vert(mesh, t[1]), c = vert(mesh, t[2]);
      vol += dot(a, cross(b, c)) / 6;
    }
    return vol;
  }

  // ---------------------------------------------------------------- triangulation
  /**
   * A face as triangles (corner positions within the face, k): ear clipping on the face's own plane, so concave
   * n-gons come out right; triangles and convex quads take the short way.
   */
  function triangulateFace(mesh, face) {
    const n = face.v.length;
    if (n === 3) return [[0, 1, 2]];
    const { n: nrm } = faceNormal(mesh, face);
    // A 2D frame on the face's plane.
    const ax = Math.abs(nrm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(ax, nrm)), w = cross(nrm, u);
    const p2 = face.v.map((i) => { const p = vert(mesh, i); return [dot(p, u), dot(p, w)]; });
    const area2 = (a, b, c) => (p2[b][0] - p2[a][0]) * (p2[c][1] - p2[a][1]) - (p2[b][1] - p2[a][1]) * (p2[c][0] - p2[a][0]);
    if (n === 4 && area2(0, 1, 2) > 0 && area2(0, 2, 3) > 0 && area2(1, 2, 3) > 0 && area2(1, 3, 0) > 0) {
      // A convex quad: along its shorter diagonal.
      const d02 = len(sub(vert(mesh, face.v[0]), vert(mesh, face.v[2]))), d13 = len(sub(vert(mesh, face.v[1]), vert(mesh, face.v[3])));
      return d02 <= d13 ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]];
    }
    const inTri = (p, a, b, c) => {
      const s1 = area2(a, b, p), s2 = area2(b, c, p), s3 = area2(c, a, p);
      return s1 >= -1e-12 && s2 >= -1e-12 && s3 >= -1e-12;
    };
    const idx = [...Array(n).keys()];
    const out = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < n * n) {
      let cut = false;
      for (let k = 0; k < idx.length; k++) {
        const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
        if (area2(a, b, c) <= 1e-14) continue; // a reflex (or flat) corner is no ear
        if (idx.some((p) => p !== a && p !== b && p !== c && inTri(p, a, b, c))) continue;
        out.push([a, b, c]); idx.splice(k, 1); cut = true; break;
      }
      if (!cut) break; // self-crossing or degenerate: fan the rest so nothing is lost
    }
    for (let k = 1; k + 1 < idx.length; k++) out.push([idx[0], idx[k], idx[k + 1]]);
    return out;
  }

  /** Every face as triangles of vertex indices. */
  function triangles(mesh) {
    const out = [];
    for (const face of mesh.f) for (const t of triangulateFace(mesh, face)) out.push([face.v[t[0]], face.v[t[1]], face.v[t[2]]]);
    return out;
  }

  /**
   * What the viewport draws: three vertices per triangle (so flat and smooth faces, and UV seams, need no splitting
   * logic), each with its position, normal and UV, the face it came from (for picking), and the edges as lines.
   * Smooth faces share a normal at each vertex (averaged over the smooth faces round it, weighted by area); flat faces
   * use their own. A matrix (column-major 4×4) moves it into the world.
   */
  function buffers(mesh, matrix) {
    const tris = [];
    const faceN = mesh.f.map((f) => faceNormal(mesh, f));
    const vn = new Float64Array(mesh.v.length);
    mesh.f.forEach((f, fi) => {
      if (!f.s) return;
      const { n, area } = faceN[fi];
      for (const i of f.v) { vn[i * 3] += n[0] * area; vn[i * 3 + 1] += n[1] * area; vn[i * 3 + 2] += n[2] * area; }
    });
    mesh.f.forEach((f, fi) => { for (const t of triangulateFace(mesh, f)) tris.push([fi, t]); });
    const count = tris.length * 3;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2), face = new Int32Array(tris.length);
    const m = matrix || null;
    const tp = (p) => (m ? transformPoint(m, p) : p);
    const nm = m ? normalMatrix(m) : null;
    const tn = (n) => (nm ? norm([nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2], nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2], nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2]]) : n);
    let o = 0;
    tris.forEach(([fi, t], ti) => {
      const f = mesh.f[fi];
      face[ti] = fi;
      for (const k of t) {
        const i = f.v[k];
        const p = tp(vert(mesh, i));
        let n = faceN[fi].n;
        if (f.s) { const s = [vn[i * 3], vn[i * 3 + 1], vn[i * 3 + 2]]; if (len(s) > 0) n = norm(s); }
        n = tn(n);
        pos.set(p, o * 3); nor.set(n, o * 3);
        if (f.uv) { uv[o * 2] = f.uv[k * 2]; uv[o * 2 + 1] = f.uv[k * 2 + 1]; }
        o++;
      }
    });
    const es = edges(mesh);
    const lines = new Float32Array(es.length * 6);
    es.forEach((e, k) => { lines.set(tp(vert(mesh, e.a)), k * 6); lines.set(tp(vert(mesh, e.b)), k * 6 + 3); });
    return { positions: pos, normals: nor, uvs: uv, faceOfTriangle: face, lines, triangles: tris.length };
  }

  function bounds(mesh, matrix) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount(mesh); i++) {
      const p = matrix ? transformPoint(matrix, vert(mesh, i)) : vert(mesh, i);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
    }
    return vertexCount(mesh) ? { min: lo, max: hi } : { min: [0, 0, 0], max: [0, 0, 0] };
  }

  // ---------------------------------------------------------------- transforms (column-major 4×4, as WebGL)
  const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function multiply(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
    return o;
  }
  /** Rotation from Euler angles in degrees, applied X then Y then Z (as Blender's default XYZ). */
  function rotation(rx, ry, rz) {
    const d = Math.PI / 180;
    const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx * d), Math.sin(rx * d), Math.cos(ry * d), Math.sin(ry * d), Math.cos(rz * d), Math.sin(rz * d)];
    const X = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
    const Y = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
    const Z = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return multiply(Z, multiply(Y, X));
  }
  /** An object's matrix from its location, rotation (degrees, XYZ) and scale. */
  function compose(t, r, s) {
    const m = rotation(r[0], r[1], r[2]);
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[c * 4 + k] *= s[c];
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
    return m;
  }
  /**
   * A matrix back to location, rotation (degrees, XYZ as compose) and scale; a mirrored matrix gives a negative X scale.
   * Matrices with shear lose it (an object's transform has none).
   */
  function decompose(m) {
    const col = (c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
    let sx = len(col(0)); const sy = len(col(1)), sz = len(col(2));
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    if (det < 0) sx = -sx;
    const R = (r, c) => m[c * 4 + r] / [sx, sy, sz][c];
    const d = 180 / Math.PI;
    const s20 = Math.max(-1, Math.min(1, R(2, 0)));
    let rx, ry, rz;
    ry = Math.asin(-s20);
    if (Math.abs(s20) < 0.999999) { rx = Math.atan2(R(2, 1), R(2, 2)); rz = Math.atan2(R(1, 0), R(0, 0)); }
    else { rz = 0; rx = Math.atan2(-R(1, 2), R(1, 1)); } // gimbal lock: all the turn about X
    const clean = (x) => (Math.abs(x) < 1e-9 ? 0 : Math.round(x * 1e9) / 1e9);
    return { t: [m[12], m[13], m[14]].map(clean), r: [rx * d, ry * d, rz * d].map(clean), s: [sx, sy, sz].map(clean) };
  }
  /** Rotation by an angle (degrees) about an axis through a point, as a matrix. */
  function rotationAbout(axis, degrees, pivot = [0, 0, 0]) {
    const [x, y, z] = norm(axis), a = (degrees * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    const R = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
    const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, pivot[0], pivot[1], pivot[2], 1], Ti = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pivot[0], -pivot[1], -pivot[2], 1];
    return multiply(T, multiply(R, Ti));
  }
  const transformPoint = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  /** The 3×3 inverse-transpose of a matrix's upper part (normals stay at right angles under scaling). */
  function normalMatrix(m) {
    const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C || 1;
    // Inverse transpose = cofactor matrix / det (laid out column-major).
    return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
  }
  /** A mesh with a matrix applied to its vertices (Apply transforms); faces turn inside out if it mirrors, so they are turned back. */
  function applyMatrix(mesh, m) {
    const out = clone(mesh);
    for (let i = 0; i < vertexCount(mesh); i++) { const p = transformPoint(m, vert(mesh, i)); out.v[i * 3] = p[0]; out.v[i * 3 + 1] = p[1]; out.v[i * 3 + 2] = p[2]; }
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    if (det < 0) out.f.forEach(flipFace);
    return out;
  }
  function flipFace(f) {
    f.v.reverse();
    if (f.uv) { const pairs = []; for (let k = 0; k < f.uv.length; k += 2) pairs.push([f.uv[k], f.uv[k + 1]]); f.uv = pairs.reverse().flat(); }
  }

  // ---------------------------------------------------------------- primitives (closed, outward, with UVs)
  function fromQuads(verts, faces, smooth = false) {
    return { v: verts.flat(), f: faces.map(([idx, uv]) => ({ v: idx, uv: uv ? uv.flat() : null, m: 0, s: smooth })), e: {} };
  }

  /** A cube: size along each axis, centred on the origin; each face its own square of the UVs' cross layout. */
  function cube(size = 2) {
    const h = size / 2;
    const v = [], index = new Map();
    const at = (p) => { const k = p.join(','); if (!index.has(k)) { index.set(k, v.length); v.push(p); } return index.get(k); };
    const cell = (cx, cy) => [[cx / 4, cy / 3], [(cx + 1) / 4, cy / 3], [(cx + 1) / 4, (cy + 1) / 3], [cx / 4, (cy + 1) / 3]];
    // Each face from its normal n and two axes u, v across it with u × v = n: corners −u−v, +u−v, +u+v, −u+v are then
    // counter-clockwise seen from outside. UVs: a 4×3 cross, the front (−Y, as Blender's front view sees it) in the middle.
    const sides = [
      [[0, -1, 0], [1, 0, 0], [0, 0, 1], cell(1, 1)], // front (−Y)
      [[0, 1, 0], [-1, 0, 0], [0, 0, 1], cell(3, 1)], // back (+Y)
      [[1, 0, 0], [0, 1, 0], [0, 0, 1], cell(2, 1)], // right (+X)
      [[-1, 0, 0], [0, -1, 0], [0, 0, 1], cell(0, 1)], // left (−X)
      [[0, 0, 1], [1, 0, 0], [0, 1, 0], cell(1, 2)], // top (+Z)
      [[0, 0, -1], [1, 0, 0], [0, -1, 0], cell(1, 0)], // bottom (−Z)
    ];
    const faces = sides.map(([n, u, w, uv]) => {
      const c = (a, b) => at([0, 1, 2].map((k) => (n[k] + a * u[k] + b * w[k]) * h));
      return [[c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)], uv];
    });
    return fromQuads(v, faces);
  }

  /** A grid on the floor (the XY plane, facing +Z): size, cuts along X and along Y. A plane is a grid of one. */
  function grid(size = 2, cutsX = 10, cutsZ = 10) {
    cutsX = Math.max(1, Math.round(cutsX)); cutsZ = Math.max(1, Math.round(cutsZ));
    const v = [], faces = [];
    for (let j = 0; j <= cutsZ; j++) for (let i = 0; i <= cutsX; i++) v.push([(i / cutsX - 0.5) * size, (j / cutsZ - 0.5) * size, 0]);
    const at = (i, j) => j * (cutsX + 1) + i;
    for (let j = 0; j < cutsZ; j++) for (let i = 0; i < cutsX; i++) {
      // Counter-clockwise seen from +Z: (i, j) → (i+1, j) → (i+1, j+1) → (i, j+1).
      faces.push([[at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], [[i / cutsX, j / cutsZ], [(i + 1) / cutsX, j / cutsZ], [(i + 1) / cutsX, (j + 1) / cutsZ], [i / cutsX, (j + 1) / cutsZ]]]);
    }
    return fromQuads(v, faces);
  }
  const plane = (size = 2) => grid(size, 1, 1);

  /** A UV sphere: radius, segments round, rings top to bottom (poles of triangles on the Z axis). */
  function uvSphere(radius = 1, segments = 32, rings = 16) {
    segments = Math.max(3, Math.round(segments)); rings = Math.max(2, Math.round(rings));
    const v = [[0, 0, radius]];
    for (let r = 1; r < rings; r++) {
      const phi = (Math.PI * r) / rings;
      for (let s = 0; s < segments; s++) { const th = (2 * Math.PI * s) / segments; v.push([radius * Math.sin(phi) * Math.cos(th), radius * Math.sin(phi) * Math.sin(th), radius * Math.cos(phi)]); }
    }
    v.push([0, 0, -radius]);
    const bottom = v.length - 1, ring = (r, s) => 1 + (r - 1) * segments + (s % segments);
    const faces = [];
    const U = (s) => s / segments, V = (r) => 1 - r / rings;
    for (let s = 0; s < segments; s++) faces.push([[0, ring(1, s), ring(1, s + 1)], [[U(s + 0.5), 1], [U(s), V(1)], [U(s + 1), V(1)]]]);
    for (let r = 1; r < rings - 1; r++) for (let s = 0; s < segments; s++)
      faces.push([[ring(r, s), ring(r + 1, s), ring(r + 1, s + 1), ring(r, s + 1)], [[U(s), V(r)], [U(s), V(r + 1)], [U(s + 1), V(r + 1)], [U(s + 1), V(r)]]]);
    for (let s = 0; s < segments; s++) faces.push([[bottom, ring(rings - 1, s + 1), ring(rings - 1, s)], [[U(s + 0.5), 0], [U(s + 1), V(rings - 1)], [U(s), V(rings - 1)]]]);
    return fromQuads(v, faces, true);
  }

  /** An icosphere: radius, subdivisions (0: the icosahedron). UVs from the direction (a seam at the back). */
  function icoSphere(radius = 1, subdivisions = 2) {
    subdivisions = Math.max(0, Math.min(5, Math.round(subdivisions)));
    const t = (1 + Math.sqrt(5)) / 2;
    let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
    let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < subdivisions; s++) {
      const mid = new Map();
      const m = (a, b) => { const k = edgeKey(a, b); if (!mid.has(k)) { mid.set(k, v.length); v.push(norm(add(v[a], v[b]))); } return mid.get(k); };
      f = f.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
    }
    const uvOf = (p) => [0.5 + Math.atan2(p[1], p[0]) / (2 * Math.PI), 0.5 + Math.asin(Math.max(-1, Math.min(1, p[2]))) / Math.PI];
    const faces = f.map((tri) => {
      const uvs = tri.map((i) => uvOf(v[i]));
      // A triangle across the seam at the back: its low-u corners wrap round.
      const us = uvs.map((q) => q[0]);
      if (Math.max(...us) - Math.min(...us) > 0.5) uvs.forEach((q) => { if (q[0] < 0.5) q[0] += 1; });
      return [tri, uvs];
    });
    return fromQuads(v.map((p) => scale(p, radius)), faces, true);
  }

  /** A cylinder along Z (or a cone when the top radius is 0): bottom radius, top radius, depth (height), segments, capped. */
  function cylinder(radius = 1, depth = 2, segments = 32, topRadius = radius) {
    segments = Math.max(3, Math.round(segments));
    const h = depth / 2, v = [], faces = [];
    const cone = topRadius <= 1e-9;
    for (let s = 0; s < segments; s++) { const th = (2 * Math.PI * s) / segments; v.push([radius * Math.cos(th), radius * Math.sin(th), -h]); }
    if (!cone) for (let s = 0; s < segments; s++) { const th = (2 * Math.PI * s) / segments; v.push([topRadius * Math.cos(th), topRadius * Math.sin(th), h]); }
    const tip = cone ? v.push([0, 0, h]) - 1 : -1;
    const B = (s) => s % segments, T = (s) => segments + (s % segments);
    for (let s = 0; s < segments; s++) {
      if (cone) faces.push([[B(s), B(s + 1), tip], [[s / segments, 0.5], [(s + 1) / segments, 0.5], [(s + 0.5) / segments, 1]]]);
      else faces.push([[B(s), B(s + 1), T(s + 1), T(s)], [[s / segments, 0.5], [(s + 1) / segments, 0.5], [(s + 1) / segments, 1], [s / segments, 1]]]);
    }
    const capUv = (s, cx) => [cx + 0.25 * Math.cos((2 * Math.PI * s) / segments) * 0.9, 0.25 + 0.25 * Math.sin((2 * Math.PI * s) / segments) * 0.9];
    // Bottom cap: counter-clockwise seen from below (−Z), so the ring backwards.
    faces.push([[...Array(segments).keys()].reverse().map(B), [...Array(segments).keys()].reverse().map((s) => capUv(s, 0.25))]);
    if (!cone) faces.push([[...Array(segments).keys()].map(T), [...Array(segments).keys()].map((s) => capUv(s, 0.75))]);
    const mesh = fromQuads(v, faces);
    // The sides are smooth, the caps flat (as Blender's shade auto smooth would show them).
    mesh.f.forEach((f, i) => { f.s = i < segments; });
    mesh.e = {};
    for (let s = 0; s < segments; s++) { mesh.e[edgeKey(B(s), B(s + 1))] = { sharp: true }; if (!cone) mesh.e[edgeKey(T(s), T(s + 1))] = { sharp: true }; }
    return mesh;
  }
  const cone = (radius = 1, depth = 2, segments = 32) => cylinder(radius, depth, segments, 0);

  /** A torus round the Z axis: major radius (to the tube's centre), minor radius (the tube's), segments, sides. */
  function torus(major = 1, minor = 0.25, segments = 48, sides = 12) {
    segments = Math.max(3, Math.round(segments)); sides = Math.max(3, Math.round(sides));
    const v = [], faces = [];
    for (let s = 0; s < segments; s++) {
      const th = (2 * Math.PI * s) / segments;
      for (let k = 0; k < sides; k++) {
        const ph = (2 * Math.PI * k) / sides, r = major + minor * Math.cos(ph);
        v.push([r * Math.cos(th), r * Math.sin(th), minor * Math.sin(ph)]);
      }
    }
    const at = (s, k) => (s % segments) * sides + (k % sides);
    for (let s = 0; s < segments; s++) for (let k = 0; k < sides; k++)
      faces.push([[at(s, k), at(s + 1, k), at(s + 1, k + 1), at(s, k + 1)], [[s / segments, k / sides], [(s + 1) / segments, k / sides], [(s + 1) / segments, (k + 1) / sides], [s / segments, (k + 1) / sides]]]);
    return fromQuads(v, faces, true);
  }

  const PRIMITIVES = {
    cube: { name: 'Cube', make: (p) => cube(p.size), params: { size: 2 } },
    plane: { name: 'Plane', make: (p) => plane(p.size), params: { size: 2 } },
    grid: { name: 'Grid', make: (p) => grid(p.size, p.cutsX, p.cutsZ), params: { size: 2, cutsX: 10, cutsZ: 10 } },
    uvsphere: { name: 'UV sphere', make: (p) => uvSphere(p.radius, p.segments, p.rings), params: { radius: 1, segments: 32, rings: 16 } },
    icosphere: { name: 'Icosphere', make: (p) => icoSphere(p.radius, p.subdivisions), params: { radius: 1, subdivisions: 2 } },
    cylinder: { name: 'Cylinder', make: (p) => cylinder(p.radius, p.depth, p.segments), params: { radius: 1, depth: 2, segments: 32 } },
    cone: { name: 'Cone', make: (p) => cone(p.radius, p.depth, p.segments), params: { radius: 1, depth: 2, segments: 32 } },
    torus: { name: 'Torus', make: (p) => torus(p.major, p.minor, p.segments, p.sides), params: { major: 1, minor: 0.25, segments: 48, sides: 12 } },
  };

  // ---------------------------------------------------------------- picking
  /** The nearest triangle a ray meets (Möller–Trumbore, both sides) in drawn buffers: { t, face } or null. */
  function rayHit(buf, origin, dir) {
    let best = Infinity, face = -1;
    const p = buf.positions;
    for (let tri = 0; tri < buf.triangles; tri++) {
      const o = tri * 9;
      const a = [p[o], p[o + 1], p[o + 2]], b = [p[o + 3], p[o + 4], p[o + 5]], c = [p[o + 6], p[o + 7], p[o + 8]];
      const e1 = sub(b, a), e2 = sub(c, a), pv = cross(dir, e2), det = dot(e1, pv);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tv = sub(origin, a), u = dot(tv, pv) * inv;
      if (u < 0 || u > 1) continue;
      const qv = cross(tv, e1), w = dot(dir, qv) * inv;
      if (w < 0 || u + w > 1) continue;
      const t = dot(e2, qv) * inv;
      if (t > 1e-6 && t < best) { best = t; face = buf.faceOfTriangle[tri]; }
    }
    return face >= 0 ? { t: best, face } : null;
  }

  // ================================================================ Edit Mode (A2)
  // A selection: { mode: 'vert' | 'edge' | 'face', verts: Set, edges: Set of edge keys, faces: Set of face indices }.
  // The set of its mode is the one that counts; the others follow from it (as Blender flushes): in vertex mode an edge
  // or face is selected when all its vertices are; in edge mode a face when all its edges are.

  const faceEdgeKeys = (face) => face.v.map((a, k) => edgeKey(a, face.v[(k + 1) % face.v.length]));
  function emptySelection(mode = 'vert') { return { mode, verts: new Set(), edges: new Set(), faces: new Set() }; }
  function cloneSelection(s) { return { mode: s.mode, verts: new Set(s.verts), edges: new Set(s.edges), faces: new Set(s.faces) }; }

  /** The whole selection as vertices, edges and faces, from the set its mode keeps. */
  function flush(mesh, sel) {
    const verts = new Set(), edgesSel = new Set(), faces = new Set();
    if (sel.mode === 'vert') {
      sel.verts.forEach((v) => verts.add(v));
      mesh.f.forEach((f, i) => { if (f.v.every((v) => verts.has(v))) faces.add(i); });
      for (const e of edges(mesh)) if (verts.has(e.a) && verts.has(e.b)) edgesSel.add(edgeKey(e.a, e.b));
    } else if (sel.mode === 'edge') {
      sel.edges.forEach((k) => { edgesSel.add(k); const [a, b] = k.split('_').map(Number); verts.add(a); verts.add(b); });
      mesh.f.forEach((f, i) => { if (faceEdgeKeys(f).every((k) => edgesSel.has(k))) faces.add(i); });
    } else {
      sel.faces.forEach((i) => { if (!mesh.f[i]) return; faces.add(i); mesh.f[i].v.forEach((v) => verts.add(v)); faceEdgeKeys(mesh.f[i]).forEach((k) => edgesSel.add(k)); });
    }
    return { verts, edges: edgesSel, faces };
  }
  /** The selection in another mode (as Blender converts it when you press 1, 2 or 3). */
  function convertSelection(mesh, sel, mode) {
    const f = flush(mesh, sel), out = emptySelection(mode);
    if (mode === 'vert') f.verts.forEach((v) => out.verts.add(v));
    if (mode === 'edge') f.edges.forEach((k) => out.edges.add(k));
    if (mode === 'face') f.faces.forEach((i) => out.faces.add(i));
    return out;
  }
  /** A selection of these vertices, in a mode (its edges or faces those the vertices make whole). */
  function selectionFromVerts(mesh, verts, mode) { return convertSelection(mesh, { mode: 'vert', verts: new Set(verts), edges: new Set(), faces: new Set() }, mode); }
  function selectionFromFaces(mesh, faces, mode) { return convertSelection(mesh, { mode: 'face', verts: new Set(), edges: new Set(), faces: new Set(faces) }, mode); }

  /** Faces with fewer than 3 different corners, or the same corner twice in a row, cleaned (their UVs kept with them). */
  function cleanFaces(mesh) {
    const out = [];
    for (const f of mesh.f) {
      const v = [], uv = [];
      f.v.forEach((x, k) => { if (v.length && v[v.length - 1] === x) return; v.push(x); if (f.uv) uv.push(f.uv[k * 2], f.uv[k * 2 + 1]); });
      while (v.length > 1 && v[0] === v[v.length - 1]) { v.pop(); if (f.uv) uv.splice(-2, 2); }
      if (new Set(v).size < 3 || new Set(v).size !== v.length) continue;
      out.push({ ...f, v, uv: f.uv ? uv : null });
    }
    mesh.f = out;
    return mesh;
  }
  /** Vertices no face uses taken away (unless kept); returns { mesh, map: old index → new index (−1: gone) }. */
  function compact(mesh, keep) {
    const used = new Uint8Array(vertexCount(mesh));
    mesh.f.forEach((f) => f.v.forEach((v) => { used[v] = 1; }));
    if (keep) keep.forEach((v) => { if (v < used.length) used[v] = 1; });
    const map = new Int32Array(used.length).fill(-1), v = [];
    let n = 0;
    for (let i = 0; i < used.length; i++) if (used[i]) { map[i] = n++; v.push(mesh.v[i * 3], mesh.v[i * 3 + 1], mesh.v[i * 3 + 2]); }
    const e = {};
    for (const [k, flags] of Object.entries(mesh.e || {})) { const [a, b] = k.split('_').map(Number); if (map[a] >= 0 && map[b] >= 0) e[edgeKey(map[a], map[b])] = flags; }
    return { mesh: { v, f: mesh.f.map((f) => ({ ...f, v: f.v.map((x) => map[x]) })), e }, map };
  }
  const remapSet = (set, map) => new Set([...set].map((x) => map[x]).filter((x) => x >= 0));

  /** Selected vertices moved by a matrix (in the mesh's own space). */
  function transformVerts(mesh, verts, m) {
    const out = clone(mesh);
    for (const i of verts) { const p = transformPoint(m, vert(mesh, i)); out.v[i * 3] = p[0]; out.v[i * 3 + 1] = p[1]; out.v[i * 3 + 2] = p[2]; }
    return out;
  }

  /** Faces sharing edges with their neighbours: edge key → face indices. */
  function edgeFaces(mesh) {
    const map = new Map();
    mesh.f.forEach((f, i) => faceEdgeKeys(f).forEach((k) => { if (!map.has(k)) map.set(k, []); map.get(k).push(i); }));
    return map;
  }

  /**
   * Extrude a region of faces (as Blender's E): the region gets new vertices of its own and walls join its border to
   * where it was (open borders too). The region stays in place (the move along its normal comes after). Returns
   * { mesh, faces: the region's face indices, verts: its new vertices, normal: the region's average normal }.
   */
  function extrudeFaces(mesh, faceSet) {
    const out = clone(mesh), region = [...faceSet].filter((i) => mesh.f[i]);
    if (!region.length) return { mesh: out, faces: [], verts: [], normal: [0, 0, 1] };
    const inRegion = new Set(region), count = new Map();
    region.forEach((i) => faceEdgeKeys(mesh.f[i]).forEach((k) => count.set(k, (count.get(k) || 0) + 1)));
    const dup = new Map();
    const copy = (v) => { if (!dup.has(v)) { dup.set(v, vertexCount(out)); out.v.push(...vert(mesh, v)); } return dup.get(v); };
    let nrm = [0, 0, 0];
    for (const i of region) {
      const f = mesh.f[i], n = f.v.length;
      const fn = faceNormal(mesh, f); nrm = add(nrm, scale(fn.n, fn.area || 1));
      for (let k = 0; k < n; k++) {
        const a = f.v[k], b = f.v[(k + 1) % n];
        if (count.get(edgeKey(a, b)) !== 1) continue; // inside the region
        // A wall with a→b (opposite the neighbour outside, which runs b→a) and b'→a' (opposite the moved face's a'→b').
        out.f.push({ v: [a, b, copy(b), copy(a)], uv: [0, 0, 1, 0, 1, 1, 0, 1], m: f.m || 0, s: !!f.s });
      }
    }
    for (const i of region) out.f[i] = { ...out.f[i], v: out.f[i].v.map(copy) };
    const { mesh: m2, map } = compact(out);
    return { mesh: m2, faces: region, verts: [...dup.values()].map((v) => map[v]), normal: norm(nrm) };
  }

  /**
   * Extrude open edges (edges with one face, as at a border): each becomes a new face beside it, its far side made of
   * new vertices. Returns { mesh, verts: the new vertices, edges: the new far edges }.
   */
  function extrudeEdges(mesh, edgeKeys) {
    const out = clone(mesh), ef = edgeFaces(mesh), dup = new Map();
    const copy = (v) => { if (!dup.has(v)) { dup.set(v, vertexCount(out)); out.v.push(...vert(mesh, v)); } return dup.get(v); };
    const farEdges = [];
    for (const k of edgeKeys) {
      const faces = ef.get(k) || [];
      if (faces.length !== 1) continue;
      const f = mesh.f[faces[0]], [x, y] = k.split('_').map(Number);
      // The face runs a→b along this edge: the new face runs b→a.
      const kx = f.v.indexOf(x), forward = f.v[(kx + 1) % f.v.length] === y;
      const a = forward ? x : y, b = forward ? y : x;
      out.f.push({ v: [b, a, copy(a), copy(b)], uv: [0, 0, 1, 0, 1, 1, 0, 1], m: f.m || 0, s: !!f.s });
      farEdges.push([copy(a), copy(b)]);
    }
    return { mesh: out, verts: [...dup.values()], edges: farEdges.map(([a, b]) => edgeKey(a, b)) };
  }

  /**
   * Inset faces (each by itself, as Blender's I pressed twice): a smaller copy inside each, its edges the thickness in
   * from the face's, joined by a ring of quads; depth lifts it along the normal. Returns { mesh, faces: the inner faces }.
   */
  function insetFaces(mesh, faceSet, thickness, depth = 0) {
    const out = clone(mesh), inner = [];
    for (const i of [...faceSet].filter((x) => mesh.f[x])) {
      const f = mesh.f[i], n = f.v.length, { n: N } = faceNormal(mesh, f);
      const P = f.v.map((v) => vert(mesh, v)), C = faceCentre(mesh, f);
      const uvC = f.uv ? [0, 1].map((c) => f.uv.filter((_, k) => k % 2 === c).reduce((s, x) => s + x, 0) / n) : null;
      const ring = P.map((c, k) => {
        const p = P[(k + n - 1) % n], q = P[(k + 1) % n];
        const in1 = norm(cross(N, norm(sub(c, p)))), in2 = norm(cross(N, norm(sub(q, c))));
        const bis = norm(add(in1, in2)), d = thickness / Math.max(0.2, dot(bis, in1));
        // Never past the centre.
        const toC = len(sub(C, c)), step = Math.min(d, toC * 0.98);
        return add(add(c, scale(bis, step)), scale(N, depth));
      });
      const base = vertexCount(out);
      ring.forEach((p) => out.v.push(...p));
      const ringUv = f.uv ? f.v.map((_, k) => { const u = [f.uv[k * 2], f.uv[k * 2 + 1]], t = Math.min(0.98, thickness / Math.max(1e-6, len(sub(C, P[k])))); return [u[0] + (uvC[0] - u[0]) * t, u[1] + (uvC[1] - u[1]) * t]; }) : null;
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        out.f.push({ v: [f.v[k], f.v[k2], base + k2, base + k], uv: f.uv ? [f.uv[k * 2], f.uv[k * 2 + 1], f.uv[k2 * 2], f.uv[k2 * 2 + 1], ...ringUv[k2], ...ringUv[k]] : null, m: f.m || 0, s: !!f.s });
      }
      out.f[i] = { ...f, v: f.v.map((_, k) => base + k), uv: ringUv ? ringUv.flat() : null };
      inner.push(i);
    }
    return { mesh: out, faces: inner };
  }

  /**
   * Inset a region of faces as one (as Blender's I): a ring of quads along the region's border only, the faces inside
   * left whole; depth lifts the region along its normal. A region with no border (a whole closed mesh) is unchanged.
   * Returns { mesh, faces: the region's faces, verts: the region's vertices after it }.
   */
  function insetRegion(mesh, faceSet, thickness, depth = 0) {
    const region = [...faceSet].filter((i) => mesh.f[i]);
    const out = clone(mesh);
    if (!region.length) return { mesh: out, faces: [], verts: [] };
    const count = new Map();
    region.forEach((i) => faceEdgeKeys(mesh.f[i]).forEach((k) => count.set(k, (count.get(k) || 0) + 1)));
    // Each border vertex: the inward directions of the border edges coming in and going out, and the normals around it.
    const info = new Map(), vn = new Map();
    const border = [];
    for (const i of region) {
      const f = mesh.f[i], n = f.v.length, { n: N, area } = faceNormal(mesh, f);
      f.v.forEach((v) => vn.set(v, add(vn.get(v) || [0, 0, 0], scale(N, area || 1))));
      for (let k = 0; k < n; k++) {
        const a = f.v[k], b = f.v[(k + 1) % n];
        if (count.get(edgeKey(a, b)) !== 1) continue;
        border.push({ face: i, k, a, b });
        const inward = norm(cross(N, norm(sub(vert(mesh, b), vert(mesh, a)))));
        if (!info.has(a)) info.set(a, { into: [], outof: [] });
        if (!info.has(b)) info.set(b, { into: [], outof: [] });
        info.get(a).outof.push(inward); info.get(b).into.push(inward);
      }
    }
    if (!border.length) return { mesh: out, faces: region, verts: [...new Set(region.flatMap((i) => mesh.f[i].v))] };
    const lift = (v) => scale(norm(vn.get(v) || [0, 0, 1]), depth);
    // The border's inner copies.
    const inner = new Map();
    for (const [v, { into, outof }] of info) {
      const in1 = into[0] || outof[0], in2 = outof[0] || into[0];
      const bis = norm(add(in1, in2)), d = thickness / Math.max(0.2, dot(bis, in1));
      inner.set(v, vertexCount(out));
      out.v.push(...add(add(vert(mesh, v), scale(bis, d)), lift(v)));
    }
    // The region's own vertices inside are lifted.
    const insideVerts = new Set();
    region.forEach((i) => mesh.f[i].v.forEach((v) => { if (!inner.has(v)) insideVerts.add(v); }));
    for (const v of insideVerts) { const p = add(vert(mesh, v), lift(v)); out.v[v * 3] = p[0]; out.v[v * 3 + 1] = p[1]; out.v[v * 3 + 2] = p[2]; }
    // The ring: a→b along the border, then b'→a'.
    for (const { face, k, a, b } of border) {
      const f = mesh.f[face], n = f.v.length, k2 = (k + 1) % n;
      const uv = f.uv ? [f.uv[k * 2], f.uv[k * 2 + 1], f.uv[k2 * 2], f.uv[k2 * 2 + 1], f.uv[k2 * 2], f.uv[k2 * 2 + 1], f.uv[k * 2], f.uv[k * 2 + 1]] : null;
      out.f.push({ v: [a, b, inner.get(b), inner.get(a)], uv, m: f.m || 0, s: !!f.s });
    }
    for (const i of region) out.f[i] = { ...out.f[i], v: out.f[i].v.map((v) => (inner.has(v) ? inner.get(v) : v)) };
    return { mesh: out, faces: region, verts: [...new Set(region.flatMap((i) => out.f[i].v))] };
  }

  /**
   * The ring of edges a loop cut crosses (as Blender's Ctrl+R): from the edge a–b on through quads by their opposite
   * edges, both ways. Returns { ring: Map edge key → [from, to] (all running the same way round), faces: Map face → the
   * index in it of one of its ring edges }.
   */
  function loopRing(mesh, a, b) {
    const ef = edgeFaces(mesh), ring = new Map(), faces = new Map();
    if (!ef.has(edgeKey(a, b))) return { ring, faces };
    ring.set(edgeKey(a, b), [a, b]);
    const walk = (face, from, to) => {
      for (let guard = 0; face !== undefined && guard < 100000; guard++) {
        if (faces.has(face)) return;
        const f = mesh.f[face];
        if (f.v.length !== 4) return;
        let k = -1;
        for (let j = 0; j < 4; j++) { const x = f.v[j], y = f.v[(j + 1) % 4]; if ((x === from && y === to) || (x === to && y === from)) { k = j; break; } }
        if (k < 0) return;
        faces.set(face, k);
        // f.v[k+3] sits beside f.v[k], f.v[k+2] beside f.v[k+1].
        const nf = f.v[k] === from ? f.v[(k + 3) % 4] : f.v[(k + 2) % 4], nt = f.v[k] === from ? f.v[(k + 2) % 4] : f.v[(k + 3) % 4];
        const ok = edgeKey(nf, nt);
        if (ring.has(ok)) return; // round the loop
        ring.set(ok, [nf, nt]);
        face = (ef.get(ok) || []).find((x) => x !== face && !faces.has(x));
        from = nf; to = nt;
      }
    };
    for (const fc of ef.get(edgeKey(a, b))) walk(fc, a, b);
    return { ring, faces };
  }
  /**
   * A loop cut (as Blender's Ctrl+R): `cuts` new edge loops across the ring from the edge a–b, evenly spaced; `factor`
   * (0..1, 0.5 in the middle) slides them towards a or b. Faces at the loop's ends (not quads) get the new vertices on
   * their edges. Returns { mesh, verts: the new vertices, edges: the new loops' edge keys }.
   */
  function loopCut(mesh, a, b, cuts = 1, factor = 0.5) {
    cuts = Math.max(1, Math.min(64, Math.round(cuts)));
    const { ring, faces } = loopRing(mesh, a, b), out = clone(mesh);
    if (!faces.size) return { mesh: out, verts: [], edges: [] };
    const h = 1 / (cuts + 1), off = (Math.max(0.01, Math.min(0.99, factor)) - 0.5) * 2 * h;
    const ts = Array.from({ length: cuts }, (_, i) => (i + 1) * h + off);
    const made = new Map(), newVerts = [];
    for (const [k, [from, to]] of ring) {
      const pa = vert(mesh, from), pb = vert(mesh, to), ids = [];
      for (const t of ts) { ids.push(vertexCount(out)); out.v.push(...add(pa, scale(sub(pb, pa), t))); }
      made.set(k, { from, ids });
      newVerts.push(...ids);
    }
    // The points along an edge x→y: x, the new ones in that direction, y (and the share of the way along each).
    const along = (x, y) => { const m = made.get(edgeKey(x, y)), ids = m.from === x ? m.ids : m.ids.slice().reverse(), t = m.from === x ? ts : ts.map((v) => 1 - v).reverse(); return { ids: [x, ...ids, y], t: [0, ...t, 1] }; };
    const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const newEdges = [];
    for (const [fi, k] of faces) {
      const f = mesh.f[fi], q = [0, 1, 2, 3].map((j) => f.v[(k + j) % 4]);
      const uv = f.uv ? [0, 1, 2, 3].map((j) => [f.uv[((k + j) % 4) * 2], f.uv[((k + j) % 4) * 2 + 1]]) : null;
      const P = along(q[0], q[1]), Q = along(q[3], q[2]);
      const parts = [];
      for (let j = 0; j <= cuts; j++) {
        const fv = [P.ids[j], P.ids[j + 1], Q.ids[j + 1], Q.ids[j]];
        const fuv = uv ? [lerp2(uv[0], uv[1], P.t[j]), lerp2(uv[0], uv[1], P.t[j + 1]), lerp2(uv[3], uv[2], Q.t[j + 1]), lerp2(uv[3], uv[2], Q.t[j])].flat() : null;
        parts.push({ v: fv, uv: fuv, m: f.m || 0, s: !!f.s });
        if (j > 0) newEdges.push(edgeKey(P.ids[j], Q.ids[j]));
      }
      out.f[fi] = parts[0];
      out.f.push(...parts.slice(1));
    }
    // Faces at the ends: the new vertices put into their edges.
    mesh.f.forEach((f, fi) => {
      if (faces.has(fi)) return;
      const n = f.v.length;
      if (!faceEdgeKeys(f).some((k) => made.has(k))) return;
      const v = [], uv = f.uv ? [] : null;
      for (let j = 0; j < n; j++) {
        const x = f.v[j], y = f.v[(j + 1) % n];
        v.push(x); if (uv) uv.push(f.uv[j * 2], f.uv[j * 2 + 1]);
        if (!made.has(edgeKey(x, y))) continue;
        const A = along(x, y), u0 = f.uv ? [f.uv[j * 2], f.uv[j * 2 + 1]] : null, u1 = f.uv ? [f.uv[((j + 1) % n) * 2], f.uv[((j + 1) % n) * 2 + 1]] : null;
        for (let i = 1; i <= cuts; i++) { v.push(A.ids[i]); if (uv) uv.push(...lerp2(u0, u1, A.t[i])); }
      }
      out.f[fi] = { ...out.f[fi], v, uv };
    });
    return { mesh: out, verts: newVerts, edges: [...new Set(newEdges)] };
  }

  /** Selected edges in runs: each { verts: in order, closed }. */
  function edgeChains(edgeKeys) {
    const nb = new Map(), left = new Set(edgeKeys);
    for (const k of left) { const [a, b] = k.split('_').map(Number); if (!nb.has(a)) nb.set(a, []); if (!nb.has(b)) nb.set(b, []); nb.get(a).push(b); nb.get(b).push(a); }
    const chains = [];
    const take = (a, b) => left.delete(edgeKey(a, b));
    const follow = (start) => {
      const verts = [start];
      let cur = start;
      for (;;) {
        const next = (nb.get(cur) || []).find((x) => left.has(edgeKey(cur, x)));
        if (next === undefined) break;
        take(cur, next);
        if (next === start) return { verts, closed: true };
        verts.push(next); cur = next;
      }
      return { verts, closed: false };
    };
    // Open runs from their ends first, then what is left is closed.
    for (const [v, list] of nb) if (list.length === 1 && list.some((x) => left.has(edgeKey(v, x)))) chains.push(follow(v));
    for (const k of [...left]) { if (!left.has(k)) continue; const [a] = k.split('_').map(Number); chains.push(follow(a)); }
    return chains;
  }
  /**
   * Bridge two edge loops (as Blender's Bridge Edge Loops): quads between two runs of selected edges with the same
   * number of edges, turned and lined up so that the quads are the shortest. Selected faces (whose borders the loops
   * are) are taken out first. Returns { mesh, faces: the new faces } or { error: 'two' | 'counts' }.
   */
  function bridgeLoops(mesh, sel) {
    const f = flush(mesh, sel);
    let out = clone(mesh);
    let keys = [...f.edges];
    if (f.faces.size) {
      // The faces between the loops go; the edges between two of them are not loops.
      out.f = out.f.filter((_, i) => !f.faces.has(i));
      keys = keys.filter((k) => countIn(mesh, f.faces, k) < 2);
    }
    const chains = edgeChains(keys);
    if (chains.length !== 2) return { error: 'two' };
    let [A, B] = chains;
    const edgesOf = (c) => c.verts.length - (c.closed ? 0 : 1);
    if (A.closed !== B.closed || edgesOf(A) !== edgesOf(B)) return { error: 'counts' };
    const P = (v) => vert(out, v), n = A.verts.length;
    // Line B up with A: the turn (closed) and the direction with the shortest joins.
    let best = null;
    for (const dir of [1, -1]) for (let r = 0; r < (A.closed ? n : 1); r++) {
      const b = Array.from({ length: n }, (_, i) => B.verts[(((dir === 1 ? i : n - 1 - i) + r) % n + n) % n]);
      const cost = A.verts.reduce((s, v, i) => s + len(sub(P(v), P(b[i]))), 0);
      if (!best || cost < best.cost) best = { cost, b };
    }
    const a = A.verts, b = best.b, faces = [];
    // Which way round: against the faces already on the loop's edges (so normals agree), else outwards from the middle.
    const ef = edgeFaces(out);
    let flip = null;
    for (let i = 0; i < (A.closed ? n : n - 1) && flip === null; i++) {
      const x = a[i], y = a[(i + 1) % n], fs = ef.get(edgeKey(x, y)) || [];
      if (!fs.length) continue;
      const fv = out.f[fs[0]].v, kx = fv.indexOf(x);
      flip = fv[(kx + 1) % fv.length] === y; // the face there runs x→y: ours must run y→x
    }
    const quad = (i) => { const j = (i + 1) % n; return [a[i], a[j], b[j], b[i]]; };
    const count = A.closed ? n : n - 1;
    if (flip === null) {
      const c = scale([...a, ...b].reduce((s, v) => add(s, P(v)), [0, 0, 0]), 1 / (2 * n)), q = quad(0);
      const nrm = cross(sub(P(q[1]), P(q[0])), sub(P(q[3]), P(q[0])));
      flip = dot(nrm, sub(P(q[0]), c)) < 0;
    }
    for (let i = 0; i < count; i++) {
      const q = quad(i);
      faces.push(out.f.length);
      out.f.push(flip ? { v: q.reverse(), uv: [0, 1, 1, 1, 1, 0, 0, 0], m: 0, s: false } : { v: q, uv: [0, 0, 1, 0, 1, 1, 0, 1], m: 0, s: false });
    }
    return { mesh: out, faces };
  }
  const countIn = (mesh, faceSet, k) => [...faceSet].filter((i) => mesh.f[i] && faceEdgeKeys(mesh.f[i]).includes(k)).length;

  /**
   * Delete (as Blender's X): 'verts' takes the vertices and every face using them; 'edges' the faces using the edges
   * (and vertices left with none); 'faces' the faces and vertices left with none; 'only-faces' the faces alone.
   */
  function deleteElements(mesh, sel, what) {
    const f = flush(mesh, sel), out = clone(mesh);
    let keep = null;
    if (what === 'verts') out.f = out.f.filter((face) => !face.v.some((v) => f.verts.has(v)));
    else if (what === 'edges') out.f = out.f.filter((face) => !faceEdgeKeys(face).some((k) => f.edges.has(k)));
    else {
      out.f = out.f.filter((_, i) => !f.faces.has(i));
      if (what === 'only-faces') keep = [...Array(vertexCount(mesh)).keys()];
    }
    return compact(out, keep).mesh;
  }

  /** Faces joined into one where they meet (their shared edges taken away): null if their border is not one loop. */
  function mergeFaceGroup(mesh, group) {
    const set = new Set(group), next = new Map(), dirEdges = new Set();
    for (const i of set) { const f = mesh.f[i]; f.v.forEach((a, k) => dirEdges.add(`${a}>${f.v[(k + 1) % f.v.length]}`)); }
    for (const de of dirEdges) {
      const [a, b] = de.split('>');
      if (dirEdges.has(`${b}>${a}`)) continue; // inside: both ways
      if (next.has(a)) return null; // a vertex the border passes twice
      next.set(a, b);
    }
    if (!next.size) return null;
    const start = next.keys().next().value, loop = [];
    let at = start, guard = 0;
    do { loop.push(Number(at)); at = next.get(at); } while (at !== undefined && at !== start && guard++ < 100000);
    if (at !== start || loop.length !== next.size) return null; // more than one loop
    const first = mesh.f[group[0]];
    const uvOf = (v) => { for (const i of set) { const f = mesh.f[i], k = f.v.indexOf(v); if (k >= 0 && f.uv) return [f.uv[k * 2], f.uv[k * 2 + 1]]; } return null; };
    const uvs = loop.map(uvOf);
    return { v: loop, uv: uvs.every(Boolean) ? uvs.flat() : null, m: first.m || 0, s: !!first.s };
  }
  /** Groups of faces joined through the given edge keys (or, with none, through any edge they share). */
  function faceGroups(mesh, faces, through) {
    const parent = new Map(); faces.forEach((i) => parent.set(i, i));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const [k, fs] of edgeFaces(mesh)) {
      if (through && !through.has(k)) continue;
      const inSel = fs.filter((i) => parent.has(i));
      for (let j = 1; j < inSel.length; j++) parent.set(find(inSel[j]), find(inSel[0]));
    }
    const groups = new Map();
    faces.forEach((i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
    return [...groups.values()];
  }
  function replaceGroups(mesh, groups) {
    const out = clone(mesh), drop = new Set();
    let merged = 0;
    for (const g of groups) {
      if (g.length < 2) continue;
      const face = mergeFaceGroup(mesh, g);
      if (!face) continue;
      out.f[g[0]] = face; g.slice(1).forEach((i) => drop.add(i)); merged++;
    }
    out.f = out.f.filter((_, i) => !drop.has(i));
    return { mesh: out, merged };
  }
  /** Vertices that join only two edges (in a straight-through run) taken out of the faces round them. */
  function dropTwoEdgeVerts(mesh, verts) {
    const out = clone(mesh), es = edges(out), deg = new Map();
    es.forEach((e) => { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); });
    for (const v of verts) {
      if (deg.get(v) !== 2) continue;
      out.f = out.f.map((f) => {
        const k = f.v.indexOf(v);
        if (k < 0 || f.v.length <= 3) return f;
        return { ...f, v: f.v.filter((_, j) => j !== k), uv: f.uv ? f.uv.filter((_, j) => (j >> 1) !== k) : null };
      });
    }
    return out;
  }
  /**
   * Dissolve (as Blender's Ctrl+X / Delete › Dissolve): faces into one n-gon where they are joined; edges by joining the
   * two faces either side; vertices by joining the faces round each (a vertex in a straight run just leaves its faces).
   */
  function dissolve(mesh, sel) {
    const f = flush(mesh, sel);
    let out;
    if (sel.mode === 'face') out = replaceGroups(mesh, faceGroups(mesh, [...f.faces])).mesh;
    else if (sel.mode === 'edge') {
      const ef = edgeFaces(mesh), faces = new Set();
      f.edges.forEach((k) => { const fs = ef.get(k) || []; if (fs.length === 2) fs.forEach((i) => faces.add(i)); });
      out = replaceGroups(mesh, faceGroups(mesh, [...faces], f.edges)).mesh;
      const ends = new Set(); f.edges.forEach((k) => k.split('_').forEach((x) => ends.add(Number(x))));
      out = dropTwoEdgeVerts(compact(out, [...Array(vertexCount(out)).keys()]).mesh, ends);
    } else {
      out = mesh;
      for (const v of f.verts) {
        const round = out.f.map((face, i) => (face.v.includes(v) ? i : -1)).filter((i) => i >= 0);
        if (round.length >= 2) out = replaceGroups(out, [round]).mesh;
      }
      out = dropTwoEdgeVerts(out, f.verts);
    }
    return compact(cleanFaces(clone(out))).mesh;
  }

  /** Vertices welded into one at a point (as Blender's M › At Center): faces that fold away are removed. */
  function mergeVerts(mesh, verts, point) {
    const list = [...verts];
    if (list.length < 2) return { mesh, vert: list[0] ?? -1 };
    const out = clone(mesh), keep = list[0], set = new Set(list);
    out.v[keep * 3] = point[0]; out.v[keep * 3 + 1] = point[1]; out.v[keep * 3 + 2] = point[2];
    out.f = out.f.map((f) => ({ ...f, v: f.v.map((v) => (set.has(v) ? keep : v)) }));
    cleanFaces(out);
    const { mesh: m2, map } = compact(out, [keep]);
    return { mesh: m2, vert: map[keep] };
  }
  /** Vertices closer than a distance welded (as Blender's Merge by Distance), among the given ones or all; returns { mesh, removed }. */
  function mergeByDistance(mesh, distance = 0.0001, only) {
    const n = vertexCount(mesh), rep = new Int32Array(n).map((_, i) => i), cell = Math.max(distance, 1e-9), grid = new Map();
    const pick = only ? [...only] : [...Array(n).keys()];
    const key = (p) => p.map((x) => Math.floor(x / cell)).join(',');
    for (const i of pick) {
      const p = vert(mesh, i), [cx, cy, cz] = p.map((x) => Math.floor(x / cell));
      let found = -1;
      for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
        for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) if (len(sub(vert(mesh, j), p)) <= distance) { found = j; break; }
      }
      if (found >= 0) rep[i] = found;
      else { const k = key(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
    }
    const out = clone(mesh);
    out.f = out.f.map((f) => ({ ...f, v: f.v.map((v) => rep[v]) }));
    cleanFaces(out);
    const removed = [...rep].filter((r, i) => r !== i).length;
    return { mesh: compact(out).mesh, removed };
  }

  /**
   * Make a face from vertices (as Blender's F): a border loop is filled; otherwise the vertices in their order round
   * their middle. It turns to match the faces beside it. Returns { mesh, face } (face −1 when it can't be made).
   */
  function makeFace(mesh, verts) {
    const list = [...new Set(verts)];
    if (list.length < 3) return { mesh, face: -1 };
    const set = new Set(list), ef = edgeFaces(mesh);
    // A border loop through exactly these vertices: walk its open edges against their faces' direction.
    const nextOf = new Map();
    for (const f of mesh.f) f.v.forEach((a, k) => { const b = f.v[(k + 1) % f.v.length]; if ((ef.get(edgeKey(a, b)) || []).length === 1 && set.has(a) && set.has(b)) nextOf.set(b, a); });
    let loop = null;
    if (nextOf.size === list.length) {
      const l = [list[0]]; let at = nextOf.get(list[0]);
      while (at !== undefined && at !== list[0] && l.length <= list.length) { l.push(at); at = nextOf.get(at); }
      if (at === list[0] && l.length === list.length) loop = l;
    }
    if (!loop) {
      const P = list.map((v) => vert(mesh, v)), C = scale(P.reduce(add, [0, 0, 0]), 1 / P.length);
      let N = [0, 0, 0];
      for (let k = 0; k < P.length; k++) N = add(N, cross(sub(P[k], C), sub(P[(k + 1) % P.length], C)));
      if (len(N) < 1e-12) N = cross(sub(P[1], P[0]), sub(P[2], P[0]));
      N = norm(N);
      const u = norm(Math.abs(N[0]) < 0.9 ? cross([1, 0, 0], N) : cross([0, 1, 0], N)), w = cross(N, u);
      loop = list.map((v, k) => [v, Math.atan2(dot(sub(P[k], C), w), dot(sub(P[k], C), u))]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
      // Turned to match a neighbour across a shared edge (which must run the other way).
      for (let k = 0; k < loop.length; k++) {
        const a = loop[k], b = loop[(k + 1) % loop.length], fs = ef.get(edgeKey(a, b)) || [];
        if (fs.length) { const f = mesh.f[fs[0]], j = f.v.indexOf(a); if (f.v[(j + 1) % f.v.length] === b) loop.reverse(); break; }
      }
    }
    const out = clone(mesh);
    out.f.push({ v: loop, uv: null, m: 0, s: false });
    return { mesh: out, face: out.f.length - 1 };
  }

  /** Faces turned over (as Blender's Flip). */
  function flipFaces(mesh, faceSet) { const out = clone(mesh); faceSet.forEach((i) => { if (out.f[i]) flipFace(out.f[i]); }); return out; }
  /**
   * Faces turned to agree with their neighbours and to point outwards (as Blender's Recalculate Outside), for each
   * connected part holding a given face (or every part).
   */
  function recalcOutside(mesh, faceSet) {
    const out = clone(mesh), ef = edgeFaces(out), seen = new Int8Array(out.f.length);
    const runs = (f, a, b) => { const k = f.v.indexOf(a); return k >= 0 && f.v[(k + 1) % f.v.length] === b; };
    for (let s = 0; s < out.f.length; s++) {
      if (seen[s]) continue;
      const part = [s], queue = [s]; seen[s] = 1;
      while (queue.length) {
        const i = queue.shift(), f = out.f[i];
        f.v.forEach((a, k) => {
          const b = f.v[(k + 1) % f.v.length], fs = ef.get(edgeKey(a, b)) || [];
          if (fs.length !== 2) return;
          const j = fs[0] === i ? fs[1] : fs[0];
          if (seen[j]) return;
          if (runs(out.f[j], a, b)) flipFace(out.f[j]); // the same way: turn it
          seen[j] = 1; part.push(j); queue.push(j);
        });
      }
      if (faceSet && faceSet.size && !part.some((i) => faceSet.has(i))) continue;
      // Outwards: the part's volume is positive (taken about its own middle, so where it is doesn't matter).
      const cs = part.map((i) => faceCentre(out, out.f[i])), mid = scale(cs.reduce(add, [0, 0, 0]), 1 / cs.length);
      let vol = 0;
      for (const i of part) for (const t of triangulateFace(out, out.f[i])) {
        const f = out.f[i], [a, b, c] = t.map((k) => sub(vert(out, f.v[k]), mid));
        vol += dot(a, cross(b, c));
      }
      if (vol < 0) part.forEach((i) => flipFace(out.f[i]));
    }
    return out;
  }
  /** Faces shaded smooth or flat (as Blender's Shade Smooth / Shade Flat). */
  function setSmooth(mesh, faceSet, smooth) { const out = clone(mesh); (faceSet ? [...faceSet] : out.f.map((_, i) => i)).forEach((i) => { if (out.f[i]) out.f[i].s = !!smooth; }); return out; }

  /** Faces copied with vertices of their own (as Blender's Shift+D in Edit Mode); returns { mesh, faces, verts } of the copy. */
  function duplicateFaces(mesh, faceSet) {
    const out = clone(mesh), dup = new Map(), faces = [];
    const copy = (v) => { if (!dup.has(v)) { dup.set(v, vertexCount(out)); out.v.push(...vert(mesh, v)); } return dup.get(v); };
    for (const i of [...faceSet].filter((x) => mesh.f[x])) { const f = mesh.f[i]; out.f.push({ ...f, v: f.v.map(copy), uv: f.uv ? f.uv.slice() : null }); faces.push(out.f.length - 1); }
    return { mesh: out, faces, verts: [...dup.values()] };
  }

  // ---------------------------------------------------------------- selecting
  function adjacency(mesh) {
    const adj = new Map();
    for (const e of edges(mesh)) { if (!adj.has(e.a)) adj.set(e.a, new Set()); if (!adj.has(e.b)) adj.set(e.b, new Set()); adj.get(e.a).add(e.b); adj.get(e.b).add(e.a); }
    return adj;
  }
  /** Every vertex joined to these by edges (as Blender's Select Linked). */
  function linkedVerts(mesh, seeds) {
    const adj = adjacency(mesh), seen = new Set(seeds), queue = [...seeds];
    while (queue.length) { const v = queue.pop(); for (const w of adj.get(v) || []) if (!seen.has(w)) { seen.add(w); queue.push(w); } }
    return seen;
  }
  /**
   * One ring more of the selection (as Ctrl+Numpad +, stepping across faces as Blender's Select More does): every vertex of
   * a face touching it. One less (Ctrl+Numpad −): the vertices whose faces are all inside it.
   */
  function growVerts(mesh, verts) { const out = new Set(verts); for (const f of mesh.f) if (f.v.some((v) => verts.has(v))) f.v.forEach((v) => out.add(v)); return out; }
  function shrinkVerts(mesh, verts) {
    const out = new Set(verts);
    for (const f of mesh.f) if (!f.v.every((v) => verts.has(v))) f.v.forEach((v) => out.delete(v));
    // The mesh's open border is an edge of the selection too (as in Blender: a whole grid loses its border).
    for (const [k, fs] of edgeFaces(mesh)) if (fs.length === 1) k.split('_').forEach((v) => out.delete(Number(v)));
    return out;
  }

  /**
   * The edge loop through an edge (as Blender's Alt+click): on through each vertex where four edges meet, by the edge
   * that shares no face with the last one; along the border for a border edge. Returns edge keys.
   */
  function edgeLoop(mesh, a, b) {
    const ef = edgeFaces(mesh), adj = adjacency(mesh), loop = new Set([edgeKey(a, b)]);
    const border = (ef.get(edgeKey(a, b)) || []).length === 1;
    const step = (from, at) => {
      let prev = from, cur = at;
      for (let guard = 0; guard < 100000; guard++) {
        const faces = new Set(ef.get(edgeKey(prev, cur)) || []);
        const around = [...(adj.get(cur) || [])].filter((w) => w !== prev);
        let next;
        if (border) next = around.filter((w) => (ef.get(edgeKey(cur, w)) || []).length === 1);
        else {
          if (around.length !== 3) return; // only through vertices where four edges meet
          next = around.filter((w) => !(ef.get(edgeKey(cur, w)) || []).some((f) => faces.has(f)));
        }
        if (next.length !== 1) return;
        const k = edgeKey(cur, next[0]);
        if (loop.has(k)) return;
        loop.add(k); prev = cur; cur = next[0];
      }
    };
    step(a, b); step(b, a);
    return loop;
  }
  /** The loop of faces across an edge (as Blender's Alt+click in face mode): on through quads by their opposite edges. */
  function faceLoop(mesh, a, b) {
    const ef = edgeFaces(mesh), out = new Set();
    for (const start of ef.get(edgeKey(a, b)) || []) {
      let face = start, edge = edgeKey(a, b);
      for (let guard = 0; guard < 100000; guard++) {
        const f = mesh.f[face];
        if (out.has(face) && face !== start) break;
        out.add(face);
        if (f.v.length !== 4) break;
        const keys = faceEdgeKeys(f), k = keys.indexOf(edge), opposite = keys[(k + 2) % 4];
        const next = (ef.get(opposite) || []).find((x) => x !== face);
        if (next === undefined || out.has(next)) break;
        face = next; edge = opposite;
      }
    }
    return out;
  }

  const api = {
    empty, clone, vertexCount, edgeKey, faceNormal, faceCentre, edges, check, volume, triangulateFace, triangles, buffers, bounds,
    identity, multiply, rotation, compose, decompose, rotationAbout, transformPoint, normalMatrix, applyMatrix, flipFace,
    cube, plane, grid, uvSphere, icoSphere, cylinder, cone, torus, PRIMITIVES, rayHit,
    emptySelection, cloneSelection, flush, convertSelection, selectionFromVerts, selectionFromFaces, faceEdgeKeys, edgeFaces, cleanFaces, compact, remapSet,
    transformVerts, extrudeFaces, extrudeEdges, insetFaces, insetRegion, loopRing, loopCut, edgeChains, bridgeLoops, deleteElements, mergeFaceGroup, dissolve, mergeVerts, mergeByDistance, makeFace,
    flipFaces, recalcOutside, setSmooth, duplicateFaces, linkedVerts, growVerts, shrinkVerts, edgeLoop, faceLoop,
    vec: { sub, add, scale, dot, cross, len, norm },
  };
  (typeof window !== 'undefined' ? window : globalThis).NoorMeshKernel = api;
})();

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).NoorMeshKernel;
