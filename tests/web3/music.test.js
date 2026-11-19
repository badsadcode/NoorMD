// NoorMD 3.0's Music bench, tested in Chromium inside the real shell page. The C# side is a stand-in (a small library
// in localStorage); the audio is real: the test server answers /media/noor.music/track/<id> with a short WAV, so the
// player really plays, pauses and moves on.
// Run: node tests/web3/music.test.js [--screenshots dir]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'web', 'node_modules', 'playwright'));

const ROOT = path.join(__dirname, '..', '..');
const MOUNTS = [['/ui/', 'src/Noor.UI/'], ['/benches/noor.markdown/', 'src/Benches/Markdown/Markdown.Bench/web/'], ['/benches/noor.music/', 'src/Benches/Music/Music.Bench/web/'], ['/', 'src/NoorMD3/wwwroot/']];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const MARKDOWN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'markdown.manifest.json'), 'utf8'));
const MUSIC = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'music.manifest.json'), 'utf8'));
const shotsAt = process.argv.indexOf('--screenshots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

let failed = 0, passed = 0;
function check(name, ok, extra) {
  if (ok) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
/** A real WAV: a quiet tone, 8 kHz mono, so the player has something to play (and to measure). */
function wav(seconds) {
  const rate = 8000, n = Math.round(rate * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 3000), 44 + i * 2);
  return b;
}
const AUDIO = wav(4);
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url.startsWith('/media/noor.music/track/')) { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': AUDIO.length }); res.end(AUDIO); return; }
    if (url.startsWith('/media/')) { res.writeHead(404); res.end(); return; }
    const m = MOUNTS.find(([p]) => url.startsWith(p));
    const file = path.join(ROOT, m[1], url.slice(m[0].length) || 'index.html');
    if (!file.startsWith(path.join(ROOT, m[1])) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const MOCK = (manifests) => {
  const listeners = [];
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch { return d; } };
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const defaults = { theme: 'dark', menuPosition: 'title', density: {}, openBenches: ['noor.music', 'noor.markdown'], activeBench: 'noor.music', layouts: {}, welcomed: true };
  const send = (data) => setTimeout(() => listeners.forEach((fn) => fn({ data })), 5);
  const TRACKS = [
    { id: 1, displayTitle: 'Analytical Engine', title: 'Analytical Engine', artist: 'Ada', album: 'Notes', genre: 'Ambient', year: 1843, duration: 4, triage: 0, plays: 3 },
    { id: 2, displayTitle: 'Bernoulli Numbers', title: 'Bernoulli Numbers', artist: 'Ada', album: 'Notes', genre: 'Ambient', year: 1843, duration: 4, triage: 0, plays: 0 },
    { id: 3, displayTitle: 'Cogs and Wheels', title: 'Cogs and Wheels', artist: 'Babbage', album: 'Difference', genre: 'Industrial', year: 1822, duration: 4, triage: 0, plays: 1 },
    { id: 4, displayTitle: 'Differences', title: 'Differences', artist: 'Babbage', album: 'Difference', genre: 'Industrial', year: 1822, duration: 4, triage: 0, plays: 0 },
    { id: 5, displayTitle: 'Every Punch Card', title: 'Every Punch Card', artist: 'Jacquard', album: 'Loom', genre: 'Folk', year: 1804, duration: 4, triage: 0, plays: 7 },
  ].map((t) => ({ ...t, folder: 'C:\\Music', fileName: t.displayTitle + '.mp3' }));
  const lib = () => get('mock.music', { tracks: TRACKS, playlists: [], smart: [], folders: [{ id: 1, path: 'C:\\Music', tracks: 5 }], session: null, undo: null });
  const save = (l) => put('mock.music', l);
  const ev = (name, payload) => send({ event: 'bench', bench: 'noor.music', name, payload: payload || {} });
  window.__ev = ev;
  const stats = (l) => ({ total: l.tracks.length, missing: 0, favorite: l.tracks.filter((t) => t.triage === 1).length, keep: l.tracks.filter((t) => t.triage === 2).length, maybe: l.tracks.filter((t) => t.triage === 3).length, skip: l.tracks.filter((t) => t.triage === 4).length, untriaged: l.tracks.filter((t) => !t.triage).length });
  const smartFilter = (sc) => (t) => sc.rules.every((r) => r.field !== 'triage' || (r.op === 'is' ? t.triage === Number(r.value) : t.triage !== Number(r.value)));
  const smartList = (l) => (l.smart || []).map((sc) => ({ ...sc, count: l.tracks.filter(smartFilter(sc)).length }));
  const rowsFor = (l, a) => {
    if (a.smartId != null) { const sc = (l.smart || []).find((x) => x.id === a.smartId); return sc ? l.tracks.filter(smartFilter(sc)) : []; }
    let rows = a.playlistId != null ? ((l.playlists.find((p) => p.id === a.playlistId) || { ids: [] }).ids.map((id) => l.tracks.find((t) => t.id === id)).filter(Boolean)) : l.tracks.slice();
    if (a.search) rows = rows.filter((t) => (t.displayTitle + ' ' + t.artist + ' ' + t.album).toLowerCase().includes(a.search.toLowerCase()));
    if (a.triage != null) rows = rows.filter((t) => t.triage === a.triage);
    const key = { title: 'displayTitle', artist: 'artist', album: 'album', duration: 'duration' }[a.sort];
    if (key && a.sort !== 'playlist') rows.sort((x, y) => String(x[key]).localeCompare(String(y[key])) || x.id - y.id);
    if (a.desc) rows.reverse();
    return rows;
  };
  const answer = (m) => {
    const a = m.args || {};
    if (m.target === 'shell' && m.cmd === 'start') return { version: '3.0.11', contract: 1, settings: get('mock.settings', defaults), benches: manifests, problems: [] };
    if (m.target === 'shell' && m.cmd === 'settings.save') { put('mock.settings', a); return a; }
    if (m.target === 'shell' && m.cmd === 'settings.patch') { const cur = get('mock.settings', defaults); for (const [k, v] of Object.entries(a)) { if (k === 'layouts') cur.layouts = { ...(cur.layouts || {}), ...v }; else cur[k] = v; } put('mock.settings', cur); return cur; }
    if (m.target === 'shell' && m.cmd === 'settings.get') return get('mock.settings', defaults);
    if (m.target === 'window') return null;
    if (m.target === 'bench:noor.markdown') return m.cmd === 'md.recentList' || m.cmd === 'md.drafts' || m.cmd === 'md.snapList' ? [] : null;
    if (m.target !== 'bench:noor.music') throw new Error(`no ${m.target} ${m.cmd}`);
    const l = lib();
    switch (m.cmd) {
      case 'music.status': return { folders: l.folders, stats: stats(l), playlists: l.playlists.map((p) => ({ id: p.id, name: p.name, count: p.ids.length })), smart: smartList(l), undo: l.undo, scanning: !!window.__scanning, lastScan: window.__lastScan || null };
      case 'music.cancelScan': window.__cancelled = true; return null;
      case 'music.query': { const rows = rowsFor(l, a); return { total: rows.length, offset: a.offset || 0, rows: rows.slice(a.offset || 0, (a.offset || 0) + (a.limit || 200)) }; }
      case 'music.ids': return rowsFor(l, a).map((t) => t.id);
      case 'music.tracks': return (a.ids || []).map((id) => l.tracks.find((t) => t.id === id)).filter(Boolean);
      case 'music.setTriage': for (const t of l.tracks) if (a.ids.includes(t.id)) t.triage = a.value; save(l); ev('triage', { ids: a.ids, value: a.value }); return stats(l);
      case 'music.played': (window.__played = window.__played || []).push(a.id); return null;
      case 'music.playlists': return l.playlists.map((p) => ({ id: p.id, name: p.name, count: p.ids.length }));
      case 'music.playlist.create': { const id = l.playlists.length + 1; l.playlists.push({ id, name: a.name, ids: a.ids || [] }); save(l); ev('playlists'); return { id }; }
      case 'music.playlist.add': { const p = l.playlists.find((x) => x.id === a.id); p.ids.push(...a.ids); save(l); ev('playlists'); return l.playlists.map((x) => ({ id: x.id, name: x.name, count: x.ids.length })); }
      case 'music.track': { const t = l.tracks.find((x) => x.id === a.id); return { ...t, tags: { title: t.title, artist: t.artist, album: t.album, albumArtist: null, genre: t.genre, year: t.year, trackNumber: null, comment: null } }; }
      case 'music.edit.validate': return /[\\/:*?"<>|]/.test(a.fileName || '') ? ['A file name can\'t contain \\ / : * ? " < > |'] : [];
      case 'music.edit.apply': {
        const t = l.tracks.find((x) => x.id === a.id);
        (window.__edits = window.__edits || []).push(a);
        const old = t.fileName;
        if (a.updateTags && a.tags) { Object.assign(t, a.tags); if (a.tags.title) t.displayTitle = a.tags.title; }
        if (a.rename) t.fileName = a.fileName;
        l.undo = { id: 1, oldName: old, newName: t.fileName };
        save(l); ev('changed', { trackId: t.id });
        return { ok: true, tagsSaved: !!a.updateTags, renamed: !!a.rename, problems: [], track: { ...t, tags: { title: t.title, artist: t.artist, album: t.album, genre: t.genre, year: t.year } }, undo: l.undo };
      }
      case 'music.undo': window.__undone = true; l.undo = null; save(l); ev('changed'); return { ok: true, problems: [], undo: null };
      case 'music.suggestName': return [a.artist, a.title].filter(Boolean).join(' - ');
      case 'music.smart.count': return l.tracks.filter(smartFilter(a.rules)).length;
      case 'music.smart.save': { l.smart = l.smart || []; const id = a.id || l.smart.length + 1; l.smart = l.smart.filter((x) => x.id !== id).concat([{ id, name: a.name, ...a.rules }]); save(l); return { id, smart: smartList(l) }; }
      case 'music.smart.delete': l.smart = (l.smart || []).filter((x) => x.id !== a.id); save(l); return smartList(l);
      case 'music.batch.preview': {
        const pre = (a.spec.rename && a.spec.rename.enabled && a.spec.rename.prefix) || '';
        const items = a.ids.map((id) => { const t = l.tracks.find((x) => x.id === id); return { id, folder: t.folder, oldName: t.fileName, newName: pre + t.fileName, renames: !!pre, ok: true, tags: [], problems: [], warnings: [] }; });
        const n = items.filter((i) => i.renames).length;
        return { willChange: n, unchanged: items.length - n, blocked: 0, items };
      }
      case 'music.batch.apply': {
        const pre = (a.spec.rename && a.spec.rename.enabled && a.spec.rename.prefix) || '';
        window.__batch = a;
        const items = a.ids.map((id) => { const t = l.tracks.find((x) => x.id === id); const old = t.fileName; t.fileName = pre + old; return { id, oldName: old, newName: t.fileName, status: 'done', message: null }; });
        l.undo = { id: 2, batchId: 9, count: items.length }; save(l); ev('changed');
        return { batchId: 9, done: items.length, failed: 0, skipped: 0, items, undo: l.undo };
      }
      case 'music.batch.undo': window.__batchUndone = a.batchId; l.undo = null; save(l); ev('changed'); return { done: 5, failed: 0, skipped: 0, items: [], undo: null };
      case 'music.playlist.rename': { const p = l.playlists.find((x) => x.id === a.id); p.name = a.name; save(l); ev('playlists'); return null; }
      case 'music.playlist.delete': l.playlists = l.playlists.filter((x) => x.id !== a.id); save(l); ev('playlists'); return null;
      case 'music.playlist.setItems': { const p = l.playlists.find((x) => x.id === a.id); p.ids = a.ids.slice(); save(l); ev('playlists'); return null; }
      case 'music.reveal': return null;
      case 'music.session.get': return l.session;
      case 'music.session.save': l.session = a.session; save(l); return null;
      case 'music.loudness.unmeasured': return (a.ids || l.tracks.map((t) => t.id)).filter((id) => { const t = l.tracks.find((x) => x.id === id); return t && t.loudness == null; });
      case 'music.loudness.set': { const t = l.tracks.find((x) => x.id === a.id); t.loudness = a.lufs; t.peak = a.peak; save(l); (window.__measured = window.__measured || []).push(a.id); return null; }
      default: throw new Error(`no ${m.cmd}`);
    }
  };
  window.chrome = { webview: {
    postMessage(m) { let reply; try { reply = { id: m.id, ok: true, result: answer(m) }; } catch (e) { reply = { id: m.id, ok: false, error: e.message }; } send(reply); },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
  } };
};

async function waitFn(page, fn, arg, timeout = 8000) { await page.waitForFunction(fn, arg, { timeout }); }

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
    await context.addInitScript(MOCK, [MUSIC, MARKDOWN]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const B = 'section.bench[data-bench="noor.music"] .nm';       // the bench's tab
    const P = '.nm.in-panel';                                     // the Music panel (beside Markdown)
    const eng = () => page.evaluate(() => { const e = window.__noor.open.get('noor.music').module._engine(); const s = e._state(); return { ...s, track: s.track && s.track.displayTitle, paused: e._audio.paused, at: e._audio.currentTime }; });
    const titles = () => page.$$eval(`${B} .music-list .track .track-title`, (xs) => xs.map((x) => x.textContent));
    const upNext = (sel) => page.$$eval(`${sel} .qitem:not(.current):not(.past) .qtitle`, (xs) => xs.map((x) => x.textContent));
    const dlg = '.nm-dialog';

    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector(`${B} .music-list .track .track-title`);

    // ---------------------------------------------------------------- the library, as in NoorMD 2.0
    check('the Music bench with room: the player card and Up next on the left, the library as a table on the right', await page.isVisible(`${B}.wide .nowplaying`) && await page.isVisible(`${B} .music-side`) && await page.isVisible(`${B} .music-cols .col.c-artist`));
    check('…sorted by title', (await titles()).join('|') === 'Analytical Engine|Bernoulli Numbers|Cogs and Wheels|Differences|Every Punch Card', await titles());
    check('…one line per track: artist, album, genre, year, plays, time', (await page.textContent(`${B} .track[data-id="5"] .c-genre`)) === 'Folk' && (await page.textContent(`${B} .track[data-id="5"] .c-plays`)) === '7' && (await page.textContent(`${B} .track[data-id="5"] .c-time`)) === '0:04');
    check('…the mark chips, with counts', (await page.textContent(`${B} .music-chips .chip.active`)).replace(/\s+/g, ' ').trim() === 'All 5');
    check('…the tabs: Library / Playlists / Sound (Up next is on the left)', await page.isVisible(`${B} .music-tabs button[data-tab="library"].active`) && await page.isHidden(`${B} .music-tabs button[data-tab="queue"]`));

    // ---------------------------------------------------------------- looking through the folders
    check('no scan banner when nothing is going on', await page.isHidden(`${B} .mu-scan`));
    await page.evaluate(() => { window.__scanning = true; window.__ev('scan', { folderId: 1, phase: 'discovering', discovered: 500, processed: 0, errors: 0 }); });
    await waitFn(page, (b) => { const n = document.querySelector(b + ' .mu-scan'); return n && !n.hidden && /Finding your music… 500 files/.test(n.textContent); }, B);
    check('while finding files: a banner with the count, a moving bar and Stop', await page.isVisible(`${B} .mu-scan .mu-scan-bar.busy`) && await page.isVisible(`${B} .mu-scan button:text-is("Stop")`));
    await page.evaluate(() => window.__ev('scan', { folderId: 1, phase: 'indexing', discovered: 9298, processed: 3120, errors: 2 }));
    await waitFn(page, (b) => /3,120 of 9,298 · 2 unreadable/.test(document.querySelector(b + ' .mu-scan').textContent), B);
    const pct = await page.$eval(`${B} .mu-scan-bar i`, (i) => i.style.width);
    check('while reading: "3,120 of 9,298", a bar that fills (34%), and the same in the status bar', pct === '34%' && /3,120 of 9,298/.test(await page.textContent('#status-bench')), [pct, await page.textContent('#status-bench')]);
    await page.click(`${B} .mu-scan button:text-is("Stop")`);
    check('…Stop asks the library to stop', await page.evaluate(() => window.__cancelled === true));
    await page.evaluate(() => { window.__scanning = false; window.__lastScan = { phase: 'done', discovered: 9298, added: 9296, errors: 2, message: '“broken.mp3”: Bad header' }; window.__ev('scan', { folderId: 1, phase: 'done', discovered: 9298, processed: 9298, errors: 2, message: '“broken.mp3”: Bad header' }); });
    await waitFn(page, (b) => { const n = document.querySelector(b + ' .mu-scan'); return n.classList.contains('note') && !n.hidden; }, B);
    const note = await page.textContent(`${B} .mu-scan`);
    check('afterwards: a note saying which files couldn\'t be read and why', /2 files couldn't be read \(the first: “broken.mp3”: Bad header\)/.test(note), note);
    await page.click(`${B} .mu-scan .nui-icon`);
    check('…which can be closed', await page.isHidden(`${B} .mu-scan`));
    await page.evaluate(() => { window.__lastScan = null; window.__ev('scan', { folderId: 1, phase: 'done', discovered: 5, processed: 5, errors: 0 }); });
    await page.waitForTimeout(400);
    check('a scan that went fine leaves no note', await page.isHidden(`${B} .mu-scan`));

    // ---------------------------------------------------------------- sorting and searching
    await page.click(`${B} .music-cols .col.c-artist`);
    await page.waitForTimeout(250);
    const byArtist = await page.$$eval(`${B} .music-list .track .c-artist`, (xs) => xs.map((x) => x.textContent));
    await page.click(`${B} .music-cols .col.c-artist`);
    await page.waitForTimeout(250);
    const back = await page.$$eval(`${B} .music-list .track .c-artist`, (xs) => xs.map((x) => x.textContent));
    check('a column head sorts by it (twice: the other way round)', byArtist[0] === 'Ada' && back[0] === 'Jacquard', [byArtist, back]);
    await page.click(`${B} .music-cols .col.c-title`);
    await page.fill(`${B} .music-search`, 'babb');
    await page.waitForTimeout(450);
    check('search finds by artist', (await titles()).join('|') === 'Cogs and Wheels|Differences', await titles());
    await page.fill(`${B} .music-search`, '');
    await page.waitForTimeout(450);

    // ---------------------------------------------------------------- playing
    await page.dblclick(`${B} .track[data-id="2"]`);
    await waitFn(page, () => { const e = window.__noor.open.get('noor.music').module._engine(); return e && !e._audio.paused && e._audio.currentTime > 0.2; });
    let s = await eng();
    check('double-click: it plays (really: the audio runs), the list from there on is the queue', s.track === 'Bernoulli Numbers' && !s.paused && s.queue.total === 5 && s.queue.pos === 1, s);
    await page.waitForSelector(`${B} .track.playing`);
    check('…the playing track is marked in the list', (await page.textContent(`${B} .track.playing .track-title`)) === 'Bernoulli Numbers');
    await page.waitForSelector(`${B} .np-title:text-is("Bernoulli Numbers")`);
    check('…the player card shows it (artist — album)', (await page.textContent(`${B} .np-sub`)) === 'Ada — Notes');
    await page.waitForSelector('#bottombar:not([hidden]) .nm-mini');
    check('…the mini player along the bottom shows it', (await page.textContent('#bottombar .mp-title')) === 'Bernoulli Numbers');
    await page.waitForFunction((b) => Number(document.querySelector(b + ' .np-range').value) > 0, B);
    check('…its position moves', Number(await page.inputValue(`${B} .np-range`)) > 0);
    check('Up next (on the left) lists what comes after it', (await upNext(`${B} .side-queue`)).join('|') === 'Cogs and Wheels|Differences|Every Punch Card', await upNext(`${B} .side-queue`));
    await page.click(`${B} .tp.next`);
    await waitFn(page, () => window.__noor.open.get('noor.music').module._engine()._state().track.displayTitle === 'Cogs and Wheels');
    check('⏭ Next: the next track', (await eng()).track === 'Cogs and Wheels');
    await page.waitForFunction((b) => document.querySelectorAll(b + ' .side-queue .qitem.past').length === 2 && !/…/.test(document.querySelector(b + ' .side-queue').textContent), B);
    check('…and the ones before show as played', (await page.$$eval(`${B} .side-queue .qitem.past .qtitle`, (xs) => xs.map((x) => x.textContent))).join('|') === 'Analytical Engine|Bernoulli Numbers', await page.$$eval(`${B} .side-queue .qitem`, (xs) => xs.map((x) => x.className + ':' + x.textContent)));
    await page.hover(`${B} .side-queue .qitem:has-text("Every Punch Card")`);
    await page.click(`${B} .side-queue .qitem:has-text("Every Punch Card") button[aria-label="Take it out of Up next"]`);
    await page.waitForTimeout(200);
    check('Up next: ✕ takes a track out', !(await upNext(`${B} .side-queue`)).includes('Every Punch Card') && (await eng()).queue.total === 4);
    check('shuffle looks like repeat: off, an outlined round button', (await page.getAttribute(`${B} .tp.shuffle`, 'aria-pressed')) === 'false');

    // ---------------------------------------------------------------- marks and playlists
    await page.click(`${B} .track[data-id="1"]`);
    await page.keyboard.press('1');
    await page.waitForSelector(`${B} .track[data-id="1"] .track-triage:text-is("★")`);
    check('1 on a selected track: ★ Favourite (in the list and the chips)', /1/.test(await page.textContent(`${B} .music-chips .chip:has-text("Fav") small`)));
    await page.click(`${B} .track[data-id="4"]`, { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Add to playlist")');
    await page.click('.nui-menu .mi:has-text("New playlist…")');
    await page.fill(`${dlg} input`, 'Machines');
    await page.click(`${dlg} .nui-btn.primary`);
    await page.waitForTimeout(300);
    await page.click(`${B} .music-tabs button[data-tab="playlists"]`);
    await page.waitForSelector(`${B} .music-playlists .qitem[data-playlist] .qtitle:text-is("Machines")`);
    await page.click(`${B} .music-playlists .qitem[data-playlist] .qtitle`);
    await page.waitForTimeout(300);
    check('right-click › Add to playlist › New playlist: made with the track; opening it lists it', (await titles()).join('|') === 'Differences' && (await page.textContent(`${B} .music-viewbar`)).includes('Machines'), [await titles(), await page.textContent(`${B} .music-viewbar`)]);
    await page.click(`${B} .music-viewbar button:has-text("Close")`);
    await page.waitForTimeout(250);

    // ---------------------------------------------------------------- smart collections
    await page.click(`${B} .music-tabs button[data-tab="playlists"]`);
    await page.click(`${B} .smart-new`);
    await page.click(`${dlg} .batch-tokens .chip:text-is("Favourites")`);
    await page.waitForFunction(() => /1 track match/.test((document.querySelector('.nm-dialog .smart-count') || {}).textContent || ''));
    check('a smart collection from a preset: it counts as you go ("1 track match right now")', true);
    await page.click(`${dlg} .smart-save`);
    await page.waitForTimeout(300);
    check('…made: the library shows what it holds', (await titles()).join('|') === 'Analytical Engine' && (await page.textContent(`${B} .music-viewbar`)).includes('Favourites'), [await titles(), await page.textContent(`${B} .music-viewbar`)]);
    await page.click(`${B} .music-viewbar button:has-text("Close")`);
    await page.waitForTimeout(250);

    // ---------------------------------------------------------------- editing a track, and many at once
    await page.click(`${B} .track[data-id="3"]`);
    await page.keyboard.press('F2');
    await page.waitForSelector(`${dlg} input[data-key="title"]`);
    await page.fill(`${dlg} input[data-key="title"]`, 'Cogs, Wheels and Levers');
    check('F2: Edit track, with its file name and tags; changing a tag ticks "Change the tags"', await page.isChecked(`${dlg} .edit-tags`) && (await page.inputValue(`${dlg} .edit-name input`)) === 'Cogs and Wheels');
    await page.click(`${dlg} .edit-save`);
    await page.waitForSelector(`${B} .track[data-id="3"] .track-title:text-is("Cogs, Wheels and Levers")`);
    const edit = await page.evaluate(() => window.__edits[0]);
    check('…Save changes the tags (the player lets go of the file meanwhile) and the list follows', edit.updateTags && edit.tags.title === 'Cogs, Wheels and Levers' && !edit.rename, edit);
    await page.click(`${B} .music-list`);
    await page.keyboard.press('Control+a');
    await page.click(`${B} .track[data-id="1"]`, { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Edit 5 tracks")');
    await page.waitForSelector(`${dlg} .batch-tr.head`);
    await page.fill(`${dlg} input[data-rule="prefix"]`, 'x ');
    await page.check(`${dlg} .batch-rename`);
    await page.waitForFunction(() => /5 will change/.test(document.querySelector('.nm-dialog .batch-summary').textContent));
    check('the Batch Organizer: rules, and a dry run that says what will change', (await page.textContent(`${dlg} .batch-tr[data-id="1"] .batch-new`)) === 'x Analytical Engine.mp3');
    await page.click(`${dlg} .batch-apply`);
    await page.click('.nm-dialog:last-of-type .nui-btn.primary:text-is("Apply")');
    await page.waitForSelector(`${dlg} .batch-result`);
    check('…Apply (after asking): the results, and Undo for the whole batch', (await page.textContent(`${dlg} .batch-result`)).startsWith('5 changed') && await page.isVisible(`${dlg} .batch-undo`));
    await page.click(`${dlg} .batch-undo`);
    await page.waitForTimeout(300);
    check('…Undo puts the batch back', (await page.evaluate(() => window.__batchUndone)) === 9 && !(await page.$(dlg)));

    // ---------------------------------------------------------------- the player beside your writing
    await page.click('.btab[data-bench="noor.markdown"]');
    await page.waitForSelector(`${P} .np-title`);
    s = await eng();
    check('in Markdown, the music keeps playing', !s.paused && s.track === 'Cogs, Wheels and Levers', s);
    check('…and the Music panel is beside the writing (offered once, when you first played)', (await page.textContent(`${P} .np-title`)) === 'Cogs, Wheels and Levers', await page.textContent(`${P} .np-title`));
    await page.click(`${P} .music-tabs button[data-tab="queue"]`);
    check('…compact: the player card, then Library / Up next / Playlists / Sound', (await upNext(`${P} .tab-queue`)).join('|') === 'Differences', await upNext(`${P} .tab-queue`));
    await page.click(`${P} .music-tabs button[data-tab="library"]`);
    await page.waitForSelector(`${P} .track .track-main small`);
    check('…the library in two lines a track (title; artist · file)', (await page.textContent(`${P} .track[data-id="1"] .track-main small`)).startsWith('Ada · '));
    await page.click('#bottombar .mp-play');
    await page.waitForTimeout(200);
    check('⏸ in the mini player pauses it', (await eng()).paused);
    await page.click('#bottombar .mp-play');
    await page.waitForTimeout(300);
    check('▶ carries on', !(await eng()).paused);
    await page.click('#bottombar button[aria-label^="Hide the mini player"]');
    await page.waitForTimeout(150);
    check('✕ hides the mini player (the music keeps playing); a ♫ in the status bar is left', await page.isHidden('#bottombar') && await page.isVisible('#status-widgets .mu-mini-btn') && !(await eng()).paused);
    await page.click('#status-widgets .mu-mini-btn');
    await page.waitForSelector('#bottombar:not([hidden]) .nm-mini');
    check('…♫ brings it back', await page.isHidden('#status-widgets .mu-mini-btn'));
    await page.click('#bottombar .mp-who');
    await page.waitForSelector('section.bench[data-bench="noor.music"]:not([hidden])');
    check('its title opens the Music bench', (await page.evaluate(() => window.__noor.active())) === 'noor.music');

    // ---------------------------------------------------------------- sound, the session
    await page.click(`${B} .music-tabs button[data-tab="sound"]`);
    await page.waitForSelector(`${B} .music-sound .eq-bands`);
    await page.check(`${B} .music-sound .sound-section:first-child .sound-head input[type=checkbox]`);
    await page.waitForTimeout(250);
    check('Sound: the equalizer turns on', (await eng()).fx.eqOn === true && !(await page.isDisabled(`${B} .eq-band[data-band="0"]`)));
    await page.selectOption(`${B} .fx-preset`, 'bass');
    await page.waitForTimeout(250);
    check('…a preset sets the bands', (await eng()).fx.gains[0] === 6 && (await page.inputValue(`${B} .eq-band[data-band="0"]`)) === '6');
    const measuredId = (await eng()).id;
    await page.click(`${B} .music-sound button:has-text("Measure this track")`);
    await waitFn(page, () => (window.__measured || []).length >= 1, null, 15000);
    check('Measure this track: measured here (the files aren\'t touched)', (await page.evaluate(() => window.__measured[0])) === measuredId, await page.evaluate(() => window.__measured));
    await page.waitForTimeout(1200);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mock.music')).session);
    check('the queue, volume and sound settings are kept for next time', saved && saved.ids.length === 4 && saved.fx.eqOn === true, saved);
    await page.click(`${B} .tp.shuffle`);
    await page.waitForTimeout(200);
    check('⇄ Shuffle on', (await eng()).shuffle === true && (await page.getAttribute(`${B} .tp.shuffle`, 'aria-pressed')) === 'true');
    await page.click(`${B} .tp.shuffle`);
    await page.click(`${B} .tp.repeat`);
    await page.waitForTimeout(200);
    check('↻ Repeat: all', (await eng()).repeat === 'all');

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.click(`${B} .music-tabs button[data-tab="library"]`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, 'noormd3-music.png') });
      await page.click('.btab[data-bench="noor.markdown"]');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, 'noormd3-music-beside-markdown.png') });
      await page.click('.btab[data-bench="noor.music"]');
      await page.waitForTimeout(300);
    }

    // ---------------------------------------------------------------- after a restart: where it was
    await page.evaluate(() => window.__noor.open.get('noor.music').module._engine()._audio.pause());
    const before = (await eng()).track;
    await page.waitForTimeout(1200);
    await page.reload();
    await waitFn(page, () => { const i = window.__noor && window.__noor.open.get('noor.music'); const e = i && i.module && i.module._engine(); return e && e._state().track; });
    s = await eng();
    check('after a restart: the same track, queue and settings, paused (nothing starts by itself)', s.track === before && s.queue.total === 4 && s.repeat === 'all' && s.fx.eqOn === true && s.paused, s);
    await page.waitForSelector('#bottombar:not([hidden]) .nm-mini');
    check('…and the mini player shows it', (await page.textContent('#bottombar .mp-title')) === before);

    // ---------------------------------------------------------------- closing the bench stops the music
    await page.click('.btab[data-bench="noor.music"] .x');
    await page.waitForTimeout(300);
    check('closing the Music bench stops the music and takes the mini player away', !(await page.isVisible('#bottombar .nm-mini')) && (await page.evaluate(() => [...document.querySelectorAll('audio')].length)) === 0);

    check('no errors on the page', errors.length === 0, errors);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
