// NoorMD docks: one rule for the panels around the editor. The window has three dock areas (left, right and bottom,
// under the editor) and the sidebar can sit left or right. Each panel (Music Bench, Video Bench, Stream Desk) lives in
// an area of your choice; an area shows one panel at a time, so e.g. music on the left and a video on the right can
// be open together. The Stream Desk can also have its own window. Layouts (where things are, which panels are open,
// sizes) can be saved; a few ready-made ones are included, and the classic layout is the default.
// The middle of the window (where documents are) is a dock area too: panels placed there open as tabs next to the
// documents, several at a time, and fill the whole editing space (a big Gallery, the Stream Desk while you stream…).
window.NoorDock = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;

  const AREAS = ['left', 'right', 'bottom'];
  const AREA_LABEL = { left: 'Left', right: 'Right', bottom: 'Bottom', center: 'Middle', window: 'Own window' };
  const ICON = { music: '♫', video: '▶', stream: '◉', apps: '◫', voice: '🎙', gallery: '▦', radio: '📻', sound: '🔊', texture: '🧱', sequencer: '🎼', calendar: '📅', assets: '🌳' };
  const DEFAULT = Object.freeze({
    v: 1, sidebar: 'left',
    place: { music: 'right', video: 'right', stream: 'right', apps: 'right', voice: 'right', gallery: 'right', radio: 'right', sound: 'center', texture: 'center', sequencer: 'center', calendar: 'right', assets: 'center' },
    size: { left: 400, right: 460, bottom: 300 },
  });
  // Ready-made layouts. `open` lists the panels a layout shows; `sidebar` may also be 'hidden'.
  const PRESETS = [
    { id: 'classic', name: 'Classic (default)', description: 'Sidebar on the left, panels on the right', layout: { sidebar: 'left', place: { music: 'right', video: 'right', stream: 'right' } }, open: [] },
    { id: 'writing', name: 'Writing', description: 'Only the document: sidebar and panels hidden', layout: { sidebar: 'hidden', place: {} }, open: [], closeAll: true },
    { id: 'media', name: 'Music + video', description: 'Music on the left, videos on the right', layout: { sidebar: 'hidden', place: { music: 'left', video: 'right' } }, open: ['music', 'video'] },
    { id: 'streaming', name: 'Streaming', description: 'Music on the left, Stream Desk on the right, videos below', layout: { sidebar: 'hidden', place: { music: 'left', stream: 'right', video: 'bottom' } }, open: ['music', 'stream'] },
    { id: 'stream-center', name: 'Streaming, desk in the middle', description: 'Stream Desk as a big tab next to your documents, music on the right', layout: { sidebar: 'hidden', place: { stream: 'center', music: 'right' } }, open: ['stream', 'music'] },
    { id: 'stream-window', name: 'Stream Desk in its own window', description: 'For a second monitor next to OBS', layout: { sidebar: 'left', place: { stream: 'window', music: 'right' } }, open: ['stream'] },
    { id: 'sidebar-right', name: 'Sidebar on the right', description: 'Files and outline on the right, panels on the left', layout: { sidebar: 'right', place: { music: 'left', video: 'left', stream: 'left' } }, open: [] },
  ];

  let hooks = { getPrefs: () => ({}), setPrefs: () => {}, panels: {} };
  let layout = clone(DEFAULT);
  const shown = { left: null, right: null, bottom: null };
  const wide = { left: false, right: false, bottom: false };
  const center = { open: [], active: null }; // panels in the middle (tabs) and the one showing, if any

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function normalize(l) {
    const out = clone(DEFAULT);
    if (l && typeof l === 'object') {
      if (['left', 'right'].includes(l.sidebar)) out.sidebar = l.sidebar;
      for (const p of Object.keys(out.place)) {
        const a = l.place && l.place[p];
        if (AREAS.includes(a) || a === 'center' || (a === 'window' && p === 'stream')) out.place[p] = a;
      }
      for (const a of AREAS) if (l.size && Number.isFinite(l.size[a])) out.size[a] = l.size[a];
    }
    return out;
  }

  /** hooks.panels: { music: { el, open, close, isOpen, label }, … } */
  function init(h) {
    hooks = { ...hooks, ...h };
    const prefs = hooks.getPrefs();
    layout = normalize(prefs.layout || (prefs.musicWidth ? { size: { right: prefs.musicWidth } } : null));
    const app = $('#app');
    for (const a of AREAS) {
      const dock = el('div', { class: 'dock', id: 'dock-' + a, 'data-area': a, role: 'complementary' },
        el('div', { class: 'dock-resizer', 'data-area': a, role: 'separator', tabindex: '0', 'aria-label': `Resize the ${a} panel`, 'aria-orientation': a === 'bottom' ? 'horizontal' : 'vertical' }));
      if (a === 'bottom') $('.main').after(dock); else app.append(dock);
      setupResizer(dock.querySelector('.dock-resizer'), a);
    }
    const stage = el('div', { class: 'dock center-dock', id: 'dock-center', 'data-area': 'center', role: 'region', 'aria-label': 'Panels in the middle' });
    $('#tabstrip').after(stage);
    $('#tabs').after(el('div', { class: 'module-tabs', id: 'module-tabs', role: 'tablist', 'aria-label': 'Panels in the middle' }));
    applyGrid();
    window.addEventListener('resize', () => applyGrid());
  }

  // ------------------------------------------------------------------ the middle

  function openInCenter(panel) {
    const node = hooks.panels[panel].el();
    if (node && node.parentElement !== $('#dock-center')) $('#dock-center').append(node);
    for (const x of AREAS) if (shown[x] === panel) { shown[x] = null; wide[x] = false; }
    if (!center.open.includes(panel)) center.open.push(panel);
    activate(panel);
    applyGrid();
  }

  /** Shows a panel that is open in the middle (its tab is selected; the document is hidden, not closed). */
  function activate(panel) {
    if (!center.open.includes(panel)) return;
    center.active = panel;
    for (const p of center.open) hooks.panels[p].el()?.classList.toggle('center-hidden', p !== panel);
    document.body.classList.add('center-active');
    document.body.dataset.center = panel; // CSS: e.g. no mini-player while the Music Bench itself is shown
    renderModuleTabs();
    requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); hooks.panels[panel].el()?.focus({ preventScroll: true }); });
  }

  /** Back to the documents (panels in the middle stay open behind their tabs). */
  function showDocuments() {
    if (!center.active) return;
    center.active = null;
    document.body.classList.remove('center-active');
    renderModuleTabs();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function renderModuleTabs() {
    const box = $('#module-tabs');
    if (!box) return;
    box.replaceChildren(...center.open.map((p) => {
      const close = el('button', { class: 'tab-close', tabindex: '-1', 'aria-label': 'Close ' + hooks.panels[p].label, title: 'Close' }, '✕');
      close.addEventListener('click', (e) => { e.stopPropagation(); hooks.panels[p].close(); });
      const node = el('div', { class: 'tab module-tab' + (center.active === p ? ' active' : ''), role: 'tab', 'aria-selected': String(center.active === p), 'data-module': p, tabindex: '-1', title: hooks.panels[p].label + ' (in the middle)' },
        el('span', { class: 'module-icon', 'aria-hidden': 'true', text: ICON[p] || '▣' }), el('span', { class: 'tab-name', text: hooks.panels[p].label }), close);
      node.addEventListener('click', () => activate(p));
      node.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); hooks.panels[p].close(); } });
      node.addEventListener('contextmenu', (e) => { e.preventDefault(); NoorChrome.openMenu(null, menuItems(p), { x: e.clientX, y: e.clientY }); });
      return node;
    }));
  }

  const area = (panel) => layout.place[panel];
  const dockOf = (a) => $('#dock-' + a);

  /** A panel is opening: put it in its area (closing whatever was there). Returns false when it lives in a window. */
  function opened(panel) {
    const a = area(panel);
    if (a === 'center') { openInCenter(panel); return true; }
    if (!AREAS.includes(a)) return false;
    const other = shown[a];
    if (other && other !== panel) { shown[a] = null; hooks.panels[other]?.close(); }
    for (const x of AREAS) if (x !== a && shown[x] === panel) { shown[x] = null; wide[x] = false; }
    const node = hooks.panels[panel].el();
    if (node && node.parentElement !== dockOf(a)) dockOf(a).append(node);
    shown[a] = panel;
    applyGrid();
    return true;
  }

  /** A panel closed: free its area. */
  function closed(panel) {
    for (const a of AREAS) if (shown[a] === panel) { shown[a] = null; wide[a] = false; }
    const i = center.open.indexOf(panel);
    if (i >= 0) {
      center.open.splice(i, 1);
      hooks.panels[panel].el()?.classList.remove('center-hidden');
      if (center.active === panel) { if (center.open.length) activate(center.open[Math.min(i, center.open.length - 1)]); else showDocuments(); }
      else renderModuleTabs();
    }
    applyGrid();
  }

  function applyGrid() {
    const root = document.documentElement.style;
    const maxSide = Math.max(300, window.innerWidth - 420);
    const maxBottom = Math.max(160, window.innerHeight - 220);
    for (const a of AREAS) {
      const open = !!shown[a];
      dockOf(a)?.classList.toggle('open', open);
      let size = layout.size[a];
      if (wide[a]) size = Math.max(size, a === 'bottom' ? window.innerHeight * 0.55 : window.innerWidth * 0.62);
      size = a === 'bottom' ? Math.min(maxBottom, Math.max(160, size)) : Math.min(maxSide, Math.max(300, size));
      root.setProperty('--dock-' + a, open ? Math.round(size) + 'px' : '0px');
    }
    document.body.classList.toggle('sidebar-right', layout.sidebar === 'right');
    for (const p of Object.keys(layout.place)) document.body.dataset['dock' + p[0].toUpperCase() + p.slice(1)] = layout.place[p];
    requestAnimationFrame(() => window.dispatchEvent(new Event('noor-layout')));
  }

  function save() { hooks.setPrefs({ layout: clone(layout) }); }

  function setupResizer(handle, a) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing-dock');
      wide[a] = false;
      const move = (ev) => {
        layout.size[a] = a === 'left' ? ev.clientX - dockOf('left').getBoundingClientRect().left
          : a === 'right' ? dockOf('right').getBoundingClientRect().right - ev.clientX
            : dockOf('bottom').getBoundingClientRect().bottom - ev.clientY;
        applyGrid();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing-dock');
        layout.size[a] = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dock-' + a), 10) || layout.size[a];
        save();
        window.dispatchEvent(new Event('resize'));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('keydown', (e) => {
      const grow = { left: ['ArrowRight', 'ArrowLeft'], right: ['ArrowLeft', 'ArrowRight'], bottom: ['ArrowUp', 'ArrowDown'] }[a];
      const i = grow.indexOf(e.key);
      if (i < 0) return;
      e.preventDefault();
      layout.size[a] += i === 0 ? 24 : -24;
      applyGrid(); save();
    });
  }

  /** Moves a panel to another area (or the Stream Desk to its own window), keeping it open if it was. */
  function place(panel, to) {
    if (!(AREAS.includes(to) || to === 'center' || (to === 'window' && panel === 'stream')) || layout.place[panel] === to) return;
    const p = hooks.panels[panel];
    const wasOpen = p.isOpen();
    if (wasOpen) { p.close(); closed(panel); }
    layout.place[panel] = to;
    save();
    applyGrid();
    if (wasOpen || to === 'window') p.open();
    notice(`${p.label}: ${to === 'window' ? 'in its own window' : to === 'center' ? 'in the middle, as a tab next to your documents' : AREA_LABEL[to].toLowerCase() + (to === 'bottom' ? ' (under the document)' : ' side')}`, 1800);
  }

  function setSidebar(side) {
    if (side === 'hidden') { hooks.setSidebarCollapsed?.(true); return; }
    hooks.setSidebarCollapsed?.(false);
    layout.sidebar = side;
    save(); applyGrid();
  }

  function toggleWide(panel) {
    const a = AREAS.find((x) => shown[x] === panel);
    if (!a) return false;
    wide[a] = !wide[a];
    applyGrid();
    return wide[a];
  }
  const isWide = (panel) => AREAS.some((a) => shown[a] === panel && wide[a]);

  /** Menu items for a panel's ⊞ button: where it can live. */
  function menuItems(panel) {
    const options = panel === 'stream' ? [...AREAS, 'center', 'window'] : [...AREAS, 'center'];
    return [
      ...options.map((a) => ({ label: (layout.place[panel] === a ? '● ' : '○ ') + (a === 'window' ? 'Own window (second monitor)' : a === 'center' ? 'In the middle (a tab next to documents)' : `Dock ${AREA_LABEL[a].toLowerCase()}`), run: () => place(panel, a) })),
      '-',
      { label: 'Layouts…', run: showLayouts },
    ];
  }

  function showMenu(panel, anchor) { NoorChrome.openMenu(anchor, menuItems(panel)); }

  // ------------------------------------------------------------------ layouts

  /** Everything a layout remembers: places, sizes, sidebar and which panels are open. */
  function snapshot() {
    const open = Object.keys(hooks.panels).filter((p) => hooks.panels[p].isOpen());
    return { ...clone(layout), sidebar: hooks.isSidebarCollapsed?.() ? 'hidden' : layout.sidebar, open };
  }

  function apply(target) {
    const want = new Set(target.open || []);
    for (const p of Object.keys(hooks.panels)) if (hooks.panels[p].isOpen() && (target.closeAll || !want.has(p) || (target.place && target.place[p] && target.place[p] !== layout.place[p]))) { hooks.panels[p].close(); closed(p); }
    const side = target.sidebar || 'left';
    layout = normalize({ ...layout, ...target, sidebar: side === 'hidden' ? layout.sidebar : side, place: { ...layout.place, ...(target.place || {}) }, size: { ...layout.size, ...(target.size || {}) } });
    save();
    hooks.setSidebarCollapsed?.(side === 'hidden');
    applyGrid();
    for (const p of want) if (hooks.panels[p] && !hooks.panels[p].isOpen()) hooks.panels[p].open();
  }

  function applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    apply({ ...clone(p.layout), size: id === 'classic' ? clone(DEFAULT.size) : undefined, open: p.open, closeAll: p.closeAll });
    hooks.setPrefs({ layoutName: p.name });
    notice(`Layout: ${p.name}`, 1400);
  }

  const saved = () => (Array.isArray(hooks.getPrefs().layouts) ? hooks.getPrefs().layouts : []);

  async function saveAs() {
    const name = await NoorUI.prompt('Save this layout', 'Name:', hooks.getPrefs().layoutName && !PRESETS.some((p) => p.name === hooks.getPrefs().layoutName) ? hooks.getPrefs().layoutName : 'My layout', { okLabel: 'Save' });
    if (!name || !name.trim()) return;
    const list = saved().filter((l) => l.name !== name.trim());
    list.push({ name: name.trim(), layout: snapshot() });
    hooks.setPrefs({ layouts: list, layoutName: name.trim() });
    notice(`Layout “${name.trim()}” saved`, 1600);
  }

  function applySaved(name) {
    const l = saved().find((x) => x.name === name);
    if (!l) return;
    apply(l.layout);
    hooks.setPrefs({ layoutName: name });
    notice(`Layout: ${name}`, 1400);
  }

  function showLayouts() {
    NoorUI.modal({ label: 'Layouts', width: 620 }, (s, close) => {
      const current = hooks.getPrefs().layoutName;
      const card = (name, description, run, del) => el('div', { class: 'layout-card' + (current === name ? ' active' : '') },
        el('button', { class: 'layout-apply', onclick: () => { close(); run(); } }, el('strong', { text: name }), el('small', { text: description })),
        del ? el('button', { class: 'icon-btn', title: 'Delete this layout', 'aria-label': 'Delete layout ' + name, onclick: () => { hooks.setPrefs({ layouts: saved().filter((l) => l.name !== name) }); close(); showLayouts(); } }, '✕') : null);
      const places = (l) => Object.entries(l.place || {}).map(([p, a]) => `${hooks.panels[p]?.label || p}: ${AREA_LABEL[a] || a}`).join(' · ');
      s.append(NoorUI.head('▦ Layouts', close),
        el('div', { class: 'modal-body layout-list', id: 'layout-list' },
          el('p', { class: 'pref-hint', text: 'Where the sidebar and the panels go, which are open, and their sizes. Each panel’s ⊞ button moves just that panel.' }),
          ...PRESETS.map((p) => card(p.name, p.description, () => applyPreset(p.id))),
          ...(saved().length ? [el('h4', { text: 'Saved' }), ...saved().map((l) => card(l.name, places(l.layout) || 'Saved layout', () => applySaved(l.name), true))] : [])),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => close() }, 'Close'),
          el('button', { class: 'action primary', id: 'layout-save', onclick: async () => { close(); await saveAs(); } }, 'Save current layout…'))));
    });
  }

  return {
    init, opened, closed, place, setSidebar, toggleWide, isWide, showMenu, menuItems, showLayouts, applyPreset, saveAs, applySaved,
    placeOf: area, PRESETS, activate, showDocuments, centerActive: () => center.active,
    _state: () => ({ layout: clone(layout), shown: { ...shown }, wide: { ...wide }, center: { open: [...center.open], active: center.active } }),
  };
})();
