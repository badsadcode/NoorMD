// NoorMesh: a polygon modeller for game assets (docs/NOORMESH_PLAN.md), a preview. Object Mode (A1): primitives,
// selection, move / turn / scale with Blender's keys (G, R, S; X, Y, Z; typed numbers), duplicate, delete, hide, apply
// transforms, undo. Edit Mode (A2, Tab): vertices, edges and faces (1, 2, 3), the same transforms on them, extrude,
// inset, delete, dissolve, merge, make face, normals, shading, loops and linked selection. The geometry is NoorMeshKernel's (meshkernel.js), the view NoorMeshView's
// (meshview.js). Meshes are never changed in place: an operation makes a new one, so undo keeps them by reference.
window.NoorMesh = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const K = () => window.NoorMeshKernel;
  const req = (type, payload) => NoorBridge.request(type, payload);

  let hooks = { showError: (e) => console.error(e) };
  let built = false, view = null;
  // The scene: objects { id, name, kind, mesh, t, r, s, hidden }; the selection; the active object.
  let objects = [], selected = new Set(), active = null, nextId = 1;
  let history = [], future = [];
  let op = null;           // a transform under way (G, R, S)
  let lastAdd = null;      // the last primitive added, its settings still adjustable
  let mouse = { x: 0, y: 0 }, box = null, showEdges = false;
  let viewName = 'User Perspective';
  // Edit Mode: the active object's mesh, its selection (NoorMeshKernel's: a mode and the set that mode keeps).
  let mode = 'object', editSel = null;
  // The file: where it was saved (or opened from), its name, whether it has changed since.
  let file = { path: '', name: '' }, dirty = false, draftTimer = 0, draftChecked = false;
  // The transform gizmos (as Blender's): each shown or not, remembered; the handle under the mouse.
  // Snapping (as Blender's magnet, Shift+Tab): steps of 0.1 m / 5° / 0.1, or a moved selection onto the vertex nearest the mouse. Ctrl does the other.
  let snapping = (() => { try { return { on: false, mode: 'increment', ...JSON.parse(localStorage.getItem('noormd.mesh.snap') || '{}') }; } catch { return { on: false, mode: 'increment' }; } })();
  // Edit Mode helpers, as Blender's: proportional editing (O), mirror (X/Y/Z), auto merge; remembered.
  let editOpts = (() => { const d = { prop: false, falloff: 'smooth', radius: 1, mirror: [false, false, false], autoMerge: false, mergeDist: 0.001 }; try { return { ...d, ...JSON.parse(localStorage.getItem('noormd.mesh.editopts') || '{}') }; } catch { return d; } })();
  // The 3D cursor (where new objects go; a pivot), and the pivot point for rotating and scaling (as Blender's "."): median, cursor, individual origins, active.
  let cursor = [0, 0, 0];
  // Edit Mode on several objects at once (as Blender's): their meshes joined into the active one's space while editing,
  // each face knowing whose it is (`o`, the index into ids); split back into the objects when Edit Mode ends.
  let multi = null; // { ids: [the active one first, then the others] }
  let pivotMode = (() => { try { return localStorage.getItem('noormd.mesh.pivot') || 'median'; } catch { return 'median'; } })();
  let gizmos = (() => { try { return { move: true, rotate: false, scale: false, ...JSON.parse(localStorage.getItem('noormd.mesh.gizmos') || '{}') }; } catch { return { move: true, rotate: false, scale: false }; } })();
  let gizmoHover = null, gizmoHandles = [];
  const editing = () => (mode === 'edit' ? byId(active) : null);
  const uploaded = new Map(); // id → the mesh object last sent to the view

  const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const AXIS_NAMES = ['X', 'Y', 'Z'];
  const AXIS_COLOURS = [[0.95, 0.32, 0.32, 0.9], [0.45, 0.8, 0.3, 0.9], [0.3, 0.55, 0.95, 0.9]];
  const PRIM_ICONS = { cube: '◼', plane: '▱', grid: '▦', uvsphere: '●', icosphere: '⬢', cylinder: '▮', cone: '▲', torus: '○' };
  const PARAM_LABELS = { size: 'Size (m)', cutsX: 'Cuts across', cutsZ: 'Cuts along', radius: 'Radius (m)', segments: 'Segments', rings: 'Rings', subdivisions: 'Subdivisions', depth: 'Depth (m)', major: 'Major radius (m)', minor: 'Minor radius (m)', sides: 'Sides' };

  function init(h) { hooks = { ...hooks, ...h }; }
  const isOpen = () => built && !$('#meshbench').hidden;
  function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('mesh');
    document.body.classList.add('mesh-open');
    $('#meshbench').hidden = false;
    if (!objects.length && !history.length) { addPrimitive('cube', null, true); history = []; future = []; dirty = false; }
    renderAll();
    if (!draftChecked) { draftChecked = true; offerDraft(); }
    if (view) view.redraw();
    $('#meshbench').focus({ preventScroll: true });
  }
  function close() {
    if (!built || !isOpen()) return;
    cancelOp();
    document.body.classList.remove('mesh-open');
    $('#meshbench').hidden = true;
    if (window.NoorDock) NoorDock.closed('mesh');
  }
  const toggle = () => (isOpen() ? close() : open());
  const setStatus = (t) => { const s = $('#nm-status'); if (s) s.textContent = t; };
  const byId = (id) => objects.find((o) => o.id === id);
  const matrixOf = (o) => K().compose(o.t, o.r, o.s);
  const sel = () => objects.filter((o) => selected.has(o.id) && !o.hidden);

  // ---------------------------------------------------------------- history (a scene per step; meshes by reference)
  const snapshot = () => ({ objects: objects.map((o) => ({ ...o, t: o.t.slice(), r: o.r.slice(), s: o.s.slice() })), selected: [...selected], active, nextId, mode, editSel: editSel && K().cloneSelection(editSel), multi: multi && { ids: multi.ids.slice() } });
  function pushHistory() { history.push(snapshot()); if (history.length > 200) history.shift(); future = []; changed(); }
  /** Something changed: the title shows it, and a draft is kept a few seconds later (to bring back after a crash). */
  function changed() {
    dirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 4000);
    if (window.NoorChrome) NoorChrome.benchChanged();
    const t = $('#nm-info'); if (t) t.textContent = fileLabel();
  }
  const fileLabel = () => `${file.name || 'Untitled scene'}${dirty ? ' •' : ''}`;
  function restore(s) {
    objects = s.objects.map((o) => ({ ...o, t: o.t.slice(), r: o.r.slice(), s: o.s.slice() })); selected = new Set(s.selected); active = s.active; nextId = Math.max(nextId, s.nextId); lastAdd = null;
    mode = s.mode || 'object'; editSel = s.editSel ? K().cloneSelection(s.editSel) : null;
    multi = s.multi && mode === 'edit' ? { ids: s.multi.ids.slice() } : null;
    if (mode === 'edit' && !editing()) { mode = 'object'; editSel = null; }
    syncAll(); renderAll();
  }
  function undo(redo = false) {
    cancelOp();
    const from = redo ? future : history, to = redo ? history : future;
    if (!from.length) return;
    to.push(snapshot());
    restore(from.pop());
    changed();
    setStatus(redo ? 'Redone' : 'Undone');
  }

  // ---------------------------------------------------------------- the view
  function sync(o) {
    if (!view) return;
    const inEdit = mode === 'edit' && o.id === active; // its overlay shows the selection instead of an outline
    const absorbed = !!multi && mode === 'edit' && o.id !== active && multi.ids.includes(o.id);
    const look = { matrix: matrixOf(o), selected: selected.has(o.id) && !inEdit, active: active === o.id && !inEdit, hidden: o.hidden || absorbed };
    if (uploaded.get(o.id) !== o.mesh) { view.setObject(o.id, K().buffers(o.mesh), look); uploaded.set(o.id, o.mesh); }
    else view.setLook(o.id, look);
  }
  function syncAll() {
    if (!view) return;
    for (const id of [...uploaded.keys()]) if (!byId(id)) { view.removeObject(id); uploaded.delete(id); }
    objects.forEach(sync);
    syncEdit();
  }

  // ---------------------------------------------------------------- Edit Mode: the overlay and picking
  const ORANGE = [1, 0.58, 0.15, 1], DARK = [0.04, 0.04, 0.05, 0.9], FACE_TINT = [1, 0.55, 0.1, 0.22];
  /** The edited mesh's vertices (dots, in vertex mode), edges, and its selected faces tinted (face mode: their centres as dots). */
  function syncEdit() {
    if (!view) return;
    const o = editing();
    if (!o) { view.setEdit(null); return; }
    const K_ = K(), m = o.mesh, f = K_.flush(m, editSel), n = K_.vertexCount(m);
    const es = K_.edges(m);
    const lines = new Float32Array(es.length * 6), lineColors = new Float32Array(es.length * 8);
    es.forEach((e, k) => {
      lines.set([m.v[e.a * 3], m.v[e.a * 3 + 1], m.v[e.a * 3 + 2], m.v[e.b * 3], m.v[e.b * 3 + 1], m.v[e.b * 3 + 2]], k * 6);
      const c = f.edges.has(K_.edgeKey(e.a, e.b)) ? ORANGE : DARK;
      lineColors.set([...c, ...c], k * 8);
    });
    let points = null, pointColors = null;
    if (editSel.mode === 'vert') {
      points = new Float32Array(m.v); pointColors = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) pointColors.set(f.verts.has(i) ? ORANGE : [0, 0, 0, 1], i * 4);
    } else if (editSel.mode === 'face') {
      points = new Float32Array(m.f.length * 3); pointColors = new Float32Array(m.f.length * 4);
      m.f.forEach((face, i) => { points.set(K_.faceCentre(m, face), i * 3); pointColors.set(f.faces.has(i) ? ORANGE : [0, 0, 0, 0.8], i * 4); });
    }
    const triList = [];
    for (const i of f.faces) for (const t of K_.triangulateFace(m, m.f[i])) for (const k of t) triList.push(m.v[m.f[i].v[k] * 3], m.v[m.f[i].v[k] * 3 + 1], m.v[m.f[i].v[k] * 3 + 2]);
    const tris = new Float32Array(triList), triColors = new Float32Array((triList.length / 3) * 4);
    for (let k = 0; k < triList.length / 3; k++) triColors.set(FACE_TINT, k * 4);
    view.setEdit({ id: o.id, matrix: matrixOf(o), points, pointColors, lines, lineColors, tris, triColors });
  }
  const worldOf = (o, i) => K().transformPoint(matrixOf(o), [o.mesh.v[i * 3], o.mesh.v[i * 3 + 1], o.mesh.v[i * 3 + 2]]);
  /** Whether a point of the edited object can be seen (nothing of it in front), as Blender selects with X-ray off. */
  function visible(o, p) {
    const s = view.project(p);
    if (!s.front) return false;
    const r = view.ray(s.x, s.y), hit = view.pick(s.x, s.y, o.id);
    if (!hit) return true;
    const along = K().vec.dot(K().vec.sub(p, r.origin), r.dir), size = K().vec.len(K().vec.sub(view.camera().eye, p));
    return hit.t >= along - Math.max(1e-4, size * 0.002);
  }
  /** The vertex nearest the mouse on the screen (that can be seen), within reach. */
  function pickVert(o, x, y, reach = 14) {
    let best = -1, bestD = reach;
    const n = K().vertexCount(o.mesh);
    const cands = [];
    for (let i = 0; i < n; i++) { const s = view.project(worldOf(o, i)); const d = Math.hypot(s.x - x, s.y - y); if (s.front && d < reach) cands.push([d, i]); }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [d, i] of cands) if (visible(o, worldOf(o, i))) { best = i; bestD = d; break; }
    void bestD;
    return best;
  }
  /** The edge nearest the mouse on the screen (seen at its nearest point), within reach: [a, b] or null. */
  function pickEdge(o, x, y, reach = 12) {
    const cands = [];
    for (const e of K().edges(o.mesh)) {
      const pa = worldOf(o, e.a), pb = worldOf(o, e.b), sa = view.project(pa), sb = view.project(pb);
      if (!sa.front || !sb.front) continue;
      const dx = sb.x - sa.x, dy = sb.y - sa.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - sa.x) * dx + (y - sa.y) * dy) / l2));
      const d = Math.hypot(sa.x + dx * t - x, sa.y + dy * t - y);
      if (d < reach) cands.push([d, e, K().vec.add(pa, K().vec.scale(K().vec.sub(pb, pa), t))]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [, e, p] of cands) if (visible(o, p)) return [e.a, e.b];
    return null;
  }
  const pickFace = (o, x, y) => { const h = view.pick(x, y, o.id); return h ? h.face : -1; };
  /** A click in Edit Mode: the vertex, edge or face under the mouse (Shift: added or taken away; Alt: its loop). */
  function editClick(e) {
    const o = editing(), K_ = K();
    const add = e.shiftKey, loop = e.altKey;
    const before = K_.cloneSelection(editSel);
    if (!add) editSel = K_.emptySelection(editSel.mode);
    if (loop) {
      const ed = pickEdge(o, e.clientX, e.clientY, 18);
      if (ed) {
        if (editSel.mode === 'face') K_.faceLoop(o.mesh, ed[0], ed[1]).forEach((i) => editSel.faces.add(i));
        else {
          const keys = K_.edgeLoop(o.mesh, ed[0], ed[1]);
          if (editSel.mode === 'edge') keys.forEach((k) => editSel.edges.add(k));
          else keys.forEach((k) => k.split('_').forEach((v) => editSel.verts.add(Number(v))));
        }
      }
    } else if (editSel.mode === 'vert') {
      const v = pickVert(o, e.clientX, e.clientY);
      if (v >= 0) { if (add && before.verts.has(v)) editSel.verts.delete(v); else editSel.verts.add(v); }
    } else if (editSel.mode === 'edge') {
      const ed = pickEdge(o, e.clientX, e.clientY);
      if (ed) { const k = K_.edgeKey(ed[0], ed[1]); if (add && before.edges.has(k)) editSel.edges.delete(k); else editSel.edges.add(k); }
    } else {
      const fi = pickFace(o, e.clientX, e.clientY);
      if (fi >= 0) { if (add && before.faces.has(fi)) editSel.faces.delete(fi); else editSel.faces.add(fi); }
    }
    syncEdit(); renderProps();
  }
  /** Box select in Edit Mode: the vertices (seen) inside it, the edges with both ends inside, the faces whose middle is. */
  function editBox(x0, y0, x1, y1, how) {
    const o = editing(), K_ = K(), m = o.mesh;
    const inside = (p) => { const s = view.project(p); return s.front && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1; };
    const big = K_.vertexCount(m) > 4000; // a big mesh: no visibility test (as X-ray)
    const seen = (p) => big || visible(o, p);
    if (how === 'set') editSel = K_.emptySelection(editSel.mode);
    const put = (set, x) => (how === 'remove' ? set.delete(x) : set.add(x));
    if (editSel.mode === 'vert') { for (let i = 0; i < K_.vertexCount(m); i++) { const p = worldOf(o, i); if (inside(p) && seen(p)) put(editSel.verts, i); } }
    else if (editSel.mode === 'edge') {
      const ok = new Set(); for (let i = 0; i < K_.vertexCount(m); i++) { const p = worldOf(o, i); if (inside(p) && seen(p)) ok.add(i); }
      for (const e of K_.edges(m)) if (ok.has(e.a) && ok.has(e.b)) put(editSel.edges, K_.edgeKey(e.a, e.b));
    } else m.f.forEach((f, i) => { const p = K_.transformPoint(matrixOf(o), K_.faceCentre(m, f)); if (inside(p) && seen(p)) put(editSel.faces, i); });
    syncEdit(); renderProps();
  }

  // ---------------------------------------------------------------- Edit Mode: entering, modes, operations
  function toggleEdit(on = mode !== 'edit') {
    cancelOp();
    if (on) {
      const o = byId(active);
      if (!o || o.hidden) { setStatus('Select an object first: Edit Mode edits the active object.'); return; }
      const together = sel().filter((x) => x !== o);
      mode = 'edit';
      if (together.length) enterMulti(o, together);
      else selected = new Set([o.id]);
      if (!editSel) editSel = K().emptySelection('vert');
      editSel = K().emptySelection(editSel.mode); // a fresh selection each time (simple and predictable)
    } else { if (multi) leaveMulti(); mode = 'object'; }
    lastAdd = null;
    syncAll(); renderAll();
    setStatus(mode === 'edit' ? (multi ? `Edit Mode: ${multi.ids.length} objects together · 1 vertices, 2 edges, 3 faces · Tab: back to Object Mode` : 'Edit Mode: 1 vertices, 2 edges, 3 faces · Tab: back to Object Mode') : 'Object Mode');
  }
  const detOf = (L) => L[0] * (L[5] * L[10] - L[6] * L[9]) - L[4] * (L[1] * L[10] - L[2] * L[9]) + L[8] * (L[1] * L[6] - L[2] * L[5]);
  /** Several objects into Edit Mode: their meshes put into the active one's space, every face marked with its owner. */
  function enterMulti(a, others) {
    const Ai = invertOf(a), mesh = K().clone(a.mesh);
    mesh.f.forEach((f) => { f.o = 0; });
    others.forEach((o, j) => {
      const L = K().multiply(Ai, matrixOf(o)), base = K().vertexCount(mesh), flip = detOf(L) < 0;
      for (let i = 0; i < K().vertexCount(o.mesh); i++) mesh.v.push(...K().transformPoint(L, vOf(o.mesh, i)));
      for (const f of o.mesh.f) { const nf = { v: f.v.map((v) => v + base), uv: f.uv ? f.uv.slice() : null, m: f.m || 0, s: !!f.s, o: j + 1 }; if (flip) K().flipFace(nf); mesh.f.push(nf); }
    });
    multi = { ids: [a.id, ...others.map((o) => o.id)] };
    a.mesh = mesh;
    selected = new Set(multi.ids);
  }
  /** The joined mesh split back: each object its own faces (new faces go with the faces beside them), in its own space. */
  function splitMulti() {
    const a = byId(multi.ids[0]), m = a.mesh, n = multi.ids.length;
    const owner = m.f.map((f) => (Number.isInteger(f.o) && f.o >= 0 && f.o < n ? f.o : -1));
    const ef = K().edgeFaces(m), queue = owner.map((o, i) => (o >= 0 ? i : -1)).filter((i) => i >= 0);
    for (let qi = 0; qi < queue.length; qi++) {
      const fi = queue[qi];
      for (const k of K().faceEdgeKeys(m.f[fi])) for (const nb of ef.get(k) || []) if (owner[nb] < 0) { owner[nb] = owner[fi]; queue.push(nb); }
    }
    const out = new Map();
    multi.ids.forEach((id, j) => {
      const o = byId(id);
      if (!o) return;
      const part = subMesh(m, m.f.map((_, i) => i).filter((i) => (owner[i] < 0 ? 0 : owner[i]) === j));
      const L = K().multiply(invertOf(o), matrixOf(a)), flip = detOf(L) < 0;
      for (let i = 0; i < K().vertexCount(part); i++) { const q = K().transformPoint(L, vOf(part, i)); part.v[i * 3] = q[0]; part.v[i * 3 + 1] = q[1]; part.v[i * 3 + 2] = q[2]; }
      if (flip) part.f.forEach((f) => K().flipFace(f));
      out.set(id, part);
    });
    return out;
  }
  function leaveMulti() {
    const parts = splitMulti();
    for (const [id, mesh] of parts) { const o = byId(id); if (o) o.mesh = mesh; }
    multi = null;
  }
  function setSelectMode(m) {
    const o = editing();
    if (!o) return;
    editSel = K().convertSelection(o.mesh, editSel, m);
    syncEdit(); renderAll();
  }
  /** One step of Edit Mode: the edited mesh replaced (and its selection), one undo step. */
  function editStep(fn, label) {
    const o = editing();
    if (!o) return null;
    pushHistory();
    const r = fn(o.mesh);
    if (!r) { history.pop(); return null; }
    o.mesh = r.mesh;
    if (r.sel) editSel = r.sel;
    lastAdd = null;
    sync(o); syncEdit(); renderAll();
    if (label) setStatus(label);
    return r;
  }
  const flushed = () => { const o = editing(); return o ? K().flush(o.mesh, editSel) : null; };
  function editSelectAll(how) {
    const o = editing(), K_ = K(), m = o.mesh;
    const all = { vert: () => new Set([...Array(K_.vertexCount(m)).keys()]), edge: () => new Set(K_.edges(m).map((e) => K_.edgeKey(e.a, e.b))), face: () => new Set(m.f.map((_, i) => i)) }[editSel.mode]();
    const key = { vert: 'verts', edge: 'edges', face: 'faces' }[editSel.mode];
    const cur = editSel[key];
    editSel = K_.emptySelection(editSel.mode);
    editSel[key] = how === 'none' ? new Set() : how === 'invert' ? new Set([...all].filter((x) => !cur.has(x))) : all;
    syncEdit(); renderProps();
  }
  function extrude() {
    const f = flushed();
    if (!f) return;
    if (f.faces.size) {
      const r = editStep((m) => { const x = K().extrudeFaces(m, f.faces); return { mesh: x.mesh, sel: K().selectionFromFaces(x.mesh, x.faces, editSel.mode) }; });
      if (!r) return;
      // Then moved along the region's normal (in the world), as Blender's extrude.
      const o = editing(), nm = K().normalMatrix(matrixOf(o));
      const n = K().faceNormal(o.mesh, o.mesh.f[[...K().flush(o.mesh, editSel).faces][0]]).n;
      const avg = [...K().flush(o.mesh, editSel).faces].reduce((acc, i) => K().vec.add(acc, K().faceNormal(o.mesh, o.mesh.f[i]).n), [0, 0, 0]);
      const local = K().vec.len(avg) > 1e-6 ? K().vec.norm(avg) : n;
      const world = K().vec.norm([nm[0] * local[0] + nm[3] * local[1] + nm[6] * local[2], nm[1] * local[0] + nm[4] * local[1] + nm[7] * local[2], nm[2] * local[0] + nm[5] * local[1] + nm[8] * local[2]]);
      startOp('move', { already: true, dir: world });
    } else if (f.edges.size) {
      const r = editStep((m) => { const x = K().extrudeEdges(m, [...f.edges]); if (!x.verts.length) return null; return { mesh: x.mesh, sel: K().selectionFromVerts(x.mesh, x.verts, editSel.mode === 'face' ? 'edge' : editSel.mode) }; });
      if (!r) { setStatus('Extrude needs faces, or edges at a border (edges between two faces are not extruded).'); return; }
      startOp('move', { already: true });
    } else setStatus('Select faces (or border edges) to extrude.');
  }
  function inset() {
    const f = flushed();
    if (!f || !f.faces.size) { setStatus('Select faces to inset.'); return; }
    startOp('inset');
  }
  function deleteMenu(x = mouse.x, y = mouse.y) {
    const del = (what) => editStep((m) => ({ mesh: K().deleteElements(m, editSel, what), sel: K().emptySelection(editSel.mode) }), 'Deleted');
    const dis = (m2) => editStep((m) => ({ mesh: K().dissolve(m, { ...K().convertSelection(m, editSel, m2) }), sel: K().emptySelection(editSel.mode) }), 'Dissolved');
    popup(x, y, 'Delete', [
      { label: 'Vertices', run: () => del('verts') }, { label: 'Edges', run: () => del('edges') }, { label: 'Faces', run: () => del('faces') }, { label: 'Only faces', run: () => del('only-faces') }, '-',
      { label: 'Dissolve vertices', run: () => dis('vert') }, { label: 'Dissolve edges', run: () => dis('edge') }, { label: 'Dissolve faces', run: () => dis('face') },
    ]);
  }
  const dissolveSel = () => editStep((m) => ({ mesh: K().dissolve(m, editSel), sel: K().emptySelection(editSel.mode) }), 'Dissolved');
  function mergeMenu(x = mouse.x, y = mouse.y) {
    const f = flushed();
    if (!f || f.verts.size < 1) { setStatus('Select vertices to merge.'); return; }
    const centreOf = (m, vs) => K().vec.scale([...vs].reduce((a, v) => K().vec.add(a, [m.v[v * 3], m.v[v * 3 + 1], m.v[v * 3 + 2]]), [0, 0, 0]), 1 / vs.size);
    const at = (pointFn, label) => editStep((m) => { const r = K().mergeVerts(m, f.verts, pointFn(m)); return { mesh: r.mesh, sel: K().selectionFromVerts(r.mesh, r.vert >= 0 ? [r.vert] : [], editSel.mode) }; }, label);
    popup(x, y, 'Merge', [
      { label: 'At center', run: () => at((m) => centreOf(m, f.verts), 'Merged at the centre') },
      { label: 'At the 3D cursor', run: () => at((m) => K().transformPoint(invertOf(editing()), cursor), 'Merged at the 3D cursor') },
      { label: 'Collapse (each island to its centre)', run: () => editStep((m) => {
        let out = m; const left = [];
        const islands = []; const seen = new Set();
        for (const v of f.verts) { if (seen.has(v)) continue; const linked = [...K().linkedVerts(m, [v])].filter((x) => f.verts.has(x)); linked.forEach((x) => seen.add(x)); islands.push(linked); }
        // Collapsed one at a time, each island's vertices found again by position (indices shift as vertices go).
        const pts = islands.map((isl) => isl.map((v) => [m.v[v * 3], m.v[v * 3 + 1], m.v[v * 3 + 2]]));
        for (const P of pts) {
          const idx = new Set(); P.forEach((p) => { for (let i = 0; i < K().vertexCount(out); i++) if (K().vec.len(K().vec.sub([out.v[i * 3], out.v[i * 3 + 1], out.v[i * 3 + 2]], p)) < 1e-9) idx.add(i); });
          const c = K().vec.scale(P.reduce((a, p) => K().vec.add(a, p), [0, 0, 0]), 1 / P.length);
          const r = K().mergeVerts(out, idx, c); out = r.mesh; left.push(c);
        }
        const keep = []; left.forEach((c) => { for (let i = 0; i < K().vertexCount(out); i++) if (K().vec.len(K().vec.sub([out.v[i * 3], out.v[i * 3 + 1], out.v[i * 3 + 2]], c)) < 1e-9) keep.push(i); });
        return { mesh: out, sel: K().selectionFromVerts(out, keep, editSel.mode) };
      }, 'Collapsed') },
      { label: 'By distance (0.1 mm)', run: () => { const r = editStep((m) => { const x = K().mergeByDistance(m, 0.0001, f.verts); return { mesh: x.mesh, sel: K().emptySelection(editSel.mode), removed: x.removed }; }); if (r) setStatus(`Merged by distance: ${r.removed} vertices removed`); } },
    ]);
  }
  function invertOf(o) {
    // The inverse of an object's matrix (no shear): undo the move, then the turn, then the scale.
    const m = matrixOf(o), d = K().decompose(m), R = K().rotation(d.r[0], d.r[1], d.r[2]);
    const Rt = [R[0], R[4], R[8], 0, R[1], R[5], R[9], 0, R[2], R[6], R[10], 0, 0, 0, 0, 1];
    const S = [1 / (d.s[0] || 1), 0, 0, 0, 0, 1 / (d.s[1] || 1), 0, 0, 0, 0, 1 / (d.s[2] || 1), 0, 0, 0, 0, 1];
    const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -d.t[0], -d.t[1], -d.t[2], 1];
    return K().multiply(S, K().multiply(Rt, T));
  }
  function makeFaceSel() {
    const f = flushed();
    if (!f || f.verts.size < 3) { setStatus('Select 3 or more vertices to make a face (edges alone are not kept).'); return; }
    editStep((m) => { const r = K().makeFace(m, f.verts); if (r.face < 0) return null; return { mesh: r.mesh, sel: K().selectionFromFaces(r.mesh, [r.face], editSel.mode) }; }, 'Made a face');
  }
  function normals(how) {
    const f = flushed();
    if (!f) return;
    const faces = f.faces.size ? f.faces : new Set(editing().mesh.f.map((_, i) => i));
    if (how === 'flip') editStep((m) => ({ mesh: K().flipFaces(m, faces) }), 'Flipped');
    else if (how === 'outside') editStep((m) => ({ mesh: K().recalcOutside(m, faces) }), 'Normals point outside');
    else editStep((m) => ({ mesh: K().flipFaces(K().recalcOutside(m, faces), faces) }), 'Normals point inside');
  }
  function normalsMenu(x = mouse.x, y = mouse.y) { popup(x, y, 'Normals', [{ label: 'Flip', run: () => normals('flip') }, { label: 'Recalculate outside', keys: 'Shift+N', run: () => normals('outside') }, { label: 'Recalculate inside', run: () => normals('inside') }]); }
  function shade(smooth) {
    if (mode === 'edit') {
      const f = flushed(); if (!f) return;
      editStep((m) => ({ mesh: K().setSmooth(m, f.faces.size ? f.faces : null, smooth) }), smooth ? 'Shaded smooth' : 'Shaded flat');
    } else {
      const list = sel(); if (!list.length) return;
      pushHistory(); list.forEach((o) => { o.mesh = K().setSmooth(o.mesh, null, smooth); }); lastAdd = null; syncAll(); renderAll();
      setStatus(smooth ? 'Shaded smooth' : 'Shaded flat');
    }
  }
  function selectLinked(underCursor) {
    const o = editing(), K_ = K();
    let seeds;
    if (underCursor) {
      const v = pickVert(o, mouse.x, mouse.y, 30), fi = v < 0 ? pickFace(o, mouse.x, mouse.y) : -1;
      seeds = v >= 0 ? [v] : fi >= 0 ? o.mesh.f[fi].v : [];
      if (!seeds.length) return;
    } else seeds = [...K_.flush(o.mesh, editSel).verts];
    const all = K_.linkedVerts(o.mesh, seeds);
    const add = K_.selectionFromVerts(o.mesh, all, editSel.mode);
    const key = { vert: 'verts', edge: 'edges', face: 'faces' }[editSel.mode];
    add[key].forEach((x) => editSel[key].add(x));
    syncEdit(); renderProps();
  }
  function growShrink(grow) {
    const o = editing(), f = K().flush(o.mesh, editSel);
    const verts = grow ? K().growVerts(o.mesh, f.verts) : K().shrinkVerts(o.mesh, f.verts);
    editSel = K().selectionFromVerts(o.mesh, verts, editSel.mode);
    syncEdit(); renderProps();
  }
  function duplicateEdit() {
    const f = flushed();
    if (!f || !f.faces.size) { setStatus('Select faces to duplicate.'); return; }
    const r = editStep((m) => { const x = K().duplicateFaces(m, f.faces); return { mesh: x.mesh, sel: K().selectionFromFaces(x.mesh, x.faces, editSel.mode) }; });
    if (r) startOp('move', { already: true });
  }
  function editMenu(x, y) {
    const f = flushed(), none = !f || !f.verts.size, noFaces = !f || !f.faces.size;
    const items = editSel.mode === 'face' ? [
      { label: 'Extrude faces', keys: 'E', run: extrude, disabled: noFaces }, { label: 'Inset faces', keys: 'I', run: inset, disabled: noFaces }, { label: 'Bridge faces', run: bridge, disabled: noFaces }, { label: 'Loop cut and slide', keys: 'Ctrl+R', run: loopCutStart },
      { label: 'Flip', keys: 'Alt+N', run: () => normals('flip'), disabled: noFaces }, { label: 'Shade smooth', run: () => shade(true), disabled: noFaces }, { label: 'Shade flat', run: () => shade(false), disabled: noFaces }, '-',
      { label: 'Duplicate', keys: 'Shift+D', run: duplicateEdit, disabled: noFaces }, { label: 'Dissolve faces', keys: 'Ctrl+X', run: dissolveSel, disabled: noFaces }, { label: 'Delete…', keys: 'X', run: () => deleteMenu(x, y), disabled: noFaces },
    ] : [
      { label: 'Extrude', keys: 'E', run: extrude, disabled: none }, { label: 'Merge…', keys: 'M', run: () => mergeMenu(x, y), disabled: none }, { label: 'Make face', keys: 'F', run: makeFaceSel, disabled: none }, '-',
      { label: 'Loop cut and slide', keys: 'Ctrl+R', run: loopCutStart }, { label: 'Bevel', keys: 'Ctrl+B', run: () => bevelStart(editSel.mode === 'vert'), disabled: none }, { label: 'Knife', keys: 'K', run: knifeStart }, { label: 'Bridge edge loops', run: bridge, disabled: none }, '-',
      { label: editSel.mode === 'edge' ? 'Dissolve edges' : 'Dissolve vertices', keys: 'Ctrl+X', run: dissolveSel, disabled: none }, { label: 'Delete…', keys: 'X', run: () => deleteMenu(x, y), disabled: none },
    ];
    popup(x, y, { vert: 'Vertex', edge: 'Edge', face: 'Face' }[editSel.mode], [
      { label: 'Move', keys: 'G', run: () => startOp('move'), disabled: none }, { label: 'Rotate', keys: 'R', run: () => startOp('rotate'), disabled: none }, { label: 'Scale', keys: 'S', run: () => startOp('scale'), disabled: none }, '-', ...items,
      '-', { label: 'Separate…', keys: 'P', run: () => separateMenu(x, y) }, { label: 'Select linked', keys: 'Ctrl+L', run: () => selectLinked(false), disabled: none }, { label: 'Object Mode', keys: 'Tab', run: () => toggleEdit(false) },
    ]);
  }

  // ---------------------------------------------------------------- objects
  function uniqueName(base) {
    const names = new Set(objects.map((o) => o.name));
    if (!names.has(base)) return base;
    for (let k = 1; ; k++) { const n = `${base}.${String(k).padStart(3, '0')}`; if (!names.has(n)) return n; }
  }
  /** A primitive at the 3D cursor (the origin for now), selected and active; its settings stay adjustable until the next edit. */
  function addPrimitive(kind, params, quiet) {
    const prim = K().PRIMITIVES[kind];
    if (!prim) return;
    const p = { ...prim.params, ...(params || {}) };
    if (!quiet) pushHistory();
    const o = { id: `o${nextId++}`, name: uniqueName(prim.name), kind, mesh: prim.make(p), t: cursor.slice(), r: [0, 0, 0], s: [1, 1, 1], hidden: false };
    objects.push(o);
    selected = new Set([o.id]); active = o.id;
    lastAdd = { id: o.id, kind, params: p };
    syncAll(); renderAll();
    setStatus(`Added ${o.name}`);
  }
  /** Changing the last primitive's settings (as Blender's Adjust Last Operation): its mesh made again, one undo step. */
  function adjustLast(key, value) {
    const o = lastAdd && byId(lastAdd.id);
    if (!o) return;
    pushHistory();
    lastAdd.params = { ...lastAdd.params, [key]: value };
    o.mesh = K().PRIMITIVES[lastAdd.kind].make(lastAdd.params);
    sync(o); renderProps();
  }
  function select(id, extend) {
    if (!extend) { selected = new Set(id ? [id] : []); active = id || null; }
    else if (id) {
      // Shift+click: an unselected or inactive object becomes selected and active; the active one is deselected.
      if (selected.has(id) && active === id) { selected.delete(id); active = null; }
      else { selected.add(id); active = id; }
    }
    syncAll(); renderAll();
  }
  function selectAll(how) {
    if (how === 'none') { selected.clear(); active = null; }
    else if (how === 'invert') { selected = new Set(objects.filter((o) => !o.hidden && !selected.has(o.id)).map((o) => o.id)); if (!selected.has(active)) active = null; }
    else selected = new Set(objects.filter((o) => !o.hidden).map((o) => o.id));
    syncAll(); renderAll();
  }
  function deleteSelected() {
    const list = sel();
    if (!list.length) return;
    pushHistory();
    objects = objects.filter((o) => !selected.has(o.id));
    selected.clear(); active = null; lastAdd = null;
    syncAll(); renderAll();
    setStatus(`Deleted ${list.length} object${list.length === 1 ? '' : 's'}`);
  }
  function duplicate() {
    const list = sel();
    if (!list.length) return;
    pushHistory();
    const copies = list.map((o) => ({ ...o, id: `o${nextId++}`, name: uniqueName(o.name.replace(/\.\d{3}$/, '')), t: o.t.slice(), r: o.r.slice(), s: o.s.slice() }));
    objects.push(...copies);
    selected = new Set(copies.map((o) => o.id)); active = copies[copies.length - 1].id; lastAdd = null;
    syncAll(); renderAll();
    startOp('move', true); // Shift+D: the copies follow the mouse straight away
  }
  function hide(how) {
    pushHistory();
    if (how === 'reveal') { objects.forEach((o) => { if (o.hidden) { o.hidden = false; selected.add(o.id); } }); }
    else if (how === 'others') objects.forEach((o) => { if (!selected.has(o.id)) o.hidden = true; });
    else { sel().forEach((o) => { o.hidden = true; selected.delete(o.id); }); if (!selected.has(active)) active = null; }
    syncAll(); renderAll();
  }
  /** Ctrl+A: the transform put into the mesh (the object keeps the look, its numbers go back to none). */
  function applyTransform(what) {
    const list = sel();
    if (!list.length) return;
    pushHistory();
    for (const o of list) {
      const parts = { location: [o.t, [0, 0, 0], [1, 1, 1]], rotation: [[0, 0, 0], o.r, [1, 1, 1]], scale: [[0, 0, 0], [0, 0, 0], o.s], rotscale: [[0, 0, 0], o.r, o.s], all: [o.t, o.r, o.s] }[what];
      o.mesh = K().applyMatrix(o.mesh, K().compose(...parts));
      if (what === 'location' || what === 'all') o.t = [0, 0, 0];
      if (what === 'rotation' || what === 'rotscale' || what === 'all') o.r = [0, 0, 0];
      if (what === 'scale' || what === 'rotscale' || what === 'all') o.s = [1, 1, 1];
    }
    lastAdd = null;
    syncAll(); renderAll();
    setStatus(`Applied ${({ location: 'location', rotation: 'rotation', scale: 'scale', rotscale: 'rotation and scale', all: 'all transforms' })[what]} to ${list.length} object${list.length === 1 ? '' : 's'}`);
  }
  function clearTransform(what) {
    const list = sel();
    if (!list.length) return;
    pushHistory();
    for (const o of list) { if (what === 'location') o.t = [0, 0, 0]; if (what === 'rotation') o.r = [0, 0, 0]; if (what === 'scale') o.s = [1, 1, 1]; }
    syncAll(); renderProps();
  }
  function rename(id) {
    const o = byId(id || active);
    if (!o) return;
    NoorUI.prompt('Rename', 'The object\'s name', o.name).then((name) => {
      if (!name || !name.trim() || name.trim() === o.name) return;
      pushHistory(); o.name = uniqueName(name.trim().slice(0, 64)); renderAll();
    }).finally(keepFocus);
  }

  // ---------------------------------------------------------------- transforms (G, R, S)
  const pivotOf = (list) => { const c = [0, 0, 0]; list.forEach((o) => { c[0] += o.t[0]; c[1] += o.t[1]; c[2] += o.t[2]; }); return c.map((x) => x / Math.max(1, list.length)); };
  function startOp(kind, fromDuplicate = false) {
    if (!view) return;
    if (mode === 'edit') { startEditOp(kind, fromDuplicate || {}); return; }
    const list = sel();
    if (!list.length) { setStatus('Select an object first (click it, or A for all).'); return; }
    cancelOp();
    const pivot = pivotMode === 'cursor' ? cursor.slice() : pivotMode === 'active' && byId(active) && list.includes(byId(active)) ? byId(active).t.slice() : pivotOf(list);
    op = { kind, indiv: pivotMode === 'individual', list, start: list.map((o) => ({ t: o.t.slice(), r: o.r.slice(), s: o.s.slice(), m: matrixOf(o) })), pivot, m0: { ...mouse }, axis: null, typed: '', fromDuplicate, before: snapshot() };
    updateOp();
  }
  /**
   * A transform of the selected vertices in Edit Mode (or an inset of the selected faces): worked out in the world as for
   * objects, then put into the mesh's own space. `already`: the undo step was made by the extrude or duplicate before it.
   */
  function startEditOp(kind, { already = false, dir = null } = {}) {
    const o = editing(), f = K().flush(o.mesh, editSel);
    if (!f.verts.size) { setStatus('Select something first (click it, A for all, or drag a box).'); return; }
    cancelOp();
    const verts = [...f.verts];
    let pivot = K().vec.scale(verts.reduce((a, v) => K().vec.add(a, worldOf(o, v)), [0, 0, 0]), 1 / verts.length);
    if (pivotMode === 'cursor') pivot = cursor.slice();
    // Individual origins: each connected part of the selection turns or scales about its own middle.
    const groups = pivotMode === 'individual' && (kind === 'rotate' || kind === 'scale') ? selectedParts(o, verts) : null;
    op = { kind, edit: true, obj: o, startMesh: o.mesh, verts, faces: f.faces, pivot, groups, m0: { ...mouse }, axis: null, dir, typed: '', fromDuplicate: already, before: already ? null : snapshot() };
    if (kind === 'move' || kind === 'rotate' || kind === 'scale') { setupProp(); setupMirror(); }
    updateOp();
  }
  /** A world transform put onto the edited vertices (in the object's own space). */
  function applyEdit(W) {
    const o = op.obj, M = matrixOf(o), Mi = invertOf(o);
    const make = typeof W === 'function' ? W : () => W;
    const L = K().multiply(Mi, K().multiply(make(op.pivot), M));
    let out;
    if (op.groups && op.groups.length > 1) {
      out = K().clone(op.startMesh);
      for (const g of op.groups) { const Lg = K().multiply(Mi, K().multiply(make(g.pivot), M)); for (const v of g.verts) { const q = K().transformPoint(Lg, vOf(op.startMesh, v)); out.v[v * 3] = q[0]; out.v[v * 3 + 1] = q[1]; out.v[v * 3 + 2] = q[2]; } }
    } else out = K().transformVerts(op.startMesh, op.verts, L);
    // Proportional editing: the vertices round the selection follow, less the further they are.
    if (op.prop) for (const { v, w } of op.prop) {
      const p = vOf(op.startMesh, v), q = K().transformPoint(L, p);
      for (let c = 0; c < 3; c++) out.v[v * 3 + c] = p[c] + (q[c] - p[c]) * w;
    }
    if (op.mirror) mirrorMoved(out);
    o.mesh = out;
  }
  const vOf = (m, i) => [m.v[i * 3], m.v[i * 3 + 1], m.v[i * 3 + 2]];
  /** The selected vertices in parts joined by edges among them, each with its middle in the world. */
  function selectedParts(o, verts) {
    const set = new Set(verts), adj = new Map();
    for (const e of K().edges(o.mesh)) if (set.has(e.a) && set.has(e.b)) { if (!adj.has(e.a)) adj.set(e.a, []); if (!adj.has(e.b)) adj.set(e.b, []); adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
    const seen = new Set(), parts = [];
    for (const v of verts) {
      if (seen.has(v)) continue;
      const part = [v]; seen.add(v);
      for (let i = 0; i < part.length; i++) for (const nb of adj.get(part[i]) || []) if (!seen.has(nb)) { seen.add(nb); part.push(nb); }
      parts.push({ verts: part, pivot: K().vec.scale(part.reduce((a, x) => K().vec.add(a, worldOf(o, x)), [0, 0, 0]), 1 / part.length) });
    }
    return parts;
  }
  const FALLOFFS = { smooth: (t) => t * t * (3 - 2 * t), sphere: (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))), root: (t) => Math.sqrt(t), linear: (t) => t, sharp: (t) => t * t, constant: () => 1 };
  /** The vertices within the proportional radius of the selection (in the world), each with how much it follows. */
  function setupProp() {
    op.prop = null; op.propDist = null;
    if (!editOpts.prop) return;
    const o = op.obj, m = op.startMesh, n = K().vertexCount(m), sel = new Set(op.verts), M = matrixOf(o);
    const selW = op.verts.map((v) => K().transformPoint(M, vOf(m, v)));
    const dist = [];
    for (let i = 0; i < n; i++) {
      if (sel.has(i)) continue;
      const p = K().transformPoint(M, vOf(m, i));
      let d = Infinity;
      for (const q of selW) { const dd = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (dd < d) d = dd; }
      dist.push([i, d]);
    }
    op.propDist = dist;
    weighProp();
  }
  function weighProp() {
    if (!op.propDist) return;
    const r = Math.max(1e-4, editOpts.radius), fall = FALLOFFS[editOpts.falloff] || FALLOFFS.smooth;
    op.prop = op.propDist.filter(([, d]) => d < r).map(([v, d]) => ({ v, w: fall(1 - d / r) }));
  }
  /** Mirror editing: each moved vertex's twin across the chosen axes (in the object's own space). */
  function setupMirror() {
    op.mirror = null;
    const axes = [0, 1, 2].filter((k) => editOpts.mirror[k]);
    if (!axes.length) return;
    const m = op.startMesh, n = K().vertexCount(m), key = (p) => p.map((x) => Math.round(x * 1e4)).join(',');
    const at = new Map();
    for (let i = 0; i < n; i++) at.set(key(vOf(m, i)), i);
    // Every combination of the chosen axes: X; or X, Y and both; …
    const flips = [];
    for (let mask = 1; mask < 1 << axes.length; mask++) flips.push(axes.filter((_, j) => mask & (1 << j)));
    const moved = new Set([...op.verts, ...(op.propDist || []).map(([v]) => v)]);
    const pairs = [];
    for (const v of moved) for (const fl of flips) {
      const p = vOf(m, v).slice(); fl.forEach((k) => { p[k] = -p[k]; });
      const c = at.get(key(p));
      if (c !== undefined && c !== v && !op.verts.includes(c)) pairs.push({ v, c, fl });
    }
    op.mirror = pairs;
  }
  function mirrorMoved(out) {
    for (const { v, c, fl } of op.mirror) {
      const p = vOf(out, v); fl.forEach((k) => { p[k] = -p[k]; });
      for (let k = 0; k < 3; k++) out.v[c * 3 + k] = p[k];
    }
  }
  function setEditOpts(patch, say) {
    editOpts = { ...editOpts, ...patch };
    try { localStorage.setItem('noormd.mesh.editopts', JSON.stringify(editOpts)); } catch { /* not kept */ }
    renderEditOpts();
    if (op && op.edit && op.propDist) { weighProp(); updateOp(); }
    if (say) setStatus(say);
  }
  function renderEditOpts() {
    const pr = $('#nm-prop'); if (pr) pr.setAttribute('aria-pressed', String(!!editOpts.prop));
    const fo = $('#nm-falloff'); if (fo) fo.value = editOpts.falloff;
    document.querySelectorAll('#meshbench [data-mirror]').forEach((b) => b.setAttribute('aria-pressed', String(!!editOpts.mirror[Number(b.dataset.mirror)])));
    const am = $('#nm-automerge'); if (am) am.setAttribute('aria-pressed', String(!!editOpts.autoMerge));
  }
  const togglePropEdit = () => setEditOpts({ prop: !editOpts.prop }, editOpts.prop ? 'Proportional editing off.' : 'Proportional editing on: the wheel (or Page Up / Down) sets its size while moving.');
  const toggleAutoMerge = () => setEditOpts({ autoMerge: !editOpts.autoMerge }, editOpts.autoMerge ? 'Auto merge off.' : 'Auto merge on: vertices moved onto others are merged into them.');
  function toggleMirror(k) { const m = editOpts.mirror.slice(); m[k] = !m[k]; setEditOpts({ mirror: m }, m.some(Boolean) ? `Mirror editing: ${m.map((on, j) => (on ? AXIS_NAMES[j] : '')).filter(Boolean).join(' ')}.` : 'Mirror editing off.'); }
  const translation = (d) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d[0], d[1], d[2], 1];
  function scaleAbout(p, axis, f, plane = null) {
    const s = [1, 1, 1].map((x, k) => (plane != null ? (k === plane ? 1 : f) : axis === null || axis === k ? f : 1));
    return K().multiply(translation(p), K().multiply([s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1], translation(p.map((x) => -x))));
  }
  function rayPlane(r, p, n) { const d = K().vec.dot(n, r.dir); if (Math.abs(d) < 1e-9) return null; const t = K().vec.dot(n, K().vec.sub(p, r.origin)) / d; return K().vec.add(r.origin, K().vec.scale(r.dir, t)); }
  /** Where along a line (through p, along a) a ray from the canvas passes closest. */
  function rayLine(r, p, a) {
    const { dot, sub } = K().vec, w = sub(r.origin, p), b = dot(r.dir, a), d = dot(r.dir, w), e = dot(a, w), den = 1 - b * b;
    return Math.abs(den) < 1e-9 ? 0 : (e - b * d) / den;
  }
  function updateOp() {
    if (!op) return;
    const V = K().vec, typed = op.typed !== '' && op.typed !== '-' && op.typed !== '.' ? Number(op.typed) : null;
    if (op.kind === 'loopcut') { updateLoopCut(); return; }
    if (op.kind === 'slide') { updateSlide(); return; }
    if (op.kind === 'bevel') { updateBevel(); return; }
    if (op.kind === 'knife') { updateKnife(); return; }
    // Steps when snapping is on (Ctrl: free) or off (Ctrl: steps), as Blender's.
    const snap = snapping.on ? !op.ctrl : !!op.ctrl;
    op.snapAt = null;
    const cam = view.camera(), toViewer = V.norm(V.sub(cam.eye, cam.target));
    let text = '';
    // The direction it is held to: an axis, or (after an extrude) the region's normal.
    const along = op.axis !== null ? AXES[op.axis] : op.dir;
    if (op.kind === 'inset') {
      // Thickness: how far the mouse has come in towards the middle, in metres there (typed: metres).
      const c = view.project(op.pivot), d0 = Math.hypot(op.m0.x - c.x, op.m0.y - c.y), d = Math.hypot(mouse.x - c.x, mouse.y - c.y);
      const r = view.ray(c.x, c.y), r2 = view.ray(c.x + 100, c.y);
      const p1 = rayPlane(r, op.pivot, toViewer), p2 = rayPlane(r2, op.pivot, toViewer);
      const perPx = p1 && p2 ? V.len(V.sub(p2, p1)) / 100 : 0.01;
      let t = typed !== null ? Math.max(0, typed) : Math.max(0, d0 - d) * perPx;
      if (snap && typed === null) t = Math.round(t * 100) / 100;
      op.obj.mesh = (op.individual ? K().insetFaces : K().insetRegion)(op.startMesh, op.faces, t).mesh;
      op.thickness = t;
      sync(op.obj); syncEdit();
      view.setGuides([]);
      hud(`Inset${op.individual ? ' (each face)' : ''}: ${fmt(t)} m${op.typed !== '' ? `  [${op.typed}]` : ''}   ·   move towards the middle · I: ${op.individual ? 'as one region' : 'each face by itself'} · type a number · click or Enter: done · right-click or Esc: back`);
      return;
    }
    if (op.kind === 'move') {
      let delta;
      if (typed !== null) delta = V.scale(along || AXES[0], typed);
      else if (along) {
        const a = along, s0 = rayLine(view.ray(op.m0.x, op.m0.y), op.pivot, a), s1 = rayLine(view.ray(mouse.x, mouse.y), op.pivot, a);
        delta = V.scale(a, s1 - s0);
      } else {
        // Free in the view's plane, or in a plane that leaves one axis out (Shift+X/Y/Z, a gizmo's square).
        const n = op.plane != null ? AXES[op.plane] : toViewer;
        const p0 = rayPlane(view.ray(op.m0.x, op.m0.y), op.pivot, n), p1 = rayPlane(view.ray(mouse.x, mouse.y), op.pivot, n);
        delta = p0 && p1 ? V.sub(p1, p0) : [0, 0, 0];
        if (op.plane != null) delta[op.plane] = 0;
      }
      if (snap && typed === null && snapping.mode === 'vertex') {
        // Onto the vertex nearest the mouse (not one being moved): the selection's middle goes there, held to its axis or plane.
        const target = snapTarget();
        if (target) {
          let d = V.sub(target.p, op.pivot);
          if (along) d = V.scale(along, V.dot(d, along));
          else if (op.plane != null) d[op.plane] = 0;
          delta = d; op.snapAt = target.at;
        }
      } else if (snap && typed === null) delta = delta.map((x) => Math.round(x * 10) / 10);
      if (op.edit) applyEdit(translation(delta));
      else op.list.forEach((o, i) => { o.t = V.add(op.start[i].t, delta); });
      text = op.prop ? `Proportional ${fmt(editOpts.radius)} m   ·   ` : '';
      text += op.axis !== null ? `Move ${AXIS_NAMES[op.axis]}: ${fmt(delta[op.axis])} m` : op.plane != null ? `Move (not ${AXIS_NAMES[op.plane]}): ${delta.map(fmt).join(', ')} m` : op.dir ? `Move along the normal: ${fmt(V.dot(delta, op.dir))} m` : `Move: ${delta.map(fmt).join(', ')} m`;
    } else if (op.kind === 'rotate') {
      const c = view.project(op.pivot);
      const ang = (p) => Math.atan2(-(p.y - c.y), p.x - c.x);
      let deg = typed !== null ? typed : ((ang(mouse) - ang(op.m0)) * 180) / Math.PI;
      if (typed === null) { deg = ((deg + 540) % 360) - 180; if (snap) deg = Math.round(deg / 5) * 5; }
      let axis = toViewer;
      if (op.axis !== null) { axis = AXES[op.axis]; if (typed === null && V.dot(axis, toViewer) < 0) deg = -deg; }
      if (op.edit) applyEdit((pv) => K().rotationAbout(axis, deg, pv));
      else op.list.forEach((o, i) => { const R = K().rotationAbout(axis, deg, op.indiv ? op.start[i].t : op.pivot), d = K().decompose(K().multiply(R, op.start[i].m)); o.t = d.t; o.r = d.r; o.s = op.start[i].s.slice(); });
      text = `Rotate${op.axis !== null ? ' ' + AXIS_NAMES[op.axis] : ''}: ${fmt(deg)}°`;
      if (op.prop) text += `   ·   proportional ${fmt(editOpts.radius)} m`;
    } else {
      const c = view.project(op.pivot);
      const d0 = Math.max(4, Math.hypot(op.m0.x - c.x, op.m0.y - c.y));
      let f = typed !== null ? typed : Math.hypot(mouse.x - c.x, mouse.y - c.y) / d0;
      if (snap && typed === null) f = Math.round(f * 10) / 10;
      if (op.edit) applyEdit((pv) => scaleAbout(pv, op.axis, f, op.plane));
      else op.list.forEach((o, i) => {
        const st = op.start[i], pivotHere = op.indiv ? st.t : op.pivot;
        if (op.plane != null) {
          // Two world axes: the object's own axes that lie most along each are scaled.
          const m = st.m, cols = [0, 1, 2].map((k) => V.norm([m[k * 4], m[k * 4 + 1], m[k * 4 + 2]]));
          const most = cols.map((v) => Math.abs(V.dot(v, AXES[op.plane]))).reduce((b, v, j, a) => (v > a[b] ? j : b), 0);
          o.s = st.s.map((x, j) => (j === most ? x : x * f));
          o.t = st.t.map((x, j) => (j === op.plane ? x : pivotHere[j] + (x - pivotHere[j]) * f));
        } else if (op.axis === null) { o.s = st.s.map((x) => x * f); o.t = st.t.map((x, k) => pivotHere[k] + (x - pivotHere[k]) * f); }
        else {
          // Along one world axis: the object's own axis that lies most along it is scaled (an object has no shear).
          const m = st.m, cols = [0, 1, 2].map((k) => V.norm([m[k * 4], m[k * 4 + 1], m[k * 4 + 2]]));
          const k = cols.map((v) => Math.abs(V.dot(v, AXES[op.axis]))).reduce((b, v, j, a) => (v > a[b] ? j : b), 0);
          o.s = st.s.map((x, j) => (j === k ? x * f : x));
          o.t = st.t.map((x, j) => (j === op.axis ? pivotHere[j] + (x - pivotHere[j]) * f : x));
        }
      });
      text = op.plane != null ? `Scale (not ${AXIS_NAMES[op.plane]}): ${fmt(f)}` : `Scale${op.axis !== null ? ' ' + AXIS_NAMES[op.axis] : ''}: ${fmt(f)}`;
      if (op.prop) text += `   ·   proportional ${fmt(editOpts.radius)} m`;
    }
    if (op.typed !== '') text += `  [${op.typed}]`;
    if (op.edit) { sync(op.obj); syncEdit(); } else op.list.forEach(sync);
    // The axis (or normal) it is held to, as a long line through the pivot.
    const guide = op.axis !== null ? [AXES[op.axis], AXIS_COLOURS[op.axis]] : op.dir && op.kind === 'move' ? [op.dir, [1, 1, 1, 0.8]] : null;
    const lines = guide ? [guide] : op.plane != null && (op.kind === 'move' || op.kind === 'scale') ? [0, 1, 2].filter((k) => k !== op.plane).map((k) => [AXES[k], AXIS_COLOURS[k]]) : [];
    view.setGuides(lines.map(([a, c]) => ({ from: V.add(op.pivot, V.scale(a, -1000)), to: V.add(op.pivot, V.scale(a, 1000)), color: c })));
    hud(`${text}   ·   X Y Z or middle-drag: an axis · type a number · click or Enter: done · right-click or Esc: back`);
  }
  /** While the middle button is held in a transform: the world axis whose direction on the screen is nearest the mouse's movement. */
  function pickAxis() {
    const m = op.mmb, dx = mouse.x - m.x, dy = mouse.y - m.y, d = Math.hypot(dx, dy);
    if (d < 8) return;
    m.moved = true;
    const c = view.project(op.pivot);
    const scale = Math.max(0.1, K().vec.len(K().vec.sub(view.camera().eye, op.pivot)) * 0.1);
    let best = null, bestDot = -1;
    AXES.forEach((a, k) => {
      const p = view.project(K().vec.add(op.pivot, K().vec.scale(a, scale)));
      const ax = p.x - c.x, ay = p.y - c.y, l = Math.hypot(ax, ay);
      if (l < 2) return; // pointing at the camera: no direction on the screen
      const dot = Math.abs((ax * dx + ay * dy) / (l * d));
      if (dot > bestDot) { bestDot = dot; best = k; }
    });
    if (best !== null) op.axis = best;
  }
  const fmt = (x) => (Math.abs(x) < 1e-9 ? '0' : (Math.round(x * 1000) / 1000).toString());
  function confirmOp() {
    if (!op) return;
    if (op.kind === 'loopcut' && !op.result) { cancelOp(); return; }
    if (op.kind === 'knife') { finishKnife(); return; }
    if (op.edit && editOpts.autoMerge && ['move', 'rotate', 'scale', 'slide'].includes(op.kind)) {
      const moved = [...op.verts, ...(op.prop || []).map((x) => x.v), ...(op.mirror || []).map((x) => x.c)];
      const r = K().autoMerge(op.obj.mesh, moved, editOpts.mergeDist);
      if (r.merged) {
        op.obj.mesh = r.mesh;
        editSel = K().selectionFromVerts(r.mesh, [...K().flush(op.startMesh, editSel).verts].map((v) => r.map[v]).filter((v) => v >= 0), editSel.mode);
        sync(op.obj);
        setTimeout(() => setStatus(`Auto merge: ${r.merged} merged.`), 0);
      }
    }
    const done = op;
    op = null;
    view.setGuides([]);
    // One undo step: the scene as it was when the transform began (a duplicate's or extrude's step is that itself).
    if (!done.fromDuplicate && done.before) { history.push(done.before); if (history.length > 200) history.shift(); future = []; }
    changed();
    lastAdd = null;
    if (done.edit) syncEdit();
    hud(''); renderAll();
  }
  function cancelOp() {
    if (!op) return;
    const done = op;
    op = null;
    if (done.edit) done.obj.mesh = done.startMesh;
    if (done.sel0) editSel = done.sel0;
    if (done.edit) syncEdit();
    else done.list.forEach((o, i) => { o.t = done.start[i].t; o.r = done.start[i].r; o.s = done.start[i].s; });
    if (view) view.setGuides([]);
    syncAll(); hud(''); renderProps();
  }
  // ---------------------------------------------------------------- snapping
  function setSnapping(patch) {
    snapping = { ...snapping, ...patch };
    try { localStorage.setItem('noormd.mesh.snap', JSON.stringify(snapping)); } catch { /* not kept */ }
    renderSnap();
    if (op) updateOp();
    setStatus(snapping.on ? (snapping.mode === 'vertex' ? 'Snapping on: moving snaps to the vertex nearest the mouse (Ctrl: free).' : 'Snapping on: steps of 0.1 m, 5°, 0.1 (Ctrl: free).') : 'Snapping off (Ctrl: steps).');
  }
  function renderSnap() {
    const b = $('#nm-snap'), m = $('#nm-snapmode');
    if (b) b.setAttribute('aria-pressed', String(!!snapping.on));
    if (m) m.value = snapping.mode;
  }
  /** The vertex (of any shown object, not one being moved) nearest the mouse on the screen, within reach: { p: world, at: [x, y] client } or null. */
  function snapTarget(reach = 24) {
    let best = null, bestD = reach;
    const moving = op && op.edit ? new Set(op.verts) : null;
    for (const o of objects) {
      if (o.hidden || (op && !op.edit && op.list.includes(o))) continue;
      const m = matrixOf(o), mesh = op && op.edit && o === op.obj ? op.startMesh : o.mesh, n = K().vertexCount(mesh);
      for (let i = 0; i < n; i++) {
        if (moving && o === op.obj && moving.has(i)) continue;
        const p = K().transformPoint(m, [mesh.v[i * 3], mesh.v[i * 3 + 1], mesh.v[i * 3 + 2]]), sc = view.project(p);
        if (!sc.front) continue;
        const d = Math.hypot(sc.x - mouse.x, sc.y - mouse.y);
        if (d < bestD) { bestD = d; best = { p, at: [sc.x, sc.y] }; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- loop cut (Ctrl+R), as Blender's
  function loopCutStart() {
    const o = editing();
    if (!o) return;
    cancelOp();
    op = { kind: 'loopcut', edit: true, obj: o, startMesh: o.mesh, verts: [], faces: new Set(), pivot: [0, 0, 0], m0: { ...mouse }, axis: null, typed: '', phase: 'pick', cuts: 1, factor: 0.5, edge: null, result: null, sel0: K().cloneSelection(editSel), before: snapshot() };
    updateOp();
  }
  function updateLoopCut() {
    const o = op.obj;
    if (op.phase === 'pick') {
      o.mesh = op.startMesh;
      const ed = pickEdge(o, mouse.x, mouse.y, 24);
      op.edge = ed && K().loopRing(op.startMesh, ed[0], ed[1]).faces.size ? ed : null;
    } else if (op.phase === 'slide') {
      // Sliding: how far the mouse has gone along the edge since the click.
      const [a, b] = op.edge, A = view.project(worldOf({ ...o, mesh: op.startMesh }, a)), B = view.project(worldOf({ ...o, mesh: op.startMesh }, b));
      const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1;
      const t = (p) => ((p.x - A.x) * dx + (p.y - A.y) * dy) / l2;
      op.factor = Math.max(0.01, Math.min(0.99, 0.5 + t(mouse) - t(op.m0)));
    }
    const cuts = op.typed !== '' && Number(op.typed) >= 1 ? Math.min(64, Math.round(Number(op.typed))) : op.cuts;
    if (op.edge) {
      const r = K().loopCut(op.startMesh, op.edge[0], op.edge[1], cuts, op.factor);
      o.mesh = r.mesh; op.result = r;
      const es = { mode: 'edge', verts: new Set(), edges: new Set(r.edges), faces: new Set() };
      editSel = editSel.mode === 'vert' ? { ...K().flush(r.mesh, es), mode: 'vert', edges: new Set(), faces: new Set() } : { ...es, mode: editSel.mode === 'face' ? 'edge' : editSel.mode };
      if (op.sel0.mode === 'face') editSel = K().emptySelection('face'); // as Blender: a loop of edges selects no faces
    } else { o.mesh = op.startMesh; op.result = null; editSel = K().cloneSelection(op.sel0); }
    sync(o); syncEdit();
    view.setGuides([]);
    hud(op.phase === 'pick'
      ? `Loop cut: ${cuts} cut${cuts === 1 ? '' : 's'}${op.typed !== '' ? `  [${op.typed}]` : ''}   ·   point at an edge · wheel, + or −, or a number: how many · click: place, then slide · right-click or Esc: back`
      : `Slide: ${fmt(op.factor)}   ·   move along the edge · click or Enter: done · right-click: in the middle · Esc: back`);
  }
  function loopCutDown(e) {
    if (e.button === 0) {
      if (op.phase === 'pick') { if (!op.edge) return; op.phase = 'slide'; op.m0 = { x: e.clientX, y: e.clientY }; updateOp(); return; }
      finishLoopCut(); return;
    }
    // Right-click while sliding: the cut stays in the middle (as Blender's); before placing: back.
    if (e.button === 2) { if (op.phase === 'slide') { op.phase = 'fixed'; op.factor = 0.5; updateOp(); finishLoopCut(); } else cancelOp(); }
  }
  function finishLoopCut() {
    if (!op || !op.result) { cancelOp(); return; }
    op.sel0 = null;
    confirmOp();
    setStatus('Loop cut.');
  }
  function loopCutKey(e) {
    const k = e.key;
    if (k === 'Escape') { cancelOp(); return true; }
    if (k === 'Enter') { finishLoopCut(); return true; }
    if (k === '+' || k === '=' || e.code === 'NumpadAdd' || k === 'PageUp') { op.typed = ''; op.cuts = Math.min(64, op.cuts + 1); updateOp(); return true; }
    if (k === '-' || e.code === 'NumpadSubtract' || k === 'PageDown') { op.typed = ''; op.cuts = Math.max(1, op.cuts - 1); updateOp(); return true; }
    if (/^[0-9]$/.test(k) && op.phase === 'pick') { op.typed += k; updateOp(); return true; }
    if (k === 'Backspace') { op.typed = op.typed.slice(0, -1); updateOp(); return true; }
    return true; // nothing else while cutting
  }
  function loopCutWheel(e) {
    // Proportional editing: the wheel sets its size while moving, rotating or scaling.
    if (op && op.edit && op.propDist && ['move', 'rotate', 'scale'].includes(op.kind)) { e.preventDefault(); e.stopPropagation(); setEditOpts({ radius: Math.max(0.001, editOpts.radius * (e.deltaY < 0 ? 1 / 1.15 : 1.15)) }); return; }
    if (op && op.kind === 'bevel') { e.preventDefault(); e.stopPropagation(); op.segments = Math.max(1, Math.min(32, op.segments + (e.deltaY < 0 ? 1 : -1))); updateOp(); return; }
    if (!op || op.kind !== 'loopcut' || op.phase !== 'pick') return;
    e.preventDefault(); e.stopPropagation();
    op.typed = ''; op.cuts = Math.max(1, Math.min(64, op.cuts + (e.deltaY < 0 ? 1 : -1)));
    updateOp();
  }

  // ---------------------------------------------------------------- bridge edge loops
  function bridge() {
    const f = flushed();
    if (!f || f.edges.size < 2) { setStatus('Select two edge loops (or two faces) to bridge.'); return; }
    editStep((m) => {
      const r = K().bridgeLoops(m, editSel);
      if (r.error) { setStatus(r.error === 'counts' ? 'Bridge: both loops need the same number of edges.' : 'Bridge: select exactly two loops of edges (or two faces).'); return null; }
      return { mesh: r.mesh, sel: K().selectionFromFaces(r.mesh, r.faces, editSel.mode) };
    }, 'Bridged.');
  }
  function edgeMenu(x = mouse.x, y = mouse.y) {
    const f = flushed(), none = !f || !f.edges.size;
    popup(x, y, 'Edge', [
      { label: 'Loop cut and slide', keys: 'Ctrl+R', run: loopCutStart },
      { label: 'Bevel edges', keys: 'Ctrl+B', run: () => bevelStart(false), disabled: none },
      { label: 'Edge slide', keys: 'G G', run: () => { startOp('move'); if (op && op.edit) startSlide(); }, disabled: none },
      { label: 'Bridge edge loops', run: bridge, disabled: none },
      { label: 'Extrude edges', keys: 'E', run: extrude, disabled: none },
      { label: 'Dissolve edges', keys: 'Ctrl+X', run: dissolveSel, disabled: none },
    ]);
  }

  // ---------------------------------------------------------------- slide (G twice), as Blender's vertex and edge slide
  function startSlide() {
    const o = op.obj, startMesh = op.startMesh, before = op.before;
    o.mesh = startMesh;
    const sides = K().slideSides(startMesh, editSel);
    const edgeSlide = [...sides.values()].some((x) => x.a !== undefined || x.b !== undefined);
    op = { kind: 'slide', edit: true, obj: o, startMesh, verts: [...sides.keys()], faces: new Set(), pivot: op.pivot, m0: { ...mouse }, axis: null, typed: '', fromDuplicate: false, before, sides, edgeSlide, even: false, flip: false, f: 0 };
    if (edgeSlide) {
      // The vertex nearest the mouse leads (its edges on the screen say how far along).
      let best = null, bestD = Infinity;
      for (const [v, sd] of sides) { if (sd.a === undefined && sd.b === undefined) continue; const sc = view.project(worldOf({ ...o, mesh: startMesh }, v)); const d = Math.hypot(sc.x - mouse.x, sc.y - mouse.y); if (d < bestD) { bestD = d; best = v; } }
      op.lead = best;
    }
    updateOp();
  }
  function updateSlide() {
    const o = op.obj, m = op.startMesh, W = (v) => worldOf({ ...o, mesh: m }, v), S = (v) => view.project(W(v));
    const out = K().clone(m), dx = mouse.x - op.m0.x, dy = mouse.y - op.m0.y;
    const typed = op.typed !== '' && op.typed !== '-' && op.typed !== '.' ? Math.max(-1, Math.min(1, Number(op.typed))) : null;
    const put = (v, p) => { out.v[v * 3] = p[0]; out.v[v * 3 + 1] = p[1]; out.v[v * 3 + 2] = p[2]; };
    if (op.edgeSlide) {
      const sd = op.sides.get(op.lead), sv = S(op.lead);
      const along = (nb) => { if (nb === undefined) return -1; const t = S(nb), ex = t.x - sv.x, ey = t.y - sv.y, l2 = ex * ex + ey * ey || 1; return (dx * ex + dy * ey) / l2; };
      let f = typed;
      if (f === null) { const ta = along(sd.a); f = ta >= 0 ? Math.min(1, ta) : -Math.min(1, Math.max(0, along(sd.b))); }
      if (op.flip) f = -f;
      op.f = f;
      const sideOf = (x) => (f >= 0 ? x.a : x.b);
      const leadT = sideOf(sd), refLen = leadT === undefined ? 0 : K().vec.len(K().vec.sub(vOf(m, leadT), vOf(m, op.lead)));
      for (const [v, x] of op.sides) {
        const t = sideOf(x);
        if (t === undefined) continue;
        const p = vOf(m, v), q = vOf(m, t), d = K().vec.sub(q, p), L = K().vec.len(d) || 1;
        put(v, op.even ? K().vec.add(p, K().vec.scale(d, Math.min(1, (Math.abs(f) * refLen) / L))) : K().vec.add(p, K().vec.scale(d, Math.abs(f))));
      }
      hud(`Edge slide: ${fmt(f)}${op.even ? ' (even)' : ''}${op.typed !== '' ? `  [${op.typed}]` : ''}   ·   move along the edges · E: even · F: flip · click or Enter: done · right-click or Esc: back`);
    } else {
      // Vertex slide: each along its edge that runs most the way the mouse has gone.
      const md = Math.hypot(dx, dy);
      let shown = 0;
      for (const [v, x] of op.sides) {
        const sv = S(v);
        let best = null, bestDot = 0.3;
        for (const nb of x.all || []) { const t = S(nb), ex = t.x - sv.x, ey = t.y - sv.y, l = Math.hypot(ex, ey); if (l < 1 || md < 2) continue; const c = (dx * ex + dy * ey) / (l * md); if (c > bestDot) { bestDot = c; best = [nb, ex, ey, l]; } }
        if (!best) continue;
        const [nb, ex, ey, l] = best, t = typed !== null ? Math.abs(typed) : Math.max(0, Math.min(1, (dx * ex + dy * ey) / (l * l)));
        const p = vOf(m, v), q = vOf(m, nb);
        put(v, K().vec.add(p, K().vec.scale(K().vec.sub(q, p), t)));
        shown = t;
      }
      op.f = shown;
      hud(`Vertex slide: ${fmt(shown)}   ·   move towards a neighbour · click or Enter: done · right-click or Esc: back`);
    }
    o.mesh = out;
    sync(o); syncEdit();
    view.setGuides([]);
  }
  function slideKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'escape') { cancelOp(); return true; }
    if (k === 'enter') { confirmOp(); return true; }
    if (k === 'e' || k === 'c') { op.even = !op.even; updateOp(); return true; }
    if (k === 'f') { op.flip = !op.flip; updateOp(); return true; }
    if (/^[0-9.]$/.test(k) || (k === '-' && op.typed === '')) { op.typed += k; updateOp(); return true; }
    if (k === 'backspace') { op.typed = op.typed.slice(0, -1); updateOp(); return true; }
    return true;
  }

  // ---------------------------------------------------------------- bevel (Ctrl+B; Ctrl+Shift+B: vertices)
  function bevelStart(vertices = false) {
    const o = editing(), f = flushed();
    if (!o || !f) return;
    if (!vertices && !f.edges.size && f.verts.size) vertices = true;
    if (vertices ? !f.verts.size : !f.edges.size) { setStatus('Select edges (or vertices) to bevel.'); return; }
    cancelOp();
    const verts = [...f.verts], pivot = K().vec.scale(verts.reduce((a, v) => K().vec.add(a, worldOf(o, v)), [0, 0, 0]), 1 / verts.length);
    op = { kind: 'bevel', edit: true, obj: o, startMesh: o.mesh, verts: [], faces: new Set(), pivot, m0: { ...mouse }, axis: null, typed: '', segments: 1, vertices, sel0: K().cloneSelection(editSel), before: snapshot(), width: 0 };
    updateOp();
  }
  function updateBevel() {
    const V = K().vec, cam = view.camera(), toViewer = V.norm(V.sub(cam.eye, cam.target));
    const c = view.project(op.pivot), d0 = Math.hypot(op.m0.x - c.x, op.m0.y - c.y), d = Math.hypot(mouse.x - c.x, mouse.y - c.y);
    const p1 = rayPlane(view.ray(c.x, c.y), op.pivot, toViewer), p2 = rayPlane(view.ray(c.x + 100, c.y), op.pivot, toViewer);
    const perPx = p1 && p2 ? V.len(V.sub(p2, p1)) / 100 : 0.01;
    const typed = op.typed !== '' && op.typed !== '.' ? Number(op.typed) : null;
    let w = typed !== null ? Math.max(0, typed) : Math.max(0, d - d0) * perPx;
    if ((snapping.on ? !op.ctrl : op.ctrl) && typed === null) w = Math.round(w * 100) / 100;
    op.width = w;
    const r = K().bevel(op.startMesh, op.sel0, w, op.segments, op.vertices);
    op.obj.mesh = r.mesh; op.result = r;
    editSel = w > 0 && r.faces.length ? K().selectionFromFaces(r.mesh, r.faces, op.sel0.mode) : K().cloneSelection(op.sel0);
    sync(op.obj); syncEdit();
    view.setGuides([]);
    hud(`Bevel${op.vertices ? ' vertices' : ''}: ${fmt(w)} m · ${op.segments} segment${op.segments === 1 ? '' : 's'}${op.typed !== '' ? `  [${op.typed}]` : ''}   ·   move away from the middle · wheel or + −: segments · V: vertices or edges · click or Enter: done · right-click or Esc: back`);
  }
  function bevelKey(e) {
    const k = e.key;
    if (k === 'Escape') { cancelOp(); return true; }
    if (k === 'Enter') { op.sel0 = null; confirmOp(); return true; }
    if (k === '+' || k === '=' || e.code === 'NumpadAdd' || k === 'PageUp') { op.segments = Math.min(32, op.segments + 1); updateOp(); return true; }
    if (k === '-' || e.code === 'NumpadSubtract' || k === 'PageDown') { op.segments = Math.max(1, op.segments - 1); updateOp(); return true; }
    if (k.toLowerCase() === 'v') { op.vertices = !op.vertices; updateOp(); return true; }
    if (/^[0-9.]$/.test(k)) { op.typed += k; updateOp(); return true; }
    if (k === 'Backspace') { op.typed = op.typed.slice(0, -1); updateOp(); return true; }
    return true;
  }

  // ---------------------------------------------------------------- knife (K), as Blender's: points on the surface
  // Each point is kept on the mesh itself (a vertex, a place on an edge, or inside a face, in the object's own space), so
  // turning, moving or zooming the view leaves it where it was put; between two points the cut runs over the surface.
  function knifeStart() {
    const o = editing();
    if (!o) return;
    cancelOp();
    op = { kind: 'knife', edit: true, obj: o, startMesh: o.mesh, verts: [], faces: new Set(), pivot: [0, 0, 0], m0: { ...mouse }, axis: null, typed: '', pts: [], walks: [], sel0: K().cloneSelection(editSel), before: snapshot() };
    updateOp();
  }
  /** Where the camera's eye is in the object's own space (for an orthographic view: far back along the view, from p). */
  function knifeEye(pLocal) {
    const o = op.obj, cam = view.camera(), Mi = invertOf(o), V = K().vec;
    if (!cam.ortho) return K().transformPoint(Mi, cam.eye);
    const pw = K().transformPoint(matrixOf(o), pLocal), dir = V.norm(V.sub(cam.target, cam.eye));
    return K().transformPoint(Mi, V.sub(pw, V.scale(dir, 1000)));
  }
  /** The point of the surface under the mouse: onto a vertex, an edge's middle or the edge when near; else on the face hit. */
  function knifePoint(x, y) {
    const o = op.obj, m = op.startMesh, V = K().vec, M = matrixOf(o);
    const v = pickVert(o, x, y, 10);
    if (v >= 0) return { c: { v }, snap: 'vertex' };
    const ed = pickEdge(o, x, y, 8);
    if (ed) {
      const [a, b] = ed, pa = K().transformPoint(M, vOf(m, a)), pb = K().transformPoint(M, vOf(m, b));
      const mid = view.project(V.scale(V.add(pa, pb), 0.5));
      if (Math.hypot(mid.x - x, mid.y - y) <= 10) return { c: { a, b, t: 0.5 }, snap: 'middle' };
      // Where the ray through the mouse passes nearest the edge.
      const ray = view.ray(x, y), d = V.sub(pb, pa), L2 = V.dot(d, d) || 1, w0 = V.sub(ray.origin, pa), bb = V.dot(ray.dir, d), dd = V.dot(ray.dir, w0), ee = V.dot(d, w0), den = L2 - bb * bb;
      const t = Math.max(0, Math.min(1, Math.abs(den) < 1e-12 ? 0.5 : (ee - bb * dd) / den));
      if (t < 0.01) return { c: { v: a }, snap: 'vertex' };
      if (t > 0.99) return { c: { v: b }, snap: 'vertex' };
      return { c: { a, b, t }, snap: 'edge' };
    }
    const hit = view.pick(x, y, o.id);
    if (!hit || hit.face === undefined || hit.face < 0) return null;
    const ray = view.ray(x, y), pw = V.add(ray.origin, V.scale(ray.dir, hit.t));
    return { c: { f: hit.face, p: K().transformPoint(invertOf(o), pw) }, snap: 'face' };
  }
  const knifeWorld = (c) => K().transformPoint(matrixOf(op.obj), K().knifePos(op.startMesh, c));
  /** The whole cut as points over the surface: the placed points with the ways between them, and on to `extra`. */
  function knifeAll(extra) {
    const out = [];
    op.pts.forEach((p, i) => { if (i === 0) out.push(p.c); else out.push(...op.walks[i].slice(1)); });
    if (extra && op.pts.length) out.push(...K().knifeWalk(op.startMesh, op.pts[op.pts.length - 1].c, extra.c, knifeEye(K().knifePos(op.startMesh, extra.c))).slice(1));
    return out;
  }
  function updateKnife() {
    op.hover = knifePoint(mouse.x, mouse.y);
    op.path = knifeAll(op.hover);
    op.cross = op.path.filter((c) => c.a !== undefined).length;
    view.setGuides([]);
    drawGizmo();
    const snapName = op.hover ? { vertex: 'on a vertex', middle: 'on an edge\'s middle', edge: 'on an edge', face: 'on a face' }[op.hover.snap] : 'off the mesh';
    hud(`Knife: ${op.pts.length} point${op.pts.length === 1 ? '' : 's'} · ${op.cross} crossing${op.cross === 1 ? '' : 's'} · ${snapName}   ·   click: a point · Enter or Space: cut · Backspace: the last point back · middle-drag, wheel: the view · right-click or Esc: back`);
  }
  /** The knife drawn over the view from its points on the mesh (again after every frame, wherever the camera is). */
  function drawKnife(g, s) {
    if (!op || op.kind !== 'knife') return;
    const pr = (c) => { const q = view.project(knifeWorld(c)); return q.front ? [q.x - s.left, q.y - s.top] : null; };
    const path = op.path || knifeAll(op.hover);
    g.lineWidth = 2;
    const placed = knifeAll(null).length;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = pr(path[i]), b = pr(path[i + 1]);
      if (!a || !b) continue;
      g.strokeStyle = i + 1 < placed ? '#5cff7a' : 'rgba(92,255,122,.6)';
      g.setLineDash(i + 1 < placed ? [] : [5, 4]);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    g.setLineDash([]);
    for (const c of path) { const a = pr(c); if (!a || c.f !== undefined) continue; g.fillStyle = '#ffd34d'; g.fillRect(a[0] - 3, a[1] - 3, 6, 6); }
    for (const p of op.pts) { const a = pr(p.c); if (a) { g.fillStyle = '#5cff7a'; g.beginPath(); g.arc(a[0], a[1], 4.5, 0, Math.PI * 2); g.fill(); } }
    if (op.hover) {
      const a = pr(op.hover.c);
      if (a) { g.strokeStyle = { vertex: '#ffffff', middle: '#4dd6ff', edge: '#ffd34d', face: '#5cff7a' }[op.hover.snap]; g.lineWidth = 2; g.beginPath(); g.arc(a[0], a[1], 6, 0, Math.PI * 2); g.stroke(); }
    }
  }
  function knifeDown(e) {
    if (e.button === 0) {
      const p = knifePoint(e.clientX, e.clientY);
      if (!p) { setStatus('Knife: click on the mesh.'); return; }
      const last = op.pts[op.pts.length - 1];
      if (last && K().knifeWalk(op.startMesh, last.c, p.c, [0, 0, 0]).length < 2) return; // the same point again
      op.walks.push(last ? K().knifeWalk(op.startMesh, last.c, p.c, knifeEye(K().knifePos(op.startMesh, p.c))) : [p.c]);
      op.pts.push(p);
      updateOp(); return;
    }
    if (e.button === 2) cancelOp();
  }
  function knifeKey(e) {
    const k = e.key;
    if (k === 'Escape') { cancelOp(); return true; }
    if (k === 'Enter' || k === ' ') { finishKnife(); return true; }
    if (k === 'Backspace') { op.pts.pop(); op.walks.pop(); updateOp(); return true; }
    // The views stay at hand while cutting.
    const views = { Numpad1: 'front', Numpad3: 'right', Numpad7: 'top', Numpad5: 'persp' };
    if (views[e.code]) { setView(views[e.code], e.ctrlKey); updateOp(); return true; }
    return true;
  }
  function finishKnife() {
    const path = op.pts.length > 1 ? knifeAll(null) : [];
    const r = path.length > 1 ? K().knifePath(op.startMesh, path) : null;
    if (!r || !r.edges.length) { cancelOp(); setStatus('Knife: nothing cut. Click points on the mesh, across faces (from an edge or vertex to another), then Enter.'); return; }
    const done = op;
    op = null;
    done.obj.mesh = r.mesh;
    editSel = K().convertSelection(r.mesh, { mode: 'edge', verts: new Set(), edges: new Set(r.edges), faces: new Set() }, editSel.mode === 'face' ? 'edge' : editSel.mode);
    if (editSel.mode === 'vert') editSel = K().selectionFromVerts(r.mesh, r.verts, 'vert');
    history.push(done.before); if (history.length > 200) history.shift(); future = [];
    changed(); sync(done.obj); syncEdit(); hud(''); renderAll(); drawGizmo();
    setStatus(`Knife: ${r.edges.length} cut${r.edges.length === 1 ? '' : 's'}.`);
  }

  // ---------------------------------------------------------------- the 3D cursor, pivot point, snap menu (Shift+S)
  /** Shift+right-click: the cursor onto the surface under the mouse (or, off every object, in the view's plane through it). */
  function placeCursor(x, y) {
    const r = view.ray(x, y), hit = view.pick(x, y), V = K().vec;
    let p = hit ? V.add(r.origin, V.scale(r.dir, hit.t)) : null;
    if (!p) { const cam = view.camera(); p = rayPlane(r, cursor, V.norm(V.sub(cam.eye, cam.target))); }
    if (!p) return;
    setCursor(p);
  }
  function setCursor(p, say) {
    cursor = p.map((x) => (Math.abs(x) < 1e-12 ? 0 : x));
    drawGizmo(); renderProps();
    setStatus(say || `3D cursor at ${cursor.map(fmt).join(', ')} m`);
  }
  /** The middle of what is selected, in the world (vertices in Edit Mode, objects' origins in Object Mode); null: nothing. */
  function selectionMiddle() {
    if (mode === 'edit') { const o = editing(), f = flushed(); if (!o || !f || !f.verts.size) return null; return K().vec.scale([...f.verts].reduce((a, v) => K().vec.add(a, worldOf(o, v)), [0, 0, 0]), 1 / f.verts.size); }
    const list = sel();
    return list.length ? pivotOf(list) : null;
  }
  function selectionToCursor(keepOffset) {
    const mid = selectionMiddle();
    if (!mid) { setStatus('Select something first.'); return; }
    if (mode === 'edit') {
      const o = editing(), f = flushed(), Mi = invertOf(o), V = K().vec, d = V.sub(cursor, mid);
      editStep((m) => {
        const out = K().clone(m);
        for (const v of f.verts) { const w = keepOffset ? V.add(worldOf(o, v), d) : cursor, q = K().transformPoint(Mi, w); out.v[v * 3] = q[0]; out.v[v * 3 + 1] = q[1]; out.v[v * 3 + 2] = q[2]; }
        return { mesh: out };
      }, keepOffset ? 'Selection moved to the cursor (its shape kept).' : 'Selection moved to the cursor.');
      return;
    }
    pushHistory();
    const d = K().vec.sub(cursor, mid);
    sel().forEach((o) => { o.t = keepOffset ? K().vec.add(o.t, d) : cursor.slice(); });
    syncAll(); renderAll();
    setStatus(keepOffset ? 'Selection moved to the cursor (spacing kept).' : 'Selection moved to the cursor.');
  }
  function snapMenu(x = mouse.x, y = mouse.y) {
    const none = !selectionMiddle();
    popup(x, y, 'Snap', [
      { label: 'Selection to cursor', run: () => selectionToCursor(false), disabled: none },
      { label: 'Selection to cursor (keep offset)', run: () => selectionToCursor(true), disabled: none },
      '-',
      { label: 'Cursor to selected', run: () => { const m = selectionMiddle(); if (m) setCursor(m); }, disabled: none },
      { label: 'Cursor to active', run: () => { const o = byId(active); if (o) setCursor(o.t.slice()); }, disabled: !byId(active) },
      { label: 'Cursor to world origin', run: () => setCursor([0, 0, 0]) },
      { label: 'Cursor to grid', run: () => setCursor(cursor.map((v) => Math.round(v))) },
    ]);
  }
  const PIVOTS = [['median', 'Median point'], ['cursor', '3D cursor'], ['individual', 'Individual origins'], ['active', 'Active element']];
  function setPivot(m) {
    pivotMode = m;
    try { localStorage.setItem('noormd.mesh.pivot', m); } catch { /* not kept */ }
    const p = $('#nm-pivot'); if (p) p.value = m;
    drawGizmo();
    setStatus(`Pivot point: ${(PIVOTS.find((x) => x[0] === m) || PIVOTS[0])[1]}.`);
  }
  function pivotMenu(x = mouse.x, y = mouse.y) {
    popup(x, y, 'Pivot point', PIVOTS.map(([m, label]) => ({ label: (pivotMode === m ? '● ' : '') + label, run: () => setPivot(m) })));
  }

  // ---------------------------------------------------------------- join (Ctrl+J), separate (P), origins
  function join() {
    const list = sel(), target = byId(active);
    if (list.length < 2 || !target || !list.includes(target)) { setStatus('Select the objects to join, the one to keep last (active).'); return; }
    pushHistory();
    const Ti = invertOf(target), mesh = K().clone(target.mesh);
    for (const o of list) {
      if (o === target) continue;
      const L = K().multiply(Ti, matrixOf(o)), base = K().vertexCount(mesh);
      // A mirrored placement (a negative scale) turns faces inside out: turned back.
      const det = L[0] * (L[5] * L[10] - L[6] * L[9]) - L[4] * (L[1] * L[10] - L[2] * L[9]) + L[8] * (L[1] * L[6] - L[2] * L[5]);
      for (let i = 0; i < K().vertexCount(o.mesh); i++) mesh.v.push(...K().transformPoint(L, vOf(o.mesh, i)));
      for (const f of o.mesh.f) { const nf = { v: f.v.map((v) => v + base), uv: f.uv ? f.uv.slice() : null, m: f.m || 0, s: !!f.s }; if (det < 0) K().flipFace(nf); mesh.f.push(nf); }
    }
    target.mesh = mesh;
    objects = objects.filter((o) => o === target || !list.includes(o));
    selected = new Set([target.id]); lastAdd = null;
    syncAll(); renderAll();
    setStatus(`Joined ${list.length} objects into ${target.name}.`);
  }
  /** Part of a mesh: the given faces and the vertices they use. */
  function subMesh(m, faces) { return K().compact({ v: m.v.slice(), f: [...faces].map((i) => { const { o: _owner, ...f } = m.f[i]; void _owner; return { ...f, v: f.v.slice(), uv: f.uv ? f.uv.slice() : null }; }), e: {} }).mesh; }
  function separate(how) {
    const o = editing();
    if (!o) return;
    const m = o.mesh;
    let parts;
    if (how === 'selection') {
      const f = flushed();
      if (!f || !f.faces.size) { setStatus('Select faces to separate.'); return; }
      if (f.faces.size === m.f.length) { setStatus('That is the whole mesh: nothing would be left.'); return; }
      parts = [m.f.map((_, i) => i).filter((i) => !f.faces.has(i)), [...f.faces]];
    } else {
      // Loose parts: faces joined through shared vertices.
      const seen = new Set(), groups = [];
      for (let i = 0; i < m.f.length; i++) {
        if (seen.has(i)) continue;
        const vs = K().linkedVerts(m, m.f[i].v);
        const g = m.f.map((_, j) => j).filter((j) => m.f[j].v.some((v) => vs.has(v)));
        g.forEach((j) => seen.add(j)); groups.push(g);
      }
      if (groups.length < 2) { setStatus('The mesh is in one piece: nothing to separate.'); return; }
      parts = groups;
    }
    pushHistory();
    o.mesh = subMesh(m, parts[0]);
    const made = parts.slice(1).map((g) => ({ id: `o${nextId++}`, name: uniqueName(o.name.replace(/\.\d{3}$/, '')), kind: 'mesh', mesh: subMesh(m, g), t: o.t.slice(), r: o.r.slice(), s: o.s.slice(), hidden: false }));
    objects.push(...made);
    made.forEach((x) => selected.add(x.id));
    editSel = K().emptySelection(editSel.mode); lastAdd = null;
    syncAll(); renderAll();
    setStatus(`Separated into ${made.length + 1} objects.`);
  }
  function separateMenu(x = mouse.x, y = mouse.y) {
    popup(x, y, 'Separate', [{ label: 'Selection', run: () => separate('selection') }, { label: 'By loose parts', run: () => separate('loose') }]);
  }
  /** Origins (as Blender's Set Origin): to the geometry's middle, to the 3D cursor; or the geometry moved to the origin. */
  function setOrigin(how) {
    const list = sel();
    if (!list.length) { setStatus('Select an object first.'); return; }
    pushHistory();
    for (const o of list) {
      const b = K().bounds(o.mesh), mid = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2), M = matrixOf(o);
      const local = how === 'cursor' ? K().transformPoint(invertOf(o), cursor) : mid;
      const out = K().clone(o.mesh);
      for (let i = 0; i < K().vertexCount(out); i++) for (let k = 0; k < 3; k++) out.v[i * 3 + k] -= local[k];
      o.mesh = out;
      if (how !== 'geometry') o.t = K().transformPoint(M, local);
    }
    lastAdd = null;
    syncAll(); renderAll();
    setStatus({ geometry: 'Geometry moved to the origin.', cursor: 'Origin moved to the 3D cursor.', middle: 'Origin moved to the geometry.' }[how]);
  }

  function opKey(e) {
    const k = e.key;
    if (k === 'Escape') { cancelOp(); return true; }
    if (k === 'Enter') { confirmOp(); return true; }
    const ax = { x: 0, y: 1, z: 2 }[k.toLowerCase()];
    // Shift+X/Y/Z: a plane that leaves that axis out (moving; scaling the other two).
    if (ax !== undefined && e.shiftKey && (op.kind === 'move' || op.kind === 'scale')) { op.plane = op.plane === ax ? null : ax; op.axis = null; op.dir = null; updateOp(); return true; }
    if (op.kind === 'loopcut') return loopCutKey(e);
    if (op.kind === 'slide') return slideKey(e);
    if (op.kind === 'bevel') return bevelKey(e);
    if (op.kind === 'knife') return knifeKey(e);
    // G again in Edit Mode: slide (as Blender's).
    if (k.toLowerCase() === 'g' && !e.shiftKey && op.kind === 'move' && op.edit && !op.fromDuplicate) { startSlide(); return true; }
    if (e.code === 'PageUp' || e.code === 'PageDown') { if (op.edit && op.propDist) { setEditOpts({ radius: Math.max(0.001, editOpts.radius * (e.code === 'PageUp' ? 1.15 : 1 / 1.15)) }); } return true; }
    if (op.kind === 'inset' && k.toLowerCase() === 'i') { op.individual = !op.individual; updateOp(); return true; }
    if (ax !== undefined && op.kind !== 'inset') { op.axis = op.axis === ax ? null : ax; op.plane = null; op.dir = null; updateOp(); return true; }
    if (/^[0-9.]$/.test(k) || (k === '-' && op.typed === '')) { op.typed += k; updateOp(); return true; }
    if (k === '-' && op.typed !== '') { op.typed = op.typed.startsWith('-') ? op.typed.slice(1) : '-' + op.typed; updateOp(); return true; }
    if (k === 'Backspace') { op.typed = op.typed.slice(0, -1); updateOp(); return true; }
    const swap = { g: 'move', r: 'rotate', s: 'scale' }[k.toLowerCase()];
    if (swap && swap !== op.kind && op.kind !== 'inset' && op.edit) {
      op.obj.mesh = op.startMesh;
      op = { ...op, kind: swap, axis: null, dir: null, typed: '', m0: { ...mouse } };
      updateOp(); return true;
    }
    if (swap && swap !== op.kind && !op.edit) {
      // Another transform from where this one is (as Blender: G, then R).
      const list = op.list, keep = op.before;
      op.list.forEach((o, i) => { o.t = op.start[i].t; o.r = op.start[i].r; o.s = op.start[i].s; });
      op = { ...op, kind: swap, axis: null, typed: '', m0: { ...mouse }, start: list.map((o) => ({ t: o.t.slice(), r: o.r.slice(), s: o.s.slice(), m: matrixOf(o) })), before: keep };
      updateOp(); return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- gizmos (move, rotate, scale), as Blender's
  /** Where the gizmo stands: the selection's middle (Edit Mode) or the selected objects' (Object Mode); null: nothing selected. */
  function gizmoPivot() {
    if (pivotMode === 'cursor' && (mode === 'edit' ? flushed() && flushed().verts.size : sel().length)) return cursor.slice();
    if (pivotMode === 'active' && mode !== 'edit' && byId(active) && selected.has(active)) return byId(active).t.slice();
    if (mode === 'edit') {
      const o = editing(); if (!o) return null;
      const f = K().flush(o.mesh, editSel); if (!f.verts.size) return null;
      return K().vec.scale([...f.verts].reduce((a, v) => K().vec.add(a, worldOf(o, v)), [0, 0, 0]), 1 / f.verts.size);
    }
    const list = sel();
    return list.length ? pivotOf(list) : null;
  }
  /** The gizmo's handles on the screen: { id, kind, axis | plane, shape, pts, color }, hit-tested in that order. */
  function gizmoLayout() {
    const out = [];
    if (!view || op || !(gizmos.move || gizmos.rotate || gizmos.scale)) return out;
    const p = gizmoPivot(); if (!p) return out;
    const V = K().vec, c = view.project(p); if (!c.front) return out;
    const cam = view.camera(), f = V.norm(V.sub(cam.target, cam.eye));
    let r = V.cross(f, [0, 0, 1]); if (V.len(r) < 1e-6) r = [1, 0, 0]; r = V.norm(r);
    const q = view.project(V.add(p, r)), ppm = Math.max(1e-6, Math.hypot(q.x - c.x, q.y - c.y));
    const L = 80 / ppm; // 80 pixels long, wherever it is
    const S = (w) => { const s = view.project(w); return [s.x, s.y]; };
    const C = [c.x, c.y];
    const col = (k, a = 1) => [[240, 82, 82], [122, 204, 76], [77, 140, 242]][k].concat(a);
    if (gizmos.rotate) {
      // A ring round each axis (dimmer where it turns away), and the view's own ring.
      for (let k = 0; k < 3; k++) {
        const a = AXES[k], u = AXES[(k + 1) % 3], w = AXES[(k + 2) % 3], pts = [];
        for (let i = 0; i <= 64; i++) { const t = (i / 64) * Math.PI * 2; pts.push(S(V.add(p, V.add(V.scale(u, Math.cos(t) * L * 0.95), V.scale(w, Math.sin(t) * L * 0.95))))); }
        out.push({ id: `rot${k}`, kind: 'rotate', axis: k, shape: 'ring', pts, color: col(k) });
      }
      const pts = []; for (let i = 0; i <= 64; i++) { const t = (i / 64) * Math.PI * 2; pts.push([C[0] + Math.cos(t) * 92, C[1] + Math.sin(t) * 92]); }
      out.push({ id: 'rotv', kind: 'rotate', axis: null, shape: 'ring', pts, color: [235, 235, 235, 1] });
    }
    if (gizmos.move) {
      out.push({ id: 'movec', kind: 'move', axis: null, shape: 'dot', pts: [C], r: 9, color: [235, 235, 235, 1] });
      for (let k = 0; k < 3; k++) {
        const u = AXES[(k + 1) % 3], w = AXES[(k + 2) % 3];
        // The plane square that leaves axis k out, between the other two arrows.
        const sq = [V.add(p, V.scale(V.add(u, w), L * 0.28)), V.add(p, V.add(V.scale(u, L * 0.42), V.scale(w, L * 0.28))), V.add(p, V.scale(V.add(u, w), L * 0.42)), V.add(p, V.add(V.scale(u, L * 0.28), V.scale(w, L * 0.42)))].map(S);
        out.push({ id: `movep${k}`, kind: 'move', plane: k, shape: 'quad', pts: sq, color: col(k, 0.55) });
      }
      for (let k = 0; k < 3; k++) out.push({ id: `move${k}`, kind: 'move', axis: k, shape: 'arrow', pts: [S(V.add(p, V.scale(AXES[k], L * 0.18))), S(V.add(p, V.scale(AXES[k], L)))], color: col(k) });
    }
    if (gizmos.scale) {
      out.push({ id: 'scalec', kind: 'scale', axis: null, shape: 'ring', pts: (() => { const pts = []; for (let i = 0; i <= 32; i++) { const t = (i / 32) * Math.PI * 2; pts.push([C[0] + Math.cos(t) * 16, C[1] + Math.sin(t) * 16]); } return pts; })(), color: [235, 235, 235, 1] });
      for (let k = 0; k < 3; k++) out.push({ id: `scale${k}`, kind: 'scale', axis: k, shape: 'box', pts: [S(V.add(p, V.scale(AXES[k], L * 0.2))), S(V.add(p, V.scale(AXES[k], gizmos.move ? L * 0.68 : L)))], color: col(k) });
    }
    return out;
  }
  const segDist = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)); return Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y); };
  function inQuad(x, y, pts) { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; }
  /** The handle under a point of the canvas (client coordinates), or null. */
  function gizmoHit(x, y) {
    const s = $('#nm-stage').getBoundingClientRect(), lx = x - s.left, ly = y - s.top;
    // Small things first (the middle, the squares), then arrows and boxes, then rings.
    const order = ['dot', 'quad', 'arrow', 'box', 'ring'];
    for (const shape of order) for (const h of gizmoHandles) {
      if (h.shape !== shape) continue;
      if (shape === 'dot' && Math.hypot(lx - h.pts[0][0], ly - h.pts[0][1]) <= h.r + 3) return h;
      if (shape === 'quad' && inQuad(lx, ly, h.pts)) return h;
      if ((shape === 'arrow' || shape === 'box') && segDist(lx, ly, h.pts[0], h.pts[1]) <= 7) return h;
      if (shape === 'ring') for (let i = 1; i < h.pts.length; i++) if (segDist(lx, ly, h.pts[i - 1], h.pts[i]) <= 6) return h;
    }
    return null;
  }
  /** The gizmo drawn on its own canvas over the view (crisp at any size), after every frame of the view. */
  function drawGizmo() {
    const cv = $('#nm-gizmo'), stage = $('#nm-stage');
    if (!cv || !stage) return;
    const s = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(s.width * dpr) || cv.height !== Math.round(s.height * dpr)) { cv.width = Math.round(s.width * dpr); cv.height = Math.round(s.height * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, s.width, s.height);
    const handles = gizmoLayout();
    // Into the stage's coordinates.
    gizmoHandles = handles.map((h) => ({ ...h, pts: h.pts.map(([x, y]) => [x - s.left, y - s.top]) }));
    {
      // The 3D cursor: a red and white ring with a cross, as Blender's.
      const c = view.project(cursor);
      if (c.front) {
        const x = c.x - s.left, y = c.y - s.top;
        g.lineWidth = 2;
        for (let i = 0; i < 8; i++) { g.strokeStyle = i % 2 ? '#ffffff' : '#e8413a'; g.beginPath(); g.arc(x, y, 9, (i * Math.PI) / 4, ((i + 1) * Math.PI) / 4); g.stroke(); }
        g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x - 15, y); g.lineTo(x - 5, y); g.moveTo(x + 5, y); g.lineTo(x + 15, y); g.moveTo(x, y - 15); g.lineTo(x, y - 5); g.moveTo(x, y + 5); g.lineTo(x, y + 15); g.stroke();
      }
    }
    drawKnife(g, s);
    if (op && op.edit && op.prop && ['move', 'rotate', 'scale'].includes(op.kind)) {
      // The proportional radius round the pivot, as Blender's circle.
      const c = view.project(op.pivot), V = K().vec, cam = view.camera();
      let rr = V.cross(V.norm(V.sub(cam.target, cam.eye)), [0, 0, 1]); if (V.len(rr) < 1e-6) rr = [1, 0, 0];
      const q = view.project(V.add(op.pivot, V.scale(V.norm(rr), editOpts.radius))), rad = Math.hypot(q.x - c.x, q.y - c.y);
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.beginPath(); g.arc(c.x - s.left, c.y - s.top, rad, 0, Math.PI * 2); g.stroke();
    }
    if (op && op.snapAt) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(op.snapAt[0] - s.left, op.snapAt[1] - s.top, 7, 0, Math.PI * 2); g.stroke(); }
    const rgba = (c, boost) => `rgba(${c.slice(0, 3).map((v) => Math.min(255, v + (boost ? 50 : 0))).join(',')},${c[3]})`;
    for (const h of gizmoHandles) {
      const hot = gizmoHover === h.id;
      g.strokeStyle = rgba(h.color, hot); g.fillStyle = rgba(h.color, hot); g.lineWidth = hot ? 4 : 2.5; g.lineCap = 'round';
      if (h.shape === 'ring') { g.beginPath(); h.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
      else if (h.shape === 'dot') { g.beginPath(); g.arc(h.pts[0][0], h.pts[0][1], h.r, 0, Math.PI * 2); g.lineWidth = hot ? 3 : 2; g.stroke(); }
      else if (h.shape === 'quad') { g.beginPath(); h.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.globalAlpha = hot ? 0.9 : 0.6; g.fill(); g.globalAlpha = 1; }
      else {
        const [a, b] = h.pts; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (h.shape === 'arrow') { g.beginPath(); g.moveTo(b[0] + Math.cos(ang) * 12, b[1] + Math.sin(ang) * 12); g.lineTo(b[0] + Math.cos(ang + 2.6) * 9, b[1] + Math.sin(ang + 2.6) * 9); g.lineTo(b[0] + Math.cos(ang - 2.6) * 9, b[1] + Math.sin(ang - 2.6) * 9); g.closePath(); g.fill(); }
        else { const z = hot ? 6 : 5; g.fillRect(b[0] - z, b[1] - z, z * 2, z * 2); }
      }
    }
  }
  function setGizmo(kind, on = !gizmos[kind]) {
    gizmos = { ...gizmos, [kind]: on };
    try { localStorage.setItem('noormd.mesh.gizmos', JSON.stringify(gizmos)); } catch { /* not kept */ }
    renderGizmoButtons(); drawGizmo();
  }
  function renderGizmoButtons() { document.querySelectorAll('#meshbench [data-gizmo]').forEach((b) => b.setAttribute('aria-pressed', String(!!gizmos[b.dataset.gizmo]))); }

  // ---------------------------------------------------------------- mouse in the view
  function onDown(e) {
    mouse = { x: e.clientX, y: e.clientY };
    if (op && op.kind === 'loopcut') { loopCutDown(e); e.preventDefault(); return; }
    if (op && op.kind === 'knife') { knifeDown(e); e.preventDefault(); return; }
    if (op) {
      if (e.button === 0) confirmOp();
      else if (e.button === 2) cancelOp();
      // The middle button (as Blender's): held and moved, the axis that runs most along the movement; clicked, free again.
      else if (e.button === 1) { op.mmb = { x: e.clientX, y: e.clientY, moved: false }; updateOp(); }
      e.preventDefault(); return;
    }
    if (e.button === 0 && !e.altKey) {
      // A gizmo's handle: that transform, held to its axis (or plane), for as long as the button is held.
      const h = gizmoHit(e.clientX, e.clientY);
      if (h) {
        startOp(h.kind);
        if (op) { op.axis = h.axis ?? null; op.plane = h.plane ?? null; op.dir = null; op.drag = true; op.m0 = { ...mouse }; gizmoHover = null; updateOp(); }
        e.preventDefault(); return;
      }
    }
    if (e.button === 2 && e.shiftKey) { placeCursor(e.clientX, e.clientY); e.preventDefault(); return; }
    if (e.button === 0) box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, moved: false };
    if (e.button === 2) box = { menu: true, x0: e.clientX, y0: e.clientY };
  }
  function onMove(e) {
    mouse = { x: e.clientX, y: e.clientY };
    op && (op.ctrl = e.ctrlKey);
    if (op && op.mmb) pickAxis();
    if (op) { updateOp(); return; }
    if (!box) { const h = gizmoHit(e.clientX, e.clientY), id = h ? h.id : null; if (id !== gizmoHover) { gizmoHover = id; drawGizmo(); } }
    if (box && !box.menu) {
      box.x1 = e.clientX; box.y1 = e.clientY;
      if (Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > 4) box.moved = true;
      drawBox();
    }
  }
  function onUp(e) {
    if (op && op.drag && e.button === 0) { confirmOp(); return; }
    if (op && op.mmb && e.button === 1) {
      if (!op.mmb.moved) op.axis = null;
      op.mmb = null; updateOp(); return;
    }
    const b = box;
    box = null; drawBox();
    if (!b) return;
    if (b.menu) { if (Math.hypot(e.clientX - b.x0, e.clientY - b.y0) < 4) (mode === 'edit' ? editMenu : objectMenu)(e.clientX, e.clientY); return; }
    if (mode === 'edit') {
      if (!b.moved) editClick({ clientX: e.clientX, clientY: e.clientY, shiftKey: b.shift, altKey: b.alt });
      else editBox(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.max(b.x0, b.x1), Math.max(b.y0, b.y1), b.ctrl ? 'remove' : b.shift ? 'add' : 'set');
      return;
    }
    if (!b.moved) {
      const hit = view.pick(e.clientX, e.clientY);
      select(hit ? hit.id : null, b.shift);
      return;
    }
    // Box select: objects with any vertex inside the rectangle (Shift adds, Ctrl takes away).
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const inside = objects.filter((o) => {
      if (o.hidden) return false;
      const m = matrixOf(o), n = K().vertexCount(o.mesh), step = Math.max(1, Math.floor(n / 3000));
      for (let i = 0; i < n; i += step) {
        const p = view.project(K().transformPoint(m, [o.mesh.v[i * 3], o.mesh.v[i * 3 + 1], o.mesh.v[i * 3 + 2]]));
        if (p.front && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) return true;
      }
      return false;
    }).map((o) => o.id);
    if (b.ctrl) inside.forEach((id) => selected.delete(id));
    else { if (!b.shift) selected.clear(); inside.forEach((id) => selected.add(id)); }
    if (!selected.has(active)) active = inside.find((id) => selected.has(id)) || null;
    syncAll(); renderAll();
  }
  function drawBox() {
    const r = $('#nm-box'), stage = $('#nm-stage');
    if (!r || !stage) return;
    if (!box || box.menu || !box.moved) { r.hidden = true; return; }
    const s = stage.getBoundingClientRect();
    Object.assign(r.style, { left: `${Math.min(box.x0, box.x1) - s.left}px`, top: `${Math.min(box.y0, box.y1) - s.top}px`, width: `${Math.abs(box.x1 - box.x0)}px`, height: `${Math.abs(box.y1 - box.y0)}px` });
    r.hidden = false;
  }
  const hud = (t) => { const h = $('#nm-hud'); if (h) h.textContent = t || (mode === 'edit' && editSel ? `${viewName} · Edit Mode (${({ vert: 'vertices', edge: 'edges', face: 'faces' })[editSel.mode]})` : viewName); };

  // ---------------------------------------------------------------- views
  function setView(which, opposite) {
    if (!view) return;
    if (which === 'persp') { view.setOrtho(!view.camera().ortho); viewName = view.camera().ortho ? 'User Orthographic' : 'User Perspective'; hud(''); return; }
    view.viewFrom(which, opposite);
    viewName = `${({ front: opposite ? 'Back' : 'Front', right: opposite ? 'Left' : 'Right', top: opposite ? 'Bottom' : 'Top' })[which]} Orthographic`;
    hud('');
  }
  function frameObjects(list) {
    if (!view) return;
    const pts = [];
    for (const o of list.filter((x) => !x.hidden)) { const b = K().bounds(o.mesh, matrixOf(o)); pts.push(b.min, b.max); }
    if (!pts.length) { view.frame([-1, -1, -1], [1, 1, 1]); return; }
    view.frame([0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))));
  }

  // ---------------------------------------------------------------- menus at the cursor
  function popup(x, y, title, items) {
    closePopup();
    // The right-click that opened it ends over it: the browser's own menu must not open there too.
    const pop = el('div', { class: 'fg-popup nm-menu', id: 'nm-popup', role: 'menu', 'aria-label': title, oncontextmenu: (e) => e.preventDefault() },
      el('strong', { class: 'nm-menutitle', text: title }),
      ...items.map((it) => (it === '-' ? el('hr') : el('button', { class: 'nm-menuitem', role: 'menuitem', disabled: it.disabled || undefined, onclick: () => { closePopup(); it.run(); } }, el('span', { text: it.label }), it.keys ? el('kbd', { text: it.keys }) : null))));
    pop.addEventListener('keydown', (e) => {
      const items = [...pop.querySelectorAll('button:not([disabled])')], i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopup(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = items.length; if (n) items[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n].focus(); }
    });
    document.body.append(pop);
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, x - 12))}px`;
    pop.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, y - 12))}px`;
    const first = pop.querySelector('button:not([disabled])'); if (first) first.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }
  function outside(e) { const p = $('#nm-popup'); if (p && !p.contains(e.target)) closePopup(); }
  function closePopup() {
    const p = $('#nm-popup');
    if (p) { p.remove(); keepFocus(); }
    document.removeEventListener('pointerdown', outside, true);
  }
  /** The keyboard back to NoorMesh (after a menu or a dialog, so G, R, S… keep working). */
  function keepFocus() { const r = $('#meshbench'); if (r && !r.hidden && !r.contains(document.activeElement)) r.focus({ preventScroll: true }); }
  const addItems = () => Object.entries(K().PRIMITIVES).map(([id, p]) => ({ label: `${PRIM_ICONS[id] || ''} ${p.name}`, run: () => addPrimitive(id) }));
  const addMenu = (x = mouse.x, y = mouse.y) => popup(x, y, 'Add a mesh', addItems());
  function objectMenu(x, y) {
    const none = !sel().length;
    popup(x, y, 'Object', [
      { label: 'Move', keys: 'G', run: () => startOp('move'), disabled: none }, { label: 'Rotate', keys: 'R', run: () => startOp('rotate'), disabled: none }, { label: 'Scale', keys: 'S', run: () => startOp('scale'), disabled: none }, '-',
      { label: 'Duplicate', keys: 'Shift+D', run: duplicate, disabled: none }, { label: 'Rename', keys: 'F2', run: () => rename(), disabled: !active },
      { label: 'Apply rotation and scale', keys: 'Ctrl+A', run: () => applyTransform('rotscale'), disabled: none }, { label: 'Hide', keys: 'H', run: () => hide('selected'), disabled: none },
      { label: 'Shade smooth', run: () => shade(true), disabled: none }, { label: 'Shade flat', run: () => shade(false), disabled: none }, { label: 'Edit Mode', keys: 'Tab', run: () => toggleEdit(true), disabled: () => !active }, '-',
      { label: 'Join', keys: 'Ctrl+J', run: join, disabled: sel().length < 2 }, { label: 'Origin to geometry', run: () => setOrigin('middle'), disabled: none }, { label: 'Origin to 3D cursor', run: () => setOrigin('cursor'), disabled: none }, { label: 'Geometry to origin', run: () => setOrigin('geometry'), disabled: none }, '-',
      { label: 'Delete', keys: 'X', run: deleteSelected, disabled: none }, '-', { label: 'Add a mesh…', keys: 'Shift+A', run: () => addMenu(x, y) },
    ]);
  }
  function applyMenu() {
    popup(mouse.x, mouse.y, 'Apply', [
      { label: 'Location', run: () => applyTransform('location') }, { label: 'Rotation', run: () => applyTransform('rotation') }, { label: 'Scale', run: () => applyTransform('scale') },
      { label: 'Rotation and scale', run: () => applyTransform('rotscale') }, { label: 'All transforms', run: () => applyTransform('all') },
    ]);
  }

  // ---------------------------------------------------------------- files: .noormesh, GLB and OBJ (A4)
  /** The scene as the app keeps it (MeshDoc's JSON). */
  function docOut() {
    // Several objects in Edit Mode together: saved as they will be when it ends (each its own mesh).
    const parts = multi && mode === 'edit' ? splitMulti() : null;
    const meshOf = (o) => (parts && parts.has(o.id) ? parts.get(o.id) : o.mesh);
    return { format: 'noormesh', version: 1, objects: objects.map((o) => ({ id: o.id, name: o.name, kind: o.kind, t: o.t, r: o.r, s: o.s, hidden: !!o.hidden,
      mesh: { v: meshOf(o).v, f: meshOf(o).f.map((f) => ({ v: f.v, uv: f.uv || null, m: f.m || 0, s: !!f.s })), e: meshOf(o).e || {} } })) };
  }
  /** Objects from a scene the app read: given ids of their own, meshes in the page's shape. */
  function objectsIn(doc) {
    return (doc.objects || []).map((o) => ({ id: `o${nextId++}`, name: uniqueName(o.name || 'Object'), kind: o.kind || 'mesh', t: (o.t || [0, 0, 0]).slice(), r: (o.r || [0, 0, 0]).slice(), s: (o.s || [1, 1, 1]).slice(), hidden: !!o.hidden,
      mesh: { v: Array.from(o.mesh.v || []), f: (o.mesh.f || []).map((f) => ({ v: Array.from(f.v), uv: f.uv ? Array.from(f.uv) : null, m: f.m || 0, s: !!f.s })), e: o.mesh.e || {} } }));
  }
  function setScene(doc, from) {
    cancelOp();
    mode = 'object'; editSel = null; lastAdd = null; multi = null;
    objects = []; nextId = 1;
    objects = objectsIn(doc);
    selected = new Set(objects.length ? [objects[objects.length - 1].id] : []); active = objects.length ? objects[objects.length - 1].id : null;
    history = []; future = [];
    file = { path: from.path || '', name: from.name || '' }; dirty = !!from.dirty;
    syncAll(); renderAll(); frameObjects(objects);
    const t = $('#nm-info'); if (t) t.textContent = fileLabel();
  }
  /** Leaving unsaved changes: asked first (Save, Don't save, Cancel). */
  async function okToLeave() {
    if (!dirty || !objects.length) return true;
    const v = await NoorUI.choose('Unsaved changes', `Save the changes to ${file.name || 'this scene'} first?`, [{ label: 'Save', value: 'save', primary: true }, { label: 'Don\'t save', value: 'discard' }, { label: 'Cancel', value: 'cancel' }]);
    keepFocus();
    if (v === 'save') return save(false);
    return v === 'discard';
  }
  async function newScene() {
    if (!(await okToLeave())) return;
    setScene({ objects: [] }, {});
    addPrimitive('cube', null, true); history = []; future = []; dirty = false;
    clearDraft(); renderAll(); setStatus('A new scene');
  }
  async function openScene(recentPath) {
    if (!(await okToLeave())) return;
    try {
      const r = await (recentPath ? req('mesh.openRecent', { path: recentPath }) : req('mesh.open'));
      if (!r || r.cancelled) return;
      setScene(r.doc, { path: r.path, name: r.name });
      clearDraft();
      setStatus(`Opened ${r.name}`);
    } catch (err) { hooks.showError(err); } finally { keepFocus(); }
  }
  async function save(asNew) {
    cancelOp();
    try {
      const r = await req('mesh.save', { doc: docOut(), path: asNew ? '' : file.path, name: file.name || 'scene' });
      if (!r || r.cancelled) return false;
      file = { path: r.path, name: r.name }; dirty = false;
      clearTimeout(draftTimer); clearDraft();
      renderAll();
      const t = $('#nm-info'); if (t) t.textContent = fileLabel();
      setStatus(`Saved ${r.name}`);
      return true;
    } catch (err) { hooks.showError(err); return false; } finally { keepFocus(); }
  }
  async function importModel() {
    cancelOp();
    try {
      const r = await req('mesh.import');
      if (!r || r.cancelled) return;
      if (mode === 'edit') toggleEdit(false);
      pushHistory();
      const added = objectsIn(r.doc);
      objects.push(...added);
      selected = new Set(added.map((o) => o.id)); active = added.length ? added[added.length - 1].id : active; lastAdd = null;
      syncAll(); renderAll(); frameObjects(added);
      const tris = added.reduce((n, o) => n + o.mesh.f.length, 0);
      setStatus(`Imported ${r.name}: ${added.length} object${added.length === 1 ? '' : 's'}, ${tris} faces (triangles from GLB; OBJ keeps its n-gons)`);
    } catch (err) { hooks.showError(err); } finally { keepFocus(); }
  }
  async function exportAs(format) {
    cancelOp();
    try {
      const r = await req('mesh.export', { doc: docOut(), format, name: (file.name || 'scene').replace(/\.noormesh$/i, '') });
      if (!r || r.cancelled) return;
      setStatus(`Exported ${r.name} (+Y up, as engines and Blender's importer expect)`);
    } catch (err) { hooks.showError(err); } finally { keepFocus(); }
  }
  function exportMenu(x, y) { popup(x, y, 'Export', [{ label: 'GLB (for engines: Godot, Unity, Unreal…)', run: () => exportAs('glb') }, { label: 'OBJ (n-gons kept, no placement)', run: () => exportAs('obj') }]); }
  async function recentMenu(x, y) {
    let files = [];
    try { files = (await req('mesh.recent')).files || []; } catch { files = []; }
    popup(x, y, 'Open recent', files.length ? files.map((f) => ({ label: f.name, run: () => openScene(f.path) })) : [{ label: 'No scenes opened yet', disabled: true, run: () => {} }]);
  }
  function saveDraft() {
    if (!dirty || !objects.length) return;
    req('mesh.draft.save', { doc: docOut(), name: file.name, path: file.path }).catch(() => { /* a draft is a convenience */ });
  }
  function clearDraft() { req('mesh.draft.clear').catch(() => {}); }
  /** A scene left unsaved last time (NoorMD closed or crashed): offered back once. */
  async function offerDraft() {
    let r;
    try { r = await req('mesh.draft.load'); } catch { return; }
    if (!r || r.none || !r.doc || !(r.doc.objects || []).length) return;
    const when = r.savedUtc ? new Date(r.savedUtc).toLocaleString() : '';
    const v = await NoorUI.choose('Bring back the scene?', `NoorMesh kept a draft of ${r.name || 'an unsaved scene'}${when ? ` (${when})` : ''}. Bring it back?`, [{ label: 'Bring it back', value: 'yes', primary: true }, { label: 'Throw it away', value: 'no' }]);
    keepFocus();
    if (v === 'yes') { setScene(r.doc, { path: r.path, name: r.name, dirty: true }); setStatus('The draft is back: save it to keep it (Ctrl+S).'); }
    else if (v === 'no') clearDraft();
  }

  // ---------------------------------------------------------------- the panels
  function renderAll() {
    renderOutliner(); renderProps(); hud(op ? undefined : '');
    const info = $('#nm-info'); if (info) info.textContent = fileLabel();
    drawGizmo();
    const ms = $('#nm-mode'); if (ms) ms.value = mode;
    const sm = $('#nm-selmodes');
    const eo = $('#nm-editopts'); if (eo) eo.hidden = mode !== 'edit';
    if (sm) { sm.hidden = mode !== 'edit'; sm.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(!!editSel && b.dataset.selmode === editSel.mode))); }
    $('#meshbench') && $('#meshbench').classList.toggle('nm-editing', mode === 'edit');
    if (window.NoorChrome) NoorChrome.benchChanged();
  }
  function renderOutliner() {
    const nav = $('#nm-nav');
    if (!nav) return;
    nav.replaceChildren(
      el('h3', { class: 'music-subhead', text: 'Scene' }),
      objects.length ? el('ul', { class: 'nm-outliner', role: 'listbox', 'aria-label': 'Objects', 'aria-multiselectable': 'true' }, ...objects.map((o) => el('li', {
        class: `nm-obj${selected.has(o.id) ? ' sel' : ''}${active === o.id ? ' active' : ''}${o.hidden ? ' off' : ''}`, role: 'option', 'aria-selected': String(selected.has(o.id)), 'data-id': o.id,
        onclick: (e) => { if (e.target.closest('button')) return; if (mode === 'edit' && o.id !== active) toggleEdit(false); if (mode !== 'edit') select(o.id, e.shiftKey || e.ctrlKey); }, ondblclick: () => rename(o.id),
      }, el('span', { class: 'nm-objicon', text: PRIM_ICONS[o.kind] || '◆' }), el('span', { class: 'nm-objname', text: o.name }),
      el('button', { class: 'icon-btn nm-eye', title: o.hidden ? 'Show' : 'Hide', 'aria-label': `${o.hidden ? 'Show' : 'Hide'} ${o.name}`, onclick: () => { pushHistory(); o.hidden = !o.hidden; if (o.hidden) selected.delete(o.id); syncAll(); renderAll(); } }, o.hidden ? '◌' : '👁'))))
        : el('p', { class: 'pref-hint', text: 'Nothing here yet: Shift+A adds a mesh.' }),
      el('button', { class: 'utility-btn', id: 'nm-add', title: 'Add a mesh (Shift+A)', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); addMenu(r.left + 12, r.bottom + 4); } }, '＋ Add a mesh'));
  }
  function vecRow(label, o, key, step, unit, title) {
    const inputs = [0, 1, 2].map((k) => {
      const i = el('input', { type: 'number', step: String(step), value: String(Math.round(o[key][k] * 1e4) / 1e4), 'aria-label': `${label} ${AXIS_NAMES[k]}`, 'data-prop': `${key}${k}`, class: 'nm-num' });
      let pushed = false;
      i.addEventListener('input', () => { const v = Number(i.value); if (!Number.isFinite(v)) return; if (!pushed) { pushHistory(); pushed = true; } o[key][k] = v; lastAdd = null; sync(o); });
      i.addEventListener('change', () => { pushed = false; renderProps(); });
      return el('label', { class: 'nm-axis' }, el('span', { class: `nm-axisname nm-${AXIS_NAMES[k].toLowerCase()}`, text: AXIS_NAMES[k] }), i);
    });
    return el('div', { class: 'nm-vec', title }, el('span', { class: 'nm-veclabel', text: `${label}${unit ? ` (${unit})` : ''}` }), ...inputs);
  }
  function renderProps() {
    const pane = $('#nm-pane');
    if (!pane) return;
    const o = byId(active);
    const parts = [];
    if (o && mode === 'edit') {
      const f = K().flush(o.mesh, editSel), c = K().check(o.mesh);
      parts.push(el('h3', { class: 'music-subhead', text: `Edit Mode: ${o.name}` }),
        el('p', { class: 'pref-hint', id: 'nm-editcounts', text: `Selected: ${f.verts.size}/${c.vertices} vertices · ${f.edges.size}/${c.edges ?? 0} edges · ${f.faces.size}/${c.faces} faces` }));
      if (f.verts.size) {
        // The selection's middle, in the world: typed numbers move it there (as Blender's Median).
        const mid = K().vec.scale([...f.verts].reduce((a, v) => K().vec.add(a, worldOf(o, v)), [0, 0, 0]), 1 / f.verts.size);
        const box = { m: mid.slice() };
        const inputs = [0, 1, 2].map((k) => {
          const i = el('input', { type: 'number', step: '0.1', value: String(Math.round(mid[k] * 1e4) / 1e4), 'aria-label': `Median ${AXIS_NAMES[k]}`, 'data-median': String(k), class: 'nm-num' });
          i.addEventListener('change', () => {
            const v = Number(i.value); if (!Number.isFinite(v)) return;
            const d = [0, 0, 0]; d[k] = v - box.m[k];
            pushHistory();
            const L = K().multiply(invertOf(o), K().multiply(translation(d), matrixOf(o)));
            o.mesh = K().transformVerts(o.mesh, [...f.verts], L);
            sync(o); syncEdit(); renderProps();
          });
          return el('label', { class: 'nm-axis' }, el('span', { class: `nm-axisname nm-${AXIS_NAMES[k].toLowerCase()}`, text: AXIS_NAMES[k] }), i);
        });
        parts.push(el('div', { class: 'nm-vec', title: 'The middle of the selection (in the world): a number typed moves the selection' }, el('span', { class: 'nm-veclabel', text: f.verts.size === 1 ? 'Vertex (m)' : 'Median (m)' }), ...inputs));
      }
      parts.push(
        el('p', { class: 'pref-hint', id: 'nm-stats', text: `${c.vertices} vertices · ${c.edges ?? 0} edges · ${c.faces} faces · ${c.triangles ?? 0} triangles${c.closed ? ' · closed' : c.open ? ` · open (${c.open} border edges)` : ''}` }),
        c.problems.length ? el('p', { class: 'pref-hint nm-problems', id: 'nm-problems', text: `⚠ ${c.problems.join('; ')}` }) : null,
        el('h3', { class: 'music-subhead', text: 'Mesh' }),
        el('div', { class: 'nm-prims' },
          el('button', { class: 'utility-btn', onclick: extrude, title: 'Extrude (E)' }, 'Extrude'), el('button', { class: 'utility-btn', onclick: inset, title: 'Inset faces (I)' }, 'Inset'),
          el('button', { class: 'utility-btn', onclick: () => mergeMenu(), title: 'Merge (M)' }, 'Merge…'), el('button', { class: 'utility-btn', onclick: makeFaceSel, title: 'Make a face (F)' }, 'Make face'),
          el('button', { class: 'utility-btn', onclick: () => deleteMenu(), title: 'Delete (X)' }, 'Delete…'), el('button', { class: 'utility-btn', onclick: dissolveSel, title: 'Dissolve (Ctrl+X)' }, 'Dissolve'),
          el('button', { class: 'utility-btn', onclick: () => normalsMenu(), title: 'Normals (Alt+N)' }, 'Normals…'), el('button', { class: 'utility-btn', onclick: () => shade(true), title: 'Shade the selected faces smooth' }, 'Smooth'),
          el('button', { class: 'utility-btn', onclick: () => shade(false), title: 'Shade the selected faces flat' }, 'Flat')),
        el('p', { class: 'pref-hint', text: 'Tab: back to Object Mode · 1 2 3: vertices, edges, faces · Alt+click: a loop · right-click: menu · F1: every key' }));
      pane.replaceChildren(...parts.filter(Boolean));
      return;
    }
    if (o) {
      const b = K().bounds(o.mesh), c = K().check(o.mesh);
      const dims = [0, 1, 2].map((k) => (b.max[k] - b.min[k]) * Math.abs(o.s[k]));
      parts.push(
        el('h3', { class: 'music-subhead', text: 'Object' }),
        el('div', { class: 'sb-row' }, el('span', { class: 'nm-objicon', text: PRIM_ICONS[o.kind] || '◆' }), el('strong', { id: 'nm-objname', text: o.name }),
          el('button', { class: 'utility-btn', title: 'Rename (F2)', onclick: () => rename(o.id) }, 'Rename')),
        vecRow('Location', o, 't', 0.1, 'm', 'Where its origin is (G moves it)'),
        vecRow('Rotation', o, 'r', 5, '°', 'Turned about X, then Y, then Z (R turns it)'),
        vecRow('Scale', o, 's', 0.1, '', 'Its size along its own axes (S scales it; Ctrl+A puts it into the mesh)'),
        el('p', { class: 'pref-hint', id: 'nm-dims', text: `Size: ${dims.map(fmt).join(' × ')} m` }),
        el('h3', { class: 'music-subhead', text: 'Mesh' }),
        el('p', { class: 'pref-hint', id: 'nm-stats', text: `${c.vertices} vertices · ${c.edges ?? 0} edges · ${c.faces} faces · ${c.triangles ?? 0} triangles${c.closed ? ' · closed' : c.open ? ` · open (${c.open} border edges)` : ''}` }),
        c.problems.length ? el('p', { class: 'pref-hint nm-problems', id: 'nm-problems', text: `⚠ ${c.problems.join('; ')}` }) : null);
    } else parts.push(el('p', { class: 'pref-hint', text: sel().length ? `${sel().length} selected (none active).` : 'Click an object to select it; Shift+click adds to the selection; drag to box-select; Shift+A adds a mesh.' }));
    // Adjust the last primitive added (as Blender's panel after Add).
    const last = lastAdd && byId(lastAdd.id);
    if (last) {
      const prim = K().PRIMITIVES[lastAdd.kind];
      parts.push(el('details', { class: 'nm-adjust', open: true }, el('summary', { text: `Adjust: ${prim.name}` }),
        el('div', { class: 'sb-fields' }, ...Object.entries(lastAdd.params).map(([key, value]) => {
          const isCount = /cuts|segments|rings|subdivisions|sides/.test(key);
          const i = el('input', { type: 'number', step: isCount ? '1' : '0.1', min: isCount ? (key === 'subdivisions' ? '0' : key.startsWith('cuts') ? '1' : '3') : '0.001', max: key === 'subdivisions' ? '5' : isCount ? '256' : '1000', value: String(value), 'aria-label': PARAM_LABELS[key] || key, 'data-param': key, class: 'nm-num' });
          i.addEventListener('change', () => { const v = Number(i.value); if (Number.isFinite(v) && v > 0 || (key === 'subdivisions' && v >= 0)) adjustLast(key, isCount ? Math.round(v) : v); });
          return el('label', { class: 'sb-inline nm-param' }, el('span', { text: PARAM_LABELS[key] || key }), i);
        }))));
    }
    parts.push(el('h3', { class: 'music-subhead', text: 'Add' }),
      el('div', { class: 'nm-prims' }, ...Object.entries(K().PRIMITIVES).map(([id, p]) => el('button', { class: 'utility-btn nm-prim', 'data-prim': id, title: `Add a ${p.name.toLowerCase()} at the origin`, onclick: () => addPrimitive(id) }, el('span', { text: PRIM_ICONS[id] || '◆' }), ` ${p.name}`))),
      el('p', { class: 'pref-hint nm-preview', text: 'NoorMesh is a preview: Tab for Edit Mode (vertices, edges, faces). Ctrl+S saves the scene (.noormesh); ⤓ exports GLB or OBJ for engines; ⤒ imports GLB or OBJ.' }));
    pane.replaceChildren(...parts.filter(Boolean));
  }

  // ---------------------------------------------------------------- building
  function build() {
    built = true;
    const root = el('section', { id: 'meshbench', class: 'soundbench texbench assetbench meshbench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'NoorMesh' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🧊' }), el('strong', { text: 'NoorMesh' }), el('small', { class: 'nm-badge', text: 'preview' }), el('small', { id: 'nm-info' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'nm-open', title: 'Open a scene (Ctrl+O)', 'aria-label': 'Open a scene', onclick: () => openScene() }, '📂'),
          el('button', { class: 'icon-btn', id: 'nm-save', title: 'Save the scene (Ctrl+S; Ctrl+Shift+S: as a new file)', 'aria-label': 'Save the scene', onclick: (e) => save(e.shiftKey) }, '💾'),
          el('button', { class: 'icon-btn', id: 'nm-import', title: 'Import a model (GLB or OBJ) into the scene', 'aria-label': 'Import a model', onclick: importModel }, '⤒'),
          el('button', { class: 'icon-btn', id: 'nm-export', title: 'Export the scene (GLB or OBJ, +Y up)', 'aria-label': 'Export the scene', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); exportMenu(r.left, r.bottom + 4); } }, '⤓'),
          el('button', { class: 'icon-btn', title: 'Shortcuts (F1 in NoorMesh)', 'aria-label': 'NoorMesh shortcuts', onclick: shortcutsDialog }, '⌨'),
          NoorDock.fullButton('NoorMesh'),
          el('button', { class: 'icon-btn', title: 'Where this panel goes', 'aria-label': 'Move NoorMesh', onclick: (e) => NoorDock.showMenu('mesh', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+N)', 'aria-label': 'Close NoorMesh', onclick: close }, '✕'))),
      el('div', { class: 'sb-main' },
        el('nav', { class: 'sb-presets', id: 'nm-nav', 'aria-label': 'Scene' }),
        el('div', { class: 'sb-editor' },
          el('div', { class: 'tb-split', id: 'nm-split' },
            el('div', { class: 'tb-view-col', id: 'nm-view-col' },
              el('div', { class: 'tb-views', role: 'group', 'aria-label': 'View' },
                (() => { const m = el('select', { id: 'nm-mode', 'aria-label': 'Mode', title: 'Object Mode: whole objects. Edit Mode (Tab): the active object\'s vertices, edges and faces.' }, el('option', { value: 'object', text: 'Object Mode' }), el('option', { value: 'edit', text: 'Edit Mode' })); m.addEventListener('change', () => { toggleEdit(m.value === 'edit'); m.value = mode; keepFocus(); }); return m; })(),
                el('span', { class: 'nm-selmodes', id: 'nm-selmodes', role: 'group', 'aria-label': 'Select', hidden: true },
                  ...[['vert', '⋅', 'Vertices (1)'], ['edge', '╱', 'Edges (2)'], ['face', '▰', 'Faces (3)']].map(([m, g, t]) => el('button', { class: 'icon-btn nm-selmode', 'data-selmode': m, title: t, 'aria-label': t, 'aria-pressed': 'false', onclick: () => { setSelectMode(m); keepFocus(); } }, g))),
                el('span', { class: 'nm-selmodes', id: 'nm-editopts', role: 'group', 'aria-label': 'Edit Mode options', hidden: true },
                  el('button', { class: 'icon-btn', id: 'nm-prop', title: 'Proportional editing (O; Shift+O: falloff; the wheel while moving: its size)', 'aria-label': 'Proportional editing', 'aria-pressed': 'false', onclick: () => { togglePropEdit(); keepFocus(); } }, '◎'),
                  el('select', { id: 'nm-falloff', class: 'nm-snapmode', title: 'Proportional falloff', 'aria-label': 'Falloff', onchange: (e) => { setEditOpts({ falloff: e.target.value }); keepFocus(); } },
                    ...[['smooth', 'Smooth'], ['sphere', 'Sphere'], ['root', 'Root'], ['linear', 'Linear'], ['sharp', 'Sharp'], ['constant', 'Constant']].map(([v, t]) => el('option', { value: v }, t))),
                  ...[0, 1, 2].map((k) => el('button', { class: 'icon-btn nm-mirror', 'data-mirror': String(k), title: `Mirror editing across ${'XYZ'[k]} (moves the twin on the other side too)`, 'aria-label': `Mirror ${'XYZ'[k]}`, 'aria-pressed': 'false', onclick: () => { toggleMirror(k); keepFocus(); } }, `⇋${'XYZ'[k]}`)),
                  el('button', { class: 'icon-btn', id: 'nm-automerge', title: 'Auto merge vertices (Alt+O): moved onto another, merged into it', 'aria-label': 'Auto merge vertices', 'aria-pressed': 'false', onclick: () => { toggleAutoMerge(); keepFocus(); } }, '⊕')),
                el('button', { class: 'utility-btn', title: 'Add a mesh (Shift+A)', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); addMenu(r.left + 12, r.bottom + 4); } }, '＋ Add'),
                el('span', { class: 'sb-fx-space' }),
                el('button', { class: 'icon-btn', title: 'Front (numpad 1; Ctrl: back)', 'aria-label': 'Front view', onclick: (e) => setView('front', e.ctrlKey) }, 'F'),
                el('button', { class: 'icon-btn', title: 'Right (numpad 3; Ctrl: left)', 'aria-label': 'Right view', onclick: (e) => setView('right', e.ctrlKey) }, 'R'),
                el('button', { class: 'icon-btn', title: 'Top (numpad 7; Ctrl: bottom)', 'aria-label': 'Top view', onclick: (e) => setView('top', e.ctrlKey) }, 'T'),
                el('button', { class: 'icon-btn', id: 'nm-persp', title: 'Perspective or orthographic (numpad 5)', 'aria-label': 'Perspective or orthographic', onclick: () => setView('persp') }, '⧉'),
                el('button', { class: 'icon-btn', title: 'Frame the selection (numpad .)', 'aria-label': 'Frame the selection', onclick: () => frameObjects(sel().length ? sel() : objects) }, '⌖'),
                el('span', { class: 'nm-gizmos', role: 'group', 'aria-label': 'Gizmos' },
                  el('button', { class: 'icon-btn', 'data-gizmo': 'move', title: 'Move gizmo: arrows (an axis), squares (a plane), the middle (free)', 'aria-label': 'Move gizmo', 'aria-pressed': 'false', onclick: () => { setGizmo('move'); keepFocus(); } }, '✥'),
                  el('button', { class: 'icon-btn', 'data-gizmo': 'rotate', title: 'Rotate gizmo: a ring for each axis, the white one turns about the view', 'aria-label': 'Rotate gizmo', 'aria-pressed': 'false', onclick: () => { setGizmo('rotate'); keepFocus(); } }, '⟳'),
                  el('button', { class: 'icon-btn', 'data-gizmo': 'scale', title: 'Scale gizmo: a handle for each axis, the middle ring scales evenly', 'aria-label': 'Scale gizmo', 'aria-pressed': 'false', onclick: () => { setGizmo('scale'); keepFocus(); } }, '⤡')),
                el('span', { class: 'nm-gizmos', role: 'group', 'aria-label': 'Snapping' },
                  el('button', { class: 'icon-btn', id: 'nm-snap', title: 'Snapping (Shift+Tab); hold Ctrl for the other', 'aria-label': 'Snapping', 'aria-pressed': 'false', onclick: () => { setSnapping({ on: !snapping.on }); keepFocus(); } }, '🧲'),
                  el('select', { id: 'nm-snapmode', class: 'nm-snapmode', title: 'What snapping does', 'aria-label': 'Snap to', onchange: (e) => { setSnapping({ mode: e.target.value }); keepFocus(); } },
                    el('option', { value: 'increment' }, 'Steps'), el('option', { value: 'vertex' }, 'Vertex'))),
                el('select', { id: 'nm-pivot', class: 'nm-snapmode', title: 'Pivot point for rotating and scaling (.)', 'aria-label': 'Pivot point', onchange: (e) => { setPivot(e.target.value); keepFocus(); } },
                  ...PIVOTS.map(([v, t]) => el('option', { value: v }, t))),
                el('button', { class: 'icon-btn', id: 'nm-edges', title: 'Show every object\'s edges', 'aria-label': 'Edges', 'aria-pressed': 'false', onclick: () => { showEdges = !showEdges; view && view.setEdges(showEdges); $('#nm-edges').setAttribute('aria-pressed', String(showEdges)); } }, '▦'),
                el('button', { class: 'icon-btn', id: 'nm-side', title: 'The view big, the properties in a column on the right; or under it', 'aria-label': 'Properties beside the view', 'aria-pressed': 'false', onclick: () => layout.set({ side: !layout.prefs.side }) }, '◫'),
                el('button', { class: 'icon-btn', id: 'nm-list', title: 'Show or hide the scene list', 'aria-label': 'The scene list', 'aria-pressed': 'true', onclick: () => layout.set({ list: !layout.prefs.list }) }, '☰')),
              el('div', { class: 'tb-stage nm-stage', id: 'nm-stage' },
                el('canvas', { id: 'nm-canvas', class: 'tb-canvas', tabindex: '-1', role: 'img', 'aria-label': 'The scene: click to select, middle-drag to turn the view, wheel to zoom', title: 'Click: select · drag: box select · middle-drag: turn · Shift+middle-drag: move · wheel: zoom · right-click: menu' }),
                el('div', { class: 'nm-hud', id: 'nm-hud', 'aria-live': 'polite' }),
                el('canvas', { class: 'nm-gizmo', id: 'nm-gizmo', 'aria-hidden': 'true' }),
                el('div', { class: 'nm-box', id: 'nm-box', hidden: true })),
              el('p', { class: 'pref-hint sb-status', id: 'nm-status', 'aria-live': 'polite' })),
            el('div', { class: 'tb-splitter', id: 'nm-splitter', role: 'separator', tabindex: '0', 'aria-label': 'Drag to share the room between the view and the properties (double-click: back to normal)' }),
            el('div', { class: 'tb-edit-col', id: 'nm-edit-col' }, el('div', { class: 'sb-pane', id: 'nm-pane' }))))));
    ($('#app') || document.body).append(root);
    new ResizeObserver(() => root.classList.toggle('wide', root.clientWidth >= 820)).observe(root);
    layout = NoorBenchLayout.attach({ root, storageKey: 'noormd.mesh.layout', defaults: { side: true }, split: $('#nm-split'), viewCol: $('#nm-view-col'), editCol: $('#nm-edit-col'),
      splitter: $('#nm-splitter'), sideButton: $('#nm-side'), listButton: $('#nm-list'), sideSized: 'edit' });
    root.addEventListener('keydown', onKey);
    root.addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; });
    try {
      // The bench takes the middle button during a transform (an axis), and Alt+click in Edit Mode (a loop, as Blender's).
      view = NoorMeshView.create($('#nm-canvas'), { drawn: () => drawGizmo(), down: onDown, move: onMove, up: onUp, takes: (e) => (!!op && op.kind !== 'loopcut' && op.kind !== 'knife' && e.button === 1) || (mode === 'edit' && !op && e.button === 0 && e.altKey), viewChanged: () => { if (!view.camera().ortho && / Orthographic$/.test(viewName)) { viewName = 'User Perspective'; hud(op ? undefined : ''); } if (op) updateOp(); } });
    } catch (err) { console.warn('NoorMesh: no 3D view', err); view = null; setTimeout(() => setStatus(`The 3D view couldn't start (it needs WebGL 2): ${err && err.message ? err.message : err}`), 0); }
    if (window.NoorChrome && NoorChrome.registerBench) NoorChrome.registerBench('mesh', { name: 'NoorMesh', title: appTitle, menus: appMenus });
    renderGizmoButtons(); renderSnap(); renderEditOpts();
    { const pv = $('#nm-pivot'); if (pv) pv.value = pivotMode; }
    // While cutting a loop the wheel sets how many cuts (before the view zooms with it).
    $('#nm-stage').addEventListener('wheel', loopCutWheel, { capture: true, passive: false });
  }
  let layout = null;

  function onKey(e) {
    const typing = e.target.closest('input, select, textarea');
    if ($('#nm-popup') && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopup(); return; }
    if (op) { if (opKey(e)) { e.preventDefault(); e.stopPropagation(); } return; }
    if (typing) return;
    const k = e.key.toLowerCase(), code = e.code;
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    // Numpad views (as Blender's), with the number row free for Edit Mode's selection modes later.
    if (code === 'Numpad1') { take(); setView('front', e.ctrlKey); return; }
    if (code === 'Numpad3') { take(); setView('right', e.ctrlKey); return; }
    if (code === 'Numpad7') { take(); setView('top', e.ctrlKey); return; }
    if (code === 'Numpad5') { take(); setView('persp'); return; }
    if (code === 'NumpadDecimal') { take(); frameObjects(sel().length ? sel() : objects); return; }
    if (e.key === 'Home') { take(); frameObjects(objects); return; }
    if (e.key === 'F1') { take(); shortcutsDialog(); return; }
    if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) { take(); setSnapping({ on: !snapping.on }); return; }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) { take(); toggleEdit(); return; }
    if (e.ctrlKey && !e.altKey && (k === 's' || k === 'o')) { take(); if (k === 's') save(e.shiftKey); else openScene(); return; }
    if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 's') { take(); snapMenu(); return; }
    if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'c') { take(); setCursor([0, 0, 0], '3D cursor back at the origin.'); frameObjects(objects); return; }
    if (e.key === '.' && code !== 'NumpadDecimal' && !e.ctrlKey && !e.altKey) { take(); pivotMenu(); return; }
    if (mode === 'edit' && editKey(e, k, code, take)) return;
    if (e.key === 'F2') { take(); rename(); return; }
    if (e.ctrlKey && !e.altKey && (k === 's' || k === 'o')) { take(); if (k === 's') save(e.shiftKey); else openScene(); return; }
    if (e.ctrlKey && !e.altKey) {
      if (k === 'z') { take(); undo(e.shiftKey); return; }
      if (k === 'y') { take(); undo(true); return; }
      if (k === 'a') { take(); applyMenu(); return; }
      if (k === 'j') { take(); join(); return; }
      if (k === 'i') { take(); selectAll('invert'); return; }
      return;
    }
    if (e.altKey) {
      if (k === 'a') { take(); selectAll('none'); return; }
      if (k === 'h') { take(); hide('reveal'); return; }
      if (k === 'g') { take(); clearTransform('location'); return; }
      if (k === 'r') { take(); clearTransform('rotation'); return; }
      if (k === 's') { take(); clearTransform('scale'); return; }
      return;
    }
    if (e.shiftKey) {
      if (k === 'a') { take(); addMenu(); return; }
      if (k === 'd') { take(); duplicate(); return; }
      if (k === 'h') { take(); hide('others'); return; }
      return;
    }
    if (k === 'g') { take(); startOp('move'); return; }
    if (k === 'r') { take(); startOp('rotate'); return; }
    if (k === 's') { take(); startOp('scale'); return; }
    if (k === 'a') { take(); selectAll('all'); return; }
    if (k === 'x' || e.key === 'Delete') { take(); deleteSelected(); return; }
    if (k === 'h') { take(); hide('selected'); return; }
    if (e.key === 'Escape' && !document.body.classList.contains('zen')) { take(); close(); }
  }

  /** Edit Mode's keys (as Blender's); true when one was used. */
  function editKey(e, k, code, take) {
    const o = editing();
    if (!o) return false;
    if (e.ctrlKey && !e.altKey) {
      if (code === 'NumpadAdd' || k === '=' || k === '+') { take(); growShrink(true); return true; }
      if (code === 'NumpadSubtract' || k === '-') { take(); growShrink(false); return true; }
      if (k === 'x') { take(); dissolveSel(); return true; }
      if (k === 'l') { take(); selectLinked(false); return true; }
      if (k === 'i') { take(); editSelectAll('invert'); return true; }
      if (k === 'r') { take(); loopCutStart(); return true; }
      if (k === 'b') { take(); bevelStart(e.shiftKey); return true; }
      if (k === 'e') { take(); edgeMenu(); return true; }
      return false; // Ctrl+Z, Ctrl+Y: undo as everywhere
    }
    if (e.altKey && !e.ctrlKey) {
      if (k === 'a') { take(); editSelectAll('none'); return true; }
      if (k === 'o') { take(); toggleAutoMerge(); return true; }
      if (k === 'n') { take(); normalsMenu(); return true; }
      return false;
    }
    if (e.shiftKey) {
      if (k === 'n') { take(); normals('outside'); return true; }
      if (k === 'd') { take(); duplicateEdit(); return true; }
      if (k === 'o') { take(); const list = Object.keys(FALLOFFS), nx = list[(list.indexOf(editOpts.falloff) + 1) % list.length]; setEditOpts({ falloff: nx }, `Proportional falloff: ${nx}.`); return true; }
      if (k === 'a') { take(); setStatus('Adding a primitive works in Object Mode for now (Tab).'); return true; }
      return false;
    }
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') { take(); setSelectMode(['vert', 'edge', 'face'][Number(code.slice(5)) - 1]); return true; }
    if (k === 'a') { take(); editSelectAll('all'); return true; }
    if (k === 'e') { take(); extrude(); return true; }
    if (k === 'k') { take(); knifeStart(); return true; }
    if (k === 'p') { take(); separateMenu(); return true; }
    if (k === 'o') { take(); togglePropEdit(); return true; }
    if (k === 'i') { take(); inset(); return true; }
    if (k === 'x' || e.key === 'Delete') { take(); deleteMenu(); return true; }
    if (k === 'm') { take(); mergeMenu(); return true; }
    if (k === 'f') { take(); makeFaceSel(); return true; }
    if (k === 'l') { take(); selectLinked(true); return true; }
    if (k === 'g') { take(); startOp('move'); return true; }
    if (k === 'r') { take(); startOp('rotate'); return true; }
    if (k === 's') { take(); startOp('scale'); return true; }
    if (k === 'h') { take(); setStatus('Hiding parts of a mesh comes later; H hides objects in Object Mode.'); return true; }
    if (e.key === 'Escape' && !document.body.classList.contains('zen')) { take(); toggleEdit(false); return true; }
    return false;
  }

  const SHORTCUTS = [
    ['Add a mesh', 'Shift+A'], ['Select', 'Click (Shift: add or take away)'], ['Box select', 'Drag (Shift: add, Ctrl: take away)'], ['Select all / none / invert', 'A / Alt+A / Ctrl+I'],
    ['Move / rotate / scale', 'G / R / S'], ['…along an axis', 'X, Y or Z (again: free), or hold the middle button and move towards it (a middle click: free)'], ['…in a plane (leaving an axis out; moving or scaling)', 'Shift+X, Shift+Y or Shift+Z'],
    ['Gizmos (move, rotate, scale)', 'The ✥ ⟳ ⤡ buttons; drag a handle'], ['…by a number', 'Type it (− turns it round), Backspace'], ['…in steps', 'Hold Ctrl'], ['Snapping on or off (steps, or to vertices; Ctrl: the other)', 'Shift+Tab'],
    ['…done / back', 'Click or Enter / right-click or Esc'], ['Clear location / rotation / scale', 'Alt+G / Alt+R / Alt+S'], ['Apply transforms', 'Ctrl+A'],
    ['Duplicate', 'Shift+D'], ['Join (into the active one)', 'Ctrl+J'], ['Place the 3D cursor', 'Shift+right-click'], ['Snap menu (cursor, selection)', 'Shift+S'], ['3D cursor back to the origin, frame everything', 'Shift+C'], ['Pivot point menu', '.'], ['Delete', 'X or Delete'], ['Hide / show all / hide others', 'H / Alt+H / Shift+H'], ['Rename', 'F2'],
    ['Turn the view', 'Middle-drag (or Alt+drag)'], ['Move the view', 'Shift+middle-drag'], ['Zoom', 'Wheel or Ctrl+middle-drag'],
    ['Front / right / top (Ctrl: the other side)', 'Numpad 1 / 3 / 7'], ['Perspective or orthographic', 'Numpad 5'], ['Frame the selection / everything', 'Numpad . / Home'],
    ['Undo / redo', 'Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y'], ['Object menu', 'Right-click'], ['Save / save as / open', 'Ctrl+S / Ctrl+Shift+S / Ctrl+O'],
    ['Edit Mode / Object Mode', 'Tab'], ['Vertices / edges / faces', '1 / 2 / 3'], ['Select a loop', 'Alt+click (Shift+Alt: add it)'],
    ['Select linked (under the mouse / of the selection)', 'L / Ctrl+L'], ['Select more / less', 'Ctrl+Numpad + / Ctrl+Numpad −'],
    ['Extrude (then along the normal)', 'E'], ['Inset faces (as one region; I again: each face)', 'I'], ['Loop cut and slide (wheel or + −: how many)', 'Ctrl+R'], ['Edge menu (bridge edge loops)', 'Ctrl+E'], ['Bevel edges / vertices (wheel or + −: segments, V: which)', 'Ctrl+B / Ctrl+Shift+B'], ['Knife (click points, Enter: cut)', 'K'],
    ['Slide vertices or an edge loop (E: even, F: flip)', 'G G'], ['Proportional editing / its falloff (wheel while moving: size)', 'O / Shift+O'], ['Auto merge vertices', 'Alt+O'], ['Mirror editing', 'The ⇋X ⇋Y ⇋Z buttons'], ['Delete / dissolve', 'X / Ctrl+X'], ['Merge', 'M'], ['Make a face', 'F'],
    ['Normals: menu / recalculate outside', 'Alt+N / Shift+N'], ['Duplicate faces', 'Shift+D'], ['Separate (selection, loose parts)', 'P'], ['Edit Mode menu', 'Right-click'],
  ];
  function shortcutsDialog() {
    NoorUI.modal({ label: 'NoorMesh shortcuts', width: 560 }, (surface, closeIt) => {
      surface.append(NoorUI.head('NoorMesh shortcuts (as Blender\'s)', closeIt),
        el('table', { class: 'nm-keys' }, ...SHORTCUTS.map(([what, keys]) => el('tr', {}, el('td', { text: what }), el('td', {}, el('kbd', { text: keys }))))),
        el('p', { class: 'pref-hint', text: 'Shortcuts of your own come with NoorMesh\'s command search in a later preview.' }));
    });
  }

  // ---------------------------------------------------------------- focus mode: title and menus
  const appTitle = () => `NoorMesh (preview) — ${fileLabel()} · ${objects.length} object${objects.length === 1 ? '' : 's'}${active && byId(active) ? ` · ${byId(active).name}` : ''}`;
  function appMenus() {
    const go = (label, run, keys, more = {}) => ({ label, keys, run, ...more });
    const none = () => !sel().length;
    return [
      ['File', 'f', () => [
        go('New scene', newScene), go('Open…', () => openScene(), 'Ctrl+O'), go('Open recent…', () => recentMenu(innerWidth / 2, innerHeight / 4)), '-',
        go('Save', () => save(false), 'Ctrl+S'), go('Save as…', () => save(true), 'Ctrl+Shift+S'), '-',
        go('Import GLB or OBJ…', importModel), go('Export GLB…', () => exportAs('glb')), go('Export OBJ…', () => exportAs('obj')), '-',
        { id: 'view.focus', label: 'Back to NoorMD (leave focus mode)' }, go('Close NoorMesh', close, 'Ctrl+Alt+N')]],
      ['Edit', 'e', () => [go('Undo', () => undo(false), 'Ctrl+Z', { disabled: () => !history.length }), go('Redo', () => undo(true), 'Ctrl+Shift+Z', { disabled: () => !future.length }), '-',
        go('Select all', () => selectAll('all'), 'A'), go('Select none', () => selectAll('none'), 'Alt+A'), go('Invert the selection', () => selectAll('invert'), 'Ctrl+I')]],
      ['Add', 'a', () => addItems().map((it) => go(it.label, it.run, '', { disabled: () => mode === 'edit' }))],
      ['Mesh', 'm', () => {
        const off = () => mode !== 'edit';
        return [go(mode === 'edit' ? 'Object Mode' : 'Edit Mode', () => toggleEdit(), 'Tab', { disabled: () => mode !== 'edit' && !active }), '-',
          go('Vertices', () => setSelectMode('vert'), '1', { disabled: off }), go('Edges', () => setSelectMode('edge'), '2', { disabled: off }), go('Faces', () => setSelectMode('face'), '3', { disabled: off }), '-',
          go('Extrude', extrude, 'E', { disabled: off }), go('Inset faces', inset, 'I', { disabled: off }), go('Merge…', () => mergeMenu(innerWidth / 2, innerHeight / 3), 'M', { disabled: off }), go('Make a face', makeFaceSel, 'F', { disabled: off }),
          go('Loop cut and slide', loopCutStart, 'Ctrl+R', { disabled: off }), go('Bevel', () => bevelStart(false), 'Ctrl+B', { disabled: off }), go('Bevel vertices', () => bevelStart(true), 'Ctrl+Shift+B', { disabled: off }), go('Knife', knifeStart, 'K', { disabled: off }), go('Bridge edge loops', bridge, '', { disabled: off }), go('Edge menu…', () => edgeMenu(innerWidth / 2, innerHeight / 3), 'Ctrl+E', { disabled: off }),
          go('Duplicate faces', duplicateEdit, 'Shift+D', { disabled: off }), go('Separate…', () => separateMenu(innerWidth / 2, innerHeight / 3), 'P', { disabled: off }), go('Delete…', () => deleteMenu(innerWidth / 2, innerHeight / 3), 'X', { disabled: off }), go('Dissolve', dissolveSel, 'Ctrl+X', { disabled: off }), '-',
          { label: 'Normals', sub: () => [go('Flip', () => normals('flip')), go('Recalculate outside', () => normals('outside'), 'Shift+N'), go('Recalculate inside', () => normals('inside'))], disabled: off },
          go('Shade smooth', () => shade(true)), go('Shade flat', () => shade(false)), '-',
          go('Select linked', () => selectLinked(false), 'Ctrl+L', { disabled: off }), go('Select more', () => growShrink(true), 'Ctrl+Numpad +', { disabled: off }), go('Select less', () => growShrink(false), 'Ctrl+Numpad −', { disabled: off })];
      }],
      ['Object', 'o', () => [
        go('Move', () => startOp('move'), 'G', { disabled: none }), go('Rotate', () => startOp('rotate'), 'R', { disabled: none }), go('Scale', () => startOp('scale'), 'S', { disabled: none }), '-',
        go('Duplicate', duplicate, 'Shift+D', { disabled: none }), go('Delete', deleteSelected, 'X', { disabled: none }), go('Rename', () => rename(), 'F2', { disabled: () => !active }), go('Join', join, 'Ctrl+J', { disabled: () => sel().length < 2 }), '-',
        { label: 'Set origin', sub: () => [go('Origin to geometry', () => setOrigin('middle')), go('Origin to 3D cursor', () => setOrigin('cursor')), go('Geometry to origin', () => setOrigin('geometry'))], disabled: none },
        { label: 'Snap', sub: () => [go('Selection to cursor', () => selectionToCursor(false)), go('Selection to cursor (keep offset)', () => selectionToCursor(true)), go('Cursor to selected', () => { const m = selectionMiddle(); if (m) setCursor(m); }), go('Cursor to world origin', () => setCursor([0, 0, 0]))] },
        { label: 'Apply', sub: () => [go('Location', () => applyTransform('location')), go('Rotation', () => applyTransform('rotation')), go('Scale', () => applyTransform('scale')), go('Rotation and scale', () => applyTransform('rotscale')), go('All transforms', () => applyTransform('all'))], disabled: none },
        { label: 'Clear', sub: () => [go('Location', () => clearTransform('location'), 'Alt+G'), go('Rotation', () => clearTransform('rotation'), 'Alt+R'), go('Scale', () => clearTransform('scale'), 'Alt+S')], disabled: none }, '-',
        go('Hide', () => hide('selected'), 'H', { disabled: none }), go('Show everything', () => hide('reveal'), 'Alt+H'), go('Hide the others', () => hide('others'), 'Shift+H')]],
      ['View', 'v', () => [go('Front', () => setView('front'), 'Numpad 1'), go('Back', () => setView('front', true), 'Ctrl+Numpad 1'), go('Right', () => setView('right'), 'Numpad 3'), go('Left', () => setView('right', true), 'Ctrl+Numpad 3'),
        go('Top', () => setView('top'), 'Numpad 7'), go('Bottom', () => setView('top', true), 'Ctrl+Numpad 7'), go('Perspective or orthographic', () => setView('persp'), 'Numpad 5'), '-',
        go('Frame the selection', () => frameObjects(sel().length ? sel() : objects), 'Numpad .'), go('Frame everything', () => frameObjects(objects), 'Home'), '-',
        { label: 'Move gizmo', checked: () => gizmos.move, run: () => setGizmo('move') }, { label: 'Rotate gizmo', checked: () => gizmos.rotate, run: () => setGizmo('rotate') }, { label: 'Scale gizmo', checked: () => gizmos.scale, run: () => setGizmo('scale') }, '-',
        { label: 'Proportional editing', checked: () => editOpts.prop, keys: 'O', run: togglePropEdit }, { label: 'Auto merge vertices', checked: () => editOpts.autoMerge, keys: 'Alt+O', run: toggleAutoMerge },
        { label: 'Mirror X', checked: () => editOpts.mirror[0], run: () => toggleMirror(0) }, { label: 'Mirror Y', checked: () => editOpts.mirror[1], run: () => toggleMirror(1) }, { label: 'Mirror Z', checked: () => editOpts.mirror[2], run: () => toggleMirror(2) }, '-',
        { label: 'Snapping', checked: () => snapping.on, keys: 'Shift+Tab', run: () => setSnapping({ on: !snapping.on }) }, { label: 'Snap in steps', checked: () => snapping.mode === 'increment', run: () => setSnapping({ mode: 'increment' }) }, { label: 'Snap to vertices', checked: () => snapping.mode === 'vertex', run: () => setSnapping({ mode: 'vertex' }) }, '-',
        go('Shortcuts…', shortcutsDialog, 'F1')]],
    ];
  }

  return {
    init, open, close, toggle, isOpen,
    /** For tests: the scene as it is. */
    _gizmo: () => gizmoHandles.map((h) => ({ id: h.id, kind: h.kind, axis: h.axis ?? null, plane: h.plane ?? null, at: h.shape === 'ring' ? h.pts[8] : h.shape === 'quad' ? [(h.pts[0][0] + h.pts[2][0]) / 2, (h.pts[0][1] + h.pts[2][1]) / 2] : h.pts[h.pts.length - 1] })),
    _state: () => ({ gizmos: { ...gizmos }, file: { ...file }, dirty, mode, editSel: editSel && { mode: editSel.mode, verts: [...editSel.verts], edges: [...editSel.edges], faces: [...editSel.faces] }, editFlush: editing() ? (() => { const f = K().flush(editing().mesh, editSel); return { verts: f.verts.size, edges: f.edges.size, faces: f.faces.size }; })() : null, objects: objects.map((o) => ({ id: o.id, name: o.name, kind: o.kind, t: o.t.slice(), r: o.r.slice(), s: o.s.slice(), hidden: o.hidden, vertices: K().vertexCount(o.mesh), faces: o.mesh.f.length, check: K().check(o.mesh) })), selected: [...selected], active, op: op ? { kind: op.kind, axis: op.axis, typed: op.typed, phase: op.phase, cuts: op.cuts, factor: op.factor, individual: !!op.individual, snapped: !!op.snapAt, plane: op.plane ?? null, segments: op.segments, width: op.width, points: op.pts ? op.pts.length : undefined, crossings: op.kind === 'knife' ? op.cross : undefined, knifeWorld: op.kind === 'knife' ? op.pts.map((p) => knifeWorld(p.c)) : undefined, hoverSnap: op.kind === 'knife' && op.hover ? op.hover.snap : undefined, f: op.f, edgeSlide: op.edgeSlide, prop: op.prop ? op.prop.length : 0, even: op.even } : null, cursor: cursor.slice(), pivot: pivotMode, multi: multi ? multi.ids.length : 0, snapping: { ...snapping }, editOpts: JSON.parse(JSON.stringify(editOpts)), history: history.length, future: future.length, lastAdd: lastAdd && { ...lastAdd }, camera: view && view.camera() }),
    _project: (p) => view && view.project(p),
    /** For tests: set the edited object's selection ({ verts | edges | faces }, in the current mode), and read its mesh. */
    _editSel: (x) => { const o = editing(); if (!o) return; const m = editSel.mode; editSel = x.faces ? K().selectionFromFaces(o.mesh, x.faces, m) : x.verts ? K().selectionFromVerts(o.mesh, x.verts, m) : K().convertSelection(o.mesh, { mode: 'edge', verts: new Set(), edges: new Set(x.edges), faces: new Set() }, m); syncEdit(); renderAll(); },
    /** For tests: an object's vertices in the world. */
    _worldVerts: (i) => { const o = objects[i]; if (!o) return null; const M = matrixOf(o), out = []; for (let k = 0; k < K().vertexCount(o.mesh); k++) out.push(K().transformPoint(M, vOf(o.mesh, k))); return out; },
    _editMesh: () => { const o = editing(); return o ? { v: o.mesh.v.slice(), faces: o.mesh.f.length, volume: K().volume(o.mesh), check: K().check(o.mesh) } : null; },
    /** For tests: select these faces of the edited object (as clicks would). */
    _editSelect: (faces) => { const o = editing(); if (!o) return; editSel = K().selectionFromFaces(o.mesh, faces, editSel.mode); syncEdit(); renderAll(); },
    /** For tests: where a vertex (or a face's middle) of the edited object shows on the screen. */
    _screenOf: (what, i) => { const o = editing(); if (!o) return null; const p = what === 'face' ? K().transformPoint(matrixOf(o), K().faceCentre(o.mesh, o.mesh.f[i])) : worldOf(o, i); return view.project(p); },
  };
})();
