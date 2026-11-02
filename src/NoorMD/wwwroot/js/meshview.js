/* NoorMesh's viewport (WebGL 2), Z up as in Blender: objects lit as NoorForge's look-dev view lights them (a key light from above and
   left of where you look from, a fill, a sky and floor), a floor grid with the X and Z axes, outlines of the selection,
   edges as lines, guides (a transform's axis), orthographic front / side / top views and perspective, and rays for
   picking. It draws what it is given (meshes already in world space, from NoorMeshKernel.buffers); the bench owns the
   scene. Navigation as Blender's: middle-drag turns, Shift+middle-drag moves, Ctrl+middle-drag or the wheel zooms;
   Alt+left-drag turns too (for a touchpad). */
(() => {
  'use strict';

  const VS = `#version 300 es
    in vec3 aPos; in vec3 aNorm; uniform mat4 uModel, uView, uProj; uniform mat3 uNormalMat;
    out vec3 vPos; out vec3 vNorm;
    void main() { vec4 w = uModel * vec4(aPos, 1.0); vPos = w.xyz; vNorm = uNormalMat * aNorm; gl_Position = uProj * uView * w; }`;
  const FS = `#version 300 es
    precision highp float;
    in vec3 vPos; in vec3 vNorm;
    uniform vec3 uEye, uKey, uFill, uBase; uniform float uRough, uMetal; uniform int uOrtho; uniform vec3 uViewDir;
    out vec4 outColor;
    void main() {
      vec3 N = normalize(vNorm);
      vec3 V = uOrtho == 1 ? -uViewDir : normalize(uEye - vPos);
      if (!gl_FrontFacing) N = -N;
      vec3 albedo = pow(uBase, vec3(2.2));
      float rough = uRough, metal = uMetal;
      vec3 F0 = mix(vec3(0.04), albedo, metal), diff = albedo * (1.0 - metal);
      float nv = max(dot(N, V), 1e-3);
      vec3 F = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - nv, 5.0);
      vec3 L = normalize(uKey), L2 = normalize(uFill), H = normalize(V + L), H2 = normalize(V + L2);
      float nl = max(dot(N, L), 0.0), nl2 = max(dot(N, L2), 0.0);
      float a2 = max(rough * rough, 0.002); a2 *= a2;
      float d1 = dot(N, H) * dot(N, H) * (a2 - 1.0) + 1.0, d2 = dot(N, H2) * dot(N, H2) * (a2 - 1.0) + 1.0;
      float k = (rough + 1.0) * (rough + 1.0) / 8.0, g = nv / (nv * (1.0 - k) + k);
      vec3 s1 = F * (a2 / (3.14159 * d1 * d1)) * g / (4.0 * nv + 1e-3), s2 = F * (a2 / (3.14159 * d2 * d2)) * g / (4.0 * nv + 1e-3);
      vec3 R = reflect(-V, N);
      float up = R.z * 0.5 + 0.5, blur = mix(0.08, 0.9, rough);
      vec3 env = mix(vec3(0.34, 0.32, 0.30), vec3(0.85, 0.9, 0.98), smoothstep(0.5 - blur * 0.5, 0.5 + blur * 0.5, up));
      vec3 amb = mix(vec3(0.12, 0.12, 0.12), vec3(0.26, 0.28, 0.32), N.z * 0.5 + 0.5);
      vec3 col = diff * (amb + vec3(1.0, 0.96, 0.9) * nl * 2.0 + vec3(0.55, 0.62, 0.75) * nl2 * 0.45) + s1 * nl * 2.0 + s2 * nl2 * 0.45 + env * F;
      col *= 0.85;
      col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
      outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
    }`;
  const LINE_VS = `#version 300 es
    in vec3 aPos; uniform mat4 uModel, uView, uProj; uniform float uLift, uOrthoDist;
    // Lifted towards the camera by a share of its distance (the same on the screen): drawn over the surface it lies on,
    // and still hidden behind surfaces in front of it, near or far.
    void main() { vec4 v = uView * uModel * vec4(aPos, 1.0); if (uOrthoDist > 0.0) v.z += uLift * uOrthoDist; else v.xyz *= 1.0 - uLift; gl_Position = uProj * v; }`;
  const LINE_FS = `#version 300 es
    precision highp float; uniform vec4 uColor; out vec4 outColor; void main() { outColor = uColor; }`;
  // Edit Mode's overlay: vertices (round dots), edges and selected faces, each with its own colour.
  const OVER_VS = `#version 300 es
    in vec3 aPos; in vec4 aCol; uniform mat4 uModel, uView, uProj; uniform float uLift, uOrthoDist, uPointSize; out vec4 vCol;
    void main() { vCol = aCol; vec4 v = uView * uModel * vec4(aPos, 1.0); if (uOrthoDist > 0.0) v.z += uLift * uOrthoDist; else v.xyz *= 1.0 - uLift; gl_Position = uProj * v; gl_PointSize = uPointSize; }`;
  const OVER_FS = `#version 300 es
    precision highp float; in vec4 vCol; uniform int uRound; out vec4 outColor;
    void main() { if (uRound == 1 && length(gl_PointCoord - 0.5) > 0.5) discard; outColor = vCol; }`;
  const GRID_VS = `#version 300 es
    precision highp float; precision highp int;
    in vec2 aPos; uniform mat4 uView, uProj; uniform float uSize; uniform int uPlane; out vec2 vP;
    void main() {
      vP = aPos * uSize;
      vec3 p = uPlane == 0 ? vec3(vP.x, vP.y, 0.0) : uPlane == 1 ? vec3(vP.x, 0.0, vP.y) : vec3(0.0, vP.x, vP.y);
      gl_Position = uProj * uView * vec4(p, 1.0);
    }`;
  const GRID_FS = `#version 300 es
    precision highp float; precision highp int; in vec2 vP; uniform float uSize, uStep; uniform int uPlane; out vec4 outColor;
    float lines(vec2 p, float step) { vec2 g = abs(fract(p / step - 0.5) - 0.5) / fwidth(p / step); return 1.0 - min(min(g.x, g.y), 1.0); }
    void main() {
      float fine = lines(vP, uStep), coarse = lines(vP, uStep * 10.0);
      float fade = 1.0 - smoothstep(uSize * 0.45, uSize, length(vP));
      // The axes, as Blender colours them: X red, Y green, Z blue. ax: the line along the plane's first axis, az: along its second.
      float ax = 1.0 - min(abs(vP.y) / fwidth(vP.y), 1.0), az = 1.0 - min(abs(vP.x) / fwidth(vP.x), 1.0);
      vec3 c = vec3(0.42, 0.44, 0.46);
      float a = max(fine * 0.28, coarse * 0.55);
      vec3 red = vec3(0.95, 0.32, 0.32), green = vec3(0.45, 0.8, 0.3), blue = vec3(0.3, 0.55, 0.95);
      vec3 first = uPlane == 2 ? green : red, second = uPlane == 0 ? green : blue;
      c = mix(c, first, ax); c = mix(c, second, az);
      a = max(a, max(ax, az) * 0.9);
      outColor = vec4(c, a * fade);
    }`;

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function lookAt(eye, target, up) {
    const z = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    let x = cross(up, z);
    if (Math.hypot(x[0], x[1], x[2]) < 1e-6) x = cross([0, 1, 0], z);
    x = norm(x);
    const y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }
  const perspective = (fov, aspect, near, far) => { const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far); return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; };
  const ortho = (h, aspect, near, far) => { const w = h * aspect; return [1 / w, 0, 0, 0, 0, 1 / h, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]; };
  const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  function invert(m) {
    const inv = new Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12] || 1;
    return inv.map((x) => x / det);
  }

  function create(canvas, hooks = {}) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL 2 is not available');
    function program(vs, fs) {
      const make = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, make(gl.VERTEX_SHADER, vs)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = new Proxy({}, { get: (c, n) => (n in c ? c[n] : (c[n] = gl.getUniformLocation(p, n))) });
      return { p, u, a: (n) => gl.getAttribLocation(p, n) };
    }
    const main = program(VS, FS), lineProg = program(LINE_VS, LINE_FS), grid = program(GRID_VS, GRID_FS), over = program(OVER_VS, OVER_FS);
    let edit = null; // { matrix, parts: [{ vao, buffers, count, mode }] }
    const gridVao = gl.createVertexArray();
    gl.bindVertexArray(gridVao);
    const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(grid.a('aPos')); gl.vertexAttribPointer(grid.a('aPos'), 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // The camera: turned round a target (yaw about Z, 0 looking from −Y as Blender's front view; pitch up), at a distance.
    let cam = { target: [0, 0, 0], yaw: 0.8, pitch: 0.45, dist: 9, ortho: false };
    let objects = new Map(); // id → { vao, count, lineVao, lineCount, base, rough, metal, selected, active, hidden, buffers }
    let guides = [];
    let showEdges = false, showGrid = true;
    let dirty = true, raf = 0;

    function upload(attrib, data, size, prog) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      const loc = prog.a(attrib);
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); }
      return b;
    }
    function drop(o) {
      if (!o) return;
      o.glBuffers.forEach((b) => gl.deleteBuffer(b));
      gl.deleteVertexArray(o.vao); gl.deleteVertexArray(o.lineVao);
    }

    const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    /**
     * Edit Mode's overlay for one object (null: none): { matrix, points, pointColors, lines, lineColors, tris, triColors }
     * (positions in the object's own space, colours RGBA per vertex).
     */
    function setEdit(data) {
      if (edit) edit.parts.forEach((p) => { p.buffers.forEach((b) => gl.deleteBuffer(b)); gl.deleteVertexArray(p.vao); });
      edit = null;
      if (data) {
        const part = (pos, col, mode) => {
          if (!pos || !pos.length) return null;
          const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
          const buffers = [upload('aPos', pos, 3, over), upload('aCol', col, 4, over)];
          gl.bindVertexArray(null);
          return { vao, buffers, count: pos.length / 3, mode };
        };
        edit = { id: data.id, matrix: data.matrix || IDENTITY, parts: [part(data.tris, data.triColors, 'tris'), part(data.lines, data.lineColors, 'lines'), part(data.points, data.pointColors, 'points')].filter(Boolean) };
      }
      redraw();
    }

    /** One object to draw (or replaced): its own buffers (NoorMeshKernel.buffers), its matrix and how it looks. */
    function setObject(id, buf, look = {}) {
      drop(objects.get(id));
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const b1 = upload('aPos', buf.positions, 3, main), b2 = upload('aNorm', buf.normals, 3, main);
      const lineVao = gl.createVertexArray();
      gl.bindVertexArray(lineVao);
      const b3 = upload('aPos', buf.lines, 3, lineProg);
      gl.bindVertexArray(null);
      objects.set(id, { vao, count: buf.triangles * 3, lineVao, lineCount: buf.lines.length / 3, glBuffers: [b1, b2, b3], buffers: buf, base: [0.72, 0.72, 0.74], rough: 0.55, metal: 0, matrix: IDENTITY, ...look });
      redraw();
    }
    function setLook(id, look) { const o = objects.get(id); if (o) { Object.assign(o, look); redraw(); } }
    function removeObject(id) { drop(objects.get(id)); objects.delete(id); redraw(); }
    function clear() { for (const o of objects.values()) drop(o); objects.clear(); redraw(); }

    function size() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return { w, h, cssW: r.width || 1, cssH: r.height || 1, left: r.left, top: r.top };
    }
    const eyeOf = () => {
      const { target: t, yaw, pitch, dist } = cam;
      return [t[0] + Math.sin(yaw) * Math.cos(pitch) * dist, t[1] - Math.cos(yaw) * Math.cos(pitch) * dist, t[2] + Math.sin(pitch) * dist];
    };
    const FOV = 0.69; // about Blender's 50 mm lens
    function matrices() {
      const s = size(), aspect = s.w / s.h, eye = eyeOf();
      // Straight down (or up), "up" on the screen is away from where the camera came from (top view: +Y up).
      const up = Math.abs(Math.cos(cam.pitch)) < 1e-4 ? [-Math.sin(cam.yaw) * Math.sign(cam.pitch), Math.cos(cam.yaw) * Math.sign(cam.pitch), 0] : [0, 0, 1];
      const view = lookAt(eye, cam.target, up);
      const far = cam.dist * 50 + 100, near = cam.ortho ? -far : Math.max(0.005, cam.dist / 1000);
      const proj = cam.ortho ? ortho(cam.dist * Math.tan(FOV / 2), aspect, near, far) : perspective(FOV, aspect, near, far);
      return { view, proj, eye, viewProj: mul(proj, view), size: s };
    }

    function draw() {
      const { view, proj, eye, size: s } = matrices();
      gl.viewport(0, 0, s.w, s.h);
      gl.clearColor(0.13, 0.135, 0.15, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      const f = norm([cam.target[0] - eye[0], cam.target[1] - eye[1], cam.target[2] - eye[2]]);
      let r = cross(f, [0, 0, 1]); if (Math.hypot(...r) < 1e-6) r = [Math.cos(cam.yaw), Math.sin(cam.yaw), 0]; r = norm(r);
      const u = cross(r, f);
      const at = (a, b, c) => norm([r[0] * a + u[0] * b - f[0] * c, r[1] * a + u[1] * b - f[1] * c, r[2] * a + u[2] * b - f[2] * c]);
      gl.useProgram(main.p);
      gl.uniformMatrix4fv(main.u.uView, false, view); gl.uniformMatrix4fv(main.u.uProj, false, proj);
      gl.uniform3fv(main.u.uEye, eye); gl.uniform3fv(main.u.uKey, at(-0.6, 0.7, 0.45)); gl.uniform3fv(main.u.uFill, at(0.8, -0.05, 0.35));
      gl.uniform1i(main.u.uOrtho, cam.ortho ? 1 : 0); gl.uniform3fv(main.u.uViewDir, f);
      gl.enable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      for (const o of objects.values()) {
        if (o.hidden) continue;
        gl.uniform3fv(main.u.uBase, o.base); gl.uniform1f(main.u.uRough, o.rough); gl.uniform1f(main.u.uMetal, o.metal);
        gl.uniformMatrix4fv(main.u.uModel, false, o.matrix); gl.uniformMatrix3fv(main.u.uNormalMat, false, window.NoorMeshKernel.normalMatrix(o.matrix));
        if (o.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
        gl.bindVertexArray(o.vao); gl.drawArrays(gl.TRIANGLES, 0, o.count);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.CULL_FACE);
      // The floor grid (the plane facing the view in an orthographic side view).
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      if (showGrid) {
        gl.useProgram(grid.p);
        gl.uniformMatrix4fv(grid.u.uView, false, view); gl.uniformMatrix4fv(grid.u.uProj, false, proj);
        // Looking level in an orthographic view, the grid stands behind the model: XZ from the front, YZ from the side.
        const plane = cam.ortho && Math.abs(f[2]) < 0.01 ? (Math.abs(f[1]) > Math.abs(f[0]) ? 1 : 2) : 0;
        const step = Math.pow(10, Math.floor(Math.log10(Math.max(0.01, cam.dist / 8))));
        gl.uniform1f(grid.u.uSize, Math.max(20, cam.dist * 6)); gl.uniform1f(grid.u.uStep, step); gl.uniform1i(grid.u.uPlane, plane);
        gl.depthMask(false);
        gl.bindVertexArray(gridVao); gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.depthMask(true);
      }
      // Edges and the selection's outline.
      gl.useProgram(lineProg.p);
      gl.uniformMatrix4fv(lineProg.u.uView, false, view); gl.uniformMatrix4fv(lineProg.u.uProj, false, proj);
      const orthoDist = cam.ortho ? cam.dist : 0;
      gl.uniform1f(lineProg.u.uOrthoDist, orthoDist);
      for (const [id, o] of objects) {
        if (o.hidden) continue;
        // The object being edited shows its own edges in the overlay (as Blender: no object outline in Edit Mode).
        if (edit && edit.id !== undefined && edit.id === id) continue;
        const sel = o.selected || o.active;
        if (!sel && !showEdges) continue;
        gl.uniform4fv(lineProg.u.uColor, o.active ? [1, 0.67, 0.25, 1] : o.selected ? [0.95, 0.45, 0.12, 0.95] : [0.05, 0.05, 0.06, 0.45]);
        gl.uniform1f(lineProg.u.uLift, 0.002);
        gl.uniformMatrix4fv(lineProg.u.uModel, false, o.matrix);
        gl.bindVertexArray(o.lineVao); gl.drawArrays(gl.LINES, 0, o.lineCount);
      }
      // Edit Mode's overlay: on the surface (lifted a little towards the camera), hidden behind it as in Blender.
      if (edit) {
        gl.useProgram(over.p);
        gl.uniformMatrix4fv(over.u.uView, false, view); gl.uniformMatrix4fv(over.u.uProj, false, proj);
        gl.uniformMatrix4fv(over.u.uModel, false, edit.matrix);
        gl.uniform1f(over.u.uOrthoDist, orthoDist);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (const p of edit.parts) {
          gl.uniform1i(over.u.uRound, p.mode === 'points' ? 1 : 0);
          gl.uniform1f(over.u.uPointSize, 6 * dpr);
          gl.uniform1f(over.u.uLift, p.mode === 'tris' ? 0.0006 : p.mode === 'lines' ? 0.0015 : 0.003);
          gl.bindVertexArray(p.vao);
          gl.drawArrays(p.mode === 'tris' ? gl.TRIANGLES : p.mode === 'lines' ? gl.LINES : gl.POINTS, 0, p.count);
        }
      }
      // Guides (a transform's axis), drawn through everything.
      if (guides.length) {
        gl.disable(gl.DEPTH_TEST);
        // Its own program again (Edit Mode's overlay may have been drawn just before with another).
        gl.useProgram(lineProg.p);
        gl.uniformMatrix4fv(lineProg.u.uView, false, view); gl.uniformMatrix4fv(lineProg.u.uProj, false, proj);
        // Each line cut to what the camera can see (in front of it, short of the far plane): a line that runs behind
        // the camera, or a kilometre past it, is otherwise lost by some renderers.
        const far = cam.dist * 50 + 100, nearCut = cam.ortho ? -far * 0.9 : Math.max(0.01, cam.dist / 200);
        const depth = (p) => dot([p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]], f);
        for (const g of guides) {
          let a = g.from.slice(), b2 = g.to.slice();
          const da = depth(a), db = depth(b2), lo = nearCut, hi = far * 0.9;
          if ((da < lo && db < lo) || (da > hi && db > hi)) continue;
          const at = (t) => [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t, a[2] + (b2[2] - a[2]) * t];
          let t0 = 0, t1 = 1;
          if (db !== da) {
            const tl = (lo - da) / (db - da), th = (hi - da) / (db - da);
            if (db > da) { t0 = Math.max(t0, tl); t1 = Math.min(t1, th); } else { t0 = Math.max(t0, th); t1 = Math.min(t1, tl); }
          }
          if (t1 <= t0) continue;
          [a, b2] = [at(t0), at(t1)];
          const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
          const b = upload('aPos', new Float32Array([...a, ...b2]), 3, lineProg);
          gl.uniform4fv(lineProg.u.uColor, g.color); gl.uniform1f(lineProg.u.uLift, 0); gl.uniformMatrix4fv(lineProg.u.uModel, false, IDENTITY);
          gl.drawArrays(gl.LINES, 0, 2);
          gl.deleteBuffer(b); gl.deleteVertexArray(vao);
        }
        gl.enable(gl.DEPTH_TEST);
      }
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      if (hooks.drawn) hooks.drawn();
    }

    function redraw() { dirty = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (dirty) { dirty = false; draw(); } }); }

    /** A ray from a point of the canvas (client coordinates): { origin, dir } in the world. */
    function ray(clientX, clientY) {
      const { viewProj, size: s } = matrices();
      const inv = invert(viewProj);
      const x = ((clientX - s.left) / s.cssW) * 2 - 1, y = 1 - ((clientY - s.top) / s.cssH) * 2;
      const un = (z) => { const p = [inv[0] * x + inv[4] * y + inv[8] * z + inv[12], inv[1] * x + inv[5] * y + inv[9] * z + inv[13], inv[2] * x + inv[6] * y + inv[10] * z + inv[14]]; const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15]; return [p[0] / w, p[1] / w, p[2] / w]; };
      const a = un(-1), b = un(1);
      return { origin: a, dir: norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) };
    }
    /** Where a world point shows on the canvas (client coordinates), and whether it is in front of the camera. */
    function project(p) {
      const { viewProj: m, size: s } = matrices();
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return { x: s.left + ((x / w + 1) / 2) * s.cssW, y: s.top + ((1 - y / w) / 2) * s.cssH, front: w > 0 };
    }
    /** The nearest object a ray from the canvas meets (or only that one): { id, face, t, point } or null. */
    function pick(clientX, clientY, onlyId) {
      const { origin, dir } = ray(clientX, clientY);
      let best = null;
      for (const [id, o] of objects) {
        if (onlyId !== undefined && id !== onlyId) continue;
        if (o.hidden || o.pickable === false) continue;
        // In the object's own space: an affine map keeps the ray's parameter, so t compares across objects.
        const inv = invert(o.matrix);
        const lo = [inv[0] * origin[0] + inv[4] * origin[1] + inv[8] * origin[2] + inv[12], inv[1] * origin[0] + inv[5] * origin[1] + inv[9] * origin[2] + inv[13], inv[2] * origin[0] + inv[6] * origin[1] + inv[10] * origin[2] + inv[14]];
        const ld = [inv[0] * dir[0] + inv[4] * dir[1] + inv[8] * dir[2], inv[1] * dir[0] + inv[5] * dir[1] + inv[9] * dir[2], inv[2] * dir[0] + inv[6] * dir[1] + inv[10] * dir[2]];
        const hit = window.NoorMeshKernel.rayHit(o.buffers, lo, ld);
        if (hit && (!best || hit.t < best.t)) best = { id, face: hit.face, t: hit.t, point: [origin[0] + dir[0] * hit.t, origin[1] + dir[1] * hit.t, origin[2] + dir[2] * hit.t] };
      }
      return best;
    }

    // ---- views
    function frame(min, max) {
      const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      const r = Math.max(0.05, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
      cam.target = c; cam.dist = r / Math.sin(FOV / 2) * 1.15; redraw();
    }
    /** Front (1), right (3), top (7); the opposite side with opposite; perspective or orthographic (5). */
    function viewFrom(which, opposite = false) {
      const s = opposite ? -1 : 1;
      if (which === 'front') { cam.yaw = opposite ? Math.PI : 0; cam.pitch = 0; }
      if (which === 'right') { cam.yaw = (Math.PI / 2) * s; cam.pitch = 0; }
      if (which === 'top') { cam.yaw = 0; cam.pitch = (Math.PI / 2) * s; }
      cam.ortho = true; redraw();
    }
    function setOrtho(on) { cam.ortho = on; redraw(); }

    // ---- navigation
    let nav = null;
    canvas.addEventListener('pointerdown', (e) => {
      // The bench may take a button the view would use (the middle one while a transform is under way: an axis).
      const orbit = (e.button === 1 || (e.button === 0 && e.altKey)) && !(hooks.takes && hooks.takes(e));
      if (!orbit) { if (e.button === 1) { e.preventDefault(); canvas.setPointerCapture(e.pointerId); } if (hooks.down) hooks.down(e); return; }
      e.preventDefault();
      nav = { x: e.clientX, y: e.clientY, pan: e.shiftKey, zoom: e.ctrlKey };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!nav) { if (hooks.move) hooks.move(e); return; }
      const dx = e.clientX - nav.x, dy = e.clientY - nav.y;
      nav.x = e.clientX; nav.y = e.clientY;
      if (nav.pan) {
        const s = (cam.dist * Math.tan(FOV / 2) * 2) / Math.max(1, canvas.getBoundingClientRect().height);
        const eye = eyeOf(), f = norm([cam.target[0] - eye[0], cam.target[1] - eye[1], cam.target[2] - eye[2]]);
        let r = cross(f, [0, 0, 1]); if (Math.hypot(...r) < 1e-6) r = [Math.cos(cam.yaw), Math.sin(cam.yaw), 0]; r = norm(r);
        const u = cross(r, f);
        cam.target = [cam.target[0] - (r[0] * dx - u[0] * dy) * s, cam.target[1] - (r[1] * dx - u[1] * dy) * s, cam.target[2] - (r[2] * dx - u[2] * dy) * s];
      } else if (nav.zoom) cam.dist = Math.max(0.02, cam.dist * Math.exp(dy * 0.01));
      else {
        // Turning leaves an orthographic side view for perspective (as Blender's auto perspective).
        if (cam.ortho && hooks.autoPerspective !== false) cam.ortho = false;
        cam.yaw -= dx * 0.008; cam.pitch = Math.max(-1.5707, Math.min(1.5707, cam.pitch + dy * 0.008));
      }
      redraw();
      if (hooks.viewChanged) hooks.viewChanged();
    });
    const endNav = (e) => { if (nav) { nav = null; return; } if (hooks.up) hooks.up(e); };
    canvas.addEventListener('pointerup', endNav);
    canvas.addEventListener('pointercancel', () => { nav = null; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(0.02, cam.dist * Math.exp(Math.sign(e.deltaY) * 0.12)); redraw(); if (hooks.viewChanged) hooks.viewChanged(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    const ro = new ResizeObserver(() => redraw()); ro.observe(canvas);

    return {
      setObject, setLook, removeObject, clear, redraw, ray, project, pick, frame, viewFrom, setOrtho, setEdit,
      setGuides(g) { guides = g || []; redraw(); },
      setEdges(on) { showEdges = !!on; redraw(); }, setGrid(on) { showGrid = !!on; redraw(); },
      camera: () => ({ ...cam, target: cam.target.slice(), eye: eyeOf() }),
      setCamera(c) { cam = { ...cam, ...c }; redraw(); },
      matrices,
      destroy() { ro.disconnect(); clear(); },
    };
  }

  window.NoorMeshView = { create };
})();
