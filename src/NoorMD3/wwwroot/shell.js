// NoorMD 3.0's shell page: the title bar and main menu, the bench tabs, each bench's main view and panels (with
// resizable edges), the status bar, Home and Settings. Benches are web modules from their DLLs
// (/benches/<id>/<entry>) and talk to their C# side through the shell (docs/noormd3/DESIGN.md, section 4).
import { el, menu, closeMenu, menuIsOpen, dialog, dialogIsOpen, toast } from '/ui/js/noor-ui.js';

const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------- the window (C#)
const pending = new Map();
let nextId = 1;
const hostListeners = [];
const webview = window.chrome && window.chrome.webview;
function call(target, cmd, args) {
  if (!webview) return Promise.reject(new Error('Not running inside NoorMD'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    webview.postMessage({ id, target, cmd, args: args === undefined ? null : args });
  });
}
if (webview) webview.addEventListener('message', (e) => {
  const m = e.data;
  if (m && m.id != null && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'Something went wrong'));
  } else if (m && m.event) hostListeners.forEach((fn) => fn(m));
});
const windowCall = (cmd, args) => call('window', cmd, args).catch(() => {});

// ---------------------------------------------------------------- state
let settings = null;           // the shell's settings (saved by the window)
let version = '';
let benches = new Map();       // id → manifest
let problems = [];
const open = new Map();        // id → instance { manifest, root, ctx, view, panels, status, title, layout }
let order = [];                // open bench ids, in tab order ('home' included when open)
let active = null;             // the bench in front ('home' or an id)
let focusMode = false;
// Panels floating in windows of their own: { id, ref, x, y, w, h, from: { bench, side } } (kept in the settings).
let floats = [];
const floatId = new URLSearchParams(location.search).get('float');   // set in a floating panel's own window

const HOME = { id: 'home', name: 'Home', icon: '⌂', density: 'roomy', menus: [], panels: [] };
const manifestOf = (id) => (id === 'home' ? HOME : benches.get(id));
const densityOf = (id) => (id === 'home' ? 'roomy' : (settings.density && settings.density[id]) || (manifestOf(id) || {}).density || 'roomy');

let saveTimer = 0;
function save() {
  if (floatId) return;   // a floating window's page doesn't own the settings
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    settings.openBenches = order.filter((id) => id !== 'home');
    settings.activeBench = active;
    settings.floats = floats.map((f) => ({ ...f }));
    for (const [id, inst] of open) if (id !== 'home') settings.layouts[id] = inst.layout;
    call('shell', 'settings.save', settings).catch((e) => toast('Settings couldn\'t be saved: ' + e.message, { error: true }));
  }, 300);
}

// ---------------------------------------------------------------- the theme and the look
const THEMES = [['dark', 'Dark'], ['light', 'Light'], ['nocturne', 'Nocturne'], ['ember', 'Ember'], ['evergreen', 'Evergreen'], ['rosewood', 'Rosewood'], ['parchment', 'Parchment'], ['glacier', 'Glacier'], ['contrast', 'High contrast']];
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  const cs = getComputedStyle(document.documentElement), v = (k) => cs.getPropertyValue(k).trim();
  const light = cs.colorScheme === 'light' || ['light', 'parchment', 'glacier'].includes(settings.theme);
  windowCall('theme', { bg: v('--bg'), fg: v('--text'), hover: light ? '#1A000000' : '#22FFFFFF', pressed: light ? '#2E000000' : '#38FFFFFF' });
  if (!floatId && floats.length) windowCall('broadcast', { name: 'settings', payload: { theme: settings.theme, density: settings.density } });   // floating windows follow
}
function applyMenuPosition() {
  const row = settings.menuPosition === 'row';
  $('#menurow').hidden = !row;
  (row ? $('#menurow') : $('#menubar')).append(...[...$('#menubar').children, ...$('#menurow').children]);
}
function applyDensity() {
  if (!floatId && floats.length) windowCall('broadcast', { name: 'settings', payload: { theme: settings.theme, density: settings.density } });
  document.body.classList.toggle('density-compact', densityOf(active) === 'compact');
  document.body.classList.toggle('density-roomy', densityOf(active) !== 'compact');
}

// ---------------------------------------------------------------- opening, switching and closing benches
async function openBench(id, { activate = true, quiet = false } = {}) {
  if (open.has(id)) { if (activate) activate_(id); return open.get(id); }
  const m = manifestOf(id);
  if (!m) { toast(`There is no bench "${id}".`, { error: true }); return null; }
  const inst = { manifest: m, status: '', title: '', placed: new Map(), bus: new Map(), layout: normaliseLayout(settings.layouts[id], m) };
  inst.root = el('section', { class: 'bench', hidden: true, 'data-bench': id, 'aria-label': m.name });
  inst.left = el('div', { class: 'side left' }); inst.right = el('div', { class: 'side right' }); inst.bottom = el('div', { class: 'side bottom' });
  inst.main = el('div', { class: 'main' }, inst.view = el('div', { class: 'view' }));
  inst.root.append(inst.left, resizer(inst, 'l'), inst.main, resizer(inst, 'r'), resizer(inst, 'b'), inst.bottom, inst.right);
  $('#benches').append(inst.root);
  open.set(id, inst);
  if (!order.includes(id)) order.push(id);
  if (id === 'home') renderHome(inst);
  else {
    inst.ctx = makeContext(id, inst);
    try {
      const mod = (await import(`/benches/${id}/${m.entry}`)).default;
      inst.module = mod;
      inst.mounted = mod.mount ? (mod.mount(inst.view, inst.ctx) || {}) : {};
    } catch (e) {
      inst.view.replaceChildren(el('div', { class: 'home' }, el('h1', { text: `${m.name} couldn't start` }), el('p', { class: 'lead', text: e.message })));
      console.error(e);
    }
  }
  await renderDocks(inst);
  renderTabs();
  if (activate) activate_(id);
  if (!quiet) save(); else save();
  return inst;
}

function activate_(id) {
  active = id;
  for (const [bid, inst] of open) inst.root.hidden = bid !== id;
  applyDensity();
  renderTabs(); renderMenus(); renderTitle(); renderStatus();
  const inst = open.get(id);
  if (inst && inst.mounted && inst.mounted.focus) setTimeout(() => inst.mounted.focus(), 0);
  save();
}

async function closeBench(id, { force = false } = {}) {
  const inst = open.get(id);
  if (!inst) return;
  // A bench may hold on (unsaved work): its canClose() answers, usually after asking the user.
  if (!force && inst.mounted && inst.mounted.canClose) {
    let ok = true;
    try { ok = await inst.mounted.canClose(); } catch (e) { console.error(e); }
    if (!ok || !open.has(id)) return;
  }
  try { inst.mounted && inst.mounted.unmount && inst.mounted.unmount(); } catch (e) { console.error(e); }
  for (const p of inst.placed.values()) try { p.result && p.result.unmount && p.result.unmount(); } catch (e) { console.error(e); }
  inst.root.remove();
  open.delete(id);
  // Its panels docked in other benches go with it (they need it running).
  let left = 0;
  for (const other of open.values()) {
    if (other.manifest.id === 'home') continue;
    const mine = placedRefs(other).filter((r) => splitRef(r)[0] === id);
    if (mine.length) { mine.forEach((r) => removeRef(other, r)); renderDocks(other); left += mine.length; }
  }
  for (const f of floats.filter((x) => splitRef(x.ref)[0] === id)) { windowCall('float.close', { id: f.id }); left++; }
  floats = floats.filter((x) => splitRef(x.ref)[0] !== id);
  if (left) toast(`${inst.manifest.name}'s panels left the other benches with it (open it again and dock them back).`);
  const i = order.indexOf(id);
  order = order.filter((x) => x !== id);
  if (active === id) {
    const next = order[Math.min(i, order.length - 1)];
    if (next) activate_(next); else openBench('home');
  }
  renderTabs(); save();
}

/** Files the window handed to a bench (dropped, or opened NoorMD with): the bench comes to the front and its page hears them. */
async function openFilesIn(id, paths) {
  const inst = await openBench(id);
  if (inst && inst.emit) inst.emit('shell.open', { paths });
}
// Files dropped anywhere on the window: WebView2 hands them to the window with their paths.
document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const host = window.chrome && window.chrome.webview;
  if (host && typeof host.postMessageWithAdditionalObjects === 'function') host.postMessageWithAdditionalObjects({ target: 'window', cmd: 'files.dropped' }, e.dataTransfer.files);
});

// ---------------------------------------------------------------- a bench's context: what its module may use
function makeContext(id, inst) {
  const styles = new Set();
  // An event reaches the bench's listeners here, and (through the window) in its other windows, so a floating
  // panel and the main window stay in step. Events arriving from elsewhere only go to the listeners here.
  const emitHere = (name, payload) => (inst.bus.get(name) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
  const emit = (name, payload) => { emitHere(name, payload); windowCall('bus.emit', { bench: id, name, payload: payload === undefined ? null : payload }); };
  inst.emit = emitHere;
  return {
    bench: inst.manifest,
    /** Runs a command on the bench's C# side. */
    call: (cmd, args) => call('bench:' + id, cmd, args),
    /** Listens to an event (from the C# side, or from the bench's own view and panels); returns a function that stops listening. */
    on(name, fn) { if (!inst.bus.has(name)) inst.bus.set(name, []); inst.bus.get(name).push(fn); return () => inst.bus.set(name, inst.bus.get(name).filter((f) => f !== fn)); },
    emit,
    setStatus(text) { inst.status = text || ''; if (active === id) renderStatus(); },
    setTitle(text) { inst.title = text || ''; if (active === id) renderTitle(); },
    toast: (text, opts) => toast(text, opts),
    /** Adds the bench's stylesheet once. */
    useStyle(href) { if (styles.has(href)) return; styles.add(href); document.head.append(el('link', { rel: 'stylesheet', href })); },
    /** Small things to bring back next time (kept with the bench's layout). */
    keep(key, value) { inst.layout.state[key] = value; if (floatId) windowCall('broadcast', { name: 'shell.keep', payload: { bench: id, key, value } }); else save(); },
    restore(key, fallback) { return key in inst.layout.state ? inst.layout.state[key] : fallback; },
    openBench: (bid) => openBench(bid),
    /** A dialog in the shell's style; resolves with the chosen button's value. */
    dialog: (title, body, buttons) => dialog(title, body, buttons),
  };
}
hostListeners.push((m) => {
  if (m.event === 'open' && !floatId) openFilesIn(m.bench, m.paths || []);
  else if (m.event === 'open.none' && !floatId) toast(`No bench opens ${(m.names || []).slice(0, 3).join(', ')}${(m.names || []).length > 3 ? '…' : ''}.`, { error: true });
  else if (m.event === 'bench' && open.has(m.bench)) open.get(m.bench).emit(m.name, m.payload);
  else if (m.event === 'shell.keep' && !floatId && m.payload && open.has(m.payload.bench)) { open.get(m.payload.bench).layout.state[m.payload.key] = m.payload.value; save(); }
  else if (m.event === 'float.closed' && !floatId) dockBack(floats.find((f) => f.id === m.id), { windowGone: true });
  else if (m.event === 'float.moved' && !floatId) { const f = floats.find((x) => x.id === m.id); if (f) { Object.assign(f, { x: Math.round(m.x), y: Math.round(m.y), w: Math.round(m.w), h: Math.round(m.h) }); save(); } }
  else if (m.event === 'settings' && floatId && m.payload) { Object.assign(settings, m.payload); applyTheme(); applyDensity(); }
  else if (m.event === 'window') { $('#winspace').style.width = Math.max(0, m.buttonsWidth || 0) + 'px'; document.body.classList.toggle('maximized', !!m.maximized); }
});

// ---------------------------------------------------------------- panels: docking, groups, resizable edges
// A bench's layout: three sides (left, right, bottom), each a list of groups; a group holds panels as tabs. A panel is
// named "<owner bench>:<panel id>", so a panel from another bench can be docked here (its owner runs it).
const SIDE_DEFAULT = { lw: 240, rw: 280, bh: 180 };
const SIDES = ['left', 'right', 'bottom'];
const refOf = (owner, pid) => `${owner}:${pid}`;
const splitRef = (ref) => { const i = ref.lastIndexOf(':'); return [ref.slice(0, i), ref.slice(i + 1)]; };
function specOf(ref) { const [owner, pid] = splitRef(ref); const m = manifestOf(owner); const spec = m && (m.panels || []).find((p) => p.id === pid); return spec ? { owner, pid, spec, bench: m } : null; }
function defaultDocks(m) {
  const docks = { left: [], right: [], bottom: [] };
  for (const p of m.panels || []) docks[p.dock].push({ panels: [refOf(m.id, p.id)], active: refOf(m.id, p.id), size: 1 });
  return docks;
}
function normaliseLayout(l, m) {
  const out = { lw: SIDE_DEFAULT.lw, rw: SIDE_DEFAULT.rw, bh: SIDE_DEFAULT.bh, docks: defaultDocks(m), state: {} };
  if (!l || typeof l !== 'object') return out;
  for (const k of ['lw', 'rw', 'bh']) if (Number.isFinite(l[k])) out[k] = l[k];
  if (l.state && typeof l.state === 'object') out.state = l.state;
  if (l.docks && typeof l.docks === 'object') {
    const seen = new Set();
    for (const side of SIDES) {
      out.docks[side] = (Array.isArray(l.docks[side]) ? l.docks[side] : []).map((g) => {
        const panels = (Array.isArray(g && g.panels) ? g.panels : []).filter((r) => typeof r === 'string' && r.includes(':') && !seen.has(r) && seen.add(r));
        return panels.length ? { panels, active: panels.includes(g.active) ? g.active : panels[0], size: Number.isFinite(g.size) && g.size > 0 ? g.size : 1 } : null;
      }).filter(Boolean);
    }
  } else if (Array.isArray(l.hidden)) {
    // 3.0.1's layouts: the default docks without the hidden panels.
    for (const side of SIDES) out.docks[side] = out.docks[side].filter((g) => !l.hidden.includes(splitRef(g.panels[0])[1]));
  }
  return out;
}
const placedRefs = (inst) => SIDES.flatMap((s) => inst.layout.docks[s].flatMap((g) => g.panels));
function whereIs(inst, ref) {
  for (const side of SIDES) { const gi = inst.layout.docks[side].findIndex((g) => g.panels.includes(ref)); if (gi >= 0) return { side, gi, group: inst.layout.docks[side][gi] }; }
  return null;
}
/** The panel's body in this bench, mounted by its owner bench the first time it's shown here. */
function placed(inst, ref) {
  if (inst.placed.has(ref)) return inst.placed.get(ref);
  const s = specOf(ref);
  const owner = s && open.get(s.owner);
  if (!s || !owner || !owner.module) return null;
  const body = el('div', { class: 'pbody', 'data-ref': ref });
  let result = {};
  const def = owner.module.panels && owner.module.panels[s.pid];
  try { result = def && def.mount ? def.mount(body, owner.ctx) || {} : (body.append(el('p', { class: 'nui-muted', text: 'Nothing here yet.' })), {}); }
  catch (e) { body.replaceChildren(el('p', { class: 'nui-muted', text: `This panel couldn't start: ${e.message}` })); }
  const p = { ref, spec: s.spec, owner: s.owner, body, result };
  inst.placed.set(ref, p);
  return p;
}
function unmountUnplaced(inst) {
  const keep = new Set(placedRefs(inst));
  for (const [ref, p] of inst.placed) if (!keep.has(ref)) { try { p.result.unmount && p.result.unmount(); } catch (e) { console.error(e); } p.body.remove(); inst.placed.delete(ref); }
}
/** Lays the bench's sides out from its layout: the groups, their tabs, the edges between them. */
async function renderDocks(inst) {
  // A docked panel from a bench that isn't open: open that bench quietly (its panels need it running).
  for (const ref of placedRefs(inst)) {
    const s = specOf(ref);
    if (!s) { removeRef(inst, ref); continue; }
    if (!open.has(s.owner)) await openBench(s.owner, { activate: false, quiet: true });
  }
  const sides = { left: inst.left, right: inst.right, bottom: inst.bottom };
  for (const side of SIDES) {
    const box = sides[side];
    box.replaceChildren();
    inst.layout.docks[side].forEach((g, gi) => {
      if (gi > 0) box.append(groupResizer(inst, side, gi));
      box.append(groupEl(inst, side, gi, g));
    });
  }
  unmountUnplaced(inst);
  const has = (s) => inst.layout.docks[s].length > 0;
  inst.root.style.setProperty('--lw', has('left') ? inst.layout.lw + 'px' : '0px');
  inst.root.style.setProperty('--rw', has('right') ? inst.layout.rw + 'px' : '0px');
  inst.root.style.setProperty('--bh', has('bottom') ? inst.layout.bh + 'px' : '0px');
  inst.root.querySelector('.resizer.l').hidden = !has('left');
  inst.root.querySelector('.resizer.r').hidden = !has('right');
  inst.root.querySelector('.resizer.b').hidden = !has('bottom');
}
function groupEl(inst, side, gi, g) {
  const tabs = g.panels.map((ref) => {
    const s = specOf(ref); if (!s) return null;
    const foreign = s.owner !== inst.manifest.id;
    const t = el('button', { class: 'ptab', role: 'tab', 'aria-selected': String(ref === g.active), 'data-ref': ref, title: `${s.spec.title}${foreign ? ` (from ${s.bench.name})` : ''}: drag to move it · right-click: more` },
      el('span', { text: s.spec.icon }), s.spec.title, foreign && s.bench.name !== s.spec.title ? el('small', { class: 'pfrom', text: s.bench.name }) : null);
    t.addEventListener('click', () => { if (dragJustEnded) return; g.active = ref; renderDocks(inst); save(); });
    t.addEventListener('pointerdown', (e) => startPanelDrag(e, inst, ref, t));
    t.addEventListener('contextmenu', (e) => { e.preventDefault(); panelMenu(inst, ref, e.clientX, e.clientY); });
    return t;
  }).filter(Boolean);
  const body = el('div', { class: 'gbody' });
  for (const ref of g.panels) { const p = placed(inst, ref); if (p) { p.body.hidden = ref !== g.active; body.append(p.body); } }
  return el('section', { class: 'pgroup', 'data-side': side, 'data-group': String(gi), style: { flex: `${g.size} 1 0` } },
    el('header', { role: 'tablist' }, ...tabs, el('span', { class: 'sp' }),
      el('button', { class: 'nui-icon', title: 'More (move, hide…)', 'aria-label': 'Panel menu', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); panelMenu(inst, g.active, r.left, r.bottom + 2); } }, '⋯'),
      el('button', { class: 'nui-icon', title: 'Hide this panel (View menu shows it again)', 'aria-label': `Hide ${(specOf(g.active) || { spec: {} }).spec.title}`, onclick: () => hidePanel(inst, g.active) }, '✕')),
    body);
}
function removeRef(inst, ref) {
  for (const side of SIDES) {
    inst.layout.docks[side] = inst.layout.docks[side].map((g) => {
      if (!g.panels.includes(ref)) return g;
      const panels = g.panels.filter((r) => r !== ref);
      return panels.length ? { ...g, panels, active: g.active === ref ? panels[Math.max(0, g.panels.indexOf(ref) - 1)] : g.active } : null;
    }).filter(Boolean);
  }
}
/** Moves a panel: onto a side (a new group at its end), before or after a group, or into a group as a tab. */
function movePanel(inst, ref, target) {
  const from = whereIs(inst, ref);
  let { side, gi = null, where = 'end' } = target;
  // Removing it first can shift the group numbers on the same side.
  const sameSideBefore = from && from.side === side && gi != null && from.gi < gi && from.group.panels.length === 1;
  removeRef(inst, ref);
  if (sameSideBefore) gi -= 1;
  const list = inst.layout.docks[side];
  if (where === 'tab' && gi != null && list[gi]) { list[gi].panels.push(ref); list[gi].active = ref; }
  else {
    const g = { panels: [ref], active: ref, size: 1 };
    if (gi == null || where === 'end') list.push(g);
    else list.splice(where === 'before' ? gi : gi + 1, 0, g);
  }
  renderDocks(inst); save();
}
async function showPanel(inst, ref, side) {
  if (whereIs(inst, ref)) return;
  const s = specOf(ref); if (!s) return;
  if (!open.has(s.owner)) await openBench(s.owner, { activate: false, quiet: true });
  movePanel(inst, ref, { side: side || s.spec.dock });
  if (s.owner !== inst.manifest.id) toast(`${s.spec.title}${s.bench.name !== s.spec.title ? ` from ${s.bench.name}` : ''} is docked here now, and keeps working.`);
}
function hidePanel(inst, ref) { removeRef(inst, ref); renderDocks(inst); save(); }
function panelMenu(inst, ref, x, y) {
  const s = specOf(ref), at = whereIs(inst, ref);
  if (!s || !at) return;
  const sideName = { left: 'Left', right: 'Right', bottom: 'Bottom' };
  menu(x, y, [{ header: `${s.spec.title}${s.owner !== inst.manifest.id ? ` · from ${s.bench.name}` : ''}` },
    ...SIDES.filter((sd) => sd !== at.side).map((sd) => ({ label: `Move to the ${sideName[sd].toLowerCase()}`, run: () => movePanel(inst, ref, { side: sd }) })),
    ...(at.group.panels.length > 1 ? [{ label: 'Into its own group', run: () => movePanel(inst, ref, { side: at.side, gi: at.gi, where: 'after' }) }] : []),
    '-', { label: 'Float in its own window', run: () => floatPanel(inst, ref) }, { label: 'Hide', run: () => hidePanel(inst, ref) }]);
}

// ---------------------------------------------------------------- floating panels (3.0.4)
// A panel can float in a window of its own (for a second monitor). The window runs the panel from its own copy of
// the bench's web module; events go between the windows, so both stay in step. Closing it docks the panel back.
const isFloating = (ref) => floats.some((f) => f.ref === ref);
const isShown = (inst, ref) => !!whereIs(inst, ref) || isFloating(ref);
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
function floatPanel(inst, ref, at) {
  if (isFloating(ref)) return;
  const s = specOf(ref), where = whereIs(inst, ref);
  if (!s) return;
  const p = inst.placed.get(ref);
  const r = p && p.body.isConnected ? p.body.getBoundingClientRect() : { width: 320, height: 260 };
  const w = Math.round(Math.max(280, Math.min(r.width, 640))), h = Math.round(Math.max(200, Math.min(r.height + 40, 720)));
  const state = p && p.result && p.result.getState ? p.result.getState() : null;
  const f = { id: newId(), ref, w, h, x: Math.round(at ? at.x : window.screenX + window.outerWidth - w - 60), y: Math.round(at ? at.y : window.screenY + 90), from: { bench: inst.manifest.id, side: where ? where.side : s.spec.dock } };
  if (where) { removeRef(inst, ref); renderDocks(inst); }
  floats.push(f);
  openFloat(f, state);
  save();
}
function openFloat(f, state) {
  const s = specOf(f.ref), owner = s && open.get(s.owner);
  if (!s || !owner) return;
  windowCall('float.open', { id: f.id, ref: f.ref, x: f.x, y: f.y, w: f.w, h: f.h, title: s.spec.title, icon: s.spec.icon, benchName: s.bench.name, state: state === undefined ? null : state, benchState: owner.layout.state });
}
/** Puts a floating panel back where it came from (or into the bench in front), closing its window if it's open. */
function dockBack(f, { windowGone = false } = {}) {
  if (!f) return;
  floats = floats.filter((x) => x !== f);
  if (!windowGone) windowCall('float.close', { id: f.id });
  const host = open.get(f.from && f.from.bench) || (active !== 'home' ? open.get(active) : null);
  if (host && host.manifest.id !== 'home' && specOf(f.ref)) movePanel(host, f.ref, { side: (f.from && f.from.side) || specOf(f.ref).spec.dock });
  save();
}
/** Window › Get over here!: every floating panel back in the main window, each where it came from. */
function getOverHere() {
  const n = floats.length;
  if (!n) { toast('No panel is floating: everything is already here.'); return; }
  // Where each floating window was, seen from this window (the rope flies that way).
  const chrome = Math.max(0, window.outerHeight - window.innerHeight);
  const pulls = floats.map((f) => ({ ref: f.ref, from: { x: f.x + f.w / 2 - window.screenX, y: f.y + 16 - window.screenY - chrome } }));
  [...floats].forEach((f) => dockBack(f));
  toast(n === 1 ? 'Get over here! One panel pulled back in.' : `Get over here! ${n} panels pulled back in.`);
  requestAnimationFrame(() => grapplingHooks(pulls));
}
/** The easter egg: a rope with a hook flies from each panel's new place out towards its floating window, catches
    it, and reels it in (a little card riding back along the rope). Skipped when the system asks for less motion. */
function grapplingHooks(pulls) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'hooks'); svg.setAttribute('aria-hidden', 'true');
  document.body.append(svg);
  const items = pulls.map((p) => {
    const tab = document.querySelector(`.bench:not([hidden]) .ptab[data-ref="${CSS.escape(p.ref)}"]`) || document.querySelector('.btab[aria-selected=true]');
    if (!tab) return null;
    const r = tab.getBoundingClientRect(), to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    // The far end: the floating window's place, kept to the edge of this window when it was outside it.
    const m = 6, far = { x: Math.max(m, Math.min(innerWidth - m, p.from.x)), y: Math.max(m, Math.min(innerHeight - m, p.from.y)) };
    if (Math.hypot(far.x - to.x, far.y - to.y) < 60) far.x = Math.min(innerWidth - m, to.x + 220);
    const rope = document.createElementNS(NS, 'path'); rope.setAttribute('class', 'rope');
    const hook = document.createElementNS(NS, 'path'); hook.setAttribute('class', 'hook');
    hook.setAttribute('d', 'M0,0 L-10,-6 M0,0 L-10,6 M0,0 L-14,0 M-6,-3.5 Q-2,-9 4,-8 M-6,3.5 Q-2,9 4,8');
    svg.append(rope, hook);
    const sp = specOf(p.ref);
    const card = el('div', { class: 'hook-card', text: sp ? `${sp.spec.icon}  ${sp.spec.title}` : '' });
    document.body.append(card);
    return { to, far, rope, hook, card, tab, angle: Math.atan2(far.y - to.y, far.x - to.x) };
  }).filter(Boolean);
  const pulse = () => items.forEach((it) => { it.tab.classList.add('hooked'); setTimeout(() => it.tab.classList.remove('hooked'), 700); });
  if (reduce || !items.length) { svg.remove(); items.forEach((it) => it.card.remove()); pulse(); return; }
  const OUT = 330, HOLD = 120, BACK = 430, t0 = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const frame = (now) => {
    const t = now - t0;
    for (const it of items) {
      let k, carrying = false;
      if (t < OUT) k = ease(t / OUT);
      else if (t < OUT + HOLD) k = 1 + Math.sin((t - OUT) / HOLD * Math.PI) * 0.025;   // the catch: a little tug
      else { k = 1 - ease(Math.min(1, (t - OUT - HOLD) / BACK)); carrying = true; }
      const tip = { x: it.to.x + (it.far.x - it.to.x) * k, y: it.to.y + (it.far.y - it.to.y) * k };
      // A rope with a bit of slack while it flies, pulled straight as it reels in.
      const sag = (carrying ? 4 : 14) * Math.sin(Math.min(1, k) * Math.PI), mx = (it.to.x + tip.x) / 2 - Math.sin(it.angle) * sag, my = (it.to.y + tip.y) / 2 + Math.cos(it.angle) * sag;
      it.rope.setAttribute('d', `M${it.to.x},${it.to.y} Q${mx},${my} ${tip.x},${tip.y}`);
      it.hook.setAttribute('transform', `translate(${tip.x},${tip.y}) rotate(${it.angle * 180 / Math.PI})`);
      it.card.style.opacity = carrying ? '1' : '0';
      it.card.style.transform = `translate(${tip.x}px, ${tip.y}px) translate(-50%, -50%)`;
    }
    if (t < OUT + HOLD + BACK) requestAnimationFrame(frame);
    else { svg.remove(); items.forEach((it) => it.card.remove()); pulse(); }
  };
  requestAnimationFrame(frame);
}

// Dragging a panel by its tab: drop zones show where it lands (a side's edge, before or after a group, or into a
// group as a tab). Esc cancels.
let dragJustEnded = false;
function startPanelDrag(e, inst, ref, tab) {
  if (e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  let drag = null;
  const move = (m) => {
    if (!drag) {
      if (Math.hypot(m.clientX - x0, m.clientY - y0) < 6) return;
      const s = specOf(ref);
      drag = { ghost: el('div', { class: 'dock-ghost', text: `${s.spec.icon}  ${s.spec.title}` }), mark: el('div', { class: 'dock-mark' }), zones: edgeZones(inst), target: null, label: `${s.spec.icon}  ${s.spec.title}` };
      try { tab.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }   // keep hearing the mouse outside the window
      document.body.append(drag.ghost, drag.mark, ...drag.zones.map((z) => z.el));
      document.body.classList.add('dock-dragging');
    }
    drag.ghost.style.left = m.clientX + 12 + 'px'; drag.ghost.style.top = m.clientY + 12 + 'px';
    // Out of the window: it'll float in a window of its own, there.
    const outside = !floatId && (m.clientX < 0 || m.clientY < 0 || m.clientX > innerWidth || m.clientY > innerHeight);
    drag.target = outside ? { float: true, x: m.screenX - 40, y: m.screenY - 16 } : dropTarget(inst, ref, m.clientX, m.clientY, drag.zones);
    drag.ghost.textContent = outside ? `${drag.label}  ↗ its own window` : drag.label;
    const t = drag.target && !drag.target.float ? drag.target : null;
    drag.mark.hidden = !t;
    if (t) Object.assign(drag.mark.style, { left: t.rect.left + 'px', top: t.rect.top + 'px', width: t.rect.width + 'px', height: t.rect.height + 'px' });
  };
  const end = (commit) => {
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('keydown', key, true);
    if (!drag) return;
    drag.ghost.remove(); drag.mark.remove(); drag.zones.forEach((z) => z.el.remove());
    document.body.classList.remove('dock-dragging');
    dragJustEnded = true; setTimeout(() => { dragJustEnded = false; }, 0);
    if (commit && drag.target && drag.target.float) floatPanel(inst, ref, drag.target);
    else if (commit && drag.target) movePanel(inst, ref, drag.target);
  };
  const up = () => end(true);
  const key = (k) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); end(false); } };
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('keydown', key, true);
  void tab;
}
/** Strips along the main view's left, right and bottom edges: dropping there puts the panel on that side. */
function edgeZones(inst) {
  const r = inst.main.getBoundingClientRect(), w = Math.min(64, r.width / 5), h = Math.min(64, r.height / 5);
  return [
    { side: 'left', rect: new DOMRect(r.left, r.top, w, r.height) },
    { side: 'right', rect: new DOMRect(r.right - w, r.top, w, r.height) },
    { side: 'bottom', rect: new DOMRect(r.left + w, r.bottom - h, r.width - 2 * w, h) },
  ].map((z) => ({ ...z, el: el('div', { class: 'dock-zone', 'data-zone': z.side, style: { left: z.rect.left + 'px', top: z.rect.top + 'px', width: z.rect.width + 'px', height: z.rect.height + 'px' } }) }));
}
const inRect = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
function dropTarget(inst, ref, x, y, zones) {
  for (const z of zones) if (inRect(z.rect, x, y)) return { side: z.side, where: 'end', rect: z.rect };
  for (const g of inst.root.querySelectorAll('.pgroup')) {
    const r = g.getBoundingClientRect();
    if (!inRect(r, x, y)) continue;
    const side = g.dataset.side, gi = Number(g.dataset.group), horiz = side === 'bottom';
    const f = horiz ? (x - r.left) / r.width : (y - r.top) / r.height;
    if (f < 0.28) return { side, gi, where: 'before', rect: horiz ? new DOMRect(r.left, r.top, r.width / 2, r.height) : new DOMRect(r.left, r.top, r.width, r.height / 2) };
    if (f > 0.72) return { side, gi, where: 'after', rect: horiz ? new DOMRect(r.left + r.width / 2, r.top, r.width / 2, r.height) : new DOMRect(r.left, r.top + r.height / 2, r.width, r.height / 2) };
    const group = inst.layout.docks[side][gi];
    if (group && group.panels.includes(ref) && group.panels.length === 1) return null; // onto itself
    return { side, gi, where: 'tab', rect: r };
  }
  return null;
}
/** The edge between two groups on a side: drag to share the room between them. */
function groupResizer(inst, side, gi) {
  const horiz = side === 'bottom';
  const r = el('div', { class: 'gresizer' + (horiz ? ' h' : ''), role: 'separator', 'aria-orientation': horiz ? 'vertical' : 'horizontal', title: 'Drag to share the room · double-click: evenly' });
  r.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); r.setPointerCapture(e.pointerId); r.classList.add('dragging');
    const a = r.previousElementSibling, b = r.nextElementSibling, ga = inst.layout.docks[side][gi - 1], gb = inst.layout.docks[side][gi];
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const total = horiz ? ra.width + rb.width : ra.height + rb.height, sum = ga.size + gb.size, start = horiz ? e.clientX : e.clientY, from = horiz ? ra.width : ra.height;
    r.onpointermove = (m) => {
      const pa = Math.max(80, Math.min(total - 80, from + (horiz ? m.clientX : m.clientY) - start));
      ga.size = sum * pa / total; gb.size = sum - ga.size;
      a.style.flex = `${ga.size} 1 0`; b.style.flex = `${gb.size} 1 0`;
    };
    r.onpointerup = () => { r.onpointermove = null; r.classList.remove('dragging'); save(); };
  });
  r.addEventListener('dblclick', () => { for (const g of inst.layout.docks[side]) g.size = 1; renderDocks(inst); save(); });
  return r;
}
/** Drag a side's edge to resize it; double-click it to put it back to its usual size. */
function resizer(inst, which) {
  const key = { l: 'lw', r: 'rw', b: 'bh' }[which];
  const r = el('div', { class: 'resizer ' + which, role: 'separator', 'aria-orientation': which === 'b' ? 'horizontal' : 'vertical', title: 'Drag to resize · double-click: the usual size', tabindex: '0' });
  const apply = (v) => { inst.layout[key] = Math.round(Math.max(140, Math.min(v, which === 'b' ? innerHeight * 0.7 : innerWidth * 0.45))); inst.root.style.setProperty('--' + key, inst.layout[key] + 'px'); };
  r.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); r.setPointerCapture(e.pointerId); r.classList.add('dragging');
    const start = which === 'b' ? e.clientY : e.clientX, from = inst.layout[key];
    r.onpointermove = (m) => { const d = (which === 'b' ? m.clientY : m.clientX) - start; apply(which === 'l' ? from + d : from - d); };
    r.onpointerup = () => { r.onpointermove = null; r.classList.remove('dragging'); save(); };
  });
  r.addEventListener('dblclick', () => { apply(SIDE_DEFAULT[key]); save(); });
  r.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10, grow = which === 'l' ? 'ArrowRight' : which === 'r' ? 'ArrowLeft' : 'ArrowUp', shrink = which === 'l' ? 'ArrowLeft' : which === 'r' ? 'ArrowRight' : 'ArrowDown';
    if (e.key === grow) { apply(inst.layout[key] + step); save(); } else if (e.key === shrink) { apply(inst.layout[key] - step); save(); }
  });
  return r;
}

// ---------------------------------------------------------------- the main menu
const keyOf = (k) => k;
function benchCommand(cmd) {
  const inst = open.get(active);
  if (!inst || active === 'home') return;
  const local = inst.mounted && inst.mounted.commands && inst.mounted.commands[cmd];
  const run = local ? Promise.resolve().then(() => local()) : inst.ctx.call(cmd);
  run.catch((e) => toast(e.message, { error: true }));
}
/** A bench's menu called File, Edit or View joins the shell's menu of that name (its items first). */
const SHARED_MENUS = ['File', 'Edit', 'View'];
/** A bench menu item for the shell's menus; its module may tick it (checked(command) → true / false). */
function benchItem(it) {
  if (!it.command) return '-';
  const inst = open.get(active), ask = inst && inst.mounted && inst.mounted.checked;
  const ticked = ask ? inst.mounted.checked(it.command) : undefined;
  return { label: it.label, keys: it.keys, run: () => benchCommand(it.command), ...(typeof ticked === 'boolean' ? { checked: () => !!inst.mounted.checked(it.command) } : {}) };
}
function benchItems(m, title) {
  const mm = (m.menus || []).find((x) => x.title === title);
  return mm ? [...mm.items.map(benchItem), '-'] : [];
}
const claims = (keys) => SHORTCUTS().has(keys);
function appMenus() {
  const inst = open.get(active), m = manifestOf(active) || HOME;
  // Undo and redo go to the bench when it has its own (an editor with its own history), else to the page.
  const edit = (c) => () => { const own = inst && inst.mounted && inst.mounted.commands && inst.mounted.commands['edit.' + c]; if (own) own(); else document.execCommand(c); };
  const menus = [
    ['File', () => [...benchItems(m, 'File'), { label: 'Home', keys: 'Ctrl+Shift+H', run: () => openBench('home') }, { label: 'Open a bench…', run: () => benchPicker() }, '-', { label: `Close ${m.name}`, keys: claims('ctrl+w') ? 'Ctrl+Shift+W' : 'Ctrl+W', run: () => closeBench(active), disabled: !active }, '-', { label: 'Settings…', keys: 'Ctrl+,', run: settingsDialog }, '-', { label: 'Exit', keys: 'Alt+F4', run: () => windowCall('close') }]],
    ['Edit', () => [...benchItems(m, 'Edit'), { label: 'Undo', keys: 'Ctrl+Z', run: edit('undo') }, { label: 'Redo', keys: 'Ctrl+Y', run: edit('redo') }, '-', { label: 'Cut', keys: 'Ctrl+X', run: edit('cut') }, { label: 'Copy', keys: 'Ctrl+C', run: edit('copy') }, { label: 'Paste', keys: 'Ctrl+V', run: () => navigator.clipboard.readText().then((t) => document.execCommand('insertText', false, t)).catch(() => {}) }, { label: 'Select all', keys: 'Ctrl+A', run: edit('selectAll') }]],
    ['View', () => [...benchItems(m, 'View'),
      ...(m.panels.length ? [{ header: `Panels of ${m.name}` }, ...m.panels.map((p) => { const ref = refOf(m.id, p.id); return { label: `${p.icon}  ${p.title}`, checked: () => isShown(inst, ref), run: () => (isFloating(ref) ? dockBack(floats.find((f) => f.ref === ref)) : whereIs(inst, ref) ? hidePanel(inst, ref) : showPanel(inst, ref)) }; })] : [{ header: 'No panels of its own' }]),
      ...(active === 'home' ? [] : (() => { const others = [...benches.values()].filter((b) => b.id !== m.id && (b.panels || []).length); return others.length ? ['-', { header: 'Panels from other benches' }, ...others.flatMap((b) => b.panels.map((p) => { const ref = refOf(b.id, p.id); return { label: `${p.icon}  ${p.title} (${b.name})`, checked: () => isShown(inst, ref), run: () => (isFloating(ref) ? dockBack(floats.find((f) => f.ref === ref)) : whereIs(inst, ref) ? hidePanel(inst, ref) : showPanel(inst, ref)) }; }))] : []; })()),
      '-', { label: 'Reset the layout', disabled: active === 'home', run: () => { inst.layout = normaliseLayout({ state: inst.layout.state }, m); renderDocks(inst); save(); } },
      { header: 'Density' }, { label: 'Roomy', checked: () => densityOf(active) === 'roomy', disabled: active === 'home', run: () => setDensity(active, 'roomy') }, { label: 'Compact', checked: () => densityOf(active) === 'compact', disabled: active === 'home', run: () => setDensity(active, 'compact') },
      '-', { label: 'Focus mode', keys: 'F11', checked: () => focusMode, run: toggleFocus }]],
    ...(m.menus || []).filter((mm) => !SHARED_MENUS.includes(mm.title)).map((mm) => [mm.title, () => mm.items.map(benchItem)]),
    ['Tools', () => [{ label: 'Settings…', keys: 'Ctrl+,', run: settingsDialog }, { label: 'Benches…', run: benchesDialog }]],
    ['Window', () => [{ label: 'Home', keys: 'Ctrl+Shift+H', run: () => openBench('home') }, '-',
      { header: floats.length ? `Floating panels (${floats.length})` : 'Floating panels' }, ...floats.map((f) => { const sp = specOf(f.ref); return { label: `${sp ? sp.spec.icon + '  ' + sp.spec.title : f.ref} · dock it back`, run: () => dockBack(f) }; }),
      { label: 'Get over here!', keys: 'Ctrl+Shift+G', disabled: !floats.length, run: getOverHere }, '-', { header: 'Open benches' }, ...order.map((id, i) => ({ label: `${manifestOf(id).icon}  ${manifestOf(id).name}`, keys: i < 9 ? `Ctrl+${i + 1}` : '', checked: () => id === active, run: () => activate_(id) })), '-', { label: 'Next bench', keys: 'Ctrl+Tab', run: () => cycle(1) }, { label: 'Previous bench', keys: 'Ctrl+Shift+Tab', run: () => cycle(-1) }, '-', { label: 'Move the tab left', keys: 'Ctrl+Shift+PageUp', disabled: order.indexOf(active) <= 0, run: () => moveTab(-1) }, { label: 'Move the tab right', keys: 'Ctrl+Shift+PageDown', disabled: order.indexOf(active) >= order.length - 1, run: () => moveTab(1) }]],
    ['Help', () => [{ label: 'About NoorMD', run: aboutDialog }]],
  ];
  return menus;
}
let menuOpenIndex = -1;
function renderMenus() {
  const bar = settings.menuPosition === 'row' ? $('#menurow') : $('#menubar');
  const other = settings.menuPosition === 'row' ? $('#menubar') : $('#menurow');
  other.replaceChildren();
  const menus = appMenus();
  bar.replaceChildren(...menus.map(([title], i) => el('button', { 'data-menu': String(i), 'aria-haspopup': 'menu', onclick: (e) => toggleMainMenu(i, e.currentTarget), onpointerenter: (e) => { if (menuOpenIndex >= 0 && menuOpenIndex !== i) toggleMainMenu(i, e.currentTarget); } }, title)));
}
function toggleMainMenu(i, button) {
  if (menuOpenIndex === i && menuIsOpen()) { closeMenu(); return; }
  const menus = appMenus();
  if (!menus[i]) return;
  const bar = button.parentElement;
  bar.querySelectorAll('button').forEach((b) => b.classList.remove('open'));
  button.classList.add('open');
  const r = button.getBoundingClientRect();
  menuOpenIndex = i;
  const m = menu(r.left, r.bottom + 2, menus[i][1](), { anchor: bar, onClose: () => { button.classList.remove('open'); if (menuOpenIndex === i) menuOpenIndex = -1; } });
  // ← → move between the main menus while one is open.
  m.box.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const n = menus.length, j = (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    toggleMainMenu(j, bar.querySelector(`[data-menu="${j}"]`));
  });
}

// ---------------------------------------------------------------- tabs, title, status
function renderTabs() {
  const tabs = order.map((id, i) => {
    const m = manifestOf(id);
    return el('button', { class: 'btab', role: 'tab', 'aria-selected': String(id === active), 'data-bench': id, title: `${m.name}${i < 9 ? ` (Ctrl+${i + 1})` : ''}`, onclick: () => { if (!tabDragEnded) activate_(id); }, onauxclick: (e) => { if (e.button === 1) closeBench(id); } },
      el('span', { class: 'ic', text: m.icon }), m.name,
      el('span', { class: 'x', role: 'button', title: `Close ${m.name}`, 'aria-label': `Close ${m.name}`, onclick: (e) => { e.stopPropagation(); closeBench(id); } }, '✕'));
  });
  tabs.forEach((t) => t.addEventListener('pointerdown', (e) => startTabDrag(e, t.dataset.bench)));
  $('#benchtabs').replaceChildren(el('div', { role: 'tablist', style: { display: 'contents' } }, ...tabs), el('button', { class: 'btab add', title: 'Open a bench', 'aria-label': 'Open a bench', onclick: (e) => benchPicker(e.currentTarget) }, '＋'));
}
/** Drag a bench tab left or right to put it elsewhere in the row (the order is kept). */
let tabDragEnded = false;
function startTabDrag(e, id) {
  if (e.button !== 0 || e.target.closest('.x')) return;
  const x0 = e.clientX;
  let dragging = false;
  const move = (m) => {
    if (!dragging) { if (Math.abs(m.clientX - x0) < 8) return; dragging = true; document.body.classList.add('tab-dragging'); }
    // Where the mouse is among the other tabs' middles decides the new place.
    const others = [...document.querySelectorAll('#benchtabs .btab[data-bench]')].filter((t) => t.dataset.bench !== id);
    let at = others.findIndex((t) => { const r = t.getBoundingClientRect(); return m.clientX < r.left + r.width / 2; });
    if (at < 0) at = others.length;
    const next = others.map((t) => t.dataset.bench); next.splice(at, 0, id);
    if (next.join() !== order.join()) { order = next; renderTabs(); }
    const me = document.querySelector(`#benchtabs .btab[data-bench="${CSS.escape(id)}"]`); if (me) me.classList.add('moving');
  };
  const up = () => {
    document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true);
    if (!dragging) return;
    document.body.classList.remove('tab-dragging');
    tabDragEnded = true; setTimeout(() => { tabDragEnded = false; }, 0);
    renderTabs(); renderMenus(); save();
  };
  document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true);
}
/** Moves the bench in front one place left (-1) or right (+1) in the row. */
function moveTab(d) {
  const i = order.indexOf(active), j = i + d;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  renderTabs(); renderMenus(); save();
}
function renderTitle() {
  if (renderTitleGuard()) return;   // a floating window keeps its own title
  const inst = open.get(active), m = manifestOf(active) || HOME;
  const sub = inst && inst.title ? inst.title : '';
  $('#wintitle').replaceChildren(el('b', { text: m.name }), sub ? `· ${sub} — NoorMD` : '— NoorMD');
  windowCall('title', { text: `${m.name}${sub ? ' · ' + sub : ''} — NoorMD` });
}
function renderStatus() {
  const inst = open.get(active);
  $('#status-bench').textContent = inst ? inst.status : '';
  $('#status-app').textContent = `NoorMD ${version}`;
}
function cycle(d) { if (!order.length) return; const i = order.indexOf(active); activate_(order[(i + d + order.length) % order.length]); }
function setDensity(id, d) { settings.density[id] = d; if ((manifestOf(id) || {}).density === d) delete settings.density[id]; applyDensity(); save(); }
function toggleFocus() { focusMode = !focusMode; $('#app').classList.toggle('focus', focusMode); }

// ---------------------------------------------------------------- Home
function renderHome(inst) {
  const hour = new Date().getHours(), greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const cards = [...benches.values()].map((m) => el('button', { class: 'card', onclick: () => openBench(m.id) }, el('span', { class: 'ic', text: m.icon }), el('b', { text: m.name }), el('small', { text: m.description })));
  inst.view.replaceChildren(el('div', { class: 'home' },
    el('h1', { text: `${greet} 🙂` }),
    el('p', { class: 'lead', text: 'NoorMD comes back to your last session. Home is here on the first start, when nothing is open, and with Ctrl+Shift+H.' }),
    el('h2', { text: 'Open a bench' }), el('div', { class: 'grid' }, ...cards),
    el('h2', { text: 'Recent' }), el('div', { class: 'empty', text: 'Your recent files and vaults show here once the Markdown and Vault benches arrive.' }),
    el('h2', { text: `What's new in ${version}` }),
    el('p', { class: 'lead', text: 'The first piece of NoorMD 3.0: the new window and title bar, the main menu that follows the bench, bench tabs, resizable side panels, Home, Settings (theme, menu position, density per bench), and the Sandbox bench proving how benches plug in. Docking, floating windows and the real benches come next.' })));
  inst.status = `${benches.size} bench${benches.size === 1 ? '' : 'es'} available`;
}

// ---------------------------------------------------------------- dialogs
function benchPicker(anchor) {
  const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 120, bottom: 80 };
  const closed = [...benches.values()].filter((m) => !open.has(m.id));
  menu(r.left, r.bottom + 2, [{ header: 'Open a bench' }, ...closed.map((m) => ({ label: `${m.icon}  ${m.name}`, run: () => openBench(m.id) })), ...(closed.length ? [] : [{ label: 'Every bench is open', disabled: true }]), '-', { label: 'Home', keys: 'Ctrl+Shift+H', run: () => openBench('home') }]);
}
async function settingsDialog() {
  const draft = JSON.parse(JSON.stringify(settings));
  const themeSel = el('select', { class: 'nui-select', 'aria-label': 'Theme' }, ...THEMES.map(([v, n]) => el('option', { value: v, selected: v === draft.theme ? '' : null }, n)));
  themeSel.onchange = () => { settings.theme = themeSel.value; applyTheme(); };
  const seg = (name, value, options, onPick) => { const box = el('div', { class: 'nui-seg', role: 'group', 'aria-label': name }); const draw = () => box.replaceChildren(...options.map(([v, n]) => el('button', { 'aria-pressed': String(v === value), onclick: () => { value = v; onPick(v); draw(); } }, n))); draw(); return box; };
  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    el('div', { class: 'nui-setting' }, el('span', {}, 'Theme', el('small', { text: 'The nine themes of NoorMD, in every bench.' })), themeSel),
    el('div', { class: 'nui-setting' }, el('span', {}, 'Main menu', el('small', { text: 'In the title bar (saves a row) or on its own row under it.' })), seg('Main menu', draft.menuPosition, [['title', 'Title bar'], ['row', 'Own row']], (v) => { settings.menuPosition = v; applyMenuPosition(); renderMenus(); })),
    el('div', { class: 'nui-h', text: 'Density, per bench' }),
    ...[...benches.values()].map((m) => el('div', { class: 'nui-setting' }, el('span', {}, `${m.icon}  ${m.name}`, el('small', { text: `Its own: ${m.density}` })), seg(`Density of ${m.name}`, (settings.density[m.id]) || m.density, [['roomy', 'Roomy'], ['compact', 'Compact']], (v) => setDensity(m.id, v)))));
  const v = await dialog('Settings', body, [{ label: 'Cancel', value: 'cancel' }, { label: 'Done', value: 'ok', primary: true }]);
  if (v === 'cancel') { Object.assign(settings, draft); applyTheme(); applyMenuPosition(); renderMenus(); applyDensity(); }
  save();
}
function benchesDialog() {
  const rows = [...benches.values()].map((m) => el('div', { class: 'nui-row' }, el('span', { text: `${m.icon}  ${m.name}` }), el('span', { class: 'nui-muted', text: `${m.id} · ${m.version} · contract ${m.contractVersion}` })));
  dialog('Benches', el('div', {}, el('div', { class: 'nui-list' }, ...rows), problems.length ? el('div', {}, el('div', { class: 'nui-h', text: 'Not loaded' }), ...problems.map((p) => el('p', { class: 'nui-muted', text: p }))) : null));
}
function aboutDialog() {
  dialog('About NoorMD', el('div', {}, el('p', { text: `NoorMD ${version}: one home for writing, media and making game assets.` }), el('p', { class: 'nui-muted', text: `Bench contract ${settings ? 1 : ''} · ${benches.size} benches.` })));
}

// ---------------------------------------------------------------- keys
const SHORTCUTS = () => {
  const m = manifestOf(active) || HOME, map = new Map();
  for (const mm of m.menus || []) for (const it of mm.items) if (it.command && it.keys) map.set(it.keys.toLowerCase(), () => benchCommand(it.command));
  return map;
};
function keyName(e) {
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+').toLowerCase();
}
document.addEventListener('keydown', (e) => {
  if (dialogIsOpen()) return;
  const k = keyName(e);
  if (k === 'ctrl+,') { e.preventDefault(); settingsDialog(); }
  else if (k === 'ctrl+shift+h') { e.preventDefault(); openBench('home'); }
  else if (k === 'ctrl+shift+w' || (k === 'ctrl+w' && !claims('ctrl+w'))) { e.preventDefault(); if (active) closeBench(active); }
  else if (k === 'f11') { e.preventDefault(); toggleFocus(); }
  else if (k === 'f10') { e.preventDefault(); const b = document.querySelector('[data-menu="0"]'); if (b) toggleMainMenu(0, b); }
  else if (k === 'ctrl+tab') { e.preventDefault(); cycle(1); }
  else if (k === 'ctrl+shift+tab') { e.preventDefault(); cycle(-1); }
  else if (k === 'ctrl+shift+g' && !floatId) { e.preventDefault(); getOverHere(); }
  else if (k === 'ctrl+shift+pageup') { e.preventDefault(); moveTab(-1); }
  else if (k === 'ctrl+shift+pagedown') { e.preventDefault(); moveTab(1); }
  else if (/^ctrl\+[1-9]$/.test(k) && order[Number(k.slice(5)) - 1]) { e.preventDefault(); activate_(order[Number(k.slice(5)) - 1]); }
  else if (k === 'escape' && focusMode && !menuIsOpen()) { e.preventDefault(); toggleFocus(); }
  // A key the bench's editor already handled (Ctrl+B in a text editor) isn't run a second time.
  else if (!e.defaultPrevented) { const run = SHORTCUTS().get(k); if (run) { e.preventDefault(); run(); } }
});
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea, [contenteditable]')) e.preventDefault(); });
$('#logo').addEventListener('click', () => openBench('home'));

// ---------------------------------------------------------------- start
async function start() {
  if (floatId) { await startFloat(); return; }
  let s;
  try { s = await call('shell', 'start'); }
  catch (e) { $('#benches').replaceChildren(el('div', { class: 'home' }, el('h1', { text: 'NoorMD couldn\'t start' }), el('p', { class: 'lead', text: e.message }))); return; }
  settings = s.settings; version = s.version; problems = s.problems || [];
  settings.layouts = settings.layouts || {}; settings.density = settings.density || {};
  benches = new Map(s.benches.map((m) => [m.id, m]));
  applyTheme(); applyMenuPosition();
  const firstStart = !settings.welcomed;
  for (const id of settings.openBenches || []) if (benches.has(id)) await openBench(id, { activate: false });
  if (firstStart || !order.length) { settings.welcomed = true; await openBench('home', { activate: false }); }
  const want = settings.activeBench && open.has(settings.activeBench) ? settings.activeBench : firstStart ? 'home' : order[0];
  activate_(want);
  // The floating panels come back (their benches opened quietly if need be).
  for (const f of (settings.floats || []).filter((x) => x && typeof x.ref === 'string' && specOf(x.ref))) {
    const owner = splitRef(f.ref)[0];
    if (!open.has(owner)) await openBench(owner, { activate: false, quiet: true });
    const ff = { id: newId(), ref: f.ref, x: f.x, y: f.y, w: f.w, h: f.h, from: f.from || { bench: active, side: specOf(f.ref).spec.dock } };
    for (const inst of open.values()) if (inst.layout && inst.layout.docks && whereIs(inst, ff.ref)) { removeRef(inst, ff.ref); renderDocks(inst); }
    floats.push(ff); openFloat(ff, null);
  }
  if (floats.length) save();
  if (problems.length) toast(`${problems.length} bench${problems.length === 1 ? '' : 'es'} couldn't be loaded: Tools › Benches says why.`, { error: true });
  window.__noor = { open, order: () => order, active: () => active, settings: () => settings, floats: () => floats }; // for tests
  windowCall('files.pending');   // files NoorMD was opened with
}
/** A floating panel's own window: a small title bar (the panel, its bench, Dock back) and the panel, run by its
    bench's web module here, in step with the main window through the bench's events. */
async function startFloat() {
  document.body.classList.add('floating');
  let s, f;
  try { s = await call('shell', 'start'); f = await call('window', 'float.get'); }
  catch (e) { $('#benches').replaceChildren(el('p', { class: 'nui-muted', style: { padding: '16px' }, text: 'This panel couldn\'t start: ' + e.message })); return; }
  settings = s.settings; version = s.version;
  settings.density = settings.density || {};
  benches = new Map(s.benches.map((m) => [m.id, m]));
  const sp = specOf(f.ref);
  if (!sp) { $('#benches').replaceChildren(el('p', { class: 'nui-muted', style: { padding: '16px' }, text: 'This panel\'s bench isn\'t there any more.' })); return; }
  active = sp.owner;
  applyTheme(); applyDensity();
  $('#menubar').replaceChildren();
  $('#wintitle').replaceChildren(el('span', { class: 'ftitle' }, el('span', { text: sp.spec.icon }), el('b', { text: sp.spec.title }), sp.bench.name !== sp.spec.title ? el('small', { class: 'nui-muted', text: sp.bench.name }) : null));
  $('#wintitle').after(el('button', { class: 'nui-icon fdock', title: 'Dock it back into the main window (closing this window does too)', 'aria-label': 'Dock back', onclick: () => windowCall('float.dock') }, '⇲'));
  windowCall('title', { text: `${sp.spec.title} — NoorMD` });
  const inst = { manifest: sp.bench, status: '', title: '', placed: new Map(), bus: new Map(), layout: { state: f.benchState || {} } };
  open.set(sp.owner, inst);
  inst.ctx = makeContext(sp.owner, inst);
  inst.ctx.panelState = f.state;
  const body = el('div', { class: 'pbody floatbody', 'data-ref': f.ref });
  $('#benches').replaceChildren(el('section', { class: 'floatpanel' }, body));
  try {
    const mod = (await import(`/benches/${sp.owner}/${sp.bench.entry}`)).default;
    inst.module = mod;
    const def = mod.panels && mod.panels[sp.pid];
    if (def && def.mount) def.mount(body, inst.ctx);
  } catch (e) { body.replaceChildren(el('p', { class: 'nui-muted', text: `This panel couldn't start: ${e.message}` })); }
  window.__noor = { open, float: f };
}
function renderTitleGuard() { return !!floatId; }
void keyOf;
start();
