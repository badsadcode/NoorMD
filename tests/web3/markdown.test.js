// NoorMD 3.0's Markdown bench, tested in Chromium inside the real shell page. The window (C# side) is a stand-in:
// the shell's commands, and the Markdown bench's file commands over a pretend disk kept in localStorage (so a reload
// is the app starting again). Run: node tests/web3/markdown.test.js [--screenshots dir]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'web', 'node_modules', 'playwright'));

const ROOT = path.join(__dirname, '..', '..');
const MOUNTS = [['/ui/', 'src/Noor.UI/'], ['/benches/noor.markdown/', 'src/Benches/Markdown/Markdown.Bench/web/'], ['/benches/noor.clock/', 'src/Benches/Clock/Clock.Bench/web/'], ['/', 'src/NoorMD3/wwwroot/']];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const MARKDOWN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'markdown.manifest.json'), 'utf8'));
const CLOCK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'clock.manifest.json'), 'utf8'));
// Long enough that going to its last heading has to scroll.
const PLAN = '# Plan\n\nSome words.\n\n## Steps\n\n* one\n* two\n\n' + 'A paragraph to scroll past.\n\n'.repeat(40) + '### Later\n\nMore.\n';
const shotsAt = process.argv.indexOf('--screenshots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

let failed = 0, passed = 0;
function check(name, ok, extra) {
  if (ok) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const m = MOUNTS.find(([p]) => url.startsWith(p));
    const file = path.join(ROOT, m[1], url.slice(m[0].length) || 'index.html');
    if (!file.startsWith(path.join(ROOT, m[1])) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const MOCK = (manifests) => {
  const log = (window.__calls = []);
  const listeners = [];
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch { return d; } };
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const defaults = { theme: 'dark', menuPosition: 'title', density: {}, openBenches: ['noor.markdown'], activeBench: 'noor.markdown', layouts: {}, welcomed: true };
  const send = (data) => setTimeout(() => listeners.forEach((fn) => fn({ data })), 5);
  const docs = {};   // the C# side's open documents (this run only, like the real one)
  const name = (p) => p.split(/[\\/]/).pop();
  const answer = (m) => {
    const a = m.args || {};
    if (m.target === 'shell' && m.cmd === 'start') return { version: '3.0.5', contract: 1, settings: get('mock.settings', defaults), benches: manifests, problems: [] };
    if (m.target === 'shell' && m.cmd === 'settings.save') { put('mock.settings', a); return a; }
    if (m.target === 'window' && m.cmd === 'print') { window.__printed = (document.getElementById('print-root') || {}).innerHTML || ''; return null; }
    if (m.target === 'window') return null;
    if (m.target === 'bench:noor.clock') return [];
    if (m.target !== 'bench:noor.markdown') throw new Error(`no ${m.target} ${m.cmd}`);
    const disk = get('mock.disk', {}), drafts = get('mock.drafts', {}), recent = get('mock.recent', []);
    const touch = (p) => put('mock.recent', [p, ...recent.filter((x) => x !== p)]);
    const write = (doc, p, text) => { const f = disk[p] || { format: 'UTF-8 · LF', stamp: 0 }; disk[p] = { ...f, text, stamp: f.stamp + 1 }; put('mock.disk', disk); docs[doc] = { path: p, stamp: disk[p].stamp }; delete drafts[doc]; put('mock.drafts', drafts); touch(p); return { path: p, name: name(p), format: disk[p].format }; };
    switch (m.cmd) {
      case 'md.pick': { const q = get('mock.picks', []); const next = q.shift() || []; put('mock.picks', q); return next; }
      case 'md.load': {
        const f = disk[a.path];
        if (!f) throw new Error(`"${a.path}" does not exist.`);
        docs[a.doc] = { path: a.path, stamp: f.stamp }; touch(a.path);
        return { path: a.path, name: name(a.path), markdown: f.text, format: f.format, warning: null };
      }
      case 'md.write': {
        const d = docs[a.doc];
        if (!d || !d.path) return { needsPath: true };
        if (!a.overwrite && disk[d.path] && disk[d.path].stamp !== d.stamp) return { conflict: true };
        return write(a.doc, d.path, a.markdown);
      }
      case 'md.writeAs': { const q = get('mock.saves', []); const p = q.shift(); put('mock.saves', q); return p ? write(a.doc, p, a.markdown) : null; }
      case 'md.draft': drafts[a.doc] = { id: a.doc, title: a.title, markdown: a.markdown, path: docs[a.doc] && docs[a.doc].path, stamp: docs[a.doc] && docs[a.doc].stamp }; put('mock.drafts', drafts); return null;
      case 'md.dropDraft': delete drafts[a.doc]; put('mock.drafts', drafts); return null;
      case 'md.resume': { const d = drafts[a.doc]; if (!d) return null; docs[a.doc] = { path: d.path, stamp: d.stamp }; return { path: d.path || null, name: d.path ? name(d.path) : null, title: d.title, markdown: d.markdown, format: 'UTF-8 · LF' }; }
      case 'md.closeDoc': delete docs[a.doc]; delete drafts[a.doc]; put('mock.drafts', drafts); (window.__closedDocs = window.__closedDocs || []).push(a.doc); return null;
      case 'md.drafts': return Object.values(drafts).filter((d) => !(a.except || []).includes(d.id)).map((d) => ({ id: d.id, title: d.title, path: d.path || null, words: 1 }));
      case 'md.recentList': return recent.map((p) => ({ path: p, name: name(p), folder: p.slice(0, p.length - name(p).length - 1), exists: !!disk[p] }));
      case 'md.recentForget': put('mock.recent', a.path ? recent.filter((x) => x !== a.path) : []); return null;
      case 'md.changed': { const d = docs[a.doc]; return !!(d && d.path && disk[d.path] && disk[d.path].stamp !== d.stamp); }
      case 'md.snapList': return (get('mock.snaps', {})[a.doc] || []).map(({ markdown, ...s }) => s);
      case 'md.snapTake': { const all = get('mock.snaps', {}); const s = { id: 'snap' + Date.now() + Math.random().toString(16).slice(2, 6), createdUtc: new Date().toISOString(), label: a.label, words: (a.markdown.match(/\S+/g) || []).length, markdown: a.markdown }; all[a.doc] = [s, ...(all[a.doc] || [])]; put('mock.snaps', all); const { markdown, ...info } = s; return info; }
      case 'md.snapGet': { const s = (get('mock.snaps', {})[a.doc] || []).find((x) => x.id === a.id); if (!s) throw new Error('That snapshot isn\'t there any more.'); return s; }
      case 'md.snapDelete': { const all = get('mock.snaps', {}); all[a.doc] = (all[a.doc] || []).filter((x) => x.id !== a.id); put('mock.snaps', all); return null; }
      case 'md.exportHtml': window.__exported = a; return { path: 'C:\\Out\\' + a.title + '.html' };
      case 'md.exportPdf': window.__pdf = { ...a, printed: (document.getElementById('print-root') || {}).innerHTML || '' }; return { path: 'C:\\Out\\' + a.title + '.pdf' };
      case 'md.reveal': (window.__revealed = window.__revealed || []).push(a.doc); return null;
      case 'md.pickImage': return { url: 'images/cat%20photo.png', name: 'cat photo' };
      default: throw new Error(`no ${m.cmd}`);
    }
  };
  window.__mockSend = send;   // the window telling the page something (files handed over, …)
  window.chrome = { webview: {
    postMessage(m) { log.push(m); let reply; try { reply = { id: m.id, ok: true, result: answer(m) }; } catch (e) { reply = { id: m.id, ok: false, error: e.message }; } send(reply); },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
  } };
};

async function waitFn(page, fn, arg, timeout = 8000) { await page.waitForFunction(fn, arg, { timeout }); }
const ST = () => window.__noor.open.get('noor.markdown').mounted._state();
const state = (page) => page.evaluate(ST);

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
    await context.addInitScript(MOCK, [MARKDOWN, CLOCK]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });   // (an inserted picture the test server doesn't have)
    const ready = async () => { await waitFn(page, () => { const i = window.__noor && window.__noor.open.get('noor.markdown'); return i && i.mounted && i.mounted._state && i.mounted._state().ready; }); await page.waitForTimeout(150); };
    const setDisk = (files) => page.evaluate((f) => { localStorage.setItem('mock.disk', JSON.stringify(f)); }, files);
    const queue = (key, items) => page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [key, items]);
    const disk = () => page.evaluate(() => JSON.parse(localStorage.getItem('mock.disk') || '{}'));
    const clickMenu = async (menuTitle, item) => {
      await page.click(`[data-menu]:text-is("${menuTitle}")`);
      await page.click(`.nui-menu .mi:has-text("${item}")`);
    };
    const dialogButton = (label) => page.click(`.nui-dialog .nui-btn:text-is("${label}")`);

    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await ready();

    // ---------------------------------------------------------------- the very first start: the welcome document
    await waitFn(page, () => document.querySelectorAll('.md-tab').length === 1);
    check('the first time, the welcome document opens', (await page.textContent('.md-tab .name')) === 'Welcome to Markdown' && (await state(page)).docs[0].text.startsWith('# Welcome to the Markdown bench'));
    check('…not as unsaved work', !(await state(page)).docs[0].dirty);
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(200);
    check('closing it asks nothing (nothing to lose)', !(await page.$('.nui-dialog')) && (await state(page)).docs.length === 0);

    // ---------------------------------------------------------------- an empty bench
    await page.waitForSelector('.md-empty h2');
    check('the Markdown bench, with nothing open', (await page.textContent('.md-empty h2')) === 'Nothing open yet');
    check('…and says so in the status bar', (await page.textContent('#status-bench')).includes('Nothing open'));

    // ---------------------------------------------------------------- menus join the shell's
    await page.click('[data-menu]:text-is("File")');
    const fileItems = await page.$$eval('.nui-menu .mi', (xs) => xs.map((x) => x.textContent));
    await page.keyboard.press('Escape');
    check('File holds the bench\'s items first, then the shell\'s', fileItems[0].includes('New document') && fileItems.some((t) => t.includes('Open…')) && fileItems.some((t) => t.includes('Home')) && fileItems.some((t) => t.includes('Close Markdown') && t.includes('Ctrl+Shift+W')), fileItems);
    const titles = await page.$$eval('[data-menu]', (xs) => xs.map((x) => x.textContent));
    check('one File, one View, and the bench\'s Format and Insert between View and Tools', titles.join(',') === 'File,Edit,View,Format,Insert,Tools,Window,Help', titles);

    // ---------------------------------------------------------------- a new document
    await page.keyboard.press('Control+n');
    await waitFn(page, () => document.querySelector('.md-pane:not([hidden]) .toastui-editor-defaultUI'));
    check('Ctrl+N: a new document in a tab, with the editor', (await page.$$('.md-tab')).length === 1 && (await page.textContent('.md-tab .name')) === 'Untitled document');
    check('the editor is dark in a dark theme', !!(await page.$('.md-pane:not([hidden]) .toastui-editor-defaultUI.toastui-editor-dark')));
    await page.click('.md-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
    await page.keyboard.type('Hello there, little document.');
    await waitFn(page, () => document.querySelector('.md-tab .dot'));
    check('typing marks it unsaved (a dot on its tab, ● in the title)', (await page.textContent('#wintitle')).includes('●'));
    await page.waitForTimeout(300);
    check('the status bar counts the words', (await page.textContent('#status-bench')).includes('4 words'));
    await page.waitForTimeout(800);
    check('unsaved work goes to a draft', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mock.drafts') || '{}')).length === 1));

    // Ctrl+B inside the editor is the editor's own: it isn't run a second time by the menu's shortcut.
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(100);
    check('Ctrl+B in the editor makes it bold once (not twice, back to plain)', (await state(page)).docs[0].text.includes('**Hello there, little document.**'), (await state(page)).docs[0].text);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    check('Ctrl+Z undoes it', !(await state(page)).docs[0].text.includes('**'));

    // ---------------------------------------------------------------- save (a new document asks where)
    await queue('mock.saves', ['C:\\Notes\\hello.md']);
    await page.keyboard.press('Control+s');
    await waitFn(page, () => !document.querySelector('.md-tab .dot'));
    check('Ctrl+S on a new document: Save As, then the tab takes the file\'s name', (await page.textContent('.md-tab .name')) === 'hello.md');
    check('…the words are on disk', ((await disk())['C:\\Notes\\hello.md'] || {}).text === 'Hello there, little document.');
    check('…and the draft is gone', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mock.drafts') || '{}')).length === 0));

    // ---------------------------------------------------------------- open: a file Visual can show, one it can't
    await setDisk({
      ...(await disk()),
      'C:\\Notes\\plan.md': { text: PLAN, format: 'UTF-8 · CRLF', stamp: 1 },
      'C:\\Notes\\raw.md': { text: '# Raw\n\n<div align="center">HTML here</div>\n\nLine one  \nhard break\n', format: 'UTF-8 · LF', stamp: 1 },
    });
    await queue('mock.picks', [['C:\\Notes\\plan.md', 'C:\\Notes\\raw.md']]);
    await page.keyboard.press('Control+o');
    await waitFn(page, () => document.querySelectorAll('.md-tab').length === 3);
    let s = await state(page);
    check('Ctrl+O: both picked files open as tabs', s.docs.map((d) => d.name).join(',') === 'hello.md,plan.md,raw.md', s.docs.map((d) => d.name));
    check('a file with raw HTML and hard breaks opens as Markdown, never rewritten by Visual', s.docs[2].mode === 'markdown' && !(await page.isHidden('.md-banner')));
    check('…and its text is exactly the file', s.docs[2].text === '# Raw\n\n<div align="center">HTML here</div>\n\nLine one  \nhard break\n');
    await page.click('.md-tab[data-doc] .name:text-is("plan.md")');
    await page.waitForTimeout(200);
    s = await state(page);
    check('plan.md opens in Visual', s.docs[1].mode === 'wysiwyg');
    check('…the status bar shows its file format', (await page.textContent('#status-bench')).includes('UTF-8 · CRLF'));
    check('…and merely looking at it in Visual changes nothing (* stays *, not -)', s.docs[1].text === PLAN, s.docs[1].text);
    await page.click('.md-modes button[data-mode="markdown"]');
    await page.waitForTimeout(150);
    s = await state(page);
    check('to Markdown without an edit: the source exactly as it was', s.docs[1].mode === 'markdown' && s.docs[1].text === PLAN, s.docs[1].text);
    check('…and still not "unsaved"', !s.docs[1].dirty);
    await page.click('.md-modes button[data-mode="split"]');
    await page.waitForTimeout(150);
    check('side by side shows the preview next to the source', (await state(page)).docs[1].mode === 'split' && await page.isVisible('.md-pane:not([hidden]) .toastui-editor-md-preview'));
    await page.keyboard.press('Control+e');
    await page.waitForTimeout(150);
    check('Ctrl+E: the next view (side by side → Visual)', (await state(page)).docs[1].mode === 'wysiwyg');

    // ---------------------------------------------------------------- the outline panel
    await page.waitForSelector('.md-outline button');
    const outline = await page.$$eval('.md-outline button', (xs) => xs.map((x) => x.className + ':' + x.textContent));
    check('the Outline panel lists the headings of the document on screen', outline.join('|') === 'l1:Plan|l2:Steps|l3:Later', outline);
    await page.click('.md-tab .name:text-is("raw.md")');
    await page.waitForTimeout(400);
    check('…and follows the document on screen', (await page.$$eval('.md-outline button', (xs) => xs.map((x) => x.textContent))).join('|') === 'Raw');
    await page.click('.md-tab .name:text-is("plan.md")');
    await page.waitForTimeout(400);
    await page.click('.md-outline button:text-is("Later")');
    await page.waitForTimeout(200);
    check('clicking a heading scrolls the editor to it (far down the document)', await page.evaluate(() => { const h = [...document.querySelectorAll('.md-pane:not([hidden]) .ProseMirror h3')][0]; const r = h.getBoundingClientRect(), box = document.querySelector('.md-pane:not([hidden]) .toastui-editor-ww-container').getBoundingClientRect(); return r.top >= box.top - 2 && r.bottom <= box.bottom ? true : [r.top, box.top]; }) === true, await page.evaluate(() => [document.querySelector('.md-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror').scrollTop, document.querySelector('.md-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror').scrollHeight, document.querySelector('.md-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror').clientHeight]));

    // ---------------------------------------------------------------- the formatting bar
    const tool = (cmd) => `.md-tools .md-tool[data-cmd="${cmd}"]`;
    const text1 = async () => (await state(page)).docs[1].text;
    check('a formatting bar: headings, bold, italic, lists, quote, code, table…', (await page.$$('.md-tools .md-tool')).length === 19 && await page.isVisible(tool('md.fmt.bold')));
    await page.click('.md-pane:not([hidden]) .ProseMirror p');
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.click(tool('md.fmt.bold'));
    await page.waitForTimeout(100);
    check('Bold on the bar makes the selection bold', (await text1()).includes('**Some words.**'), (await text1()).slice(0, 60));
    check('…and lights up while the cursor is in bold text', (await page.getAttribute(tool('md.fmt.bold'), 'aria-pressed')) === 'true');
    check('…keeping the cursor in the editor', await page.evaluate(() => !!document.activeElement.closest('.ProseMirror')));
    await page.click(tool('md.fmt.bold'));
    await page.waitForTimeout(100);
    check('Bold again takes it off', !(await text1()).includes('**'));
    await page.click(tool('heading'));
    await page.click('.nui-menu .mi:has-text("Heading 2")');
    await page.waitForTimeout(100);
    check('the paragraph-style picker: Heading 2', (await text1()).includes('## Some words.'));
    check('…and the picker says where the cursor is', (await page.textContent('.md-heading .lbl')) === 'Heading 2');
    await page.keyboard.press('Control+Shift+Digit3');
    await page.waitForTimeout(100);
    check('Ctrl+Shift+3: Heading 3', (await text1()).includes('### Some words.') && (await page.textContent('.md-heading .lbl')) === 'Heading 3');
    await page.keyboard.press('Control+Shift+Digit0');
    await page.waitForTimeout(100);
    check('Ctrl+Shift+0: plain text again', (await text1()).includes('\n\nSome words.') && (await page.textContent('.md-heading .lbl')) === 'Text');
    await page.click(tool('md.fmt.ul'));
    await page.waitForTimeout(100);
    check('the list button makes a bulleted list (and lights up)', /\n[*-] Some words\./.test(await text1()) && (await page.getAttribute(tool('md.fmt.ul'), 'aria-pressed')) === 'true');
    await page.click(tool('edit.undo'));
    await page.waitForTimeout(100);
    check('Undo on the bar takes it back', (await text1()).includes('\n\nSome words.\n') && !/\n[*-] Some words\./.test(await text1()));
    // In Markdown view the bar writes Markdown.
    await page.click('.md-modes button[data-mode="markdown"]');
    await page.waitForTimeout(150);
    await page.click('.md-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div:nth-child(3)');
    await page.click(tool('heading'));
    await page.click('.nui-menu .mi:has-text("Heading 1")');
    await page.waitForTimeout(100);
    check('in Markdown view too: Heading 1 puts a # in front', (await text1()).includes('\n# Some words.'), (await text1()).slice(0, 60));
    check('…and the picker reads it back', (await page.textContent('.md-heading .lbl')) === 'Heading 1');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    await page.click('.md-modes button[data-mode="wysiwyg"]');
    await page.waitForTimeout(150);
    await clickMenu('View', 'Formatting bar');
    check('View › Formatting bar hides it', await page.isHidden('.md-tools'));
    await clickMenu('View', 'Formatting bar');
    check('…and brings it back', await page.isVisible('.md-tools'));

    // ---------------------------------------------------------------- Format and Insert menus
    await page.click('.md-pane:not([hidden]) .ProseMirror p');
    await page.keyboard.press('End');
    await clickMenu('Format', 'Heading 2');
    await page.waitForTimeout(100);
    check('Format › Heading 2 turns the paragraph into a heading', (await state(page)).docs[1].text.includes('## Some words.'));
    await page.keyboard.press('Control+z');
    await clickMenu('Insert', 'Table');
    await page.waitForTimeout(100);
    check('Insert › Table adds a table', (await state(page)).docs[1].text.includes('|'), (await state(page)).docs[1].text.slice(0, 120));

    await page.click(tool('md.ins.image'));
    await page.waitForSelector('.nui-dialog');
    await page.click('.nui-dialog .nui-btn:text-is("Choose a file…")');
    await page.waitForTimeout(100);
    await dialogButton('Insert');
    await page.waitForTimeout(150);
    check('the image button: a picture chosen from a file goes in with a relative path and its name', (await state(page)).docs[1].text.includes('![cat photo](images/cat%20photo.png)'), (await state(page)).docs[1].text.slice(0, 200));
    check('New and Open stay usable on the bar; the rest wait for a document', true);

    // ---------------------------------------------------------------- someone else changed the file
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mock.disk')); d['C:\\Notes\\plan.md'].stamp = 7; d['C:\\Notes\\plan.md'].text = 'theirs'; localStorage.setItem('mock.disk', JSON.stringify(d)); });
    await page.keyboard.press('Control+s');
    await page.waitForSelector('.nui-dialog');
    check('saving over another program\'s changes asks first', (await page.textContent('.nui-dialog header')).includes('Changed by another program'));
    await dialogButton('Cancel');
    check('Cancel: their changes stay', (await disk())['C:\\Notes\\plan.md'].text === 'theirs' && (await state(page)).docs[1].dirty);
    await page.keyboard.press('Control+s');
    await page.waitForSelector('.nui-dialog');
    await dialogButton('Replace them');
    await waitFn(page, () => !document.querySelector('.md-tab[aria-selected=true] .dot'));
    check('Replace them: saved', (await disk())['C:\\Notes\\plan.md'].text.includes('# Plan'));

    // ---------------------------------------------------------------- Ctrl+W closes a document, not the bench
    await page.click('.md-tab .name:text-is("raw.md")');
    await page.click('.md-pane:not([hidden]) .toastui-editor-md-container .ProseMirror');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nmore');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+w');
    await page.waitForSelector('.nui-dialog');
    check('Ctrl+W on an unsaved document asks (and the bench stays open)', (await page.textContent('.nui-dialog .body')).includes('raw.md') && await page.evaluate(() => window.__noor.open.has('noor.markdown')));
    await dialogButton('Don\'t save');
    await page.waitForTimeout(200);
    s = await state(page);
    check('Don\'t save: the document closes, the file is untouched', s.docs.length === 2 && (await disk())['C:\\Notes\\raw.md'].text.endsWith('hard break\n'));

    // ---------------------------------------------------------------- the app closes with unsaved work, and starts again
    await page.click('.md-tab .name:text-is("hello.md")');
    await page.click('.md-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Unsaved words.');
    await page.waitForTimeout(900);
    // A draft nobody owns (a crash between writing it and keeping the session).
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mock.drafts') || '{}'); d['00ff00ff00ff00ff'] = { id: '00ff00ff00ff00ff', title: 'Lost poem', markdown: 'Roses are #b19aff' }; localStorage.setItem('mock.drafts', JSON.stringify(d)); });
    await page.waitForTimeout(400);
    await page.reload();
    await ready();
    await page.waitForTimeout(300);
    s = await state(page);
    check('next start: the same documents come back, the same one on screen', s.docs.map((d) => d.name).join(',') === 'hello.md,plan.md' && s.docs.find((d) => d.id === s.current).name === 'hello.md', s.docs.map((d) => d.name));
    check('…with the unsaved words, still unsaved', s.docs[0].dirty && s.docs[0].text.includes('Unsaved words.'), s.docs[0]);
    check('…and in the view they were in', s.docs[1].mode === 'wysiwyg');
    check('a draft nobody owned is offered', (await page.textContent('.md-banner')).includes('Lost poem'));
    await page.click('.md-banner .nui-btn:text-is("Bring it back")');
    await page.waitForTimeout(300);
    s = await state(page);
    check('Bring it back: it opens as an unsaved document', s.docs.length === 3 && s.docs[2].name === 'Lost poem' && s.docs[2].dirty && s.docs[2].text === 'Roses are #b19aff');

    // ---------------------------------------------------------------- closing the bench with unsaved work
    await page.keyboard.press('Control+Shift+W');
    await page.waitForSelector('.nui-dialog');
    check('closing the bench with unsaved documents asks', (await page.textContent('.nui-dialog .body')).includes('2 documents'));
    await dialogButton('Cancel');
    await page.waitForTimeout(100);
    check('Cancel: the bench stays', await page.evaluate(() => window.__noor.open.has('noor.markdown')));
    await page.keyboard.press('Control+Shift+W');
    await page.waitForSelector('.nui-dialog');
    await dialogButton('Keep for next time');
    await page.waitForTimeout(300);
    check('Keep for next time: the bench closes, the drafts stay', !(await page.evaluate(() => window.__noor.open.has('noor.markdown'))) && await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mock.drafts') || '{}')).length === 2));
    check('…and no document was thrown away', !(await page.evaluate(() => (window.__closedDocs || []).length)));
    // Open the bench again (it's no longer in the session; the shell's own settings save has to settle first).
    await page.waitForTimeout(700);
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('mock.settings')); s.openBenches = ['noor.markdown']; s.activeBench = 'noor.markdown'; localStorage.setItem('mock.settings', JSON.stringify(s)); });
    await page.reload();
    await ready();
    await page.waitForTimeout(300);
    s = await state(page);
    check('opened again: the kept documents are back with their changes', s.docs.length === 3 && s.docs.filter((d) => d.dirty).length === 2, s.docs.map((d) => [d.name, d.dirty]));

    // ---------------------------------------------------------------- recent files
    for (const d of s.docs) { await page.click(`.md-tab[data-doc="${d.id}"] .x`); if (await page.$('.nui-dialog')) await dialogButton('Don\'t save'); await page.waitForTimeout(150); }
    await page.waitForSelector('.md-empty .md-recent-item');
    const recent = await page.$$eval('.md-empty .md-recent-item .n', (xs) => xs.map((x) => x.textContent));
    check('with everything closed, the empty bench lists recent files', recent.includes('plan.md') && recent.includes('hello.md'), recent);
    await page.click('.md-empty .md-recent-item .n:text-is("plan.md")');
    await waitFn(page, () => document.querySelectorAll('.md-tab').length === 1);
    check('…and one click opens it again', (await page.textContent('.md-tab .name')) === 'plan.md');

    // ---------------------------------------------------------------- find and replace (plan.md is open again)
    await page.click('.md-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror h1');
    await page.keyboard.press('Control+f');
    check('Ctrl+F opens the find bar, with the cursor in it', await page.isVisible('.md-findbar') && await page.evaluate(() => document.activeElement.classList.contains('md-find-input')));
    await page.keyboard.type('paragraph');
    await page.waitForTimeout(100);
    check('…and counts the matches', (await page.textContent('.md-find-count')) === '1 of 40', await page.textContent('.md-find-count'));
    await page.keyboard.press('Enter');
    check('Enter: the next one', (await page.textContent('.md-find-count')) === '2 of 40');
    await page.keyboard.press('Shift+Enter');
    check('Shift+Enter: back', (await page.textContent('.md-find-count')) === '1 of 40');
    check('the matches are highlighted (and the document isn\'t touched)', await page.evaluate(() => CSS.highlights.has('noor-find-current')) && !(await state(page)).docs[0].dirty);
    await page.keyboard.press('Escape');
    check('Esc closes it', await page.isHidden('.md-findbar') && await page.evaluate(() => !CSS.highlights.has('noor-find')));
    await page.keyboard.press('Control+h');
    check('Ctrl+H: find and replace, with the last search', await page.isVisible('.md-find-replace') && (await page.inputValue('.md-find-input')) === 'paragraph');
    await page.fill('.md-find-replace input', 'line');
    await page.click('.md-find-replace .nui-btn:text-is("All")');
    await page.waitForTimeout(150);
    let pt = (await state(page)).docs[0].text;
    check('Replace all: every one replaced, in one go', !pt.includes('paragraph') && (pt.match(/A line to scroll past/g) || []).length === 40);
    await page.keyboard.press('Escape');
    await page.click('.md-tools .md-tool[data-cmd="edit.undo"]');
    await page.waitForTimeout(150);
    check('…and one Undo brings them all back', ((await state(page)).docs[0].text.match(/A paragraph to scroll past/g) || []).length === 40);

    // ---------------------------------------------------------------- text size, line width, the Markdown view's options
    const docSize = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.md-pane:not([hidden]) .toastui-editor-contents')).fontSize));
    const before = await docSize();
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);
    check('Ctrl+= makes the text bigger', (await docSize()) === before + 2, [before, await docSize()]);
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(50);
    check('Ctrl+0: back to normal', (await docSize()) === before);
    await clickMenu('View', 'Line width: wide');
    check('View › Line width: wide', (await state(page)).prefs.width === 'wide' && await page.evaluate(() => getComputedStyle(document.querySelector('.md-bench')).getPropertyValue('--measure').trim() === '1100px'));
    await page.click('[data-menu]:text-is("View")');
    check('…and the View menu ticks it (and the view the document is in)', (await page.getAttribute('.nui-menu .mi:has-text("Line width: wide")', 'aria-checked')) === 'true' && (await page.getAttribute('.nui-menu .mi:has-text("Visual")', 'aria-checked')) === 'true');
    await page.keyboard.press('Escape');
    await clickMenu('View', 'Line width: comfortable');
    await page.click('.md-modes button[data-mode="markdown"]');
    await page.waitForTimeout(150);
    check('the Markdown view numbers its lines', await page.evaluate(() => document.querySelector('.md-bench').classList.contains('source-line-numbers') && getComputedStyle(document.querySelector('.md-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div'), '::before').content.includes('counter')));
    await clickMenu('View', 'Line numbers (Markdown view)');
    check('…until you turn them off', !(await page.evaluate(() => document.querySelector('.md-bench').classList.contains('source-line-numbers'))));
    await clickMenu('View', 'Line numbers (Markdown view)');
    await clickMenu('View', 'Word wrap (Markdown view)');
    check('word wrap can go off (long lines scroll sideways)', await page.evaluate(() => getComputedStyle(document.querySelector('.md-pane:not([hidden]) .toastui-editor-md-container .ProseMirror')).whiteSpace === 'pre'));
    await clickMenu('View', 'Word wrap (Markdown view)');
    await clickMenu('View', 'Spellcheck');
    check('spellcheck can go off', await page.evaluate(() => document.querySelector('.md-pane:not([hidden]) .ProseMirror').getAttribute('spellcheck') === 'false'));
    await clickMenu('View', 'Spellcheck');
    await page.click('.md-modes button[data-mode="split"]');
    await page.waitForTimeout(150);
    const sp = await page.$('.md-pane:not([hidden]) .toastui-editor-md-splitter');
    const spb = await sp.boundingBox();
    await page.mouse.move(spb.x + spb.width / 2, spb.y + 200);
    await page.mouse.down();
    await page.mouse.move(spb.x + spb.width / 2 - 200, spb.y + 200, { steps: 5 });
    await page.mouse.up();
    check('side by side: the divider drags', (await state(page)).prefs.split < 0.42, (await state(page)).prefs.split);
    await sp.dblclick();
    check('…and a double-click puts it back in the middle', (await state(page)).prefs.split === 0.5);
    await page.click('.md-modes button[data-mode="wysiwyg"]');
    await page.waitForTimeout(150);

    // ---------------------------------------------------------------- another program changes the open file
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mock.disk')); d['C:\\Notes\\plan.md'].stamp += 5; d['C:\\Notes\\plan.md'].text = '# Plan, rewritten elsewhere\n'; localStorage.setItem('mock.disk', JSON.stringify(d)); });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForSelector('.md-banner:not([hidden])');
    check('coming back to NoorMD: "changed by another program"', (await page.textContent('.md-banner')).includes('changed by another program'));
    await page.click('.md-banner .nui-btn:text-is("Reload")');
    await page.waitForSelector('.nui-dialog');
    check('…with unsaved changes here, Reload asks first', (await page.textContent('.nui-dialog .body')).includes('throws away'));
    await dialogButton('Reload');
    await page.waitForTimeout(250);
    check('Reload: the file as it is now, and nothing unsaved', (await state(page)).docs[0].text === '# Plan, rewritten elsewhere\n' && !(await state(page)).docs[0].dirty && await page.isHidden('.md-banner'));

    // ---------------------------------------------------------------- the document tab's menu, naming a new document
    await page.click('.md-tab .name:text-is("plan.md")', { button: 'right' });
    const tabItems = await page.$$eval('.nui-menu .mi', (xs) => xs.map((m) => m.textContent + (m.getAttribute('aria-disabled') ? ' (off)' : '')));
    check('right-click a tab: close, close others / to the right, name, copy the path, show in Explorer, reload', ['Close', 'Close the others', 'Close the ones to the right', 'Name it…', 'Copy the path', 'Show in Explorer', 'Reload from disk'].every((l) => tabItems.some((t) => t.startsWith(l))) && tabItems.some((t) => t.startsWith('Name it…') && t.endsWith('(off)')), tabItems);
    await page.click('.nui-menu .mi:has-text("Show in Explorer")');
    await page.waitForTimeout(50);
    check('Show in Explorer asks the C# side for that document', (await page.evaluate(() => window.__revealed || [])).length === 1);
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(200);
    await page.dblclick('.md-tab[aria-selected=true] .name');
    await page.waitForSelector('.nui-dialog');
    await page.fill('.nui-dialog input', 'Shopping list');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    check('double-click a new document\'s tab to name it', (await page.textContent('.md-tab[aria-selected=true] .name')) === 'Shopping list');
    await page.keyboard.type('Milk');
    await queue('mock.saves', ['C:\\Notes\\Shopping list.md']);
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(200);
    check('…and its first save suggests that name', await page.evaluate(() => window.__calls.filter((c) => c.cmd === 'md.writeAs').pop().args.title === 'Shopping list'));
    await page.click('.md-tab .name:text-is("Shopping list.md")', { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Close the others")');
    await page.waitForTimeout(200);
    check('Close the others', (await state(page)).docs.length === 1);

    // ---------------------------------------------------------------- files dropped on the window (handed over by the C# side)
    await setDisk({ ...(await disk()), 'C:\\Drop\\dropped.md': { text: '# Dropped in\n', format: 'UTF-8 · LF', stamp: 1 } });
    await page.evaluate(() => window.__mockSend({ event: 'open', bench: 'noor.markdown', paths: ['C:\\Drop\\dropped.md'] }));
    await waitFn(page, () => [...document.querySelectorAll('.md-tab .name')].some((n) => n.textContent === 'dropped.md'));
    check('a file dropped on the window opens in a tab', (await page.textContent('.md-tab[aria-selected=true] .name')) === 'dropped.md');
    await page.evaluate(() => window.__mockSend({ event: 'open.none', names: ['song.xyz'] }));
    await page.waitForTimeout(100);
    check('…and one no bench opens says so', (await page.textContent('.nui-toasts')).includes('No bench opens song.xyz'));

    // ---------------------------------------------------------------- Statistics and the writing goal (dropped.md is on screen)
    await page.click('.md-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror h1');
    await page.waitForTimeout(150);   // (ProseMirror takes the click's cursor in a moment; people are slower than Playwright)
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.keyboard.type('One two three four five.');
    await page.waitForTimeout(500);
    const statRow = (k) => page.evaluate((key) => { const r = [...document.querySelectorAll('.md-stats .nui-row')].find((x) => x.firstChild.textContent === key); return r ? r.lastChild.textContent : null; }, k);
    check('the Statistics panel counts the document on screen', (await statRow('Words')) === '7' && (await statRow('Headings')) === '1' && (await statRow('Paragraphs')) === '2', [await statRow('Words'), await statRow('Headings'), await statRow('Paragraphs')]);
    check('…with the writing goal', (await page.textContent('.md-goal-text')).includes('7 / 750 words'));
    await page.click('.md-goal .nui-btn');
    await page.waitForSelector('.nui-dialog');
    await page.fill('.nui-dialog input', '10');
    await dialogButton('Set the goal');
    await page.waitForTimeout(150);
    check('Set the goal…: 7 of 10 words is 70%', (await page.textContent('.md-goal-text')).includes('7 / 10 words') && (await page.getAttribute('.md-goal-bar', 'aria-valuenow')) === '70');
    await page.click('.md-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror p');
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Six seven eight.');
    await page.waitForTimeout(500);
    check('…and reaching it is a small party', (await page.textContent('.md-goal-text')).includes('🎉'));

    // ---------------------------------------------------------------- History: snapshots
    check('the History panel starts empty', (await page.textContent('.md-history')).includes('No snapshots yet'));
    await page.click('.md-snap-take');
    await page.waitForSelector('.md-snap');
    check('Take a snapshot: it shows up in History', (await page.$$('.md-snap')).length === 1 && (await page.textContent('.md-snap .m')).includes('words'));
    const snapText = (await state(page)).docs.find((d) => d.name === 'dropped.md').text;
    await page.click('.md-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' A rewrite gone wrong.');
    await page.waitForTimeout(200);
    await page.click('.md-snap-main');
    await page.waitForSelector('.nui-dialog .md-snap-preview');
    check('clicking a snapshot shows it, rendered', (await page.textContent('.md-snap-preview h1')) === 'Dropped in');
    await dialogButton('Bring it back');
    await page.waitForTimeout(300);
    let dtext = (await state(page)).docs.find((d) => d.name === 'dropped.md').text;
    check('Bring it back: the document is as it was', dtext.trim() === snapText.trim() && !dtext.includes('gone wrong'), dtext);
    check('…and what was there is kept as a snapshot too', (await page.$$('.md-snap')).length === 2 && (await page.textContent('.md-snap .l')).startsWith('Before bringing back'));
    await page.click('.md-snap-main');   // the newest: what was there before
    await page.waitForSelector('.nui-dialog .md-snap-preview');
    await dialogButton('Bring it back');
    await page.waitForTimeout(300);
    check('…so bringing that one back undoes it', (await state(page)).docs.find((d) => d.name === 'dropped.md').text.includes('gone wrong'));
    const nSnaps = (await page.$$('.md-snap')).length;
    await page.click('.md-snap button[aria-label^="Delete"]');
    await page.waitForTimeout(200);
    check('a snapshot can be deleted', (await page.$$('.md-snap')).length === nSnaps - 1);

    // ---------------------------------------------------------------- export, print, copy
    await clickMenu('File', 'Export HTML…');
    await waitFn(page, () => !!window.__exported);
    let ex = await page.evaluate(() => window.__exported);
    check('Export HTML: the document rendered, named after the file', ex.title === 'dropped' && ex.bodyHtml.includes('<h1') && ex.bodyHtml.includes('Dropped in'));
    await page.evaluate(() => { const ed = document.querySelector('.md-pane:not([hidden]) .ProseMirror'); void ed; });
    await setDisk({ ...(await disk()), 'C:\\Drop\\evil.md': { text: '# Hi\n\n<img src=x onerror="alert(1)"><script>alert(2)</script>\n', format: 'UTF-8 · LF', stamp: 1 } });
    await page.evaluate(() => window.__mockSend({ event: 'open', bench: 'noor.markdown', paths: ['C:\\Drop\\evil.md'] }));
    await waitFn(page, () => [...document.querySelectorAll('.md-tab .name')].some((n) => n.textContent === 'evil.md'));
    await page.evaluate(() => { window.__exported = null; });
    await clickMenu('File', 'Export HTML…');
    await waitFn(page, () => !!window.__exported);
    ex = await page.evaluate(() => window.__exported);
    check('…with any scripts in the Markdown taken out', !/onerror|<script/i.test(ex.bodyHtml), ex.bodyHtml);
    await clickMenu('File', 'Export PDF…');
    await waitFn(page, () => !!window.__pdf);
    const pdf = await page.evaluate(() => window.__pdf);
    check('Export PDF: the page prints just the document', pdf.title === 'evil' && pdf.printed.includes('<h1') && !/<script/i.test(pdf.printed));
    await clickMenu('File', 'Print…');
    await waitFn(page, () => window.__printed !== undefined);
    check('Print: the system\'s print dialog, with the document in the print area', (await page.evaluate(() => window.__printed)).includes('Hi') && await page.evaluate(() => getComputedStyle(document.getElementById('print-root')).display === 'none'));
    await page.evaluate(() => { document.getElementById('print-root') && 0; });
    await page.emulateMedia({ media: 'print' });
    check('…and when printing, only that shows', await page.evaluate(() => getComputedStyle(document.getElementById('print-root')).display === 'block' && getComputedStyle(document.getElementById('app')).display === 'none'));
    await page.emulateMedia({ media: 'screen' });

    // ---------------------------------------------------------------- settings, and the welcome document from Help
    await clickMenu('Tools', 'Markdown settings…');
    await page.waitForSelector('.md-settings');
    await page.selectOption('.md-settings select >> nth=0', 'serif');
    await page.selectOption('.md-settings select >> nth=1', 'markdown');
    await dialogButton('Save');
    await page.waitForTimeout(100);
    check('Markdown settings: a serif font for documents', (await page.evaluate(() => getComputedStyle(document.querySelector('.md-pane:not([hidden]) .toastui-editor-contents')).fontFamily)).includes('Georgia'));
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(200);
    { const st = await state(page); check('…and new documents open in Markdown', st.docs.find((d) => d.id === st.current).mode === 'markdown'); }
    await clickMenu('Help', 'The Markdown welcome document');
    await page.waitForTimeout(200);
    check('Help › the welcome document opens again any time', (await page.textContent('.md-tab[aria-selected=true] .name')) === 'Welcome to Markdown');

    // ---------------------------------------------------------------- themes
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.waitForTimeout(100);
    check('a light theme: the editor turns light', !(await page.$('.md-pane:not([hidden]) .toastui-editor-defaultUI.toastui-editor-dark')));
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await setDisk({ ...(await disk()), 'C:\\Notes\\NoorMD 3.0.md': { text: '# NoorMD 3.0 ✨\n\nOne home for every bench. **Markdown** is the first real one.\n\n## What\'s in\n\n* Documents as tabs\n* Visual, Markdown and side by side\n* An outline that follows you around\n* Drafts that survive closing the app\n\n## Next\n\n> The Music bench. With a player you can dock anywhere.\n\n| Bench | Status |\n| --- | --- |\n| Markdown | here |\n| Music | next |\n', format: 'UTF-8 · LF', stamp: 1 } });
      await queue('mock.picks', [['C:\\Notes\\NoorMD 3.0.md']]);
      await page.keyboard.press('Control+o');
      await waitFn(page, () => [...document.querySelectorAll('.md-tab .name')].some((n) => n.textContent === 'NoorMD 3.0.md'));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, 'noormd3-markdown.png') });
      await page.click('.md-modes button[data-mode="split"]');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, 'noormd3-markdown-split.png') });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'parchment'; });
      await page.click('.md-modes button[data-mode="wysiwyg"]');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, 'noormd3-markdown-parchment.png') });
    }

    check('no errors on the page', errors.length === 0, errors);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
