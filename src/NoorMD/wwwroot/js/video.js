// NoorMD Video Bench: works like the Music Bench, for videos. A library (search, sort, filters, series, multi-select,
// right-click menu), an Up next queue with shuffle and repeat, playlists (e.g. a whole TV show), resume where you
// stopped, sidecar subtitles (converted by the host), a choice of audio track, speed, timestamped notes and a pop-out
// player that stays on top. The page refers to videos only by library id; files are served from /_video/{id}.
window.NoorVideo = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const SORTS = [['series', 'Series & episode'], ['title', 'Title'], ['recent', 'Recently watched'], ['added', 'Recently added'], ['duration', 'Duration']];
  const FILTERS = [['all', 'All'], ['unwatched', 'Unwatched'], ['inprogress', 'In progress'], ['watched', 'Watched']];

  let hooks = { showError: (e) => console.error(e), onPlay: () => {} };
  let built = false;
  let restored = false;
  let status = { folders: [], series: [], resume: [], playlists: [], count: 0 };
  let view = { search: '', filter: 'all', series: null, playlistId: null, sort: 'series', desc: false };
  let rows = [];                 // the library view, in display order
  let selected = -1, sel = new Set(), anchor = -1;
  let tab = 'library';
  let q = { ids: [], order: [], pos: -1, shuffle: false, repeat: 'off', volume: 1 };
  let current = null;            // { video, subtitles, notes, next, exists }
  let poppedOut = null;          // id playing in the pop-out window
  let lastSaved = 0, countdown = null, audioLang = null;
  let pauseOnNote = true, resumeAfterNote = false; // writing a note pauses the video and resumes it when the note is added
  let shown = 300;               // rows rendered (more on scroll)
  const cache = new Map();       // id -> row

  const video = document.createElement('video');
  video.preload = 'metadata';
  video.id = 'vb-video';
  video.setAttribute('playsinline', '');

  const fmt = (s) => { if (!Number.isFinite(s) || s < 0) return '0:00'; s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const isOpen = () => document.body.classList.contains('video-open');
  const resumeAfter = (duration) => (duration > 0 ? Math.min(5, duration * 0.1) : 5); // same rule as VideoLibrary.ResumeAfter
  const currentId = () => (q.pos >= 0 && q.pos < q.order.length ? q.ids[q.order[q.pos]] : current ? current.video.id : null);
  const epLabel = (v) => (v.episode != null ? (v.season != null ? `S${v.season}E${v.episode}` : `E${v.episode}`) : '');

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('video.scanned', (p) => { if (built) { refresh(true); notice(`Video library updated: ${p.found} videos${p.added ? `, ${p.added} new` : ''}${p.missing ? `, ${p.missing} missing` : ''}`, 3000); } });
    NoorBridge.on('video.popin', (p) => onPopIn(p));
    NoorBridge.on('video.notes', (p) => { if (current && current.video.id === p.id) reloadCurrent(); });
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('seeked', () => renderNotePop());
    video.addEventListener('pause', () => { savePosition(true); renderTransport(); });
    video.addEventListener('play', () => { hideCountdown(); hooks.onPlay(); renderTransport(); });
    video.addEventListener('ended', onEnded);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('volumechange', () => { const v = $('#vb-volume'); if (v) v.value = String(Math.round(video.volume * 100)); });
    video.addEventListener('error', () => {
      if (!video.getAttribute('src')) return;
      const code = video.error ? video.error.code : 0;
      showPlayerMessage(code === 4 ? 'This video’s format or codec can’t be played here. MP4 (H.264/AAC) and WebM play best; you can still open it in another player with “Show in Explorer”.' : 'The video could not be read. It may have been moved or deleted — try Rescan.');
    });
    document.addEventListener('fullscreenchange', () => { video.controls = document.fullscreenElement === video; });
  }

  // ------------------------------------------------------------------ open / close

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('video'); // its dock area (another panel there makes room; music keeps playing)
    document.body.classList.add('video-open');
    $('#videobench').hidden = false;
    await refresh(true);
    if (!restored) { restored = true; await restoreSession(); }
    $('#videobench').focus({ preventScroll: true });
  }

  function close() {
    if (!built || !isOpen()) return;
    savePosition(true);
    video.pause();
    hideCountdown();
    document.body.classList.remove('video-open');
    $('#videobench').hidden = true;
    if (window.NoorDock) NoorDock.closed('video');
    setWide(false);
    saveSession();
  }

  function toggle() { if (isOpen()) close(); else open(); }

  async function refresh(reload) {
    try { status = await req('video.status'); } catch (err) { hooks.showError(err); return; }
    $('#vb-count').textContent = status.count ? `${status.count.toLocaleString()} videos` : '';
    renderEmpty();
    renderChips();
    renderPlaylists();
    if (reload) await loadView();
  }

  // ------------------------------------------------------------------ layout

  function build() {
    built = true;
    const tr = (cls, label, title, fn) => el('button', { class: 'tp ' + cls, title, 'aria-label': title, onclick: fn }, label);
    const tabBtn = (id, label) => el('button', { role: 'tab', 'data-vbtab': id, onclick: () => setTab(id) }, label);
    const root = el('section', { id: 'videobench', class: 'videobench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'Video Bench' },
      el('div', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🎬' }), el('strong', { text: 'Video Bench' }), el('small', { id: 'vb-count' }), el('small', { id: 'vb-selcount', class: 'music-selcount', 'aria-live': 'polite' })),
        el('span', { class: 'vb-head-buttons' },
          el('button', { class: 'icon-btn', id: 'vb-dock', title: 'Where this panel goes (left, right, bottom) and layouts', 'aria-label': 'Move the Video Bench', onclick: (e) => NoorDock.showMenu('video', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn vb-list-toggle', id: 'vb-list-toggle', title: 'Hide or show the list (Library, Up next, Playlists, Notes)', 'aria-label': 'Hide or show the list', 'aria-pressed': 'true', onclick: () => setListsHidden(!root.classList.contains('lists-hidden')) }, '☰'),
          el('button', { class: 'icon-btn', id: 'vb-wide', title: 'Wide / narrow panel', 'aria-label': 'Wide or narrow panel', 'aria-pressed': 'false', onclick: () => setWide(!(window.NoorDock ? NoorDock.isWide('video') : document.body.classList.contains('video-wide'))) }, '⤢'),
          el('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close Video Bench', onclick: close }, '✕'))),
      el('section', { class: 'nowplaying vb-player', 'aria-label': 'Now playing' },
        el('div', { class: 'vb-stage', id: 'vb-stage', ondblclick: toggleFullscreen, onclick: (e) => { if (e.target === video) playPause(); } },
          video, el('div', { class: 'vb-note-pop', id: 'vb-note-pop', hidden: true, 'aria-live': 'polite' }), el('div', { class: 'vb-message', id: 'vb-message', hidden: true }), el('div', { class: 'vb-countdown', id: 'vb-countdown', hidden: true })),
        el('div', { class: 'np-text vb-text' },
          el('div', { class: 'np-title', id: 'vb-title', text: 'Nothing playing', title: 'Show in the list', onclick: () => revealPlaying() }),
          el('div', { class: 'np-sub', id: 'vb-sub' }),
          el('small', { id: 'vb-resume', class: 'vb-resume' })),
        el('div', { class: 'np-seek' },
          el('span', { id: 'vb-cur', text: '0:00' }),
          el('input', { type: 'range', id: 'vb-range', min: '0', max: '1000', value: '0', 'aria-label': 'Seek' }),
          el('span', { id: 'vb-dur', text: '0:00' })),
        el('div', { class: 'np-controls' },
          tr('shuffle', '⇄', 'Shuffle', () => setShuffle(!q.shuffle)),
          tr('prev', '⏮', 'Previous', prev),
          tr('play', '▶', 'Play / pause (Space)', playPause),
          tr('next', '⏭', 'Next', () => next(false)),
          tr('repeat', '↻', 'Repeat', cycleRepeat),
          el('input', { type: 'range', class: 'np-volume', id: 'vb-volume', min: '0', max: '100', value: '100', 'aria-label': 'Volume' })),
        el('div', { class: 'vb-extras', id: 'vb-extras' })),
      el('div', { class: 'vb-empty', id: 'vb-empty', hidden: true }),
      el('div', { class: 'music-tabs', role: 'tablist' }, tabBtn('library', 'Library'), tabBtn('queue', 'Up next'), tabBtn('playlists', 'Playlists'), tabBtn('notes', 'Notes')),
      el('div', { class: 'music-pane vb-pane', 'data-vbpane': 'library' },
        el('div', { class: 'music-toolbar' },
          el('input', { id: 'vb-search', type: 'search', placeholder: 'Search title, series, file…', 'aria-label': 'Search videos', autocomplete: 'off', spellcheck: 'false' }),
          el('select', { id: 'vb-sort', 'aria-label': 'Sort by' }, ...SORTS.map(([v, l]) => el('option', { value: v, text: l }))),
          el('button', { class: 'icon-btn', id: 'vb-desc', title: 'Reverse order', 'aria-label': 'Reverse sort order', onclick: () => setView({ desc: !view.desc }) }, '⇅'),
          el('button', { class: 'icon-btn', title: 'Show the playing video in the list', 'aria-label': 'Show the playing video in the list', onclick: () => revealPlaying() }, '◎')),
        el('div', { class: 'music-chips', id: 'vb-chips' }),
        el('div', { class: 'music-viewbar hide', id: 'vb-viewbar' }),
        el('div', { class: 'vb-list', id: 'vb-list', tabindex: '0', role: 'listbox', 'aria-label': 'Videos', 'aria-multiselectable': 'true' })),
      el('div', { class: 'music-pane vb-pane', 'data-vbpane': 'queue' }, el('div', { class: 'music-queue', id: 'vb-queue' })),
      el('div', { class: 'music-pane vb-pane', 'data-vbpane': 'playlists' }, el('div', { class: 'music-playlists', id: 'vb-playlists' })),
      el('div', { class: 'music-pane vb-pane', 'data-vbpane': 'notes' }, el('div', { class: 'vb-notes', id: 'vb-notes', 'aria-label': 'Notes' })),
      el('div', { class: 'music-foot' }, el('span', { class: 'music-scan', id: 'vb-scan' }), el('button', { class: 'utility-btn', onclick: showFolders }, '📁 Folders')));
    document.body.append(root);
    // In full screen: NoorMD's control bar over the video (timeline, previous / play / next, volume, ⚙), shown on mouse move.
    NoorPlayerControls.attach($('#vb-stage'), video, {
      fullscreenOnly: true, onPrev: prev, onNext: () => next(false), hasNext: () => q.pos + 1 < q.order.length || q.repeat === 'all' || (q.shuffle && q.ids.length > 1),
      onFullscreen: toggleFullscreen, onSpeed: () => { renderExtras(); scheduleSave(); }, onSubtitle: (i) => setSubtitle(i), onAudio: (i) => setAudio(i),
    });
    try { if (localStorage.getItem('noormd.video.listsHidden') === '1') root.classList.add('lists-hidden'); } catch { /* fine */ }
    root.addEventListener('keydown', onKey);
    let t;
    $('#vb-search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => setView({ search: e.target.value.trim() }), 180); });
    $('#vb-sort').addEventListener('change', (e) => setView({ sort: e.target.value }));
    const range = $('#vb-range');
    range.addEventListener('input', () => { range.dataset.dragging = '1'; $('#vb-cur').textContent = fmt((Number(range.value) / 1000) * (video.duration || 0)); });
    range.addEventListener('change', () => { delete range.dataset.dragging; if (Number.isFinite(video.duration)) video.currentTime = (Number(range.value) / 1000) * video.duration; });
    $('#vb-volume').addEventListener('input', (e) => { video.volume = Number(e.target.value) / 100; q.volume = video.volume; scheduleSave(); });
    const list = $('#vb-list');
    list.addEventListener('click', (e) => {
      const node = e.target.closest('.vtrack[data-index]');
      if (!node || e.target.closest('button')) return;
      clickSelect(Number(node.dataset.index), e.ctrlKey || e.metaKey, e.shiftKey);
    });
    list.addEventListener('dblclick', (e) => { const node = e.target.closest('.vtrack[data-index]'); if (node && !e.target.closest('button')) playView(Number(node.dataset.index)); });
    list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const node = e.target.closest('.vtrack[data-index]');
      if (!node) return;
      const i = Number(node.dataset.index);
      if (!sel.has(i)) clickSelect(i, false, false);
      list.focus({ preventScroll: true });
      showMenu(e.clientX, e.clientY);
    });
    list.addEventListener('keydown', onListKey);
    ['wheel', 'pointerdown', 'keydown', 'touchstart'].forEach((t) => list.addEventListener(t, () => { userBrowsedAt = Date.now(); }, { passive: true }));
    list.addEventListener('scroll', () => { if (list.scrollTop + list.clientHeight > list.scrollHeight - 300 && shown < rows.length) { shown += 300; renderList(); } }, { passive: true });
    // Its size is the dock's (dock.js); ⤢ makes the dock wide for a while.
    setTab('library');
    renderTransport();
    renderExtras();
  }

  function setTab(id) {
    tab = id;
    document.querySelectorAll('[data-vbtab]').forEach((b) => { b.classList.toggle('active', b.dataset.vbtab === id); b.setAttribute('aria-selected', String(b.dataset.vbtab === id)); });
    document.querySelectorAll('#videobench .vb-pane').forEach((p) => { p.hidden = p.dataset.vbpane !== id; });
    if (id === 'queue') renderQueue();
    if (id === 'playlists') renderPlaylists();
    if (id === 'notes') renderNotes();
    if (id === 'library') requestAnimationFrame(() => followPlaying(true));
  }

  function setWide(on) {
    if (window.NoorDock && on !== NoorDock.isWide('video')) on = NoorDock.toggleWide('video');
    document.body.classList.toggle('video-wide', on);
    $('#vb-wide')?.setAttribute('aria-pressed', String(on));
  }

  function renderEmpty() {
    const empty = $('#vb-empty');
    const none = !status.folders.length;
    empty.hidden = !none;
    if (none) empty.replaceChildren(el('h2', { text: 'Your videos, in order' }),
      el('p', { text: 'Add a folder with tutorials, recordings or a TV show. Each subfolder becomes a series in episode order; NoorMD remembers where you stopped. Videos are only read, never changed.' }),
      el('button', { class: 'action primary', onclick: addFolder }, '📁 Add a video folder…'));
  }

  // ------------------------------------------------------------------ library view

  function queryPayload() {
    return { search: view.search, filter: view.filter, series: view.series, playlistId: view.playlistId, sort: view.playlistId && view.sort === 'series' ? 'playlist' : view.sort, desc: view.desc };
  }

  async function loadView() {
    let list;
    try { list = await req('video.query', queryPayload()); } catch (err) { hooks.showError(err); return; }
    rows = list;
    rows.forEach((r) => cache.set(r.id, r));
    shown = Math.max(300, shown);
    renderList();
  }

  async function setView(patch) {
    view = { ...view, ...patch };
    if ('playlistId' in patch && patch.playlistId) { view.series = null; }
    if ('series' in patch && patch.series) { view.playlistId = null; }
    selected = -1; sel = new Set(); anchor = -1; shown = 300;
    $('#vb-sort').value = view.sort;
    renderChips();
    renderViewbar();
    $('#vb-list').scrollTop = 0;
    await loadView();
  }

  function renderChips() {
    const box = $('#vb-chips');
    if (!box) return;
    const series = el('select', { id: 'vb-series', 'aria-label': 'Series' }, el('option', { value: '', text: 'All series' }), ...status.series.map((s) => el('option', { value: s.key, text: `${s.name} (${s.watched}/${s.count})` })));
    series.value = view.series || '';
    series.addEventListener('change', () => setView({ series: series.value || null }));
    box.replaceChildren(
      ...FILTERS.map(([v, l]) => el('button', { class: 'chip' + (view.filter === v ? ' active' : ''), 'data-filter': v, onclick: () => setView({ filter: v }) }, v === 'all' ? `${l} ${status.count || ''}`.trim() : l)),
      series);
  }

  function renderViewbar() {
    const bar = $('#vb-viewbar');
    const pl = view.playlistId ? status.playlists.find((p) => p.id === view.playlistId) : null;
    if (!pl) { bar.replaceChildren(); bar.classList.add('hide'); return; }
    bar.classList.remove('hide');
    bar.replaceChildren(el('span', {}, '▤ Playlist: ', el('strong', { text: pl.name })),
      el('button', { class: 'utility-btn', onclick: () => playView(0) }, '▶ Play'),
      el('button', { class: 'utility-btn', onclick: () => setView({ playlistId: null }) }, '✕ Close'));
  }

  function rowNode(v, i) {
    const playing = v.id === currentId();
    const pct = v.duration > 0 && !v.watched && v.position > resumeAfter(v.duration) ? Math.min(100, (v.position / v.duration) * 100) : 0;
    return el('div', {
      class: 'vtrack' + (sel.has(i) ? ' selected' : '') + (i === selected ? ' cursor' : '') + (playing ? ' playing' : '') + (v.watched ? ' watched' : ''),
      role: 'option', 'aria-selected': String(sel.has(i)), 'data-index': String(i), 'data-id': String(v.id),
    },
    el('span', { class: 'track-state', text: playing ? (video.paused ? '❚❚' : '▶') : v.watched ? '✓' : '' }),
    el('span', { class: 'vtrack-text' },
      el('span', { class: 'track-title', text: v.title }),
      el('span', { class: 'track-sub', text: [view.series || view.playlistId ? null : v.series, epLabel(v), v.notes ? `📝 ${v.notes}` : null].filter(Boolean).join(' · ') }),
      pct ? el('span', { class: 'vb-bar' }, el('span', { style: `width:${pct}%` })) : null),
    el('span', { class: 'track-dur', text: pct ? `${fmt(v.position)} / ${fmt(v.duration)}` : fmt(v.duration) }));
  }

  function renderList() {
    const list = $('#vb-list');
    if (!list) return;
    const n = Math.min(rows.length, shown);
    list.replaceChildren(...rows.slice(0, n).map(rowNode),
      ...(rows.length ? [] : [el('p', { class: 'music-none', text: status.folders.length ? 'Nothing here. Try another filter or search.' : 'Add a video folder to start.' })]),
      ...(rows.length > n ? [el('p', { class: 'music-none', text: `Scroll for ${rows.length - n} more…` })] : []));
    updateSelection();
  }

  function updateSelection() {
    document.querySelectorAll('#vb-list .vtrack[data-index]').forEach((node) => {
      const i = Number(node.dataset.index);
      node.classList.toggle('selected', sel.has(i));
      node.classList.toggle('cursor', i === selected);
      node.setAttribute('aria-selected', String(sel.has(i)));
    });
    const c = $('#vb-selcount');
    if (c) c.textContent = sel.size > 1 ? `${sel.size} selected` : '';
  }

  function clickSelect(i, toggleOne, range) {
    if (range && anchor >= 0) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      if (!toggleOne) sel = new Set();
      for (let k = a; k <= b; k++) sel.add(k);
    } else if (toggleOne) { if (sel.has(i)) sel.delete(i); else sel.add(i); anchor = i; }
    else { sel = new Set([i]); anchor = i; }
    selected = i;
    updateSelection();
  }

  function selectIndex(i, extend) {
    if (!rows.length) return;
    selected = Math.max(0, Math.min(rows.length - 1, i));
    if (selected >= shown) { shown = selected + 100; renderList(); }
    if (extend) { if (anchor < 0) anchor = selected; sel = new Set(); for (let k = Math.min(anchor, selected); k <= Math.max(anchor, selected); k++) sel.add(k); }
    else { sel = new Set([selected]); anchor = selected; }
    updateSelection();
    document.querySelector(`#vb-list .vtrack[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  const selectedIds = () => [...(sel.size ? sel : selected >= 0 ? new Set([selected]) : new Set())].sort((a, b) => a - b).map((i) => rows[i] && rows[i].id).filter((x) => x != null);

  function selectAll() { sel = new Set(rows.map((_, i) => i)); if (selected < 0 && rows.length) selected = 0; updateSelection(); }

  function onListKey(e) {
    const map = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
    if (map[e.key] != null && e.altKey && view.playlistId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); moveInPlaylist(map[e.key]); return; }
    if (map[e.key] != null && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); selectIndex((selected < 0 ? -1 : selected) + map[e.key], e.shiftKey); return; }
    if (e.key === 'Home' && !e.ctrlKey) { e.preventDefault(); selectIndex(0, e.shiftKey); return; }
    if (e.key === 'End' && !e.ctrlKey) { e.preventDefault(); selectIndex(rows.length - 1, e.shiftKey); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); selectAll(); return; }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault(); e.stopPropagation();
      const node = document.querySelector(`#vb-list .vtrack[data-index="${selected}"]`);
      const r = (node || $('#vb-list')).getBoundingClientRect();
      showMenu(r.left + 40, r.top + 24);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const ids = selectedIds(); if (ids.length > 1) setQueue(ids, 0, true); else if (selected >= 0) playView(selected); return; }
    if (e.key === 'Delete' && view.playlistId) { e.preventDefault(); e.stopPropagation(); removeFromPlaylist(selectedIds()); }
  }

  let userBrowsedAt = 0;

  /** Keeps the playing video visible (and highlighted) when it changes, unless the user is browsing the list. */
  function followPlaying(force = false) {
    const id = currentId();
    if (id == null || !isOpen() || tab !== 'library') return;
    if (!force && (Date.now() - userBrowsedAt < 10000 || sel.size > 1)) return;
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    if (i >= shown) { shown = i + 100; renderList(); }
    const node = document.querySelector(`#vb-list .vtrack[data-index="${i}"]`);
    const list = $('#vb-list');
    if (!node || !list) return;
    const r = node.getBoundingClientRect(), l = list.getBoundingClientRect();
    if (r.top >= l.top && r.bottom <= l.bottom) return; // already visible
    list.scrollTop += r.top - l.top - list.clientHeight / 2 + r.height / 2;
  }

  async function revealPlaying() {
    const id = currentId();
    if (id == null) { notice('Nothing is playing.'); return; }
    let i = rows.findIndex((r) => r.id === id);
    if (i < 0) { await setView({ search: '', filter: 'all', series: null, playlistId: null }); $('#vb-search').value = ''; i = rows.findIndex((r) => r.id === id); }
    if (i < 0) return;
    setTab('library');
    selectIndex(i, false);
    document.querySelector(`#vb-list .vtrack[data-index="${i}"]`)?.scrollIntoView({ block: 'center' });
  }

  // ------------------------------------------------------------------ the right-click menu

  function showMenu(x, y) {
    const ids = selectedIds();
    if (!ids.length) return;
    const many = ids.length > 1;
    const one = !many ? cache.get(ids[0]) : null;
    const inPl = view.playlistId ? status.playlists.find((p) => p.id === view.playlistId) : null;
    const items = [
      { label: many ? `Play these ${ids.length} videos` : 'Play', run: () => (many ? setQueue(ids, 0, true) : playView(selected)) },
      { label: 'Play next', run: () => playNext(ids) },
      { label: 'Add to Up next', run: () => enqueue(ids) },
      '-',
      { label: 'Add to playlist', sub: () => [
        ...status.playlists.filter((p) => !inPl || p.id !== inPl.id).map((p) => ({ label: `${p.name}  (${p.count})`, run: () => addToPlaylist(p, ids) })),
        ...(status.playlists.length ? ['-'] : []),
        { label: 'New playlist…', run: () => createPlaylist(ids) },
      ] },
      inPl ? { label: `Remove from “${inPl.name}”`, run: () => removeFromPlaylist(ids) } : null,
      inPl && !many ? { label: 'Move up (Alt+↑)', run: () => moveInPlaylist(-1) } : null,
      inPl && !many ? { label: 'Move down (Alt+↓)', run: () => moveInPlaylist(1) } : null,
      '-',
      { label: 'Mark as watched', run: () => markWatched(ids, true) },
      { label: 'Mark as not watched', run: () => markWatched(ids, false) },
      '-',
      { label: 'Notes…', disabled: many, run: () => one && playIds([one.id], 0, false).then(() => setTab('notes')) },
      { label: 'Show in Explorer', disabled: many || !one, run: () => one && req('video.reveal', { id: one.id }).catch(hooks.showError) },
      '-',
      { label: 'Select all', run: selectAll },
    ].filter(Boolean);
    NoorChrome.openMenu(null, items, { x, y });
  }

  // ------------------------------------------------------------------ queue (like the Music Bench)

  function shuffledOrder(n, keepFirst) {
    const order = [...Array(n).keys()].filter((i) => i !== keepFirst);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return keepFirst != null && keepFirst >= 0 ? [keepFirst, ...order] : order;
  }

  async function playView(index) {
    if (!rows[index]) return;
    await setQueue(rows.map((r) => r.id), index, true);
  }

  async function playIds(ids, index, autoplay) { await setQueue(ids, index, autoplay); }

  async function setQueue(ids, startIndex, autoplay, at = null) {
    q.ids = ids.slice();
    q.order = q.shuffle ? shuffledOrder(ids.length, startIndex) : ids.map((_, i) => i);
    q.pos = q.order.indexOf(startIndex);
    await loadCurrent(autoplay, at);
    scheduleSave();
  }

  function enqueue(ids) {
    if (!q.order.length) { setQueue(ids, 0, false); notice(`Added ${ids.length} to Up next`, 1400); return; }
    const base = q.ids.length;
    q.ids.push(...ids);
    q.order.push(...ids.map((_, i) => base + i));
    notice(`Added ${ids.length} to Up next`, 1400);
    renderQueue(); scheduleSave();
  }

  function playNext(ids) {
    if (!q.order.length) { setQueue(ids, 0, true); return; }
    const base = q.ids.length;
    q.ids.push(...ids);
    q.order.splice(q.pos + 1, 0, ...ids.map((_, i) => base + i));
    notice(ids.length === 1 ? 'Plays next' : `${ids.length} play next`, 1400);
    renderQueue(); scheduleSave();
  }

  function next(auto) {
    if (!q.order.length) return;
    if (auto && q.repeat === 'one') { video.currentTime = 0; video.play().catch(() => {}); return; }
    let pos = q.pos + 1;
    if (pos >= q.order.length) {
      if (q.repeat === 'all' || !auto || (q.shuffle && q.ids.length > 1)) {
        if (q.shuffle) { const last = q.order[q.pos]; q.order = shuffledOrder(q.ids.length, -1); if (q.order[0] === last && q.order.length > 1) q.order.push(q.order.shift()); }
        pos = 0;
      } else { notice('That was the last video in Up next ✓', 2500); return; }
    }
    q.pos = pos;
    loadCurrent(true);
    scheduleSave();
  }

  function prev() {
    if (!q.order.length) return;
    if (video.currentTime > 3) { video.currentTime = 0; return; }
    q.pos = q.pos > 0 ? q.pos - 1 : (q.repeat === 'all' ? q.order.length - 1 : 0);
    loadCurrent(true);
    scheduleSave();
  }

  /** Drops queue entries no longer in the play order, so shuffle on/off can't bring removed videos back (and the queue survives a restart). */
  function compactQueue() {
    const keep = new Set(q.order);
    const remap = new Map();
    const ids = [];
    q.ids.forEach((id, i) => { if (keep.has(i)) { remap.set(i, ids.length); ids.push(id); } });
    q.ids = ids;
    q.order = q.order.map((i) => remap.get(i));
  }

  function setShuffle(on) {
    q.shuffle = on;
    if (q.order.length) {
      const cur = q.order[q.pos];
      if (on) { const rest = shuffledOrder(q.ids.length, cur); q.order = rest; q.pos = 0; }
      else { q.order = q.ids.map((_, i) => i); q.pos = Math.max(0, cur); }
    }
    renderTransport(); renderQueue(); scheduleSave();
  }

  function cycleRepeat() { q.repeat = { off: 'all', all: 'one', one: 'off' }[q.repeat]; renderTransport(); scheduleSave(); }

  function playPause() {
    if (!video.getAttribute('src')) { if (q.order.length) loadCurrent(true); else if (rows.length) playView(selected >= 0 ? selected : 0); return; }
    if (video.paused) video.play().catch(() => {}); else video.pause();
  }

  /** In the middle: the list beside the player can be hidden, so the video gets the whole width. */
  function setListsHidden(on) {
    const root = $('#videobench');
    root.classList.toggle('lists-hidden', on);
    $('#vb-list-toggle')?.setAttribute('aria-pressed', String(!on));
    try { localStorage.setItem('noormd.video.listsHidden', on ? '1' : '0'); } catch { /* fine */ }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else $('#vb-stage').requestFullscreen().catch(() => {}); // the stage, so notes on the video show in full screen too
  }

  // Notes on the video: a note appears over the picture at its moment, for a few seconds. Can be switched off (💬).
  const NOTE_SECONDS = 6;
  let notesOnVideo = (() => { try { return localStorage.getItem('noormd.video.notesOnVideo') !== 'off'; } catch { return true; } })();
  let shownNote = null;

  function setNotesOnVideo(on) {
    notesOnVideo = on;
    try { localStorage.setItem('noormd.video.notesOnVideo', on ? 'on' : 'off'); } catch { /* fine */ }
    shownNote = undefined; // redraw whatever is (or isn't) showing now
    renderNotePop();
    renderExtras();
    notice(on ? 'Notes show on the video at their moment' : 'Notes on the video: off', 1600);
  }

  function renderNotePop() {
    const pop = $('#vb-note-pop');
    if (!pop) return;
    const t = video.currentTime;
    const n = notesOnVideo && current && current.notes.length
      ? current.notes.filter((x) => t >= x.time && t < x.time + NOTE_SECONDS).sort((a, b) => b.time - a.time)[0] : null;
    if ((n ? n.id + ':' + n.text : null) === shownNote) return;
    shownNote = n ? n.id + ':' + n.text : null;
    pop.hidden = !n;
    if (n) pop.replaceChildren(el('span', { class: 'vb-note-pop-time', text: n.stamp || fmt(n.time) }), el('span', { class: 'vb-note-pop-text', text: n.text }));
  }

  // ------------------------------------------------------------------ playing

  /** Plays one video by id (the Video Bench API used by the self-test and the pop-out hand-back). */
  async function select(id, { autoplay = false, at = null } = {}) {
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) await setQueue(rows.map((r) => r.id), i, autoplay, at);
    else await setQueue([id], 0, autoplay, at);
  }

  async function loadCurrent(autoplay, at = null) {
    const id = currentId();
    if (current && current.video.id !== id) savePosition(true);
    if (id == null) return;
    let d;
    try { d = await req('video.get', { id }); } catch (err) { hooks.showError(err); return; }
    current = d;
    cache.set(id, d.video);
    hideCountdown();
    showPlayerMessage(null);
    if (poppedOut === id) { renderAll(); showPlayerMessage('Playing in the pop-out player.', [['Bring it back here', () => req('video.popout.close').catch(() => {})]]); return; }
    video.replaceChildren(...d.subtitles.map((s) => el('track', { kind: 'subtitles', label: s.label, srclang: s.lang === 'und' ? 'en' : s.lang, src: `_sub/${id}/${s.index}` })));
    video.src = `_video/${id}`;
    video.volume = q.volume;
    video.dataset.resume = String(at != null ? at : !d.video.watched && d.video.position > resumeAfter(d.video.duration) ? d.video.position : 0);
    video.dataset.autoplay = autoplay ? '1' : '';
    renderAll();
    followPlaying();
    if (!d.exists) showPlayerMessage('This file is missing on disk. Rescan the folder or reconnect the drive.');
  }

  async function reloadCurrent() {
    if (!current) return;
    try { const d = await req('video.get', { id: current.video.id }); current = { ...current, notes: d.notes, next: d.next, video: d.video }; } catch { return; }
    renderNotes();
  }

  function onLoaded() {
    const at = Number(video.dataset.resume || 0);
    if (at > 0 && at < video.duration - 2) {
      video.currentTime = at;
      notice(`Resumed at ${fmt(at)}`, 2500);
      showResumeHint(at);
    } else $('#vb-resume').replaceChildren();
    if (video.dataset.autoplay) video.play().catch(() => {});
    const tracks = [...video.textTracks];
    tracks.forEach((t, i) => { t.mode = i === 0 && current && current.subtitles.length ? 'showing' : 'disabled'; });
    // Keep the language chosen for the previous video when this one has it too.
    const at2 = audioTracks();
    if (audioLang && at2.length > 1) { const i = at2.findIndex((t) => t.language === audioLang); if (i >= 0) setAudio(i, false); }
    renderExtras();
    renderTime();
  }

  function showResumeHint(at) {
    $('#vb-resume').replaceChildren(el('span', { text: `Continued from ${fmt(at)} · ` }), el('button', { class: 'linkish', onclick: () => { video.currentTime = 0; $('#vb-resume').replaceChildren(); } }, 'Start over'));
  }

  function onTime() {
    if (!video.paused && Date.now() - lastSaved > 5000) savePosition(false);
    renderTime();
    const ts = $('#vb-note-time');
    if (ts && !$('#vb-note-input')?.value) ts.textContent = fmt(video.currentTime);
    renderNotePop();
  }

  function renderTime() {
    const d = video.duration, c = video.currentTime;
    $('#vb-cur').textContent = fmt(c);
    $('#vb-dur').textContent = fmt(d);
    const r = $('#vb-range');
    if (!r.dataset.dragging) r.value = Number.isFinite(d) && d > 0 ? String(Math.round((c / d) * 1000)) : '0';
  }

  function savePosition(force) {
    if (!current || !video.getAttribute('src') || !Number.isFinite(video.duration) || poppedOut === current.video.id) return;
    const id = current.video.id;
    if (!force && Date.now() - lastSaved < 5000) return;
    lastSaved = Date.now();
    req('video.position', { id, position: video.currentTime, duration: video.duration }).then((row) => {
      if (!row) return;
      cache.set(id, row);
      const i = rows.findIndex((e) => e.id === id);
      if (i >= 0) rows[i] = row;
      if (current && current.video.id === id) current.video = row;
    }).catch(() => {});
  }

  async function onEnded() {
    if (!current) return;
    await req('video.position', { id: current.video.id, position: video.duration, duration: video.duration }).catch(() => {});
    if (q.repeat === 'one') { video.currentTime = 0; video.play().catch(() => {}); return; }
    await refresh(true);
    const hasNext = q.pos + 1 < q.order.length || q.repeat === 'all' || (q.shuffle && q.ids.length > 1);
    if (!hasNext) { notice('That was the last video in Up next ✓', 3000); return; }
    const nextId = q.pos + 1 < q.order.length ? q.ids[q.order[q.pos + 1]] : null;
    const nextRow = nextId != null ? cache.get(nextId) : null;
    let n = 6;
    const box = $('#vb-countdown');
    box.hidden = false;
    const draw = () => box.replaceChildren(el('div', { text: nextRow ? `Next: ${nextRow.title}` : 'Next video' }), el('div', { class: 'vb-count', text: `in ${n} s` }),
      el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: hideCountdown }, 'Cancel'), el('button', { class: 'action primary', onclick: () => { hideCountdown(); next(true); } }, 'Play now')));
    draw();
    countdown = setInterval(() => { n--; if (n <= 0) { hideCountdown(); next(true); } else draw(); }, 1000);
  }

  function hideCountdown() { clearInterval(countdown); countdown = null; const b = $('#vb-countdown'); if (b) b.hidden = true; }

  function showPlayerMessage(text, actions = []) {
    const m = $('#vb-message');
    if (!m) return;
    m.hidden = !text;
    if (text) m.replaceChildren(el('p', { text }), ...actions.map(([label, fn]) => el('button', { class: 'action', onclick: fn }, label)));
  }

  function renderAll() {
    const v = current && current.video;
    $('#vb-title').textContent = v ? v.title : 'Nothing playing';
    $('#vb-sub').textContent = v ? [v.series, epLabel(v), v.width ? `${v.width}×${v.height}` : null].filter(Boolean).join(' · ') : 'Double-click a video in the list';
    renderTransport();
    renderExtras();
    renderNotes();
    renderList();
    if (tab === 'queue') renderQueue();
  }

  function renderTransport() {
    if (!built) return;
    const play = document.querySelector('#videobench .tp.play');
    play.textContent = video.paused ? '▶' : '❚❚';
    play.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    const sh = document.querySelector('#videobench .tp.shuffle');
    sh.classList.toggle('on', q.shuffle); sh.setAttribute('aria-pressed', String(q.shuffle));
    sh.title = q.shuffle ? 'Shuffle is on — click to play in order' : 'Shuffle is off — click to play in random order';
    const rp = document.querySelector('#videobench .tp.repeat');
    rp.classList.toggle('on', q.repeat !== 'off'); rp.textContent = q.repeat === 'one' ? '↻¹' : '↻';
    rp.title = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this video' }[q.repeat];
    $('#vb-volume').value = String(Math.round(q.volume * 100));
    document.querySelectorAll('#vb-list .vtrack').forEach((n) => {
      const isCur = Number(n.dataset.id) === currentId();
      n.classList.toggle('playing', isCur);
      const s = n.querySelector('.track-state');
      if (s && isCur) s.textContent = video.paused ? '❚❚' : '▶';
    });
  }

  function audioTracks() { return video.audioTracks ? [...video.audioTracks] : []; }

  function setAudio(index, remember = true) {
    const list = audioTracks();
    list.forEach((t, i) => { t.enabled = i === index; });
    if (remember && list[index]) audioLang = list[index].language || null;
    const s = $('#vb-audio');
    if (s) s.value = String(index);
  }

  function renderExtras() {
    const box = $('#vb-extras');
    if (!box) return;
    const speed = el('select', { id: 'vb-speed', 'aria-label': 'Playback speed', title: 'Speed ([ and ])' }, ...SPEEDS.map((s) => el('option', { value: String(s), text: s === 1 ? '1× speed' : `${s}×` })));
    speed.value = String(video.playbackRate);
    speed.addEventListener('change', () => { video.playbackRate = Number(speed.value); scheduleSave(); });
    const subsList = current ? current.subtitles : [];
    const subs = el('select', { id: 'vb-subs', 'aria-label': 'Subtitles', title: 'Subtitles (C)' }, el('option', { value: '-1', text: subsList.length ? 'Subtitles off' : 'No subtitles' }),
      ...subsList.map((s) => el('option', { value: String(s.index), text: s.label })));
    subs.value = String([...video.textTracks].findIndex((t) => t.mode === 'showing'));
    subs.disabled = !subsList.length;
    subs.addEventListener('change', () => setSubtitle(Number(subs.value)));
    const tracks = audioTracks();
    const audio = tracks.length > 1 ? el('select', { id: 'vb-audio', 'aria-label': 'Audio track', title: 'Audio track (A)' },
      ...tracks.map((t, i) => el('option', { value: String(i), text: `🔊 ${t.label || t.language || `Track ${i + 1}`}${t.label && t.language ? ` (${t.language})` : ''}` }))) : null;
    if (audio) { audio.value = String(Math.max(0, tracks.findIndex((t) => t.enabled))); audio.addEventListener('change', () => setAudio(Number(audio.value))); }
    const ic = (label, title, fn, id) => el('button', { class: 'icon-btn', title, 'aria-label': title, id, onclick: fn, disabled: !current || undefined }, label);
    box.replaceChildren(speed, subs, ...(audio ? [audio] : []),
      el('span', { class: 'sd-spacer' }),
      el('button', { class: 'icon-btn' + (notesOnVideo ? ' on' : ''), id: 'vb-notes-on-video', title: notesOnVideo ? 'Notes show on the video at their moment (click to hide them)' : 'Show notes on the video at their moment', 'aria-label': 'Notes on the video', 'aria-pressed': String(notesOnVideo), onclick: () => setNotesOnVideo(!notesOnVideo) }, '💬'),
      ic('⧉', 'Pop out: a small window that stays on top', popOut, 'vb-popout'),
      ic('⛶', 'Full screen (F)', toggleFullscreen),
      ic(current && current.video.watched ? '↺' : '✓', current && current.video.watched ? 'Mark as not watched' : 'Mark as watched', () => current && markWatched([current.video.id], !current.video.watched)));
  }

  function setSubtitle(index) {
    [...video.textTracks].forEach((t, i) => { t.mode = i === index ? 'showing' : 'disabled'; });
    const s = $('#vb-subs');
    if (s) s.value = String(index);
  }

  async function markWatched(ids, value) {
    try { await req('video.watched', { ids, value }); } catch (err) { hooks.showError(err); return; }
    await refresh(true);
    if (current && ids.includes(current.video.id)) { await reloadCurrent(); renderExtras(); }
  }

  // ------------------------------------------------------------------ Up next

  function renderQueue() {
    const box = $('#vb-queue');
    if (!box) return;
    const upcoming = q.order.slice(q.pos + 1);
    const nowRow = cache.get(currentId());
    const item = (orderPos) => {
      const v = cache.get(q.ids[q.order[orderPos]]) || { title: `Video ${q.ids[q.order[orderPos]]}`, duration: 0 };
      return el('div', { class: 'qitem' },
        el('span', { class: 'qpos', text: String(orderPos - q.pos) }),
        el('button', { class: 'qtitle linkish', onclick: () => { q.pos = orderPos; loadCurrent(true); scheduleSave(); } }, v.title),
        el('small', { text: fmt(v.duration) }),
        el('span', { class: 'qactions' },
          el('button', { class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', onclick: () => moveQueue(orderPos, -1) }, '↑'),
          el('button', { class: 'icon-btn', title: 'Move down', 'aria-label': 'Move down', onclick: () => moveQueue(orderPos, 1) }, '↓'),
          el('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove from Up next', onclick: () => { q.order.splice(orderPos, 1); compactQueue(); renderQueue(); scheduleSave(); } }, '✕')));
    };
    box.replaceChildren(
      el('div', { class: 'music-viewbar' }, el('span', { text: `${upcoming.length} upcoming · ${q.shuffle ? 'shuffled' : 'in order'} · repeat ${q.repeat}` }),
        el('button', { class: 'utility-btn', disabled: !q.order.length || undefined, onclick: () => createPlaylist(q.order.map((i) => q.ids[i])) }, 'Save as playlist'),
        el('button', { class: 'utility-btn danger', onclick: () => { q.order = q.order.slice(0, q.pos + 1); compactQueue(); renderQueue(); scheduleSave(); } }, 'Clear upcoming')),
      ...(nowRow ? [el('div', { class: 'qitem playing' }, el('span', { class: 'qpos', text: '▶' }), el('span', { class: 'qtitle', text: nowRow.title }), el('small', { text: fmt(nowRow.duration) }))] : []),
      ...upcoming.slice(0, 500).map((_, k) => item(q.pos + 1 + k)),
      ...(upcoming.length ? [] : [el('p', { class: 'music-none', text: 'Nothing queued. Right-click videos → Add to Up next, or play a playlist.' })]));
  }

  function moveQueue(orderPos, delta) {
    const to = orderPos + delta;
    if (to <= q.pos || to >= q.order.length) return;
    [q.order[orderPos], q.order[to]] = [q.order[to], q.order[orderPos]];
    renderQueue(); scheduleSave();
  }

  // ------------------------------------------------------------------ playlists

  function renderPlaylists() {
    const box = $('#vb-playlists');
    if (!box) return;
    const items = status.playlists.map((p) => el('div', { class: 'qitem', 'data-playlist': String(p.id) },
      el('span', { class: 'qpos', text: '▤' }),
      el('button', { class: 'qtitle linkish', onclick: () => openPlaylist(p.id) }, p.name),
      el('small', { text: `${p.watched}/${p.count} watched · ${fmt(p.duration)}` }),
      el('span', { class: 'qactions' },
        el('button', { class: 'icon-btn', title: 'Play', 'aria-label': `Play ${p.name}`, onclick: () => playPlaylist(p.id) }, '▶'),
        el('button', { class: 'icon-btn', title: 'Rename', 'aria-label': 'Rename', onclick: () => renamePlaylist(p) }, '✎'),
        el('button', { class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete playlist', onclick: () => deletePlaylist(p) }, '✕'))));
    box.replaceChildren(
      el('div', { class: 'music-viewbar' },
        el('button', { class: 'utility-btn', id: 'vb-pl-new', onclick: () => createPlaylist([]) }, '＋ New playlist'),
        el('button', { class: 'utility-btn', id: 'vb-pl-series', onclick: playlistFromSeries }, '＋ From a series / TV show…')),
      ...(items.length ? items : [el('p', { class: 'music-none', text: 'No playlists yet. Make one from a whole series, or right-click videos → Add to playlist.' })]));
  }

  async function openPlaylist(id) { setTab('library'); $('#vb-search').value = ''; await setView({ playlistId: id, search: '', filter: 'all', series: null, sort: 'series' }); }

  async function playPlaylist(id) {
    let list;
    try { list = await req('video.query', { playlistId: id, sort: 'playlist', filter: 'all' }); } catch (err) { hooks.showError(err); return; }
    if (!list.length) { notice('This playlist is empty.'); return; }
    list.forEach((r) => cache.set(r.id, r));
    // Start where you left off: the first unfinished video of the playlist.
    const start = Math.max(0, list.findIndex((v) => !v.watched));
    await setQueue(list.map((v) => v.id), start, true);
  }

  async function createPlaylist(ids, suggested = 'New playlist') {
    const name = await NoorUI.prompt('New playlist', 'Playlist name:', suggested, { okLabel: 'Create' });
    if (!name) return null;
    try {
      const r = await req('video.playlist.create', { name, ids });
      status.playlists = r.playlists;
      renderPlaylists();
      notice(`Playlist “${name}” created${ids.length ? ` with ${ids.length} videos` : ''}`, 2000);
      return r.id;
    } catch (err) { hooks.showError(err); return null; }
  }

  async function playlistFromSeries() {
    if (!status.series.length) { notice('Add a video folder first.'); return; }
    NoorUI.modal({ label: 'Playlist from a series', width: 480 }, (s, closeModal) => {
      const pick = el('select', { id: 'vb-series-pick', 'aria-label': 'Series' }, ...status.series.map((x) => el('option', { value: x.key, text: `${x.name} (${x.count} videos)` })));
      s.append(NoorUI.head('▤ Playlist from a series', closeModal),
        el('div', { class: 'modal-body' }, el('p', { text: 'All videos of the series, in episode order. New episodes added to the folder later can be added with right-click → Add to playlist.' }), pick),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => closeModal() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'vb-series-ok', onclick: async () => {
            const series = status.series.find((x) => x.key === pick.value);
            closeModal();
            let list;
            try { list = await req('video.query', { series: series.key, sort: 'series', filter: 'all' }); } catch (err) { hooks.showError(err); return; }
            await createPlaylist(list.map((v) => v.id), series.name);
          } }, 'Next…'))));
    });
  }

  async function addToPlaylist(p, ids) {
    try { status.playlists = await req('video.playlist.add', { id: p.id, ids }); renderPlaylists(); notice(`Added ${ids.length === 1 ? 'the video' : `${ids.length} videos`} to “${p.name}”`, 1600); }
    catch (err) { hooks.showError(err); }
  }

  async function removeFromPlaylist(ids) {
    const pl = status.playlists.find((p) => p.id === view.playlistId);
    if (!pl || !ids.length) return;
    // Edit the whole playlist, not just what is shown: hidden entries (filtered, searched, missing) stay in it.
    let keep;
    try {
      keep = await req('video.playlist.items', { id: pl.id });
      for (const id of ids) { const at = keep.indexOf(id); if (at >= 0) keep.splice(at, 1); }
      status.playlists = await req('video.playlist.setItems', { id: pl.id, ids: keep });
    } catch (err) { hooks.showError(err); return; }
    notice(`Removed ${ids.length} from “${pl.name}” (the files are not touched)`, 2200);
    sel = new Set(); selected = -1; anchor = -1;
    renderPlaylists(); renderViewbar();
    await loadView();
  }

  async function moveInPlaylist(delta) {
    const pl = status.playlists.find((p) => p.id === view.playlistId);
    if (!pl || selected < 0) return;
    if (view.sort !== 'series' || view.search || view.filter !== 'all' || view.desc) { notice('Clear the search and filter (and ⇅) to reorder the playlist.'); return; }
    const to = selected + delta;
    if (to < 0 || to >= rows.length) return;
    let ids;
    try {
      // Swap the two entries in the whole playlist (missing videos aren't shown but keep their places).
      ids = await req('video.playlist.items', { id: pl.id });
      const a = ids.indexOf(rows[selected].id), b = ids.indexOf(rows[to].id);
      if (a < 0 || b < 0) return;
      [ids[a], ids[b]] = [ids[b], ids[a]];
      status.playlists = await req('video.playlist.setItems', { id: pl.id, ids });
    } catch (err) { hooks.showError(err); return; }
    await loadView();
    selectIndex(to, false);
  }

  async function renamePlaylist(p) {
    const name = await NoorUI.prompt('Rename playlist', 'New name:', p.name, { okLabel: 'Rename' });
    if (!name) return;
    try { status.playlists = await req('video.playlist.rename', { id: p.id, name }); renderPlaylists(); renderViewbar(); } catch (err) { hooks.showError(err); }
  }

  async function deletePlaylist(p) {
    if (!await NoorUI.confirm('Delete playlist?', `“${p.name}” will be deleted. The videos are not touched.`, 'Delete')) return;
    try { status.playlists = await req('video.playlist.delete', { id: p.id }); } catch (err) { hooks.showError(err); return; }
    if (view.playlistId === p.id) await setView({ playlistId: null });
    renderPlaylists();
  }

  // ------------------------------------------------------------------ notes

  function renderNotes() {
    const box = $('#vb-notes');
    if (!box) return;
    const tabBtn = document.querySelector('[data-vbtab="notes"]');
    if (tabBtn) tabBtn.textContent = current && current.notes.length ? `Notes (${current.notes.length})` : 'Notes';
    if (!current) { box.replaceChildren(el('p', { class: 'music-none', text: 'Notes are tied to a moment in the video. Play something, then press N.' })); return; }
    const input = el('textarea', { id: 'vb-note-input', rows: '2', placeholder: 'Note at this moment… (Enter adds, Shift+Enter new line)', 'aria-label': 'New note' });
    let at = null;
    input.addEventListener('input', () => { if (at == null && input.value) { at = video.currentTime; $('#vb-note-time').textContent = fmt(at); noteStarted(); } if (!input.value) at = null; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const text = input.value; addNote(text, at ?? video.currentTime); at = null; if (text.trim()) noteFinished(); }
      if (e.key === 'Escape') { e.stopPropagation(); input.value = ''; at = null; noteFinished(); $('#videobench').focus(); }
    });
    const pauseBox = el('input', { type: 'checkbox', id: 'vb-note-pause' });
    pauseBox.checked = pauseOnNote;
    pauseBox.addEventListener('change', () => { pauseOnNote = pauseBox.checked; if (!pauseOnNote) resumeAfterNote = false; scheduleSave(); });
    box.replaceChildren(
      el('div', { class: 'vb-notes-head' }, el('strong', { text: current.video.title }),
        el('button', { class: 'utility-btn', disabled: !current.notes.length || undefined, onclick: insertNotes, title: 'Insert the notes into the open document as a list with timestamps' }, '⇩ Into document')),
      el('div', { class: 'vb-note-new' }, el('span', { class: 'vb-stamp', id: 'vb-note-time', text: fmt(video.currentTime) }), input),
      el('label', { class: 'inline vb-note-option', title: 'The video waits while you write and continues when the note is added (Esc cancels and continues too)' }, pauseBox, 'Pause while I write a note'),
      el('ol', { class: 'vb-note-list', id: 'vb-note-list' }, ...current.notes.map((n) => el('li', { class: 'vb-note', 'data-note': String(n.id) },
        el('button', { class: 'vb-stamp linkish', title: 'Jump to this moment', onclick: () => { video.currentTime = n.time; video.play().catch(() => {}); } }, n.stamp),
        el('span', { class: 'vb-note-text', text: n.text, title: 'Double-click to edit', ondblclick: (e) => editNote(n, e.currentTarget) }),
        el('button', { class: 'icon-btn', title: 'Delete note', 'aria-label': 'Delete note', onclick: () => deleteNote(n) }, '✕')))));
  }

  /** Writing a note started: pause (if that option is on) and remember to continue afterwards. */
  function noteStarted() {
    if (pauseOnNote && !video.paused) { video.pause(); resumeAfterNote = true; }
  }

  /** The note was added or cancelled: continue if we paused for it. */
  function noteFinished() {
    if (resumeAfterNote) { resumeAfterNote = false; video.play().catch(() => {}); }
  }

  async function addNote(text, time) {
    if (!text.trim() || !current) return;
    try {
      const r = await req('video.note.add', { id: current.video.id, time, text });
      current.notes = r.notes;
      renderNotes();
      $('#vb-note-input')?.focus();
    } catch (err) { hooks.showError(err); }
  }

  function editNote(n, span) {
    const ta = el('textarea', { class: 'vb-note-edit', rows: '2', 'aria-label': 'Edit note' });
    ta.value = n.text;
    span.replaceWith(ta);
    ta.focus();
    let finished = false;
    const done = async (save) => {
      if (finished) return;
      finished = true;
      if (save && ta.value.trim() && ta.value !== n.text) {
        try { current.notes = await req('video.note.update', { id: current.video.id, noteId: n.id, text: ta.value }); } catch (err) { hooks.showError(err); }
      }
      renderNotes();
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
    ta.addEventListener('blur', () => done(true));
  }

  async function deleteNote(n) {
    try { current.notes = await req('video.note.delete', { id: current.video.id, noteId: n.id }); renderNotes(); } catch (err) { hooks.showError(err); }
  }

  async function insertNotes() {
    try { const r = await req('video.note.insert', { id: current.video.id }); notice(`Notes inserted into “${r.document}”`, 2500); } catch (err) { hooks.showError(err); }
  }

  // ------------------------------------------------------------------ pop-out

  async function popOut() {
    if (!current) return;
    const id = current.video.id, time = video.currentTime || current.video.position || 0, paused = video.paused;
    savePosition(true);
    try { await req('video.popout', { id, time, paused, pauseOnNote }); } catch (err) { hooks.showError(err); return; }
    poppedOut = id;
    video.pause();
    video.removeAttribute('src');
    video.load();
    showPlayerMessage('Playing in the pop-out player. It stays on top of other windows; close it to continue here.');
  }

  async function onPopIn(p) {
    poppedOut = null;
    if (!built) return;
    showPlayerMessage(null);
    if (current && current.video.id === p.id) { await loadCurrent(isOpen(), p.time); return; }
    if (p.id == null) return;
    // The pop-out moved on (next episode): continue that one here, where it stopped.
    const k = q.order.findIndex((i) => q.ids[i] === p.id);
    if (k >= 0) { q.pos = k; await loadCurrent(isOpen(), p.time); scheduleSave(); }
    else await select(p.id, { autoplay: isOpen(), at: p.time });
  }

  // ------------------------------------------------------------------ folders, keys, session

  async function addFolder() {
    try { const r = await req('video.addFolder'); if (r && !r.cancelled) await refresh(true); } catch (err) { hooks.showError(err); }
  }

  function showFolders() {
    NoorUI.modal({ label: 'Video folders', width: 560 }, (s, closeModal) => {
      const draw = () => s.querySelector('.modal-body').replaceChildren(
        ...(status.folders.length ? status.folders.map((f) => el('div', { class: 'qitem' }, el('span', { class: 'qtitle', text: f.path }), el('small', { text: `${f.count} videos` }),
          el('button', { class: 'icon-btn', title: 'Remove from the library (files stay on disk)', 'aria-label': 'Remove folder', onclick: async () => {
            if (!await NoorUI.confirm('Remove this folder?', `“${f.path}” is removed from the Video Bench, with its positions and notes. The videos stay on disk.`, 'Remove')) return;
            await req('video.removeFolder', { id: f.id }).catch(hooks.showError);
            if (current && current.video.folder.startsWith(f.path)) { current = null; q = { ...q, ids: [], order: [], pos: -1 }; video.removeAttribute('src'); video.load(); renderAll(); }
            await refresh(true); draw();
          } }, '✕'))) : [el('p', { class: 'music-none', text: 'No folders yet.' })]));
      s.append(NoorUI.head('📁 Video folders', closeModal), el('div', { class: 'modal-body' }),
        el('div', { class: 'modal-foot' }, el('span', { text: 'Subfolders are included. Files are only read.' }),
          el('div', { class: 'modal-buttons' },
            el('button', { class: 'action', onclick: async () => { await req('video.rescan').catch(hooks.showError); await refresh(true); draw(); } }, 'Rescan'),
            el('button', { class: 'action primary', onclick: async () => { await addFolder(); draw(); } }, 'Add folder…'))));
      draw();
    });
  }

  function onKey(e) {
    const typing = e.target.closest('input, textarea, select');
    if (e.key === 'Escape' && !typing) { if (document.fullscreenElement) return; e.preventDefault(); e.stopPropagation(); close(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !current) return;
    if (e.target.closest('#vb-list') && /^(Arrow|Page|Home|End|Enter|Delete)/.test(e.key)) return;
    const k = e.key;
    const seek = (d) => { video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + d)); };
    if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); playPause(); }
    else if (k === 'j' || k === 'J') { e.preventDefault(); seek(-10); }
    else if (k === 'l' || k === 'L') { e.preventDefault(); seek(10); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); seek(k === 'ArrowLeft' ? -5 : 5); }
    else if (k === 'f' || k === 'F') { e.preventDefault(); toggleFullscreen(); }
    else if (k === 'n' || k === 'N') { e.preventDefault(); setTab('notes'); const i = $('#vb-note-input'); if (i) { i.focus(); i.dispatchEvent(new Event('input')); noteStarted(); } }
    else if (k === '[' || k === ']') {
      e.preventDefault();
      const i = SPEEDS.indexOf(video.playbackRate);
      video.playbackRate = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + (k === ']' ? 1 : -1)))];
      notice(`Speed ${video.playbackRate}×`, 900);
      renderExtras();
    } else if (k === 'c' || k === 'C') {
      e.preventDefault();
      const n = video.textTracks.length;
      if (!n) { notice('No subtitles for this video.'); return; }
      const cur = [...video.textTracks].findIndex((t) => t.mode === 'showing');
      const nx = cur + 1 >= n ? -1 : cur + 1;
      setSubtitle(nx);
      notice(nx < 0 ? 'Subtitles off' : `Subtitles: ${video.textTracks[nx].label}`, 1200);
    } else if (k === 'a' || k === 'A') {
      e.preventDefault();
      const t = audioTracks();
      if (t.length < 2) { notice('This video has one audio track.'); return; }
      const nx = (t.findIndex((x) => x.enabled) + 1) % t.length;
      setAudio(nx);
      notice(`Audio: ${t[nx].label || t[nx].language || `Track ${nx + 1}`}`, 1200);
    }
  }

  let saveTimer = 0;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 800); }

  function saveSession() {
    const json = JSON.stringify({ v: 2, ids: q.ids, order: q.order, pos: q.pos, shuffle: q.shuffle, repeat: q.repeat, volume: q.volume, speed: video.playbackRate, audioLang, pauseOnNote, view: { filter: view.filter, series: view.series, playlistId: view.playlistId, sort: view.sort, desc: view.desc } });
    req('video.session.save', { json }).catch(() => {});
  }

  async function restoreSession() {
    let s = null;
    try { const json = await req('video.session.get'); s = json ? JSON.parse(json) : null; } catch { s = null; }
    if (s && s.v === 2) {
      q.shuffle = !!s.shuffle; q.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
      q.volume = Number.isFinite(s.volume) ? s.volume : 1;
      audioLang = s.audioLang || null;
      pauseOnNote = s.pauseOnNote !== false;
      if (s.view) { view = { ...view, ...s.view, search: '' }; $('#vb-sort').value = view.sort; renderChips(); renderViewbar(); await loadView(); }
      if (Array.isArray(s.ids) && s.ids.length && Array.isArray(s.order) && s.order.length && s.order.every((i) => Number.isInteger(i) && i >= 0 && i < s.ids.length)) {
        q.ids = s.ids; q.order = s.order; q.pos = Math.min(Math.max(0, s.pos | 0), s.order.length - 1);
        compactQueue(); // a queue saved with removed entries (older versions) comes back without them
        await loadCurrent(false);
      }
    }
    if (!current && status.resume.length) await select(status.resume[0].id, { autoplay: false });
    renderTransport();
  }

  return {
    init, open, close, toggle, isOpen, select, addFolder,
    _state: () => ({
      open: isOpen(), current: current ? { id: current.video.id, title: current.video.title, notes: current.notes.length, subtitles: current.subtitles.length } : null,
      rows: rows.map((r) => r.id), sel: [...sel].sort((a, b) => a - b), view: { ...view }, q: { ...q, current: currentId() },
      time: video.currentTime, paused: video.paused, rate: video.playbackRate, poppedOut, tracks: [...video.textTracks].map((t) => t.mode),
      audio: audioTracks().map((t) => [t.label, t.language, t.enabled]),
    }),
  };
})();
