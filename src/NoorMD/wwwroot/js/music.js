// NoorMD Creator's Bench — Music Bench UI and player.
// Playback uses one <audio> element served from https://noormd.local/_media/{id} (the host answers HTTP ranges).
// The page refers to tracks only by library id; files, tags and renames are handled by the host.
window.NoorMusic = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const bridge = NoorBridge;

  const ROW = 50;            // px per virtual-list row
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
  let status = { folders: [], stats: null, playlists: [], scanning: false, undo: null };
  const cache = new Map();  // track id -> row
  let view = { search: '', triage: null, missingOnly: false, playlistId: null, sort: 'title', desc: false, total: 0 };
  let viewRows = new Map(); // index -> row
  let viewGen = 0;
  const pending = new Set();
  let selected = -1;
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
    document.body.classList.toggle('music-open', open);
    if (open) { start().then(() => focusList()); }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function applyVisibility() {
    const prefs = hooks.getPrefs();
    document.body.classList.toggle('music-disabled', !enabled());
    document.documentElement.style.setProperty('--music-w', Math.min(640, Math.max(300, Number(prefs.musicWidth) || 400)) + 'px');
    if (!enabled()) { audio.pause(); document.body.classList.remove('music-open'); }
    $('#miniplayer').classList.toggle('hide', !enabled() || prefs.miniPlayer === false || currentId() == null);
  }

  function buildPanel() {
    const panel = $('#music');
    panel.innerHTML = '';
    panel.append(
      el('div', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '♫' }), el('strong', { text: 'Music Bench' }), el('small', { id: 'music-count' })),
        el('button', { class: 'icon-btn', title: 'Close (Ctrl+Shift+M)', 'aria-label': 'Close Music Bench', onclick: () => togglePanel(false) }, '✕')),
      buildNowPlaying(),
      el('div', { class: 'music-tabs', role: 'tablist' },
        ...[['library', 'Library'], ['queue', 'Up next'], ['playlists', 'Playlists']].map(([id, label]) =>
          el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', onclick: () => setTab(id) }, label))),
      el('div', { class: 'music-pane', 'data-pane': 'library' },
        el('div', { class: 'music-toolbar' },
          el('input', { id: 'music-search', type: 'search', placeholder: 'Search title, file, folder, genre…', 'aria-label': 'Search music', autocomplete: 'off', spellcheck: 'false' }),
          el('select', { id: 'music-sort', 'aria-label': 'Sort by' }, SORTS.map(([v, l]) => el('option', { value: v }, l))),
          el('button', { class: 'icon-btn', id: 'music-desc', title: 'Reverse order', 'aria-label': 'Reverse sort order' }, '⇅')),
        el('div', { class: 'music-chips', id: 'music-chips' }),
        el('div', { class: 'music-viewbar', id: 'music-viewbar' }),
        el('div', { class: 'music-list', id: 'music-list', tabindex: '0', role: 'listbox', 'aria-label': 'Tracks' }, el('div', { class: 'music-spacer', id: 'music-spacer' })),
        el('div', { class: 'music-empty hide', id: 'music-empty' })),
      el('div', { class: 'music-pane hide', 'data-pane': 'queue' }, el('div', { class: 'music-queue', id: 'music-queue' })),
      el('div', { class: 'music-pane hide', 'data-pane': 'playlists' }, el('div', { class: 'music-playlists', id: 'music-playlists' })),
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
    list.addEventListener('keydown', onListKey);
    // One delegated handler for all rows. Selecting must not rebuild the rows: a double-click needs both
    // clicks to land on the same element, and re-rendering between them would swallow it.
    list.addEventListener('click', (e) => {
      const node = e.target.closest('.track[data-index]');
      if (!node || e.target.closest('button')) return;
      selected = Number(node.dataset.index);
      updateSelection();
    });
    list.addEventListener('dblclick', (e) => {
      const node = e.target.closest('.track[data-index]');
      if (!node || e.target.closest('button')) return;
      playView(Number(node.dataset.index));
    });
    new ResizeObserver(() => requestAnimationFrame(renderList)).observe(list);
    renderChips();

    const resizer = $('#music-resizer');
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing-sidebar');
      const move = (ev) => document.documentElement.style.setProperty('--music-w', Math.min(640, Math.max(300, window.innerWidth - ev.clientX)) + 'px');
      const up = () => {
        resizer.removeEventListener('pointermove', move); resizer.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing-sidebar');
        hooks.setPrefs({ musicWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--music-w'), 10) });
      };
      resizer.addEventListener('pointermove', move); resizer.addEventListener('pointerup', up);
    });
  }

  function setTab(id) {
    tab = id;
    document.querySelectorAll('.music-tabs button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === id); b.setAttribute('aria-selected', String(b.dataset.tab === id)); });
    document.querySelectorAll('.music-pane').forEach((p) => p.classList.toggle('hide', p.dataset.pane !== id));
    if (id === 'queue') renderQueue();
    if (id === 'playlists') renderPlaylists();
    if (id === 'library') requestAnimationFrame(renderList);
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
    if ('playlistId' in patch && patch.playlistId) view.sort = 'playlist';
    $('#music-sort').value = view.sort === 'playlist' ? 'title' : view.sort;
    viewRows = new Map();
    viewGen++;
    selected = -1;
    $('#music-list').scrollTop = 0;
    renderChips();
    renderViewbar();
    await loadView(true);
  }

  function queryPayload(offset, limit) {
    return { search: view.search, triage: view.triage, missingOnly: view.missingOnly, playlistId: view.playlistId, sort: view.sort, desc: view.desc, offset, limit };
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
    spacer.style.height = view.total * ROW + 'px';
    const first = Math.max(0, Math.floor(list.scrollTop / ROW) - 5);
    const last = Math.min(view.total, Math.ceil((list.scrollTop + list.clientHeight) / ROW) + 5);
    const missingPages = new Set();
    const nodes = [];
    for (let i = first; i < last; i++) {
      const row = viewRows.get(i);
      if (!row) { missingPages.add(Math.floor(i / PAGE) * PAGE); nodes.push(el('div', { class: 'track loading', style: `top:${i * ROW}px` }, el('span', { class: 'muted', text: '…' }))); continue; }
      nodes.push(trackRow(row, i));
    }
    spacer.replaceChildren(...nodes);
    for (const off of missingPages) fetchPage(off).then(() => requestAnimationFrame(renderList));
    if (!view.total && status.folders.length) spacer.replaceChildren(el('div', { class: 'music-none', text: view.search ? 'No tracks match your search.' : 'No tracks here yet.' }));
  }

  function trackRow(row, i) {
    const playing = row.id === currentId();
    const t = TRIAGE[row.triage] || TRIAGE[0];
    const node = el('div', {
      class: 'track' + (i === selected ? ' selected' : '') + (playing ? ' playing' : '') + (row.missing ? ' missing' : ''),
      style: `top:${i * ROW}px`, role: 'option', 'aria-selected': String(i === selected), 'data-index': String(i), 'data-id': String(row.id),
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
      const on = Number(n.dataset.index) === selected;
      n.classList.toggle('selected', on);
      n.setAttribute('aria-selected', String(on));
    });
  }

  function focusList() { const l = $('#music-list'); if (l && !l.classList.contains('hide')) l.focus({ preventScroll: true }); }

  function selectIndex(i) {
    if (!view.total) return;
    selected = Math.max(0, Math.min(view.total - 1, i));
    const list = $('#music-list');
    const top = selected * ROW;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW - list.clientHeight;
    renderList();
  }

  function onListKey(e) {
    const row = viewRows.get(selected);
    const page = Math.max(1, Math.floor($('#music-list').clientHeight / ROW) - 1);
    const map = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if (map[e.key] != null) { e.preventDefault(); selectIndex((selected < 0 ? -1 : selected) + map[e.key]); return; }
    if (e.key === 'Home') { e.preventDefault(); selectIndex(0); return; }
    if (e.key === 'End') { e.preventDefault(); selectIndex(view.total - 1); return; }
    if (!row || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Enter') { e.preventDefault(); playView(selected); }
    else if (/^[0-4]$/.test(e.key)) { e.preventDefault(); setTriage([row.id], Number(e.key)); }
    else if (e.key.toLowerCase() === 'q') { e.preventDefault(); enqueue([row.id]); }
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); playNext([row.id]); }
    else if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); editTrack(row.id); }
  }

  // ------------------------------------------------------------------ queue & playback

  function shuffledOrder(n, keepFirst) {
    const order = [...Array(n).keys()].filter((i) => i !== keepFirst);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return keepFirst != null && keepFirst >= 0 ? [keepFirst, ...order] : order;
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
    if (autoplay) audio.play().catch((err) => { if (err.name !== 'AbortError') console.warn(err); });
    renderAll();
    updateMediaSession();
    loadTracks(upcomingIds(50));
  }

  function onLoaded() {
    if (restorePosition != null) { try { audio.currentTime = Math.min(restorePosition, audio.duration || restorePosition); } catch { } restorePosition = null; }
    renderTransport();
  }

  function onTime() {
    renderTime();
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
      if (q.repeat === 'all' || (!auto)) {
        if (q.shuffle && q.repeat === 'all') q.order = shuffledOrder(q.ids.length, -1);
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

  function removeFromQueue(orderPos) {
    if (orderPos === q.pos) { notice('That track is playing. Skip it first.', 1600); return; }
    q.order.splice(orderPos, 1);
    if (orderPos < q.pos) q.pos--;
    renderQueue(); scheduleSave();
  }

  function moveInQueue(orderPos, delta) {
    const to = orderPos + delta;
    if (to <= q.pos || to >= q.order.length || orderPos <= q.pos) return;
    [q.order[orderPos], q.order[to]] = [q.order[to], q.order[orderPos]];
    renderQueue(); scheduleSave();
  }

  function clearUpcoming() { q.order = q.order.slice(0, q.pos + 1); renderQueue(); scheduleSave(); }

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
    const json = JSON.stringify({ v: 1, ids, order, pos: q.pos, shuffle: q.shuffle, repeat: q.repeat, volume: q.volume, position: audio.currentTime || 0 });
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
        el('div', { class: 'np-art', id: 'np-art', 'aria-hidden': 'true' }, el('span', { text: '♫' })),
        el('div', { class: 'np-text' },
          el('div', { class: 'np-title', id: 'np-title', text: 'Nothing playing' }),
          el('div', { class: 'np-sub', id: 'np-sub', text: 'Pick a track and press Enter' }),
          el('div', { class: 'np-file', id: 'np-file' }))),
      el('div', { class: 'np-seek' },
        el('span', { id: 'np-cur', text: '0:00' }),
        el('input', { type: 'range', id: 'np-range', min: '0', max: '1000', value: '0', 'aria-label': 'Seek' }),
        el('span', { id: 'np-dur', text: '0:00' })),
      el('div', { class: 'np-controls' },
        tr('shuffle', '⇄', 'Shuffle', () => setShuffle(!q.shuffle)),
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
      b('⏮', 'Previous', prev), b('▶', 'Play / pause', toggle, 'mp-play'), b('⏭', 'Next', () => next(false)),
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

  function renderAll() { renderTransport(); renderTime(); renderList(); if (tab === 'queue') renderQueue(); applyVisibility(); }

  function renderTransport() {
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
    document.querySelectorAll('.tp.shuffle').forEach((b) => b.classList.toggle('on', q.shuffle));
    document.querySelectorAll('.tp.repeat').forEach((b) => { b.classList.toggle('on', q.repeat !== 'off'); b.textContent = q.repeat === 'one' ? '↻¹' : '↻'; b.title = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this track' }[q.repeat]; });
    const tri = currentTriage();
    document.querySelectorAll('.np-triage .chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.triage) === tri));
    $('#mp-triage').textContent = tri ? TRIAGE[tri].icon : '';
    $('#np-volume').value = String(Math.round(q.volume * 100));
    for (const sel of ['#np-art', '#mp-art']) {
      const box = $(sel);
      const want = row && row.hasArt ? `_art/${row.id}?v=${mediaVersion}` : null;
      if (box.dataset.src === (want || '')) continue;
      box.dataset.src = want || '';
      box.replaceChildren(want ? el('img', { src: want, alt: '', onerror: (e) => e.target.replaceWith(el('span', { text: '♫' })) }) : el('span', { text: '♫' }));
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
    const box = $('#music-queue');
    if (!box) return;
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
    box.replaceChildren(
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
        if (isCurrent) {
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
    undoLastEdit, addFolder, importPlaylist, showFolders, setShuffle: () => setShuffle(!q.shuffle), cycleRepeat,
    isOpen: () => document.body.classList.contains('music-open'),
    // test hooks (used by the automated UI tests and NoorMD.exe --self-test)
    _testPlay: async (ids, index, muted) => { await start(); audio.muted = !!muted; await setQueue(ids, index, true); },
    _state: () => ({ q: { ...q, current: currentId() }, paused: audio.paused, time: audio.currentTime, duration: audio.duration, src: audio.getAttribute('src'), view: { ...view }, selected, rows: viewRows.size }),
  };
})();
