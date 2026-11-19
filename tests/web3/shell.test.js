// NoorMD 3.0's shell page, tested in Chromium against a stand-in for the window (the C# side): files served as the
// window serves them (/ = the shell, /ui = Noor.UI, /benches/<id> = a bench's web folder), and chrome.webview
// answering the shell's and the Sandbox's commands. Run: node tests/web3/shell.test.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'web', 'node_modules', 'playwright'));

const ROOT = path.join(__dirname, '..', '..');
const MOUNTS = [['/ui/', 'src/Noor.UI/'], ['/benches/noor.sandbox/', 'src/Benches/Sandbox/Sandbox.Bench/web/'], ['/', 'src/NoorMD3/wwwroot/']];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const SANDBOX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sandbox.manifest.json'), 'utf8'));

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
const MOCK = (manifest) => {
  const log = (window.__calls = []);
  const listeners = [];
  const store = () => { try { return JSON.parse(localStorage.getItem('mock.settings')); } catch { return null; } };
  const defaults = { theme: 'dark', menuPosition: 'title', density: {}, openBenches: [], activeBench: null, layouts: {}, welcomed: false };
  const words = (t) => (t.match(/[\p{L}\p{N}](?:[\p{L}\p{N}'’-]|\.(?=\p{N}))*/gu) || []).length;
  const send = (data) => setTimeout(() => listeners.forEach((fn) => fn({ data })), 5);
  const answer = (m) => {
    if (m.target === 'shell' && m.cmd === 'start') return { version: '3.0.1', contract: 1, settings: store() || defaults, benches: [manifest], problems: [] };
    if (m.target === 'shell' && m.cmd === 'settings.save') { localStorage.setItem('mock.settings', JSON.stringify(m.args)); return m.args; }
    if (m.target === 'window') return null;
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
    await context.addInitScript(MOCK, SANDBOX);
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
    check('…the status bar names the version', (await page.textContent('#status-app')) === 'NoorMD 3.0.1');
    check('…the window got the theme\'s colours for its native buttons', (await calls()).some((c) => c.target === 'window' && c.cmd === 'theme' && c.args.bg === '#0b0d12'));
    check('…the main menu: File, Edit, View, Tools, Window, Help', (await menuTitles()).join() === 'File,Edit,View,Tools,Window,Help', await menuTitles());
    check('…Home offers the Sandbox', await page.isVisible('.home .card:has-text("Sandbox")'));

    // ---- opening the Sandbox: its tab, its menu between View and Tools, its panels, its module from its folder
    await page.click('.home .card:has-text("Sandbox")');
    await waitFn(page, () => window.__noor.active() === 'noor.sandbox' && document.querySelector('.sb-text'));
    check('Sandbox opens as a tab, in front', (await page.$$eval('.btab[aria-selected=true]', (t) => t.map((x) => x.dataset.bench))).join() === 'noor.sandbox');
    check('…the menu follows it: Sandbox sits between View and Tools', (await menuTitles()).join() === 'File,Edit,View,Sandbox,Tools,Window,Help', await menuTitles());
    check('…its panels: About on the left, Statistics on the right', await page.isVisible('[data-bench="noor.sandbox"] .side.left [data-panel=about]') && await page.isVisible('[data-bench="noor.sandbox"] .side.right [data-panel=stats]'));
    check('…the title bar names it', (await page.textContent('#wintitle')).startsWith('Sandbox'));

    // ---- a round trip to its C# side
    await page.click('.sb-text');
    await page.keyboard.type('NoorMD 3.0 is one home. Benches talk!');
    await waitFn(page, () => /7 words/.test(document.querySelector('#status-bench').textContent));
    check('typing: the C# side counts, the status bar says so', /7 words · 1 min read/.test(await status()), await status());
    check('…and the Statistics panel shows it (an event inside the bench)', /Words\s*7/.test(await page.textContent('[data-panel=stats] .pbody')) && /Sentences\s*2/.test(await page.textContent('[data-panel=stats] .pbody')), await page.textContent('[data-panel=stats] .pbody'));
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
    check('View › Statistics hides the panel', !(await page.isVisible('[data-panel=stats]')));
    await openMenu('View');
    check('…the View menu shows it unticked', (await page.getAttribute('.nui-menu .mi:has-text("Statistics")', 'aria-checked')) === 'false');
    await pick('Statistics');
    check('…and ticks it back', await page.isVisible('[data-panel=stats]'));
    await page.click('[data-panel=about] header .nui-icon');
    check('✕ on a panel hides it', !(await page.isVisible('[data-panel=about]')));
    await openMenu('View'); await pick('Compact');
    check('View › Compact: the bench turns compact', await page.evaluate(() => document.body.classList.contains('density-compact')));
    await openMenu('View'); await pick('Roomy');
    check('…and roomy again', await page.evaluate(() => document.body.classList.contains('density-roomy')));

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
    check('Ctrl+Shift+H: Home in front (its tab stayed beside the Sandbox)', (await page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench))).join() === 'home,noor.sandbox');
    await page.keyboard.press('Control+2');
    check('Ctrl+2: the second tab', await page.evaluate(() => window.__noor.active()) === 'noor.sandbox');
    await page.keyboard.press('Control+Tab');
    check('Ctrl+Tab: the next one (round to the first)', await page.evaluate(() => window.__noor.active()) === 'home');
    await openMenu('Window');
    check('Window lists the open benches with their shortcuts', /Home\s*Ctrl\+1/.test(await page.textContent('.nui-menu')) && /Sandbox\s*Ctrl\+2/.test(await page.textContent('.nui-menu')), await page.textContent('.nui-menu'));
    await pick('Sandbox');
    await page.keyboard.press('F11');
    check('F11: focus mode hides the tabs, the panels and the status bar', !(await page.isVisible('#benchtabs')) && !(await page.isVisible('[data-panel=stats]')) && !(await page.isVisible('#statusbar')));
    await page.keyboard.press('Escape');
    check('…Esc leaves it', await page.isVisible('#benchtabs'));

    // ---- a restart brings the session back
    await page.waitForTimeout(400);
    await page.reload();
    await waitFn(page, () => window.__noor && window.__noor.active() === 'noor.sandbox' && document.querySelector('.sb-text'));
    check('restart: the same bench in front (Home isn\'t part of the session)', (await page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench))).join() === 'noor.sandbox');
    check('…the Sandbox\'s text kept (the bench\'s own state)', (await page.inputValue('.sb-text')) === 'NoorMD 3.0 is one home. Benches talk!');
    check('…its layout kept (About still hidden, the left side 260 px)', !(await page.isVisible('[data-panel=about]')) && (await page.$eval('section.bench[data-bench="noor.sandbox"]', (b) => getComputedStyle(b).getPropertyValue('--lw').trim())) === '0px');
    check('…the theme and the menu row kept', (await page.getAttribute('html', 'data-theme')) === 'parchment' && await page.isVisible('#menurow'));

    // ---- closing
    await page.click('.btab[data-bench="noor.sandbox"] .x');
    check('✕ on the tab closes the bench', (await page.$$eval('.btab[data-bench]', (t) => t.map((x) => x.dataset.bench))).join() === 'home');
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
    }
    check('no page errors', errors.length === 0, errors);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
})();
