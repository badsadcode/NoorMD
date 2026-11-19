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
    { id: 1, displayTitle: 'Analytical Engine', artist: 'Ada', album: 'Notes', duration: 4, triage: 0 },
    { id: 2, displayTitle: 'Bernoulli Numbers', artist: 'Ada', album: 'Notes', duration: 4, triage: 0 },
    { id: 3, displayTitle: 'Cogs and Wheels', artist: 'Babbage', album: 'Difference', duration: 4, triage: 0 },
    { id: 4, displayTitle: 'Differences', artist: 'Babbage', album: 'Difference', duration: 4, triage: 0 },
    { id: 5, displayTitle: 'Every Punch Card', artist: 'Jacquard', album: 'Loom', duration: 4, triage: 0 },
  ];
  const lib = () => get('mock.music', { tracks: TRACKS, playlists: [], folders: [{ id: 1, path: 'C:\\Music', tracks: 5 }], session: null });
  const save = (l) => put('mock.music', l);
  const ev = (name, payload) => send({ event: 'bench', bench: 'noor.music', name, payload: payload || {} });
  window.__ev = ev;
  const stats = (l) => ({ total: l.tracks.length, missing: 0, favorite: l.tracks.filter((t) => t.triage === 1).length, keep: l.tracks.filter((t) => t.triage === 2).length, maybe: l.tracks.filter((t) => t.triage === 3).length, skip: l.tracks.filter((t) => t.triage === 4).length, untriaged: l.tracks.filter((t) => !t.triage).length });
  const rowsFor = (l, a) => {
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
      case 'music.status': return { folders: l.folders, stats: stats(l), playlists: l.playlists.map((p) => ({ id: p.id, name: p.name, count: p.ids.length })), scanning: !!window.__scanning, lastScan: window.__lastScan || null };
      case 'music.cancelScan': window.__cancelled = true; return null;
      case 'music.query': { const rows = rowsFor(l, a); return { total: rows.length, offset: a.offset || 0, rows: rows.slice(a.offset || 0, (a.offset || 0) + (a.limit || 200)) }; }
      case 'music.ids': return rowsFor(l, a).map((t) => t.id);
      case 'music.tracks': return (a.ids || []).map((id) => l.tracks.find((t) => t.id === id)).filter(Boolean);
      case 'music.setTriage': for (const t of l.tracks) if (a.ids.includes(t.id)) t.triage = a.value; save(l); ev('triage', { ids: a.ids, value: a.value }); return stats(l);
      case 'music.played': (window.__played = window.__played || []).push(a.id); return null;
      case 'music.playlists': return l.playlists.map((p) => ({ id: p.id, name: p.name, count: p.ids.length }));
      case 'music.playlist.create': { const id = l.playlists.length + 1; l.playlists.push({ id, name: a.name, ids: a.ids || [] }); save(l); ev('playlists'); return { id }; }
      case 'music.playlist.add': { const p = l.playlists.find((x) => x.id === a.id); p.ids.push(...a.ids); save(l); ev('playlists'); return null; }
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
    const eng = () => page.evaluate(() => { const e = window.__noor.open.get('noor.music').module._engine(); const s = e._state(); return { ...s, track: s.track && s.track.displayTitle, paused: e._audio.paused, at: e._audio.currentTime }; });
    const titles = () => page.$$eval('.mu-row .t', (xs) => xs.map((x) => x.textContent));
    const clickMenu = async (title, item) => { await page.click(`[data-menu]:text-is("${title}")`); await page.click(`.nui-menu .mi:has-text("${item}")`); };

    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.mu-row .t');

    // ---------------------------------------------------------------- the library
    check('the Music bench: the library, sorted by artist', (await titles()).join('|') === 'Analytical Engine|Bernoulli Numbers|Cogs and Wheels|Differences|Every Punch Card', await titles());
    check('…its sections (All music, Favourite…), with counts', (await page.textContent('.mu-sec.on')).includes('All music') && (await page.textContent('.mu-sec.on .c')) === '5');

    // ---------------------------------------------------------------- looking through the folders
    check('no scan banner when nothing is going on', await page.isHidden('.mu-scan'));
    await page.evaluate(() => { window.__scanning = true; window.__ev('scan', { folderId: 1, phase: 'discovering', discovered: 500, processed: 0, errors: 0 }); });
    await waitFn(page, () => { const b = document.querySelector('.mu-scan'); return b && !b.hidden && /Finding your music… 500 files/.test(b.textContent); });
    check('while finding files: a banner with the count, a moving bar and Stop', await page.isVisible('.mu-scan .mu-scan-bar.busy') && await page.isVisible('.mu-scan button:text-is("Stop")'));
    await page.evaluate(() => window.__ev('scan', { folderId: 1, phase: 'indexing', discovered: 9298, processed: 3120, errors: 2 }));
    await waitFn(page, () => /3,120 of 9,298 · 2 unreadable/.test(document.querySelector('.mu-scan').textContent));
    const pct = await page.$eval('.mu-scan-bar i', (i) => i.style.width);
    check('while reading: "3,120 of 9,298", a bar that fills (34%), and the same in the status bar', pct === '34%' && /3,120 of 9,298/.test(await page.textContent('#status-bench')), [pct, await page.textContent('#status-bench')]);
    await page.click('.mu-scan button:text-is("Stop")');
    check('…Stop asks the library to stop', await page.evaluate(() => window.__cancelled === true));
    await page.evaluate(() => { window.__scanning = false; window.__lastScan = { phase: 'done', discovered: 9298, added: 9296, errors: 2, message: '“broken.mp3”: Bad header' }; window.__ev('scan', { folderId: 1, phase: 'done', discovered: 9298, processed: 9298, errors: 2, message: '“broken.mp3”: Bad header' }); });
    await waitFn(page, () => document.querySelector('.mu-scan.note') && !document.querySelector('.mu-scan').hidden);
    const note = await page.textContent('.mu-scan');
    check('afterwards: a note saying which files couldn\'t be read and why', /2 files couldn't be read \(the first: “broken.mp3”: Bad header\)/.test(note), note);
    await page.click('.mu-scan .nui-icon');
    check('…which can be closed', await page.isHidden('.mu-scan'));
    await page.evaluate(() => window.__ev('scan', { folderId: 1, phase: 'done', discovered: 5, processed: 5, errors: 0 }));
    await page.waitForTimeout(150);
    check('a scan that went fine leaves no note', await page.isHidden('.mu-scan'));
    await page.evaluate(() => { window.__lastScan = null; });
    await page.click('.mu-cols .h.t'); await page.click('.mu-cols .h.t');
    await page.waitForTimeout(150);
    check('clicking a column sorts by it (twice: the other way round)', (await titles())[0] === 'Every Punch Card', await titles());
    await page.fill('.mu-search', 'babbage');
    await page.waitForTimeout(400);
    check('search finds by artist', (await titles()).length === 2 && (await page.textContent('.mu-heading')).includes('2 tracks'));
    await page.fill('.mu-search', '');
    await page.click('.mu-cols .h.a');
    await page.waitForTimeout(400);

    // ---------------------------------------------------------------- playing
    await page.dblclick('.mu-row:has-text("Bernoulli Numbers")');
    await waitFn(page, () => { const e = window.__noor.open.get('noor.music').module._engine(); return e && !e._audio.paused && e._audio.currentTime > 0.2; });
    let s = await eng();
    check('double-click: it plays (really: the audio runs), the list from there on is the queue', s.track === 'Bernoulli Numbers' && !s.paused && s.queue.total === 5 && s.queue.pos === 1, s);
    await page.waitForSelector('.mu-row.now');
    check('…the playing track is marked in the list', (await page.textContent('.mu-row.now .t')) === 'Bernoulli Numbers');
    await page.waitForSelector('#bottombar:not([hidden]) .mu-mp');
    check('…the mini player along the bottom shows it', (await page.textContent('#bottombar .mu-mp-title')).includes('Bernoulli Numbers'));
    await page.waitForSelector('.mu-np-title:text-is("Bernoulli Numbers")');
    check('…and Now playing (a panel beside the library)', (await page.textContent('.mu-np-sub')).includes('Ada'));
    await page.waitForFunction(() => Number(document.querySelector('.mu-np-seek .mu-range').value) > 0);
    check('…its position moves', Number(await page.inputValue('.mu-np-seek .mu-range')) > 0);
    await page.click('.mu-tab[data-tab="queue"]');
    check('Up next lists what comes after it', (await page.$$eval('.mu-p-queue .mu-q:not(.now) .t', (xs) => xs.map((x) => x.textContent))).join('|') === 'Cogs and Wheels|Differences|Every Punch Card');
    await page.click('.mu-tp[title="Next"]');
    await waitFn(page, () => window.__noor.open.get('noor.music').module._engine()._state().track.displayTitle === 'Cogs and Wheels');
    check('⏭ Next: the next track', (await eng()).track === 'Cogs and Wheels');
    await page.hover('.mu-q:has-text("Every Punch Card")');
    await page.click('.mu-q:has-text("Every Punch Card") button[title="Take it out"]');
    await page.waitForTimeout(150);
    check('Up next: ✕ takes a track out', !(await page.textContent('.mu-p-queue')).includes('Every Punch Card') && (await eng()).queue.total === 4);

    // ---------------------------------------------------------------- marks and playlists
    await page.click('.mu-row:has-text("Analytical Engine")');
    await page.keyboard.press('1');
    await page.waitForSelector('.mu-row:has-text("Analytical Engine") .tr:text-is("★")');
    check('1 on a selected track: ★ Favourite (in the list and the sections)', (await page.textContent('.mu-sec:has-text("Favourite") .c')) === '1');
    await page.click('.mu-row:has-text("Differences")', { button: 'right' });
    await page.click('.nui-menu .mi:has-text("A new playlist…")');
    await page.fill('.nui-dialog .mu-field input', 'Machines');
    await page.click('.nui-dialog .nui-btn.primary');
    await page.waitForSelector('.mu-sec[data-playlist] .n:text-is("Machines")');
    await page.click('.mu-sec[data-playlist]');
    await page.waitForTimeout(300);
    check('right-click › A new playlist: made with the track, listed under Playlists', (await titles()).join('|') === 'Differences' && (await page.textContent('.mu-heading h1')) === 'Machines');
    await page.click('.mu-sec:has-text("All music")');
    await page.waitForTimeout(200);

    // ---------------------------------------------------------------- the player keeps going elsewhere
    await page.click('.btab[data-bench="noor.markdown"]');
    await page.waitForTimeout(500);
    s = await eng();
    check('in another bench (Markdown), the music keeps playing', !s.paused && s.track === 'Cogs and Wheels', s);
    check('…and the mini player is still along the bottom', await page.isVisible('#bottombar .mu-mp'));
    await page.click('#bottombar .mu-ib.play');
    await page.waitForTimeout(200);
    check('⏸ in the mini player pauses it', (await eng()).paused);
    await page.click('#bottombar .mu-ib.play');
    await page.waitForTimeout(300);
    check('▶ carries on', !(await eng()).paused);
    await page.click('#bottombar button[aria-label="Hide the mini player"]');
    await page.waitForTimeout(150);
    check('✕ hides the mini player (the music keeps playing); a ♫ in the status bar is left', await page.isHidden('#bottombar') && await page.isVisible('#status-widgets .mu-mini-btn') && !(await eng()).paused);
    await page.click('#status-widgets .mu-mini-btn');
    await page.waitForSelector('#bottombar:not([hidden]) .mu-mp');
    check('…♫ brings it back', await page.isHidden('#status-widgets .mu-mini-btn'));
    await page.click('#bottombar .mu-mp-who');
    await page.waitForSelector('section.bench[data-bench="noor.music"]:not([hidden])');
    check('its title opens the Music bench', (await page.evaluate(() => window.__noor.active())) === 'noor.music');

    // ---------------------------------------------------------------- sound, the session
    await page.click('.mu-tab[data-tab="sound"]');
    await page.waitForSelector('.mu-sound .mu-check');
    await page.click('.mu-sound .mu-check:has-text("Equalizer") input');
    await page.waitForTimeout(200);
    check('Sound: the equalizer turns on (and its presets with it)', (await eng()).fx.eqOn === true && !(await page.isDisabled('.mu-sound select')));
    await page.selectOption('.mu-sound select', 'bass');
    await page.waitForTimeout(200);
    check('…a preset sets the bands', (await eng()).fx.gains[0] === 6 && (await page.inputValue('.mu-band input')) === '6');
    await page.click('.mu-sound button:has-text("Measure")');
    await waitFn(page, () => (window.__measured || []).length >= 1, null, 15000);
    check('Measure the loudness: the queue\'s tracks are measured here (the files aren\'t touched)', (await page.evaluate(() => window.__measured.length)) >= 1);
    await page.waitForTimeout(1200);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mock.music')).session);
    check('the queue, volume and sound settings are kept for next time', saved && saved.ids.length === 4 && saved.fx.eqOn === true, saved);
    await page.click('.mu-tp[title="Shuffle"]');
    await page.waitForTimeout(150);
    check('🔀 Shuffle on', (await eng()).shuffle === true && (await page.getAttribute('.mu-tp[title="Shuffle"]', 'aria-pressed')) === 'true');
    await page.click('.mu-tp[title="Shuffle"]');
    await page.click('.mu-tp[title^="Repeat"]');
    await page.waitForTimeout(150);
    check('🔁 Repeat: all', (await eng()).repeat === 'all');

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.click('.mu-tab[data-tab="library"]').catch(() => {});
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, 'noormd3-music.png') });
    }

    // ---------------------------------------------------------------- after a restart: where it was
    await page.evaluate(() => window.__noor.open.get('noor.music').module._engine()._audio.pause());
    const before = (await eng()).track;
    await page.waitForTimeout(1200);
    await page.reload();
    await waitFn(page, () => { const i = window.__noor && window.__noor.open.get('noor.music'); const e = i && i.module && i.module._engine(); return e && e._state().track; });
    s = await eng();
    check('after a restart: the same track, queue and settings, paused (nothing starts by itself)', s.track === before && s.queue.total === 4 && s.repeat === 'all' && s.fx.eqOn === true && s.paused, s);
    await page.waitForSelector('#bottombar:not([hidden]) .mu-mp');
    check('…and the mini player shows it', (await page.textContent('#bottombar .mu-mp-title')).includes(before));

    // ---------------------------------------------------------------- closing the bench stops the music
    await page.click('#bottombar .mu-ib.play');
    await page.waitForTimeout(300);
    await page.click('.btab[data-bench="noor.music"] .x');
    await page.waitForTimeout(300);
    check('closing the Music bench stops the music and takes the mini player away', !(await page.isVisible('#bottombar .mu-mp')) && (await page.evaluate(() => { const a = [...document.querySelectorAll('audio')]; return a.length; })) === 0);

    check('no errors on the page', errors.length === 0, errors);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
