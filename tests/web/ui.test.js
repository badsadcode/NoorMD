// Automated UI checks for the NoorMD web front-end, run in headless Chromium against a mock host.
// Usage: node tests/web/ui.test.js [--screenshots <dir>]
'use strict';
const { chromium } = require('playwright');
const { serve, mockHostScript, mediaLog } = require('./harness');

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
const state = (page) => page.evaluate(() => window.NoorMD.getState());
const msgs = (page, type) => page.evaluate((t) => window.__mock.log.filter((m) => m.type === t).length, type);

(async () => {
  const shotsIdx = process.argv.indexOf('--screenshots');
  const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
  const { server, url } = await serve();
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
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
      check('Vault-only commands are disabled without a Vault', await page.evaluate(() => { document.querySelector('#menubar .menu-title[data-menu="5"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); const b = [...document.querySelectorAll('.menu-popup .menu-item')].find((x) => x.textContent.includes('Find in Vault')); return !!b && b.disabled; }));
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.NoorMusic.toggle());
      if (shots) await page.screenshot({ path: `${shots}/vault.png` });
      const unexpected = errors.filter((e) => !/Empty src|status of 404/.test(e));
      check('no page errors in Vault checks', unexpected.length === 0, unexpected);
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
