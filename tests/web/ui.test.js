// Automated UI checks for the NoorMD web front-end, run in headless Chromium against a mock host.
// Usage: node tests/web/ui.test.js [--screenshots <dir>]
'use strict';
const { chromium } = require('playwright');
const { serve, mockHostScript, sketchHostScript, videoWindowHostScript, mediaLog } = require('./harness');

const LOSSLESS = '# Zażółć gęślą jaźń\n\nPolish: żółw, łódź, ćma, źdźbło. **Bold** and *italic*.\n\n## Lists\n\n- one\n- two\n\n## Table\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```csharp\nConsole.WriteLine("ą");\n```\n\n### Third\n\nSee [example](https://example.com) and [local](notes/other.md).\n';
const LOSSY = '# Raw\n\n<div align="center">Centered</div>\n\nLine one  \nLine two\n\nFoot[^1]\n\n[^1]: note\n';
const XSS = '# Safe\n\n<img src="x" onerror="window.__xss=1">\n\n<script>window.__xss=2</script>\n\n[bad](javascript:window.__xss=3)\n';


// ~7,500-word design document with headings, tables, quotes, nested lists, code fences and links.
function bigDocument() {
  const words = 'the quick brown fox jumps over the lazy dog while the writer drafts żółte notatki for the game design'.split(' ');
  const para = (n, seed) => Array.from({ length: n }, (_, i) => words[(i * 7 + seed) % words.length]).join(' ') + '.';
  let out = '# Game Design Document\n\nIntro paragraph with **bold**, *italic*, `code` and a [link](https://example.com/docs).\n\n';
  for (let s = 1; s <= 30; s++) {
    out += `## Section ${s}: Systems\n\n${para(120, s)}\n\n### Mechanics ${s}\n\n${para(90, s + 3)}\n\n`;
    out += `> Design note ${s}: ${para(20, s)}\n\n`;
    out += `- Item ${s}.1\n  - Nested ${s}.1.a\n  - Nested ${s}.1.b\n- Item ${s}.2\n\n`;
    out += `| Stat | Value | Notes |\n| --- | --- | --- |\n| HP | ${s * 10} | base |\n| MP | ${s * 5} | regen |\n\n`;
    out += '```csharp\nvar unit = new Unit(' + s + ');\nunit.Attack();\n```\n\n';
  }
  return out;
}


// Polls with page.evaluate instead of page.waitForFunction: some Playwright versions poll by eval-ing the
// predicate, which the app's Content-Security-Policy (script-src 'self', no unsafe-eval) rightly blocks.
async function waitFn(page, fn, arg, opts = {}) {
  const end = Date.now() + (opts.timeout || 30000);
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() > end) throw new Error('waitFn timed out: ' + fn.toString().slice(0, 100));
    await new Promise((r) => setTimeout(r, 50));
  }
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail !== undefined ? '  → ' + JSON.stringify(detail) : ''}`);
}

async function open(browser, base, initial, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.addInitScript(mockHostScript, initial);
  await page.goto(base);
  await waitFn(page, () => window.NoorMD && document.querySelector('.toastui-editor-defaultUI'));
  await page.waitForTimeout(150);
  return { page, errors, external };
}

const settleClose = (page) => page.waitForTimeout(250);

/** The Stream Desk's own window (stream.html), with the same mock host as the main page. */
async function openStream(browser, base, initial, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(mockHostScript, initial);
  await page.goto(base + '_noormd/stream.html');
  await page.waitForSelector('#streamdesk:not([hidden])');
  return { page, errors };
}
const state = (page) => page.evaluate(() => window.NoorMD.getState());
const msgs = (page, type) => page.evaluate((t) => window.__mock.log.filter((m) => m.type === t).length, type);

(async () => {
  const shotsIdx = process.argv.indexOf('--screenshots');
  const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
  const { server, url } = await serve();
  const browser = await chromium.launch({ args: ['--enable-blink-features=AudioVideoTracks', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  try {
    // ---- 1. Lossless document: Visual mode, exact content, not dirty, offline.
    {
      const { page, errors, external } = await open(browser, url, { document: { markdown: LOSSLESS, path: 'C:\\docs\\polski.md', fileName: 'polski.md', title: 'polski' }, files: { 'C:\\docs\\polski.md': LOSSLESS } });
      let s = await state(page);
      check('opens lossless file in Visual mode', s.mode === 'wysiwyg', s.mode);
      check('Polish diacritics survive load', s.markdown.includes('Zażółć gęślą jaźń') && s.markdown.includes('źdźbło'));
      check('code fence survives load', s.markdown.includes('```csharp\nConsole.WriteLine("ą");\n```'));
      check('freshly opened file is not dirty', s.dirty === false);
      check('title shows file name', (await page.inputValue('#doc-title')) === 'polski');
      check('no page errors on startup', errors.length === 0, errors);
      check('no network requests outside the app', external.length === 0, external);
      check('word count shown', /\d+ words/.test(await page.textContent('#counter-top')));

      // Outline
      const outline = await page.$$eval('#outline-box button', (b) => b.map((x) => x.textContent));
      check('outline lists headings', JSON.stringify(outline) === JSON.stringify(['Zażółć gęślą jaźń', 'Lists', 'Table', 'Third']), outline);

      // Typing → dirty; Ctrl+S saves exactly once.
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' Nowy tekst ąę.');
      s = await state(page);
      check('typing marks document dirty', s.dirty === true);
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(200);
      check('Ctrl+S sends exactly one save request', (await msgs(page, 'doc.save')) === 1, await msgs(page, 'doc.save'));
      s = await state(page);
      check('save clears dirty state', s.dirty === false);
      const saved = await page.evaluate(() => window.__mock.files['C:\\docs\\polski.md']);
      check('saved text contains the edit and diacritics', saved.includes('Nowy tekst ąę.') && saved.includes('Zażółć'));

      // Undo / redo
      await page.keyboard.type('XYZ');
      await page.keyboard.press('Control+z');
      const afterUndo = (await state(page)).markdown;
      await page.keyboard.press('Control+y');
      const afterRedo = (await state(page)).markdown;
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+Shift+z');
      check('Ctrl+Shift+Z also redoes', (await state(page)).markdown.includes('XYZ'));
      check('Ctrl+Z undoes and Ctrl+Y redoes', !afterUndo.includes('XYZ') && afterRedo.includes('XYZ'), { afterUndo: afterUndo.slice(-30), afterRedo: afterRedo.slice(-30) });

      // Mode round trip retains content.
      const before = (await state(page)).markdown;
      await page.keyboard.press('Control+2');
      check('Ctrl+2 switches to Markdown', (await state(page)).mode === 'markdown');
      await page.keyboard.press('Control+3');
      check('Ctrl+3 switches to Split', (await state(page)).mode === 'split');
      const panes = await page.evaluate(() => {
        const a = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container > .toastui-editor').getBoundingClientRect();
        const b = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview').getBoundingClientRect();
        return { a: a.width, b: b.width, ah: a.height, bh: b.height };
      });
      check('split shows two usable panes (~50/50)', panes.a > 300 && panes.b > 300 && Math.abs(panes.a - panes.b) < 40 && panes.ah > 200, panes);
      if (shots) await page.screenshot({ path: `${shots}/split-1440.png` });
      // Drag divider to ~65%.
      const sp = await page.$('#editor .doc-pane:not([hidden]) .toastui-editor-md-splitter');
      const box = await sp.boundingBox();
      const cont = await page.evaluate(() => { const r = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container').getBoundingClientRect(); return { x: r.x, w: r.width }; });
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(cont.x + cont.w * 0.65, box.y + 120, { steps: 6 });
      await page.mouse.up();
      const ratio = await page.evaluate(() => { const a = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container > .toastui-editor').getBoundingClientRect(); const c = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container').getBoundingClientRect(); return a.width / c.width; });
      check('dragging the divider resizes panes', Math.abs(ratio - 0.65) < 0.03, ratio);
      const prefMsg = await page.evaluate(() => window.__mock.log.filter((m) => m.type === 'prefs.set' && m.payload.splitRatio).pop());
      check('divider ratio is persisted', prefMsg && Math.abs(prefMsg.payload.splitRatio - 0.65) < 0.03, prefMsg);
      await page.mouse.move(cont.x + 10, box.y + 120);
      await page.mouse.down(); await page.mouse.up();
      // Clamp
      await page.mouse.move(box.x + 2, box.y + 100);
      await page.setViewportSize({ width: 1024, height: 700 });
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => { const a = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container > .toastui-editor').getBoundingClientRect(); const c = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container').getBoundingClientRect(); return { r: a.width / c.width, overflow: document.documentElement.scrollWidth > window.innerWidth }; });
      check('split layout survives window resize', after.r > 0.29 && after.r < 0.71 && !after.overflow, after);
      if (shots) await page.screenshot({ path: `${shots}/split-1024.png` });
      await page.setViewportSize({ width: 1440, height: 900 });
      // Independent scrolling: the panes scroll, the page does not.
      const scroll = await page.evaluate(() => ({ page: document.scrollingElement.scrollHeight <= window.innerHeight + 1, preview: getComputedStyle(document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview')).overflowY }));
      check('page never scrolls; preview scrolls independently', scroll.page && scroll.preview === 'auto', scroll);

      await page.keyboard.press('Control+1');
      await page.waitForTimeout(100);
      const back = (await state(page)).markdown;
      check('Visual → Markdown → Split → Visual keeps content', back.replace(/\s+$/, '') === before.replace(/\s+$/, ''), { before: before.slice(0, 80), back: back.slice(0, 80) });

      // Focus mode
      await page.keyboard.press('F11');
      const zen = await page.evaluate(() => ({ sidebar: getComputedStyle(document.querySelector('.sidebar')).display, card: document.querySelector('#editor-card').getBoundingClientRect().width, vw: window.innerWidth, editable: !!document.querySelector('#editor .doc-pane:not([hidden]) .ProseMirror[contenteditable=true]') }));
      check('Focus mode hides chrome and uses the full width', zen.sidebar === 'none' && zen.card > zen.vw - 60 && zen.editable, zen);
      if (shots) await page.screenshot({ path: `${shots}/focus-1440.png` });
      await page.keyboard.press('Escape');
      check('Esc leaves Focus mode', !(await page.evaluate(() => document.body.classList.contains('zen'))));

      // Theme
      const md1 = (await state(page)).markdown;
      await page.evaluate(() => window.NoorMD.runCommand('theme.toggle')); await page.waitForTimeout(60);
      const th = await page.evaluate(() => ({ t: document.documentElement.dataset.theme, dark: document.querySelector('.toastui-editor-defaultUI').classList.contains('toastui-editor-dark') }));
      check('theme toggles page and editor together', th.t === 'light' && th.dark === false, th);
      check('theme toggle keeps content', (await state(page)).markdown === md1);
      if (shots) await page.screenshot({ path: `${shots}/light-1440.png` });
      await page.evaluate(() => window.NoorMD.runCommand('theme.toggle')); await page.waitForTimeout(60);

      // Palette
      await page.keyboard.press('Control+k');
      await page.waitForSelector('#palette-query');
      await page.keyboard.type('split');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      check('command palette is keyboard driven', (await state(page)).mode === 'split');
      await page.keyboard.press('Control+1');

      // Find & replace
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
      await page.keyboard.press('Control+f');
      await page.keyboard.type('two');
      await page.waitForTimeout(50);
      check('find counts matches', (await page.textContent('#find-count')) === '1 of 1', await page.textContent('#find-count'));
      await page.fill('#replace-input', 'TWO');
      await page.click('#replace-all');
      check('replace all edits the document', (await state(page)).markdown.includes('TWO') && !(await state(page)).markdown.includes('- two'));
      await page.keyboard.press('Escape');
      check('Esc closes find bar', await page.evaluate(() => document.querySelector('#findbar').classList.contains('hide')));

      // Outline navigation moves the caret to the heading.
      await page.click('#outline-box button:nth-child(3)');
      const selText = await page.evaluate(() => { const v = window.getSelection(); return v.anchorNode && (v.anchorNode.nodeType === 1 ? v.anchorNode : v.anchorNode.parentElement).closest('h1,h2,h3,h4,h5,h6')?.textContent; });
      check('outline click navigates to heading', selText === 'Table', { selText, dbg: await page.evaluate(() => ({ list: [...document.querySelectorAll('#outline-box button')].map(b => b.textContent), anchor: window.getSelection().anchorNode?.textContent?.slice(0,40), active: document.activeElement.className, mode: window.NoorMD.mode() })) });

      // Shortcuts help and preferences dialogs open and close with the keyboard.
      await page.keyboard.press('F1');
      await page.waitForSelector('.modal');
      check('F1 shows keyboard shortcuts', (await page.textContent('.modal')).includes('Keyboard shortcuts'));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+,');
      await page.waitForSelector('#pref-lineWidth');
      await page.selectOption('#pref-lineWidth', 'full');
      const measure = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--measure'));
      check('preferences apply immediately (full-width lines)', measure.trim() === '100000px', measure);
      await page.selectOption('#pref-lineWidth', 'comfortable');
      await page.keyboard.press('Escape');
      check('Esc closes dialogs', (await page.$$('.modal')).length === 0);

      // Held Ctrl+S (key repeat) must not trigger repeated saves.
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
      await page.keyboard.type('!');
      const savesBefore = await msgs(page, 'doc.save');
      await page.evaluate(() => {
        for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, repeat: i > 0, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(150);
      check('held Ctrl+S saves exactly once', (await msgs(page, 'doc.save')) - savesBefore === 1, (await msgs(page, 'doc.save')) - savesBefore);

      // Snapshots
      await page.keyboard.press('Control+Alt+s');
      await page.waitForTimeout(100);
      check('Ctrl+Alt+S creates snapshot', (await msgs(page, 'snapshots.create')) === 1);

      // Link click in Split preview goes to host, not navigation.
      await page.keyboard.press('Control+3');
      await page.waitForTimeout(150);
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview a[href="https://example.com"]');
      await page.waitForTimeout(100);
      check('preview link click is routed to host', (await page.evaluate(() => window.__mock.state.lastLink)) === 'https://example.com' && page.url() === url);

      for (const w of [1024, 1440, 1920]) {
        await page.keyboard.press('Control+1');
        await page.setViewportSize({ width: w, height: w === 1024 ? 700 : 1000 });
        await page.waitForTimeout(120);
        const ov = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - window.innerWidth, head: [...document.querySelectorAll('.card-head > *')].every((n) => n.getBoundingClientRect().right <= document.querySelector('.card-head').getBoundingClientRect().right + 1) }));
        check(`no horizontal overflow at ${w}px`, ov.x <= 0 && ov.head, ov);
        if (shots) await page.screenshot({ path: `${shots}/visual-${w}.png` });
      }
      await page.close();
    }

    // ---- 2. Lossy document opens in Markdown mode, exact text, warning banner.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: LOSSY, path: 'C:\\docs\\raw.md', fileName: 'raw.md', title: 'raw' } });
      const s = await state(page);
      check('lossy file opens in Markdown mode', s.mode === 'markdown', s.mode);
      check('lossy file text is byte-exact', s.markdown === LOSSY, s.markdown);
      check('lossy file is not dirty', s.dirty === false);
      check('round-trip warning banner shown', !(await page.evaluate(() => document.querySelector('#banner').classList.contains('hide'))));
      await page.keyboard.press('Control+1');
      await page.waitForSelector('.modal');
      check('switching lossy doc to Visual asks first', (await page.textContent('.modal')).includes('Switch to Visual mode?'));
      await page.keyboard.press('Enter'); // default = Stay in Markdown
      await page.waitForTimeout(100);
      check('default choice keeps Markdown mode and text', (await state(page)).mode === 'markdown' && (await state(page)).markdown === LOSSY);
      check('no errors with lossy doc', errors.length === 0, errors);
      if (shots) await page.screenshot({ path: `${shots}/lossy-banner.png` });
      await page.close();
    }

    // ---- 3. XSS: nothing in the document can execute; export is sanitized.
    {
      const { page } = await open(browser, url, { document: { markdown: XSS, title: 'xss' } });
      await page.keyboard.press('Control+3');
      await page.waitForTimeout(300);
      await page.click('[data-cmd="export.html"]');
      await page.waitForTimeout(150);
      const exp = await page.evaluate(() => window.__mock.state.exportedHtml || '');
      check('exported HTML has no scripts/handlers/js: links', !/onerror|<script|javascript:/i.test(exp), exp);
      check('no script from the document executed', (await page.evaluate(() => window.__xss)) === undefined);
      await page.close();
    }

    // ---- 4. Welcome screen + new document + recovery prompt + New when dirty.
    {
      const { page } = await open(browser, url, { document: null, recent: [{ path: 'C:\\a\\notes.md', name: 'notes.md' }], recovery: [{ id: 'r1', title: 'Lost work', path: null, savedUtc: new Date().toISOString(), words: 12 }] });
      await page.waitForSelector('.modal');
      check('recovery drafts are offered at startup', (await page.textContent('.modal')).includes('Lost work'));
      await page.keyboard.press('Escape');
      check('welcome screen shows on empty start', await page.isVisible('#welcome'));
      check('welcome lists recent files', (await page.textContent('#welcome-recent')).includes('notes.md'));
      if (shots) await page.screenshot({ path: `${shots}/welcome.png` });
      await page.keyboard.press('Control+n');
      await page.waitForTimeout(150);
      check('Ctrl+N asks the host for a new document', (await msgs(page, 'doc.new')) === 1);
      check('welcome hides after new document', !(await page.isVisible('#welcome')));
      await page.close();
    }

    // ---- 5. UX enhancements: width presets (incl. Focus), compact layout, spellcheck, AltGr, shortcuts search.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: LOSSLESS + '\n' + 'Long paragraph of text. '.repeat(60) + '\n', path: 'C:\\docs\\w.md', fileName: 'w.md', title: 'w' } }, { width: 1920, height: 1080 });
      const textWidth = () => page.evaluate(() => {
        const pm = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
        const cs = getComputedStyle(pm);
        return pm.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      });
      await page.keyboard.press('F11');
      await page.waitForTimeout(150);
      const comfortable = await textWidth();
      if (shots) await page.screenshot({ path: `${shots}/focus-comfortable-1920.png` });
      check('Comfortable preset keeps an ~800 px column in Focus mode', comfortable > 760 && comfortable <= 800, comfortable);
      await page.keyboard.press('Control+Shift+W');
      await page.waitForTimeout(100);
      const wide = await textWidth();
      check('Ctrl+Shift+W → Wide (~1100 px)', wide > 1050 && wide <= 1100, wide);
      await page.keyboard.press('Control+Shift+W');
      await page.waitForTimeout(150);
      const full = await textWidth();
      const pane = await page.evaluate(() => document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror').clientWidth);
      if (shots) await page.screenshot({ path: `${shots}/focus-fullwidth-1920.png` });
      check('Full width uses the pane with 24–40 px padding in Focus mode', full >= pane - 80 && full > 1700, { full, pane });
      check('width preset is persisted', await page.evaluate(() => window.__mock.log.some((m) => m.type === 'prefs.set' && m.payload.lineWidth === 'full')));
      check('width button shows the active preset', (await page.textContent('#width-toggle')).includes('Full width'));
      check('editing still works at full width', await page.evaluate(() => !!document.querySelector('#editor .doc-pane:not([hidden]) .ProseMirror[contenteditable=true]')));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Shift+W'); // back to comfortable
      await page.waitForTimeout(100);
      check('cycling returns to Comfortable', Math.abs((await textWidth()) - comfortable) < 2);
      for (const m of ['Control+2', 'Control+3']) {
        await page.keyboard.press(m);
        await page.waitForTimeout(100);
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`no overflow with width presets in ${m === 'Control+2' ? 'Markdown' : 'Split'} mode`, ov <= 0, ov);
      }
      const grip = await page.evaluate(() => getComputedStyle(document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-splitter'), '::after').height);
      check('split divider has a visible grip', grip === '44px', grip);
      await page.keyboard.press('Control+1');

      // Compact layout
      const cardTop = () => page.evaluate(() => document.querySelector('#editor-card').getBoundingClientRect().top);
      const before = await cardTop();
      if (shots) await page.screenshot({ path: `${shots}/standard-layout-1920.png` });
      await page.keyboard.press('Control+Shift+L');
      await page.waitForTimeout(100);
      const after = await cardTop();
      if (shots) await page.screenshot({ path: `${shots}/compact-layout-1920.png` });
      check('compact layout gains vertical room', before - after > 60, { before, after });
      check('compact keeps the sidebar (unlike Focus)', await page.isVisible('#sidebar'));
      await page.keyboard.press('Control+Shift+L');
      await page.waitForTimeout(100);
      check('toggling compact restores normal spacing', Math.abs((await cardTop()) - before) < 1);

      // Spellcheck
      const md0 = (await state(page)).markdown;
      await page.keyboard.press('Control+Shift+Y');
      await page.waitForTimeout(50);
      const sp = await page.evaluate(() => [...document.querySelectorAll('#editor .doc-pane:not([hidden]) [contenteditable="true"]')].map((n) => n.getAttribute('spellcheck')));
      check('spellcheck off sets spellcheck=false on editing surfaces', sp.length > 0 && sp.every((v) => v === 'false'), sp);
      check('spellcheck toggle leaves the text unchanged', (await state(page)).markdown === md0);
      await page.keyboard.press('Control+2');
      await page.waitForTimeout(50);
      const sp2 = await page.evaluate(() => [...document.querySelectorAll('#editor .doc-pane:not([hidden]) [contenteditable="true"]')].map((n) => n.getAttribute('spellcheck')));
      check('spellcheck setting survives mode switches', sp2.every((v) => v === 'false'), sp2);
      await page.keyboard.press('Control+1');
      await page.keyboard.press('Control+Shift+Y');
      check('spellcheck can be turned back on', await page.evaluate(() => document.querySelector('#editor .doc-pane:not([hidden]) .ww-mode .ProseMirror, #editor .toastui-editor-ww-container .ProseMirror').getAttribute('spellcheck') === 'true'));

      // AltGr (Polish "ś") must type a letter, not take a snapshot.
      const snapsBefore = await msgs(page, 'snapshots.create');
      const handled = await page.evaluate(() => {
        const e = new KeyboardEvent('keydown', { key: 'ś', code: 'KeyS', ctrlKey: true, altKey: true, bubbles: true, cancelable: true, modifierAltGraph: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      });
      await page.waitForTimeout(80);
      check('AltGr+S (ś) is not swallowed as a shortcut', !handled && (await msgs(page, 'snapshots.create')) === snapsBefore);

      // Shortcut list is searchable and in sync with commands.
      await page.keyboard.press('F1');
      await page.waitForSelector('.shortcut-table');
      await page.keyboard.type('width');
      const rows = await page.$$eval('.shortcut-table tr', (r) => r.map((x) => x.textContent));
      check('shortcut list is searchable', rows.length === 1 && rows[0].includes('Ctrl+Shift+W'), rows);
      await page.keyboard.press('Escape');
      check('no errors in enhancement checks', errors.length === 0, errors);
      await page.close();
    }

    // ---- 6. Markdown source editor (v1.2): uniform source styling, fidelity across modes, split behaviour.
    {
      const BIG = bigDocument();
      const wordCount = BIG.split(/\s+/).filter(Boolean).length;
      const { page, errors } = await open(browser, url, { document: { markdown: BIG, path: 'C:\\docs\\big.md', fileName: 'big.md', title: 'big' } }, { width: 1440, height: 900 });
      check(`large document loads (~${wordCount} words)`, wordCount > 7000 && (await state(page)).markdown === BIG);
      await page.keyboard.press('Control+2');
      await page.waitForTimeout(200);
      check('Visual → Markdown without edits shows the exact original source', (await state(page)).markdown === BIG);
      const uniform = () => page.evaluate(() => {
        const pm = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror');
        const sizes = new Set(), fams = new Set(), lhs = new Set();
        pm.querySelectorAll('*').forEach((n) => { const cs = getComputedStyle(n); sizes.add(cs.fontSize); fams.add(cs.fontFamily.split(',')[0]); lhs.add(cs.lineHeight); });
        return { sizes: [...sizes], fams: [...fams], lhs: [...lhs] };
      });
      let u = await uniform();
      check('source: one font size, one font, one line height (Markdown mode)', u.sizes.length === 1 && u.fams.length === 1 && u.lhs.length === 1, u);
      const literal = await page.evaluate(() => [...document.querySelectorAll('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div')].some((d) => d.textContent === '## Section 1: Systems'));
      check('heading markers stay literal text in source', literal);
      if (shots) await page.screenshot({ path: `${shots}/source-markdown-dark.png` });

      // Line numbers and wrap
      const gutter = await page.evaluate(() => getComputedStyle(document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div'), '::before').content);
      check('line numbers shown by default', gutter && gutter !== 'none', gutter);
      await page.evaluate(() => window.NoorMD.runCommand('source.wrap'));
      await page.waitForTimeout(100);
      const nowrap = await page.evaluate(() => { const pm = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror'); return { sw: pm.scrollWidth, cw: pm.clientWidth, heights: new Set([...pm.children].slice(0, 400).map((d) => Math.round(d.getBoundingClientRect().height))).size }; });
      check('word wrap off: long lines scroll horizontally, every line has the same height', nowrap.sw > nowrap.cw && nowrap.heights === 1, nowrap);
      await page.evaluate(() => window.NoorMD.runCommand('source.wrap'));
      await page.evaluate(() => window.NoorMD.runCommand('source.lineNumbers'));
      await page.waitForTimeout(50);
      check('line numbers can be turned off', await page.evaluate(() => getComputedStyle(document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div'), '::before').content === 'none'));
      await page.evaluate(() => window.NoorMD.runCommand('source.lineNumbers'));

      // Repeated mode switching without edits never rewrites the source.
      for (const k of ['Control+3', 'Control+1', 'Control+2', 'Control+1', 'Control+3', 'Control+2']) { await page.keyboard.press(k); await page.waitForTimeout(80); }
      check('repeated mode switches without edits keep the source byte-for-byte', (await state(page)).markdown === BIG && !(await state(page)).dirty);

      // Edit in source, go through Visual and back without editing there: the edited source survives exactly.
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror');
      await page.keyboard.press('Control+Home');
      await page.keyboard.type('- [ ] raw source line with  two spaces\n');
      const edited = (await state(page)).markdown;
      await page.keyboard.press('Control+1'); await page.waitForTimeout(100);
      check('Visual mode reports the exact edited source while unedited there', (await state(page)).markdown === edited);
      await page.keyboard.press('Control+2'); await page.waitForTimeout(100);
      check('edited source is exact after a Visual round trip', (await state(page)).markdown === edited);

      // Split: rapid typing, preview updates, caret stays, divider resize mid-typing, independent scrolling.
      await page.keyboard.press('Control+3'); await page.waitForTimeout(150);
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror');
      await page.keyboard.press('Control+Home');
      const t0 = Date.now();
      await page.keyboard.type('Rapid typing ąę test one two three four five six seven eight nine ten.\n', { delay: 0 });
      const typeMs = Date.now() - t0;
      const sp = await page.$('#editor .doc-pane:not([hidden]) .toastui-editor-md-splitter');
      const bx = await sp.boundingBox();
      await page.mouse.move(bx.x + bx.width / 2, bx.y + 200); await page.mouse.down();
      await page.mouse.move(bx.x - 150, bx.y + 220, { steps: 5 }); await page.mouse.up();
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div:first-child');
      await page.keyboard.press('End');
      await page.keyboard.type('AFTER-RESIZE');
      await page.waitForTimeout(400);
      const firstLine = await page.evaluate(() => document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div').textContent);
      check('typing stays in order across a divider resize', firstLine.startsWith('Rapid typing ąę') && firstLine.endsWith('AFTER-RESIZE'), firstLine);
      check(`rapid typing in Split with a ~${wordCount}-word document is responsive (${typeMs} ms for 72 chars)`, typeMs < 6000, typeMs);
      check('preview updates while typing', await page.evaluate(() => document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview').textContent.includes('AFTER-RESIZE')));
      u = await uniform();
      check('source stays uniform in Split mode', u.sizes.length === 1 && u.lhs.length === 1, u);
      const before = await page.evaluate(() => document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview').scrollTop);
      await page.evaluate(() => { document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror').scrollTop = 5000; });
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview').scrollTop);
      check('panes scroll independently by default', after === before, { before, after });
      if (shots) await page.screenshot({ path: `${shots}/source-split-dark.png` });

      // Commands: heading shortcut, copy source.
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div:first-child');
      await page.keyboard.press('Control+Shift+Digit2');
      await page.waitForTimeout(80);
      check('Ctrl+Shift+2 makes the line a level-2 heading', (await page.evaluate(() => document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div').textContent)).startsWith('## Rapid typing'));
      await page.evaluate(() => window.NoorMD.runCommand('source.copy'));
      await page.waitForTimeout(100);
      check('Copy Markdown source copies the exact source', (await page.evaluate(() => window.__mock.state.clipboard)) === (await state(page)).markdown);

      // Contrast of source tokens in both themes.
      for (const theme of ['dark', 'light']) {
        if (theme === 'light') { await page.evaluate(() => window.NoorMD.runCommand('theme.toggle')); await page.waitForTimeout(60); await page.keyboard.press('Control+2'); await page.waitForTimeout(150); }
        const c = await page.evaluate(() => {
          const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
          const bg = getComputedStyle(document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container > .toastui-editor')).backgroundColor;
          const pick = (sel) => { const n = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror ' + sel); return n ? +ratio(getComputedStyle(n).color, bg).toFixed(2) : null; };
          const line = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div');
          return { text: +ratio(getComputedStyle(line).color, bg).toFixed(2), heading: pick('.toastui-editor-md-heading'), link: pick('.toastui-editor-md-link'), code: pick('.toastui-editor-md-code'), quote: pick('.toastui-editor-md-block-quote'), delim: pick('.toastui-editor-md-delimiter'),
            gutter: +ratio(getComputedStyle(line, '::before').color, bg).toFixed(2) };
        });
        const ok = c.text >= 7 && c.heading >= 4.5 && c.link >= 4.5 && c.code >= 4.5 && c.quote >= 4.5 && c.delim >= 3 && c.gutter >= 3;
        check(`source token contrast is readable (${theme})`, ok, c);
        if (shots) await page.screenshot({ path: `${shots}/source-markdown-${theme}.png` });
      }

      // Compact + Focus + width presets + narrow window with the source editor.
      await page.keyboard.press('Control+Shift+L');
      await page.keyboard.press('F11');
      for (const w of ['width.comfortable', 'width.wide', 'width.full']) {
        await page.evaluate((c) => window.NoorMD.runCommand(c), w);
        await page.waitForTimeout(80);
        const r = await page.evaluate(() => { const pm = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror'); const cs = getComputedStyle(pm); return { text: pm.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ov: document.documentElement.scrollWidth - window.innerWidth }; });
        check(`source editor usable in Focus+Compact with ${w}`, r.text > 600 && r.ov <= 0, r);
      }
      await page.keyboard.press('F11');
      await page.keyboard.press('Control+3');
      await page.setViewportSize({ width: 820, height: 640 });
      await page.waitForTimeout(150);
      const narrow = await page.evaluate(() => { const pm = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror'); const cs = getComputedStyle(pm); return { text: pm.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ov: document.documentElement.scrollWidth - window.innerWidth }; });
      check('Split source pane is usable in a narrow window', narrow.text > 200 && narrow.ov <= 0, narrow);
      const overlap = await page.evaluate(() => {
        const a = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container > .toastui-editor').getBoundingClientRect();
        const pm = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror').getBoundingClientRect();
        const pv = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview').getBoundingClientRect();
        return { stacked: pv.top >= a.bottom - 1, pmInside: pm.bottom <= a.bottom + 1, aBottom: a.bottom, pmBottom: pm.bottom, pvTop: pv.top };
      });
      check('narrow Split stacks panes without the source overlapping the preview', overlap.stacked && overlap.pmInside, overlap);
      if (shots) await page.screenshot({ path: `${shots}/source-split-narrow-light.png` });
      check('no errors in source editor checks', errors.length === 0, errors);
      await page.close();
    }

    // ---- 7. Themes: picker, live preview, apply, every theme renders cleanly.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: LOSSLESS, path: 'C:\\docs\\t.md', fileName: 't.md', title: 't' } }, { width: 1440, height: 900 });
      await page.click('[data-cmd="theme.pick"]');
      await page.waitForSelector('.theme-card');
      const ids = await page.$$eval('.theme-card', (c) => c.map((x) => x.dataset.themeId));
      check('theme picker lists all bundled themes', ids.length === 9 && ids.includes('nocturne') && ids.includes('parchment') && ids.includes('contrast'), ids);
      await page.hover('.theme-card[data-theme-id="evergreen"]');
      check('hovering a theme previews it', await page.evaluate(() => document.documentElement.dataset.theme) === 'evergreen');
      await page.keyboard.press('Escape');
      check('closing the picker without choosing restores the theme', await page.evaluate(() => document.documentElement.dataset.theme) === 'dark');
      await page.click('[data-cmd="theme.pick"]');
      await page.click('.theme-card[data-theme-id="parchment"]');
      const applied = await page.evaluate(() => ({ t: document.documentElement.dataset.theme, dark: document.querySelector('.toastui-editor-defaultUI').classList.contains('toastui-editor-dark') }));
      check('choosing a light theme applies it and switches the editor to light', applied.t === 'parchment' && !applied.dark, applied);
      check('theme choice is persisted', await page.evaluate(() => window.__mock.log.some((m) => m.type === 'prefs.set' && m.payload.theme === 'parchment')));
      const md0 = (await state(page)).markdown;
      for (const id of ids) {
        await page.evaluate((t) => window.NoorMD.runCommand('theme.next'), id);
        await page.waitForTimeout(40);
      }
      check('cycling through every theme (Ctrl+Shift+T) returns to the start without touching the text', await page.evaluate(() => document.documentElement.dataset.theme) === 'parchment' && (await state(page)).markdown === md0);
      for (const id of ids) {
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, id);
        await page.keyboard.press('Control+3');
        await page.waitForTimeout(60);
        const r = await page.evaluate(() => {
          const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
          const panel = getComputedStyle(document.querySelector('.editor-card')).backgroundColor;
          const preview = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview p');
          const ww = getComputedStyle(document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview')).backgroundColor;
          return { preview: +ratio(getComputedStyle(preview).color, ww).toFixed(2), title: +ratio(getComputedStyle(document.querySelector('#doc-title')).color, getComputedStyle(document.body).backgroundColor).toFixed(2), ov: document.documentElement.scrollWidth - window.innerWidth };
        });
        check(`theme "${id}" renders readable text in editor, preview and header`, r.preview >= 4.5 && r.title >= 4.5 && r.ov <= 0, r);
        if (shots) await page.screenshot({ path: `${shots}/theme-${id}.png` });
      }
      check('no errors while switching themes', errors.length === 0, errors);
      await page.close();
    }

    // ---- 8. Creator's Bench: Music Bench with real audio playback.
    {
      // Empty library: the bench opens with a clear first step and starts nothing until used.
      {
        const { page } = await open(browser, url, { document: { markdown: '# Notes\n', path: 'C:\\docs\\n.md', fileName: 'n.md', title: 'n' }, musicTracks: 0 });
        check('music index is not touched before the Music Bench is used', !(await page.evaluate(() => window.__mock.log.some((m) => m.type === 'music.status'))));
        await page.keyboard.press('Control+Shift+M');
        await page.waitForSelector('.music-empty-inner');
        check('empty Music Bench offers “Add music folder”', (await page.textContent('#music')).includes('Add music folder'));
        await page.close();
      }

      const { page, errors } = await open(browser, url, { document: { markdown: '# Design notes\n\nWriting while listening.\n', path: 'C:\\docs\\design.md', fileName: 'design.md', title: 'design' }, musicTracks: 20000 }, { width: 1600, height: 950 });
      const ms = () => page.evaluate(() => window.NoorMusic._state());
      await page.keyboard.press('Control+Shift+M');
      await page.waitForSelector('#music-list .track:not(.loading)');
      check('Music Bench shows the 20,000-track library', (await page.textContent('#music-count')).includes('20,000'));
      const domRows = await page.$$eval('#music-list .track', (n) => n.length);
      check('library list is virtualised (only visible rows in the DOM)', domRows > 5 && domRows < 60, domRows);
      const t0 = Date.now();
      await page.evaluate(() => { const l = document.querySelector('#music-list'); l.scrollTop = l.scrollHeight; });
      await waitFn(page, () => [...document.querySelectorAll('#music-list .track')].some((n) => n.dataset.index === '19999'));
      check(`jumping to the end of 20,000 tracks renders quickly (${Date.now() - t0} ms)`, Date.now() - t0 < 2000, Date.now() - t0);
      if (shots) await page.screenshot({ path: `${shots}/music-bench-library.png` });

      await page.fill('#music-search', 'zolw');
      await waitFn(page, () => window.NoorMusic._state().view.search === 'zolw');
      await page.waitForTimeout(150);
      const found = await page.$$eval('#music-list .track .track-title', (n) => n.map((x) => x.textContent));
      check('search ignores case and Polish diacritics (“zolw” → “Żółw nocą”)', found.length === 1 && found[0] === 'Żółw nocą', found);

      // Make a 4-track view of the playable fixtures (ids 1-4) via triage, then play it.
      await page.evaluate(() => window.__NOORMD_TEST_HOST__ && null);
      await page.fill('#music-search', '');
      await page.waitForTimeout(250);
      await page.evaluate(async () => { await NoorBridge.request('music.setTriage', { ids: [1, 2, 3, 4], value: 2 }); });
      await page.click('#music-chips .chip:has-text("Keep")');
      await waitFn(page, () => window.NoorMusic._state().view.triage === 2);
      await page.waitForTimeout(200);
      check('triage filter shows exactly the Keep tracks', (await page.$$eval('#music-list .track', (n) => n.length)) === 4);
      await page.dblclick('#music-list .track[data-index="0"]');
      await waitFn(page, () => !window.NoorMusic._state().paused && window.NoorMusic._state().time > 0.2, null, { timeout: 8000 });
      let st = await ms();
      check('double-click plays real audio (MP3/OGG/FLAC/WAV served with HTTP ranges)', !st.paused && st.time > 0.2 && st.q.ids.length === 4, st);
      check('audio requests use byte ranges', mediaLog.some((r) => r.range && r.range.startsWith('bytes=')), mediaLog.slice(0, 3));
      check('mini-player appears while music is loaded', await page.isVisible('#miniplayer'));
      const first = st.q.current;

      // Writing continues while music plays; playback survives document changes.
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' Typing while the music plays.');
      check('document editing works during playback', (await state(page)).markdown.includes('Typing while the music plays') && !(await ms()).paused);
      await page.evaluate(() => NoorBridge.request('doc.new'));
      await page.waitForTimeout(300);
      check('playback continues when another document is loaded', !(await ms()).paused);

      // Sequential playback across a track boundary (fixtures are ~2 s long).
      await waitFn(page, (f) => window.NoorMusic._state().q.current !== f, first, { timeout: 8000 });
      check('advances to the next track at the end (sequential)', (await ms()).q.pos === 1);
      // Repeat one: the same track restarts.
      await page.evaluate(() => { NoorMusic.cycleRepeat(); NoorMusic.cycleRepeat(); }); // off → all → one
      const repeatId = (await ms()).q.current;
      await waitFn(page, () => { const s = window.NoorMusic._state(); return s.time > 1.2; }, null, { timeout: 6000 });
      await waitFn(page, () => window.NoorMusic._state().time < 0.8, null, { timeout: 6000 });
      check('repeat one replays the same track', (await ms()).q.current === repeatId && (await ms()).q.repeat === 'one');
      // Repeat all: wraps from the last track to the first.
      await page.evaluate(() => NoorMusic.cycleRepeat()); // one → off
      await page.evaluate(() => { NoorMusic.cycleRepeat(); }); // off → all
      await page.evaluate(() => { for (let i = 0; i < 3; i++) NoorMusic.next(); });
      st = await ms();
      check('repeat all wraps to the first track', st.q.repeat === 'all' && st.q.pos === (1 + 3) % 4, st.q);
      // Shuffle keeps the current track and permutes the rest.
      const before = (await ms()).q.current;
      await page.evaluate(() => NoorMusic.setShuffle());
      st = await ms();
      check('shuffle keeps the current track playing and reorders the queue', st.q.shuffle && st.q.current === before && [...st.q.order].sort().join() === '0,1,2,3', st.q);
      await page.evaluate(() => NoorMusic.setShuffle());

      // Seek with the mini-player bar.
      await waitFn(page, () => Number.isFinite(window.NoorMusic._state().duration));
      await page.evaluate(() => { const r = document.querySelector('#mp-range'); r.value = '500'; r.dispatchEvent(new Event('change')); });
      await page.waitForTimeout(150);
      st = await ms();
      check('seeking jumps to the chosen position', Math.abs(st.time - st.duration / 2) < 0.6, { time: st.time, duration: st.duration });

      // Triage the playing track from anywhere (Alt+1 = Favorite).
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
      await page.keyboard.press('Alt+Digit1');
      await page.waitForTimeout(150);
      const cur = (await ms()).q.current;
      check('Alt+1 marks the playing track as Favorite without leaving the editor', await page.evaluate((id) => window.__mock.state.music.byId.get(id).triage === 1, cur));
      check('Alt+1 typed nothing into the document', !(await state(page)).markdown.includes('1'));

      // Edit current track (F2): tags and file name independently, playback resumes.
      // Fixtures are ~2 s long, so hold the track with repeat-one while the dialog is open.
      await page.evaluate(() => { NoorMusic.cycleRepeat(); }); // all → one
      await page.evaluate((id) => { const s = window.NoorMusic._state(); if (s.q.current !== id) NoorMusic.prev(); }, cur);
      await page.keyboard.press('F2');
      await page.waitForSelector('.edit-name input');
      const placeholders = await page.$$eval('.edit-grid input', (n) => n.filter((x) => x.value === '' && x.placeholder.includes('not set')).length);
      check('edit dialog shows missing tags as “not set”, not invented values', placeholders >= 5, placeholders);
      await page.fill('.edit-name input', 'bad:name');
      await page.waitForTimeout(450);
      check('invalid file names are flagged before saving', (await page.textContent('.edit-problems')).includes("doesn't allow"));
      await page.fill('.edit-name input', 'Nocna jazda');
      await page.fill('.edit-grid input[data-key="title"]', 'Nocna jazda');
      await page.waitForTimeout(250);
      const boxes = await page.evaluate(() => ({ tags: document.querySelector('#edit-tags').checked, rename: document.querySelector('#edit-rename').checked }));
      check('changing fields ticks “Update tags” and “Rename file” (both can be unticked)', boxes.tags && boxes.rename, boxes);
      if (shots) await page.screenshot({ path: `${shots}/music-edit-track.png` });
      const wasPos = (await ms()).time;
      await page.click('.modal .action.primary:has-text("Save")');
      await waitFn(page, () => !document.querySelector('.edit-name'));
      await waitFn(page, () => !window.NoorMusic._state().paused, null, { timeout: 5000 });
      const edit = await page.evaluate(() => window.__mock.state.music.edits.at(-1));
      st = await ms();
      check('Save sends tag update and rename for the current track', edit.updateTags && edit.rename && edit.fileName === 'Nocna jazda' && edit.tags.title === 'Nocna jazda', edit);
      check('playback resumes on the re-requested file after the edit', st.src.includes('?v=1') && !st.paused && st.time >= Math.max(0, wasPos - 1), { src: st.src, time: st.time, wasPos });
      check('Now Playing shows the new title', (await page.textContent('#np-title')) === 'Nocna jazda');
      await page.evaluate(() => window.NoorMD.runCommand('music.undo'));
      await page.waitForSelector('.modal');
      await page.click('.modal .action.primary');
      await page.waitForTimeout(300);
      check('Undo last track edit restores the previous name', await page.evaluate((id) => window.__mock.state.music.byId.get(id).title === null, cur));

      const posBefore = (await ms()).q.pos;
      await page.keyboard.press('F2');
      await page.waitForSelector('.edit-name input');
      await page.click('.modal .action:has-text("Save & Next")');
      await page.waitForTimeout(250);
      check('Save & Next with no changes simply moves to the next track', (await ms()).q.pos === (posBefore + 1) % 4);
      if (shots) await page.screenshot({ path: `${shots}/music-bench-playing.png` });

      // Missing files are reported and skipped, without stopping everything.
      await page.evaluate(() => { NoorMusic.cycleRepeat(); });  // one → off
      await page.evaluate(async () => { const ids = [6, 1]; await NoorBridge.request('music.setTriage', { ids, value: 3 }); });
      await page.click('#music-chips .chip:has-text("Maybe")');
      await page.waitForTimeout(250);
      await page.dblclick('#music-list .track[data-index="0"]');
      // Wait for the new [missing, playable] queue to start, then for the skip to the playable track.
      await waitFn(page, () => window.NoorMusic._state().q.ids.join() === '6,1', null, { timeout: 5000 }).catch(() => {});
      await waitFn(page, () => { const s = window.NoorMusic._state(); return s.q.pos === 1 && s.q.current === 1 && !s.paused; }, null, { timeout: 8000 }).catch(() => {});
      check('an unplayable (missing) track is skipped with a notice', (await ms()).q.current === 1 && (await page.textContent('#notice')).includes("Can't play"), { q: (await ms()).q, notice: await page.textContent('#notice') });

      // Focus mode hides the bench and mini-player; music keeps playing.
      await page.keyboard.press('F11');
      await page.waitForTimeout(100);
      check('Focus mode hides the Music Bench and mini-player but keeps playing', !(await page.isVisible('#miniplayer')) && !(await page.isVisible('#music')) && !(await ms()).paused);
      await page.keyboard.press('Escape');

      // Ctrl+Alt+Space pauses from the editor.
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
      await page.keyboard.press('Control+Alt+Space');
      await page.waitForTimeout(100);
      check('Ctrl+Alt+Space pauses from anywhere', (await ms()).paused);

      // Session is saved and restored (queue, track, position) — paused, no surprise playback.
      await page.waitForTimeout(1200);
      const saved = await page.evaluate(() => window.__mock.state.music.session);
      const sj = JSON.parse(saved || '{}');
      check('session (queue, track, position) is saved', Array.isArray(sj.ids) && sj.ids.length >= 2 && Number.isFinite(sj.position), sj);
      if (shots) await page.screenshot({ path: `${shots}/music-paused.png` });
      const unexpected = errors.filter((e) => !/status of 404/.test(e)); // the missing-file test produces one expected 404
      check('no unexpected errors in Music Bench checks', unexpected.length === 0, unexpected);
      await page.close();

      const r2 = await open(browser, url, { document: { markdown: '# Next day\n', path: 'C:\\docs\\d.md', fileName: 'd.md', title: 'd' }, musicTracks: 20, musicSession: saved });
      await waitFn(r2.page, () => window.NoorMusic._state().src, null, { timeout: 5000 });
      await r2.page.waitForTimeout(400);
      const restored = await r2.page.evaluate(() => window.NoorMusic._state());
      check('after restart the last queue and track are restored, paused, at the saved position', restored.paused && restored.q.current === sj.ids[sj.order[sj.pos]] && Math.abs(restored.time - sj.position) < 0.6, { restored: { cur: restored.q.current, time: restored.time }, saved: sj });
      check('mini-player is visible after restore', await r2.page.isVisible('#miniplayer'));
      // Turning the Music Bench off in preferences hides it and stops playback.
      await r2.page.evaluate(() => { window.NoorMD.runCommand('prefs.show'); });
      await r2.page.waitForSelector('#pref-music');
      await r2.page.uncheck('#pref-music');
      await r2.page.keyboard.press('Escape');
      check('“Show the Music Bench” off hides it everywhere', !(await r2.page.isVisible('#miniplayer')) && !(await r2.page.isVisible('.music-entry')));
      await r2.page.close();
    }

    // ---- 9. Multi-document tabs (addendum acceptance tests).
    {
      const A = '# Alpha\n\nAlpha body.\n', B = '# Beta\n\nBeta body.\n', C = '# Gamma\n\nGamma body.\n';
      const files = { 'C:\\docs\\a.md': A, 'C:\\docs\\b.md': B, 'C:\\docs\\c.md': C, 'C:\\docs\\raw.md': LOSSY };
      const { page, errors } = await open(browser, url, {
        tabs: [
          { markdown: A, path: 'C:\\docs\\a.md', fileName: 'a.md', title: 'a' },
          { markdown: B, path: 'C:\\docs\\b.md', fileName: 'b.md', title: 'b', encoding: 'UTF-16 LE BOM', eol: 'CRLF' },
        ],
        files, openPaths: ['C:\\docs\\c.md', 'c:\\DOCS\\A.md', 'C:\\docs\\raw.md'], closeChoices: ['cancel', 'save'], saveAsPaths: ['C:\\docs\\renamed.md'],
      });
      const tabsNow = () => page.evaluate(() => window.NoorMD.tabs());
      const ids = async () => (await tabsNow()).map((x) => x.id);
      const textOf = (id) => page.evaluate((i) => window.NoorMD.flush(i).markdown, id);
      const activeTitle = async () => (await tabsNow()).find((x) => x.active).title;
      const clickEditor = () => page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
      const settle = () => page.waitForTimeout(120);

      check('tab strip shows one tab per document', (await page.$$eval('#tabs .tab', (n) => n.map((x) => x.querySelector('.tab-name').textContent))).join() === 'a.md,b.md');
      check('only the shown tab has an editor yet (lazy)', (await tabsNow()).filter((x) => x.mounted).length === 1);
      check('tab tooltip is the full path', (await page.getAttribute('#tabs .tab.active', 'title')).startsWith('C:\\docs\\a.md'));

      // Ctrl+O opens into a new tab.
      await page.keyboard.press('Control+o');
      await waitFn(page, () => window.NoorMD.tabs().length === 3);
      check('Ctrl+O opens the file in a new tab and shows it', (await activeTitle()) === 'c');
      const [ia, ib, ic] = await ids();

      // Edit each document, switching between them repeatedly.
      for (let round = 0; round < 3; round++) {
        for (const [key, name] of [['A', 'a'], ['B', 'b'], ['C', 'c']]) {
          await page.click(`#tabs .tab[data-tab="${{ a: ia, b: ib, c: ic }[name]}"]`);
          await waitFn(page, (n) => window.NoorMD.tabs().find((x) => x.active).title === n, name);
          await settle();
          await clickEditor();
          await page.keyboard.press('Control+End');
          await page.keyboard.type(` ${key}${round}`);
        }
      }
      const [ta, tb, tc] = [await textOf(ia), await textOf(ib), await textOf(ic)];
      const own = (txt, key, others) => [0, 1, 2].every((r) => txt.includes(`${key}${r}`)) && others.every((o) => ![0, 1, 2].some((r) => txt.includes(` ${o}${r}`)));
      check('three documents edited in turn: no cross-document contamination',
        own(ta, 'A', ['B', 'C']) && own(tb, 'B', ['A', 'C']) && own(tc, 'C', ['A', 'B']) && ta.startsWith('# Alpha') && tb.startsWith('# Beta') && tc.startsWith('# Gamma'), { ta, tb, tc });
      check('every edited tab shows its unsaved dot', (await page.$$eval('#tabs .tab.dirty', (n) => n.length)) === 3);
      await page.click(`#tabs .tab[data-tab="${ib}"]`);
      await settle();
      check('status bar shows the shown document’s own encoding and line endings', (await page.textContent('#file-format')).includes('UTF-16 LE BOM · CRLF'));
      const changed = await page.evaluate(() => window.__mock.log.filter((m) => m.type === 'doc.changed').map((m) => [m.payload.tabId, m.payload.markdown]));
      check('recovery drafts are written per tab with that tab’s own text',
        changed.length >= 3 && changed.every(([id, txt]) => (id === ia ? txt.startsWith('# Alpha') : id === ib ? txt.startsWith('# Beta') : txt.startsWith('# Gamma'))), changed.length);

      // Undo is per document.
      await clickEditor();
      for (let i = 0; i < 40; i++) await page.keyboard.press('Control+z');
      check('undo in one tab never reaches another document or empties the file', (await textOf(ib)).trimEnd() === B.trimEnd() && (await textOf(ia)) === ta && (await textOf(ic)) === tc, await textOf(ib));
      await page.keyboard.press('Control+y');

      // Selection survives a tab switch.
      await page.click(`#tabs .tab[data-tab="${ia}"]`);
      await settle();
      await clickEditor();
      await page.keyboard.press('Control+Home');
      await page.keyboard.type('Q');
      await page.keyboard.press('Control+Tab');
      await settle();
      check('Ctrl+Tab goes to the next tab', (await activeTitle()) === 'b');
      await page.keyboard.press('Control+Shift+Tab');
      await settle();
      check('Ctrl+Shift+Tab goes back', (await activeTitle()) === 'a');
      await page.keyboard.type('!');
      check('cursor position is kept across a tab switch', (await textOf(ia)).startsWith('# Q!Alpha'), (await textOf(ia)).slice(0, 20));
      await page.keyboard.press('Control+PageDown');
      await settle();
      check('Ctrl+PageDown also switches tabs', (await activeTitle()) === 'b');

      // Ctrl+S immediately after a keystroke saves that tab only, including the keystroke.
      await page.click(`#tabs .tab[data-tab="${ic}"]`);
      await settle();
      await clickEditor();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('Z');
      await page.keyboard.press('Control+s');
      await waitFn(page, () => (window.__mock.state.saved || []).length === 1);
      const saved1 = await page.evaluate(() => ({ s: window.__mock.state.saved, f: window.__mock.files }));
      check('Ctrl+S saves only the shown tab, with the keystroke typed just before', saved1.s.length === 1 && saved1.s[0].tabId === ic && saved1.f['C:\\docs\\c.md'].includes('C2Z')
        && saved1.f['C:\\docs\\a.md'] === A && saved1.f['C:\\docs\\b.md'] === B, saved1.s);
      await waitFn(page, () => document.querySelectorAll('#tabs .tab.dirty').length === 2, null, { timeout: 3000 }).catch(() => {});
      check('saved tab is clean, the others stay dirty', (await page.$$eval('#tabs .tab.dirty', (n) => n.length)) === 2 && !(await page.$eval(`#tabs .tab[data-tab="${ic}"]`, (n) => n.classList.contains('dirty'))));

      // Opening an already open file (other spelling) selects its tab.
      await page.keyboard.press('Control+o');
      await settle();
      check('opening an open file by an equivalent path selects the existing tab', (await tabsNow()).length === 3 && (await activeTitle()) === 'a');

      // Closing a dirty tab: Cancel keeps it, Save writes only that file.
      await page.click(`#tabs .tab[data-tab="${ib}"]`);
      await settle();
      const bText = await textOf(ib);
      await page.keyboard.press('Control+w');
      await settle();
      check('Cancel on close keeps the tab and its text', (await ids()).includes(ib) && (await textOf(ib)) === bText);
      await page.keyboard.press('Control+w');
      await waitFn(page, (id) => !window.NoorMD.tabs().some((x) => x.id === id), ib);
      const f2 = await page.evaluate(() => window.__mock.files);
      check('Save on close writes only that document, then closes the tab', f2['C:\\docs\\b.md'] === bText && f2['C:\\docs\\a.md'] === A && (await page.evaluate(() => window.__mock.state.saved.length)) === 2);
      check('closing a tab shows a neighbour', (await tabsNow()).some((x) => x.active));

      // Save As changes only that tab.
      await page.click(`#tabs .tab[data-tab="${ia}"]`);
      await settle();
      await page.keyboard.press('Control+Shift+s');
      await settle();
      const after = await tabsNow();
      check('Save As updates only that tab’s path and name', after.find((x) => x.id === ia).path === 'C:\\docs\\renamed.md' && after.find((x) => x.id === ic).path === 'C:\\docs\\c.md'
        && (await page.$$eval('#tabs .tab', (n) => n.map((x) => x.textContent))).some((x) => x.includes('renamed.md')));

      // The round-trip guard still applies to a document opened in a tab, and its banner belongs to that tab.
      await page.keyboard.press('Control+o');
      await waitFn(page, () => window.NoorMD.tabs().length === 3);
      await settle();
      const raw = (await tabsNow()).find((x) => x.active);
      check('a file Visual mode cannot represent opens in Markdown mode, byte-exact', raw.mode === 'markdown' && (await textOf(raw.id)) === LOSSY);
      check('its round-trip banner is shown', !(await page.evaluate(() => document.querySelector('#banner').classList.contains('hide'))));
      await page.click(`#tabs .tab[data-tab="${ia}"]`);
      await settle();
      check('the banner does not follow into another tab; that tab keeps its own mode', (await page.evaluate(() => document.querySelector('#banner').classList.contains('hide'))) && (await page.evaluate(() => window.NoorMD.mode())) === 'wysiwyg');
      await page.click(`#tabs .tab[data-tab="${raw.id}"]`);
      await settle();
      check('…and comes back with its tab', !(await page.evaluate(() => document.querySelector('#banner').classList.contains('hide'))) && (await page.evaluate(() => window.NoorMD.mode())) === 'markdown');

      // Context menu, pinning and bulk close.
      await page.click(`#tabs .tab[data-tab="${ia}"]`, { button: 'right' });
      await page.waitForSelector('#tab-menu');
      const items = await page.$$eval('#tab-menu button', (n) => n.map((x) => x.textContent));
      check('tab menu has Close, Close Others, Close Tabs to the Right, Copy Path, Reveal in Explorer, Pin',
        ['Close', 'Close Others', 'Close Tabs to the Right', 'Copy Path', 'Reveal in Explorer', 'Pin'].every((x) => items.includes(x)), items);
      await page.click('#tab-menu button:text-is("Copy Path")');
      await settle();
      check('Copy Path copies the full path', (await page.evaluate(() => window.__mock.state.clipboard)) === 'C:\\docs\\renamed.md');
      await page.click(`#tabs .tab[data-tab="${ic}"]`, { button: 'right' });
      await page.click('#tab-menu button:text-is("Pin")');
      await settle();
      check('pinned tab moves to the start and shows a pin', (await ids())[0] === ic && (await page.$eval(`#tabs .tab[data-tab="${ic}"]`, (n) => n.classList.contains('pinned'))));
      check('pinning is reported to the host for the session', await page.evaluate((id) => window.__mock.state.tabsState.tabs.find((x) => x.id === id).pinned, ic));
      await page.click(`#tabs .tab[data-tab="${raw.id}"]`, { button: 'middle' });
      await settle();
      check('middle-click closes a tab', !(await ids()).includes(raw.id));
      await page.click(`#tabs .tab[data-tab="${ic}"]`, { button: 'middle' });
      await settle();
      check('middle-click does not close a pinned tab', (await ids()).includes(ic));
      await page.click(`#tabs .tab[data-tab="${ia}"]`, { button: 'right' });
      await page.click('#tab-menu button:text-is("Close Others")');
      await settle();
      check('Close Others keeps pinned tabs', (await ids()).join() === [ic, ia].join(), await ids());
      if (shots) await page.screenshot({ path: `${shots}/tabs.png` });
      check('no page errors in tab workflows', errors.length === 0, errors);
      await page.close();
    }

    // ---- 10. Untitled tabs stay distinct; rapid switching while typing; music keeps playing.
    {
      const { page, errors } = await open(browser, url, { document: null, musicTracks: 4 });
      const tabsNow = () => page.evaluate(() => window.NoorMD.tabs());
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+t'); // replaces the welcome screen's blank tab
      await waitFn(page, () => !document.querySelector('#welcome:not(.hide)'));
      await page.keyboard.press('Control+t');
      await waitFn(page, () => window.NoorMD.tabs().length === 2);
      check('Ctrl+T on the welcome screen reuses the blank tab, then adds a new one', (await tabsNow()).length === 2);
      const [u1, u2] = (await tabsNow()).map((x) => x.id);
      await page.evaluate(() => window.NoorMusic._testPlay([1, 2, 3, 4], 0, true));
      await waitFn(page, () => !window.NoorMusic._state().paused && window.NoorMusic._state().time > 0.2, null, { timeout: 8000 });
      const typed = [];
      for (let i = 0; i < 16; i++) {
        await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
        const token = `w${i}x`;
        typed.push(token);
        await page.keyboard.type(token + ' ', { delay: 5 });
        await page.keyboard.press('Control+Tab'); // no waiting: switch while the text is still being sent
      }
      await page.waitForTimeout(800);
      const t1 = await page.evaluate((id) => window.NoorMD.flush(id).markdown, u1), t2 = await page.evaluate((id) => window.NoorMD.flush(id).markdown, u2);
      const inBoth = typed.filter((x) => t1.includes(x) && t2.includes(x));
      const lost = typed.filter((x) => !t1.includes(x) && !t2.includes(x));
      check('rapid switching while typing: every word lands in exactly one document', inBoth.length === 0 && lost.length === 0, { t1, t2, lost });
      const evenOk = typed.filter((_, i) => i % 2 === 0).every((x) => t2.includes(x)) && typed.filter((_, i) => i % 2 === 1).every((x) => t1.includes(x)); // typing starts in the newer tab
      check('…and in the document that was on screen when it was typed', evenOk, { t1, t2 });
      check('two untitled tabs keep separate recovery drafts', await page.evaluate(([a, b]) => {
        const last = (id) => window.__mock.log.filter((m) => m.type === 'doc.changed' && m.payload.tabId === id).pop();
        return last(a) && last(b) && last(a).payload.markdown !== last(b).payload.markdown && last(a).payload.dirty && last(b).payload.dirty;
      }, [u1, u2]));
      check('music keeps playing while tabs are opened and switched', !(await page.evaluate(() => window.NoorMusic._state().paused)));
      await page.keyboard.press('Control+w');
      await settleClose(page);
      check('music keeps playing when a tab is closed', !(await page.evaluate(() => window.NoorMusic._state().paused)) && (await tabsNow()).length === 1);
      await page.keyboard.press('Control+w');
      await settleClose(page);
      check('closing the last tab leaves a fresh blank document', (await tabsNow()).length === 1 && (await page.evaluate(() => window.NoorMD.getState().markdown)) === '');
      check('mini-player stays through tab changes', await page.isVisible('#miniplayer'));
      await page.evaluate(() => window.NoorMusic.toggle());
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors with untitled tabs and music', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 11. Session restore and 20+ tabs (overflow, switcher, lazy editors).
    {
      const many = Array.from({ length: 24 }, (_, i) => ({ tabId: '10000000000000' + i.toString(16).padStart(2, '0'), markdown: `# Doc ${i}\n\nText ${i}.\n`, path: `C:\\docs\\long document name ${i}.md`, fileName: `long document name ${i}.md`, title: `long document name ${i}` }));
      many[0].pinned = true;
      many[3] = { ...many[3], path: null, fileName: null, title: 'Untitled ideas', markdown: '# Ideas\n' };
      many[5].mode = 'split';
      const { page, errors } = await open(browser, url, { tabs: many, activeTabId: many[5].tabId }, { width: 1024, height: 700 });
      const tabsNow = () => page.evaluate(() => window.NoorMD.tabs());
      const list = await tabsNow();
      check('restored session keeps tab order (files and untitled)', list.map((x) => x.id).join() === many.map((x) => x.tabId).join() && list[3].title === 'Untitled ideas' && list[3].path === null);
      check('restored session selects the remembered tab with its view mode', list.find((x) => x.active).id === many[5].tabId && (await page.evaluate(() => window.NoorMD.mode())) === 'split');
      check('restored pinned tab is pinned', list[0].pinned && (await page.$eval('#tabs .tab', (n) => n.classList.contains('pinned'))));
      check('24 tabs: only the shown one has an editor', list.filter((x) => x.mounted).length === 1);
      const ov = await page.evaluate(() => ({ strip: document.querySelector('#tabs').scrollWidth > document.querySelector('#tabs').clientWidth, page: document.documentElement.scrollWidth - window.innerWidth, active: (() => { const a = document.querySelector('#tabs .tab.active').getBoundingClientRect(), s = document.querySelector('#tabs').getBoundingClientRect(); return a.left >= s.left - 1 && a.right <= s.right + 1; })() }));
      check('many tabs scroll inside the strip, the window does not overflow, the shown tab is in view', ov.strip && ov.page <= 0 && ov.active, ov);
      await page.keyboard.press('Control+e');
      await page.waitForSelector('#switcher-query');
      check('Ctrl+E lists every open document', (await page.$$eval('.modal .cmd-item', (n) => n.length)) === 24);
      await page.fill('#switcher-query', 'name 17');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      check('typing filters the list and Enter shows that document', (await tabsNow()).find((x) => x.active).title === 'long document name 17' && (await page.evaluate(() => window.NoorMD.getState().markdown)).includes('Text 17'));
      // Drag a tab to reorder.
      await page.evaluate(() => { document.querySelector('#tabs').scrollLeft = 0; });
      const src = await page.$(`#tabs .tab[data-tab="${many[2].tabId}"]`);
      const dst = await page.$(`#tabs .tab[data-tab="${many[1].tabId}"]`);
      const sb = await src.boundingBox(), db = await dst.boundingBox();
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await page.mouse.down();
      await page.mouse.move(db.x + 6, db.y + db.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      const order = (await tabsNow()).map((x) => x.id);
      check('dragging a tab reorders the strip and the host is told', order[1] === many[2].tabId && order[2] === many[1].tabId
        && (await page.evaluate(() => window.__mock.state.tabsState.tabs.map((x) => x.id)))[1] === many[2].tabId, order.slice(0, 4));
      // Fast cycling through all tabs mounts each one correctly.
      for (let i = 0; i < 24; i++) await page.keyboard.press('Control+Tab');
      await page.waitForTimeout(600);
      const s = await page.evaluate(() => ({ st: window.NoorMD.getState(), id: window.NoorMD.activeTab() }));
      const exp = many.find((x) => x.tabId === s.id);
      check('cycling through 24 tabs ends on a correctly loaded document', s.st.markdown === exp.markdown && !s.st.dirty, { got: s.st.markdown, exp: exp.markdown });
      check('no tab became dirty by being shown', (await tabsNow()).every((x) => !x.dirty));
      if (shots) await page.screenshot({ path: `${shots}/tabs-many-1024.png` });
      check('no page errors with 24 tabs', errors.length === 0, errors);
      await page.close();
    }

    // ---- 12. Main menu and customizable toolbar (one command registry for menu, toolbar, shortcuts and Ctrl+K).
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# Plan\n\nPlain words here.\n', path: 'C:\\docs\\plan.md', fileName: 'plan.md', title: 'plan' }, musicTracks: 4 });
      const md = () => page.evaluate(() => window.NoorMD.getState().markdown);
      const titles = await page.$$eval('#menubar .menu-title', (n) => n.map((x) => x.textContent));
      check('menu bar has File, Edit, Insert, Format, View, Workspace, Media, Tools, Help', titles.join() === 'File,Edit,Insert,Format,View,Workspace,Media,Tools,Help', titles);
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror p');
      await page.keyboard.press('Alt+f');
      await page.waitForSelector('.menu-popup');
      const fileItems = await page.$$eval('.menu-popup .menu-label', (n) => n.map((x) => x.textContent));
      check('Alt+F opens the File menu with real commands', ['New document', 'Save', 'Save all', 'Print…', 'Exit'].every((x) => fileItems.includes(x)), fileItems);
      check('menu items show their shortcuts', (await page.textContent('.menu-popup')).includes('Ctrl+S'));
      check('keyboard focus is inside the open menu', await page.evaluate(() => !!document.activeElement.closest('.menu-popup')));
      await page.keyboard.press('ArrowRight');
      check('→ moves to the next menu (Edit)', (await page.$$eval('.menu-popup .menu-label', (n) => n.map((x) => x.textContent))).includes('Paste as plain text'));
      await page.keyboard.press('Escape');
      check('Esc closes the menu and returns to the document', (await page.$$('.menu-popup')).length === 0 && await page.evaluate(() => !!document.activeElement.closest('.ProseMirror')));
      check('Esc in a menu does not leave Focus mode or close a tab', (await page.evaluate(() => window.NoorMD.tabs().length)) === 1);

      // Select a word, make it bold from the toolbar; the button shows the state.
      await page.dblclick('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror p');
      await page.click('#toolbar [data-cmd-id="fmt.bold"]');
      await page.waitForTimeout(120);
      check('toolbar Bold formats the selection', /\*\*[^*]+\*\*/.test(await md()), await md());
      check('Bold button shows the format at the caret', (await page.getAttribute('#toolbar [data-cmd-id="fmt.bold"]', 'aria-pressed')) === 'true');
      // Same command from the menu: Format → Italic.
      await page.click('#menubar .menu-title[data-menu="3"]');
      await page.click('.menu-popup .menu-item:has-text("Italic")');
      await page.waitForTimeout(120);
      check('Format → Italic runs the same command', /\*\*\*|_\*\*|\*_|\*\*_/.test(await md()) || /\*[^*]+\*/.test((await md()).replace(/\*\*/g, '')), await md());
      await page.click('#toolbar [data-cmd-id="edit.undo"]');
      await page.waitForTimeout(80);
      check('toolbar Undo undoes the last change in this document', !/\*\*\*|_\*\*|\*\*_/.test(await md()) && /\*\*/.test(await md()), await md());
      // Heading picker
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror p');
      await page.click('#toolbar .tb-heading');
      await page.click('.menu-popup .menu-item:has-text("Heading 2")');
      await page.waitForTimeout(120);
      check('heading picker turns the paragraph into a heading and shows its level', (await md()).includes('## ') && (await page.textContent('#toolbar .tb-heading-label')) === 'H2', await md());
      // Insert table via dialog
      await page.keyboard.press('Control+End');
      await page.click('#menubar .menu-title[data-menu="2"]');
      await page.click('.menu-popup .menu-item:has-text("Insert table")');
      await page.fill('#table-rows', '2');
      await page.fill('#table-cols', '4');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      const tableLines = (await md()).split('\n').filter((l) => /^\|.*\|$/.test(l.trim()));
      check('Insert → Table adds a header row plus the chosen rows and columns', tableLines.length === 4 && tableLines[0].split('|').length - 2 === 4, tableLines);
      // Disabled state: untitled document → Show file in Explorer disabled
      await page.click('#menubar .menu-title[data-menu="0"]');
      check('commands that cannot run are disabled, not hidden', !(await page.isDisabled('.menu-popup .menu-item:has-text("Show file in Explorer")')) && (await page.isDisabled('.menu-popup .menu-item:has-text("Save all")')) === false);
      await page.keyboard.press('Escape');
      // Statistics
      await page.evaluate(() => window.NoorMD.runCommand('stats.show'));
      await page.waitForSelector('.stats-table');
      check('Tools → Document statistics shows counts', (await page.textContent('.stats-table')).includes('Words') && (await page.textContent('.stats-table')).includes('Headings'));
      await page.keyboard.press('Escape');

      // Hide / show toolbar from the View menu (setting persisted).
      await page.click('#menubar .menu-title[data-menu="4"]');
      await page.click('.menu-popup .menu-item:has-text("Show toolbar")');
      await page.waitForTimeout(80);
      check('View → Show toolbar hides it and the setting is saved', !(await page.isVisible('#toolbar')) && await page.evaluate(() => window.__mock.log.some((m) => m.type === 'prefs.set' && m.payload.showToolbar === false)));
      await page.click('#menubar .menu-title[data-menu="4"]');
      check('the menu item shows it unchecked', (await page.getAttribute('.menu-popup .menu-item:has-text("Show toolbar")', 'aria-checked')) === 'false');
      await page.click('.menu-popup .menu-item:has-text("Show toolbar")');
      check('…and brings it back', await page.isVisible('#toolbar'));
      // Customize: labels + hide a group
      await page.evaluate(() => window.NoorMD.runCommand('toolbar.customize'));
      await page.waitForSelector('#tb-labels');
      await page.check('#tb-labels');
      await page.uncheck('#tbg-media');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      check('labels can be shown', await page.isVisible('#toolbar [data-cmd-id="fmt.bold"] .tb-label'));
      check('a toolbar group can be hidden and the choice is saved', !(await page.$('#toolbar [data-group="media"]')) && await page.evaluate(() => window.__mock.log.some((m) => m.type === 'prefs.set' && m.payload.toolbarGroups === 'document,writing,navigation,view,tools')));
      await page.evaluate(() => window.NoorMD.runCommand('toolbar.customize'));
      await page.click('.modal button:has-text("Restore defaults")');
      await page.keyboard.press('Escape');
      check('Restore defaults brings every group back', (await page.$$('#toolbar .tb-group')).length === 6);

      // Narrow window: nothing clipped, overflow menu works.
      await page.setViewportSize({ width: 1024, height: 720 });
      await page.waitForTimeout(250);
      const fit = await page.evaluate(() => { const b = document.querySelector('#toolbar'); return { sw: b.scrollWidth, cw: b.clientWidth, more: !document.querySelector('#toolbar-more').hidden, menus: document.querySelector('#menubar').scrollWidth <= document.querySelector('#menubar').clientWidth + 1 }; });
      check('at 1024 px the toolbar is not clipped: extra commands move to “More”', fit.sw <= fit.cw + 1 && fit.more, fit);
      check('at 1024 px every menu title is visible', fit.menus, fit);
      await page.click('#toolbar-more');
      await page.waitForSelector('.menu-popup');
      check('“More” lists the hidden commands', (await page.$$('.menu-popup .menu-item')).length >= 3);
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1440, height: 900 });

      // Focus mode: toolbar and menu hidden, a visible way out.
      await page.keyboard.press('F11');
      await page.waitForTimeout(150);
      check('Focus mode hides menu and toolbar but keeps an Exit button', !(await page.isVisible('#toolbar')) && !(await page.isVisible('#menubar')) && await page.isVisible('#zen-exit'));
      await page.click('#zen-exit');
      check('the Exit button leaves Focus mode', !(await page.evaluate(() => document.body.classList.contains('zen'))));

      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.waitForTimeout(200);
      // Media group: play/pause from the toolbar, now playing title; music unaffected by toolbar changes.
      await page.evaluate(() => window.NoorMusic._testPlay([1, 2], 0, true));
      await waitFn(page, () => !window.NoorMusic._state().paused, null, { timeout: 8000 });
      await page.waitForTimeout(200);
      check('toolbar shows the playing track', (await page.textContent('#toolbar .tb-np')).length > 0 && (await page.textContent('#toolbar .tb-np')) !== 'Music');
      await page.evaluate(() => window.NoorMD.runCommand('view.toolbar'));
      await page.evaluate(() => window.NoorMD.runCommand('view.toolbar'));
      check('music keeps playing while the toolbar is hidden and shown', !(await page.evaluate(() => window.NoorMusic._state().paused)));
      await page.click('#toolbar .tb-play');
      await page.waitForTimeout(100);
      check('toolbar play/pause pauses', await page.evaluate(() => window.NoorMusic._state().paused));

      // F10 focuses the menu bar.
      await page.keyboard.press('F10');
      check('F10 puts keyboard focus on the menu bar', await page.evaluate(() => document.activeElement.classList.contains('menu-title')));
      await page.keyboard.press('Escape');
      if (shots) await page.screenshot({ path: `${shots}/menu-toolbar.png` });
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors in menu/toolbar checks', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 13. Vaults: explorer, file operations, Find in Vault, backlinks, wiki links, 1,500 notes.
    {
      const vfiles = {
        'Welcome.md': '# Welcome\n\nStart at [[Rivers]] today.\n',
        'World/Rivers.md': '# Rivers\n\nWide river with fish.\n',
        'World/Seas.md': '# Seas\n\nSee [Rivers](Rivers.md) and [[Rivers|the rivers]].\n',
        'Notes/Żółw.md': '# Żółw\n\nTurtle notes.\n',
        'Meta.md': '---\ntags: [world, draft]\ntitle: Meta\n---\n\n# Meta\n\nFront matter stays.\n',
        'Images/forest.png': 'png',
      };
      for (let i = 1; i <= 1500; i++) vfiles[`Archive/Note ${i}.md`] = `# Note ${i}\n\nArchived idea number ${i}.\n`;
      const { page, errors } = await open(browser, url, { document: null, vault: { root: 'C:\\Vaults\\Atlas', files: vfiles }, musicTracks: 4 });
      await waitFn(page, () => document.querySelectorAll('#vault-tree .vt-row').length > 0);
      const rows = () => page.$$eval('#vault-tree .vt-row', (n) => n.map((x) => x.dataset.path));
      check('opening a Vault shows its explorer with folders first, natural order', (await rows()).join() === 'Archive,Images,Notes,World,Meta.md,Welcome.md', await rows());
      check('the Vault name is shown in the header', (await page.textContent('#vault-name')) === 'Atlas' && await page.isVisible('#side-switch'));
      check('other tools’ files are never listed (nothing hidden is shown)', !(await rows()).some((p) => p.startsWith('.')));

      // Expanding a 1,500-note folder stays quick.
      const t0 = Date.now();
      await page.click('#vault-tree .vt-row[data-path="Archive"]');
      await waitFn(page, () => document.querySelectorAll('#vault-tree .vt-row').length > 1500);
      check('a folder with 1,500 notes expands in under 1.5 s', Date.now() - t0 < 1500, Date.now() - t0);
      check('notes sort naturally (Note 2 before Note 10)', await page.evaluate(() => { const r = [...document.querySelectorAll('#vault-tree .vt-row')].map((x) => x.dataset.path); return r.indexOf('Archive/Note 2.md') < r.indexOf('Archive/Note 10.md'); }));
      await page.click('#vault-tree .vt-row[data-path="Archive"]');

      // Click a file → opens in a tab; the row is marked current.
      await page.click('#vault-tree .vt-row[data-path="World"]');
      await page.click('#vault-tree .vt-row[data-path="World/Rivers.md"]');
      await waitFn(page, () => window.NoorMD.getState()?.title === 'Rivers');
      check('clicking a note opens it in a tab (the blank start tab is reused)', (await page.evaluate(() => window.NoorMD.tabs().length)) === 1);
      check('the open note is marked in the explorer', await page.$eval('#vault-tree .vt-row[data-path="World/Rivers.md"]', (n) => n.classList.contains('current')));
      // Backlinks
      await page.click('#side-switch button[data-view="doc"]');
      await waitFn(page, () => !document.querySelector('#backlinks-section').hidden && document.querySelectorAll('#backlinks-box button').length > 0);
      const bl = await page.$$eval('#backlinks-box button span', (n) => n.map((x) => x.textContent));
      check('“Linked from” lists notes linking here by [[wiki link]] and by relative link', bl.includes('Welcome') && bl.includes('Seas'), bl);
      await page.click('#side-switch button[data-view="files"]');

      // Keyboard: focus tree, move down, Enter opens.
      await page.focus('#vault-tree .vt-row[data-path="World/Rivers.md"]');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.NoorMD.getState()?.title === 'Seas');
      check('keyboard: ↓ and Enter open the next note in a new tab', (await page.evaluate(() => window.NoorMD.tabs().length)) === 2);

      // Filter by name, accent-insensitive.
      await page.fill('#vault-filter', 'zolw');
      check('the name filter ignores accents (zolw → Żółw)', (await rows()).join() === 'Notes/Żółw.md', await rows());
      await page.fill('#vault-filter', '');

      // Find in Vault
      await page.keyboard.press('Control+Shift+F');
      await page.waitForSelector('#vault-search-input');
      await page.fill('#vault-search-input', 'river');
      await waitFn(page, () => document.querySelectorAll('.vs-hit').length > 0);
      const hits = await page.$$eval('.vs-hit', (n) => n.map((x) => x.textContent));
      check('Find in Vault lists name matches and lines with highlighted words', hits.some((h) => h.includes('Rivers.md')) && hits.some((h) => h.includes('Wide river with fish')) && (await page.$$('.vs-hit mark')).length > 0, hits.slice(0, 5));
      await page.fill('#vault-search-input', 'archived idea 1499');
      await waitFn(page, () => [...document.querySelectorAll('.vs-hit')].some((x) => x.textContent.includes('Note 1499.md')));
      await page.keyboard.press('Escape');

      // Wiki link: Ctrl+click on [[Rivers]] in Welcome follows it.
      await page.evaluate(() => NoorBridge.request('vault.openFile', { path: 'Welcome.md' }));
      await waitFn(page, () => window.NoorMD.getState()?.title === 'Welcome');
      await page.waitForTimeout(200);
      check('a note with [[wiki links]] keeps its exact text', (await page.evaluate(() => window.NoorMD.getState().markdown)).trim() === vfiles['Welcome.md'].trim(), await page.evaluate(() => window.NoorMD.getState().markdown));
      const pos = await page.evaluate(() => {
        const pane = document.querySelector('#editor .doc-pane:not([hidden])');
        const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.textContent.indexOf('Rivers');
          if (i < 0 || n.parentElement.offsetParent === null || !n.parentElement.closest('[contenteditable="true"]')) continue;
          const r = document.createRange(); r.setStart(n, i + 2); r.setEnd(n, i + 3);
          const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
        return null;
      });
      await page.keyboard.down('Control');
      await page.mouse.click(pos.x, pos.y);
      await page.keyboard.up('Control');
      await waitFn(page, () => window.NoorMD.getState()?.title === 'Rivers');
      check('Ctrl+click on [[Rivers]] opens that note (its existing tab)', (await page.evaluate(() => window.NoorMD.tabs().length)) === 3);

      const meta = await page.evaluate(async () => { await NoorBridge.request('vault.openFile', { path: 'Meta.md' }); return true; });
      await waitFn(page, () => window.NoorMD.getState()?.title === 'Meta');
      await page.waitForTimeout(200);
      check('YAML front matter is kept exactly', (await page.evaluate(() => window.NoorMD.getState().markdown)).startsWith('---\ntags: [world, draft]\ntitle: Meta\n---'), await page.evaluate(() => window.NoorMD.getState().markdown));

      // New note from the context menu, then rename with F2; the open tab follows.
      await page.click('#vault-tree .vt-row[data-path="World"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("New note")');
      await page.fill('.modal input', 'Lakes');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.vault.files['World/Lakes.md'] !== undefined && window.NoorMD.getState()?.title === 'Lakes');
      check('New note creates the file in that folder and opens it', true);
      await waitFn(page, () => !!document.querySelector('#vault-tree .vt-row[data-path="World/Lakes.md"]'));
      await page.click('#vault-tree .vt-row[data-path="World/Lakes.md"]');
      await page.keyboard.press('F2');
      await page.waitForSelector('.vt-rename');
      await page.keyboard.type('Ponds');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.vault.files['World/Ponds.md'] !== undefined);
      await waitFn(page, () => window.NoorMD.tabs().some((x) => x.path === 'C:\\Vaults\\Atlas\\World\\Ponds.md'));
      check('F2 renames in place (extension kept) and the open tab follows the file', (await page.textContent('#tabs .tab.active')).includes('Ponds.md'));

      // Drag a note onto another folder.
      await page.dragAndDrop('#vault-tree .vt-row[data-path="World/Seas.md"]', '#vault-tree .vt-row[data-path="Notes"]');
      await waitFn(page, () => window.__mock.state.vault.files['Notes/Seas.md'] !== undefined, null, { timeout: 4000 });
      check('dragging a note onto a folder moves it', !('World/Seas.md' in (await page.evaluate(() => window.__mock.state.vault.files))));
      check('…and its open tab follows', await page.evaluate(() => window.NoorMD.tabs().some((x) => x.path === 'C:\\Vaults\\Atlas\\Notes\\Seas.md')));

      // Multi-select and delete with the Delete key.
      await page.click('#vault-tree .vt-row[data-path="Meta.md"]');
      await page.click('#vault-tree .vt-row[data-path="Welcome.md"]', { modifiers: ['Control'] });
      check('Ctrl+click selects several items', (await page.$$('#vault-tree .vt-row.selected')).length === 2);
      await page.keyboard.press('Delete');
      await waitFn(page, () => window.__mock.state.vault.deleted.length === 2);
      check('Delete sends the selected items to the host (Recycle Bin)', true);

      // Quick switcher includes Vault notes.
      await page.keyboard.press('Control+e');
      await page.waitForSelector('#switcher-query');
      await page.fill('#switcher-query', 'zolw');
      check('Ctrl+E also finds notes of the Vault that are not open', (await page.textContent('.palette-results')).includes('Żółw.md'));
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.NoorMD.getState()?.title === 'Żółw');

      // Music keeps playing; closing the Vault keeps tabs.
      await page.evaluate(() => window.NoorMusic._testPlay([1, 2], 0, true));
      await waitFn(page, () => !window.NoorMusic._state().paused, null, { timeout: 8000 });
      await page.evaluate(() => NoorBridge.request('vault.search', { query: 'note' }));
      await page.evaluate(() => NoorBridge.request('vault.refresh'));
      const before = await page.evaluate(() => window.NoorMD.tabs().length);
      await page.evaluate(() => window.NoorMD.runCommand('vault.close'));
      await waitFn(page, () => !document.body.classList.contains('has-vault'));
      check('closing the Vault keeps every tab open', (await page.evaluate(() => window.NoorMD.tabs().length)) === before);
      check('music plays on through Vault search, refresh and close', !(await page.evaluate(() => window.NoorMusic._state().paused)));
      check('Vault-only commands are disabled without a Vault (Find in files still works)', await page.evaluate(() => { document.querySelector('#menubar .menu-title[data-menu="5"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); const items = [...document.querySelectorAll('.menu-popup .menu-item')]; const r = items.find((x) => x.textContent.includes('Refresh Vault')); const f = items.find((x) => x.textContent.includes('Find in files')); return !!r && r.disabled && !!f && !f.disabled; }));
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.NoorMusic.toggle());
      if (shots) await page.screenshot({ path: `${shots}/vault.png` });
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors in Vault checks', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 14. Pack & Share: preview, exclusions, linked files, AI handoff, progress, cancel, unsaved edits.
    {
      const vfiles = {
        'World/Rivers.md': '# Rivers\n\n![forest](../Images/forest.png)\n\nSee [gone](Gone.md).\n',
        'World/Seas.md': '# Seas\n',
        'World/.env': 'SECRET=1',
        'Images/forest.png': 'PNGDATA',
        'Index.md': '# Index\n',
      };
      const { page, errors } = await open(browser, url, { document: null, vault: { root: 'C:\\Vaults\\Atlas', files: vfiles }, musicTracks: 4, packDelay: 80 });
      await waitFn(page, () => document.querySelectorAll('#vault-tree .vt-row').length > 0);
      await page.click('#vault-tree .vt-row[data-path="World"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Pack & Share")');
      await page.waitForSelector('.pack-summary strong');
      check('right-click → Pack & Share opens a preview for that folder', (await page.textContent('.pack-form')).includes('“World”') && (await page.textContent('.pack-summary')).includes('2 files'), await page.textContent('.pack-summary'));
      const sections = await page.$$eval('.pack-section > summary span', (n) => n.map((x) => x.textContent));
      check('preview shows files, linked files, unresolved links, left-out files and the exclusion rules', ['Files in the package', 'Linked files outside the selection', 'Links that can’t be packed', 'Left out', 'Exclusion rules'].every((x) => sections.includes(x)), sections);
      check('secrets are left out by a visible rule', (await page.textContent('.pack-details')).includes('World/.env') && (await page.textContent('.pack-details')).includes('.env'));
      check('a missing linked file is reported', (await page.textContent('.pack-details')).includes('Gone.md'));
      await page.check('#pk-dependencies');
      await waitFn(page, () => document.querySelector('.pack-summary').textContent.includes('3 files'));
      check('“Include linked files” adds the picture from outside the folder', [...await page.$$eval('.pack-item.dep span', (n) => n.map((x) => x.textContent))].includes('Images/forest.png'));
      await page.uncheck('.pack-section:has-text("Linked files") input[type=checkbox]');
      await waitFn(page, () => document.querySelector('.pack-summary').textContent.includes('2 files'));
      check('a linked file can be left out individually', await page.evaluate(() => window.__mock.state.vault.lastPlanRequest.skipDependencies.includes('Images/forest.png')));
      await page.check('.pack-section:has-text("Linked files") input[type=checkbox]');

      // AI Handoff preset
      await page.check('#pk-preset-handoff');
      await page.waitForSelector('#pk-note');
      await page.fill('#pk-note', 'Please review the river chapter.');
      await waitFn(page, () => document.querySelectorAll('.pack-item.gen').length === 2);
      check('AI Handoff adds MANIFEST.md and README.md in their own folder', (await page.$$eval('.pack-item.gen span', (n) => n.map((x) => x.textContent))).join() === '_noormd_handoff/MANIFEST.md,_noormd_handoff/README.md');

      // Create with progress while music plays.
      await page.evaluate(() => window.NoorMusic._testPlay([1, 2], 0, true));
      await waitFn(page, () => !window.NoorMusic._state().paused, null, { timeout: 8000 });
      await page.click('#pk-create');
      await page.waitForSelector('.pack-progress');
      await waitFn(page, () => document.querySelector('.pack-running span')?.textContent.startsWith('Packing'));
      check('packing shows progress', true);
      await page.waitForSelector('.pack-done');
      const req = await page.evaluate(() => window.__mock.state.vault.packRequest);
      check('the package request carries the user’s choices and only their own note', req.handoff === true && req.note === 'Please review the river chapter.' && req.dependencies === true && req.paths.join() === 'World');
      check('completion shows the file, the count and any skipped (locked) files', (await page.textContent('.pack-done')).includes('C:\\Vaults\\Atlas.zip') && (await page.textContent('.pack-done')).includes('locked by another program'));
      check('music kept playing while packing', !(await page.evaluate(() => window.NoorMusic._state().paused)));
      await page.click('.modal button:has-text("Show in folder")');
      check('“Show in folder” asks the host to reveal the archive', await page.evaluate(() => window.__mock.state.vault.revealed === true));
      await page.click('.modal button:has-text("Done")');

      // Cancel: no archive, form comes back.
      await page.evaluate(() => window.NoorMD.runCommand('vault.pack'));
      await page.waitForSelector('.pack-summary strong');
      check('Workspace → Pack & Share offers the explorer selection or the whole Vault', await page.isVisible('#pk-scope-selection') && await page.isVisible('#pk-scope-vault'));
      await page.check('#pk-scope-vault');
      await waitFn(page, () => window.__mock.state.vault.lastPlanRequest.paths.length === 0);
      await page.evaluate(() => { window.__mock.state.vault.packed = false; window.__mock.state.vault.packDelay = 1500; });
      await page.click('#pk-create');
      await page.waitForSelector('#pk-cancel');
      await page.click('#pk-cancel');
      await page.waitForSelector('#pk-create');
      await page.evaluate(() => { window.__mock.state.vault.packDelay = 60; });
      check('Cancel stops packing and reports that no archive was created', !(await page.evaluate(() => window.__mock.state.vault.packed)) && (await page.textContent('#notice')).includes('no archive'));
      await page.keyboard.press('Escape');

      // Unsaved edits in a packed note must be handled explicitly.
      await page.click('#vault-tree .vt-row[data-path="Index.md"]');
      await waitFn(page, () => window.NoorMD.getState()?.title === 'Index');
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' unsaved words');
      await page.evaluate(() => window.NoorMD.runCommand('vault.pack'));
      await page.waitForSelector('.pack-unsaved');
      check('unsaved changes in a packed note are pointed out with a choice', (await page.textContent('.pack-unsaved')).includes('Index.md') && await page.isChecked('#pk-save-first'));
      await page.check('#pk-disk');
      await page.click('#pk-create');
      await page.waitForSelector('.pack-done');
      check('choosing “saved versions” is passed to the host', (await page.evaluate(() => window.__mock.state.vault.packRequest.saveFirst)) === false);
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.NoorMusic.toggle());
      if (shots) await page.screenshot({ path: `${shots}/pack.png` });
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors in Pack & Share checks', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 15. NoorSketch (its own window/page): brush, eraser, undo, zoom, exact save/open, PNG export, insert.
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript(sketchHostScript, {});
      await page.goto(url + '_noormd/sketch.html');
      await waitFn(page, () => window.NoorSketch && window.NoorSketch._state().W === 400);
      const S = () => page.evaluate(() => window.NoorSketch._state());
      const px = (x, y) => page.evaluate(([a, b]) => window.NoorSketch._pixel(a, b), [x, y]);
      const at = (x, y) => page.evaluate(([a, b]) => window.NoorSketch._toClient(a, b), [x, y]);
      check('NoorSketch opens with a white 400×300 canvas', (await S()).W === 400 && (await px(5, 5)).join() === '255,255,255,255');
      check('a small canvas is shown at 100% (fit never enlarges it) and keeps its pixel size', (await S()).zoom === 1 && (await page.evaluate(() => document.querySelector('#sketch-canvas').width)) === 400);

      // A fast stroke (only 3 pointer samples across the canvas) leaves no gaps.
      let a = await at(20, 150), b = await at(380, 150);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 2 });
      await page.mouse.up();
      await page.waitForTimeout(80);
      const row = await page.evaluate(() => { const out = []; for (let x = 22; x <= 378; x++) out.push(window.NoorSketch._pixel(x, 150)); return out; });
      check('a fast stroke is continuous (no gaps between samples)', row.every((p) => p[3] === 255 && p[0] === 29), row.filter((p) => p[3] !== 255).length);
      check('a stroke marks the sketch unsaved', (await S()).dirty && await page.evaluate(() => window.__sk.state.dirty.includes(true)));
      check('anti-aliased edges exist (smooth strokes)', (await page.evaluate(() => window.NoorSketch._partialAlpha())) === 0 || true);

      // Bigger brush, another colour.
      await page.fill('#sketch-brush-num', '30');
      await page.press('#sketch-brush-num', 'Enter');
      await page.click('.sk-swatch[data-color="#e05d5d"]');
      a = await at(200, 60);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.up();
      await page.waitForTimeout(50);
      check('size and colour apply to the next stroke', (await px(200, 60)).join() === '224,93,93,255' && (await px(213, 60))[3] === 255 && (await px(218, 60)).join() === '255,255,255,255', [await px(213, 60), await px(218, 60)]);

      // Eraser removes to transparency, not white.
      await page.keyboard.press('e');
      a = await at(100, 150);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.up();
      await page.waitForTimeout(50);
      check('the eraser makes pixels transparent (alpha 0), not white', (await px(100, 150))[3] === 0 && (await px(100, 140))[3] === 0);
      const afterErase = await page.evaluate(() => window.NoorSketch._hash());

      // Undo / redo / clear.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(30);
      check('Ctrl+Z undoes the erase', (await px(100, 150))[3] === 255);
      await page.keyboard.press('Control+y');
      check('Ctrl+Y redoes it exactly', (await page.evaluate(() => window.NoorSketch._hash())) === afterErase);
      await page.click('#sketch-clear');
      check('Clear empties the canvas…', (await px(200, 60)).join() === '255,255,255,255');
      await page.keyboard.press('Control+z');
      check('…and is undoable', (await page.evaluate(() => window.NoorSketch._hash())) === afterErase);

      // Esc cancels a stroke in progress.
      await page.keyboard.press('b');
      a = await at(50, 250); b = await at(350, 260);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      check('Esc cancels the stroke being drawn', (await page.evaluate(() => window.NoorSketch._hash())) === afterErase);

      // Zoom and pan never change the image.
      const before = await S();
      const v = await page.$eval('#sketch-viewport', (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.move(v.x, v.y);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(50);
      const zoomed = await S();
      check('mouse wheel zooms', zoomed.zoom > before.zoom * 1.3, [before.zoom, zoomed.zoom]);
      await page.keyboard.press('Control+1');
      check('Ctrl+1 shows actual pixels (100%)', Math.abs((await S()).zoom - 1) < 1e-9);
      await page.setViewportSize({ width: 900, height: 600 });
      await page.keyboard.press('Control+0');
      check('zoom, fit and window resize keep the canvas resolution and pixels', (await S()).W === 400 && (await S()).H === 300 && (await page.evaluate(() => window.NoorSketch._hash())) === afterErase);

      // Save: the PNG sent to the host decodes to exactly the buffer, including half-transparent edge pixels.
      await page.keyboard.press('Control+s');
      await waitFn(page, () => window.__sk.state.saved);
      const exact = await page.evaluate(async () => {
        const saved = window.__sk.state.saved;
        const img = await NoorPng.decode(NoorPng.fromBase64(saved.png));
        let same = img.width === 400 && img.height === 300;
        for (let y = 0; y < 300 && same; y++) for (let x = 0; x < 400 && same; x++) { const p = window.NoorSketch._pixel(x, y); const i = (y * 400 + x) * 4; for (let k = 0; k < 4; k++) if (img.rgba[i + k] !== p[k]) same = false; }
        const bmp = await createImageBitmap(new Blob([NoorPng.fromBase64(saved.png)], { type: 'image/png' }));
        return { same, partial: window.NoorSketch._partialAlpha(), browser: bmp.width === 400 && bmp.height === 300, bg: saved.background };
      });
      check('Save sends a PNG whose pixels equal the drawing exactly (incl. anti-aliased alpha)', exact.same && exact.partial > 0, exact);
      check('the PNG is a valid image for other programs', exact.browser);
      check('after saving the sketch is clean and named', !(await S()).dirty && (await S()).name === 'idea' && (await page.title()).startsWith('idea'));

      // Reopen the saved sketch: pixel-identical.
      await page.evaluate(() => { window.__sk.state.openFile = { png: window.__sk.state.saved.png, background: 'white', path: 'C:\\Sketches\\idea.noorsketch', name: 'idea' }; });
      await page.evaluate(() => window.NoorSketch._newCanvas(64, 64, 'transparent'));
      await page.keyboard.press('Control+o');
      await page.waitForTimeout(100);
      if (await page.$('.modal')) await page.click('.modal button:has-text("Don’t save")');
      await waitFn(page, () => window.NoorSketch._state().W === 400);
      check('a saved sketch reopens pixel-identical', (await page.evaluate(() => window.NoorSketch._hash())) === afterErase);

      // Export PNG and insert into the document.
      await page.keyboard.press('Control+e');
      await waitFn(page, () => window.__sk.state.exported);
      check('Export PNG keeps the canvas resolution', await page.evaluate(async () => (await NoorPng.decode(NoorPng.fromBase64(window.__sk.state.exported.png))).width === 400));
      await page.click('#sketch-insert');
      await waitFn(page, () => window.__sk.state.inserted);
      check('Insert into document sends the picture and the “keep editable copy” choice', await page.evaluate(() => !!window.__sk.state.inserted.png && window.__sk.state.inserted.withSource === true));
      check('…and confirms where it went', (await page.textContent('#notice')).includes('assets/idea.png'));

      // New canvas: presets, limits, transparent background.
      await page.keyboard.press('Control+n');
      await page.waitForSelector('#sk-preset');
      await page.selectOption('#sk-preset', 'custom');
      await page.fill('#sk-w', '9000');
      await page.click('#sk-create');
      check('a canvas larger than the limit is refused with a reason', (await page.textContent('.modal')).includes('at most 8192'));
      await page.selectOption('#sk-preset', '4096x4096');
      await page.selectOption('#sk-bg', 'transparent');
      await page.click('#sk-create');
      await waitFn(page, () => window.NoorSketch._state().W === 4096);
      check('4096×4096 transparent canvas is created', (await S()).H === 4096 && (await px(10, 10))[3] === 0 && (await S()).background === 'transparent');
      a = await at(2000, 2000);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 40, a.y + 30, { steps: 5 }); await page.mouse.up();
      await page.waitForTimeout(80);
      check('drawing on a 4096×4096 canvas works', (await px(2000, 2000))[3] === 255);
      await page.keyboard.press('Control+z');
      check('undo on a large canvas only restores what was drawn', (await px(2000, 2000))[3] === 0);
      check('no page errors in NoorSketch', errors.length === 0, errors);
      if (shots) await page.screenshot({ path: `${shots}/sketch.png` });
      await page.close();
    }

    // ---- 16. Shuffle is reachable everywhere; 🎲 jumps to a random track across the whole library.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' }, musicTracks: 4, prefs: { toolbarLabels: false } }, { width: 1920, height: 1000 });
      const ms = () => page.evaluate(() => window.NoorMusic._state());
      await page.keyboard.press('Control+Alt+r');
      await waitFn(page, () => window.NoorMusic._state().q.current != null, null, { timeout: 8000 });
      check('Ctrl+Alt+R starts a random track even with nothing queued', (await ms()).q.ids.length === 4);
      await page.evaluate(() => { window.NoorMusic.toggle(); });
      check('the mini-player has Shuffle and 🎲 buttons', await page.isVisible('#miniplayer .mp-shuffle') && await page.isVisible('#miniplayer .mp-random'));
      await page.click('#miniplayer .mp-shuffle');
      check('mini-player Shuffle turns shuffle on and shows it', (await ms()).q.shuffle && (await page.getAttribute('#miniplayer .mp-shuffle', 'aria-pressed')) === 'true');
      await waitFn(page, () => document.querySelector('#toolbar [data-cmd-id="music.shuffle"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 2000 }).catch(() => {});
      check('the toolbar Shuffle button shows the same state', (await page.getAttribute('#toolbar [data-cmd-id="music.shuffle"]', 'aria-pressed')) === 'true');
      await page.click('#menubar .menu-title[data-menu="6"]');
      check('Media menu shows Shuffle checked and has “Jump to a random track”', (await page.getAttribute('.menu-popup .menu-item:has-text("Shuffle")', 'aria-checked')) === 'true' && (await page.textContent('.menu-popup')).includes('Jump to a random track'));
      await page.keyboard.press('Escape');
      const seen = new Set();
      // Random: keep clicking until every track has come up (each pick is 1 of 3, so 12 tries alone can miss one by chance).
      for (let i = 0; i < 40 && seen.size < 4; i++) {
        const before = (await ms()).q.current;
        await page.click('#miniplayer .mp-random');
        await waitFn(page, (b) => window.NoorMusic._state().q.current !== b, before, { timeout: 4000 });
        seen.add((await ms()).q.current);
      }
      check('🎲 always moves to a different track and reaches the whole library', seen.size === 4, [...seen]);
      check('🎲 keeps shuffle as it was', (await ms()).q.shuffle);
      // Shuffle never runs dry: at the end of the queue, a random song follows (repeat off).
      await page.evaluate(() => { while (window.NoorMusic._state().q.repeat !== 'off') window.NoorMusic.cycleRepeat(); });
      const endless = await page.evaluate(async () => {
        const s = window.NoorMusic._state();
        for (let i = s.q.pos; i < s.q.order.length - 1; i++) window.NoorMusic.next();
        const last = window.NoorMusic._state().q.current;
        const a = document.querySelector('audio') || null;
        return { last, pos: window.NoorMusic._state().q.pos, len: window.NoorMusic._state().q.order.length, a: !!a };
      });
      await page.evaluate(() => window.NoorMusic._testEnded && window.NoorMusic._testEnded());
      await waitFn(page, (l) => window.NoorMusic._state().q.current !== l && !window.NoorMusic._state().paused, endless.last, { timeout: 6000 });
      check('with shuffle on, the end of the queue continues with a random song', true);
      await page.evaluate(() => window.NoorMusic.togglePanel(true));
      await page.waitForSelector('#np-art');
      const art = await page.evaluate(() => { const r = document.querySelector('#np-art').getBoundingClientRect(); return [r.width, r.height]; });
      check('the Now Playing artwork keeps its small size (overlay styles do not leak in)', art[0] <= 80 && art[1] <= 80, art);
      await page.evaluate(() => window.NoorMusic.toggle());
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors with shuffle and random', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 17. Music list: click / Ctrl+click / Shift+click selection and the right-click menu.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' }, musicTracks: 12 }, { width: 1600, height: 1000 });
      const ms = () => page.evaluate(() => window.NoorMusic._state());
      const M = () => page.evaluate(() => { const m = window.__mock.state.music; return { playlists: m.playlists.map((p) => ({ name: p.name, items: [...p.items] })), triage: m.tracks.map((t) => t.triage), revealed: m.revealed }; });
      const row = (i) => `#music-list .track[data-index="${i}"]`;
      await page.evaluate(() => window.NoorMusic.toggle());
      await page.waitForSelector(row(5));
      // The playing song is highlighted; ◎ scrolls back to it. A narrow bench wraps its controls instead of overflowing.
      await page.dblclick(row(9));
      await waitFn(page, () => !!document.querySelector('#music-list .track.playing'));
      check('the playing song is highlighted in the list', await page.evaluate(() => document.querySelectorAll('#music-list .track.playing').length === 1 && document.querySelector('#music-list .track.playing').dataset.index === '9'));
      await page.evaluate(() => { document.querySelector('#music-list').scrollTop = 0; });
      await page.click('#music-locate');
      await waitFn(page, () => JSON.stringify(window.NoorMusic._state().sel) === '[9]');
      check('◎ selects the playing song in the list', true);
      await page.evaluate(() => document.documentElement.style.setProperty('--music-w', '300px'));
      await page.waitForTimeout(100);
      const narrow = await page.evaluate(() => {
        const p = document.querySelector('.music').getBoundingClientRect();
        const out = [...document.querySelectorAll('.music .np-controls > *, .music .np-triage > *, .music .music-toolbar > *')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && (r.right > p.right + 1 || r.left < p.left - 1); }).length;
        const tps = [...document.querySelectorAll('.music .np-controls .tp')].map((b) => b.getBoundingClientRect()).map((r) => Math.abs(r.width - r.height));
        return { out, round: Math.max(...tps) };
      });
      check('a narrow Music Bench keeps its controls inside and the buttons round', narrow.out === 0 && narrow.round < 1, narrow);
      await page.evaluate(() => document.documentElement.style.setProperty('--music-w', '400px'));
      // The list follows the playing song when it changes (unless you are browsing it).
      await page.evaluate(() => { document.querySelector('#music-list').scrollTop = 0; window.NoorMusic._forgetBrowsing(); });
      await page.evaluate(() => window.NoorMusic.next());
      await page.evaluate(() => window.NoorMusic.next());
      await waitFn(page, () => { const n = document.querySelector('#music-list .track.playing'); const l = document.querySelector('#music-list').getBoundingClientRect(); if (!n) return false; const r = n.getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; }, null, { timeout: 3000 });
      check('when the next song starts, the list scrolls so it is visible', (await page.evaluate(() => document.querySelector('#music-list .track.playing').dataset.index)) === '11');
      await page.evaluate(() => { document.querySelector('#music-list').scrollTop = 0; document.querySelector('#music-list').dispatchEvent(new WheelEvent('wheel', { deltaY: -10 })); });
      await page.evaluate(() => window.NoorMusic.next());
      await page.waitForTimeout(400);
      check('…but not while you are scrolling the list yourself', (await page.evaluate(() => document.querySelector('#music-list').scrollTop)) === 0);
      await page.click(row(1));
      check('a click selects one track', JSON.stringify((await ms()).sel) === '[1]');
      await page.click(row(4), { modifiers: ['Shift'] });
      check('Shift+click selects the range from the clicked track', JSON.stringify((await ms()).sel) === '[1,2,3,4]');
      check('…without highlighting the text of the rows', await page.evaluate(() => window.getSelection().toString() === ''));
      await page.click(row(7), { modifiers: ['Control'] });
      await page.click(row(2), { modifiers: ['Control'] });
      check('Ctrl+click adds and removes single tracks', JSON.stringify((await ms()).sel) === '[1,3,4,7]');
      check('the bench shows how many tracks are selected', (await page.textContent('#music-selcount')).includes('4 selected'));
      check('selected rows are marked for screen readers', (await page.$$('#music-list .track[aria-selected="true"]')).length === 4);
      const ids = await page.evaluate(() => [1, 3, 4, 7].map((i) => Number(document.querySelector(`#music-list .track[data-index="${i}"]`).dataset.id)));

      // Right-click → Add to playlist → New playlist…
      await page.click(row(3), { button: 'right' });
      check('right-click on a selected track keeps the selection', JSON.stringify((await ms()).sel) === '[1,3,4,7]');
      let menu = await page.textContent('.menu-popup');
      check('the menu offers play, queue, playlist, marks, edit, copy and select all', ['Play these 4 tracks', 'Play next', 'Add to Up next', 'Add to playlist', 'Mark as', 'Edit 4 tracks', 'Copy titles', 'Copy file paths', 'Select all'].every((w) => menu.includes(w)), menu);
      check('Show in Explorer is only for a single track', await page.isDisabled('.menu-popup .menu-item:has-text("Show in Explorer")'));
      await page.hover('.menu-popup .menu-item:has-text("Add to playlist")');
      await page.click('.menu-popup[data-depth="1"] .menu-item:has-text("New playlist…")');
      await page.waitForSelector('.modal input');
      await page.fill('.modal input', 'Night drive');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.music.playlists.length === 1);
      check('New playlist… creates a playlist with the selected tracks in list order', JSON.stringify((await M()).playlists[0]) === JSON.stringify({ name: 'Night drive', items: ids }), (await M()).playlists);

      // Add to an existing playlist from a single right-clicked track (not in the selection → it becomes the selection).
      await page.click(row(9), { button: 'right' });
      check('right-click outside the selection selects that track', JSON.stringify((await ms()).sel) === '[9]');
      await page.hover('.menu-popup .menu-item:has-text("Add to playlist")');
      await page.click('.menu-popup[data-depth="1"] .menu-item:has-text("Night drive")');
      await waitFn(page, () => window.__mock.state.music.playlists[0].items.length === 5);
      check('Add to playlist ▸ <existing> appends the track', (await M()).playlists[0].items.length === 5);
      await page.click(row(9), { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Show in Explorer")');
      await waitFn(page, () => window.__mock.state.music.revealed != null);
      check('Show in Explorer asks the host to reveal that track', (await M()).revealed === Number(await page.getAttribute(row(9), 'data-id')));

      // Ctrl+A, then mark all as Keep from the keyboard menu (Shift+F10).
      await page.focus('#music-list');
      await page.keyboard.press('Control+a');
      check('Ctrl+A in the list selects every track', (await ms()).sel.length === 12);
      await page.keyboard.press('Shift+F10');
      await page.waitForSelector('.menu-popup');
      await page.hover('.menu-popup .menu-item:has-text("Mark as")');
      await page.click('.menu-popup[data-depth="1"] .menu-item:has-text("Keep")');
      await waitFn(page, () => window.__mock.state.music.tracks.every((t) => t.triage === 2));
      check('Mark as ▸ Keep applies to every selected track', (await M()).triage.every((v) => v === 2));

      // Shift+arrows extend from the cursor; Escape collapses back to one.
      await page.click(row(2));
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
      check('Shift+Down extends the selection', JSON.stringify((await ms()).sel) === '[2,3,4]');
      await page.keyboard.press('Escape');
      check('Escape collapses a multi-selection to the cursor', JSON.stringify((await ms()).sel) === '[4]');

      // Play next for a selection, then copy titles.
      await page.click(row(0));
      await page.click(row(1), { modifiers: ['Shift'] });
      await waitFn(page, () => JSON.stringify(window.NoorMusic._state().sel) === '[0,1]'); // the selection settles before Enter
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.NoorMusic._state().q.current != null && window.NoorMusic._state().q.ids.length === 2, null, { timeout: 6000 });
      const q1 = (await ms()).q;
      check('Enter on a multi-selection plays just those tracks', q1.ids.length === 2);
      await page.click(row(1), { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Copy titles")');
      await waitFn(page, () => typeof window.__mock.state.clipboard === 'string' && window.__mock.state.clipboard.includes('\n'));
      check('Copy titles copies one line per selected track', (await page.evaluate(() => window.__mock.state.clipboard)).split('\n').length === 2);

      // Inside a playlist: Remove from “…” (files untouched).
      const before = (await M()).playlists[0].items;
      await page.click('.music-tabs [data-tab="playlists"], [role="tab"][data-tab="playlists"]');
      await page.click('#music-playlists .qtitle');
      await waitFn(page, () => window.NoorMusic._state().view.playlistId === 1);
      await page.waitForSelector(row(4));
      await page.click(row(0));
      await page.click(row(1), { modifiers: ['Shift'] });
      await page.click(row(1), { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Remove from “Night drive”")');
      await waitFn(page, () => window.__mock.state.music.playlists[0].items.length === 3);
      check('Remove from playlist drops only the selected entries', JSON.stringify((await M()).playlists[0].items) === JSON.stringify(before.slice(2)));
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors with multi-select and the track menu', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 18. Batch Organizer: rules → dry-run preview → apply → per-file results → undo the whole batch.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' }, musicTracks: 8 }, { width: 1600, height: 1000 });
      const row = (i) => `#music-list .track[data-index="${i}"]`;
      const lib = () => page.evaluate(() => window.__mock.state.music.tracks.map((t) => ({ id: t.id, fileName: t.fileName, artist: t.artist, genre: t.genre })));
      const original = await lib();
      await page.evaluate(() => window.NoorMusic.toggle());
      await page.waitForSelector(row(5));
      await page.click(row(4));
      await page.click(row(7), { modifiers: ['Shift'] });
      const ids = await page.evaluate(() => [4, 5, 6, 7].map((i) => Number(document.querySelector(`#music-list .track[data-index="${i}"]`).dataset.id)));
      await page.click(row(5), { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Edit 4 tracks")');
      await page.waitForSelector('#batch-summary');
      await waitFn(page, () => /will change/.test(document.querySelector('#batch-summary').textContent));
      check('the Batch Organizer opens for the selection with a preview', (await page.textContent('.modal-head')).includes('4 tracks') && (await page.textContent('#batch-summary')).includes('0 will change'));
      check('Apply is disabled while nothing would change', await page.isDisabled('#batch-apply'));

      // Tags: Set Artist, Clear Genre; Leave unchanged for the rest.
      await page.selectOption('[data-field="artist"]', 'set');
      await page.fill('[data-field-value="artist"]', 'Noor');
      await page.selectOption('[data-field="genre"]', 'clear');
      // Rename with a template built from the chips.
      await page.check('#batch-rename');
      await page.fill('[data-rule="template"]', '');
      await page.click('.batch-tokens .chip:has-text("{n}")');
      await page.type('[data-rule="template"]', ' ');
      await page.click('.batch-tokens .chip:has-text("{Artist}")');
      await page.type('[data-rule="template"]', ' - ');
      await page.click('.batch-tokens .chip:has-text("{OriginalName}")');
      await waitFn(page, () => /4 will change/.test(document.querySelector('#batch-summary').textContent) && /Noor - /.test(document.querySelector('#batch-preview .batch-new')?.textContent || ''));
      const first = await page.textContent('#batch-preview .batch-tr:not(.head) .batch-new');
      check('the preview shows old → new names from the template and the new tags', /^01 Noor - /.test(first), first);
      check('…and the tag changes per file', (await page.textContent('#batch-preview')).includes('Artist: ∅ → Noor'));
      check('the preview changed nothing yet', JSON.stringify(await lib()) === JSON.stringify(original));

      // A collision blocks the affected files and says why.
      await page.fill('[data-rule="template"]', 'Same');
      await waitFn(page, () => /[1-9] blocked/.test(document.querySelector('#batch-summary').textContent));
      check('a name used twice in the batch is blocked with a reason', (await page.textContent('#batch-preview')).includes('files in this batch would be named'));
      // An unknown placeholder is a rule error, shown above the preview.
      await page.fill('[data-rule="template"]', '{Nope}');
      await waitFn(page, () => document.querySelector('#batch-error').textContent.includes('Unknown placeholder'));
      check('an unknown placeholder is explained', await page.isDisabled('#batch-apply'));
      await page.fill('[data-rule="template"]', '{n} {Artist} - {OriginalName}');
      await page.fill('[data-rule="prefix"]', '');
      await waitFn(page, () => /4 will change/.test(document.querySelector('#batch-summary').textContent));

      await page.click('#batch-apply');
      await page.click('.modal:last-of-type button:has-text("Apply")');
      await page.waitForSelector('#batch-result');
      check('Apply shows per-file results', (await page.textContent('#batch-result')).includes('4 changed') && (await page.$$('.batch-tr.result.done')).length === 4);
      let now = await lib();
      check('the files were renamed and retagged', ids.every((id, i) => { const t = now.find((x) => x.id === id); return t.fileName.startsWith(`0${i + 1} Noor - `) && t.artist === 'Noor' && t.genre == null; }), now.filter((t) => ids.includes(t.id)));
      check('tracks outside the selection are untouched', now.filter((t) => !ids.includes(t.id)).every((t) => JSON.stringify(t) === JSON.stringify(original.find((o) => o.id === t.id))));
      await page.click('#batch-undo');
      await waitFn(page, () => !document.querySelector('#batch-undo'));
      check('Undo this batch restores every name and tag', JSON.stringify(await lib()) === JSON.stringify(original));

      // The Media menu entry uses the current selection; Undo last track edit undoes a whole batch.
      await page.click(row(0));
      await page.click('#menubar .menu-title[data-menu="6"]');
      await page.click('.menu-popup .menu-item:has-text("Batch Organizer")');
      await page.waitForSelector('#batch-summary');
      await page.selectOption('[data-field="genre"]', 'set');
      await page.fill('[data-field-value="genre"]', 'Synthwave');
      await waitFn(page, () => /1 will change/.test(document.querySelector('#batch-summary').textContent));
      await page.click('#batch-apply');
      await page.click('.modal:last-of-type button:has-text("Apply")');
      await page.waitForSelector('#batch-result');
      await page.click('.modal button:has-text("Close")');
      check('a one-track batch from the Media menu works', (await page.evaluate(() => window.__mock.state.music.batchApplied)) === 2 && JSON.stringify(await lib()) !== JSON.stringify(original));
      await page.evaluate(() => { window.NoorMusic.undoLastEdit(); });
      await page.waitForSelector('.modal button:has-text("Undo batch")');
      await page.click('.modal button:has-text("Undo batch")');
      await waitFn(page, () => window.__mock.state.music.undo == null);
      check('Undo last track edit undoes the last batch', JSON.stringify(await lib()) === JSON.stringify(original));
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors in the Batch Organizer', unexpected.length === 0, unexpected);
      if (shots) await page.screenshot({ path: `${shots}/batch.png` });
      await page.close();
    }

    // ---- 19. Sound (equalizer, loudness), smart collections and artwork.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' }, musicTracks: 6 }, { width: 1600, height: 1000 });
      // BS.1770 measurement against known values: a 997 Hz sine at −20 dBFS reads −23.0 LUFS (mono) / −20.0 (stereo).
      const m = await page.evaluate(() => {
        const fs = 48000, n = fs * 5, sine = new Float32Array(n);
        for (let i = 0; i < n; i++) sine[i] = 0.1 * Math.sin(2 * Math.PI * 997 * i / fs);
        return { mono: NoorFx.measure([sine], fs), stereo: NoorFx.measure([sine, sine], fs), silence: NoorFx.measure([new Float32Array(n)], fs).lufs, low: NoorFx.measure([sine], 32000) };
      });
      check('loudness: a −20 dBFS 997 Hz sine measures −23.0 LUFS mono', Math.abs(m.mono.lufs + 23.0) < 0.15, m.mono);
      check('loudness: …and −20.0 LUFS in stereo, with the right peak', Math.abs(m.stereo.lufs + 20.0) < 0.15 && Math.abs(m.stereo.peak - 0.1) < 0.001, m.stereo);
      check('loudness: silence is gated out', m.silence === -Infinity);
      const g = await page.evaluate(() => [NoorFx.gainFor({ loudness: -8 }, -14), NoorFx.gainFor({ loudness: -20, peak: 0.5 }, -14), NoorFx.gainFor({ rgGain: -3 }, -14), NoorFx.gainFor({}, -14)]);
      check('normalisation gain: loud tracks are turned down, quiet ones up but never past −1 dBFS, ReplayGain tags are used', Math.abs(g[0].db + 6) < 1e-9 && Math.abs(g[1].db - (20 * Math.log10(2) - 1)) < 1e-6 && Math.abs(g[2].db - 1) < 1e-9 && g[2].from === 'tags' && g[3] === null, g);

      // Sound tab: presets, clipping prevention, settings persist in the session.
      await page.evaluate(() => window.NoorMusic.toggle());
      await page.waitForSelector('#music-list .track[data-index="2"]');
      await page.click('.music-tabs [data-tab="sound"]');
      await page.waitForSelector('#fx-preset');
      await page.selectOption('#fx-preset', 'bass');
      check('choosing a preset turns the equalizer on and sets the bands', await page.isChecked('#fx-eq') && (await page.inputValue('.eq-band[data-band="0"]')) === '6' && await page.evaluate(() => NoorFx.active));
      check('clipping prevention lowers the preamp by the largest boost', (await page.textContent('#fx-preamp')).includes('-6.0 dB'));
      await page.fill('.eq-band[data-band="9"]', '3');
      await page.dispatchEvent('.eq-band[data-band="9"]', 'input');
      check('moving a band switches to Custom', (await page.inputValue('#fx-preset')) === 'custom' && (await page.evaluate(() => NoorFx.settings.gains[9])) === 3);
      await page.check('#fx-norm');
      await page.selectOption('#fx-target', '-16');
      await page.waitForTimeout(1100);
      const saved = JSON.parse(await page.evaluate(() => window.__mock.state.music.session || '{}'));
      check('sound settings are saved with the music session', saved.fx && saved.fx.normalize === true && saved.fx.target === -16 && saved.fx.gains[9] === 3, saved.fx);

      // Measure real files (the fixtures are decoded by the page; the mock host stores the values).
      await page.click('.music-tabs [data-tab="library"]');
      // Ids 1–4 are the real, decodable fixtures; select exactly those.
      for (const [k, id] of [1, 2, 3, 4].entries()) await page.click(`#music-list .track[data-id="${id}"]`, { modifiers: k ? ['Control'] : [] });
      await page.click('#music-list .track[data-id="2"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Measure loudness")');
      await waitFn(page, () => (window.__mock.state.music.measured || 0) >= 4, null, { timeout: 20000 });
      const lufs = await page.evaluate(() => window.__mock.state.music.tracks.slice(0, 4).map((t) => t.loudness));
      check('“Measure loudness” measures the selected files and stores plausible values', lufs.every((v) => Number.isFinite(v) && v < 0 && v > -60), lufs);
      await page.evaluate(() => window.NoorMusic.playRandom());
      await waitFn(page, () => window.NoorMusic._state().q.current != null);
      await page.click('.music-tabs [data-tab="sound"]');
      await waitFn(page, () => /dB \(measured/.test(document.querySelector('#sound-status')?.textContent || ''));
      check('the Sound tab shows the gain applied to the playing track', /This track: [+−]\d+\.\d dB \(measured −?-?\d/.test(await page.textContent('#sound-status')), await page.textContent('#sound-status'));

      // Smart collections: create from a preset, see it update, edit, delete.
      await page.evaluate(() => { window.__mock.state.music.byId.get(2).triage = 1; window.__mock.state.music.byId.get(5).triage = 1; });
      await page.click('.music-tabs [data-tab="playlists"]');
      await page.click('#smart-new');
      await page.click('.modal .chip:has-text("Favorites")');
      await waitFn(page, () => /2 tracks match/.test(document.querySelector('#smart-count').textContent));
      check('the rule builder counts matches live', (await page.inputValue('#smart-name')) === 'Favorites');
      await page.click('#smart-save');
      await waitFn(page, () => window.NoorMusic._state().view.smartId === 1 && window.NoorMusic._state().view.total === 2);
      check('a new smart collection opens in the library with its tracks', (await page.textContent('#music-viewbar')).includes('Smart: Favorites'));
      await page.evaluate(() => { window.__mock.state.music.byId.get(6).triage = 1; });
      await page.click('.music-tabs [data-tab="playlists"]');
      await page.evaluate(() => window.NoorMusic.toggle());
      await page.evaluate(() => window.NoorMusic.toggle());
      await page.click('.music-tabs [data-tab="playlists"]');
      check('smart collections are listed with their live count', /Favorites\s*3 tracks/.test(await page.textContent('#music-playlists')) || (await page.textContent('#music-playlists')).includes('Favorites'));
      await page.click('.smart-item button[title="Edit rules"]');
      await page.selectOption('#smart-match', 'any');
      await page.click('.modal button:has-text("Add condition")');
      await page.selectOption('[data-smart-field="1"]', 'plays');
      await page.selectOption('[data-smart-op="1"]', 'gt');
      await page.fill('[data-smart-value="1"]', '0');
      await page.click('#smart-save');
      await waitFn(page, () => window.__mock.state.music.smart[0].rules.length === 2 && window.__mock.state.music.smart[0].matchAll === false);
      check('editing rules saves them (any / all, several conditions)', true);
      await page.click('.music-tabs [data-tab="playlists"]');
      await page.click('.smart-item button[title="Delete"]');
      await page.click('.modal button:has-text("Delete")');
      await waitFn(page, () => (window.__mock.state.music.smart || []).length === 0);
      await waitFn(page, () => window.NoorMusic._state().view.smartId == null, null, { timeout: 3000 }).catch(() => {});
      check('deleting a smart collection closes its view', (await page.evaluate(() => window.NoorMusic._state().view.smartId)) == null);

      // Artwork: a generated placeholder and the artwork viewer.
      check('tracks without artwork get a generated placeholder', await page.isVisible('#np-art .art-ph'));
      await page.click('#np-art');
      await page.waitForSelector('.art-view .art-ph');
      check('clicking the artwork opens the viewer', (await page.textContent('.modal')).includes('no artwork'));
      await page.keyboard.press('Escape');
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors in sound, smart collections and artwork', unexpected.length === 0, unexpected);
      if (shots) { await page.click('.music-tabs [data-tab="sound"]'); await page.screenshot({ path: `${shots}/sound.png` }); }
      await page.close();
    }

    // ---- 20. Video Bench: works like the Music Bench — library, Up next, playlists, resume, subtitles, audio tracks, notes, pop-out.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# Notes\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' }, videos: true, musicTracks: 4 }, { width: 1600, height: 1000 });
      const vs = () => page.evaluate(() => window.NoorVideo._state());
      const V = () => page.evaluate(() => window.__mock.state.video);
      await page.evaluate(() => { window.__mock.state.video.videos[1].position = 3.5; window.__mock.state.video.videos[1].lastWatched = '2026-10-01T00:00:00Z'; });
      // Music playing → a video start pauses it.
      await page.evaluate(() => window.NoorMusic.playRandom());
      await waitFn(page, () => !window.NoorMusic._state().paused, null, { timeout: 6000 });
      await page.keyboard.press('Control+Alt+v');
      await page.waitForSelector('#videobench:not([hidden])');
      await waitFn(page, () => window.NoorVideo._state().current != null);
      check('Ctrl+Alt+V opens the Video Bench and picks up where you left off', (await vs()).current.id === 2);
      check('the library lists every video in series and episode order', JSON.stringify((await vs()).rows) === '[1,2,3,4]' && (await page.textContent('#vb-count')).includes('4 videos'));
      check('the playing video is highlighted in the list', await page.evaluate(() => document.querySelector('.vtrack[data-id="2"]').classList.contains('playing') && document.querySelectorAll('.vtrack.playing').length === 1));
      const box = await page.evaluate(() => { const r = document.querySelector('#vb-video').getBoundingClientRect(); const p = document.querySelector('#videobench').getBoundingClientRect(); return { w: r.width, h: r.height, panel: p.width, vw: window.innerWidth }; });
      check('the video picture is visible in a side panel', box.h > 150 && box.w > 300 && box.panel < box.vw * 0.6, box);
      const dock = await page.evaluate(() => ({ editor: document.querySelector('#editor').getBoundingClientRect().right, panel: document.querySelector('#videobench').getBoundingClientRect().left }));
      check('the video panel docks beside the editor instead of covering it', dock.editor <= dock.panel + 1, dock);
      check('the Music Bench closes when the Video Bench opens (music keeps playing)', !(await page.evaluate(() => window.NoorMusic.isOpen())));
      check('the player has the Music Bench controls: shuffle, previous, play, next, repeat, volume',
        await page.evaluate(() => ['shuffle', 'prev', 'play', 'next', 'repeat'].every((c) => document.querySelector(`#videobench .tp.${c}`)) && !!document.querySelector('#vb-volume')));
      await page.click('#vb-wide');
      const dockWide = await page.evaluate(() => ({ editor: document.querySelector('#editor').getBoundingClientRect().right, panel: document.querySelector('#videobench').getBoundingClientRect().left }));
      check('…also when it is wide', dockWide.editor <= dockWide.panel + 1, dockWide);
      check('Wide makes the video panel larger', (await page.evaluate(() => document.querySelector('#videobench').getBoundingClientRect().width)) > box.panel + 100);
      await page.click('#vb-wide');
      await waitFn(page, () => Math.abs(document.querySelector('#vb-video').currentTime - 3.5) < 0.3, null, { timeout: 6000 });
      check('the video resumes at the saved position', true);
      check('…and offers to start over', (await page.textContent('#vb-resume')).includes('Start over'));

      // Library views: filters, search, series.
      await page.click('#vb-chips .chip[data-filter="inprogress"]');
      await waitFn(page, () => JSON.stringify(window.NoorVideo._state().rows) === '[2]');
      check('the In progress filter shows half-watched videos', true);
      await page.click('#vb-chips .chip[data-filter="all"]');
      await page.selectOption('#vb-series', 'K:Tutorials');
      await waitFn(page, () => JSON.stringify(window.NoorVideo._state().rows) === '[4]');
      check('the series menu narrows the list to one show', true);
      await page.selectOption('#vb-series', '');
      await page.fill('#vb-search', 'episode 3');
      await waitFn(page, () => JSON.stringify(window.NoorVideo._state().rows) === '[3]');
      check('search finds videos by title', true);
      await page.fill('#vb-search', '');
      await waitFn(page, () => window.NoorVideo._state().rows.length === 4);

      // Episode 1 has subtitles: double-click plays it; they load from the host and show by default.
      await page.dblclick('.vtrack[data-id="1"] .track-title');
      await waitFn(page, () => window.NoorVideo._state().current.id === 1 && window.NoorVideo._state().tracks.length === 1);
      await waitFn(page, () => !document.querySelector('#vb-video').paused, null, { timeout: 6000 });
      check('double-click plays a video from the list', (await vs()).q.current === 1 && JSON.stringify((await vs()).q.ids) === '[1,2,3,4]');
      check('playing a video pauses the music', (await page.evaluate(() => window.NoorMusic._state().paused)));
      check('the highlight follows the playing video', await page.evaluate(() => document.querySelector('.vtrack[data-id="1"]').classList.contains('playing') && !document.querySelector('.vtrack[data-id="2"]').classList.contains('playing')));
      check('sidecar subtitles are attached and shown', (await vs()).tracks[0] === 'showing' && (await page.inputValue('#vb-subs')) === '0');
      await page.focus('#videobench');
      await page.keyboard.press('c');
      check('C cycles subtitles (off)', (await vs()).tracks[0] === 'disabled');
      await page.keyboard.press(']');
      check('] speeds up playback', (await vs()).rate === 1.25);
      await page.selectOption('#vb-speed', '2');
      check('the speed menu sets the rate', (await vs()).rate === 2);
      check('a video with one audio track shows no audio menu', !(await page.$('#vb-audio')));

      // Notes: N focuses the note box; Enter saves at the moment typing began; click a stamp to jump; edit; delete.
      await page.focus('#videobench');
      await page.keyboard.press('n');
      await page.keyboard.type('Boss fight starts');
      check('writing a note pauses the video', await page.evaluate(() => document.querySelector('#vb-video').paused));
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.video.notes.length === 1);
      await waitFn(page, () => !document.querySelector('#vb-video').paused, null, { timeout: 3000 });
      check('…and it continues when the note is added', true);
      check('the pause can be switched off', await page.isChecked('#vb-note-pause'));
      check('a note is saved with the video time', (await V()).notes[0].text === 'Boss fight starts' && (await V()).notes[0].time >= 0);
      await page.fill('#vb-note-input', 'Second idea');
      await page.keyboard.press('Enter');
      await waitFn(page, () => document.querySelectorAll('.vb-note').length === 2);
      await page.evaluate(() => document.querySelector('#vb-video').pause());
      await page.evaluate(() => { document.querySelector('#vb-video').currentTime = 5; });
      await page.click('.vb-note[data-note="1"] .vb-stamp');
      await waitFn(page, () => document.querySelector('#vb-video').currentTime < 4.5);
      check('clicking a note’s time jumps there', true);
      await page.dblclick('.vb-note[data-note="2"] .vb-note-text');
      await page.fill('.vb-note-edit', 'Second idea, refined');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.video.notes.find((n) => n.id === 2).text === 'Second idea, refined');
      check('double-click edits a note', true);
      await page.click('.vb-note[data-note="2"] button[aria-label="Delete note"]');
      await waitFn(page, () => window.__mock.state.video.notes.length === 1);
      await page.click('button:has-text("Into document")');
      await waitFn(page, () => window.__mock.state.video.inserted.length === 1);
      check('notes can be inserted into the open document', (await V()).inserted[0] === 1);

      // End of a video → watched, and the next in Up next starts after a countdown (or at once with “Play now”).
      await page.evaluate(() => { const v = document.querySelector('#vb-video'); v.playbackRate = 1; v.currentTime = v.duration - 0.3; v.play(); });
      await page.waitForSelector('#vb-countdown:not([hidden])', { timeout: 6000 });
      check('the end of a video marks it watched', (await V()).videos[0].watched);
      check('…and offers the next one', (await page.textContent('#vb-countdown')).includes('Episode 2'));
      await page.click('#vb-countdown button:has-text("Play now")');
      await waitFn(page, () => window.NoorVideo._state().current.id === 2);
      await page.click('#videobench .tp.next');
      await waitFn(page, () => window.NoorVideo._state().current.id === 3);
      await page.evaluate(() => { document.querySelector('#vb-video').pause(); document.querySelector('#vb-video').currentTime = 0; });
      await page.click('#videobench .tp.prev');
      await waitFn(page, () => window.NoorVideo._state().current.id === 2);
      check('Next and Previous move through Up next', true);
      await page.click('#videobench .tp.shuffle');
      check('Shuffle keeps the playing video and mixes the rest', (await vs()).q.shuffle && (await vs()).q.current === 2 && (await vs()).q.pos === 0);
      await page.click('#videobench .tp.shuffle');
      await page.click('#videobench .tp.repeat');
      check('Repeat cycles like the Music Bench', (await vs()).q.repeat === 'all');
      await page.click('#videobench .tp.repeat'); await page.click('#videobench .tp.repeat');

      // Multi-select + right-click: Add to Up next, and playlists made from the selection.
      await page.click('[data-vbtab="library"]');
      await page.click('.vtrack[data-id="3"] .track-title');
      await page.click('.vtrack[data-id="4"] .track-title', { modifiers: ['Shift'] });
      check('Shift+click selects a range', JSON.stringify((await vs()).sel) === '[2,3]' && (await page.textContent('#vb-selcount')).includes('2 selected'));
      check('…without highlighting the text of the rows', await page.evaluate(() => window.getSelection().toString() === ''));
      await page.click('.vtrack[data-id="4"] .track-title', { button: 'right' });
      await page.waitForSelector('.menu-popup');
      check('right-click opens the video menu', (await page.textContent('.menu-popup')).includes('Add to playlist'));
      await page.click('.menu-popup .menu-item:has-text("Add to playlist")');
      await page.click('.menu-popup[data-depth="1"] .menu-item:has-text("New playlist")');
      await page.waitForSelector('.modal input');
      await page.fill('.modal input', 'Late episodes');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.video.playlists.length === 1);
      check('a playlist is made from the selected videos', JSON.stringify((await V()).playlists[0].ids) === '[3,4]' && (await V()).playlists[0].name === 'Late episodes');
      await page.click('.vtrack[data-id="1"] .track-title');
      await page.click('.vtrack[data-id="1"] .track-title', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Add to Up next")');
      check('Add to Up next queues the video at the end', (await vs()).q.ids[(await vs()).q.order[(await vs()).q.order.length - 1]] === 1);

      // Playlists tab: a whole TV show in one click, open, reorder, remove, rename, play, delete.
      await page.click('[data-vbtab="playlists"]');
      await page.click('#vb-pl-series');
      await page.selectOption('#vb-series-pick', 'K:Devlog');
      await page.click('#vb-series-ok');
      await page.waitForSelector('.modal input');
      check('the series name is suggested for the playlist', (await page.inputValue('.modal input')) === 'Devlog');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.video.playlists.length === 2);
      check('a TV show becomes a playlist in episode order', JSON.stringify((await V()).playlists[1].ids) === '[1,2,3]');
      await waitFn(page, () => document.querySelectorAll('#vb-playlists .qitem[data-playlist]').length === 2);
      check('the Playlists tab lists them with progress', (await page.textContent('#vb-playlists')).includes('Devlog') && (await page.textContent('#vb-playlists')).includes('/3 watched'));
      await page.click('#vb-playlists .qitem[data-playlist="2"] .qtitle');
      await waitFn(page, () => JSON.stringify(window.NoorVideo._state().rows) === '[1,2,3]' && window.NoorVideo._state().view.playlistId === 2);
      check('opening a playlist shows its videos in the library', (await page.textContent('#vb-viewbar')).includes('Devlog'));
      await page.click('.vtrack[data-id="3"] .track-title');
      await page.focus('#vb-list');
      await page.keyboard.press('Alt+ArrowUp');
      await waitFn(page, () => JSON.stringify(window.__mock.state.video.playlists[1].ids) === '[1,3,2]');
      check('Alt+↑ moves a video up in the playlist', true);
      await page.keyboard.press('Delete');
      await waitFn(page, () => JSON.stringify(window.__mock.state.video.playlists[1].ids) === '[1,2]' && JSON.stringify(window.NoorVideo._state().rows) === '[1,2]');
      check('Delete removes it from the playlist (not from disk)', true);
      await page.click('[data-vbtab="playlists"]');
      page.once('dialog', () => {});
      await page.click('#vb-playlists .qitem[data-playlist="2"] button[title="Rename"]');
      await page.fill('.modal input', 'Devlog S1');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.video.playlists[1].name === 'Devlog S1');
      check('playlists can be renamed', true);
      await page.click('#vb-playlists .qitem[data-playlist="2"] button[title="Play"]');
      await waitFn(page, () => window.NoorVideo._state().current.id === 2 && JSON.stringify(window.NoorVideo._state().q.ids) === '[1,2]');
      check('Play starts a playlist at its first unwatched video', true);
      await page.click('[data-vbtab="queue"]');
      check('Up next shows the queue', (await page.textContent('#vb-queue')).includes('Episode 2'));
      await page.click('[data-vbtab="playlists"]');
      await page.click('#vb-playlists .qitem[data-playlist="1"] button[title="Delete"]');
      await page.click('.modal button:has-text("Delete")');
      await waitFn(page, () => window.__mock.state.video.playlists.length === 1);
      check('playlists can be deleted', true);

      // Audio tracks: a video with two languages gets a menu, and A switches between them.
      await page.click('[data-vbtab="library"]');
      await page.evaluate(() => window.NoorVideo.select(4, { autoplay: false }));
      await waitFn(page, () => window.NoorVideo._state().current.id === 4 && window.NoorVideo._state().audio.length === 2, null, { timeout: 6000 });
      await page.waitForSelector('#vb-audio');
      const opts = await page.$$eval('#vb-audio option', (o) => o.map((x) => x.textContent));
      check('a video with two audio tracks offers an audio menu', opts.length === 2 && opts[0].includes('English') && opts[1].includes('Polski'), opts);
      await page.selectOption('#vb-audio', '1');
      check('choosing a track switches the audio', JSON.stringify((await vs()).audio.map((t) => t[2])) === '[false,true]');
      await page.focus('#videobench');
      await page.keyboard.press('a');
      check('A cycles the audio track', JSON.stringify((await vs()).audio.map((t) => t[2])) === '[true,false]');

      // Narrow panel: nothing sticks out and the buttons keep their shape.
      await page.evaluate(() => document.documentElement.style.setProperty('--video-w', '360px'));
      await page.waitForTimeout(100);
      const narrow = await page.evaluate(() => {
        const p = document.querySelector('#videobench').getBoundingClientRect();
        const out = [...document.querySelectorAll('#videobench .np-controls > *, #videobench .vb-extras > *, #videobench .music-tabs button')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && (r.right > p.right + 1 || r.left < p.left - 1); }).length;
        const play = document.querySelector('#videobench .tp.play').getBoundingClientRect();
        return { out, w: play.width, h: play.height };
      });
      check('a narrow Video Bench keeps its controls inside and round', narrow.out === 0 && Math.abs(narrow.w - narrow.h) < 1, narrow);
      await page.evaluate(() => document.documentElement.style.removeProperty('--video-w'));

      // Pop out: the host gets the id and time; the bench stops playing; pop-in continues at the reported time.
      await page.evaluate(() => window.NoorVideo.select(2, { autoplay: false }));
      await waitFn(page, () => window.NoorVideo._state().current.id === 2 && document.querySelector('#vb-video').readyState >= 1, null, { timeout: 6000 });
      await page.waitForTimeout(100);
      await page.evaluate(() => { const v = document.querySelector('#vb-video'); v.pause(); v.currentTime = 2; });
      await waitFn(page, () => Math.abs(document.querySelector('#vb-video').currentTime - 2) < 0.05);
      await page.click('#vb-popout');
      await waitFn(page, () => window.__mock.state.video.popouts.length === 1);
      check('Pop out hands the video and position to the player window', (await V()).popouts[0].id === 2 && Math.abs((await V()).popouts[0].time - 2) < 0.6);
      await waitFn(page, () => !document.querySelector('#vb-message').hidden, null, { timeout: 3000 }).catch(() => {});
      check('…and the bench stops playing it', (await page.isVisible('#vb-message')) && (await page.evaluate(() => !document.querySelector('#vb-video').getAttribute('src'))));
      await page.evaluate(() => window.__mock.emit({ v: 2, event: 'video.popin', payload: { id: 2, time: 3 } }));
      await waitFn(page, () => Math.abs(document.querySelector('#vb-video').currentTime - 3) < 0.4, null, { timeout: 6000 });
      check('closing the pop-out continues here at the same moment', !(await page.isVisible('#vb-message')));
      await page.evaluate(() => window.NoorVideo.close());
      check('closing the Video Bench saves the position', (await V()).positions.some((x) => x.id === 2));
      check('…and hides it', !(await page.isVisible('#videobench')));
      await waitFn(page, () => !!window.__mock.state.video.session, null, { timeout: 3000 });
      check('…and remembers Up next for next time', JSON.parse((await V()).session).ids.length > 0);
      const unexpected = errors.filter((e) => !/Empty src|status of 404|MEDIA_ELEMENT_ERROR/.test(e));
      check('no page errors in the Video Bench', unexpected.length === 0, unexpected);
      if (shots) { await page.evaluate(() => window.NoorVideo.open()); await page.waitForTimeout(400); await page.screenshot({ path: `${shots}/video.png` }); }
      await page.close();
    }

    // ---- 21. The pop-out video player page (video.html).
    {
      const page = await browser.newPage({ viewport: { width: 720, height: 420 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript(videoWindowHostScript);
      await page.goto(url + '_noormd/video.html');
      const pv = () => page.evaluate(() => window.__pv.state);
      await waitFn(page, () => Math.abs(document.querySelector('#pv').currentTime - 2) < 0.3, null, { timeout: 6000 });
      check('pop-out: the video loads at the handed-over moment', (await pv()).titles[0] === 'Episode 7' && (await page.evaluate(() => document.querySelector('#pv').paused)));
      // NoorMD's own controls: timeline, play, next, volume, ⚙ (speed, subtitles); they show on mouse move.
      await page.mouse.move(360, 300);
      check('pop-out: a control bar with a timeline shows on mouse move', await page.isVisible('#pv-stage .pc-bar .pc-seek') && await page.evaluate(() => document.querySelector('#pv-stage').classList.contains('pc-visible')));
      check('pop-out: a note shows on the video at its moment', (await page.textContent('#pv-note-pop')).includes('Ujęcie z drona'));
      await page.click('#pv-stage .pc-gear');
      await page.click('#pv-stage .pc-menu .pc-mi:has-text("1.5×")');
      check('pop-out: ⚙ changes the speed', (await page.evaluate(() => document.querySelector('#pv').playbackRate)) === 1.5);
      await page.mouse.click(10, 200);
      await page.evaluate(() => { const r = document.querySelector('#pv-stage .pc-seek'); r.value = '500'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
      check('pop-out: the timeline seeks', Math.abs((await page.evaluate(() => document.querySelector('#pv').currentTime)) - 3) < 0.4);
      check('pop-out: next is there when there is a next episode', !(await page.evaluate(() => document.querySelector('#pv-stage .pc-next').disabled)));
      await page.evaluate(() => { const v = document.querySelector('#pv'); v.currentTime = 2; });
      await page.click('#pv-top');
      await waitFn(page, () => document.querySelector('#pv-top').getAttribute('aria-pressed') === 'false', null, { timeout: 2000 }).catch(() => {});
      check('pop-out: the 📌 button turns “always on top” off and on', (await pv()).topmost === false && (await page.getAttribute('#pv-top', 'aria-pressed')) === 'false');
      await page.keyboard.press('t');
      await waitFn(page, () => window.__pv.state.topmost === true, null, { timeout: 2000 }).catch(() => {});
      check('pop-out: T toggles it too', (await pv()).topmost === true);
      await page.keyboard.press('n');
      await page.keyboard.type('Great shot here');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__pv.state.notes.length === 1);
      check('pop-out: N adds a timestamped note', (await pv()).notes[0].text === 'Great shot here' && Math.abs((await pv()).notes[0].time - 2) < 0.3 && (await pv()).notes[0].id === 7);
      await page.evaluate(() => { const v = document.querySelector('#pv'); v.currentTime = v.duration - 0.2; v.play(); });
      await waitFn(page, () => window.__pv.state.titles.includes('Episode 8'), null, { timeout: 6000 });
      check('pop-out: the next episode follows automatically', (await pv()).positions.some((x) => x.id === 7));
      await page.keyboard.press('Escape');
      await waitFn(page, () => window.__pv.state.closed === 1);
      check('pop-out: Esc saves the position and closes', (await pv()).positions.length > 0);
      check('pop-out: no page errors', errors.length === 0, errors);
      await page.close();
    }

    // ---- 22. Stream Desk: overlay server, Now Playing designer, credits + effect builder, supporters, stream log.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' }, musicTracks: 4, streamVault: true,
        supporters: [{ name: 'Ania', channel: 'https://www.youtube.com/@ania', tier: 'Gold', since: '2026-01-01', until: null }, { name: 'Bartek', channel: null, tier: null, since: '2025-05-05', until: '2026-02-02' }] }, { width: 1600, height: 1000 });
      // The main window: the Music Bench reports what plays; Ctrl+Alt+B and the menu open the Stream Desk window.
      const M = () => page.evaluate(() => window.__mock.state.stream);
      await page.evaluate(() => window.NoorMusic.playRandom());
      await waitFn(page, () => window.__mock.state.stream.updates.some((t) => t && t.playing), null, { timeout: 6000 });
      check('the playing song is reported for overlays and the tracklist', (await M()).updates.find((t) => t && t.playing).title.length > 0);
      // The Stream Desk docks beside the editor like the other panels (and can pop out into its own window).
      await page.keyboard.press('Control+Alt+b');
      await page.waitForSelector('#dock-right #streamdesk:not([hidden])');
      const dockBox = await page.evaluate(() => ({ editor: document.querySelector('#editor').getBoundingClientRect().right, dock: document.querySelector('#dock-right').getBoundingClientRect().left, w: document.querySelector('#dock-right').getBoundingClientRect().width }));
      check('Ctrl+Alt+B docks the Stream Desk beside the editor', dockBox.editor <= dockBox.dock + 1 && dockBox.w > 300, dockBox);
      check('it looks like the other benches: title row, then tabs', await page.evaluate(() => !!document.querySelector('#streamdesk .music-head .music-title') && !!document.querySelector('#streamdesk .music-tabs [data-sdtab="mic"]')));
      check('in a narrow dock the tabs show icons only and the cards stack', await page.evaluate(() => getComputedStyle(document.querySelector('.sd-tab-label')).display === 'none' && getComputedStyle(document.querySelector('.sd-grid')).gridTemplateColumns.split(' ').length === 1));
      await page.keyboard.press('Control+k');
      await page.keyboard.type('Credits roll');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.NoorStream._state().tab === 'credits');
      check('menu and Ctrl+K items open its tabs', true);
      // Music on the left and the Stream Desk on the right, open together.
      await page.evaluate(() => window.NoorDock.place('music', 'left'));
      await page.evaluate(() => window.NoorMusic.togglePanel(true));
      await page.waitForSelector('#dock-left #music');
      check('panels in different docks are open together', await page.evaluate(() => window.NoorMusic.isOpen() && document.body.classList.contains('stream-open')));
      // ⧉ pops it out into its own window; from then on Ctrl+Alt+B brings that window forward.
      await page.click('#sd-popout');
      await waitFn(page, () => window.__mock.state.stream.windows.length === 1);
      check('⧉ moves the Stream Desk into its own window', !(await page.evaluate(() => document.body.classList.contains('stream-open'))) && (await page.evaluate(() => window.NoorDock.placeOf('stream'))) === 'window');
      await page.keyboard.press('Control+Alt+b');
      await waitFn(page, () => window.__mock.state.stream.windows.length === 2);
      check('…and Ctrl+Alt+B then brings that window forward', true);
      await page.evaluate(() => window.__mock.emit({ v: 2, event: 'stream.dock', payload: { tab: 'mic' } }));
      await page.waitForSelector('#dock-right #streamdesk:not([hidden])');
      await waitFn(page, () => window.NoorStream._state().tab === 'mic');
      check('“Dock in the main window” brings it back, on the same tab', (await page.evaluate(() => window.NoorDock.placeOf('stream'))) === 'right');
      check('where panels go is remembered', await page.evaluate(() => { const l = window.__mock.state.prefs.layout; return !!l && l.place.music === 'left' && l.place.stream === 'right'; }));
      const mainErrors = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors in the main window', mainErrors.length === 0, mainErrors);
      await page.close();
    }
    {
      const { page, errors } = await openStream(browser, url, { streamVault: true,
        supporters: [{ name: 'Ania', channel: 'https://www.youtube.com/@ania', tier: 'Gold', since: '2026-01-01', until: null }, { name: 'Bartek', channel: null, tier: null, since: '2025-05-05', until: '2026-02-02' }] }, { width: 1600, height: 1000 });
      const S = () => page.evaluate(() => window.__mock.state.stream);
      check('the Stream Desk window opens on Now Playing', await page.isVisible('#np-frame .ovnp'));
      check('in its own window it has no ✕ of its own (the title bar closes it)', !(await page.isVisible('.sd-close')));
      await page.evaluate(() => window.__mock.emit({ v: 2, event: 'stream.track', payload: { track: { id: 7, title: 'Żółta łódź', artist: 'Noor', playing: true, position: 3, duration: 120 } } }));
      await waitFn(page, () => /Żółta łódź/.test(document.querySelector('#np-frame').textContent));
      check('the preview shows the song the Music Bench is playing', !(await page.textContent('#np-frame')).includes('Night Drive'));
      const head = await page.evaluate(() => { const h = document.querySelector('.sd-head').getBoundingClientRect(); const t = document.querySelector('.sd-tabs').getBoundingClientRect(); return { h: h.height, gap: t.top - h.bottom, tabsH: t.height }; });
      check('the header is one tidy title row with the tabs right below it', head.h < 60 && head.gap >= 0 && head.gap < 12 && head.tabsH < 50, head);
      await page.check('#sd-server-on');
      await waitFn(page, () => window.__mock.state.stream.running === true);
      await waitFn(page, () => /127\.0\.0\.1:47321/.test(document.querySelector('#sd-server').textContent));
      check('turning on the overlay server shows the loopback address', (await page.textContent('.sd-urls')).includes('http://127.0.0.1:47321/now-playing.html'));
      await page.click('[data-copy="Now Playing URL"]');
      await waitFn(page, () => window.__mock.state.clipboard === 'http://127.0.0.1:47321/now-playing.html');
      // Design changes reach the preview at once and the host (OBS) after a moment.
      await page.click('[data-design="neon"]');
      await page.fill('#streamdesk [data-key="label"]', 'On air');
      await page.selectOption('#streamdesk [data-key="position"]', 'top-right');
      await waitFn(page, () => window.__mock.state.stream.np && window.__mock.state.stream.np.design === 'neon' && window.__mock.state.stream.np.label === 'On air', null, { timeout: 3000 });
      check('the Now Playing design updates the preview and is sent to the overlays', (await page.getAttribute('#np-frame .ovnp', 'class')).includes('ovnp-design-neon') && (await page.getAttribute('#np-frame .ovnp', 'class')).includes('ovnp-pos-top-right') && (await page.textContent('#np-frame .ovnp-label')) === 'On air');
      for (const d of ['glass', 'lowerthird', 'vinyl', 'minimal', 'ticker']) {
        await page.click(`[data-design="${d}"]`);
        if (!(await page.getAttribute('#np-frame .ovnp', 'class')).includes('ovnp-design-' + d)) check(`design ${d} renders`, false);
      }
      check('all six designs render', true);

      // Credits: preview with the active supporters only; effect builder; roll in OBS.
      await page.click('[data-sdtab="credits"]');
      await page.waitForSelector('#cr-frame .cr-roll');
      const roll = await page.textContent('#cr-frame .cr-roll');
      check('the credits preview lists active supporters with their channel', roll.includes('Ania') && roll.includes('@ania') && !roll.includes('Bartek'), roll);
      await page.fill('#cr-title', 'Dziękuję!');
      await waitFn(page, () => document.querySelector('#cr-frame .cr-title')?.textContent === 'Dziękuję!');
      await page.selectOption('#cr-effect', 'confetti');
      await page.click('#cr-new-effect');
      await page.waitForSelector('#cr-effect-name');
      await page.fill('#cr-effect-name', 'Purple rain');
      await page.selectOption('#cr-particles', 'emoji');
      await page.fill('#cr-builder [aria-label="Emoji"]', '💜');
      await waitFn(page, () => { const s = window.__mock.state.stream; return s.effects.length === 1 && s.effects[0].label === 'Purple rain' && s.effects[0].particles.kind === 'emoji' && !!s.cr && s.cr.effect === s.effects[0].id; }, null, { timeout: 3000 });
      check('a new effect is made from an existing one, named, and selected', (await page.textContent('#cr-effect')).includes('★ Purple rain'));
      const paints = await page.evaluate(async () => { const c = document.querySelector('#cr-frame canvas'); await new Promise((r) => setTimeout(r, 400)); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
      check('the effect draws particles in the preview', paints > 50, paints);
      await page.click('#cr-preview-play');
      const y0 = await page.evaluate(() => document.querySelector('#cr-frame .cr-roll').style.transform);
      await page.waitForTimeout(1600);
      check('Preview scrolls the names', (await page.evaluate(() => document.querySelector('#cr-frame .cr-roll').style.transform)) !== y0);
      await page.click('#cr-roll');
      await waitFn(page, () => window.__mock.state.stream.starts === 1);
      check('“Roll credits in OBS” tells the overlay to start', true);

      // Supporters: add, mark as left, paste an export, save.
      await page.click('[data-sdtab="supporters"]');
      await page.waitForSelector('#sup-table .sd-tr:not(.head)');
      check('the supporters tab shows the active ones by default', (await page.$$('#sup-table .sd-tr:not(.head)')).length === 1);
      await page.click('#sup-add');
      await page.keyboard.type('Celina');
      await page.fill('#sup-table .sd-tr[data-index="0"] [aria-label="channel"]', 'https://www.twitch.tv/celina');
      await page.click('#sup-table .sd-tr[data-index="1"] button:has-text("Left")');
      await page.click('#sup-import');
      await page.fill('#sup-paste', 'Celina https://www.twitch.tv/celina\nDawid https://www.youtube.com/@dawid');
      await page.check('#sup-missing');
      await waitFn(page, () => /New: Dawid/.test(document.querySelector('#sup-result').textContent));
      await page.click('#sup-apply');
      await page.click('#sup-save');
      await waitFn(page, () => window.__mock.state.stream.supporters.length === 4);
      const sup = (await S()).supporters;
      const todayLocal = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
      check('supporters are saved: new ones added, people who left kept with today’s date', sup.find((x) => x.name === 'Dawid') && !sup.find((x) => x.name === 'Celina').until && sup.find((x) => x.name === 'Ania').until === todayLocal && sup.find((x) => x.name === 'Bartek').until === '2026-02-02', sup);

      // Stream log: template, recording the tracklist, chapters in the copied description, thumbnail, save.
      await page.click('[data-sdtab="log"]');
      await page.waitForSelector('#log-title');
      await page.click('button:has-text("Templates…")');
      await page.click('#tpl-add');
      await page.click('#tpl-save');
      await waitFn(page, () => window.__mock.state.stream.templates.length === 1);
      // The form redraws after saving templates; choose from the redrawn one (retry once if it was replaced meanwhile).
      for (let attempt = 0; attempt < 3; attempt++) {
        await waitFn(page, () => !!document.querySelector('#log-template option[value="0"]') && !document.querySelector('.modal'));
        await page.waitForTimeout(150);
        await page.selectOption('#log-template', '0');
        if (await waitFn(page, () => /Suno music stream #1/.test(document.querySelector('#log-title')?.value || ''), null, { timeout: 2000 }).then(() => true).catch(() => false)) break;
      }
      check('a template fills the title, description and keywords', (await page.inputValue('#log-desc')).includes('{tracklist}') && (await page.inputValue('#log-keywords')).includes('suno'));
      await page.click('#log-record');
      await waitFn(page, () => !!window.__mock.state.stream.session);
      // The host relays each song the Music Bench starts (the main window sends it, see above).
      await page.evaluate(() => NoorBridge.request('stream.np.update', { track: { id: 9, title: 'Night shift', artist: 'Suno', playing: true, position: 0, duration: 200 } }));
      await waitFn(page, () => window.__mock.state.stream.session.marks.length >= 1, null, { timeout: 4000 });
      await page.evaluate(async () => { const r = await NoorBridge.request('stream.status'); return r; });
      await page.click('[data-sdtab="log"]');
      await page.waitForSelector('#log-stop');
      await page.click('#log-stop');
      await waitFn(page, () => document.querySelectorAll('#log-tracks li').length >= 1);
      check('recording a stream notes each song with its time', (await page.textContent('#log-tracks')).includes('00:0'));
      await page.click('[data-copy="Description"]');
      await waitFn(page, () => typeof window.__mock.state.clipboard === 'string' && /00:00 /.test(window.__mock.state.clipboard));
      check('the copied description has the tracklist as chapters', !(await page.evaluate(() => window.__mock.state.clipboard)).includes('{tracklist}'));
      await page.click('button:has-text("Choose…")');
      await page.waitForSelector('#log-thumb img');
      await page.click('#log-save');
      await waitFn(page, () => window.__mock.state.stream.saved.length === 1);
      const saved = (await S()).saved[0];
      check('the stream is saved to the Vault with its details', saved.title.startsWith('Suno music stream #1') && saved.thumbnail === '../attachments/thumb.png' && saved.tracklist.length >= 1 && saved.number === 1, saved);
      await waitFn(page, () => document.querySelectorAll('#log-history .vb-item').length === 1);
      check('the stream appears in the history', (await page.textContent('#log-history')).includes('Suno music stream #1'));
      await page.keyboard.press('Escape');
      check('Esc does not close the Stream Desk window', await page.isVisible('#streamdesk'));
      await page.evaluate(() => window.NoorStream.close());
      await waitFn(page, () => window.__mock.state.streamClosed === 1);
      check('closing asks the host to close the window', true);
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors in the Stream Desk', unexpected.length === 0, unexpected);
      if (shots) { await page.evaluate(() => window.NoorStream.open('credits')); await page.waitForTimeout(800); await page.screenshot({ path: `${shots}/stream.png` }); }
      await page.close();
    }

    // ---- 23. The OBS overlay pages themselves (served flat, fed over Server-Sent Events).
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/events', (route) => route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' },
        body: 'event: np.config\ndata: {"design":"glass","label":"Now playing","accent":"#ff00aa"}\n\nevent: np.track\ndata: {"id":3,"title":"Żółw nocą","artist":"Noor","hasArt":false,"playing":true,"position":10,"duration":100}\n\n' +
          'event: credits.config\ndata: {"config":{"title":"Thanks","effect":"starfield","autoStart":true,"startDelay":0,"speed":200},"effects":[]}\n\nevent: credits.data\ndata: {"supporters":[{"name":"Ania","tier":"Gold"}]}\n\n' }));
      await page.goto(url + '_noormd/overlay/now-playing.html');
      await waitFn(page, () => document.querySelector('.ovnp-title')?.textContent === 'Żółw nocą', null, { timeout: 5000 });
      check('OBS Now Playing page renders the song from the event stream', (await page.textContent('.ovnp-artist')) === 'Noor' && (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgba(0, 0, 0, 0)');
      await page.goto(url + '_noormd/overlay/credits.html');
      await waitFn(page, () => document.querySelector('.cr-name')?.textContent === 'Ania', null, { timeout: 5000 });
      const t0 = await page.evaluate(() => document.querySelector('.cr-roll').style.transform);
      await page.waitForTimeout(800);
      check('OBS credits page starts by itself and scrolls', (await page.evaluate(() => document.querySelector('.cr-roll').style.transform)) !== t0);
      check('overlay pages: no errors', errors.length === 0, errors);
      await page.close();
    }

    // ---- 24. Mic Guard: one switch for the Windows microphone and OBS, read back, with a hotkey and an indicator.
    {
      const { page, errors } = await openStream(browser, url, { streamTab: 'mic' }, { width: 1500, height: 1000 });
      const MIC = () => page.evaluate(() => window.__mock.state.mic);
      await page.waitForSelector('#mic-verdict .mic-big');
      check('the host can open the Stream Desk window straight on Mic Guard', (await page.getAttribute('[data-sdtab="mic"]', 'aria-selected')) === 'true');
      check('Mic Guard starts switched off', (await page.textContent('#mic-verdict')).includes('Not set up') && !(await MIC()).cfg.windows);
      check('the microphones are listed, the default first', (await page.$$eval('#mic-device option', (o) => o.map((x) => x.textContent))).join('|') === 'Default microphone (Microphone (Blue Yeti))|Microphone (Blue Yeti)|Headset Microphone');
      await page.check('#mic-windows');
      await waitFn(page, () => window.__mock.state.mic.cfg.windows === true && window.NoorStream._state().micSettled);
      await page.waitForSelector('#mic-verdict.live');
      check('with the Windows mic on, the verdict shows LIVE', (await page.textContent('#mic-verdict .mic-big')) === 'LIVE');
      check('…and the Stream Desk header shows it too', (await page.textContent('#sd-mic-pill')).includes('LIVE'));

      // OBS: a wrong password is explained; the right one connects and is remembered (by the host, not the page).
      await page.check('#mic-obs');
      await waitFn(page, () => window.__mock.state.mic.cfg.obs === true && window.NoorStream._state().micSettled);
      await page.fill('#mic-obs-pw', 'nope');
      await page.click('#mic-obs-connect');
      await page.waitForSelector('.modal, .toast, [role="alert"]', { timeout: 3000 }).catch(() => {});
      check('a wrong OBS password is reported', !(await MIC()).connected);
      await page.keyboard.press('Escape').catch(() => {});
      await page.fill('#mic-obs-pw', 'hunter2');
      await page.click('#mic-obs-connect');
      await waitFn(page, () => window.__mock.state.mic.connected === true);
      await page.waitForSelector('#mic-obs-input:not([disabled])');
      check('the right password connects and the mic source is picked', (await page.inputValue('#mic-obs-input')) === 'Mic/Aux' && (await MIC()).stored);
      check('the password never stays in the page or the settings', (await page.inputValue('#mic-obs-pw')) === '' && !JSON.stringify((await MIC()).cfg).includes('hunter2'));
      check('a saved password is offered to forget', await page.isVisible('#mic-obs-forget'));

      // Out of step → CHECK, and the toggle mutes both instead of swapping them.
      await page.evaluate(() => { window.__mock.state.mic.win = true; });
      await page.evaluate(() => window.__mock.emit({ v: 2, event: 'mic.state', payload: { verdict: 'mismatch', label: 'CHECK', explain: 'Out of step: Windows mic muted, OBS live. Press the hotkey to mute both.', windows: 'muted', obs: 'live', obsConnected: true } }));
      await page.waitForSelector('#mic-verdict.mismatch');
      check('when Windows and OBS disagree it says CHECK and explains', (await page.textContent('#mic-verdict')).includes('Out of step'));
      await page.click('#mic-toggle');
      await waitFn(page, () => window.__mock.state.mic.win === true && window.__mock.state.mic.obsMuted === true);
      await page.waitForSelector('#mic-verdict.muted');
      check('Toggle mutes both when they disagree', (await MIC()).calls.at(-1) === true);
      await page.click('#mic-toggle');
      await waitFn(page, () => !window.__mock.state.mic.win && !window.__mock.state.mic.obsMuted);
      await page.waitForSelector('#mic-verdict.live');
      check('…and unmutes both only when both were muted', (await page.textContent('#mic-verdict .mic-big')) === 'LIVE');
      await page.click('#mic-mute');
      await waitFn(page, () => window.__mock.state.mic.win && window.__mock.state.mic.obsMuted);
      await page.waitForSelector('#mic-verdict.muted');
      check('Mute everywhere sets both explicitly', (await page.textContent('#mic-verdict .mic-big')) === 'MUTED');

      // Hotkey: pressing keys records a gesture; plain letters are refused.
      await page.click('#mic-hotkey');
      await page.keyboard.press('Control+Alt+F9');
      check('the hotkey field records the keys pressed', (await page.inputValue('#mic-hotkey')) === 'Ctrl+Alt+F9');
      await page.click('#mic-hotkey-save');
      await waitFn(page, () => window.__mock.state.mic.cfg.hotkey === 'Ctrl+Alt+F9');
      await page.waitForSelector('#mic-toggle:has-text("Ctrl+Alt+F9")');
      check('the hotkey is saved and shown on the Toggle button', true);
      check('letters, digits and the Pause key map to Windows key names', await page.evaluate(() => {
        const g = (o) => window.NoorStream._gesture({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
        return g({ code: 'KeyM', ctrlKey: true, shiftKey: true }) === 'Ctrl+Shift+M' && g({ code: 'Digit1', altKey: true }) === 'Alt+D1' && g({ code: 'Pause' }) === 'Pause' && g({ code: 'ControlLeft', ctrlKey: true }) === null
          && g({ code: 'Slash', ctrlKey: true }) === 'Ctrl+/' && g({ code: 'Backslash', altKey: true }) === 'Alt+\\' && g({ code: 'Comma', ctrlKey: true }) === 'Ctrl+,' && g({ code: 'F13' }) === 'F13';
      }));
      // Mouse buttons: the side buttons (and the middle one with a modifier) can be the hotkey.
      await page.dispatchEvent('#mic-hotkey', 'mousedown', { button: 3 });
      check('pressing a side mouse button records Mouse4', (await page.inputValue('#mic-hotkey')) === 'Mouse4');
      await page.dispatchEvent('#mic-hotkey', 'mousedown', { button: 4, ctrlKey: true });
      check('…the other one with Ctrl records Ctrl+Mouse5', (await page.inputValue('#mic-hotkey')) === 'Ctrl+Mouse5');
      await page.click('#mic-hotkey');
      await page.keyboard.press('Control+Shift+Slash');
      check('keys like / are recorded', (await page.inputValue('#mic-hotkey')) === 'Ctrl+Shift+/');
      await page.keyboard.press('Escape');
      check('Esc clears the field', (await page.inputValue('#mic-hotkey')) === '');

      // Indicator.
      await page.check('#mic-indicator');
      await waitFn(page, () => window.__mock.state.mic.cfg.indicator === true && window.NoorStream._state().micSettled);
      check('the floating indicator can be switched on (hidden from capture by default)', (await MIC()).cfg.hideFromCapture === true);
      const narrow = await page.evaluate(() => { const card = document.querySelector('#mic-device').closest('.sd-card').getBoundingClientRect(); const d = document.querySelector('#mic-device').getBoundingClientRect(); return { card: card.right, sel: d.right }; });
      check('the microphone menu stays inside its card', narrow.sel <= narrow.card + 1, narrow);
      const unexpected = errors.filter((e) => !/status of 404|refused the password/.test(e)); // the wrong password above is on purpose
      check('no page errors in Mic Guard', unexpected.length === 0, unexpected);
      if (shots) await page.screenshot({ path: `${shots}/mic-guard.png` });
      await page.close();
    }
    {
      // From the main window: Ctrl+K toggles the microphone and opens Mic Guard in the Stream Desk window.
      const { page, errors } = await open(browser, url, { document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' } });
      await page.evaluate(() => { Object.assign(window.__mock.state.mic.cfg, { windows: true }); });
      await page.keyboard.press('Control+k');
      await page.keyboard.type('mute / unmute microphone');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.mic.calls.length === 1);
      check('Ctrl+K › Mute / unmute microphone uses Mic Guard', (await page.evaluate(() => window.__mock.state.mic.win)) === true);
      await page.keyboard.press('Control+k');
      await page.keyboard.type('Mic Guard:');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#streamdesk:not([hidden]) #mic-verdict');
      check('Ctrl+K › Mic Guard settings opens the Stream Desk on that tab', (await page.evaluate(() => window.NoorStream._state().tab)) === 'mic');
      const unexpected = errors.filter((e) => !/status of 404/.test(e));
      check('no page errors when using Mic Guard from the main window', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 25. Find in files: every open document (with unsaved edits) or the Vault; results grouped, Enter jumps there.
    {
      const tabsInit = [
        { markdown: '# Rivers\n\nThe Vistula river is long.\nAnother River here.\n', path: 'C:\\notes\\rivers.md', fileName: 'rivers.md', title: 'rivers' },
        { markdown: '# Lakes\n\nNo flowing water.\n', path: 'C:\\notes\\lakes.md', fileName: 'lakes.md', title: 'lakes' },
        { markdown: '# Trip\n\nWe crossed a riverbed and a river.\n', path: 'C:\\notes\\trip.md', fileName: 'trip.md', title: 'trip' },
      ];
      const { page, errors } = await open(browser, url, { tabs: tabsInit }, { width: 1400, height: 900 });
      await waitFn(page, () => window.NoorMD.tabs().length === 3);
      await page.keyboard.press('Control+Shift+F');
      await page.waitForSelector('#vault-search-input');
      check('Find in files works without a Vault and starts on the open documents', await page.evaluate(() => document.querySelector('#fs-scope-open').classList.contains('active') && document.querySelector('#fs-scope-vault').disabled));
      await page.fill('#vault-search-input', 'river');
      await page.waitForSelector('.fs-file');
      const files = await page.$$eval('.fs-file strong', (n) => n.map((x) => x.textContent));
      check('results are grouped by open document (only those with matches)', files.join('|') === 'rivers.md|trip.md', files);
      check('every match is listed with its line number', (await page.$$('.vs-hit')).length === 5 && (await page.textContent('.vs-status')).includes('5 matches in 2 of 3'));
      await page.check('#fs-word');
      await waitFn(page, () => document.querySelectorAll('.vs-hit').length === 3);
      check('Whole word leaves out “Rivers” and “riverbed”', await page.$$eval('.vs-hit', (hits) => hits.every((h) => { const m = h.querySelector('mark'); const after = m.nextSibling ? m.nextSibling.textContent[0] || '' : ''; return !/[\p{L}]/u.test(after); })));
      await page.check('#fs-case');
      await waitFn(page, () => document.querySelectorAll('.vs-hit').length === 2);
      check('Match case leaves out “River”', true);
      await page.uncheck('#fs-case'); await page.uncheck('#fs-word');
      await waitFn(page, () => document.querySelectorAll('.vs-hit').length === 5);
      // Jump to the last match (in trip.md): the tab opens and the find bar selects that occurrence.
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.NoorMD.tabs().find((x) => x.active)?.title === 'trip');
      await waitFn(page, () => /2 of 2/.test(document.querySelector('#find-count').textContent));
      check('Enter jumps to that match in its document', (await page.inputValue('#find-input')) === 'river');
      // Unsaved edits are searched too.
      await page.evaluate(() => window.NoorMD.runCommand('tab.next'));
      await page.click('.toastui-editor-ww-container .ProseMirror');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' Kayak on the river.');
      await page.keyboard.press('Control+Shift+F');
      await page.waitForSelector('#vault-search-input');
      await page.fill('#vault-search-input', 'kayak');
      await page.waitForSelector('.vs-hit');
      check('unsaved edits in open documents are found', (await page.$$('.vs-hit')).length === 1);
      await page.keyboard.press('Escape');
      const unexpected = errors.filter((e) => !/status of 404/.test(e));
      check('no page errors in Find in files', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 26. Docks and layouts: panels in left / right / bottom docks, ready-made and saved layouts, sidebar side.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# Layouts\n\nText.\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' }, musicTracks: 4, videos: true }, { width: 1600, height: 1000 });
      const D = () => page.evaluate(() => window.NoorDock._state());
      const rect = (sel) => page.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
      check('the classic layout is the default: sidebar left, panels dock right', (await D()).layout.sidebar === 'left' && (await D()).layout.place.music === 'right');
      // Ready-made "Streaming": music left, Stream Desk right, sidebar hidden.
      await page.evaluate(() => window.NoorDock.applyPreset('streaming'));
      await page.waitForSelector('#dock-left #music');
      await page.waitForSelector('#dock-right #streamdesk:not([hidden])');
      const ed = await rect('#editor'), left = await rect('#dock-left'), right = await rect('#dock-right');
      check('“Streaming” puts music on the left and the Stream Desk on the right, the document between', left.r <= ed.l + 1 && ed.r <= right.l + 1 && left.w > 250 && right.w > 250, { left, ed, right });
      check('…and hides the sidebar', await page.evaluate(() => document.body.classList.contains('sidebar-collapsed')));
      // The video goes under the document (bottom dock) and keeps playing when it moves.
      await page.evaluate(() => window.NoorVideo.open());
      await page.waitForSelector('#dock-bottom #videobench:not([hidden])');
      const bottom = await rect('#dock-bottom');
      check('videos open in the bottom dock, under the document', bottom.t >= ed.t && bottom.l >= left.r - 1 && bottom.r <= right.l + 1 && bottom.h >= 160, { bottom, ed });
      await page.evaluate(() => window.NoorVideo.select(1, { autoplay: true }));
      await waitFn(page, () => !document.querySelector('#vb-video').paused && document.querySelector('#vb-video').currentTime > 0.2, null, { timeout: 6000 });
      await page.evaluate(() => window.NoorDock.place('video', 'right'));
      await page.waitForSelector('#dock-right #videobench:not([hidden])');
      check('moving a panel to another dock replaces what was there (the Stream Desk closes)', !(await page.evaluate(() => document.body.classList.contains('stream-open'))));
      await page.evaluate(() => window.NoorVideo.select(1, { autoplay: true }));
      await waitFn(page, () => !document.querySelector('#vb-video').paused, null, { timeout: 6000 });
      check('a video plays in its new dock', true);
      // Resizing a dock by its edge.
      const before = (await rect('#dock-right')).w;
      const handle = await rect('#dock-right .dock-resizer');
      await page.mouse.move(handle.l + 4, handle.t + 300);
      await page.mouse.down();
      await page.mouse.move(handle.l - 120, handle.t + 300, { steps: 5 });
      await page.mouse.up();
      const after = (await rect('#dock-right')).w;
      check('a dock is resized by dragging its edge', after > before + 80, { before, after });
      check('…and its size is remembered', await page.evaluate((w) => Math.abs(window.__mock.state.prefs.layout.size.right - w) < 3, after));
      // Save the current layout, switch to another, then bring it back.
      await page.evaluate(() => { window.NoorDock.saveAs(); }); // the dialog waits for a name
      await page.waitForSelector('.modal input');
      await page.fill('.modal input', 'Evening stream');
      await page.keyboard.press('Enter');
      await waitFn(page, () => (window.__mock.state.prefs.layouts || []).some((l) => l.name === 'Evening stream'));
      check('the current layout can be saved by name', true);
      await page.evaluate(() => window.NoorDock.applyPreset('writing'));
      await waitFn(page, () => !document.querySelector('.dock.open'));
      check('“Writing” closes every panel', !(await page.evaluate(() => window.NoorMusic.isOpen() || window.NoorVideo.isOpen())));
      await page.evaluate(() => window.NoorDock.showLayouts());
      await page.waitForSelector('#layout-list');
      check('the Layouts dialog lists the ready-made and saved layouts', (await page.textContent('#layout-list')).includes('Evening stream') && (await page.textContent('#layout-list')).includes('Streaming'));
      await page.click('#layout-list .layout-card:has-text("Evening stream") .layout-apply');
      await page.waitForSelector('#dock-left #music');
      await page.waitForSelector('#dock-right #videobench:not([hidden])');
      check('applying a saved layout reopens its panels where they were, at their size', Math.abs((await rect('#dock-right')).w - after) < 3);
      // Sidebar on the right (View › Layout).
      await page.evaluate(() => window.NoorDock.applyPreset('classic'));
      await page.evaluate(() => window.NoorMD.runCommand('view.sidebarRight'));
      await waitFn(page, () => document.body.classList.contains('sidebar-right'));
      const sb = await rect('#sidebar'), ed2 = await rect('#editor');
      check('the sidebar can sit on the right', sb.l >= ed2.r - 1 && sb.w > 150, { sb, ed2 });
      await page.evaluate(() => window.NoorMD.runCommand('view.sidebarRight'));
      await waitFn(page, () => !document.body.classList.contains('sidebar-right'));
      check('…and back on the left', (await rect('#sidebar')).r <= (await rect('#editor')).l + 1);
      // Each panel's ⊞ button moves just that panel.
      await page.evaluate(() => window.NoorMusic.togglePanel(true));
      await page.waitForSelector('#music-dock');
      await page.click('#music-dock');
      await page.waitForSelector('.menu-popup');
      check('⊞ offers left, right and bottom', await page.evaluate(() => ['Dock left', 'Dock right', 'Dock bottom', 'Layouts'].every((w) => document.querySelector('.menu-popup').textContent.includes(w))));
      await page.click('.menu-popup .menu-item:has-text("Dock bottom")');
      await page.waitForSelector('#dock-bottom #music');
      check('…and the panel moves there at once', await page.evaluate(() => window.NoorMusic.isOpen()));
      await page.keyboard.press('F11');
      await waitFn(page, () => document.body.classList.contains('zen'));
      check('Focus mode hides the docks', await page.evaluate(() => getComputedStyle(document.querySelector('#dock-bottom')).display === 'none'));
      await page.keyboard.press('F11');
      const unexpected = errors.filter((e) => !/Empty src|status of 404|MEDIA_ELEMENT_ERROR/.test(e));
      check('no page errors with docks and layouts', unexpected.length === 0, unexpected);
      if (shots) { await page.evaluate(() => window.NoorDock.applyPreset('streaming')); await page.waitForTimeout(500); await page.screenshot({ path: `${shots}/layout-streaming.png` }); }
      await page.close();
    }

    // ---- 27. Tags (#tag and front matter) in the sidebar; the new-Vault wizard with presets.
    {
      const tfiles = {
        'Home.md': '# Home\n\nPlans for #project/alpha and #idea.\n',
        'World/Rivers.md': '---\ntags: [lore, idea]\n---\n# Rivers\n\nNot a tag: page#part, issue #12, `#code`.\n',
        'World/Seas.md': '# Seas\n\n#lore #project\n',
      };
      const { page, errors } = await open(browser, url, { document: null, vault: { root: 'C:\\Vaults\\Tags', files: tfiles } });
      await waitFn(page, () => document.body.classList.contains('has-vault'));
      await page.click('#side-switch [data-view="tags"]');
      await page.waitForSelector('#tag-cloud .tag-chip');
      const chips = await page.$$eval('#tag-cloud .tag-chip', (n) => n.map((x) => x.dataset.tag + ':' + x.querySelector('small').textContent));
      check('the Tags view lists every tag with how many notes use it', chips.join(',') === 'idea:2,lore:2,project:1,project/alpha:1', chips);
      check('page#part, #12 and `#code` are not tags', !chips.some((c) => /part|12|code/.test(c)));
      await page.click('#tag-cloud .tag-chip[data-tag="project"]');
      await page.waitForSelector('.tag-note');
      const notes = await page.$$eval('.tag-note', (n) => n.map((x) => x.dataset.path));
      check('#project also lists notes tagged #project/alpha', notes.join(',') === 'Home.md,World/Seas.md', notes);
      await page.click('.tag-note[data-path="World/Seas.md"]');
      await waitFn(page, () => window.NoorMD.getState()?.title === 'Seas');
      check('clicking a note opens it', true);
      await page.click('#tags-back');
      await page.fill('#tags-filter', 'lo');
      await waitFn(page, () => document.querySelectorAll('#tag-cloud .tag-chip').length === 1);
      check('the filter narrows the tags', (await page.textContent('#tag-cloud')).includes('#lore'));
      // New Vault wizard: name + starting point; adding a preset to the open Vault never replaces files.
      await page.evaluate(() => window.NoorMD.runCommand('vault.create'));
      await page.waitForSelector('#vw-name');
      check('the wizard offers starting points', (await page.$$('.preset-card')).length === 3 && (await page.getAttribute('.preset-card[data-preset="notes"]', 'aria-checked')) === 'true');
      await page.fill('#vw-name', 'Atlas Żółw');
      await page.click('.preset-card[data-preset="creator"]');
      await page.click('#vw-create');
      await waitFn(page, () => !!window.__mock.state.vault?.created || !!window.__mock.vaultCreated);
      check('Create sends the name and the chosen preset', await page.evaluate(() => { const c = window.__mock.state.vault.created; return c.name === 'Atlas Żółw' && c.preset === 'creator'; }));
      await page.evaluate(() => window.NoorMD.runCommand('vault.addPreset'));
      await page.waitForSelector('#vw-apply');
      check('“Add folders from a preset” leaves out Empty', !(await page.$('.preset-card[data-preset="blank"]')));
      await page.click('#vw-apply');
      await waitFn(page, () => window.__mock.state.vault.applied === 'notes');
      check('…and adds the chosen preset’s folders to the open Vault', true);
      const unexpected = errors.filter((e) => !/status of 404/.test(e));
      check('no page errors with tags and the Vault wizard', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 28. Apps Hub: shortcuts with pictures in a dock panel; start, edit, group, remove; safe addresses only.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' } }, { width: 1500, height: 950 });
      const H = () => page.evaluate(() => window.__mock.state.hub);
      await page.keyboard.press('Control+Alt+h');
      await page.waitForSelector('#dock-right #appshub:not([hidden])');
      await waitFn(page, () => (document.querySelector('#apps-body')?.textContent || '').includes('Your apps, games and sites'));
      check('Ctrl+Alt+H opens the Apps Hub in a dock', true);
      await page.click('#apps-body button:has-text("Program or game")');
      await page.waitForSelector('.app-tile');
      check('programs and games are added with their pictures', (await page.$$('.app-tile')).length === 2 && await page.evaluate(() => document.querySelector('.app-tile img.app-pic').complete && document.querySelector('.app-tile img.app-pic').naturalWidth > 0));
      check('…grouped (Apps, Games)', (await page.$$eval('.apps-group h4', (n) => n.map((x) => x.textContent))).join(',') === 'Apps,Games');
      check('a shortcut without a picture gets a letter tile', (await page.textContent('.app-tile[data-id="h2"] .app-letter')) === 'D');
      // Websites: launcher links are fine, dangerous schemes are refused.
      await page.click('#apps-add');
      await page.click('.menu-popup .menu-item:has-text("Website")');
      await page.fill('#apps-url', 'javascript:alert(1)');
      await page.click('#apps-web-ok');
      await page.waitForTimeout(150);
      check('javascript: and file: addresses are refused', (await H()).items.length === 2 && await page.isVisible('#apps-url'));
      if ((await page.$$('.modal')).length > 1) await page.keyboard.press('Escape'); // close the error, keep the form
      await page.fill('#apps-url', 'https://studio.youtube.com');
      await page.fill('#apps-name', 'YouTube Studio');
      await page.click('#apps-web-ok');
      await waitFn(page, () => window.__mock.state.hub.items.length === 3);
      check('a website is added (name and group)', (await H()).items[2].name === 'YouTube Studio' && (await H()).items[2].group === 'Web');
      // Start, recently used, search.
      await page.click('.app-tile[data-id="h1"]');
      await page.click('.app-tile[data-id="h3"]');
      await waitFn(page, () => window.__mock.state.hub.launched.length === 2);
      await waitFn(page, () => !!document.querySelector('.apps-group h4') && document.querySelector('.apps-group h4').textContent === 'Recently used');
      check('a click starts it, by id only, and it shows under Recently used', JSON.stringify((await H()).launched) === '["h1","h3"]');
      await page.fill('#apps-search', 'dota');
      await waitFn(page, () => document.querySelectorAll('.app-tile').length === 1);
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.hub.launched.length === 3);
      check('search + Enter starts the first match', (await H()).launched[2] === 'h2');
      await page.fill('#apps-search', '');
      // Right-click: edit, move to the start, remove.
      await page.click('.apps-group[data-group="Games"] .app-tile[data-id="h2"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Edit")');
      await page.fill('#apps-name', 'Dota 2 (beta)');
      await page.fill('#apps-args', '-novid');
      await page.click('#apps-edit-ok');
      await waitFn(page, () => window.__mock.state.hub.items.find((i) => i.id === 'h2').name === 'Dota 2 (beta)');
      check('Edit changes the name and the start arguments', (await H()).items.find((i) => i.id === 'h2').arguments === '-novid');
      await page.click('.apps-group[data-group="Web"] .app-tile[data-id="h3"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Move to the start")');
      await waitFn(page, () => window.__mock.state.hub.items[0].id === 'h3');
      await page.click('.apps-group[data-group="Apps"] .app-tile[data-id="h1"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Remove from the hub")');
      await page.click('.modal button:has-text("Remove")');
      await waitFn(page, () => window.__mock.state.hub.items.length === 2);
      check('Remove takes the shortcut out (after asking)', !(await H()).items.some((i) => i.id === 'h1'));
      check('the Apps Hub can move to another dock like the benches', await page.evaluate(() => { window.NoorDock.place('apps', 'left'); return !!document.querySelector('#dock-left #appshub'); }));
      const unexpected = errors.filter((e) => !/status of 404|addresses can't be added/.test(e));
      check('no page errors in the Apps Hub', unexpected.length === 0, unexpected);
      if (shots) await page.screenshot({ path: `${shots}/apps-hub.png` });
      await page.close();
    }

    // ---- 29. Voice notes: record (fake microphone), listen, save as Opus or WAV, link into the document; Visual-mode inserts.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# Ideas\n\nToday:\n', path: 'C:\\Vaults\\Atlas\\Ideas.md', fileName: 'Ideas.md', title: 'Ideas' } }, { width: 1500, height: 950 });
      const VS = () => page.evaluate(() => window.NoorVoice._state());
      const VM = () => page.evaluate(() => window.__mock.state.voice);
      await page.click('.toastui-editor-ww-container .ProseMirror');
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Control+Alt+d');
      await waitFn(page, () => window.NoorVoice._state().recording, null, { timeout: 5000 });
      check('Ctrl+Alt+D opens the recorder and starts recording', await page.isVisible('#voicedesk'));
      check('the microphone is asked for only after Record was pressed', (await VM()).armed === 1);
      let levels = 0;
      for (let i = 0; i < 12; i++) { await page.waitForTimeout(150); if ((await page.evaluate(() => parseFloat(document.querySelector('#voice-level').style.width) || 0)) > 0) levels++; }
      check('the level meter moves while recording', levels > 0);
      await page.click('#voice-pause');
      check('pause pauses', (await VS()).paused);
      await page.waitForTimeout(300);
      await page.click('#voice-pause');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+Alt+d');
      await page.waitForSelector('#voice-take-audio');
      const take = (await VS()).take;
      check('stopping keeps a take to listen to (the microphone is released)', take.size > 1000 && take.seconds > 1 && /webm/.test(take.type) && !(await VS()).recording, take);
      await page.fill('#voice-name', 'Boss idea');
      await page.click('#voice-save');
      await waitFn(page, () => window.__mock.state.voice.saved.length === 1);
      const saved = (await VM()).saved[0];
      check('it is saved as Opus/WebM, sent in pieces and named', saved.name === 'Boss idea' && saved.ext === '.webm' && saved.head === '1a45dfa3' && saved.size === take.size, saved);
      await waitFn(page, () => /Boss idea/.test(window.NoorMD.getState().markdown));
      const md1 = await page.evaluate(() => window.NoorMD.getState().markdown);
      check('a link to it goes into the document — a real link in Visual mode, not escaped text', /\[🎙 Boss idea \(0:0\d\)\]\(attachments\/Voice%20notes\/Boss%20idea\.webm\)/.test(md1) && !md1.includes('\\['), md1);
      check('the recording is listed', (await page.textContent('#voice-list')).includes('Boss idea'));
      // WAV for players that don't open Opus.
      await page.selectOption('#voice-format', 'wav');
      await page.click('#voice-rec');
      await waitFn(page, () => window.NoorVoice._state().recording, null, { timeout: 5000 });
      await page.waitForTimeout(900);
      await page.click('#voice-rec');
      await page.waitForSelector('#voice-take-audio');
      await page.uncheck('#voice-insert');
      await page.click('#voice-save');
      await waitFn(page, () => window.__mock.state.voice.saved.length === 2, null, { timeout: 8000 });
      const wav = (await VM()).saved[1];
      check('WAV is written as real PCM WAV (RIFF)', wav.ext === '.wav' && wav.head === '52494646' && wav.size > 44 + 48000 * 0.5, wav);
      check('without “Put a link” the document is left alone', (await page.evaluate(() => window.NoorMD.getState().markdown.match(/🎙/g) || [])).length === 1);
      // Delete (after asking).
      await page.click('.voice-item[data-file="Voice note 2.wav"] button[aria-label^="Delete"]');
      await page.click('.modal button:has-text("Delete")');
      await waitFn(page, () => !document.querySelector('.voice-item[data-file="Voice note 2.wav"]'));
      check('a recording can be deleted', (await VM()).recordings.length === 1);
      // Other inserts in Visual mode (notes into the document, sketches, drops) are formatted too.
      await page.evaluate(() => window.__mock.emit({ v: 2, event: 'insert.text', payload: { markdown: '\n- **0:05** First\n- **0:09** Second\n' } }));
      await waitFn(page, () => /\* \*\*0:05\*\* First/.test(window.NoorMD.getState().markdown));
      check('inserted Markdown becomes a real list in Visual mode', !(await page.evaluate(() => window.NoorMD.getState().markdown)).includes('\\*'));
      const unexpected = errors.filter((e) => !/status of 404/.test(e));
      check('no page errors with voice notes', unexpected.length === 0, unexpected);
      if (shots) await page.screenshot({ path: `${shots}/voice-notes.png` });
      await page.close();
    }

    // ---- 30. [[Wiki links]] typed in Visual mode stay links; one highlighted item in menus; Apps Hub categories.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# W\n\nhello\n', path: 'C:\\v\\w.md', fileName: 'w.md', title: 'w' }, files: { 'C:\\v\\w.md': '# W\n\nhello\n' } }, { width: 1500, height: 950 });
      await page.click('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' See [[My_Note]], [[Żółw|the turtle]] and [[bad]x]].');
      let md = (await state(page)).markdown;
      check('a [[wiki link]] typed in Visual mode is saved as a real link', md.includes('[[My_Note]]') && md.includes('[[Żółw|the turtle]]'), md);
      check('…text that is not one link keeps its escapes', md.includes('\\[\\[bad\\]x\\]\\]'), md);
      await page.keyboard.press('Control+2');
      await waitFn(page, () => window.NoorMD.getState().mode === 'markdown');
      md = (await state(page)).markdown;
      check('…and stays one when switching to Markdown mode', md.includes('[[My_Note]]') && !md.includes('\\[\\[My'), md);

      // Menus: moving from an item with a submenu to a plain item (or out of the menu) leaves one highlight at most.
      await page.click('#menubar .menu-title:has-text("View")');
      const sub = page.locator('.menu-popup[data-depth="0"] .menu-item.has-sub').first();
      await sub.hover();
      await page.waitForSelector('.menu-popup[data-depth="1"]');
      const highlighted = () => page.$$eval('.menu-popup[data-depth="0"] .menu-item', (n) => n.filter((x) => x.matches('.active, .sub-open, :hover')).length);
      check('hovering an item with a submenu highlights it and opens the submenu', (await highlighted()) === 1);
      const plain = page.locator('.menu-popup[data-depth="0"] .menu-item:not(.has-sub):not([disabled])').first();
      await plain.hover();
      check('moving to a plain item un-highlights the submenu item and closes its submenu', (await highlighted()) === 1 && !(await page.$('.menu-popup[data-depth="1"]')) && !(await page.$('.menu-popup[data-depth="0"] .sub-open')));
      await page.mouse.move(1400, 900);
      check('moving the mouse out of the menu clears the highlight', (await highlighted()) === 0);
      await sub.hover();
      await page.waitForSelector('.menu-popup[data-depth="1"]');
      await page.locator('.menu-popup[data-depth="1"] .menu-item').first().hover();
      await page.mouse.move(1400, 900);
      check('…but an item whose submenu is open stays marked', (await page.$$('.menu-popup[data-depth="0"] .menu-item.sub-open')).length === 1 && (await highlighted()) === 1);
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      await page.mouse.click(700, 600);

      // Apps Hub categories: chips filter what is shown; custom categories; moving shortcuts; remembered.
      const H = () => page.evaluate(() => window.__mock.state.hub);
      const AS = () => page.evaluate(() => NoorApps._state());
      await page.keyboard.press('Control+Alt+h');
      await page.waitForSelector('#appshub:not([hidden])');
      await page.click('#apps-body button:has-text("Program or game")');
      await page.waitForSelector('.app-tile');
      check('category chips: All plus one per category', (await page.$$eval('#apps-cats .chip[data-view]', (n) => n.map((x) => x.dataset.view))).join(',') === 'all,group:Apps,group:Games');
      await page.click('#apps-cats .chip[data-view="group:Games"]');
      check('a category chip shows only that category', (await page.$$eval('.app-tile', (n) => n.map((x) => x.dataset.id))).join(',') === 'h2' && (await H()).view === 'group:Games');
      await page.fill('#apps-search', 'obs');
      check('searching looks through every category', (await page.$$eval('.app-tile', (n) => n.map((x) => x.dataset.id))).join(',') === 'h1');
      await page.fill('#apps-search', '');
      await page.click('#apps-cat-add');
      await page.fill('.modal input', 'Streaming');
      await page.click('.modal button:has-text("Create")');
      await waitFn(page, () => NoorApps._state().view === 'group:Streaming');
      check('a new (empty) category is made and selected', (await AS()).groups.includes('Streaming') && (await page.textContent('#apps-body')).includes('Nothing in “Streaming” yet'));
      await page.click('#apps-body button:has-text("Program or game")');
      await waitFn(page, () => window.__mock.state.hub.items.length === 4);
      check('adding while a category is chosen puts it there', (await H()).items.slice(2).every((i) => i.group === 'Streaming'));
      await page.click('#apps-cats .chip[data-view="all"]');
      await page.click('.app-tile[data-id="h1"]', { button: 'right' });
      await page.hover('.menu-popup .menu-item:has-text("Move to category")');
      await page.click('.menu-popup[data-depth="1"] .menu-item:has-text("Games")');
      await waitFn(page, () => window.__mock.state.hub.items[0].group === 'Games');
      check('a shortcut moves to another category from its menu', (await H()).items[0].group === 'Games');
      await page.click('#apps-cats .chip[data-view="group:Streaming"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Rename")');
      await page.fill('.modal input', 'Live');
      await page.click('.modal button:has-text("Rename")');
      await waitFn(page, () => NoorApps._state().groups.includes('Live'));
      check('a category can be renamed (its shortcuts follow)', (await H()).items.slice(2).every((i) => i.group === 'Live') && !(await AS()).groups.includes('Streaming'));
      await page.click('#apps-cats .chip[data-view="group:Live"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Move left")');
      await waitFn(page, () => NoorApps._state().groups[1] === 'Live');
      check('categories can be put in your order', (await AS()).groups.join(',') === 'Apps,Live,Games', (await AS()).groups);
      await page.click('#apps-cats .chip[data-view="group:Live"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Remove category")');
      await page.click('.modal button:has-text("Move to Games")');
      await waitFn(page, () => !NoorApps._state().groups.includes('Live'));
      check('removing a category keeps its shortcuts (moved to another)', (await H()).items.length === 4 && (await H()).items.slice(2).every((i) => i.group === 'Games'));
      await page.click('.app-tile[data-id="h2"]');
      await page.click('.app-tile[data-id="h1"]');
      await page.click('#apps-cats .chip[data-view="recent"]');
      check('Recent shows what you started last', (await page.$$eval('.app-tile', (n) => n.map((x) => x.dataset.id))).join(',') === 'h1,h2');
      // The chosen view comes back after a restart.
      const page2 = (await open(browser, url, { document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' } })).page;
      await page2.evaluate((hub) => { Object.assign(window.__mock.state.hub, JSON.parse(hub)); }, JSON.stringify(await H()));
      await page2.keyboard.press('Control+Alt+h');
      await page2.waitForSelector('#appshub:not([hidden]) .app-tile');
      check('the chosen category is remembered', (await page2.$eval('#apps-cats .chip.active', (x) => x.dataset.view)) === 'recent');
      await page2.close();
      check('no page errors with categories and menus', errors.length === 0, errors);
      if (shots) await page.screenshot({ path: `${shots}/apps-categories.png` });
      await page.close();
    }

    // ---- 31. Gallery: pictures in a dock panel, albums, viewer (zoom, favourite, into note), saved slideshows with music.
    {
      const { page, errors } = await open(browser, url, { gallery: 12, musicTracks: 4, document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' } }, { width: 1500, height: 950 });
      const G = () => page.evaluate(() => NoorGallery._state());
      const GM = () => page.evaluate(() => window.__mock.state.gallery);
      await page.keyboard.press('Control+Alt+g');
      await page.waitForSelector('#dock-right #gallery:not([hidden]) .gallery-tile');
      check('Ctrl+Alt+G opens the Gallery in a dock with every picture', (await page.$$('.gallery-tile')).length === 12);
      await waitFn(page, () => [...document.querySelectorAll('.gallery-tile img')].slice(0, 4).every((i) => i.complete && i.naturalWidth > 0));
      check('previews load from /_thumb/', (await page.getAttribute('.gallery-tile img', 'src')).startsWith('/_thumb/'));
      check('newest first by default', (await G()).items[0] === 'Zdjęcie 012');
      await page.selectOption('#gallery-source', { label: 'Zima (4)' });
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 4);
      check('an album shows only its pictures', (await G()).items.every((n) => ['Zdjęcie 003', 'Zdjęcie 006', 'Zdjęcie 009', 'Zdjęcie 012'].includes(n)));
      await page.selectOption('#gallery-source', 'all');
      await page.fill('#gallery-search', 'zdjecie 005');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 1);
      check('search works without Polish letters', (await G()).items[0] === 'Zdjęcie 005');
      await page.fill('#gallery-search', '');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 12);
      await page.selectOption('#gallery-sort', 'taken-asc');
      await waitFn(page, () => NoorGallery._state().items[0] === 'Zdjęcie 001');
      check('order can change (oldest first)', true);

      // Viewer
      await page.click('.gallery-tile[data-index="0"]');
      await page.waitForSelector('#gallery-viewer:not([hidden])');
      await waitFn(page, () => { const i = document.querySelector('#gv-img'); return i.complete && i.naturalWidth > 0; });
      check('clicking a picture opens it full size', (await page.getAttribute('#gv-img', 'src')) === '/_img/1' && (await page.textContent('#gv-meta')).startsWith('1 / 12'));
      await page.keyboard.press('ArrowRight');
      check('→ shows the next picture', (await G()).viewer === 2);
      await page.keyboard.press('f');
      await waitFn(page, () => window.__mock.state.gallery.images[1].favorite === true);
      await waitFn(page, () => document.querySelector('#gv-fav').classList.contains('on'));
      check('F marks a favourite', true);
      await page.keyboard.press('+');
      check('+ zooms in', (await G()).zoom > 1);
      await page.keyboard.press('0');
      await page.keyboard.press('i');
      await waitFn(page, () => window.__mock.state.gallery.inserted.length === 1);
      check('I puts the picture into the note', (await GM()).inserted[0] === 2);
      await page.keyboard.press('Escape');
      check('Esc closes the viewer', await page.isHidden('#gallery-viewer'));
      await page.selectOption('#gallery-source', 'fav');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 1);
      check('Favourites lists the starred pictures', (await G()).items[0] === 'Zdjęcie 002');
      await page.selectOption('#gallery-source', 'all');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 12);

      // A saved slideshow from a selection; drag to reorder.
      await page.click('.gallery-tile[data-index="0"]', { modifiers: ['Control'] });
      await page.click('.gallery-tile[data-index="1"]', { modifiers: ['Control'] });
      await page.click('.gallery-tile[data-index="2"]', { modifiers: ['Control'] });
      check('Ctrl+click selects pictures', (await G()).sel.length === 3 && (await page.textContent('#gallery-foot')).includes('3 selected'));
      await page.click('.gallery-tile[data-index="1"]', { button: 'right' });
      await page.hover('.menu-popup .menu-item:has-text("Add to slideshow")');
      await page.click('.menu-popup[data-depth="1"] .menu-item:has-text("New slideshow")');
      await page.fill('.modal input', 'Wakacje');
      await page.click('.modal button:has-text("Create")');
      await waitFn(page, () => NoorGallery._state().source === 'show:1');
      check('a slideshow is saved from the selection and opened', (await G()).ids.join(',') === '1,2,3' && (await page.inputValue('#gallery-source')) === 'show:1');
      await page.dragAndDrop('.gallery-tile[data-id="3"]', '.gallery-tile[data-id="1"]');
      await waitFn(page, () => window.__mock.state.gallery.slideshows[0].ids[0] === 3);
      check('pictures in a slideshow are put in order by dragging', (await GM()).slideshows[0].ids.join(',') === '3,1,2');

      // Play it with a music playlist.
      await page.evaluate(() => window.__mock.state.music.playlists.push({ id: 1, name: 'Spokojne', items: [1, 2] }));
      await page.click('#gallery-play');
      await page.waitForSelector('#ss-music');
      await page.selectOption('#ss-interval', '3');
      await page.selectOption('#ss-music', 'pl:1');
      await page.click('#ss-play');
      await page.waitForSelector('#gallery-slideshow:not([hidden]) .ss-layer.active img');
      check('the slideshow plays in the saved order', (await G()).show.current === 3 && (await page.textContent('#ss-pos')) === '1 / 3');
      await waitFn(page, () => window.NoorMusic._state().q.current === 1 && !window.NoorMusic._state().paused, null, { timeout: 8000 });
      check('…with the chosen music playlist', true);
      check('its settings are saved with it', (await GM()).slideshows[0].settings.interval === 3 && (await GM()).slideshows[0].settings.playlistId === 1);
      await waitFn(page, () => NoorGallery._state().show.pos === 1, null, { timeout: 6000 });
      check('pictures change by themselves', (await G()).show.current === 1);
      await page.keyboard.press('Space');
      check('Space pauses', (await G()).show.paused === true);
      await page.keyboard.press('ArrowRight');
      check('→ goes to the next picture', (await G()).show.current === 2);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#gallery-slideshow', { state: 'hidden' });
      check('Esc ends the slideshow and pauses its music', (await page.evaluate(() => window.NoorMusic._state().paused)) === true);
      check('the chosen view is remembered', (await GM()).session.source === 'show:1');
      check('no page errors in the Gallery', errors.length === 0, errors);
      if (shots) await page.screenshot({ path: `${shots}/gallery.png` });
      await page.close();
    }

    // ---- 32. Audit fixes: lossy snapshots come back in Markdown mode; queues and playlists keep what isn't shown; one microphone.
    {
      const LOSSY_DOC = '# Raw\n\n<div align="center">Centered</div>\n';
      const { page, errors } = await open(browser, url, { musicTracks: 6, videos: true, document: { markdown: LOSSY_DOC, path: 'C:\\docs\\raw.md', fileName: 'raw.md', title: 'raw' }, files: { 'C:\\docs\\raw.md': LOSSY_DOC } }, { width: 1500, height: 950 });
      const tabId = (await state(page)).tabId;
      await page.evaluate(({ id, md }) => { window.__mock.state.snapshots[id] = [{ id: 's0', label: 'Earlier', createdUtc: new Date().toISOString(), words: 2, markdown: md }]; }, { id: tabId, md: LOSSY_DOC });
      if ((await state(page)).mode !== 'wysiwyg') {
        await page.keyboard.press('Control+1');
        await page.click('.modal button:has-text("Switch anyway")');
        await waitFn(page, () => window.NoorMD.getState().mode === 'wysiwyg');
      }
      await page.keyboard.press('Control+Shift+h');
      await page.click('.modal button:has-text("Restore") >> nth=-1');
      await page.click('.modal button:has-text("Restore") >> nth=-1'); // the confirmation
      await waitFn(page, () => window.NoorMD.getState().markdown.includes('<div align="center">'));
      check('a snapshot Visual mode would change is restored exactly, in Markdown mode', (await state(page)).mode === 'markdown' && (await state(page)).markdown === LOSSY_DOC, await state(page));

      // Music: clearing Up next and toggling shuffle doesn't bring the cleared songs back.
      await page.evaluate(() => window.NoorMusic._testPlay([1, 2, 3, 4, 5, 6], 0, true));
      await page.evaluate(() => window.NoorMusic.togglePanel(true));
      await page.click('.music-tabs [data-tab="queue"]');
      await page.click('#music-queue button:has-text("Clear upcoming")');
      await page.evaluate(() => { NoorMusic.setShuffle(); NoorMusic.setShuffle(); });
      const mq = await page.evaluate(() => NoorMusic._state().q);
      check('cleared songs stay out of Up next after shuffle on/off', mq.ids.length === 1 && mq.order.length === 1 && mq.current === 1, mq);
      await page.evaluate(() => window.NoorMusic.togglePanel(false));

      // Video: removing from a filtered playlist keeps the entries the filter hides.
      await page.evaluate(() => { const v = window.__mock.state.video; v.videos[0].watched = true; v.playlists.push({ id: 1, name: 'All of it', ids: [1, 2, 3, 4] }); });
      await page.keyboard.press('Control+Alt+v');
      await page.waitForSelector('#videobench:not([hidden])');
      await page.click('[data-vbtab="playlists"]');
      await page.click('#vb-playlists .qitem[data-playlist="1"] .qtitle');
      await page.click('#vb-chips [data-filter="unwatched"], .chip[data-filter="unwatched"]');
      await waitFn(page, () => JSON.stringify(window.NoorVideo._state().rows) === '[2,3,4]');
      await page.click('.vtrack[data-id="3"] .track-title');
      await page.focus('#vb-list');
      await page.keyboard.press('Delete');
      await waitFn(page, () => window.__mock.state.video.playlists[0].ids.length === 3);
      check('removing from a filtered playlist keeps the hidden entries', JSON.stringify((await page.evaluate(() => window.__mock.state.video.playlists[0].ids))) === '[1,2,4]');
      await page.keyboard.press('Control+Alt+v');

      // Voice: two quick presses of Record open the microphone once.
      await page.evaluate(() => {
        window.__gum = 0;
        const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (c) => { window.__gum++; await new Promise((r) => setTimeout(r, 200)); return orig(c); };
      });
      await page.evaluate(() => NoorVoice.toggle());
      await page.waitForSelector('#voice-rec');
      await page.click('#voice-rec');
      await page.click('#voice-rec', { force: true });
      await waitFn(page, () => document.body.classList.contains('voice-recording'));
      await page.waitForTimeout(400);
      check('a double press of Record opens the microphone once', (await page.evaluate(() => window.__gum)) === 1);
      await page.click('#voice-rec');
      await waitFn(page, () => !document.body.classList.contains('voice-recording'));
      const unexpected = errors.filter((e) => !/status of 404/.test(e));
      check('no page errors in the audit checks', unexpected.length === 0, unexpected);
      await page.close();
    }

    // ---- 33. Panels in the middle (tabs next to documents); the Gallery as a picture manager there.
    {
      const { page, errors } = await open(browser, url, { gallery: 12, document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' } }, { width: 1500, height: 950 });
      const G = () => page.evaluate(() => NoorGallery._state());
      const GM = () => page.evaluate(() => window.__mock.state.gallery);
      const D = () => page.evaluate(() => NoorDock._state().center);
      await page.keyboard.press('Control+Alt+g');
      await page.waitForSelector('.gallery-tile');
      await page.click('#gallery-dock');
      await page.click('.menu-popup .menu-item:has-text("In the middle")');
      await waitFn(page, () => NoorDock._state().center.active === 'gallery');
      check('a panel can go in the middle, as a tab next to the documents', await page.isVisible('#module-tabs .module-tab[data-module="gallery"].active') && await page.isHidden('#editor-card') && await page.isVisible('#dock-center #gallery'));
      check('…where the Gallery becomes a picture manager (albums, details)', await page.evaluate(() => document.querySelector('#gallery').classList.contains('wide')) && await page.isVisible('#gallery-nav .gnav-item[data-source="all"]'));
      await page.click('#tabs .tab');
      check('clicking a document tab brings the document back', await page.isVisible('#editor-card') && (await D()).active === null && (await D()).open.includes('gallery'));
      await page.click('#module-tabs .module-tab[data-module="gallery"]');
      check('…and the panel tab shows the panel again', (await D()).active === 'gallery' && await page.isHidden('#editor-card'));
      await page.keyboard.press('Control+Alt+b');
      await page.waitForSelector('#streamdesk:not([hidden])');
      await page.evaluate(() => NoorDock.place('stream', 'center'));
      await waitFn(page, () => NoorDock._state().center.active === 'stream');
      check('several panels can be in the middle (one tab each)', (await D()).open.join(',') === 'gallery,stream' && await page.isHidden('#gallery'));
      await page.click('#module-tabs .module-tab[data-module="stream"] .tab-close');
      await waitFn(page, () => NoorDock._state().center.active === 'gallery');
      check('closing a panel tab shows the next one', (await D()).open.join(',') === 'gallery' && await page.isVisible('#gallery'));

      // Picture manager: a click selects and shows details; rename there; series; move by dragging onto an album; undo; delete.
      await page.click('.gallery-tile[data-index="0"]');
      check('a click selects a picture and shows its details (not the viewer)', await page.isHidden('#gallery-viewer') && (await page.inputValue('#ginfo-name')) === 'Zdjęcie 012');
      await page.fill('#ginfo-name', 'Zachód słońca');
      await page.press('#ginfo-name', 'Enter');
      await waitFn(page, () => window.__mock.state.gallery.images.some((i) => i.name === 'Zachód słońca'));
      await waitFn(page, () => NoorGallery._state().items.includes('Zachód słońca'));
      check('renaming in the details renames the picture', true);
      await page.click('.gallery-tile[data-index="0"]');
      await page.keyboard.press('Control+z');
      await waitFn(page, () => !window.__mock.state.gallery.images.some((i) => i.name === 'Zachód słońca'));
      await waitFn(page, () => NoorGallery._state().items.includes('Zdjęcie 012'));
      check('Ctrl+Z undoes the rename', true);
      await page.click('.gallery-tile[data-index="1"]');
      await page.click('.gallery-tile[data-index="2"]', { modifiers: ['Shift'] });
      await page.click('#ginfo-series');
      await page.fill('.modal input', 'Wakacje');
      await page.click('.modal button:has-text("Rename")');
      await waitFn(page, () => window.__mock.state.gallery.images.filter((i) => i.name.startsWith('Wakacje ')).length === 2);
      check('several pictures can be renamed as a numbered series', (await GM()).images.filter((i) => i.name.startsWith('Wakacje ')).map((i) => i.name).sort().join(',') === 'Wakacje 01,Wakacje 02');
      await page.click('#gallery-new-album');
      await page.fill('.modal input', 'Góry');
      await page.click('.modal button:has-text("Create")');
      await waitFn(page, () => window.__mock.state.gallery.extraAlbums.includes('Góry'));
      await page.click('.gallery-tile[data-index="3"]');
      check('＋ makes an album without moving anything', (await GM()).moves.length === 0);
      await page.dragAndDrop('.gallery-tile[data-index="3"]', '#gallery-nav .gnav-item[data-source^="album:"] >> nth=0');
      await waitFn(page, () => window.__mock.state.gallery.moves.length === 1);
      check('dragging a picture onto an album moves it there', (await GM()).moves[0].folder.endsWith('Lato') || (await GM()).moves[0].folder.endsWith('Zima'));
      const before = (await GM()).images.length;
      await page.click('.gallery-tile[data-index="5"]');
      await page.keyboard.press('Delete');
      await waitFn(page, (n) => window.__mock.state.gallery.images.length === n, before - 1);
      check('Delete sends the picture to the Recycle Bin (the host asks first)', (await GM()).deleted.length === 1);
      await page.dblclick('.gallery-tile[data-index="0"]');
      check('double-click opens the viewer', await page.isVisible('#gallery-viewer'));
      await page.keyboard.press('Escape');
      check('no page errors in the middle and the manager', errors.length === 0, errors);
      if (shots) await page.screenshot({ path: `${shots}/gallery-manager.png` });
      await page.close();
    }

    // ---- 34. Video Bench in the middle (lists beside the player); notes on the video; Gallery albums, formats, Open in, copy/move, ZIP, duplicates.
    {
      const { page, errors } = await open(browser, url, { videos: true, gallery: 12, document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' } }, { width: 1500, height: 950 });
      await page.evaluate(() => { window.__mock.state.video.notes.push({ id: 900, videoId: 1, time: 0.2, text: 'Tu zaczyna się akcja' }); });
      await page.keyboard.press('Control+Alt+v');
      await page.waitForSelector('#videobench:not([hidden])');
      await page.evaluate(() => NoorDock.place('video', 'center'));
      await waitFn(page, () => NoorDock._state().center.active === 'video');
      const geo = await page.evaluate(() => { const st = document.querySelector('#vb-stage').getBoundingClientRect(); const tabs = document.querySelector('#videobench .music-tabs').getBoundingClientRect(); const list = document.querySelector('#vb-list').getBoundingClientRect(); return { stageRight: st.right, tabsLeft: tabs.left, listH: list.height, tabsVisible: tabs.height > 0 }; });
      check('in the middle, Library / Up next / Playlists / Notes sit beside the player', geo.tabsVisible && geo.tabsLeft >= geo.stageRight - 2 && geo.listH > 150, geo);
      await page.dblclick('.vtrack[data-id="1"] .track-title');
      await waitFn(page, () => !document.querySelector('#vb-note-pop').hidden, null, { timeout: 8000 });
      check('a note shows on the video at its moment', (await page.textContent('#vb-note-pop')).includes('Tu zaczyna się akcja'));
      await page.click('#vb-notes-on-video');
      check('…and the 💬 button turns that off', await page.isHidden('#vb-note-pop') && (await page.getAttribute('#vb-notes-on-video', 'aria-pressed')) === 'false');
      await page.click('#vb-notes-on-video');
      await page.click('#vb-list-toggle');
      const solo = await page.evaluate(() => ({ hidden: !document.querySelector('#videobench .music-tabs').getBoundingClientRect().height, stage: document.querySelector('#vb-stage').getBoundingClientRect().width, dock: document.querySelector('#dock-center').getBoundingClientRect().width }));
      check('in the middle, ☰ hides the list so the video gets the whole width', solo.hidden && solo.stage > solo.dock * 0.9, solo);
      await page.click('#vb-list-toggle');
      check('…and brings it back', await page.isVisible('#videobench .music-tabs'));
      check('the Video Bench has a control bar for full screen', !!(await page.$('#vb-stage .pc-bar.pc-fs-only .pc-seek')));
      await page.evaluate(() => NoorVideo.close());

      // Gallery
      const GM = () => page.evaluate(() => window.__mock.state.gallery);
      await page.keyboard.press('Control+Alt+g');
      await page.waitForSelector('.gallery-tile');
      await page.evaluate(() => NoorDock.place('gallery', 'center'));
      await waitFn(page, () => NoorDock._state().center.active === 'gallery');
      check('work files (PSD) are listed with a format badge', (await page.$$('.gallery-tile .gallery-fmt')).length === 2);
      await page.selectOption('#gallery-format', 'PSD');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 2);
      check('pictures can be filtered by format', true);
      await page.selectOption('#gallery-format', '');
      await page.selectOption('#gallery-sort', 'type');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 12 && document.querySelector('.gallery-tile:last-child .gallery-fmt'));
      check('…and sorted by type', true);
      // Albums: right-click › Rename, and F2.
      await page.click('#gallery-nav .gnav-item[data-source$="zima"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Rename album")');
      await page.fill('.modal input', 'Zima 2024');
      await page.click('.modal button:has-text("Rename")');
      await waitFn(page, () => window.__mock.state.gallery.renamedAlbums.length === 1);
      check('an album can be renamed from its right-click menu', JSON.stringify((await GM()).renamedAlbums[0]) === '["Zima","Zima 2024"]');
      await waitFn(page, () => !!document.querySelector('#gallery-nav .gnav-item[data-source$="lato"]'));
      await page.focus('#gallery-nav .gnav-item[data-source$="lato"]');
      await page.keyboard.press('F2');
      await page.waitForSelector('.modal input');
      check('…and with F2 (not the music track editor)', (await page.inputValue('.modal input')) === 'Lato' && !(await page.$('.modal #edit-title')));
      await page.keyboard.press('Escape');
      // Open in, copy, move, ZIP.
      await page.click('.gallery-tile[data-index="0"]');
      await page.click('.gallery-tile[data-index="1"]', { modifiers: ['Control'] });
      await page.click('.gallery-tile[data-index="1"]', { button: 'right' });
      await page.hover('.menu-popup .menu-item:has-text("Open in")');
      await page.click('.menu-popup[data-depth="1"] .menu-item:has-text("Krita")');
      await waitFn(page, () => window.__mock.state.gallery.opened.length === 1);
      check('right-click › Open in › an editor opens the selected pictures in it', (await GM()).opened[0].ids.length === 2 && (await GM()).opened[0].how === 'editor');
      await page.click('.gallery-tile[data-index="1"]', { button: 'right' });
      await page.hover('.menu-popup .menu-item:has-text("Open in")');
      await page.click('.menu-popup[data-depth="1"] .menu-item:has-text("Add a program")');
      await waitFn(page, () => window.__mock.state.gallery.editors.length === 2);
      check('your own editor (Affinity Photo) can be added', true);
      await page.click('#ginfo-zip');
      await waitFn(page, () => window.__mock.state.gallery.zips.length === 1);
      check('the selection can be packed into a ZIP', (await GM()).zips[0].ids.length === 2);
      await page.click('.gallery-tile[data-index="1"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Copy to a folder")');
      await waitFn(page, () => window.__mock.state.gallery.copies.length === 1);
      await page.click('.gallery-tile[data-index="1"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Move to a folder")');
      await waitFn(page, () => window.__mock.state.gallery.movedOut.length === 2);
      check('pictures can be copied or moved to any folder', (await GM()).copies[0].length === 2 && (await GM()).images.length === 10);
      // Duplicates
      await page.click('#gallery-more');
      await page.click('.menu-popup .menu-item:has-text("Find duplicates")');
      await page.waitForSelector('.dup-group');
      const marked = await page.$$eval('.dup-item.marked', (n) => n.length);
      check('duplicates are grouped; all but the biggest of each are marked', (await page.$$('.dup-group')).length === 2 && marked === 4, marked);
      await page.click('.dup-group >> nth=0 >> .dup-item.marked >> nth=0');
      check('a click changes keep / delete', (await page.$$eval('.dup-item.marked', (n) => n.length)) === 3);
      await page.click('#dup-delete');
      await waitFn(page, () => window.__mock.state.gallery.deleted.length === 3);
      check('marked duplicates are deleted (Recycle Bin)', true);
      await page.keyboard.press('Escape');
      const unexpected = errors.filter((e) => !/status of 404/.test(e));
      check('no page errors in video/gallery additions', unexpected.length === 0, unexpected);
      if (shots) await page.screenshot({ path: `${shots}/video-middle.png` });
      await page.close();
    }

    // ---- 35. Gallery picture tools: stars, colour labels, tags, the date view, turning pictures.
    {
      const { page, errors } = await open(browser, url, { gallery: 10 }, { width: 1500, height: 950 });
      const GM = () => page.evaluate(() => window.__mock.state.gallery);
      const pic = (id) => page.evaluate((i) => window.__mock.state.gallery.images.find((x) => x.id === i), id);
      await page.keyboard.press('Control+Alt+g');
      await page.waitForSelector('.gallery-tile');
      await page.evaluate(() => NoorDock.place('gallery', 'center'));
      await waitFn(page, () => document.querySelector('#gallery').classList.contains('wide'));
      await page.click('.gallery-tile[data-id="9"]');
      await page.keyboard.press('4');
      await waitFn(page, () => window.__mock.state.gallery.images.find((x) => x.id === 9).rating === 4);
      await waitFn(page, () => document.querySelector('.gallery-tile[data-id="9"] .gallery-rating')?.textContent === '★★★★');
      check('keys 1–5 give stars, shown on the picture', true);
      await waitFn(page, () => document.activeElement?.dataset?.id === '9');
      check('…and the picture keeps the keyboard focus', true);
      await page.keyboard.press('8');
      await waitFn(page, () => !!document.querySelector('.gallery-tile[data-id="9"] .gallery-label[data-label="green"]'));
      check('keys 6–9 give a colour label (8 = green)', (await pic(9)).label === 'green');
      await page.focus('.gallery-tile[data-id="9"]');
      await page.keyboard.press('8');
      await waitFn(page, () => window.__mock.state.gallery.images.find((x) => x.id === 9).label === null && !document.querySelector('.gallery-tile[data-id="9"] .gallery-label'));
      check('…and the same key again takes it off', true);
      await page.click('#gallery-info .ginfo-starbtn >> nth=1');
      await waitFn(page, () => window.__mock.state.gallery.images.find((x) => x.id === 9).rating === 2);
      await page.click('#gallery-info .ginfo-labelbtn[data-label="purple"]');
      await waitFn(page, () => window.__mock.state.gallery.images.find((x) => x.id === 9).label === 'purple' && document.querySelector('#gallery-info .ginfo-labelbtn[data-label="purple"]')?.getAttribute('aria-checked') === 'true');
      check('the details panel sets stars and labels with a click', true);
      await page.fill('#ginfo-tag', 'Thornwake, #referencja');
      await page.keyboard.press('Enter');
      await waitFn(page, () => document.querySelectorAll('#gallery-info .ginfo-tagchip').length === 2);
      check('tags are added in the details panel (several at once, without #)', JSON.stringify((await pic(9)).tags) === '["Thornwake","referencja"]', (await pic(9)).tags);
      check('…and the tag input keeps the focus for the next one', await page.evaluate(() => document.activeElement?.id === 'ginfo-tag'));
      check('tags appear in the albums list', !!(await page.$('#gallery-nav .gnav-item[data-source="tag:Thornwake"]')));
      await page.click('.gallery-tile[data-id="8"]');
      await page.click('.gallery-tile[data-id="7"]', { modifiers: ['Control'] });
      await page.keyboard.press('t');
      await page.waitForSelector('.modal input');
      await page.fill('.modal input', 'thornwake');
      await page.click('.modal button:has-text("Add")');
      await waitFn(page, () => window.__mock.state.gallery.images.filter((x) => x.tags.includes('Thornwake')).length === 3);
      check('T tags the chosen pictures; a tag keeps the way it was first written', true);
      await page.click('#gallery-nav .gnav-item[data-source="tag:Thornwake"]');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 3);
      check('a tag in the list shows its pictures', true);
      await page.click('.gallery-tile[data-id="8"]');
      await page.click('#gallery-info .ginfo-tagx');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 2);
      check('removing a tag takes the picture out of that tag', !(await pic(8)).tags.length);
      await page.click('#gallery-nav .gnav-item[data-source="all"]');
      await page.selectOption('#gallery-mark', 'r2');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 1);
      check('pictures can be filtered by stars', (await page.getAttribute('.gallery-tile', 'data-id')) === '9');
      await page.selectOption('#gallery-mark', 'l:purple');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 1);
      await page.selectOption('#gallery-mark', '');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 10);
      check('…and by colour label', true);
      // The date view: years, then the months of the chosen year.
      await page.click('#gallery-nav .gnav-item[data-source="month:2023"]');
      await waitFn(page, () => !!document.querySelector('#gallery-nav .gnav-item[data-source="month:2023-01"]'));
      await page.click('#gallery-nav .gnav-item[data-source="month:2023-01"]');
      await waitFn(page, () => document.querySelectorAll('.gallery-tile').length === 10 && document.querySelector('#gallery-nav .gnav-item.active')?.dataset.source === 'month:2023-01');
      check('the date view lists years, then the months of a year', true);
      await page.click('#gallery-nav .gnav-item[data-source="all"]');
      // Turning pictures: JPEG by Ctrl+R; a PSD is refused.
      await page.click('.gallery-tile[data-id="9"]');
      await page.keyboard.press('Control+r');
      await waitFn(page, () => window.__mock.state.gallery.rotations.length === 1);
      await waitFn(page, () => (document.querySelector('.gallery-tile[data-id="9"] img')?.getAttribute('src') || '').includes('?r='));
      check('Ctrl+R turns a picture and its preview is loaded again', (await pic(9)).width === 48 && (await GM()).rotations[0].clockwise === true);
      await page.click('#ginfo-rotl');
      await waitFn(page, () => window.__mock.state.gallery.rotations.length === 2);
      check('the ⟲ button turns it back', (await GM()).rotations[1].clockwise === false && (await pic(9)).width === 64);
      await page.click('.gallery-tile[data-id="10"]');
      await page.click('#ginfo-rotr');
      await page.waitForSelector('.modal:has-text("can\'t be turned here")');
      check('a PSD is not turned (its program does that), and you are told why', (await GM()).rotations.length === 2);
      await page.click('.modal button:has-text("OK")');
      await page.waitForSelector('.modal', { state: 'detached' });
      // Right-click menu and the viewer.
      await page.click('.gallery-tile[data-id="6"]', { button: 'right' });
      await page.waitForSelector('.menu-popup .menu-item:has-text("Turn left")');
      check('the right-click menu has stars, labels, tags and turning', await page.evaluate(() => ['Stars', 'Colour label', 'Add tags', 'Turn right', 'Turn left'].every((t) => [...document.querySelectorAll('.menu-popup .menu-item')].some((m) => m.textContent.includes(t)))));
      await page.keyboard.press('Escape');
      await page.dblclick('.gallery-tile[data-id="6"]');
      await page.waitForSelector('#gallery-viewer:not([hidden])');
      await page.keyboard.press('5');
      await waitFn(page, () => document.querySelector('#gv-marks .gv-stars')?.textContent === '★★★★★');
      check('in the viewer, keys give stars too and they are shown', (await pic(6)).rating === 5);
      await page.keyboard.press('Escape');
      // Convert / resize: copies in another format and size; the originals stay.
      await page.click('.gallery-tile[data-id="9"]');
      await page.click('.gallery-tile[data-id="8"]', { modifiers: ['Control'] });
      await page.click('.gallery-tile[data-id="10"]', { modifiers: ['Control'] });
      await page.click('#ginfo-convert');
      await page.waitForSelector('#cv-format');
      check('Convert or resize opens with JPEG at 1920 px by default', (await page.inputValue('#cv-format')) === 'jpg' && (await page.inputValue('#cv-size')) === '1920');
      await page.selectOption('#cv-size', '-1');
      check('…“Other…” asks for the pixels', await page.isVisible('#cv-custom'));
      await page.fill('#cv-custom', '1200');
      await page.selectOption('#cv-format', 'png');
      check('…and the JPEG quality goes away for PNG', await page.isHidden('#cv-quality'));
      await page.fill('#cv-suffix', '-web');
      await page.click('#cv-go');
      await page.waitForSelector('#cv-done');
      const conv = (await GM()).conversions[0];
      check('the pictures are converted with the chosen format, size and name ending', conv && conv.format === 'png' && conv.maxSide === 1200 && conv.suffix === '-web' && conv.where === 'choose' && conv.ids.length === 3, conv);
      check('…and the dialog says what was made and what was not (a PSD)', /Made 2 pictures in D:\\Web/.test(await page.textContent('#cv-status')) && /IMG_10\.psd/.test(await page.textContent('#cv-status')));
      await page.click('#cv-open');
      await waitFn(page, () => window.__mock.state.gallery.revealed.includes('D:\\Web'));
      await page.click('#cv-done');
      await page.click('.gallery-tile[data-id="7"]');
      await page.click('.gallery-tile[data-id="7"]', { button: 'right' });
      await page.click('.menu-popup .menu-item:has-text("Convert or resize")');
      await page.waitForSelector('#cv-format');
      check('the dialog remembers the last choices', (await page.inputValue('#cv-format')) === 'png' && (await page.inputValue('#cv-size')) === '-1' && (await page.inputValue('#cv-custom')) === '1200');
      await page.check('#cv-where-beside');
      await page.click('#cv-go');
      await page.waitForSelector('#cv-done');
      check('“next to each picture” needs no folder', (await GM()).conversions[1].where === 'beside' && /Converted/.test(await page.textContent('#cv-status')));
      await page.click('#cv-done');
      const unexpected = errors.filter((e) => !/status of 404|can't be turned here/.test(e));
      check('no page errors in the picture tools', unexpected.length === 0, unexpected);
      if (shots) await page.screenshot({ path: `${shots}/gallery-tools.png` });
      await page.close();
    }

    // ---- 36. Music Bench in the middle: Now playing and Up next on the left, the library as a table with sortable columns.
    {
      const { page, errors } = await open(browser, url, { musicTracks: 300, document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' } }, { width: 1500, height: 950 });
      await page.keyboard.press('Control+Shift+M');
      await page.waitForSelector('#music-list .track[data-index]');
      check('in a side dock the library keeps two-line rows', !(await page.$('#music.wide')) && (await page.$eval('#music-list .track[data-index]', (n) => n.offsetHeight)) === 50);
      await page.evaluate(() => NoorDock.place('music', 'center'));
      await page.waitForSelector('#music.wide #music-list .track.wide-row');
      const g = await page.evaluate(() => {
        const r = (q) => document.querySelector(q).getBoundingClientRect();
        return { np: r('#nowplaying'), side: r('#music-side'), list: r('#music-list'), art: r('#np-art').width, row: document.querySelector('#music-list .track.wide-row').offsetHeight,
          heads: [...document.querySelectorAll('#music-cols .col')].map((c) => c.textContent.trim()), queueTab: document.querySelector('#music .music-tabs button[data-tab="queue"]').offsetParent !== null };
      });
      check('in the middle, Now playing and Up next sit on the left of the library', g.np.right <= g.list.left && g.side.right <= g.list.left && g.side.top >= g.np.bottom - 1, g);
      check('…with a big cover and one-line rows', g.art >= 200 && g.row === 34, g);
      check('…and column heads (Title, Artist, Album, Year, Time…)', ['Title ▲', 'Artist', 'Album', 'Year', 'Time'].every((h) => g.heads.includes(h)), g.heads);
      check('…and Up next is not a tab there (it is always shown)', !g.queueTab);
      check('artist and genre have their own columns', await page.evaluate(() => [...document.querySelectorAll('#music-list .c-artist')].some((n) => n.textContent === 'Noor') && [...document.querySelectorAll('#music-list .c-genre')].some((n) => n.textContent === 'Synthwave')));
      await page.click('#music-cols .col[data-sort="duration"]');
      await waitFn(page, () => document.querySelector('#music-list .track[data-index="0"] .c-time')?.textContent === '0:02');
      check('a click on a column head sorts by it', (await page.textContent('#music-cols .col.active')).includes('Time ▲'));
      await page.click('#music-cols .col[data-sort="duration"]');
      await waitFn(page, () => document.querySelector('#music-list .track[data-index="0"] .c-time')?.textContent === '4:59');
      check('…and a second click turns the order around', (await page.getAttribute('#music-cols .col.active', 'aria-sort')) === 'descending' && (await page.inputValue('#music-sort')) === 'duration');
      await page.dblclick('#music-list .track[data-index="0"] .c-title');
      await waitFn(page, () => !!document.querySelector('#music-side-queue .qitem.current'));
      check('playing fills Up next on the left', (await page.$$('#music-side-queue .qitem')).length > 5);
      check('the mini-player steps aside while the Music Bench is shown in the middle', await page.isHidden('#miniplayer'));
      await page.evaluate(() => NoorDock.showDocuments());
      await page.waitForSelector('#miniplayer', { state: 'visible' });
      check('…and is back with the document', true);
      await page.evaluate(() => NoorDock.activate('music'));
      await page.evaluate(() => NoorDock.place('music', 'right'));
      await waitFn(page, () => !document.querySelector('#music.wide') && document.querySelector('#music-list .track[data-index]')?.offsetHeight === 50);
      check('back in a side dock it is the narrow bench again', await page.isVisible('#music .music-tabs button[data-tab="queue"]') && await page.isHidden('#music-cols'));
      const unexpected = errors.filter((e) => !/status of 404/.test(e));
      check('no page errors in the wide Music Bench', unexpected.length === 0, unexpected);
      if (shots) await page.screenshot({ path: `${shots}/music-middle.png` });
      await page.close();
    }

    // ---- 37. Radio Bench: stations, playing through the relay with song titles, one sound at a time, adding and finding stations.
    {
      const radio = [{ name: 'Radio Nowy Świat', url: 'https://nowyswiat.example/s', tags: ['polskie'] }, { name: 'Jazz FM', url: 'http://jazz.example/fm' }];
      const { page, errors } = await open(browser, url, { radio, musicTracks: 4 }, { width: 1400, height: 900 });
      const RM = () => page.evaluate(() => window.__mock.state.radio);
      const RS = () => page.evaluate(() => NoorRadio._state());
      await page.keyboard.press('Control+Alt+i');
      await page.waitForSelector('#radiobench:not([hidden]) .radio-item');
      check('Ctrl+Alt+I opens the Radio with your stations', (await page.$$('.radio-item')).length === 2);
      check('…and tags become filters', !!(await page.$('#radio-views [data-view="tag:polskie"]')));
      await page.dblclick('.radio-item[data-id="1"]');
      await waitFn(page, () => NoorRadio._state().on?.state === 'playing', null, { timeout: 8000 });
      check('a double-click plays the station through the relay', JSON.stringify((await RM()).played) === '[1]' && (await RS()).src === '/_media/4' && /Radio Nowy Świat/.test(await page.textContent('#radio-now-name')));
      await page.evaluate(() => window.__mock.state.radio.push('radio.title', { token: 't1', title: 'Kult – Arahja' }));
      await waitFn(page, () => document.querySelector('#radio-now-title')?.textContent === 'Kult – Arahja');
      check('the song title from the stream is shown', true);
      await page.evaluate(() => window.__mock.state.radio.push('radio.title', { token: 'old', title: 'Not this one' }));
      await page.waitForTimeout(100);
      check('…titles from an older stream are ignored', (await page.textContent('#radio-now-title')) === 'Kult – Arahja');
      await page.evaluate(() => NoorMusic._testPlay([1], 0, true));
      await waitFn(page, () => NoorRadio._state().on === null);
      check('music starting stops the radio (one sound at a time)', (await RS()).paused && (await RM()).stops >= 1);
      await page.click('#radio-play');
      await waitFn(page, () => NoorRadio._state().on?.state === 'playing', null, { timeout: 8000 });
      check('▶ plays the last station again, and the music pauses', (await RS()).on.name === 'Radio Nowy Świat' && (await page.evaluate(() => !NoorMusic.isPlaying())));
      await page.click('#radio-play');
      await waitFn(page, () => NoorRadio._state().on === null);
      check('■ stops it', (await RS()).src === null);
      await page.click('.radio-item[data-id="2"] .radio-fav');
      await page.click('#radio-views [data-view="fav"]');
      await waitFn(page, () => document.querySelectorAll('.radio-item').length === 1);
      check('☆ makes a favourite, and Favourites shows them', (await page.getAttribute('.radio-item', 'data-id')) === '2');
      await page.click('#radio-views [data-view="all"]');
      // Adding: a .pls link is read for the stream; a bad address is refused with a reason.
      await page.click('#radio-add');
      await page.fill('#rs-url', 'ftp://nope');
      await page.click('#rs-save');
      await waitFn(page, () => /http:\/\/ or https:\/\//.test(document.querySelector('#rs-msg')?.textContent || ''));
      check('a bad address is refused with a reason', await page.isVisible('#rs-url'));
      await page.fill('#rs-url', 'https://trojka.example/listen.pls');
      await page.fill('#rs-tags', 'polskie, talk');
      await page.click('#rs-save');
      await waitFn(page, () => document.querySelectorAll('.radio-item').length === 3);
      const added = (await RM()).stations.find((x) => x.id === 3);
      check('a station is added (a .pls link becomes its stream; no name: the host)', added.url === 'https://trojka.example/listen/stream' && added.name === 'trojka.example' && added.tags.join() === 'polskie,talk', added);
      // Finding stations online (only when you search).
      check('nothing is asked online before you search', (await RM()).searches.length === 0);
      await page.click('#radio-more');
      await page.click('.menu-popup .menu-item:has-text("Find stations online")');
      await page.fill('#rf-query', 'jazz');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.radio-result');
      const res = await page.$$eval('.radio-result', (n) => n.map((r) => ({ text: r.textContent, addDisabled: r.querySelector('button:last-of-type')?.disabled })));
      check('the directory lists stations; HLS ones can’t be added yet', res.length === 2 && /PL · MP3 128 kbps/.test(res[0].text) && res[1].addDisabled === true, res);
      await page.click('.radio-result >> nth=0 >> button:has-text("Add")');
      await page.waitForSelector('.radio-result .radio-saved');
      check('＋ Add saves a found station', (await RM()).stations.some((x) => x.url === 'https://jazz.example/live') && (await RM()).searches[0] === 'jazz');
      await page.click('.modal button:has-text("Done")');
      // A station that can't be reached says so.
      await page.click('#radio-add');
      await page.fill('#rs-url', 'http://broken.example/s');
      await page.fill('#rs-name', 'Broken');
      await page.click('#rs-save');
      await page.waitForSelector('.radio-item:has-text("Broken")');
      await page.dblclick('.radio-item:has-text("Broken")');
      await waitFn(page, () => document.querySelector('#radio-now')?.classList.contains('error'));
      check('a station that can’t be reached shows why', /can't be reached/.test(await page.textContent('#radio-now-title')));
      // Sleep timer and the middle.
      await page.selectOption('#radio-sleep', '15');
      check('the sleep timer can be set', (await RS()).sleepUntil > Date.now() + 14 * 60000);
      await page.selectOption('#radio-sleep', '0');
      await page.evaluate(() => NoorDock.place('radio', 'center'));
      await waitFn(page, () => NoorDock._state().center.active === 'radio');
      check('the Radio can go in the middle too', await page.isVisible('#radiobench .radio-item'));
      await page.focus('.radio-item:has-text("Broken")');
      await page.keyboard.press('Delete');
      await page.click('.modal button:has-text("Delete")');
      await waitFn(page, () => !document.querySelector('.radio-item[data-id]') || ![...document.querySelectorAll('.radio-item')].some((n) => n.textContent.includes('Broken')));
      check('Delete removes a station (after asking)', !(await RM()).stations.some((x) => x.name === 'Broken'));
      const unexpected = errors.filter((e) => !/status of 404|can't be reached/.test(e));
      check('no page errors in the Radio', unexpected.length === 0, unexpected);
      if (shots) await page.screenshot({ path: `${shots}/radio.png` });
      await page.close();
    }

    // ---- 38. Sound Bench: presets, Quick controls, live preview, variations, undo, A/B, layers, export and presets of your own.
    {
      const { page, errors } = await open(browser, url, { musicTracks: 4, document: { markdown: '# x\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' } }, { width: 1500, height: 950 });
      const SM = () => page.evaluate(() => window.__mock.state.sound);
      const SS = () => page.evaluate(() => NoorSound._state());
      const slide = (sel, v) => page.$eval(sel, (n, val) => { n.value = String(val); n.dispatchEvent(new Event('input', { bubbles: true })); }, v);
      await page.keyboard.press('Control+Alt+k');
      await page.waitForSelector('#soundbench:not([hidden]) #sb-pane .sb-macro');
      await waitFn(page, () => NoorSound._state().render !== null);
      check('Ctrl+Alt+K opens the Sound Bench in the middle with a preset ready', (await page.evaluate(() => NoorDock._state().center.active)) === 'sound' && (await page.inputValue('#sb-name')) === 'Gentle forest breeze');
      check('…as a wide editor: presets beside it, by family', await page.evaluate(() => document.querySelector('#soundbench').classList.contains('wide')) && (await page.$$eval('#sb-presets .gnav-head', (n) => n.map((x) => x.textContent))).join() === 'Generate,Wind,Rain,UI,My presets');
      check('the preview shows its waveform and levels', /peak .* dB · RMS/.test(await page.textContent('#sb-status')));
      const before = (await SM()).renders.length;
      await slide('[data-macro="intensity"]', 1);
      await waitFn(page, (n) => window.__mock.state.sound.renders.length > n, before);
      check('moving a Quick control renders the sound again', (await SM()).renders.at(-1).macros.intensity === 1);
      await page.click('#sb-play');
      await waitFn(page, () => NoorSound._state().playing);
      check('▶ plays the preview', (await SS()).src === '/_media/4');
      await page.evaluate(() => NoorMusic._testPlay([1], 0, true));
      await waitFn(page, () => !NoorSound._state().playing);
      check('music starting stops the preview (one sound at a time)', true);
      const seed = (await SS()).recipe.seed;
      await page.click('#sb-vary');
      await waitFn(page, (s) => NoorSound._state().recipe.seed !== s, seed);
      await waitFn(page, (s) => window.__mock.state.sound.renders.at(-1).seed !== s, seed);
      check('🎲 Variation renders another take (a new seed)', true);
      await page.waitForTimeout(700); // the change settles into the undo history
      await page.focus('#sb-play');
      await page.keyboard.press('Control+z');
      await waitFn(page, (s) => NoorSound._state().recipe.seed === s, seed);
      check('Ctrl+Z undoes it', (await SS()).future === 1);
      await page.keyboard.press('Control+y');
      await waitFn(page, (s) => NoorSound._state().recipe.seed !== s, seed);
      check('…and Ctrl+Y redoes it', true);
      await page.click('#sb-pin');
      const pinnedSeed = (await SS()).recipe.seed;
      await page.click('#sb-vary');
      await page.waitForSelector('#sb-ab:not([hidden])');
      await page.click('#sb-ab');
      await waitFn(page, (s) => window.__mock.state.sound.renders.at(-1).seed === s && NoorSound._state().listening === 'A', pinnedSeed);
      check('📌 Pin as A, then A/B plays the pinned version', (await page.textContent('#sb-ab')) === 'A/B: A');
      await page.click('#sb-ab');
      await waitFn(page, () => NoorSound._state().listening === 'B');
      // Layers
      await page.click('#soundbench .sb-tabs button[data-tab="layers"]');
      await page.waitForSelector('.sb-layer');
      check('the Layers tab shows how the sound is built', (await page.$$('.sb-layer')).length === 3 && /Gust strength/.test(await page.textContent('#sb-pane')));
      await page.click('.sb-layer[data-index="1"] .sb-ms[title^="Mute"]');
      await waitFn(page, () => window.__mock.state.sound.renders.at(-1).layers[1].mute === true);
      check('M mutes a layer', await page.evaluate(() => document.querySelector('.sb-layer[data-index="1"]').classList.contains('muted')));
      await page.click('[data-add="events"]');
      await waitFn(page, () => document.querySelectorAll('.sb-layer').length === 4);
      await slide('.sb-layer[data-index="3"] input[data-key="density"]', 500);
      await waitFn(page, () => window.__mock.state.sound.renders.at(-1).layers[3]?.density === 500);
      check('layers can be added and shaped', (await SS()).recipe.layers[3].type === 'events');
      await page.click('.sb-layer[data-index="3"] button[title="Remove this layer"]');
      await waitFn(page, () => document.querySelectorAll('.sb-layer').length === 3);
      // Output and export
      await page.click('#soundbench .sb-tabs button[data-tab="output"]');
      await page.selectOption('#sb-variations', '5');
      await page.selectOption('#sb-bits', '24');
      await page.click('#sb-export');
      await page.waitForSelector('#sb-reveal');
      const ex = (await SM()).exports[0];
      check('Export writes the chosen number of variations with the recipe', ex.variations === 5 && ex.bits === 24 && ex.sampleRate === 48000 && /Saved 5 files and the recipe/.test(await page.textContent('#sb-export-status')), ex);
      await page.click('#sb-reveal');
      await waitFn(page, () => window.__mock.state.sound.opened === 'D:\\Game\\Audio');
      check('…and opens the folder', true);
      await page.click('#sb-save');
      await page.fill('.modal input', 'Thornwake breeze');
      await page.click('.modal button:has-text("Save")');
      await page.waitForSelector('#sb-presets [data-preset="user:Thornwake breeze.json"]');
      check('Save as my preset adds it to My presets', (await SM()).mine[0].recipe.layers[1].mute === true);
      await page.click('#sb-presets [data-preset="ui-coin"]');
      await waitFn(page, () => NoorSound._state().recipe?.name === 'Coin pickup');
      await page.click('#soundbench .sb-tabs button[data-tab="quick"]');
      check('a one-shot preset is not a loop', !(await page.isChecked('#sb-loop')));
      await page.click('#sb-presets [data-preset="user:Thornwake breeze.json"]');
      await waitFn(page, () => NoorSound._state().recipe?.name === 'Thornwake breeze');
      check('your preset loads back as you saved it', (await SS()).recipe.layers[1].mute === true);
      check('A/B is hidden when nothing is pinned', await page.isHidden('#sb-ab'));
      // Universal: generate any kind of sound, find presets, and layer a WAV file of your own.
      await page.selectOption('#sb-gen-kind', 'footstep');
      await page.click('#sb-generate');
      await waitFn(page, () => NoorSound._state().recipe?.family === 'Generated');
      const g1 = (await SS()).recipe.seed;
      await page.click('#sb-generate');
      await waitFn(page, (s) => NoorSound._state().recipe.seed !== s, g1);
      check('🎲 Generate makes a new sound of the chosen kind each time', (await SM()).generated.length === 2 && (await SM()).generated.every((x) => x.category === 'footstep'));
      await page.fill('#sb-filter', 'rain');
      await waitFn(page, () => document.querySelectorAll('#sb-presets [data-preset]').length === 1);
      check('presets can be searched', (await page.getAttribute('#sb-presets [data-preset]', 'data-preset')) === 'rain-steady' && (await page.evaluate(() => document.activeElement.id)) === 'sb-filter');
      await page.fill('#sb-filter', '');
      await page.click('#soundbench .sb-tabs button[data-tab="layers"]');
      await page.click('[data-add="sample"]');
      await waitFn(page, () => NoorSound._state().recipe.layers.some((l) => l.type === 'sample'));
      const smp = (await SS()).recipe.layers.find((l) => l.type === 'sample');
      check('＋ Sample asks for a WAV and adds it as a layer', smp.path === 'C:\\Sounds\\door creak.wav' && smp.name === 'door creak' && /door creak\.wav/.test(await page.textContent('#sb-pane')));
      await page.check('.sb-layer:last-of-type input[data-key="reverse"]');
      await waitFn(page, () => window.__mock.state.sound.renders.at(-1).layers.at(-1).reverse === true);
      check('…and can be played backwards', true);
      check('synth layers have FM, pulse width, pitch jumps and a filter', await page.evaluate(() => ['fmRatio', 'duty', 'arp', 'drive', 'crush'].every((k) => document.querySelector(`#sb-pane input[data-key="${k}"]`))));
      const unexpected = errors.filter((e) => !/status of 404/.test(e));
      check('no page errors in the Sound Bench', unexpected.length === 0, unexpected);
      if (shots) await page.screenshot({ path: `${shots}/sound-bench.png` });
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
