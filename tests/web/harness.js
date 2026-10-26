// Test harness: serves wwwroot the same way the desktop host does (/ -> index.html, /_noormd/* -> assets)
// and injects a scripted mock of the host bridge (window.__NOORMD_TEST_HOST__).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(__dirname, '..', '..', 'src', 'NoorMD', 'wwwroot');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Real audio fixtures for media tests: ids 1-4 are playable, other ids are "missing" (404).
const FIXTURES = path.resolve(__dirname, '..', 'NoorMD.Media.Tests', 'Fixtures');
const MEDIA = { 1: 'tone.mp3', 2: 'tone.ogg', 3: 'tone.flac', 4: 'tone.wav' };
const MEDIA_TYPES = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.wav': 'audio/wav' };
const MAX_CHUNK = 2 * 1024 * 1024; // same as NoorMD.Media.MediaResponse
const mediaLog = [];

function serveMedia(id, req, res) {
  const name = MEDIA[id];
  if (!name) { res.writeHead(404); res.end(); return; }
  const file = path.join(FIXTURES, name);
  const data = fs.readFileSync(file);
  const type = MEDIA_TYPES[path.extname(file)];
  const range = req.headers.range;
  mediaLog.push({ id, range: range || null });
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) { res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': data.length }); res.end(data); return; }
  let start = m[1] === '' ? Math.max(0, data.length - Number(m[2])) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? data.length - 1 : Math.min(Number(m[2]), data.length - 1);
  if (start >= data.length || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); res.end(); return; }
  end = Math.min(end, start + MAX_CHUNK - 1);
  res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${data.length}` });
  res.end(data.subarray(start, end + 1));
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const media = /^\/_media\/(\d+)$/.exec(url.pathname);
    if (media) { serveMedia(Number(media[1]), req, res); return; }
    if (url.pathname.startsWith('/_art/')) { res.writeHead(404); res.end(); return; }
    let rel = url.pathname === '/' ? 'index.html' : url.pathname.startsWith('/_noormd/') ? url.pathname.slice('/_noormd/'.length) : null;
    if (!rel) { res.writeHead(404); res.end(); return; }
    const file = path.join(WWW, decodeURIComponent(rel));
    if (!file.startsWith(WWW) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

// Runs inside the page before any app script. Mirrors the C# BridgeHost semantics closely enough
// to exercise the UI: requests get replies, the host pulls state with NoorMD.getState().
function mockHostScript(initial) {
  const listeners = [];
  const log = [];
  const files = initial.files || {};
  const state = { prefs: initial.prefs || {}, recent: initial.recent || [], snapshots: {}, recovery: initial.recovery || [], printed: 0,
    tabs: new Map(), active: null, tabsState: null, prompts: [], closeChoices: initial.closeChoices || [], saveAsPaths: initial.saveAsPaths || [] };
  let seq = 0;
  const newId = () => (0xabc0000000000000 + (++seq)).toString(16).slice(0, 12) + String(seq).padStart(4, '0');
  const emit = (data) => setTimeout(() => listeners.forEach((fn) => fn({ data })), 0);
  const reply = (id, ok, result, error) => id != null && emit({ v: 2, replyTo: id, ok, result, error });
  const event = (name, payload) => emit({ v: 2, event: name, payload });
  const nameOf = (p) => p.split(/[\\/]/).pop();
  const payloadFor = (id, p) => ({ tabId: id, markdown: files[p], path: p, fileName: nameOf(p), title: nameOf(p).replace(/\.(md|markdown|txt)$/i, '') });
  const addTab = (path) => { const id = newId(); state.tabs.set(id, { path: path || null }); return id; };
  const flush = (id) => window.NoorMD.flush(id);
  const blankActive = () => {
    const tab = state.tabs.get(state.active);
    if (!tab || tab.path) return null;
    const s = flush(state.active);
    return s && !s.dirty && !s.markdown.trim() ? state.active : null;
  };
  const save = (id, as) => {
    const tab = state.tabs.get(id);
    const s = flush(id);
    const target = (as || !tab.path) ? (state.saveAsPaths.shift() || initial.saveAsPath || 'C:\\docs\\saved.md') : tab.path;
    files[target] = s.markdown; tab.path = target;
    (state.saved = state.saved || []).push({ tabId: id, path: target });
    event('doc.saved', { tabId: id, gen: s.gen, path: target, fileName: nameOf(target), title: nameOf(target).replace(/\.md$/, '') });
    return target;
  };
  const docs = initial.tabs || (initial.document ? [initial.document] : []);
  window.__NOORMD_TEST_HOST__ = {
    addEventListener: (_t, fn) => listeners.push(fn),
    postMessage(m) {
      log.push(m);
      const p = m.payload || {};
      switch (m.type) {
        case 'app.ready': {
          const tabs = docs.map((d) => { const id = d.tabId || addTab(d.path); if (d.tabId) state.tabs.set(id, { path: d.path || null }); return { ...d, tabId: id }; });
          const welcome = !tabs.length;
          if (welcome) tabs.push({ tabId: addTab(null), markdown: '', title: 'Untitled document' });
          state.active = initial.activeTabId || tabs[0].tabId;
          return reply(m.id, true, { prefs: state.prefs, recent: state.recent, tabs, activeTabId: state.active, welcome, recovery: state.recovery });
        }
        case 'tabs.state': state.tabsState = p; if (p.active) state.active = p.active; return reply(m.id, true, null);
        case 'doc.save': case 'doc.saveAs': {
          const target = save(p.tabId, m.type === 'doc.saveAs');
          return reply(m.id, true, { saved: true, fileName: nameOf(target) });
        }
        case 'doc.saveAll': {
          let n = 0;
          for (const id of state.tabs.keys()) if (flush(id).dirty) { save(id, false); n++; }
          return reply(m.id, true, { saved: n });
        }
        case 'doc.open': case 'doc.openRecent': {
          const path = p.path || (initial.openPaths && initial.openPaths.shift()) || initial.openPath;
          const existing = [...state.tabs].find(([, v]) => v.path && v.path.toLowerCase() === path.toLowerCase());
          if (existing) { event('tab.select', { tabId: existing[0] }); return reply(m.id, true, { opened: true, existing: true }); }
          const id = blankActive() || addTab(path);
          state.tabs.get(id).path = path;
          event('doc.load', payloadFor(id, path));
          return reply(m.id, true, { opened: true, tabId: id });
        }
        case 'doc.new': {
          const id = (p.reuseBlank && blankActive()) || addTab(null);
          state.tabs.get(id).path = null;
          event('doc.load', { tabId: id, markdown: p.markdown || '', title: p.title || 'Untitled document' });
          return reply(m.id, true, { opened: true, tabId: id });
        }
        case 'tab.close': {
          const s = flush(p.tabId);
          if (s && s.dirty) {
            const choice = state.closeChoices.shift() || 'discard';
            state.prompts.push({ tabId: p.tabId, title: s.title, choice });
            event('tab.select', { tabId: p.tabId });
            if (choice === 'cancel') return reply(m.id, true, { closed: false });
            if (choice === 'save') save(p.tabId, false);
          }
          state.tabs.delete(p.tabId);
          if (!state.tabs.size) { const id = addTab(null); event('doc.load', { tabId: id, markdown: '', title: 'Untitled document' }); }
          return reply(m.id, true, { closed: true });
        }
        case 'doc.copyPath': state.clipboard = state.tabs.get(p.tabId).path; return reply(m.id, true, null);
        case 'snapshots.create': { const s = flush(p.tabId); const list = state.snapshots[p.tabId] = state.snapshots[p.tabId] || []; list.unshift({ id: 's' + list.length, label: p.label, createdUtc: new Date().toISOString(), words: 1, markdown: s.markdown }); return reply(m.id, true, {}); }
        case 'snapshots.list': return reply(m.id, true, (state.snapshots[p.tabId] || []).map(({ markdown, ...x }) => x));
        case 'snapshots.get': return reply(m.id, true, (state.snapshots[p.tabId] || []).find((x) => x.id === p.id));
        case 'snapshots.delete': state.snapshots[p.tabId] = (state.snapshots[p.tabId] || []).filter((x) => x.id !== p.id); return reply(m.id, true, {});
        case 'print': state.printed++; return reply(m.id, true, {});
        case 'export.html': state.exportedHtml = p.bodyHtml; return reply(m.id, true, { path: 'C:\\out.html' });
        case 'export.pdf': return reply(m.id, true, { path: 'C:\\out.pdf' });
        case 'link.open': state.lastLink = p.href; return reply(m.id, true, {});
        case 'clipboard.copyText': state.clipboard = p.text; return reply(m.id, true, {});
        case 'recovery.list': return reply(m.id, true, state.recovery);
        default:
          if (m.type.startsWith('music.')) return reply(m.id, true, musicMock(m.type, p));
          return reply(m.id, true, {});
      }
    },
  };
  // ---- mock music library: N tracks; ids 1-4 are real playable fixtures, the rest are "missing" files.
  function musicMock(type, p) {
    const lib = state.music;
    const row = (t) => ({ ...t, displayTitle: t.title || t.fileName.replace(/\.[^.]+$/, ''), triage: t.triage, missing: false, hasArt: false });
    const filtered = () => {
      let list = p.playlistId ? (lib.playlists.find((x) => x.id === p.playlistId)?.items || []).map((id) => lib.byId.get(id)) : lib.tracks;
      const terms = (p.search || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').split(/\s+/).filter(Boolean);
      if (terms.length) list = list.filter((t) => terms.every((w) => t.search.includes(w)));
      if (p.triage != null) list = list.filter((t) => t.triage === p.triage);
      if (p.sort && p.sort !== 'playlist') {
        const k = { title: (t) => (t.title || t.fileName).toLowerCase(), filename: (t) => t.fileName.toLowerCase(), duration: (t) => t.duration, triage: (t) => t.triage || 9 }[p.sort] || ((t) => (t.title || t.fileName).toLowerCase());
        list = [...list].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : a.id - b.id));
        if (p.desc) list.reverse();
      }
      return list;
    };
    const stats = () => ({ total: lib.tracks.length, missing: 0, favorite: lib.tracks.filter((t) => t.triage === 1).length, keep: lib.tracks.filter((t) => t.triage === 2).length, maybe: lib.tracks.filter((t) => t.triage === 3).length, skip: lib.tracks.filter((t) => t.triage === 4).length, untriaged: lib.tracks.filter((t) => !t.triage).length });
    switch (type) {
      case 'music.status': return { folders: lib.tracks.length ? [{ id: 1, path: 'C:\\Music\\Suno', recursive: true, trackCount: lib.tracks.length, lastScanUtc: null }] : [], stats: stats(), playlists: lib.playlists.map((x) => ({ id: x.id, name: x.name, count: x.items.length })), scanning: false, undo: lib.undo };
      case 'music.query': { const all = filtered(); return { total: all.length, offset: p.offset || 0, rows: all.slice(p.offset || 0, (p.offset || 0) + (p.limit || 200)).map(row) }; }
      case 'music.ids': return filtered().map((t) => t.id);
      case 'music.tracks': return (p.ids || []).map((id) => lib.byId.get(id)).filter(Boolean).map(row);
      case 'music.track': { const t = lib.byId.get(p.id); return { ...row(t), path: t.folder + '\\' + t.fileName, readOnly: false, tags: { title: t.title, artist: t.artist, album: null, albumArtist: null, genre: t.genre, year: null, trackNumber: null, comment: null } }; }
      case 'music.setTriage': (p.ids || []).forEach((id) => { lib.byId.get(id).triage = p.value; }); return stats();
      case 'music.edit.validate': return /[<>:"|?*]/.test(p.fileName) ? ['The name contains characters Windows doesn\'t allow in file names'] : lib.tracks.some((t) => t.fileName.toLowerCase() === (p.fileName + '.mp3').toLowerCase() && t.id !== p.id) ? ['A file with that name already exists'] : [];
      case 'music.edit.apply': {
        const t = lib.byId.get(p.id);
        lib.edits.push({ ...p });
        const old = { fileName: t.fileName, title: t.title };
        if (p.updateTags && p.tags) { if ('title' in p.tags) t.title = p.tags.title || null; if ('artist' in p.tags) t.artist = p.tags.artist || null; if ('genre' in p.tags) t.genre = p.tags.genre || null; }
        if (p.rename) t.fileName = p.fileName.replace(/\.mp3$/i, '') + t.fileName.slice(t.fileName.lastIndexOf('.'));
        t.search = (t.title + ' ' + t.fileName).toLowerCase();
        lib.undo = { id: lib.edits.length, oldName: old.fileName, newName: t.fileName, old, trackId: t.id };
        return { ok: true, tagsSaved: !!p.updateTags, renamed: !!p.rename, problems: [], track: musicMock('music.track', { id: t.id }), undo: { id: lib.undo.id, oldName: lib.undo.oldName, newName: lib.undo.newName } };
      }
      case 'music.undo': { const u = lib.undo; const t = lib.byId.get(u.trackId); t.fileName = u.old.fileName; t.title = u.old.title; lib.undo = null; return { ok: true, tagsSaved: true, renamed: true, problems: [], track: musicMock('music.track', { id: t.id }), undo: null }; }
      case 'music.suggestName': return [p.artist, p.title].filter(Boolean).join(' - ');
      case 'music.playlist.create': { const id = lib.playlists.length + 1; lib.playlists.push({ id, name: p.name, items: p.ids || [] }); return { id }; }
      case 'music.playlist.add': { const pl = lib.playlists.find((x) => x.id === p.id); pl.items.push(...p.ids); return lib.playlists.map((x) => ({ id: x.id, name: x.name, count: x.items.length })); }
      case 'music.session.get': return lib.session;
      case 'music.session.save': lib.session = p.json; lib.sessionSaves++; return null;
      default: return null;
    }
  }
  const N = initial.musicTracks ?? 0;
  const tracks = [];
  const names = { 1: 'Suno Track 0001.mp3', 2: 'Suno Track 0002.ogg', 3: 'Żółw nocą.flac', 4: 'loop.wav' };
  for (let i = 1; i <= N; i++) {
    const fileName = names[i] || `Suno Track ${String(i).padStart(5, '0')}.mp3`;
    const t = { id: i, fileName, folder: 'C:\\Music\\Suno\\' + Math.floor(i / 500), title: i === 3 ? 'Żółw nocą' : null, artist: i % 9 === 0 ? 'Noor' : null, genre: i % 5 === 0 ? 'Synthwave' : null, duration: i <= 4 ? 2 : 60 + (i % 240), triage: 0 };
    t.search = (fileName + ' ' + (t.title || '') + ' ' + (t.genre || '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
    tracks.push(t);
  }
  state.music = { tracks, byId: new Map(tracks.map((t) => [t.id, t])), playlists: [], edits: [], session: initial.musicSession || null, sessionSaves: 0, undo: null };
  window.__mock = { log, files, state };
}

module.exports = { serve, mockHostScript, WWW, mediaLog };
