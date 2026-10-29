// The Asset Bench's 3D preview: reads the GLB the app built (exactly what an export writes) and draws it with WebGL 2.
// Bark with its colour, normal and ORM maps, leaf cards cut out by alpha, clumps with their gradient; a sun and a sky;
// a ground grid in metres; the wind played from the wind data in the file; views that show the wireframe, the parts
// (separate branches in their own colours) and the wind data itself.
window.NoorAssetView = (() => {
  'use strict';

  // ---------------------------------------------------------------- GLB

  /** Parses a GLB into { nodes: [{ name, matrix, mesh }], meshes, materials, images (Blobs) }. */
  function parseGlb(buffer) {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
    const binStart = 20 + jsonLen + 8;
    const binLen = dv.getUint32(20 + jsonLen, true);
    const bin = buffer.slice(binStart, binStart + binLen);
    const viewBytes = (i) => { const v = json.bufferViews[i]; return new Uint8Array(bin, v.byteOffset || 0, v.byteLength); };
    const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    function accessor(i) {
      const a = json.accessors[i];
      const v = json.bufferViews[a.bufferView];
      const n = a.count * COMPONENTS[a.type];
      const off = (v.byteOffset || 0) + (a.byteOffset || 0);
      if (a.componentType === 5126) return new Float32Array(bin, off, n);
      if (a.componentType === 5125) return new Uint32Array(bin, off, n);
      if (a.componentType === 5123) return new Uint16Array(bin, off, n);
      throw new Error('Unsupported accessor type');
    }
    const meshes = (json.meshes || []).map((m) => ({
      name: m.name,
      primitives: m.primitives.map((p) => {
        const at = p.attributes;
        const get = (k) => (at[k] !== undefined ? accessor(at[k]) : null);
        return {
          position: get('POSITION'), normal: get('NORMAL'), tangent: get('TANGENT'), uv0: get('TEXCOORD_0'), uv1: get('TEXCOORD_1'), uv2: get('TEXCOORD_2'),
          color: get('COLOR_0'), indices: accessor(p.indices), material: p.material ?? -1,
        };
      }),
    }));
    const images = (json.images || []).map((im) => new Blob([viewBytes(im.bufferView)], { type: im.mimeType || 'image/png' }));
    const textures = (json.textures || []).map((t) => t.source);
    // Images drawn sharp: a texture's sampler magnifying NEAREST (9728), as small pixel-look textures ask.
    const samplers = json.samplers || [];
    const nearest = new Set((json.textures || []).filter((t) => (samplers[t.sampler ?? -1] || {}).magFilter === 9728).map((t) => t.source));
    const materials = (json.materials || []).map((m) => {
      const pbr = m.pbrMetallicRoughness || {};
      const tex = (t) => (t && t.index !== undefined ? textures[t.index] : -1);
      return {
        name: m.name || '', color: pbr.baseColorFactor || [1, 1, 1, 1], roughness: pbr.roughnessFactor ?? 1, metallic: pbr.metallicFactor ?? 1,
        colorImage: tex(pbr.baseColorTexture), ormImage: tex(pbr.metallicRoughnessTexture), normalImage: tex(m.normalTexture),
        mask: m.alphaMode === 'MASK', cutoff: m.alphaCutoff ?? 0.5, doubleSided: !!m.doubleSided, emissive: m.emissiveFactor || [0, 0, 0],
      };
    });
    // Node world matrices (translation and rotation only: that is all the Asset Bench writes).
    const nodes = [];
    function walk(i, parent) {
      const n = json.nodes[i];
      const local = compose(n.translation || [0, 0, 0], n.rotation || [0, 0, 0, 1]);
      const world = mul(parent, local);
      nodes.push({ name: n.name || '', matrix: world, mesh: n.mesh ?? -1, depth: nodes.length });
      (n.children || []).forEach((c) => walk(c, world));
    }
    const scene = (json.scenes || [])[json.scene || 0];
    (scene ? scene.nodes : []).forEach((i) => walk(i, ident()));
    return { nodes, meshes, materials, images, nearest };
  }

  // ---------------------------------------------------------------- matrices (column-major)

  const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function compose(t, q) {
    const [x, y, z, w] = q;
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
      t[0], t[1], t[2], 1];
  }
  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
  }

  // ---------------------------------------------------------------- shaders

  const VS = `#version 300 es
    in vec3 aPos; in vec3 aNorm; in vec4 aTan; in vec2 aUv; in vec2 aUv1; in vec2 aUv2; in vec4 aCol;
    uniform mat4 uModel, uView, uProj; uniform float uTime, uWind, uHeight; uniform int uWindFrom; uniform vec3 uWindDir;
    out vec3 vPos; out vec3 vNorm; out vec4 vTan; out vec2 vUv; out vec4 vWind; out vec4 vCol;
    void main() {
      // Wind data: x trunk sway, y branch bend, z leaf flutter, w phase (from the UVs or the vertex colour).
      vec4 wd = uWindFrom == 1 ? vec4(aUv2.y, aUv1.x, aUv1.y, aUv2.x) : uWindFrom == 2 ? aCol : vec4(0.0);
      vWind = wd; vCol = aCol;
      vec4 w = uModel * vec4(aPos, 1.0);
      vec3 n = normalize(mat3(uModel) * aNorm);
      if (uWind > 0.0) {
        float t = uTime, ph = wd.w * 6.2832;
        float gust = 0.65 + 0.35 * sin(t * 0.37) * sin(t * 0.23 + 1.3);
        vec3 dir = uWindDir;
        w.xyz += dir * wd.x * uHeight * 0.025 * uWind * gust * (1.0 + 0.35 * sin(t * 0.9));
        w.xyz += (dir * 0.8 + vec3(0.0, -0.25, 0.0)) * wd.y * 0.18 * uWind * gust * sin(t * 1.9 + ph);
        w.xyz += n * wd.z * 0.05 * uWind * sin(t * 9.0 + ph * 7.0 + dot(w.xyz, vec3(3.1, 1.7, 2.3)));
      }
      vPos = w.xyz; vNorm = n; vTan = vec4(mat3(uModel) * aTan.xyz, aTan.w); vUv = aUv;
      gl_Position = uProj * uView * w;
    }`;
  const FS = `#version 300 es
    precision highp float;
    in vec3 vPos; in vec3 vNorm; in vec4 vTan; in vec2 vUv; in vec4 vWind; in vec4 vCol;
    uniform sampler2D tColor, tNormal, tOrm, tPaint; uniform int uHasColor, uHasNormal, uHasOrm, uMask, uMode, uTint, uHasPaint;
    uniform vec4 uPaint, uBrush; uniform float uBrushHard;
    uniform vec4 uBase; uniform float uRough, uCutoff; uniform vec3 uEye, uSun, uPart, uEmissive;
    out vec4 outColor;
    vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
    // NoorForge painting: the stroke being painted (a coverage picture in UV space) over the result, and the brush's
    // ring where it touches the surface (its inner ring: where the hardness ends).
    vec3 painted(vec3 c) {
      if (uHasPaint == 1) c = mix(c, uPaint.rgb, texture(tPaint, vUv).r * uPaint.a);
      if (uBrush.w > 0.0) {
        float d = distance(vPos, uBrush.xyz), w = max(uBrush.w * 0.05, fwidth(d) * 1.5);
        float ring = 1.0 - smoothstep(0.0, w, abs(d - uBrush.w));
        float inner = uBrushHard < 0.98 ? (1.0 - smoothstep(0.0, w, abs(d - uBrush.w * uBrushHard))) * 0.45 : 0.0;
        c = mix(c, vec3(1.0, 0.95, 0.8), max(ring, inner) * 0.85);
      }
      return c;
    }
    void main() {
      // One channel (NoorForge): the picture as it is, no light.
      if (uMode == 4) { outColor = vec4(painted(uHasColor == 1 ? texture(tColor, vUv).rgb : vec3(0.0)), 1.0); return; }
      vec4 base = uBase;
      if (uHasColor == 1) {
        vec4 t = texture(tColor, vUv);
        // Cut-out leaves keep their coverage at a distance: the smaller mipmaps average the alpha away, so it is
        // raised by the mip level (otherwise far and low-detail trees look thin).
        if (uMask == 1) {
          vec2 px = vUv * vec2(textureSize(tColor, 0));
          float lod = max(0.0, 0.5 * log2(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px)))));
          t.a *= 1.0 + lod * 0.25;
        }
        base *= vec4(t.rgb, t.a);
      }
      if (uMask == 1 && base.a < uCutoff) discard;
      vec3 N = normalize(vNorm);
      if (!gl_FrontFacing) N = -N;
      if (uHasNormal == 1 && uMode == 0) {
        vec3 T = normalize(vTan.xyz - N * dot(N, vTan.xyz)), B = cross(N, T) * vTan.w;
        vec3 tn = texture(tNormal, vUv).xyz * 2.0 - 1.0;
        N = normalize(T * tn.x + B * tn.y + N * tn.z);
      }
      float rough = uRough, ao = 1.0;
      if (uHasOrm == 1) { vec3 o = texture(tOrm, vUv).rgb; ao = o.r; rough *= o.g; }
      vec3 albedo = base.rgb;
      // Painted shading in the vertex colours (when they don't carry the wind data), as engines multiply it.
      if (uTint == 1 && uMode != 3) albedo *= vCol.rgb;
      if (uMode == 1) albedo = vec3(0.62);
      if (uMode == 2) albedo = uPart;
      if (uMode == 3) { outColor = vec4(vWind.x, vWind.y, vWind.z, 1.0); return; }
      vec3 V = normalize(uEye - vPos), L = normalize(uSun), H = normalize(V + L);
      float nl = max(dot(N, L), 0.0);
      // Leaves let a little light through from behind.
      float back = uMask == 1 ? max(dot(-N, L), 0.0) * 0.35 : 0.0;
      vec3 sky = mix(vec3(0.28, 0.25, 0.2), vec3(0.62, 0.72, 0.85), N.y * 0.5 + 0.5);
      float spec = pow(max(dot(N, H), 0.0), mix(64.0, 4.0, rough)) * (1.0 - rough) * 0.5;
      vec3 col = albedo * (sky * 0.75 * ao + vec3(1.0, 0.95, 0.85) * (nl + back) * 1.35) + vec3(spec) * nl;
      if (uMode == 0) col += uEmissive * 1.4;          // glowing crystals and caps
      col = col / (col + vec3(0.9)) * 1.6;           // gentle tone mapping
      outColor = vec4(painted(pow(col, vec3(1.0 / 2.2))), 1.0);
    }`;
  const GRID_VS = `#version 300 es
    in vec2 aPos; uniform mat4 uView, uProj; uniform float uSize; out vec2 vXZ;
    void main() { vXZ = aPos * uSize; gl_Position = uProj * uView * vec4(vXZ.x, 0.0, vXZ.y, 1.0); }`;
  const GRID_FS = `#version 300 es
    precision highp float; in vec2 vXZ; uniform float uSize; out vec4 outColor;
    void main() {
      vec2 g = abs(fract(vXZ - 0.5) - 0.5) / fwidth(vXZ);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      float fade = 1.0 - smoothstep(uSize * 0.4, uSize, length(vXZ));
      float axis = (1.0 - min(abs(vXZ.x) / fwidth(vXZ.x), 1.0)) + (1.0 - min(abs(vXZ.y) / fwidth(vXZ.y), 1.0));
      vec3 c = mix(vec3(0.16, 0.17, 0.15), vec3(0.42, 0.45, 0.38), line * 0.7 + axis * 0.3);
      outColor = vec4(c, (0.55 + 0.45 * line) * fade);
    }`;
  const LINE_VS = `#version 300 es
    in vec3 aPos; uniform mat4 uModel, uView, uProj;
    void main() { gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); gl_Position.z -= 0.0004 * gl_Position.w; }`;
  const LINE_FS = `#version 300 es
    precision highp float; out vec4 outColor; void main() { outColor = vec4(0.05, 0.05, 0.06, 0.55); }`;

  const PART_COLORS = [[0.55, 0.4, 0.28], [0.85, 0.45, 0.35], [0.4, 0.65, 0.85], [0.9, 0.75, 0.3], [0.55, 0.8, 0.45], [0.75, 0.5, 0.85], [0.35, 0.8, 0.75], [0.95, 0.55, 0.7]];

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  /** The nearest triangle a ray meets (Möller–Trumbore, both sides): { point, normal (towards the ray's start), material }. */
  function rayCast(pick, o, d) {
    const t = pick.tris;
    let best = Infinity, bi = -1;
    for (let i = 0; i < pick.count; i++) {
      const b = i * 9;
      const e1x = t[b + 3] - t[b], e1y = t[b + 4] - t[b + 1], e1z = t[b + 5] - t[b + 2];
      const e2x = t[b + 6] - t[b], e2y = t[b + 7] - t[b + 1], e2z = t[b + 8] - t[b + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const inv = 1 / det;
      const sx = o[0] - t[b], sy = o[1] - t[b + 1], sz = o[2] - t[b + 2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (dist > 1e-6 && dist < best) { best = dist; bi = i; }
    }
    if (bi < 0) return null;
    const b = bi * 9;
    let n = norm(cross([t[b + 3] - t[b], t[b + 4] - t[b + 1], t[b + 5] - t[b + 2]], [t[b + 6] - t[b], t[b + 7] - t[b + 1], t[b + 8] - t[b + 2]]));
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0) n = [-n[0], -n[1], -n[2]];
    return { point: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best], normal: n, material: pick.mats[bi] };
  }

  /** A viewer on a canvas. Returns { load(buffer), setMode, setWind, setWireframe, reset, zoom, state, destroy }. */
  function create(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL 2 is not available');
    const program = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
      return { p, u, a: (n) => gl.getAttribLocation(p, n) };
    };
    const main = program(VS, FS), grid = program(GRID_VS, GRID_FS), lines = program(LINE_VS, LINE_FS);
    const gridBuf = gl.createBuffer();
    const gridVao = gl.createVertexArray();
    gl.bindVertexArray(gridVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(grid.a('aPos'));
    gl.vertexAttribPointer(grid.a('aPos'), 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    let scene = null;          // { draws: [...], textures: [...], bounds, windFrom }
    let mode = 0, wind = 0, wireframe = false;
    let channel = [];      // NoorForge: one channel's textures, per material
    let paint = [], paintColor = [1, 1, 1, 0]; // NoorForge: the stroke being painted (R8 coverage per material)
    let brush = [0, 0, 0, 0], brushHard = 1;
    let painter = null;    // NoorForge's brush: takes the left button while painting
    let pickTris = null;   // world-space triangles, made on the first pick
    let yaw = 0.6, pitch = 0.12, dist = 10, target = [0, 3, 0], height = 8;
    let raf = 0, start = performance.now(), dirty = true;
    const windDir = [0.8, 0, 0.6];

    function upload(target, data, size, attrib, prog) {
      if (!data) { gl.disableVertexAttribArray(prog.a(attrib)); return null; }
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = prog.a(attrib);
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); }
      return b;
    }

    async function load(buffer) {
      const glb = parseGlb(buffer);
      const bitmaps = await Promise.all(glb.images.map((b) => createImageBitmap(b, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(() => null)));
      dispose();
      const textures = bitmaps.map((bmp, i) => {
        if (!bmp) return null;
        // Colour maps are sRGB; normal and ORM maps are data.
        const srgb = glb.materials.some((m) => m.colorImage === i);
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        gl.generateMipmap(gl.TEXTURE_2D);
        const sharp = glb.nearest.has(i);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, sharp ? gl.NEAREST_MIPMAP_NEAREST : gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, sharp ? gl.NEAREST : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        return t;
      });
      const draws = [];
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      let windFrom = 0, part = 0;
      for (const node of glb.nodes) {
        // Collision pieces (Godot's "-convcolonly" nodes) are not drawn.
        if (node.mesh < 0 || /-convcolonly$/.test(node.name || '')) continue;
        const color = PART_COLORS[part++ % PART_COLORS.length];
        for (const prim of glb.meshes[node.mesh].primitives) {
          const vao = gl.createVertexArray();
          gl.bindVertexArray(vao);
          const buffers = [
            upload(gl.ARRAY_BUFFER, prim.position, 3, 'aPos', main), upload(gl.ARRAY_BUFFER, prim.normal, 3, 'aNorm', main),
            upload(gl.ARRAY_BUFFER, prim.tangent, 4, 'aTan', main), upload(gl.ARRAY_BUFFER, prim.uv0, 2, 'aUv', main),
            upload(gl.ARRAY_BUFFER, prim.uv1, 2, 'aUv1', main), upload(gl.ARRAY_BUFFER, prim.uv2, 2, 'aUv2', main),
            upload(gl.ARRAY_BUFFER, prim.color, 4, 'aCol', main),
          ];
          if (!prim.tangent) gl.vertexAttrib4f(main.a('aTan'), 1, 0, 0, 1);
          const ib = gl.createBuffer();
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, prim.indices, gl.STATIC_DRAW);
          gl.bindVertexArray(null);
          if (prim.uv1 && prim.uv2) windFrom = 1; else if (prim.color && windFrom === 0 && !prim.uv1) windFrom = 2;
          // Bounds in world space.
          const m = node.matrix, p = prim.position;
          for (let i = 0; i < p.length; i += 3) {
            const x = m[0] * p[i] + m[4] * p[i + 1] + m[8] * p[i + 2] + m[12], y = m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13], z = m[2] * p[i] + m[6] * p[i + 1] + m[10] * p[i + 2] + m[14];
            if (x < lo[0]) lo[0] = x; if (y < lo[1]) lo[1] = y; if (z < lo[2]) lo[2] = z;
            if (x > hi[0]) hi[0] = x; if (y > hi[1]) hi[1] = y; if (z > hi[2]) hi[2] = z;
          }
          draws.push({ vao, buffers: [...buffers.filter(Boolean), ib], ib, count: prim.indices.length, type: prim.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, indices: prim.indices, positions: prim.position, matrix: node.matrix, material: glb.materials[prim.material] || null, matIndex: prim.material, part: color, node: node.name, lines: null, hasColor: !!prim.color });
        }
      }
      // Framed again when the first thing comes, or something of quite another size (a rock after a tree).
      const sizeOf = (b) => Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]);
      const first = !scene || sizeOf({ lo, hi }) > sizeOf(scene.bounds) * 2.5 || sizeOf({ lo, hi }) < sizeOf(scene.bounds) / 2.5;
      scene = { draws, textures, bounds: { lo, hi }, windFrom, nodes: glb.nodes.filter((n) => n.mesh >= 0 && !/-convcolonly$/.test(n.name || '')).map((n) => n.name) };
      height = Math.max(0.5, hi[1] - lo[1]);
      if (first) frame();
      dirty = true;
      tick();
    }

    /** Every drawn triangle in world space (9 floats each), with its material, for picking. */
    function worldTriangles() {
      let n = 0;
      for (const d of scene.draws) n += d.indices.length / 3;
      const tris = new Float32Array(n * 9), mats = new Int32Array(n);
      let k = 0;
      for (const d of scene.draws) {
        const m = d.matrix, p = d.positions, idx = d.indices;
        for (let i = 0; i < idx.length; i++) {
          const v = idx[i] * 3, x = p[v], y = p[v + 1], z = p[v + 2];
          tris[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          tris[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          tris[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (i % 3 === 2) mats[(k - 2) / 3] = d.matIndex ?? 0;
          k++;
        }
      }
      return { tris, mats, count: n };
    }

    function frame() {
      if (!scene) return;
      const { lo, hi } = scene.bounds;
      target = [(lo[0] + hi[0]) / 2, lo[1] + (hi[1] - lo[1]) * 0.48, (lo[2] + hi[2]) / 2];
      const size = Math.max(hi[1] - lo[1], hi[0] - lo[0], hi[2] - lo[2]);
      dist = size * 1.75 + Math.min(0.5, size * 0.3);
      // Low things (rocks, shrubs) are looked at from a little higher.
      yaw = 0.6; pitch = hi[1] - lo[1] < size * 0.6 ? 0.38 : 0.12;
      dirty = true;
    }

    function dispose() {
      pickTris = null;
      if (!scene) return;
      for (const d of scene.draws) { gl.deleteVertexArray(d.vao); d.buffers.forEach((b) => gl.deleteBuffer(b)); if (d.lines) { gl.deleteVertexArray(d.lines.vao); gl.deleteBuffer(d.lines.vb); gl.deleteBuffer(d.lines.ib); } }
      scene.textures.forEach((t) => t && gl.deleteTexture(t));
    }

    /** Edges of a primitive, each once, for the wireframe. */
    function linesOf(d) {
      if (d.lines) return d.lines;
      const seen = new Set(), out = [];
      const idx = d.indices;
      for (let i = 0; i < idx.length; i += 3)
        for (let e = 0; e < 3; e++) {
          const a = idx[i + e], b = idx[i + (e + 1) % 3];
          const key = a < b ? a * 4194304 + b : b * 4194304 + a;
          if (!seen.has(key)) { seen.add(key); out.push(a, b); }
        }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, d.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(lines.a('aPos'));
      gl.vertexAttribPointer(lines.a('aPos'), 3, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(out), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      d.lines = { vao, vb, ib, count: out.length };
      return d.lines;
    }

    function draw() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr)); }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.11, 0.12, 0.14, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const eye = [target[0] + Math.sin(yaw) * Math.cos(pitch) * dist, target[1] + Math.sin(pitch) * dist, target[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
      const view = lookAt(eye, target, [0, 1, 0]);
      const proj = perspective(0.75, canvas.width / Math.max(1, canvas.height), Math.max(0.01, dist / 500), dist * 20 + 100);
      const time = (performance.now() - start) / 1000;
      gl.enable(gl.DEPTH_TEST);
      // Ground.
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(grid.p);
      gl.uniformMatrix4fv(grid.u.uView, false, view); gl.uniformMatrix4fv(grid.u.uProj, false, proj);
      gl.uniform1f(grid.u.uSize, Math.max(10, height * 2));
      gl.depthMask(false);
      gl.bindVertexArray(gridVao); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      if (!scene) return;
      gl.useProgram(main.p);
      gl.uniformMatrix4fv(main.u.uView, false, view); gl.uniformMatrix4fv(main.u.uProj, false, proj);
      gl.uniform3fv(main.u.uEye, eye); gl.uniform3fv(main.u.uSun, [0.45, 0.8, 0.4]);
      gl.uniform1f(main.u.uTime, time); gl.uniform1f(main.u.uWind, wind); gl.uniform1f(main.u.uHeight, height);
      gl.uniform1i(main.u.uWindFrom, scene.windFrom); gl.uniform3fv(main.u.uWindDir, windDir);
      gl.uniform1i(main.u.uMode, mode);
      gl.uniform1i(main.u.tColor, 0); gl.uniform1i(main.u.tNormal, 1); gl.uniform1i(main.u.tOrm, 2); gl.uniform1i(main.u.tPaint, 3);
      gl.uniform4fv(main.u.uPaint, paintColor); gl.uniform4fv(main.u.uBrush, brush); gl.uniform1f(main.u.uBrushHard, brushHard);
      for (const d of scene.draws) {
        const m = d.material;
        const tex = (unit, img, flag) => {
          const t = img >= 0 ? scene.textures[img] : null;
          gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.uniform1i(main.u[flag], t ? 1 : 0);
        };
        if (mode === 4) {
          // The channel's picture for this material (texture set), in place of its colour.
          const t = channel[d.matIndex ?? 0] || null;
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.uniform1i(main.u.uHasColor, t ? 1 : 0);
        } else tex(0, m ? m.colorImage : -1, 'uHasColor');
        {
          const t = paint[d.matIndex ?? 0] || null;
          gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.uniform1i(main.u.uHasPaint, t ? 1 : 0);
        }
        tex(1, m ? m.normalImage : -1, 'uHasNormal');
        tex(2, m ? m.ormImage : -1, 'uHasOrm');
        gl.uniform4fv(main.u.uBase, m ? m.color : [1, 1, 1, 1]);
        gl.uniform1f(main.u.uRough, m ? m.roughness : 0.9);
        gl.uniform1i(main.u.uMask, m && m.mask ? 1 : 0);
        gl.uniform1f(main.u.uCutoff, m ? m.cutoff : 0.5);
        gl.uniform3fv(main.u.uEmissive, m ? m.emissive : [0, 0, 0]);
        gl.uniform3fv(main.u.uPart, d.part);
        gl.uniform1i(main.u.uTint, d.hasColor && scene.windFrom !== 2 ? 1 : 0);
        gl.uniformMatrix4fv(main.u.uModel, false, d.matrix);
        if (m && m.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
        gl.bindVertexArray(d.vao);
        gl.drawElements(gl.TRIANGLES, d.count, d.type, 0);
      }
      gl.disable(gl.CULL_FACE);
      if (wireframe) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(lines.p);
        gl.uniformMatrix4fv(lines.u.uView, false, view); gl.uniformMatrix4fv(lines.u.uProj, false, proj);
        for (const d of scene.draws) {
          if (d.material && d.material.mask) continue;   // card outlines only clutter the view
          const l = linesOf(d);
          gl.uniformMatrix4fv(lines.u.uModel, false, d.matrix);
          gl.bindVertexArray(l.vao);
          gl.drawElements(gl.LINES, l.count, gl.UNSIGNED_INT, 0);
        }
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
    }

    function tick() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (dirty || wind > 0) { draw(); dirty = false; }
        if (wind > 0) tick();
      });
    }

    // Orbit: drag to turn, wheel to zoom, right-drag or Shift+drag to move.
    let drag = null;
    // A painter (NoorForge's brush) takes the left button when it wants it; Alt+drag still turns the model.
    canvas.addEventListener('pointerdown', (e) => {
      if (painter && e.button === 0 && !e.altKey && painter.down(e)) { drag = { paint: true }; canvas.setPointerCapture(e.pointerId); return; }
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (painter && (!drag || drag.paint)) { if (drag) painter.move(e); else painter.hover(e); }
      if (!drag || drag.paint) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const s = dist * 0.0018;
        target = [target[0] - Math.cos(yaw) * dx * s, target[1] + dy * s, target[2] + Math.sin(yaw) * dx * s];
      } else { yaw -= dx * 0.008; pitch = Math.max(-0.2, Math.min(1.45, pitch + dy * 0.006)); }
      dirty = true; tick();
    });
    const end = (e) => { if (drag && drag.paint && painter) painter.up(e); drag = null; canvas.classList.remove('dragging'); };
    canvas.addEventListener('pointerleave', () => { if (painter && !drag) painter.hover(null); });
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    const resize = new ResizeObserver(() => { dirty = true; tick(); });
    resize.observe(canvas);

    function zoom(f) { dist = Math.max(0.3, Math.min(400, dist * f)); dirty = true; tick(); }

    return {
      load,
      setMode(m) { mode = { shaded: 0, clay: 1, parts: 2, wind: 3, channel: 4 }[m] ?? 0; dirty = true; tick(); },
      /** NoorForge's brush: { down(e) → true to paint, move(e), up(e), hover(e or null) }; null gives the mouse back. */
      setPainter(p) { painter = p || null; },
      /** The brush's ring on the surface (null: none), its radius in metres and its hardness (0–1). */
      setBrush(at, radius, hardness = 1) { brush = at ? [at[0], at[1], at[2], radius] : [0, 0, 0, 0]; brushHard = hardness; dirty = true; tick(); },
      /** The stroke being painted: per material { size, data: Uint8Array coverage } (or null), drawn in a colour. */
      setPaint(layers, color = [1, 1, 1], strength = 0.85) {
        (layers || []).forEach((l, i) => {
          if (!l) return;
          if (!paint[i]) {
            paint[i] = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, paint[i]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          }
          gl.bindTexture(gl.TEXTURE_2D, paint[i]);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, l.size, l.size, 0, gl.RED, gl.UNSIGNED_BYTE, l.data);
        });
        if (!layers) { paint.forEach((t) => t && gl.deleteTexture(t)); paint = []; }
        paintColor = [color[0], color[1], color[2], strength];
        dirty = true; tick();
      },
      /**
       * What is under a point of the canvas (client coordinates): { point, normal, dir (the ray's), material } in
       * world space, or null for nothing.
       */
      pick(clientX, clientY) {
        if (!scene) return null;
        if (!pickTris) pickTris = worldTriangles();
        const r = canvas.getBoundingClientRect();
        const x = ((clientX - r.left) / r.width) * 2 - 1, y = 1 - ((clientY - r.top) / r.height) * 2;
        const eye = [target[0] + Math.sin(yaw) * Math.cos(pitch) * dist, target[1] + Math.sin(pitch) * dist, target[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
        const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
        const rt = norm(cross(f, [0, 1, 0])), up = cross(rt, f);
        const t = Math.tan(0.75 / 2), aspect = r.width / Math.max(1, r.height);
        const dir = norm([f[0] + rt[0] * x * t * aspect + up[0] * y * t, f[1] + rt[1] * x * t * aspect + up[1] * y * t, f[2] + rt[2] * x * t * aspect + up[2] * y * t]);
        const hit = rayCast(pickTris, eye, dir);
        return hit ? { point: hit.point, normal: hit.normal, dir, material: hit.material } : null;
      },
      /** Pictures (one per material, as ImageBitmaps; null for none) shown unlit in the "channel" mode, as data. */
      setChannel(bitmaps) {
        channel.forEach((t) => t && gl.deleteTexture(t));
        channel = (bitmaps || []).map((bmp) => {
          if (!bmp) return null;
          const t = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          return t;
        });
        dirty = true; tick();
      },
      setWind(v) { wind = v; dirty = true; tick(); },
      setWireframe(v) { wireframe = !!v; dirty = true; tick(); },
      reset() { frame(); tick(); },
      zoom,
      state: () => ({ loaded: !!scene, draws: scene ? scene.draws.length : 0, nodes: scene ? scene.nodes : [], windFrom: scene ? ['none', 'uv', 'color'][scene.windFrom] : null, mode, wind, wireframe, bounds: scene ? scene.bounds : null, dist }),
      destroy() { cancelAnimationFrame(raf); resize.disconnect(); dispose(); },
    };
  }

  return { create, parseGlb };
})();
