// NoorMD 3.0's shell page, tested in Chromium against a stand-in for the window (the C# side): files served as the
// window serves them (/ = the shell, /ui = Noor.UI, /benches/<id> = a bench's web folder), and chrome.webview
// answering the shell's and the Sandbox's commands. Run: node tests/web3/shell.test.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'web', 'node_modules', 'playwright'));

const ROOT = path.join(__dirname, '..', '..');
const MOUNTS = [['/ui/', 'src/Noor.UI/'], ['/benches/noor.sandbox/', 'src/Benches/Sandbox/Sandbox.Bench/web/'], ['/benches/noor.clock/', 'src/Benches/Clock/Clock.Bench/web/'], ['/', 'src/NoorMD3/wwwroot/']];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const SANDBOX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sandbox.manifest.json'), 'utf8'));
const CLOCK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'clock.manifest.json'), 'utf8'));

let failed = 0, passed = 0;
function check(name, ok, extra) {
  if (ok) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const m = MOUNTS.find(([p]) => url.startsWith(p));
    let file = path.join(ROOT, m[1], url.slice(m[0].length) || 'index.html');
    if (!file.startsWith(path.join(ROOT, m[1])) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

// The window, as far as the page can tell: the shell's commands, the Sandbox's C# side, the window's own commands.
// Settings live in localStorage so a reload is a restart.
const MOCK = (manifests) => {
  const log = (window.__calls = []);
  const listeners = [];
  const store = () => { try { return JSON.parse(localStorage.getItem('mock.settings')); } catch { return null; } };
  const defaults = { theme: 'dark', menuPosition: 'title', density: {}, openBenches: [], activeBench: null, layouts: {}, welcomed: false };
  const words = (t) => (t.match(/[\p{L}\p{N}](?:[\p{L}\p{N}'’-]|\.(?=\p{N}))*/gu) || []).length;
  const send = (data) => setTimeout(() => listeners.forEach((fn) => fn({ data })), 5);
  const qs = new URLSearchParams(location.search);
  const me = qs.get('float') || (qs.get('bench') ? 'bench:' + qs.get('bench') : 'main');
  const channel = new BroadcastChannel('mock-noormd3');
  channel.onmessage = (e) => { const d = e.data; if ((d.to && d.to === me) || (!d.to && d.from !== me)) { if (d.msg.event === 'mock.closed') window.__closed = true; send(d.msg); } };
  const answer = (m) => {
    if (m.target === 'shell' && m.cmd === 'start') return { version: '3.0.4', contract: 1, settings: store() || defaults, benches: manifests, problems: [] };
    if (m.target === 'shell' && m.cmd === 'settings.save') { localStorage.setItem('mock.settings', JSON.stringify(m.args)); return m.args; }
    // Each window patches its own part of the settings ("layouts" merged per bench).
    if (m.target === 'shell' && m.cmd === 'settings.patch') { const cur = store() || { ...defaults }; for (const [k, v] of Object.entries(m.args)) { if (k === 'layouts') cur.layouts = { ...(cur.layouts || {}), ...v }; else cur[k] = v; } localStorage.setItem('mock.settings', JSON.stringify(cur)); (window.__patches = window.__patches || []).push(m.args); return cur; }
    if (m.target === 'shell' && m.cmd === 'settings.get') return store() || defaults;
    // The window's floating panels: a BroadcastChannel stands in for the window passing events between pages.
    if (m.target === 'window' && m.cmd === 'float.open') { localStorage.setItem('mock.float.' + m.args.id, JSON.stringify(m.args)); (window.__floatOpens = window.__floatOpens || []).push(m.args); return { id: m.args.id }; }
    if (m.target === 'window' && m.cmd === 'float.get') return JSON.parse(localStorage.getItem('mock.float.' + me));
    if (m.target === 'window' && m.cmd === 'float.dock') { channel.postMessage({ to: 'main', msg: { event: 'float.closed', id: me } }); window.__docked = true; return null; }
    if (m.target === 'window' && m.cmd === 'float.close') { (window.__floatCloses = window.__floatCloses || []).push(m.args.id); channel.postMessage({ to: m.args.id, msg: { event: 'mock.closed' } }); return null; }
    // Benches in windows of their own (3.0.11): the test opens the window's page itself.
    if (m.target === 'window' && m.cmd === 'bench.open') { (window.__benchOpens = window.__benchOpens || []).push(m.args); return null; }
    if (m.target === 'window' && m.cmd === 'bench.focus') { (window.__benchFocus = window.__benchFocus || []).push(m.args.bench); return null; }
    if (m.target === 'window' && m.cmd === 'bench.back') { window.__wentBack = true; channel.postMessage({ to: 'main', msg: { event: 'benchwindow.closed', bench: me.slice(6) } }); return null; }
    if (m.target === 'window' && m.cmd === 'bench.close') { (window.__benchCloses = window.__benchCloses || []).push(m.args.bench); channel.postMessage({ to: 'bench:' + m.args.bench, msg: { event: 'mock.closed' } }); return null; }
    if (m.target === 'window' && m.cmd === 'bus.emit') { channel.postMessage({ from: me, msg: { event: 'bench', bench: m.args.bench, name: m.args.name, payload: m.args.payload } }); return null; }
    if (m.target === 'window' && m.cmd === 'broadcast') { channel.postMessage({ from: me, msg: { event: m.args.name, payload: m.args.payload } }); return null; }
    if (m.target === 'window') return null;
    if (m.target === 'bench:noor.clock' && m.cmd === 'clock.zones') return [{ id: 'UTC', name: 'UTC', offset: 0 }, { id: 'Europe/Warsaw', name: 'Warsaw', offset: 60 }, { id: 'Asia/Tokyo', name: 'Tokyo', offset: 540 }];
    if (m.target === 'bench:noor.sandbox' && m.cmd === 'sandbox.count') { const t = (m.args && m.args.text) || '', w = words(t); return { words: w, characters: t.length, sentences: (t.match(/[.!?]+(\s|$)/g) || []).length, minutes: w ? Math.max(1, Math.round(w / 230)) : 0 }; }
    if (m.target === 'bench:noor.sandbox' && m.cmd === 'sandbox.hello') { send({ event: 'bench', bench: 'noor.sandbox', name: 'hello', payload: { at: '12:34:56' } }); return { message: 'Hello from C# (mock).' }; }
    throw new Error(`no ${m.target} ${m.cmd}`);
  };
  window.chrome = { webview: {
    postMessage(m) { log.push(m); let reply; try { reply = { id: m.id, ok: true, result: answer(m) }; } catch (e) { reply = { id: m.id, ok: false, error: e.message }; } send(reply); },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
  } };
};

async function waitFn(page, fn, arg, timeout = 5000) { await page.waitForFunction(fn, arg, { timeout }); }

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
    await context.addInitScript(MOCK, [SANDBOX, CLOCK]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const calls = () => page.evaluate(() => window.__calls);
    const status = () => page.textContent('#status-bench');
    const menuTitles = () => page.$$eval('#menubar button, #menurow button', (b) => b.map((x) => x.textContent));
    const openMenu = async (title) => { await page.click(`#menubar button:text-is("${title}"), #menurow button:text-is("${title}")`); await page.waitForSelector('.nui-menu'); };
    const pick = async (label) => { await page.click(`.nui-menu .mi:has-text("${label}")`); };

    // ---- the first start: Home, the theme sent to the window, the version in the status bar
    await page.goto(url);
    await waitFn(page, () => window.__noor && window.__noor.active() === 'home');
    check('first start: Home is open and in front', (await page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench))).join() === 'home' && /Good (morning|afternoon|evening|night)/.test(await page.textContent('.home h1')));
    check('…the status bar names the version', (await page.textContent('#status-app')) === 'NoorMD 3.0.4');
    check('…the window got the theme\'s colours for its native buttons', (await calls()).some((c) => c.target === 'window' && c.cmd === 'theme' && c.args.bg === '#0b0d12'));
    check('…the main menu: File, Edit, View, Tools, Window, Help', (await menuTitles()).join() === 'File,Edit,View,Tools,Window,Help', await menuTitles());
    check('…Home offers the Sandbox and the Clock', await page.isVisible('.home .card:has-text("Sandbox")') && await page.isVisible('.home .card:has-text("Clock")'));

    // ---- opening the Sandbox: its tab, its menu between View and Tools, its panels, its module from its folder
    await page.click('.home .card:has-text("Sandbox")');
    await waitFn(page, () => window.__noor.active() === 'noor.sandbox' && document.querySelector('.sb-text'));
    check('Sandbox opens as a tab, in front', (await page.$$eval('.btab[aria-selected=true]', (t) => t.map((x) => x.dataset.bench))).join() === 'noor.sandbox');
    check('…the menu follows it: Sandbox sits between View and Tools', (await menuTitles()).join() === 'File,Edit,View,Sandbox,Tools,Window,Help', await menuTitles());
    check('…its panels: About on the left, Statistics on the right', await page.isVisible('section.bench[data-bench="noor.sandbox"] .side.left .pbody[data-ref="noor.sandbox:about"]') && await page.isVisible('section.bench[data-bench="noor.sandbox"] .side.right .pbody[data-ref="noor.sandbox:stats"]'));
    check('…the title bar names it', (await page.textContent('#wintitle')).startsWith('Sandbox'));

    // ---- a round trip to its C# side
    await page.click('.sb-text');
    await page.keyboard.type('NoorMD 3.0 is one home. Benches talk!');
    await waitFn(page, () => /7 words/.test(document.querySelector('#status-bench').textContent));
    check('typing: the C# side counts, the status bar says so', /7 words · 1 min read/.test(await status()), await status());
    check('…and the Statistics panel shows it (an event inside the bench)', /Words\s*7/.test(await page.textContent('.pbody[data-ref="noor.sandbox:stats"]')) && /Sentences\s*2/.test(await page.textContent('.pbody[data-ref="noor.sandbox:stats"]')), await page.textContent('.pbody[data-ref="noor.sandbox:stats"]'));
    await openMenu('Sandbox'); await pick('Say hello from C#');
    await page.waitForSelector('.nui-toast:has-text("Hello from C# (mock).")');
    await page.waitForSelector('.nui-toast:has-text("waved at 12:34:56")');
    check('Sandbox › Say hello from C#: the answer, and an event sent back from C#', true);
    await page.keyboard.press('Control+Shift+C');
    await page.waitForSelector('.nui-toast:has-text("Counted by the C# side")');
    check('a bench\'s own shortcut (Ctrl+Shift+C) runs its command', true);

    // ---- resizable sides
    const rw = () => page.$eval('section.bench[data-bench="noor.sandbox"]', (b) => getComputedStyle(b).getPropertyValue('--rw').trim());
    const res = await page.$('[data-bench="noor.sandbox"] .resizer.r');
    const rb = await res.boundingBox();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); await page.mouse.down();
    await page.mouse.move(rb.x + rb.width / 2 - 100, rb.y + rb.height / 2, { steps: 5 }); await page.mouse.up();
    check('dragging the right edge makes the right side wider (280 → 380)', (await rw()) === '380px', await rw());
    await page.waitForTimeout(400);
    check('…and the width is saved with the bench\'s layout', (await page.evaluate(() => JSON.parse(localStorage.getItem('mock.settings')).layouts['noor.sandbox'].rw)) === 380);
    await page.dblclick('[data-bench="noor.sandbox"] .resizer.r');
    check('…double-click: back to its usual size', (await rw()) === '280px', await rw());
    await page.focus('[data-bench="noor.sandbox"] .resizer.l');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    check('…the edges resize from the keyboard too (← →)', (await page.$eval('section.bench[data-bench="noor.sandbox"]', (b) => getComputedStyle(b).getPropertyValue('--lw').trim())) === '260px');

    // ---- View: panels and density
    await openMenu('View'); await pick('Statistics');
    check('View › Statistics hides the panel', !(await page.isVisible('.pbody[data-ref="noor.sandbox:stats"]')));
    await openMenu('View');
    check('…the View menu shows it unticked', (await page.getAttribute('.nui-menu .mi:has-text("Statistics")', 'aria-checked')) === 'false');
    await pick('Statistics');
    check('…and ticks it back', await page.isVisible('.pbody[data-ref="noor.sandbox:stats"]'));
    await page.click('.pgroup:has([data-ref="noor.sandbox:about"]) header button[aria-label^="Hide"]');
    check('✕ on a panel hides it', !(await page.isVisible('.pbody[data-ref="noor.sandbox:about"]')));
    await openMenu('View'); await pick('Compact');
    check('View › Compact: the bench turns compact', await page.evaluate(() => document.body.classList.contains('density-compact')));
    await openMenu('View'); await pick('Roomy');
    check('…and roomy again', await page.evaluate(() => document.body.classList.contains('density-roomy')));


    // ---- docking (3.0.2): drag a panel by its tab; groups of tabs; edges between groups; Esc cancels
    const sb = 'section.bench[data-bench="noor.sandbox"]';
    const docks = () => page.evaluate(() => window.__noor.open.get('noor.sandbox').layout.docks);
    const tabCenter = async (sel) => { const b = await (await page.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const dragTo = async (fromSel, x, y, { cancel = false } = {}) => {
      const [fx, fy] = await tabCenter(fromSel);
      await page.mouse.move(fx, fy); await page.mouse.down();
      await page.mouse.move(fx + 20, fy + 10, { steps: 3 });
      await page.mouse.move(x, y, { steps: 8 });
      if (cancel) { await page.keyboard.press('Escape'); await page.mouse.up(); return; }
      await page.mouse.up();
    };
    await openMenu('View'); await pick('About');   // About back (it was hidden above)
    // Statistics onto the About group, in its middle: tabbed together on the left; the right side goes away.
    const aboutBox = await (await page.$(`${sb} .pgroup:has(.ptab[data-ref="noor.sandbox:about"])`)).boundingBox();
    await dragTo(`${sb} .ptab[data-ref="noor.sandbox:stats"]`, aboutBox.x + aboutBox.width / 2, aboutBox.y + aboutBox.height / 2);
    let d = await docks();
    check('dragging Statistics into the About group: two tabs on the left, the right side empty', d.left.length === 1 && d.left[0].panels.join() === 'noor.sandbox:about,noor.sandbox:stats' && d.right.length === 0 && (await page.$eval(sb, (b) => getComputedStyle(b).getPropertyValue('--rw').trim())) === '0px', d);
    check('…the dropped one is in front; a click on the other tab brings it forward', await page.isVisible(`${sb} [data-ref="noor.sandbox:stats"].pbody`) && !(await page.isVisible(`${sb} [data-ref="noor.sandbox:about"].pbody`)));
    await page.click(`${sb} .ptab[data-ref="noor.sandbox:about"]`);
    check('…(About in front now)', await page.isVisible(`${sb} [data-ref="noor.sandbox:about"].pbody`) && !(await page.isVisible(`${sb} [data-ref="noor.sandbox:stats"].pbody`)));
    check('…the panel kept what it showed (moved, not restarted)', /Words\s*7/.test(await page.textContent(`${sb} [data-ref="noor.sandbox:stats"].pbody`)));
    // Statistics to the main view's bottom edge: a bottom side appears.
    const main = await (await page.$(`${sb} .main`)).boundingBox();
    await dragTo(`${sb} .ptab[data-ref="noor.sandbox:stats"]`, main.x + main.width / 2, main.y + main.height - 15);
    d = await docks();
    check('dragging it to the bottom edge: it docks at the bottom', d.bottom.length === 1 && d.bottom[0].panels.join() === 'noor.sandbox:stats' && d.left[0].panels.join() === 'noor.sandbox:about' && await page.isVisible(`${sb} .side.bottom [data-ref="noor.sandbox:stats"]`), d);
    // While dragging, drop zones show; Esc cancels and nothing moves.
    const [sx, sy] = await tabCenter(`${sb} .ptab[data-ref="noor.sandbox:stats"]`);
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 30, sy - 30, { steps: 4 });
    check('…while dragging, the drop zones and the ghost show', (await page.$$('.dock-zone')).length === 3 && await page.isVisible('.dock-ghost'));
    await page.mouse.move(main.x + 10, main.y + main.height / 2, { steps: 4 });
    check('…over the left edge, the landing spot shows', await page.isVisible('.dock-mark'));
    await page.keyboard.press('Escape'); await page.mouse.up();
    d = await docks();
    check('…Esc cancels: still at the bottom, the zones gone', d.bottom.length === 1 && !(await page.$('.dock-zone')) && !(await page.$('.dock-ghost')), d);
    // Right-click a tab: Move to the left (a new group under About), then an edge between the two groups.
    await page.click(`${sb} .ptab[data-ref="noor.sandbox:stats"]`, { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Move to the left")');
    d = await docks();
    check('right-click › Move to the left: a second group on the left, the bottom gone', d.left.length === 2 && d.left[1].panels.join() === 'noor.sandbox:stats' && d.bottom.length === 0, d);
    const gr = await (await page.$(`${sb} .side.left .gresizer`)).boundingBox();
    await page.mouse.move(gr.x + gr.width / 2, gr.y + gr.height / 2); await page.mouse.down();
    await page.mouse.move(gr.x + gr.width / 2, gr.y + gr.height / 2 + 120, { steps: 5 }); await page.mouse.up();
    d = await docks();
    check('dragging the edge between the two groups gives the top one more room', d.left[0].size > d.left[1].size * 1.5, d.left.map((g) => g.size));
    await page.dblclick(`${sb} .side.left .gresizer`);
    d = await docks();
    check('…double-click shares it evenly again', d.left[0].size === 1 && d.left[1].size === 1);
    // Back where it started, for the checks below: Statistics on the right.
    await page.click(`${sb} .ptab[data-ref="noor.sandbox:stats"]`, { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Move to the right")');

    // ---- any panel in any bench: the Clock's stopwatch docked in the Sandbox
    await openMenu('View');
    check('View lists the panels from other benches', await page.isVisible('.nui-menu .mi:has-text("Stopwatch (Clock)")') && await page.isVisible('.nui-menu .mi:has-text("Clock (Clock)")'));
    await pick('Stopwatch (Clock)');
    await page.waitForSelector(`${sb} .side.bottom [data-ref="noor.clock:stopwatch"] .ck-go`);
    check('…the Stopwatch docks in the Sandbox (at the bottom, its usual side), its tab says where it\'s from', /Stopwatch\s*Clock/.test(await page.textContent(`${sb} .ptab[data-ref="noor.clock:stopwatch"]`)));
    check('…the Clock opened quietly to run it (a tab, but the Sandbox stays in front)', (await page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench))).includes('noor.clock') && await page.evaluate(() => window.__noor.active()) === 'noor.sandbox');
    await page.click(`${sb} [data-ref="noor.clock:stopwatch"] .ck-go`);
    await page.waitForTimeout(250);
    check('…it works here: Start, and it counts', (await page.textContent(`${sb} [data-ref="noor.clock:stopwatch"] .ck-go`)) === 'Stop' && (await page.textContent(`${sb} [data-ref="noor.clock:stopwatch"] .ck-wt`)) !== '00:00.00');
    await page.click('.btab[data-bench="noor.clock"]');
    await page.waitForTimeout(100);
    check('…and it\'s the same stopwatch in the Clock bench (running there too)', (await page.textContent('section.bench[data-bench="noor.clock"] [data-ref="noor.clock:stopwatch"] .ck-go')) === 'Stop');
    await openMenu('Clock'); await pick('Start / stop the stopwatch');
    check('…the Clock menu stops it everywhere', (await page.textContent(`${sb} [data-ref="noor.clock:stopwatch"] .ck-go`)) === 'Go on');
    // The Clock's main view: time zones from its C# side.
    await page.click('section.bench[data-bench="noor.clock"] .ck-add');
    await page.waitForSelector('.nui-dialog select');
    await page.selectOption('.nui-dialog select', 'Europe/Warsaw');
    await page.click('.nui-dialog button:text-is("Add")');
    check('Clock › Add a time zone: the list comes from its C# side, the zone is added', /Europe\/Warsaw|Europe Warsaw/.test(await page.textContent('section.bench[data-bench="noor.clock"] .ck-zones')));
    // Closing the Clock takes its panels out of the other benches.
    await page.click('.btab[data-bench="noor.clock"] .x');
    await page.click('.btab[data-bench="noor.sandbox"]');
    check('closing the Clock: its stopwatch leaves the Sandbox, and says so', !(await page.$(`${sb} [data-ref="noor.clock:stopwatch"]`)) && await page.isVisible('.nui-toast:has-text("panels left the other benches")'));
    // Dock it back for the restart check below.
    await openMenu('View'); await pick('Stopwatch (Clock)');
    await page.waitForSelector(`${sb} [data-ref="noor.clock:stopwatch"] .ck-go`);
    await page.click('.btab[data-bench="noor.sandbox"]');
    await page.click(`${sb} .pgroup:has([data-ref="noor.sandbox:about"]) header button[aria-label^="Hide"]`);   // About hidden again, as before



    // ---- floating panels (3.0.4): a panel in a window of its own, in step with the main window
    const floats = () => page.evaluate(() => window.__noor.floats().map((f) => ({ ...f })));
    await page.click(`${sb} .ptab[data-ref="noor.sandbox:stats"]`, { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Float in its own window")');
    let fl = await floats();
    check('right-click › Float in its own window: the window is asked to open one with Statistics', fl.length === 1 && fl[0].ref === 'noor.sandbox:stats' && (await page.evaluate(() => window.__floatOpens.length)) === 1 && (await page.evaluate(() => window.__floatOpens[0].title)) === 'Statistics', fl);
    check('…it leaves the bench\'s sides; View still ticks it (it\'s shown, just elsewhere)', !(await docks()).right.some((g) => g.panels.includes('noor.sandbox:stats')) && (await (async () => { await openMenu('View'); const c = await page.getAttribute('.nui-menu .mi:has-text("Statistics")', 'aria-checked'); await page.keyboard.press('Escape'); return c; })()) === 'true');
    const fp = await context.newPage();
    fp.on('pageerror', (e) => errors.push('float: ' + e));
    await fp.goto(url + '?float=' + fl[0].id);
    await fp.waitForSelector('.floatpanel .pbody .nui-row');
    await fp.waitForFunction(() => /Words\s*7/.test(document.querySelector('.floatpanel').textContent));
    check('the floating window: just the panel, its name in the title bar, the last count asked for and shown', (await fp.textContent('#wintitle')).includes('Statistics') && !(await fp.isVisible('#benchtabs')) && !(await fp.isVisible('#statusbar')) && /Words\s*7/.test(await fp.textContent('.floatpanel')));
    await page.click('.sb-text'); await page.keyboard.press('End'); await page.keyboard.type(' Three more words.');
    await fp.waitForFunction(() => /Words\s*10/.test(document.querySelector('.floatpanel').textContent), null, { timeout: 4000 }).catch(() => {});
    check('…typing in the main window updates it (the bench\'s events reach the floating window)', /Words\s*10/.test(await fp.textContent('.floatpanel')), await fp.textContent('.floatpanel'));
    await page.keyboard.press('Control+,'); await page.waitForSelector('.nui-dialog');
    await page.selectOption('.nui-dialog select', 'evergreen');
    await fp.waitForFunction(() => document.documentElement.dataset.theme === 'evergreen', null, { timeout: 3000 }).catch(() => {});
    check('…a theme picked in the main window: the floating window follows', (await fp.getAttribute('html', 'data-theme')) === 'evergreen');
    await page.click('.nui-dialog button:text-is("Cancel")');
    await fp.waitForFunction(() => document.documentElement.dataset.theme !== 'evergreen', null, { timeout: 3000 }).catch(() => {});
    check('…and back when the change is cancelled', (await fp.getAttribute('html', 'data-theme')) === (await page.getAttribute('html', 'data-theme')));
    await fp.click('.fdock');
    await waitFn(page, () => window.__noor.floats().length === 0);
    check('⇲ Dock back in the floating window: Statistics is back where it was', (await docks()).right.some((g) => g.panels.includes('noor.sandbox:stats')) && await page.isVisible(`${sb} .pbody[data-ref="noor.sandbox:stats"]`));
    await fp.close();
    // The Clock's stopwatch floating: started in its window, running in the Clock bench too.
    await page.click(`${sb} .ptab[data-ref="noor.clock:stopwatch"]`, { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Float in its own window")');
    fl = await floats();
    const fp2 = await context.newPage();
    fp2.on('pageerror', (e) => errors.push('float2: ' + e));
    await fp2.goto(url + '?float=' + fl[0].id);
    await fp2.waitForSelector('.floatpanel .ck-go');
    await fp2.click('.floatpanel .ck-go');
    await page.waitForTimeout(300);
    check('the Stopwatch floating: started there, it\'s running in the Clock bench as well', (await fp2.textContent('.floatpanel .ck-go')) === 'Stop' && (await page.textContent('section.bench[data-bench="noor.clock"] [data-ref="noor.clock:stopwatch"] .ck-go')) === 'Stop');
    await fp2.click('.floatpanel .ck-go');
    // Dragging a tab out of the window floats it there.
    const [ox, oy] = await tabCenter(`${sb} .ptab[data-ref="noor.sandbox:stats"]`);
    await page.mouse.move(ox, oy); await page.mouse.down();
    await page.mouse.move(ox + 30, oy, { steps: 3 });
    await page.mouse.move(-25, oy, { steps: 6 });
    check('…dragging a tab out of the window: the ghost says it\'ll get a window of its own', /its own window/.test(await page.textContent('.dock-ghost')));
    await page.mouse.up();
    fl = await floats();
    check('…let go out there: it floats (two floating panels now)', fl.length === 2 && fl.some((f) => f.ref === 'noor.sandbox:stats'), fl);
    await openMenu('Window');
    check('Window lists the floating panels and Get over here!', /Floating panels \(2\)/.test(await page.textContent('.nui-menu')) && await page.isVisible('.nui-menu .mi:has-text("Get over here!")'));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+G');
    await page.waitForTimeout(120);
    check('…the easter egg: ropes with grappling hooks fly out and reel the panels in', (await page.$$('.hooks .rope')).length === 2 && (await page.$$('.hooks .hook')).length === 2);
    await page.waitForTimeout(1100);
    check('…and tidy themselves away', !(await page.$('.hooks')) && !(await page.$('.hook-card')));
    await waitFn(page, () => window.__noor.floats().length === 0);
    check('Get over here! (Ctrl+Shift+G): every floating panel back in the main window, where it came from', (await docks()).right.some((g) => g.panels.includes('noor.sandbox:stats')) && (await docks()).bottom.some((g) => g.panels.includes('noor.clock:stopwatch')) && await page.isVisible('.nui-toast:has-text("Get over here! 2 panels pulled back in.")') && (await page.evaluate(() => window.__floatCloses.length)) >= 2);
    check('…and their windows were told to close', await fp2.evaluate(() => window.__closed === true));
    await fp2.close();
    // ---- a bench in a window of its own (3.0.11)
    await page.click('.btab[data-bench="noor.sandbox"]', { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Move to a new window")');
    await waitFn(page, () => (window.__benchOpens || []).length === 1);
    check('right-click a bench tab › Move to a new window: the window is asked for one, with the Sandbox', (await page.evaluate(() => window.__benchOpens[0].bench)) === 'noor.sandbox');
    check('…its tab stays, pointing there (↗), and another bench comes to the front', await page.isVisible('.btab.away[data-bench="noor.sandbox"] .aw') && (await page.evaluate(() => window.__noor.active())) !== 'noor.sandbox');
    check('…the main window keeps no view of it (just its module, for its panels elsewhere)', (await page.evaluate(() => document.querySelector('section.bench[data-bench="noor.sandbox"] .view').children.length)) === 0);
    check('…and remembers it for the next start', await page.evaluate(() => (JSON.parse(localStorage.getItem('mock.settings')).windows || []).some((w) => w.bench === 'noor.sandbox')));
    const bw = await context.newPage();
    bw.on('pageerror', (e) => errors.push('bench window: ' + e));
    await bw.goto(url + '?bench=noor.sandbox');
    await bw.waitForSelector('.sb-text');
    check('the bench\'s window: the Sandbox, its name, and the way back', (await bw.textContent('.btab.bw-name')).includes('Sandbox') && await bw.isVisible('.btab.bw-back'));
    check('…with its panels, the Clock\'s stopwatch included (the Clock runs there quietly for it)', await bw.isVisible('.pbody[data-ref="noor.sandbox:stats"]') && await bw.isVisible('.pbody[data-ref="noor.clock:stopwatch"] .ck-go') && !(await bw.$('.btab[data-bench="noor.clock"]')));
    await bw.fill('.sb-text', 'Written in its own window.');
    await bw.waitForFunction(() => /Words\s*5/.test(document.querySelector('.pbody[data-ref="noor.sandbox:stats"]').textContent), null, { timeout: 4000 }).catch(() => {});
    check('…it works there (the count follows the typing)', /Words\s*5/.test(await bw.textContent('.pbody[data-ref="noor.sandbox:stats"]')));
    await bw.click('[data-menu]:text-is("File")');
    check('…its File menu: back to the main window, or close the bench (no Home, no Exit)', await bw.isVisible('.nui-menu .mi:has-text("Back to the main window")') && !(await bw.isVisible('.nui-menu .mi:has-text("Exit")')));
    await bw.keyboard.press('Escape');
    await page.click('.btab[data-bench="noor.sandbox"]');
    check('clicking its tab in the main window goes to its window', (await page.evaluate(() => window.__benchFocus || [])).includes('noor.sandbox'));
    await bw.click('.btab.bw-back');
    await waitFn(page, () => window.__noor.active() === 'noor.sandbox' && !document.querySelector('.btab.away'));
    check('⇱ Back to the main window: the Sandbox is a tab here again, in front, with its view', await page.isVisible('section.bench[data-bench="noor.sandbox"] .sb-text') && await bw.evaluate(() => window.__wentBack === true));
    await waitFn(page, () => !(JSON.parse(localStorage.getItem('mock.settings')).windows || []).length).catch(() => {});
    check('…and isn\'t remembered as windowed any more', await page.evaluate(() => !(JSON.parse(localStorage.getItem('mock.settings')).windows || []).length));
    check('…what was written in its window came along (the bench\'s own state)', (await page.inputValue('.sb-text')) === 'Written in its own window.');
    await page.fill('.sb-text', 'NoorMD 3.0 is one home. Benches talk! Three more words.');
    await page.waitForTimeout(500);   // (the Sandbox keeps its text when it has counted it)
    await bw.close();
    // Dragging the tab out of the window does it too; right-click › Bring it back asks the window to send it back.
    const [tx, ty] = await tabCenter('.btab[data-bench="noor.sandbox"]');
    await page.mouse.move(tx, ty); await page.mouse.down();
    await page.mouse.move(tx + 10, ty + 40, { steps: 3 });
    await page.mouse.move(tx + 40, ty + 260, { steps: 6 });
    check('dragging a bench tab down out of the tab row: the ghost says it gets a window of its own', /window of its own/.test(await page.textContent('.dock-ghost')));
    await page.mouse.up();
    await waitFn(page, () => (window.__benchOpens || []).length === 2);
    check('…let go: it moves to a window there', await page.isVisible('.btab.away[data-bench="noor.sandbox"]'));
    const bw2 = await context.newPage();
    bw2.on('pageerror', (e) => errors.push('bench window 2: ' + e));
    await bw2.goto(url + '?bench=noor.sandbox');
    await bw2.waitForSelector('.sb-text');
    await page.click('.btab[data-bench="noor.sandbox"]', { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Bring it back into this window")');
    await waitFn(page, () => !document.querySelector('.btab.away'));
    check('right-click › Bring it back: the window sends it back (it keeps its work first)', await bw2.evaluate(() => window.__wentBack === true) && await page.isVisible('section.bench[data-bench="noor.sandbox"] .sb-text'));
    await bw2.close();

    // A floating panel comes back after a restart: the Clock's small clock floats until the restart check below.
    await openMenu('View'); await pick('Clock (Clock)');
    await page.waitForSelector(`${sb} .pbody[data-ref="noor.clock:now"]`);
    await page.click(`${sb} .ptab[data-ref="noor.clock:now"]`, { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Float in its own window")');

    // ---- reordering the bench tabs (3.0.3)
    const tabOrder = () => page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench));
    const before = await tabOrder();
    const ts = await (await page.$('.btab[data-bench="noor.sandbox"]')).boundingBox();
    const last = await (await page.$(`.btab[data-bench="${before[before.length - 1]}"]`)).boundingBox();
    await page.mouse.move(ts.x + ts.width / 2, ts.y + ts.height / 2); await page.mouse.down();
    await page.mouse.move(last.x + last.width + 20, ts.y + ts.height / 2, { steps: 8 }); await page.mouse.up();
    let after = await tabOrder();
    check('dragging the Sandbox tab to the end of the row moves it there (and the Sandbox stays in front)', after[after.length - 1] === 'noor.sandbox' && after.length === before.length && await page.evaluate(() => window.__noor.active()) === 'noor.sandbox', [before, after]);
    await page.keyboard.press('Control+Shift+PageUp');
    after = await tabOrder();
    check('Ctrl+Shift+PageUp moves it one place left', after[after.length - 2] === 'noor.sandbox', after);
    await page.keyboard.press('Control+Shift+PageDown');
    await page.waitForTimeout(400);
    check('…Ctrl+Shift+PageDown back, and the order is kept', (await tabOrder())[after.length - 1] === 'noor.sandbox' && JSON.parse(await page.evaluate(() => localStorage.getItem('mock.settings'))).openBenches.slice(-1)[0] === 'noor.sandbox');
    while ((await tabOrder()).join() !== before.join() && (await tabOrder()).indexOf('noor.sandbox') > before.indexOf('noor.sandbox')) await page.keyboard.press('Control+Shift+PageUp');   // the old order back for the checks below
    check('scrollbars: the themed slim ones (no standard scrollbar-color switching them off)', await page.evaluate(() => getComputedStyle(document.querySelector('.pgroup .pbody')).scrollbarColor === 'auto' && getComputedStyle(document.querySelector('.pgroup .pbody')).scrollbarWidth === 'auto'));

    // ---- the main menu from the keyboard
    await page.click('.sb-text');
    await page.keyboard.press('F10');
    await page.waitForSelector('.nui-menu');
    check('F10 opens the first menu (File)', await page.isVisible('.nui-menu .mi:has-text("Settings…")'));
    await page.keyboard.press('ArrowRight');
    check('…→ moves to Edit', await page.isVisible('.nui-menu .mi:has-text("Undo")'));
    await page.keyboard.press('Escape');
    check('…Esc closes it', !(await page.$('.nui-menu')));

    // ---- Settings: theme, menu position, density per bench
    await page.keyboard.press('Control+,');
    await page.waitForSelector('.nui-dialog');
    await page.selectOption('.nui-dialog select', 'parchment');
    check('Settings › Theme: the whole window changes at once', (await page.getAttribute('html', 'data-theme')) === 'parchment');
    check('…and the window\'s buttons follow', (await calls()).some((c) => c.target === 'window' && c.cmd === 'theme' && c.args.bg === '#f1eadd'));
    await page.click('.nui-dialog [aria-label="Main menu"] button:text-is("Own row")');
    check('…Main menu › Own row: the menus move to a row of their own', await page.isVisible('#menurow') && (await page.$$('#menurow button')).length === 7 && (await page.$$('#menubar button')).length === 0);
    await page.click('.nui-dialog button:text-is("Done")');
    await page.waitForTimeout(400);
    let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mock.settings')));
    check('…Done: saved (theme, menu position)', saved.theme === 'parchment' && saved.menuPosition === 'row', saved);
    await page.keyboard.press('Control+,');
    await page.waitForSelector('.nui-dialog');
    await page.selectOption('.nui-dialog select', 'nocturne');
    await page.click('.nui-dialog button:text-is("Cancel")');
    check('Settings › Cancel puts the theme back', (await page.getAttribute('html', 'data-theme')) === 'parchment');

    // ---- Home again, switching, Window menu, focus mode
    await page.keyboard.press('Control+Shift+H');
    await waitFn(page, () => window.__noor.active() === 'home');
    check('Ctrl+Shift+H: Home in front (its tab stayed beside the others)', (await page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench))).join() === 'home,noor.sandbox,noor.clock');
    await page.keyboard.press('Control+2');
    check('Ctrl+2: the second tab', await page.evaluate(() => window.__noor.active()) === 'noor.sandbox');
    await page.keyboard.press('Control+Tab');
    check('Ctrl+Tab: the next one', await page.evaluate(() => window.__noor.active()) === 'noor.clock');
    await openMenu('Window');
    check('Window lists the open benches with their shortcuts', /Home\s*Ctrl\+1/.test(await page.textContent('.nui-menu')) && /Sandbox\s*Ctrl\+2/.test(await page.textContent('.nui-menu')), await page.textContent('.nui-menu'));
    await pick('Sandbox');
    check('…picking one switches to it (a menu opened after F10 and → no longer swallows the click)', await page.evaluate(() => window.__noor.active()) === 'noor.sandbox');
    await page.keyboard.press('F11');
    check('F11: focus mode hides the tabs, the panels and the status bar', !(await page.isVisible('#benchtabs')) && !(await page.isVisible('.pbody[data-ref="noor.sandbox:stats"]')) && !(await page.isVisible('#statusbar')));
    const fm = await page.evaluate(() => { const b = document.querySelector('section.bench[data-bench="noor.sandbox"]').getBoundingClientRect(), m = document.querySelector('section.bench[data-bench="noor.sandbox"] .main').getBoundingClientRect(); return { bw: b.width, mw: m.width, bh: b.height, mh: m.height }; });
    check('…and the page gets the whole window (no room kept for the hidden panels)', fm.mw > fm.bw - 40 && fm.mh > fm.bh - 30, fm);
    await page.keyboard.press('Escape');
    check('…Esc leaves it', await page.isVisible('#benchtabs'));

    // ---- a restart brings the session back
    await page.waitForTimeout(400);
    await page.reload();
    await waitFn(page, () => window.__noor && window.__noor.active() === 'noor.sandbox' && document.querySelector('.sb-text'));
    check('restart: the same benches, the Sandbox in front (Home isn\'t part of the session)', (await page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench))).sort().join() === 'noor.clock,noor.sandbox' && await page.evaluate(() => window.__noor.active()) === 'noor.sandbox');
    check('…the borrowed Stopwatch is back in the Sandbox, working', await page.isVisible(`section.bench[data-bench="noor.sandbox"] [data-ref="noor.clock:stopwatch"] .ck-go`));
    check('…and the floating Clock opens in its window again', (await page.evaluate(() => window.__noor.floats().map((f) => f.ref))).join() === 'noor.clock:now' && (await page.evaluate(() => (window.__floatOpens || []).map((f) => f.ref))).includes('noor.clock:now'));
    await page.keyboard.press('Control+Shift+G');
    await waitFn(page, () => window.__noor.floats().length === 0);
    check('…the Sandbox\'s text kept (the bench\'s own state)', (await page.inputValue('.sb-text')) === 'NoorMD 3.0 is one home. Benches talk! Three more words.', await page.inputValue('.sb-text'));
    check('…its layout kept (About still hidden, the left side 260 px)', !(await page.isVisible('.pbody[data-ref="noor.sandbox:about"]')) && (await page.$eval('section.bench[data-bench="noor.sandbox"]', (b) => getComputedStyle(b).getPropertyValue('--lw').trim())) === '0px');
    check('…the theme and the menu row kept', (await page.getAttribute('html', 'data-theme')) === 'parchment' && await page.isVisible('#menurow'));

    // ---- closing
    await page.click('.btab[data-bench="noor.sandbox"] .x');
    check('✕ on the tab closes the bench', (await page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench))).join() === 'noor.clock');
    await page.keyboard.press('Control+w');
    await waitFn(page, () => window.__noor.active() === 'home');
    check('closing the last tab brings Home back (never an empty window)', (await page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench))).join() === 'home');
    await page.click('.btab.add');
    check('＋ lists the benches that aren\'t open', await page.isVisible('.nui-menu .mi:has-text("Sandbox")'));
    await page.keyboard.press('Escape');

    if (process.argv.includes('--screenshots')) {
      const dir = process.argv[process.argv.indexOf('--screenshots') + 1];
      fs.mkdirSync(dir, { recursive: true });
      await page.evaluate(() => { localStorage.clear(); });
      await page.reload(); await waitFn(page, () => window.__noor && window.__noor.active() === 'home');
      await page.screenshot({ path: path.join(dir, 'noormd3-home.png') });
      await page.click('.home .card:has-text("Sandbox")'); await waitFn(page, () => document.querySelector('.sb-text'));
      await page.click('.sb-text'); await page.keyboard.type('NoorMD 3.0 is one home for every bench. Each bench is its own DLL, and they talk to each other.');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(dir, 'noormd3-sandbox.png') });
      // Docking: the Clock's panels borrowed into the Sandbox, Statistics tabbed with About, and a drag in progress.
      await openMenu('View'); await pick('Stopwatch (Clock)');
      await page.waitForSelector('[data-ref="noor.clock:stopwatch"] .ck-go');
      await page.click('.btab[data-bench="noor.sandbox"]');
      await openMenu('View'); await pick('Clock (Clock)');
      await page.waitForSelector('.pbody[data-ref="noor.clock:now"]');
      await page.click('section.bench[data-bench="noor.sandbox"] [data-ref="noor.clock:stopwatch"] .ck-go');
      await page.waitForTimeout(1300);
      await page.screenshot({ path: path.join(dir, 'noormd3-docking.png') });
      await page.keyboard.press('F11'); await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(dir, 'noormd3-focus.png') });
      await page.keyboard.press('F11');
      const t = await (await page.$('section.bench[data-bench="noor.sandbox"] .ptab[data-ref="noor.sandbox:stats"]')).boundingBox();
      const a = await (await page.$('section.bench[data-bench="noor.sandbox"] .pgroup:has(.ptab[data-ref="noor.sandbox:about"])')).boundingBox();
      await page.mouse.move(t.x + 20, t.y + 10); await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 10 });
      await page.screenshot({ path: path.join(dir, 'noormd3-dragging.png') });
      await page.mouse.up();
      // Get over here!, mid-flight: two floating panels reeled back in.
      for (const ref of ['noor.sandbox:stats', 'noor.clock:stopwatch']) {
        await page.click(`section.bench[data-bench="noor.sandbox"] .ptab[data-ref="${ref}"]`, { button: 'right' });
        await page.click('.nui-menu .mi:has-text("Float in its own window")');
      }
      await page.evaluate(() => { const fs = window.__noor.floats(); fs[0].x = window.screenX + window.innerWidth + 300; fs[0].y = window.screenY + 200; fs[1].x = window.screenX - 500; fs[1].y = window.screenY + 120; });
      await page.keyboard.press('Control+Shift+G');
      await page.waitForTimeout(560);
      await page.screenshot({ path: path.join(dir, 'noormd3-get-over-here.png') });
      await page.waitForTimeout(800);
    }
    check('no page errors', errors.length === 0, errors);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
})();
