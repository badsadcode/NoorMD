// The Music bench: your music folders as a library (its tab), and a player that keeps playing whichever bench is in
// front. The player runs in the main window (engine.js); the library view, the panels (Now playing, Up next, Sound)
// and the mini player in the status bar talk to it through the bench's events, from any window.
import { el, menu } from '/ui/js/noor-ui.js';
import { createEngine } from './engine.js';
import { NoorFx } from './fx.js';

const here = (p) => new URL(p, import.meta.url).href;
const art = (id) => `/media/noor.music/art/${id}`;
const fail = (ctx) => (e) => ctx.toast(e.message, { error: true });
export const TRIAGE = [
  { v: 0, label: 'Not marked', short: '—', icon: '○' },
  { v: 1, label: 'Favourite', short: 'Fav', icon: '★' },
  { v: 2, label: 'Keep', short: 'Keep', icon: '✓' },
  { v: 3, label: 'Maybe', short: 'Maybe', icon: '?' },
  { v: 4, label: 'Skip', short: 'Skip', icon: '✕' },
];
const SORTS = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['genre', 'Genre'], ['year', 'Year'], ['duration', 'Time'], ['plays', 'Plays'], ['added', 'Added'], ['filename', 'File name']];
export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '–:––';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
}
/** A cover picture, or a note when the track has none (or it doesn't load). */
function cover(track, cls = 'mu-art') {
  const box = el('div', { class: cls, 'aria-hidden': 'true' }, el('span', { text: '♫' }));
  if (track && track.hasArt) {
    const img = el('img', { alt: '', src: art(track.id), onerror: () => img.remove() });
    box.append(img);
  }
  return box;
}

// ---------------------------------------------------------------- the player's state, as each page last heard it
let engine = null;
const heard = { state: null, time: null };
function listen(ctx, onState, onTime) {
  const offs = [
    ctx.on('player.state', (s) => { heard.state = s; if (s) heard.time = { id: s.id, time: s.time, duration: s.duration }; onState && onState(s); }),
    ctx.on('player.time', (t) => { heard.time = t; onTime && onTime(t); }),
  ];
  if (heard.state && onState) setTimeout(() => onState(heard.state), 0);
  ctx.emit('player.ask');
  return () => offs.forEach((f) => f());
}
const doIt = (ctx, m) => ctx.emit('player.do', m);

const ICON = { shuffle: '⇄', random: '⚄', prev: '⏮', play: '▶', pause: '❚❚', next: '⏭', repeat: '↻', repeatOne: '↻¹' };

/** The cover box: the picture, or a soft accent tile with a note when there's none. */
function artBox(cls) {
  const box = el('div', { class: cls, 'aria-hidden': 'true' }, el('span', { text: '♫' }));
  let showing;
  return {
    node: box,
    set(track) {
      const want = track && track.hasArt ? art(track.id) : null;
      const key = want || (track ? 'none:' + track.id : '');
      if (showing === key) return;
      showing = key;
      box.replaceChildren(want ? el('img', { alt: '', src: want, onerror: (e) => e.target.replaceWith(el('span', { text: '♫' })) }) : el('span', { text: '♫' }));
    },
  };
}

/** A seek bar that follows the player (and seeks when dragged). */
function seekRow(ctx, cls) {
  const cur = el('span', { class: 'mu-time', text: '0:00' }), dur = el('span', { class: 'mu-time', text: '0:00' });
  const range = el('input', { type: 'range', class: 'mu-range', min: '0', max: '1000', value: '0', 'aria-label': 'Position' });
  let dragging = false, d = 0;
  range.addEventListener('input', () => { dragging = true; cur.textContent = fmtTime((Number(range.value) / 1000) * d); fill(); });
  range.addEventListener('change', () => { dragging = false; if (d) doIt(ctx, { op: 'seek', t: (Number(range.value) / 1000) * d }); });
  const fill = () => range.style.setProperty('--fill', `${Number(range.value) / 10}%`);
  return {
    node: el('div', { class: cls }, cur, range, dur),
    time(t) {
      if (!t) return;
      d = t.duration || d;
      if (dragging) return;
      cur.textContent = fmtTime(t.time); dur.textContent = fmtTime(d);
      range.value = d ? String(Math.round((t.time / d) * 1000)) : '0';
      fill();
    },
  };
}

/** The mini player: a bar along the bottom of the window (whichever bench is in front), as in NoorMD 2.0. ✕ hides it
    (the music keeps playing); a small ♫ in the status bar brings it back. */
function bottomBar(ctx) {
  const cover = artBox('mu-mp-art');
  const title = el('div', { class: 'mu-mp-title' }), sub = el('div', { class: 'mu-mp-sub' });
  const b = (label, t, op, cls = '') => el('button', { class: 'mu-ib ' + cls, title: t, 'aria-label': t, onclick: () => doIt(ctx, { op }) }, label);
  const shuffle = b(ICON.shuffle, 'Shuffle', 'shuffle', 'toggle'), play = b(ICON.play, 'Play / pause', 'toggle', 'play');
  const seek = seekRow(ctx, 'mu-mp-seek');
  const mark = el('span', { class: 'mu-mp-mark' });
  let hidden = !!ctx.restore('bar.hidden', false);
  const reopen = el('button', { class: 'mu-mini-btn', title: 'Show the mini player', 'aria-label': 'Show the mini player', hidden: true, onclick: () => setHidden(false) }, '♫');
  const bar = el('div', { class: 'mu-mp', role: 'region', 'aria-label': 'Mini player' },
    el('button', { class: 'mu-mp-who', title: 'Open the Music bench', onclick: () => ctx.openBench('noor.music') }, cover.node, el('div', { class: 'mu-mp-text' }, title, sub)),
    shuffle, b(ICON.prev, 'Previous', 'prev'), play, b(ICON.next, 'Next', 'next'),
    el('button', { class: 'mu-ib', title: 'A random track', 'aria-label': 'A random track', onclick: async () => doIt(ctx, { op: 'random', ids: await ctx.call('music.ids', { sort: 'title', offset: 0, limit: 2000 }).catch(() => []) }) }, ICON.random),
    seek.node, mark,
    el('button', { class: 'mu-ib quiet', title: 'Open the Music bench', 'aria-label': 'Open the Music bench', onclick: () => ctx.openBench('noor.music') }, '♫'),
    el('button', { class: 'mu-ib quiet', title: 'Hide the mini player (the music keeps playing)', 'aria-label': 'Hide the mini player', onclick: () => setHidden(true) }, '✕'));
  let has = false;
  function place() {
    ctx.setBottomBar(has && !hidden ? bar : null);
    reopen.hidden = !(has && hidden);
  }
  function setHidden(v) { hidden = v; ctx.keep('bar.hidden', v); place(); }
  ctx.setStatusWidget(reopen);
  const off = listen(ctx, (s) => {
    has = !!(s && s.track);
    place();
    if (!has) return;
    cover.set(s.track);
    title.textContent = s.track.displayTitle;
    sub.textContent = s.track.artist || s.track.fileName || '';
    play.textContent = s.playing ? ICON.pause : ICON.play;
    play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    shuffle.classList.toggle('on', !!s.shuffle); shuffle.setAttribute('aria-pressed', String(!!s.shuffle));
    mark.textContent = s.track.triage ? TRIAGE[s.track.triage].icon : '';
    seek.time(s);
  }, (t) => seek.time(t));
  return { stop() { off(); ctx.setBottomBar(null); ctx.setStatusWidget(null); } };
}

// ---------------------------------------------------------------- dialogs shared by the view and the menus
async function askText(ctx, title, label, value = '', okLabel = 'OK') {
  let input;
  const ok = await ctx.dialog(title, el('label', { class: 'mu-field' }, el('span', { text: label }),
    input = el('input', { class: 'nui-field', type: 'text', value, onkeydown: (e) => { if (e.key === 'Enter') e.target.closest('.nui-dialog').querySelector('.nui-btn.primary').click(); } })),
    [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: true }]);
  return ok ? input.value.trim() : null;
}
async function addFolder(ctx) {
  try { const r = await ctx.call('music.addFolder', {}); if (r) ctx.toast(`Looking through ${r.path}…`); } catch (e) { fail(ctx)(e); }
}
async function newPlaylist(ctx, ids = []) {
  const name = await askText(ctx, 'New playlist', 'Its name', 'New playlist', 'Make it');
  if (!name) return null;
  try { const r = await ctx.call('music.playlist.create', { name, ids }); ctx.toast(ids.length ? `“${name}”: ${ids.length} track${ids.length === 1 ? '' : 's'}.` : `Playlist “${name}” made.`); return r.id; } catch (e) { fail(ctx)(e); return null; }
}
async function foldersDialog(ctx) {
  const s = await ctx.call('music.status').catch(() => null);
  if (!s) return;
  const list = el('div', { class: 'mu-folders' });
  const draw = (st) => list.replaceChildren(...(st.folders.length ? st.folders.map((f) => el('div', { class: 'mu-folder' },
    el('span', { class: 'n', text: f.path, title: f.path }), el('span', { class: 'nui-muted', text: `${f.tracks} track${f.tracks === 1 ? '' : 's'}` }),
    el('button', { class: 'nui-btn small', title: 'Look for new music in it', onclick: () => ctx.call('music.rescan', { id: f.id }).catch(fail(ctx)) }, 'Rescan'),
    el('button', { class: 'nui-icon', title: 'Remove it from the library (the files stay where they are)', 'aria-label': `Remove ${f.path}`, onclick: async () => draw(await ctx.call('music.removeFolder', { id: f.id })) }, '✕')))
    : [el('p', { class: 'nui-muted', text: 'No music folders yet.' })]));
  draw(s);
  const what = await ctx.dialog('Music folders', el('div', { class: 'mu-folders-wrap' }, el('p', { class: 'nui-muted', text: 'The library is made from these folders (and their subfolders). Your files are only read: nothing is moved or changed.' }), list),
    [{ label: 'Close', value: null }, { label: 'Add a folder…', value: 'add', primary: true }]);
  if (what === 'add') addFolder(ctx);
}

export default {
  /** Once per window: the player in the main window, the mini player along the bottom of every window. */
  start(ctx) {
    ctx.useStyle(here('bench.css'));
    if (ctx.isMainWindow && !engine) engine = createEngine(ctx);
    this._mini = bottomBar(ctx);
  },
  /** For tests: the player (main window only). */
  _engine: () => engine,
  /** The bench closed: the music stops (its window's mini player goes too). */
  closed() {
    if (engine) { engine.stop(); engine = null; }
    if (this._mini) { this._mini.stop(); this._mini = null; }
    heard.state = null;
  },

  // ---------------------------------------------------------------- the library
  mount(root, ctx) {
    ctx.useStyle(here('bench.css'));
    const view = { search: '', triage: null, missingOnly: false, playlistId: null, sort: ctx.restore('sort', 'artist'), desc: !!ctx.restore('desc', false) };
    let status = null, total = 0, rows = new Map(), pending = new Set(), sel = new Set(), anchor = -1, focus = -1, gen = 0, nowId = null, scanLine = '';
    const ROW = 32;
    const side = el('nav', { class: 'mu-side', 'aria-label': 'Library sections' });
    const search = el('input', { class: 'nui-field mu-search', type: 'search', placeholder: 'Search titles, artists, albums… (Ctrl+F)', 'aria-label': 'Search the library',
      oninput: () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { view.search = search.value; reload(); }, 180); } });
    let searchTimer = 0;
    const heading = el('div', { class: 'mu-heading' });
    const head = el('div', { class: 'mu-cols', role: 'row' });
    const spacer = el('div', { class: 'mu-spacer' });
    const list = el('div', { class: 'mu-list', role: 'grid', tabindex: '0', 'aria-label': 'Tracks', 'aria-multiselectable': 'true' }, spacer);
    const empty = el('div', { class: 'mu-empty', hidden: true });
    const main = el('section', { class: 'mu-main' },
      el('div', { class: 'mu-bar' }, heading, search,
        el('button', { class: 'nui-btn primary', title: 'Play this list from the top', onclick: () => playFrom(0) }, '▶ Play'),
        el('button', { class: 'nui-btn', title: 'Play this list shuffled', onclick: async () => { const ids = await allIds(); if (ids.length) { doIt(ctx, { op: 'shuffle', on: true }); doIt(ctx, { op: 'playIds', ids, start: Math.floor(Math.random() * ids.length) }); } } }, '⇄ Shuffle'),
        el('button', { class: 'nui-btn', title: 'A random track from this list', onclick: async () => doIt(ctx, { op: 'random', ids: await allIds() }) }, '⚄')),
      head, list, empty);
    const box = el('div', { class: 'mu-bench' }, side, main);
    root.replaceChildren(box);

    const payload = (offset, limit) => ({ search: view.search, triage: view.triage, missingOnly: view.missingOnly, playlistId: view.playlistId, sort: view.sort, desc: view.desc, offset, limit });
    const allIds = () => ctx.call('music.ids', payload(0, 2000)).catch(() => []);

    // ---------------------------------------------------------- the side: sections, playlists, folders
    function drawSide() {
      const st = status ? status.stats : { total: 0 };
      const item = (label, icon, count, on, active, extra = {}) => el('button', { class: 'mu-sec' + (active ? ' on' : ''), onclick: on, ...extra },
        el('span', { class: 'ic', text: icon }), el('span', { class: 'n', text: label }), count != null ? el('span', { class: 'c', text: String(count) }) : '');
      const isAll = view.triage == null && !view.missingOnly && view.playlistId == null;
      side.replaceChildren(
        el('div', { class: 'mu-side-h', text: 'Library' }),
        item('All music', '♫', st.total, () => setSection({}), isAll),
        ...TRIAGE.filter((t) => t.v !== 0).map((t) => item(t.label, t.icon, st[['', 'favorite', 'keep', 'maybe', 'skip'][t.v]], () => setSection({ triage: t.v }), view.triage === t.v)),
        item('Not marked', '○', st.untriaged, () => setSection({ triage: 0 }), view.triage === 0),
        st.missing ? item('Missing files', '⚠', st.missing, () => setSection({ missingOnly: true }), view.missingOnly) : '',
        el('div', { class: 'mu-side-h' }, 'Playlists', el('button', { class: 'nui-icon', title: 'New playlist', 'aria-label': 'New playlist', onclick: () => newPlaylist(ctx) }, '＋')),
        ...((status && status.playlists) || []).map((p) => item(p.name, '☰', p.count, () => setSection({ playlistId: p.id }), view.playlistId === p.id,
          { oncontextmenu: (e) => { e.preventDefault(); playlistMenu(p, e.clientX, e.clientY); }, 'data-playlist': String(p.id),
            ondragover: (e) => { if ([...e.dataTransfer.types].includes('text/x-noor-tracks')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
            ondragleave: (e) => e.currentTarget.classList.remove('drop'),
            ondrop: (e) => { e.currentTarget.classList.remove('drop'); const ids = JSON.parse(e.dataTransfer.getData('text/x-noor-tracks') || '[]'); if (ids.length) ctx.call('music.playlist.add', { id: p.id, ids }).then(() => ctx.toast(`Added to “${p.name}”.`)).catch(fail(ctx)); } })),
        el('div', { class: 'mu-side-h', text: 'Folders' }),
        el('button', { class: 'mu-sec', onclick: () => foldersDialog(ctx) }, el('span', { class: 'ic', text: '📁' }), el('span', { class: 'n', text: status ? `${status.folders.length} folder${status.folders.length === 1 ? '' : 's'}` : 'Folders' })),
        el('button', { class: 'mu-sec', onclick: () => addFolder(ctx) }, el('span', { class: 'ic', text: '＋' }), el('span', { class: 'n', text: 'Add a folder…' })),
        scanLine ? el('div', { class: 'mu-scan', text: scanLine }) : '');
    }
    function setSection(s) {
      view.triage = s.triage ?? null; view.missingOnly = !!s.missingOnly; view.playlistId = s.playlistId ?? null;
      reload(); drawSide();
    }
    function playlistMenu(p, x, y) {
      menu(x, y, [{ header: p.name },
        { label: 'Play it', run: async () => { const ids = await ctx.call('music.ids', { playlistId: p.id, sort: 'playlist', offset: 0, limit: 2000 }).catch(() => []); if (ids.length) doIt(ctx, { op: 'playIds', ids, start: 0 }); else ctx.toast('This playlist is empty.'); } },
        { label: 'Rename…', run: async () => { const name = await askText(ctx, 'Rename the playlist', 'Its name', p.name, 'Rename'); if (name) ctx.call('music.playlist.rename', { id: p.id, name }).catch(fail(ctx)); } },
        '-', { label: 'Delete it (the music stays)', run: async () => { const ok = await ctx.dialog('Delete the playlist?', el('p', { text: `“${p.name}” goes; its tracks stay in the library.` }), [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true }]); if (ok) { await ctx.call('music.playlist.delete', { id: p.id }).catch(fail(ctx)); if (view.playlistId === p.id) setSection({}); } } }]);
    }

    // ---------------------------------------------------------- the list (only the rows on screen are drawn)
    function drawHead() {
      const col = (key, label, cls) => el('button', { class: 'h ' + cls + (view.sort === key ? ' on' : ''), role: 'columnheader', 'aria-sort': view.sort === key ? (view.desc ? 'descending' : 'ascending') : 'none',
        onclick: () => { if (view.sort === key) view.desc = !view.desc; else { view.sort = key; view.desc = false; } ctx.keep('sort', view.sort); ctx.keep('desc', view.desc); drawHead(); reload(); } },
      label, view.sort === key ? (view.desc ? ' ▾' : ' ▴') : '');
      head.replaceChildren(el('span', { class: 'h ic' }), col('title', 'Title', 't'), col('artist', 'Artist', 'a'), col('album', 'Album', 'al'), col('duration', 'Time', 'd'), el('span', { class: 'h tr', text: '' }));
      const sectionName = view.playlistId != null ? ((status && status.playlists.find((p) => p.id === view.playlistId)) || {}).name || 'Playlist'
        : view.missingOnly ? 'Missing files' : view.triage != null ? (TRIAGE[view.triage] || {}).label : 'All music';
      heading.replaceChildren(el('h1', { text: sectionName }), el('span', { class: 'nui-muted', text: `${total.toLocaleString()} track${total === 1 ? '' : 's'}` }));
    }
    async function reload() {
      const g = ++gen;
      rows = new Map(); pending = new Set(); sel = new Set(); anchor = -1; focus = -1;
      let r;
      try { r = await ctx.call('music.query', payload(0, 200)); } catch (e) { if (g === gen) { total = 0; drawRows(); } fail(ctx)(e); return; }
      if (g !== gen) return;
      total = r.total;
      r.rows.forEach((row, i) => rows.set(i, row));
      list.scrollTop = 0;
      drawHead(); drawRows(); drawEmpty();
    }
    function drawEmpty() {
      const noFolders = status && !status.folders.length;
      empty.hidden = total > 0;
      list.hidden = total === 0;
      head.hidden = total === 0;
      if (total > 0) return;
      empty.replaceChildren(noFolders
        ? el('div', { class: 'mu-welcome' }, el('div', { class: 'big', text: '♫' }), el('h2', { text: 'Your music, beside your work' }),
          el('p', { class: 'nui-muted', text: 'Add a folder with music in it. NoorMD makes a library of it (your files are only read), and the player keeps playing whichever bench you\'re in.' }),
          el('button', { class: 'nui-btn primary', onclick: () => addFolder(ctx) }, 'Add a music folder…'))
        : el('p', { class: 'nui-muted', text: view.search ? `Nothing found for “${view.search}”.` : view.playlistId != null ? 'This playlist is empty. Right-click tracks › Add to playlist, or drag them here.' : 'Nothing here.' }));
    }
    async function ensureRows(from, to) {
      const need = [];
      for (let i = from; i <= to; i++) if (!rows.has(i) && !pending.has(Math.floor(i / 200))) need.push(Math.floor(i / 200));
      for (const page of [...new Set(need)]) {
        pending.add(page);
        const g = gen;
        ctx.call('music.query', payload(page * 200, 200)).then((r) => { if (g !== gen) return; r.rows.forEach((row, k) => rows.set(page * 200 + k, row)); drawRows(); }).catch(() => {}).finally(() => pending.delete(page));
      }
    }
    function drawRows() {
      spacer.style.height = total * ROW + 'px';
      const top = list.scrollTop, h = list.clientHeight || 600;
      const from = Math.max(0, Math.floor(top / ROW) - 8), to = Math.min(total - 1, Math.ceil((top + h) / ROW) + 8);
      ensureRows(from, to);
      const out = [];
      for (let i = from; i <= to; i++) {
        const r = rows.get(i);
        const playing = r && r.id === nowId;
        out.push(el('div', { class: 'mu-row' + (sel.has(i) ? ' sel' : '') + (playing ? ' now' : '') + (r && r.missing ? ' missing' : '') + (i === focus ? ' focus' : ''), role: 'row', 'data-i': String(i), 'aria-selected': String(sel.has(i)),
          style: { top: i * ROW + 'px' }, draggable: r ? 'true' : 'false' },
          el('span', { class: 'ic', text: playing ? (heard.state && heard.state.playing ? '▶' : '❚❚') : '' }),
          el('span', { class: 't', text: r ? r.displayTitle : '…', title: r ? r.displayTitle : '' }),
          el('span', { class: 'a', text: r ? r.artist || '' : '' }),
          el('span', { class: 'al', text: r ? r.album || '' : '' }),
          el('span', { class: 'd', text: r ? fmtTime(r.duration) : '' }),
          el('span', { class: 'tr', text: r && r.triage ? TRIAGE[r.triage].icon : '', title: r && r.triage ? TRIAGE[r.triage].label : '' })));
      }
      spacer.replaceChildren(...out);
    }
    list.addEventListener('scroll', () => requestAnimationFrame(drawRows));
    new ResizeObserver(() => drawRows()).observe(list);
    const selectedIds = () => [...sel].sort((a, b) => a - b).map((i) => rows.get(i)).filter(Boolean).map((r) => r.id);
    async function playFrom(index) {
      const ids = await allIds();
      if (!ids.length) return;
      const startId = (rows.get(index) || {}).id;
      doIt(ctx, { op: 'playIds', ids, start: Math.max(0, startId != null ? ids.indexOf(startId) : index) });
    }
    function select(i, e = {}) {
      if (e.shiftKey && anchor >= 0) { sel = new Set(); for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) sel.add(k); }
      else if (e.ctrlKey) { if (sel.has(i)) sel.delete(i); else sel.add(i); anchor = i; }
      else { sel = new Set([i]); anchor = i; }
      focus = i;
      drawRows();
    }
    // A click redraws the rows, so a double-click is told from two clicks on the same row (the browser's own
    // dblclick would go to a row that's no longer there).
    let lastClick = { i: -1, t: 0 };
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.mu-row'); if (!row) return;
      const i = Number(row.dataset.i), now = Date.now();
      if (lastClick.i === i && now - lastClick.t < 450 && !e.shiftKey && !e.ctrlKey) { lastClick = { i: -1, t: 0 }; playFrom(i); return; }
      lastClick = { i, t: now };
      select(i, e); list.focus();
    });
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.mu-row'); if (!row) return;
      const i = Number(row.dataset.i);
      if (!sel.has(i)) select(i);
      e.dataTransfer.setData('text/x-noor-tracks', JSON.stringify(selectedIds()));
      e.dataTransfer.effectAllowed = 'copy';
    });
    list.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.mu-row'); if (!row) return;
      e.preventDefault();
      const i = Number(row.dataset.i);
      if (!sel.has(i)) select(i);
      trackMenu(e.clientX, e.clientY);
    });
    list.addEventListener('keydown', (e) => {
      if (!total) return;
      const pageRows = Math.max(1, Math.floor(list.clientHeight / ROW) - 1);
      const move = { ArrowDown: 1, ArrowUp: -1, PageDown: pageRows, PageUp: -pageRows, Home: -Infinity, End: Infinity }[e.key];
      if (move != null) {
        e.preventDefault();
        const i = Math.max(0, Math.min(total - 1, (focus < 0 ? 0 : focus) + (Number.isFinite(move) ? move : move > 0 ? total : -total)));
        select(i, e);
        if (i * ROW < list.scrollTop) list.scrollTop = i * ROW; else if ((i + 1) * ROW > list.scrollTop + list.clientHeight) list.scrollTop = (i + 1) * ROW - list.clientHeight;
      } else if (e.key === 'Enter' && focus >= 0) { e.preventDefault(); playFrom(focus); }
      else if (e.key === ' ' ) { e.preventDefault(); doIt(ctx, { op: 'toggle' }); }
      else if (/^[0-4]$/.test(e.key) && !e.ctrlKey && sel.size) { e.preventDefault(); setTriage(selectedIds(), Number(e.key)); }
      else if (e.key === 'a' && e.ctrlKey) { e.preventDefault(); sel = new Set([...Array(total).keys()]); drawRows(); }
    });
    async function setTriage(ids, value) {
      if (!ids.length) return;
      try {
        if (status) status.stats = await ctx.call('music.setTriage', { ids, value });
        ctx.toast(value ? `${TRIAGE[value].icon} ${TRIAGE[value].label}` : 'Mark taken off', { ms: 1100 });
      } catch (e) { fail(ctx)(e); }
    }
    async function trackMenu(x, y) {
      const ids = selectedIds();
      const n = ids.length;
      const lists = (status && status.playlists) || [];
      menu(x, y, [
        { header: n === 1 ? (rows.get([...sel][0]) || {}).displayTitle || 'Track' : `${n} tracks` },
        { label: 'Play', run: () => (n === 1 ? playFrom([...sel][0]) : doIt(ctx, { op: 'playIds', ids, start: 0 })) },
        { label: 'Play next', run: () => doIt(ctx, { op: 'playNext', ids }) },
        { label: 'Add to Up next', run: () => doIt(ctx, { op: 'enqueue', ids }) },
        '-',
        { header: 'Add to a playlist' },
        ...lists.slice(0, 12).map((p) => ({ label: `☰  ${p.name}`, run: () => ctx.call('music.playlist.add', { id: p.id, ids }).then(() => ctx.toast(`Added to “${p.name}”.`)).catch(fail(ctx)) })),
        { label: 'A new playlist…', run: () => newPlaylist(ctx, ids) },
        ...(view.playlistId != null ? [{ label: 'Take out of this playlist', run: async () => { const left = (await ctx.call('music.ids', { playlistId: view.playlistId, sort: 'playlist', offset: 0, limit: 2000 })).filter((id) => !ids.includes(id)); await ctx.call('music.playlist.setItems', { id: view.playlistId, ids: left }).catch(fail(ctx)); } }] : []),
        '-',
        ...TRIAGE.map((t) => ({ label: `${t.icon}  ${t.v ? t.label : 'Take the mark off'}`, keys: String(t.v), run: () => setTriage(ids, t.v) })),
        '-',
        { label: 'Show in Explorer', disabled: n !== 1, run: () => ctx.call('music.reveal', { id: ids[0] }).catch(fail(ctx)) },
      ], { anchor: list });
    }

    // ---------------------------------------------------------- keeping up
    async function refreshStatus() {
      try { status = await ctx.call('music.status'); } catch (e) { fail(ctx)(e); return; }
      drawSide(); drawEmpty();
      ctx.setStatus(`${status.stats.total.toLocaleString()} track${status.stats.total === 1 ? '' : 's'} in ${status.folders.length} folder${status.folders.length === 1 ? '' : 's'}${status.scanning ? ' · looking for music…' : ''}`);
    }
    let changeTimer = 0;
    const offs = [
      listen(ctx, (s) => { const was = nowId; nowId = s ? s.id : null; if (was !== nowId || true) drawRows(); }),
      ctx.on('changed', () => { clearTimeout(changeTimer); changeTimer = setTimeout(() => { refreshStatus(); reload(); }, 250); }),
      ctx.on('playlists', () => { refreshStatus(); if (view.playlistId != null) reload(); }),
      ctx.on('triage', (p) => { for (const [i, r] of rows) if (p.ids.includes(r.id)) rows.set(i, { ...r, triage: p.value }); drawRows(); refreshStatus(); doIt(ctx, { op: 'trackChanged', rows: p.ids.map((id) => ({ id, triage: p.value })) }); }),
      ctx.on('scan', (sp) => {
        scanLine = sp.phase === 'error' ? `Couldn't finish: ${sp.message || 'error'}` : sp.phase === 'done' ? '' : `Looking for music… ${sp.processed.toLocaleString()} / ${sp.discovered.toLocaleString()}`;
        drawSide();
        if (sp.phase === 'done' || sp.phase === 'error') { refreshStatus(); reload(); }
      }),
    ];
    drawHead();
    refreshStatus().then(reload);
    return {
      focus: () => list.focus(),
      commands: {
        'music.addFolderUi': () => addFolder(ctx),
        'music.foldersUi': () => foldersDialog(ctx),
        'music.rescanUi': () => ctx.call('music.rescan', {}).then(() => ctx.toast('Looking for new music…')).catch(fail(ctx)),
        'music.newPlaylist': () => newPlaylist(ctx),
        'music.focusSearch': () => { search.focus(); search.select(); },
        'music.toggle': async () => doIt(ctx, { op: 'toggle', ids: heard.state && heard.state.id != null ? null : await allIds(), start: focus >= 0 ? focus : 0 }),
        'music.next': () => doIt(ctx, { op: 'next' }),
        'music.prev': () => doIt(ctx, { op: 'prev' }),
        'music.random': async () => doIt(ctx, { op: 'random', ids: await allIds() }),
        'music.shuffle': () => doIt(ctx, { op: 'shuffle' }),
        'music.repeat': () => doIt(ctx, { op: 'repeat' }),
        'music.favCurrent': () => { const id = heard.state && heard.state.id; if (id == null) ctx.toast('Nothing is playing.'); else setTriage([id], 1); },
        'music.reveal.playing': async () => {
          const id = heard.state && heard.state.id;
          if (id == null) { ctx.toast('Nothing is playing.'); return; }
          const ids = await allIds();
          const i = ids.indexOf(id);
          if (i < 0) { ctx.toast('The playing track isn\'t in this list (search, section or playlist).'); return; }
          list.scrollTop = Math.max(0, i * ROW - list.clientHeight / 2);
          select(i);
        },
      },
      checked: (cmd) => (cmd === 'music.shuffle' ? !!(heard.state && heard.state.shuffle) : undefined),
      unmount() { offs.forEach((f) => f()); clearTimeout(changeTimer); clearTimeout(searchTimer); },
      _state: () => ({ total, view: { ...view }, selected: [...sel], status, rows: [...rows.values()].slice(0, 50) }),
    };
  },

  panels: {
    // ------------------------------------------------------------ Music: the player and the library in one panel (as in
    // NoorMD 2.0), to keep beside your writing: what's playing on top, then Library / Up next / Playlists / Sound.
    player: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        let tab = ctx.restore('panel.tab', 'library'), last = null;
        // ---------------------------------------------------- the player card
        const cover = artBox('mu-np-art');
        const title = el('div', { class: 'mu-np-title', title: 'Show it in the list', onclick: () => revealPlaying() });
        const sub = el('div', { class: 'mu-np-sub' }), file = el('div', { class: 'mu-np-file' });
        const seek = seekRow(ctx, 'mu-np-seek');
        const tp = (label, t, op, cls = '') => el('button', { class: 'mu-tp ' + cls, title: t, 'aria-label': t, onclick: () => doIt(ctx, { op }) }, label);
        const shuffle = tp(ICON.shuffle, 'Shuffle', 'shuffle', 'toggle'), play = tp(ICON.play, 'Play / pause', 'toggle', 'play'), repeat = tp(ICON.repeat, 'Repeat', 'repeat', 'toggle');
        const vol = el('input', { type: 'range', class: 'mu-vol', min: '0', max: '100', value: '80', 'aria-label': 'Volume', oninput: (e) => doIt(ctx, { op: 'volume', v: Number(e.target.value) / 100 }) });
        const marks = el('div', { class: 'mu-np-marks', role: 'group', 'aria-label': 'Mark the playing track' },
          ...TRIAGE.filter((t) => t.v).map((t) => el('button', { class: 'mu-chip', 'data-v': String(t.v), title: t.label, onclick: () => { const tr = last && last.track; if (tr) ctx.call('music.setTriage', { ids: [tr.id], value: tr.triage === t.v ? 0 : t.v }).catch(fail(ctx)); } }, `${t.icon} ${t.short}`)));
        const card = el('section', { class: 'mu-card', 'aria-label': 'Now playing' },
          el('div', { class: 'mu-np-top' }, cover.node, el('div', { class: 'mu-np-text' }, title, sub, file)),
          seek.node,
          el('div', { class: 'mu-np-controls' }, shuffle,
            el('button', { class: 'mu-tp', title: 'A random track', 'aria-label': 'A random track', onclick: async () => doIt(ctx, { op: 'random', ids: await ids() }) }, ICON.random),
            tp(ICON.prev, 'Previous', 'prev'), play, tp(ICON.next, 'Next', 'next'), repeat, vol),
          marks);
        // ---------------------------------------------------- the tabs
        const tabs = el('div', { class: 'mu-tabs', role: 'tablist' }, ...[['library', 'Library'], ['queue', 'Up next'], ['playlists', 'Playlists'], ['sound', 'Sound']].map(([k, l]) =>
          el('button', { class: 'mu-tab', role: 'tab', 'data-tab': k, onclick: () => setTab(k) }, l)));
        const body = el('div', { class: 'mu-tabbody' });
        root.replaceChildren(el('div', { class: 'mu-panel' }, card, tabs, body));
        function setTab(k) { tab = k; ctx.keep('panel.tab', k); drawTab(); }

        // ---------------------------------------------------- Library: search, sort, marks, a two-line list
        const lib = { search: '', sort: ctx.restore('panel.sort', 'title'), desc: !!ctx.restore('panel.desc', false), triage: null, playlistId: null, playlistName: '', total: 0, rows: new Map(), pending: new Set(), gen: 0, sel: -1 };
        const ROW = 50;
        const q = (offset, limit) => ({ search: lib.search, sort: lib.playlistId != null && lib.sort === 'title' ? 'playlist' : lib.sort, desc: lib.desc, triage: lib.triage, playlistId: lib.playlistId, offset, limit });
        const ids = () => ctx.call('music.ids', q(0, 2000)).catch(() => []);
        let stats = null, playlists = [];
        const searchIn = el('input', { class: 'nui-field mu-p-search', type: 'search', placeholder: 'Search title, artist, album…', 'aria-label': 'Search the library', oninput: () => { clearTimeout(st); st = setTimeout(() => { lib.search = searchIn.value; reload(); }, 180); } });
        let st = 0;
        const sortSel = el('select', { class: 'nui-field mu-p-sort', 'aria-label': 'Sort by', onchange: (e) => { lib.sort = e.target.value; ctx.keep('panel.sort', lib.sort); reload(); } },
          ...SORTS.map(([k, l]) => el('option', { value: k, selected: lib.sort === k || undefined }, l)));
        const dirBtn = el('button', { class: 'nui-icon', title: 'The other way round', 'aria-label': 'Reverse the order', onclick: () => { lib.desc = !lib.desc; ctx.keep('panel.desc', lib.desc); reload(); } }, '⇅');
        const chips = el('div', { class: 'mu-chips' });
        const spacer = el('div', { class: 'mu-p-spacer' });
        const list = el('div', { class: 'mu-p-list', role: 'listbox', tabindex: '0', 'aria-label': 'Tracks' }, spacer);
        const libBox = el('div', { class: 'mu-p-lib' }, el('div', { class: 'mu-p-bar' }, searchIn, sortSel, dirBtn), chips, list,
          el('div', { class: 'mu-p-foot' }, el('button', { class: 'nui-btn small', onclick: () => foldersDialog(ctx) }, '📁 Folders')));
        function drawChips() {
          const s = stats || {};
          const chip = (label, n, on, run) => el('button', { class: 'mu-chip' + (on ? ' on' : ''), onclick: run }, label, n != null ? el('small', { text: ' ' + n }) : '');
          chips.replaceChildren(
            ...(lib.playlistId != null ? [el('button', { class: 'mu-chip on', title: 'Back to the whole library', onclick: () => { lib.playlistId = null; reload(); } }, `☰ ${lib.playlistName} ✕`)] : []),
            chip('All', s.total, lib.triage == null, () => { lib.triage = null; reload(); }),
            ...TRIAGE.filter((t) => t.v).map((t) => chip(`${t.icon} ${t.short}`, s[['', 'favorite', 'keep', 'maybe', 'skip'][t.v]], lib.triage === t.v, () => { lib.triage = t.v; reload(); })),
            chip('○ —', s.untriaged, lib.triage === 0, () => { lib.triage = 0; reload(); }));
        }
        async function reload() {
          const g = ++lib.gen;
          lib.rows = new Map(); lib.pending = new Set(); lib.sel = -1;
          let r;
          try { r = await ctx.call('music.query', q(0, 200)); } catch { r = { total: 0, rows: [] }; }
          if (g !== lib.gen) return;
          lib.total = r.total; r.rows.forEach((row, i) => lib.rows.set(i, row));
          list.scrollTop = 0; drawChips(); drawRows();
        }
        function drawRows() {
          if (tab !== 'library') return;
          spacer.style.height = lib.total * ROW + 'px';
          if (!lib.total) { spacer.replaceChildren(el('div', { class: 'mu-none', text: stats && !stats.total ? 'No music yet. Add a folder (📁 Folders).' : 'Nothing here.' })); return; }
          const top = list.scrollTop, h = list.clientHeight || 400;
          const from = Math.max(0, Math.floor(top / ROW) - 6), to = Math.min(lib.total - 1, Math.ceil((top + h) / ROW) + 6);
          for (let p = Math.floor(from / 200); p <= Math.floor(to / 200); p++) if (!lib.rows.has(p * 200) && !lib.pending.has(p)) {
            lib.pending.add(p); const g = lib.gen;
            ctx.call('music.query', q(p * 200, 200)).then((r) => { if (g === lib.gen) { r.rows.forEach((row, k) => lib.rows.set(p * 200 + k, row)); drawRows(); } }).catch(() => {}).finally(() => lib.pending.delete(p));
          }
          const nowId = last && last.id;
          const out = [];
          for (let i = from; i <= to; i++) {
            const r = lib.rows.get(i);
            out.push(el('div', { class: 'mu-p-row' + (r && r.id === nowId ? ' now' : '') + (i === lib.sel ? ' sel' : ''), role: 'option', 'data-i': String(i), style: { top: i * ROW + 'px' }, draggable: r ? 'true' : 'false' },
              el('span', { class: 'st', text: r && r.id === nowId ? (last.playing ? '▶' : '❚❚') : '' }),
              el('span', { class: 't', text: r ? r.displayTitle : '…' }),
              el('span', { class: 'd', text: r ? fmtTime(r.duration) : '' }),
              el('span', { class: 's', text: r ? [r.artist, r.fileName].filter(Boolean).join(' · ') : '' }),
              el('span', { class: 'm', text: r && r.triage ? TRIAGE[r.triage].icon : '' })));
          }
          spacer.replaceChildren(...out);
        }
        list.addEventListener('scroll', () => requestAnimationFrame(drawRows));
        new ResizeObserver(() => drawRows()).observe(list);
        async function playFrom(i) {
          const all = await ids(); if (!all.length) return;
          const id = (lib.rows.get(i) || {}).id;
          doIt(ctx, { op: 'playIds', ids: all, start: Math.max(0, id != null ? all.indexOf(id) : i) });
        }
        let lastClick = { i: -1, t: 0 };
        list.addEventListener('click', (e) => {
          const row = e.target.closest('.mu-p-row'); if (!row) return;
          const i = Number(row.dataset.i), now = Date.now();
          if (lastClick.i === i && now - lastClick.t < 450) { lastClick = { i: -1, t: 0 }; playFrom(i); return; }
          lastClick = { i, t: now }; lib.sel = i; drawRows(); list.focus();
        });
        list.addEventListener('keydown', (e) => {
          if (!lib.total) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); lib.sel = Math.max(0, Math.min(lib.total - 1, lib.sel + (e.key === 'ArrowDown' ? 1 : -1))); if (lib.sel * ROW < list.scrollTop) list.scrollTop = lib.sel * ROW; else if ((lib.sel + 1) * ROW > list.scrollTop + list.clientHeight) list.scrollTop = (lib.sel + 1) * ROW - list.clientHeight; drawRows(); }
          else if (e.key === 'Enter' && lib.sel >= 0) { e.preventDefault(); playFrom(lib.sel); }
          else if (/^[0-4]$/.test(e.key) && lib.sel >= 0 && lib.rows.get(lib.sel)) { e.preventDefault(); ctx.call('music.setTriage', { ids: [lib.rows.get(lib.sel).id], value: Number(e.key) }).catch(fail(ctx)); }
        });
        list.addEventListener('dragstart', (e) => { const row = e.target.closest('.mu-p-row'); const r = row && lib.rows.get(Number(row.dataset.i)); if (r) { e.dataTransfer.setData('text/x-noor-tracks', JSON.stringify([r.id])); e.dataTransfer.effectAllowed = 'copy'; } });
        list.addEventListener('contextmenu', (e) => {
          const row = e.target.closest('.mu-p-row'); const r = row && lib.rows.get(Number(row.dataset.i)); if (!r) return;
          e.preventDefault(); lib.sel = Number(row.dataset.i); drawRows();
          menu(e.clientX, e.clientY, [{ header: r.displayTitle },
            { label: 'Play', run: () => playFrom(lib.sel) }, { label: 'Play next', run: () => doIt(ctx, { op: 'playNext', ids: [r.id] }) }, { label: 'Add to Up next', run: () => doIt(ctx, { op: 'enqueue', ids: [r.id] }) },
            '-', { header: 'Add to a playlist' },
            ...playlists.slice(0, 12).map((p) => ({ label: `☰  ${p.name}`, run: () => ctx.call('music.playlist.add', { id: p.id, ids: [r.id] }).then(() => ctx.toast(`Added to “${p.name}”.`)).catch(fail(ctx)) })),
            { label: 'A new playlist…', run: () => newPlaylist(ctx, [r.id]) },
            '-', ...TRIAGE.map((t) => ({ label: `${t.icon}  ${t.v ? t.label : 'Take the mark off'}`, keys: String(t.v), run: () => ctx.call('music.setTriage', { ids: [r.id], value: t.v }).catch(fail(ctx)) })),
            '-', { label: 'Show in Explorer', run: () => ctx.call('music.reveal', { id: r.id }).catch(fail(ctx)) }], { anchor: list });
        });
        async function revealPlaying() {
          const id = last && last.id; if (id == null) return;
          setTab('library');
          const all = await ids(); const i = all.indexOf(id);
          if (i < 0) { ctx.toast('The playing track isn\'t in this list (search or mark).'); return; }
          list.scrollTop = Math.max(0, i * ROW - list.clientHeight / 2); lib.sel = i; drawRows();
        }

        // ---------------------------------------------------- Up next, Playlists, Sound
        const queueBox = el('div', { class: 'mu-p-queue' });
        function drawQueue() {
          const s = last;
          const items = s ? s.queue.items : [];
          if (!items.length) { queueBox.replaceChildren(el('div', { class: 'mu-none', text: 'Up next is empty. Double-click a track, or right-click › Add to Up next.' })); return; }
          queueBox.replaceChildren(
            el('div', { class: 'mu-p-qhead' }, el('span', { class: 'nui-muted', text: `${Math.max(0, s.queue.total - s.queue.pos - 1)} upcoming · ${s.shuffle ? 'shuffled' : 'in order'} · repeat ${s.repeat}` }),
              items.length > 1 ? el('button', { class: 'nui-btn small quiet', onclick: () => doIt(ctx, { op: 'clearUpcoming' }) }, 'Clear upcoming') : ''),
            ...items.map((it, k) => el('div', { class: 'mu-q' + (k === 0 ? ' now' : ''), ondblclick: () => k && doIt(ctx, { op: 'jump', pos: it.pos }) },
              el('span', { class: 'qp', text: k === 0 ? '▶' : String(k) }), el('span', { class: 't', text: it.title, title: it.artist || '' }), el('span', { class: 'd', text: fmtTime(it.duration) }),
              k ? el('span', { class: 'acts' },
                el('button', { class: 'nui-icon', title: 'Play now', 'aria-label': 'Play now', onclick: () => doIt(ctx, { op: 'jump', pos: it.pos }) }, '▶'),
                el('button', { class: 'nui-icon', title: 'Earlier', 'aria-label': 'Earlier', onclick: () => doIt(ctx, { op: 'move', pos: it.pos, delta: -1 }) }, '↑'),
                el('button', { class: 'nui-icon', title: 'Later', 'aria-label': 'Later', onclick: () => doIt(ctx, { op: 'move', pos: it.pos, delta: 1 }) }, '↓'),
                el('button', { class: 'nui-icon', title: 'Take it out', 'aria-label': 'Take it out', onclick: () => doIt(ctx, { op: 'remove', pos: it.pos }) }, '✕')) : el('span'))));
        }
        const plBox = el('div', { class: 'mu-p-pls' });
        function drawPlaylists() {
          plBox.replaceChildren(
            el('button', { class: 'nui-btn small', onclick: () => newPlaylist(ctx) }, '＋ New playlist'),
            ...(playlists.length ? playlists.map((p) => el('div', { class: 'mu-p-pl', 'data-playlist': String(p.id) },
              el('button', { class: 'n', title: 'Show its tracks', onclick: () => { lib.playlistId = p.id; lib.playlistName = p.name; setTab('library'); reload(); } }, `☰ ${p.name}`), el('span', { class: 'nui-muted', text: String(p.count) }),
              el('button', { class: 'nui-icon', title: 'Play it', 'aria-label': `Play ${p.name}`, onclick: async () => { const all = await ctx.call('music.ids', { playlistId: p.id, sort: 'playlist', offset: 0, limit: 2000 }).catch(() => []); if (all.length) doIt(ctx, { op: 'playIds', ids: all, start: 0 }); else ctx.toast('This playlist is empty.'); } }, '▶')))
              : [el('p', { class: 'mu-none', text: 'No playlists yet. Right-click a track › A new playlist.' })]));
        }
        const soundBox = el('div', { class: 'mu-sound' });
        const sound = soundPanel(ctx, soundBox);
        function drawTab() {
          tabs.querySelectorAll('.mu-tab').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); b.classList.toggle('on', b.dataset.tab === tab); });
          body.replaceChildren(tab === 'library' ? libBox : tab === 'queue' ? queueBox : tab === 'playlists' ? plBox : soundBox);
          if (tab === 'library') requestAnimationFrame(drawRows);
          if (tab === 'queue') drawQueue();
          if (tab === 'playlists') drawPlaylists();
          if (tab === 'sound' && last) sound.draw(last);
        }
        async function refresh() {
          const s = await ctx.call('music.status').catch(() => null);
          if (!s) return;
          stats = s.stats; playlists = s.playlists;
          drawChips(); if (tab === 'playlists') drawPlaylists();
        }
        // ---------------------------------------------------- keeping up
        let ct = 0;
        const offs = [
          listen(ctx, (s) => {
            const was = last && last.id;
            last = s;
            const tr = s && s.track;
            cover.set(tr);
            title.textContent = tr ? tr.displayTitle : 'Nothing playing';
            sub.textContent = tr ? [tr.artist, tr.album].filter(Boolean).join(' — ') : 'Double-click a track to play it';
            file.textContent = tr ? tr.fileName || '' : '';
            play.textContent = s && s.playing ? ICON.pause : ICON.play;
            shuffle.classList.toggle('on', !!(s && s.shuffle)); shuffle.setAttribute('aria-pressed', String(!!(s && s.shuffle)));
            repeat.classList.toggle('on', !!(s && s.repeat !== 'off')); repeat.textContent = s && s.repeat === 'one' ? ICON.repeatOne : ICON.repeat;
            repeat.title = s ? { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this track' }[s.repeat] : 'Repeat';
            if (document.activeElement !== vol) vol.value = String(Math.round((s ? s.volume : 0.8) * 100));
            marks.querySelectorAll('.mu-chip').forEach((c) => c.classList.toggle('on', !!tr && tr.triage === Number(c.dataset.v)));
            seek.time(s);
            if (tab === 'queue') drawQueue();
            if (tab === 'sound') sound.draw(s);
            if (tab === 'library' && (s ? s.id : null) !== was) drawRows(); else if (tab === 'library') drawRows();
          }, (t) => seek.time(t)),
          ctx.on('changed', () => { clearTimeout(ct); ct = setTimeout(() => { refresh(); reload(); }, 250); }),
          ctx.on('playlists', () => { refresh(); if (lib.playlistId != null) reload(); }),
          ctx.on('triage', (p) => { for (const [i, r] of lib.rows) if (p.ids.includes(r.id)) lib.rows.set(i, { ...r, triage: p.value }); drawRows(); refresh(); }),
        ];
        drawTab(); refresh(); reload();
        return { unmount() { offs.forEach((f) => f()); clearTimeout(ct); clearTimeout(st); sound.stop(); } };
      },
    },
  },
};

/** The Sound tab: equalizer, limiter, loudness evened out between tracks (and measured here when the tags don't say). */
function soundPanel(ctx, box) {
  let measuring = null, alive = true;
  const set = (patch) => doIt(ctx, { op: 'fx', patch });
  function draw(s) {
    if (!s || !alive) return;
    const fx = s.fx;
    const bands = NoorFx.BANDS.map((f, i) => el('label', { class: 'mu-band', title: `${f < 1000 ? f : f / 1000 + 'k'} Hz` },
      el('input', { type: 'range', min: '-12', max: '12', step: '0.5', value: String(fx.gains[i]), disabled: !fx.eqOn, 'aria-label': `${f} Hz`,
        onchange: (e) => { const gains = fx.gains.slice(); gains[i] = Number(e.target.value); set({ gains, preset: 'custom' }); } }),
      el('span', { text: f < 1000 ? String(f) : f / 1000 + 'k' })));
    const tg = s.trackGain || { db: 0, from: 'none' };
    box.replaceChildren(
      el('label', { class: 'mu-check' }, el('input', { type: 'checkbox', checked: fx.eqOn || undefined, onchange: (e) => set({ eqOn: e.target.checked }) }), 'Equalizer'),
      el('select', { class: 'nui-field', disabled: !fx.eqOn, 'aria-label': 'Preset', onchange: (e) => set({ preset: e.target.value }) },
        ...Object.entries(NoorFx.PRESETS).map(([k, p]) => el('option', { value: k, selected: fx.preset === k || undefined }, p.label)),
        fx.preset === 'custom' ? el('option', { value: 'custom', selected: true }, 'Your own') : ''),
      el('div', { class: 'mu-bands' }, ...bands),
      el('label', { class: 'mu-check' }, el('input', { type: 'checkbox', checked: fx.preventClipping || undefined, onchange: (e) => set({ preventClipping: e.target.checked }) }), 'Keep it from clipping (a limiter)'),
      el('hr'),
      el('label', { class: 'mu-check' }, el('input', { type: 'checkbox', checked: fx.normalize || undefined, onchange: (e) => set({ normalize: e.target.checked }) }), 'Even out the loudness between tracks'),
      el('select', { class: 'nui-field', disabled: !fx.normalize, 'aria-label': 'Target loudness', onchange: (e) => set({ target: Number(e.target.value) }) },
        ...NoorFx.TARGETS.map(([t, l]) => el('option', { value: String(t), selected: fx.target === t || undefined }, l))),
      el('p', { class: 'nui-muted mu-hint', text: !s.track ? 'Loudness comes from each track\'s ReplayGain tags, or NoorMD measures it (the files are never changed).'
        : tg.from === 'none' ? 'This track hasn\'t been measured yet.' : `This track: ${tg.db >= 0 ? '+' : ''}${tg.db.toFixed(1)} dB (${tg.from === 'measured' ? 'measured' : 'from its tags'}).` }),
      el('button', { class: 'nui-btn small', disabled: !!measuring, onclick: () => measureQueue(s) }, measuring ? `Measuring… ${measuring}` : 'Measure the queue\'s loudness'));
  }
  async function measureQueue(s) {
    const ids = (s.queue.items || []).map((it) => it.id);
    let todo = [];
    try { todo = await ctx.call('music.loudness.unmeasured', { ids }); } catch (e) { fail(ctx)(e); return; }
    if (!todo.length) { ctx.toast('Everything in Up next is measured already.'); return; }
    let done = 0;
    for (const id of todo) {
      measuring = `${done + 1} / ${todo.length}`; draw(heard.state || s);
      try {
        const m = await NoorFx.analyze(`/media/noor.music/track/${id}`);
        if (Number.isFinite(m.lufs)) { await ctx.call('music.loudness.set', { id, lufs: m.lufs, peak: m.peak }); doIt(ctx, { op: 'trackChanged', rows: [{ id, loudness: m.lufs, peak: m.peak }] }); }
      } catch (e) { console.warn(e); }
      done++;
    }
    measuring = null; draw(heard.state || s);
    ctx.toast(`Measured ${done} track${done === 1 ? '' : 's'}.`);
  }
  return { draw, stop() { alive = false; } };
}
