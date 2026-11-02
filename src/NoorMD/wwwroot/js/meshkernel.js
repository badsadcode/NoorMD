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

  const api = {
    empty, clone, vertexCount, edgeKey, faceNormal, faceCentre, edges, check, volume, triangulateFace, triangles, buffers, bounds,
    identity, multiply, rotation, compose, decompose, rotationAbout, transformPoint, normalMatrix, applyMatrix, flipFace,
    cube, plane, grid, uvSphere, icoSphere, cylinder, cone, torus, PRIMITIVES, rayHit,
    vec: { sub, add, scale, dot, cross, len, norm },
  };
  (typeof window !== 'undefined' ? window : globalThis).NoorMeshKernel = api;
})();

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).NoorMeshKernel;
