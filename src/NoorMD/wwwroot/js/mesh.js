// NoorMesh: a polygon modeller for game assets (docs/NOORMESH_PLAN.md), a preview. Phase A1: the scene and Object
// Mode — primitives, selection, move / turn / scale with Blender's keys (G, R, S; X, Y, Z; typed numbers), duplicate,
// delete, hide, apply transforms, undo. The geometry is NoorMeshKernel's (meshkernel.js), the view NoorMeshView's
// (meshview.js). Meshes are never changed in place: an operation makes a new one, so undo keeps them by reference.
window.NoorMesh = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const K = () => window.NoorMeshKernel;

  let hooks = { showError: (e) => console.error(e) };
  let built = false, view = null;
  // The scene: objects { id, name, kind, mesh, t, r, s, hidden }; the selection; the active object.
  let objects = [], selected = new Set(), active = null, nextId = 1;
  let history = [], future = [];
  let op = null;           // a transform under way (G, R, S)
  let lastAdd = null;      // the last primitive added, its settings still adjustable
  let mouse = { x: 0, y: 0 }, box = null, showEdges = false;
  let viewName = 'User Perspective';
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
    if (!objects.length && !history.length) { addPrimitive('cube', null, true); history = []; future = []; }
    renderAll();
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
  const snapshot = () => ({ objects: objects.map((o) => ({ ...o, t: o.t.slice(), r: o.r.slice(), s: o.s.slice() })), selected: [...selected], active, nextId });
  function pushHistory() { history.push(snapshot()); if (history.length > 200) history.shift(); future = []; }
  function restore(s) { objects = s.objects.map((o) => ({ ...o, t: o.t.slice(), r: o.r.slice(), s: o.s.slice() })); selected = new Set(s.selected); active = s.active; nextId = Math.max(nextId, s.nextId); lastAdd = null; syncAll(); renderAll(); }
  function undo(redo = false) {
    cancelOp();
    const from = redo ? future : history, to = redo ? history : future;
    if (!from.length) return;
    to.push(snapshot());
    restore(from.pop());
    setStatus(redo ? 'Redone' : 'Undone');
  }

  // ---------------------------------------------------------------- the view
  function sync(o) {
    if (!view) return;
    const look = { matrix: matrixOf(o), selected: selected.has(o.id), active: active === o.id, hidden: o.hidden };
    if (uploaded.get(o.id) !== o.mesh) { view.setObject(o.id, K().buffers(o.mesh), look); uploaded.set(o.id, o.mesh); }
    else view.setLook(o.id, look);
  }
  function syncAll() {
    if (!view) return;
    for (const id of [...uploaded.keys()]) if (!byId(id)) { view.removeObject(id); uploaded.delete(id); }
    objects.forEach(sync);
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
    const o = { id: `o${nextId++}`, name: uniqueName(prim.name), kind, mesh: prim.make(p), t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], hidden: false };
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
    const list = sel();
    if (!view) return;
    if (!list.length) { setStatus('Select an object first (click it, or A for all).'); return; }
    cancelOp();
    const pivot = pivotOf(list);
    op = { kind, list, start: list.map((o) => ({ t: o.t.slice(), r: o.r.slice(), s: o.s.slice(), m: matrixOf(o) })), pivot, m0: { ...mouse }, axis: null, typed: '', fromDuplicate, before: snapshot() };
    updateOp();
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
    const snap = op.ctrl;
    const cam = view.camera(), toViewer = V.norm(V.sub(cam.eye, cam.target));
    let text = '';
    if (op.kind === 'move') {
      let delta;
      if (typed !== null) delta = V.scale(AXES[op.axis ?? 0], typed);
      else if (op.axis !== null) {
        const a = AXES[op.axis], s0 = rayLine(view.ray(op.m0.x, op.m0.y), op.pivot, a), s1 = rayLine(view.ray(mouse.x, mouse.y), op.pivot, a);
        delta = V.scale(a, s1 - s0);
      } else {
        const p0 = rayPlane(view.ray(op.m0.x, op.m0.y), op.pivot, toViewer), p1 = rayPlane(view.ray(mouse.x, mouse.y), op.pivot, toViewer);
        delta = p0 && p1 ? V.sub(p1, p0) : [0, 0, 0];
      }
      if (snap && typed === null) delta = delta.map((x) => Math.round(x * 10) / 10);
      op.list.forEach((o, i) => { o.t = V.add(op.start[i].t, delta); });
      text = op.axis !== null ? `Move ${AXIS_NAMES[op.axis]}: ${fmt(delta[op.axis])} m` : `Move: ${delta.map(fmt).join(', ')} m`;
    } else if (op.kind === 'rotate') {
      const c = view.project(op.pivot);
      const ang = (p) => Math.atan2(-(p.y - c.y), p.x - c.x);
      let deg = typed !== null ? typed : ((ang(mouse) - ang(op.m0)) * 180) / Math.PI;
      if (typed === null) { deg = ((deg + 540) % 360) - 180; if (snap) deg = Math.round(deg / 5) * 5; }
      let axis = toViewer;
      if (op.axis !== null) { axis = AXES[op.axis]; if (typed === null && V.dot(axis, toViewer) < 0) deg = -deg; }
      const R = K().rotationAbout(axis, deg, op.pivot);
      op.list.forEach((o, i) => { const d = K().decompose(K().multiply(R, op.start[i].m)); o.t = d.t; o.r = d.r; o.s = op.start[i].s.slice(); });
      text = `Rotate${op.axis !== null ? ' ' + AXIS_NAMES[op.axis] : ''}: ${fmt(deg)}°`;
    } else {
      const c = view.project(op.pivot);
      const d0 = Math.max(4, Math.hypot(op.m0.x - c.x, op.m0.y - c.y));
      let f = typed !== null ? typed : Math.hypot(mouse.x - c.x, mouse.y - c.y) / d0;
      if (snap && typed === null) f = Math.round(f * 10) / 10;
      op.list.forEach((o, i) => {
        const st = op.start[i];
        if (op.axis === null) { o.s = st.s.map((x) => x * f); o.t = st.t.map((x, k) => op.pivot[k] + (x - op.pivot[k]) * f); }
        else {
          // Along one world axis: the object's own axis that lies most along it is scaled (an object has no shear).
          const m = st.m, cols = [0, 1, 2].map((k) => V.norm([m[k * 4], m[k * 4 + 1], m[k * 4 + 2]]));
          const k = cols.map((v) => Math.abs(V.dot(v, AXES[op.axis]))).reduce((b, v, j, a) => (v > a[b] ? j : b), 0);
          o.s = st.s.map((x, j) => (j === k ? x * f : x));
          o.t = st.t.map((x, j) => (j === op.axis ? op.pivot[j] + (x - op.pivot[j]) * f : x));
        }
      });
      text = `Scale${op.axis !== null ? ' ' + AXIS_NAMES[op.axis] : ''}: ${fmt(f)}`;
    }
    if (op.typed !== '') text += `  [${op.typed}]`;
    op.list.forEach(sync);
    // The axis it is held to, as a long line through the pivot.
    view.setGuides(op.axis !== null ? [{ from: V.add(op.pivot, V.scale(AXES[op.axis], -1000)), to: V.add(op.pivot, V.scale(AXES[op.axis], 1000)), color: AXIS_COLOURS[op.axis] }] : []);
    hud(`${text}   ·   X Y Z: an axis · type a number · click or Enter: done · right-click or Esc: back`);
  }
  const fmt = (x) => (Math.abs(x) < 1e-9 ? '0' : (Math.round(x * 1000) / 1000).toString());
  function confirmOp() {
    if (!op) return;
    const done = op;
    op = null;
    view.setGuides([]);
    // One undo step: the scene as it was when the transform began (a duplicate's step is the copy itself).
    if (!done.fromDuplicate) { history.push(done.before); if (history.length > 200) history.shift(); future = []; }
    lastAdd = null;
    hud(''); renderAll();
  }
  function cancelOp() {
    if (!op) return;
    const done = op;
    op = null;
    done.list.forEach((o, i) => { o.t = done.start[i].t; o.r = done.start[i].r; o.s = done.start[i].s; });
    if (view) view.setGuides([]);
    syncAll(); hud(''); renderProps();
  }
  function opKey(e) {
    const k = e.key;
    if (k === 'Escape') { cancelOp(); return true; }
    if (k === 'Enter') { confirmOp(); return true; }
    const ax = { x: 0, y: 1, z: 2 }[k.toLowerCase()];
    if (ax !== undefined) { op.axis = op.axis === ax ? null : ax; updateOp(); return true; }
    if (/^[0-9.]$/.test(k) || (k === '-' && op.typed === '')) { op.typed += k; updateOp(); return true; }
    if (k === '-' && op.typed !== '') { op.typed = op.typed.startsWith('-') ? op.typed.slice(1) : '-' + op.typed; updateOp(); return true; }
    if (k === 'Backspace') { op.typed = op.typed.slice(0, -1); updateOp(); return true; }
    const swap = { g: 'move', r: 'rotate', s: 'scale' }[k.toLowerCase()];
    if (swap && swap !== op.kind) {
      // Another transform from where this one is (as Blender: G, then R).
      const list = op.list, keep = op.before;
      op.list.forEach((o, i) => { o.t = op.start[i].t; o.r = op.start[i].r; o.s = op.start[i].s; });
      op = { ...op, kind: swap, axis: null, typed: '', m0: { ...mouse }, start: list.map((o) => ({ t: o.t.slice(), r: o.r.slice(), s: o.s.slice(), m: matrixOf(o) })), before: keep };
      updateOp(); return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- mouse in the view
  function onDown(e) {
    mouse = { x: e.clientX, y: e.clientY };
    if (op) { if (e.button === 0) confirmOp(); else if (e.button === 2) cancelOp(); e.preventDefault(); return; }
    if (e.button === 0) box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey, moved: false };
    if (e.button === 2) box = { menu: true, x0: e.clientX, y0: e.clientY };
  }
  function onMove(e) {
    mouse = { x: e.clientX, y: e.clientY };
    op && (op.ctrl = e.ctrlKey);
    if (op) { updateOp(); return; }
    if (box && !box.menu) {
      box.x1 = e.clientX; box.y1 = e.clientY;
      if (Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > 4) box.moved = true;
      drawBox();
    }
  }
  function onUp(e) {
    const b = box;
    box = null; drawBox();
    if (!b) return;
    if (b.menu) { if (Math.hypot(e.clientX - b.x0, e.clientY - b.y0) < 4) objectMenu(e.clientX, e.clientY); return; }
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
  const hud = (t) => { const h = $('#nm-hud'); if (h) h.textContent = t || viewName; };

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
    const pop = el('div', { class: 'fg-popup nm-menu', id: 'nm-popup', role: 'menu', 'aria-label': title },
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
      { label: 'Apply rotation and scale', keys: 'Ctrl+A', run: () => applyTransform('rotscale'), disabled: none }, { label: 'Hide', keys: 'H', run: () => hide('selected'), disabled: none }, '-',
      { label: 'Delete', keys: 'X', run: deleteSelected, disabled: none }, '-', { label: 'Add a mesh…', keys: 'Shift+A', run: () => addMenu(x, y) },
    ]);
  }
  function applyMenu() {
    popup(mouse.x, mouse.y, 'Apply', [
      { label: 'Location', run: () => applyTransform('location') }, { label: 'Rotation', run: () => applyTransform('rotation') }, { label: 'Scale', run: () => applyTransform('scale') },
      { label: 'Rotation and scale', run: () => applyTransform('rotscale') }, { label: 'All transforms', run: () => applyTransform('all') },
    ]);
  }

  // ---------------------------------------------------------------- the panels
  function renderAll() { renderOutliner(); renderProps(); hud(op ? undefined : ''); if (window.NoorChrome) NoorChrome.benchChanged(); }
  function renderOutliner() {
    const nav = $('#nm-nav');
    if (!nav) return;
    nav.replaceChildren(
      el('h3', { class: 'music-subhead', text: 'Scene' }),
      objects.length ? el('ul', { class: 'nm-outliner', role: 'listbox', 'aria-label': 'Objects', 'aria-multiselectable': 'true' }, ...objects.map((o) => el('li', {
        class: `nm-obj${selected.has(o.id) ? ' sel' : ''}${active === o.id ? ' active' : ''}${o.hidden ? ' off' : ''}`, role: 'option', 'aria-selected': String(selected.has(o.id)), 'data-id': o.id,
        onclick: (e) => { if (!e.target.closest('button')) select(o.id, e.shiftKey || e.ctrlKey); }, ondblclick: () => rename(o.id),
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
      el('p', { class: 'pref-hint nm-preview', text: 'NoorMesh is a preview: Object Mode for now. Edit Mode (vertices, edges, faces), saving and GLB export come in the next previews.' }));
    pane.replaceChildren(...parts.filter(Boolean));
  }

  // ---------------------------------------------------------------- building
  function build() {
    built = true;
    const root = el('section', { id: 'meshbench', class: 'soundbench texbench assetbench meshbench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'NoorMesh' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🧊' }), el('strong', { text: 'NoorMesh' }), el('small', { class: 'nm-badge', text: 'preview' }), el('small', { id: 'nm-info' })),
        el('span', { class: 'panel-head-buttons' },
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
                el('select', { id: 'nm-mode', 'aria-label': 'Mode', title: 'Object Mode: whole objects. Edit Mode (Tab) comes in the next preview.' }, el('option', { value: 'object', text: 'Object Mode' }), el('option', { value: 'edit', text: 'Edit Mode (soon)', disabled: true })),
                el('button', { class: 'utility-btn', title: 'Add a mesh (Shift+A)', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); addMenu(r.left + 12, r.bottom + 4); } }, '＋ Add'),
                el('span', { class: 'sb-fx-space' }),
                el('button', { class: 'icon-btn', title: 'Front (numpad 1; Ctrl: back)', 'aria-label': 'Front view', onclick: (e) => setView('front', e.ctrlKey) }, 'F'),
                el('button', { class: 'icon-btn', title: 'Right (numpad 3; Ctrl: left)', 'aria-label': 'Right view', onclick: (e) => setView('right', e.ctrlKey) }, 'R'),
                el('button', { class: 'icon-btn', title: 'Top (numpad 7; Ctrl: bottom)', 'aria-label': 'Top view', onclick: (e) => setView('top', e.ctrlKey) }, 'T'),
                el('button', { class: 'icon-btn', id: 'nm-persp', title: 'Perspective or orthographic (numpad 5)', 'aria-label': 'Perspective or orthographic', onclick: () => setView('persp') }, '⧉'),
                el('button', { class: 'icon-btn', title: 'Frame the selection (numpad .)', 'aria-label': 'Frame the selection', onclick: () => frameObjects(sel().length ? sel() : objects) }, '⌖'),
                el('button', { class: 'icon-btn', id: 'nm-edges', title: 'Show every object\'s edges', 'aria-label': 'Edges', 'aria-pressed': 'false', onclick: () => { showEdges = !showEdges; view && view.setEdges(showEdges); $('#nm-edges').setAttribute('aria-pressed', String(showEdges)); } }, '▦'),
                el('button', { class: 'icon-btn', id: 'nm-side', title: 'The view big, the properties in a column on the right; or under it', 'aria-label': 'Properties beside the view', 'aria-pressed': 'false', onclick: () => layout.set({ side: !layout.prefs.side }) }, '◫'),
                el('button', { class: 'icon-btn', id: 'nm-list', title: 'Show or hide the scene list', 'aria-label': 'The scene list', 'aria-pressed': 'true', onclick: () => layout.set({ list: !layout.prefs.list }) }, '☰')),
              el('div', { class: 'tb-stage nm-stage', id: 'nm-stage' },
                el('canvas', { id: 'nm-canvas', class: 'tb-canvas', tabindex: '-1', role: 'img', 'aria-label': 'The scene: click to select, middle-drag to turn the view, wheel to zoom', title: 'Click: select · drag: box select · middle-drag: turn · Shift+middle-drag: move · wheel: zoom · right-click: menu' }),
                el('div', { class: 'nm-hud', id: 'nm-hud', 'aria-live': 'polite' }),
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
      view = NoorMeshView.create($('#nm-canvas'), { down: onDown, move: onMove, up: onUp, viewChanged: () => { if (op) updateOp(); } });
    } catch (err) { console.warn('NoorMesh: no 3D view', err); view = null; setTimeout(() => setStatus(`The 3D view couldn't start (it needs WebGL 2): ${err && err.message ? err.message : err}`), 0); }
    if (window.NoorChrome && NoorChrome.registerBench) NoorChrome.registerBench('mesh', { name: 'NoorMesh', title: appTitle, menus: appMenus });
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
    if (e.key === 'F2') { take(); rename(); return; }
    if (e.ctrlKey && !e.altKey) {
      if (k === 'z') { take(); undo(e.shiftKey); return; }
      if (k === 'y') { take(); undo(true); return; }
      if (k === 'a') { take(); applyMenu(); return; }
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
    if (e.key === 'Tab') { take(); setStatus('Edit Mode (vertices, edges and faces) comes in the next NoorMesh preview.'); return; }
    if (e.key === 'Escape' && !document.body.classList.contains('zen')) { take(); close(); }
  }

  const SHORTCUTS = [
    ['Add a mesh', 'Shift+A'], ['Select', 'Click (Shift: add or take away)'], ['Box select', 'Drag (Shift: add, Ctrl: take away)'], ['Select all / none / invert', 'A / Alt+A / Ctrl+I'],
    ['Move / rotate / scale', 'G / R / S'], ['…along an axis', 'X, Y or Z (again: free)'], ['…by a number', 'Type it (− turns it round), Backspace'], ['…in steps', 'Hold Ctrl'],
    ['…done / back', 'Click or Enter / right-click or Esc'], ['Clear location / rotation / scale', 'Alt+G / Alt+R / Alt+S'], ['Apply transforms', 'Ctrl+A'],
    ['Duplicate', 'Shift+D'], ['Delete', 'X or Delete'], ['Hide / show all / hide others', 'H / Alt+H / Shift+H'], ['Rename', 'F2'],
    ['Turn the view', 'Middle-drag (or Alt+drag)'], ['Move the view', 'Shift+middle-drag'], ['Zoom', 'Wheel or Ctrl+middle-drag'],
    ['Front / right / top (Ctrl: the other side)', 'Numpad 1 / 3 / 7'], ['Perspective or orthographic', 'Numpad 5'], ['Frame the selection / everything', 'Numpad . / Home'],
    ['Undo / redo', 'Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y'], ['Object menu', 'Right-click'],
  ];
  function shortcutsDialog() {
    NoorUI.modal({ label: 'NoorMesh shortcuts', width: 560 }, (surface, closeIt) => {
      surface.append(NoorUI.head('NoorMesh shortcuts (as Blender\'s)', closeIt),
        el('table', { class: 'nm-keys' }, ...SHORTCUTS.map(([what, keys]) => el('tr', {}, el('td', { text: what }), el('td', {}, el('kbd', { text: keys }))))),
        el('p', { class: 'pref-hint', text: 'Shortcuts of your own come with NoorMesh\'s command search in a later preview.' }));
    });
  }

  // ---------------------------------------------------------------- focus mode: title and menus
  const appTitle = () => `NoorMesh (preview) — ${objects.length} object${objects.length === 1 ? '' : 's'}${active && byId(active) ? ` · ${byId(active).name}` : ''}`;
  function appMenus() {
    const go = (label, run, keys, more = {}) => ({ label, keys, run, ...more });
    const none = () => !sel().length;
    return [
      ['File', 'f', () => [{ id: 'view.focus', label: 'Back to NoorMD (leave focus mode)' }, go('Close NoorMesh', close, 'Ctrl+Alt+N')]],
      ['Edit', 'e', () => [go('Undo', () => undo(false), 'Ctrl+Z', { disabled: () => !history.length }), go('Redo', () => undo(true), 'Ctrl+Shift+Z', { disabled: () => !future.length }), '-',
        go('Select all', () => selectAll('all'), 'A'), go('Select none', () => selectAll('none'), 'Alt+A'), go('Invert the selection', () => selectAll('invert'), 'Ctrl+I')]],
      ['Add', 'a', () => addItems().map((it) => go(it.label, it.run))],
      ['Object', 'o', () => [
        go('Move', () => startOp('move'), 'G', { disabled: none }), go('Rotate', () => startOp('rotate'), 'R', { disabled: none }), go('Scale', () => startOp('scale'), 'S', { disabled: none }), '-',
        go('Duplicate', duplicate, 'Shift+D', { disabled: none }), go('Delete', deleteSelected, 'X', { disabled: none }), go('Rename', () => rename(), 'F2', { disabled: () => !active }), '-',
        { label: 'Apply', sub: () => [go('Location', () => applyTransform('location')), go('Rotation', () => applyTransform('rotation')), go('Scale', () => applyTransform('scale')), go('Rotation and scale', () => applyTransform('rotscale')), go('All transforms', () => applyTransform('all'))], disabled: none },
        { label: 'Clear', sub: () => [go('Location', () => clearTransform('location'), 'Alt+G'), go('Rotation', () => clearTransform('rotation'), 'Alt+R'), go('Scale', () => clearTransform('scale'), 'Alt+S')], disabled: none }, '-',
        go('Hide', () => hide('selected'), 'H', { disabled: none }), go('Show everything', () => hide('reveal'), 'Alt+H'), go('Hide the others', () => hide('others'), 'Shift+H')]],
      ['View', 'v', () => [go('Front', () => setView('front'), 'Numpad 1'), go('Back', () => setView('front', true), 'Ctrl+Numpad 1'), go('Right', () => setView('right'), 'Numpad 3'), go('Left', () => setView('right', true), 'Ctrl+Numpad 3'),
        go('Top', () => setView('top'), 'Numpad 7'), go('Bottom', () => setView('top', true), 'Ctrl+Numpad 7'), go('Perspective or orthographic', () => setView('persp'), 'Numpad 5'), '-',
        go('Frame the selection', () => frameObjects(sel().length ? sel() : objects), 'Numpad .'), go('Frame everything', () => frameObjects(objects), 'Home'), '-', go('Shortcuts…', shortcutsDialog, 'F1')]],
    ];
  }

  return {
    init, open, close, toggle, isOpen,
    /** For tests: the scene as it is. */
    _state: () => ({ objects: objects.map((o) => ({ id: o.id, name: o.name, kind: o.kind, t: o.t.slice(), r: o.r.slice(), s: o.s.slice(), hidden: o.hidden, vertices: K().vertexCount(o.mesh), faces: o.mesh.f.length, check: K().check(o.mesh) })), selected: [...selected], active, op: op ? { kind: op.kind, axis: op.axis, typed: op.typed } : null, history: history.length, future: future.length, lastAdd: lastAdd && { ...lastAdd }, camera: view && view.camera() }),
    _project: (p) => view && view.project(p),
  };
})();
