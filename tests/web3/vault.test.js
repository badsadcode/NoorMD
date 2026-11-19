// NoorMD 3.0's Vault bench, tested in Chromium inside the real shell page, together with the Markdown bench (notes open
// there). The window (C# side) is a stand-in: both benches' commands over one pretend disk in localStorage, with the
// window's part (files handed to the bench that opens them, moved files announced) played the same way.
// Run: node tests/web3/vault.test.js [--screenshots dir]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'web', 'node_modules', 'playwright'));

const ROOT = path.join(__dirname, '..', '..');
const MOUNTS = [['/ui/', 'src/Noor.UI/'], ['/benches/noor.markdown/', 'src/Benches/Markdown/Markdown.Bench/web/'], ['/benches/noor.vault/', 'src/Benches/Vault/Vault.Bench/web/'], ['/', 'src/NoorMD3/wwwroot/']];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const MARKDOWN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'markdown.manifest.json'), 'utf8'));
const VAULT = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vault.manifest.json'), 'utf8'));
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
  const listeners = [];
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch { return d; } };
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const defaults = { theme: 'dark', menuPosition: 'title', density: {}, openBenches: ['noor.vault'], activeBench: 'noor.vault', layouts: {}, welcomed: true };
  const send = (data) => setTimeout(() => listeners.forEach((fn) => fn({ data })), 5);
  window.__mockSend = send;
  const docs = {};
  const S = '\\';
  const name = (p) => p.split(/[\\/]/).pop();
  const base = (p) => name(p).replace(/\.md$/i, '');
  // ---- the pretend disk: full Windows-style paths → { text, stamp }
  const disk = () => get('mock.disk', {});
  const saveDisk = (d) => put('mock.disk', d);
  const vault = () => get('mock.vault', null);   // { root, name, folders: [rel] }
  const rel = (v, full) => full.slice(v.root.length + 1).split(S).join('/');
  const full = (v, r) => v.root + S + r.split('/').join(S);
  const notesOf = (v) => Object.keys(disk()).filter((k) => k.startsWith(v.root + S)).map((k) => rel(v, k));
  const changed = () => send({ event: 'bench', bench: 'noor.vault', name: 'changed', payload: {} });
  const handOver = (paths) => { send({ event: 'open', bench: 'noor.markdown', paths }); };
  const write = (fullPath, text) => { const d = disk(); d[fullPath] = { text, stamp: ((d[fullPath] && d[fullPath].stamp) || 0) + 1, format: 'UTF-8 · LF' }; saveDisk(d); };
  const linksTo = (text, target) => (text.match(new RegExp('\\[\\[' + target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\|[^\\]]*)?\\]\\]', 'g')) || []).length;
  const PRESETS = [
    { id: 'blank', name: 'Empty', icon: '▫', group: 'Start simple', goodFor: 'Your own structure.', description: 'Just a Home note.', folders: [], notes: [] },
    { id: 'para', name: 'PARA', icon: '📂', group: 'Popular structures', goodFor: 'Keeping projects moving.', description: 'Projects, Areas, Resources, Archive.', folders: ['1 Projects', '2 Areas', '3 Resources', '4 Archive', 'Templates'], notes: ['Templates/Project.md'] },
    { id: 'zettelkasten', name: 'Zettelkasten', icon: '🗃', group: 'Popular structures', goodFor: 'Growing ideas.', description: 'Small linked notes.', folders: ['Fleeting', 'Permanent', 'Index', 'Templates'], notes: ['Index/Start here.md', 'Permanent/One idea per note.md', 'Templates/Permanent note.md'] },
  ];
  const answer = (m) => {
    const a = m.args || {};
    if (m.target === 'shell' && m.cmd === 'start') return { version: '3.0.8', contract: 1, settings: get('mock.settings', defaults), benches: manifests, problems: [] };
    if (m.target === 'shell' && m.cmd === 'settings.save') { put('mock.settings', a); return a; }
    if (m.target === 'window') return null;
    if (m.target === 'bench:noor.markdown') {
      const d = disk();
      switch (m.cmd) {
        case 'md.load': { const f = d[a.path]; if (!f) throw new Error(`"${a.path}" does not exist.`); docs[a.doc] = { path: a.path, stamp: f.stamp }; return { path: a.path, name: name(a.path), markdown: f.text, format: 'UTF-8 · LF', warning: null }; }
        case 'md.write': { const doc = docs[a.doc]; if (!doc || !doc.path) return { needsPath: true }; write(doc.path, a.markdown); doc.stamp = disk()[doc.path].stamp; return { path: doc.path, name: name(doc.path), format: 'UTF-8 · LF' }; }
        case 'md.changed': { const doc = docs[a.doc]; return !!(doc && doc.path && (!d[doc.path] || d[doc.path].stamp !== doc.stamp)); }
        case 'md.recentList': return [];
        case 'md.drafts': return [];
        case 'md.resume': return null;
        case 'md.snapList': return [];
        default: return null;
      }
    }
    if (m.target !== 'bench:noor.vault') throw new Error(`no ${m.target} ${m.cmd}`);
    const v = vault();
    const need = () => { if (!v) throw new Error('No vault is open.'); return v; };
    switch (m.cmd) {
      case 'vault.state': return { open: !!v, root: v && v.root, name: v && v.name, notes: v ? notesOf(v).length : 0, recent: get('mock.vaultRecent', []).map((p) => ({ path: p, name: name(p), exists: true })) };
      case 'vault.presets': return PRESETS;
      case 'vault.create': {
        const q = get('mock.folders', []); const parent = q.shift(); put('mock.folders', q);
        if (!parent) return null;
        const p = PRESETS.find((x) => x.id === a.preset);
        const nv = { root: parent + S + a.name, name: a.name, folders: [...p.folders] };
        put('mock.vault', nv); put('mock.vaultRecent', [nv.root]);
        write(full(nv, 'Home.md'), `# ${a.name}\n\n## Start here\n\n- [[Start here]]\n- [[One idea per note]]\n\n#home\n`);
        if (a.preset === 'zettelkasten') {
          write(full(nv, 'Index/Start here.md'), '# Start here\n\nAn index note.\n\n- [[One idea per note]]\n');
          write(full(nv, 'Permanent/One idea per note.md'), '# One idea per note\n\nEach permanent note holds one idea. #permanent\n\nRelated: [[Start here]]\n');
          write(full(nv, 'Templates/Permanent note.md'), '# {{title}}\n');
        }
        send({ event: 'bench', bench: 'noor.vault', name: 'opened', payload: { root: nv.root } });
        handOver([full(nv, 'Home.md')]);
        return { root: nv.root };
      }
      case 'vault.tree': {
        const vv = need(); const ns = notesOf(vv); const folders = new Set(vv.folders);
        for (const n of ns) { const parts = n.split('/'); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/')); }
        return { root: vv.root, name: vv.name, entries: [...[...folders].map((f) => ({ path: f, folder: true, note: false })), ...ns.map((n) => ({ path: n, folder: false, note: true, modified: new Date().toISOString() }))] };
      }
      case 'vault.notes': return v ? notesOf(v).map((p) => ({ path: p, name: base(p) })) : [];
      case 'vault.recentNotes': return notesOf(need()).slice(0, 12).map((p) => ({ path: p, name: base(p), modified: new Date().toISOString() }));
      case 'vault.search': { const vv = need(); const q = (a.q || '').toLowerCase(); const out = []; for (const n of notesOf(vv)) { if (base(n).toLowerCase().includes(q)) out.push({ path: n, name: base(n), line: 0, snippet: '', nameMatch: true }); const lines = disk()[full(vv, n)].text.split('\n'); lines.forEach((l, i) => { if (l.toLowerCase().includes(q)) out.push({ path: n, name: base(n), line: i + 1, snippet: l, nameMatch: false }); }); } return out; }
      case 'vault.tags': { const vv = need(); const counts = {}; for (const n of notesOf(vv)) for (const t of disk()[full(vv, n)].text.match(/(^|\s)#([a-z][\w-]*)/gi) || []) { const k = t.trim().slice(1).toLowerCase(); counts[k] = (counts[k] || 0) + 1; } return Object.entries(counts).map(([tag, count]) => ({ tag, count })); }
      case 'vault.tagged': { const vv = need(); return notesOf(vv).filter((n) => new RegExp('(^|\\s)#' + a.tag + '\\b', 'i').test(disk()[full(vv, n)].text)).map((p) => ({ path: p, name: base(p) })); }
      case 'vault.backlinks': { if (!v || !a.path || !a.path.startsWith(v.root + S)) return { inVault: false }; const r = rel(v, a.path); const refs = []; for (const n of notesOf(v)) { if (n === r) continue; disk()[full(v, n)].text.split('\n').forEach((l, i) => { if (linksTo(l, base(r))) refs.push({ source: n, name: base(n), line: i + 1, snippet: l }); }); } return { inVault: true, path: r, refs, tags: (disk()[a.path].text.match(/#([a-z][\w-]*)/gi) || []).map((t) => t.slice(1)) }; }
      case 'vault.openNote': handOver([full(need(), a.path)]); return null;
      case 'vault.openLink': {
        if (!v) return { noVault: true };
        if (a.from && !a.from.startsWith(v.root + S)) return { outside: true };
        const hit = notesOf(v).find((n) => base(n).toLowerCase() === a.target.toLowerCase());
        if (hit) { handOver([full(v, hit)]); return { opened: hit }; }
        const fromRel = a.from ? rel(v, a.from) : '';
        return { missing: true, folder: fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : '', name: a.target + '.md' };
      }
      case 'vault.createLink': { const vv = need(); const fromRel = a.from ? rel(vv, a.from) : ''; const folder = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : ''; const r = (folder ? folder + '/' : '') + a.target + '.md'; write(full(vv, r), `# ${a.target}\n\n`); changed(); handOver([full(vv, r)]); return { path: r }; }
      case 'vault.newNote': { const vv = need(); const r = (a.folder ? a.folder + '/' : '') + a.name + '.md'; if (disk()[full(vv, r)]) throw new Error(`“${a.name}.md” already exists there.`); write(full(vv, r), `# ${a.name}\n\n`); changed(); handOver([full(vv, r)]); return { path: r }; }
      case 'vault.newFolder': { const vv = need(); vv.folders.push((a.parent ? a.parent + '/' : '') + a.name); put('mock.vault', vv); changed(); return { path: a.name }; }
      case 'vault.renamePlan': { const vv = need(); const old = base(a.path); const notes = notesOf(vv).filter((n) => n !== a.path && linksTo(disk()[full(vv, n)].text, old)); return { links: notes.reduce((s, n) => s + linksTo(disk()[full(vv, n)].text, old), 0), notes }; }
      case 'vault.rename': {
        const vv = need(); const old = base(a.path); const folder = a.path.includes('/') ? a.path.slice(0, a.path.lastIndexOf('/') + 1) : '';
        const to = folder + a.name + '.md'; const d = disk(); const fromFull = full(vv, a.path), toFull = full(vv, to);
        d[toFull] = d[fromFull]; delete d[fromFull]; saveDisk(d);
        let links = 0; const updated = [], skipped = [];
        if (a.updateLinks) for (const n of notesOf(vv)) { const f = full(vv, n); const t = disk()[f].text; const c = linksTo(t, old); if (!c) continue; if ((a.skip || []).includes(f)) { skipped.push(n); continue; } write(f, t.split(`[[${old}]]`).join(`[[${a.name}]]`)); links += c; updated.push(f); }
        for (const doc of Object.values(docs)) if (doc.path === fromFull) { doc.path = toFull; doc.stamp = disk()[toFull].stamp; }   // the Markdown bench's C# side follows (shell.moved)
        send({ event: 'moved', moves: [{ from: fromFull, to: toFull }] });
        changed();
        return { moves: [{ from: a.path, to, fromFull, toFull }], links, notes: updated.length, skipped, updated };
      }
      case 'vault.delete': { const vv = need(); const d = disk(); const gone = []; for (const p of a.paths) { if (d[full(vv, p)]) { delete d[full(vv, p)]; gone.push(full(vv, p)); } } saveDisk(d); changed(); return { deleted: gone.length, paths: gone }; }
      case 'vault.reveal': (window.__revealed = window.__revealed || []).push(a.path || ''); return null;
      case 'vault.close': put('mock.vault', null); send({ event: 'bench', bench: 'noor.vault', name: 'opened', payload: { root: null } }); return null;
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
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
    await context.addInitScript(MOCK, [MARKDOWN, VAULT]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const mdState = () => page.evaluate(() => { const i = window.__noor.open.get('noor.markdown'); return i && i.mounted && i.mounted._state ? i.mounted._state() : null; });
    const disk = () => page.evaluate(() => JSON.parse(localStorage.getItem('mock.disk') || '{}'));
    const dialogButton = (label) => page.click(`.nui-dialog .nui-btn:text-is("${label}")`);
    const clickMenu = async (title, item) => { await page.click(`[data-menu]:text-is("${title}")`); await page.click(`.nui-menu .mi:has-text("${item}")`); };
    const R = 'C:\\Notes\\Ideas';

    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.vt-welcome');

    // ---------------------------------------------------------------- no vault yet: the welcome and the wizard
    check('the Vault bench, with no vault: a welcome with the wizard', (await page.textContent('.vt-welcome h1')).includes('linked together') && await page.isVisible('.vt-welcome .nui-btn.primary'));
    await page.click('.vt-welcome .nui-btn.primary');
    await page.waitForSelector('.vt-wiz');
    const groups = await page.$$eval('.vt-wiz-group', (xs) => xs.map((x) => x.textContent));
    check('the wizard groups the structures (start simple, the popular ones…)', groups.join('|') === 'Start simple|Popular structures', groups);
    await page.click('.vt-wiz-card[data-preset="zettelkasten"]');
    check('choosing one shows what you get: its folders and starter notes', (await page.textContent('.vt-wiz-preview')).includes('Permanent') && (await page.textContent('.vt-wiz-preview')).includes('One idea per note.md'));
    check('…and suggests a name', (await page.inputValue('.vt-wiz-name input')) === 'My Zettelkasten vault');
    await page.fill('.vt-wiz-name input', 'Ideas');
    check('the preview follows the name', (await page.textContent('.vt-wiz-tree')).includes('📁 Ideas'));
    await page.evaluate(() => localStorage.setItem('mock.folders', JSON.stringify(['C:\\Notes'])));
    await dialogButton('Choose where to make it…');
    await waitFn(page, () => window.__noor.active() === 'noor.markdown' && [...document.querySelectorAll('.md-tab .name')].some((n) => n.textContent === 'Home.md'));
    check('made: its Home note opens in the Markdown bench', (await page.textContent('.md-tab[aria-selected=true] .name')) === 'Home.md');

    // ---------------------------------------------------------------- the vault's home
    await page.click('.btab[data-bench="noor.vault"]');
    await page.waitForSelector('.vt-head h1');
    check('the vault\'s home: its name and where it is', (await page.textContent('.vt-head h1')) === 'Ideas' && (await page.textContent('.vt-path')) === R);
    check('…recently changed notes', (await page.$$('.vt-card .vt-row')).length === 4);
    check('…and its tags', (await page.$$eval('.vt-tag', (xs) => xs.map((x) => x.textContent))).some((t) => t.startsWith('#permanent')));
    await page.fill('.vt-search', 'idea');
    await page.waitForSelector('.vt-results .vt-hit');
    check('search finds notes by name and by what they say', (await page.$$eval('.vt-results .vt-hit .n', (xs) => xs.map((x) => x.textContent))).includes('One idea per note'));
    await page.click('.vt-results .vt-hit:has(.n:text-is("One idea per note"))');
    await waitFn(page, () => window.__noor.active() === 'noor.markdown' && [...document.querySelectorAll('.md-tab .name')].some((n) => n.textContent === 'One idea per note.md'));
    check('a result opens in the Markdown bench', (await page.textContent('.md-tab[aria-selected=true] .name')) === 'One idea per note.md');

    // ---------------------------------------------------------------- the Vault's panels, docked in the Markdown bench
    await clickMenu('View', 'Explorer (Vault)');
    await page.waitForSelector('section.bench[data-bench="noor.markdown"] .vt-tree .vt-item');
    const items = await page.$$eval('section.bench[data-bench="noor.markdown"] .vt-item .nm', (xs) => xs.map((x) => x.textContent));
    check('the Explorer docks beside your writing and lists the vault', items.includes('Index') && items.includes('Permanent') && items.includes('Home'), items);
    check('…with the note on screen marked (its folder opened to show it)', (await page.textContent('section.bench[data-bench="noor.markdown"] .vt-item.current .nm')) === 'One idea per note');
    await clickMenu('View', 'Backlinks (Vault)');
    await page.waitForSelector('section.bench[data-bench="noor.markdown"] .vt-list .vt-hit');
    const bl = await page.$$eval('section.bench[data-bench="noor.markdown"] .vt-list .vt-sub', (xs) => xs.map((x) => x.textContent));
    check('Backlinks: what links to the note on screen', bl.some((t) => t.startsWith('2 links to “One idea per note”')), bl);
    await page.click('section.bench[data-bench="noor.markdown"] .vt-item .nm:text-is("Index")').catch(() => {});
    await page.waitForTimeout(150);
    await page.click('section.bench[data-bench="noor.markdown"] .vt-item .nm:text-is("Start here")');
    await waitFn(page, () => [...document.querySelectorAll('.md-tab .name')].some((n) => n.textContent === 'Start here.md'));
    check('clicking a note in the Explorer opens it', (await page.textContent('.md-tab[aria-selected=true] .name')) === 'Start here.md');

    // ---------------------------------------------------------------- wiki links in the editor
    await page.click('.md-modes button[data-mode="markdown"]');
    await page.waitForTimeout(150);
    await page.click('.md-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div:last-child');
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('See [[On');
    await page.waitForSelector('.md-wiki .md-wiki-item');
    check('typing [[ suggests notes from the vault', (await page.$$eval('.md-wiki .md-wiki-item .n', (xs) => xs.map((x) => x.textContent))).join() === 'One idea per note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    let st = await mdState();
    check('Enter finishes the link', st.docs.find((d) => d.name === 'Start here.md').text.includes('See [[One idea per note]]'), st.docs.find((d) => d.name === 'Start here.md').text);
    check('…and the suggestions go away', !(await page.$('.md-wiki')));
    await page.keyboard.type(' and [[Brand new idea]]');
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    // Ctrl+click a link to a note that doesn't exist yet: offered, made, opened.
    const linkBox = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('.md-pane:not([hidden]) .toastui-editor-md-container .ProseMirror > div')];
      const line = lines.find((l) => l.textContent.includes('[[Brand new idea]]'));
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) { const i = node.textContent.indexOf('Brand new'); if (i >= 0) { const r = document.createRange(); r.setStart(node, i + 2); r.setEnd(node, i + 3); const b = r.getBoundingClientRect(); return { x: b.left + 1, y: b.top + b.height / 2 }; } }
      return null;
    });
    await page.keyboard.down('Control');
    await page.mouse.click(linkBox.x, linkBox.y);
    await page.keyboard.up('Control');
    await page.waitForSelector('.nui-dialog');
    check('Ctrl+click a link to a note that isn\'t there yet: offered', (await page.textContent('.nui-dialog .body')).includes('Brand new idea') && (await page.textContent('.nui-dialog .body')).includes('in “Index”'));
    await dialogButton('Make it');
    await waitFn(page, () => [...document.querySelectorAll('.md-tab .name')].some((n) => n.textContent === 'Brand new idea.md'));
    check('…made next to the note, and opened', !!(await disk())[R + '\\Index\\Brand new idea.md']);

    // ---------------------------------------------------------------- renaming a note keeps the links working
    await page.click('.md-tab .name:text-is("Start here.md")');
    await page.keyboard.press('Control+s');   // Start here saved: clean, so it can follow the rename
    await page.waitForTimeout(200);
    await page.click('.md-tab .name:text-is("One idea per note.md")');
    await page.waitForTimeout(150);
    await page.click('section.bench[data-bench="noor.markdown"] .vt-item.current', { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Rename…")');
    await page.waitForSelector('.nui-dialog input');
    await page.fill('.nui-dialog input', 'Atomic notes');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.nui-dialog .nui-btn:text-is("Rename and update links")');
    check('renaming asks about the links to it', (await page.textContent('.nui-dialog header')).includes('Update 3 links'));
    await dialogButton('Rename and update links');
    await waitFn(page, () => [...document.querySelectorAll('.md-tab .name')].some((n) => n.textContent === 'Atomic notes.md'));
    const d2 = await disk();
    check('the file is renamed, and the notes linking to it now say [[Atomic notes]]', !!d2[R + '\\Permanent\\Atomic notes.md'] && d2[R + '\\Index\\Start here.md'].text.includes('[[Atomic notes]]') && d2[R + '\\Home.md'].text.includes('[[Atomic notes]]'));
    check('the open tab follows the renamed note', (await page.textContent('.md-tab[aria-selected=true] .name')) === 'Atomic notes.md');
    await waitFn(page, () => { const i = window.__noor.open.get('noor.markdown'); const d = i.mounted._state().docs.find((x) => x.name === 'Start here.md'); return d && d.text.includes('[[Atomic notes]]'); });
    st = await mdState();
    check('…and an open note that links to it (no unsaved changes) updates by itself', !st.docs.find((d) => d.name === 'Start here.md').dirty);
    await page.waitForTimeout(300);
    check('the Explorer shows the new name', (await page.$$eval('section.bench[data-bench="noor.markdown"] .vt-item .nm', (xs) => xs.map((x) => x.textContent))).includes('Atomic notes'));

    // ---------------------------------------------------------------- new notes and deleting
    await page.click('section.bench[data-bench="noor.markdown"] .vt-panel-head .nui-icon[title="New note"]');
    await page.waitForSelector('.nui-dialog input');
    await page.fill('.nui-dialog input', 'Shopping');
    await dialogButton('Make it');
    await waitFn(page, () => [...document.querySelectorAll('.md-tab .name')].some((n) => n.textContent === 'Shopping.md'));
    check('New note (Explorer): made and opened', !!(await disk())[R + '\\Shopping.md']);
    await page.waitForTimeout(300);
    await page.click('section.bench[data-bench="noor.markdown"] .vt-item .nm:text-is("Shopping")', { button: 'right' });
    await page.click('.nui-menu .mi:has-text("Delete…")');
    await page.waitForSelector('.nui-dialog');
    check('deleting asks first (the Recycle Bin)', (await page.textContent('.nui-dialog .body')).includes('Recycle Bin'));
    await dialogButton('Move to the Recycle Bin');
    await page.waitForTimeout(400);
    check('…and it\'s gone from the vault', !(await disk())[R + '\\Shopping.md'] && !(await page.$$eval('section.bench[data-bench="noor.markdown"] .vt-item .nm', (xs) => xs.map((x) => x.textContent))).includes('Shopping'));
    check('…and its tab (no unsaved changes) closes', !(await page.$$eval('.md-tab .name', (xs) => xs.map((x) => x.textContent))).includes('Shopping.md'));
    check('renaming in the vault doesn\'t bury you in messages', (await page.$$eval('.nui-toast', (xs) => xs.filter((t) => /changed on disk/.test(t.textContent)).length)) === 0, await page.$$eval('.nui-toast', (xs) => xs.map((t) => t.textContent)));
    await page.fill('section.bench[data-bench="noor.markdown"] .vt-filter', 'atom');
    await page.waitForTimeout(100);
    check('the Explorer\'s filter narrows the list', (await page.$$eval('section.bench[data-bench="noor.markdown"] .vt-item .nm', (xs) => xs.map((x) => x.textContent))).join() === 'Permanent/Atomic notes');
    await page.fill('section.bench[data-bench="noor.markdown"] .vt-filter', '');

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.click('.md-tab .name:text-is("Start here.md")');
      await page.click('.md-modes button[data-mode="wysiwyg"]');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, 'noormd3-vault-in-markdown.png') });
      await page.click('.btab[data-bench="noor.vault"]');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, 'noormd3-vault-home.png') });
      await page.evaluate(() => { window.__noor.open.get('noor.vault').mounted.commands['vault.wizard'](); });
      await page.waitForSelector('.vt-wiz');
      await page.click('.vt-wiz-card[data-preset="para"]');
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, 'noormd3-vault-wizard.png') });
      await dialogButton('Cancel');
    }

    check('no errors on the page', errors.length === 0, errors);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
