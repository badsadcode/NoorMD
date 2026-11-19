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

const HOME = { id: 'home', name: 'Home', icon: '⌂', density: 'roomy', menus: [], panels: [] };
const manifestOf = (id) => (id === 'home' ? HOME : benches.get(id));
const densityOf = (id) => (id === 'home' ? 'roomy' : (settings.density && settings.density[id]) || (manifestOf(id) || {}).density || 'roomy');

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    settings.openBenches = order.filter((id) => id !== 'home');
    settings.activeBench = active;
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
}
function applyMenuPosition() {
  const row = settings.menuPosition === 'row';
  $('#menurow').hidden = !row;
  (row ? $('#menurow') : $('#menubar')).append(...[...$('#menubar').children, ...$('#menurow').children]);
}
function applyDensity() {
  document.body.classList.toggle('density-compact', densityOf(active) === 'compact');
  document.body.classList.toggle('density-roomy', densityOf(active) !== 'compact');
}

// ---------------------------------------------------------------- opening, switching and closing benches
async function openBench(id, { activate = true } = {}) {
  if (open.has(id)) { if (activate) activate_(id); return open.get(id); }
  const m = manifestOf(id);
  if (!m) { toast(`There is no bench "${id}".`, { error: true }); return null; }
  const inst = { manifest: m, status: '', title: '', panels: new Map(), bus: new Map(), layout: normaliseLayout(settings.layouts[id], m) };
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
      for (const p of m.panels) mountPanel(inst, p);
    } catch (e) {
      inst.view.replaceChildren(el('div', { class: 'home' }, el('h1', { text: `${m.name} couldn't start` }), el('p', { class: 'lead', text: e.message })));
      console.error(e);
    }
  }
  layoutSides(inst);
  renderTabs();
  if (activate) activate_(id);
  save();
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

function closeBench(id) {
  const inst = open.get(id);
  if (!inst) return;
  try { inst.mounted && inst.mounted.unmount && inst.mounted.unmount(); } catch (e) { console.error(e); }
  for (const p of inst.panels.values()) try { p.result && p.result.unmount && p.result.unmount(); } catch (e) { console.error(e); }
  inst.root.remove();
  open.delete(id);
  const i = order.indexOf(id);
  order = order.filter((x) => x !== id);
  if (active === id) {
    const next = order[Math.min(i, order.length - 1)];
    if (next) activate_(next); else openBench('home');
  }
  renderTabs(); save();
}

// ---------------------------------------------------------------- a bench's context: what its module may use
function makeContext(id, inst) {
  const styles = new Set();
  const emit = (name, payload) => (inst.bus.get(name) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
  inst.emit = emit;
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
    keep(key, value) { inst.layout.state[key] = value; save(); },
    restore(key, fallback) { return key in inst.layout.state ? inst.layout.state[key] : fallback; },
    openBench: (bid) => openBench(bid),
  };
}
hostListeners.push((m) => {
  if (m.event === 'bench' && open.has(m.bench)) open.get(m.bench).emit(m.name, m.payload);
  else if (m.event === 'window') { $('#winspace').style.width = Math.max(0, m.buttonsWidth || 0) + 'px'; document.body.classList.toggle('maximized', !!m.maximized); }
});

// ---------------------------------------------------------------- panels and the resizable edges
const SIDE_DEFAULT = { lw: 240, rw: 280, bh: 180 };
function normaliseLayout(l, m) {
  const out = { lw: SIDE_DEFAULT.lw, rw: SIDE_DEFAULT.rw, bh: SIDE_DEFAULT.bh, hidden: [], state: {} };
  if (l && typeof l === 'object') {
    for (const k of ['lw', 'rw', 'bh']) if (Number.isFinite(l[k])) out[k] = l[k];
    if (Array.isArray(l.hidden)) out.hidden = l.hidden.filter((x) => typeof x === 'string');
    if (l.state && typeof l.state === 'object') out.state = l.state;
  }
  void m;
  return out;
}
function mountPanel(inst, spec) {
  const body = el('div', { class: 'pbody' });
  const box = el('section', { class: 'panel', 'data-panel': spec.id, 'aria-label': spec.title },
    el('header', {}, el('span', { class: 'ptitle' }, el('span', { text: spec.icon }), spec.title), el('span', { class: 'sp' }),
      el('button', { class: 'nui-icon', title: 'Hide the panel (View menu shows it again)', 'aria-label': `Hide ${spec.title}`, onclick: () => togglePanel(inst, spec.id, false) }, '✕')),
    body);
  let result = null;
  const def = inst.module && inst.module.panels && inst.module.panels[spec.id];
  try { result = def && def.mount ? def.mount(body, inst.ctx) || {} : (body.append(el('p', { class: 'nui-muted', text: 'Nothing here yet.' })), {}); }
  catch (e) { body.replaceChildren(el('p', { class: 'nui-muted', text: `This panel couldn't start: ${e.message}` })); }
  inst.panels.set(spec.id, { spec, box, result });
}
function layoutSides(inst) {
  const sides = { left: inst.left, right: inst.right, bottom: inst.bottom };
  for (const s of Object.values(sides)) s.replaceChildren();
  for (const p of inst.panels.values()) if (!inst.layout.hidden.includes(p.spec.id)) sides[p.spec.dock].append(p.box);
  const has = (s) => sides[s].children.length > 0;
  inst.root.style.setProperty('--lw', has('left') ? inst.layout.lw + 'px' : '0px');
  inst.root.style.setProperty('--rw', has('right') ? inst.layout.rw + 'px' : '0px');
  inst.root.style.setProperty('--bh', has('bottom') ? inst.layout.bh + 'px' : '0px');
  inst.root.querySelector('.resizer.l').hidden = !has('left');
  inst.root.querySelector('.resizer.r').hidden = !has('right');
  inst.root.querySelector('.resizer.b').hidden = !has('bottom');
}
function togglePanel(inst, pid, show) {
  const h = new Set(inst.layout.hidden);
  if (show === undefined) show = h.has(pid);
  if (show) h.delete(pid); else h.add(pid);
  inst.layout.hidden = [...h];
  layoutSides(inst); save();
}
/** Drag an edge to resize a side; double-click it to put it back to its usual size. */
function resizer(inst, which) {
  const key = { l: 'lw', r: 'rw', b: 'bh' }[which];
  const r = el('div', { class: 'resizer ' + which, role: 'separator', 'aria-orientation': which === 'b' ? 'horizontal' : 'vertical', title: 'Drag to resize · double-click: the usual size', tabindex: '0' });
  const apply = (v) => { inst.layout[key] = Math.round(Math.max(140, Math.min(v, which === 'b' ? innerHeight * 0.7 : innerWidth * 0.45))); layoutSides(inst); };
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
function appMenus() {
  const inst = open.get(active), m = manifestOf(active) || HOME;
  const edit = (c) => () => document.execCommand(c);
  return [
    ['File', () => [{ label: 'Home', keys: 'Ctrl+Shift+H', run: () => openBench('home') }, { label: 'Open a bench…', run: () => benchPicker() }, '-', { label: `Close ${m.name}`, keys: 'Ctrl+W', run: () => closeBench(active), disabled: !active }, '-', { label: 'Settings…', keys: 'Ctrl+,', run: settingsDialog }, '-', { label: 'Exit', keys: 'Alt+F4', run: () => windowCall('close') }]],
    ['Edit', () => [{ label: 'Undo', keys: 'Ctrl+Z', run: edit('undo') }, { label: 'Redo', keys: 'Ctrl+Y', run: edit('redo') }, '-', { label: 'Cut', keys: 'Ctrl+X', run: edit('cut') }, { label: 'Copy', keys: 'Ctrl+C', run: edit('copy') }, { label: 'Paste', keys: 'Ctrl+V', run: () => navigator.clipboard.readText().then((t) => document.execCommand('insertText', false, t)).catch(() => {}) }, { label: 'Select all', keys: 'Ctrl+A', run: edit('selectAll') }]],
    ['View', () => [
      ...(m.panels.length ? [{ header: `Panels of ${m.name}` }, ...m.panels.map((p) => ({ label: p.title, checked: () => !inst.layout.hidden.includes(p.id), run: () => togglePanel(inst, p.id) }))] : [{ header: 'No panels here' }]),
      '-', { label: 'Reset the layout', disabled: active === 'home', run: () => { inst.layout = normaliseLayout({ state: inst.layout.state }, m); layoutSides(inst); save(); } },
      { header: 'Density' }, { label: 'Roomy', checked: () => densityOf(active) === 'roomy', disabled: active === 'home', run: () => setDensity(active, 'roomy') }, { label: 'Compact', checked: () => densityOf(active) === 'compact', disabled: active === 'home', run: () => setDensity(active, 'compact') },
      '-', { label: 'Focus mode', keys: 'F11', checked: () => focusMode, run: toggleFocus }]],
    ...(m.menus || []).map((mm) => [mm.title, () => mm.items.map((it) => (it.command ? { label: it.label, keys: it.keys, run: () => benchCommand(it.command) } : '-'))]),
    ['Tools', () => [{ label: 'Settings…', keys: 'Ctrl+,', run: settingsDialog }, { label: 'Benches…', run: benchesDialog }]],
    ['Window', () => [{ label: 'Home', keys: 'Ctrl+Shift+H', run: () => openBench('home') }, '-', { header: 'Open benches' }, ...order.map((id, i) => ({ label: `${manifestOf(id).icon}  ${manifestOf(id).name}`, keys: i < 9 ? `Ctrl+${i + 1}` : '', checked: () => id === active, run: () => activate_(id) })), '-', { label: 'Next bench', keys: 'Ctrl+Tab', run: () => cycle(1) }, { label: 'Previous bench', keys: 'Ctrl+Shift+Tab', run: () => cycle(-1) }]],
    ['Help', () => [{ label: 'About NoorMD', run: aboutDialog }]],
  ];
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
    return el('button', { class: 'btab', role: 'tab', 'aria-selected': String(id === active), 'data-bench': id, title: `${m.name}${i < 9 ? ` (Ctrl+${i + 1})` : ''}`, onclick: () => activate_(id), onauxclick: (e) => { if (e.button === 1) closeBench(id); } },
      el('span', { class: 'ic', text: m.icon }), m.name,
      el('span', { class: 'x', role: 'button', title: `Close ${m.name} (Ctrl+W)`, 'aria-label': `Close ${m.name}`, onclick: (e) => { e.stopPropagation(); closeBench(id); } }, '✕'));
  });
  $('#benchtabs').replaceChildren(el('div', { role: 'tablist', style: { display: 'contents' } }, ...tabs), el('button', { class: 'btab add', title: 'Open a bench', 'aria-label': 'Open a bench', onclick: (e) => benchPicker(e.currentTarget) }, '＋'));
}
function renderTitle() {
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
  else if (k === 'ctrl+w') { e.preventDefault(); if (active) closeBench(active); }
  else if (k === 'f11') { e.preventDefault(); toggleFocus(); }
  else if (k === 'f10') { e.preventDefault(); const b = document.querySelector('[data-menu="0"]'); if (b) toggleMainMenu(0, b); }
  else if (k === 'ctrl+tab') { e.preventDefault(); cycle(1); }
  else if (k === 'ctrl+shift+tab') { e.preventDefault(); cycle(-1); }
  else if (/^ctrl\+[1-9]$/.test(k) && order[Number(k.slice(5)) - 1]) { e.preventDefault(); activate_(order[Number(k.slice(5)) - 1]); }
  else if (k === 'escape' && focusMode && !menuIsOpen()) { e.preventDefault(); toggleFocus(); }
  else { const run = SHORTCUTS().get(k); if (run) { e.preventDefault(); run(); } }
});
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea, [contenteditable]')) e.preventDefault(); });
$('#logo').addEventListener('click', () => openBench('home'));

// ---------------------------------------------------------------- start
async function start() {
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
  if (problems.length) toast(`${problems.length} bench${problems.length === 1 ? '' : 'es'} couldn't be loaded: Tools › Benches says why.`, { error: true });
  window.__noor = { open, order: () => order, active: () => active, settings: () => settings }; // for tests
}
void keyOf;
start();
