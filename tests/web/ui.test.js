// Automated UI checks for the NoorMD web front-end, run in headless Chromium against a mock host.
// Usage: node tests/web/ui.test.js [--screenshots <dir>]
'use strict';
const { chromium } = require('playwright');
const { serve, mockHostScript } = require('./harness');

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
  await page.waitForFunction(() => window.NoorMD && document.querySelector('.toastui-editor-defaultUI'));
  await page.waitForTimeout(150);
  return { page, errors, external };
}

const state = (page) => page.evaluate(() => window.NoorMD.getState());
const msgs = (page, type) => page.evaluate((t) => window.__mock.log.filter((m) => m.type === t).length, type);

(async () => {
  const shotsIdx = process.argv.indexOf('--screenshots');
  const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
  const { server, url } = await serve();
  const browser = await chromium.launch();
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
      await page.click('#editor .toastui-editor-ww-container .ProseMirror');
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
        const a = document.querySelector('#editor .toastui-editor-md-container > .toastui-editor').getBoundingClientRect();
        const b = document.querySelector('#editor .toastui-editor-md-preview').getBoundingClientRect();
        return { a: a.width, b: b.width, ah: a.height, bh: b.height };
      });
      check('split shows two usable panes (~50/50)', panes.a > 300 && panes.b > 300 && Math.abs(panes.a - panes.b) < 40 && panes.ah > 200, panes);
      if (shots) await page.screenshot({ path: `${shots}/split-1440.png` });
      // Drag divider to ~65%.
      const sp = await page.$('#editor .toastui-editor-md-splitter');
      const box = await sp.boundingBox();
      const cont = await page.evaluate(() => { const r = document.querySelector('#editor .toastui-editor-md-container').getBoundingClientRect(); return { x: r.x, w: r.width }; });
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(cont.x + cont.w * 0.65, box.y + 120, { steps: 6 });
      await page.mouse.up();
      const ratio = await page.evaluate(() => { const a = document.querySelector('#editor .toastui-editor-md-container > .toastui-editor').getBoundingClientRect(); const c = document.querySelector('#editor .toastui-editor-md-container').getBoundingClientRect(); return a.width / c.width; });
      check('dragging the divider resizes panes', Math.abs(ratio - 0.65) < 0.03, ratio);
      const prefMsg = await page.evaluate(() => window.__mock.log.filter((m) => m.type === 'prefs.set' && m.payload.splitRatio).pop());
      check('divider ratio is persisted', prefMsg && Math.abs(prefMsg.payload.splitRatio - 0.65) < 0.03, prefMsg);
      await page.mouse.move(cont.x + 10, box.y + 120);
      await page.mouse.down(); await page.mouse.up();
      // Clamp
      await page.mouse.move(box.x + 2, box.y + 100);
      await page.setViewportSize({ width: 1024, height: 700 });
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => { const a = document.querySelector('#editor .toastui-editor-md-container > .toastui-editor').getBoundingClientRect(); const c = document.querySelector('#editor .toastui-editor-md-container').getBoundingClientRect(); return { r: a.width / c.width, overflow: document.documentElement.scrollWidth > window.innerWidth }; });
      check('split layout survives window resize', after.r > 0.29 && after.r < 0.71 && !after.overflow, after);
      if (shots) await page.screenshot({ path: `${shots}/split-1024.png` });
      await page.setViewportSize({ width: 1440, height: 900 });
      // Independent scrolling: the panes scroll, the page does not.
      const scroll = await page.evaluate(() => ({ page: document.scrollingElement.scrollHeight <= window.innerHeight + 1, preview: getComputedStyle(document.querySelector('#editor .toastui-editor-md-preview')).overflowY }));
      check('page never scrolls; preview scrolls independently', scroll.page && scroll.preview === 'auto', scroll);

      await page.keyboard.press('Control+1');
      await page.waitForTimeout(100);
      const back = (await state(page)).markdown;
      check('Visual → Markdown → Split → Visual keeps content', back.replace(/\s+$/, '') === before.replace(/\s+$/, ''), { before: before.slice(0, 80), back: back.slice(0, 80) });

      // Focus mode
      await page.keyboard.press('F11');
      const zen = await page.evaluate(() => ({ sidebar: getComputedStyle(document.querySelector('.sidebar')).display, card: document.querySelector('#editor-card').getBoundingClientRect().width, vw: window.innerWidth, editable: !!document.querySelector('#editor .ProseMirror[contenteditable=true]') }));
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
      await page.click('#editor .toastui-editor-ww-container .ProseMirror');
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
      await page.click('#editor .toastui-editor-ww-container .ProseMirror');
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
      await page.click('#editor .toastui-editor-md-preview a[href="https://example.com"]');
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
        const pm = document.querySelector('#editor .toastui-editor-ww-container .ProseMirror');
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
      const pane = await page.evaluate(() => document.querySelector('#editor .toastui-editor-ww-container .ProseMirror').clientWidth);
      if (shots) await page.screenshot({ path: `${shots}/focus-fullwidth-1920.png` });
      check('Full width uses the pane with 24–40 px padding in Focus mode', full >= pane - 80 && full > 1700, { full, pane });
      check('width preset is persisted', await page.evaluate(() => window.__mock.log.some((m) => m.type === 'prefs.set' && m.payload.lineWidth === 'full')));
      check('width button shows the active preset', (await page.textContent('#width-toggle')).includes('Full width'));
      check('editing still works at full width', await page.evaluate(() => !!document.querySelector('#editor .ProseMirror[contenteditable=true]')));
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
      const grip = await page.evaluate(() => getComputedStyle(document.querySelector('#editor .toastui-editor-md-splitter'), '::after').height);
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
      const sp = await page.evaluate(() => [...document.querySelectorAll('#editor [contenteditable="true"]')].map((n) => n.getAttribute('spellcheck')));
      check('spellcheck off sets spellcheck=false on editing surfaces', sp.length > 0 && sp.every((v) => v === 'false'), sp);
      check('spellcheck toggle leaves the text unchanged', (await state(page)).markdown === md0);
      await page.keyboard.press('Control+2');
      await page.waitForTimeout(50);
      const sp2 = await page.evaluate(() => [...document.querySelectorAll('#editor [contenteditable="true"]')].map((n) => n.getAttribute('spellcheck')));
      check('spellcheck setting survives mode switches', sp2.every((v) => v === 'false'), sp2);
      await page.keyboard.press('Control+1');
      await page.keyboard.press('Control+Shift+Y');
      check('spellcheck can be turned back on', await page.evaluate(() => document.querySelector('#editor .ww-mode .ProseMirror, #editor .toastui-editor-ww-container .ProseMirror').getAttribute('spellcheck') === 'true'));

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
        const pm = document.querySelector('#editor .toastui-editor-md-container .ProseMirror');
        const sizes = new Set(), fams = new Set(), lhs = new Set();
        pm.querySelectorAll('*').forEach((n) => { const cs = getComputedStyle(n); sizes.add(cs.fontSize); fams.add(cs.fontFamily.split(',')[0]); lhs.add(cs.lineHeight); });
        return { sizes: [...sizes], fams: [...fams], lhs: [...lhs] };
      });
      let u = await uniform();
      check('source: one font size, one font, one line height (Markdown mode)', u.sizes.length === 1 && u.fams.length === 1 && u.lhs.length === 1, u);
      const literal = await page.evaluate(() => [...document.querySelectorAll('#editor .toastui-editor-md-container .ProseMirror > div')].some((d) => d.textContent === '## Section 1: Systems'));
      check('heading markers stay literal text in source', literal);
      if (shots) await page.screenshot({ path: `${shots}/source-markdown-dark.png` });

      // Line numbers and wrap
      const gutter = await page.evaluate(() => getComputedStyle(document.querySelector('#editor .toastui-editor-md-container .ProseMirror > div'), '::before').content);
      check('line numbers shown by default', gutter && gutter !== 'none', gutter);
      await page.evaluate(() => window.NoorMD.runCommand('source.wrap'));
      await page.waitForTimeout(100);
      const nowrap = await page.evaluate(() => { const pm = document.querySelector('#editor .toastui-editor-md-container .ProseMirror'); return { sw: pm.scrollWidth, cw: pm.clientWidth, heights: new Set([...pm.children].slice(0, 400).map((d) => Math.round(d.getBoundingClientRect().height))).size }; });
      check('word wrap off: long lines scroll horizontally, every line has the same height', nowrap.sw > nowrap.cw && nowrap.heights === 1, nowrap);
      await page.evaluate(() => window.NoorMD.runCommand('source.wrap'));
      await page.evaluate(() => window.NoorMD.runCommand('source.lineNumbers'));
      await page.waitForTimeout(50);
      check('line numbers can be turned off', await page.evaluate(() => getComputedStyle(document.querySelector('#editor .toastui-editor-md-container .ProseMirror > div'), '::before').content === 'none'));
      await page.evaluate(() => window.NoorMD.runCommand('source.lineNumbers'));

      // Repeated mode switching without edits never rewrites the source.
      for (const k of ['Control+3', 'Control+1', 'Control+2', 'Control+1', 'Control+3', 'Control+2']) { await page.keyboard.press(k); await page.waitForTimeout(80); }
      check('repeated mode switches without edits keep the source byte-for-byte', (await state(page)).markdown === BIG && !(await state(page)).dirty);

      // Edit in source, go through Visual and back without editing there: the edited source survives exactly.
      await page.click('#editor .toastui-editor-md-container .ProseMirror');
      await page.keyboard.press('Control+Home');
      await page.keyboard.type('- [ ] raw source line with  two spaces\n');
      const edited = (await state(page)).markdown;
      await page.keyboard.press('Control+1'); await page.waitForTimeout(100);
      check('Visual mode reports the exact edited source while unedited there', (await state(page)).markdown === edited);
      await page.keyboard.press('Control+2'); await page.waitForTimeout(100);
      check('edited source is exact after a Visual round trip', (await state(page)).markdown === edited);

      // Split: rapid typing, preview updates, caret stays, divider resize mid-typing, independent scrolling.
      await page.keyboard.press('Control+3'); await page.waitForTimeout(150);
      await page.click('#editor .toastui-editor-md-container .ProseMirror');
      await page.keyboard.press('Control+Home');
      const t0 = Date.now();
      await page.keyboard.type('Rapid typing ąę test one two three four five six seven eight nine ten.\n', { delay: 0 });
      const typeMs = Date.now() - t0;
      const sp = await page.$('#editor .toastui-editor-md-splitter');
      const bx = await sp.boundingBox();
      await page.mouse.move(bx.x + bx.width / 2, bx.y + 200); await page.mouse.down();
      await page.mouse.move(bx.x - 150, bx.y + 220, { steps: 5 }); await page.mouse.up();
      await page.click('#editor .toastui-editor-md-container .ProseMirror > div:first-child');
      await page.keyboard.press('End');
      await page.keyboard.type('AFTER-RESIZE');
      await page.waitForTimeout(400);
      const firstLine = await page.evaluate(() => document.querySelector('#editor .toastui-editor-md-container .ProseMirror > div').textContent);
      check('typing stays in order across a divider resize', firstLine.startsWith('Rapid typing ąę') && firstLine.endsWith('AFTER-RESIZE'), firstLine);
      check(`rapid typing in Split with a ~${wordCount}-word document is responsive (${typeMs} ms for 72 chars)`, typeMs < 6000, typeMs);
      check('preview updates while typing', await page.evaluate(() => document.querySelector('#editor .toastui-editor-md-preview').textContent.includes('AFTER-RESIZE')));
      u = await uniform();
      check('source stays uniform in Split mode', u.sizes.length === 1 && u.lhs.length === 1, u);
      const before = await page.evaluate(() => document.querySelector('#editor .toastui-editor-md-preview').scrollTop);
      await page.evaluate(() => { document.querySelector('#editor .toastui-editor-md-container .ProseMirror').scrollTop = 5000; });
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => document.querySelector('#editor .toastui-editor-md-preview').scrollTop);
      check('panes scroll independently by default', after === before, { before, after });
      if (shots) await page.screenshot({ path: `${shots}/source-split-dark.png` });

      // Commands: heading shortcut, copy source.
      await page.click('#editor .toastui-editor-md-container .ProseMirror > div:first-child');
      await page.keyboard.press('Control+Shift+Digit2');
      await page.waitForTimeout(80);
      check('Ctrl+Shift+2 makes the line a level-2 heading', (await page.evaluate(() => document.querySelector('#editor .toastui-editor-md-container .ProseMirror > div').textContent)).startsWith('## Rapid typing'));
      await page.evaluate(() => window.NoorMD.runCommand('source.copy'));
      await page.waitForTimeout(100);
      check('Copy Markdown source copies the exact source', (await page.evaluate(() => window.__mock.state.clipboard)) === (await state(page)).markdown);

      // Contrast of source tokens in both themes.
      for (const theme of ['dark', 'light']) {
        if (theme === 'light') { await page.evaluate(() => window.NoorMD.runCommand('theme.toggle')); await page.waitForTimeout(60); await page.keyboard.press('Control+2'); await page.waitForTimeout(150); }
        const c = await page.evaluate(() => {
          const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
          const bg = getComputedStyle(document.querySelector('#editor .toastui-editor-md-container > .toastui-editor')).backgroundColor;
          const pick = (sel) => { const n = document.querySelector('#editor .toastui-editor-md-container .ProseMirror ' + sel); return n ? +ratio(getComputedStyle(n).color, bg).toFixed(2) : null; };
          const line = document.querySelector('#editor .toastui-editor-md-container .ProseMirror > div');
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
        const r = await page.evaluate(() => { const pm = document.querySelector('#editor .toastui-editor-md-container .ProseMirror'); const cs = getComputedStyle(pm); return { text: pm.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ov: document.documentElement.scrollWidth - window.innerWidth }; });
        check(`source editor usable in Focus+Compact with ${w}`, r.text > 600 && r.ov <= 0, r);
      }
      await page.keyboard.press('F11');
      await page.keyboard.press('Control+3');
      await page.setViewportSize({ width: 820, height: 640 });
      await page.waitForTimeout(150);
      const narrow = await page.evaluate(() => { const pm = document.querySelector('#editor .toastui-editor-md-container .ProseMirror'); const cs = getComputedStyle(pm); return { text: pm.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ov: document.documentElement.scrollWidth - window.innerWidth }; });
      check('Split source pane is usable in a narrow window', narrow.text > 200 && narrow.ov <= 0, narrow);
      const overlap = await page.evaluate(() => {
        const a = document.querySelector('#editor .toastui-editor-md-container > .toastui-editor').getBoundingClientRect();
        const pm = document.querySelector('#editor .toastui-editor-md-container .ProseMirror').getBoundingClientRect();
        const pv = document.querySelector('#editor .toastui-editor-md-preview').getBoundingClientRect();
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
          const preview = document.querySelector('#editor .toastui-editor-md-preview p');
          const ww = getComputedStyle(document.querySelector('#editor .toastui-editor-md-preview')).backgroundColor;
          return { preview: +ratio(getComputedStyle(preview).color, ww).toFixed(2), title: +ratio(getComputedStyle(document.querySelector('#doc-title')).color, getComputedStyle(document.body).backgroundColor).toFixed(2), ov: document.documentElement.scrollWidth - window.innerWidth };
        });
        check(`theme "${id}" renders readable text in editor, preview and header`, r.preview >= 4.5 && r.title >= 4.5 && r.ov <= 0, r);
        if (shots) await page.screenshot({ path: `${shots}/theme-${id}.png` });
      }
      check('no errors while switching themes', errors.length === 0, errors);
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
