// NoorMD Apps Hub: your shortcuts to programs, games, files, folders and websites, with their pictures, in a panel
// that docks like the benches. Click starts it; right-click edits. The host keeps the list and starts things by id.
window.NoorApps = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const KIND_ICON = { app: '▶', file: '📄', folder: '📁', web: '🌐' };

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  let hub = { items: [], groups: [], view: 'all' };
  let filter = '';

  const isOpen = () => document.body.classList.contains('apps-open');

  function init(h) { hooks = { ...hooks, ...h }; }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('apps');
    document.body.classList.add('apps-open');
    $('#appshub').hidden = false;
    await refresh();
    $('#apps-search').focus({ preventScroll: true });
  }

  function close() {
    if (!built || !isOpen()) return;
    document.body.classList.remove('apps-open');
    $('#appshub').hidden = true;
    if (window.NoorDock) NoorDock.closed('apps');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  async function refresh() {
    try { hub = await req('apps.list'); } catch (err) { hooks.showError(err); return; }
    render();
  }

  function build() {
    built = true;
    const root = el('section', { id: 'appshub', class: 'appshub', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'Apps Hub' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '◫' }), el('strong', { text: 'Apps Hub' }), el('small', { id: 'apps-count' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'apps-add', title: 'Add a program, game, file, folder or website', 'aria-label': 'Add to the Apps Hub', onclick: (e) => addMenu(e.currentTarget) }, '＋'),
          el('button', { class: 'icon-btn', id: 'apps-dock', title: 'Where this panel goes (left, right, bottom) and layouts', 'aria-label': 'Move the Apps Hub', onclick: (e) => NoorDock.showMenu('apps', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+H)', 'aria-label': 'Close Apps Hub', onclick: close }, '✕'))),
      el('div', { class: 'apps-toolbar' }, el('input', { id: 'apps-search', type: 'search', placeholder: 'Find a shortcut…', 'aria-label': 'Find a shortcut', autocomplete: 'off', spellcheck: 'false' }),
        el('div', { class: 'apps-cats', id: 'apps-cats', role: 'tablist', 'aria-label': 'Categories' })),
      el('div', { class: 'apps-body', id: 'apps-body' }));
    ($('#app') || document.body).append(root);
    $('#apps-search').addEventListener('input', (e) => { filter = e.target.value.trim().toLowerCase(); render(); });
    $('#apps-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = $('#apps-body .app-tile'); if (first) { e.preventDefault(); launch(first.dataset.id); } }
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.target.closest('input')) { e.preventDefault(); e.stopPropagation(); close(); } });
  }

  function addMenu(anchor) {
    NoorChrome.openMenu(anchor, [
      { label: 'Program or game…', run: () => add('app') },
      { label: 'Website or launcher link…', run: () => addWeb() },
      { label: 'Folder…', run: () => add('folder') },
      { label: 'File…', run: () => add('file') },
    ]);
  }

  async function add(kind) {
    try {
      const r = await req('apps.add', { kind, group: currentGroup() || undefined });
      if (!r || r.cancelled) return;
      hub = r.hub;
      render();
      notice(r.added.length === 1 ? `Added “${r.added[0].name}”` : `Added ${r.added.length} shortcuts`, 1800);
    } catch (err) { hooks.showError(err); }
  }

  function addWeb(item) {
    const editing = !!item;
    NoorUI.modal({ label: editing ? 'Edit shortcut' : 'Add a website', width: 520 }, (s, closeModal) => {
      const url = el('input', { id: 'apps-url', type: 'text', value: item ? item.target : 'https://', placeholder: 'https://… or steam://rungameid/570', 'aria-label': 'Address', spellcheck: 'false' });
      const name = el('input', { id: 'apps-name', type: 'text', value: item ? item.name : '', placeholder: 'Name (optional)', 'aria-label': 'Name' });
      const group = groupInput(item ? item.group : currentGroup() || 'Web');
      const go = async () => {
        try {
          hub = editing ? await req('apps.update', { id: item.id, url: url.value, name: name.value, group: group.value }) : (await req('apps.addWeb', { url: url.value, name: name.value, group: group.value })).hub;
          closeModal(); render();
        } catch (err) { hooks.showError(err); }
      };
      [url, name].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }));
      s.append(NoorUI.head(editing ? '✎ Edit shortcut' : '🌐 Add a website or launcher link', closeModal),
        el('div', { class: 'modal-body apps-form' },
          el('label', {}, el('span', { text: 'Address' }), url),
          el('label', {}, el('span', { text: 'Name' }), name),
          el('label', {}, el('span', { text: 'Group' }), group),
          el('p', { class: 'pref-hint', text: 'Opens in your browser, or in the program that handles the link (steam://, discord://…). NoorMD downloads nothing for it; give it a picture with right-click › Change picture.' })),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => closeModal() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'apps-web-ok', onclick: go }, editing ? 'Save' : 'Add'))));
      setTimeout(() => (editing ? name : url).select(), 0);
    });
  }

  function groupInput(value) {
    const id = 'apps-groups-' + Math.random().toString(36).slice(2, 7);
    const i = el('input', { type: 'text', value: value || '', list: id, 'aria-label': 'Group', id: 'apps-group' });
    const wrap = el('span', { class: 'apps-group-wrap' }, i, el('datalist', { id }, ...['Apps', 'Games', 'Web', 'Streaming', 'Folders', 'Files', ...hub.groups].filter((g, k, a) => a.indexOf(g) === k).map((g) => el('option', { value: g }))));
    Object.defineProperty(wrap, 'value', { get: () => i.value });
    return wrap;
  }

  function edit(item) {
    if (item.kind === 'web') { addWeb(item); return; }
    NoorUI.modal({ label: 'Edit shortcut', width: 560 }, (s, closeModal) => {
      const name = el('input', { id: 'apps-name', type: 'text', value: item.name, 'aria-label': 'Name' });
      const args = el('input', { id: 'apps-args', type: 'text', value: item.arguments || '', placeholder: 'e.g. --minimize-to-tray', 'aria-label': 'Arguments', spellcheck: 'false' });
      const group = groupInput(item.group);
      const save = async () => {
        try { hub = await req('apps.update', { id: item.id, name: name.value, group: group.value, arguments: item.kind === 'app' ? args.value : null }); closeModal(); render(); } catch (err) { hooks.showError(err); }
      };
      s.append(NoorUI.head('✎ Edit shortcut', closeModal),
        el('div', { class: 'modal-body apps-form' },
          el('label', {}, el('span', { text: 'Name' }), name),
          el('label', {}, el('span', { text: 'Group' }), group),
          item.kind === 'app' ? el('label', {}, el('span', { text: 'Arguments' }), args) : null,
          el('p', { class: 'pref-hint apps-target', text: item.target })),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => closeModal() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'apps-edit-ok', onclick: save }, 'Save'))));
    });
  }

  async function launch(id) {
    const item = hub.items.find((x) => x.id === id);
    try {
      const r = await req('apps.launch', { id });
      if (item) Object.assign(item, r);
      notice(`Starting ${item ? item.name : ''}…`, 1400);
      render();
    } catch (err) { hooks.showError(err); }
  }

  function menu(item, x, y) {
    NoorChrome.openMenu(null, [
      { label: item.kind === 'web' ? 'Open' : 'Start', run: () => launch(item.id) },
      '-',
      { label: 'Edit…', run: () => edit(item) },
      { label: 'Change picture…', run: async () => { try { const r = await req('apps.icon.pick', { id: item.id }); if (r && !r.cancelled) { hub = r; render(); } } catch (err) { hooks.showError(err); } } },
      { label: item.kind === 'web' ? 'Use a letter tile' : 'Use the Windows icon', run: async () => { try { hub = await req('apps.icon.reset', { id: item.id }); render(); } catch (err) { hooks.showError(err); } } },
      { label: 'Show in Explorer', disabled: item.kind === 'web', run: () => req('apps.reveal', { id: item.id }).catch(hooks.showError) },
      { label: 'Move to category', sub: () => [
        ...hub.groups.map((g) => ({ label: (g === item.group ? '✓ ' : '') + g, disabled: g === item.group, run: () => moveTo(item, g) })),
        '-',
        { label: 'New category…', run: async () => { const g = await newCategory(); if (g) moveTo(item, g); } },
      ] },
      { label: 'Move to the start', run: async () => { try { hub = await req('apps.reorder', { ids: [item.id] }); render(); } catch (err) { hooks.showError(err); } } },
      '-',
      { label: 'Remove from the hub', run: async () => {
        if (!await NoorUI.confirm('Remove this shortcut?', `“${item.name}” is removed from the Apps Hub. The program or file itself is not touched.`, 'Remove')) return;
        try { hub = await req('apps.remove', { id: item.id }); render(); } catch (err) { hooks.showError(err); }
      } },
    ], { x, y });
  }

  /** A colour from the name for letter tiles, so tiles stay the same between runs. */
  function tileColor(item) {
    if (item.color) return item.color;
    let h = 0;
    for (const c of item.name) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 55% 42%)`;
  }

  function tile(item) {
    const pic = item.icon
      ? el('img', { class: 'app-pic', src: item.icon, alt: '', draggable: 'false' })
      : el('span', { class: 'app-pic app-letter', style: `background:${tileColor(item)}`, text: (item.name.trim()[0] || '?').toUpperCase() });
    return el('button', {
      class: 'app-tile' + (item.exists ? '' : ' missing'), 'data-id': item.id, title: `${item.name}\n${item.target}${item.exists ? '' : '\n(not found)'}`,
      onclick: () => launch(item.id),
      oncontextmenu: (e) => { e.preventDefault(); menu(item, e.clientX, e.clientY); },
    }, pic, el('span', { class: 'app-name', text: item.name }), el('span', { class: 'app-kind', 'aria-hidden': 'true', text: KIND_ICON[item.kind] || '' }));
  }

  const currentGroup = () => (hub.view && hub.view.startsWith('group:') ? hub.view.slice(6) : null);
  const byRecent = (list) => list.filter((i) => i.lastUsed).sort((a, b) => String(b.lastUsed).localeCompare(String(a.lastUsed)));

  async function setView(view) {
    hub.view = view;
    render();
    try { await req('apps.view', { view }); } catch (err) { hooks.showError(err); }
  }

  async function moveTo(item, group) {
    try { hub = await req('apps.update', { id: item.id, group }); render(); notice(`“${item.name}” → ${group}`, 1400); } catch (err) { hooks.showError(err); }
  }

  /** Asks for a name and makes the category; returns its name (or null). */
  async function newCategory() {
    const name = await NoorUI.prompt('New category', 'Name of the category (for example Games, Work or Streaming):', '', { okLabel: 'Create' });
    if (!name || !name.trim()) return null;
    try { hub = await req('apps.category.add', { name }); } catch (err) { hooks.showError(err); return null; }
    const made = hub.groups.find((g) => g.toLowerCase() === name.trim().toLowerCase()) || name.trim();
    await setView('group:' + made);
    return made;
  }

  async function renameCategory(g) {
    const name = await NoorUI.prompt('Rename category', `New name for “${g}” (an existing name merges the two):`, g, { okLabel: 'Rename' });
    if (!name || !name.trim() || name.trim() === g) return;
    try { hub = await req('apps.category.rename', { from: g, name }); render(); } catch (err) { hooks.showError(err); }
  }

  async function removeCategory(g) {
    const count = hub.items.filter((i) => i.group === g).length;
    const others = hub.groups.filter((x) => x !== g);
    let moveTo = others[0] || 'Apps';
    if (count) {
      const choice = await NoorUI.choose(`Remove “${g}”?`, [`Its ${count} shortcut${count === 1 ? '' : 's'} stay in the hub and move to another category.`],
        [{ label: 'Cancel', value: null }, ...(others.length ? others.slice(0, 3) : ['Apps']).map((x, k) => ({ label: `Move to ${x}`, value: x, primary: k === 0 }))]);
      if (!choice) return;
      moveTo = choice;
    }
    try { hub = await req('apps.category.remove', { name: g, moveTo }); render(); } catch (err) { hooks.showError(err); }
  }

  function categoryMenu(g, x, y) {
    const i = hub.groups.indexOf(g);
    NoorChrome.openMenu(null, [
      { label: 'Rename…', run: () => renameCategory(g) },
      { label: 'Move left', disabled: i <= 0, run: async () => { try { hub = await req('apps.category.move', { name: g, by: -1 }); render(); } catch (err) { hooks.showError(err); } } },
      { label: 'Move right', disabled: i >= hub.groups.length - 1, run: async () => { try { hub = await req('apps.category.move', { name: g, by: 1 }); render(); } catch (err) { hooks.showError(err); } } },
      '-',
      { label: 'Remove category…', run: () => removeCategory(g) },
    ], { x, y });
  }

  function renderCats() {
    const cats = $('#apps-cats');
    const recentCount = byRecent(hub.items).length;
    const chip = (view, label, count, extra = {}) => el('button', {
      class: 'chip' + (hub.view === view ? ' active' : ''), role: 'tab', 'aria-selected': String(hub.view === view), 'data-view': view,
      onclick: () => setView(view), ...extra,
    }, label, count != null ? el('small', { text: ' ' + count }) : null);
    cats.replaceChildren(
      chip('all', 'All', null),
      ...(recentCount ? [chip('recent', '🕘 Recent', null)] : []),
      ...hub.groups.map((g) => chip('group:' + g, g, hub.items.filter((i) => i.group === g).length, {
        title: 'Right-click to rename, move or remove', 'data-group': g,
        oncontextmenu: (e) => { e.preventDefault(); categoryMenu(g, e.clientX, e.clientY); },
      })),
      el('button', { class: 'chip apps-cat-add', id: 'apps-cat-add', title: 'New category', 'aria-label': 'New category', onclick: () => newCategory() }, '＋'));
  }

  function render() {
    if (!built) return;
    const body = $('#apps-body');
    $('#apps-count').textContent = hub.items.length ? String(hub.items.length) : '';
    // A category that is gone (or a view from another build) falls back to All.
    if (!(hub.view === 'all' || hub.view === 'recent' || (currentGroup() != null && hub.groups.includes(currentGroup())))) hub.view = 'all';
    if (hub.view === 'recent' && !byRecent(hub.items).length) hub.view = 'all';
    renderCats();
    if (!hub.items.length && hub.view === 'all') {
      body.replaceChildren(el('div', { class: 'vb-empty' }, el('h2', { text: 'Your apps, games and sites in one place' }),
        el('p', { text: 'Add programs, games (Steam and Epic shortcuts work too), folders, files and websites. Click a tile to start it.' }),
        el('div', { class: 'modal-buttons' },
          el('button', { class: 'action primary', onclick: () => add('app') }, '＋ Program or game…'),
          el('button', { class: 'action', onclick: () => addWeb() }, '🌐 Website…'))));
      return;
    }
    const matches = (i) => !filter || i.name.toLowerCase().includes(filter) || i.group.toLowerCase().includes(filter) || i.target.toLowerCase().includes(filter);
    // Searching looks through every category; otherwise the chosen one is shown.
    if (filter || hub.view === 'all') {
      const items = hub.items.filter(matches);
      const recent = filter ? [] : byRecent(hub.items).slice(0, 6);
      const groups = hub.groups.filter((g) => items.some((i) => i.group === g));
      body.replaceChildren(
        ...(recent.length >= 2 ? [el('section', { class: 'apps-group' }, el('h4', { text: 'Recently used' }), el('div', { class: 'apps-grid' }, ...recent.map(tile)))] : []),
        ...groups.map((g) => el('section', { class: 'apps-group', 'data-group': g }, el('h4', { text: g }), el('div', { class: 'apps-grid' }, ...items.filter((i) => i.group === g).map(tile)))),
        ...(items.length ? [] : [el('p', { class: 'music-none', text: 'Nothing matches.' })]));
      return;
    }
    if (hub.view === 'recent') {
      body.replaceChildren(el('section', { class: 'apps-group' }, el('div', { class: 'apps-grid' }, ...byRecent(hub.items).slice(0, 24).map(tile))));
      return;
    }
    const g = currentGroup();
    const items = hub.items.filter((i) => i.group === g);
    body.replaceChildren(items.length
      ? el('section', { class: 'apps-group', 'data-group': g }, el('div', { class: 'apps-grid' }, ...items.map(tile)))
      : el('div', { class: 'vb-empty' }, el('p', { text: `Nothing in “${g}” yet. Add something with ＋ (it goes into this category), or right-click a shortcut › Move to category.` }),
        el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => add('app') }, '＋ Program or game…'),
          el('button', { class: 'action', onclick: () => addWeb() }, '🌐 Website…'))));
  }

  return { init, open, close, toggle, isOpen, refresh, _state: () => ({ open: isOpen(), items: hub.items.map((i) => i.name), view: hub.view, groups: [...hub.groups] }) };
})();
