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
/** The rock fixture's vertices as NoorForge texels (64×64: position, normal, part 0), for the brush's live preview. */
function rockTexels() {
  const buf = fs.readFileSync(path.join(FIXTURES, 'rock-lod0.glb'));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(20 + jsonLen + 8);
  const read = (i) => { const a = json.accessors[i], v = json.bufferViews[a.bufferView], off = (v.byteOffset || 0) + (a.byteOffset || 0); return Array.from({ length: a.count * 3 }, (_, k) => bin.readFloatLE(off + k * 4)); };
  const prim = json.meshes[0].primitives[0];
  const pos = read(prim.attributes.POSITION), nrm = read(prim.attributes.NORMAL);
  const size = 64, out = new Float32Array(size * size * 7).fill(NaN);
  for (let i = 0; i < Math.min(size * size, pos.length / 3); i++) {
    out.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], 0], i * 7);
  }
  return Buffer.from(out.buffer);
}
const MEDIA = { 1: 'tone.mp3', 2: 'tone.ogg', 3: 'tone.flac', 4: 'tone.wav' };
const MEDIA_TYPES = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.webm': 'video/webm' };
const MAX_CHUNK = 2 * 1024 * 1024; // same as NoorMD.Media.MediaResponse
const mediaLog = [];

// Media 9: 30 seconds of quiet (8 kHz, 16-bit mono WAV), for listening that must last (a song kept playing while edited).
let longWav = null;
function makeLongWav() {
  const rate = 8000, n = rate * 30, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * 300), 44 + i * 2);
  return b;
}

function serveMedia(id, req, res, video) {
  const name = video ? (id === 4 ? 'dual-audio.webm' : 'clip.webm') : id === 9 ? 'long.wav' : MEDIA[id]; // video 4 has two audio tracks
  if (!name) { res.writeHead(404); res.end(); return; }
  const file = path.join(FIXTURES, name);
  const data = id === 9 && !video ? (longWav = longWav || makeLongWav()) : fs.readFileSync(file);
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
    // Asset Bench previews: real GLBs made by the C# tree builder ("s" keys: separate branches).
    if (/^\/_asset\/r\d+\/lod\d\.glb$/.test(url.pathname)) { res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); res.end(fs.readFileSync(path.join(FIXTURES, 'rock-lod0.glb'))); return; }
    // NoorForge's texels for painting: here the rock's vertices (where its surface is), 7 floats each, NaN after.
    if (url.pathname === '/_forge/texels/0.bin') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(rockTexels()); return; }
    const glb = /^\/_asset\/(k\d+)(s?)\/lod(\d)\.glb$/.exec(url.pathname);
    if (glb) { const f = glb[2] ? 'tree-separate.glb' : `tree-lod${Math.min(1, Number(glb[3]))}.glb`; res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); res.end(fs.readFileSync(path.join(FIXTURES, f))); return; }
    const pic = /^\/_(img|thumb)\/(\d+)$/.exec(url.pathname); // Gallery: every picture id under 900 is the same small photo
    if (pic) { if (Number(pic[2]) >= 900) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(fs.readFileSync(path.join(FIXTURES, 'photo-exif.jpg'))); return; }
    if (url.pathname.startsWith('/_hubicon/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGNzYAAA1bAgNOzQdTAAAAAElFTkSuQmCC', 'base64')); return; }
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
        case 'prefs.set': Object.assign(state.prefs, JSON.parse(JSON.stringify(p))); return reply(m.id, true, null);
        case 'streamwin.ready': return reply(m.id, true, { tab: initial.streamTab || null });
        case 'streamwin.close': state.streamClosed = (state.streamClosed || 0) + 1; return reply(m.id, true, null);
        case 'streamwin.dirty': state.streamDirty = !!p.dirty; return reply(m.id, true, null);
        case 'recovery.list': return reply(m.id, true, state.recovery);
        default:
          if (m.type === 'vault.pack.create') { packCreate(m.id, p); return; }
          if (m.type.startsWith('vault.')) { try { return reply(m.id, true, vaultMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('music.')) return reply(m.id, true, musicMock(m.type, p));
          if (m.type.startsWith('gallery.')) { try { return reply(m.id, true, galleryMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('voice.')) { try { return reply(m.id, true, voiceMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('sound.')) { try { return reply(m.id, true, soundMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('texture.')) { try { return reply(m.id, true, textureMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('cal.')) { try { return reply(m.id, true, calMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('asset.')) { try { return reply(m.id, true, assetMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('forge.')) { try { return reply(m.id, true, forgeMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('seq.')) { try { return reply(m.id, true, seqMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('export.') && !['export.markdown', 'export.html', 'export.pdf'].includes(m.type)) { try { return reply(m.id, true, exportMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('radio.')) { try { return reply(m.id, true, radioMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
          if (m.type.startsWith('apps.')) { try { return reply(m.id, true, appsMock(m.type, p)); } catch (err) { return reply(m.id, false, null, err.message); } }
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
      case 'vault.presets': return [
        { id: 'blank', name: 'Empty', icon: '▫', description: 'Just a Home note.', folders: [], notes: [] },
        { id: 'notes', name: 'Personal notes', icon: '🗂', description: 'Inbox, notes, journal.', folders: ['Inbox', 'Notes', 'Journal'], notes: ['Inbox/Read me first.md'] },
        { id: 'creator', name: 'Streamer / creator', icon: '📡', description: 'Streams, supporters.', folders: ['Streams', 'Stream'], notes: [] }];
      case 'vault.create': V.created = { ...p }; return { cancelled: false };
      case 'vault.applyPreset': V.applied = p.preset; V.dirs.add('Inbox'); pushTree(); return { home: 'Home.md' };
      case 'vault.tags': case 'vault.tagged': {
        // Same rules as VaultTags.cs for the cases the tests use: #tag outside code, tags: [..] in front matter.
        const tagsOf = (text) => {
          const out = [];
          const add = (t) => { t = t.trim().replace(/^#/, ''); if (t && !/^\d+$/.test(t) && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t); };
          const fm = /^---\n([\s\S]*?)\n---/.exec(text);
          if (fm) { const m = /^tags?:\s*\[?([^\]\n]*)\]?/m.exec(fm[1]); if (m) m[1].split(',').forEach((x) => add(x.replace(/["']/g, ''))); }
          const body = (fm ? text.slice(fm[0].length) : text).replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
          for (const m of body.matchAll(/(?<![\p{L}\p{N}_&/#\])(`])#([\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*)/gu)) add(m[1]);
          return out;
        };
        const all = Object.entries(V.files).filter(([f]) => /\.md$/i.test(f)).map(([f, t]) => ({ f, tags: tagsOf(t) }));
        if (type === 'vault.tagged') {
          const want = String(p.tag).toLowerCase();
          return all.filter((n) => n.tags.some((t) => t.toLowerCase() === want || t.toLowerCase().startsWith(want + '/')))
            .map((n) => ({ path: n.f, name: n.f.split('/').pop().replace(/\.md$/i, ''), folder: n.f.includes('/') ? n.f.slice(0, n.f.lastIndexOf('/')) : '', tags: n.tags }));
        }
        const counts = new Map();
        for (const n of all) for (const t of n.tags) counts.set(t.toLowerCase(), { tag: (counts.get(t.toLowerCase()) || {}).tag || t, count: ((counts.get(t.toLowerCase()) || {}).count || 0) + 1 });
        return { tags: [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag)), indexed: all.length };
      }
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
  const ST = { windows: [], running: false, port: 47321, clients: 0, np: null, cr: null, effects: [], templates: [], txt: { enabled: false, path: 'C:\\Users\\me\\now-playing.txt', format: '{artist} - {title}' },
    updates: [], starts: 0, stops: 0, supporters: initial.supporters || [], streams: [], session: null, saved: [], vault: initial.streamVault ? 'C:\\Vault' : null };
  state.stream = ST;
  function streamMock(type, p) {
    const today = '2026-10-26';
    switch (type) {
      case 'stream.status': return { server: { running: ST.running, port: ST.port, url: `http://127.0.0.1:${ST.port}/`, clients: ST.clients }, enabled: ST.running, nowPlaying: ST.np, schedule: ST.sc, credits: ST.cr, effects: ST.effects, templates: ST.templates, txt: ST.txt, vault: ST.vault, supportersNote: 'Stream/Supporters.md', streamsFolder: 'Streams', session: ST.session };
      case 'stream.server': ST.running = !!p.enabled; ST.port = p.port || ST.port; return ST.running ? { running: true, url: `http://127.0.0.1:${ST.port}/` } : { running: false };
      case 'stream.np.config': ST.np = p.config; return null;
      case 'stream.sc.config': ST.sc = p.config; ST.scSaves = (ST.scSaves || 0) + 1; return null;
      case 'stream.window': ST.windows.push({ ...p }); return { open: !p.close };
      case 'stream.track': return null;
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


  // ---- mock Apps Hub (same address rules as AppsHub.cs: http(s) and launcher links; javascript:, file: and the like refused).
  // Sound Bench: real preset recipes (from the C# presets), renders recorded, the test tone as the preview.
  const SND = { recipes: {"wind-forest":{"version":1,"name":"Gentle forest breeze","family":"Wind","seed":1,"duration":20,"loop":true,"macros":{"intensity":0.5,"gust":0.5,"brightness":0.5,"distance":0,"shelter":0},"gust":{"rate":5,"depth":0.5,"base":0.35},"layers":[{"type":"noise","name":"Air","mute":false,"solo":false,"gain":-14,"pan":0,"width":0.8,"gustAmount":0.7,"start":0,"attack":0,"release":0,"color":"pink","filter":"lowpass","freq":600,"q":0.7,"gustFilter":0.6,"drift":0,"wobble":0,"wobbleRate":1,"density":20,"decay":10,"pitch":3000,"pitchSpread":0.7,"tone":0.3,"gainSpread":6,"wave":"sine","pitchEnd":0,"hold":0,"vibrato":0,"vibratoRate":6,"repeat":0},{"type":"noise","name":"Leaves","mute":false,"solo":false,"gain":-30,"pan":0,"width":1,"gustAmount":1,"start":0,"attack":0,"release":0,"color":"white","filter":"bandpass","freq":4500,"q":0.8,"gustFilter":0.3,"drift":0,"wobble":0.5,"wobbleRate":3,"density":20,"decay":10,"pitch":3000,"pitchSpread":0.7,"tone":0.3,"gainSpread":6,"wave":"sine","pitchEnd":0,"hold":0,"vibrato":0,"vibratoRate":6,"repeat":0},{"type":"events","name":"Leaf ticks","mute":false,"solo":false,"gain":-36,"pan":0,"width":0.9,"gustAmount":1,"start":0,"attack":0,"release":0,"color":"pink","filter":"lowpass","freq":1000,"q":0.7,"gustFilter":0,"drift":0,"wobble":0,"wobbleRate":1,"density":25,"decay":6,"pitch":5000,"pitchSpread":1,"tone":0.1,"gainSpread":6,"wave":"sine","pitchEnd":0,"hold":0,"vibrato":0,"vibratoRate":6,"repeat":0}],"master":{"gain":14,"highPass":20,"lowPass":20000,"width":1,"reverb":0,"room":0.5,"normalize":false,"ceiling":-1}},"rain-steady":{"version":1,"name":"Steady rain","family":"Rain","seed":1,"duration":20,"loop":true,"macros":{"intensity":0.5,"gust":0.5,"brightness":0.5,"distance":0,"shelter":0},"gust":{"rate":3,"depth":0.3,"base":0.45},"layers":[{"type":"noise","name":"Rain bed","mute":false,"solo":false,"gain":-22,"pan":0,"width":0.8,"gustAmount":0.4,"start":0,"attack":0,"release":0,"color":"white","filter":"bandpass","freq":3500,"q":0.4,"gustFilter":0,"drift":0,"wobble":0,"wobbleRate":1,"density":20,"decay":10,"pitch":3000,"pitchSpread":0.7,"tone":0.3,"gainSpread":6,"wave":"sine","pitchEnd":0,"hold":0,"vibrato":0,"vibratoRate":6,"repeat":0},{"type":"noise","name":"Wash","mute":false,"solo":false,"gain":-30,"pan":0,"width":0.8,"gustAmount":0.3,"start":0,"attack":0,"release":0,"color":"pink","filter":"lowpass","freq":1200,"q":0.7,"gustFilter":0,"drift":0,"wobble":0,"wobbleRate":1,"density":20,"decay":10,"pitch":3000,"pitchSpread":0.7,"tone":0.3,"gainSpread":6,"wave":"sine","pitchEnd":0,"hold":0,"vibrato":0,"vibratoRate":6,"repeat":0},{"type":"events","name":"Near drops","mute":false,"solo":false,"gain":-30,"pan":0,"width":0.9,"gustAmount":0.4,"start":0,"attack":0,"release":0,"color":"pink","filter":"lowpass","freq":1000,"q":0.7,"gustFilter":0,"drift":0,"wobble":0,"wobbleRate":1,"density":220,"decay":6,"pitch":3000,"pitchSpread":1,"tone":0.3,"gainSpread":6,"wave":"sine","pitchEnd":0,"hold":0,"vibrato":0,"vibratoRate":6,"repeat":0},{"type":"events","name":"Splashes","mute":false,"solo":false,"gain":-28,"pan":0,"width":0.9,"gustAmount":0.4,"start":0,"attack":0,"release":0,"color":"pink","filter":"lowpass","freq":1000,"q":0.7,"gustFilter":0,"drift":0,"wobble":0,"wobbleRate":1,"density":15,"decay":25,"pitch":1200,"pitchSpread":0.8,"tone":0.6,"gainSpread":6,"wave":"sine","pitchEnd":0,"hold":0,"vibrato":0,"vibratoRate":6,"repeat":0}],"master":{"gain":15.5,"highPass":20,"lowPass":20000,"width":1,"reverb":0,"room":0.5,"normalize":false,"ceiling":-1}},"ui-coin":{"version":1,"name":"Coin pickup","family":"UI","seed":1,"duration":0.5,"loop":false,"macros":{"intensity":0.5,"gust":0.5,"brightness":0.5,"distance":0,"shelter":0},"gust":{"rate":6,"depth":0,"base":0.5},"layers":[{"type":"synth","name":"Low note","mute":false,"solo":false,"gain":-10,"pan":0,"width":0,"gustAmount":0,"start":0,"attack":0.002,"release":0.02,"color":"pink","filter":"lowpass","freq":1000,"q":0.7,"gustFilter":0,"drift":0,"wobble":0,"wobbleRate":1,"density":20,"decay":10,"pitch":988,"pitchSpread":0.7,"tone":0.3,"gainSpread":6,"wave":"square","pitchEnd":0,"hold":0.05,"vibrato":0,"vibratoRate":6,"repeat":0},{"type":"synth","name":"High note","mute":false,"solo":false,"gain":-10,"pan":0,"width":0,"gustAmount":0,"start":0.07,"attack":0.002,"release":0.3,"color":"pink","filter":"lowpass","freq":1000,"q":0.7,"gustFilter":0,"drift":0,"wobble":0,"wobbleRate":1,"density":20,"decay":10,"pitch":1319,"pitchSpread":0.7,"tone":0.3,"gainSpread":6,"wave":"square","pitchEnd":0,"hold":0.05,"vibrato":0,"vibratoRate":6,"repeat":0}],"master":{"gain":0,"highPass":20,"lowPass":20000,"width":1,"reverb":0,"room":0.5,"normalize":true,"ceiling":-1}},"machine-engine":{"version":1,"name":"Engine idle","family":"Machines","seed":1,"duration":4,"loop":true,"macros":{"intensity":0.5,"gust":0.5,"brightness":0.5,"distance":0,"shelter":0},"gust":{"rate":6,"depth":0,"base":0.5},"layers":[{"type":"synth","id":"L1","name":"Motor","mute":false,"solo":false,"gain":-10,"pan":0,"width":0,"gustAmount":0,"start":0,"attack":0.01,"release":0.1,"color":"pink","filter":"lowpass","freq":400,"q":0.7,"gustFilter":0,"drift":0,"wobble":0,"wobbleRate":1,"density":20,"decay":10,"pitch":45,"pitchSpread":0.7,"tone":0.3,"gainSpread":6,"wave":"saw","pitchEnd":0,"hold":60,"vibrato":0.1,"vibratoRate":6,"repeat":0,"duty":0.5,"fmRatio":0,"fmDepth":0,"arp":0,"arpTime":0.08,"rhythm":0,"burst":1,"burstSpread":30,"freqEnd":0,"useFilter":true,"drive":0.5,"crush":0,"path":null,"sampleName":null,"semitones":0,"trimStart":0,"trimEnd":0,"reverse":false,"loopSample":false,"effects":[]},{"type":"noise","id":"L2","name":"Rumble","mute":false,"solo":false,"gain":-12,"pan":0,"width":0.4,"gustAmount":0,"start":0,"attack":0,"release":0,"color":"brown","filter":"lowpass","freq":180,"q":0.7,"gustFilter":0,"drift":0,"wobble":0.4,"wobbleRate":7,"density":20,"decay":10,"pitch":3000,"pitchSpread":0.7,"tone":0.3,"gainSpread":6,"wave":"sine","pitchEnd":0,"hold":0,"vibrato":0,"vibratoRate":6,"repeat":0,"duty":0.5,"fmRatio":0,"fmDepth":0,"arp":0,"arpTime":0.08,"rhythm":0,"burst":1,"burstSpread":30,"freqEnd":0,"useFilter":false,"drive":0,"crush":0,"path":null,"sampleName":null,"semitones":0,"trimStart":0,"trimEnd":0,"reverse":false,"loopSample":false,"effects":[]}],"master":{"gain":-8,"highPass":20,"lowPass":20000,"width":1,"reverb":0,"room":0.5,"normalize":false,"ceiling":-1,"effects":[]},"modulators":[],"knobs":[{"id":"K1","name":"Motor RPM","value":0}],"routes":[{"source":"K1","target":"L1:pitch","amount":14,"curve":0.8,"off":false},{"source":"K1","target":"L1:freq","amount":1.6,"curve":1,"off":false},{"source":"K1","target":"L1:gain","amount":3,"curve":1,"off":false},{"source":"K1","target":"L2:freq","amount":1.2,"curve":1,"off":false},{"source":"K1","target":"L2:gain","amount":4,"curve":1,"off":false}]}}, renders: [], exports: [], mine: [], opened: null };
  state.sound = SND;
  const TEX = { recipes: {"bricks-red":{"version":1,"name":"Red bricks","family":"Walls","seed":1,"layers":[{"id":"T1","name":"Bricks","type":"bricks","mute":false,"scaleX":4,"scaleY":8,"octaves":5,"persistence":0.5,"lacunarity":2,"warp":0,"warpScale":3,"mode":"cells","jitter":1,"mortar":0.12,"bevel":0.08,"offset":0.5,"variation":0.3,"count":40,"length":0.2,"width":0.004,"low":0,"high":1,"gamma":1,"invert":false,"blend":"normal","opacity":1,"seedShift":0},{"id":"T2","name":"Texture","type":"noise","mute":false,"scaleX":24,"scaleY":24,"octaves":4,"persistence":0.5,"lacunarity":2,"warp":0,"warpScale":3,"mode":"cells","jitter":1,"mortar":0.08,"bevel":0.1,"offset":0.5,"variation":0.3,"count":40,"length":0.2,"width":0.004,"low":0,"high":1,"gamma":1,"invert":false,"blend":"overlay","opacity":0.35,"seedShift":0}],"surface":{"ramp":[{"pos":0,"color":"#6e6a64"},{"pos":0.15,"color":"#8a8580"},{"pos":0.2,"color":"#5a2418"},{"pos":0.6,"color":"#8e3a26"},{"pos":1,"color":"#b0563a"}],"colorVariation":0.35,"dirt":0.5,"roughnessLow":0.95,"roughnessHigh":0.8,"roughnessVariation":0.1,"metallic":0,"normalStrength":6,"aoStrength":0.7,"aoRadius":0.015}},"stone-cobbles":{"version":1,"name":"Cobblestones","family":"Stone","seed":1,"layers":[{"id":"T1","name":"Stones","type":"cells","mute":false,"scaleX":6,"scaleY":6,"octaves":5,"persistence":0.5,"lacunarity":2,"warp":0,"warpScale":3,"mode":"stones","jitter":0.85,"mortar":0.08,"bevel":0.1,"offset":0.5,"variation":0.35,"count":40,"length":0.2,"width":0.004,"low":0,"high":1,"gamma":1,"invert":false,"blend":"normal","opacity":1,"seedShift":0},{"id":"T2","name":"Surface","type":"noise","mute":false,"scaleX":16,"scaleY":16,"octaves":5,"persistence":0.5,"lacunarity":2,"warp":0,"warpScale":3,"mode":"cells","jitter":1,"mortar":0.08,"bevel":0.1,"offset":0.5,"variation":0.3,"count":40,"length":0.2,"width":0.004,"low":0.1,"high":0.9,"gamma":1,"invert":false,"blend":"multiply","opacity":0.35,"seedShift":0}],"surface":{"ramp":[{"pos":0,"color":"#2b2620"},{"pos":0.25,"color":"#4a4238"},{"pos":0.6,"color":"#7d766c"},{"pos":1,"color":"#a59d90"}],"colorVariation":0.3,"dirt":0.6,"roughnessLow":0.95,"roughnessHigh":0.7,"roughnessVariation":0.1,"metallic":0,"normalStrength":6,"aoStrength":0.7,"aoRadius":0.03}},"metal-brushed":{"version":1,"name":"Brushed metal","family":"Metal","seed":1,"layers":[{"id":"T1","name":"Brushing","type":"noise","mute":false,"scaleX":2,"scaleY":128,"octaves":3,"persistence":0.6,"lacunarity":2,"warp":0,"warpScale":3,"mode":"cells","jitter":1,"mortar":0.08,"bevel":0.1,"offset":0.5,"variation":0.3,"count":40,"length":0.2,"width":0.004,"low":0,"high":1,"gamma":1,"invert":false,"blend":"normal","opacity":1,"seedShift":0},{"id":"T2","name":"Scratches","type":"scratches","mute":false,"scaleX":1,"scaleY":1,"octaves":5,"persistence":0.5,"lacunarity":2,"warp":0,"warpScale":3,"mode":"cells","jitter":1,"mortar":0.08,"bevel":0.1,"offset":0.5,"variation":0.3,"count":60,"length":0.15,"width":0.0015,"low":0,"high":1,"gamma":1,"invert":false,"blend":"subtract","opacity":0.4,"seedShift":0}],"surface":{"ramp":[{"pos":0,"color":"#8a8d91"},{"pos":1,"color":"#c9ccd0"}],"colorVariation":0.1,"dirt":0.05,"roughnessLow":0.45,"roughnessHigh":0.3,"roughnessVariation":0.15,"metallic":1,"normalStrength":1,"aoStrength":0.2,"aoRadius":0.02}}}, renders: [], exports: [], mine: [], saved: [] };
  state.texture = TEX;
  /** A small PNG for a map: its colour depends on the map and the recipe's seed, so tests can tell renders apart. */
  function texPng(map, seed) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const base = { albedo: [180, 80, 50], normal: [128, 128, 255], roughness: [200, 200, 200], ao: [230, 230, 230], metallic: [0, 0, 0], height: [128, 128, 128] }[map];
    g.fillStyle = `rgb(${base.map((v, i) => (map === 'albedo' && i === 1 ? (v + seed * 37) % 256 : v)).join(',')})`;
    g.fillRect(0, 0, 32, 32);
    if (map === 'albedo') { g.fillStyle = 'rgb(60,40,30)'; g.fillRect(0, 14, 32, 4); g.fillRect(14, 0, 4, 14); }
    return c.toDataURL('image/png');
  }
  // Where exports go: projects and layouts (a small copy of ExportLayouts.cs, enough to check the panel).
  const EXP = { projects: [], plans: [], added: 0 };
  state.export = EXP;
  const LAYOUTS = [
    { id: 'flat', name: 'Flat: everything in the folder', description: '', texture: { folder: '', file: '{name}_{map}' }, sound: { folder: '', file: '{name}_{n}' }, music: { folder: '', file: '{name}' }, model: { folder: '', file: '{name}' } },
    { id: 'per-item', name: 'A folder for each', description: '', model: { folder: '{name}', file: '{name}' }, texture: { folder: '{name}', file: '{name}_{map}' }, sound: { folder: '{name}', file: '{name}_{n}' }, music: { folder: '{name}', file: '{name}' } },
    { id: 'godot', name: 'Godot', description: '', model: { folder: 'assets/models/{family_snake}/{name_snake}', file: '{name_snake}' }, texture: { folder: 'assets/materials/{name_snake}', file: '{name_snake}_{map}' }, sound: { folder: 'assets/audio/sfx/{name_snake}', file: '{name_snake}_{n}' }, music: { folder: 'assets/audio/music/{name_snake}', file: '{name_snake}' } },
    { id: 'unity', name: 'Unity', description: '', model: { folder: 'Assets/Models/{Family}/{Name}', file: '{Name}' }, texture: { folder: 'Assets/Materials/{Name}/Textures', file: '{Name}_{Map}' }, sound: { folder: 'Assets/Audio/SFX/{Name}', file: '{Name}_{n}' }, music: { folder: 'Assets/Audio/Music/{Name}', file: '{Name}' } },
    { id: 'unreal', name: 'Unreal Engine', description: '', model: { folder: 'Content/{Family}/{Name}', file: 'SM_{Name}' }, texture: { folder: 'Content/Materials/{Name}', file: 'T_{Name}_{MAP}' }, sound: { folder: 'Content/Audio/SFX/{Name}', file: 'A_{Name}_{n}' }, music: { folder: 'Content/Audio/Music/{Name}', file: 'A_{Name}' } },
  ];
  // Asset Bench: two real presets (from TreePresets), builds that point at the fixture GLBs, exports recorded.
  const ASSET = { recipes: {"oak":{"version":1,"name":"Oak","seed":1,"archetype":"broadleaf","style":"realistic","height":10,"trunkRadius":0.35,"taper":0.7,"crownStart":0.35,"lean":3,"wobble":4,"twist":0,"flare":0.6,"roots":6,"collar":0.6,"shape":"hemispherical","levels":[{"count":7,"start":0.35,"angle":55,"angleSpread":15,"length":0.62,"lengthSpread":0.15,"radius":0.6,"bend":12,"wobble":10,"spiral":137.5,"whorl":1},{"count":9,"start":0.15,"angle":45,"angleSpread":12,"length":0.5,"lengthSpread":0.15,"radius":0.5,"bend":8,"wobble":12,"spiral":137.5,"whorl":1},{"count":6,"start":0.2,"angle":50,"angleSpread":12,"length":0.4,"lengthSpread":0.15,"radius":0.5,"bend":0,"wobble":15,"spiral":137.5,"whorl":1}],"branches":"merged","mixedRadius":0.08,"quality":"medium","budget":8000,"lods":3,"flatShading":false,"foliage":"cards","leafShape":"broad","leafCluster":"cluster","leafDensity":0.65,"leafSize":0.9,"cardScale":1,"outerLeaves":0.5,"leafBudget":16000,"trimCards":true,"leafColor":"#3f6b26","leafColor2":"#7a9a33","crownNormals":0.6,"barkColor":"#5a4636","barkMaterial":"wood-bark","barkTile":1,"wind":true,"windData":"uv"},"stylized":{"version":1,"name":"Stylized oak","seed":1,"archetype":"broadleaf","style":"stylized","height":7,"trunkRadius":0.45,"taper":0.6,"crownStart":0.4,"lean":3,"wobble":6,"twist":0.6,"flare":0.9,"roots":5,"collar":0.9,"shape":"spherical","levels":[{"count":5,"start":0.45,"angle":50,"angleSpread":12,"length":0.6,"lengthSpread":0.15,"radius":0.65,"bend":25,"wobble":10,"spiral":137.5,"whorl":1},{"count":4,"start":0.3,"angle":40,"angleSpread":12,"length":0.5,"lengthSpread":0.15,"radius":0.55,"bend":20,"wobble":10,"spiral":137.5,"whorl":1}],"branches":"merged","mixedRadius":0.08,"quality":"low","budget":3000,"lods":3,"flatShading":false,"foliage":"both","leafShape":"broad","leafDensity":0.7,"leafSize":1.3,"leafColor":"#3e7d2a","leafColor2":"#b7d14a","crownNormals":0.6,"barkColor":"#6e4a2f","barkMaterial":"","barkTile":1,"wind":true,"windData":"uv"}}, builds: [], exports: [], mine: [], opened: null };
  state.assets = ASSET;
  // Rocks: two real presets (from RockPresets), builds that point at a real rock GLB, exports recorded.
  const ROCK = { recipes: {
    rock: {"version": 1,"name": "Rock","seed": 1,"kind": "rock","style": "realistic","size": 1,"height": 0.7,"elongation": 0.3,"roughness": 0.5,"fractures": 7,"edgeWear": 0.4,"strata": 0,"flatBase": true,"sink": 0.15,"material": "rock","tileMetres": 1.5,"color": "#8a8580","moss": 0,"mossColor": "#5e7a3a","snow": 0,"snowColor": "#eef2f6","stones": 40,"pieces": 0,"debris": 0,"dip": 0,"taper": 0.5,"lods": 3,"lodTriangles": [],"collisionPieces": 1},
    boulder: {"version": 1,"name": "Boulder","seed": 1,"kind": "boulder","style": "realistic","size": 2.8,"height": 0.75,"elongation": 0.3,"roughness": 0.55,"fractures": 8,"edgeWear": 0.4,"strata": 0,"flatBase": true,"sink": 0.15,"material": "rock","tileMetres": 1.5,"color": "#8a8580","moss": 0,"mossColor": "#5e7a3a","snow": 0,"snowColor": "#eef2f6","stones": 40,"pieces": 0,"debris": 0,"dip": 0,"taper": 0.5,"lods": 3,"lodTriangles": [],"collisionPieces": 1},
  }, builds: [], exports: [], mine: [] };
  state.rocks = ROCK;
  function rockMock(type, p) {
    const mine = () => ROCK.mine.map((x) => ({ id: x.id, name: x.recipe.name, style: x.recipe.style, kind: x.recipe.kind, description: 'Your preset' }));
    switch (type) {
      case 'asset.rock.presets': return { builtIn: [{ id: 'rock', name: 'Rock', description: 'Knee-high.', style: 'realistic', kind: 'rock' }, { id: 'boulder', name: 'Boulder', description: 'Big.', style: 'realistic', kind: 'boulder' }], mine: mine(), materials: [{ id: 'rock', name: 'Weathered rock' }, { id: 'mossy', name: 'Mossy rock' }] };
      case 'asset.rock.preset': {
        const own = ROCK.mine.find((x) => x.id === p.id);
        const r = own ? own.recipe : ROCK.recipes[p.id];
        if (!r) throw new Error('Unknown preset.');
        return JSON.parse(JSON.stringify(r));
      }
      case 'asset.rock.build': {
        ROCK.builds.push(JSON.parse(JSON.stringify(p.recipe)));
        const key = 'r' + ROCK.builds.length;
        const budget = { stone: 150, rock: 400, boulder: 1200, outcrop: 2500, scree: 1500 }[p.recipe.kind];
        return { key, ms: 120, notes: [], height: 0.54, width: 0.76, collision: p.recipe.collisionPieces > 0 ? Array(p.recipe.collisionPieces).fill(54) : [],
          lods: Array.from({ length: p.recipe.lods }, (_, i) => ({ url: `/_asset/${key}/lod${i}.glb`, triangles: p.recipe.lodTriangles[i] || [budget, budget * 0.4, budget * 0.15][i], vertices: 300, bytes: 108848 })),
          nodes: [{ name: 'Rock', triangles: budget }, { name: 'Collision-convcolonly', triangles: 54 }] };
      }
      case 'asset.rock.export': {
        ROCK.exports.push(JSON.parse(JSON.stringify(p)));
        const stem = p.recipe.name.replace(/ /g, '_');
        const n = p.variants || 1;
        const sfx = (v) => (n > 1 ? '_' + String(v + 1).padStart(2, '0') : '');
        const files = Array.from({ length: n }, (_, v) => p.lodFiles === 'one' || p.recipe.lods < 2 ? [stem + sfx(v) + '.glb'] : Array.from({ length: p.recipe.lods }, (_, i) => `${stem}${sfx(v)}_LOD${i}.glb`)).flat();
        const recipes = Array.from({ length: n }, (_, v) => stem + sfx(v) + '.noorrock.json');
        return { folder: 'D:\\Game\\Rocks', files, recipe: recipes[0], recipes, variants: n, manifest: stem + '.manifest.json', shaders: [], godot: null, project: null, relative: '.', triangles: Array(n).fill(400) };
      }
      case 'asset.rock.save': { const id = 'user:' + p.recipe.name + '.json'; const replaced = ROCK.mine.some((x) => x.id === id); ROCK.mine = ROCK.mine.filter((x) => x.id !== id).concat([{ id, recipe: p.recipe }]); return { id, replaced, mine: mine() }; }
      case 'asset.rock.delete': ROCK.mine = ROCK.mine.filter((x) => x.id !== p.id); return { mine: mine() };
      default: throw new Error('Unknown command ' + type);
    }
  }
  // NoorForge: the app bakes and composes; here a rock GLB stands in for the textured model, a photo for each map.
  const FORGE = { renders: [], exports: [], picks: 0, maskLayers: [], mine: [] };
  function forgeMock(type, p) {
    state.forge = FORGE;
    const layer = (name, extra) => ({ name, visible: true, opacity: 1, material: '', scale: 1, color: '#808080', roughness: 0.7, metallic: 0, useColor: true, useRoughness: true, useMetallic: true, useNormal: true, normalStrength: 1,
      mask: { kind: 'all', amount: 0.5, softness: 0.3, invert: false, noise: 0.3, noiseScale: 0.25, index: 0 }, ...extra });
    switch (type) {
      case 'forge.smart.save': {
        FORGE.mine = FORGE.mine.filter((s) => s.name.toLowerCase() !== p.name.toLowerCase());
        FORGE.mine.push({ id: 'mine:' + p.name.toLowerCase(), name: p.name, description: '', layers: JSON.parse(JSON.stringify(p.recipe.layers)), mine: true });
        return { id: 'mine:' + p.name.toLowerCase(), smart: forgeMock('forge.presets').smart };
      }
      case 'forge.smart.delete': FORGE.mine = FORGE.mine.filter((s) => s.id !== p.id); return { removed: true, smart: forgeMock('forge.presets').smart };
      case 'forge.presets': return {
        smart: [{ id: 'mossy-stone', name: 'Mossy stone', description: 'Rock with moss on top.', layers: [layer('Stone', { material: 'stone-rock', scale: 1.5 }), layer('Moss', { material: 'stone-mossy', mask: { kind: 'top', amount: 0.3, softness: 0.3, invert: false, noise: 0.6, noiseScale: 0.4, index: 0 } })] },
          { id: 'clay', name: 'Plain clay', description: 'One grey layer.', layers: [layer('Clay', { color: '#9a9a9a' })] }, ...FORGE.mine],
        materials: [{ id: 'stone-rock', name: 'Rock', family: 'Stone' }, { id: 'stone-mossy', name: 'Mossy stone', family: 'Stone' }, { id: 'metal-rusty', name: 'Rusty metal', family: 'Metal' }],
        masks: ['all', 'none', 'edges', 'cavity', 'top', 'bottom', 'height', 'part', 'material'], sizes: [256, 512, 1024, 2048, 4096],
        tips: [{ id: 'square', name: 'Square', width: 8, height: 8, data: btoa(String.fromCharCode(...new Array(64).fill(255))) },
          { id: 'chalk', name: 'Chalk', width: 8, height: 8, data: btoa(String.fromCharCode(...Array.from({ length: 64 }, (_, i) => (i % 3 ? 255 : 0)))) }],
      };
      case 'forge.model.pick': FORGE.picks++; return { path: 'C:\\Models\\Crate.glb', name: 'Crate', triangles: 1200, parts: ['Body', 'Lid'], size: [1, 0.8, 1], sets: [{ name: 'Wood', triangles: 1000, unwrapped: false }, { name: 'Metal', triangles: 200, unwrapped: true }] };
      case 'forge.render': {
        FORGE.renders.push(JSON.parse(JSON.stringify(p.recipe))); FORGE.maskLayers.push(p.maskLayer);
        const maps = (i) => Object.fromEntries(['basecolor', 'normal', 'orm', 'roughness', 'metallic', 'height', 'ao', 'curvature', ...(p.maskLayer >= 0 ? ['mask'] : [])].map((m) => [m, `/_img/${i + 1}`]));
        return { url: '/_asset/r1/lod0.glb', key: 'f1', size: Math.min(512, p.recipe.size), ms: 640, sets: [{ name: 'Wood', maps: maps(0) }, { name: 'Metal', maps: maps(1) }] };
      }
      case 'forge.export': FORGE.exports.push(JSON.parse(JSON.stringify(p.recipe))); return { folder: 'C:\\Export', files: ['Crate_Wood_BaseColor.png', 'Crate_Wood_Normal.png', 'Crate.glb', 'Crate.noorforge.json'] };
      case 'forge.recipe.open': return { cancelled: true };
      case 'forge.picture.pick': {
        FORGE.pictures = (FORGE.pictures || 0) + 1;
        const stencil = p.purpose === 'stencil' || p.purpose === 'decal', w = stencil ? 16 : 8, h = 8;
        // A stencil white on its left half; a tip all white.
        const data = btoa(String.fromCharCode(...Array.from({ length: w * h }, (_, i) => (!stencil || i % w < w / 2 ? 255 : 0))));
        return { picture: { id: (p.purpose === 'decal' ? 'd' : stencil ? 's' : 't') + 'mock' + FORGE.pictures, name: p.purpose === 'decal' ? 'Logo' : stencil ? 'Leaves stencil' : 'Leaf photo', width: w, height: h, data } };
      }
      case 'forge.texels': FORGE.texels = (FORGE.texels || 0) + 1; return { size: 64, sets: ['/_forge/texels/0.bin'] };
      case 'forge.fromAsset': FORGE.fromAsset = p.key; return { path: `C:\\Local\\Forge\\Models\\${p.name}.glb`, name: p.name, triangles: 400, parts: ['Rock'], size: [1.2, 0.9, 1.1], sets: [{ name: 'Rock', triangles: 400, unwrapped: true }] };
      default: throw new Error('Unknown forge command ' + type);
    }
  }

  function assetMock(type, p) {
    if (type.startsWith('asset.rock.')) return rockMock(type, p);
    const builtIn = [{ id: 'oak', name: 'Oak (realistic)', description: 'A broad crown.', style: 'realistic', archetype: 'broadleaf', group: 'Forest' }, { id: 'stylized-oak', name: 'Stylized oak', description: 'Chunky and puffy.', style: 'stylized', archetype: 'broadleaf', group: 'Forest' },
      { id: 'willow', name: 'Weeping willow (realistic)', description: 'Curtains.', style: 'realistic', archetype: 'broadleaf', group: 'Swamp & marsh' },
      { id: 'thornwake-pine', name: 'Pine', description: 'Tiers.', style: 'realistic', archetype: 'conifer', group: 'Thornwake', profile: 'thornwake' }];
    const profiles = [{ id: 'thornwake', name: 'Thornwake', description: 'Pixel-art woodland.', group: 'Thornwake', engine: 'other', lodFiles: 'separate', helpers: false }];
    const mine = () => ASSET.mine.map((x) => ({ id: x.id, name: x.recipe.name, style: x.recipe.style, archetype: x.recipe.archetype, description: 'Your preset' }));
    switch (type) {
      case 'asset.presets': return { builtIn, profiles, mine: mine(), barks: [{ id: 'wood-bark', name: 'Tree bark' }, { id: 'wood-planks', name: 'Wooden planks' }] };
      case 'asset.preset': {
        const own = ASSET.mine.find((x) => x.id === p.id);
        if (own) return JSON.parse(JSON.stringify(own.recipe));
        const r = p.id === 'thornwake-pine' ? { ...ASSET.recipes.oak, name: 'Pine', archetype: 'conifer', profile: 'thornwake', pixels: 64, lodTriangles: [2800, 1100, 220], triangleTarget: 0, billboard: false } : p.id === 'willow' ? { ...ASSET.recipes.oak, name: 'Weeping willow', arrangement: 'hanging', leafShape: 'slender', hangLength: 7, rootStyle: 'surface' } : ASSET.recipes[p.id === 'stylized-oak' ? 'stylized' : p.id];
        if (!r) throw new Error('Unknown preset.');
        return JSON.parse(JSON.stringify(r));
      }
      case 'asset.build': {
        ASSET.builds.push(JSON.parse(JSON.stringify(p.recipe)));
        const key = 'k' + ASSET.builds.length + (p.recipe.branches === 'separate' ? 's' : '');
        const lods = Math.max(1, Math.min(p.recipe.lods, 2));
        const separate = p.recipe.branches === 'separate';
        return { key, ms: 840, branches: 26, notes: ['3 thin branch ends are tubes (thinner than the low quality grid).'],
          lods: Array.from({ length: lods }, (_, i) => ({ url: `/_asset/${key}/lod${i}.glb`, triangles: i ? 1524 : 2454, vertices: i ? 2900 : 4800, bytes: i ? 75384 : 117984, wood: i ? 700 : 1200, leaves: i ? 824 : 1254, drawCalls: 2, fullness: i ? 0.71 : 0.77, overdraw: 2.5, emptyCards: 0.79 })),
          nodes: separate ? ['Trunk', 'Branch_01', 'Branch_01_Leaves'].map((name) => ({ name, triangles: 300 })) : [{ name: 'Trunk', triangles: 1200 }, { name: 'Leaves', triangles: 1254 }] };
      }
      case 'asset.export': {
        ASSET.exports.push(JSON.parse(JSON.stringify(p)));
        const stem = p.recipe.name.replace(/ /g, '_');
        const n = p.variants || 1;
        const sfx = (v) => (p.recipe.profile ? '_' + 'ABCDEFGHIJ'[v] : n > 1 ? '_' + String(v + 1).padStart(2, '0') : '');
        const files = Array.from({ length: n }, (_, v) => p.lodFiles === 'one' || p.recipe.lods < 2 ? [stem + sfx(v) + '.glb'] : Array.from({ length: p.recipe.lods }, (_, i) => `${stem}${sfx(v)}_LOD${i}.glb`)).flat();
        const recipes = Array.from({ length: n }, (_, v) => stem + sfx(v) + '.noortree.json');
        const godot = p.engine === 'godot' && p.shaders ? (p.godotInProject === false ? { folder: 'D:\\Game\\Trees\\addons\\noor_trees', inProject: false, resPath: null, written: 5 } : { folder: 'D:\\Game\\addons\\noor_trees', inProject: true, resPath: 'res://addons/noor_trees', written: 5 }) : null;
        return { folder: 'D:\\Game\\Trees', files, recipe: recipes[0], recipes, variants: n, manifest: stem + '.manifest.json', handoff: p.recipe.profile ? stem + '.handoff.md' : null, profile: p.recipe.profile ? 'Thornwake' : null, engine: p.engine, godot, project: null, relative: '.', triangles: Array(n).fill(2454) };
      }
      case 'asset.reveal': ASSET.opened = p.folder; return null;
      case 'asset.save': { const id = 'user:' + p.recipe.name + '.json'; const replaced = ASSET.mine.some((x) => x.id === id); ASSET.mine = ASSET.mine.filter((x) => x.id !== id).concat([{ id, recipe: p.recipe }]); return { id, replaced, mine: mine() }; }
      case 'asset.delete': ASSET.mine = ASSET.mine.filter((x) => x.id !== p.id); return { mine: mine() };
      case 'asset.image.pick': ASSET.picks = (ASSET.picks || []).concat([p.kind]); return { path: p.kind === 'leaves' ? 'D:\\Art\\my leaves.png' : 'D:\\Art\\my bark.png', name: p.kind === 'leaves' ? 'my leaves.png' : 'my bark.png', width: 1024, height: 1024 };
      case 'asset.open': return ASSET.openRock ? { subject: 'rock', recipe: { ...JSON.parse(JSON.stringify(ROCK.recipes.boulder)), name: 'Opened rock' } } : { subject: 'tree', recipe: { ...JSON.parse(JSON.stringify(ASSET.recipes.oak)), name: 'Opened tree' } };
      default: throw new Error('Unknown command ' + type);
    }
  }
  // NoorCalendar: entries relative to today, and a small copy of the engine's repeats (enough to draw the views).
  const pad2 = (n) => String(n).padStart(2, '0');
  const calDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const calTime = (d) => `${calDay(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const calParse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s); return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)); };
  const calToday = new Date(); calToday.setHours(0, 0, 0, 0);
  const calAt = (days, h, m) => { const d = new Date(calToday); d.setDate(d.getDate() + days); if (h != null) d.setHours(h, m || 0); return d; };
  const CAL = {
    saves: [], deletes: [], snoozes: [], dismissed: [], exports: [], imports: 0, problem: null,
    entries: [
      { id: 'meet', title: 'Team meeting', notes: 'Room 4', category: 'appointment', color: '', allDay: false, start: calTime(calAt(0, 10)), end: calTime(calAt(0, 11)), repeat: { freq: 'weekly', interval: 1, days: [], monthMode: 'day', until: null, count: null }, skip: [], moved: [], reminders: [15], sinceYear: null, note: null, game: null, platform: null, updated: '' },
      { id: 'ola', title: 'Ola', notes: '', category: 'birthday', color: '', allDay: true, start: calDay(new Date(calAt(3).getFullYear() - 30, calAt(3).getMonth(), calAt(3).getDate())), end: calDay(new Date(calAt(3).getFullYear() - 30, calAt(3).getMonth(), calAt(3).getDate())), repeat: { freq: 'yearly', interval: 1, days: [], monthMode: 'day', until: null, count: null }, skip: [], moved: [], reminders: [-540], sinceYear: calAt(3).getFullYear() - 30, note: null, game: null, platform: null, updated: '' },
    ],
  };
  state.calendar = CAL;
  function calOccurrences(e, from, to) {
    const out = [];
    const s0 = calParse(e.start), e0 = calParse(e.end);
    const len = e.allDay ? (calParse(e.end) - calParse(e.start)) + 86400000 : e0 - s0;
    const starts = [];
    if (!e.repeat) starts.push(s0);
    else {
      const r = e.repeat;
      for (let k = 0, at = new Date(s0); at < to && k < 5000; k++) {
        if (r.freq === 'daily') { at = new Date(s0); at.setDate(s0.getDate() + k * r.interval); }
        else if (r.freq === 'weekly') { at = new Date(s0); at.setDate(s0.getDate() + 7 * k * r.interval); }
        else if (r.freq === 'monthly') { at = new Date(s0); at.setMonth(s0.getMonth() + k * r.interval); }
        else { at = new Date(s0); at.setFullYear(s0.getFullYear() + k * r.interval); }
        if (r.until && at > calParse(r.until + 'T23:59')) break;
        if (r.count && k >= r.count) break;
        starts.push(at);
      }
    }
    for (const at of starts) {
      const key = calDay(at);
      if ((e.skip || []).includes(key)) continue;
      const mv = (e.moved || []).find((m) => m.date === key);
      const st = mv ? calParse(mv.start) : at, en = mv ? (e.allDay ? new Date(calParse(mv.end).getTime() + 86400000) : calParse(mv.end)) : new Date(at.getTime() + len);
      if (st < to && en > from) out.push({ entryId: e.id, date: key, start: calTime(st), end: calTime(en), allDay: e.allDay, age: e.sinceYear ? st.getFullYear() - e.sinceYear : null, moved: !!mv });
    }
    return out;
  }
  function calMock(type, p) {
    switch (type) {
      case 'cal.entries': return { entries: JSON.parse(JSON.stringify(CAL.entries)), problem: CAL.problem, now: calTime(new Date()), categories: [], countries: [{ code: 'GB', name: 'United Kingdom' }, { code: 'SE', name: 'Sweden' }] };
      case 'cal.range': {
        const from = calParse(p.from), to = calParse(p.to);
        CAL.ranges = (CAL.ranges || []).concat([p]);
        // A made-up holiday the day after tomorrow, for the chosen country.
        const hd = new Date(); hd.setHours(0, 0, 0, 0); hd.setDate(hd.getDate() + 2);
        const holidays = p.holidays && hd >= from && hd < to ? [{ id: `hol-${calDay(hd)}-0`, date: calDay(hd), name: p.holidays === 'SE' ? 'Midsummer Day' : 'Bank holiday' }] : [];
        // Work days taken by days off in the year (Monday to Friday; the mock has no public holidays in it).
        let daysOff = null;
        if (p.year) {
          const y0 = new Date(p.year, 0, 1), y1 = new Date(p.year + 1, 0, 1), days = new Set();
          for (const e of CAL.entries.filter((x) => x.category === 'holiday')) for (const o of calOccurrences(e, y0, y1)) {
            for (let d = calParse(o.start); d < calParse(o.end); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) if (d >= y0 && d < y1 && d.getDay() % 6 !== 0) days.add(calDay(d));
          }
          daysOff = { year: p.year, workDays: days.size };
        }
        return { occurrences: CAL.entries.flatMap((e) => calOccurrences(e, from, to)).sort((a, b) => a.start.localeCompare(b.start)), holidays, daysOff };
      }
      case 'cal.schedule': {
        CAL.schedules = (CAL.schedules || []).concat([p]);
        const from = calParse(p.week + 'T00:00');
        const slots = CAL.entries.filter((e) => e.category === 'stream').flatMap((e) => calOccurrences(e, from, new Date(from.getTime() + 7 * 86400000)))
          .map((o) => { const e = CAL.entries.find((x) => x.id === o.entryId); return { entryId: e.id, title: e.title, game: e.game, platform: e.platform, allDay: e.allDay, start: calParse(o.start).toISOString(), end: calParse(o.end).toISOString() }; });
        const text = p.format === 'discord' ? `**📅 ${p.title || 'Stream schedule'}**\n` + slots.map((x) => `• <t:${Math.floor(new Date(x.start) / 1000)}:F> — **${x.title}**`).join('\n') : `${p.title || 'Stream schedule'}\n` + slots.map((x) => x.title).join('\n');
        return { week: p.week, text, slots, zone: 'UTC+01:00' };
      }
      case 'cal.schedule.png': CAL.pictures = (CAL.pictures || []).concat([{ name: p.name, bytes: p.data.length, png: p.data.startsWith('data:image/png;base64,') }]); return { path: 'C:\\Users\\me\\Stream schedule.png' };
      case 'cal.agenda': CAL.agendas = (CAL.agendas || []).concat([p]); return { markdown: `## Agenda · from ${p.from}\n\n**Today**\n- 19:00 Test entry\n` };
      case 'cal.note.current': return { path: 'Streams/Plan.md', name: 'Plan' };
      case 'cal.fromText': {
        // A tiny stand-in for the app's parser: "14 Nov 19:00" (this year), else nothing found.
        CAL.fromText = (CAL.fromText || []).concat([p.text]);
        const m = /(\d{1,2}) Nov (\d{2}):(\d{2})/.exec(p.text);
        if (!m) return { found: null };
        const y = new Date().getFullYear();
        return { found: { start: `${y}-11-${m[1].padStart(2, '0')}T${m[2]}:${m[3]}`, end: null, allDay: false, title: p.text.replace(/^.*?\d{2}:\d{2}\s*/, '') } };
      }
      case 'cal.save': {
        const e = JSON.parse(JSON.stringify(p.entry));
        if (!e.id) e.id = 'n' + (CAL.saves.length + 1);
        CAL.saves.push(JSON.parse(JSON.stringify(e)));
        CAL.entries = CAL.entries.filter((x) => x.id !== e.id).concat([e]);
        return { entry: e };
      }
      case 'cal.delete': { const e = CAL.entries.find((x) => x.id === p.id); CAL.deletes.push(p.id); CAL.entries = CAL.entries.filter((x) => x.id !== p.id); return { entry: e || null }; }
      case 'cal.snooze': CAL.snoozes.push({ key: p.key, minutes: p.minutes }); return null;
      case 'cal.dismiss': CAL.dismissed.push(p.key); return null;
      case 'cal.import': {
        CAL.imports++;
        const e = { id: 'imp1', title: 'Imported dentist', notes: '', category: 'appointment', color: '', allDay: false, start: calTime(calAt(1, 9)), end: calTime(calAt(1, 9, 30)), repeat: null, skip: [], moved: [], reminders: [], sinceYear: null, note: null, game: null, platform: null, updated: '' };
        CAL.entries.push(e);
        return { added: 1, notes: ['“Hourly thing” repeats hourly, which NoorMD doesn\'t do: only its first time was kept.'], file: 'google.ics', entries: JSON.parse(JSON.stringify(CAL.entries)) };
      }
      case 'cal.export': CAL.exports.push(p); return { path: 'C:\\Users\\me\\NoorMD calendar.ics', count: CAL.entries.length };
      default: throw new Error('Unknown command ' + type);
    }
  }

  // NoorSequencer: templates are small songs; renders, notes and exports are recorded.
  const seqTrack = (name, kind, instrument, patterns, sequence, extra) => ({ id: '', name, kind, instrument: { wave: 'triangle', pulseWidth: 0.25, detune: 6, octave: 0, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2, cutoff: 8000, resonance: 0.7, filterEnvelope: 0, vibrato: 0, vibratoRate: 5, drumTune: 0, drumDecay: 1, drumTone: 0.5, path: null, sampleName: null, rootNote: 60, loop: false, ...instrument },
    gain: -8, pan: 0, mute: false, solo: false, effects: [], patterns, sequence, ...extra });
  const seqSong = (name, tracks) => ({ version: 1, name, family: 'Exploration', tempo: 96, beatsPerBar: 4, swing: 0, key: 0, scale: 'major', bars: 8, loopStart: 0, loopEnd: 8, masterGain: 0, masterEffects: [], seed: 1, tracks });
  const SEQ = {
    renders: [], notes: [], exports: [], saves: [], picks: 0, opened: 0, mine: [],
    songs: {
      cozy: () => seqSong('Cozy exploration', [
        seqTrack('Melody', 'synth', {}, [{ notes: [{ step: 0, length: 2, pitch: 72, velocity: 0.8 }, { step: 4, length: 4, pitch: 76, velocity: 0.8 }] }, { notes: [{ step: 0, length: 8, pitch: 67, velocity: 0.8 }] }], [1, 2, 1, 2, 1, 2, 1, 2]),
        seqTrack('Drums', 'drums', {}, [{ notes: [{ step: 0, length: 1, pitch: 0, velocity: 0.9 }, { step: 4, length: 1, pitch: 1, velocity: 0.9 }] }], [0, 0, 1, 1, 1, 1, 1, 1]),
      ]),
      adaptive: () => ({ ...seqSong('Adaptive adventure', [
        seqTrack('Pad', 'synth', {}, [{ notes: [{ step: 0, length: 16, pitch: 62, velocity: 0.8 }] }], [1, 1, 1, 1], { inLayers: [] }),
        seqTrack('Bass', 'synth', { octave: -1 }, [{ notes: [{ step: 0, length: 2, pitch: 50, velocity: 0.8 }] }], [1, 1, 1, 1], { inLayers: ['L2', 'L3'] }),
        seqTrack('Battle drums', 'drums', {}, [{ notes: [{ step: 0, length: 1, pitch: 0, velocity: 0.9 }] }], [1, 1, 1, 1], { inLayers: ['L3'] }),
      ]), bars: 4, loopEnd: 4, key: 2, scale: 'minor', layers: [{ id: 'L1', name: 'Exploration' }, { id: 'L2', name: 'Danger' }, { id: 'L3', name: 'Combat' }] }),
      empty: () => seqSong('Untitled song', [seqTrack('Drums', 'drums', {}, [{ notes: [] }], [1, 1, 1, 1, 1, 1, 1, 1]), seqTrack('Lead', 'synth', {}, [{ notes: [] }], [1, 1, 1, 1, 1, 1, 1, 1])]),
    },
  };
  state.seq = SEQ;
  function seqMock(type, p) {
    const mine = () => SEQ.mine.map((x) => ({ id: x.id, name: x.song.name, family: x.song.family, description: `${x.song.bars} bars · ${x.song.tempo} BPM` }));
    switch (type) {
      case 'seq.templates': return { templates: [{ id: 'empty', name: 'Empty song', description: '' }, { id: 'cozy', name: 'Cozy exploration', description: '' }, { id: 'adaptive', name: 'Adaptive adventure', description: '' }], mine: mine(), scales: ['major', 'minor'], kit: ['Kick', 'Snare', 'Clap', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Rim'] };
      case 'seq.template': {
        const own = SEQ.mine.find((x) => x.id === p.id);
        if (own) return JSON.parse(JSON.stringify(own.song));
        if (!SEQ.songs[p.id]) throw new Error('Unknown template.');
        const s = SEQ.songs[p.id](); s.tracks.forEach((t, i) => { t.id = 'K' + (i + 1); }); return s;
      }
      case 'seq.render': {
        SEQ.renders.push(JSON.parse(JSON.stringify(p)));
        const barSeconds = 60 / p.song.tempo * p.song.beatsPerBar;
        const from = p.loop ? p.song.loopStart : p.fromBar || 0, to = p.loop ? p.song.loopEnd : p.song.bars;
        return { url: SEQ.longAudio ? `/_media/9?r=${SEQ.renders.length}` : '/_media/4', seconds: (to - from) * barSeconds, fromBar: from, toBar: to, barSeconds, loop: !!p.loop, cut: false, layer: p.layer || null, peakDb: -3.2, levels: p.song.tracks.filter((t) => !t.mute).map((t, k) => ({ name: t.name, peakDb: -6 - k })).concat((p.song.buses || []).map((b) => ({ name: b.name, peakDb: -18 }))), warnings: p.song.tracks.some((t) => t.kind === 'sample' && !t.instrument.path) ? ['“Sample”: its sample is missing or can\'t be read'] : [] };
      }
      case 'seq.transition': SEQ.transitions = (SEQ.transitions || []).concat([{ from: p.from, to: p.to, fadeBars: p.fadeBars }]); return { url: '/_media/4', seconds: 17.1, switchAt: 8.6, barSeconds: 2.1 };
      case 'seq.loopcheck': SEQ.loopchecks = (SEQ.loopchecks || []).concat([{ layer: p.layer || null }]); return { seconds: 8.571, seamJump: 0.4, tailPercent: 6.2, startDb: -18.5, endDb: -19.1, checks: p.layer === 'L1' ? [] : ['The start and the end differ by 7 dB: the loop may sound like it restarts'], seamUrl: '/_media/4', seamAt: 2 };
      case 'seq.sample.fromSound': SEQ.fromSound = p.id; return { path: 'C:\\Local\\Sequencer\\Samples\\Coin pickup 1A2B3C4D.wav', name: 'Coin pickup.wav', seconds: 0.5 };
      case 'seq.sample.library': return { tracks: [{ id: 7, title: 'Kalimba loop', artist: 'Me', seconds: 4.2 }].filter((x) => !p.search || x.title.toLowerCase().includes(p.search.toLowerCase())) };
      case 'seq.sample.fromLibrary': SEQ.fromLibrary = p.id; return { path: 'D:\\Music\\Kalimba loop.wav', name: 'Kalimba loop.wav', seconds: 4.2 };
      case 'seq.note': SEQ.notes.push({ track: p.track, pitch: p.pitch, pitches: p.pitches, velocity: p.velocity }); return { url: '/_media/4' };
      case 'seq.font.pick': case 'seq.font.presets': {
        SEQ.fonts = (SEQ.fonts || []).concat([{ type, path: p && p.path }]);
        return { path: 'C:\\Fonts\\GeneralUser.sf2', name: 'GeneralUser GS', presets: [{ index: 0, name: 'Grand Piano', bank: 0, program: 0 }, { index: 1, name: 'Strings', bank: 0, program: 48 }, { index: 2, name: 'Standard kit', bank: 128, program: 0 }] };
      }
      case 'seq.sample.pick': SEQ.picks++; return { path: 'C:\\Samples\\kalimba C4.wav', name: 'kalimba C4.wav', seconds: 1.2 };
      case 'seq.export': {
        SEQ.exports.push(JSON.parse(JSON.stringify(p)));
        const f = p.song.name.replace(/[^A-Za-z0-9]+/g, '_');
        return { music: p.musicBench ? 2 : 0, folder: 'D:\\Game\\Music', files: [...(p.parts.mix ? [f + '.wav'] : []), ...(p.parts.loop ? [f + '_loop.wav'] : []), ...(p.parts.midi ? [f + '.mid'] : [])], recipe: f + '.noorsong.json', stems: p.parts.stems ? f + ' stems' : null, warnings: [], project: null, relative: '.' };
      }
      case 'seq.reveal': SEQ.revealed = p.folder; return null;
      case 'seq.save': {
        SEQ.saves.push(JSON.parse(JSON.stringify(p.song)));
        const id = 'user:' + p.song.name + '.json';
        const replaced = SEQ.mine.some((x) => x.id === id);
        SEQ.mine = SEQ.mine.filter((x) => x.id !== id).concat([{ id, song: JSON.parse(JSON.stringify(p.song)) }]);
        return { id, replaced, mine: mine() };
      }
      case 'seq.delete': SEQ.mine = SEQ.mine.filter((x) => x.id !== p.id); return { mine: mine() };
      case 'seq.open': SEQ.opened++; return { song: { ...SEQ.songs.cozy(), name: 'Opened song', tempo: 120 } };
      default: throw new Error('Unknown command ' + type);
    }
  }

  function exportMock(type, p) {
    const all = () => ({ projects: EXP.projects, layouts: LAYOUTS });
    switch (type) {
      case 'export.projects': return all();
      case 'export.project.add': { EXP.added++; const id = 'p' + EXP.added; EXP.projects.push({ id, name: 'My Game', root: 'D:\\Games\\My Game', missing: false }); return { id, all: all() }; }
      case 'export.project.remove': EXP.projects = EXP.projects.filter((x) => x.id !== p.id); return all();
      case 'export.plan': {
        EXP.plans.push(JSON.parse(JSON.stringify(p)));
        const words = (p.name || 'Untitled').split(/[^A-Za-z0-9]+/).filter(Boolean);
        if (p.woodOnly) words.push('Wood');
        const fam = (p.family || 'Custom').split(/[^A-Za-z0-9]+/).filter(Boolean);
        const t = { name: words.join('_'), Name: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(''), name_snake: words.map((w) => w.toLowerCase()).join('_'),
          family: fam.join('_'), Family: fam.map((w) => w[0].toUpperCase() + w.slice(1)).join(''), family_snake: fam.map((w) => w.toLowerCase()).join('_') };
        const l = LAYOUTS.find((x) => x.id === p.layout);
        const pat = l ? l[p.bench] : { folder: p.folderPattern || '', file: p.filePattern || (p.bench === 'sound' ? '{name}_{n}' : p.bench === 'model' ? '{name}' : '{name}_{map}') };
        const fill = (s, more) => s.replace(/\{([^}]+)\}/g, (_, k) => ({ ...t, ...more })[k] ?? '');
        const maps = { generic: ['albedo', 'normal', 'roughness', 'ao', 'metallic', 'height'], unreal: ['basecolor', 'normal', 'orm', 'height'] }[p.target] || ['albedo', 'normal', 'roughness', 'ao', 'metallic', 'height'];
        const codes = { albedo: 'BC', basecolor: 'BC', normal: 'N', orm: 'ORM', height: 'H', roughness: 'R', ao: 'AO', metallic: 'M' };
        const exts = p.format === 'both' ? ['.wav', '.ogg'] : [p.format === 'ogg' ? '.ogg' : '.wav'];
        const files = p.bench === 'model'
          ? (() => { const v = p.variants || 1, first = fill(pat.file) + (v > 1 ? '_01' : '');
              return [...(p.lods > 1 && p.lodFiles !== 'one' ? Array.from({ length: p.lods }, (_, i) => `${first}_LOD${i}.glb`) : [first + '.glb']), t.name + (v > 1 ? '_01' : '') + (p.recipeKind === 'rock' ? '.noorrock.json' : '.noortree.json'),
                ...(v > 1 ? [`… and the same for _02 to _${String(v).padStart(2, '0')}`] : []), t.name + '.manifest.json']; })()
          : p.bench === 'music'
          ? [...exts.flatMap((e) => [...(p.parts && p.parts.mix === false ? [] : [fill(pat.file) + e]), ...(p.parts && p.parts.loop ? [fill(pat.file) + '_loop' + e] : []),
              ...(p.parts && p.parts.layers ? (p.layers || []).map((l) => `${fill(pat.file)}_${l.split(/\s+/).join('_')}_loop${e}`) : [])]), ...(p.parts && p.parts.midi ? [fill(pat.file) + '.mid'] : [])]
          : p.bench === 'sound'
          ? Array.from({ length: Math.min(p.variations || 1, 3) }, (_, i) => exts.map((e) => fill(p.variations > 1 ? pat.file : pat.file.replace(/_\{n\}/, ''), { n: String(i + 1).padStart(2, '0') }) + e)).flat()
          : maps.map((m) => fill(pat.file, { map: m, Map: m[0].toUpperCase() + m.slice(1), MAP: codes[m] }) + '.png');
        const project = EXP.projects.find((x) => x.id === p.project);
        return { project: project ? project.name : null, root: project ? project.root : null, folder: fill(pat.folder, {}), files };
      }
      default: throw new Error('Unknown command ' + type);
    }
  }
  function textureMock(type, p) {
    const builtIn = [{ id: 'bricks-red', family: 'Walls', name: 'Red bricks', description: 'Bricks.' }, { id: 'stone-cobbles', family: 'Stone', name: 'Cobblestones', description: 'Stones.' }, { id: 'metal-brushed', family: 'Metal', name: 'Brushed metal', description: 'Metal.' }];
    const mine = () => TEX.mine.map((x) => ({ id: x.id, family: x.recipe.family, name: x.recipe.name, description: 'Your preset' }));
    switch (type) {
      case 'texture.presets': return { builtIn, mine: mine() };
      case 'texture.preset': {
        const own = TEX.mine.find((x) => x.id === p.id);
        if (own) return JSON.parse(JSON.stringify(own.recipe));
        if (!TEX.recipes[p.id]) throw new Error('Unknown preset.');
        return JSON.parse(JSON.stringify(TEX.recipes[p.id]));
      }
      case 'texture.render': {
        TEX.renders.push({ recipe: JSON.parse(JSON.stringify(p.recipe)), size: p.size });
        const key = 'k' + TEX.renders.length;
        const maps = {}; for (const m of ['albedo', 'normal', 'roughness', 'ao', 'metallic', 'height']) maps[m] = texPng(m, p.recipe.seed);
        const warnings = (p.recipe.layers || []).filter((l) => l.type === 'image' && !/old wall/.test(l.path || '')).map((l) => `“${l.imageName || l.name}”: the picture is missing or can't be read`);
        return { key, size: p.size <= 256 ? 256 : 512, maps, ms: 42, warnings, albedo: { r: 0.3, g: 0.27, b: 0.2, luminance: 0.27 } };
      }
      case 'texture.export': {
        TEX.exports.push({ recipe: JSON.parse(JSON.stringify(p.recipe)), size: p.size, target: p.target, project: p.project || null, layout: p.layout, folderPattern: p.folderPattern, filePattern: p.filePattern,
          skip: p.skip, normal: p.normal, heightBits: p.heightBits, packs: p.packs });
        const stem = p.recipe.name.replace(/ /g, '_');
        const names = { generic: ['albedo', 'normal', 'roughness', 'ao', 'metallic', 'height'], godot: ['albedo', 'normal', 'roughness', 'metallic', 'ao', 'height'], unity: ['albedo', 'normal', 'metallic_smoothness', 'ao', 'height'], unreal: ['basecolor', 'normal', 'orm', 'height'] }[p.target];
        const paintings = (p.recipe.layers || []).filter((l) => l.type === 'painted' && l.path).length;
        return { folder: 'D:\\Game\\Materials', files: names.map((n) => `${stem}_${n}.png`), recipe: stem + '.noortex.json', paintings,
          gallery: p.gallery ? names.length : null, vault: p.vault ? `Materials/${stem}.noortex.json` : null, notes: [] };
      }
      case 'texture.set': {
        TEX.sets = (TEX.sets || []).concat([JSON.parse(JSON.stringify(p))]);
        const names = { 'bricks-red': 'Red bricks', 'stone-cobbles': 'Cobblestones', 'metal-brushed': 'Brushed metal' };
        const lum = { 'bricks-red': 0.21, 'stone-cobbles': 0.18, 'metal-brushed': 0.52 };
        return { done: p.presets.length, total: p.presets.length, folder: 'D:\\Game\\Materials', set: `${p.name}.set.json`, pixelsPerMetre: p.size / p.tileMetres, median: 0.21,
          materials: p.presets.map((id) => ({ name: names[id], luminance: lum[id], note: lum[id] > 0.21 * 1.6 ? 'much brighter than the set' : null })) };
      }
      case 'texture.reveal': TEX.opened = p.folder; return null;
      case 'texture.batch.pick': return { pictures: ['moss', 'rust', 'sand'].map((n) => ({ path: `D:\\Textures\\${n}_albedo.png`, name: `${n}_albedo.png` })) };
      case 'texture.batch.cancel': TEX.batchCancelled = true; return null;
      case 'texture.batch': TEX.batches = (TEX.batches || []).concat([JSON.parse(JSON.stringify(p))]); return { done: p.pictures.length, total: p.pictures.length, cancelled: false, skipped: [], folder: 'D:\\Game\\Materials', folders: p.pictures.length, project: null };
      case 'texture.paint.new': {
        TEX.paintNew = (TEX.paintNew || 0) + 1;
        const name = `${p.recipe.name} painting.noorsketch`;
        return { path: 'C:\\Users\\me\\AppData\\Local\\NoorMD\\Texture\\Paintings\\' + name, name };
      }
      case 'texture.paint.edit': TEX.paintEdits = (TEX.paintEdits || []).concat([{ path: p.path, recipe: JSON.parse(JSON.stringify(p.recipe)) }]); return null;
      case 'texture.image.pick': TEX.imagePicks = (TEX.imagePicks || 0) + 1; return TEX.imageCancel ? { cancelled: true } : { path: 'C:\\Photos\\old wall.jpg', name: 'old wall.jpg', width: 1600, height: 1200 };
      case 'texture.save': { const id = 'user:' + p.recipe.name + '.json'; const replaced = TEX.mine.some((x) => x.id === id); TEX.mine = TEX.mine.filter((x) => x.id !== id).concat([{ id, recipe: p.recipe }]); return { id, replaced, mine: mine() }; }
      case 'texture.delete': TEX.mine = TEX.mine.filter((x) => x.id !== p.id); return { mine: mine() };
      case 'texture.open': return { recipe: { ...JSON.parse(JSON.stringify(TEX.recipes['stone-cobbles'])), name: 'Opened stones' } };
      default: throw new Error('Unknown command ' + type);
    }
  }
  function sndFeedback(lufs, checks) {
    const rows = 16, columns = 40; let bin = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) bin += String.fromCharCode(r === 8 ? 240 : Math.max(0, 120 - Math.abs(r - 8) * 15));
    return { lufs, shortTermMax: lufs + 2, momentaryMax: lufs + 3, truePeakDb: -1.5, samplePeakDb: -1.7, correlation: 0.6, width: 0.5, dcPercent: 0, clipped: 0, centroidHz: 2400, seamJump: 0.3, checks,
      spectrogram: { columns, rows, lowHz: 30, highHz: 20000, data: btoa(bin) } };
  }
  function soundMock(type, p) {
    const builtIn = [{ id: 'wind-forest', family: 'Wind', name: 'Gentle forest breeze', description: 'Soft air through trees.' }, { id: 'rain-steady', family: 'Rain', name: 'Steady rain', description: 'Rain all around.' }, { id: 'ui-coin', family: 'UI', name: 'Coin pickup', description: 'Two notes.' }, { id: 'machine-engine', family: 'Machines', name: 'Engine idle', description: 'A running motor.' }];
    switch (type) {
      case 'sound.presets': return { builtIn, mine: SND.mine.map((x) => ({ id: x.id, family: x.recipe.family, name: x.recipe.name, description: 'Your preset' })),
        categories: [{ id: 'pickup', name: 'Pickup / coin', description: 'Bright.' }, { id: 'footstep', name: 'Footstep', description: 'One step.' }, { id: 'explosion', name: 'Explosion', description: 'Boom.' }] };
      case 'sound.generate': {
        SND.generated = (SND.generated || []).concat([{ category: p.category, seed: p.seed }]);
        const r = JSON.parse(JSON.stringify(SND.recipes['ui-coin']));
        return { ...r, family: 'Generated', name: `${p.category} ${p.seed % 1000}`, seed: p.seed };
      }
      case 'sound.sample.peaks': {
        if (!/door creak/.test(p.path || '')) throw new Error('That file is missing, can\'t be read, or isn\'t one you picked.');
        SND.peaksAsked = (SND.peaksAsked || 0) + 1;
        const peaks = []; for (let i = 0; i < 600; i++) { const v = Math.abs(Math.sin(i / 37)) * (i < 300 ? 0.8 : 0.3); peaks.push(-v, v); }
        return { seconds: 1.8, peaks };
      }
      case 'sound.ir.pick': SND.irPicks = (SND.irPicks || 0) + 1; return SND.irCancel ? { cancelled: true } : { path: 'C:\\IRs\\stairwell.wav', name: 'stairwell', seconds: 2.1 };
      case 'sound.sample.pick': SND.picks = (SND.picks || 0) + 1; return { path: 'C:\\Sounds\\door creak.wav', name: 'door creak.wav', seconds: 1.8 };
      case 'sound.preset': {
        const mine = SND.mine.find((x) => x.id === p.id);
        if (mine) return JSON.parse(JSON.stringify(mine.recipe));
        if (!SND.recipes[p.id]) throw new Error('Unknown preset.');
        return JSON.parse(JSON.stringify(SND.recipes[p.id]));
      }
      case 'sound.render': {
        SND.renders.push(JSON.parse(JSON.stringify(p.recipe)));
        const peaks = []; for (let i = 0; i < 600; i++) { const v = 0.3 + 0.2 * Math.sin(i / 20) * (p.recipe.macros.intensity + 0.2); peaks.push(-v, v); }
        const warnings = p.recipe.layers.filter((l) => l.type === 'sample' && !/door creak/.test(l.path || '')).map((l) => `“${l.sampleName || l.name}”: the file is missing or can't be read`);
        const lufs = p.recipe.master.targetLufs < 0 ? p.recipe.master.targetLufs : Math.round((-20 + p.recipe.macros.intensity * 10) * 10) / 10;
        return { url: '/_media/4', seconds: Math.min(30, p.recipe.duration), peakDb: -6.5 + p.recipe.macros.intensity * 4, rmsDb: -23 + p.recipe.macros.intensity * 6, cut: p.recipe.duration > 30, peaks, warnings, feedback: sndFeedback(lufs, p.recipe.master.gain > 20 ? ['True peak 0.4 dBTP is above the ceiling (−1.0 dB): it may clip once converted'] : []) };
      }
      case 'sound.reference.pick': SND.refPicks = (SND.refPicks || 0) + 1; return { url: '/_media/4', name: 'boss door.wav', seconds: 3, peaks: Array.from({ length: 1200 }, (_, i) => (i % 2 ? 0.7 : -0.7)), feedback: sndFeedback(-12, []) };
      case 'sound.reference.clear': SND.refCleared = (SND.refCleared || 0) + 1; return null;
      case 'sound.export': {
        SND.exports.push({ recipe: JSON.parse(JSON.stringify(p.recipe)), variations: p.variations, sampleRate: p.sampleRate, bits: p.bits, stems: !!p.stems, project: p.project || null, layout: p.layout, format: p.format, oggQuality: p.oggQuality, vault: !!p.vault, musicBench: !!p.musicBench });
        const stem = p.recipe.name.replace(/ /g, '_');
        const files = p.variations > 1 ? Array.from({ length: p.variations }, (_, i) => `${stem}_${String(i + 1).padStart(2, '0')}.wav`) : [stem + '.wav'];
        return { folder: 'D:\\Game\\Audio', files: p.format === 'ogg' ? files.map((f) => f.replace(/\.wav$/, '.ogg')) : files, recipe: stem + '.noorsound.json', stems: p.stems ? files.map((f) => f.replace(/\.wav$/, ' stems')) : [],
          vault: p.vault ? `Sounds/${stem}.noorsound.json` : null, music: p.musicBench ? files.length : 0, notes: [] };
      }
      case 'sound.reveal': if (p.folder !== 'D:\\Game\\Audio') throw new Error('That is not a folder the sounds went to.'); SND.opened = p.folder; return null;
      case 'sound.save': {
        const id = 'user:' + p.recipe.name + '.json';
        const replaced = SND.mine.some((x) => x.id === id);
        SND.mine = SND.mine.filter((x) => x.id !== id).concat([{ id, recipe: JSON.parse(JSON.stringify(p.recipe)) }]);
        return { id, replaced, mine: SND.mine.map((x) => ({ id: x.id, family: x.recipe.family, name: x.recipe.name, description: 'Your preset' })) };
      }
      case 'sound.delete': SND.mine = SND.mine.filter((x) => x.id !== p.id); return { mine: SND.mine.map((x) => ({ id: x.id, family: x.recipe.family, name: x.recipe.name, description: 'Your preset' })) };
      case 'sound.open': return { recipe: { ...JSON.parse(JSON.stringify(SND.recipes['ui-coin'])), name: 'Opened coin' } };
      default: throw new Error('Unknown command ' + type);
    }
  }

  // Radio: stations, the relay (a token and the test tone as the "stream"), and the online directory.
  const RAD = { stations: (initial.radio || []).map((x, i) => ({ id: i + 1, homepage: null, tags: [], favorite: false, added: '2024-01-01T00:00:00Z', lastPlayed: null, plays: 0, ...x })), next: (initial.radio || []).length + 1,
    played: [], stops: 0, searches: [], token: 0, push: (name, payload) => event(name, payload) };
  state.radio = RAD;
  function radioMock(type, p) {
    const list = () => ({ stations: [...RAD.stations].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ ...x, tags: [...x.tags] })) });
    const get = (id) => RAD.stations.find((x) => x.id === id) || (() => { throw new Error('That station is gone.'); })();
    const clean = (u) => { if (!/^https?:\/\/[^\s/@]+(\/|$)/i.test(String(u || '').trim())) throw new Error('A station address starts with http:// or https://.'); return String(u).trim(); };
    switch (type) {
      case 'radio.list': return list();
      case 'radio.add': {
        let url = clean(p.url);
        if (/\.pls$/i.test(url)) url = url.replace(/\.pls$/i, '/stream'); // the playlist is read for the stream address
        const known = RAD.stations.find((x) => x.url.toLowerCase() === url.toLowerCase());
        if (known) return { id: known.id, added: false, ...list() };
        const st = { id: RAD.next++, name: (p.name || '').trim() || new URL(url).host, url, homepage: p.homepage || null, tags: p.tags || [], favorite: false, added: new Date().toISOString(), lastPlayed: null, plays: 0 };
        RAD.stations.push(st);
        return { id: st.id, added: true, ...list() };
      }
      case 'radio.update': { const st = get(p.id); Object.assign(st, { name: p.name.trim() || st.name, url: clean(p.url), homepage: p.homepage || null, tags: p.tags || [] }); return list(); }
      case 'radio.delete': RAD.stations = RAD.stations.filter((x) => x.id !== p.id); return list();
      case 'radio.favorite': get(p.id).favorite = !!p.on; return list();
      case 'radio.play': {
        const url = p.id != null ? get(p.id).url : clean(p.url);
        if (/broken/.test(url)) throw new Error('The station can\'t be reached: no such host.');
        RAD.played.push(p.id != null ? p.id : url);
        if (p.id != null) { const st = get(p.id); st.plays++; st.lastPlayed = new Date().toISOString(); }
        return { token: 't' + (++RAD.token), url: '/_media/4' };
      }
      case 'radio.stop': RAD.stops++; return null;
      case 'radio.import': RAD.stations.push({ id: RAD.next++, name: 'Imported FM', url: 'http://imported.example/s', homepage: null, tags: [], favorite: false, added: '2024-01-01T00:00:00Z', lastPlayed: null, plays: 0 }); return { added: 1, known: 0, ...list() };
      case 'radio.export': return { path: 'C:\\Users\\me\\Radio stations.m3u8', count: RAD.stations.length };
      case 'radio.search': {
        RAD.searches.push(p.query);
        const saved = new Set(RAD.stations.map((x) => x.url.toLowerCase()));
        return [{ name: 'Jazz Radio Kraków', url: 'https://jazz.example/live', homepage: null, tags: ['jazz', 'polish'], country: 'PL', codec: 'MP3', bitrate: 128, hls: false },
          { name: 'Lofi HLS', url: 'https://hls.example/live.m3u8', homepage: null, tags: ['lofi'], country: 'US', codec: 'AAC', bitrate: 64, hls: true }].map((x) => ({ ...x, saved: saved.has(x.url) }));
      }
      default: throw new Error('Unknown command ' + type);
    }
  }

  const HUB = { items: [], launched: [], next: 1, categories: [], view: 'all' };
  state.hub = HUB;
  function appsMock(type, p) {
    const groups = () => [...new Set([...HUB.categories, ...HUB.items.map((i) => i.group)])];
    const keepOrder = () => { HUB.categories = groups(); };
    const payload = () => ({ items: HUB.items.map((i) => ({ ...i })), groups: groups(), view: HUB.view });
    const get = (id) => HUB.items.find((i) => i.id === id) || (() => { throw new Error('That shortcut is no longer in the hub.'); })();
    const item = (o) => ({ id: 'h' + HUB.next++, arguments: null, color: null, icon: null, lastUsed: null, uses: 0, exists: true, ...o });
    switch (type) {
      case 'apps.list': return payload();
      case 'apps.add': {
        const added = p.kind === 'folder' ? [item({ name: 'Projects', kind: 'folder', target: 'C:\\Projects', group: 'Folders' })]
          : [item({ name: 'OBS Studio', kind: 'app', target: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe', group: 'Apps', icon: '/_hubicon/obs.png' }),
            item({ name: 'Dota 2', kind: 'app', target: 'C:\\Users\\me\\Desktop\\Dota 2.url', group: 'Games' })];
        if (p.group) added.forEach((i) => { i.group = p.group; });
        HUB.items.push(...added);
        return { added, hub: payload() };
      }
      case 'apps.addWeb': {
        const m = /^([a-z][a-z0-9+.-]*):/i.exec(String(p.url || '').trim());
        if (!m || !/^[a-z][a-z0-9+.-]*:\/?\/?\S+/i.test(p.url)) throw new Error('That is not a full address (for example https://example.com or steam://rungameid/570).');
        if (['javascript', 'vbscript', 'data', 'file', 'about', 'ms-msdt', 'search-ms', 'shell'].includes(m[1].toLowerCase())) throw new Error(`“${m[1]}:” addresses can't be added to the hub.`);
        const it = item({ name: p.name || new URL(p.url).host.replace('www.', '') || m[1], kind: 'web', target: p.url.trim(), group: p.group || 'Web' });
        HUB.items.push(it);
        return { added: [it], hub: payload() };
      }
      case 'apps.update': { const i = get(p.id); if (p.name) i.name = p.name; if (p.group != null) i.group = p.group || 'Apps'; if (p.arguments != null) i.arguments = p.arguments || null; if (p.url != null && i.kind === 'web') i.target = p.url; return payload(); }
      case 'apps.remove': HUB.items = HUB.items.filter((i) => i.id !== p.id); return payload();
      case 'apps.reorder': { const first = p.ids.map(get); HUB.items = [...first, ...HUB.items.filter((i) => !first.includes(i))]; return payload(); }
      case 'apps.launch': { const i = get(p.id); HUB.launched.push(i.id); i.uses++; i.lastUsed = new Date(Date.now() + HUB.launched.length).toISOString(); return { ...i }; }
      case 'apps.icon.pick': get(p.id).icon = '/_hubicon/custom.png'; return payload();
      case 'apps.icon.reset': get(p.id).icon = null; return payload();
      case 'apps.reveal': return null;
      case 'apps.view': HUB.view = p.view; return { view: HUB.view };
      case 'apps.category.add': { const n = String(p.name || '').trim(); if (!n) throw new Error('Give the category a name.'); keepOrder(); if (!HUB.categories.includes(n)) HUB.categories.push(n); return payload(); }
      case 'apps.category.rename': {
        const n = String(p.name || '').trim(); if (!n) throw new Error('Give the category a name.');
        keepOrder();
        HUB.categories = HUB.categories.includes(n) ? HUB.categories.filter((g) => g !== p.from) : HUB.categories.map((g) => (g === p.from ? n : g));
        HUB.items.forEach((i) => { if (i.group === p.from) i.group = n; });
        if (HUB.view === 'group:' + p.from) HUB.view = 'group:' + n;
        return payload();
      }
      case 'apps.category.remove': {
        const to = p.moveTo || 'Apps'; keepOrder();
        HUB.categories = HUB.categories.filter((g) => g !== p.name);
        HUB.items.forEach((i) => { if (i.group === p.name) i.group = to; });
        if (!HUB.categories.includes(to) && HUB.items.some((i) => i.group === to)) HUB.categories.push(to);
        if (HUB.view === 'group:' + p.name) HUB.view = 'all';
        return payload();
      }
      case 'apps.category.move': { keepOrder(); const i = HUB.categories.indexOf(p.name), j = Math.max(0, Math.min(HUB.categories.length - 1, i + Math.sign(p.by))); [HUB.categories[i], HUB.categories[j]] = [HUB.categories[j], HUB.categories[i]]; return payload(); }
      default: return null;
    }
  }


  // ---- mock voice notes: chunks are joined like VoiceNotes.cs; the first bytes tell the format.
  const VOICE = { armed: 0, saved: [], uploads: {}, recordings: [] };
  state.voice = VOICE;
  // ---- mock Gallery: initial.gallery = number of pictures (in albums "Lato" and "Zima"); slideshows and favourites like GalleryLibrary.
  const GAL = { folders: [], images: [], slideshows: [], next: 1, inserted: [], revealed: [], session: null, scans: 0, extraAlbums: [], moves: [], deleted: [], last: null, renamedAlbums: [], copies: [], movedOut: [], zips: [], editors: [{ name: 'Krita', detected: true }], opened: [], rotations: [], conversions: [] };
  state.gallery = GAL;
  function galAdd(n) {
    for (let i = 0; i < n; i++) {
      const id = GAL.next++;
      const album = i % 3 === 2 ? 'Zima' : 'Lato';
      const psd = id % 5 === 0;
      GAL.images.push({ id, name: `Zdjęcie ${String(id).padStart(3, '0')}`, album, albumKey: 'c:\\pics\\' + album.toLowerCase(), size: 120000 + id, width: 64, height: 48, taken: new Date(Date.UTC(2023, 0, 1) + id * 86400000).toISOString(), favorite: false, fileName: `IMG_${id}.${psd ? 'psd' : 'jpg'}`, folder: 'C:\\Pics\\' + album, format: psd ? 'PSD' : 'JPG', web: !psd, rating: 0, label: null, tags: [] });
    }
  }
  if (initial.gallery) { GAL.folders.push({ id: 1, path: 'C:\\Pics', count: initial.gallery }); galAdd(initial.gallery); }
  function galleryMock(type, p) {
    const status = () => {
      const albums = [...new Set(GAL.images.map((i) => i.albumKey))].map((k) => { const list = GAL.images.filter((i) => i.albumKey === k); return { key: k, name: list[0].album, folder: list[0].folder, count: list.length, coverId: list[0].id }; });
      const formats = [...new Set(GAL.images.map((i) => i.format))].map((f) => ({ format: f, count: GAL.images.filter((i) => i.format === f).length }));
      return { folders: GAL.folders.map((f) => ({ ...f, count: GAL.images.length })), count: GAL.images.length, albums, slideshows: GAL.slideshows.map((s) => ({ id: s.id, name: s.name, count: s.ids.length, settings: s.settings })), scanning: false, formats, editors: GAL.editors.map((e) => ({ ...e })),
        tags: [...new Set(GAL.images.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b)).map((t) => ({ tag: t, count: GAL.images.filter((i) => i.tags.includes(t)).length })),
        months: [...new Set(GAL.images.map((i) => i.taken.slice(0, 7)))].sort().reverse().map((m) => ({ month: m, count: GAL.images.filter((i) => i.taken.startsWith(m)).length })),
        labels: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] };
    };
    const get = (id) => GAL.images.find((i) => i.id === id) || (() => { throw new Error('That picture is no longer in the Gallery.'); })();
    const show = (id) => GAL.slideshows.find((s) => s.id === id) || (() => { throw new Error('That slideshow is gone.'); })();
    switch (type) {
      case 'gallery.status': return status();
      case 'gallery.query': {
        if (p.slideshow) return show(p.slideshow).ids.map(get).map((i) => ({ ...i }));
        let list = GAL.images.filter((i) => (p.filter !== 'favorites' || i.favorite) && (!p.album || i.albumKey === p.album) && (!p.format || i.format === p.format)
          && (i.rating || 0) >= (p.minRating || 0) && (!p.label || i.label === p.label) && (!p.tag || i.tags.some((t) => t.toLowerCase() === p.tag.toLowerCase())) && (!p.month || i.taken.startsWith(p.month)));
        if (p.search) { const t = p.search.toLowerCase(); list = list.filter((i) => (i.name + ' ' + i.album).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').includes(t)); }
        const key = p.sort === 'name' ? (i) => i.name : p.sort === 'type' ? (i) => i.format + i.name : p.sort === 'size' ? (i) => String(i.size).padStart(12, '0') : p.sort === 'added' ? (i) => String(i.id).padStart(6, '0') : p.sort === 'rating' ? (i) => String(i.rating || 0) + i.taken : (i) => i.taken;
        list.sort((a, b) => key(a).localeCompare(key(b)) * (p.descending ? -1 : 1));
        return list.map((i) => ({ ...i }));
      }
      case 'gallery.addFolder': GAL.folders.push({ id: GAL.folders.length + 1, path: 'C:\\Pics' }); galAdd(5); return status();
      case 'gallery.removeFolder': GAL.folders = GAL.folders.filter((f) => f.id !== p.id); GAL.images = []; return status();
      case 'gallery.rescan': GAL.scans++; return status();
      case 'gallery.favorite': p.ids.forEach((id) => { get(id).favorite = !!p.on; }); return null;
      case 'gallery.insert': GAL.inserted.push(p.id); return { inserted: true, document: 'x.md' };
      case 'gallery.reveal': GAL.revealed.push(p.id); return null;
      case 'gallery.slideshow.create': { const name = String(p.name || '').trim(); if (!name) throw new Error('Give the slideshow a name.'); const id = GAL.slideshows.length + 1; GAL.slideshows.push({ id, name, ids: p.ids.filter((x) => GAL.images.some((i) => i.id === x)), settings: p.settings || {} }); return { id, status: status() }; }
      case 'gallery.slideshow.update': { const s = show(p.id); if (p.name) s.name = p.name.trim(); if (p.settings) s.settings = p.settings; if (p.ids) s.ids = [...p.ids]; return status(); }
      case 'gallery.slideshow.add': { const s = show(p.id); p.ids.forEach((x) => { if (!s.ids.includes(x)) s.ids.push(x); }); return status(); }
      case 'gallery.slideshow.delete': GAL.slideshows = GAL.slideshows.filter((s) => s.id !== p.id); return status();
      case 'gallery.places': return [{ path: 'C:\\Pics', label: 'Pics', key: 'c:\\pics' }, { path: 'C:\\Pics\\Lato', label: 'Pics/Lato', key: 'c:\\pics\\lato' }, { path: 'C:\\Pics\\Zima', label: 'Pics/Zima', key: 'c:\\pics\\zima' }, ...GAL.extraAlbums.map((a) => ({ path: 'C:\\Pics\\' + a, label: 'Pics/' + a, key: 'c:\\pics\\' + a.toLowerCase() }))];
      case 'gallery.album.create': { const n = String(p.name || '').trim(); if (!n || GAL.extraAlbums.includes(n)) throw new Error('That is not a valid folder name.'); GAL.extraAlbums.push(n); return { path: 'C:\\Pics\\' + n, key: 'c:\\pics\\' + n.toLowerCase() }; }
      case 'gallery.rename': { const i = get(p.id); const n = String(p.name).trim(); if (GAL.images.some((x) => x !== i && x.name === n && x.album === i.album)) throw new Error(`A file named "${n}.jpg" already exists in this folder. Nothing was renamed.`); GAL.last = [{ id: i.id, name: i.name, album: i.album, albumKey: i.albumKey }]; i.name = n; return { status: status(), undo: true }; }
      case 'gallery.renameSeries': { GAL.last = p.ids.map((id) => { const i = get(id); return { id, name: i.name, album: i.album, albumKey: i.albumKey }; }); p.ids.forEach((id, k) => { get(id).name = `${p.name.trim()} ${String(k + 1).padStart(2, '0')}`; }); return { status: status(), undo: true }; }
      case 'gallery.move': { const album = p.folder.split('\\').pop(); GAL.last = p.ids.map((id) => { const i = get(id); return { id, name: i.name, album: i.album, albumKey: i.albumKey }; }); p.ids.forEach((id) => { const i = get(id); i.album = album; i.albumKey = 'c:\\pics\\' + album.toLowerCase(); }); GAL.moves.push({ ids: [...p.ids], folder: p.folder }); return { moved: p.ids.length, status: status(), undo: true }; }
      case 'gallery.undo': { if (!GAL.last) throw new Error('There is nothing to undo.'); GAL.last.forEach((b) => Object.assign(get(b.id), { name: b.name, album: b.album, albumKey: b.albumKey })); const n = GAL.last.length; GAL.last = null; return { restored: n, status: status() }; }
      case 'gallery.delete': { GAL.images = GAL.images.filter((i) => !p.ids.includes(i.id)); GAL.deleted.push(...p.ids); return { deleted: p.ids.length, status: status() }; }
      case 'gallery.album.rename': { const a = p.folder.split('\\').pop(); const n = p.name.trim(); GAL.images.filter((i) => i.album === a).forEach((i) => { i.album = n; i.albumKey = 'c:\\pics\\' + n.toLowerCase(); i.folder = 'C:\\Pics\\' + n; }); GAL.renamedAlbums.push([a, n]); return { path: 'C:\\Pics\\' + n, key: 'c:\\pics\\' + n.toLowerCase(), status: status(), undo: true }; }
      case 'gallery.revealFolder': GAL.revealed.push(p.folder); return null;
      case 'gallery.copyTo': GAL.copies.push([...p.ids]); return { count: p.ids.length, folder: 'D:\\Export', inside: false, status: status(), undo: false };
      case 'gallery.moveTo': GAL.images = GAL.images.filter((i) => !p.ids.includes(i.id)); GAL.movedOut.push(...p.ids); return { count: p.ids.length, folder: 'D:\\Elsewhere', inside: false, status: status(), undo: true };
      case 'gallery.zip': GAL.zips.push({ ids: [...p.ids], name: p.name }); return { path: 'D:\\' + p.name + '.zip', count: p.ids.length };
      case 'gallery.editors': return GAL.editors;
      case 'gallery.editor.add': GAL.editors.push({ name: 'Affinity Photo 2', detected: false }); return { editors: GAL.editors };
      case 'gallery.editor.remove': GAL.editors.splice(p.index, 1); return { editors: GAL.editors };
      case 'gallery.openWith': GAL.opened.push({ ids: [...p.ids], how: p.how, editor: p.editor }); return null;
      case 'gallery.toTexture': GAL.toTexture = (GAL.toTexture || []).concat([[...p.ids]]); GAL.toTextureMany = !!p.many; return { pictures: p.ids.map(get).map((i) => ({ path: `C:\\Pics\\${i.name}.jpg`, name: i.name + '.jpg', width: 1600, height: 1200 })), skipped: [] };
      case 'gallery.duplicates': { const by = new Map(); GAL.images.forEach((i) => { const k = i.id % 4; by.set(k, [...(by.get(k) || []), i]); }); return [...by.values()].filter((g) => g.length > 1).slice(0, 2).map((g) => ({ kind: 'same', items: g.slice(0, 3).map((i) => ({ ...i })) })); }
      case 'gallery.rating': p.ids.forEach((id) => { get(id).rating = Math.max(0, Math.min(5, p.stars)); }); return null;
      case 'gallery.label': if (p.label && !['red', 'orange', 'yellow', 'green', 'blue', 'purple'].includes(p.label)) throw new Error('Unknown colour label.'); p.ids.forEach((id) => { get(id).label = p.label || null; }); return null;
      case 'gallery.tags.add': p.ids.forEach((id) => { const i = get(id); p.tags.forEach((t) => { const known = GAL.images.flatMap((x) => x.tags).find((x) => x.toLowerCase() === t.toLowerCase()) || t; if (!i.tags.some((x) => x.toLowerCase() === t.toLowerCase())) i.tags.push(known); }); }); return { status: status(), images: p.ids.map(get).map((i) => ({ ...i, tags: [...i.tags] })) };
      case 'gallery.tags.remove': p.ids.forEach((id) => { const i = get(id); i.tags = i.tags.filter((x) => x.toLowerCase() !== p.tag.toLowerCase()); }); return { status: status(), images: p.ids.map(get).map((i) => ({ ...i, tags: [...i.tags] })) };
      case 'gallery.rotate': {
        const ok = p.ids.map(get).filter((i) => i.format !== 'PSD');
        const refused = p.ids.map(get).filter((i) => i.format === 'PSD').map((i) => `${i.fileName}: This format can't be turned here; turn it in your picture editor.`);
        if (!ok.length && refused.length) throw new Error(refused[0]);
        ok.forEach((i) => { [i.width, i.height] = [i.height, i.width]; GAL.rotations.push({ id: i.id, clockwise: p.clockwise !== false }); });
        return { images: ok.map((i) => ({ ...i, tags: [...i.tags] })), refused };
      }
      case 'gallery.convert': {
        GAL.conversions.push({ ...p, ids: [...p.ids] });
        const ok = p.ids.filter((id) => get(id).format !== 'PSD');
        const failed = p.ids.filter((id) => get(id).format === 'PSD').map((id) => `${get(id).fileName}: Windows can't read this format here; export it from its program.`);
        if (!ok.length && failed.length) throw new Error(failed[0]);
        return { count: ok.length, folder: p.where === 'beside' ? null : 'D:\\Web', failed, inside: false, status: status() };
      }
      case 'gallery.convert.reveal': GAL.revealed.push(p.folder); return null;
      case 'gallery.session.get': return GAL.session;
      case 'gallery.session.save': GAL.session = p.state; return null;
      default: return null;
    }
  }

  function voiceMock(type, p) {
    const status = () => ({ folder: 'C:\\Vaults\\Atlas\\attachments\\Voice notes', inVault: true, recordings: VOICE.recordings.slice() });
    switch (type) {
      case 'voice.status': return status();
      case 'voice.arm': VOICE.armed++; return null;
      case 'voice.begin': { const token = 't' + Object.keys(VOICE.uploads).length + Date.now(); VOICE.uploads[token] = { name: p.name, ext: p.ext, parts: [] }; return { token }; }
      case 'voice.chunk': VOICE.uploads[p.token].parts.push(p.data); return null;
      case 'voice.cancel': delete VOICE.uploads[p.token]; return null;
      case 'voice.finish': {
        const u = VOICE.uploads[p.token]; delete VOICE.uploads[p.token];
        const bytes = u.parts.map((b) => atob(b)).join('');
        const name = u.name || `Voice note ${VOICE.saved.length + 1}`;
        const file = name + u.ext;
        VOICE.saved.push({ name, ext: u.ext, size: bytes.length, head: [...bytes.slice(0, 4)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''), seconds: p.seconds });
        VOICE.recordings.unshift({ name, file, size: bytes.length, created: new Date().toISOString(), url: '/_voice/' + encodeURIComponent(file) });
        const sec = Math.floor(p.seconds || 0);
        return { path: 'C:\\Vaults\\Atlas\\attachments\\Voice notes\\' + file, name, link: `[🎙 ${name} (${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')})](<attachments/Voice notes/${file}>)`, status: status() };
      }
      case 'voice.delete': VOICE.recordings = VOICE.recordings.filter((r) => r.file !== p.file); return status();
      case 'voice.link': return { link: `[🎙 ${p.file}](<attachments/Voice notes/${p.file}>)` };
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
      case 'video.playlist.items': return [...VID.playlists.find((x) => x.id === p.id).ids];
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
      case 'music.playlists': return lib.playlists.map((x) => ({ id: x.id, name: x.name, count: x.items.length }));
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
        case 'sketch.save': state.saved = p; state.saveCount++;
          if (initial.ready && initial.ready.texture) return reply(m.id, true, { path: initial.ready.file.path, name: initial.ready.file.name, applied: true });
          return reply(m.id, true, { path: 'C:\\Sketches\\idea.noorsketch', name: 'idea' });
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
        case 'video.get': return reply(m.id, true, { video: video(p.id), subtitles: [], notes: p.id === 7 ? [{ id: 5, time: 1.8, text: 'Ujęcie z drona' }] : [], next: p.id === 7 ? video(8) : null, exists: true });
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
