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
const MEDIA_TYPES = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.webm': 'video/webm' };
const MAX_CHUNK = 2 * 1024 * 1024; // same as NoorMD.Media.MediaResponse
const mediaLog = [];

function serveMedia(id, req, res, video) {
  const name = video ? (id === 4 ? 'dual-audio.webm' : 'clip.webm') : MEDIA[id]; // video 4 has two audio tracks
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
    const vid = /^\/_video\/(\d+)$/.exec(url.pathname);
    if (vid) { serveMedia(Number(vid[1]), req, res, true); return; }
    if (/^\/_sub\/\d+\/0$/.test(url.pathname)) { res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' }); res.end('WEBVTT\n\n00:00:00.500 --> 00:00:05.000\nHello from the subtitles\n'); return; }
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
          if (initial.vault) setTimeout(() => openVault(initial.vault.root), 0);
          return reply(m.id, true, { prefs: state.prefs, recent: state.recent, tabs, activeTabId: state.active, welcome, recovery: state.recovery, vaults: { vault: null, recent: [] } });
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
          event('tab.closed', { tabId: p.tabId });
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
          if (m.type === 'vault.pack.create') { packCreate(m.id, p); return; }
          if (m.type.startsWith('vault.')) { try { return reply(m.id, true, vaultMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('music.')) return reply(m.id, true, musicMock(m.type, p));
          if (m.type.startsWith('mic.')) { try { return reply(m.id, true, micMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('stream.')) { try { return reply(m.id, true, streamMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('video.')) { try { return reply(m.id, true, videoMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          return reply(m.id, true, {});
      }
    },
  };
  // ---- mock Vault: an in-memory folder tree (files: { 'World/Rivers.md': '…' }, folders implied or listed in dirs).
  const V = { root: null, files: {}, dirs: new Set(), ops: [], deleted: [] };
  const vaultFull = (rel) => V.root + '\\' + rel.replace(/\//g, '\\');
  const vaultInfo = () => ({ vault: V.root ? { root: V.root, name: V.root.split('\\').pop(), attachments: 'attachments', excluded: [] } : null, recent: V.root ? [{ path: V.root, name: V.root.split('\\').pop() }] : [] });
  const allDirs = () => { const d = new Set(V.dirs); for (const f of Object.keys(V.files)) { const parts = f.split('/'); for (let i = 1; i < parts.length; i++) d.add(parts.slice(0, i).join('/')); } return d; };
  const treePayload = () => ({ root: V.root, indexed: true, entries: [...[...allDirs()].map((p) => ({ p, d: true, s: 0 })), ...Object.keys(V.files).map((p) => ({ p, d: false, s: V.files[p].length }))].sort((a, b) => a.p.localeCompare(b.p, undefined, { numeric: true, sensitivity: 'base' })) });
  const pushTree = () => event('vault.tree', treePayload());
  function openVault(root) {
    V.root = root;
    V.files = { ...(initial.vault.files || {}) };
    V.dirs = new Set(initial.vault.dirs || []);
    event('vault.changed', vaultInfo());
    setTimeout(() => { pushTree(); event('vault.indexed', { notes: Object.keys(V.files).length }); }, 10);
  }
  const fold = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase();
  const openRel = (rel) => {
    const full = vaultFull(rel);
    files[full] = V.files[rel];
    const existing = [...state.tabs].find(([, v]) => v.path === full);
    if (existing) { event('tab.select', { tabId: existing[0] }); return { opened: true, existing: true }; }
    const id = blankActive() || addTab(full);
    state.tabs.get(id).path = full;
    event('doc.load', payloadFor(id, full));
    return { opened: true, tabId: id };
  };
  const relOfTab = (tabId) => { const t = state.tabs.get(tabId); return t && t.path && t.path.startsWith(V.root + '\\') ? t.path.slice(V.root.length + 1).replace(/\\/g, '/') : null; };
  const linksIn = (text) => [...text.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)].map((m) => m[1].trim());
  function vaultMock(type, p) {
    V.ops.push({ type, p });
    switch (type) {
      case 'vault.open': openVault(initial.vault.root); return { opened: true };
      case 'vault.close': V.root = null; event('vault.changed', vaultInfo()); return null;
      case 'vault.tree': return treePayload();
      case 'vault.refresh': pushTree(); return null;
      case 'vault.openFile': if (!(p.path in V.files)) throw new Error('That file no longer exists.'); return openRel(p.path);
      case 'vault.search': {
        const terms = fold(p.query).split(/\s+/).filter(Boolean);
        const hits = [];
        for (const [rel, text] of Object.entries(V.files)) if (terms.every((t) => fold(rel).includes(t))) hits.push({ path: rel, name: rel.split('/').pop(), line: 0, snippet: rel, nameMatch: true });
        for (const [rel, text] of Object.entries(V.files)) text.split('\n').forEach((l, i) => { if (terms.some((t) => fold(l).includes(t)) && terms.every((t) => fold(text).includes(t))) hits.push({ path: rel, name: rel.split('/').pop(), line: i + 1, snippet: l.trim(), nameMatch: false }); });
        return { hits, indexed: Object.keys(V.files).length };
      }
      case 'vault.backlinks': {
        const rel = relOfTab(p.tabId);
        if (!rel) return { refs: [], inVault: false };
        const name = rel.split('/').pop().replace(/\.md$/, '');
        const refs = [];
        for (const [src, text] of Object.entries(V.files)) { if (src === rel) continue; text.split('\n').forEach((l, i) => { if (linksIn(l).some((x) => x === name || x + '.md' === rel) || l.includes('](' + rel + ')')) refs.push({ source: src, line: i + 1, snippet: l.trim() }); }); }
        return { refs, inVault: true, path: rel };
      }
      case 'vault.openWiki': {
        const hit = Object.keys(V.files).find((f) => f.split('/').pop().replace(/\.md$/, '') === p.target || f === p.target + '.md');
        if (hit) return openRel(hit);
        V.files[p.target + '.md'] = '# ' + p.target + '\n\n'; pushTree(); return openRel(p.target + '.md');
      }
      case 'vault.linkTo': return { link: p.path.split('/').map(encodeURIComponent).join('/'), title: p.path.split('/').pop().replace(/\.md$/, '') };
      case 'vault.newNote': {
        const name = (p.name || 'Untitled').replace(/\.md$/, '') + '.md';
        const rel = (p.folder ? p.folder + '/' : '') + name;
        if (rel in V.files) throw new Error('“' + name + '” already exists there.');
        V.files[rel] = ''; pushTree(); openRel(rel); return { path: rel };
      }
      case 'vault.newFolder': { const rel = (p.parent ? p.parent + '/' : '') + p.name; V.dirs.add(rel); pushTree(); return { path: rel }; }
      case 'vault.rename': {
        const parent = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/') + 1) : '';
        let name = p.name; if (/\.md$/.test(p.path) && !name.includes('.')) name += '.md';
        const to = parent + name;
        const moved = moveRel(p.path, to);
        pushTree(); return { path: to, moved };
      }
      case 'vault.move': { let n = 0; for (const x of p.paths) { moveRel(x, (p.folder ? p.folder + '/' : '') + x.split('/').pop()); n++; } pushTree(); return { moved: n }; }
      case 'vault.duplicate': { const to = p.path.replace(/(\.md)?$/, ' copy$1'); V.files[to] = V.files[p.path]; pushTree(); return { path: to }; }
      case 'vault.delete': { for (const x of p.paths) { for (const f of Object.keys(V.files)) if (f === x || f.startsWith(x + '/')) { delete V.files[f]; V.deleted.push(f); } V.dirs.delete(x); } pushTree(); return { deleted: p.paths.length }; }
      case 'vault.settings.get': return { attachments: 'attachments', excluded: [] };
      case 'vault.pack.plan': {
        const sel = p.paths && p.paths.length ? p.paths : [''];
        const rules = p.exclusions || ['.env', '*.pem', '.obsidian/'];
        const inSel = (f) => sel.some((x) => x === '' || f === x || f.startsWith(x + '/'));
        const ruleOf = (f) => rules.find((r) => (r.endsWith('/') ? f.split('/').slice(0, -1).includes(r.slice(0, -1)) : new RegExp('^' + r.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(f.split('/').pop())));
        const files = [], excluded = [], deps = [], unresolved = [];
        for (const f of Object.keys(V.files).sort()) {
          if (!inSel(f)) continue;
          const r = ruleOf(f);
          if (r) { excluded.push({ path: f, rule: r }); continue; }
          if (!p.attachments && !/\.md$/.test(f)) { excluded.push({ path: f, rule: 'not a note (attachments off)' }); continue; }
          files.push({ entry: f, size: V.files[f].length, dependency: false });
          for (const m of V.files[f].matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
            const base = f.includes('/') ? f.slice(0, f.lastIndexOf('/')).split('/') : [];
            for (const seg of m[1].split('/')) { if (seg === '..') base.pop(); else if (seg !== '.') base.push(seg); }
            const target = base.join('/');
            if (!(target in V.files)) unresolved.push({ from: f, target: m[1], problem: 'file not found' });
            else if (!inSel(target) && !deps.some((d) => d.path === target)) deps.push({ path: target, from: f, included: !!p.dependencies && !(p.skipDependencies || []).includes(target) });
          }
        }
        for (const d of deps) if (d.included) files.push({ entry: d.path, size: V.files[d.path].length, dependency: true });
        V.lastPlanRequest = p;
        return { defaults: ['.env', '*.pem', '.obsidian/'], files, fileCount: files.length, bytes: files.reduce((a, f) => a + f.size, 0), excluded, excludedCount: excluded.length, dependencies: deps, unresolved,
          generated: p.handoff ? ['_noormd_handoff/MANIFEST.md', '_noormd_handoff/README.md'] : p.manifest ? ['_noormd_package/MANIFEST.md'] : [], warnings: [],
          unsaved: [...state.tabs].filter(([id, t]) => t.path && t.path.startsWith(V.root) && window.NoorMD.flush(id).dirty).map(([id, t]) => ({ tabId: id, name: t.path.split('\\').pop() })), suggestedName: 'x.zip' };
      }
      case 'vault.pack.cancel': V.packCancelled = true; return null;
      case 'vault.pack.reveal': V.revealed = true; return null;
      default: return null;
    }
  }
  async function packCreate(id, p) {
    V.packRequest = p; V.packCancelled = false;
    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, V.packDelay || initial.packDelay || 60));
      if (V.packCancelled) return reply(id, true, { cancelled: true });
      event('vault.pack.progress', { done: i, total: 5, bytes: i * 1000 });
    }
    V.packed = true;
    return reply(id, true, { path: 'C:\\Vaults\\Atlas.zip', entries: 5, bytes: 5000, failures: [{ entry: 'World/locked.md', problem: 'locked by another program' }] });
  }
  function vaultMockUnused() {
    switch (0) {
      default: return null;
    }
  }
  function moveRel(from, to) {
    let n = 0;
    for (const f of Object.keys(V.files)) {
      if (f !== from && !f.startsWith(from + '/')) continue;
      const dest = to + f.slice(from.length);
      V.files[dest] = V.files[f]; delete V.files[f]; n++;
      for (const [id, t] of state.tabs) if (t.path === vaultFull(f)) { t.path = vaultFull(dest); files[t.path] = V.files[dest]; event('doc.renamed', { tabId: id, path: t.path, fileName: dest.split('/').pop(), title: dest.split('/').pop().replace(/\.md$/, '') }); }
    }
    for (const d of [...V.dirs]) if (d === from || d.startsWith(from + '/')) { V.dirs.delete(d); V.dirs.add(to + d.slice(from.length)); }
    return n;
  }
  state.vault = V;

  // ---- mock Stream Desk host (MainWindow.Stream.cs): config in memory, supporters/streams as objects.
  const ST = { running: false, port: 47321, clients: 0, np: null, cr: null, effects: [], templates: [], txt: { enabled: false, path: 'C:\\Users\\me\\now-playing.txt', format: '{artist} - {title}' },
    updates: [], starts: 0, stops: 0, supporters: initial.supporters || [], streams: [], session: null, saved: [], vault: initial.streamVault ? 'C:\\Vault' : null };
  state.stream = ST;
  function streamMock(type, p) {
    const today = '2026-10-26';
    switch (type) {
      case 'stream.status': return { server: { running: ST.running, port: ST.port, url: `http://127.0.0.1:${ST.port}/`, clients: ST.clients }, enabled: ST.running, nowPlaying: ST.np, credits: ST.cr, effects: ST.effects, templates: ST.templates, txt: ST.txt, vault: ST.vault, supportersNote: 'Stream/Supporters.md', streamsFolder: 'Streams', session: ST.session };
      case 'stream.server': ST.running = !!p.enabled; ST.port = p.port || ST.port; return ST.running ? { running: true, url: `http://127.0.0.1:${ST.port}/` } : { running: false };
      case 'stream.np.config': ST.np = p.config; return null;
      case 'stream.np.update': ST.updates.push(p.track); if (ST.session && p.track && p.track.playing && ST.session.last !== p.track.id) { ST.session.marks.push({ offset: ST.session.marks.length * 200, text: (p.track.artist ? p.track.artist + ' – ' : '') + p.track.title, stamp: '00:0' + ST.session.marks.length + ':00' }); ST.session.last = p.track.id; } return null;
      case 'stream.credits.config': ST.cr = p.config; ST.effects = p.effects || ST.effects; return null;
      case 'stream.credits.start': if (!ST.running) throw new Error('Turn on the OBS overlay server first.'); ST.starts++; return { clients: 1 };
      case 'stream.credits.stop': ST.stops++; return null;
      case 'stream.txt': ST.txt.enabled = !!p.enabled; if (p.format) ST.txt.format = p.format; return { path: ST.txt.path };
      case 'stream.supporters.get': if (!ST.vault) throw new Error('No Vault is open.'); return { path: 'Stream/Supporters.md', exists: true, supporters: ST.supporters.map((x) => ({ ...x, active: !x.until })) };
      case 'stream.supporters.save': ST.supporters = p.supporters.map((x) => ({ name: x.name, channel: x.channel || null, tier: x.tier || null, since: x.since || null, until: x.until || null })); return { path: 'Stream/Supporters.md', count: ST.supporters.length };
      case 'stream.supporters.import': {
        const found = String(p.text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/https?:\/\/\S+/); return { name: (m ? l.replace(m[0], '') : l).trim(), channel: m ? m[0] : null }; });
        if (!found.length) throw new Error('No names were found in the pasted text.');
        const merged = (p.current || ST.supporters).filter((x) => x.name).map((x) => ({ ...x }));
        const added = [], left = [];
        for (const f of found) if (!merged.some((x) => x.name.toLowerCase() === f.name.toLowerCase())) { merged.push({ ...f, tier: null, since: today, until: null }); added.push(f.name); }
        if (p.markMissingAsLeft) for (const x of merged) if (!x.until && !found.some((f) => f.name.toLowerCase() === x.name.toLowerCase())) { x.until = today; left.push(x.name); }
        return { found: found.length, added, updated: [], returned: [], left, merged: merged.map((x) => ({ ...x, active: !x.until })) };
      }
      case 'stream.log.list': return { folder: 'Streams', streams: ST.streams.map((e) => ({ title: e.title, date: e.date, number: e.number, path: e.path, keywords: [], tracks: (e.tracklist || []).length })), nextNumber: ST.streams.reduce((n, e) => Math.max(n, e.number || 0), 0) + 1 };
      case 'stream.log.get': return { ...ST.streams.find((e) => e.path === p.path) };
      case 'stream.log.save': {
        const e = { ...p.entry };
        e.path = p.path || `Streams/${e.date} #${e.number} ${e.title}.md`;
        ST.streams = ST.streams.filter((x) => x.path !== e.path).concat([e]);
        ST.saved.push(e);
        return { path: e.path };
      }
      case 'stream.log.thumbnail': return { thumbnail: '../attachments/thumb.png', thumbnailData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' };
      case 'stream.templates.save': ST.templates = p.templates; return null;
      case 'stream.session.start': ST.session = { start: new Date().toISOString(), marks: [], last: null }; return { start: ST.session.start };
      case 'stream.session.stop': { const marks = ST.session ? ST.session.marks : []; ST.session = null; return { marks, seconds: 600 }; }
      case 'stream.chapters': return (p.tracklist || []).map((m, i) => `${i === 0 ? '00:00' : String(Math.floor(m.offset / 60)).padStart(2, '0') + ':' + String(Math.floor(m.offset % 60)).padStart(2, '0')} ${m.text}`).join('\n');
      case 'stream.fill': return String(p.template).replace(/\{(\w+)(?::[^}]+)?\}/g, (all, k) => (k === 'date' ? p.date : p.values && k in p.values ? p.values[k] : all));
      default: return null;
    }
  }


  // ---- mock Mic Guard: the same rules as MicGuard.cs (sides that are off don't count; the hotkey mutes unless all muted).
  const MIC = { cfg: { windows: false, deviceId: null, obs: false, obsUrl: 'ws://127.0.0.1:4455', obsInput: null, hotkey: null, indicator: false, opacity: 0.92, scale: 1, hideFromCapture: true },
    win: false, obsMuted: false, connected: false, password: null, stored: false, calls: [] };
  state.mic = MIC;
  function micMock(type, p) {
    const side = (on, known, muted) => (!on ? 'off' : !known ? 'unknown' : muted ? 'muted' : 'live');
    const sides = () => ({ windows: side(MIC.cfg.windows, true, MIC.win), obs: side(MIC.cfg.obs, MIC.connected, MIC.obsMuted) });
    const verdict = () => {
      const v = Object.values(sides()).filter((x) => x !== 'off');
      if (!v.length) return 'notsetup';
      if (v.includes('unknown')) return v.includes('live') ? 'live' : 'unknown';
      return v.every((x) => x === 'live') ? 'live' : v.every((x) => x === 'muted') ? 'muted' : 'mismatch';
    };
    const label = (v) => ({ live: 'LIVE', muted: 'MUTED', mismatch: 'CHECK', unknown: '?' }[v] || 'OFF');
    const status = () => {
      const v = verdict(), s = sides();
      return { config: { ...MIC.cfg }, devices: [{ id: 'dev-a', name: 'Microphone (Blue Yeti)', isDefault: true }, { id: 'dev-b', name: 'Headset Microphone', isDefault: false }],
        windows: { state: s.windows, name: 'Microphone (Blue Yeti)', error: null },
        obs: { state: s.obs, connected: MIC.connected, connecting: false, version: MIC.connected ? '5.5.0' : null, error: MIC.cfg.obs && !MIC.connected ? 'Not connected.' : null, inputs: MIC.connected ? [{ name: 'Mic/Aux', kind: 'wasapi_input_capture' }, { name: 'Desktop Audio', kind: 'wasapi_output_capture' }] : [], hasPassword: MIC.stored },
        verdict: v, label: label(v), explain: v === 'mismatch' ? `Out of step: Windows mic ${s.windows}, OBS ${s.obs}. Press the hotkey to mute both.` : `state ${v}`,
        hotkey: { gesture: MIC.cfg.hotkey, error: null }, indicator: { shown: MIC.cfg.indicator, excludedFromCapture: MIC.cfg.indicator && MIC.cfg.hideFromCapture } };
    };
    const set = (muted) => { MIC.calls.push(muted); if (MIC.cfg.windows) MIC.win = muted; if (MIC.cfg.obs && MIC.connected) MIC.obsMuted = muted; };
    switch (type) {
      case 'mic.status': return status();
      case 'mic.config':
        if ('hotkey' in p && p.hotkey && !/^((Ctrl|Alt|Shift|Win)\+)+\w+$|^F\d+$/.test(p.hotkey)) throw new Error('Use Ctrl, Alt or Shift with that key.');
        for (const k of Object.keys(MIC.cfg)) if (k in p) MIC.cfg[k] = p[k] === '' ? null : p[k];
        if (MIC.cfg.obs && !MIC.connected && MIC.stored) { MIC.connected = true; MIC.cfg.obsInput = MIC.cfg.obsInput || 'Mic/Aux'; }
        return status();
      case 'mic.obs.connect':
        if (!(p.password === 'hunter2' || (!p.password && MIC.stored))) throw new Error(p.password ? 'OBS refused the password.' : 'OBS asks for a password.');
        if (p.password && p.remember) MIC.stored = true;
        MIC.connected = true; MIC.cfg.obsInput = MIC.cfg.obsInput || 'Mic/Aux';
        return status();
      case 'mic.obs.forget': MIC.stored = false; return status();
      case 'mic.set': set(!!p.muted); return status();
      case 'mic.toggle': set(verdict() !== 'muted'); return status();
      default: return null;
    }
  }

  // ---- mock video library: two series; every video is the same 6-second clip.webm fixture; video 1 has subtitles.
  const VID = { videos: [], notes: [], nextNote: 1, popouts: [], inserted: [], positions: [], playlists: [], nextPl: 1 };
  if (initial.videos) {
    const add = (id, title, series, ep) => VID.videos.push({ id, title, series, seriesKey: 'K:' + series, season: null, episode: ep, duration: 6, width: 160, height: 90, position: 0, watched: false, lastWatched: null, missing: false, notes: 0, fileName: title + '.webm', folder: 'C:\\Videos\\' + series });
    add(1, 'Episode 1', 'Devlog', 1); add(2, 'Episode 2', 'Devlog', 2); add(3, 'Episode 3', 'Devlog', 3); add(4, 'Intro to shaders', 'Tutorials', null);
  }
  state.video = VID;
  function videoMock(type, p) {
    const get = (id) => VID.videos.find((v) => v.id === id) || (() => { throw new Error('That video is no longer in the library.'); })();
    const notes = (id) => VID.notes.filter((n) => n.videoId === id).sort((a, b) => a.time - b.time).map((n) => ({ ...n, stamp: `${Math.floor(n.time / 60)}:${String(Math.floor(n.time % 60)).padStart(2, '0')}` }));
    const eps = (key) => VID.videos.filter((v) => v.seriesKey === key);
    const next = (id) => { const v = get(id); const list = eps(v.seriesKey); const i = list.indexOf(v); return list[i + 1] || null; };
    const row = (v) => ({ ...v, notes: VID.notes.filter((n) => n.videoId === v.id).length });
    const playlists = () => VID.playlists.map((x) => ({ id: x.id, name: x.name, count: x.ids.length, duration: x.ids.reduce((t, id) => t + get(id).duration, 0), watched: x.ids.filter((id) => get(id).watched).length }));
    switch (type) {
      case 'video.status': {
        const keys = [...new Set(VID.videos.map((v) => v.seriesKey))];
        return { folders: VID.videos.length ? [{ id: 1, path: 'C:\\Videos', count: VID.videos.length }] : [], scanning: false,
          series: keys.map((k) => ({ key: k, name: k.slice(2), folder: 'C:\\Videos\\' + k.slice(2), count: eps(k).length, watched: eps(k).filter((v) => v.watched).length, lastWatched: null, resumeId: (eps(k).find((v) => !v.watched) || eps(k)[0]).id })),
          resume: VID.videos.filter((v) => !v.watched && v.position > Math.min(5, v.duration * 0.1)).map(row), count: VID.videos.length, playlists: playlists() };
      }
      case 'video.query': {
        let list = VID.videos.slice();
        if (p.playlistId) list = (VID.playlists.find((x) => x.id === p.playlistId) || { ids: [] }).ids.map(get);
        if (p.series) list = list.filter((v) => v.seriesKey === p.series);
        if (p.search) list = list.filter((v) => (v.title + ' ' + v.series + ' ' + v.fileName).toLowerCase().includes(String(p.search).toLowerCase()));
        const inprog = (v) => !v.watched && v.position > Math.min(5, v.duration * 0.1);
        if (p.filter === 'watched') list = list.filter((v) => v.watched);
        if (p.filter === 'unwatched') list = list.filter((v) => !v.watched);
        if (p.filter === 'inprogress') list = list.filter(inprog);
        if (p.sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
        if (p.desc) list.reverse();
        return list.map(row);
      }
      case 'video.playlists': return playlists();
      case 'video.playlist.create': { const pl = { id: VID.nextPl++, name: String(p.name).trim(), ids: [...(p.ids || [])] }; VID.playlists.push(pl); return { id: pl.id, playlists: playlists() }; }
      case 'video.playlist.rename': VID.playlists.find((x) => x.id === p.id).name = p.name; return playlists();
      case 'video.playlist.delete': VID.playlists = VID.playlists.filter((x) => x.id !== p.id); return playlists();
      case 'video.playlist.setItems': VID.playlists.find((x) => x.id === p.id).ids = [...p.ids]; return playlists();
      case 'video.playlist.add': VID.playlists.find((x) => x.id === p.id).ids.push(...p.ids); return playlists();
      case 'video.episodes': return eps(p.key).map(row);
      case 'video.search': return VID.videos.filter((v) => (v.title + ' ' + v.series).toLowerCase().includes(String(p.text).toLowerCase())).map(row);
      case 'video.get': { const v = get(p.id); return { video: row(v), subtitles: v.id === 1 ? [{ index: 0, label: 'en (SRT)', lang: 'en' }] : [], notes: notes(v.id), next: next(v.id) && row(next(v.id)), exists: true }; }
      case 'video.position': { const v = get(p.id); VID.positions.push({ id: p.id, position: p.position }); const w = p.duration > 0 && p.position >= p.duration * 0.92; v.position = w ? 0 : p.position; v.watched = v.watched || w; v.lastWatched = new Date().toISOString(); return row(v); }
      case 'video.watched': (p.ids || []).forEach((id) => { const v = get(id); v.watched = !!p.value; v.position = 0; }); return null;
      case 'video.next': return next(p.id) && row(next(p.id));
      case 'video.note.add': if (!String(p.text || '').trim()) throw new Error('A note needs some text.'); VID.notes.push({ id: VID.nextNote++, videoId: p.id, time: p.time, text: p.text.trim() }); return { id: VID.nextNote - 1, notes: notes(p.id) };
      case 'video.note.update': { const n = VID.notes.find((x) => x.id === p.noteId); n.text = p.text.trim(); return notes(p.id); }
      case 'video.note.delete': VID.notes = VID.notes.filter((x) => x.id !== p.noteId); return notes(p.id);
      case 'video.note.insert': VID.inserted.push(p.id); return { document: 'x.md' };
      case 'video.popout': VID.popouts.push({ ...p }); return null;
      case 'video.session.save': VID.session = p.json; return null;
      case 'video.session.get': return VID.session || null;
      default: return null;
    }
  }

  // ---- mock music library: N tracks; ids 1-4 are real playable fixtures, the rest are "missing" files.
  function musicMock(type, p) {
    const lib = state.music;
    const row = (t) => ({ ...t, displayTitle: t.title || t.fileName.replace(/\.[^.]+$/, ''), triage: t.triage, missing: false, hasArt: false });
    const filtered = () => {
      let list = p.playlistId ? (lib.playlists.find((x) => x.id === p.playlistId)?.items || []).map((id) => lib.byId.get(id)) : lib.tracks;
      const sc = p.smartId ? (lib.smart || []).find((x) => x.id === p.smartId) : p.smartRules;
      if (sc) list = list.filter((t) => smartMatch(sc, t));
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
    // Minimal smart-rule evaluation (the real one is SQL in MusicLibrary; this covers what the UI tests use).
    function smartMatch(r, t) {
      const one = (x) => {
        const v = { triage: t.triage, genre: t.genre, plays: t.plays || 0, title: t.title || t.fileName, measured: t.loudness != null ? 1 : 0, hasArt: 0, lastPlayed: t.lastPlayed || null }[x.field];
        switch (x.op) {
          case 'is': return String(v ?? '') === String(x.value); case 'isNot': return String(v ?? '') !== String(x.value);
          case 'contains': return String(v ?? '').toLowerCase().includes(String(x.value || '').toLowerCase());
          case 'gt': return Number(v) > Number(x.value); case 'lt': return Number(v) < Number(x.value);
          case 'isTrue': return v === 1; case 'isFalse': return v === 0; case 'never': return v == null;
          default: return true;
        }
      };
      const hits = (r.rules || []).map(one);
      return r.matchAll === false ? hits.some(Boolean) : hits.every(Boolean);
    }
    const smartList = () => (lib.smart || []).map((x) => ({ ...x, count: lib.tracks.filter((t) => smartMatch(x, t)).length }));
    const stats = () => ({ total: lib.tracks.length, missing: 0, favorite: lib.tracks.filter((t) => t.triage === 1).length, keep: lib.tracks.filter((t) => t.triage === 2).length, maybe: lib.tracks.filter((t) => t.triage === 3).length, skip: lib.tracks.filter((t) => t.triage === 4).length, untriaged: lib.tracks.filter((t) => !t.triage).length });
    switch (type) {
      case 'music.status': return { folders: lib.tracks.length ? [{ id: 1, path: 'C:\\Music\\Suno', recursive: true, trackCount: lib.tracks.length, lastScanUtc: null }] : [], stats: stats(), playlists: lib.playlists.map((x) => ({ id: x.id, name: x.name, count: x.items.length })), smart: smartList(), scanning: false, undo: lib.undo };
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
      case 'music.playlist.setItems': { const pl = lib.playlists.find((x) => x.id === p.id); pl.items = [...p.ids]; return null; }
      case 'music.reveal': lib.revealed = p.id; return null;
      case 'music.batch.preview': case 'music.batch.apply': {
        const sp = p.spec || {}, R = sp.rename || {}, T = sp.tags || {};
        for (const m of (R.enabled ? R.template || '' : '').matchAll(/\{(\w+)(?::0+)?\}/g)) if (!['OriginalName', 'Title', 'Artist', 'n', 'TrackNumber', 'Genre', 'Album', 'AlbumArtist', 'Year', 'Comment', 'Folder'].includes(m[1])) throw new Error(`Unknown placeholder {${m[1]}} in the name template.`);
        const items = (p.ids || []).map((id, i) => {
          const t = lib.byId.get(id);
          const ext = t.fileName.slice(t.fileName.lastIndexOf('.'));
          const orig = t.fileName.slice(0, -ext.length);
          const n = String((R.counterStart ?? 1) + i * (R.counterStep ?? 1)).padStart(R.counterDigits ?? 2, '0');
          const vals = { title: t.title, artist: t.artist, genre: t.genre };
          const tags = [];
          for (const [f, rule] of Object.entries(T)) {
            const next = rule.mode === 'clear' ? null : (rule.value || '').replace('{n}', n).replace('{OriginalName}', orig) || null;
            if ((vals[f] ?? null) !== next) tags.push({ field: f, old: vals[f] ?? null, new: next });
            vals[f] = next;
          }
          let name = orig;
          const warnings = [], problems = [];
          if (R.enabled) {
            name = (R.template || '').replace(/\{(\w+)(?::0+)?\}/g, (_, k) => { const v = k === 'OriginalName' ? orig : k === 'n' ? n : vals[k.toLowerCase()]; if (!v) warnings.push(`{${k}} is empty for this track.`); return v || ''; });
            if (R.find) name = name.split(R.find).join(R.replace || '');
            name = (R.prefix || '') + name.replace(/\s+/g, ' ').trim().replace(/^- /, '') + (R.suffix || '');
            if (R.case === 'upper') name = name.toUpperCase(); else if (R.case === 'lower') name = name.toLowerCase();
            if (/[<>:"/\\|?*]/.test(name)) problems.push('The name contains characters Windows doesn\'t allow.');
          }
          return { id, folder: t.folder, oldName: t.fileName, newName: name + ext, renames: name + ext !== t.fileName, ok: true, tags, problems, warnings };
        });
        const count = new Map();
        items.forEach((x) => count.set(x.newName.toLowerCase(), (count.get(x.newName.toLowerCase()) || 0) + 1));
        items.forEach((x) => { if (count.get(x.newName.toLowerCase()) > 1) x.problems.push(`${count.get(x.newName.toLowerCase())} files in this batch would be named "${x.newName}".`); x.ok = !x.problems.length; });
        const willChange = items.filter((x) => x.ok && (x.renames || x.tags.length)).length;
        if (type === 'music.batch.preview') return { willChange, unchanged: items.filter((x) => x.ok && !x.renames && !x.tags.length).length, blocked: items.filter((x) => !x.ok).length, items };
        lib.batches = lib.batches || [];
        const batchId = lib.batches.length + 1;
        const before = items.filter((x) => x.ok).map((x) => { const t = lib.byId.get(x.id); return { id: x.id, fileName: t.fileName, title: t.title, artist: t.artist, genre: t.genre }; });
        lib.batches.push(before);
        for (const x of items.filter((y) => y.ok)) { const t = lib.byId.get(x.id); t.fileName = x.newName; for (const c of x.tags) t[c.field] = c.new; t.search = (t.fileName + ' ' + (t.title || '')).toLowerCase(); }
        lib.undo = { batchId, count: willChange };
        lib.batchApplied = (lib.batchApplied || 0) + 1;
        return { batchId: willChange ? batchId : null, done: willChange, failed: 0, skipped: items.filter((x) => !x.ok).length, items: items.map((x) => ({ id: x.id, oldName: x.oldName, newName: x.ok ? x.newName : x.oldName, status: !x.ok ? 'skipped' : x.renames || x.tags.length ? 'done' : 'unchanged', message: x.problems.join(' ') || null })), undo: lib.undo };
      }
      case 'music.batch.undo': {
        for (const b of lib.batches[p.batchId - 1]) Object.assign(lib.byId.get(b.id), b);
        lib.undo = null;
        return { batchId: p.batchId, done: lib.batches[p.batchId - 1].length, failed: 0, skipped: 0, items: [], undo: null };
      }
      case 'music.loudness.set': { const t = lib.byId.get(p.id); t.loudness = p.lufs; t.peak = p.peak; lib.measured = (lib.measured || 0) + 1; return null; }
      case 'music.loudness.unmeasured': return (p.ids || lib.tracks.map((t) => t.id)).filter((id) => lib.byId.get(id) && lib.byId.get(id).loudness == null);
      case 'music.smart.count': return lib.tracks.filter((t) => smartMatch(p.rules, t)).length;
      case 'music.smart.save': {
        if (!p.name || !p.name.trim()) throw new Error('Give the collection a name (at most 200 characters).');
        lib.smart = lib.smart || [];
        let id = p.id;
        if (id) Object.assign(lib.smart.find((x) => x.id === id), { name: p.name, ...p.rules });
        else { id = lib.smart.length + 1; lib.smart.push({ id, name: p.name, ...p.rules }); }
        return { id, smart: smartList() };
      }
      case 'music.smart.delete': lib.smart = (lib.smart || []).filter((x) => x.id !== p.id); return smartList();
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
  window.__mock = { log, files, state, emit };
}

// Mock host for the NoorSketch window: records what the page sends, answers like SketchWindow.cs.
function sketchHostScript(initial) {
  const listeners = [];
  const log = [];
  const state = { saved: null, exported: null, inserted: null, dirty: [], openFile: initial.openFile || null, saveCount: 0 };
  const emit = (data) => setTimeout(() => listeners.forEach((fn) => fn({ data })), 0);
  const reply = (id, ok, result, error) => id != null && emit({ v: 2, replyTo: id, ok, result, error });
  window.__NOORMD_TEST_HOST__ = {
    addEventListener: (_t, fn) => listeners.push(fn),
    postMessage(m) {
      log.push({ type: m.type, keys: Object.keys(m.payload || {}) });
      const p = m.payload || {};
      switch (m.type) {
        case 'sketch.ready': return reply(m.id, true, initial.ready || { width: 400, height: 300, background: 'white' });
        case 'sketch.dirty': state.dirty.push(p.dirty); return;
        case 'sketch.save': state.saved = p; state.saveCount++; return reply(m.id, true, { path: 'C:\\Sketches\\idea.noorsketch', name: 'idea' });
        case 'sketch.open': return reply(m.id, true, state.openFile || { cancelled: true });
        case 'sketch.exportPng': state.exported = p; return reply(m.id, true, { path: 'C:\\Sketches\\idea.png' });
        case 'sketch.insert': state.inserted = p; return reply(m.id, true, { inserted: true, link: 'assets/idea.png', document: 'Plan.md' });
        default: return reply(m.id, true, null);
      }
    },
  };
  window.__sk = { log, state, emit };
}

// The pop-out video window's host (VideoWindow.cs): plays video 7, which has a next episode 8.
function videoWindowHostScript() {
  const listeners = [];
  const state = { positions: [], topmost: true, notes: [], titles: [], closed: 0 };
  const emit = (data) => setTimeout(() => listeners.forEach((fn) => fn({ data })), 0);
  const reply = (id, ok, result, error) => id != null && emit({ v: 2, replyTo: id, ok, result, error });
  const video = (id) => ({ id, title: id === 7 ? 'Episode 7' : 'Episode 8', duration: 6, position: 0, watched: false });
  window.__NOORMD_TEST_HOST__ = {
    addEventListener: (_t, fn) => listeners.push(fn),
    postMessage(m) {
      const p = m.payload || {};
      switch (m.type) {
        case 'video.ready': reply(m.id, true, null); emit({ v: 2, event: 'video.load', payload: { id: 7, time: 2, paused: true } }); return;
        case 'video.get': return reply(m.id, true, { video: video(p.id), subtitles: [], notes: [], next: p.id === 7 ? video(8) : null, exists: true });
        case 'video.position': state.positions.push(p); return reply(m.id, true, video(p.id));
        case 'video.topmost': state.topmost = !!p.value; return reply(m.id, true, { topmost: state.topmost });
        case 'video.title': state.titles.push(p.title); return reply(m.id, true, null);
        case 'video.note.add': state.notes.push(p); return reply(m.id, true, { id: 1, notes: [] });
        case 'video.close': state.closed++; return reply(m.id, true, null);
        default: return reply(m.id, true, null);
      }
    },
  };
  window.__pv = { state, emit };
}

module.exports = { serve, mockHostScript, sketchHostScript, videoWindowHostScript, WWW, mediaLog };
