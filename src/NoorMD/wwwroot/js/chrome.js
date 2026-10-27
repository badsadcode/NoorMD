// NoorMD window chrome: the main menu bar and the customizable primary toolbar.
// Neither owns any behaviour. Every item names a command from the app's single command registry (app.js),
// so the menu, the toolbar, keyboard shortcuts and the Ctrl+K palette always run the same code.
window.NoorChrome = (() => {
  'use strict';
  const { $, el } = NoorUI;
  let api = null;

  // ---------------------------------------------------------------- icons (24×24, stroke)

  const P = {
    new: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
    open: 'M4 19V5h7l2 3h7v11z',
    save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
    undo: 'M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3',
    redo: 'm15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h3',
    bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z',
    italic: 'M10 4h8M6 20h8M14 4l-4 16',
    strike: 'M5 12h14M16 6.5C15 5 13.6 4.5 12 4.5c-2.5 0-4 1.3-4 3.2 0 1.6 1 2.4 2.6 3M8 17.5c1 1.5 2.4 2 4 2 2.6 0 4.2-1.3 4.2-3.3 0-.7-.2-1.3-.5-1.7',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    ul: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    ol: 'M10 6h10M10 12h10M10 18h10M4 4h1.5v4M3.5 10.5c.5-.7 2.5-.7 2.5.6 0 1-2.5 2-2.5 2.9H6M3.5 16h2.3l-1.3 1.6c1 0 1.6.4 1.6 1.1 0 1.2-2 1.3-2.6.6',
    task: 'M4 5h5v5H4zM4 14h5v5H4zM5.5 16.5l1 1 2-2.5M13 7.5h7M13 16.5h7',
    code: 'm8 8-4 4 4 4M16 8l4 4-4 4',
    codeblock: 'M4 4h16v16H4zM9 10l-2 2 2 2M15 10l2 2-2 2',
    table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
    quote: 'M7 7H4v6h3l-1 4M17 7h-3v6h3l-1 4',
    hr: 'M4 12h16',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01',
    find: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16.5 16.5 21 21',
    sidebar: 'M4 5h16v14H4zM9 5v14',
    tabs: 'M3 8h7l2-3h9v14H3z',
    focus: 'M12 3 21 12 12 21 3 12z',
    width: 'M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3',
    snapshot: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2',
    palette: 'M8 4a2 2 0 1 0 0 4h8a2 2 0 1 0 0-4 2 2 0 0 0-2 2v12a2 2 0 1 0 2-2H8a2 2 0 1 0 2 2V6a2 2 0 0 0-2-2z',
    play: 'M7 4v16l13-8z',
    shuffle: 'M3 7h4c4 0 6 10 10 10h4M3 17h4c1.6 0 2.8-1.6 3.9-3.6M14 9.6C15.1 8.2 16 7 17.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3',
    dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
    pause: 'M7 4h4v16H7zM14 4h4v16h-4z',
    music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    film: 'M3 5h18v14H3zM7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4',
    broadcast: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2',
    heading: 'M6 4v16M18 4v16M6 12h12',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    vault: 'M3 6h6l2 2h10v11H3zM3 10h18',
    pack: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
    sketch: 'M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16zM14 7l3 3',
    search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16.5 16.5 21 21M8 11h6',
  };
  const icon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', P[name] || P.more);
    svg.append(path);
    return svg;
  };

  // ---------------------------------------------------------------- toolbar layout

  // Group ids are stored in preferences (toolbarGroups), so they must stay stable.
  const GROUPS = {
    document: { label: 'Document', items: [['doc.new', 'new', 'New'], ['doc.open', 'open', 'Open'], ['doc.save', 'save', 'Save'], '|', ['edit.undo', 'undo', 'Undo'], ['edit.redo', 'redo', 'Redo']] },
    writing: { label: 'Writing', items: ['heading', ['fmt.bold', 'bold', 'Bold', 'strong'], ['fmt.italic', 'italic', 'Italic', 'emph'], ['fmt.strike', 'strike', 'Strike', 'strike'], ['insert.link', 'link', 'Link'], '|',
      ['fmt.ul', 'ul', 'Bullets', 'bulletList'], ['fmt.ol', 'ol', 'Numbers', 'orderedList'], ['fmt.task', 'task', 'Checklist', 'taskList'], ['fmt.quote', 'quote', 'Quote', 'blockQuote'], '|',
      ['fmt.code', 'code', 'Code', 'code'], ['insert.codeblock', 'codeblock', 'Code block', 'codeBlock'], ['insert.table', 'table', 'Table', 'table'], ['insert.image', 'image', 'Image']] },
    navigation: { label: 'Navigation', items: [['find.show', 'find', 'Find'], ['view.sidebar', 'sidebar', 'Sidebar'], ['tab.switch', 'tabs', 'Documents']] },
    view: { label: 'View', items: ['modes', ['width.cycle', 'width', 'Width'], ['view.focus', 'focus', 'Focus']] },
    tools: { label: 'Tools', items: [['snapshot.create', 'snapshot', 'Snapshot'], ['palette.show', 'palette', 'Commands']] },
    media: { label: 'Media', items: ['nowplaying', ['music.shuffle', 'shuffle', 'Shuffle'], ['music.random', 'dice', 'Random'], ['music.toggle', 'music', 'Music Bench'], ['video.toggle', 'film', 'Video Bench'], ['stream.toggle', 'broadcast', 'Stream Desk']] },
  };
  const DEFAULT_ORDER = ['document', 'writing', 'navigation', 'view', 'tools', 'media'];
  // When the window is narrow, the least important buttons move into "More" first (higher = kept longer).
  const PRIORITY = {
    'doc.save': 9, modes: 9, 'fmt.bold': 8, 'fmt.italic': 8, heading: 7, 'edit.undo': 6, 'insert.link': 6, 'fmt.ul': 6, 'find.show': 6,
    'edit.redo': 5, 'fmt.ol': 5, 'doc.open': 4, 'fmt.task': 4, 'fmt.code': 4, 'view.focus': 4, 'doc.new': 3, 'fmt.strike': 3, 'fmt.quote': 3,
    'insert.codeblock': 3, 'insert.table': 3, 'width.cycle': 2, 'insert.image': 2, 'view.sidebar': 2, 'palette.show': 2, nowplaying: 2,
    'tab.switch': 1, 'snapshot.create': 1, 'music.toggle': 1, 'music.shuffle': 1, 'music.random': 1, 'video.toggle': 0.5, 'stream.toggle': 0.5,
  };

  /** The user's visible groups, in order; unknown ids (a later build dropped a module) are ignored. */
  function groupOrder(prefs) {
    const raw = String(prefs.toolbarGroups ?? DEFAULT_ORDER.join(','));
    const list = raw.split(',').map((s) => s.trim()).filter((g) => GROUPS[g]);
    return [...new Set(list)];
  }

  let formatState = {};

  function buildToolbar() {
    const prefs = api.prefs();
    const bar = $('#toolbar');
    bar.replaceChildren();
    for (const gid of groupOrder(prefs)) {
      const g = el('div', { class: 'tb-group', role: 'group', 'aria-label': GROUPS[gid].label, 'data-group': gid });
      for (const item of GROUPS[gid].items) {
        let node;
        if (item === '|') node = el('span', { class: 'tb-sep', 'aria-hidden': 'true' });
        else if (item === 'heading') node = headingButton();
        else if (item === 'modes') node = modePill();
        else if (item === 'nowplaying') node = nowPlaying();
        else node = commandButton(...item);
        node.dataset.priority = String(item === '|' ? 0 : PRIORITY[typeof item === 'string' ? item : item[0]] ?? 3);
        g.append(node);
      }
      bar.append(g);
    }
    const more = el('button', { class: 'tb-btn tb-more', id: 'toolbar-more', title: 'More commands', 'aria-label': 'More commands', 'aria-haspopup': 'menu', hidden: true }, icon('more'));
    more.addEventListener('click', () => openOverflow(more));
    bar.append(more);
    refresh();
    requestAnimationFrame(fitToolbar);
  }

  function commandButton(id, iconName, label, stateKey) {
    const c = api.command(id);
    const keep = id === 'width.cycle'; // the width button always names the current preset
    const b = el('button', { class: 'tb-btn' + (keep ? ' tb-keep-label' : ''), id: keep ? 'width-toggle' : null, 'data-cmd-id': id, 'data-state': stateKey || null, 'aria-label': c ? c.label : label, title: tip(id, label) },
      icon(iconName), el('span', { class: 'tb-label', text: label }));
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the caret (and selection) in the editor
    b.addEventListener('click', () => api.run(id));
    return b;
  }

  function tip(id, label) {
    const c = api.command(id);
    return (c ? c.label : label) + (c && c.keys ? ` (${c.keys})` : '');
  }

  function headingButton() {
    const b = el('button', { class: 'tb-btn tb-heading', 'data-state': 'heading', 'aria-haspopup': 'menu', title: 'Paragraph style (Ctrl+Shift+1…6)', 'aria-label': 'Paragraph style' },
      icon('heading'), el('span', { class: 'tb-label tb-heading-label', text: 'Text' }), el('span', { class: 'tb-caret', 'aria-hidden': 'true', text: '▾' }));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => openMenu(b, [['heading.0', 'Normal text'], ...[1, 2, 3, 4, 5, 6].map((n) => [`heading.${n}`, `Heading ${n}`])].map(([id, label]) => ({ id, label }))));
    return b;
  }

  function modePill() {
    const pill = el('div', { class: 'pill', role: 'tablist', 'aria-label': 'Editor mode' });
    for (const [mode, id, label] of [['wysiwyg', 'view.visual', '✦ Visual'], ['markdown', 'view.markdown', '</> Markdown'], ['split', 'view.split', '◫ Split']]) {
      const b = el('button', { role: 'tab', 'data-mode': mode, id: 'mode-' + (mode === 'wysiwyg' ? 'visual' : mode), title: tip(id, label) }, label);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => api.run(id));
      pill.append(b);
    }
    return pill;
  }

  function nowPlaying() {
    const b = el('button', { class: 'tb-btn tb-play', 'data-cmd-id': 'music.play', title: tip('music.play', 'Play / pause'), 'aria-label': 'Play / pause music' }, icon('play'), el('span', { class: 'tb-label tb-np', text: 'Music' }));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => api.run('music.play'));
    return b;
  }

  /** Re-reads checked/enabled/format state into every visible button and menu. */
  function refresh() {
    const bar = $('#toolbar');
    if (!bar) return;
    for (const b of bar.querySelectorAll('[data-cmd-id]')) {
      const st = api.state(b.dataset.cmdId);
      b.disabled = st.enabled === false;
      const pressed = b.dataset.state ? !!(formatState[b.dataset.state] && formatState[b.dataset.state].active) : st.checked;
      if (pressed === undefined || pressed === null) b.removeAttribute('aria-pressed');
      else b.setAttribute('aria-pressed', String(!!pressed));
      b.classList.toggle('on', !!pressed);
    }
    bar.querySelectorAll('.pill button').forEach((b) => {
      const on = !!api.state({ wysiwyg: 'view.visual', markdown: 'view.markdown', split: 'view.split' }[b.dataset.mode]).checked;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    const h = bar.querySelector('.tb-heading-label');
    if (h) h.textContent = api.headingLabel();
    const np = api.nowPlaying();
    const play = bar.querySelector('.tb-play');
    if (play) {
      play.replaceChild(icon(np.playing ? 'pause' : 'play'), play.querySelector('svg'));
      play.querySelector('.tb-np').textContent = np.title || 'Music';
      play.title = (np.title ? np.title + ' — ' : '') + tip('music.play', 'Play / pause');
    }
  }

  function setFormatState(st) {
    formatState = st || {};
    refresh();
  }

  // Items that don't fit are moved into the "More" menu (lowest groups first), instead of being clipped.
  function fitToolbar() {
    const bar = $('#toolbar');
    if (!bar || bar.offsetParent === null) return;
    const more = $('#toolbar-more');
    const items = [...bar.querySelectorAll('.tb-group > *')];
    items.forEach((n) => n.classList.remove('tb-overflow'));
    bar.querySelectorAll('.tb-group').forEach((g) => g.classList.remove('tb-overflow'));
    more.hidden = true;
    if (bar.scrollWidth <= bar.clientWidth + 1) return;
    // Dropping the separators is often enough; then no "More" button is needed.
    items.filter((n) => n.classList.contains('tb-sep')).forEach((n) => n.classList.add('tb-overflow'));
    if (bar.scrollWidth <= bar.clientWidth + 1) return;
    more.hidden = false;
    // Least important first; among equals, the ones further right.
    const order = items.map((n, i) => [n, Number(n.dataset.priority || 0), i]).sort((a, b) => a[1] - b[1] || b[2] - a[2]);
    for (const [n] of order) {
      if (bar.scrollWidth <= bar.clientWidth + 1) break;
      n.classList.add('tb-overflow');
      const g = n.parentElement;
      if ([...g.children].every((x) => x.classList.contains('tb-overflow') || x.classList.contains('tb-sep'))) g.classList.add('tb-overflow');
    }
  }

  function openOverflow(anchor) {
    const hidden = [...document.querySelectorAll('#toolbar .tb-overflow[data-cmd-id], #toolbar .tb-overflow.tb-heading, #toolbar .tb-overflow.pill, #toolbar .tb-overflow [data-cmd-id], #toolbar .tb-overflow .tb-heading, #toolbar .tb-overflow .pill')];
    const entries = [];
    for (const n of hidden) {
      if (n.classList.contains('tb-heading')) entries.push(...[0, 1, 2, 3].map((k) => ({ id: 'heading.' + k })));
      else if (n.classList.contains('pill')) entries.push({ id: 'view.visual' }, { id: 'view.markdown' }, { id: 'view.split' });
      else entries.push({ id: n.dataset.cmdId });
    }
    const seen = new Set();
    const unique = entries.filter((x) => !seen.has(x.id) && seen.add(x.id));
    entries.length = 0;
    entries.push(...unique, '-', { id: 'toolbar.customize' });
    openMenu(anchor, entries);
  }

  // ---------------------------------------------------------------- menus

  const MENUS = [
    ['File', 'f', () => [
      { id: 'doc.new' }, { id: 'doc.open' }, { id: 'vault.open' }, { label: 'Open recent', sub: recentItems }, '-',
      { id: 'doc.save' }, { id: 'doc.saveAs' }, { id: 'doc.saveAll' }, '-',
      { label: 'Export', sub: () => [{ id: 'export.markdown' }, { id: 'export.html' }, { id: 'export.pdf' }] }, { id: 'print' }, '-',
      { id: 'doc.reload' }, { id: 'doc.reveal' }, { id: 'tab.close' }, { id: 'app.newWindow' }, '-', { id: 'app.exit' },
    ]],
    ['Edit', 'e', () => [
      { id: 'edit.undo' }, { id: 'edit.redo' }, '-', { id: 'edit.cut' }, { id: 'edit.copy' }, { id: 'edit.paste' }, { id: 'edit.selectAll' }, '-',
      { id: 'find.show' }, { id: 'find.replace' }, { id: 'vault.search' }, '-', { id: 'source.copy' }, { id: 'spell.toggle' }, '-', { id: 'prefs.show' },
    ]],
    ['Insert', 'i', () => [
      { id: 'insert.link' }, { id: 'insert.image' }, { id: 'insert.table' }, { id: 'insert.codeblock' }, { id: 'insert.hr' }, { id: 'fmt.task' }, '-',
      { id: 'vault.insertLink' }, { label: 'Sketch (opens NoorSketch)', run: () => api.run('sketch.new') },
    ]],
    ['Format', 'o', () => [
      { id: 'heading.0' }, { id: 'heading.1' }, { id: 'heading.2' }, { id: 'heading.3' }, { label: 'More headings', sub: () => [{ id: 'heading.4' }, { id: 'heading.5' }, { id: 'heading.6' }] }, '-',
      { id: 'fmt.bold' }, { id: 'fmt.italic' }, { id: 'fmt.strike' }, { id: 'fmt.code' }, '-',
      { id: 'fmt.quote' }, { id: 'fmt.ul' }, { id: 'fmt.ol' }, { id: 'fmt.task' }, { id: 'fmt.indent' }, { id: 'fmt.outdent' },
    ]],
    ['View', 'v', () => [
      { id: 'view.toolbar' }, { id: 'view.sidebar' }, { id: 'music.toggle' }, { id: 'music.mini' }, '-',
      { id: 'view.visual' }, { id: 'view.markdown' }, { id: 'view.split' }, '-',
      { id: 'view.focus' }, { id: 'layout.compact' },
      { label: 'Layout', sub: () => [
        ...NoorDock.PRESETS.map((p) => ({ label: p.name, title: p.description, run: () => NoorDock.applyPreset(p.id) })), '-',
        { id: 'layout.show' }, { id: 'layout.save' }, '-', { id: 'view.sidebarRight' },
      ] },
      { label: 'Line width', sub: () => [{ id: 'width.comfortable' }, { id: 'width.wide' }, { id: 'width.full' }] },
      { label: 'Zoom', sub: () => [{ id: 'font.bigger' }, { id: 'font.smaller' }, { id: 'font.reset' }] },
      { label: 'Markdown source', sub: () => [{ id: 'source.lineNumbers' }, { id: 'source.wrap' }, { id: 'source.sync' }] }, '-',
      { id: 'theme.pick' }, { id: 'theme.next' }, '-', { id: 'toolbar.customize' },
    ]],
    ['Workspace', 'w', () => [
      { id: 'vault.open' }, { id: 'vault.create' }, { label: 'Recent vaults', sub: () => api.recentVaults() }, { id: 'vault.close' }, { id: 'vault.reveal' }, { id: 'vault.addPreset' }, '-',
      { id: 'vault.explorer' }, { id: 'vault.tags' }, { id: 'vault.search' }, { id: 'tab.switch' }, { id: 'vault.backlinks' }, { id: 'vault.refresh' }, '-',
      { id: 'vault.pack' }, '-', { id: 'tab.closeOthers' }, { id: 'tab.pin' }, { id: 'recovery.show' }, { id: 'session.restore' },
    ]],
    ['Media', 'm', () => [
      { id: 'music.toggle' }, { id: 'video.toggle' }, { id: 'stream.toggle' }, { label: 'Stream', sub: () => [{ id: 'stream.nowplaying' }, { id: 'stream.credits' }, { id: 'stream.supporters' }, { id: 'stream.log' }] }, '-', { id: 'music.addFolder' }, { id: 'music.folders' }, { id: 'music.import' }, { id: 'video.addFolder' }, '-',
      { id: 'music.play' }, { id: 'music.next' }, { id: 'music.prev' }, { id: 'music.random' }, '-', { id: 'music.shuffle' }, { id: 'music.repeat' }, '-',
      { id: 'music.edit' }, { id: 'music.batch' }, { id: 'music.undo' }, '-', { id: 'music.sound' }, { id: 'music.smart' },
      { label: 'Triage current track', sub: () => [{ id: 'music.fav' }, { id: 'music.keep' }, { id: 'music.maybe' }, { id: 'music.skip' }, { id: 'music.clearTriage' }] },
    ]],
    ['Tools', 't', () => [
      { id: 'palette.show' }, { id: 'stats.show' }, { id: 'goal.set' }, '-', { id: 'snapshot.create' }, { id: 'history.show' }, '-',
      { label: 'NoorSketch', sub: () => [{ id: 'sketch.new' }, { id: 'sketch.open' }] }, { id: 'apps.toggle' },
    ]],
    ['Help', 'h', () => [
      { id: 'shortcuts.show' }, { id: 'help.guide' }, '-', { id: 'help.diagnostics' }, { id: 'help.repo' }, { id: 'about.show' },
    ]],
  ];

  function recentItems() {
    const list = api.recent().slice(0, 12).map((r) => ({ label: r.name, title: r.path, run: () => api.openRecent(r.path) }));
    return list.length ? list : [{ label: 'No recent files', disabled: true }];
  }

  function buildMenubar() {
    const bar = $('#menubar');
    bar.replaceChildren();
    MENUS.forEach(([name, key, items], i) => {
      const b = el('button', { class: 'menu-title', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu': String(i), tabindex: i === 0 ? '0' : '-1' },
        el('span', { class: 'mnemonic', text: name.slice(0, name.toLowerCase().indexOf(key)) }), el('u', { text: name[name.toLowerCase().indexOf(key)] }), name.slice(name.toLowerCase().indexOf(key) + 1));
      b.title = `${name} (Alt+${key.toUpperCase()})`;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); toggleTop(i); });
      b.addEventListener('mouseenter', () => { if (openTop !== null && openTop !== i) showTop(i); });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + MENUS.length) % MENUS.length; focusTitle(n); }
        else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTop(i, true); }
      });
      bar.append(b);
    });
  }

  function focusTitle(i) {
    const titles = [...document.querySelectorAll('#menubar .menu-title')];
    titles.forEach((t, k) => { t.tabIndex = k === i ? 0 : -1; });
    titles[i].focus();
    if (openTop !== null) showTop(i, true);
  }

  let openTop = null;
  let returnFocus = null;
  function toggleTop(i) { if (openTop === i) closeMenus(); else showTop(i, false); }
  function showTop(i, focusFirst) {
    const title = document.querySelector(`#menubar .menu-title[data-menu="${i}"]`);
    if (openTop === null) returnFocus = document.activeElement && !document.activeElement.closest('#menubar') ? document.activeElement : returnFocus;
    closeMenus(true);
    openTop = i;
    title.setAttribute('aria-expanded', 'true');
    title.classList.add('open');
    const r = title.getBoundingClientRect();
    const menu = renderMenu(MENUS[i][2](), { left: r.left, top: r.bottom + 2 }, 0, (dir) => {
      const n = (i + dir + MENUS.length) % MENUS.length;
      showTop(n, true);
      document.querySelector(`#menubar .menu-title[data-menu="${n}"]`).tabIndex = 0;
    });
    if (focusFirst) menu.querySelector('.menu-item:not([disabled])')?.focus();
  }

  /** Opens a stand-alone popup menu (toolbar heading picker, overflow, context menus). */
  function openMenu(anchor, items, at) {
    closeMenus(true);
    returnFocus = document.activeElement;
    const r = anchor ? anchor.getBoundingClientRect() : { left: at.x, bottom: at.y, right: at.x };
    const menu = renderMenu(items, { left: r.left, top: r.bottom + 2 }, 0);
    menu.querySelector('.menu-item:not([disabled])')?.focus();
  }

  function renderMenu(items, pos, depth, onSide) {
    const menu = el('div', { class: 'menu-popup', role: 'menu', 'data-depth': String(depth) });
    const list = typeof items === 'function' ? items() : items;
    let lastWasSep = true;
    for (const it of list) {
      if (it === '-') { if (!lastWasSep) menu.append(el('div', { class: 'menu-sep', role: 'separator' })); lastWasSep = true; continue; }
      const c = it.id ? api.command(it.id) : null;
      if (it.id && !c) continue; // a module that isn't in this build: no dead items
      const st = it.id ? api.state(it.id) : {};
      const label = it.label || c.label;
      const keys = c && c.keys ? c.keys : '';
      const checkable = st.checked !== undefined && st.checked !== null;
      const b = el('button', {
        class: 'menu-item' + (it.sub ? ' has-sub' : ''), role: checkable ? 'menuitemcheckbox' : 'menuitem', tabindex: '-1',
        'aria-checked': checkable ? String(!!st.checked) : null, disabled: it.disabled || st.enabled === false || undefined, title: it.title || null, 'data-cmd-id': it.id || null,
      }, el('span', { class: 'menu-check', 'aria-hidden': 'true', text: checkable && st.checked ? '✓' : '' }), el('span', { class: 'menu-label', text: label }),
      el('span', { class: 'menu-keys', text: it.sub ? '▸' : keys }));
      if (it.sub) {
        const open = () => {
          menu.querySelectorAll(':scope > .menu-item.sub-open').forEach((x) => x.classList.remove('sub-open'));
          document.querySelectorAll('.menu-popup').forEach((m) => { if (Number(m.dataset.depth) > depth) m.remove(); });
          b.classList.add('sub-open');
          const r = b.getBoundingClientRect();
          return renderMenu(it.sub, { left: r.right - 2, top: r.top - 5, flipLeft: r.left + 2 }, depth + 1);
        };
        b.addEventListener('mouseenter', open);
        b.addEventListener('click', () => open().querySelector('.menu-item:not([disabled])')?.focus());
        b._openSub = open;
      } else {
        b.addEventListener('mouseenter', () => {
          document.querySelectorAll('.menu-popup').forEach((m) => { if (Number(m.dataset.depth) > depth) m.remove(); });
          b.focus({ preventScroll: true });
        });
        b.addEventListener('click', () => {
          closeMenus();
          if (it.run) it.run(); else api.run(it.id);
        });
      }
      menu.append(b);
      lastWasSep = false;
    }
    while (menu.lastChild && menu.lastChild.classList.contains('menu-sep')) menu.lastChild.remove();
    menu.addEventListener('keydown', (e) => menuKeys(e, menu, depth, onSide));
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(menu);
    const mr = menu.getBoundingClientRect();
    // A submenu that doesn't fit on the right opens to the left of its parent instead of covering it.
    const left = pos.flipLeft != null && pos.left + mr.width > window.innerWidth - 4 ? pos.flipLeft - mr.width : pos.left;
    menu.style.left = Math.max(4, Math.min(left, window.innerWidth - mr.width - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(pos.top, window.innerHeight - mr.height - 4)) + 'px';
    if (!document._noorMenuListener) {
      document._noorMenuListener = true;
      document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu-popup, #menubar')) closeMenus(); }, true);
      window.addEventListener('blur', () => closeMenus(true));
      window.addEventListener('resize', () => closeMenus(true));
    }
    return menu;
  }

  function menuKeys(e, menu, depth, onSide) {
    const items = [...menu.querySelectorAll(':scope > .menu-item:not([disabled])')];
    const i = items.indexOf(document.activeElement);
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); items[(i + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (k === 'Home' || k === 'End') { e.preventDefault(); items[k === 'Home' ? 0 : items.length - 1]?.focus(); }
    else if (k === 'ArrowRight') {
      e.preventDefault();
      const cur = items[i];
      if (cur && cur._openSub) cur._openSub().querySelector('.menu-item:not([disabled])')?.focus();
      else if (onSide) onSide(1);
      else if (depth > 0) return;
    } else if (k === 'ArrowLeft') {
      e.preventDefault();
      if (depth > 0) {
        const parent = [...document.querySelectorAll(`.menu-popup[data-depth="${depth - 1}"] .sub-open`)][0];
        menu.remove();
        parent?.classList.remove('sub-open');
        parent?.focus();
      } else if (onSide) onSide(-1);
    } else if (k === 'Enter' || k === ' ') { e.preventDefault(); items[i]?.click(); }
    else if (k === 'Tab') { e.preventDefault(); closeMenus(); }
    else if (k.length === 1 && /\S/.test(k)) {
      // Type-ahead: jump to the next item starting with that letter.
      const start = (i + 1) % Math.max(1, items.length);
      const order = items.slice(start).concat(items.slice(0, start));
      order.find((x) => x.querySelector('.menu-label').textContent.toLowerCase().startsWith(k.toLowerCase()))?.focus();
    }
  }

  /** Closes every menu. Returns true if one was open (so Esc can be consumed). */
  function closeMenus(keepFocus) {
    const popups = document.querySelectorAll('.menu-popup');
    const had = popups.length > 0;
    popups.forEach((m) => m.remove());
    document.querySelectorAll('#menubar .menu-title').forEach((t) => { t.setAttribute('aria-expanded', 'false'); t.classList.remove('open'); });
    const wasTop = openTop !== null;
    openTop = null;
    if (had && !keepFocus) {
      const target = returnFocus && document.contains(returnFocus) ? returnFocus : null;
      returnFocus = null;
      if (target && target.focus) target.focus({ preventScroll: true }); else if (wasTop) api.focusEditor();
    }
    return had;
  }
  const isOpen = () => document.querySelectorAll('.menu-popup').length > 0;

  /** Alt+letter opens a top menu; F10 focuses the menu bar. Returns true when handled. */
  function handleKey(e) {
    if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); closeMenus(true); returnFocus = document.activeElement; focusTitle(0); return true; }
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^Key[A-Z]$/.test(e.code)) {
      const letter = e.code.slice(3).toLowerCase();
      const i = MENUS.findIndex(([, key]) => key === letter);
      if (i < 0) return false;
      e.preventDefault();
      showTop(i, true);
      return true;
    }
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); closeMenus(); return true; }
    return false;
  }

  // ---------------------------------------------------------------- customization

  function showCustomize() {
    const prefs = api.prefs();
    let order = groupOrder(prefs);
    const hidden = DEFAULT_ORDER.filter((g) => !order.includes(g));
    let all = order.concat(hidden);
    NoorUI.modal({ label: 'Customize toolbar', width: 520 }, (s, close) => {
      const list = el('div', { class: 'tb-custom-list' });
      const render = () => {
        list.replaceChildren(...all.map((g, i) => {
          const cb = el('input', { type: 'checkbox', id: 'tbg-' + g, checked: order.includes(g) || undefined });
          cb.addEventListener('change', () => { order = all.filter((x) => (x === g ? cb.checked : order.includes(x))); save(); });
          const move = (d) => { const j = i + d; if (j < 0 || j >= all.length) return; [all[i], all[j]] = [all[j], all[i]]; order = all.filter((x) => order.includes(x)); save(); render(); list.querySelector('#tbg-' + g)?.focus(); };
          return el('div', { class: 'tb-custom-row' }, el('label', { class: 'inline', for: 'tbg-' + g }, cb, GROUPS[g].label),
            el('span', { class: 'row-actions' },
              el('button', { class: 'utility-btn', 'aria-label': `Move ${GROUPS[g].label} left`, disabled: i === 0 || undefined, onclick: () => move(-1) }, '↑'),
              el('button', { class: 'utility-btn', 'aria-label': `Move ${GROUPS[g].label} right`, disabled: i === all.length - 1 || undefined, onclick: () => move(1) }, '↓')));
        }));
      };
      const save = () => api.setPrefs({ toolbarGroups: order.join(',') });
      const show = el('input', { type: 'checkbox', id: 'tb-show', checked: prefs.showToolbar !== false || undefined });
      show.addEventListener('change', () => api.setPrefs({ showToolbar: show.checked }));
      const labels = el('input', { type: 'checkbox', id: 'tb-labels', checked: !!prefs.toolbarLabels || undefined });
      labels.addEventListener('change', () => api.setPrefs({ toolbarLabels: labels.checked }));
      const small = el('input', { type: 'checkbox', id: 'tb-small', checked: !!prefs.toolbarSmall || undefined });
      small.addEventListener('change', () => api.setPrefs({ toolbarSmall: small.checked }));
      const zen = el('input', { type: 'checkbox', id: 'tb-zen', checked: !!prefs.zenToolbar || undefined });
      zen.addEventListener('change', () => api.setPrefs({ zenToolbar: zen.checked }));
      render();
      s.append(NoorUI.head('Customize toolbar', close), el('div', { class: 'modal-body' },
        el('label', { class: 'inline' }, show, 'Show the toolbar'),
        el('label', { class: 'inline' }, labels, 'Show text labels'),
        el('label', { class: 'inline' }, small, 'Small buttons (always small in Compact layout)'),
        el('label', { class: 'inline' }, zen, 'Keep the toolbar in Focus mode'),
        el('div', { class: 'section-heading', style: 'margin:14px 0 6px', text: 'Groups (tick to show, arrows to reorder)' }), list),
      el('div', { class: 'modal-foot' }, el('span', { text: 'Every command also stays in the menus and in Ctrl+K.' }),
        el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => { all = [...DEFAULT_ORDER]; order = [...DEFAULT_ORDER]; api.setPrefs({ toolbarGroups: order.join(','), toolbarLabels: false, toolbarSmall: false, showToolbar: true }); show.checked = true; labels.checked = false; small.checked = false; render(); } }, 'Restore defaults'),
          el('button', { class: 'action primary', onclick: () => close() }, 'Done'))));
    });
  }

  function applyPrefs(prefs) {
    document.body.classList.toggle('no-toolbar', prefs.showToolbar === false);
    document.body.classList.toggle('toolbar-labels', !!prefs.toolbarLabels);
    document.body.classList.toggle('toolbar-small', !!prefs.toolbarSmall);
    document.body.classList.toggle('zen-toolbar', !!prefs.zenToolbar);
    const want = groupOrder(prefs).join(',');
    const have = [...document.querySelectorAll('#toolbar .tb-group')].map((g) => g.dataset.group).join(',');
    if (want !== have) buildToolbar(); else requestAnimationFrame(fitToolbar);
  }

  function init(a) {
    api = a;
    buildMenubar();
    buildToolbar();
    $('#toolbar').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const prefs = api.prefs();
      openMenu(null, [
        { label: prefs.toolbarLabels ? 'Hide text labels' : 'Show text labels', run: () => api.setPrefs({ toolbarLabels: !prefs.toolbarLabels }) },
        { label: prefs.toolbarSmall ? 'Normal buttons' : 'Small buttons', run: () => api.setPrefs({ toolbarSmall: !prefs.toolbarSmall }) },
        { id: 'toolbar.customize' }, '-', { id: 'view.toolbar' },
      ], { x: e.clientX, y: e.clientY });
    });
    // Holding Alt underlines the menu access keys, as in other Windows programs.
    window.addEventListener('keydown', (e) => { if (e.key === 'Alt') document.body.classList.add('show-mnemonics'); }, true);
    window.addEventListener('keyup', (e) => { if (e.key === 'Alt') document.body.classList.remove('show-mnemonics'); }, true);
    window.addEventListener('blur', () => document.body.classList.remove('show-mnemonics'));
    window.addEventListener('resize', () => requestAnimationFrame(fitToolbar));
    if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(fitToolbar)).observe($('#toolbar'));
  }

  return { init, refresh, setFormatState, applyPrefs, handleKey, closeMenus, isOpen, showCustomize, fitToolbar, openMenu };
})();
