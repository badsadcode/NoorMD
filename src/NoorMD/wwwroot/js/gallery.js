// NoorMD Gallery: the pictures in the folders you add (subfolders are albums), in a panel that docks like the benches.
// Click a picture to view it full size; put it into the note; mark favourites; play a slideshow with music.
// Pictures come from the host by id (/_img/{id}, previews from /_thumb/{id}); the files themselves are never changed.
window.NoorGallery = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const PAGE = 240; // tiles drawn at a time; "Show more" adds the next ones
  const SORTS = { 'taken-desc': ['taken', true, 'Newest first'], 'taken-asc': ['taken', false, 'Oldest first'], name: ['name', false, 'By name'], type: ['type', false, 'By type (format)'], 'size-desc': ['size', true, 'Largest files first'], 'rating-desc': ['rating', true, 'Most stars first'], 'added-desc': ['added', true, 'Recently added'] };
  const TRANSITIONS = { fade: 'Fade', kenburns: 'Slow zoom (Ken Burns)', slide: 'Slide', none: 'None' };
  const DEFAULT_SHOW = { interval: 5, transition: 'fade', shuffle: false, loop: true, music: 'keep', playlistId: null, captions: true, stopMusic: true };

  let hooks = { showError: (e) => console.error(e), insertedInto: () => {} };
  let built = false;
  let status = { folders: [], count: 0, albums: [], slideshows: [], scanning: false };
  let view = { source: 'all', sort: 'taken-desc', search: '', format: '', mark: '' };
  // Colour labels, with the keys that set them (6–9, as in Lightroom); the others are in the menus.
  const LABELS = { red: ['Red', '6'], orange: ['Orange', ''], yellow: ['Yellow', '7'], green: ['Green', '8'], blue: ['Blue', '9'], purple: ['Purple', ''] };
  const LABEL_KEYS = { 6: 'red', 7: 'yellow', 8: 'green', 9: 'blue' };
  // A picture that was turned gets a new address for its preview, so the old one isn't shown from the cache.
  const turned = new Map();
  const thumbUrl = (id) => '/_thumb/' + id + (turned.has(id) ? '?r=' + turned.get(id) : '');
  const imgUrl = (id) => '/_img/' + id + (turned.has(id) ? '?r=' + turned.get(id) : '');
  let items = [];
  let shown = PAGE;
  const sel = new Set();
  let anchor = -1;
  let loadGen = 0;

  const isOpen = () => document.body.classList.contains('gallery-open');
  let manualScan = false;
  let checkedThisSession = false;

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('gallery.dupProgress', (p) => { if (onDupProgress) onDupProgress(p); });
    NoorBridge.on('gallery.convertProgress', (p) => { if (onConvertProgress) onConvertProgress(p); });
    NoorBridge.on('gallery.scanned', (p) => {
      if (!built) return;
      if (p.added || manualScan) notice(p.added ? `NoorGallery: ${p.added} new picture${p.added === 1 ? '' : 's'}` : 'NoorGallery is up to date', 1800);
      manualScan = false;
      refresh();
    });
  }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('gallery');
    document.body.classList.add('gallery-open');
    $('#gallery').hidden = false;
    if (!view.restored) {
      view.restored = true;
      try { const s = await req('gallery.session.get'); if (s) { const st = typeof s === 'string' ? JSON.parse(s) : s; if (st.source) view.source = st.source; if (SORTS[st.sort]) view.sort = st.sort; } } catch { /* first run */ }
    }
    await refresh();
    // Once per session: look for pictures added since (and formats NoorMD learned to show), quietly, in the background.
    if (!checkedThisSession && status.folders.length) { checkedThisSession = true; req('gallery.rescan').catch(() => {}); }
  }

  function close() {
    if (!built || !isOpen()) return;
    document.body.classList.remove('gallery-open');
    $('#gallery').hidden = true;
    if (window.NoorDock) NoorDock.closed('gallery');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  async function refresh() {
    try { status = await req('gallery.status'); } catch (err) { hooks.showError(err); return; }
    renderSources();
    await load();
  }

  function saveSession() { req('gallery.session.save', { state: { source: view.source, sort: view.sort } }).catch(() => {}); }

  function build() {
    built = true;
    const root = el('section', { id: 'gallery', class: 'gallery', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'NoorGallery' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '▦' }), el('strong', { text: 'NoorGallery' }), el('small', { id: 'gallery-count' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'gallery-play', title: 'Slideshow of what is shown (or the selected pictures)', 'aria-label': 'Play a slideshow', onclick: () => slideshowSetup() }, '▶'),
          el('button', { class: 'icon-btn', id: 'gallery-more', title: 'Folders, rescan and slideshows', 'aria-label': 'NoorGallery menu', onclick: (e) => mainMenu(e.currentTarget) }, '⋯'),
          el('button', { class: 'icon-btn', id: 'gallery-dock', title: 'Where this panel goes (left, right, bottom) and layouts', 'aria-label': 'Move NoorGallery', onclick: (e) => NoorDock.showMenu('gallery', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+G)', 'aria-label': 'Close NoorGallery', onclick: close }, '✕'))),
      el('div', { class: 'gallery-toolbar' },
        el('input', { id: 'gallery-search', type: 'search', placeholder: 'Find by name or album…', 'aria-label': 'Find pictures', autocomplete: 'off', spellcheck: 'false' }),
        el('div', { class: 'gallery-row' },
          el('select', { id: 'gallery-source', 'aria-label': 'What to show' }),
          el('select', { id: 'gallery-format', 'aria-label': 'Format', title: 'Only one format (JPG, PNG, PSD, Affinity…)' }),
          el('select', { id: 'gallery-mark', 'aria-label': 'Stars or colour label', title: 'Only pictures with stars or a colour label' },
            el('option', { value: '', text: 'Any stars or label' }),
            el('optgroup', { label: 'Stars' }, ...[1, 2, 3, 4, 5].map((n) => el('option', { value: 'r' + n, text: '★'.repeat(n) + (n < 5 ? ' or more' : '') }))),
            el('optgroup', { label: 'Colour label' }, ...Object.entries(LABELS).map(([k, v]) => el('option', { value: 'l:' + k, text: '● ' + v[0] })))),
          el('select', { id: 'gallery-sort', 'aria-label': 'Order' }, ...Object.entries(SORTS).map(([k, v]) => el('option', { value: k, text: v[2] }))))),
      el('div', { class: 'gallery-main' },
        el('nav', { class: 'gallery-nav', id: 'gallery-nav', 'aria-label': 'Albums and slideshows' }),
        el('div', { class: 'gallery-body', id: 'gallery-body' }),
        el('aside', { class: 'gallery-info', id: 'gallery-info', 'aria-label': 'Picture details' })));
    ($('#app') || document.body).append(root);
    // With room (in the middle, or a wide dock) the Gallery becomes a picture manager: albums on the left, details on the right.
    new ResizeObserver(() => {
      const w = root.clientWidth >= 880;
      if (w !== root.classList.contains('wide')) { root.classList.toggle('wide', w); renderNav(); renderInfo(); }
    }).observe(root);
    const size = el('input', { type: 'range', id: 'gallery-size', min: '80', max: '280', step: '10', value: String(tileSize()), 'aria-label': 'Picture size', title: 'Picture size (or Ctrl + mouse wheel over the pictures)' });
    size.addEventListener('input', () => { root.style.setProperty('--gtile', size.value + 'px'); try { localStorage.setItem('noormd.gallery.size', size.value); } catch { /* fine */ } });
    root.style.setProperty('--gtile', tileSize() + 'px');
    $('#gallery-sort').after(size);
    // Ctrl + mouse wheel over the pictures: bigger or smaller pictures (the slider moves with it); the wheel alone scrolls.
    $('#gallery-body').addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const v = Math.max(Number(size.min), Math.min(Number(size.max), Number(size.value) + (e.deltaY < 0 ? 1 : -1) * Number(size.step)));
      if (String(v) === size.value) return;
      size.value = String(v);
      size.dispatchEvent(new Event('input'));
    }, { passive: false });
    let t = null;
    $('#gallery-search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { view.search = e.target.value.trim(); load(); }, 180); });
    $('#gallery-source').addEventListener('change', (e) => { view.source = e.target.value; saveSession(); load(); });
    $('#gallery-sort').addEventListener('change', (e) => { view.sort = e.target.value; saveSession(); load(); });
    $('#gallery-format').addEventListener('change', (e) => { view.format = e.target.value; load(); });
    $('#gallery-mark').addEventListener('change', (e) => { view.mark = e.target.value; load(); });
    root.addEventListener('keydown', onPanelKeys);
  }

  function tileSize() { try { return Number(localStorage.getItem('noormd.gallery.size')) || 104; } catch { return 104; } }

  function mainMenu(anchorEl) {
    const showing = view.source.startsWith('show:') ? status.slideshows.find((s) => 'show:' + s.id === view.source) : null;
    NoorChrome.openMenu(anchorEl, [
      { label: 'Add a picture folder…', run: addFolder },
      { label: 'Look for new pictures', disabled: !status.folders.length, run: async () => { manualScan = true; notice('Looking for new pictures…', 1200); try { status = await req('gallery.rescan'); renderSources(); load(); } catch (err) { hooks.showError(err); } } },
      { label: 'Undo the last rename or move', disabled: !canUndo, run: undo },
      { label: 'Find duplicates…', disabled: !status.count, run: findDuplicates },
      { label: 'Picture editors (Open in)', sub: () => openInMenu([]).filter((x) => x === '-' || (x.label && (x.label.startsWith('Add') || x.label.startsWith('Remove')))) },
      { label: 'Folders', disabled: !status.folders.length, sub: () => status.folders.map((f) => ({ label: `${f.path} (${f.count})`, sub: [{ label: 'Remove from NoorGallery…', run: () => removeFolder(f) }] })) },
      '-',
      { label: 'Save these pictures as a slideshow…', disabled: !items.length, run: () => saveSlideshow(sel.size ? [...sel] : items.map((i) => i.id)) },
      ...(showing ? [
        { label: `Slideshow settings for “${showing.name}”…`, run: () => slideshowSetup(showing) },
        { label: 'Rename slideshow…', run: () => renameSlideshow(showing) },
        { label: 'Delete slideshow…', run: () => deleteSlideshow(showing) },
      ] : []),
    ]);
  }

  async function addFolder() {
    try {
      const r = await req('gallery.addFolder');
      if (!r || r.cancelled) return;
      status = r;
      if (!view.source || view.source === 'all') renderSources();
      renderSources();
      await load();
      notice(`NoorGallery: ${status.count} picture${status.count === 1 ? '' : 's'}`, 1800);
    } catch (err) { hooks.showError(err); }
  }

  async function removeFolder(f) {
    if (!await NoorUI.confirm('Remove this folder from NoorGallery?', [`“${f.path}” is no longer shown in NoorGallery. The pictures stay where they are.`, 'Favourites and slideshow places of its pictures are forgotten.'], 'Remove')) return;
    try { status = await req('gallery.removeFolder', { id: f.id }); renderSources(); load(); } catch (err) { hooks.showError(err); }
  }

  function renderFormats() {
    const f = $('#gallery-format');
    if (!f) return;
    const list = status.formats || [];
    if (view.format && !list.some((x) => x.format === view.format)) view.format = '';
    f.replaceChildren(el('option', { value: '', text: 'All formats' }), ...list.map((x) => el('option', { value: x.format, text: `${x.format} (${x.count})` })));
    f.value = view.format;
    f.hidden = list.length < 2;
  }

  function renderSources() {
    renderFormats();
    if (!built) return;
    $('#gallery-count').textContent = status.count ? String(status.count) : '';
    const s = $('#gallery-source');
    const tags = status.tags || [];
    const years = yearsOf(status.months || []);
    const known = new Set(['all', 'fav', ...status.albums.map((a) => 'album:' + a.key), ...status.slideshows.map((x) => 'show:' + x.id), ...tags.map((t) => 'tag:' + t.tag),
      ...years.flatMap((y) => ['month:' + y.year, ...y.months.map((m) => 'month:' + m.month)])]);
    if (!known.has(view.source)) view.source = 'all';
    s.replaceChildren(
      el('option', { value: 'all', text: `All pictures (${status.count})` }),
      el('option', { value: 'fav', text: '★ Favourites' }),
      ...(status.albums.length ? [el('optgroup', { label: 'Albums' }, ...status.albums.map((a) => el('option', { value: 'album:' + a.key, text: `${a.name} (${a.count})` })))] : []),
      ...(status.slideshows.length ? [el('optgroup', { label: 'Slideshows' }, ...status.slideshows.map((x) => el('option', { value: 'show:' + x.id, text: `▶ ${x.name} (${x.count})` })))] : []),
      ...(tags.length ? [el('optgroup', { label: 'Tags' }, ...tags.map((t) => el('option', { value: 'tag:' + t.tag, text: `# ${t.tag} (${t.count})` })))] : []),
      ...(years.length ? [el('optgroup', { label: 'By date' }, ...years.flatMap((y) => [el('option', { value: 'month:' + y.year, text: `${y.year} (${y.count})` }),
        ...y.months.map((m) => el('option', { value: 'month:' + m.month, text: `\u2003${monthName(m.month)} (${m.count})` }))]))] : []));
    s.value = view.source;
    const mk = $('#gallery-mark');
    if (mk) mk.value = view.mark;
    $('#gallery-sort').value = view.sort;
    $('#gallery-sort').disabled = view.source.startsWith('show:'); // a slideshow keeps its own order
  }

  async function load() {
    if (!built) return;
    const gen = ++loadGen;
    const [sort, descending] = SORTS[view.sort] || SORTS['taken-desc'];
    const q = { search: view.search || null, sort, descending, filter: view.source === 'fav' ? 'favorites' : 'all', format: view.format || null };
    if (view.mark.startsWith('r')) q.minRating = Number(view.mark.slice(1));
    if (view.mark.startsWith('l:')) q.label = view.mark.slice(2);
    if (view.source.startsWith('tag:')) q.tag = view.source.slice(4);
    if (view.source.startsWith('month:')) q.month = view.source.slice(6);
    if (view.source.startsWith('album:')) q.album = view.source.slice(6);
    if (view.source.startsWith('dir:')) q.folder = view.source.slice(4);
    if (view.source.startsWith('show:')) q.slideshow = Number(view.source.slice(5));
    let rows;
    if (view.source.startsWith('library:')) rows = []; // a group with no folder of its own: only its albums show
    else try { rows = await req('gallery.query', q); } catch (err) { hooks.showError(err); return; }
    if (gen !== loadGen) return;
    items = rows;
    shown = PAGE;
    for (const id of [...sel]) if (!items.some((i) => i.id === id)) sel.delete(id);
    renderSources();
    render();
  }

  function render() {
    renderNav();
    renderInfo();
    const body = $('#gallery-body');
    if (!status.folders.length) {
      body.replaceChildren(el('div', { class: 'vb-empty' }, el('h2', { text: 'Your pictures in one place' }),
        el('p', { text: 'Add a folder with pictures. Its subfolders become albums. NoorMD only reads them: nothing is moved or changed.' }),
        el('div', { class: 'modal-buttons' }, el('button', { class: 'action primary', onclick: addFolder }, '＋ Add a picture folder…'))));
      return;
    }
    // An album or a folder: where it is, and its sub-albums as folders before its own pictures (not while searching or filtering).
    const node = placeNode();
    const subs = node && !view.search && !view.format && !view.mark ? [...node.kids.values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
    const top = node ? [crumbs(node)] : [];
    if (!items.length && subs.length) {
      body.replaceChildren(...top, el('div', { class: 'gallery-grid gallery-folders-only', role: 'list', 'aria-label': 'Albums' }, ...subs.map(folderTile)), el('p', { class: 'gallery-foot', id: 'gallery-foot', text: footText() }));
      return;
    }
    if (!items.length) {
      body.replaceChildren(...top, el('p', { class: 'music-none', text: view.search ? 'Nothing matches.' : view.source === 'fav' ? 'No favourites yet. Press F on a picture (or right-click › Favourite).' : view.mark ? 'No pictures with those stars or that label here.' : 'No pictures here.' }));
      return;
    }
    const grid = el('div', { class: 'gallery-grid', role: 'listbox', 'aria-label': 'Pictures', 'aria-multiselectable': 'true' });
    subs.forEach((k) => grid.append(folderTile(k)));
    items.slice(0, shown).forEach((it, i) => grid.append(tile(it, i)));
    // Keys keep working after a change (stars, label, favourite): the same picture keeps the focus.
    const focused = document.activeElement?.closest?.('#gallery-body .gallery-tile')?.dataset.id;
    if (focused) queueMicrotask(() => grid.querySelector(`.gallery-tile[data-id="${focused}"]`)?.focus({ preventScroll: true }));
    body.replaceChildren(...top, grid,
      ...(items.length > shown ? [el('button', { class: 'action gallery-show-more', onclick: () => { shown += PAGE; render(); } }, `Show more (${items.length - shown} left)`)] : []),
      el('p', { class: 'gallery-foot', id: 'gallery-foot', text: footText() }));
  }

  function footText() {
    const own = `${items.length} picture${items.length === 1 ? '' : 's'}`, node = placeNode();
    const subs = node && !view.search && !view.format && !view.mark ? node.kids.size : 0;
    const text = subs ? `${subs} album${subs === 1 ? '' : 's'} · ${own} (${node.total} in all)` : own;
    return text + (sel.size ? ` · ${sel.size} selected` : '');
  }

  function tile(it, i) {
    const b = el('button', {
      class: 'gallery-tile' + (sel.has(it.id) ? ' selected' : '') + (it.favorite ? ' fav' : ''), role: 'option', 'aria-selected': String(sel.has(it.id)),
      'data-id': String(it.id), 'data-index': String(i), title: `${it.name}\n${it.album} · ${dateText(it.taken)}${it.rating ? '\n' + '★'.repeat(it.rating) : ''}${it.tags && it.tags.length ? '\n# ' + it.tags.join(', ') : ''}`, draggable: 'true',
      onclick: (e) => onTileClick(e, i),
      ondblclick: () => openViewer(i),
      oncontextmenu: (e) => { e.preventDefault(); if (!sel.has(it.id)) { sel.clear(); sel.add(it.id); anchor = i; markSelection(); } tileMenu(it, i, e.clientX, e.clientY); },
    }, el('img', { src: thumbUrl(it.id), alt: it.name, loading: 'lazy', decoding: 'async', draggable: 'false',
      // No preview (a work file whose program isn't installed): its format and name instead.
      onerror: (e) => { e.target.replaceWith(el('span', { class: 'gallery-nothumb' }, el('b', { text: it.format || '?' }), el('small', { text: it.name }))); } }),
    ...(it.web === false ? [el('span', { class: 'gallery-fmt', 'aria-hidden': 'true', text: it.format })] : []),
    el('span', { class: 'gallery-star', 'aria-hidden': 'true', text: '★' }),
    ...(it.rating ? [el('span', { class: 'gallery-rating', 'aria-hidden': 'true', text: '★'.repeat(it.rating) })] : []),
    ...(it.label ? [el('span', { class: 'gallery-label', 'data-label': it.label, 'aria-hidden': 'true' })] : []));
    b.addEventListener('dragstart', (e) => {
      // Dragging carries the selected pictures (or this one) to an album on the left, or to a new place in a slideshow.
      const ids = sel.has(it.id) ? items.filter((x) => sel.has(x.id)).map((x) => x.id) : [it.id];
      e.dataTransfer.setData('text/x-noormd-gallery', String(it.id));
      e.dataTransfer.setData('text/x-noormd-gallery-ids', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
      b.classList.add('dragging');
    });
    b.addEventListener('dragend', () => b.classList.remove('dragging'));
    if (view.source.startsWith('show:')) wireReorder(b, it);
    return b;
  }

  function onTileClick(e, i) {
    const id = items[i].id;
    if (e.ctrlKey || e.metaKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); anchor = i; markSelection(); return; }
    if (e.shiftKey && anchor >= 0) { sel.clear(); const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; for (let k = a; k <= b; k++) sel.add(items[k].id); markSelection(); return; }
    sel.clear(); anchor = i; sel.add(id); markSelection();
    // As a picture manager a click selects (details on the right); double-click or Enter opens it. In a narrow panel a click opens it.
    if (!isWide()) { sel.clear(); markSelection(); openViewer(i); }
  }

  const isWide = () => !!$('#gallery')?.classList.contains('wide');

  function markSelection() {
    document.querySelectorAll('#gallery-body .gallery-tile').forEach((t) => { const on = sel.has(Number(t.dataset.id)); t.classList.toggle('selected', on); t.setAttribute('aria-selected', String(on)); });
    const f = $('#gallery-foot'); if (f) f.textContent = footText();
    renderInfo();
  }

  function onPanelKeys(e) {
    if (e.target.closest('input, select')) { if (e.key === 'Escape' && e.target.id === 'gallery-search' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; view.search = ''; load(); } return; }
    const tileEl = e.target.closest('.gallery-tile');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key.toLowerCase() === 'z' && e.ctrlKey && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (!tileEl) return;
    const i = Number(tileEl.dataset.index);
    const cols = Math.max(1, Math.round($('#gallery-body .gallery-grid').clientWidth / tileEl.offsetWidth));
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (move) { e.preventDefault(); const n = Math.max(0, Math.min(Math.min(items.length, shown) - 1, i + move)); document.querySelector(`#gallery-body .gallery-tile[data-index="${n}"]`)?.focus(); return; }
    if (e.key === 'Enter') { e.preventDefault(); openViewer(i); return; }
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey) { e.preventDefault(); setFavorite(sel.size ? [...sel] : [items[i].id], !items[i].favorite); }
    if (e.key === 'a' && e.ctrlKey) { e.preventDefault(); items.slice(0, shown).forEach((x) => sel.add(x.id)); markSelection(); }
    const ids = sel.size ? [...sel] : [items[i].id];
    if (e.key === 'F2') { e.preventDefault(); if (ids.length > 1) renameSeries(ids); else renamePicture(items.find((x) => x.id === ids[0])); }
    if (e.key === 'Delete') { e.preventDefault(); deletePictures(ids); }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && /^[0-9]$/.test(e.key)) { e.preventDefault(); markKey(ids, Number(e.key)); }
    if (e.key.toLowerCase() === 'r' && e.ctrlKey && !e.altKey) { e.preventDefault(); rotate(ids, !e.shiftKey); }
    if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.altKey) { e.preventDefault(); addTags(ids); }
  }

  // ---------------------------------------------------------------- stars, colour labels, tags, turning

  /** 0–5 sets the stars; 6–9 a colour label (the same label again takes it off). */
  function markKey(ids, n) {
    if (n <= 5) { setRating(ids, n); return; }
    const label = LABEL_KEYS[n];
    const same = ids.every((id) => items.find((x) => x.id === id)?.label === label);
    setLabel(ids, same ? null : label);
  }

  const update = (ids, fn) => { for (const list of [items, viewer.list]) for (const it of list) if (ids.includes(it.id)) fn(it); };

  async function setRating(ids, stars) {
    try {
      await req('gallery.rating', { ids, stars });
      update(ids, (it) => { it.rating = stars; });
      if (view.mark.startsWith('r') && stars < Number(view.mark.slice(1))) await load(); else render();
      if (viewer.open) renderViewerMarks();
      notice(stars ? '★'.repeat(stars) : 'No stars', 900);
    } catch (err) { hooks.showError(err); }
  }

  async function setLabel(ids, label) {
    try {
      await req('gallery.label', { ids, label });
      update(ids, (it) => { it.label = label; });
      if (view.mark.startsWith('l:') && label !== view.mark.slice(2)) await load(); else render();
      if (viewer.open) renderViewerMarks();
      notice(label ? `● ${LABELS[label][0]}` : 'No colour label', 900);
    } catch (err) { hooks.showError(err); }
  }

  function afterTags(r) {
    if (r.status) status = r.status;
    const byId = new Map((r.images || []).map((x) => [x.id, x]));
    update([...byId.keys()], (it) => { it.tags = byId.get(it.id).tags; });
    renderSources();
    if (view.source.startsWith('tag:') && !status.tags.some((t) => 'tag:' + t.tag === view.source)) { view.source = 'all'; load(); return; }
    if (view.source.startsWith('tag:')) load(); else render();
  }

  async function addTags(ids, text) {
    const known = (status.tags || []).map((t) => t.tag);
    const v = text ?? await NoorUI.prompt('Add tags', `Tags for ${ids.length === 1 ? 'this picture' : `the ${ids.length} pictures`} (separate several with commas):${known.length ? `\nIn use: ${known.slice(0, 12).join(', ')}${known.length > 12 ? '…' : ''}` : ''}`, '', { okLabel: 'Add' });
    const tags = (v || '').split(',').map((x) => x.trim().replace(/^#/, '').trim()).filter(Boolean);
    if (!tags.length) return;
    try { afterTags(await req('gallery.tags.add', { ids, tags })); notice(`Tagged: ${tags.join(', ')}`, 1400); } catch (err) { hooks.showError(err); }
  }

  async function removeTag(ids, tag) {
    try { afterTags(await req('gallery.tags.remove', { ids, tag })); } catch (err) { hooks.showError(err); }
  }

  async function rotate(ids, clockwise) {
    try {
      const r = await req('gallery.rotate', { ids, clockwise });
      const byId = new Map((r.images || []).map((x) => [x.id, x]));
      const stamp = Date.now();
      for (const id of byId.keys()) turned.set(id, stamp);
      update([...byId.keys()], (it) => { const n = byId.get(it.id); it.width = n.width; it.height = n.height; it.size = n.size; });
      render();
      if (viewer.open && byId.has(viewer.list[viewer.index]?.id)) renderViewer();
      if (r.refused && r.refused.length) notice(`Turned ${byId.size}; not turned: ${r.refused.join('; ')}`, 4000);
    } catch (err) { hooks.showError(err); }
  }

  function markMenu(ids, it) {
    return [
      { label: 'Stars', sub: () => [0, 1, 2, 3, 4, 5].map((n) => ({ label: n ? `${'★'.repeat(n)}  (${n})` : 'No stars  (0)', checked: !!it && ids.length === 1 && (it.rating || 0) === n, run: () => setRating(ids, n) })) },
      { label: 'Colour label', sub: () => [
        ...Object.entries(LABELS).map(([k, v]) => ({ label: `● ${v[0]}${v[1] ? `  (${v[1]})` : ''}`, checked: !!it && ids.length === 1 && it.label === k, run: () => setLabel(ids, k) })),
        '-', { label: 'No label', run: () => setLabel(ids, null) }] },
      { label: 'Add tags…  (T)', run: () => addTags(ids) },
      ...(it && ids.length === 1 && it.tags && it.tags.length ? [{ label: 'Remove a tag', sub: () => it.tags.map((t) => ({ label: '# ' + t, run: () => removeTag(ids, t) })) }] : []),
      { label: 'Turn right  (Ctrl+R)', run: () => rotate(ids, true) },
      { label: 'Turn left  (Ctrl+Shift+R)', run: () => rotate(ids, false) },
    ];
  }

  function marksEditor(chosen) {
    const ids = chosen.map((x) => x.id);
    const one = chosen.length === 1 ? chosen[0] : null;
    const stars = one ? one.rating || 0 : (chosen.every((x) => x.rating === chosen[0].rating) ? chosen[0].rating || 0 : -1);
    const label = chosen.every((x) => x.label === chosen[0].label) ? chosen[0].label : undefined;
    const tagSet = [...new Set(chosen.flatMap((x) => x.tags || []))].sort((a, b) => a.localeCompare(b));
    const input = el('input', { type: 'text', id: 'ginfo-tag', placeholder: '＋ tag', 'aria-label': 'Add a tag', list: 'ginfo-tags-known', spellcheck: 'false' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); const v = input.value; input.value = ''; addTags(ids, v).then(() => $('#ginfo-tag')?.focus()); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.value = ''; }
    });
    return el('div', { class: 'ginfo-marks' },
      el('div', { class: 'ginfo-stars', role: 'radiogroup', 'aria-label': 'Stars' }, ...[1, 2, 3, 4, 5].map((n) => el('button', {
        class: 'ginfo-starbtn' + (stars >= n ? ' on' : ''), role: 'radio', 'aria-checked': String(stars === n), 'aria-label': `${n} star${n > 1 ? 's' : ''}`, title: `${n} (key ${n}); click again for none`,
        onclick: () => setRating(ids, stars === n ? 0 : n) }, '★'))),
      el('div', { class: 'ginfo-labels', role: 'radiogroup', 'aria-label': 'Colour label' }, ...Object.entries(LABELS).map(([k, v]) => el('button', {
        class: 'ginfo-labelbtn' + (label === k ? ' on' : ''), 'data-label': k, role: 'radio', 'aria-checked': String(label === k), 'aria-label': v[0], title: v[0] + (v[1] ? ` (key ${v[1]})` : '') + '; click again for none',
        onclick: () => setLabel(ids, label === k ? null : k) }))),
      el('div', { class: 'ginfo-tags' },
        ...tagSet.map((t) => el('span', { class: 'ginfo-tagchip' }, el('button', { class: 'ginfo-tagname', title: 'Show pictures with this tag', onclick: () => { view.source = 'tag:' + t; sel.clear(); load(); } }, '# ' + t),
          el('button', { class: 'ginfo-tagx', 'aria-label': `Remove the tag ${t}`, title: 'Remove', onclick: () => removeTag(ids, t) }, '×'))),
        input, el('datalist', { id: 'ginfo-tags-known' }, ...(status.tags || []).map((t) => el('option', { value: t.tag })))),
      el('div', { class: 'ginfo-turn' },
        el('button', { class: 'utility-btn', id: 'ginfo-rotl', title: 'Turn left (Ctrl+Shift+R)', onclick: () => rotate(ids, false) }, '⟲ Turn left'),
        el('button', { class: 'utility-btn', id: 'ginfo-rotr', title: 'Turn right (Ctrl+R): JPEG photos only change their orientation, PNG keeps every pixel', onclick: () => rotate(ids, true) }, '⟳ Turn right')));
  }

  async function tileMenu(it, i, x, y) {
    if (!places) await loadPlaces();
    const ids = sel.size ? [...sel] : [it.id];
    const many = ids.length > 1;
    const showing = view.source.startsWith('show:') ? Number(view.source.slice(5)) : null;
    NoorChrome.openMenu(null, [
      { label: 'View', run: () => openViewer(i) },
      { label: many ? `Slideshow of the ${ids.length} selected` : 'Slideshow from here', run: () => slideshowSetup(null, many ? ids : null, many ? 0 : i) },
      '-',
      { label: 'Put into the note', disabled: many, run: () => insert(it) },
      { label: it.favorite && !many ? 'Not a favourite' : 'Favourite', run: () => setFavorite(ids, !(it.favorite && !many)) },
      ...markMenu(ids, many ? null : it),
      { label: 'Add to slideshow', sub: () => [
        ...status.slideshows.filter((s) => s.id !== showing).map((s) => ({ label: s.name, run: () => addToSlideshow(s, ids) })),
        ...(status.slideshows.length ? ['-'] : []),
        { label: 'New slideshow…', run: () => saveSlideshow(ids) },
      ] },
      ...(showing ? [{ label: 'Remove from this slideshow', run: () => removeFromSlideshow(showing, ids) }] : []),
      '-',
      many ? { label: `Rename as a numbered series…`, run: () => renameSeries(ids) } : { label: 'Rename…  (F2)', run: () => renamePicture(it) },
      { label: 'Open in', sub: () => openInMenu(ids) },
      { label: 'Move to album', sub: () => moveMenu(ids) },
      { label: 'Move to a folder…', run: () => copyOrMove(ids, false) },
      { label: 'Copy to a folder…', run: () => copyOrMove(ids, true) },
      { label: many ? `Convert or resize ${ids.length}…` : 'Convert or resize…', run: () => convertPictures(ids) },
      { label: many ? `Pack ${ids.length} into a ZIP…` : 'Pack into a ZIP…', run: () => packZip(ids) },
      { label: 'Show in Explorer', disabled: many, run: () => req('gallery.reveal', { id: it.id }).catch(hooks.showError) },
      '-',
      { label: many ? `Delete ${ids.length} pictures…` : 'Delete…  (Del)', run: () => deletePictures(ids) },
    ], { x, y });
  }

  // ---------------------------------------------------------------- open in an editor, copy/move anywhere, ZIP

  /** Pictures into NoorMaterial: a new material from them, or added over the one being made. */
  async function toTexture(ids, mode) {
    try {
      const r = await req('gallery.toTexture', { ids, many: mode === 'batch' });
      if (r.skipped && r.skipped.length) notice(`Can't be read as a texture: ${r.skipped.join(', ')}`, 3000);
      if (r.pictures.length) { if (mode === 'batch') await NoorTexture.batchPictures(r.pictures); else await NoorTexture.fromPictures(r.pictures, mode); }
    } catch (err) { hooks.showError(err); }
  }

  function textureMenu(ids) {
    const many = ids.length > 1;
    const has = window.NoorTexture && NoorTexture.hasMaterial();
    return [
      { label: many ? `New material from these ${ids.length} (as photo layers)` : 'New material from this picture', run: () => toTexture(ids, 'new') },
      { label: many ? 'Add them over the current material' : 'Add it over the current material', disabled: !has, run: () => toTexture(ids, 'add') },
      '-',
      { label: many ? `Make PBR maps for each of the ${ids.length} (batch)…` : 'Make PBR maps from it (batch)…', run: () => toTexture(ids, 'batch') },
    ];
  }

  function openInMenu(ids) {
    const eds = status.editors || [];
    return [
      { label: '🧱 NoorMaterial', sub: () => textureMenu(ids) },
      { label: ids.length > 1 ? `🖼️ NoorPhoto (${Math.min(ids.length, 8)} pictures)` : '🖼️ NoorPhoto', disabled: !window.NoorPhoto, run: () => NoorPhoto.openFromGallery(ids) },
      { label: '👾 NoorSprite', disabled: ids.length !== 1 || !window.NoorSprite, run: () => req('gallery.toSprite', { ids }).then((r) => NoorSprite.openFrom(r)).catch(hooks.showError) },
      '-',
      ...eds.map((e, i) => ({ label: e.name, run: () => req('gallery.openWith', { ids, how: 'editor', editor: i }).catch(hooks.showError) })),
      ...(eds.length ? ['-'] : []),
      { label: 'The default program', run: () => req('gallery.openWith', { ids, how: 'default' }).catch(hooks.showError) },
      { label: 'Choose in Windows (Open with)…', disabled: ids.length > 1, run: () => req('gallery.openWith', { ids, how: 'choose' }).catch(hooks.showError) },
      '-',
      { label: 'Add a program (Affinity Photo, Photoshop…)…', run: addEditor },
      ...eds.filter((e) => !e.detected).length ? [{ label: 'Remove a program', sub: () => eds.map((e, i) => (e.detected ? null : { label: e.name, run: () => removeEditor(i) })).filter(Boolean) }] : [],
    ];
  }

  async function addEditor() {
    try { const r = await req('gallery.editor.add'); if (r && r.editors) { status.editors = r.editors; notice('Added. Right-click pictures › Open in to use it.', 2200); } } catch (err) { hooks.showError(err); }
  }

  async function removeEditor(i) {
    try { const r = await req('gallery.editor.remove', { index: i }); status.editors = r.editors; } catch (err) { hooks.showError(err); }
  }

  async function copyOrMove(ids, copy) {
    try {
      const r = await req(copy ? 'gallery.copyTo' : 'gallery.moveTo', { ids });
      if (!r || r.cancelled) return;
      if (!copy) sel.clear();
      await afterChange(r, `${copy ? 'Copied' : 'Moved'} ${r.count} picture${r.count === 1 ? '' : 's'} to ${r.folder}${!copy && !r.inside ? ' (outside NoorGallery folders, so they left NoorGallery)' : ''}`);
    } catch (err) { hooks.showError(err); }
  }

  async function packZip(ids) {
    const album = view.source.startsWith('album:') ? status.albums.find((a) => 'album:' + a.key === view.source) : null;
    try {
      const r = await req('gallery.zip', { ids, name: album ? album.name.split('/').pop() : 'Pictures' });
      if (r && !r.cancelled) notice(`Packed ${r.count} picture${r.count === 1 ? '' : 's'} into ${r.path}`, 3500);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- albums: rename, new inside, Explorer

  function albumMenu(a, x, y) {
    NoorChrome.openMenu(null, [
      { label: 'Look for new pictures here', run: () => rescanHere(a.folder) }, '-',
      { label: 'Rename album…  (F2)', run: () => renameAlbum(a) },
      { label: 'New album inside…', run: () => newAlbum(null, a.folder) },
      { label: 'Slideshow of this album', run: async () => { view.source = 'album:' + a.key; await load(); slideshowSetup(); } },
      { label: 'Pack the album into a ZIP…', run: async () => { const list = await req('gallery.query', { album: a.key, sort: 'name', descending: false }); packZip(list.map((i) => i.id)); } },
      { label: 'Show in Explorer', run: () => req('gallery.revealFolder', { folder: a.folder }).catch(hooks.showError) },
    ], { x, y });
  }

  async function renameAlbum(a) {
    const old = a.name.split('/').pop();
    const name = await NoorUI.prompt('Rename album', `New name for the folder “${old}” (its pictures stay in it):`, old, { okLabel: 'Rename' });
    if (!name || !name.trim() || name.trim() === old) return;
    try {
      const r = await req('gallery.album.rename', { folder: a.folder, name });
      if (view.source === 'album:' + a.key) view.source = 'album:' + r.key;
      await afterChange(r, `Album renamed to “${name.trim()}”`);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- duplicates

  let onDupProgress = null;
  let onConvertProgress = null;

  // ---------------------------------------------------------------- convert / resize (copies; the originals stay)

  const CONVERT_SIZES = [[0, 'As they are'], [3840, '3840 px (4K)'], [2560, '2560 px'], [1920, '1920 px (Full HD)'], [1280, '1280 px'], [1024, '1024 px'], [800, '800 px'], [-1, 'Other…']];
  function convertSettings() { try { return { format: 'jpg', maxSide: 1920, quality: 88, suffix: '', where: 'choose', ...JSON.parse(localStorage.getItem('noormd.convert') || '{}') }; } catch { return { format: 'jpg', maxSide: 1920, quality: 88, suffix: '', where: 'choose' }; } }

  function convertPictures(ids) {
    if (!ids.length) return;
    const st = convertSettings();
    NoorUI.modal({ label: 'Convert or resize pictures', width: 520 }, (s, closeModal) => {
      const format = el('select', { id: 'cv-format', 'aria-label': 'Format' },
        el('option', { value: 'keep', text: 'Same as now (JPEG stays JPEG, PNG stays PNG…)' }), el('option', { value: 'jpg', text: 'JPEG (photos, small files)' }), el('option', { value: 'png', text: 'PNG (sharp, keeps see-through parts)' }));
      format.value = st.format;
      const known = CONVERT_SIZES.some(([n]) => n === st.maxSide);
      const size = el('select', { id: 'cv-size', 'aria-label': 'Longest side' }, ...CONVERT_SIZES.map(([n, t]) => el('option', { value: String(n), text: t })));
      size.value = known ? String(st.maxSide) : '-1';
      const custom = el('input', { type: 'number', id: 'cv-custom', min: '16', max: '20000', step: '1', value: String(known || !st.maxSide ? 1600 : st.maxSide), 'aria-label': 'Longest side in pixels' });
      const customRow = el('label', { hidden: size.value !== '-1' }, el('span', { text: 'Pixels' }), custom);
      size.addEventListener('change', () => { customRow.hidden = size.value !== '-1'; if (!customRow.hidden) custom.focus(); });
      const quality = el('input', { type: 'range', id: 'cv-quality', min: '50', max: '100', step: '1', value: String(st.quality), 'aria-label': 'JPEG quality' });
      const qText = el('small', { text: String(st.quality) });
      quality.addEventListener('input', () => { qText.textContent = quality.value; });
      const qRow = el('label', { hidden: format.value === 'png' }, el('span', { text: 'JPEG quality' }), el('span', { class: 'cv-quality' }, quality, qText));
      format.addEventListener('change', () => { qRow.hidden = format.value === 'png'; });
      const suffix = el('input', { type: 'text', id: 'cv-suffix', value: st.suffix, placeholder: 'e.g. -web (optional)', maxlength: '40', spellcheck: 'false', 'aria-label': 'Name ending' });
      const whereChoose = el('input', { type: 'radio', name: 'cv-where', id: 'cv-where-choose', value: 'choose', checked: st.where !== 'beside' || undefined });
      const whereBeside = el('input', { type: 'radio', name: 'cv-where', id: 'cv-where-beside', value: 'beside', checked: st.where === 'beside' || undefined });
      const statusLine = el('p', { class: 'pref-hint', id: 'cv-status', 'aria-live': 'polite', text: 'The originals stay as they are. Nothing is overwritten: a name already there gets (2).' });
      const go = el('button', { class: 'action primary', id: 'cv-go', autofocus: true }, `Convert ${ids.length} picture${ids.length === 1 ? '' : 's'}`);
      const cancel = el('button', { class: 'action', onclick: () => closeModal() }, 'Cancel');
      const read = () => ({ format: format.value, maxSide: size.value === '-1' ? Math.max(16, Number(custom.value) || 0) : Number(size.value), quality: Number(quality.value), suffix: suffix.value, where: whereBeside.checked ? 'beside' : 'choose' });
      let busy = false;
      go.addEventListener('click', async () => {
        if (busy) return;
        const o = read();
        try { localStorage.setItem('noormd.convert', JSON.stringify(o)); } catch { /* private storage off */ }
        busy = true; go.disabled = true;
        statusLine.textContent = o.where === 'choose' ? 'Choose where to save them…' : 'Converting…';
        onConvertProgress = (p) => { if (busy) statusLine.textContent = `Converting… ${p.done} of ${p.total}`; };
        try {
          const r = await req('gallery.convert', { ids, ...o });
          if (!r || r.cancelled) { statusLine.textContent = 'Cancelled. Nothing was made.'; return; }
          if (r.status) { status = r.status; renderSources(); if (r.inside) await load(); }
          statusLine.textContent = `Made ${r.count} picture${r.count === 1 ? '' : 's'}${r.folder ? ` in ${r.folder}` : ' (in a “Converted” folder next to each)'}.`
            + (r.failed && r.failed.length ? ` Not converted (${r.failed.length}): ${r.failed.slice(0, 3).join('; ')}${r.failed.length > 3 ? '…' : ''}` : '');
          go.replaceWith(...(r.folder ? [el('button', { class: 'action', id: 'cv-open', onclick: () => req('gallery.convert.reveal', { folder: r.folder }).catch(hooks.showError) }, '📁 Open the folder')] : []),
            el('button', { class: 'action primary', id: 'cv-done', onclick: () => closeModal() }, 'Done'));
          cancel.remove();
          $('#cv-done')?.focus();
        } catch (err) { statusLine.textContent = String(err && err.message ? err.message : err); } finally { busy = false; go.disabled = false; onConvertProgress = null; }
      });
      s.append(NoorUI.head(`⇲ Convert or resize · ${ids.length} picture${ids.length === 1 ? '' : 's'}`, closeModal),
        el('div', { class: 'modal-body apps-form' },
          el('label', {}, el('span', { text: 'Format' }), format),
          el('label', {}, el('span', { text: 'Longest side' }), size),
          customRow, qRow,
          el('label', {}, el('span', { text: 'Name ending' }), suffix),
          el('div', { class: 'cv-where', role: 'radiogroup', 'aria-label': 'Where' },
            el('label', {}, whereChoose, el('span', { text: 'In a folder I choose' })),
            el('label', {}, whereBeside, el('span', { text: 'Next to each picture, in a “Converted” folder' }))),
          el('p', { class: 'pref-hint', text: 'Smaller pictures are never made bigger. Photos are turned the way they were taken. JPEG keeps the date taken but not the camera details or the location.' }),
          statusLine),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' }, cancel, go)));
    });
  }

  async function findDuplicates() {
    const album = view.source.startsWith('album:') ? status.albums.find((a) => 'album:' + a.key === view.source) : null;
    let groups = null;
    const marked = new Set();
    let busy = false;
    NoorUI.modal({ label: 'Find duplicates', width: 980 }, (s, closeModal) => {
      const similar = el('input', { type: 'checkbox', id: 'dup-similar' });
      const statusLine = el('span', { class: 'dup-status', id: 'dup-status', text: '' });
      const body = el('div', { class: 'modal-body dup-body', id: 'dup-body' });
      const del = el('button', { class: 'action danger', id: 'dup-delete', disabled: true, onclick: async () => {
        const ids = [...marked];
        try {
          const r = await req('gallery.delete', { ids });
          if (!r || r.cancelled || !r.deleted) return;
          for (const g of groups) g.items = g.items.filter((i) => !ids.includes(i.id));
          groups = groups.filter((g) => g.items.length > 1);
          marked.clear();
          status = r.status; renderSources(); load();
          draw();
          notice(`Deleted ${r.deleted} picture${r.deleted === 1 ? '' : 's'} (in the Recycle Bin)`, 2400);
        } catch (err) { hooks.showError(err); }
      } }, 'Delete marked');
      const keep = (how) => {
        marked.clear();
        for (const g of groups) {
          const sorted = [...g.items].sort(how === 'newest' ? (a, b) => String(b.taken).localeCompare(String(a.taken)) : how === 'oldest' ? (a, b) => String(a.taken).localeCompare(String(b.taken)) : (a, b) => (b.width * b.height - a.width * a.height) || (b.size - a.size));
          sorted.slice(1).forEach((i) => marked.add(i.id));
        }
        draw();
      };
      const draw = () => {
        del.disabled = !marked.size;
        del.textContent = marked.size ? `Delete ${marked.size} marked` : 'Delete marked';
        if (!groups) return;
        if (!groups.length) { body.replaceChildren(el('p', { class: 'music-none', text: 'No duplicates found. 🎉' })); return; }
        body.replaceChildren(...groups.map((g, gi) => el('section', { class: 'dup-group' },
          el('h4', { text: `${g.kind === 'same' ? 'Same file' : 'Look alike'} · ${g.items.length} pictures` }),
          el('div', { class: 'dup-row' }, ...g.items.map((i) => el('button', {
            class: 'dup-item' + (marked.has(i.id) ? ' marked' : ''), 'data-id': String(i.id), title: `${i.folder}\\${i.fileName}`,
            onclick: () => { if (marked.has(i.id)) marked.delete(i.id); else if (g.items.filter((x) => !marked.has(x.id)).length > 1) marked.add(i.id); else notice('Keep at least one of each group.', 1600); draw(); },
          }, el('img', { src: thumbUrl(i.id), alt: '', loading: 'lazy' }),
          el('span', { class: 'dup-mark', text: marked.has(i.id) ? 'Delete' : 'Keep' }),
          el('small', { text: `${i.album} · ${i.width ? i.width + '×' + i.height + ' · ' : ''}${sizeText(i.size)}` }),
          el('small', { class: 'dup-name', text: i.fileName })))))));
      };
      const run = async () => {
        if (busy) return;
        busy = true; groups = null; marked.clear();
        body.replaceChildren(el('p', { class: 'music-none', text: 'Looking…' }));
        try { groups = await req('gallery.duplicates', { similar: similar.checked, album: album ? album.key : null }); keep('largest'); statusLine.textContent = groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'}: the biggest of each is kept, the rest marked. Click a picture to change it.` : ''; }
        catch (err) { hooks.showError(err); body.replaceChildren(); }
        finally { busy = false; }
      };
      onDupProgress = (p) => { if (busy) statusLine.textContent = `Checked ${p.done} of ${p.total}…`; };
      const off = () => { onDupProgress = null; };
      s.append(NoorUI.head(`⧉ Find duplicates ${album ? 'in ' + album.name : 'in NoorGallery'}`, () => { if (typeof off === 'function') off(); closeModal(); }),
        el('div', { class: 'dup-toolbar' },
          el('button', { class: 'action primary', id: 'dup-run', onclick: run }, 'Look for duplicates'),
          el('label', { class: 'check' }, similar, ' Also look-alikes (resized or re-saved; slower)'),
          el('span', { class: 'sd-spacer' }),
          el('button', { class: 'utility-btn', onclick: () => groups && keep('largest') }, 'Keep the biggest'),
          el('button', { class: 'utility-btn', onclick: () => groups && keep('newest') }, 'Keep the newest'),
          el('button', { class: 'utility-btn', onclick: () => groups && keep('oldest') }, 'Keep the oldest')),
        statusLine, body,
        el('div', { class: 'modal-foot' }, el('span', { class: 'pref-hint', text: 'Marked pictures go to the Recycle Bin after one more question.' }),
          el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => { if (typeof off === 'function') off(); closeModal(); } }, 'Close'), del)));
      run();
    });
  }

  // ---------------------------------------------------------------- organizing (rename, move, albums, delete, undo)

  let canUndo = false;
  let places = null;

  async function loadPlaces() {
    try { places = await req('gallery.places'); } catch (err) { hooks.showError(err); places = []; }
    return places;
  }

  async function afterChange(r, message) {
    if (r && r.status) status = r.status;
    canUndo = !!(r && r.undo);
    places = null;
    renderSources();
    await load();
    if (message) notice(message + (canUndo ? ' · Ctrl+Z puts it back' : ''), 2400);
  }

  async function renamePicture(it) {
    if (!it) return;
    const name = await NoorUI.prompt('Rename picture', 'New name (the file is renamed, the extension stays):', it.name, { okLabel: 'Rename' });
    if (!name || !name.trim() || name.trim() === it.name) return;
    try { await afterChange(await req('gallery.rename', { id: it.id, name }), 'Renamed'); } catch (err) { hooks.showError(err); }
  }

  async function renameSeries(ids) {
    const ordered = items.filter((x) => ids.includes(x.id)).map((x) => x.id); // in the order shown
    const first = items.find((x) => x.id === ordered[0]);
    const name = await NoorUI.prompt('Rename as a series', `${ordered.length} pictures get this name and a number, in the order shown (for example “${(first && first.album) || 'Wakacje'} 01”):`, (first && first.album.split('/').pop()) || '', { okLabel: 'Rename' });
    if (!name || !name.trim()) return;
    try { await afterChange(await req('gallery.renameSeries', { ids: ordered, name }), `Renamed ${ordered.length} pictures`); } catch (err) { hooks.showError(err); }
  }

  /** The "Move to album" items (load the album list first with loadPlaces). */
  function moveMenu(ids) {
    const list = places || [];
    const here = new Set(items.filter((x) => ids.includes(x.id)).map((x) => x.albumKey));
    return [
      ...list.slice(0, 60).map((pl) => ({ label: pl.label, disabled: here.size === 1 && here.has(pl.key), run: () => movePictures(ids, pl.path, pl.label) })),
      ...(list.length > 60 ? [{ label: `More albums… (${list.length})`, run: () => pickPlace(ids) }] : []),
      '-',
      { label: 'New album…', run: () => newAlbum(ids) },
      { label: 'Another folder on disk…', run: () => copyOrMove(ids, false) },
    ];
  }

  async function pickPlace(ids) {
    const list = places || await loadPlaces();
    const choice = await NoorUI.choose('Move to album', ['Choose where the pictures go.'], [{ label: 'Cancel', value: null }, ...list.slice(0, 200).map((pl) => ({ label: pl.label, value: pl.path }))]);
    if (choice) movePictures(ids, choice, list.find((x) => x.path === choice)?.label);
  }

  async function movePictures(ids, folder, label) {
    try { const r = await req('gallery.move', { ids, folder }); sel.clear(); await afterChange(r, `Moved ${r.moved} picture${r.moved === 1 ? '' : 's'} to ${label || 'the album'}`); } catch (err) { hooks.showError(err); }
  }

  /** A new album inside the Gallery folder of the current album (or the first Gallery folder); the pictures move there if given. */
  async function newAlbum(ids, inFolder) {
    const list = places || await loadPlaces();
    const album = view.source.startsWith('album:') ? status.albums.find((a) => 'album:' + a.key === view.source) : null;
    const parent = inFolder || (album && list.find((pl) => pl.key === album.key)?.path) || (status.folders[0] && status.folders[0].path);
    if (!parent) { notice('Add a picture folder first.', 2000); return; }
    const name = await NoorUI.prompt('New album', `A new folder in “${list.find((pl) => pl.path === parent)?.label || parent}”:`, '', { okLabel: 'Create' });
    if (!name || !name.trim()) return;
    try {
      const made = await req('gallery.album.create', { parent, name });
      places = null;
      if (ids && ids.length) await movePictures(ids, made.path, name.trim());
      else notice(`Album “${name.trim()}” made. Drag pictures onto it to move them there.`, 2600);
      renderNav();
    } catch (err) { hooks.showError(err); }
  }

  async function deletePictures(ids) {
    try {
      const r = await req('gallery.delete', { ids });
      if (!r || r.cancelled || !r.deleted) return;
      sel.clear();
      await afterChange(r, `Deleted ${r.deleted} picture${r.deleted === 1 ? '' : 's'} (in the Recycle Bin)`);
      canUndo = false;
    } catch (err) { hooks.showError(err); }
  }

  async function undo() {
    if (!canUndo) { notice('Nothing to undo here.', 1400); return; }
    try { const r = await req('gallery.undo'); canUndo = false; await afterChange(r, `Put ${r.restored} picture${r.restored === 1 ? '' : 's'} back`); canUndo = false; } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- the manager's albums list and details

  function renderNav() {
    const nav = $('#gallery-nav');
    if (!nav || !isWide()) { if (nav) nav.replaceChildren(); return; }
    const item = (source, label, count, extra = {}) => {
      const b = el('button', { class: 'gnav-item' + (view.source === source ? ' active' : '') + (extra.node && !extra.album && !extra.library ? ' gnav-group' : '') + (extra.library ? ' gnav-library' : ''), 'data-source': source, title: extra.title || label, style: extra.depth ? `padding-left:${10 + Math.min(extra.depth, 5) * 12}px` : null,
        onclick: () => { if (extra.path && extra.hasKids && view.source === source) { toggleFolder(extra.path); return; } if (extra.path && extra.hasKids) navOpen.add(extra.path); goTo(source); } },
      extra.path && extra.hasKids ? el('span', { class: 'gnav-twisty', role: 'button', 'aria-label': navOpen.has(extra.path) ? 'Close' : 'Open', 'aria-expanded': String(navOpen.has(extra.path)), text: navOpen.has(extra.path) ? '▾' : '▸', onclick: (e) => { e.stopPropagation(); toggleFolder(extra.path); } })
        : extra.path ? el('span', { class: 'gnav-twisty', 'aria-hidden': 'true' }) : null,
      el('span', { class: 'gnav-label', text: label }), count != null ? el('small', { text: String(count) }) : null);
      if (extra.album) b.addEventListener('contextmenu', (e) => { e.preventDefault(); albumMenu(extra.album, e.clientX, e.clientY); });
      else if (extra.node && extra.folder) b.addEventListener('contextmenu', (e) => { e.preventDefault(); folderMenu(extra.folder, e.clientX, e.clientY); });
      if (extra.album) {
        b.addEventListener('keydown', (e) => { if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); renameAlbum(extra.album); } });
      }
      if (extra.folder) {
        // Drop pictures here to move them into this album.
        b.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-noormd-gallery-ids')) { e.preventDefault(); b.classList.add('drop-target'); } });
        b.addEventListener('dragleave', () => b.classList.remove('drop-target'));
        b.addEventListener('drop', (e) => { e.preventDefault(); b.classList.remove('drop-target'); const ids = JSON.parse(e.dataTransfer.getData('text/x-noormd-gallery-ids') || '[]'); if (ids.length) movePictures(ids, extra.folder, label); });
      }
      return b;
    };
    const tree = albumTree();
    const node = tree.bySource.get(view.source);
    // Choosing a place (from the list, a folder in the pictures or the path above them) opens the folders around it.
    if (node && navShown !== view.source) for (let n = node.parent; n; n = n.parent) navOpen.add(n.navKey);
    navShown = view.source;
    const row = (n, label, depth) => item(n.source, label, n.total, { depth, path: n.navKey, hasKids: n.kids.size > 0, album: n.album, folder: n.folder, library: n.library,
      title: n.album ? `${n.folder || n.album.name} (right-click: rename, look for new pictures…)` : n.folder || n.name, node: n });
    const treeRows = (node, depth) => [...node.kids.values()].sort((a, b) => a.name.localeCompare(b.name)).flatMap((k) => {
      const { n, label } = chain(k);
      return [row(n, label, depth), ...(n.kids.size && navOpen.has(n.navKey) ? treeRows(n, depth + 1) : [])];
    });
    const groups = [...tree.groups.values()].sort((x, y) => x.name.localeCompare(y.name));
    nav.replaceChildren(
      item('all', 'All pictures', status.count),
      item('fav', '★ Favourites', null),
      el('div', { class: 'gnav-head' }, el('span', { text: 'Albums' }), el('button', { class: 'icon-btn', id: 'gallery-new-album', title: 'New album (a folder)', 'aria-label': 'New album', onclick: () => newAlbum(null) }, '＋')),
      ...(groups.length > 1
        ? groups.flatMap((g) => [row(g, g.name, 0), ...(navOpen.has(g.navKey) ? treeRows(g, 1) : [])])
        : groups.flatMap((g) => [...(g.album ? [row({ ...g, kids: new Map(), total: g.album.count }, g.name, 0)] : []), ...treeRows(g, 0)])),
      ...(status.slideshows.length ? [el('div', { class: 'gnav-head' }, el('span', { text: 'Slideshows' })), ...status.slideshows.map((x) => item('show:' + x.id, '▶ ' + x.name, x.count))] : []),
      ...((status.tags || []).length ? [el('div', { class: 'gnav-head' }, el('span', { text: 'Tags' })), ...status.tags.map((t) => item('tag:' + t.tag, '# ' + t.tag, t.count))] : []),
      ...dateNav(item));
  }

  // Which album folders are open in the list (kept between sessions on this computer).
  let navShown = null; // the source the list last opened folders for
  const navOpen = new Set((() => { try { return JSON.parse(localStorage.getItem('noormd.gallery.navOpen') || '[]'); } catch { return []; } })());
  function toggleFolder(path) {
    if (navOpen.has(path)) navOpen.delete(path); else navOpen.add(path);
    try { localStorage.setItem('noormd.gallery.navOpen', JSON.stringify([...navOpen].slice(-500))); } catch { /* fine */ }
    renderNav();
  }
  function goTo(source) { view.source = source; sel.clear(); saveSession(); renderNav(); load(); }

  /**
   * The albums as a tree of folders, one per picture folder (library). Every place in it can be opened: an album shows
   * its own pictures with its sub-albums as folders first; a folder with no pictures of its own shows only its folders.
   * Counts are everything inside (an album with 4 pictures and a sub-album of 10 says 14).
   */
  function albumTree() {
    const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
    const leaf = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
    const roots = [...(status.folders || [])].map((f) => f.path).sort((a, b) => b.length - a.length);
    const rootOf = (a) => roots.find((r) => { const f = norm(a.folder), n = norm(r); return f === n || f.startsWith(n + '\\') || f.startsWith(n + '/'); }) || '';
    const groups = new Map(), bySource = new Map();
    const mk = (name, navKey, folder, parent, library = false) => ({ name, navKey, folder, parent, library, kids: new Map(), album: null, source: folder ? 'dir:' + folder : 'library:' + navKey, total: 0, cover: null });
    for (const a of [...status.albums].sort((x, y) => x.name.localeCompare(y.name))) {
      const r = rootOf(a), sep = r.includes('\\') ? '\\' : '/';
      if (!groups.has(r)) groups.set(r, mk(r ? leaf(r) : 'Other', 'root:' + r, r || null, null, true));
      const g = groups.get(r);
      if (r && norm(a.folder) === norm(r)) { g.album = a; continue; } // pictures right in the picture folder
      let n = g, rel = '';
      for (const part of a.name.split('/')) {
        rel = rel ? `${rel}/${part}` : part;
        if (!n.kids.has(part)) n.kids.set(part, mk(part, `${r}|${rel}`, r ? r + sep + rel.split('/').join(sep) : null, n));
        n = n.kids.get(part);
      }
      n.album = a; n.folder = a.folder;
    }
    const finish = (n) => {
      if (n.album) n.source = 'album:' + n.album.key;
      n.total = (n.album ? n.album.count : 0) + [...n.kids.values()].reduce((t, k) => t + finish(k), 0);
      bySource.set(n.source, n);
      // The cover: its own, else the first one inside.
      n.cover = n.album && n.album.coverId != null ? n.album.coverId : ([...n.kids.values()].map((k) => k.cover).find((c) => c != null) ?? null);
      return n.total;
    };
    for (const g of groups.values()) finish(g);
    return { groups, bySource };
  }
  /** A folder with no pictures of its own and only one folder inside shares a row with it ("Textures › Rocks"). */
  function chain(k) {
    let n = k, label = k.name;
    while (!n.album && n.kids.size === 1) { n = [...n.kids.values()][0]; label += ' › ' + n.name; }
    return { n, label };
  }
  /** The place being shown (an album or a folder), or null. */
  function placeNode() {
    return /^(album|dir|library):/.test(view.source) ? albumTree().bySource.get(view.source) || null : null;
  }

  /** Right-click on a folder with no pictures of its own (or a picture folder). */
  function folderMenu(folder, x, y) {
    NoorChrome.openMenu(null, [
      { label: 'Look for new pictures here', run: () => rescanHere(folder) },
      { label: 'Show in Explorer', run: () => req('gallery.revealFolder', { folder }).catch(hooks.showError) },
    ], { x, y });
  }
  async function rescanHere(folder) {
    notice('Looking for new pictures here…', 1200);
    try { status = await req('gallery.rescanAlbum', { folder }); renderSources(); load(); } catch (err) { hooks.showError(err); }
  }

  /** A sub-album (or a folder of albums) among the pictures: double-click (or Enter) goes into it. */
  function folderTile(k) {
    const { n, label } = chain(k);
    return el('button', { class: 'gallery-folder', 'data-folder-source': n.source, title: `${label} · ${n.total} picture${n.total === 1 ? '' : 's'} (double-click to open)`,
      ondblclick: () => goTo(n.source),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); goTo(n.source); } },
      oncontextmenu: (e) => { e.preventDefault(); if (n.album) albumMenu(n.album, e.clientX, e.clientY); else if (n.folder) folderMenu(n.folder, e.clientX, e.clientY); } },
    el('span', { class: 'gallery-folder-art' }, folderArt(),
      n.cover != null ? el('img', { class: 'gallery-folder-pic', src: thumbUrl(n.cover), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onerror: (e) => e.target.remove() }) : null),
    el('span', { class: 'gallery-folder-name' }, el('b', { text: label }), el('small', { text: String(n.total) })));
  }
  /** A folder drawn as one: the back with its tab, two sheets of paper, the front (the preview sits on the front). */
  function folderArt() {
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 80'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'gallery-folder-svg');
    const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); };
    add('path', { class: 'gf-back', d: 'M5 9a5 5 0 0 1 5-5h22a5 5 0 0 1 4 2l4 5h50a5 5 0 0 1 5 5v55a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z' });
    add('rect', { class: 'gf-paper', x: 11, y: 14, width: 76, height: 22, rx: 2 });
    add('rect', { class: 'gf-paper gf-paper2', x: 15, y: 18, width: 74, height: 22, rx: 2 });
    add('path', { class: 'gf-front', d: 'M3 27a4 4 0 0 1 4-4h86a4 4 0 0 1 4 4.4l-3.4 46a4 4 0 0 1-4 3.6H10.4a4 4 0 0 1-4-3.6z' });
    return svg;
  }
  /** Where the place is: its picture folder › … › it (each part opens). */
  function crumbs(node) {
    const path = [];
    for (let n = node; n; n = n.parent) path.unshift(n);
    return el('nav', { class: 'gallery-crumbs', 'aria-label': 'Where these pictures are' }, ...path.flatMap((n, i) => [
      i ? el('span', { class: 'gallery-crumb-sep', 'aria-hidden': 'true', text: '›' }) : null,
      i === path.length - 1 ? el('strong', { text: n.name }) : el('button', { class: 'gallery-crumb', onclick: () => goTo(n.source) }, n.name),
    ]).filter(Boolean));
  }


  /** Years, and the months of the open year (or of the year a month is chosen in). */
  function dateNav(item) {
    const years = yearsOf(status.months || []);
    if (!years.length) return [];
    const openYear = view.source.startsWith('month:') ? view.source.slice(6, 10) : null;
    return [el('div', { class: 'gnav-head' }, el('span', { text: 'By date' })),
      ...years.flatMap((y) => [item('month:' + y.year, y.year, y.count),
        ...(y.year === openYear ? y.months.map((m) => item('month:' + m.month, monthName(m.month, true), m.count, { depth: 1 })) : [])])];
  }

  function yearsOf(months) {
    const by = new Map();
    for (const m of months) {
      const y = m.month.slice(0, 4);
      if (!by.has(y)) by.set(y, { year: y, count: 0, months: [] });
      const e = by.get(y); e.count += m.count; e.months.push(m);
    }
    return [...by.values()];
  }

  function monthName(ym, short) {
    const [y, m] = ym.split('-').map(Number);
    try { return new Date(y, m - 1, 1).toLocaleDateString(undefined, short ? { month: 'long' } : { month: 'long', year: 'numeric' }); } catch { return ym; }
  }

  function renderInfo() {
    const box = $('#gallery-info');
    if (!box || !isWide()) { if (box) box.replaceChildren(); return; }
    const chosen = items.filter((x) => sel.has(x.id));
    if (!chosen.length) {
      box.replaceChildren(el('div', { class: 'ginfo-empty' },
        el('strong', { text: `${items.length} picture${items.length === 1 ? '' : 's'}` }),
        el('p', { text: 'Click a picture to see its details; Ctrl or Shift + click to choose several. Double-click opens it. Drag pictures onto an album to move them there.' })));
      return;
    }
    if (chosen.length === 1) {
      const it = chosen[0];
      const name = el('input', { type: 'text', id: 'ginfo-name', value: it.name, 'aria-label': 'Name', spellcheck: 'false' });
      let busy = false;
      const commit = async () => {
        // Enter and then leaving the field must rename once: compare with the picture's current name.
        const cur = items.find((x) => x.id === it.id);
        const v = name.value.trim();
        if (busy || !cur || !v || v === cur.name) { if (cur && !v) name.value = cur.name; return; }
        busy = true;
        try { await afterChange(await req('gallery.rename', { id: it.id, name: v }), 'Renamed'); } catch (err) { name.value = cur.name; hooks.showError(err); } finally { busy = false; }
      };
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); name.value = it.name; } });
      name.addEventListener('blur', commit);
      const i = items.indexOf(it);
      box.replaceChildren(
        el('button', { class: 'ginfo-preview', title: 'Open (Enter)', onclick: () => openViewer(i) }, el('img', { src: thumbUrl(it.id), alt: it.name })),
        el('label', { class: 'ginfo-field' }, el('span', { text: 'Name' }), name),
        marksEditor([it]),
        el('dl', { class: 'ginfo-facts' },
          el('dt', { text: 'Album' }), el('dd', { text: it.album }),
          el('dt', { text: 'Taken' }), el('dd', { text: dateText(it.taken) }),
          ...(it.width ? [el('dt', { text: 'Size' }), el('dd', { text: `${it.width} × ${it.height}` })] : []),
          el('dt', { text: 'File' }), el('dd', { text: `${it.fileName} · ${sizeText(it.size)}`, title: it.folder })),
        el('div', { class: 'ginfo-actions' },
          el('button', { class: 'utility-btn', onclick: () => openViewer(i) }, '⤢ Open'),
          el('button', { class: 'utility-btn' + (it.favorite ? ' on' : ''), id: 'ginfo-fav', onclick: () => setFavorite([it.id], !it.favorite) }, it.favorite ? '★ Favourite' : '☆ Favourite'),
          el('button', { class: 'utility-btn', onclick: () => insert(it) }, '⤓ Into note'),
          el('button', { class: 'utility-btn', onclick: async (e) => { const a = e.currentTarget; if (!places) await loadPlaces(); NoorChrome.openMenu(a, moveMenu([it.id])); } }, '→ Move…'),
          el('button', { class: 'utility-btn', id: 'ginfo-openin', onclick: (e) => NoorChrome.openMenu(e.currentTarget, openInMenu([it.id])) }, '✎ Open in…'),
          el('button', { class: 'utility-btn', id: 'ginfo-texture', title: 'Make a material from it in NoorMaterial, or add it over the one you are making', onclick: (e) => NoorChrome.openMenu(e.currentTarget, textureMenu([it.id])) }, '🧱 Texture…'),
          el('button', { class: 'utility-btn', id: 'ginfo-convert', onclick: () => convertPictures([it.id]) }, '⇲ Convert…'),
          el('button', { class: 'utility-btn', onclick: () => req('gallery.reveal', { id: it.id }).catch(hooks.showError) }, '📁 Explorer'),
          el('button', { class: 'utility-btn danger', onclick: () => deletePictures([it.id]) }, '🗑 Delete…')));
      return;
    }
    const ids = chosen.map((x) => x.id);
    box.replaceChildren(
      el('div', { class: 'ginfo-stack' }, ...chosen.slice(0, 4).map((x) => el('img', { src: thumbUrl(x.id), alt: '' }))),
      el('strong', { class: 'ginfo-count', text: `${chosen.length} pictures selected` }),
      el('small', { class: 'ginfo-sub', text: sizeText(chosen.reduce((t, x) => t + (x.size || 0), 0)) }),
      marksEditor(chosen),
      el('div', { class: 'ginfo-actions' },
        el('button', { class: 'utility-btn', onclick: () => slideshowSetup(null, ids, 0) }, '▶ Slideshow'),
        el('button', { class: 'utility-btn', onclick: () => setFavorite(ids, true) }, '★ Favourites'),
        el('button', { class: 'utility-btn', id: 'ginfo-series', onclick: () => renameSeries(ids) }, '✎ Rename as series…'),
        el('button', { class: 'utility-btn', onclick: async (e) => { const a = e.currentTarget; if (!places) await loadPlaces(); NoorChrome.openMenu(a, moveMenu(ids)); } }, '→ Move…'),
        el('button', { class: 'utility-btn', onclick: () => saveSlideshow(ids) }, '＋ New slideshow…'),
        el('button', { class: 'utility-btn', onclick: (e) => NoorChrome.openMenu(e.currentTarget, openInMenu(ids)) }, '✎ Open in…'),
        el('button', { class: 'utility-btn', id: 'ginfo-texture', title: 'Make a material from them in NoorMaterial, or add them over the one you are making', onclick: (e) => NoorChrome.openMenu(e.currentTarget, textureMenu(ids)) }, '🧱 Texture…'),
        el('button', { class: 'utility-btn', onclick: () => copyOrMove(ids, true) }, '⧉ Copy to…'),
        el('button', { class: 'utility-btn', id: 'ginfo-convert', onclick: () => convertPictures(ids) }, '⇲ Convert or resize…'),
        el('button', { class: 'utility-btn', id: 'ginfo-zip', onclick: () => packZip(ids) }, '🗜 ZIP…'),
        el('button', { class: 'utility-btn danger', onclick: () => deletePictures(ids) }, '🗑 Delete…')));
  }

  async function setFavorite(ids, on) {
    try {
      await req('gallery.favorite', { ids, on });
      for (const it of items) if (ids.includes(it.id)) it.favorite = on;
      if (view.source === 'fav' && !on) await load(); else render();
      if (viewer.open) { const it = viewer.list[viewer.index]; $('#gv-fav').classList.toggle('on', !!it.favorite); $('#gv-fav').setAttribute('aria-pressed', String(!!it.favorite)); } // just the star: zoom and picture stay
      notice(on ? '★ Favourite' : 'No longer a favourite', 1000);
    } catch (err) { hooks.showError(err); }
  }

  async function insert(it) {
    if (!hooks.hasDocument()) { notice('Open a document to put the picture into.', 2200); return; }
    try {
      const r = await req('gallery.insert', { id: it.id });
      if (r && r.inserted) notice(`Picture put into ${r.document || 'the document'}`, 1600);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- slideshows (saved)

  async function saveSlideshow(ids, settings) {
    const name = await NoorUI.prompt('New slideshow', 'Name of the slideshow:', view.source.startsWith('album:') ? status.albums.find((a) => 'album:' + a.key === view.source)?.name || '' : '', { okLabel: 'Create' });
    if (!name || !name.trim()) return null;
    try {
      const r = await req('gallery.slideshow.create', { name, ids, settings: settings || DEFAULT_SHOW });
      status = r.status;
      view.source = 'show:' + r.id;
      sel.clear();
      saveSession();
      renderSources();
      await load();
      notice(`Slideshow “${name.trim()}” with ${ids.length} picture${ids.length === 1 ? '' : 's'}. Drag pictures to change the order.`, 2600);
      return r.id;
    } catch (err) { hooks.showError(err); return null; }
  }

  async function addToSlideshow(s, ids) {
    try { status = await req('gallery.slideshow.add', { id: s.id, ids }); renderSources(); notice(`Added to “${s.name}”`, 1400); } catch (err) { hooks.showError(err); }
  }

  async function removeFromSlideshow(id, ids) {
    const keep = items.filter((i) => !ids.includes(i.id)).map((i) => i.id);
    try { status = await req('gallery.slideshow.update', { id, ids: keep }); sel.clear(); await load(); } catch (err) { hooks.showError(err); }
  }

  async function renameSlideshow(s) {
    const name = await NoorUI.prompt('Rename slideshow', 'New name:', s.name, { okLabel: 'Rename' });
    if (!name || !name.trim()) return;
    try { status = await req('gallery.slideshow.update', { id: s.id, name }); renderSources(); } catch (err) { hooks.showError(err); }
  }

  async function deleteSlideshow(s) {
    if (!await NoorUI.confirm(`Delete “${s.name}”?`, 'Only the slideshow is deleted. The pictures stay where they are.', 'Delete')) return;
    try { status = await req('gallery.slideshow.delete', { id: s.id }); view.source = 'all'; saveSession(); renderSources(); load(); } catch (err) { hooks.showError(err); }
  }

  /** In a slideshow, pictures are put in order by dragging them. */
  function wireReorder(b, it) {
    b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-noormd-gallery', String(it.id)); e.dataTransfer.effectAllowed = 'move'; b.classList.add('dragging'); });
    b.addEventListener('dragend', () => b.classList.remove('dragging'));
    b.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-noormd-gallery')) { e.preventDefault(); b.classList.add('drop-target'); } });
    b.addEventListener('dragleave', () => b.classList.remove('drop-target'));
    b.addEventListener('drop', async (e) => {
      e.preventDefault();
      b.classList.remove('drop-target');
      const from = Number(e.dataTransfer.getData('text/x-noormd-gallery'));
      if (!from || from === it.id) return;
      const moving = sel.has(from) && !sel.has(it.id) ? items.filter((x) => sel.has(x.id)).map((x) => x.id) : [from];
      const rest = items.map((x) => x.id).filter((x) => !moving.includes(x));
      rest.splice(rest.indexOf(it.id), 0, ...moving);
      try { status = await req('gallery.slideshow.update', { id: Number(view.source.slice(5)), ids: rest }); await load(); } catch (err) { hooks.showError(err); }
    });
  }

  // ---------------------------------------------------------------- viewer

  const viewer = { open: false, list: [], index: 0, zoom: 1, x: 0, y: 0 };

  function openViewer(i, list) {
    viewer.list = list || items;
    viewer.index = Math.max(0, Math.min(viewer.list.length - 1, i));
    if (!viewer.list.length) return;
    let v = $('#gallery-viewer');
    if (!v) v = buildViewer();
    v.hidden = false;
    viewer.open = true;
    document.body.classList.add('gallery-viewing');
    renderViewer();
    v.focus();
  }

  function closeViewer() {
    const v = $('#gallery-viewer');
    if (!v || v.hidden) return;
    v.hidden = true;
    viewer.open = false;
    document.body.classList.remove('gallery-viewing');
    const t = document.querySelector(`#gallery-body .gallery-tile[data-id="${viewer.list[viewer.index]?.id}"]`);
    if (t) { t.scrollIntoView({ block: 'nearest' }); t.focus({ preventScroll: true }); }
  }

  function buildViewer() {
    const img = el('img', { id: 'gv-img', alt: '', draggable: 'false' });
    const v = el('div', { id: 'gallery-viewer', class: 'gallery-viewer', hidden: true, tabindex: '-1', role: 'dialog', 'aria-label': 'Picture' },
      el('div', { class: 'gv-stage', id: 'gv-stage' }, img),
      el('button', { class: 'gv-nav gv-prev', 'aria-label': 'Previous picture (←)', title: 'Previous (←)', onclick: () => step(-1) }, '‹'),
      el('button', { class: 'gv-nav gv-next', 'aria-label': 'Next picture (→)', title: 'Next (→)', onclick: () => step(1) }, '›'),
      el('div', { class: 'gv-bar' },
        el('div', { class: 'gv-info' }, el('strong', { id: 'gv-name' }), el('span', { id: 'gv-meta' }), el('span', { id: 'gv-marks', class: 'gv-marks' })),
        el('div', { class: 'gv-actions' },
          el('button', { class: 'gv-btn', id: 'gv-rotl', title: 'Turn left (Ctrl+Shift+R)', 'aria-label': 'Turn left', onclick: () => rotate([viewer.list[viewer.index].id], false) }, '⟲'),
          el('button', { class: 'gv-btn', id: 'gv-rotr', title: 'Turn right (Ctrl+R)', 'aria-label': 'Turn right', onclick: () => rotate([viewer.list[viewer.index].id], true) }, '⟳'),
          el('button', { class: 'gv-btn', id: 'gv-fav', title: 'Favourite (F)', onclick: () => { const it = viewer.list[viewer.index]; setFavorite([it.id], !it.favorite); } }, '★'),
          el('button', { class: 'gv-btn', id: 'gv-insert', title: 'Put into the note (I)', onclick: () => insert(viewer.list[viewer.index]) }, '⤓ Into note'),
          el('button', { class: 'gv-btn', title: 'Show in Explorer', onclick: () => req('gallery.reveal', { id: viewer.list[viewer.index].id }).catch(hooks.showError) }, '📁'),
          el('button', { class: 'gv-btn', id: 'gv-show', title: 'Slideshow from here (S)', onclick: () => { const i = viewer.index; const list = viewer.list; closeViewer(); slideshowSetup(null, list === items ? null : list.map((x) => x.id), i); } }, '▶ Slideshow'),
          el('button', { class: 'gv-btn', title: 'Close (Esc)', 'aria-label': 'Close', onclick: closeViewer }, '✕'))));
    document.body.append(v);
    v.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeViewer(); }
      else if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); step(1); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); step(-1); }
      else if (k === 'Home') { e.preventDefault(); viewer.index = 0; renderViewer(); }
      else if (k === 'End') { e.preventDefault(); viewer.index = viewer.list.length - 1; renderViewer(); }
      else if (k.toLowerCase() === 'f' && !e.ctrlKey) { e.preventDefault(); $('#gv-fav').click(); }
      else if (k.toLowerCase() === 'i' && !e.ctrlKey) { e.preventDefault(); $('#gv-insert').click(); }
      else if (k.toLowerCase() === 's' && !e.ctrlKey) { e.preventDefault(); $('#gv-show').click(); }
      else if (k.toLowerCase() === 'z' && !e.ctrlKey) { e.preventDefault(); setZoom(viewer.zoom > 1.01 ? 1 : naturalZoom()); }
      else if (/^[0-9]$/.test(k) && !e.ctrlKey && !e.altKey) { e.preventDefault(); markKey([viewer.list[viewer.index].id], Number(k)); }
      else if (k.toLowerCase() === 'r' && e.ctrlKey) { e.preventDefault(); rotate([viewer.list[viewer.index].id], !e.shiftKey); }
      else if (k.toLowerCase() === 't' && !e.ctrlKey) { e.preventDefault(); addTags([viewer.list[viewer.index].id]); }
      else if (k === '+' || k === '=') { e.preventDefault(); setZoom(viewer.zoom * 1.25); }
      else if (k === '-') { e.preventDefault(); setZoom(viewer.zoom / 1.25); }
    });
    const stage = v.querySelector('#gv-stage');
    stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(viewer.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    stage.addEventListener('dblclick', () => setZoom(viewer.zoom > 1.01 ? 1 : Math.max(2, naturalZoom())));
    let drag = null;
    stage.addEventListener('pointerdown', (e) => { if (viewer.zoom <= 1.01) return; drag = { x: e.clientX - viewer.x, y: e.clientY - viewer.y }; stage.setPointerCapture(e.pointerId); stage.classList.add('panning'); });
    stage.addEventListener('pointermove', (e) => { if (!drag) return; viewer.x = e.clientX - drag.x; viewer.y = e.clientY - drag.y; applyZoom(); });
    stage.addEventListener('pointerup', () => { drag = null; stage.classList.remove('panning'); });
    stage.addEventListener('click', (e) => { if (e.target === stage && viewer.zoom <= 1.01) closeViewer(); });
    return v;
  }

  /** The zoom at which the picture shows at its own size (1 = fit to the window). */
  function naturalZoom() {
    const img = $('#gv-img');
    if (!img || !img.naturalWidth || !img.clientWidth) return 1;
    return Math.max(1, img.naturalWidth / img.clientWidth);
  }

  function setZoom(z) {
    viewer.zoom = Math.max(1, Math.min(12, z));
    if (viewer.zoom <= 1.01) { viewer.zoom = 1; viewer.x = 0; viewer.y = 0; }
    applyZoom();
  }

  function applyZoom() {
    const img = $('#gv-img'), stage = $('#gv-stage');
    // Panning stops at the picture's edges: it can be moved only as far as it is bigger than the window.
    if (viewer.zoom > 1 && img.clientWidth && stage) {
      const mx = Math.max(0, (img.clientWidth * viewer.zoom - stage.clientWidth) / 2), my = Math.max(0, (img.clientHeight * viewer.zoom - stage.clientHeight) / 2);
      viewer.x = Math.max(-mx, Math.min(mx, viewer.x)); viewer.y = Math.max(-my, Math.min(my, viewer.y));
    }
    img.style.transform = viewer.zoom === 1 ? '' : `translate(${viewer.x}px, ${viewer.y}px) scale(${viewer.zoom})`;
    $('#gv-stage').classList.toggle('zoomed', viewer.zoom > 1);
  }

  function step(d) {
    if (!viewer.list.length) return;
    viewer.index = (viewer.index + d + viewer.list.length) % viewer.list.length;
    renderViewer();
  }

  function renderViewer() {
    const it = viewer.list[viewer.index];
    if (!it) return;
    viewer.zoom = 1; viewer.x = 0; viewer.y = 0;
    const img = $('#gv-img');
    img.style.transform = '';
    img.hidden = false;
    $('#gv-nopreview')?.remove();
    img.onerror = () => {
      // A work file without a preview here: say so, and offer the editor.
      img.hidden = true;
      $('#gv-stage').append(el('div', { class: 'gv-nopreview', id: 'gv-nopreview' }, el('b', { text: it.format }), el('p', { text: 'Windows has no preview for this file here. Open it in its program:' }),
        el('button', { class: 'gv-btn', onclick: (e) => NoorChrome.openMenu(e.currentTarget, openInMenu([it.id])) }, '✎ Open in…')));
    };
    img.src = imgUrl(it.id);
    img.alt = it.name;
    $('#gv-name').textContent = it.name + (it.web === false ? ` (${it.format})` : '');
    $('#gv-meta').textContent = [`${viewer.index + 1} / ${viewer.list.length}`, it.album, dateText(it.taken), it.width ? `${it.width} × ${it.height}` : '', sizeText(it.size)].filter(Boolean).join(' · ');
    $('#gv-fav').classList.toggle('on', !!it.favorite);
    $('#gv-fav').setAttribute('aria-pressed', String(!!it.favorite));
    renderViewerMarks();
    // The next picture loads while you look at this one.
    const next = viewer.list[(viewer.index + 1) % viewer.list.length];
    if (next && next !== it) { const pre = new Image(); pre.src = imgUrl(next.id); }
  }

  /** Stars, colour label and tags of the picture in the viewer (keys 0–9 and T change them). */
  function renderViewerMarks() {
    const it = viewer.list[viewer.index];
    const box = $('#gv-marks');
    if (!it || !box) return;
    box.replaceChildren(
      ...(it.rating ? [el('span', { class: 'gv-stars', title: `${it.rating} star${it.rating > 1 ? 's' : ''}`, text: '★'.repeat(it.rating) })] : []),
      ...(it.label ? [el('span', { class: 'gallery-label inline', 'data-label': it.label, title: LABELS[it.label]?.[0] || it.label })] : []),
      ...(it.tags || []).map((t) => el('span', { class: 'gv-tag', text: '# ' + t })));
  }

  // ---------------------------------------------------------------- slideshow player

  const show = { running: false, list: [], order: [], pos: 0, timer: null, paused: false, settings: { ...DEFAULT_SHOW }, startedMusic: false, front: 0, hideTimer: null };

  /** Asks how to play (interval, transition, music…), then plays. `saved` is a saved slideshow; `ids` a selection. */
  async function slideshowSetup(saved, ids, startAt = 0) {
    let list;
    if (saved) {
      try { list = await req('gallery.query', { slideshow: saved.id }); } catch (err) { hooks.showError(err); return; }
    } else if (ids && ids.length) {
      const byId = new Map(items.map((i) => [i.id, i]));
      list = ids.map((id) => byId.get(id) || (viewer.list || []).find((x) => x.id === id)).filter(Boolean);
    } else if (sel.size > 1) {
      list = items.filter((i) => sel.has(i.id));
    } else if (/^(album|dir):/.test(view.source)) {
      // An album's slideshow has its sub-albums' pictures too (as many as its count says).
      const [sort, descending] = SORTS[view.sort] || SORTS['taken-desc'];
      const q = { sort, descending, subAlbums: true, ...(view.source.startsWith('album:') ? { album: view.source.slice(6) } : { folder: view.source.slice(4) }) };
      try { list = await req('gallery.query', q); } catch (err) { hooks.showError(err); return; }
    } else list = items;
    if (!list.length) { notice(status.folders.length ? 'There are no pictures to show here.' : 'Add a picture folder first.', 2200); return; }
    const current = view.source.startsWith('show:') && !saved ? status.slideshows.find((s) => 'show:' + s.id === view.source) : saved;
    const settings = { ...DEFAULT_SHOW, ...(current && current.settings ? current.settings : lastSettings()) };
    let playlists = [];
    if (window.NoorMusic && NoorMusic.listPlaylists) { try { playlists = await NoorMusic.listPlaylists(); } catch { playlists = []; } }
    NoorUI.modal({ label: 'Slideshow', width: 520 }, (s, closeModal) => {
      const interval = el('select', { id: 'ss-interval', 'aria-label': 'Each picture for' }, ...[3, 5, 8, 12, 20].map((n) => el('option', { value: String(n), text: `${n} seconds`, selected: settings.interval === n || undefined })));
      const transition = el('select', { id: 'ss-transition', 'aria-label': 'Transition' }, ...Object.entries(TRANSITIONS).map(([k, v]) => el('option', { value: k, text: v, selected: settings.transition === k || undefined })));
      const music = el('select', { id: 'ss-music', 'aria-label': 'Music' },
        el('option', { value: 'none', text: 'No music (pause what is playing)' }),
        el('option', { value: 'keep', text: 'Keep what NoorMusic plays' }),
        ...(playlists.length ? [el('optgroup', { label: 'Play a music playlist' }, ...playlists.map((p) => el('option', { value: 'pl:' + p.id, text: `♫ ${p.name} (${p.count ?? '?'})` })))] : []));
      music.value = settings.music === 'playlist' && settings.playlistId ? 'pl:' + settings.playlistId : settings.music === 'none' ? 'none' : 'keep';
      if (!music.value) music.value = 'keep';
      const shuffle = el('input', { type: 'checkbox', id: 'ss-shuffle', checked: settings.shuffle || undefined });
      const loop = el('input', { type: 'checkbox', id: 'ss-loop', checked: settings.loop || undefined });
      const captions = el('input', { type: 'checkbox', id: 'ss-captions', checked: settings.captions || undefined });
      const stopMusic = el('input', { type: 'checkbox', id: 'ss-stopmusic', checked: settings.stopMusic || undefined });
      const read = () => ({
        interval: Number(interval.value), transition: transition.value, shuffle: shuffle.checked, loop: loop.checked, captions: captions.checked, stopMusic: stopMusic.checked,
        music: music.value.startsWith('pl:') ? 'playlist' : music.value, playlistId: music.value.startsWith('pl:') ? Number(music.value.slice(3)) : null,
      });
      const go = async () => {
        const st = read();
        closeModal();
        rememberSettings(st);
        if (current && current.id) { try { status = await req('gallery.slideshow.update', { id: current.id, settings: st }); renderSources(); } catch (err) { hooks.showError(err); } }
        play(list, st, startAt);
      };
      s.append(NoorUI.head(`▶ ${current ? current.name : 'Slideshow'} · ${list.length} picture${list.length === 1 ? '' : 's'}`, closeModal),
        el('div', { class: 'modal-body apps-form' },
          el('label', {}, el('span', { text: 'Each picture' }), interval),
          el('label', {}, el('span', { text: 'Transition' }), transition),
          el('label', {}, el('span', { text: 'Music' }), music),
          el('div', { class: 'ss-checks' },
            el('label', {}, shuffle, el('span', { text: 'Shuffle' })),
            el('label', {}, loop, el('span', { text: 'Start again at the end' })),
            el('label', {}, captions, el('span', { text: 'Show name and date' })),
            el('label', {}, stopMusic, el('span', { text: 'Pause the music when the slideshow ends' }))),
          el('p', { class: 'pref-hint', text: 'While it plays: Space pauses, ← → change pictures, F toggles full screen, Esc ends.' })),
        el('div', { class: 'modal-foot' },
          current ? el('span') : el('button', { class: 'action', id: 'ss-save', onclick: async () => { const st = read(); closeModal(); rememberSettings(st); await saveSlideshow(list.map((i) => i.id), st); } }, 'Save as slideshow…'),
          el('div', { class: 'modal-buttons' },
            el('button', { class: 'action', onclick: () => closeModal() }, 'Cancel'),
            el('button', { class: 'action primary', id: 'ss-play', autofocus: true, onclick: go }, '▶ Play'))));
    });
  }

  function lastSettings() { try { return JSON.parse(localStorage.getItem('noormd.slideshow') || '{}'); } catch { return {}; } }
  function rememberSettings(st) { try { localStorage.setItem('noormd.slideshow', JSON.stringify(st)); } catch { /* private storage off */ } }

  function play(list, settings, startAt = 0) {
    stopShow(true);
    show.list = list;
    show.settings = settings;
    const idx = list.map((_, i) => i);
    if (settings.shuffle) {
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const at = idx.indexOf(startAt); if (at > 0) { idx.splice(at, 1); idx.unshift(startAt); }
      show.pos = 0;
    } else show.pos = Math.max(0, Math.min(list.length - 1, startAt));
    show.order = idx;
    show.running = true;
    show.paused = false;
    let s = $('#gallery-slideshow');
    if (!s) s = buildShow();
    s.dataset.transition = settings.transition;
    s.hidden = false;
    s.classList.add('show-controls');
    document.body.classList.add('gallery-slideshow');
    s.focus();
    startMusic(settings);
    showSlide(true);
  }

  function startMusic(st) {
    show.startedMusic = false;
    if (!window.NoorMusic) return;
    if (st.music === 'none') { NoorMusic.pause && NoorMusic.pause(); return; }
    if (st.music === 'playlist' && st.playlistId) { NoorMusic.playPlaylist(st.playlistId).catch(() => {}); show.startedMusic = true; return; }
    if (st.music === 'keep' && NoorMusic.resume) { if (!NoorMusic.isPlaying()) { NoorMusic.resume(); show.startedMusic = NoorMusic.isPlaying ? true : false; } }
  }

  function buildShow() {
    const s = el('div', { id: 'gallery-slideshow', class: 'gallery-slideshow', hidden: true, tabindex: '-1', role: 'dialog', 'aria-label': 'Slideshow' },
      el('div', { class: 'ss-layer', 'data-layer': '0' }, el('img', { alt: '', draggable: 'false' })),
      el('div', { class: 'ss-layer', 'data-layer': '1' }, el('img', { alt: '', draggable: 'false' })),
      el('div', { class: 'ss-caption', id: 'ss-caption' }),
      el('div', { class: 'ss-controls' },
        el('button', { class: 'gv-btn', 'aria-label': 'Previous', title: 'Previous (←)', onclick: () => advance(-1) }, '⏮'),
        el('button', { class: 'gv-btn', id: 'ss-pause', 'aria-label': 'Pause', title: 'Pause (Space)', onclick: togglePause }, '⏸'),
        el('button', { class: 'gv-btn', 'aria-label': 'Next', title: 'Next (→)', onclick: () => advance(1) }, '⏭'),
        el('span', { class: 'ss-pos', id: 'ss-pos' }),
        el('button', { class: 'gv-btn', title: 'Full screen (F)', 'aria-label': 'Full screen', onclick: toggleFullscreen }, '⛶'),
        el('button', { class: 'gv-btn', title: 'End (Esc)', 'aria-label': 'End the slideshow', onclick: () => stopShow() }, '✕')),
      el('div', { class: 'ss-progress' }, el('i', { id: 'ss-bar' })));
    document.body.append(s);
    s.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); stopShow(); }
      else if (k === ' ' || k === 'k') { e.preventDefault(); togglePause(); }
      else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); advance(1); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); advance(-1); }
      else if (k.toLowerCase() === 'f') { e.preventDefault(); toggleFullscreen(); }
    });
    s.addEventListener('mousemove', () => {
      s.classList.add('show-controls');
      clearTimeout(show.hideTimer);
      show.hideTimer = setTimeout(() => { if (!show.paused) s.classList.remove('show-controls'); }, 2200);
    });
    return s;
  }

  function toggleFullscreen() {
    const s = $('#gallery-slideshow');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else s.requestFullscreen().catch(() => {});
    s.focus();
  }

  function showSlide(first) {
    const s = $('#gallery-slideshow');
    const it = show.list[show.order[show.pos]];
    if (!s || !it) return;
    const layers = s.querySelectorAll('.ss-layer');
    const nextLayer = layers[first ? show.front : 1 - show.front];
    const img = nextLayer.querySelector('img');
    clearTimeout(show.timer);
    const reveal = () => {
      if (!show.running) return;
      layers.forEach((l) => l.classList.remove('active', 'kb'));
      void nextLayer.offsetWidth; // restart the zoom animation
      nextLayer.classList.add('active');
      if (show.settings.transition === 'kenburns') { nextLayer.style.setProperty('--kb-x', `${(Math.random() * 6 - 3).toFixed(1)}%`); nextLayer.style.setProperty('--kb-y', `${(Math.random() * 6 - 3).toFixed(1)}%`); nextLayer.style.setProperty('--kb-ms', `${show.settings.interval * 1000 + 1200}ms`); nextLayer.classList.add('kb'); }
      show.front = Number(nextLayer.dataset.layer);
      $('#ss-caption').textContent = show.settings.captions ? [it.name, dateText(it.taken)].filter(Boolean).join(' · ') : '';
      $('#ss-pos').textContent = `${show.pos + 1} / ${show.order.length}`;
      s.dataset.current = String(it.id);
      schedule();
      // The next one loads in the background, so the change is smooth.
      const n = show.list[show.order[(show.pos + 1) % show.order.length]];
      if (n) { const pre = new Image(); pre.src = imgUrl(n.id); }
    };
    img.onload = reveal;
    img.onerror = reveal; // a picture that can't be shown is skipped by time, not stuck on
    img.src = imgUrl(it.id);
    img.alt = it.name;
  }

  function schedule() {
    clearTimeout(show.timer);
    const bar = $('#ss-bar');
    bar.style.transition = 'none'; bar.style.width = '0%';
    if (show.paused) return;
    void bar.offsetWidth;
    bar.style.transition = `width ${show.settings.interval}s linear`; bar.style.width = '100%';
    show.timer = setTimeout(() => advance(1, true), show.settings.interval * 1000);
  }

  function advance(d, auto) {
    if (!show.running) return;
    let p = show.pos + d;
    if (p >= show.order.length) {
      if (!show.settings.loop && auto) { stopShow(); notice('Slideshow ended', 1400); return; }
      p = 0;
    }
    if (p < 0) p = show.order.length - 1;
    show.pos = p;
    showSlide(false);
  }

  function togglePause() {
    show.paused = !show.paused;
    const b = $('#ss-pause');
    b.textContent = show.paused ? '▶' : '⏸';
    b.setAttribute('aria-label', show.paused ? 'Play' : 'Pause');
    $('#gallery-slideshow').classList.toggle('paused', show.paused);
    schedule();
  }

  function stopShow(silent) {
    const s = $('#gallery-slideshow');
    clearTimeout(show.timer);
    if (!show.running) return;
    show.running = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (s) { s.hidden = true; s.querySelectorAll('.ss-layer').forEach((l) => { l.classList.remove('active', 'kb'); l.querySelector('img').removeAttribute('src'); }); }
    document.body.classList.remove('gallery-slideshow');
    if (!silent && show.settings.stopMusic && show.settings.music !== 'none' && window.NoorMusic && NoorMusic.pause) NoorMusic.pause();
    const t = document.querySelector(`#gallery-body .gallery-tile[data-id="${show.list[show.order[show.pos]]?.id}"]`);
    if (t) t.focus({ preventScroll: false });
  }

  // ---------------------------------------------------------------- helpers

  function dateText(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function sizeText(n) {
    if (!n) return '';
    return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  return {
    init, open, close, toggle, isOpen, refresh, slideshow: () => { if (!isOpen()) open().then(() => slideshowSetup()); else slideshowSetup(); },
    isBusy: () => viewer.open || show.running,
    _state: () => ({ open: isOpen(), source: view.source, sort: view.sort, items: items.map((i) => i.name), ids: items.map((i) => i.id), sel: [...sel], viewer: viewer.open ? viewer.list[viewer.index]?.id : null, zoom: viewer.zoom,
      show: show.running ? { current: show.list[show.order[show.pos]]?.id, pos: show.pos, paused: show.paused, settings: { ...show.settings }, order: show.order.map((i) => show.list[i].id) } : null }),
  };
})();
