// NoorMD Creator's Bench — Music Bench UI and player.
// Playback uses one <audio> element served from https://noormd.local/_media/{id} (the host answers HTTP ranges).
// The page refers to tracks only by library id; files, tags and renames are handled by the host.
window.NoorMusic = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const bridge = NoorBridge;

  // px per virtual-list row: two lines in a side panel; one line with columns when the bench is wide (in the middle).
  let wide = false;
  const rowH = () => (wide ? 34 : 50);
  // Columns of the wide library: [label, sort key or null, class].
  const COLUMNS = [['Title', 'title', 'c-title'], ['Artist', 'artist', 'c-artist'], ['Album', null, 'c-album'], ['Genre', 'genre', 'c-genre'], ['Year', 'year', 'c-year'],
    ['', 'triage', 'c-triage'], ['Plays', 'plays', 'c-plays'], ['Time', 'duration', 'c-time']];
  const PAGE = 200;          // rows fetched per request
  const TRIAGE = [
    { v: 0, key: '0', label: 'Untriaged', short: '—', icon: '○' },
    { v: 1, key: '1', label: 'Favorite', short: 'Fav', icon: '★' },
    { v: 2, key: '2', label: 'Keep', short: 'Keep', icon: '✓' },
    { v: 3, key: '3', label: 'Maybe', short: 'Maybe', icon: '?' },
    { v: 4, key: '4', label: 'Skip', short: 'Skip', icon: '✕' },
  ];
  const SORTS = [['title', 'Title'], ['filename', 'File name'], ['folder', 'Folder'], ['artist', 'Artist'], ['genre', 'Genre'], ['year', 'Year'], ['duration', 'Duration'], ['triage', 'Triage'], ['added', 'Date added'], ['plays', 'Play count']];

  const audio = new Audio();
  audio.preload = 'metadata';
  let hooks = { getPrefs: () => ({}), setPrefs: () => {}, showError: (e) => console.error(e) };
  let started = false;      // the bench (and its database) only starts on first use
  let status = { folders: [], stats: null, playlists: [], smart: [], scanning: false, undo: null };
  const cache = new Map();  // track id -> row
  let view = { search: '', triage: null, missingOnly: false, playlistId: null, smartId: null, sort: 'title', desc: false, total: 0 };
  let viewRows = new Map(); // index -> row
  let viewGen = 0;
  const pending = new Set();
  let selected = -1;          // the row with the keyboard cursor
  let sel = new Set();        // selected row indices of the current view (multi-select)
  let anchor = -1;            // start of a Shift range
  let tab = 'library';
  let q = { ids: [], order: [], pos: -1, shuffle: false, repeat: 'off', volume: 0.8 };
  let mediaVersion = 0;     // bumped after an edit so the player re-requests the (possibly renamed/retagged) file
  let playedMarked = null;
  let consecutiveErrors = 0;
  let saveTimer = null;
  let restorePosition = null;

  const currentId = () => (q.pos >= 0 && q.pos < q.order.length ? q.ids[q.order[q.pos]] : null);
  const fmt = (s) => { if (!Number.isFinite(s) || s < 0) return '0:00'; s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const enabled = () => hooks.getPrefs().showMusic !== false;
  const req = (type, payload) => bridge.request(type, payload);

  // ------------------------------------------------------------------ init / panel

  function init(h) {
    hooks = { ...hooks, ...h };
    audio.volume = q.volume;
    NoorFx.attach(audio);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('play', renderTransport);
    audio.addEventListener('pause', () => { renderTransport(); scheduleSave(); });
    audio.addEventListener('ended', () => next(true));
    audio.addEventListener('error', onError);
    audio.addEventListener('playing', () => {
      consecutiveErrors = 0;
      const id = currentId();
      if (id != null && playedMarked !== id) { playedMarked = id; req('music.played', { id }).catch(() => {}); }
    });
    bridge.on('music.scan', onScan);
    bridge.on('music.changed', () => { if (started) refreshStatus(true); });
    setupMediaSession();
    buildPanel();
    buildMiniPlayer();
    applyVisibility();
  }

  /** Called after app.ready: resume the last session (paused) if there is one. Doesn't open the panel. */
  async function resumeSession() {
    if (!enabled()) return;
    let json = null;
    try { json = await req('music.session.get'); } catch { return; }
    if (!json) return;
    started = true;
    try {
      const s = JSON.parse(json);
      if (s.fx) NoorFx.load(s.fx);
      if (!Array.isArray(s.ids) || !s.ids.length) return;
      q = { ids: s.ids.filter(Number.isInteger), order: Array.isArray(s.order) ? s.order : s.ids.map((_, i) => i), pos: s.pos ?? 0, shuffle: !!s.shuffle, repeat: ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off', volume: Number.isFinite(s.volume) ? s.volume : 0.8 };
      if (q.order.length !== q.ids.length || q.order.some((i) => !Number.isInteger(i) || i < 0 || i >= q.ids.length)) q.order = q.ids.map((_, i) => i);
      q.pos = Math.min(Math.max(0, q.pos), q.order.length - 1);
      audio.volume = q.volume;
      await loadTracks(q.order.slice(Math.max(0, q.pos - 50), q.pos + 200).map((i) => q.ids[i]));
      restorePosition = Number.isFinite(s.position) ? s.position : 0;
      loadCurrent(false);
      renderAll();
    } catch (err) { console.error('Music session restore failed', err); }
  }

  async function start() {
    if (started && status.stats) return;
    started = true;
    await refreshStatus(false);
  }

  async function refreshStatus(invalidate) {
    try { status = await req('music.status'); } catch (err) { hooks.showError(err); return; }
    if (invalidate) { viewRows = new Map(); viewGen++; }
    renderHeader();
    renderPlaylists();
    await loadView(false);
  }

  function togglePanel(force) {
    if (!enabled()) { notice('The Music Bench is turned off in Preferences.'); return; }
    const open = force ?? !document.body.classList.contains('music-open');
    if (open === document.body.classList.contains('music-open')) { if (open) focusList(); return; }
    if (open && window.NoorDock) NoorDock.opened('music'); // its dock area (another panel there makes room)
    document.body.classList.toggle('music-open', open);
    if (!open && window.NoorDock) NoorDock.closed('music');
    if (open) { start().then(() => { focusList(); followPlaying(true); }); }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function applyVisibility() {
    const prefs = hooks.getPrefs();
    document.body.classList.toggle('music-disabled', !enabled());
    document.documentElement.style.setProperty('--music-w', Math.min(640, Math.max(300, Number(prefs.musicWidth) || 400)) + 'px');
    if (!enabled()) { audio.pause(); document.body.classList.remove('music-open'); if (window.NoorDock) NoorDock.closed('music'); }
    $('#miniplayer').classList.toggle('hide', !enabled() || prefs.miniPlayer === false || currentId() == null);
  }

  function buildPanel() {
    const panel = $('#music');
    panel.innerHTML = '';
    panel.append(
      el('div', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '♫' }), el('strong', { text: 'Music Bench' }), el('small', { id: 'music-count' }), el('small', { id: 'music-selcount', class: 'music-selcount', 'aria-live': 'polite' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'music-dock', title: 'Where this panel goes (left, right, bottom) and layouts', 'aria-label': 'Move the Music Bench', onclick: (e) => NoorDock.showMenu('music', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Shift+M)', 'aria-label': 'Close Music Bench', onclick: () => togglePanel(false) }, '✕'))),
      buildNowPlaying(),
      el('div', { class: 'music-tabs', role: 'tablist' },
        ...[['library', 'Library'], ['queue', 'Up next'], ['playlists', 'Playlists'], ['sound', 'Sound']].map(([id, label]) =>
          el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', onclick: () => setTab(id) }, label))),
      el('div', { class: 'music-pane', 'data-pane': 'library' },
        el('div', { class: 'music-toolbar' },
          el('input', { id: 'music-search', type: 'search', placeholder: 'Search title, file, folder, genre…', 'aria-label': 'Search music', autocomplete: 'off', spellcheck: 'false' }),
          el('select', { id: 'music-sort', 'aria-label': 'Sort by' }, SORTS.map(([v, l]) => el('option', { value: v }, l))),
          el('button', { class: 'icon-btn', id: 'music-desc', title: 'Reverse order', 'aria-label': 'Reverse sort order' }, '⇅'),
          el('button', { class: 'icon-btn', id: 'music-locate', title: 'Show the playing song in the list', 'aria-label': 'Show the playing song in the list', onclick: () => revealPlaying() }, '◎')),
        el('div', { class: 'music-chips', id: 'music-chips' }),
        el('div', { class: 'music-viewbar', id: 'music-viewbar' }),
        el('div', { class: 'music-cols', id: 'music-cols', role: 'row', 'aria-label': 'Sort by column' }),
        el('div', { class: 'music-list', id: 'music-list', tabindex: '0', role: 'listbox', 'aria-label': 'Tracks' }, el('div', { class: 'music-spacer', id: 'music-spacer' })),
        el('div', { class: 'music-empty hide', id: 'music-empty' })),
      el('div', { class: 'music-pane hide', 'data-pane': 'queue' }, el('div', { class: 'music-queue', id: 'music-queue' })),
      el('div', { class: 'music-pane hide', 'data-pane': 'playlists' }, el('div', { class: 'music-playlists', id: 'music-playlists' })),
      el('div', { class: 'music-pane hide', 'data-pane': 'sound' }, el('div', { class: 'music-sound', id: 'music-sound' })),
      el('section', { class: 'music-side', id: 'music-side', 'aria-label': 'Up next' },
        el('h4', { class: 'music-subhead', text: 'Up next' }),
        el('div', { class: 'music-queue', id: 'music-side-queue' })),
      el('div', { class: 'music-foot' },
        el('span', { id: 'music-scan', class: 'music-scan' }),
        el('button', { class: 'utility-btn', onclick: showFolders }, '📁 Folders')),
    );
    let searchTimer;
    $('#music-search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setView({ search: e.target.value }), 180); });
    $('#music-search').addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); focusList(); } });
    $('#music-sort').addEventListener('change', (e) => setView({ sort: e.target.value }));
    $('#music-desc').addEventListener('click', () => setView({ desc: !view.desc }));
    const list = $('#music-list');
    list.addEventListener('scroll', () => requestAnimationFrame(renderList), { passive: true });
    // Browsing the list by hand: don't jump to the playing song for a while (see followPlaying).
    ['wheel', 'pointerdown', 'keydown', 'touchstart'].forEach((t) => list.addEventListener(t, () => { userBrowsedAt = Date.now(); }, { passive: true }));
    list.addEventListener('keydown', onListKey);
    // One delegated handler for all rows. Selecting must not rebuild the rows: a double-click needs both
    // clicks to land on the same element, and re-rendering between them would swallow it.
    list.addEventListener('click', (e) => {
      const node = e.target.closest('.track[data-index]');
      if (!node || e.target.closest('button')) return;
      clickSelect(Number(node.dataset.index), e.ctrlKey || e.metaKey, e.shiftKey);
    });
    list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const node = e.target.closest('.track[data-index]');
      if (!node) return;
      const i = Number(node.dataset.index);
      if (!sel.has(i)) clickSelect(i, false, false);
      list.focus({ preventScroll: true });
      showTrackMenu(e.clientX, e.clientY);
    });
    list.addEventListener('dblclick', (e) => {
      const node = e.target.closest('.track[data-index]');
      if (!node || e.target.closest('button')) return;
      playView(Number(node.dataset.index));
    });
    new ResizeObserver(() => requestAnimationFrame(renderList)).observe(list);
    // With room (in the middle) the bench spreads out: Now playing and Up next on the left, the library with columns on the right.
    new ResizeObserver(() => setWide(panel.clientWidth >= 900)).observe(panel);
    renderChips();
    renderColumns();

    // Its size is the dock's (dock.js), resized from the dock's inner edge.
  }

  function setWide(on) {
    if (on === wide) return;
    const list = $('#music-list');
    const topIndex = list ? Math.floor(list.scrollTop / rowH()) : 0;
    wide = on;
    $('#music').classList.toggle('wide', on);
    if (on && tab === 'queue') setTab('library'); // Up next is always shown on the left
    renderColumns();
    if (list) list.scrollTop = topIndex * rowH();
    renderList();
    renderQueue();
  }

  /** The column heads of the wide library: a click sorts by that column, a second click turns the order around. */
  function renderColumns() {
    const box = $('#music-cols');
    if (!box) return;
    box.replaceChildren(el('span', { class: 'track-state' }), ...COLUMNS.map(([label, key, cls]) => key
      ? el('button', { class: 'col ' + cls + (view.sort === key ? ' active' : ''), 'data-sort': key, title: key === 'triage' ? 'Sort by triage' : `Sort by ${label.toLowerCase()}`, 'aria-sort': view.sort === key ? (view.desc ? 'descending' : 'ascending') : 'none',
        onclick: () => setView(view.sort === key ? { desc: !view.desc } : { sort: key, desc: key === 'plays' || key === 'year' }) },
        (label || '★') + (view.sort === key ? (view.desc ? ' ▼' : ' ▲') : ''))
      : el('span', { class: 'col ' + cls, text: label })), el('span', { class: 'track-actions-space' }));
  }

  function setTab(id) {
    tab = id;
    // Only the Music Bench's own tabs and panes (the Video Bench reuses these class names).
    document.querySelectorAll('.music .music-tabs button[data-tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === id); b.setAttribute('aria-selected', String(b.dataset.tab === id)); });
    document.querySelectorAll('.music .music-pane[data-pane]').forEach((p) => p.classList.toggle('hide', p.dataset.pane !== id));
    if (id === 'queue') renderQueue();
    if (id === 'playlists') renderPlaylists();
    if (id === 'sound') renderSound();
    if (id === 'library') { requestAnimationFrame(renderList); followPlaying(true); }
  }

  function renderHeader() {
    const s = status.stats;
    $('#music-count').textContent = s ? `${s.total.toLocaleString()} tracks${s.missing ? ` · ${s.missing} missing` : ''}` : '';
    renderChips();
    const empty = $('#music-empty');
    const noFolders = !status.folders.length;
    empty.classList.toggle('hide', !noFolders);
    $('#music-list').classList.toggle('hide', noFolders);
    if (noFolders) {
      empty.replaceChildren(el('div', { class: 'music-empty-inner' },
        el('div', { class: 'big', text: '♫' }),
        el('p', {}, el('strong', { text: 'Your music, next to your writing.' })),
        el('p', { text: 'Add a folder of MP3, FLAC, WAV, OGG or M4A files. NoorMD only reads it — nothing is moved or changed until you edit a track yourself.' }),
        el('button', { class: 'action primary', onclick: addFolder }, '＋ Add music folder'),
        el('button', { class: 'action', onclick: importPlaylist }, 'Import playlist…')));
    }
  }

  function renderChips() {
    const box = $('#music-chips');
    if (!box) return;
    const s = status.stats || {};
    const counts = { all: s.total, 1: s.favorite, 2: s.keep, 3: s.maybe, 4: s.skip, 0: s.untriaged };
    const chip = (label, active, onclick, count) => el('button', { class: 'chip' + (active ? ' active' : ''), onclick }, label, count != null ? el('small', { text: ' ' + Number(count || 0).toLocaleString() }) : null);
    box.replaceChildren(...[
      chip('All', view.triage == null && !view.missingOnly, () => setView({ triage: null, missingOnly: false }), counts.all),
      ...TRIAGE.slice(1).concat(TRIAGE[0]).map((t) => chip(`${t.icon} ${t.short}`, view.triage === t.v, () => setView({ triage: view.triage === t.v ? null : t.v, missingOnly: false }), counts[t.v])),
      s.missing ? chip('⚠ Missing', view.missingOnly, () => setView({ missingOnly: !view.missingOnly, triage: null }), s.missing) : null,
    ].filter(Boolean));
  }

  function renderViewbar() {
    const bar = $('#music-viewbar');
    if (view.smartId) {
      const sc = (status.smart || []).find((x) => x.id === view.smartId);
      bar.classList.remove('hide');
      bar.replaceChildren(el('span', {}, '⚡ Smart: ', el('strong', { text: sc ? sc.name : '…' })),
        el('button', { class: 'utility-btn', onclick: () => playView(0) }, '▶ Play'),
        sc ? el('button', { class: 'utility-btn', onclick: () => editSmart(sc) }, '✎ Rules') : null,
        el('button', { class: 'utility-btn', onclick: () => setView({ smartId: null }) }, '✕ Close'));
      return;
    }
    if (!view.playlistId) { bar.replaceChildren(); bar.classList.add('hide'); return; }
    const pl = status.playlists.find((p) => p.id === view.playlistId);
    bar.classList.remove('hide');
    bar.replaceChildren(el('span', {}, '♪ Playlist: ', el('strong', { text: pl ? pl.name : '…' })),
      el('button', { class: 'utility-btn', onclick: () => playView(0) }, '▶ Play'),
      el('button', { class: 'utility-btn', onclick: () => setView({ playlistId: null, sort: 'title' }) }, '✕ Close'));
  }

  // ------------------------------------------------------------------ library list (virtualised)

  async function setView(patch) {
    view = { ...view, ...patch };
    if ('playlistId' in patch && patch.playlistId) { view.sort = 'playlist'; view.smartId = null; }
    if ('smartId' in patch && patch.smartId) { view.playlistId = null; if (view.sort === 'playlist') view.sort = 'title'; }
    $('#music-sort').value = view.sort === 'playlist' ? 'title' : view.sort;
    viewRows = new Map();
    viewGen++;
    selected = -1; sel = new Set(); anchor = -1;
    $('#music-list').scrollTop = 0;
    renderChips();
    renderColumns();
    renderViewbar();
    await loadView(true);
  }

  function queryPayload(offset, limit) {
    return { search: view.search, triage: view.triage, missingOnly: view.missingOnly, playlistId: view.playlistId, smartId: view.smartId, sort: view.sort, desc: view.desc, offset, limit };
  }

  async function loadView(resetScroll) {
    if (!status.folders.length && !view.playlistId) { renderList(); return; }
    await fetchPage(0);
    if (resetScroll) $('#music-list').scrollTop = 0;
    renderList();
  }

  async function fetchPage(offset) {
    const key = viewGen + ':' + offset;
    if (pending.has(key)) return;
    pending.add(key);
    const gen = viewGen;
    try {
      const r = await req('music.query', queryPayload(offset, PAGE));
      if (gen !== viewGen) return;
      view.total = r.total;
      r.rows.forEach((row, i) => { viewRows.set(offset + i, row); cache.set(row.id, row); });
    } catch (err) { hooks.showError(err); }
    finally { pending.delete(key); }
  }

  function renderList() {
    const list = $('#music-list');
    if (!list || list.offsetParent === null) return;
    const spacer = $('#music-spacer');
    spacer.style.height = view.total * rowH() + 'px';
    const first = Math.max(0, Math.floor(list.scrollTop / rowH()) - 5);
    const last = Math.min(view.total, Math.ceil((list.scrollTop + list.clientHeight) / rowH()) + 5);
    const missingPages = new Set();
    const nodes = [];
    for (let i = first; i < last; i++) {
      const row = viewRows.get(i);
      if (!row) { missingPages.add(Math.floor(i / PAGE) * PAGE); nodes.push(el('div', { class: 'track loading', style: `top:${i * rowH()}px` }, el('span', { class: 'muted', text: '…' }))); continue; }
      nodes.push(trackRow(row, i));
    }
    spacer.replaceChildren(...nodes);
    for (const off of missingPages) fetchPage(off).then(() => requestAnimationFrame(renderList));
    if (!view.total && status.folders.length) spacer.replaceChildren(el('div', { class: 'music-none', text: view.search ? 'No tracks match your search.' : 'No tracks here yet.' }));
  }

  function trackRow(row, i) {
    const playing = row.id === currentId();
    const t = TRIAGE[row.triage] || TRIAGE[0];
    if (wide) return el('div', {
      class: 'track wide-row' + (sel.has(i) ? ' selected' : '') + (i === selected ? ' cursor' : '') + (playing ? ' playing' : '') + (row.missing ? ' missing' : ''),
      style: `top:${i * rowH()}px`, role: 'option', 'aria-selected': String(sel.has(i)), 'data-index': String(i), 'data-id': String(row.id),
      title: row.folder + '\\' + row.fileName + (row.missing ? '\nMissing on disk' : row.readError ? '\nTags unreadable' : ''),
    },
    el('span', { class: 'track-state', text: playing ? (audio.paused ? '❚❚' : '▶') : '' }),
    el('span', { class: 'track-title c-title', text: row.displayTitle }),
    el('span', { class: 'c-artist', text: row.artist || '' }),
    el('span', { class: 'c-album', text: row.album || '' }),
    el('span', { class: 'c-genre', text: row.genre || '' }),
    el('span', { class: 'c-year', text: row.year ? String(row.year) : '' }),
    el('span', { class: 'track-triage c-triage t' + row.triage, title: t.label, text: row.triage ? t.icon : '' }),
    el('span', { class: 'c-plays', text: row.plays ? String(row.plays) : '' }),
    el('span', { class: 'track-time c-time', text: fmt(row.duration) }),
    el('span', { class: 'track-actions' },
      el('button', { class: 'icon-btn', title: 'Play next', 'aria-label': 'Play next', onclick: (e) => { e.stopPropagation(); playNext([row.id]); } }, '⤵'),
      el('button', { class: 'icon-btn', title: 'Add to Up next', 'aria-label': 'Add to queue', onclick: (e) => { e.stopPropagation(); enqueue([row.id]); } }, '＋'),
      el('button', { class: 'icon-btn', title: 'Add to playlist', 'aria-label': 'Add to playlist', onclick: (e) => { e.stopPropagation(); addToPlaylist([row.id]); } }, '♪')));
    const node = el('div', {
      class: 'track' + (sel.has(i) ? ' selected' : '') + (i === selected ? ' cursor' : '') + (playing ? ' playing' : '') + (row.missing ? ' missing' : ''),
      style: `top:${i * rowH()}px`, role: 'option', 'aria-selected': String(sel.has(i)), 'data-index': String(i), 'data-id': String(row.id),
      title: row.folder + '\\' + row.fileName,
    },
    el('span', { class: 'track-state', text: playing ? (audio.paused ? '❚❚' : '▶') : '' }),
    el('span', { class: 'track-main' },
      el('span', { class: 'track-title', text: row.displayTitle }),
      el('small', { text: [row.artist, row.title ? row.fileName : row.folder.split(/[\\/]/).pop()].filter(Boolean).join(' · ') + (row.missing ? ' · missing on disk' : row.readError ? ' · tags unreadable' : '') })),
    el('span', { class: 'track-triage t' + row.triage, title: t.label, text: row.triage ? t.icon : '' }),
    el('span', { class: 'track-time', text: fmt(row.duration) }),
    el('span', { class: 'track-actions' },
      el('button', { class: 'icon-btn', title: 'Play next', 'aria-label': 'Play next', onclick: (e) => { e.stopPropagation(); playNext([row.id]); } }, '⤵'),
      el('button', { class: 'icon-btn', title: 'Add to Up next', 'aria-label': 'Add to queue', onclick: (e) => { e.stopPropagation(); enqueue([row.id]); } }, '＋'),
      el('button', { class: 'icon-btn', title: 'Add to playlist', 'aria-label': 'Add to playlist', onclick: (e) => { e.stopPropagation(); addToPlaylist([row.id]); } }, '♪')));
    return node;
  }

  function updateSelection() {
    document.querySelectorAll('#music-list .track[data-index]').forEach((n) => {
      const i = Number(n.dataset.index);
      n.classList.toggle('selected', sel.has(i));
      n.classList.toggle('cursor', i === selected);
      n.setAttribute('aria-selected', String(sel.has(i)));
    });
    const count = $('#music-selcount');
    if (count) count.textContent = sel.size > 1 ? `${sel.size.toLocaleString()} selected` : '';
  }

  /** Click: one row. Ctrl+click: add/remove a row. Shift+click: the range from the last clicked row. */
  function clickSelect(i, toggleOne, range) {
    if (range && anchor >= 0) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      if (!toggleOne) sel = new Set();
      for (let k = a; k <= b; k++) sel.add(k);
    } else if (toggleOne) {
      if (sel.has(i)) sel.delete(i); else sel.add(i);
      anchor = i;
    } else {
      sel = new Set([i]);
      anchor = i;
    }
    selected = i;
    updateSelection();
  }

  function selectAll() {
    sel = new Set(Array.from({ length: view.total }, (_, k) => k));
    if (selected < 0 && view.total) selected = 0;
    updateSelection();
    notice(`${view.total.toLocaleString()} tracks selected`, 1200);
  }

  /** Track ids of the selection, in list order. Rows not loaded yet are looked up for the whole view. */
  async function selectedIds() {
    const idx = (sel.size ? [...sel] : selected >= 0 ? [selected] : []).sort((a, b) => a - b);
    if (!idx.length) return [];
    if (idx.every((k) => viewRows.has(k))) return idx.map((k) => viewRows.get(k).id);
    const all = await req('music.ids', queryPayload(0, 2000));
    return idx.map((k) => all[k]).filter((id) => id != null);
  }

  async function withSelection(fn) {
    let ids;
    try { ids = await selectedIds(); } catch (err) { hooks.showError(err); return; }
    if (ids.length) await fn(ids);
  }

  async function removeFromPlaylist(ids) {
    const pl = status.playlists.find((p) => p.id === view.playlistId);
    if (!pl) return;
    try {
      const current = await req('music.ids', { playlistId: pl.id, sort: 'playlist' });
      // One entry per selected row: a track that is in the playlist twice keeps its other place.
      for (const id of ids) { const at = current.indexOf(id); if (at >= 0) current.splice(at, 1); }
      await req('music.playlist.setItems', { id: pl.id, ids: current });
      notice(`Removed ${ids.length} track${ids.length === 1 ? '' : 's'} from “${pl.name}” (the files are not touched)`, 2200);
      await refreshStatus(false);
      sel = new Set(); anchor = -1;
      viewRows = new Map(); viewGen++;
      await loadView(false);
    } catch (err) { hooks.showError(err); }
  }

  async function copyLines(ids, kind) {
    try {
      await loadTracks(ids);
      const rows = ids.map((id) => cache.get(id)).filter(Boolean);
      const text = rows.map((r) => (kind === 'path' ? r.folder + '\\' + r.fileName : [r.artist, r.displayTitle].filter(Boolean).join(' – '))).join('\n');
      await req('clipboard.copyText', { text });
      notice(`Copied ${rows.length} ${kind === 'path' ? 'file path' : 'title'}${rows.length === 1 ? '' : 's'}`, 1500);
    } catch (err) { hooks.showError(err); }
  }

  /** Right-click menu for the selected tracks. */
  function showTrackMenu(x, y) {
    const n = sel.size || (selected >= 0 ? 1 : 0);
    if (!n) return;
    const many = n > 1;
    const one = !many ? viewRows.get(selected) : null;
    const plural = (w) => (many ? `${n.toLocaleString()} ${w}s` : w);
    const inPlaylist = view.playlistId ? status.playlists.find((p) => p.id === view.playlistId) : null;
    const items = [
      { label: many ? `Play these ${n.toLocaleString()} tracks` : 'Play', run: () => (many ? withSelection((ids) => setQueue(ids, q.shuffle ? Math.floor(Math.random() * ids.length) : 0, true)) : playView(selected)) },
      { label: 'Play next', run: () => withSelection(playNext) },
      { label: 'Add to Up next', run: () => withSelection(enqueue) },
      '-',
      { label: 'Add to playlist', sub: () => [
        ...status.playlists.filter((p) => !inPlaylist || p.id !== inPlaylist.id).map((p) => ({ label: `${p.name}  (${p.count})`, run: () => withSelection(async (ids) => {
          try { status.playlists = await req('music.playlist.add', { id: p.id, ids }); notice(`Added ${plural('track')} to “${p.name}”`, 1600); renderPlaylists(); } catch (err) { hooks.showError(err); }
        }) })),
        ...(status.playlists.length ? ['-'] : []),
        { label: 'New playlist…', run: () => withSelection((ids) => createPlaylist(ids)) },
      ] },
      inPlaylist ? { label: `Remove from “${inPlaylist.name}”`, run: () => withSelection(removeFromPlaylist) } : null,
      '-',
      { label: 'Mark as', sub: () => [
        ...TRIAGE.slice(1).map((t) => ({ label: `${t.icon}  ${t.label}`, run: () => withSelection((ids) => setTriage(ids, t.v)) })),
        '-', { label: 'Clear mark', run: () => withSelection((ids) => setTriage(ids, 0)) },
      ] },
      { label: many ? `Edit ${n.toLocaleString()} tracks… (Batch Organizer)` : 'Edit track…', run: () => (many ? withSelection((ids) => batchOrganizer(ids)) : one && editTrack(one.id)) },
      '-',
      { label: 'Show in Explorer', disabled: many || !one, run: () => one && req('music.reveal', { id: one.id }).catch(hooks.showError) },
      { label: 'Show artwork', disabled: many || !one, run: () => { if (one) { cache.set(one.id, { ...(cache.get(one.id) || {}), ...one }); showArtwork(one.id); } } },
      { label: 'Measure loudness', run: () => withSelection((ids) => measure(ids, { label: 'the selection' })) },
      { label: many ? 'Copy titles' : 'Copy title', run: () => withSelection((ids) => copyLines(ids, 'title')) },
      { label: many ? 'Copy file paths' : 'Copy file path', run: () => withSelection((ids) => copyLines(ids, 'path')) },
      '-',
      { label: 'Select all', run: selectAll },
    ].filter(Boolean);
    NoorChrome.openMenu(null, items, { x, y });
  }

  function focusList() { const l = $('#music-list'); if (l && !l.classList.contains('hide')) l.focus({ preventScroll: true }); }

  function selectIndex(i, extend) {
    if (!view.total) return;
    selected = Math.max(0, Math.min(view.total - 1, i));
    if (extend) {
      if (anchor < 0) anchor = selected;
      sel = new Set();
      for (let k = Math.min(anchor, selected); k <= Math.max(anchor, selected); k++) sel.add(k);
    } else { sel = new Set([selected]); anchor = selected; }
    const list = $('#music-list');
    const top = selected * rowH();
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + rowH() > list.scrollTop + list.clientHeight) list.scrollTop = top + rowH() - list.clientHeight;
    renderList();
  }

  function onListKey(e) {
    const row = viewRows.get(selected);
    const page = Math.max(1, Math.floor($('#music-list').clientHeight / rowH()) - 1);
    const map = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if (map[e.key] != null && !e.ctrlKey && !e.altKey) { e.preventDefault(); selectIndex((selected < 0 ? -1 : selected) + map[e.key], e.shiftKey); return; }
    if (e.key === 'Home' && !e.ctrlKey) { e.preventDefault(); selectIndex(0, e.shiftKey); return; }
    if (e.key === 'End' && !e.ctrlKey) { e.preventDefault(); selectIndex(view.total - 1, e.shiftKey); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); selectAll(); return; }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault(); e.stopPropagation();
      const node = document.querySelector(`#music-list .track[data-index="${selected}"]`);
      const r = (node || $('#music-list')).getBoundingClientRect();
      showTrackMenu(r.left + 40, r.top + rowH());
      return;
    }
    if (e.key === 'Escape' && sel.size > 1) { e.preventDefault(); e.stopPropagation(); sel = new Set(selected >= 0 ? [selected] : []); anchor = selected; updateSelection(); return; }
    if (!row || e.ctrlKey || e.altKey || e.metaKey) return;
    const multi = sel.size > 1;
    if (e.key === 'Enter') { e.preventDefault(); if (multi) withSelection((ids) => setQueue(ids, 0, true)); else playView(selected); }
    else if (/^[0-4]$/.test(e.key)) { e.preventDefault(); withSelection((ids) => setTriage(ids, Number(e.key))); }
    else if (e.key.toLowerCase() === 'q') { e.preventDefault(); withSelection(enqueue); }
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); withSelection(playNext); }
    else if (e.key === 'Delete' && view.playlistId) { e.preventDefault(); withSelection(removeFromPlaylist); }
    else if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); editTrack(row.id); }
  }

  // ------------------------------------------------------------------ queue & playback

  function shuffledOrder(n, keepFirst) {
    const order = [...Array(n).keys()].filter((i) => i !== keepFirst);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return keepFirst != null && keepFirst >= 0 ? [keepFirst, ...order] : order;
  }

  /** Scrolls the list to the song that is playing and selects it (if it is in the current view). */
  let userBrowsedAt = 0, followGen = 0;
  const isOpen = () => document.body.classList.contains('music-open');

  /**
   * Keeps the playing song visible in the list when it changes (it is highlighted there). Not while the user is
   * browsing the list or has picked several tracks, and the selection is never changed.
   */
  async function followPlaying(force = false) {
    const id = currentId();
    if (id == null || !isOpen() || tab !== 'library') return;
    if (!force && (Date.now() - userBrowsedAt < 10000 || sel.size > 1)) return;
    const gen = ++followGen;
    let ids;
    try { ids = await req('music.ids', queryPayload(0, 2000)); } catch { return; }
    if (gen !== followGen || currentId() !== id) return;
    const i = ids.indexOf(id);
    if (i < 0) return;
    const list = $('#music-list');
    if (!list) return;
    const top = i * rowH(), bottom = top + rowH();
    if (top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight) return; // already visible
    list.scrollTop = Math.max(0, top - list.clientHeight / 2 + rowH() / 2);
    requestAnimationFrame(renderList);
  }

  async function revealPlaying() {
    const id = currentId();
    if (id == null) { notice('Nothing is playing.'); return; }
    let ids;
    try { ids = await req('music.ids', queryPayload(0, 2000)); } catch (err) { hooks.showError(err); return; }
    const i = ids.indexOf(id);
    if (i < 0) { notice('The playing song is not in this view (search, filter or playlist).', 3000); return; }
    setTab('library');
    const list = $('#music-list');
    list.scrollTop = Math.max(0, i * rowH() - list.clientHeight / 2 + rowH() / 2);
    selected = i; sel = new Set([i]); anchor = i;
    requestAnimationFrame(() => { renderList(); updateSelection(); });
  }

  async function playView(index) {
    let ids;
    try { ids = await req('music.ids', queryPayload(0, 2000)); } catch (err) { hooks.showError(err); return; }
    if (!ids.length) return;
    const startId = viewRows.get(index)?.id;
    const startIdx = Math.max(0, startId != null ? ids.indexOf(startId) : index);
    setQueue(ids, startIdx, true);
  }

  async function setQueue(ids, startIndex, autoplay) {
    consecutiveErrors = 0;
    q.ids = ids.slice();
    q.order = q.shuffle ? shuffledOrder(ids.length, startIndex) : ids.map((_, i) => i);
    q.pos = q.order.indexOf(startIndex);
    await loadTracks(upcomingIds(200));
    loadCurrent(autoplay);
    scheduleSave();
  }

  function upcomingIds(n) { return q.order.slice(Math.max(0, q.pos), q.pos + n).map((i) => q.ids[i]); }

  async function loadTracks(ids) {
    const need = ids.filter((id) => id != null && !cache.has(id));
    if (!need.length) return;
    try { (await req('music.tracks', { ids: need })).forEach((r) => cache.set(r.id, r)); } catch { /* shown when playing */ }
  }

  function loadCurrent(autoplay) {
    const id = currentId();
    if (id == null) { audio.removeAttribute('src'); audio.load(); renderAll(); return; }
    audio.src = `_media/${id}?v=${mediaVersion}`;
    applyTrackGain(id);
    if (autoplay) audio.play().catch((err) => { if (err.name !== 'AbortError') console.warn(err); });
    renderAll();
    updateMediaSession();
    loadTracks(upcomingIds(50));
    followPlaying();
  }

  function onLoaded() {
    if (restorePosition != null) { try { audio.currentTime = Math.min(restorePosition, audio.duration || restorePosition); } catch { } restorePosition = null; }
    renderTransport();
  }

  function onTime() {
    renderTime();
    emitNowPlaying(false);
    if (!audio.paused && Math.floor(audio.currentTime) % 5 === 0) scheduleSave();
  }

  /** Releases the current file (before it is renamed/re-tagged). The browser then reports an "empty src"
   *  error asynchronously — that is expected and must not count as a playback failure. */
  function releaseFile() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function onError() {
    const id = currentId();
    if (id == null || !audio.getAttribute('src')) return;
    const err = audio.error;
    if (err && /empty src/i.test(err.message || '')) return;
    if (!audio.currentSrc || !audio.currentSrc.includes(`/_media/${id}?v=${mediaVersion}`)) return; // stale error from a previous source
    const row = cache.get(id);
    consecutiveErrors++;
    notice(`Can't play “${row ? row.displayTitle : 'track'}” (missing, moved or unsupported). ${consecutiveErrors < q.order.length ? 'Skipping…' : ''}`, 3500);
    if (consecutiveErrors >= Math.min(q.order.length, 25)) { audio.pause(); consecutiveErrors = 0; return; }
    setTimeout(() => next(true, true), 700);
  }

  function next(auto, afterError) {
    if (!q.order.length) return;
    if (auto && !afterError && q.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    let pos = q.pos + 1;
    if (pos >= q.order.length) {
      // Shuffle never runs dry: at the end it reshuffles and keeps playing random songs (repeat one/off aside).
      if (q.repeat === 'all' || !auto || (q.shuffle && q.ids.length > 1)) {
        if (q.shuffle) { const last = q.order[q.pos]; q.order = shuffledOrder(q.ids.length, -1); if (q.order[0] === last && q.order.length > 1) q.order.push(q.order.shift()); }
        pos = 0;
      } else { audio.pause(); audio.currentTime = 0; renderAll(); scheduleSave(); return; }
    }
    q.pos = pos;
    loadCurrent(true);
    scheduleSave();
  }

  function prev() {
    if (!q.order.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    q.pos = q.pos > 0 ? q.pos - 1 : (q.repeat === 'all' ? q.order.length - 1 : 0);
    loadCurrent(true);
    scheduleSave();
  }

  function toggle() {
    if (currentId() == null) {
      if (view.total) playView(selected >= 0 ? selected : 0);
      else { togglePanel(true); notice('Choose a track in the Music Bench to start.'); }
      return;
    }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }

  function seek(seconds) { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration - 0.25, seconds)); }

  function setShuffle(on) {
    const cur = q.pos >= 0 ? q.order[q.pos] : 0;
    q.shuffle = on;
    q.order = on ? shuffledOrder(q.ids.length, cur) : q.ids.map((_, i) => i);
    q.pos = q.order.indexOf(cur);
    notice(on ? 'Shuffle on' : 'Shuffle off', 1200);
    renderAll(); scheduleSave();
  }

  /**
   * Jumps to a random track. The queue becomes the whole current library view (or the whole library when the
   * view is empty), so every song can come up — not just the ones already queued. Shuffle stays as it was.
   */
  async function playRandom() {
    if (!enabled()) return;
    await start();
    let ids;
    try { ids = await req('music.ids', queryPayload(0, 2000)); } catch (err) { hooks.showError(err); return; }
    if (!ids.length && (view.search || view.triage != null || view.playlistId)) {
      try { ids = await req('music.ids', { search: '', triage: null, missingOnly: false, playlistId: null, sort: 'title', desc: false, offset: 0, limit: 2000 }); } catch { ids = []; }
    }
    if (!ids.length) { togglePanel(true); notice('Add a music folder first.'); return; }
    const cur = currentId();
    let pick = Math.floor(Math.random() * ids.length);
    if (ids.length > 1 && ids[pick] === cur) pick = (pick + 1 + Math.floor(Math.random() * (ids.length - 1))) % ids.length;
    await setQueue(ids, pick, true);
    const row = cache.get(ids[pick]);
    notice('🎲 ' + (row ? row.displayTitle : 'Random track'), 1600);
  }

  function cycleRepeat() {
    q.repeat = { off: 'all', all: 'one', one: 'off' }[q.repeat];
    notice({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat this track' }[q.repeat], 1200);
    renderAll(); scheduleSave();
  }

  function setVolume(v) { q.volume = Math.max(0, Math.min(1, v)); audio.volume = q.volume; audio.muted = false; renderTransport(); scheduleSave(); }

  function enqueue(ids) {
    const fresh = ids.filter((id) => !upcomingIds(Infinity).includes(id)); // no accidental duplicates in Up next
    if (!fresh.length) { notice('Already in Up next', 1200); return; }
    const startPlaying = currentId() == null;
    for (const id of fresh) { q.ids.push(id); q.order.push(q.ids.length - 1); }
    if (startPlaying) { q.pos = 0; loadCurrent(true); }
    loadTracks(fresh);
    notice(fresh.length === 1 ? 'Added to Up next' : `${fresh.length} tracks added to Up next`, 1400);
    renderQueue(); scheduleSave();
  }

  function playNext(ids) {
    if (currentId() == null) { enqueue(ids); return; }
    const at = q.pos + 1;
    ids.forEach((id, k) => { q.ids.push(id); q.order.splice(at + k, 0, q.ids.length - 1); });
    loadTracks(ids);
    notice('Plays next', 1200);
    renderQueue(); scheduleSave();
  }

  /** Drops queue entries no longer in the play order, so shuffle on/off or a reshuffle can't bring removed songs back. */
  function compactQueue() {
    const keep = new Set(q.order);
    const remap = new Map();
    const ids = [];
    q.ids.forEach((id, i) => { if (keep.has(i)) { remap.set(i, ids.length); ids.push(id); } });
    q.ids = ids;
    q.order = q.order.map((i) => remap.get(i));
  }

  function removeFromQueue(orderPos) {
    if (orderPos === q.pos) { notice('That track is playing. Skip it first.', 1600); return; }
    q.order.splice(orderPos, 1);
    if (orderPos < q.pos) q.pos--;
    compactQueue();
    renderQueue(); scheduleSave();
  }

  function moveInQueue(orderPos, delta) {
    const to = orderPos + delta;
    if (to <= q.pos || to >= q.order.length || orderPos <= q.pos) return;
    [q.order[orderPos], q.order[to]] = [q.order[to], q.order[orderPos]];
    renderQueue(); scheduleSave();
  }

  function clearUpcoming() { q.order = q.order.slice(0, q.pos + 1); compactQueue(); renderQueue(); scheduleSave(); }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 900);
  }

  function saveSession() {
    if (!started) return;
    // Keep the saved session compact: drop ids no longer referenced by the order.
    const used = [...new Set(q.order)].sort((a, b) => a - b);
    const remap = new Map(used.map((old, i) => [old, i]));
    const ids = used.map((i) => q.ids[i]);
    const order = q.order.map((i) => remap.get(i));
    const json = JSON.stringify({ v: 1, ids, order, pos: q.pos, shuffle: q.shuffle, repeat: q.repeat, volume: q.volume, position: audio.currentTime || 0, fx: NoorFx.settings });
    req('music.session.save', { json }).catch(() => {});
  }

  // ------------------------------------------------------------------ triage

  async function setTriage(ids, value) {
    if (!ids.length) return;
    try { status.stats = await req('music.setTriage', { ids, value }); } catch (err) { hooks.showError(err); return; }
    ids.forEach((id) => { const r = cache.get(id); if (r) r.triage = value; });
    for (const [i, r] of viewRows) if (ids.includes(r.id)) viewRows.set(i, { ...r, triage: value });
    const t = TRIAGE[value];
    notice(value ? `${t.icon} ${t.label}` : 'Triage cleared', 1100);
    renderChips(); renderList(); renderTransport();
  }

  function triageCurrent(value) {
    const id = currentId();
    if (id == null) { notice('Nothing is playing.', 1200); return; }
    setTriage([id], value);
  }

  // ------------------------------------------------------------------ now playing / mini player

  function buildNowPlaying() {
    const tr = (cls, label, title, fn) => el('button', { class: 'tp ' + cls, title, 'aria-label': title, onclick: fn }, label);
    return el('section', { class: 'nowplaying', id: 'nowplaying', 'aria-label': 'Now playing' },
      el('div', { class: 'np-top' },
        el('button', { class: 'np-art', id: 'np-art', title: 'Show artwork', 'aria-label': 'Show artwork', onclick: () => currentId() != null && showArtwork(currentId()) }, el('span', { text: '♫' })),
        el('div', { class: 'np-text' },
          el('div', { class: 'np-title', id: 'np-title', text: 'Nothing playing', title: 'Show in the list', onclick: () => revealPlaying() }),
          el('div', { class: 'np-sub', id: 'np-sub', text: 'Pick a track and press Enter' }),
          el('div', { class: 'np-file', id: 'np-file' }))),
      el('div', { class: 'np-seek' },
        el('span', { id: 'np-cur', text: '0:00' }),
        el('input', { type: 'range', id: 'np-range', min: '0', max: '1000', value: '0', 'aria-label': 'Seek' }),
        el('span', { id: 'np-dur', text: '0:00' })),
      el('div', { class: 'np-controls' },
        tr('shuffle', '⇄', 'Shuffle: play the queue in random order', () => setShuffle(!q.shuffle)),
        tr('random', '🎲', 'Jump to a random track (Ctrl+Alt+R)', () => playRandom()),
        tr('prev', '⏮', 'Previous (Ctrl+Alt+←)', prev),
        tr('play', '▶', 'Play / pause (Ctrl+Alt+Space)', toggle),
        tr('next', '⏭', 'Next (Ctrl+Alt+→)', () => next(false)),
        tr('repeat', '↻', 'Repeat', cycleRepeat),
        el('input', { type: 'range', class: 'np-volume', id: 'np-volume', min: '0', max: '100', value: '80', 'aria-label': 'Volume' })),
      el('div', { class: 'np-triage', role: 'group', 'aria-label': 'Triage current track' },
        ...TRIAGE.slice(1).map((t) => el('button', { class: 'chip t' + t.v, 'data-triage': String(t.v), title: `${t.label} (Alt+${t.v})`, onclick: () => triageCurrent(currentTriage() === t.v ? 0 : t.v) }, `${t.icon} ${t.short}`)),
        el('button', { class: 'action primary np-edit', title: 'Edit current track (F2)', onclick: () => editCurrent() }, '✎ Edit track')));
  }

  function buildMiniPlayer() {
    const mp = $('#miniplayer');
    const b = (label, title, fn, cls = '') => el('button', { class: 'icon-btn ' + cls, title, 'aria-label': title, onclick: fn }, label);
    mp.replaceChildren(
      el('div', { class: 'mp-art', id: 'mp-art', 'aria-hidden': 'true' }, el('span', { text: '♫' })),
      el('div', { class: 'mp-text' }, el('div', { class: 'mp-title', id: 'mp-title' }), el('div', { class: 'mp-sub', id: 'mp-sub' })),
      b('⇄', 'Shuffle', () => setShuffle(!q.shuffle), 'mp-shuffle'), b('⏮', 'Previous', prev), b('▶', 'Play / pause', toggle, 'mp-play'), b('⏭', 'Next', () => next(false)),
      b('🎲', 'Jump to a random track (Ctrl+Alt+R)', () => playRandom(), 'mp-random'),
      el('span', { class: 'mp-time', id: 'mp-cur', text: '0:00' }),
      el('input', { type: 'range', id: 'mp-range', min: '0', max: '1000', value: '0', 'aria-label': 'Seek' }),
      el('span', { class: 'mp-time', id: 'mp-dur', text: '0:00' }),
      el('span', { class: 'mp-triage', id: 'mp-triage' }),
      b('✎', 'Edit current track (F2)', () => editCurrent()),
      b('♫', 'Open Music Bench (Ctrl+Shift+M)', () => togglePanel()),
      b('✕', 'Hide mini-player (keeps playing)', () => { hooks.setPrefs({ miniPlayer: false }); applyVisibility(); notice('Mini-player hidden — show it again from Preferences or the command palette', 3000); }));
    for (const id of ['#np-range', '#mp-range']) {
      const r = $(id);
      r.addEventListener('input', () => { r.dataset.dragging = '1'; });
      r.addEventListener('change', () => { delete r.dataset.dragging; if (Number.isFinite(audio.duration)) seek((r.value / 1000) * audio.duration); });
    }
    $('#np-volume').addEventListener('input', (e) => setVolume(e.target.value / 100));
  }

  const currentTriage = () => cache.get(currentId())?.triage ?? 0;

  function renderAll() { renderTransport(); renderTime(); renderList(); renderQueue(); applyVisibility(); }

  let lastEmit = { key: '', at: 0 };
  /** Tells the Stream Desk what is playing (for the OBS overlay, now-playing.txt and the stream tracklist). */
  function emitNowPlaying(force) {
    if (!hooks.onNowPlaying) return;
    const id = currentId();
    const row = id != null ? cache.get(id) : null;
    const key = `${id}|${audio.paused}|${row ? row.displayTitle : ''}`;
    const now = Date.now();
    if (!force && key === lastEmit.key && now - lastEmit.at < 5000) return;
    lastEmit = { key, at: now };
    hooks.onNowPlaying(row ? { id, title: row.displayTitle || row.fileName, artist: row.artist || null, hasArt: !!row.hasArt, playing: !audio.paused, position: audio.currentTime || 0, duration: Number.isFinite(audio.duration) ? audio.duration : row.duration || 0, art: row.hasArt ? `_art/${id}?v=${mediaVersion}` : null } : null);
  }

  function renderTransport() {
    emitNowPlaying(false);
    const id = currentId();
    const row = id != null ? cache.get(id) : null;
    const title = row ? row.displayTitle : id != null ? 'Loading…' : 'Nothing playing';
    const sub = row ? [row.artist, row.album].filter(Boolean).join(' — ') || (row.title ? '' : 'No title tag — showing the file name') : '';
    $('#np-title').textContent = title;
    $('#np-sub').textContent = sub;
    $('#np-file').textContent = row ? row.fileName : '';
    $('#np-file').title = row ? row.folder + '\\' + row.fileName : '';
    $('#mp-title').textContent = title;
    $('#mp-sub').textContent = row ? (row.artist || row.fileName) : '';
    const icon = audio.paused ? '▶' : '❚❚';
    document.querySelectorAll('.tp.play, .mp-play').forEach((b) => { b.textContent = icon; b.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause'); });
    window.dispatchEvent(new Event('noor-music'));
    document.querySelectorAll('.tp.shuffle, .mp-shuffle').forEach((b) => { b.classList.toggle('on', q.shuffle); b.setAttribute('aria-pressed', String(q.shuffle)); b.title = q.shuffle ? 'Shuffle is on — click to play in order' : 'Shuffle is off — click to play in random order'; });
    document.querySelectorAll('.tp.repeat').forEach((b) => { b.classList.toggle('on', q.repeat !== 'off'); b.textContent = q.repeat === 'one' ? '↻¹' : '↻'; b.title = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this track' }[q.repeat]; });
    const tri = currentTriage();
    document.querySelectorAll('.np-triage .chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.triage) === tri));
    $('#mp-triage').textContent = tri ? TRIAGE[tri].icon : '';
    $('#np-volume').value = String(Math.round(q.volume * 100));
    for (const sel of ['#np-art', '#mp-art']) {
      const box = $(sel);
      const want = row && row.hasArt ? `_art/${row.id}?v=${mediaVersion}` : null;
      const key = want || (row ? 'ph:' + row.id + ':' + (row.displayTitle || '') : '');
      if (box.dataset.src === key) continue;
      box.dataset.src = key;
      box.replaceChildren(want ? el('img', { src: want, alt: '', onerror: (e) => e.target.replaceWith(artPlaceholder(row)) }) : artPlaceholder(row));
    }
    document.querySelectorAll('#music-list .track').forEach((n) => {
      const isCur = Number(n.dataset.id) === id;
      n.classList.toggle('playing', isCur);
      const s = n.querySelector('.track-state');
      if (s) s.textContent = isCur ? (audio.paused ? '❚❚' : '▶') : '';
    });
    document.title = id != null && !audio.paused ? `▶ ${title}` : 'NoorMD';
  }

  function renderTime() {
    const d = audio.duration, c = audio.currentTime;
    for (const [cur, dur, range] of [['#np-cur', '#np-dur', '#np-range'], ['#mp-cur', '#mp-dur', '#mp-range']]) {
      $(cur).textContent = fmt(c);
      $(dur).textContent = fmt(d);
      const r = $(range);
      if (!r.dataset.dragging) r.value = Number.isFinite(d) && d > 0 ? String(Math.round((c / d) * 1000)) : '0';
    }
  }

  function renderQueue() {
    for (const box of [tab === 'queue' ? $('#music-queue') : null, wide ? $('#music-side-queue') : null]) if (box) fillQueue(box);
  }

  function fillQueue(box) {
    if (!q.order.length) { box.replaceChildren(el('p', { class: 'music-none', text: 'Up next is empty. Double-click a track, or use ＋ to add tracks.' })); return; }
    const from = Math.max(0, q.pos - 3), to = Math.min(q.order.length, q.pos + 150);
    const items = [];
    for (let p = from; p < to; p++) {
      const id = q.ids[q.order[p]];
      const row = cache.get(id);
      items.push(el('div', { class: 'qitem' + (p === q.pos ? ' current' : p < q.pos ? ' past' : '') },
        el('span', { class: 'qpos', text: p === q.pos ? '▶' : String(p - q.pos) }),
        el('span', { class: 'qtitle', text: row ? row.displayTitle : '…', title: row ? row.fileName : '' }),
        el('span', { class: 'track-time', text: row ? fmt(row.duration) : '' }),
        p > q.pos ? el('span', { class: 'qactions' },
          el('button', { class: 'icon-btn', title: 'Play now', 'aria-label': 'Play now', onclick: () => { q.pos = p; loadCurrent(true); scheduleSave(); } }, '▶'),
          el('button', { class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', onclick: () => moveInQueue(p, -1) }, '↑'),
          el('button', { class: 'icon-btn', title: 'Move down', 'aria-label': 'Move down', onclick: () => moveInQueue(p, 1) }, '↓'),
          el('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove from queue', onclick: () => removeFromQueue(p) }, '✕')) : el('span')));
    }
    box.replaceChildren(
      el('div', { class: 'music-viewbar' }, el('span', { text: `${q.order.length - q.pos - 1} upcoming · ${q.shuffle ? 'shuffled' : 'in order'} · repeat ${q.repeat}` }),
        el('button', { class: 'utility-btn', onclick: saveQueueAsPlaylist }, 'Save as playlist'),
        el('button', { class: 'utility-btn danger', onclick: clearUpcoming }, 'Clear upcoming')),
      ...items, ...(to < q.order.length ? [el('p', { class: 'music-none', text: `…and ${q.order.length - to} more` })] : []));
  }

  // ------------------------------------------------------------------ playlists

  function renderPlaylists() {
    const box = $('#music-playlists');
    if (!box) return;
    const items = status.playlists.map((p) => el('div', { class: 'qitem' },
      el('span', { class: 'qpos', text: '♪' }),
      el('button', { class: 'qtitle linkish', onclick: () => { setTab('library'); setView({ playlistId: p.id, search: '', triage: null, missingOnly: false }); } }, `${p.name}`),
      el('small', { text: `${p.count} tracks` }),
      el('span', { class: 'qactions' },
        el('button', { class: 'icon-btn', title: 'Play', 'aria-label': `Play ${p.name}`, onclick: () => playPlaylist(p.id) }, '▶'),
        el('button', { class: 'icon-btn', title: 'Rename', 'aria-label': 'Rename', onclick: () => renamePlaylist(p) }, '✎'),
        el('button', { class: 'icon-btn', title: 'Export .m3u8', 'aria-label': 'Export', onclick: () => req('music.playlist.export', { id: p.id }).then((r) => r && notice(`Exported ${r.count} tracks to ${r.path}`, 4000)).catch(hooks.showError) }, '⇪'),
        el('button', { class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete playlist', onclick: () => deletePlaylist(p) }, '✕'))));
    const smart = (status.smart || []).map((sc) => el('div', { class: 'qitem smart-item' },
      el('span', { class: 'qpos', text: '⚡' }),
      el('button', { class: 'qtitle linkish', onclick: () => { setTab('library'); setView({ smartId: sc.id, search: '', triage: null, missingOnly: false }); } }, sc.name),
      el('small', { text: `${sc.count} tracks` }),
      el('span', { class: 'qactions' },
        el('button', { class: 'icon-btn', title: 'Play', 'aria-label': `Play ${sc.name}`, onclick: () => playSmart(sc) }, '▶'),
        el('button', { class: 'icon-btn', title: 'Edit rules', 'aria-label': 'Edit rules', onclick: () => editSmart(sc) }, '✎'),
        el('button', { class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete smart collection', onclick: () => deleteSmart(sc) }, '✕'))));
    box.replaceChildren(
      el('h4', { class: 'music-subhead', text: 'Smart collections' }),
      el('div', { class: 'music-viewbar' }, el('button', { class: 'utility-btn', id: 'smart-new', onclick: () => editSmart(null) }, '⚡ New smart collection…')),
      ...(smart.length ? smart : [el('p', { class: 'music-none', text: 'Smart collections fill themselves from rules — “never played”, “favorites not heard in a month”, “added this week”…' })]),
      el('h4', { class: 'music-subhead', text: 'Playlists' }),
      el('div', { class: 'music-viewbar' },
        el('button', { class: 'utility-btn', onclick: () => createPlaylist([]) }, '＋ New playlist'),
        el('button', { class: 'utility-btn', onclick: importPlaylist }, 'Import .m3u / .m3u8…')),
      ...(items.length ? items : [el('p', { class: 'music-none', text: 'No playlists yet. Create one, import an .m3u file, or save Up next as a playlist.' })]));
  }

  async function playPlaylist(id) {
    let ids;
    try { ids = await req('music.ids', { playlistId: id, sort: 'playlist' }); } catch (err) { hooks.showError(err); return; }
    if (!ids.length) { notice('This playlist is empty.'); return; }
    setQueue(ids, q.shuffle ? Math.floor(Math.random() * ids.length) : 0, true);
  }

  async function createPlaylist(ids) {
    const name = await NoorUI.prompt('New playlist', 'Playlist name:', 'Writing session', { okLabel: 'Create' });
    if (!name) return null;
    try {
      const r = await req('music.playlist.create', { name, ids });
      await refreshStatus(false);
      notice(`Playlist “${name}” created${ids.length ? ` with ${ids.length} tracks` : ''}`, 2000);
      return r.id;
    } catch (err) { hooks.showError(err); return null; }
  }

  async function renamePlaylist(p) {
    const name = await NoorUI.prompt('Rename playlist', 'New name:', p.name, { okLabel: 'Rename' });
    if (!name) return;
    await req('music.playlist.rename', { id: p.id, name }).catch(hooks.showError);
    refreshStatus(false);
  }

  async function deletePlaylist(p) {
    if (!await NoorUI.confirm('Delete playlist?', `“${p.name}” will be deleted. The music files are not touched.`, 'Delete')) return;
    await req('music.playlist.delete', { id: p.id }).catch(hooks.showError);
    if (view.playlistId === p.id) setView({ playlistId: null, sort: 'title' });
    refreshStatus(false);
  }

  async function importPlaylist() {
    await start();
    try {
      const r = await req('music.playlist.import');
      if (!r || r.cancelled) return;
      notice(`Imported ${r.added} tracks${r.missing ? `; ${r.missing} files not found` : ''}${r.unsupported ? `; ${r.unsupported} unsupported entries skipped` : ''}.`, 5000);
      await refreshStatus(true);
      setTab('library'); setView({ playlistId: r.playlistId });
    } catch (err) { hooks.showError(err); }
  }

  function addToPlaylist(ids) {
    NoorUI.modal({ label: 'Add to playlist', width: 420 }, (s, close) => {
      s.append(NoorUI.head('Add to playlist', close), el('div', { class: 'modal-body' },
        ...status.playlists.map((p) => el('button', { class: 'cmd-item', onclick: async () => {
          close();
          try { status.playlists = await req('music.playlist.add', { id: p.id, ids }); notice(`Added to “${p.name}”`, 1400); renderPlaylists(); } catch (err) { hooks.showError(err); }
        } }, el('span', { text: p.name }), el('small', { text: `${p.count} tracks` }))),
        el('button', { class: 'cmd-item', onclick: () => { close(); createPlaylist(ids); } }, el('span', { text: '＋ New playlist…' }))));
    });
  }

  // ------------------------------------------------------------------ sound: equalizer, loudness, limiter

  let measuring = null; // { ids, done, failed, abort, label }

  function applyTrackGain(id) {
    const row = cache.get(id);
    NoorFx.setTrack(row);
    if (tab === 'sound') renderSoundStatus();
    const s = NoorFx.settings;
    // Normalising and nothing known about this track: measure it (and the next ones) quietly in the background.
    if (s.normalize && s.autoMeasure !== false && row && !Number.isFinite(row.loudness) && !Number.isFinite(row.rgGain) && !measuring)
      measure([id, ...upcomingIds(3).slice(1)].filter((x) => { const r = cache.get(x); return !r || !Number.isFinite(r.loudness); }), { quiet: true });
  }

  function fxChanged(patch) {
    if (!NoorFx.update(patch)) { notice('Sound effects are not available in this browser engine.'); return; }
    applyTrackGain(currentId());
    scheduleSave();
    renderSound();
  }

  /** Measures tracks one after another (decoding happens in the page; the files are only read). */
  async function measure(ids, { quiet = false, label = '' } = {}) {
    if (!ids.length) { if (!quiet) notice('Everything here is measured already.'); return; }
    if (measuring) { if (!quiet) notice('A measurement is already running.'); return; }
    const ctl = new AbortController();
    measuring = { ids, done: 0, failed: 0, abort: ctl, label, quiet };
    renderSoundStatus();
    for (const id of ids) {
      if (ctl.signal.aborted) break;
      try {
        const r = await NoorFx.analyze(`_media/${id}?v=${mediaVersion}`, ctl.signal);
        if (Number.isFinite(r.lufs)) {
          await req('music.loudness.set', { id, lufs: Math.round(r.lufs * 100) / 100, peak: Math.round(r.peak * 10000) / 10000 });
          const c = cache.get(id);
          if (c) cache.set(id, { ...c, loudness: r.lufs, peak: r.peak });
          for (const [i, row] of viewRows) if (row.id === id) viewRows.set(i, { ...row, loudness: r.lufs, peak: r.peak });
          if (id === currentId()) NoorFx.setTrack(cache.get(id));
        } else measuring.failed++;
      } catch (err) {
        if (err.name === 'AbortError') break;
        measuring.failed++;
      }
      measuring.done++;
      renderSoundStatus();
      await new Promise((r) => setTimeout(r, 30)); // keep the editor responsive between tracks
    }
    const m = measuring;
    measuring = null;
    renderSoundStatus();
    if (!m.quiet || m.failed) notice(`Loudness measured: ${m.done - m.failed} track${m.done - m.failed === 1 ? '' : 's'}${m.failed ? ` · ${m.failed} could not be decoded` : ''}${ctl.signal.aborted ? ' (stopped)' : ''}`, 3500);
    if (tab === 'sound') renderSound();
  }

  async function measureView() {
    try { const ids = await req('music.loudness.unmeasured', { ids: await req('music.ids', queryPayload(0, 2000)) }); measure(ids, { label: 'this view' }); } catch (err) { hooks.showError(err); }
  }
  async function measureAll() {
    try { measure(await req('music.loudness.unmeasured', {}), { label: 'the library' }); } catch (err) { hooks.showError(err); }
  }

  function gainText(row) {
    const g = NoorFx.gainFor(row);
    if (!g) return 'not measured yet';
    return `${g.db >= 0 ? '+' : '−'}${Math.abs(g.db).toFixed(1)} dB (${g.from === 'measured' ? `measured ${row.loudness.toFixed(1)} LUFS` : 'from ReplayGain tags'})`;
  }

  function renderSoundStatus() {
    const box = $('#sound-status');
    if (!box) return;
    const row = cache.get(currentId());
    box.replaceChildren(
      el('div', {}, el('strong', { text: 'This track: ' }), row ? (NoorFx.settings.normalize ? gainText(row) : 'normalisation is off') : 'nothing playing'),
      measuring ? el('div', { class: 'sound-progress' },
        el('progress', { max: String(measuring.ids.length), value: String(measuring.done) }),
        el('span', { text: ` Measuring ${measuring.done}/${measuring.ids.length}${measuring.label ? ' in ' + measuring.label : ''}…` }),
        el('button', { class: 'utility-btn', onclick: () => measuring && measuring.abort.abort() }, 'Stop')) : null);
  }

  function renderSound() {
    const box = $('#music-sound');
    if (!box) return;
    const s = NoorFx.settings;
    const eqOn = el('input', { type: 'checkbox', id: 'fx-eq' }); eqOn.checked = s.eqOn;
    eqOn.addEventListener('change', () => fxChanged({ eqOn: eqOn.checked }));
    const preset = el('select', { id: 'fx-preset', 'aria-label': 'Equalizer preset' },
      ...Object.entries(NoorFx.PRESETS).map(([k, p]) => el('option', { value: k, text: p.label })), el('option', { value: 'custom', text: 'Custom' }));
    preset.value = s.preset;
    preset.addEventListener('change', () => { if (preset.value !== 'custom') fxChanged({ preset: preset.value, eqOn: true }); });
    const bands = el('div', { class: 'eq-bands', role: 'group', 'aria-label': 'Equalizer bands' }, ...NoorFx.BANDS.map((f, i) => {
      const r = el('input', { type: 'range', min: '-12', max: '12', step: '0.5', value: String(s.gains[i]), class: 'eq-band', 'data-band': String(i), 'aria-label': `${f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz'} gain`, disabled: !s.eqOn || undefined });
      const val = el('span', { class: 'eq-val', text: (s.gains[i] > 0 ? '+' : '') + s.gains[i] });
      r.addEventListener('input', () => {
        const gains = NoorFx.settings.gains; gains[i] = Number(r.value);
        val.textContent = (gains[i] > 0 ? '+' : '') + gains[i];
        NoorFx.update({ gains, preset: 'custom' });
        $('#fx-preset').value = 'custom';
        $('#fx-preamp').textContent = preampText();
        scheduleSave();
      });
      return el('label', { class: 'eq-col' }, val, r, el('span', { class: 'eq-f', text: f >= 1000 ? f / 1000 + 'k' : String(f) }));
    }));
    const clip = el('input', { type: 'checkbox', id: 'fx-clip' }); clip.checked = s.preventClipping;
    clip.addEventListener('change', () => fxChanged({ preventClipping: clip.checked }));
    const norm = el('input', { type: 'checkbox', id: 'fx-norm' }); norm.checked = s.normalize;
    norm.addEventListener('change', () => fxChanged({ normalize: norm.checked }));
    const target = el('select', { id: 'fx-target', 'aria-label': 'Loudness target' }, ...NoorFx.TARGETS.map(([v, l]) => el('option', { value: String(v), text: l })));
    target.value = String(s.target);
    target.addEventListener('change', () => fxChanged({ target: Number(target.value) }));
    const auto = el('input', { type: 'checkbox', id: 'fx-auto' }); auto.checked = s.autoMeasure !== false;
    auto.addEventListener('change', () => fxChanged({ autoMeasure: auto.checked }));
    box.replaceChildren(
      el('section', { class: 'sound-section' },
        el('div', { class: 'sound-head' }, el('label', { class: 'inline' }, eqOn, el('strong', { text: 'Equalizer' })), preset),
        bands,
        el('div', { class: 'sound-row' }, el('label', { class: 'inline' }, clip, 'Prevent clipping'), el('small', { id: 'fx-preamp', class: 'pref-hint', text: preampText() }))),
      el('section', { class: 'sound-section' },
        el('div', { class: 'sound-head' }, el('label', { class: 'inline' }, norm, el('strong', { text: 'Even out loudness' })), target),
        el('p', { class: 'pref-hint', text: 'Plays every track at about the same loudness. Uses NoorMD’s own measurement or ReplayGain tags; the files are never changed. A track is never boosted above −1 dBFS.' }),
        el('div', { class: 'sound-row' }, el('label', { class: 'inline' }, auto, 'Measure tracks automatically as they play')),
        el('div', { class: 'sound-row' },
          el('button', { class: 'utility-btn', disabled: currentId() == null || undefined, onclick: () => measure([currentId()], { label: 'this track' }) }, 'Measure this track'),
          el('button', { class: 'utility-btn', onclick: () => withSelection((ids) => req('music.loudness.unmeasured', { ids }).then((u) => measure(u, { label: 'the selection' }))) }, 'Measure selected'),
          el('button', { class: 'utility-btn', onclick: measureView }, 'Measure this view'),
          el('button', { class: 'utility-btn', onclick: measureAll }, 'Measure whole library')),
        el('div', { id: 'sound-status', class: 'sound-status', 'aria-live': 'polite' })));
    renderSoundStatus();
  }

  function preampText() {
    const p = NoorFx.preamp;
    return p < 0 ? `Preamp ${p.toFixed(1)} dB keeps the boosts from clipping; a limiter catches the rest.` : 'A limiter keeps peaks below −1 dBFS.';
  }

  // ------------------------------------------------------------------ smart collections

  const SMART_FIELDS = [
    ['title', 'Title', 'text'], ['artist', 'Artist', 'text'], ['album', 'Album', 'text'], ['genre', 'Genre', 'text'], ['comment', 'Comment', 'text'],
    ['fileName', 'File name', 'text'], ['folder', 'Folder', 'text'], ['year', 'Year', 'number'], ['plays', 'Play count', 'number'],
    ['duration', 'Duration (seconds)', 'number'], ['loudness', 'Loudness (LUFS)', 'number'], ['added', 'Added', 'date'], ['lastPlayed', 'Last played', 'date'],
    ['triage', 'Mark', 'triage'], ['hasArt', 'Has artwork', 'flag'], ['measured', 'Loudness measured', 'flag'], ['missing', 'Missing on disk', 'flag'],
  ];
  const SMART_OPS = {
    text: [['contains', 'contains'], ['notContains', 'does not contain'], ['is', 'is'], ['isNot', 'is not'], ['startsWith', 'starts with'], ['isEmpty', 'is empty'], ['notEmpty', 'is not empty']],
    number: [['gt', '>'], ['ge', '≥'], ['lt', '<'], ['le', '≤'], ['eq', '='], ['ne', '≠'], ['isEmpty', 'is unknown']],
    date: [['withinDays', 'in the last … days'], ['olderThanDays', 'not in the last … days'], ['never', 'never'], ['ever', 'ever']],
    triage: [['is', 'is'], ['isNot', 'is not']],
    flag: [['isTrue', 'yes'], ['isFalse', 'no']],
  };
  const NO_VALUE = new Set(['isEmpty', 'notEmpty', 'never', 'ever', 'isTrue', 'isFalse']);
  const SMART_PRESETS = [
    { name: 'Recently added', matchAll: true, rules: [{ field: 'added', op: 'withinDays', value: '14' }] },
    { name: 'Favorites', matchAll: true, rules: [{ field: 'triage', op: 'is', value: '1' }] },
    { name: 'Never played', matchAll: true, rules: [{ field: 'lastPlayed', op: 'never' }] },
    { name: 'Not played for a month', matchAll: true, rules: [{ field: 'lastPlayed', op: 'olderThanDays', value: '30' }, { field: 'triage', op: 'isNot', value: '4' }] },
    { name: 'Most played', matchAll: true, rules: [{ field: 'plays', op: 'gt', value: '0' }], limit: 50, limitSort: 'plays', limitDesc: true },
    { name: 'Still to triage', matchAll: true, rules: [{ field: 'triage', op: 'is', value: '0' }] },
    { name: 'Short tracks (under 2 min)', matchAll: true, rules: [{ field: 'duration', op: 'lt', value: '120' }] },
    { name: 'Missing artwork', matchAll: true, rules: [{ field: 'hasArt', op: 'isFalse' }] },
  ];

  function editSmart(existing) {
    const start0 = existing || { name: '', matchAll: true, rules: [{ field: 'genre', op: 'contains', value: '' }] };
    let rules = start0.rules.map((r) => ({ ...r }));
    NoorUI.modal({ label: existing ? 'Edit smart collection' : 'New smart collection', width: 720 }, (s, close) => {
      const name = el('input', { type: 'text', value: start0.name, id: 'smart-name', 'aria-label': 'Name', placeholder: 'Name' });
      const match = el('select', { id: 'smart-match', 'aria-label': 'Match' }, el('option', { value: 'all', text: 'all of these' }), el('option', { value: 'any', text: 'any of these' }));
      match.value = start0.matchAll === false ? 'any' : 'all';
      const limitOn = el('input', { type: 'checkbox', id: 'smart-limit-on' }); limitOn.checked = !!start0.limit;
      const limit = el('input', { type: 'number', min: '1', max: '10000', value: String(start0.limit || 50), class: 'num', id: 'smart-limit', 'aria-label': 'Limit' });
      const limitSort = el('select', { id: 'smart-limit-sort', 'aria-label': 'Choose by' }, ...[['plays:1', 'most played'], ['added:1', 'most recently added'], ['lastPlayed:1', 'most recently played'], ['lastPlayed:0', 'least recently played'], ['random:0', 'random'], ['duration:0', 'shortest'], ['title:0', 'title']].map(([v, t]) => el('option', { value: v, text: t })));
      limitSort.value = `${start0.limitSort || 'plays'}:${start0.limitDesc === false ? 0 : 1}`;
      const list = el('div', { class: 'smart-rules', id: 'smart-rules' });
      const count = el('div', { class: 'batch-summary', id: 'smart-count', 'aria-live': 'polite' });
      const err = el('div', { class: 'edit-problems', role: 'alert' });
      const presets = existing ? null : el('div', { class: 'batch-tokens' }, el('span', { class: 'pref-hint', text: 'Start from: ' }),
        ...SMART_PRESETS.map((p) => el('button', { class: 'chip', type: 'button', onclick: () => { name.value = p.name; match.value = p.matchAll ? 'all' : 'any'; rules = p.rules.map((r) => ({ ...r })); limitOn.checked = !!p.limit; if (p.limit) { limit.value = String(p.limit); limitSort.value = `${p.limitSort}:${p.limitDesc ? 1 : 0}`; } draw(); } }, p.name)));
      let t = null;
      const payload = () => {
        const [ls, ld] = limitSort.value.split(':');
        return { matchAll: match.value === 'all', rules, limit: limitOn.checked ? Number(limit.value) : undefined, limitSort: ls, limitDesc: ld === '1' };
      };
      const recount = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          try { const n = await req('music.smart.count', { rules: payload() }); count.textContent = `${n.toLocaleString()} track${n === 1 ? '' : 's'} match right now`; err.replaceChildren(); }
          catch (e) { count.textContent = ''; err.replaceChildren(el('div', { text: '⚠ ' + e.message })); }
        }, 200);
      };
      function draw() {
        list.replaceChildren(...rules.map((r, i) => {
          const kind = (SMART_FIELDS.find(([f]) => f === r.field) || SMART_FIELDS[0])[2];
          const field = el('select', { 'aria-label': 'Field', 'data-smart-field': String(i) }, ...SMART_FIELDS.map(([f, l]) => el('option', { value: f, text: l })));
          field.value = r.field;
          const op = el('select', { 'aria-label': 'Condition', 'data-smart-op': String(i) }, ...SMART_OPS[kind].map(([o, l]) => el('option', { value: o, text: l })));
          if (!SMART_OPS[kind].some(([o]) => o === r.op)) r.op = SMART_OPS[kind][0][0];
          op.value = r.op;
          let value;
          if (kind === 'triage') {
            value = el('select', { 'aria-label': 'Mark', 'data-smart-value': String(i) }, ...TRIAGE.map((x) => el('option', { value: String(x.v), text: `${x.icon} ${x.label}` })));
            value.value = String(r.value ?? '1'); r.value = value.value;
          } else value = el('input', { type: kind === 'text' ? 'text' : 'number', value: r.value ?? '', 'aria-label': 'Value', 'data-smart-value': String(i), hidden: NO_VALUE.has(r.op) || undefined, placeholder: kind === 'date' ? 'days' : '' });
          field.addEventListener('change', () => { r.field = field.value; r.value = ''; draw(); });
          op.addEventListener('change', () => { r.op = op.value; draw(); });
          value.addEventListener(value.tagName === 'SELECT' ? 'change' : 'input', () => { r.value = value.value; recount(); });
          return el('div', { class: 'smart-rule' }, field, op, value,
            el('button', { class: 'icon-btn', title: 'Remove condition', 'aria-label': 'Remove condition', disabled: rules.length === 1 || undefined, onclick: () => { rules.splice(i, 1); draw(); } }, '✕'));
        }));
        recount();
      }
      [match, limitOn, limit, limitSort].forEach((x) => x.addEventListener('change', recount));
      limit.addEventListener('input', recount);
      const save = async () => {
        try {
          const r = await req('music.smart.save', { id: existing ? existing.id : undefined, name: name.value, rules: payload() });
          status.smart = r.smart;
          close();
          renderPlaylists();
          setTab('library');
          setView({ smartId: r.id, search: '', triage: null, missingOnly: false });
          notice(existing ? 'Smart collection updated' : 'Smart collection created — it updates itself as the library changes', 2600);
        } catch (e) { err.replaceChildren(el('div', { text: '⚠ ' + e.message })); }
      };
      s.append(NoorUI.head(existing ? '⚡ Edit smart collection' : '⚡ New smart collection', close),
        el('div', { class: 'modal-body smart-body' },
          presets,
          el('div', { class: 'batch-row' }, el('label', { text: 'Name' }), name),
          el('div', { class: 'batch-row' }, el('span', { text: 'Tracks that match' }), match),
          list,
          el('button', { class: 'utility-btn', onclick: () => { rules.push({ field: 'genre', op: 'contains', value: '' }); draw(); } }, '＋ Add condition'),
          el('div', { class: 'batch-row' }, el('label', { class: 'inline' }, limitOn, 'Only the first'), limit, el('span', { text: 'chosen by' }), limitSort),
          count, err),
        el('div', { class: 'modal-foot' }, el('span', { text: 'Smart collections update themselves; no files are moved.' }),
          el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => close() }, 'Cancel'), el('button', { class: 'action primary', id: 'smart-save', onclick: save }, existing ? 'Save' : 'Create'))));
      draw();
    });
  }

  async function deleteSmart(sc) {
    if (!await NoorUI.confirm('Delete smart collection?', `“${sc.name}” will be deleted. No tracks or files are affected.`, 'Delete')) return;
    try { status.smart = await req('music.smart.delete', { id: sc.id }); } catch (err) { hooks.showError(err); }
    if (view.smartId === sc.id) setView({ smartId: null });
    renderPlaylists();
  }

  async function playSmart(sc) {
    let ids;
    try { ids = await req('music.ids', { smartId: sc.id, sort: 'title' }); } catch (err) { hooks.showError(err); return; }
    if (!ids.length) { notice('Nothing matches this smart collection right now.'); return; }
    setQueue(ids, q.shuffle ? Math.floor(Math.random() * ids.length) : 0, true);
  }

  // ------------------------------------------------------------------ artwork

  /** A calm placeholder when a track has no artwork: a gradient and initial derived from the title. */
  function artPlaceholder(row) {
    const name = row ? (row.displayTitle || row.fileName || '♫') : '♫';
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const hue = h % 360;
    const letter = row ? ([...name.replace(/^[^\p{L}\p{N}]+/u, '')][0] || '♫').toUpperCase() : '♫';
    return el('span', { class: 'art-ph', style: `background:linear-gradient(135deg,hsl(${hue} 55% 42%),hsl(${(hue + 50) % 360} 60% 28%))`, text: letter });
  }

  function showArtwork(id) {
    const row = cache.get(id);
    if (!row) return;
    NoorUI.modal({ label: 'Artwork', width: 560 }, (s, close) => {
      s.append(NoorUI.head(row.displayTitle || row.fileName, close),
        el('div', { class: 'modal-body art-view' }, row.hasArt ? el('img', { src: `_art/${id}?v=${mediaVersion}`, alt: `Artwork of ${row.displayTitle || row.fileName}`, id: 'art-large' }) : artPlaceholder(row)),
        el('div', { class: 'modal-foot' }, el('span', { text: row.hasArt ? '' : 'This track has no artwork (embedded or cover.jpg / folder.jpg next to it).' }),
          el('div', { class: 'modal-buttons' },
            row.hasArt ? el('button', { class: 'action', onclick: () => saveArtwork(id) }, 'Save artwork as…') : null,
            el('button', { class: 'action primary', onclick: () => close() }, 'Close'))));
    });
  }

  async function saveArtwork(id) {
    try { const r = await req('music.art.save', { id }); if (r && r.path) notice(`Artwork saved to ${r.path}`, 3500); } catch (err) { hooks.showError(err); }
  }

  // ------------------------------------------------------------------ Batch Organizer

  const BATCH_FIELDS = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['albumArtist', 'Album artist'], ['genre', 'Genre'], ['year', 'Year'], ['trackNumber', 'Track #'], ['comment', 'Comment']];
  const BATCH_TOKENS = ['{OriginalName}', '{Title}', '{Artist}', '{Album}', '{AlbumArtist}', '{Genre}', '{Year}', '{TrackNumber:00}', '{n}', '{Folder}'];
  const BATCH_KEY = 'noormd.batch.rules';

  async function batchSelected() {
    await start();
    if (!sel.size && selected < 0) { notice('Select tracks in the Music Bench first (click, Shift+click, Ctrl+click or Ctrl+A).', 3500); togglePanel(true); return; }
    await withSelection(batchOrganizer);
  }

  /**
   * One set of tag and rename rules for many tracks. Every change of a rule refreshes a dry-run preview from the host
   * (old → new name, tag changes, problems per file); nothing is touched until Apply. A batch is undone as a whole.
   */
  function batchOrganizer(ids) {
    if (!ids.length) return;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(BATCH_KEY) || '{}') || {}; } catch { saved = {}; }
    const R = { enabled: false, template: '{OriginalName}', find: '', replace: '', regex: false, matchCase: false, prefix: '', suffix: '', case: 'none', underscores: false, tidy: true, replaceIllegal: false, counterStart: 1, counterStep: 1, counterDigits: 2, ...(saved.rename || {}) };
    const tagRules = Object.fromEntries(BATCH_FIELDS.map(([k]) => [k, { mode: 'keep', value: '' }]));
    let preview = null, timer = null, gen = 0, busy = false;

    NoorUI.modal({ label: 'Batch Organizer', width: 980 }, (s, close) => {
      const summary = el('div', { class: 'batch-summary', role: 'status', 'aria-live': 'polite', id: 'batch-summary' }, 'Preparing preview…');
      const table = el('div', { class: 'batch-preview', id: 'batch-preview', role: 'table', 'aria-label': 'Preview' });
      const specError = el('div', { class: 'edit-problems', role: 'alert', id: 'batch-error' });
      const applyBtn = el('button', { class: 'action primary', id: 'batch-apply', disabled: true, onclick: () => apply() }, 'Apply');
      const onlyChanges = el('input', { type: 'checkbox', id: 'batch-only' });
      onlyChanges.addEventListener('change', renderPreview);

      // Tags: Leave unchanged / Set to / Clear per field.
      const tagGrid = el('div', { class: 'batch-tags' });
      for (const [key, label] of BATCH_FIELDS) {
        const mode = el('select', { 'aria-label': `${label}: what to do`, 'data-field': key },
          el('option', { value: 'keep', text: 'Leave unchanged' }), el('option', { value: 'set', text: 'Set to' }), el('option', { value: 'clear', text: 'Clear' }));
        const value = el('input', { type: 'text', disabled: true, placeholder: key === 'trackNumber' ? '{n}' : key === 'title' ? '{OriginalName}' : '', 'aria-label': `${label} value`, 'data-field-value': key, spellcheck: 'false' });
        mode.addEventListener('change', () => { tagRules[key].mode = mode.value; value.disabled = mode.value !== 'set'; if (mode.value === 'set') value.focus(); schedule(); });
        value.addEventListener('input', () => { tagRules[key].value = value.value; schedule(); });
        tagGrid.append(el('label', { text: label }), mode, value);
      }

      // File names.
      const inp = (key, attrs = {}) => {
        const i = el('input', { type: attrs.type || 'text', value: String(R[key]), 'data-rule': key, spellcheck: 'false', ...attrs });
        i.addEventListener('input', () => { R[key] = i.type === 'number' ? Number(i.value) : i.value; schedule(); });
        return i;
      };
      const chk = (key, label) => {
        const c = el('input', { type: 'checkbox', 'data-rule': key });
        c.checked = !!R[key];
        c.addEventListener('change', () => { R[key] = c.checked; schedule(); });
        return el('label', { class: 'inline' }, c, label);
      };
      const template = inp('template', { 'aria-label': 'Name template', class: 'batch-template' });
      const tokens = el('div', { class: 'batch-tokens' }, ...BATCH_TOKENS.map((t) => el('button', { class: 'chip', type: 'button', title: `Insert ${t}`, onclick: () => {
        const a = template.selectionStart ?? template.value.length, b = template.selectionEnd ?? a;
        template.value = template.value.slice(0, a) + t + template.value.slice(b);
        template.focus(); template.setSelectionRange(a + t.length, a + t.length);
        R.template = template.value; renameOn.checked = R.enabled = true; schedule();
      } }, t)));
      const renameOn = el('input', { type: 'checkbox', id: 'batch-rename' });
      renameOn.checked = R.enabled;
      renameOn.addEventListener('change', () => { R.enabled = renameOn.checked; schedule(); });
      const caseSel = el('select', { 'aria-label': 'Letter case', 'data-rule': 'case' }, ...[['none', 'Keep as is'], ['title', 'Title Case'], ['sentence', 'Sentence case'], ['lower', 'lower case'], ['upper', 'UPPER CASE']].map(([v, t]) => el('option', { value: v, text: t })));
      caseSel.value = R.case;
      caseSel.addEventListener('change', () => { R.case = caseSel.value; schedule(); });

      const names = el('div', { class: 'batch-names' },
        el('label', { class: 'inline batch-rename-toggle' }, renameOn, el('strong', { text: 'Rename files' })),
        el('div', { class: 'batch-row' }, el('label', { text: 'Template' }), template), tokens,
        el('div', { class: 'batch-row' }, el('label', { text: 'Find' }), inp('find', { 'aria-label': 'Find' }), el('label', { text: 'Replace with' }), inp('replace', { 'aria-label': 'Replace with' })),
        el('div', { class: 'batch-row' }, chk('regex', 'Regular expression'), chk('matchCase', 'Match case')),
        el('div', { class: 'batch-row' }, el('label', { text: 'Prefix' }), inp('prefix', { 'aria-label': 'Prefix' }), el('label', { text: 'Suffix' }), inp('suffix', { 'aria-label': 'Suffix' })),
        el('div', { class: 'batch-row' }, el('label', { text: 'Case' }), caseSel, chk('underscores', 'Underscores → spaces'), chk('tidy', 'Tidy spaces')),
        el('div', { class: 'batch-row' }, el('label', { text: 'Counter {n}' }), el('span', { text: 'start' }), inp('counterStart', { type: 'number', min: '0', class: 'num', 'aria-label': 'Counter start' }),
          el('span', { text: 'step' }), inp('counterStep', { type: 'number', min: '1', class: 'num', 'aria-label': 'Counter step' }),
          el('span', { text: 'digits' }), inp('counterDigits', { type: 'number', min: '1', max: '6', class: 'num', 'aria-label': 'Counter digits' })),
        el('div', { class: 'batch-row' }, chk('replaceIllegal', 'Replace characters Windows doesn’t allow with “-”')));

      const body = el('div', { class: 'modal-body batch-body' },
        el('div', { class: 'batch-rules' },
          el('section', {}, el('h3', { text: 'Tags' }), el('p', { class: 'pref-hint', text: '“Set to” values may use placeholders such as {OriginalName} or {n}.' }), tagGrid),
          el('section', {}, el('h3', { text: 'File names' }), names)),
        specError,
        el('div', { class: 'batch-preview-head' }, summary, el('label', { class: 'inline' }, onlyChanges, 'Only changes and problems')),
        table);
      s.append(NoorUI.head(`Batch Organizer — ${ids.length.toLocaleString()} track${ids.length === 1 ? '' : 's'}`, close), body,
        el('div', { class: 'modal-foot' },
          el('span', { text: 'Dry run: nothing changes until Apply. The whole batch can be undone.' }),
          el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => close() }, 'Cancel'), applyBtn)));

      function spec() {
        const tags = {};
        for (const [k, r] of Object.entries(tagRules)) if (r.mode !== 'keep') tags[k] = { mode: r.mode, value: r.value };
        return { tags, rename: { ...R } };
      }

      function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 220); }

      async function refresh() {
        const my = ++gen;
        try {
          const p = await req('music.batch.preview', { ids, spec: spec() });
          if (my !== gen) return;
          preview = p; specError.replaceChildren();
        } catch (err) {
          if (my !== gen) return;
          preview = null;
          specError.replaceChildren(el('div', { text: '⚠ ' + err.message }));
        }
        renderPreview();
      }

      function renderPreview() {
        if (!preview) { summary.textContent = 'Fix the rule above to see a preview.'; table.replaceChildren(); applyBtn.disabled = true; return; }
        const p = preview;
        summary.textContent = `${p.willChange.toLocaleString()} will change · ${p.unchanged.toLocaleString()} unchanged · ${p.blocked.toLocaleString()} blocked`;
        applyBtn.disabled = busy || p.willChange === 0;
        applyBtn.textContent = p.willChange ? `Apply to ${p.willChange.toLocaleString()} file${p.willChange === 1 ? '' : 's'}` : 'Apply';
        const rows = p.items.filter((i) => !onlyChanges.checked || !i.ok || i.renames || i.tags.length || i.warnings.length);
        const shown = rows.slice(0, 500);
        table.replaceChildren(
          el('div', { class: 'batch-tr head', role: 'row' }, ...['', 'Current name', 'New name', 'Tags'].map((t) => el('span', { role: 'columnheader', text: t }))),
          ...shown.map((i) => el('div', { class: 'batch-tr' + (i.ok ? '' : ' blocked') + (i.warnings.length ? ' warn' : ''), role: 'row', 'data-id': String(i.id) },
            el('span', { class: 'batch-state', role: 'cell', title: i.ok ? (i.renames || i.tags.length ? 'Will change' : 'Unchanged') : 'Blocked', text: !i.ok ? '✕' : i.warnings.length ? '⚠' : i.renames || i.tags.length ? '✓' : '·' }),
            el('span', { role: 'cell', class: 'batch-old', text: i.oldName, title: i.folder }),
            el('span', { role: 'cell', class: 'batch-new' + (i.renames ? ' changed' : ''), text: i.renames ? i.newName : '(same)' }),
            el('span', { role: 'cell', class: 'batch-tagchanges' },
              ...i.tags.map((c) => el('span', { class: 'chip', text: `${(BATCH_FIELDS.find(([k]) => k === c.field) || [, c.field])[1]}: ${c.old ?? '∅'} → ${c.new ?? '∅'}` })),
              ...i.problems.map((m) => el('div', { class: 'batch-problem', text: '✕ ' + m })),
              ...i.warnings.map((m) => el('div', { class: 'batch-warning', text: '⚠ ' + m }))))),
          ...(rows.length > shown.length ? [el('p', { class: 'music-none', text: `…and ${(rows.length - shown.length).toLocaleString()} more (all are applied).` })] : []));
      }

      async function apply() {
        if (!preview || !preview.willChange || busy) return;
        const n = preview.willChange;
        if (!await NoorUI.confirm('Apply the batch?', [`${n.toLocaleString()} file${n === 1 ? '' : 's'} will be changed${preview.blocked ? `; ${preview.blocked} blocked file${preview.blocked === 1 ? ' is' : 's are'} skipped` : ''}.`, 'You can undo the whole batch afterwards (Media › Undo last track edit).'], 'Apply')) return;
        try { localStorage.setItem(BATCH_KEY, JSON.stringify({ rename: { ...R, enabled: false } })); } catch { /* per-viewer convenience only */ }
        busy = true; applyBtn.disabled = true; applyBtn.textContent = 'Applying…';
        const isCur = ids.includes(currentId());
        const at = audio.currentTime, playing = !audio.paused;
        if (isCur) releaseFile();
        let r;
        try { r = await req('music.batch.apply', { ids, spec: spec() }); } catch (err) { busy = false; specError.replaceChildren(el('div', { text: '⚠ ' + err.message })); renderPreview(); return; }
        mediaVersion++;
        ids.forEach((id) => cache.delete(id));
        if (isCur) { restorePosition = at; audio.src = `_media/${currentId()}?v=${mediaVersion}`; if (playing) audio.play().catch(() => {}); }
        status.undo = r.undo || status.undo;
        viewRows = new Map(); viewGen++;
        loadView(false);
        refreshStatus(false);
        renderAll();
        showResults(r);
      }

      function showResults(r) {
        const label = { done: '✓ Done', failed: '✕ Failed', partial: '⚠ Partly', skipped: '– Skipped', unchanged: '· Unchanged' };
        body.replaceChildren(
          el('div', { class: 'batch-summary', id: 'batch-result', role: 'status' }, `${r.done} changed · ${r.failed} failed · ${r.skipped} skipped`),
          el('div', { class: 'batch-preview', role: 'table', 'aria-label': 'Results' },
            ...r.items.filter((i) => i.status !== 'unchanged').slice(0, 1000).map((i) => el('div', { class: 'batch-tr result ' + i.status, role: 'row' },
              el('span', { role: 'cell', class: 'batch-status', text: label[i.status] || i.status }),
              el('span', { role: 'cell', text: i.oldName }),
              el('span', { role: 'cell', text: i.newName !== i.oldName ? '→ ' + i.newName : '' }),
              el('span', { role: 'cell', class: 'batch-problem', text: i.message || '' })))));
        const foot = s.querySelector('.modal-buttons');
        foot.replaceChildren(
          r.batchId ? el('button', { class: 'action', id: 'batch-undo', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const u = await req('music.batch.undo', { batchId: r.batchId });
              mediaVersion++; ids.forEach((id) => cache.delete(id));
              status.undo = u.undo; viewRows = new Map(); viewGen++; loadView(false); refreshStatus(false);
              notice(`Batch undone: ${u.done} restored${u.skipped ? `, ${u.skipped} skipped (changed since)` : ''}${u.failed ? `, ${u.failed} failed` : ''}`, 4500);
              close();
            } catch (err) { hooks.showError(err); }
          } }, '↶ Undo this batch') : null,
          el('button', { class: 'action primary', autofocus: true, onclick: () => close() }, 'Close'));
        notice(`Batch applied: ${r.done} changed${r.failed ? `, ${r.failed} failed` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}`, 3500);
      }

      refresh();
    });
  }

  async function saveQueueAsPlaylist() { await createPlaylist(q.order.map((i) => q.ids[i])); }

  // ------------------------------------------------------------------ folders & scanning

  async function addFolder() {
    await start();
    try { const r = await req('music.addFolder'); if (r && !r.cancelled) { notice('Indexing in the background — keep writing.', 2600); await refreshStatus(true); } } catch (err) { hooks.showError(err); }
  }

  function showFolders() {
    NoorUI.modal({ label: 'Music folders', width: 640 }, (s, close) => {
      const body = el('div', { class: 'modal-body' });
      const render = () => {
        body.replaceChildren(
          el('p', { text: 'NoorMD reads these folders (including subfolders). It never moves, renames or rewrites files on its own; removing a folder only removes it from the index.' }),
          ...status.folders.map((f) => el('div', { class: 'snapshot' },
            el('div', { class: 'info' }, el('div', { text: f.path }), el('small', { text: `${f.trackCount.toLocaleString()} tracks · ${f.lastScanUtc ? 'scanned ' + new Date(f.lastScanUtc).toLocaleString() : 'not scanned yet'}` })),
            el('div', { class: 'row-actions' },
              el('button', { class: 'utility-btn', onclick: () => req('music.rescan', { id: f.id }).then(() => notice('Rescanning…', 1500)).catch(hooks.showError) }, 'Rescan'),
              el('button', { class: 'utility-btn danger', onclick: async () => {
                if (!await NoorUI.confirm('Remove folder from library?', [`“${f.path}” and its ${f.trackCount} tracks will be removed from the index, including their triage marks and playlist entries.`, 'The files on disk are not touched.'], 'Remove')) return;
                await req('music.removeFolder', { id: f.id }).catch(hooks.showError);
                await refreshStatus(true); render();
              } }, 'Remove')))),
          status.folders.length ? null : el('p', { class: 'music-none', text: 'No folders yet.' }));
      };
      render();
      s.append(NoorUI.head('Music folders', close), body, el('div', { class: 'modal-foot' },
        el('span', { text: 'Missing files are marked, never deleted. Moved files are relinked on rescan.' }),
        el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => req('music.rescan', {}).catch(hooks.showError) }, 'Rescan all'),
          el('button', { class: 'action primary', onclick: async () => { await addFolder(); render(); } }, '＋ Add folder'))));
    });
  }

  function onScan(p) {
    const box = $('#music-scan');
    if (!box) return;
    const msg = {
      discovering: 'Looking for music files…',
      indexing: `Indexing ${p.processed.toLocaleString()} / ${p.discovered.toLocaleString()}…`,
      done: `Indexed ${p.discovered.toLocaleString()} files: ${p.added} new, ${p.updated} updated${p.relinked ? `, ${p.relinked} relinked` : ''}${p.markedMissing ? `, ${p.markedMissing} missing` : ''}${p.errors ? `, ${p.errors} unreadable` : ''}.`,
      cancelled: 'Scan cancelled — progress kept.',
      unavailable: p.message, error: 'Scan failed: ' + (p.message || ''),
    }[p.phase] || '';
    box.replaceChildren(...[el('span', { text: msg }), p.phase === 'indexing' || p.phase === 'discovering' ? el('button', { class: 'linkish', onclick: () => req('music.cancelScan') }, ' Cancel') : null].filter(Boolean));
    if (p.phase === 'indexing' && p.processed % 1000 < 260) refreshStatus(true);
  }

  // ------------------------------------------------------------------ edit current track

  function editCurrent() {
    const inList = document.activeElement && document.activeElement.id === 'music-list';
    const id = (inList ? viewRows.get(selected)?.id : null) ?? currentId() ?? viewRows.get(selected)?.id;
    if (id == null) { notice('Nothing is playing or selected.', 1400); return; }
    editTrack(id);
  }

  async function editTrack(id) {
    let t;
    try { t = await req('music.track', { id }); } catch (err) { hooks.showError(err); return; }
    const fields = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['albumArtist', 'Album artist'], ['genre', 'Genre'], ['year', 'Year'], ['trackNumber', 'Track #'], ['comment', 'Comment']];
    const ext = t.fileName.slice(t.fileName.lastIndexOf('.'));
    const baseName = t.fileName.slice(0, -ext.length);
    const inputs = {};
    let validateTimer = null;
    NoorUI.modal({ label: 'Edit track', width: 640 }, (s, close) => {
      const nameInput = el('input', { type: 'text', value: baseName, 'aria-label': 'File name', spellcheck: 'false', autofocus: true });
      const nameProblems = el('div', { class: 'edit-problems', role: 'alert' });
      const renameBox = el('input', { type: 'checkbox', id: 'edit-rename' });
      const tagsBox = el('input', { type: 'checkbox', id: 'edit-tags' });
      const grid = el('div', { class: 'pref-grid edit-grid' });
      for (const [key, label] of fields) {
        const v = t.tags[key];
        const input = el('input', { type: key === 'year' || key === 'trackNumber' ? 'number' : 'text', value: v == null ? '' : String(v), placeholder: '— not set —', 'aria-label': label, 'data-key': key, spellcheck: key === 'title' || key === 'comment' ? 'true' : 'false' });
        input.addEventListener('input', () => { tagsBox.checked = changedTags() != null; });
        inputs[key] = input;
        grid.append(el('label', { text: label }), input);
      }
      const changedTags = () => {
        const out = {};
        let any = false;
        for (const [key] of fields) {
          const before = t.tags[key] == null ? '' : String(t.tags[key]);
          const now = inputs[key].value.trim();
          if (now !== before) { out[key] = key === 'year' || key === 'trackNumber' ? (now === '' ? '' : Number(now)) : now; any = true; }
        }
        return any ? out : null;
      };
      const validate = () => {
        clearTimeout(validateTimer);
        renameBox.checked = nameInput.value.trim() !== baseName;
        if (!renameBox.checked) { nameProblems.replaceChildren(); return; }
        validateTimer = setTimeout(async () => {
          try {
            const probs = await req('music.edit.validate', { id, fileName: nameInput.value });
            nameProblems.replaceChildren(...probs.map((p) => el('div', { text: '⚠ ' + p })));
          } catch { /* ignore */ }
        }, 200);
      };
      nameInput.addEventListener('input', validate);
      const suggest = el('button', { class: 'utility-btn', onclick: async () => {
        const name = await req('music.suggestName', { title: inputs.title.value, artist: inputs.artist.value }).catch(() => '');
        if (name) { nameInput.value = name; validate(); }
      } }, '↺ Name from tags');

      const save = async (andNext) => {
        const tags = changedTags();
        const doTags = tagsBox.checked && tags != null;
        const doRename = renameBox.checked && nameInput.value.trim() !== baseName;
        if (!doTags && !doRename) { close(); if (andNext) next(false); return; }
        if (doTags) {
          for (const k of ['year', 'trackNumber']) if (tags[k] !== undefined && tags[k] !== '' && !(Number.isInteger(tags[k]) && tags[k] >= 0 && tags[k] < 100000)) { notice(`${k === 'year' ? 'Year' : 'Track #'} must be a whole number.`); return; }
        }
        // Release the file from the player while it's being rewritten/renamed, then resume where it was.
        const isCurrent = id === currentId();
        const resumeAt = isCurrent ? audio.currentTime : 0;
        const wasPlaying = isCurrent && !audio.paused;
        if (isCurrent) releaseFile();
        let r;
        try {
          r = await req('music.edit.apply', { id, updateTags: doTags, tags: doTags ? tags : undefined, rename: doRename, fileName: nameInput.value });
        } catch (err) { r = { ok: false, problems: [err.message] }; }
        mediaVersion++;
        if (r.track) { cache.set(id, { ...(cache.get(id) || {}), ...r.track, ...r.track.tags, title: r.track.tags.title, displayTitle: r.track.displayTitle }); }
        for (const [i, row] of viewRows) if (row.id === id && r.track) viewRows.set(i, { ...row, displayTitle: r.track.displayTitle, title: r.track.tags.title, artist: r.track.tags.artist, fileName: r.track.fileName });
        // Reload the edited song where it was, unless Save & Next moves on (the next song must start at 0:00).
        if (isCurrent && !(andNext && r.ok)) {
          restorePosition = resumeAt;
          audio.src = `_media/${id}?v=${mediaVersion}`;
          if (wasPlaying && !andNext) audio.play().catch(() => {});
        }
        status.undo = r.undo || status.undo;
        renderAll();
        if (!r.ok) {
          nameProblems.replaceChildren(...(r.problems || []).map((p) => el('div', { text: '⚠ ' + p })));
          if (r.tagsSaved || r.renamed) notice('Partly saved: ' + [r.tagsSaved ? 'tags saved' : null, r.renamed ? 'file renamed' : null].filter(Boolean).join(', '), 4000);
          return;
        }
        close();
        notice(`Saved${r.tagsSaved ? ' · tags updated' : ''}${r.renamed ? ' · file renamed' : ''} — Undo: palette › “Undo last track edit”`, 3500);
        if (andNext) next(false);
      };

      s.append(NoorUI.head('✎ Edit track', close), el('div', { class: 'modal-body' },
        el('div', { class: 'edit-file' },
          el('label', { text: 'File name' }),
          el('div', { class: 'edit-name' }, nameInput, el('span', { class: 'edit-ext', text: ext }), suggest),
          nameProblems,
          el('small', { class: 'pref-hint' }, `Location: ${t.folder}`, ' · ', el('button', { class: 'linkish', onclick: () => req('music.reveal', { id }).catch(hooks.showError) }, 'Show in Explorer'), t.readOnly ? ' · ⚠ read-only file' : '', t.readError ? ' · ⚠ ' + t.readError : '')),
        grid,
        el('div', { class: 'edit-options' },
          el('label', { class: 'inline' }, tagsBox, 'Update tags in the file (ID3 / Vorbis / MP4)'),
          el('label', { class: 'inline' }, renameBox, 'Rename the file on disk'))),
      el('div', { class: 'modal-foot' },
        el('span', { text: 'Enter saves · Ctrl+Enter saves & plays next · Esc cancels (nothing changes)' }),
        el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => close() }, 'Cancel'),
          el('button', { class: 'action', onclick: () => save(true) }, 'Save & Next'),
          el('button', { class: 'action primary', onclick: () => save(false) }, 'Save'))));
      s.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(e.ctrlKey); }
      });
      setTimeout(() => { nameInput.select(); }, 0);
    });
  }

  async function undoLastEdit() {
    await start();
    const u = status.undo;
    if (!u) { notice('There is no track edit to undo.'); return; }
    if (u.batchId) {
      if (!await NoorUI.confirm('Undo the last batch?', [`${u.count} file${u.count === 1 ? '' : 's'} changed by the Batch Organizer will get back their previous names and tags.`, 'Files changed since are skipped and listed.'], 'Undo batch')) return;
      const curId = currentId(), at = audio.currentTime, playing = !audio.paused;
      if (curId != null) releaseFile();
      try {
        const r = await req('music.batch.undo', { batchId: u.batchId });
        status.undo = r.undo;
        notice(`Batch undone: ${r.done} restored${r.skipped ? `, ${r.skipped} skipped (changed since)` : ''}${r.failed ? `, ${r.failed} failed` : ''}`, 4500);
      } catch (err) { hooks.showError(err); }
      mediaVersion++; cache.clear();
      if (curId != null) { restorePosition = at; audio.src = `_media/${curId}?v=${mediaVersion}`; if (playing) audio.play().catch(() => {}); }
      viewRows = new Map(); viewGen++; loadView(false);
      refreshStatus(true);
      renderAll();
      return;
    }
    if (!await NoorUI.confirm('Undo last track edit?', [`“${u.newName}” will be restored to “${u.oldName}”, with its previous tags.`, 'NoorMD refuses if the file was changed since.'], 'Undo')) return;
    const isCur = cache.get(currentId())?.fileName === u.newName;
    const at = audio.currentTime, playing = !audio.paused;
    if (isCur) releaseFile();
    try {
      const r = await req('music.undo');
      mediaVersion++;
      if (r.track) cache.set(r.track.id, { ...(cache.get(r.track.id) || {}), ...r.track, title: r.track.tags.title, artist: r.track.tags.artist });
      status.undo = r.undo;
      notice(r.ok ? 'Edit undone ✓' : 'Undo refused: ' + r.problems.join(' '), 4500);
    } catch (err) { hooks.showError(err); }
    if (isCur) { restorePosition = at; audio.src = `_media/${currentId()}?v=${mediaVersion}`; if (playing) audio.play().catch(() => {}); }
    refreshStatus(true);
    renderAll();
  }

  // ------------------------------------------------------------------ media keys

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported action */ } };
    set('play', () => audio.play()); set('pause', () => audio.pause());
    set('nexttrack', () => next(false)); set('previoustrack', prev);
    set('seekto', (d) => seek(d.seekTime));
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const row = cache.get(currentId());
    if (!row) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: row.displayTitle, artist: row.artist || '', album: row.album || '',
        artwork: row.hasArt ? [{ src: new URL(`_art/${row.id}?v=${mediaVersion}`, location.href).href }] : [] });
    } catch { /* ignore */ }
  }

  return {
    init, resumeSession, togglePanel, applyVisibility, toggle, next: () => next(false), prev, editCurrent, triageCurrent,
    openSound: () => { togglePanel(true); setTab('sound'); }, undoLastEdit, batchSelected, batchOrganizer, editSmart, measure, showArtwork, addFolder, importPlaylist, showFolders, setShuffle: () => setShuffle(!q.shuffle), cycleRepeat, playRandom,
    isOpen,
    _forgetBrowsing: () => { userBrowsedAt = 0; },
    /** A video started: music pauses so the two don't play over each other (it doesn't resume by itself). */
    revealPlaying,
    pauseForVideo: () => { if (!audio.paused) { audio.pause(); notice('Music paused for the video', 1600); } },
    /** For the main toolbar: what is loaded and whether it is playing. */
    nowPlaying: () => { const id = currentId(); const row = id != null ? cache.get(id) : null; return { playing: !audio.paused, title: row ? row.displayTitle : null, loaded: id != null }; },
    shuffleOn: () => !!q.shuffle,
    // For other panels (Gallery slideshows): music playlists, play one, pause and continue.
    listPlaylists: () => req('music.playlists'),
    playPlaylist: async (id) => { await start(); await playPlaylist(id); },
    pause: () => { if (!audio.paused) audio.pause(); },
    resume: () => { if (audio.paused && currentId() != null) audio.play().catch(() => {}); },
    isPlaying: () => !audio.paused,
    repeatMode: () => q.repeat,
    // test hooks (used by the automated UI tests and NoorMD.exe --self-test)
    _testEnded: () => next(true),
    _testPlay: async (ids, index, muted) => { await start(); audio.muted = !!muted; await setQueue(ids, index, true); },
    _state: () => ({ q: { ...q, current: currentId() }, paused: audio.paused, time: audio.currentTime, duration: audio.duration, src: audio.getAttribute('src'), view: { ...view }, selected, sel: [...sel].sort((a, b) => a - b), rows: viewRows.size }),
  };
})();
