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

/** A PNG (8-bit RGBA) as base64, for host replies that carry pictures. */
function pngB64(w, h, pixel) {
  const zlib = require('zlib');
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) Buffer.from(pixel(x, y)).copy(raw, y * (w * 4 + 1) + 1 + x * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
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

/** NoorStream's own window (stream.html), with the same mock host as the main page. */
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
    // ---- 66y. Languages: Preferences › Language translates the page at once, your writing stays as it is.
    {
      const { page, errors } = await open(browser, url, { document: { markdown: '# File\n\nFile and Edit are words in my note.\n', path: 'C:\\x.md', fileName: 'x.md', title: 'x' } }, { width: 1400, height: 900 });
      const titles = () => page.$$eval('#menubar .menu-title', (n) => n.map((x) => x.textContent));
      check('English to begin with', (await titles())[0] === 'File');
      await page.keyboard.press('Control+,');
      await page.waitForSelector('#pref-language option[value="pl"]', { state: 'attached' });
      check('Preferences › Language lists the languages', (await page.$$eval('#pref-language option', (o) => o.map((x) => x.value))).join() === 'en,pl');
      await page.selectOption('#pref-language', 'pl');
      await waitFn(page, () => document.querySelector('#menubar .menu-title').textContent === 'Plik');
      const st = await page.evaluate(() => window.__mock.state);
      check('choosing Polski: the menus in Polish at once, the choice kept', (await titles()).slice(0, 2).join() === 'Plik,Edycja' && st.prefs.language === 'pl');
      check('…the open dialog too (its heading, its labels)', /Preferencje/.test(await page.textContent('.modal .modal-head, .modal h2, .modal')) && /Język/.test(await page.textContent('.modal')));
      check('…how much is translated, and that the app\'s own windows follow at the next start', /60% translated/.test(await page.textContent('#pref-language-info')) && /next start/.test(await page.textContent('#pref-language-info')));
      check('…your writing is not translated', /File and Edit are words in my note/.test(await page.textContent('#editor')));
      check('…text with a number in it, by its pattern', (await page.evaluate(() => NoorI18n.t('12 words'))) === '12 słów');
      // Make a translation, and the folder.
      await page.click('#pref-translate');
      await page.waitForSelector('.modal input[type=text]');
      await page.fill('.modal:last-of-type input[type=text]', 'it'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.modal input[type=text]').length && /Italiano|name/.test(document.querySelector('.modal:last-of-type').textContent));
      await page.fill('.modal:last-of-type input[type=text]', 'Italiano'); await page.keyboard.press('Enter');
      await waitFn(page, () => window.__mock.state.i18nTemplate);
      check('Make a translation…: a file of every text to fill in, for a new language', JSON.stringify(await page.evaluate(() => window.__mock.state.i18nTemplate)) === '{"code":"it","name":"Italiano"}');
      await page.click('#pref-translations');
      await waitFn(page, () => window.__mock.state.i18nFolder);
      check('Translations folder opens', true);
      // Back to English.
      await page.selectOption('#pref-language', 'en');
      await waitFn(page, () => document.querySelector('#menubar .menu-title').textContent === 'File');
      check('back to English at once', (await titles()).slice(0, 2).join() === 'File,Edit' && /Preferences/.test(await page.textContent('.modal')));
      check('no page errors with languages', errors.length === 0, errors);
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
