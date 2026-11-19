// The Vault bench's web module (contract v1). Its tab is the vault's home: search, recent notes, tags, and the wizard
// that starts a vault. Its panels (Explorer, Backlinks, Tags, Search) dock beside your writing in any bench. Notes open
// in the Markdown bench (the C# side hands them over); renames keep links working.
import { el, menu, quickPick } from '/ui/js/noor-ui.js';
import { createMap } from './map.js';

const here = (p) => new URL(p, import.meta.url).href;
const baseName = (p) => (p || '').split('/').pop().replace(/\.(md|markdown|mdown|mkd)$/i, '');
const folderOf = (p) => (p && p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
};
const fail = (ctx) => (e) => ctx.toast(e.message, { error: true });

/** The Markdown bench tells everyone which document is on screen and which ones have unsaved changes. */
function dirtyPaths(ctx) { return new Promise((resolve) => { const off = ctx.subscribe('docs.dirty', (p) => { setTimeout(() => off(), 0); resolve((p && p.paths) || []); }); setTimeout(() => resolve([]), 60); }); }

// ---------------------------------------------------------------- actions shared by the view and the panels
async function openNote(ctx, path) { try { await ctx.call('vault.openNote', { path }); } catch (e) { fail(ctx)(e); } }

async function askName(ctx, title, label, value = '', okLabel = 'OK') {
  let input;
  const ok = await ctx.dialog(title, el('label', { class: 'vt-field' }, el('span', { text: label }),
    input = el('input', { class: 'nui-field', type: 'text', value, onkeydown: (e) => { if (e.key === 'Enter') e.target.closest('.nui-dialog').querySelector('.nui-btn.primary').click(); } })),
  [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: true }]);
  return ok ? input.value.trim() : null;
}

async function newNote(ctx, folder = '') {
  const name = await askName(ctx, 'New note', folder ? `Its name (in “${folder}”)` : 'Its name', '', 'Make it');
  if (!name) return;
  try { await ctx.call('vault.newNote', { folder, name }); } catch (e) { fail(ctx)(e); }
}
async function newFolder(ctx, parent = '') {
  const name = await askName(ctx, 'New folder', parent ? `Its name (in “${parent}”)` : 'Its name', '', 'Make it');
  if (!name) return;
  try { await ctx.call('vault.newFolder', { parent, name }); } catch (e) { fail(ctx)(e); }
}

/** Renames or moves keep links working: the user is told how many links change, and chooses. */
async function afterMove(ctx, r) {
  if (r.updated && r.updated.length) ctx.publish('files.rewritten', { paths: r.updated });
  const bits = [];
  if (r.links) bits.push(`${r.links} link${r.links === 1 ? '' : 's'} updated in ${r.notes} note${r.notes === 1 ? '' : 's'}`);
  if (r.skipped && r.skipped.length) bits.push(`not updated (open with unsaved changes): ${r.skipped.slice(0, 3).join(', ')}`);
  if (bits.length) ctx.toast(bits.join(' · '));
}
async function chooseLinks(ctx, plan, verb) {
  if (!plan.links) return true;
  const who = plan.notes.length === 1 ? `“${baseName(plan.notes[0])}”` : `${plan.notes.length} notes`;
  const v = await ctx.dialog(`Update ${plan.links} link${plan.links === 1 ? '' : 's'}?`, el('p', { text: `${who} link${plan.notes.length === 1 ? 's' : ''} to what you're about to ${verb.toLowerCase()}. NoorMD can update those links so they keep working.` }),
    [{ label: 'Cancel', value: null }, { label: `${verb} only`, value: 'only' }, { label: `${verb} and update links`, value: 'update', primary: true }]);
  return v === null ? null : v === 'update';
}
async function renameItem(ctx, path, isFolder) {
  const current = isFolder ? path.split('/').pop() : baseName(path);
  const name = await askName(ctx, isFolder ? 'Rename the folder' : 'Rename the note', 'New name', current, 'Rename');
  if (!name || name === current) return;
  try {
    const plan = await ctx.call('vault.renamePlan', { path, name });
    const update = await chooseLinks(ctx, plan, 'Rename');
    if (update === null) return;
    await afterMove(ctx, await ctx.call('vault.rename', { path, name, updateLinks: update, skip: await dirtyPaths(ctx) }));
  } catch (e) { fail(ctx)(e); }
}
async function moveItems(ctx, paths, folder) {
  try {
    const plan = await ctx.call('vault.movePlan', { paths, folder });
    const update = await chooseLinks(ctx, plan, 'Move');
    if (update === null) return;
    await afterMove(ctx, await ctx.call('vault.move', { paths, folder, updateLinks: update, skip: await dirtyPaths(ctx) }));
  } catch (e) { fail(ctx)(e); }
}
async function moveDialog(ctx, path) {
  const tree = await ctx.call('vault.tree').catch(() => null);
  if (!tree) return;
  const folders = ['', ...tree.entries.filter((e) => e.folder && e.path !== path && !e.path.startsWith(path + '/')).map((e) => e.path)];
  const sel = el('select', { class: 'nui-select', size: '10', style: { width: '100%' } }, ...folders.map((f) => el('option', { value: f, text: f || `${tree.name} (the top)` })));
  sel.value = folderOf(path);
  const ok = await ctx.dialog(`Move “${path.split('/').pop()}”`, el('label', { class: 'vt-field' }, el('span', { text: 'To which folder?' }), sel), [{ label: 'Cancel', value: false }, { label: 'Move', value: true, primary: true }]);
  if (ok && sel.value !== folderOf(path)) moveItems(ctx, [path], sel.value);
}
async function deleteItems(ctx, paths) {
  const label = paths.length === 1 ? `“${paths[0].split('/').pop()}”` : `${paths.length} items`;
  const ok = await ctx.dialog(`Delete ${label}?`, el('p', { text: 'It goes to the Windows Recycle Bin, where you can get it back.' }), [{ label: 'Cancel', value: false }, { label: 'Move to the Recycle Bin', value: true, primary: true }]);
  if (!ok) return;
  try {
    const r = await ctx.call('vault.delete', { paths });
    if (r && r.paths && r.paths.length) ctx.publish('files.deleted', { paths: r.paths });
  } catch (e) { fail(ctx)(e); }
}
// ---------------------------------------------------------------- bookmarks, Pack & Share, a random note
let marked = new Set();   // the open vault's bookmarks (kept fresh by whoever loads them)
async function loadBookmarks(ctx) {
  const list = await ctx.call('vault.bookmarks').catch(() => []);
  marked = new Set(list.map((b) => b.path));
  return list;
}
async function setBookmark(ctx, path, on) {
  try { await ctx.call('vault.bookmark', { path, on }); ctx.toast(on ? `Bookmarked “${baseName(path) || path}”.` : 'Bookmark removed.'); } catch (e) { fail(ctx)(e); }
}
async function randomNote(ctx) { try { await ctx.call('vault.random', {}); } catch (e) { fail(ctx)(e); } }
const hitLabel = (h) => (h.nameMatch || !h.line ? folderOf(h.path) || 'in the vault' : `line ${h.line}: ${h.snippet}`);
const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Pack & Share: notes (and what they link to) into one ZIP to send someone, or to hand to an AI assistant. */
async function packDialog(ctx, selection = []) {
  const opts = { selection, attachments: true, dependencies: true, preserve: true, manifest: false, handoff: false, note: '' };
  let plan = null, timer = 0;
  const summary = el('div', { class: 'vt-pack-sum' }, el('span', { class: 'nui-muted', text: 'Looking…' }));
  const details = el('div', { class: 'vt-pack-details' });
  async function refresh() {
    plan = await ctx.call('vault.packPlan', opts).catch((e) => { summary.replaceChildren(el('span', { class: 'vt-warn', text: e.message })); return null; });
    if (!plan) return;
    const deps = plan.dependencies.filter((d) => d.included);
    summary.replaceChildren(el('b', { text: `${plan.fileCount} file${plan.fileCount === 1 ? '' : 's'} · ${kb(plan.bytes)}` }),
      el('span', { class: 'nui-muted', text: [deps.length ? `${deps.length} linked from outside the selection` : '', plan.excludedCount ? `${plan.excludedCount} left out (private or hidden)` : ''].filter(Boolean).join(' · ') }));
    details.replaceChildren(
      ...plan.warnings.map((w) => el('div', { class: 'vt-warn', text: '⚠ ' + w })),
      plan.unresolved.length ? el('details', {}, el('summary', { text: `${plan.unresolved.length} link${plan.unresolved.length === 1 ? '' : 's'} lead nowhere` }),
        ...plan.unresolved.slice(0, 40).map((u) => el('div', { class: 'vt-pack-row', text: `${u.from}: ${u.target} (${u.problem})` }))) : '',
      el('details', {}, el('summary', { text: 'What goes in' }), ...plan.files.slice(0, 300).map((f) => el('div', { class: 'vt-pack-row' + (f.dependency ? ' dep' : ''), text: `${f.entry}${f.dependency ? ' (linked)' : ''} · ${kb(f.size)}` }))));
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 200); };
  const check = (key, label, hint) => el('label', { class: 'vt-check', title: hint || '' }, el('input', { type: 'checkbox', checked: opts[key] || undefined, onchange: (e) => { opts[key] = e.target.checked; noteBox.hidden = !opts.handoff; later(); } }), label);
  const noteBox = el('label', { class: 'vt-field', hidden: true }, el('span', { text: 'A note for the assistant (what you want it to do)' }),
    el('textarea', { class: 'nui-field vt-pack-note', rows: '3', oninput: (e) => { opts.note = e.target.value; } }));
  const what = selection.length ? selection.map((s) => baseName(s) || s.split('/').pop()).join(', ') : 'the whole vault';
  refresh();
  const go = await ctx.dialog('Pack & Share', () => el('div', { class: 'vt-pack' },
    el('p', { class: 'vt-wiz-lead', text: `Packs ${what} into one ZIP file, to send to someone or keep. Nothing is uploaded anywhere.` }),
    el('div', { class: 'vt-pack-opts' },
      check('dependencies', 'Notes and pictures they link to', 'Adds what the chosen notes link to, so nothing is missing at the other end'),
      check('attachments', 'Pictures and other files', 'Not only notes'),
      check('preserve', 'Keep the folders', 'Off: every file in one folder'),
      check('manifest', 'A list of the contents (manifest)', ''),
      check('handoff', 'For an AI assistant (adds a guide to the vault)', 'Adds a short README explaining how the notes link together')),
    noteBox, summary, details), [{ label: 'Cancel', value: false }, { label: 'Save the ZIP…', value: true, primary: true }]);
  clearTimeout(timer);
  if (!go) return;
  const dirty = await dirtyPaths(ctx);
  if (dirty.length) ctx.toast(`${dirty.length} document${dirty.length === 1 ? ' has' : 's have'} unsaved changes: the ZIP gets what's saved on disk.`);
  try {
    const r = await ctx.call('vault.packCreate', opts);
    if (!r) return;
    ctx.toast(r.failures.length ? `Saved with ${r.failures.length} file${r.failures.length === 1 ? '' : 's'} missing: ${r.path}` : `Packed ${r.entries} file${r.entries === 1 ? '' : 's'} into ${r.path}`, { error: r.failures.length > 0 });
  } catch (e) { fail(ctx)(e); }
}

function itemMenu(ctx, x, y, entry, anchor) {
  const folder = entry.folder ? entry.path : folderOf(entry.path);
  const isMarked = marked.has(entry.path);
  menu(x, y, [
    ...(entry.note ? [{ label: 'Open', run: () => openNote(ctx, entry.path) }, '-'] : []),
    ...(entry.path ? [{ label: isMarked ? 'Remove the bookmark' : 'Bookmark ☆', run: () => setBookmark(ctx, entry.path, !isMarked) }] : []),
    { label: 'Pack & Share…', run: () => packDialog(ctx, entry.path ? [entry.path] : []) },
    '-',
    { label: 'New note here', run: () => newNote(ctx, folder) },
    { label: 'New folder here', run: () => newFolder(ctx, folder) },
    { label: 'New note from a template…', run: () => fromTemplate(ctx, folder) },
    '-',
    { label: 'Rename…', disabled: !entry.path, run: () => renameItem(ctx, entry.path, entry.folder) },
    { label: 'Move to…', disabled: !entry.path, run: () => moveDialog(ctx, entry.path) },
    { label: 'Show in Explorer', run: () => ctx.call('vault.reveal', { path: entry.path }).catch(fail(ctx)) },
    '-',
    { label: 'Delete…', disabled: !entry.path, run: () => deleteItems(ctx, [entry.path]) },
  ], { anchor });
}

// ---------------------------------------------------------------- go to a note (Ctrl+P), today's note, templates
async function switcher(ctx) {
  const notes = await ctx.call('vault.notes').catch(() => []);
  if (!notes.length) { ctx.toast('No vault open, or it has no notes yet.'); return; }
  const items = [];
  for (const n of notes) {
    items.push({ label: n.name, detail: n.path, icon: '📝', keywords: (n.aliases || []).join(' '), path: n.path });
    for (const a of n.aliases || []) items.push({ label: a, detail: `→ ${n.name} · ${n.path}`, icon: '↪', path: n.path });
  }
  const pick = await quickPick(items, { placeholder: 'Go to a note (type part of its name)', empty: 'No note matches.' });
  if (pick) openNote(ctx, pick.path);
}
async function today(ctx) { try { await ctx.call('vault.daily', {}); } catch (e) { fail(ctx)(e); } }
async function fromTemplate(ctx, folder = '') {
  const [templates, tree] = await Promise.all([ctx.call('vault.templates').catch(() => []), ctx.call('vault.tree').catch(() => null)]);
  if (!templates.length) { ctx.toast('This vault has no templates yet: notes in a folder called Templates become templates.'); return; }
  const tpl = el('select', { class: 'nui-select' }, ...templates.map((t) => el('option', { value: t.path, text: t.name })));
  const folders = ['', ...(tree ? tree.entries.filter((e) => e.folder && !e.path.startsWith('Templates')).map((e) => e.path) : [])];
  const where = el('select', { class: 'nui-select' }, ...folders.map((f) => el('option', { value: f, text: f || '(the top of the vault)' })));
  where.value = folder;
  const name = el('input', { class: 'nui-field', type: 'text', placeholder: 'Its name' });
  const ok = await ctx.dialog('New note from a template', el('div', { class: 'vt-form' },
    el('label', { class: 'vt-field' }, el('span', { text: 'Template' }), tpl),
    el('label', { class: 'vt-field' }, el('span', { text: 'Name' }), name),
    el('label', { class: 'vt-field' }, el('span', { text: 'Folder' }), where)),
  [{ label: 'Cancel', value: false }, { label: 'Make it', value: true, primary: true }]);
  if (!ok || !name.value.trim()) return;
  try { await ctx.call('vault.newFromTemplate', { template: tpl.value, folder: where.value, name: name.value.trim() }); } catch (e) { fail(ctx)(e); }
}

// ---------------------------------------------------------------- the wizard
async function wizard(ctx) {
  const presets = await ctx.call('vault.presets').catch(() => []);
  if (!presets.length) return;
  let chosen = presets.find((p) => p.id === 'para') || presets[0];
  let nameInput;
  const body = () => {
    const preview = el('div', { class: 'vt-wiz-preview' });
    const showPreview = () => {
      preview.replaceChildren(
        el('div', { class: 'vt-wiz-ptitle' }, el('span', { class: 'vt-wiz-icon', text: chosen.icon }), el('b', { text: chosen.name })),
        el('p', { text: chosen.description }),
        el('div', { class: 'vt-wiz-tree' },
          el('div', { class: 'f', text: '📁 ' + (nameInput && nameInput.value.trim() || 'Your vault') }),
          el('div', { class: 'n', text: '📝 Home.md' }),
          ...chosen.folders.map((f) => el('div', { class: 'f', style: { paddingLeft: `${18 + (f.split('/').length - 1) * 14}px` }, text: '📁 ' + f.split('/').pop() })),
          ...chosen.notes.map((n) => el('div', { class: 'n', style: { paddingLeft: `${18 + (n.split('/').length - 1) * 14}px` }, text: (n.startsWith('Templates/') ? '🧩 ' : '📝 ') + n.split('/').pop() }))),
        chosen.notes.some((n) => n.startsWith('Templates/')) ? el('p', { class: 'nui-muted', text: '🧩 are templates: starting points for new notes.' }) : '');
    };
    const groups = [...new Set(presets.map((p) => p.group))];
    const cards = el('div', { class: 'vt-wiz-cards' }, ...groups.flatMap((g) => [
      el('div', { class: 'vt-wiz-group', text: g }),
      ...presets.filter((p) => p.group === g).map((p) => el('button', { class: 'vt-wiz-card', 'data-preset': p.id, 'aria-pressed': String(p === chosen), onclick: (e) => {
        chosen = p; cards.querySelectorAll('.vt-wiz-card').forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget))); showPreview();
        if (!nameInput.dataset.touched) nameInput.value = p.id === 'blank' ? 'My vault' : `My ${p.name} vault`;
      } }, el('span', { class: 'vt-wiz-icon', text: p.icon }), el('span', { class: 'vt-wiz-text' }, el('b', { text: p.name }), el('span', { text: p.goodFor })))),
    ]));
    nameInput = el('input', { class: 'nui-field', type: 'text', value: 'My PARA vault', oninput: (e) => { e.target.dataset.touched = '1'; showPreview(); } });
    showPreview();
    return el('div', { class: 'vt-wiz' },
      el('p', { class: 'vt-wiz-lead', text: 'A vault is a folder of Markdown notes that link to each other. Pick a way to organise it (you can always change it later):' }),
      el('div', { class: 'vt-wiz-main' }, cards, preview),
      el('label', { class: 'vt-field vt-wiz-name' }, el('span', { text: 'Its name (the folder it gets)' }), nameInput));
  };
  const ok = await ctx.dialog('Make a new vault', body, [{ label: 'Cancel', value: false }, { label: 'Choose where to make it…', value: true, primary: true }]);
  if (!ok) return;
  try { const r = await ctx.call('vault.create', { name: nameInput.value.trim(), preset: chosen.id }); if (r) ctx.toast(`Your vault is ready: ${r.root}`); }
  catch (e) { fail(ctx)(e); }
}

export default {
  mount(root, ctx) {
    ctx.useStyle(here('bench.css'));
    const box = el('div', { class: 'vt-home' });
    root.replaceChildren(box);
    let state = null, searchTimer = 0, searchInput = null, view = ctx.restore('view', 'home'), map = null;
    const viewSwitch = () => el('div', { class: 'nui-seg vt-views', role: 'group', 'aria-label': 'View' },
      ...[['home', 'Home'], ['map', 'Map']].map(([v, l]) => el('button', { 'data-view': v, 'aria-pressed': String(view === v), onclick: () => setView(v) }, l)));
    function setView(v) { if (view === v) return; view = v; ctx.keep('view', v); render(); }

    async function render() {
      try { state = await ctx.call('vault.state'); } catch (e) { box.replaceChildren(el('p', { text: e.message })); return; }
      ctx.setTitle(state.open ? state.name : '');
      ctx.setStatus(state.open ? `${state.notes.toLocaleString()} note${state.notes === 1 ? '' : 's'} · ${state.root}` : 'No vault open');
      if (!state.open) { if (map) { map.destroy(); map = null; } renderWelcome(); return; }
      if (view === 'map') { await renderMap(); return; }
      if (map) { map.destroy(); map = null; }
      const [recent, tags, marks] = await Promise.all([ctx.call('vault.recentNotes').catch(() => []), ctx.call('vault.tags').catch(() => []), loadBookmarks(ctx)]);
      const results = el('div', { class: 'vt-results' });
      searchInput = el('input', { class: 'nui-field vt-search', type: 'search', placeholder: `Search ${state.name} (Ctrl+Shift+F)`, 'aria-label': 'Search the vault',
        oninput: () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(searchInput.value, results), 150); },
        onkeydown: (e) => { if (e.key === 'Enter') { const first = results.querySelector('.vt-hit'); if (first) first.click(); } } });
      box.replaceChildren(
        el('header', { class: 'vt-head' },
          el('div', { class: 'vt-name' }, el('span', { class: 'vt-logo', text: '🗄' }), el('div', {}, el('h1', { text: state.name }), el('div', { class: 'nui-muted vt-path', text: state.root }))),
          el('div', { class: 'vt-acts' }, viewSwitch(),
            el('button', { class: 'nui-btn primary', onclick: () => newNote(ctx) }, 'New note'),
            el('button', { class: 'nui-btn', title: 'Today\'s note', onclick: () => today(ctx) }, 'Today'),
            el('button', { class: 'nui-btn', title: 'Open a random note (rediscover something)', onclick: () => randomNote(ctx) }, '🎲'),
            el('button', { class: 'nui-btn', onclick: () => newFolder(ctx) }, 'New folder'),
            el('button', { class: 'nui-btn quiet', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); vaultMenu(r.left, r.bottom + 2); } }, 'More ▾'))),
        searchInput,
        el('div', { class: 'vt-hint nui-muted' }, 'Try ', ...['tag:idea', 'path:Projects', '"exact words"', '-skip', 'status:done'].map((t) => el('button', { class: 'vt-op', title: 'Add to the search', onclick: () => { searchInput.value = (searchInput.value.trim() + ' ' + t).trim(); searchInput.focus(); runSearch(searchInput.value, results); } }, t))),
        results,
        el('div', { class: 'vt-cols' },
          ...(marks.length ? [el('section', { class: 'vt-card' }, el('h2', { text: 'Bookmarks' }),
            ...marks.map((b) => el('button', { class: 'vt-row' + (b.exists ? '' : ' gone'), title: b.path, onclick: () => (b.folder ? null : openNote(ctx, b.path)),
              oncontextmenu: (e) => { e.preventDefault(); itemMenu(ctx, e.clientX, e.clientY, { path: b.path, folder: b.folder, note: !b.folder }, box); } },
            el('span', { class: 'n', text: (b.folder ? '📁 ' : '☆ ') + b.name }), el('span', { class: 'm', text: folderOf(b.path) || 'in the vault' }))))] : []),
          el('section', { class: 'vt-card' }, el('h2', { text: 'Recently changed' }),
            ...(recent.length ? recent.map((n) => el('button', { class: 'vt-row', title: n.path, onclick: () => openNote(ctx, n.path) }, el('span', { class: 'n', text: n.name }), el('span', { class: 'm', text: `${folderOf(n.path) ? folderOf(n.path) + ' · ' : ''}${ago(n.modified)}` })))
              : [el('p', { class: 'nui-muted', text: 'No notes yet. Make one!' })])),
          el('section', { class: 'vt-card' }, el('h2', { text: 'Tags' }),
            tags.length ? el('div', { class: 'vt-tags' }, ...tags.slice(0, 60).map((t) => el('button', { class: 'vt-tag', onclick: () => { searchInput.value = '#' + t.tag; showTagged(t.tag, results); } }, `#${t.tag}`, el('span', { text: String(t.count) }))))
              : el('p', { class: 'nui-muted', text: 'No tags yet. Write #idea in a note, or tags: [idea] at its top.' }))));
    }
    /** The map of the whole vault. */
    async function renderMap() {
      const graph = await ctx.call('vault.graph').catch((e) => { fail(ctx)(e); return null; });
      if (!graph) return;
      const canvas = el('canvas', { class: 'vt-map-canvas', 'aria-label': 'Map of the vault' });
      const info = el('div', { class: 'vt-map-info nui-muted' });
      const filter = el('input', { class: 'nui-field vt-map-filter', type: 'search', placeholder: 'Find on the map (name, folder, #tag)', oninput: (e) => map && map.setHighlight(e.target.value) });
      const missing = el('input', { type: 'checkbox', checked: ctx.restore('map.missing', true) || undefined, onchange: (e) => { ctx.keep('map.missing', e.target.checked); map && map.setShowMissing(e.target.checked); } });
      const folders = [...new Set(graph.nodes.filter((n) => !n.missing).map((n) => n.folder))].sort();
      box.replaceChildren(
        el('header', { class: 'vt-head' },
          el('div', { class: 'vt-name' }, el('span', { class: 'vt-logo', text: '🗄' }), el('div', {}, el('h1', { text: state.name }), el('div', { class: 'nui-muted vt-path', text: `${graph.nodes.filter((n) => !n.missing).length} notes · ${graph.edges.length} links` }))),
          el('div', { class: 'vt-acts' }, viewSwitch(), el('button', { class: 'nui-btn', onclick: () => map && map.fit() }, 'Fit'))),
        el('div', { class: 'vt-map-bar' }, filter, el('label', { class: 'vt-check' }, missing, 'Notes still to make'),
          el('div', { class: 'vt-legend' }, ...folders.slice(0, 10).map((f, i) => el('span', { class: 'vt-legend-item' }, el('i', { style: { background: `hsl(${Math.round((i * 137.5 + 260) % 360)} 62% 62%)` } }), f || 'top')))),
        el('div', { class: 'vt-map-wrap' }, canvas, info));
      if (map) map.destroy();
      map = createMap(canvas, {
        onOpen: (n) => { if (n.missing) ctx.call('vault.createLink', { from: '', target: n.path.slice(1) }).catch(fail(ctx)); else openNote(ctx, n.path); },
        onHover: (n) => { info.textContent = n ? (n.missing ? `${n.name}: not made yet (click to make it)` : `${n.path} · ${n.links} link${n.links === 1 ? '' : 's'}`) : 'Drag to move around, wheel to zoom, click a note to open it.'; },
      });
      info.textContent = 'Drag to move around, wheel to zoom, click a note to open it.';
      map.setShowMissing(missing.checked);
      map.setData(graph);
    }
    function vaultMenu(x, y) {
      menu(x, y, [
        { label: 'Show the vault in Explorer', run: () => ctx.call('vault.reveal', {}).catch(fail(ctx)) },
        { label: 'Make another vault (wizard)…', run: () => wizard(ctx) },
        { label: 'Open another folder as a vault…', run: () => ctx.call('vault.openFolder').catch(fail(ctx)) },
        { label: 'Recent vaults…', run: () => recentDialog() },
        '-',
        { label: 'Pack & Share the vault…', run: () => packDialog(ctx, []) },
        { label: 'A random note', run: () => randomNote(ctx) },
        '-',
        { label: 'Close the vault', run: () => ctx.call('vault.close').catch(fail(ctx)) },
      ], { anchor: box });
    }
    function renderWelcome() {
      box.replaceChildren(el('div', { class: 'vt-welcome' },
        el('div', { class: 'vt-logo big', text: '🗄' }),
        el('h1', { text: 'Your notes, linked together' }),
        el('p', { class: 'nui-muted', text: 'A vault is an ordinary folder of Markdown notes. Link them with [[Note name]], tag them with #idea, and find anything in a moment. The Explorer, Backlinks, Tags and Search panels dock beside your writing.' }),
        el('div', { class: 'vt-acts center' }, el('button', { class: 'nui-btn primary', onclick: () => wizard(ctx) }, 'Make a new vault…'), el('button', { class: 'nui-btn', onclick: () => ctx.call('vault.openFolder').catch(fail(ctx)) }, 'Open a folder as a vault…')),
        state.recent.length ? el('div', { class: 'vt-recent' }, el('h2', { text: 'Recent vaults' }), ...state.recent.map(recentRow)) : ''));
    }
    function recentRow(r) {
      return el('div', { class: 'vt-row' + (r.exists ? '' : ' gone'), role: 'button', tabindex: '0', title: r.path, onclick: () => r.exists && ctx.call('vault.openRecent', { path: r.path }).catch(fail(ctx)) },
        el('span', { class: 'n', text: r.name }), el('span', { class: 'm', text: r.exists ? r.path : `${r.path} (not there any more)` }),
        el('button', { class: 'nui-icon x', title: 'Forget it', onclick: async (e) => { e.stopPropagation(); await ctx.call('vault.forget', { path: r.path }); render(); } }, '✕'));
    }
    async function recentDialog() {
      const s = await ctx.call('vault.state').catch(() => null);
      if (!s || !s.recent.length) { ctx.toast('No recent vaults yet.'); return; }
      await ctx.dialog('Recent vaults', (finish) => el('div', { class: 'vt-recent', onclick: (e) => { if (e.target.closest('.vt-row') && !e.target.closest('.x')) finish(null); } }, ...s.recent.map(recentRow)), [{ label: 'Close', value: null, primary: true }]);
    }
    async function runSearch(q, out) {
      if (q.startsWith('#') && q.length > 1) { showTagged(q.slice(1), out); return; }
      if (!q.trim()) { out.replaceChildren(); return; }
      const hits = await ctx.call('vault.search', { q }).catch(() => []);
      out.replaceChildren(...(hits.length ? hits.slice(0, 50).map((h) => el('button', { class: 'vt-hit', title: h.path, onclick: () => openNote(ctx, h.path) },
        el('span', { class: 'n', text: h.name }), el('span', { class: 'm', text: hitLabel(h) })))
        : [el('p', { class: 'nui-muted', text: `Nothing found for “${q}”.` })]));
    }
    async function showTagged(tag, out) {
      const list = await ctx.call('vault.tagged', { tag }).catch(() => []);
      out.replaceChildren(el('div', { class: 'nui-muted vt-sub', text: `${list.length} note${list.length === 1 ? '' : 's'} tagged #${tag}` }),
        ...list.map((n) => el('button', { class: 'vt-hit', onclick: () => openNote(ctx, n.path) }, el('span', { class: 'n', text: n.name }), el('span', { class: 'm', text: folderOf(n.path) }))));
    }

    let refreshTimer = 0;
    const offs = [
      ctx.on('opened', () => render()),
      ctx.on('bookmarks', () => { if (view === 'home' && !(searchInput && document.activeElement === searchInput)) render(); }),
      ctx.on('changed', () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
          // Typing in the search box isn't interrupted: the results refresh, then the rest.
          if (view === 'map' && map) { const g = await ctx.call('vault.graph').catch(() => null); if (g) map.setData(g); return; }
          if (searchInput && searchInput.value && document.activeElement === searchInput) { runSearch(searchInput.value, box.querySelector('.vt-results')); return; }
          const q = searchInput ? searchInput.value : '';
          await render();
          if (q && searchInput) { searchInput.value = q; runSearch(q, box.querySelector('.vt-results')); }
        }, 300);
      }),
    ];
    render();
    return {
      focus: () => searchInput && searchInput.focus(),
      commands: {
        'vault.wizard': () => wizard(ctx),
        'vault.openFolder': () => ctx.call('vault.openFolder').catch(fail(ctx)),
        'vault.recentDialog': recentDialog,
        'vault.newNote': () => newNote(ctx),
        'vault.newFolder': () => newFolder(ctx),
        'vault.reveal': () => ctx.call('vault.reveal', {}).catch(fail(ctx)),
        'vault.close': () => ctx.call('vault.close').catch(fail(ctx)),
        'vault.focusSearch': () => { if (view !== 'home') setView('home'); setTimeout(() => { if (searchInput) { searchInput.focus(); searchInput.select(); } }, 50); },
        'vault.switcher': () => switcher(ctx),
        'vault.today': () => today(ctx),
        'vault.fromTemplate': () => fromTemplate(ctx),
        'vault.showHome': () => setView('home'),
        'vault.random': () => randomNote(ctx),
        'vault.pack': () => packDialog(ctx, []),
        'vault.showMap': () => setView('map'),
      },
      checked: (cmd) => (cmd === 'vault.showHome' ? view === 'home' : cmd === 'vault.showMap' ? view === 'map' : undefined),
      unmount() { offs.forEach((f) => f()); clearTimeout(refreshTimer); clearTimeout(searchTimer); if (map) map.destroy(); },
      _state: () => ({ ...state, view, mapNodes: map ? map._nodes().length : 0 }),
    };
  },

  panels: {
    // ------------------------------------------------------------ Explorer: the vault's folders and notes
    explorer: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        const open = new Set(ctx.restore('explorer.open', []));
        let current = null, data = null, filter = '', onScreen = null, revealed = null, marks = [], marksOpen = ctx.restore('explorer.marks', true);
        const list = el('div', { class: 'vt-tree', role: 'tree' });
        const filterInput = el('input', { class: 'nui-field vt-filter', type: 'search', placeholder: 'Filter', 'aria-label': 'Filter notes', oninput: (e) => { filter = e.target.value.toLowerCase(); draw(); } });
        const head = el('div', { class: 'vt-panel-head' }, filterInput,
          el('button', { class: 'nui-icon', title: 'New note', 'aria-label': 'New note', onclick: () => newNote(ctx, '') }, '＋'),
          el('button', { class: 'nui-icon', title: 'New folder', 'aria-label': 'New folder', onclick: () => newFolder(ctx, '') }, '🗀'));
        root.replaceChildren(el('div', { class: 'vt-panel' }, head, list));
        async function load() {
          try { data = await ctx.call('vault.tree'); } catch { data = null; }
          marks = data ? await loadBookmarks(ctx) : [];
          draw();
        }
        /** The note on screen (in the Markdown bench), as a vault path; its folders open to show it (once). */
        function findCurrent() {
          current = null;
          if (!onScreen || !onScreen.path || !data) return;
          const norm = onScreen.path.replace(/\\/g, '/'), rootN = data.root.replace(/\\/g, '/');
          if (!norm.toLowerCase().startsWith(rootN.toLowerCase() + '/')) return;
          current = norm.slice(rootN.length + 1);
          if (revealed !== current) { revealed = current; for (let f = folderOf(current); f; f = folderOf(f)) open.add(f); }
        }
        function draw() {
          findCurrent();
          if (!data) { list.replaceChildren(el('div', { class: 'vt-none' }, el('p', { text: 'No vault open.' }), el('button', { class: 'nui-btn', onclick: () => wizard(ctx) }, 'Make one…'))); return; }
          const entries = data.entries;
          const kids = new Map();
          for (const e of entries) { const p = folderOf(e.path); if (!kids.has(p)) kids.set(p, []); kids.get(p).push(e); }
          for (const arr of kids.values()) arr.sort((a, b) => (b.folder - a.folder) || a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
          const rows = [];
          if (filter) {
            for (const e of entries.filter((x) => x.note && x.path.toLowerCase().includes(filter))) rows.push(row(e, 0, true));
          } else {
            const walk = (folder, depth) => { for (const e of kids.get(folder) || []) { if (!e.folder && !e.note) continue; rows.push(row(e, depth)); if (e.folder && open.has(e.path)) walk(e.path, depth + 1); } };
            walk('', 0);
          }
          const markRows = !filter && marks.length ? [
            el('div', { class: 'vt-tree-root vt-marks-head', role: 'button', onclick: () => { marksOpen = !marksOpen; ctx.keep('explorer.marks', marksOpen); draw(); } }, `${marksOpen ? '▾' : '▸'} ☆ Bookmarks`),
            ...(marksOpen ? marks.map((b) => el('div', { class: 'vt-item' + (b.exists ? '' : ' gone') + (current === b.path ? ' current' : ''), title: b.path, style: { paddingLeft: '22px' },
              onclick: () => { if (!b.folder) openNote(ctx, b.path); else { for (let f = b.path; f; f = folderOf(f)) open.add(f); ctx.keep('explorer.open', [...open]); draw(); } },
              oncontextmenu: (ev) => { ev.preventDefault(); itemMenu(ctx, ev.clientX, ev.clientY, { path: b.path, folder: b.folder, note: !b.folder }, list); } },
            el('span', { class: 'ic', text: b.folder ? '📁' : '☆' }), el('span', { class: 'nm', text: b.name }))) : []),
          ] : [];
          list.replaceChildren(...markRows, el('div', { class: 'vt-tree-root', title: data.root, oncontextmenu: (ev) => { ev.preventDefault(); itemMenu(ctx, ev.clientX, ev.clientY, { path: '', folder: true }, list); } }, `🗄 ${data.name}`), ...rows);
          if (!rows.length) list.append(el('div', { class: 'vt-none', text: filter ? 'No note matches.' : 'This vault is empty.' }));
        }
        function row(e, depth, flat = false) {
          const isOpen = open.has(e.path);
          const r = el('div', { class: 'vt-item' + (e.folder ? ' folder' : '') + (current && !e.folder && current === e.path ? ' current' : ''), role: 'treeitem', 'data-path': e.path, draggable: 'true', tabindex: '-1',
            style: { paddingLeft: `${8 + depth * 14}px` }, title: e.path,
            onclick: () => { if (e.folder) { if (isOpen) open.delete(e.path); else open.add(e.path); ctx.keep('explorer.open', [...open]); draw(); } else openNote(ctx, e.path); },
            oncontextmenu: (ev) => { ev.preventDefault(); itemMenu(ctx, ev.clientX, ev.clientY, e, list); },
            ondragstart: (ev) => { ev.dataTransfer.setData('text/x-noor-vault', e.path); ev.dataTransfer.effectAllowed = 'move'; },
            ondragover: (ev) => { if (e.folder && [...ev.dataTransfer.types].includes('text/x-noor-vault')) { ev.preventDefault(); r.classList.add('drop'); } },
            ondragleave: () => r.classList.remove('drop'),
            ondrop: (ev) => { r.classList.remove('drop'); const from = ev.dataTransfer.getData('text/x-noor-vault'); if (from && e.folder && from !== e.path && folderOf(from) !== e.path) { ev.preventDefault(); moveItems(ctx, [from], e.path); } } },
          el('span', { class: 'tw', text: e.folder ? (isOpen ? '▾' : '▸') : '' }), el('span', { class: 'ic', text: e.folder ? '📁' : '📝' }),
          el('span', { class: 'nm', text: e.folder ? e.path.split('/').pop() : (flat ? e.path.replace(/\.(md|markdown|mdown|mkd)$/i, '') : baseName(e.path)) }));
          return r;
        }
        const offs = [
          ctx.on('changed', () => load()), ctx.on('opened', () => load()), ctx.on('bookmarks', () => load()),
          ctx.subscribe('doc.current', (d) => { onScreen = d; draw(); }),
        ];
        load();
        return { unmount: () => offs.forEach((f) => f()) };
      },
    },

    // ------------------------------------------------------------ Backlinks: notes linking to the one on screen
    backlinks: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        const box = el('div', { class: 'vt-panel vt-list' });
        root.replaceChildren(box);
        let doc = null;
        const closed = new Set(ctx.restore('backlinks.closed', []));
        async function linkIt(m, target) {
          const skip = await dirtyPaths(ctx);
          try {
            // A note open with unsaved changes is refused by the vault (with a clear message).
            const r = await ctx.call('vault.linkMention', { source: m.source, target, line: m.line, column: m.column, text: m.text, skip });
            if (r && r.updated) ctx.publish('files.rewritten', { paths: [r.updated] });
            ctx.toast(`Linked in “${m.name}”.`);
          } catch (e) { fail(ctx)(e); }
          draw();
        }
        async function draw() {
          if (!doc || !doc.path) { box.replaceChildren(el('div', { class: 'vt-none', text: 'Open a note from the vault to see what links to it.' })); return; }
          const r = await ctx.call('vault.backlinks', { path: doc.path }).catch(() => ({ inVault: false }));
          if (!r.inVault) { box.replaceChildren(el('div', { class: 'vt-none', text: `“${doc.title}” isn't in the open vault.` })); return; }
          const section = (key, title, count, rows, empty) => {
            const isOpen = !closed.has(key);
            return [el('button', { class: 'vt-sechead', 'aria-expanded': String(isOpen), onclick: () => { if (isOpen) closed.add(key); else closed.delete(key); ctx.keep('backlinks.closed', [...closed]); draw(); } },
              el('span', { text: `${isOpen ? '▾' : '▸'} ${title}` }), el('span', { class: 'nui-muted', text: String(count) })),
            ...(isOpen ? (count ? rows : [el('p', { class: 'nui-muted vt-empty', text: empty })]) : [])];
          };
          const name = baseName(r.path);
          box.replaceChildren(
            el('div', { class: 'vt-bl-head' }, el('b', { text: name }),
              el('button', { class: 'nui-icon vt-star' + (r.bookmarked ? ' on' : ''), title: r.bookmarked ? 'Remove the bookmark' : 'Bookmark this note', 'aria-pressed': String(!!r.bookmarked), onclick: () => setBookmark(ctx, r.path, !r.bookmarked) }, r.bookmarked ? '★' : '☆')),
            ...section('links', 'Links to this note', r.refs.length,
              r.refs.map((x) => el('button', { class: 'vt-hit', title: x.source, onclick: () => openNote(ctx, x.source) }, el('span', { class: 'n', text: x.name }), el('span', { class: 'm', text: `line ${x.line}: ${x.snippet}` }))),
              `Nothing links here yet. Link to it with [[${name}]].`),
            ...section('mentions', 'Mentioned without a link', r.mentions.length,
              r.mentions.map((x) => el('div', { class: 'vt-hit vt-mention', title: x.source },
                el('button', { class: 'n vt-link', onclick: () => openNote(ctx, x.source) }, x.name),
                el('button', { class: 'nui-btn small vt-linkit', title: `Turn “${x.text}” into [[${name}]]`, onclick: () => linkIt(x, r.path) }, 'Link it'),
                el('span', { class: 'm', text: `line ${x.line}: ${x.snippet}` }))),
              'No other note names it without a link.'),
            ...section('outgoing', 'Links from this note', r.outgoing.length,
              r.outgoing.map((x) => el('button', { class: 'vt-hit' + (x.path ? '' : ' missing'), title: x.path || `${x.name} (not made yet: click to make it)`,
                onclick: () => (x.path ? openNote(ctx, x.path) : ctx.call('vault.createLink', { from: doc.path, target: x.target }).catch(fail(ctx))) },
              el('span', { class: 'n', text: x.name }), el('span', { class: 'm', text: x.path ? folderOf(x.path) || 'in the vault' : 'not made yet' }))),
              'This note doesn\'t link anywhere yet.'),
            r.tags.length ? el('div', { class: 'vt-tags small' }, ...r.tags.map((t) => el('span', { class: 'vt-tag', text: '#' + t }))) : '');
        }
        const offs = [ctx.subscribe('doc.current', (d) => { doc = d; draw(); }), ctx.on('changed', () => draw()), ctx.on('opened', () => draw()), ctx.on('bookmarks', () => draw())];
        draw();
        return { unmount: () => offs.forEach((f) => f()) };
      },
    },

    // ------------------------------------------------------------ Tags
    tags: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        const box = el('div', { class: 'vt-panel vt-list' });
        root.replaceChildren(box);
        const openTags = new Set();
        async function draw() {
          const tags = await ctx.call('vault.tags').catch(() => null);
          if (!tags) { box.replaceChildren(el('div', { class: 'vt-none', text: 'No vault open.' })); return; }
          if (!tags.length) { box.replaceChildren(el('div', { class: 'vt-none', text: 'No tags yet. Write #idea in a note.' })); return; }
          const rows = [];
          for (const t of tags) {
            const isOpen = openTags.has(t.tag);
            rows.push(el('button', { class: 'vt-tagrow', 'aria-expanded': String(isOpen), onclick: () => { if (isOpen) openTags.delete(t.tag); else openTags.add(t.tag); draw(); } },
              el('span', { text: (isOpen ? '▾ #' : '▸ #') + t.tag }), el('span', { class: 'nui-muted', text: String(t.count) })));
            if (isOpen) {
              const notes = await ctx.call('vault.tagged', { tag: t.tag }).catch(() => []);
              rows.push(...notes.map((n) => el('button', { class: 'vt-hit indent', onclick: () => openNote(ctx, n.path) }, el('span', { class: 'n', text: n.name }))));
            }
          }
          box.replaceChildren(...rows);
        }
        const offs = [ctx.on('changed', () => draw()), ctx.on('opened', () => draw())];
        draw();
        return { unmount: () => offs.forEach((f) => f()) };
      },
    },

    // ------------------------------------------------------------ Local map: the note on screen and its neighbours
    localmap: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        let depth = ctx.restore('local.depth', 1), doc = null;
        const canvas = el('canvas', { class: 'vt-map-canvas', 'aria-label': 'Map around the note on screen' });
        const note = el('div', { class: 'vt-none', hidden: true });
        const seg = el('div', { class: 'nui-seg vt-depth', role: 'group', 'aria-label': 'How far' },
          ...[1, 2].map((d) => el('button', { 'data-depth': String(d), 'aria-pressed': String(depth === d), title: d === 1 ? 'Linked notes' : 'And the notes linked to those', onclick: () => { depth = d; ctx.keep('local.depth', d); seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.depth) === d))); load(); } }, d === 1 ? '1 step' : '2 steps')));
        root.replaceChildren(el('div', { class: 'vt-panel' }, el('div', { class: 'vt-panel-head' }, seg), el('div', { class: 'vt-map-wrap small' }, canvas, note)));
        const map = createMap(canvas, { onOpen: (n) => { if (!n.missing) openNote(ctx, n.path); } });
        async function load() {
          if (!doc || !doc.path) { note.hidden = false; note.textContent = 'Open a note from the vault to see what it links to.'; map.setData({ nodes: [], edges: [] }); return; }
          const g = await ctx.call('vault.graph', { center: doc.path, depth }).catch(() => null);
          if (!g || !g.inVault) { note.hidden = false; note.textContent = `“${doc.title}” isn't in the open vault.`; map.setData({ nodes: [], edges: [] }); return; }
          note.hidden = true;
          map.setData(g, { centerPath: g.center, keepPositions: false });
        }
        const offs = [ctx.subscribe('doc.current', (d) => { doc = d; load(); }), ctx.on('changed', () => load()), ctx.on('opened', () => load())];
        load();
        return { unmount: () => { offs.forEach((f) => f()); map.destroy(); } };
      },
    },

    // ------------------------------------------------------------ Search
    search: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        const out = el('div', { class: 'vt-list' });
        let timer = 0;
        const input = el('input', { class: 'nui-field vt-filter', type: 'search', placeholder: 'Search (tag:x path:x "exact" -skip)', 'aria-label': 'Search the vault', value: ctx.restore('search.q', ''),
          oninput: () => { clearTimeout(timer); timer = setTimeout(run, 150); } });
        root.replaceChildren(el('div', { class: 'vt-panel' }, el('div', { class: 'vt-panel-head' }, input), out));
        async function run() {
          const q = input.value; ctx.keep('search.q', q);
          if (!q.trim()) { out.replaceChildren(el('div', { class: 'vt-none', text: 'Type to search every note.' })); return; }
          const hits = await ctx.call('vault.search', { q }).catch((e) => { out.replaceChildren(el('div', { class: 'vt-none', text: e.message })); return null; });
          if (!hits) return;
          out.replaceChildren(...(hits.length ? hits.slice(0, 100).map((h) => el('button', { class: 'vt-hit', title: h.path, onclick: () => openNote(ctx, h.path) },
            el('span', { class: 'n', text: h.name }), el('span', { class: 'm', text: hitLabel(h) })))
            : [el('div', { class: 'vt-none', text: `Nothing found for “${q}”.` })]));
        }
        const off = ctx.on('changed', () => { if (input.value) run(); });
        run();
        return { unmount: () => { off(); clearTimeout(timer); } };
      },
    },
  },
};
