// The Music bench's page, as in NoorMD 2.0 (music.js): the player card, Library / Up next / Playlists / Sound, the
// library as a two-line list (beside your writing) or, with room (900 px and up, the bench in the middle), the player
// and Up next on the left and the library as a table on the right. Track editing, the Batch Organizer, smart
// collections and the folders dialog come along. The player itself runs in the main window (engine.js); this page
// talks to it through the bench's events, so it works the same in a bench window or a floating panel.
import { el, menu } from '/ui/js/noor-ui.js';
import { NoorFx } from './fx.js';

const PAGE = 200;          // rows fetched per request
export const TRIAGE = [
  { v: 0, label: 'Not marked', short: '—', icon: '○' },
  { v: 1, label: 'Favourite', short: 'Fav', icon: '★' },
  { v: 2, label: 'Keep', short: 'Keep', icon: '✓' },
  { v: 3, label: 'Maybe', short: 'Maybe', icon: '?' },
  { v: 4, label: 'Skip', short: 'Skip', icon: '✕' },
];
const SORTS = [['title', 'Title'], ['filename', 'File name'], ['folder', 'Folder'], ['artist', 'Artist'], ['genre', 'Genre'], ['year', 'Year'], ['duration', 'Duration'], ['triage', 'Mark'], ['added', 'Date added'], ['plays', 'Play count']];
// Columns of the wide library: [label, sort key or null, class].
const COLUMNS = [['Title', 'title', 'c-title'], ['Artist', 'artist', 'c-artist'], ['Album', null, 'c-album'], ['Genre', 'genre', 'c-genre'], ['Year', 'year', 'c-year'],
  ['', 'triage', 'c-triage'], ['Plays', 'plays', 'c-plays'], ['Time', 'duration', 'c-time']];
export const ICON = { shuffle: '⇄', random: '⚄', prev: '⏮', play: '▶', pause: '❚❚', next: '⏭', repeat: '↻', repeatOne: '↻¹' };

export const art = (id, v = 0) => `/media/noor.music/art/${id}${v ? `?v=${v}` : ''}`;
const media = (id) => `/media/noor.music/track/${id}`;
export function fmt(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
}

// ---------------------------------------------------------------- the player's state, as this window last heard it
export const heard = { state: null, time: null };
export function listen(ctx, onState, onTime) {
  const offs = [
    ctx.on('player.state', (s) => { heard.state = s; if (s) heard.time = { id: s.id, time: s.time, duration: s.duration }; onState && onState(s); }),
    ctx.on('player.time', (t) => { heard.time = t; onTime && onTime(t); }),
  ];
  if (heard.state && onState) setTimeout(() => onState(heard.state), 0);
  ctx.emit('player.ask');
  return () => offs.forEach((f) => f());
}
export const doIt = (ctx, m) => ctx.emit('player.do', m);

/** A calm placeholder when a track has no artwork: a gradient and an initial from its title. */
export function artPlaceholder(row) {
  const name = row ? (row.displayTitle || row.fileName || '♫') : '♫';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const hue = h % 360;
  const letter = row ? ([...name.replace(/^[^\p{L}\p{N}]+/u, '')][0] || '♫').toUpperCase() : '♫';
  return el('span', { class: 'art-ph', style: `background:linear-gradient(135deg,hsl(${hue} 55% 42%),hsl(${(hue + 50) % 360} 60% 28%))`, text: letter });
}
/** Fills an artwork box (the picture, or the placeholder), only when what it shows changes. */
export function setArt(box, row, v = 0) {
  const want = row && row.hasArt ? art(row.id, v) : null;
  const key = want || (row ? 'ph:' + row.id + ':' + (row.displayTitle || '') : '');
  if (box.dataset.src === key) return;
  box.dataset.src = key;
  box.replaceChildren(want ? el('img', { src: want, alt: '', onerror: (e) => e.target.replaceWith(artPlaceholder(row)) }) : row ? artPlaceholder(row) : el('span', { text: '♫' }));
}

// ---------------------------------------------------------------- dialogs (2.0's modals, in Noor.UI's look)
export function modal({ label, width = 640, onClose = null }, build) {
  let done = false;
  const scrim = el('div', { class: 'nui-scrim nm-scrim', onpointerdown: (e) => { if (e.target === scrim) close(); } });
  const surface = el('div', { class: 'nui-dialog nm-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, style: `width:min(${width}px, calc(100vw - 32px))` });
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  function close() { if (done) return; done = true; scrim.remove(); document.removeEventListener('keydown', onKey, true); if (onClose) onClose(); }
  scrim.append(surface);
  document.body.append(scrim);
  document.addEventListener('keydown', onKey, true);
  build(surface, close);
  const first = surface.querySelector('[autofocus], input:not([type=checkbox]), select, .nui-btn.primary');
  if (first) setTimeout(() => first.focus(), 0);
  return close;
}
export const head = (title, close) => el('header', {}, el('span', { text: title }), el('button', { class: 'nui-icon', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => close() }, '✕'));
export function prompt(title, label, value, { okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    modal({ label: title, width: 440, onClose: () => resolve(null) }, (s, close) => {
      const input = el('input', { type: 'text', class: 'nui-field', value: value || '', 'aria-label': label, autofocus: true });
      const ok = () => { resolve(input.value.trim() || null); close(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      s.append(head(title, () => { close(); resolve(null); }), el('div', { class: 'modal-body' }, el('label', { class: 'nm-label', text: label }), input),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' },
          el('button', { class: 'nui-btn', onclick: () => { close(); resolve(null); } }, 'Cancel'), el('button', { class: 'nui-btn primary', onclick: ok }, okLabel))));
      setTimeout(() => input.select(), 0);
    });
  });
}
export function confirm(title, lines, okLabel = 'OK') {
  return new Promise((resolve) => {
    modal({ label: title, width: 480, onClose: () => resolve(false) }, (s, close) => {
      const end = (v) => { resolve(v); close(); };
      s.append(head(title, () => end(false)), el('div', { class: 'modal-body' }, ...[].concat(lines).map((t) => el('p', { text: t }))),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' },
          el('button', { class: 'nui-btn', onclick: () => end(false) }, 'Cancel'), el('button', { class: 'nui-btn primary', autofocus: true, onclick: () => end(true) }, okLabel))));
    });
  });
}

// ---------------------------------------------------------------- scanning: progress, and how the last one went
export function lastScanNote(ls) {
  if (!ls) return '';
  if (ls.phase === 'error') return `The last look through your music stopped: ${ls.message || 'an error'}.`;
  if (ls.phase === 'unavailable') return ls.message || 'A music folder wasn\'t available.';
  if (ls.phase === 'cancelled') return 'The last look through your music was stopped before the end.';
  if (ls.errors > 0) return `${ls.errors.toLocaleString()} file${ls.errors === 1 ? '' : 's'} couldn't be read${ls.message ? ` (the first: ${ls.message})` : ''}.`;
  return '';
}

/** While NoorMD looks through the folders: a bar with the count climbing and Stop; afterwards a note if anything went
    wrong (which files couldn't be read, and why). */
function scanBanner(ctx, onProgress) {
  const text = el('span', { class: 'mu-scan-text' });
  const bar = el('div', { class: 'mu-scan-bar' }, el('i'));
  const stop = el('button', { class: 'nui-btn small', title: 'Stop looking (what was found so far stays)', onclick: () => ctx.call('music.cancelScan', {}).catch(() => {}) }, 'Stop');
  const closeBtn = el('button', { class: 'nui-icon', title: 'Hide this note', 'aria-label': 'Hide this note', onclick: () => { node.hidden = true; } }, '✕');
  const node = el('div', { class: 'mu-scan', role: 'status', 'aria-live': 'polite', hidden: true }, el('div', { class: 'mu-scan-row' }, text, stop, closeBtn), bar);
  let refreshAt = 0;
  function busy(label, frac) {
    node.hidden = false; node.classList.remove('note'); stop.hidden = false; closeBtn.hidden = true; bar.hidden = false;
    text.textContent = label;
    bar.classList.toggle('busy', frac == null);
    bar.firstChild.style.width = frac == null ? '' : `${Math.max(2, Math.round(frac * 100))}%`;
    ctx.setStatus(label);
  }
  function note(msg) {
    stop.hidden = true; bar.hidden = true; closeBtn.hidden = false;
    node.hidden = !msg; node.classList.add('note'); text.textContent = msg || '';
  }
  return {
    node,
    update(sp) {
      if (sp.phase === 'discovering') busy(sp.discovered ? `Finding your music… ${sp.discovered.toLocaleString()} files so far` : 'Finding your music…', null);
      else if (sp.phase === 'indexing') {
        busy(`Reading your music… ${sp.processed.toLocaleString()} of ${sp.discovered.toLocaleString()}${sp.errors ? ` · ${sp.errors.toLocaleString()} unreadable` : ''}`, sp.discovered ? sp.processed / sp.discovered : null);
        if (Date.now() > refreshAt) { refreshAt = Date.now() + 2000; onProgress(false); }   // the counts climb as it goes
      } else { note(lastScanNote(sp)); onProgress(true); }
    },
    fromStatus(st) {
      if (!st) return;
      if (st.scanning) { if (node.hidden || node.classList.contains('note')) busy('Looking through your music…', null); }
      else if (!node.hidden && !node.classList.contains('note')) note(lastScanNote(st.lastScan));
    },
    busy: () => !node.hidden && !node.classList.contains('note'),
  };
}

/**
 * Builds the music page in `root`. In the bench's tab it spreads out when there's room; as a panel it's 2.0's
 * compact player beside the editor. Returns { commands, focus, unmount, … }.
 */
export function createMusicUi(root, ctx, { where = 'bench' } = {}) {
  const $ = (sel) => root.querySelector(sel);
  const notice = (text, ms) => ctx.toast(text, ms ? { ms } : undefined);
  const showError = (e) => ctx.toast(e && e.message ? e.message : String(e), { error: true });
  const req = (cmd, args = {}) => ctx.call(cmd, args);

  let wide = false;
  const rowH = () => (wide ? 34 : 50);
  let status = { folders: [], stats: null, playlists: [], smart: [], scanning: false, undo: null };
  const cache = new Map();  // track id → row
  let view = { search: '', triage: null, missingOnly: false, playlistId: null, smartId: null, sort: ctx.restore('sort', 'title'), desc: !!ctx.restore('desc', false), total: 0 };
  if (view.sort === 'playlist') view.sort = 'title';
  let viewRows = new Map(); // index → row
  let viewGen = 0;
  const pending = new Set();
  let selected = -1;          // the row with the keyboard cursor
  let sel = new Set();        // selected rows (indices in the current view)
  let anchor = -1;            // where a Shift range starts
  let tab = ctx.restore(where + '.tab', 'library');
  let ps = null;              // the player's state
  let artV = 0;               // bumped after edits, so covers are fetched afresh
  let alive = true;

  const currentId = () => (ps ? ps.id : null);
  const paused = () => !(ps && ps.playing);
  const curRow = () => { const id = currentId(); return id == null ? null : (cache.get(id) || (ps && ps.track) || null); };

  // ---------------------------------------------------------------- the page
  const tr = (cls, label, title, fn) => el('button', { class: 'tp ' + cls, title, 'aria-label': title, onclick: fn }, label);
  const nowplaying = el('section', { class: 'nowplaying', 'aria-label': 'Now playing' },
    el('div', { class: 'np-top' },
      el('button', { class: 'np-art', title: 'Show the artwork', 'aria-label': 'Show the artwork', onclick: () => currentId() != null && showArtwork(currentId()) }, el('span', { text: '♫' })),
      el('div', { class: 'np-text' },
        el('div', { class: 'np-title', text: 'Nothing playing', title: 'Show it in the list', onclick: () => revealPlaying() }),
        el('div', { class: 'np-sub', text: 'Pick a track and press Enter' }),
        el('div', { class: 'np-file' }))),
    el('div', { class: 'np-seek' },
      el('span', { class: 'np-cur', text: '0:00' }),
      el('input', { type: 'range', class: 'np-range', min: '0', max: '1000', value: '0', 'aria-label': 'Position' }),
      el('span', { class: 'np-dur', text: '0:00' })),
    el('div', { class: 'np-controls' },
      tr('shuffle', ICON.shuffle, 'Shuffle', () => doIt(ctx, { op: 'shuffle' })),
      tr('random', ICON.random, 'A random track', () => playRandom()),
      tr('prev', ICON.prev, 'Previous', () => doIt(ctx, { op: 'prev' })),
      tr('play', ICON.play, 'Play / pause', () => toggle()),
      tr('next', ICON.next, 'Next', () => doIt(ctx, { op: 'next' })),
      tr('repeat', ICON.repeat, 'Repeat', () => doIt(ctx, { op: 'repeat' })),
      el('input', { type: 'range', class: 'np-volume', min: '0', max: '100', value: '80', 'aria-label': 'Volume', oninput: (e) => doIt(ctx, { op: 'volume', v: Number(e.target.value) / 100 }) })),
    el('div', { class: 'np-triage', role: 'group', 'aria-label': 'Mark the playing track' },
      ...TRIAGE.slice(1).map((t) => el('button', { class: 'chip t' + t.v, 'data-triage': String(t.v), title: t.label, onclick: () => triageCurrent(currentTriage() === t.v ? 0 : t.v) }, `${t.icon} ${t.short}`)),
      el('button', { class: 'nui-btn primary small np-edit', title: 'Edit the track (F2)', onclick: () => editCurrent() }, '✎ Edit track')));

  const scan = scanBanner(ctx, (finished) => { refreshStatus(finished || view.total === 0); if (finished) setTimeout(() => refreshStatus(false), 300); });
  const page = el('div', { class: 'nm music' + (where === 'panel' ? ' in-panel' : '') },
    el('div', { class: 'music-head' },
      el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '♫' }), el('strong', { text: 'Music' }), el('small', { class: 'music-count' }), el('small', { class: 'music-selcount', 'aria-live': 'polite' })),
      el('span', { class: 'panel-head-buttons' },
        el('button', { class: 'nui-icon', title: 'Music folders', 'aria-label': 'Music folders', onclick: () => showFolders() }, '📁'))),
    nowplaying,
    el('div', { class: 'music-tabs', role: 'tablist' },
      ...[['library', 'Library'], ['queue', 'Up next'], ['playlists', 'Playlists'], ['sound', 'Sound']].map(([id, label]) =>
        el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', onclick: () => setTab(id) }, label))),
    el('div', { class: 'music-pane', 'data-pane': 'library' },
      el('div', { class: 'music-toolbar' },
        el('input', { class: 'music-search', type: 'search', placeholder: 'Search title, artist, album, file…', 'aria-label': 'Search music', autocomplete: 'off', spellcheck: 'false' }),
        el('select', { class: 'music-sort', 'aria-label': 'Sort by' }, SORTS.map(([v, l]) => el('option', { value: v }, l))),
        el('button', { class: 'nui-icon music-desc', title: 'The other way round', 'aria-label': 'Reverse the order' }, '⇅'),
        el('button', { class: 'nui-icon', title: 'Show the playing track in the list', 'aria-label': 'Show the playing track in the list', onclick: () => revealPlaying() }, '◎')),
      el('div', { class: 'music-chips' }),
      el('div', { class: 'music-viewbar hide' }),
      el('div', { class: 'music-cols', role: 'row', 'aria-label': 'Sort by column' }),
      scan.node,
      el('div', { class: 'music-list', tabindex: '0', role: 'listbox', 'aria-label': 'Tracks', 'aria-multiselectable': 'true' }, el('div', { class: 'music-spacer' })),
      el('div', { class: 'music-empty hide' })),
    el('div', { class: 'music-pane hide', 'data-pane': 'queue' }, el('div', { class: 'music-queue tab-queue' })),
    el('div', { class: 'music-pane hide', 'data-pane': 'playlists' }, el('div', { class: 'music-playlists' })),
    el('div', { class: 'music-pane hide', 'data-pane': 'sound' }, el('div', { class: 'music-sound' })),
    el('section', { class: 'music-side', 'aria-label': 'Up next' },
      el('h4', { class: 'music-subhead', text: 'Up next' }),
      el('div', { class: 'music-queue side-queue' })),
    el('div', { class: 'music-foot' },
      el('span', { class: 'music-scan' }),
      el('button', { class: 'nui-btn small', onclick: () => showFolders() }, '📁 Folders')));
  root.replaceChildren(page);

  const list = $('.music-list');
  let searchTimer = 0;
  $('.music-search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setView({ search: e.target.value }), 180); });
  $('.music-search').addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); focusList(); } });
  $('.music-sort').value = view.sort;
  $('.music-sort').addEventListener('change', (e) => setView({ sort: e.target.value }));
  $('.music-desc').addEventListener('click', () => setView({ desc: !view.desc }));
  list.addEventListener('scroll', () => requestAnimationFrame(renderList), { passive: true });
  // Browsing the list by hand: don't jump to the playing track for a while (see followPlaying).
  let userBrowsedAt = 0, followGen = 0;
  ['wheel', 'pointerdown', 'keydown', 'touchstart'].forEach((t) => list.addEventListener(t, () => { userBrowsedAt = Date.now(); }, { passive: true }));
  list.addEventListener('keydown', onListKey);
  // One handler for all rows. Selecting must not rebuild the rows: a double-click needs both clicks on one element.
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
  // Tracks dragged onto a playlist (in the Playlists tab) are added to it.
  list.addEventListener('dragstart', (e) => {
    const node = e.target.closest('.track[data-index]');
    if (!node) return;
    const i = Number(node.dataset.index);
    if (!sel.has(i)) clickSelect(i, false, false);
    const idx = [...sel].sort((a, b) => a - b).filter((k) => viewRows.has(k));
    e.dataTransfer.setData('text/x-noor-tracks', JSON.stringify(idx.map((k) => viewRows.get(k).id)));
    e.dataTransfer.effectAllowed = 'copy';
  });
  for (const id of ['.np-range']) {
    const r = $(id);
    r.addEventListener('input', () => { r.dataset.dragging = '1'; $('.np-cur').textContent = fmt((r.value / 1000) * ((ps && ps.duration) || 0)); });
    r.addEventListener('change', () => { delete r.dataset.dragging; const d = ps && ps.duration; if (d) doIt(ctx, { op: 'seek', t: (r.value / 1000) * d }); });
  }
  const ro1 = new ResizeObserver(() => requestAnimationFrame(renderList));
  ro1.observe(list);
  // With room the bench spreads out: Now playing and Up next on the left, the library as a table on the right.
  const ro2 = new ResizeObserver(() => setWide(page.clientWidth >= 900));
  ro2.observe(page);

  function setWide(on) {
    if (on === wide) return;
    const topIndex = Math.floor(list.scrollTop / rowH());
    wide = on;
    page.classList.toggle('wide', on);
    if (on && tab === 'queue') setTab('library');   // Up next is always on the left
    renderColumns();
    const spacer = $('.music-spacer');
    spacer.style.height = view.total * rowH() + 'px';   // first, or the browser cuts the new scroll position short
    list.scrollTop = topIndex * rowH();
    renderList();
    renderQueue();
  }

  /** The column heads of the wide library: a click sorts by that column, a second click turns the order around. */
  function renderColumns() {
    const box = $('.music-cols');
    box.replaceChildren(el('span', { class: 'track-state' }), ...COLUMNS.map(([label, key, cls]) => key
      ? el('button', { class: 'col ' + cls + (view.sort === key ? ' active' : ''), 'data-sort': key, title: key === 'triage' ? 'Sort by mark' : `Sort by ${label.toLowerCase()}`, 'aria-sort': view.sort === key ? (view.desc ? 'descending' : 'ascending') : 'none',
        onclick: () => setView(view.sort === key ? { desc: !view.desc } : { sort: key, desc: key === 'plays' || key === 'year' }) },
        (label || '★') + (view.sort === key ? (view.desc ? ' ▼' : ' ▲') : ''))
      : el('span', { class: 'col ' + cls, text: label })), el('span', { class: 'track-actions-space' }));
  }

  function setTab(id) {
    tab = id;
    ctx.keep(where + '.tab', id);
    page.querySelectorAll('.music-tabs button[data-tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === id); b.setAttribute('aria-selected', String(b.dataset.tab === id)); });
    page.querySelectorAll('.music-pane[data-pane]').forEach((p) => p.classList.toggle('hide', p.dataset.pane !== id));
    if (id === 'queue') renderQueue();
    if (id === 'playlists') renderPlaylists();
    if (id === 'sound') renderSound();
    if (id === 'library') { requestAnimationFrame(renderList); followPlaying(true); }
  }

  function renderHeader() {
    const s = status.stats;
    $('.music-count').textContent = s ? `${s.total.toLocaleString()} track${s.total === 1 ? '' : 's'}${s.missing ? ` · ${s.missing} missing` : ''}` : '';
    renderChips();
    const empty = $('.music-empty');
    const noFolders = !status.folders.length;
    empty.classList.toggle('hide', !noFolders);
    list.classList.toggle('hide', noFolders);
    if (noFolders) {
      empty.replaceChildren(el('div', { class: 'music-empty-inner' },
        el('div', { class: 'big', text: '♫' }),
        el('p', {}, el('strong', { text: 'Your music, next to your writing.' })),
        el('p', { text: 'Add a folder of MP3, FLAC, WAV, OGG or M4A files. NoorMD only reads it: nothing is moved or changed until you edit a track yourself.' }),
        el('button', { class: 'nui-btn primary', onclick: () => addFolder() }, '＋ Add a music folder'),
        el('button', { class: 'nui-btn', onclick: () => importPlaylist() }, 'Import a playlist…')));
    }
    if (!status.scanning) ctx.setStatus(s ? `${s.total.toLocaleString()} track${s.total === 1 ? '' : 's'} in ${status.folders.length} folder${status.folders.length === 1 ? '' : 's'}` : '');
  }

  function renderChips() {
    const box = $('.music-chips');
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
    const bar = $('.music-viewbar');
    if (view.smartId) {
      const sc = (status.smart || []).find((x) => x.id === view.smartId);
      bar.classList.remove('hide');
      bar.replaceChildren(el('span', {}, '⚡ Smart: ', el('strong', { text: sc ? sc.name : '…' })),
        el('button', { class: 'nui-btn small', onclick: () => playView(0) }, '▶ Play'),
        sc ? el('button', { class: 'nui-btn small', onclick: () => editSmart(sc) }, '✎ Rules') : null,
        el('button', { class: 'nui-btn small', onclick: () => setView({ smartId: null }) }, '✕ Close'));
      return;
    }
    if (!view.playlistId) { bar.replaceChildren(); bar.classList.add('hide'); return; }
    const pl = status.playlists.find((p) => p.id === view.playlistId);
    bar.classList.remove('hide');
    bar.replaceChildren(el('span', {}, '♪ Playlist: ', el('strong', { text: pl ? pl.name : '…' })),
      el('button', { class: 'nui-btn small', onclick: () => playView(0) }, '▶ Play'),
      el('button', { class: 'nui-btn small', onclick: () => setView({ playlistId: null, sort: 'title' }) }, '✕ Close'));
  }

  // ---------------------------------------------------------------- the library list (only the rows in view are built)
  async function setView(patch) {
    view = { ...view, ...patch };
    if ('playlistId' in patch && patch.playlistId) { view.sort = 'playlist'; view.smartId = null; }
    if ('smartId' in patch && patch.smartId) { view.playlistId = null; if (view.sort === 'playlist') view.sort = 'title'; }
    if (view.sort !== 'playlist') { ctx.keep('sort', view.sort); ctx.keep('desc', view.desc); }
    $('.music-sort').value = view.sort === 'playlist' ? 'title' : view.sort;
    viewRows = new Map();
    viewGen++;
    selected = -1; sel = new Set(); anchor = -1;
    list.scrollTop = 0;
    renderChips();
    renderColumns();
    renderViewbar();
    updateSelection();
    await loadView(true);
  }

  const queryPayload = (offset, limit) => ({ search: view.search, triage: view.triage, missingOnly: view.missingOnly, playlistId: view.playlistId, smartId: view.smartId, sort: view.sort, desc: view.desc, offset, limit });
  const viewIds = () => req('music.ids', queryPayload(0, 50000));

  async function loadView(resetScroll) {
    if (!status.folders.length && !view.playlistId) { view.total = 0; renderList(); return; }
    await fetchPage(0);
    if (resetScroll) list.scrollTop = 0;
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
    } catch (err) { showError(err); }
    finally { pending.delete(key); }
  }

  function renderList() {
    if (!alive || list.offsetParent === null) return;
    const spacer = $('.music-spacer');
    spacer.style.height = view.total * rowH() + 'px';
    const first = Math.max(0, Math.floor(list.scrollTop / rowH()) - 5);
    const last = Math.min(view.total, Math.ceil((list.scrollTop + list.clientHeight) / rowH()) + 5);
    const missingPages = new Set();
    const nodes = [];
    for (let i = first; i < last; i++) {
      const row = viewRows.get(i);
      if (!row) { missingPages.add(Math.floor(i / PAGE) * PAGE); nodes.push(el('div', { class: 'track loading', style: `top:${i * rowH()}px` }, el('span', { class: 'nui-muted', text: '…' }))); continue; }
      nodes.push(trackRow(row, i));
    }
    spacer.replaceChildren(...nodes);
    for (const off of missingPages) fetchPage(off).then(() => requestAnimationFrame(renderList));
    if (!view.total && (status.folders.length || view.playlistId)) spacer.replaceChildren(el('div', { class: 'music-none', text: view.search ? 'No tracks match your search.' : view.playlistId ? 'This playlist is empty. Right-click tracks › Add to playlist.' : 'No tracks here yet.' }));
  }

  function trackRow(row, i) {
    const playing = row.id === currentId();
    const t = TRIAGE[row.triage] || TRIAGE[0];
    const where_ = row.folder ? row.folder + '\\' + row.fileName : row.fileName;
    const acts = el('span', { class: 'track-actions' },
      el('button', { class: 'nui-icon', title: 'Play next', 'aria-label': 'Play next', onclick: (e) => { e.stopPropagation(); doIt(ctx, { op: 'playNext', ids: [row.id] }); } }, '⤵'),
      el('button', { class: 'nui-icon', title: 'Add to Up next', 'aria-label': 'Add to Up next', onclick: (e) => { e.stopPropagation(); doIt(ctx, { op: 'enqueue', ids: [row.id] }); } }, '＋'),
      el('button', { class: 'nui-icon', title: 'Add to a playlist', 'aria-label': 'Add to a playlist', onclick: (e) => { e.stopPropagation(); addToPlaylist([row.id]); } }, '♪'));
    const cls = 'track' + (sel.has(i) ? ' selected' : '') + (i === selected ? ' cursor' : '') + (playing ? ' playing' : '') + (row.missing ? ' missing' : '');
    const state = el('span', { class: 'track-state', text: playing ? (paused() ? '❚❚' : '▶') : '' });
    if (wide) return el('div', {
      class: cls + ' wide-row', style: `top:${i * rowH()}px`, role: 'option', 'aria-selected': String(sel.has(i)), 'data-index': String(i), 'data-id': String(row.id), draggable: 'true',
      title: where_ + (row.missing ? '\nMissing on disk' : row.readError ? '\nTags unreadable' : ''),
    },
    state,
    el('span', { class: 'track-title c-title', text: row.displayTitle }),
    el('span', { class: 'c-artist', text: row.artist || '' }),
    el('span', { class: 'c-album', text: row.album || '' }),
    el('span', { class: 'c-genre', text: row.genre || '' }),
    el('span', { class: 'c-year', text: row.year ? String(row.year) : '' }),
    el('span', { class: 'track-triage c-triage t' + row.triage, title: t.label, text: row.triage ? t.icon : '' }),
    el('span', { class: 'c-plays', text: row.plays ? String(row.plays) : '' }),
    el('span', { class: 'track-time c-time', text: fmt(row.duration) }),
    acts);
    const folderName = (row.folder || '').split(/[\\/]/).pop();
    return el('div', { class: cls, style: `top:${i * rowH()}px`, role: 'option', 'aria-selected': String(sel.has(i)), 'data-index': String(i), 'data-id': String(row.id), draggable: 'true', title: where_ },
      state,
      el('span', { class: 'track-main' },
        el('span', { class: 'track-title', text: row.displayTitle }),
        el('small', { text: [row.artist, row.title ? row.fileName : folderName].filter(Boolean).join(' · ') + (row.missing ? ' · missing on disk' : row.readError ? ' · tags unreadable' : '') })),
      el('span', { class: 'track-triage t' + row.triage, title: t.label, text: row.triage ? t.icon : '' }),
      el('span', { class: 'track-time', text: fmt(row.duration) }),
      acts);
  }

  function updateSelection() {
    page.querySelectorAll('.music-list .track[data-index]').forEach((n) => {
      const i = Number(n.dataset.index);
      n.classList.toggle('selected', sel.has(i));
      n.classList.toggle('cursor', i === selected);
      n.setAttribute('aria-selected', String(sel.has(i)));
    });
    $('.music-selcount').textContent = sel.size > 1 ? `${sel.size.toLocaleString()} selected` : '';
  }

  /** Click: one row. Ctrl+click: add or take away a row. Shift+click: the range from the last clicked row. */
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

  /** The selected tracks' ids, in list order. Rows not loaded yet are looked up for the whole view. */
  async function selectedIds() {
    const idx = (sel.size ? [...sel] : selected >= 0 ? [selected] : []).sort((a, b) => a - b);
    if (!idx.length) return [];
    if (idx.every((k) => viewRows.has(k))) return idx.map((k) => viewRows.get(k).id);
    const all = await viewIds();
    return idx.map((k) => all[k]).filter((id) => id != null);
  }

  async function withSelection(fn) {
    let ids;
    try { ids = await selectedIds(); } catch (err) { showError(err); return; }
    if (ids.length) await fn(ids);
  }

  async function removeFromPlaylist(ids) {
    const pl = status.playlists.find((p) => p.id === view.playlistId);
    if (!pl) return;
    try {
      const current = await req('music.ids', { playlistId: pl.id, sort: 'playlist' });
      // One entry per selected row: a track that's in the playlist twice keeps its other place.
      for (const id of ids) { const at = current.indexOf(id); if (at >= 0) current.splice(at, 1); }
      await req('music.playlist.setItems', { id: pl.id, ids: current });
      notice(`Took ${ids.length} track${ids.length === 1 ? '' : 's'} out of “${pl.name}” (the files aren't touched).`, 2200);
      sel = new Set(); anchor = -1;
      await refreshStatus(true);
    } catch (err) { showError(err); }
  }

  async function copyLines(ids, kind) {
    try {
      await loadTracks(ids);
      const rows = ids.map((id) => cache.get(id)).filter(Boolean);
      const text = rows.map((r) => (kind === 'path' ? (r.folder ? r.folder + '\\' : '') + r.fileName : [r.artist, r.displayTitle].filter(Boolean).join(' – '))).join('\n');
      await navigator.clipboard.writeText(text);
      notice(`Copied ${rows.length} ${kind === 'path' ? 'file path' : 'title'}${rows.length === 1 ? '' : 's'}.`, 1500);
    } catch (err) { showError(err); }
  }

  async function loadTracks(ids) {
    const need = ids.filter((id) => id != null && !cache.has(id));
    if (!need.length) return;
    try { (await req('music.tracks', { ids: need.slice(0, 2000) })).forEach((r) => cache.set(r.id, r)); } catch { /* shown when it matters */ }
  }

  /** The right-click menu for the selected tracks. */
  function showTrackMenu(x, y) {
    const n = sel.size || (selected >= 0 ? 1 : 0);
    if (!n) return;
    const many = n > 1;
    const one = !many ? viewRows.get(selected) : null;
    const plural = (w) => (many ? `${n.toLocaleString()} ${w}s` : w);
    const inPlaylist = view.playlistId ? status.playlists.find((p) => p.id === view.playlistId) : null;
    const items = [
      { label: many ? `Play these ${n.toLocaleString()} tracks` : 'Play', keys: 'Enter', run: () => (many ? withSelection((ids) => setQueue(ids, ps && ps.shuffle ? Math.floor(Math.random() * ids.length) : 0)) : playView(selected)) },
      { label: 'Play next', keys: 'N', run: () => withSelection((ids) => doIt(ctx, { op: 'playNext', ids })) },
      { label: 'Add to Up next', keys: 'Q', run: () => withSelection((ids) => doIt(ctx, { op: 'enqueue', ids })) },
      '-',
      { label: 'Add to playlist', sub: () => [
        ...status.playlists.filter((p) => !inPlaylist || p.id !== inPlaylist.id).map((p) => ({ label: `${p.name}  (${p.count})`, run: () => withSelection(async (ids) => {
          try { status.playlists = await req('music.playlist.add', { id: p.id, ids }); notice(`Added ${plural('track')} to “${p.name}”.`, 1600); renderPlaylists(); } catch (err) { showError(err); }
        }) })),
        ...(status.playlists.length ? ['-'] : []),
        { label: 'New playlist…', run: () => withSelection((ids) => createPlaylist(ids)) },
      ] },
      inPlaylist ? { label: `Take out of “${inPlaylist.name}”`, keys: 'Del', run: () => withSelection(removeFromPlaylist) } : null,
      '-',
      { label: 'Mark as', sub: () => [
        ...TRIAGE.slice(1).map((t) => ({ label: `${t.icon}  ${t.label}`, keys: String(t.v), run: () => withSelection((ids) => setTriage(ids, t.v)) })),
        '-', { label: 'Take the mark off', keys: '0', run: () => withSelection((ids) => setTriage(ids, 0)) },
      ] },
      { label: many ? `Edit ${n.toLocaleString()} tracks… (Batch Organizer)` : 'Edit track…', keys: many ? '' : 'F2', run: () => (many ? withSelection((ids) => batchOrganizer(ids)) : one && editTrack(one.id)) },
      '-',
      { label: 'Show in Explorer', disabled: many || !one, run: () => one && req('music.reveal', { id: one.id }).catch(showError) },
      { label: 'Show the artwork', disabled: many || !one, run: () => one && showArtwork(one.id) },
      { label: 'Measure the loudness', run: () => withSelection((ids) => req('music.loudness.unmeasured', { ids }).then((u) => measure(u, { label: 'the selection' }))) },
      { label: many ? 'Copy the titles' : 'Copy the title', run: () => withSelection((ids) => copyLines(ids, 'title')) },
      { label: many ? 'Copy the file paths' : 'Copy the file path', run: () => withSelection((ids) => copyLines(ids, 'path')) },
      '-',
      { label: 'Select all', keys: 'Ctrl+A', run: selectAll },
    ].filter(Boolean);
    menu(x, y, items, { anchor: list });
  }

  function focusList() { if (!list.classList.contains('hide')) list.focus({ preventScroll: true }); }

  function selectIndex(i, extend) {
    if (!view.total) return;
    selected = Math.max(0, Math.min(view.total - 1, i));
    if (extend) {
      if (anchor < 0) anchor = selected;
      sel = new Set();
      for (let k = Math.min(anchor, selected); k <= Math.max(anchor, selected); k++) sel.add(k);
    } else { sel = new Set([selected]); anchor = selected; }
    const top = selected * rowH();
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + rowH() > list.scrollTop + list.clientHeight) list.scrollTop = top + rowH() - list.clientHeight;
    renderList();
    updateSelection();
  }

  function onListKey(e) {
    const row = viewRows.get(selected);
    const pg = Math.max(1, Math.floor(list.clientHeight / rowH()) - 1);
    const map = { ArrowDown: 1, ArrowUp: -1, PageDown: pg, PageUp: -pg };
    if (map[e.key] != null && !e.ctrlKey && !e.altKey) { e.preventDefault(); selectIndex((selected < 0 ? -1 : selected) + map[e.key], e.shiftKey); return; }
    if (e.key === 'Home' && !e.ctrlKey) { e.preventDefault(); selectIndex(0, e.shiftKey); return; }
    if (e.key === 'End' && !e.ctrlKey) { e.preventDefault(); selectIndex(view.total - 1, e.shiftKey); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); selectAll(); return; }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault(); e.stopPropagation();
      const node = page.querySelector(`.music-list .track[data-index="${selected}"]`);
      const r = (node || list).getBoundingClientRect();
      showTrackMenu(r.left + 40, r.top + rowH());
      return;
    }
    if (e.key === 'Escape' && sel.size > 1) { e.preventDefault(); e.stopPropagation(); sel = new Set(selected >= 0 ? [selected] : []); anchor = selected; updateSelection(); return; }
    if (!row || e.ctrlKey || e.altKey || e.metaKey) return;
    const multi = sel.size > 1;
    if (e.key === 'Enter') { e.preventDefault(); if (multi) withSelection((ids) => setQueue(ids, 0)); else playView(selected); }
    else if (/^[0-4]$/.test(e.key)) { e.preventDefault(); withSelection((ids) => setTriage(ids, Number(e.key))); }
    else if (e.key.toLowerCase() === 'q') { e.preventDefault(); withSelection((ids) => doIt(ctx, { op: 'enqueue', ids })); }
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); withSelection((ids) => doIt(ctx, { op: 'playNext', ids })); }
    else if (e.key === 'Delete' && view.playlistId) { e.preventDefault(); withSelection(removeFromPlaylist); }
    else if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); editTrack(row.id); }
  }

  // ---------------------------------------------------------------- playing (the player does it; this page asks)
  const isShown = () => alive && page.isConnected && page.offsetParent !== null;
  /** Keeps the playing track in view when it changes. Not while you browse the list, or with several tracks picked. */
  async function followPlaying(force = false) {
    const id = currentId();
    if (id == null || !isShown() || tab !== 'library') return;
    if (!force && (Date.now() - userBrowsedAt < 10000 || sel.size > 1)) return;
    const gen = ++followGen;
    let ids;
    try { ids = await viewIds(); } catch { return; }
    if (gen !== followGen || currentId() !== id) return;
    const i = ids.indexOf(id);
    if (i < 0) return;
    const top = i * rowH(), bottom = top + rowH();
    if (top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight) return;
    list.scrollTop = Math.max(0, top - list.clientHeight / 2 + rowH() / 2);
    requestAnimationFrame(renderList);
  }

  async function revealPlaying() {
    const id = currentId();
    if (id == null) { notice('Nothing is playing.'); return; }
    let ids;
    try { ids = await viewIds(); } catch (err) { showError(err); return; }
    const i = ids.indexOf(id);
    if (i < 0) { notice('The playing track isn\'t in this list (search, mark or playlist).', 3000); return; }
    setTab('library');
    list.scrollTop = Math.max(0, i * rowH() - list.clientHeight / 2 + rowH() / 2);
    selected = i; sel = new Set([i]); anchor = i;
    requestAnimationFrame(() => { renderList(); updateSelection(); });
  }

  async function playView(index) {
    let ids;
    try { ids = await viewIds(); } catch (err) { showError(err); return; }
    if (!ids.length) return;
    const startId = viewRows.get(index)?.id;
    setQueue(ids, Math.max(0, startId != null ? ids.indexOf(startId) : index));
  }
  function setQueue(ids, start) {
    doIt(ctx, { op: 'playIds', ids, start });
    // As in NoorMD 2.0, the player sits beside your writing: the Music panel docks in Markdown (once; hide it and it stays hidden).
    if (where === 'bench' && ctx.offerPanel) ctx.offerPanel('noor.markdown', 'player');
  }
  async function toggle() {
    if (currentId() != null) { doIt(ctx, { op: 'toggle' }); return; }
    if (selected >= 0) { playView(selected); return; }
    let ids = [];
    try { ids = await viewIds(); } catch { /* nothing to play */ }
    doIt(ctx, { op: 'toggle', ids, start: 0 });
  }
  /** A random track: the queue becomes the whole list in view (or the library), so every track can come up. */
  async function playRandom() {
    let ids = [];
    try { ids = await viewIds(); } catch (err) { showError(err); return; }
    if (!ids.length && (view.search || view.triage != null || view.playlistId || view.smartId)) {
      try { ids = await req('music.ids', { sort: 'title', offset: 0, limit: 50000 }); } catch { ids = []; }
    }
    doIt(ctx, { op: 'random', ids });
  }

  // ---------------------------------------------------------------- marks
  async function setTriage(ids, value) {
    if (!ids.length) return;
    try { status.stats = await req('music.setTriage', { ids, value }); } catch (err) { showError(err); return; }
    applyTriage(ids, value);
    const t = TRIAGE[value];
    notice(value ? `${t.icon} ${t.label}` : 'Mark taken off', 1100);
  }
  function applyTriage(ids, value) {
    ids.forEach((id) => { const r = cache.get(id); if (r) cache.set(id, { ...r, triage: value }); });
    for (const [i, r] of viewRows) if (ids.includes(r.id)) viewRows.set(i, { ...r, triage: value });
    renderChips(); renderList(); renderTransport();
  }
  const currentTriage = () => (curRow() || {}).triage ?? 0;
  function triageCurrent(value) {
    const id = currentId();
    if (id == null) { notice('Nothing is playing.', 1200); return; }
    setTriage([id], value);
  }

  // ---------------------------------------------------------------- the player card and Up next follow the player
  function renderTransport() {
    const id = currentId();
    const row = curRow();
    const title = row ? row.displayTitle : id != null ? 'Loading…' : 'Nothing playing';
    const sub = row ? [row.artist, row.album].filter(Boolean).join(' — ') || (row.title ? '' : 'No title tag: showing the file name') : 'Pick a track and press Enter';
    $('.np-title').textContent = title;
    $('.np-sub').textContent = sub;
    $('.np-file').textContent = row ? row.fileName || '' : '';
    $('.np-file').title = row && row.folder ? row.folder + '\\' + row.fileName : '';
    const p = $('.tp.play');
    p.textContent = paused() ? ICON.play : ICON.pause;
    p.setAttribute('aria-label', paused() ? 'Play' : 'Pause');
    const sh = !!(ps && ps.shuffle);
    const shBtn = $('.tp.shuffle');
    shBtn.classList.toggle('on', sh); shBtn.setAttribute('aria-pressed', String(sh));
    shBtn.title = sh ? 'Shuffle is on: click to play in order' : 'Shuffle is off: click to play in random order';
    const rep = (ps && ps.repeat) || 'off';
    const rBtn = $('.tp.repeat');
    rBtn.classList.toggle('on', rep !== 'off'); rBtn.textContent = rep === 'one' ? ICON.repeatOne : ICON.repeat;
    rBtn.title = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this track' }[rep];
    const tri = currentTriage();
    page.querySelectorAll('.np-triage .chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.triage) === tri));
    const vol = $('.np-volume');
    if (document.activeElement !== vol) vol.value = String(Math.round(((ps && ps.volume) ?? 0.8) * 100));
    setArt($('.np-art'), row, artV);
    page.querySelectorAll('.music-list .track[data-id]').forEach((n) => {
      const isCur = Number(n.dataset.id) === id;
      n.classList.toggle('playing', isCur);
      const s = n.querySelector('.track-state');
      if (s) s.textContent = isCur ? (paused() ? '❚❚' : '▶') : '';
    });
  }

  function renderTime(t) {
    if (!t) return;
    const d = t.duration || (ps && ps.duration) || 0;
    const r = $('.np-range');
    if (r.dataset.dragging) return;
    $('.np-cur').textContent = fmt(t.time);
    $('.np-dur').textContent = fmt(d);
    r.value = d > 0 ? String(Math.round((t.time / d) * 1000)) : '0';
  }

  function renderQueue() {
    for (const box of [tab === 'queue' ? $('.tab-queue') : null, wide ? $('.side-queue') : null]) if (box) fillQueue(box);
  }
  function fillQueue(box) {
    const qu = ps ? ps.queue : { pos: -1, total: 0, items: [] };
    if (!qu.total) { box.replaceChildren(el('p', { class: 'music-none', text: 'Up next is empty. Double-click a track, or use ＋ to add tracks.' })); return; }
    const items = qu.items.map((it) => el('div', { class: 'qitem' + (it.pos === qu.pos ? ' current' : it.pos < qu.pos ? ' past' : ''), ondblclick: () => it.pos !== qu.pos && doIt(ctx, { op: 'jump', pos: it.pos }) },
      el('span', { class: 'qpos', text: it.pos === qu.pos ? '▶' : String(it.pos - qu.pos) }),
      el('span', { class: 'qtitle', text: it.title, title: it.fileName || '' }),
      el('span', { class: 'track-time', text: it.duration ? fmt(it.duration) : '' }),
      it.pos > qu.pos ? el('span', { class: 'qactions' },
        el('button', { class: 'nui-icon', title: 'Play now', 'aria-label': 'Play now', onclick: () => doIt(ctx, { op: 'jump', pos: it.pos }) }, '▶'),
        el('button', { class: 'nui-icon', title: 'Earlier', 'aria-label': 'Earlier', onclick: () => doIt(ctx, { op: 'move', pos: it.pos, delta: -1 }) }, '↑'),
        el('button', { class: 'nui-icon', title: 'Later', 'aria-label': 'Later', onclick: () => doIt(ctx, { op: 'move', pos: it.pos, delta: 1 }) }, '↓'),
        el('button', { class: 'nui-icon', title: 'Take it out', 'aria-label': 'Take it out of Up next', onclick: () => doIt(ctx, { op: 'remove', pos: it.pos }) }, '✕')) : el('span')));
    const lastPos = qu.items.length ? qu.items[qu.items.length - 1].pos : qu.pos;
    box.replaceChildren(
      el('div', { class: 'music-viewbar' }, el('span', { text: `${Math.max(0, qu.total - qu.pos - 1)} upcoming · ${ps.shuffle ? 'shuffled' : 'in order'} · repeat ${ps.repeat}` }),
        el('button', { class: 'nui-btn small', onclick: () => saveQueueAsPlaylist() }, 'Save as a playlist'),
        el('button', { class: 'nui-btn small danger', onclick: () => doIt(ctx, { op: 'clearUpcoming' }) }, 'Clear upcoming')),
      ...items, ...(lastPos < qu.total - 1 ? [el('p', { class: 'music-none', text: `…and ${(qu.total - 1 - lastPos).toLocaleString()} more` })] : []));
  }
  async function saveQueueAsPlaylist() {
    const qu = ps ? ps.queue : null;
    if (!qu || !qu.total) { notice('Up next is empty.'); return; }
    // The page only hears a window of Up next; the whole queue is in the player's saved session.
    let ids = qu.items.map((it) => it.id);
    try { const s = await req('music.session.get'); if (s && Array.isArray(s.ids) && Array.isArray(s.order)) ids = s.order.map((i) => s.ids[i]).filter((x) => x != null); } catch { /* the window will do */ }
    await createPlaylist(ids);
  }

  // ---------------------------------------------------------------- playlists and smart collections
  function renderPlaylists() {
    const box = $('.music-playlists');
    if (tab !== 'playlists') return;
    const drop = (p) => ({
      ondragover: (e) => { if ([...e.dataTransfer.types].includes('text/x-noor-tracks')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
      ondragleave: (e) => e.currentTarget.classList.remove('drop'),
      ondrop: async (e) => {
        e.currentTarget.classList.remove('drop');
        const ids = JSON.parse(e.dataTransfer.getData('text/x-noor-tracks') || '[]');
        if (!ids.length) return;
        try { status.playlists = await req('music.playlist.add', { id: p.id, ids }); notice(`Added to “${p.name}”.`, 1400); renderPlaylists(); } catch (err) { showError(err); }
      },
    });
    const items = status.playlists.map((p) => el('div', { class: 'qitem', 'data-playlist': String(p.id), ...drop(p) },
      el('span', { class: 'qpos', text: '♪' }),
      el('button', { class: 'qtitle linkish', onclick: () => { setTab('library'); setView({ playlistId: p.id, search: '', triage: null, missingOnly: false }); } }, p.name),
      el('small', { text: `${p.count} track${p.count === 1 ? '' : 's'}` }),
      el('span', { class: 'qactions' },
        el('button', { class: 'nui-icon', title: 'Play', 'aria-label': `Play ${p.name}`, onclick: () => playPlaylist(p.id) }, '▶'),
        el('button', { class: 'nui-icon', title: 'Rename', 'aria-label': 'Rename', onclick: () => renamePlaylist(p) }, '✎'),
        el('button', { class: 'nui-icon', title: 'Export as .m3u8', 'aria-label': 'Export', onclick: () => req('music.playlist.export', { id: p.id }).then((r) => r && notice(`Exported ${r.count} tracks to ${r.path}`, 4000)).catch(showError) }, '⇪'),
        el('button', { class: 'nui-icon', title: 'Delete', 'aria-label': 'Delete the playlist', onclick: () => deletePlaylist(p) }, '✕'))));
    const smart = (status.smart || []).map((sc) => el('div', { class: 'qitem smart-item' },
      el('span', { class: 'qpos', text: '⚡' }),
      el('button', { class: 'qtitle linkish', onclick: () => { setTab('library'); setView({ smartId: sc.id, search: '', triage: null, missingOnly: false }); } }, sc.name),
      el('small', { text: `${sc.count} track${sc.count === 1 ? '' : 's'}` }),
      el('span', { class: 'qactions' },
        el('button', { class: 'nui-icon', title: 'Play', 'aria-label': `Play ${sc.name}`, onclick: () => playSmart(sc) }, '▶'),
        el('button', { class: 'nui-icon', title: 'Edit the rules', 'aria-label': 'Edit the rules', onclick: () => editSmart(sc) }, '✎'),
        el('button', { class: 'nui-icon', title: 'Delete', 'aria-label': 'Delete the smart collection', onclick: () => deleteSmart(sc) }, '✕'))));
    box.replaceChildren(
      el('h4', { class: 'music-subhead', text: 'Smart collections' }),
      el('div', { class: 'music-viewbar' }, el('button', { class: 'nui-btn small smart-new', onclick: () => editSmart(null) }, '⚡ New smart collection…')),
      ...(smart.length ? smart : [el('p', { class: 'music-none', text: 'Smart collections fill themselves from rules: “never played”, “favourites not heard for a month”, “added this week”…' })]),
      el('h4', { class: 'music-subhead', text: 'Playlists' }),
      el('div', { class: 'music-viewbar' },
        el('button', { class: 'nui-btn small', onclick: () => createPlaylist([]) }, '＋ New playlist'),
        el('button', { class: 'nui-btn small', onclick: () => importPlaylist() }, 'Import .m3u / .m3u8…')),
      ...(items.length ? items : [el('p', { class: 'music-none', text: 'No playlists yet. Make one, import an .m3u file, or save Up next as a playlist.' })]));
  }

  async function playPlaylist(id) {
    let ids;
    try { ids = await req('music.ids', { playlistId: id, sort: 'playlist' }); } catch (err) { showError(err); return; }
    if (!ids.length) { notice('This playlist is empty.'); return; }
    setQueue(ids, ps && ps.shuffle ? Math.floor(Math.random() * ids.length) : 0);
  }
  async function createPlaylist(ids) {
    const name = await prompt('New playlist', 'Its name', 'Writing session', { okLabel: 'Make it' });
    if (!name) return null;
    try {
      const r = await req('music.playlist.create', { name, ids });
      await refreshStatus(false);
      notice(`Playlist “${name}” made${ids.length ? ` with ${ids.length} track${ids.length === 1 ? '' : 's'}` : ''}.`, 2000);
      return r.id;
    } catch (err) { showError(err); return null; }
  }
  async function renamePlaylist(p) {
    const name = await prompt('Rename the playlist', 'New name', p.name, { okLabel: 'Rename' });
    if (!name) return;
    await req('music.playlist.rename', { id: p.id, name }).catch(showError);
    refreshStatus(false);
  }
  async function deletePlaylist(p) {
    if (!await confirm('Delete the playlist?', `“${p.name}” will be deleted. The music files aren't touched.`, 'Delete')) return;
    await req('music.playlist.delete', { id: p.id }).catch(showError);
    if (view.playlistId === p.id) setView({ playlistId: null, sort: 'title' });
    refreshStatus(false);
  }
  async function importPlaylist() {
    try {
      const r = await req('music.playlist.import');
      if (!r || r.cancelled) return;
      notice(`Imported ${r.added} track${r.added === 1 ? '' : 's'}${r.missing ? `; ${r.missing} files not found` : ''}${r.unsupported ? `; ${r.unsupported} entries skipped (not music)` : ''}.`, 5000);
      await refreshStatus(true);
      setTab('library'); setView({ playlistId: r.playlistId });
    } catch (err) { showError(err); }
  }
  function addToPlaylist(ids) {
    modal({ label: 'Add to a playlist', width: 420 }, (s, close) => {
      s.append(head('Add to a playlist', close), el('div', { class: 'modal-body' },
        ...status.playlists.map((p) => el('button', { class: 'cmd-item', onclick: async () => {
          close();
          try { status.playlists = await req('music.playlist.add', { id: p.id, ids }); notice(`Added to “${p.name}”.`, 1400); renderPlaylists(); } catch (err) { showError(err); }
        } }, el('span', { text: p.name }), el('small', { text: `${p.count} track${p.count === 1 ? '' : 's'}` }))),
        el('button', { class: 'cmd-item', onclick: () => { close(); createPlaylist(ids); } }, el('span', { text: '＋ New playlist…' }))));
    });
  }

  const SMART_FIELDS = [
    ['title', 'Title', 'text'], ['artist', 'Artist', 'text'], ['album', 'Album', 'text'], ['genre', 'Genre', 'text'], ['comment', 'Comment', 'text'],
    ['fileName', 'File name', 'text'], ['folder', 'Folder', 'text'], ['year', 'Year', 'number'], ['plays', 'Play count', 'number'],
    ['duration', 'Duration (seconds)', 'number'], ['loudness', 'Loudness (LUFS)', 'number'], ['added', 'Added', 'date'], ['lastPlayed', 'Last played', 'date'],
    ['triage', 'Mark', 'triage'], ['hasArt', 'Has artwork', 'flag'], ['measured', 'Loudness measured', 'flag'], ['missing', 'Missing on disk', 'flag'],
  ];
  const SMART_OPS = {
    text: [['contains', 'contains'], ['notContains', 'doesn\'t contain'], ['is', 'is'], ['isNot', 'is not'], ['startsWith', 'starts with'], ['isEmpty', 'is empty'], ['notEmpty', 'is not empty']],
    number: [['gt', '>'], ['ge', '≥'], ['lt', '<'], ['le', '≤'], ['eq', '='], ['ne', '≠'], ['isEmpty', 'is unknown']],
    date: [['withinDays', 'in the last … days'], ['olderThanDays', 'not in the last … days'], ['never', 'never'], ['ever', 'ever']],
    triage: [['is', 'is'], ['isNot', 'is not']],
    flag: [['isTrue', 'yes'], ['isFalse', 'no']],
  };
  const NO_VALUE = new Set(['isEmpty', 'notEmpty', 'never', 'ever', 'isTrue', 'isFalse']);
  const SMART_PRESETS = [
    { name: 'Recently added', matchAll: true, rules: [{ field: 'added', op: 'withinDays', value: '14' }] },
    { name: 'Favourites', matchAll: true, rules: [{ field: 'triage', op: 'is', value: '1' }] },
    { name: 'Never played', matchAll: true, rules: [{ field: 'lastPlayed', op: 'never' }] },
    { name: 'Not played for a month', matchAll: true, rules: [{ field: 'lastPlayed', op: 'olderThanDays', value: '30' }, { field: 'triage', op: 'isNot', value: '4' }] },
    { name: 'Most played', matchAll: true, rules: [{ field: 'plays', op: 'gt', value: '0' }], limit: 50, limitSort: 'plays', limitDesc: true },
    { name: 'Still to mark', matchAll: true, rules: [{ field: 'triage', op: 'is', value: '0' }] },
    { name: 'Short tracks (under 2 min)', matchAll: true, rules: [{ field: 'duration', op: 'lt', value: '120' }] },
    { name: 'Missing artwork', matchAll: true, rules: [{ field: 'hasArt', op: 'isFalse' }] },
  ];

  function editSmart(existing) {
    const start0 = existing || { name: '', matchAll: true, rules: [{ field: 'genre', op: 'contains', value: '' }] };
    let rules = start0.rules.map((r) => ({ ...r }));
    modal({ label: existing ? 'Edit the smart collection' : 'New smart collection', width: 720 }, (s, close) => {
      const name = el('input', { type: 'text', class: 'nui-field', value: start0.name, 'aria-label': 'Name', placeholder: 'Name' });
      const match = el('select', { class: 'nui-field', 'aria-label': 'Match' }, el('option', { value: 'all', text: 'all of these' }), el('option', { value: 'any', text: 'any of these' }));
      match.value = start0.matchAll === false ? 'any' : 'all';
      const limitOn = el('input', { type: 'checkbox' }); limitOn.checked = !!start0.limit;
      const limit = el('input', { type: 'number', min: '1', max: '10000', value: String(start0.limit || 50), class: 'nui-field num', 'aria-label': 'How many' });
      const limitSort = el('select', { class: 'nui-field', 'aria-label': 'Chosen by' }, ...[['plays:1', 'most played'], ['added:1', 'most recently added'], ['lastPlayed:1', 'most recently played'], ['lastPlayed:0', 'least recently played'], ['random:0', 'random'], ['duration:0', 'shortest'], ['title:0', 'title']].map(([v, t]) => el('option', { value: v, text: t })));
      limitSort.value = `${start0.limitSort || 'plays'}:${start0.limitDesc === false ? 0 : 1}`;
      const listBox = el('div', { class: 'smart-rules' });
      const count = el('div', { class: 'batch-summary smart-count', 'aria-live': 'polite' });
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
        listBox.replaceChildren(...rules.map((r, i) => {
          const kind = (SMART_FIELDS.find(([f]) => f === r.field) || SMART_FIELDS[0])[2];
          const field = el('select', { class: 'nui-field', 'aria-label': 'Field', 'data-smart-field': String(i) }, ...SMART_FIELDS.map(([f, l]) => el('option', { value: f, text: l })));
          field.value = r.field;
          const op = el('select', { class: 'nui-field', 'aria-label': 'Condition', 'data-smart-op': String(i) }, ...SMART_OPS[kind].map(([o, l]) => el('option', { value: o, text: l })));
          if (!SMART_OPS[kind].some(([o]) => o === r.op)) r.op = SMART_OPS[kind][0][0];
          op.value = r.op;
          let value;
          if (kind === 'triage') {
            value = el('select', { class: 'nui-field', 'aria-label': 'Mark', 'data-smart-value': String(i) }, ...TRIAGE.map((x) => el('option', { value: String(x.v), text: `${x.icon} ${x.label}` })));
            value.value = String(r.value ?? '1'); r.value = value.value;
          } else value = el('input', { type: kind === 'text' ? 'text' : 'number', class: 'nui-field', value: r.value ?? '', 'aria-label': 'Value', 'data-smart-value': String(i), hidden: NO_VALUE.has(r.op) || undefined, placeholder: kind === 'date' ? 'days' : '' });
          field.addEventListener('change', () => { r.field = field.value; r.value = ''; draw(); });
          op.addEventListener('change', () => { r.op = op.value; draw(); });
          value.addEventListener(value.tagName === 'SELECT' ? 'change' : 'input', () => { r.value = value.value; recount(); });
          return el('div', { class: 'smart-rule' }, field, op, value,
            el('button', { class: 'nui-icon', title: 'Take this condition away', 'aria-label': 'Take this condition away', disabled: rules.length === 1 || undefined, onclick: () => { rules.splice(i, 1); draw(); } }, '✕'));
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
          setTab('library');
          setView({ smartId: r.id, search: '', triage: null, missingOnly: false });
          notice(existing ? 'Smart collection changed.' : 'Smart collection made: it keeps itself up to date as the library changes.', 2600);
        } catch (e) { err.replaceChildren(el('div', { text: '⚠ ' + e.message })); }
      };
      s.append(head(existing ? '⚡ Edit the smart collection' : '⚡ New smart collection', close),
        el('div', { class: 'modal-body smart-body' },
          presets,
          el('div', { class: 'batch-row' }, el('label', { text: 'Name' }), name),
          el('div', { class: 'batch-row' }, el('span', { text: 'Tracks that match' }), match),
          listBox,
          el('div', {}, el('button', { class: 'nui-btn small', onclick: () => { rules.push({ field: 'genre', op: 'contains', value: '' }); draw(); } }, '＋ Add a condition')),
          el('div', { class: 'batch-row' }, el('label', { class: 'inline' }, limitOn, 'Only the first'), limit, el('span', { text: 'chosen by' }), limitSort),
          count, err),
        el('div', { class: 'modal-foot' }, el('span', { text: 'Smart collections keep themselves up to date; no files are moved.' }),
          el('div', { class: 'modal-buttons' }, el('button', { class: 'nui-btn', onclick: () => close() }, 'Cancel'), el('button', { class: 'nui-btn primary smart-save', onclick: save }, existing ? 'Save' : 'Make it'))));
      draw();
    });
  }
  async function deleteSmart(sc) {
    if (!await confirm('Delete the smart collection?', `“${sc.name}” will be deleted. No tracks or files are affected.`, 'Delete')) return;
    try { status.smart = await req('music.smart.delete', { id: sc.id }); } catch (err) { showError(err); }
    if (view.smartId === sc.id) setView({ smartId: null });
    renderPlaylists();
  }
  async function playSmart(sc) {
    let ids;
    try { ids = await req('music.ids', { smartId: sc.id, sort: 'title' }); } catch (err) { showError(err); return; }
    if (!ids.length) { notice('Nothing matches this smart collection right now.'); return; }
    setQueue(ids, ps && ps.shuffle ? Math.floor(Math.random() * ids.length) : 0);
  }

  // ---------------------------------------------------------------- Sound: equalizer, loudness, limiter
  let measuring = null;   // { ids, done, failed, abort, label }
  async function measure(ids, { label = '' } = {}) {
    if (!ids.length) { notice('Everything here is measured already.'); return; }
    if (measuring) { notice('A measurement is already running.'); return; }
    const ctl = new AbortController();
    measuring = { ids, done: 0, failed: 0, abort: ctl, label };
    renderSoundStatus();
    for (const id of ids) {
      if (ctl.signal.aborted || !alive) break;
      try {
        const r = await NoorFx.analyze(media(id) + (artV ? `?v=${artV}` : ''), ctl.signal);
        if (Number.isFinite(r.lufs)) {
          await req('music.loudness.set', { id, lufs: Math.round(r.lufs * 100) / 100, peak: Math.round(r.peak * 10000) / 10000 });
          gotLoudness({ id, loudness: r.lufs, peak: r.peak });
          doIt(ctx, { op: 'trackChanged', rows: [{ id, loudness: r.lufs, peak: r.peak }] });
        } else measuring.failed++;
      } catch (err) {
        if (err.name === 'AbortError') break;
        measuring.failed++;
      }
      measuring.done++;
      renderSoundStatus();
      await new Promise((res) => setTimeout(res, 30));   // the rest of NoorMD stays responsive between tracks
    }
    const m = measuring;
    measuring = null;
    if (!alive) return;
    renderSoundStatus();
    notice(`Loudness measured: ${m.done - m.failed} track${m.done - m.failed === 1 ? '' : 's'}${m.failed ? ` · ${m.failed} couldn't be decoded` : ''}${ctl.signal.aborted ? ' (stopped)' : ''}.`, 3500);
    if (tab === 'sound') renderSound();
  }
  function gotLoudness({ id, loudness, peak }) {
    const c = cache.get(id);
    if (c) cache.set(id, { ...c, loudness, peak });
    for (const [i, row] of viewRows) if (row.id === id) viewRows.set(i, { ...row, loudness, peak });
  }
  async function measureView() {
    try { measure(await req('music.loudness.unmeasured', { ids: await viewIds() }), { label: 'this list' }); } catch (err) { showError(err); }
  }
  async function measureAll() {
    try { measure(await req('music.loudness.unmeasured', {}), { label: 'the library' }); } catch (err) { showError(err); }
  }
  function gainText(row) {
    const g = ps && ps.trackGain;
    if (!g || g.from === 'none') return 'not measured yet';
    return `${g.db >= 0 ? '+' : '−'}${Math.abs(g.db).toFixed(1)} dB (${g.from === 'measured' && row && Number.isFinite(row.loudness) ? `measured ${row.loudness.toFixed(1)} LUFS` : g.from === 'measured' ? 'measured' : 'from its ReplayGain tags'})`;
  }
  function renderSoundStatus() {
    const box = $('.sound-status');
    if (!box) return;
    const row = curRow();
    const fx = (ps && ps.fx) || NoorFx.settings;
    box.replaceChildren(
      el('div', {}, el('strong', { text: 'This track: ' }), row ? (fx.normalize ? gainText(row) : 'evening out is off') : 'nothing playing'),
      measuring ? el('div', { class: 'sound-progress' },
        el('progress', { max: String(measuring.ids.length), value: String(measuring.done) }),
        el('span', { text: ` Measuring ${measuring.done} / ${measuring.ids.length}${measuring.label ? ' in ' + measuring.label : ''}…` }),
        el('button', { class: 'nui-btn small', onclick: () => measuring && measuring.abort.abort() }, 'Stop')) : null);
  }
  const fxChanged = (patch) => doIt(ctx, { op: 'fx', patch });
  function preampText(fx) {
    const p = ps && Number.isFinite(ps.preamp) ? ps.preamp : 0;
    return fx.eqOn && p < 0 ? `Preamp ${p.toFixed(1)} dB keeps the boosts from clipping; a limiter catches the rest.` : 'A limiter keeps peaks below −1 dBFS.';
  }
  function renderSound() {
    const box = $('.music-sound');
    if (tab !== 'sound') return;
    if (box.contains(document.activeElement) && document.activeElement.type === 'range') return;   // not under the mouse while dragging a band
    const s = (ps && ps.fx) || NoorFx.settings;
    const check = (on, fn) => { const c = el('input', { type: 'checkbox' }); c.checked = !!on; c.addEventListener('change', () => fn(c.checked)); return c; };
    const preset = el('select', { class: 'nui-field fx-preset', 'aria-label': 'Equalizer preset' },
      ...Object.entries(NoorFx.PRESETS).map(([k, p]) => el('option', { value: k, text: p.label })), el('option', { value: 'custom', text: 'Your own' }));
    preset.value = s.preset;
    preset.addEventListener('change', () => { if (preset.value !== 'custom') fxChanged({ preset: preset.value, gains: NoorFx.PRESETS[preset.value].gains.slice(), eqOn: true }); });
    const bands = el('div', { class: 'eq-bands', role: 'group', 'aria-label': 'Equalizer bands' }, ...NoorFx.BANDS.map((f, i) => {
      const r = el('input', { type: 'range', min: '-12', max: '12', step: '0.5', value: String(s.gains[i]), class: 'eq-band', 'data-band': String(i), 'aria-label': `${f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz'} gain`, disabled: !s.eqOn || undefined });
      const val = el('span', { class: 'eq-val', text: (s.gains[i] > 0 ? '+' : '') + s.gains[i] });
      r.addEventListener('input', () => { val.textContent = (Number(r.value) > 0 ? '+' : '') + r.value; });
      r.addEventListener('change', () => { const gains = s.gains.slice(); gains[i] = Number(r.value); preset.value = 'custom'; fxChanged({ gains, preset: 'custom' }); });
      return el('label', { class: 'eq-col' }, val, r, el('span', { class: 'eq-f', text: f >= 1000 ? f / 1000 + 'k' : String(f) }));
    }));
    const target = el('select', { class: 'nui-field fx-target', 'aria-label': 'Loudness target' }, ...NoorFx.TARGETS.map(([v, l]) => el('option', { value: String(v), text: l })));
    target.value = String(s.target);
    target.addEventListener('change', () => fxChanged({ target: Number(target.value) }));
    box.replaceChildren(
      el('section', { class: 'sound-section' },
        el('div', { class: 'sound-head' }, el('label', { class: 'inline' }, check(s.eqOn, (v) => fxChanged({ eqOn: v })), el('strong', { text: 'Equalizer' })), preset),
        bands,
        el('div', { class: 'sound-row' }, el('label', { class: 'inline' }, check(s.preventClipping, (v) => fxChanged({ preventClipping: v })), 'Keep it from clipping'), el('small', { class: 'pref-hint', text: preampText(s) }))),
      el('section', { class: 'sound-section' },
        el('div', { class: 'sound-head' }, el('label', { class: 'inline' }, check(s.normalize, (v) => fxChanged({ normalize: v })), el('strong', { text: 'Even out the loudness' })), target),
        el('p', { class: 'pref-hint', text: 'Plays every track at about the same loudness, from NoorMD\'s own measurement or ReplayGain tags. The files are never changed, and a track is never boosted above −1 dBFS.' }),
        el('div', { class: 'sound-row' }, el('label', { class: 'inline' }, check(s.autoMeasure !== false, (v) => fxChanged({ autoMeasure: v })), 'Measure tracks as they play')),
        el('div', { class: 'sound-row' },
          el('button', { class: 'nui-btn small', disabled: currentId() == null || undefined, onclick: () => measure([currentId()], { label: 'this track' }) }, 'Measure this track'),
          el('button', { class: 'nui-btn small', onclick: () => withSelection((ids) => req('music.loudness.unmeasured', { ids }).then((u) => measure(u, { label: 'the selection' }))) }, 'Measure the selected'),
          el('button', { class: 'nui-btn small', onclick: measureView }, 'Measure this list'),
          el('button', { class: 'nui-btn small', onclick: measureAll }, 'Measure the whole library')),
        el('div', { class: 'sound-status', 'aria-live': 'polite' })));
    renderSoundStatus();
  }

  // ---------------------------------------------------------------- artwork
  function showArtwork(id) {
    const row = cache.get(id) || (ps && ps.track && ps.track.id === id ? ps.track : null);
    if (!row) return;
    modal({ label: 'Artwork', width: 560 }, (s, close) => {
      s.append(head(row.displayTitle || row.fileName, close),
        el('div', { class: 'modal-body art-view' }, row.hasArt ? el('img', { src: art(id, artV), alt: `The artwork of ${row.displayTitle || row.fileName}`, class: 'art-large' }) : artPlaceholder(row)),
        el('div', { class: 'modal-foot' }, el('span', { text: row.hasArt ? '' : 'This track has no artwork (in the file, or a cover.jpg / folder.jpg beside it).' }),
          el('div', { class: 'modal-buttons' },
            row.hasArt ? el('button', { class: 'nui-btn', onclick: () => req('music.art.save', { id }).then((r) => r && r.path && notice(`Artwork saved to ${r.path}`, 3500)).catch(showError) }, 'Save the artwork as…') : null,
            el('button', { class: 'nui-btn primary', onclick: () => close() }, 'Close'))));
    });
  }

  // ---------------------------------------------------------------- the Batch Organizer
  const BATCH_FIELDS = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['albumArtist', 'Album artist'], ['genre', 'Genre'], ['year', 'Year'], ['trackNumber', 'Track #'], ['comment', 'Comment']];
  const BATCH_TOKENS = ['{OriginalName}', '{Title}', '{Artist}', '{Album}', '{AlbumArtist}', '{Genre}', '{Year}', '{TrackNumber:00}', '{n}', '{Folder}'];

  /** Edits after which the player picks the files up again where it was. */
  async function aroundEdit(ids, work, { next = false } = {}) {
    doIt(ctx, { op: 'release', ids });
    try { return await work(); }
    finally {
      artV++;
      ids.forEach((id) => cache.delete(id));
      doIt(ctx, { op: 'reload', ids, next });
    }
  }

  /**
   * One set of tag and rename rules for many tracks. Every change of a rule refreshes a dry-run preview (old → new
   * name, tag changes, problems per file); nothing is touched until Apply, and a batch is undone as a whole.
   */
  function batchOrganizer(ids) {
    if (!ids.length) return;
    const saved = ctx.restore('batch.rules', {}) || {};
    const R = { enabled: false, template: '{OriginalName}', find: '', replace: '', regex: false, matchCase: false, prefix: '', suffix: '', case: 'none', underscores: false, tidy: true, replaceIllegal: false, counterStart: 1, counterStep: 1, counterDigits: 2, ...(saved.rename || {}) };
    const tagRules = Object.fromEntries(BATCH_FIELDS.map(([k]) => [k, { mode: 'keep', value: '' }]));
    let preview = null, timer = null, gen = 0, busy = false;

    modal({ label: 'Batch Organizer', width: 980 }, (s, close) => {
      const summary = el('div', { class: 'batch-summary', role: 'status', 'aria-live': 'polite' }, 'Preparing the preview…');
      const table = el('div', { class: 'batch-preview', role: 'table', 'aria-label': 'Preview' });
      const specError = el('div', { class: 'edit-problems', role: 'alert' });
      const applyBtn = el('button', { class: 'nui-btn primary batch-apply', disabled: true, onclick: () => apply() }, 'Apply');
      const onlyChanges = el('input', { type: 'checkbox' });
      onlyChanges.addEventListener('change', renderPreview);

      const tagGrid = el('div', { class: 'batch-tags' });
      for (const [key, label] of BATCH_FIELDS) {
        const mode = el('select', { class: 'nui-field', 'aria-label': `${label}: what to do`, 'data-field': key },
          el('option', { value: 'keep', text: 'Leave as it is' }), el('option', { value: 'set', text: 'Set to' }), el('option', { value: 'clear', text: 'Clear' }));
        const value = el('input', { type: 'text', class: 'nui-field', disabled: true, placeholder: key === 'trackNumber' ? '{n}' : key === 'title' ? '{OriginalName}' : '', 'aria-label': `${label} value`, 'data-field-value': key, spellcheck: 'false' });
        mode.addEventListener('change', () => { tagRules[key].mode = mode.value; value.disabled = mode.value !== 'set'; if (mode.value === 'set') value.focus(); schedule(); });
        value.addEventListener('input', () => { tagRules[key].value = value.value; schedule(); });
        tagGrid.append(el('label', { text: label }), mode, value);
      }
      const inp = (key, attrs = {}) => {
        const i = el('input', { type: attrs.type || 'text', class: 'nui-field ' + (attrs.class || ''), value: String(R[key]), 'data-rule': key, spellcheck: 'false', ...attrs, ...(attrs.class ? { class: 'nui-field ' + attrs.class } : {}) });
        i.addEventListener('input', () => { R[key] = i.type === 'number' ? Number(i.value) : i.value; schedule(); });
        return i;
      };
      const chk = (key, label) => {
        const c = el('input', { type: 'checkbox', 'data-rule': key });
        c.checked = !!R[key];
        c.addEventListener('change', () => { R[key] = c.checked; schedule(); });
        return el('label', { class: 'inline' }, c, label);
      };
      const renameOn = el('input', { type: 'checkbox', class: 'batch-rename' });
      renameOn.checked = R.enabled;
      renameOn.addEventListener('change', () => { R.enabled = renameOn.checked; schedule(); });
      const template = inp('template', { 'aria-label': 'Name template', class: 'batch-template' });
      const tokens = el('div', { class: 'batch-tokens' }, ...BATCH_TOKENS.map((t) => el('button', { class: 'chip', type: 'button', title: `Insert ${t}`, onclick: () => {
        const a = template.selectionStart ?? template.value.length, b = template.selectionEnd ?? a;
        template.value = template.value.slice(0, a) + t + template.value.slice(b);
        template.focus(); template.setSelectionRange(a + t.length, a + t.length);
        R.template = template.value; renameOn.checked = R.enabled = true; schedule();
      } }, t)));
      const caseSel = el('select', { class: 'nui-field', 'aria-label': 'Letter case', 'data-rule': 'case' }, ...[['none', 'Keep as it is'], ['title', 'Title Case'], ['sentence', 'Sentence case'], ['lower', 'lower case'], ['upper', 'UPPER CASE']].map(([v, t]) => el('option', { value: v, text: t })));
      caseSel.value = R.case;
      caseSel.addEventListener('change', () => { R.case = caseSel.value; schedule(); });
      const names = el('div', { class: 'batch-names' },
        el('label', { class: 'inline batch-rename-toggle' }, renameOn, el('strong', { text: 'Rename the files' })),
        el('div', { class: 'batch-row' }, el('label', { text: 'Template' }), template), tokens,
        el('div', { class: 'batch-row' }, el('label', { text: 'Find' }), inp('find', { 'aria-label': 'Find' }), el('label', { text: 'Replace with' }), inp('replace', { 'aria-label': 'Replace with' })),
        el('div', { class: 'batch-row' }, chk('regex', 'Regular expression'), chk('matchCase', 'Match case')),
        el('div', { class: 'batch-row' }, el('label', { text: 'Prefix' }), inp('prefix', { 'aria-label': 'Prefix' }), el('label', { text: 'Suffix' }), inp('suffix', { 'aria-label': 'Suffix' })),
        el('div', { class: 'batch-row' }, el('label', { text: 'Case' }), caseSel, chk('underscores', 'Underscores → spaces'), chk('tidy', 'Tidy spaces')),
        el('div', { class: 'batch-row' }, el('label', { text: 'Counter {n}' }), el('span', { text: 'start' }), inp('counterStart', { type: 'number', min: '0', class: 'num', 'aria-label': 'Counter start' }),
          el('span', { text: 'step' }), inp('counterStep', { type: 'number', min: '1', class: 'num', 'aria-label': 'Counter step' }),
          el('span', { text: 'digits' }), inp('counterDigits', { type: 'number', min: '1', max: '6', class: 'num', 'aria-label': 'Counter digits' })),
        el('div', { class: 'batch-row' }, chk('replaceIllegal', 'Replace characters Windows doesn\'t allow with “-”')));
      const body = el('div', { class: 'modal-body batch-body' },
        el('div', { class: 'batch-rules' },
          el('section', {}, el('h3', { text: 'Tags' }), el('p', { class: 'pref-hint', text: '“Set to” values may use placeholders such as {OriginalName} or {n}.' }), tagGrid),
          el('section', {}, el('h3', { text: 'File names' }), names)),
        specError,
        el('div', { class: 'batch-preview-head' }, summary, el('label', { class: 'inline' }, onlyChanges, 'Only changes and problems')),
        table);
      const buttons = el('div', { class: 'modal-buttons' }, el('button', { class: 'nui-btn', onclick: () => close() }, 'Cancel'), applyBtn);
      s.append(head(`Batch Organizer: ${ids.length.toLocaleString()} track${ids.length === 1 ? '' : 's'}`, close), body,
        el('div', { class: 'modal-foot' }, el('span', { text: 'A dry run: nothing changes until Apply, and the whole batch can be undone.' }), buttons));

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
        summary.textContent = `${p.willChange.toLocaleString()} will change · ${p.unchanged.toLocaleString()} stay as they are · ${p.blocked.toLocaleString()} can't`;
        applyBtn.disabled = busy || p.willChange === 0;
        applyBtn.textContent = p.willChange ? `Apply to ${p.willChange.toLocaleString()} file${p.willChange === 1 ? '' : 's'}` : 'Apply';
        const rows = p.items.filter((i) => !onlyChanges.checked || !i.ok || i.renames || i.tags.length || i.warnings.length);
        const shown = rows.slice(0, 500);
        table.replaceChildren(
          el('div', { class: 'batch-tr head', role: 'row' }, ...['', 'Now', 'New name', 'Tags'].map((t) => el('span', { role: 'columnheader', text: t }))),
          ...shown.map((i) => el('div', { class: 'batch-tr' + (i.ok ? '' : ' blocked') + (i.warnings.length ? ' warn' : ''), role: 'row', 'data-id': String(i.id) },
            el('span', { class: 'batch-state', role: 'cell', title: i.ok ? (i.renames || i.tags.length ? 'Will change' : 'Stays as it is') : 'Can\'t', text: !i.ok ? '✕' : i.warnings.length ? '⚠' : i.renames || i.tags.length ? '✓' : '·' }),
            el('span', { role: 'cell', class: 'batch-old', text: i.oldName, title: i.folder }),
            el('span', { role: 'cell', class: 'batch-new' + (i.renames ? ' changed' : ''), text: i.renames ? i.newName : '(the same)' }),
            el('span', { role: 'cell', class: 'batch-tagchanges' },
              ...i.tags.map((c) => el('span', { class: 'chip', text: `${(BATCH_FIELDS.find(([k]) => k === c.field) || [, c.field])[1]}: ${c.old ?? '∅'} → ${c.new ?? '∅'}` })),
              ...i.problems.map((m) => el('div', { class: 'batch-problem', text: '✕ ' + m })),
              ...i.warnings.map((m) => el('div', { class: 'batch-warning', text: '⚠ ' + m }))))),
          ...(rows.length > shown.length ? [el('p', { class: 'music-none', text: `…and ${(rows.length - shown.length).toLocaleString()} more (all of them are applied).` })] : []));
      }
      async function apply() {
        if (!preview || !preview.willChange || busy) return;
        const n = preview.willChange;
        if (!await confirm('Apply the batch?', [`${n.toLocaleString()} file${n === 1 ? '' : 's'} will be changed${preview.blocked ? `; ${preview.blocked} that can't be ${preview.blocked === 1 ? 'is' : 'are'} skipped` : ''}.`, 'You can undo the whole batch afterwards (Edit › Undo the last track edit).'], 'Apply')) return;
        ctx.keep('batch.rules', { rename: { ...R, enabled: false } });
        busy = true; applyBtn.disabled = true; applyBtn.textContent = 'Applying…';
        let r;
        try { r = await aroundEdit(ids, () => req('music.batch.apply', { ids, spec: spec() })); }
        catch (err) { busy = false; specError.replaceChildren(el('div', { text: '⚠ ' + err.message })); renderPreview(); return; }
        status.undo = r.undo || status.undo;
        refreshStatus(true);
        showResults(r);
      }
      function showResults(r) {
        const label = { done: '✓ Done', failed: '✕ Failed', partial: '⚠ Partly', skipped: '– Skipped', unchanged: '· The same' };
        body.replaceChildren(
          el('div', { class: 'batch-summary batch-result', role: 'status' }, `${r.done} changed · ${r.failed} failed · ${r.skipped} skipped`),
          el('div', { class: 'batch-preview', role: 'table', 'aria-label': 'Results' },
            ...r.items.filter((i) => i.status !== 'unchanged').slice(0, 1000).map((i) => el('div', { class: 'batch-tr result ' + i.status, role: 'row' },
              el('span', { role: 'cell', class: 'batch-status', text: label[i.status] || i.status }),
              el('span', { role: 'cell', text: i.oldName }),
              el('span', { role: 'cell', text: i.newName !== i.oldName ? '→ ' + i.newName : '' }),
              el('span', { role: 'cell', class: 'batch-problem', text: i.message || '' })))));
        buttons.replaceChildren(
          r.batchId ? el('button', { class: 'nui-btn batch-undo', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const u = await aroundEdit(ids, () => req('music.batch.undo', { batchId: r.batchId }));
              status.undo = u.undo; refreshStatus(true);
              notice(`Batch undone: ${u.done} put back${u.skipped ? `, ${u.skipped} skipped (changed since)` : ''}${u.failed ? `, ${u.failed} failed` : ''}.`, 4500);
              close();
            } catch (err) { showError(err); }
          } }, '↶ Undo this batch') : null,
          el('button', { class: 'nui-btn primary', autofocus: true, onclick: () => close() }, 'Close'));
        notice(`Batch applied: ${r.done} changed${r.failed ? `, ${r.failed} failed` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}.`, 3500);
      }
      refresh();
    });
  }
  async function batchSelected() {
    if (!sel.size && selected < 0) { notice('Select tracks in the library first (click, Shift+click, Ctrl+click or Ctrl+A).', 3500); return; }
    await withSelection(batchOrganizer);
  }

  // ---------------------------------------------------------------- folders
  async function addFolder() {
    try { const r = await req('music.addFolder'); if (r && !r.cancelled) { notice('Looking through it in the background: keep working.', 2600); await refreshStatus(true); } } catch (err) { showError(err); }
  }
  function showFolders() {
    modal({ label: 'Music folders', width: 640 }, (s, close) => {
      const body = el('div', { class: 'modal-body' });
      const render = () => {
        const last = lastScanNote(status.lastScan);
        body.replaceChildren(
          el('p', { text: 'NoorMD reads these folders (and their subfolders). It never moves, renames or rewrites files by itself; taking a folder away only takes it out of the library.' }),
          ...status.folders.map((f) => el('div', { class: 'snapshot mu-folder' },
            el('div', { class: 'info' }, el('div', { text: f.path, title: f.path }), el('small', { text: `${(f.tracks ?? 0).toLocaleString()} track${f.tracks === 1 ? '' : 's'} · ${f.lastScan ? 'looked through ' + new Date(f.lastScan).toLocaleString() : 'not looked through yet'}` })),
            el('div', { class: 'row-actions' },
              el('button', { class: 'nui-btn small', onclick: () => req('music.rescan', { id: f.id }).then(() => notice('Looking through it again…', 1500)).catch(showError) }, 'Rescan'),
              el('button', { class: 'nui-btn small danger', onclick: async () => {
                if (!await confirm('Take the folder out of the library?', [`“${f.path}” and its ${f.tracks} tracks leave the library, with their marks and playlist entries.`, 'The files on disk aren\'t touched.'], 'Take it out')) return;
                await req('music.removeFolder', { id: f.id }).catch(showError);
                await refreshStatus(true); render();
              } }, 'Take out')))),
          status.folders.length ? null : el('p', { class: 'music-none', text: 'No folders yet.' }),
          status.scanning ? el('p', { class: 'mu-folders-note', text: 'Looking through your music right now…' }) : last ? el('p', { class: 'mu-folders-note', text: last }) : null);
      };
      render();
      s.append(head('Music folders', close), body, el('div', { class: 'modal-foot' },
        el('span', { text: 'Missing files are marked, never deleted. Moved files are found again on a rescan.' }),
        el('div', { class: 'modal-buttons' },
          el('button', { class: 'nui-btn', onclick: () => req('music.rescan', {}).then(() => notice('Looking for new music…', 1500)).catch(showError) }, 'Rescan all'),
          el('button', { class: 'nui-btn primary', onclick: async () => { await addFolder(); render(); } }, '＋ Add a folder'))));
    });
  }

  // ---------------------------------------------------------------- editing a track
  function editCurrent() {
    const inList = document.activeElement === list;
    const id = (inList ? viewRows.get(selected)?.id : null) ?? currentId() ?? viewRows.get(selected)?.id;
    if (id == null) { notice('Nothing is playing or selected.', 1400); return; }
    editTrack(id);
  }
  async function editTrack(id) {
    let t;
    try { t = await req('music.track', { id }); } catch (err) { showError(err); return; }
    const fields = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['albumArtist', 'Album artist'], ['genre', 'Genre'], ['year', 'Year'], ['trackNumber', 'Track #'], ['comment', 'Comment']];
    const dot = t.fileName.lastIndexOf('.');
    const ext = dot > 0 ? t.fileName.slice(dot) : '';
    const baseName = ext ? t.fileName.slice(0, -ext.length) : t.fileName;
    const inputs = {};
    let validateTimer = null;
    modal({ label: 'Edit track', width: 640 }, (s, close) => {
      const nameInput = el('input', { type: 'text', class: 'nui-field', value: baseName, 'aria-label': 'File name', spellcheck: 'false', autofocus: true });
      const nameProblems = el('div', { class: 'edit-problems', role: 'alert' });
      const renameBox = el('input', { type: 'checkbox', class: 'edit-rename' });
      const tagsBox = el('input', { type: 'checkbox', class: 'edit-tags' });
      const grid = el('div', { class: 'pref-grid edit-grid' });
      for (const [key, label] of fields) {
        const v = t.tags[key];
        const input = el('input', { type: key === 'year' || key === 'trackNumber' ? 'number' : 'text', class: 'nui-field', value: v == null ? '' : String(v), placeholder: '— not set —', 'aria-label': label, 'data-key': key, spellcheck: key === 'title' || key === 'comment' ? 'true' : 'false' });
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
          try { const probs = await req('music.edit.validate', { id, fileName: nameInput.value.trim() + ext }); nameProblems.replaceChildren(...probs.map((p) => el('div', { text: '⚠ ' + p }))); } catch { /* checked again on save */ }
        }, 200);
      };
      nameInput.addEventListener('input', validate);
      const suggest = el('button', { class: 'nui-btn small', onclick: async () => {
        const name = await req('music.suggestName', { title: inputs.title.value, artist: inputs.artist.value }).catch(() => '');
        if (name) { nameInput.value = name; validate(); }
      } }, '↺ Name from the tags');

      const save = async (andNext) => {
        const tags = changedTags();
        const doTags = tagsBox.checked && tags != null;
        const doRename = renameBox.checked && nameInput.value.trim() !== baseName;
        if (!doTags && !doRename) { close(); if (andNext) doIt(ctx, { op: 'next' }); return; }
        if (doTags) {
          for (const k of ['year', 'trackNumber']) if (tags[k] !== undefined && tags[k] !== '' && !(Number.isInteger(tags[k]) && tags[k] >= 0 && tags[k] < 100000)) { notice(`${k === 'year' ? 'The year' : 'The track number'} must be a whole number.`); return; }
        }
        let r;
        const isCurrent = id === currentId();
        try {
          r = await aroundEdit([id], () => req('music.edit.apply', { id, updateTags: doTags, tags: doTags ? tags : undefined, rename: doRename, fileName: nameInput.value.trim() + ext }), { next: andNext && isCurrent });
        } catch (err) { r = { ok: false, problems: [err.message] }; }
        if (r.track) {
          const patch = { displayTitle: r.track.displayTitle, title: r.track.tags.title, artist: r.track.tags.artist, album: r.track.tags.album, genre: r.track.tags.genre, year: r.track.tags.year, fileName: r.track.fileName };
          for (const [i, row] of viewRows) if (row.id === id) viewRows.set(i, { ...row, ...patch });
          renderList();
        }
        status.undo = r.undo || status.undo;
        if (!r.ok) {
          nameProblems.replaceChildren(...(r.problems || []).map((p) => el('div', { text: '⚠ ' + p })));
          if (r.tagsSaved || r.renamed) notice('Partly saved: ' + [r.tagsSaved ? 'the tags were saved' : null, r.renamed ? 'the file was renamed' : null].filter(Boolean).join(', '), 4000);
          return;
        }
        close();
        notice(`Saved${r.tagsSaved ? ' · tags changed' : ''}${r.renamed ? ' · file renamed' : ''}. Edit › Undo the last track edit puts it back.`, 3500);
        if (andNext && !isCurrent) doIt(ctx, { op: 'next' });
      };
      s.append(head('✎ Edit track', close), el('div', { class: 'modal-body' },
        el('div', { class: 'edit-file' },
          el('label', { text: 'File name' }),
          el('div', { class: 'edit-name' }, nameInput, el('span', { class: 'edit-ext', text: ext }), suggest),
          nameProblems,
          el('small', { class: 'pref-hint' }, `In ${t.folder}`, ' · ', el('button', { class: 'linkish', onclick: () => req('music.reveal', { id }).catch(showError) }, 'Show in Explorer'), t.readOnly ? ' · ⚠ the file is read-only' : '', t.readError ? ' · ⚠ ' + t.readError : '')),
        grid,
        el('div', { class: 'edit-options' },
          el('label', { class: 'inline' }, tagsBox, 'Change the tags in the file (ID3 / Vorbis / MP4)'),
          el('label', { class: 'inline' }, renameBox, 'Rename the file on disk'))),
      el('div', { class: 'modal-foot' },
        el('span', { text: 'Enter saves · Ctrl+Enter saves and plays the next · Esc cancels (nothing changes)' }),
        el('div', { class: 'modal-buttons' },
          el('button', { class: 'nui-btn', onclick: () => close() }, 'Cancel'),
          el('button', { class: 'nui-btn', onclick: () => save(true) }, 'Save & next'),
          el('button', { class: 'nui-btn primary edit-save', onclick: () => save(false) }, 'Save'))));
      s.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(e.ctrlKey); } });
      setTimeout(() => nameInput.select(), 0);
    });
  }
  async function undoLastEdit() {
    try { status = { ...status, ...(await req('music.status')) }; } catch { /* use what we have */ }
    const u = status.undo;
    if (!u) { notice('There is no track edit to undo.'); return; }
    if (u.batchId) {
      if (!await confirm('Undo the last batch?', [`${u.count} file${u.count === 1 ? '' : 's'} changed by the Batch Organizer get their names and tags back.`, 'Files changed since then are skipped (and listed).'], 'Undo the batch')) return;
      try {
        const r = await aroundEdit([...cache.keys()], () => req('music.batch.undo', { batchId: u.batchId }));
        status.undo = r.undo;
        notice(`Batch undone: ${r.done} put back${r.skipped ? `, ${r.skipped} skipped (changed since)` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`, 4500);
      } catch (err) { showError(err); }
      refreshStatus(true);
      return;
    }
    if (!await confirm('Undo the last track edit?', [`“${u.newName}” gets back its name, “${u.oldName}”, and its tags.`, 'NoorMD won\'t if the file was changed since.'], 'Undo')) return;
    try {
      const r = await aroundEdit([...cache.keys()], () => req('music.undo'));
      status.undo = r.undo;
      notice(r.ok ? 'Edit undone ✓' : 'Couldn\'t undo: ' + r.problems.join(' '), 4500);
    } catch (err) { showError(err); }
    refreshStatus(true);
  }

  // ---------------------------------------------------------------- keeping up with the library
  async function refreshStatus(invalidate) {
    try { status = await req('music.status'); } catch (err) { showError(err); return; }
    if (!alive) return;
    if (invalidate) { viewRows = new Map(); viewGen++; }
    scan.fromStatus(status);
    renderHeader();
    renderViewbar();
    renderPlaylists();
    await loadView(false);
  }
  let changeTimer = 0;
  const offs = [
    listen(ctx, (s) => {
      const was = currentId();
      ps = s;
      if (s && s.track) cache.set(s.track.id, { ...(cache.get(s.track.id) || {}), ...s.track });
      renderTransport();
      renderTime(s);
      renderQueue();
      if (tab === 'sound') { renderSoundStatus(); if (!measuring) renderSound(); }
      if (currentId() !== was) followPlaying();
    }, (t) => renderTime(t)),
    ctx.on('changed', () => { clearTimeout(changeTimer); changeTimer = setTimeout(() => refreshStatus(true), 250); }),
    ctx.on('playlists', () => refreshStatus(view.playlistId != null || view.smartId != null)),
    ctx.on('triage', (p) => { applyTriage(p.ids, p.value); doIt(ctx, { op: 'trackChanged', rows: p.ids.map((id) => ({ id, triage: p.value })) }); req('music.status').then((st) => { status = st; renderChips(); }).catch(() => {}); }),
    ctx.on('scan', (sp) => { scan.update(sp); const box = $('.music-scan'); if (box) box.textContent = ''; }),
    ctx.on('measured', (m) => gotLoudness(m)),
  ];
  renderColumns();
  renderChips();
  setTab(tab);
  refreshStatus(false);

  return {
    commands: {
      'music.toggle': () => toggle(),
      'music.next': () => doIt(ctx, { op: 'next' }),
      'music.prev': () => doIt(ctx, { op: 'prev' }),
      'music.random': () => playRandom(),
      'music.shuffle': () => doIt(ctx, { op: 'shuffle' }),
      'music.repeat': () => doIt(ctx, { op: 'repeat' }),
      'music.reveal.playing': () => revealPlaying(),
      'music.favCurrent': () => triageCurrent(currentTriage() === 1 ? 0 : 1),
      'music.focusSearch': () => { setTab('library'); $('.music-search').focus(); $('.music-search').select(); },
      'music.addFolderUi': () => addFolder(),
      'music.foldersUi': () => showFolders(),
      'music.rescanUi': () => req('music.rescan', {}).then(() => notice('Looking for new music…')).catch(showError),
      'music.newPlaylist': () => createPlaylist([]),
      'music.importPlaylist': () => importPlaylist(),
      'music.newSmart': () => editSmart(null),
      'music.editTrack': () => editCurrent(),
      'music.batch': () => batchSelected(),
      'music.undoEdit': () => undoLastEdit(),
      'music.sound': () => setTab('sound'),
      'music.selectAll': () => { setTab('library'); selectAll(); },
    },
    checked: (cmd) => (cmd === 'music.shuffle' ? !!(ps && ps.shuffle) : undefined),
    focus: () => focusList(),
    setTab,
    unmount() {
      alive = false;
      offs.forEach((f) => f());
      ro1.disconnect(); ro2.disconnect();
      clearTimeout(changeTimer); clearTimeout(searchTimer);
      if (measuring) measuring.abort.abort();
    },
    _state: () => ({ view: { ...view }, selected, sel: [...sel].sort((a, b) => a - b), rows: viewRows.size, wide, tab, status }),
  };
}
