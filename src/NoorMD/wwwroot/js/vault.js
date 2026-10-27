// NoorMD Vaults (page side): the explorer tree, Find in Vault, backlinks and note links.
// A Vault is an ordinary folder; every file operation is done and validated by the host (MainWindow.Vault.cs).
window.NoorVault = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const bridge = NoorBridge;
  let app = null;
  let vault = null;          // { root, name, attachments, excluded } or null
  let recent = [];           // [{ path, name }]
  let entries = [];          // [{ p, d, s, m }]
  let byParent = new Map();  // folder path -> child entries
  let indexed = false;
  let expanded = new Set();
  let selected = new Set();
  let focusPath = null;
  let anchorPath = null;

  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[łŁ]/g, 'l').toLowerCase();
  const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const isNote = (p) => /\.(md|markdown|mdown|mkd)$/i.test(p);
  const isImage = (p) => /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(p);
  const req = (type, payload) => bridge.request(type, payload);
  const fail = (err) => app.showError(err);

  // ---------------------------------------------------------------- state from the host

  function onChanged(p) {
    const was = vault && vault.root;
    vault = p.vault || null;
    recent = p.recent || [];
    if (!vault) { entries = []; byParent = new Map(); indexed = false; }
    if (vault && vault.root !== was) {
      entries = []; byParent = new Map(); indexed = false; selected = new Set(); focusPath = null;
      try { expanded = new Set(JSON.parse(localStorage.getItem('noormd.vault.expanded:' + vault.root) || '[]')); } catch { expanded = new Set(); }
      setView('files');
      req('vault.tree').then(onTree).catch(() => {});
    }
    document.body.classList.toggle('has-vault', !!vault);
    if (!vault) setView('doc');
    $('#vault-title').textContent = vault ? vault.name : '';
    $('#vault-title').title = vault ? vault.root : '';
    const crumb = $('#vault-name');
    crumb.hidden = !vault;
    crumb.textContent = vault ? vault.name : '';
    renderTree();
    refreshBacklinks();
    app.refreshChrome();
  }

  function onTree(p) {
    if (!vault || (p.root && p.root !== vault.root)) return;
    entries = p.entries || [];
    indexed = !!p.indexed;
    byParent = new Map();
    for (const e of entries) {
      const parent = parentOf(e.p);
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(e);
    }
    for (const list of byParent.values()) list.sort((a, b) => (a.d === b.d ? 0 : a.d ? -1 : 1)); // folders first, natural order kept
    const known = new Set(entries.map((e) => e.p));
    selected = new Set([...selected].filter((x) => known.has(x)));
    renderTree();
  }

  function onIndexed() { indexed = true; refreshBacklinks(); if (sideView === 'tags') renderTags(); }

  // ---------------------------------------------------------------- sidebar views

  let sideView = 'doc';
  function setView(view) {
    const v = vault && (view === 'files' || view === 'tags') ? view : 'doc';
    sideView = v;
    document.body.classList.toggle('side-files', v === 'files');
    document.body.classList.toggle('side-tags', v === 'tags');
    document.querySelectorAll('#side-switch button').forEach((b) => { const on = b.dataset.view === v; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    if (v === 'tags') renderTags();
  }

  // ---------------------------------------------------------------- tags (#tag in notes and tags: in front matter)

  let tagList = [], openTag = null, tagSeq = 0;

  async function renderTags() {
    const box = $('#tags-box');
    if (!box || !vault) return;
    const mine = ++tagSeq;
    if (openTag) {
      let notes;
      try { notes = await req('vault.tagged', { tag: openTag }); } catch (err) { fail(err); return; }
      if (mine !== tagSeq) return;
      box.replaceChildren(
        el('div', { class: 'tags-head' },
          el('button', { class: 'utility-btn', id: 'tags-back', onclick: () => { openTag = null; renderTags(); } }, '← All tags'),
          el('strong', { text: '#' + openTag }), el('small', { text: `${notes.length} note${notes.length === 1 ? '' : 's'}` })),
        ...notes.map((n) => el('button', { class: 'tag-note', title: n.path, 'data-path': n.path, onclick: () => req('vault.openFile', { path: n.path }).catch(fail) },
          el('span', { class: 'tag-note-name', text: '📝 ' + n.name }), el('small', { text: [n.folder, n.tags.filter((t) => t.toLowerCase() !== openTag.toLowerCase()).map((t) => '#' + t).join(' ')].filter(Boolean).join(' · ') }))),
        ...(notes.length ? [] : [el('p', { class: 'empty', text: 'No notes have this tag any more.' })]));
      return;
    }
    let r;
    try { r = await req('vault.tags'); } catch (err) { fail(err); return; }
    if (mine !== tagSeq) return;
    tagList = r.tags || [];
    drawTagList();
  }

  function drawTagList() {
    const box = $('#tags-box');
    const f = fold($('#tags-filter').value.trim().replace(/^#/, ''));
    const shownTags = tagList.filter((t) => !f || fold(t.tag).includes(f));
    box.replaceChildren(
      ...(tagList.length ? [] : [el('p', { class: 'empty', text: indexed ? 'No tags yet. Write #idea in a note, or tags: [idea] in its front matter.' : 'Reading the Vault…' })]),
      el('div', { class: 'tag-cloud', id: 'tag-cloud' }, ...shownTags.map((t) => {
        const depth = t.tag.split('/').length - 1;
        return el('button', { class: 'tag-chip' + (depth ? ' nested' : ''), 'data-tag': t.tag, title: depth ? `#${t.tag} (also listed under #${t.tag.split('/')[0]})` : `Notes tagged #${t.tag}`, onclick: () => { openTag = t.tag; renderTags(); } },
          '#' + t.tag, el('small', { text: String(t.count) }));
      })));
  }

  /** Shows the notes with a tag (from a click on #tag in a note, or the command palette). */
  function showTag(tag) {
    if (!vault) return;
    document.body.classList.remove('sidebar-collapsed');
    openTag = String(tag).replace(/^#/, '');
    setView('tags');
  }

  function saveExpanded() {
    try { localStorage.setItem('noormd.vault.expanded:' + vault.root, JSON.stringify([...expanded].slice(0, 2000))); } catch { /* per-viewer convenience only */ }
  }

  // ---------------------------------------------------------------- tree

  const ICON = { folder: '▸', open: '▾' };
  function fileIcon(e) {
    if (e.d) return '';
    if (isNote(e.p)) return '📝';
    if (isImage(e.p)) return '🖼';
    if (/\.(mp3|flac|wav|ogg|opus|m4a)$/i.test(e.p)) return '♫';
    if (/\.pdf$/i.test(e.p)) return '📄';
    if (/\.noorsketch$/i.test(e.p)) return '✎';
    return '·';
  }

  /** The rows currently shown, in order (expanded folders only, or the filter results). */
  function visibleRows() {
    const filter = fold($('#vault-filter').value.trim());
    if (filter) {
      return entries.filter((e) => !e.d && fold(nameOf(e.p)).includes(filter)).slice(0, 500).map((e) => ({ e, level: 0, flat: true }));
    }
    const out = [];
    const walk = (parent, level) => {
      for (const e of byParent.get(parent) || []) {
        out.push({ e, level });
        if (e.d && expanded.has(e.p)) walk(e.p, level + 1);
      }
    };
    walk('', 0);
    return out;
  }

  function renderTree() {
    const box = $('#vault-tree');
    if (!box) return;
    if (!vault) { box.replaceChildren(); return; }
    const activePath = app.activeVaultPath();
    const rows = visibleRows();
    if (!rows.length) {
      box.replaceChildren(el('p', { class: 'empty', text: entries.length ? 'No matching files.' : 'Loading the Vault…' }));
      return;
    }
    if (!focusPath || !rows.some((r) => r.e.p === focusPath)) focusPath = rows[0].e.p;
    box.replaceChildren(...rows.map(({ e, level, flat }) => {
      const row = el('div', {
        class: 'vt-row' + (e.d ? ' folder' : '') + (selected.has(e.p) ? ' selected' : '') + (e.p === activePath ? ' current' : ''),
        role: 'treeitem', 'data-path': e.p, 'aria-level': String(level + 1), 'aria-selected': String(selected.has(e.p)),
        'aria-expanded': e.d ? String(expanded.has(e.p)) : null, tabindex: e.p === focusPath ? '0' : '-1', draggable: 'true',
        title: e.p, style: `--lvl:${level}`,
      },
      el('span', { class: 'vt-chev', 'aria-hidden': 'true', text: e.d ? (expanded.has(e.p) ? ICON.open : ICON.folder) : '' }),
      el('span', { class: 'vt-icon', 'aria-hidden': 'true', text: fileIcon(e) }),
      el('span', { class: 'vt-name', text: nameOf(e.p) }),
      flat ? el('small', { class: 'vt-where', text: parentOf(e.p) }) : null);
      return row;
    }));
  }

  const rowOf = (p) => document.querySelector(`#vault-tree .vt-row[data-path="${CSS.escape(p)}"]`);
  const entryOf = (p) => entries.find((x) => x.p === p) || null;

  function focusRow(p, extend) {
    focusPath = p;
    if (extend && anchorPath) {
      const rows = visibleRows().map((r) => r.e.p);
      const [a, b] = [rows.indexOf(anchorPath), rows.indexOf(p)].sort((x, y) => x - y);
      selected = new Set(rows.slice(a, b + 1));
    } else if (!extend) { selected = new Set([p]); anchorPath = p; }
    renderTree();
    const row = rowOf(p);
    if (row) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); }
  }

  function toggleFolder(p, open) {
    const want = open === undefined ? !expanded.has(p) : open;
    if (want) expanded.add(p); else expanded.delete(p);
    saveExpanded();
    renderTree();
    rowOf(p)?.focus({ preventScroll: true });
  }

  function activate(p) {
    const e = entryOf(p);
    if (!e) return;
    if (e.d) { toggleFolder(p); return; }
    req('vault.openFile', { path: p }).catch(fail);
  }

  function onTreeClick(ev) {
    const row = ev.target.closest('.vt-row');
    if (!row) return;
    const p = row.dataset.path;
    if (ev.ctrlKey || ev.metaKey) {
      if (selected.has(p)) selected.delete(p); else selected.add(p);
      focusPath = p; anchorPath = p;
      renderTree();
      rowOf(p)?.focus({ preventScroll: true });
      return;
    }
    if (ev.shiftKey) { focusRow(p, true); return; }
    focusRow(p, false);
    if (ev.target.closest('.vt-chev') || entryOf(p)?.d) toggleFolder(p);
    else activate(p);
  }

  function onTreeKey(ev) {
    const rows = visibleRows().map((r) => r.e);
    if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((e) => e.p === focusPath));
    const cur = rows[i];
    const k = ev.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { ev.preventDefault(); focusRow(rows[Math.min(rows.length - 1, Math.max(0, i + (k === 'ArrowDown' ? 1 : -1)))].p, ev.shiftKey); }
    else if (k === 'Home' || k === 'End') { ev.preventDefault(); focusRow(rows[k === 'Home' ? 0 : rows.length - 1].p, ev.shiftKey); }
    else if (k === 'ArrowRight') { ev.preventDefault(); if (cur.d && !expanded.has(cur.p)) toggleFolder(cur.p, true); else if (cur.d && rows[i + 1]) focusRow(rows[i + 1].p); }
    else if (k === 'ArrowLeft') { ev.preventDefault(); if (cur.d && expanded.has(cur.p)) toggleFolder(cur.p, false); else if (parentOf(cur.p)) focusRow(parentOf(cur.p)); }
    else if (k === 'Enter') { ev.preventDefault(); activate(cur.p); }
    else if (k === 'F2') { ev.preventDefault(); ev.stopPropagation(); startRename(cur.p); }
    else if (k === 'Delete') { ev.preventDefault(); deleteItems(selected.size ? [...selected] : [cur.p]); }
    else if (k === ' ') { ev.preventDefault(); if (selected.has(cur.p) && selected.size > 1) selected.delete(cur.p); else selected.add(cur.p); renderTree(); rowOf(cur.p)?.focus(); }
    else if (k === 'ContextMenu' || (k === 'F10' && ev.shiftKey)) { ev.preventDefault(); const r = rowOf(cur.p).getBoundingClientRect(); showContextMenu(cur.p, r.left + 30, r.bottom); }
  }

  /** The folder new items go into: the focused folder, or the folder of the focused file. */
  function targetFolder(p) {
    const e = p != null ? entryOf(p) : (focusPath ? entryOf(focusPath) : null);
    if (!e) return '';
    return e.d ? e.p : parentOf(e.p);
  }

  async function newNote(folder) {
    const name = await NoorUI.prompt('New note', `Name of the new note${folder ? ' in “' + folder + '”' : ''}:`, 'Untitled', { okLabel: 'Create' });
    if (!name || !name.trim()) return;
    try {
      const r = await req('vault.newNote', { folder: folder ?? targetFolder(), name: name.trim() });
      if (folder) { expanded.add(folder); saveExpanded(); }
      if (r && r.path) focusPath = r.path;
    } catch (err) { fail(err); }
  }

  async function newFolder(parent) {
    const name = await NoorUI.prompt('New folder', `Name of the new folder${parent ? ' in “' + parent + '”' : ''}:`, 'New folder', { okLabel: 'Create' });
    if (!name || !name.trim()) return;
    try {
      const r = await req('vault.newFolder', { parent: parent ?? targetFolder(), name: name.trim() });
      if (parent) expanded.add(parent);
      if (r && r.path) { expanded.add(r.path); focusPath = r.path; }
      saveExpanded();
    } catch (err) { fail(err); }
  }

  function startRename(p) {
    const row = rowOf(p);
    if (!row) return;
    const span = row.querySelector('.vt-name');
    const old = nameOf(p);
    const input = el('input', { class: 'vt-rename', value: old, 'aria-label': 'New name', spellcheck: 'false' });
    span.replaceWith(input);
    row.draggable = false;
    const dot = old.lastIndexOf('.');
    input.focus();
    input.setSelectionRange(0, dot > 0 && !entryOf(p)?.d ? dot : old.length);
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (!commit || !name || name === old) { renderTree(); rowOf(p)?.focus(); return; }
      try {
        const r = await req('vault.rename', { path: p, name });
        if (r && r.path) {
          if (expanded.has(p)) { expanded.delete(p); expanded.add(r.path); saveExpanded(); }
          focusPath = r.path; selected = new Set([r.path]);
          linksNotice(r.links);
        }
      } catch (err) { fail(err); }
      renderTree();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  function linksNotice(l) {
    if (l && l.links) notice(`Updated ${l.links} link${l.links === 1 ? '' : 's'} in ${l.notes} note${l.notes === 1 ? '' : 's'}`, 2600);
  }

  async function deleteItems(paths) {
    if (!paths.length) return;
    try {
      const r = await req('vault.delete', { paths });
      if (r && r.deleted) { selected = new Set(); notice(`Moved ${r.deleted} item${r.deleted === 1 ? '' : 's'} to the Recycle Bin`, 2400); }
    } catch (err) { fail(err); }
  }

  async function moveItems(paths, folder) {
    const list = paths.filter((p) => p !== folder && parentOf(p) !== folder && !(folder + '/').startsWith(p + '/'));
    if (!list.length) return;
    try {
      const r = await req('vault.move', { paths: list, folder });
      if (r && r.moved) { if (folder) { expanded.add(folder); saveExpanded(); } notice(`Moved ${r.moved} item${r.moved === 1 ? '' : 's'}${folder ? ' to “' + folder + '”' : ''}${r.links && r.links.links ? ` · ${r.links.links} link${r.links.links === 1 ? '' : 's'} updated` : ''}`, 2600); }
    } catch (err) { fail(err); }
  }

  function showContextMenu(p, x, y) {
    if (p && !selected.has(p)) { selected = new Set([p]); focusPath = p; renderTree(); }
    const e = p ? entryOf(p) : null;
    const many = selected.size > 1;
    const sel = p ? [...selected] : [];
    const items = [];
    if (e && !e.d) items.push({ label: isNote(e.p) || /\.txt$/i.test(e.p) ? 'Open' : 'Open in default app', run: () => activate(e.p), disabled: many });
    items.push({ label: 'New note…', run: () => newNote(targetFolder(p)) }, { label: 'New folder…', run: () => newFolder(targetFolder(p)) });
    if (e) {
      items.push('-', { label: 'Rename', run: () => startRename(e.p), disabled: many }, { label: 'Duplicate', run: () => req('vault.duplicate', { path: e.p }).catch(fail), disabled: many },
        { label: many ? `Delete ${sel.length} items` : 'Delete', run: () => deleteItems(sel) });
      if (e && !e.d && isNote(e.p)) items.push('-', { label: 'Insert link to this note', run: () => insertLinkTo(e.p) });
      items.push('-', { label: 'Reveal in Explorer', run: () => req('vault.revealItem', { path: e.p }).catch(fail), disabled: many }, { label: 'Copy path', run: () => req('vault.copyPath', { path: e.p }).then(() => notice('Path copied', 1400)).catch(fail), disabled: many });
    }
    items.push('-', { label: many ? `Pack & Share ${sel.length} items…` : 'Pack & Share…', run: () => showPack(sel) });
    items.push('-', { label: 'Refresh', run: () => req('vault.refresh').catch(fail) });
    NoorChrome.openMenu(null, items, { x, y });
  }

  // Drag & drop inside the tree moves files and folders. (Files dragged in from Windows are not handled here.)
  const DND = 'application/x-noormd-vault';
  function setupDnD(box) {
    box.addEventListener('dragstart', (ev) => {
      const row = ev.target.closest('.vt-row');
      if (!row) return;
      const p = row.dataset.path;
      if (!selected.has(p)) {
        // Don't rebuild the rows here: replacing the dragged element cancels the drag.
        selected = new Set([p]);
        box.querySelectorAll('.vt-row').forEach((n) => { const on = n.dataset.path === p; n.classList.toggle('selected', on); n.setAttribute('aria-selected', String(on)); });
      }
      ev.dataTransfer.setData(DND, JSON.stringify([...selected]));
      ev.dataTransfer.effectAllowed = 'move';
    });
    const folderAt = (ev) => {
      const row = ev.target.closest && ev.target.closest('.vt-row');
      if (!row) return ev.target.closest && ev.target.closest('#vault-tree') ? '' : null;
      const e = entryOf(row.dataset.path);
      return e ? (e.d ? e.p : parentOf(e.p)) : null;
    };
    box.addEventListener('dragover', (ev) => {
      if (![...ev.dataTransfer.types].includes(DND)) return;
      const f = folderAt(ev);
      if (f === null) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      box.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
      (f ? rowOf(f) : box)?.classList.add('drop-target');
    });
    box.addEventListener('dragleave', () => box.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target')));
    box.addEventListener('drop', (ev) => {
      if (![...ev.dataTransfer.types].includes(DND)) return;
      ev.preventDefault();
      ev.stopPropagation();
      box.classList.remove('drop-target');
      box.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
      const f = folderAt(ev);
      if (f === null) return;
      let paths = [];
      try { paths = JSON.parse(ev.dataTransfer.getData(DND)); } catch { return; }
      moveItems(paths, f);
    });
  }

  // ---------------------------------------------------------------- Find in files: open documents or the Vault

  let lastScope = null;

  /**
   * One search for "all open documents" (like Notepad++'s Find in All Opened Documents, including unsaved edits)
   * and "every note in the Vault". Ctrl+Shift+F. Results are grouped by file; Enter or a click jumps there.
   */
  function showSearch(initial, scope) {
    NoorUI.closeAll();
    let where = scope || lastScope || (vault ? 'vault' : 'open');
    if (where === 'vault' && !vault) where = 'open';
    NoorUI.modal({ label: 'Find in files', width: 800 }, (s, close) => {
      const input = el('input', { id: 'vault-search-input', autocomplete: 'off', 'aria-label': 'Search', autofocus: true, spellcheck: 'false' });
      const status = el('div', { class: 'vs-status', 'aria-live': 'polite' });
      const results = el('div', { class: 'palette-results vs-results', role: 'listbox' });
      const matchCase = el('input', { type: 'checkbox', id: 'fs-case' });
      const wholeWord = el('input', { type: 'checkbox', id: 'fs-word' });
      const options = el('span', { class: 'fs-options' }, el('label', { class: 'inline' }, matchCase, 'Match case'), el('label', { class: 'inline' }, wholeWord, 'Whole word'));
      const scopeBtn = (id, label, title, enabled) => el('button', { class: 'chip', id: 'fs-scope-' + id, 'data-scope': id, title, disabled: !enabled || undefined, onclick: () => { where = id; lastScope = id; draw(); run(); input.focus(); } }, label);
      const scopes = el('div', { class: 'fs-scopes', role: 'radiogroup', 'aria-label': 'Where to search' },
        scopeBtn('open', `📑 Open documents (${app.openTabCount()})`, 'Every open tab, including changes not saved yet', true),
        scopeBtn('vault', vault ? `🗂 Vault: ${vault.name}` : '🗂 Vault (none open)', vault ? 'Every note in the Vault (saved files)' : 'Open a Vault first (Workspace › Open Folder as Vault)', !!vault));
      const foot = el('span');
      let items = [], sel = 0, seq = 0, timer = null;

      function draw() {
        scopes.querySelectorAll('[data-scope]').forEach((b) => { b.classList.toggle('active', b.dataset.scope === where); b.setAttribute('aria-checked', String(b.dataset.scope === where)); });
        options.hidden = where !== 'open';
        input.placeholder = where === 'open' ? 'Search all open documents…' : 'Search every note in ' + vault.name + '…';
        foot.textContent = where === 'open' ? 'Searches the text as written (Markdown) · ↑ ↓ Enter jumps to the match' : 'Case and accents are ignored · ↑ ↓ Enter opens the note in a tab';
      }
      const mark = () => results.querySelectorAll('.vs-hit').forEach((b, i) => { b.classList.toggle('selected', i === sel); b.setAttribute('aria-selected', String(i === sel)); if (i === sel) b.scrollIntoView({ block: 'nearest' }); });
      const hitButton = (i, label, snippet, open) => el('button', {
        class: 'cmd-item vs-hit' + (i === sel ? ' selected' : ''), role: 'option', tabindex: '-1', 'aria-selected': String(i === sel),
        onclick: () => { close(); open(); }, onmousemove: () => { if (sel !== i) { sel = i; mark(); } },
      }, label, snippet);

      function renderOpen(q, groups) {
        results.replaceChildren();
        items = [];
        for (const g of groups) {
          results.append(el('div', { class: 'fs-file', 'data-tab': g.tabId }, el('strong', { text: (g.dirty ? '● ' : '') + g.name }), el('small', { text: `${g.hits.length >= 500 ? '500+' : g.hits.length} match${g.hits.length === 1 ? '' : 'es'}${g.path ? ' · ' + g.path : ''}` })));
          for (const h of g.hits) {
            const i = items.length;
            const snippet = el('span', { class: 'vs-snippet' }, h.text.slice(0, h.start), el('mark', { text: h.text.slice(h.start, h.start + h.length) }), h.text.slice(h.start + h.length));
            const open = () => app.revealMatch(g.tabId, q, h.n, matchCase.checked);
            items.push(open);
            results.append(hitButton(i, el('span', { class: 'vs-file fs-line', text: String(h.line) }), snippet, open));
          }
        }
        mark();
      }

      function renderVault(q, hits) {
        results.replaceChildren();
        items = [];
        const terms = fold(q).split(/\s+/).filter(Boolean);
        hits.forEach((h, i) => {
          const snippet = el('span', { class: 'vs-snippet' });
          highlight(snippet, h.nameMatch ? h.path : h.snippet, terms);
          const open = () => openHit(h, q);
          items.push(open);
          results.append(hitButton(i, el('span', { class: 'vs-file', text: (h.nameMatch ? '📝 ' : '') + h.name + (h.line ? ' · ' + h.line : '') }), snippet, open));
        });
        mark();
      }

      function run() {
        const q = where === 'open' ? input.value : input.value.trim();
        const mine = ++seq;
        sel = 0;
        if (!q.trim()) { items = []; status.textContent = ''; results.replaceChildren(); return; }
        if (where === 'open') {
          const groups = app.searchOpenTabs(q, { matchCase: matchCase.checked, wholeWord: wholeWord.checked });
          const n = groups.reduce((a, g) => a + g.hits.length, 0);
          status.textContent = n ? `${n} match${n === 1 ? '' : 'es'} in ${groups.length} of ${app.openTabCount()} open document${app.openTabCount() === 1 ? '' : 's'}` : `No results in ${app.openTabCount()} open document${app.openTabCount() === 1 ? '' : 's'}`;
          renderOpen(q, groups);
          return;
        }
        status.textContent = indexed ? 'Searching…' : 'Indexing the Vault…';
        req('vault.search', { query: q }).then((r) => {
          if (mine !== seq) return;
          const hits = (r && r.hits) || [];
          const files = new Set(hits.map((h) => h.path)).size;
          status.textContent = hits.length ? `${hits.length >= 300 ? '300+' : hits.length} result${hits.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'} · ${r.indexed} notes searched` : `No results · ${r.indexed} notes searched`;
          renderVault(q, hits);
        }).catch(fail);
      }
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 160); });
      [matchCase, wholeWord].forEach((c) => c.addEventListener('change', () => { run(); input.focus(); }));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
        else if (e.key === 'Enter') { e.preventDefault(); const open = items[sel]; if (open) { close(); open(); } }
      });
      s.append(NoorUI.head('Find in files', close), el('div', { class: 'modal-body vs-body' }, scopes, el('div', { class: 'fs-searchrow' }, input, options), status, results),
        el('div', { class: 'modal-foot' }, foot, el('span', { text: 'Esc to close' })));
      draw();
      if (initial) { input.value = initial; run(); }
    });
  }

  function highlight(node, text, terms) {
    const f = fold(text);
    const marks = [];
    for (const t of terms) { let i = f.indexOf(t); while (i >= 0 && marks.length < 50) { marks.push([i, i + t.length]); i = f.indexOf(t, i + t.length); } }
    marks.sort((a, b) => a[0] - b[0]);
    let pos = 0;
    for (const [a, b] of marks) {
      if (a < pos) continue;
      node.append(text.slice(pos, a), el('mark', { text: text.slice(a, b) }));
      pos = b;
    }
    node.append(text.slice(pos));
  }

  async function openHit(h, query) {
    try {
      await req('vault.openFile', { path: h.path });
      if (!h.nameMatch && query) setTimeout(() => app.findInDocument(query.split(/\s+/)[0]), 350);
    } catch (err) { fail(err); }
  }

  // ---------------------------------------------------------------- backlinks

  let backlinkSeq = 0;
  function refreshBacklinks() {
    const sec = $('#backlinks-section');
    if (!sec) return;
    const tabId = app.activeTabId();
    if (!vault || !tabId) { sec.hidden = true; return; }
    const mine = ++backlinkSeq;
    req('vault.backlinks', { tabId }).then((r) => {
      if (mine !== backlinkSeq) return;
      sec.hidden = !r || !r.inVault;
      const box = $('#backlinks-box');
      box.replaceChildren();
      if (!r || !r.inVault) return;
      if (!r.refs.length) { box.append(el('p', { class: 'empty', text: indexed ? 'No other note links here yet.' : 'Indexing…' })); return; }
      for (const ref of r.refs.slice(0, 100)) {
        box.append(el('button', { title: ref.snippet, onclick: () => req('vault.openFile', { path: ref.source }).catch(fail) },
          el('span', { text: nameOf(ref.source).replace(/\.(md|markdown)$/i, '') }), el('small', { class: 'bl-snippet', text: ref.snippet })));
      }
    }).catch(() => { sec.hidden = true; });
  }

  // ---------------------------------------------------------------- links between notes

  /** Ctrl+click (or the command) on [[Wiki link]] or [text](note.md) under the caret opens that note. */
  function linkAtCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    const node = sel.anchorNode;
    const text = node.nodeType === 3 ? node.textContent : node.textContent || '';
    const at = node.nodeType === 3 ? sel.anchorOffset : 0;
    const scan = (re) => { re.lastIndex = 0; let m; while ((m = re.exec(text))) { if (at >= m.index && at <= m.index + m[0].length) return m; } return null; };
    const wiki = scan(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g);
    if (wiki) return { wiki: wiki[1].trim() };
    const md = scan(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g);
    if (md) return { href: md[1] };
    // In Visual mode a [[link]] can be split across formatting; look at the whole paragraph as a fallback.
    const block = (node.nodeType === 3 ? node.parentElement : node)?.closest('p, li, h1, h2, h3, h4, h5, h6, div');
    const all = block ? block.textContent : '';
    const w = [...all.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)];
    return w.length === 1 ? { wiki: w[0][1].trim() } : null;
  }

  async function followLink() {
    const link = linkAtCaret();
    if (!link) { notice('Put the cursor on a [[link]] or a [link](note.md) first.', 2200); return false; }
    try {
      if (link.wiki) {
        if (!vault) { notice('[[Wiki links]] work inside a Vault (Workspace → Open Folder as Vault).', 2600); return true; }
        await req('vault.openWiki', { target: link.wiki, tabId: app.activeTabId() });
      } else await req('link.open', { href: link.href, tabId: app.activeTabId() });
    } catch (err) { fail(err); }
    return true;
  }

  async function insertLinkTo(path) {
    try {
      const r = await req('vault.linkTo', { tabId: app.activeTabId(), path });
      if (r && r.link) app.insertText(`[${r.title}](${r.link})`);
    } catch (err) { fail(err); }
  }

  function pickNoteToLink() {
    if (!vault) { notice('Open a Vault first.'); return; }
    app.pickFrom('Link to a note', notes().map((p) => ({ label: nameOf(p).replace(/\.(md|markdown|mdown|mkd)$/i, ''), detail: parentOf(p), run: () => insertLinkTo(p) })));
  }

  const notes = () => entries.filter((e) => !e.d && isNote(e.p)).map((e) => e.p);

  // ---------------------------------------------------------------- create / settings

  /** Preset cards (from the host, so the list matches what gets created). */
  function presetPicker(presets, chosen, onPick) {
    const box = el('div', { class: 'preset-grid', role: 'radiogroup', 'aria-label': 'Starting point' });
    const draw = () => box.replaceChildren(...presets.map((p) => el('button', {
      class: 'preset-card' + (p.id === chosen ? ' active' : ''), role: 'radio', 'aria-checked': String(p.id === chosen), 'data-preset': p.id,
      onclick: () => { chosen = p.id; onPick(p.id); draw(); },
    }, el('span', { class: 'preset-icon', text: p.icon }), el('strong', { text: p.name }), el('small', { text: p.description }),
    p.folders.length ? el('span', { class: 'preset-folders', text: p.folders.map((f) => '📁 ' + f).join('  ') }) : null)));
    draw();
    return box;
  }

  /** New Vault wizard: a name, a starting point (folders + a few notes), then where on disk. */
  async function createVault() {
    let presets;
    try { presets = await req('vault.presets'); } catch (err) { fail(err); return; }
    NoorUI.modal({ label: 'Create a new Vault', width: 760 }, (s, close) => {
      let preset = 'notes';
      const name = el('input', { id: 'vw-name', value: 'My Vault', 'aria-label': 'Vault name', spellcheck: 'false' });
      const create = async () => {
        const n = name.value.trim();
        if (!n) { name.focus(); return; }
        close();
        try { const r = await req('vault.create', { name: n, preset }); if (r && !r.cancelled) notice(`Vault “${n}” created`, 2200); } catch (err) { fail(err); }
      };
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
      s.append(NoorUI.head('🗂 Create a new Vault', close),
        el('div', { class: 'modal-body vw-body' },
          el('label', { class: 'vw-row' }, el('span', { text: 'Name' }), name),
          el('p', { class: 'pref-hint', text: 'A Vault is an ordinary folder of Markdown notes. Pick a starting point; you can change everything later, and nothing outside the new folder is touched.' }),
          presetPicker(presets, preset, (id) => { preset = id; })),
        el('div', { class: 'modal-foot' }, el('span', { text: 'Next: choose where the folder goes' }), el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => close() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'vw-create', onclick: create }, 'Choose location…'))));
      setTimeout(() => name.select(), 0);
    });
  }

  /** Adds a preset's folders and starter notes to the open Vault (existing files are kept). */
  async function addPreset() {
    if (!vault) return;
    let presets;
    try { presets = await req('vault.presets'); } catch (err) { fail(err); return; }
    NoorUI.modal({ label: 'Add folders from a preset', width: 760 }, (s, close) => {
      let preset = 'notes';
      s.append(NoorUI.head('🗂 Add folders from a preset — ' + vault.name, close),
        el('div', { class: 'modal-body vw-body' },
          el('p', { class: 'pref-hint', text: 'Adds the folders and starter notes that are missing. Nothing you already have is changed or replaced.' }),
          presetPicker(presets.filter((p) => p.id !== 'blank'), preset, (id) => { preset = id; })),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => close() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'vw-apply', onclick: async () => { close(); try { await req('vault.applyPreset', { preset }); notice('Folders added', 1800); } catch (err) { fail(err); } } }, 'Add folders'))));
    });
  }

  async function showSettings() {
    if (!vault) return;
    let cur;
    try { cur = await req('vault.settings.get'); } catch (err) { fail(err); return; }
    NoorUI.modal({ label: 'Vault settings', width: 560 }, (s, close) => {
      const att = el('input', { id: 'vault-attachments', value: cur.attachments, 'aria-label': 'Attachments folder', spellcheck: 'false' });
      const ex = el('input', { id: 'vault-excluded', value: (cur.excluded || []).join(', '), 'aria-label': 'Excluded folders', spellcheck: 'false', placeholder: 'e.g. Archive, Exports' });
      const save = async () => {
        try {
          await req('vault.settings.set', { attachments: att.value.trim(), excluded: ex.value.split(',').map((x) => x.trim()).filter(Boolean) });
          close();
          notice('Vault settings saved', 1600);
        } catch (err) { fail(err); }
      };
      s.append(NoorUI.head('Vault settings — ' + vault.name, close), el('div', { class: 'modal-body' },
        el('div', { class: 'pref-grid' },
          el('label', { for: 'vault-attachments', text: 'Attachments folder' }), el('div', {}, att, el('small', { class: 'pref-hint', text: 'Where pictures and sketches added to notes are copied (relative to the Vault). Created when first needed.' })),
          el('label', { for: 'vault-excluded', text: 'Leave out folders' }), el('div', {}, ex, el('small', { class: 'pref-hint', text: 'Folder names to hide from the explorer and search, separated by commas. Hidden folders (.git, .obsidian, …) are always left out and never changed.' }))),
        el('p', { class: 'pref-hint', text: 'These settings are kept in NoorMD’s own settings, not inside the Vault.' })),
      el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => close() }, 'Cancel'), el('button', { class: 'action primary', onclick: save }, 'Save'))));
    });
  }

  // ---------------------------------------------------------------- Pack & Share

  const fmtSize = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');

  /** One right-click, one ZIP: preview what goes in, then pack it in the background. */
  function showPack(paths) {
    if (!vault) { notice('Open a Vault first.'); return; }
    const selection = (paths && paths.length ? paths : []).slice();
    const opts = { scope: selection.length ? 'selection' : 'vault', preset: 'zip', attachments: true, dependencies: false, preserve: true, manifest: false, note: '', skip: new Set(), exclusions: null, saveFirst: true };
    let plan = null, seq = 0, timer = null, busy = false;
    NoorUI.closeAll();
    NoorUI.modal({ label: 'Pack & Share', width: 780 }, (s, close) => {
      const body = el('div', { class: 'modal-body pack-body' });
      const foot = el('div', { class: 'modal-foot' });
      const radio = (name, value, label, checked) => {
        const r = el('input', { type: 'radio', name, value, checked: checked || undefined, id: `pk-${name}-${value}` });
        r.addEventListener('change', () => { opts[name] = value; renderForm(); refresh(); });
        return el('label', { class: 'inline', for: r.id }, r, label);
      };
      const check = (key, label, hint) => {
        const c = el('input', { type: 'checkbox', id: 'pk-' + key, checked: opts[key] || undefined });
        c.addEventListener('change', () => { opts[key] = c.checked; refresh(); });
        return el('label', { class: 'inline', for: c.id, title: hint || '' }, c, label);
      };
      const form = el('div', { class: 'pack-form' });
      const summary = el('div', { class: 'pack-summary', 'aria-live': 'polite', text: 'Preparing preview…' });
      const details = el('div', { class: 'pack-details' });
      const note = el('textarea', { id: 'pk-note', rows: '4', placeholder: 'Optional. What should the recipient do with these files? Only what you write here is included.', 'aria-label': 'Instructions for the recipient' });
      note.addEventListener('input', () => { opts.note = note.value; });
      const rules = el('textarea', { id: 'pk-rules', rows: '6', spellcheck: 'false', 'aria-label': 'Exclusion rules, one per line' });
      rules.addEventListener('input', () => { opts.exclusions = rules.value.split('\n').map((x) => x.trim()).filter(Boolean); refresh(); });

      function renderForm() {
        form.replaceChildren(
          el('div', { class: 'pack-row' }, el('strong', { text: 'What' }),
            selection.length ? radio('scope', 'selection', selection.length === 1 ? `“${selection[0] || vault.name}”` : `${selection.length} selected items`, opts.scope === 'selection') : null,
            radio('scope', 'vault', `The whole Vault (${vault.name})`, opts.scope === 'vault')),
          el('div', { class: 'pack-row' }, el('strong', { text: 'Kind' }),
            radio('preset', 'zip', 'Standard ZIP', opts.preset === 'zip'),
            radio('preset', 'handoff', 'AI Handoff Package', opts.preset === 'handoff')),
          el('div', { class: 'pack-row pack-checks' },
            check('attachments', 'Include pictures and other files', 'Files in the selection that are not notes'),
            check('dependencies', 'Include linked files from elsewhere in the Vault', 'Files outside the selection that the notes link to — review them below'),
            check('preserve', 'Keep folder structure (links keep working)'),
            opts.preset === 'zip' ? check('manifest', 'Add a list of the files (manifest)') : null),
          opts.preset === 'handoff' ? el('div', { class: 'pack-handoff' },
            el('p', { class: 'pref-hint', text: 'Adds MANIFEST.md and README.md in a separate “_noormd_handoff” folder (your own README is never replaced). Nothing is uploaded: you get a ZIP to share yourself.' }),
            el('label', { for: 'pk-note', text: 'Instructions for the recipient (written by you)' }), note) : null);
      }

      function req2() {
        return {
          paths: opts.scope === 'selection' ? selection : [], attachments: opts.attachments, dependencies: opts.dependencies, preserve: opts.preserve,
          manifest: opts.manifest || opts.preset === 'handoff', handoff: opts.preset === 'handoff', note: opts.preset === 'handoff' ? opts.note : '',
          skipDependencies: [...opts.skip], exclusions: opts.exclusions ?? undefined, saveFirst: opts.saveFirst,
        };
      }

      function refresh() {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const mine = ++seq;
          try {
            const r = await req('vault.pack.plan', req2());
            if (mine !== seq) return;
            plan = r;
            if (opts.exclusions === null) { opts.exclusions = r.defaults.slice(); rules.value = opts.exclusions.join('\n'); }
            renderPlan();
          } catch (err) { summary.textContent = err.message; }
        }, 200);
      }

      const openState = new Map(); // sections keep the open/closed state the user gave them across preview refreshes
      function section(title, count, open, ...children) {
        const d = el('details', { class: 'pack-section', open: (openState.has(title) ? openState.get(title) : open) || undefined }, el('summary', {}, el('span', { text: title }), el('small', { text: String(count) })), ...children);
        d.addEventListener('toggle', () => openState.set(title, d.open));
        return d;
      }

      function renderPlan() {
        const deps = plan.dependencies || [];
        const inc = deps.filter((d) => d.included).length;
        summary.replaceChildren(
          el('strong', { text: `${plan.fileCount.toLocaleString()} file${plan.fileCount === 1 ? '' : 's'}` }), ` · about ${fmtSize(plan.bytes)} before compression`,
          plan.excludedCount ? ` · ${plan.excludedCount} left out` : '', deps.length ? ` · ${deps.length} linked file${deps.length === 1 ? '' : 's'} outside (${inc} included)` : '',
          plan.unresolved.length ? el('span', { class: 'pack-warn', text: ` · ${plan.unresolved.length} link${plan.unresolved.length === 1 ? '' : 's'} not found` }) : '');
        const fileList = el('div', { class: 'pack-list' }, ...plan.files.slice(0, 500).map((f) => el('div', { class: 'pack-item' + (f.dependency ? ' dep' : '') },
          el('span', { text: f.entry }), el('small', { text: (f.dependency ? 'linked · ' : '') + fmtSize(f.size) }))),
        plan.fileCount > 500 ? el('p', { class: 'pref-hint', text: `…and ${(plan.fileCount - 500).toLocaleString()} more` }) : null,
        ...plan.generated.map((g) => el('div', { class: 'pack-item gen' }, el('span', { text: g }), el('small', { text: 'generated' }))));
        const depList = el('div', { class: 'pack-list' }, ...deps.map((d) => {
          const c = el('input', { type: 'checkbox', checked: !opts.skip.has(d.path) || undefined, disabled: !opts.dependencies || undefined, 'aria-label': 'Include ' + d.path });
          c.addEventListener('change', () => { if (c.checked) opts.skip.delete(d.path); else opts.skip.add(d.path); refresh(); });
          return el('label', { class: 'pack-item' }, c, el('span', { text: d.path }), el('small', { text: 'linked from ' + d.from }));
        }));
        const exList = el('div', { class: 'pack-list' }, ...plan.excluded.slice(0, 500).map((x) => el('div', { class: 'pack-item' }, el('span', { text: x.path }), el('small', { text: x.rule }))));
        const unList = el('div', { class: 'pack-list' }, ...plan.unresolved.map((u) => el('div', { class: 'pack-item' }, el('span', { text: u.from + ' → ' + u.target }), el('small', { text: u.problem }))));
        const unsaved = plan.unsaved || [];
        details.replaceChildren(
          unsaved.length ? el('div', { class: 'pack-unsaved' },
            el('strong', { text: `${unsaved.length} open document${unsaved.length === 1 ? ' has' : 's have'} unsaved changes: ${unsaved.map((u) => u.name).join(', ')}` }),
            (() => { const a = el('input', { type: 'radio', name: 'pk-unsaved', id: 'pk-save-first', checked: opts.saveFirst || undefined }); a.addEventListener('change', () => { opts.saveFirst = true; }); return el('label', { class: 'inline', for: 'pk-save-first' }, a, 'Save them first, then pack'); })(),
            (() => { const b = el('input', { type: 'radio', name: 'pk-unsaved', id: 'pk-disk', checked: !opts.saveFirst || undefined }); b.addEventListener('change', () => { opts.saveFirst = false; }); return el('label', { class: 'inline', for: 'pk-disk' }, b, 'Pack the versions saved on disk (without the unsaved changes)'); })()) : null,
          plan.warnings.length ? el('ul', { class: 'pack-warnings' }, ...plan.warnings.map((w) => el('li', { text: w }))) : null,
          section('Files in the package', plan.fileCount, true, fileList),
          deps.length ? section('Linked files outside the selection', deps.length, opts.dependencies, el('p', { class: 'pref-hint', text: opts.dependencies ? 'Untick any you don’t want to share.' : 'Turn on “Include linked files” above to add them.' }), depList) : null,
          plan.unresolved.length ? section('Links that can’t be packed', plan.unresolved.length, false, unList) : null,
          section('Left out', plan.excludedCount, false, exList),
          section('Exclusion rules', opts.exclusions ? opts.exclusions.length : 0, false,
            el('p', { class: 'pref-hint', text: 'One rule per line. “name/” leaves out every folder with that name; other rules match file names (* and ? wildcards). Defaults protect secrets like .env files and keys.' }),
            rules, el('button', { class: 'utility-btn', onclick: () => { opts.exclusions = plan.defaults.slice(); rules.value = opts.exclusions.join('\n'); refresh(); } }, 'Restore default rules')));
        renderFoot();
      }

      function renderFoot() {
        foot.replaceChildren(el('span', { text: 'Your files are only read — never moved or changed.' }), el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => close() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'pk-create', disabled: !plan || !plan.fileCount || undefined, onclick: create }, opts.preset === 'handoff' ? 'Create handoff ZIP…' : 'Create ZIP…')));
      }

      async function create() {
        if (busy) return;
        busy = true;
        const bar = el('div', { class: 'pack-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, el('div', { class: 'pack-fill' }));
        const label = el('span', { text: 'Choose where to save…' });
        foot.replaceChildren(el('div', { class: 'pack-running' }, bar, label), el('div', { class: 'modal-buttons' }, el('button', { class: 'action', id: 'pk-cancel', onclick: () => req('vault.pack.cancel').catch(() => {}) }, 'Cancel')));
        const onProgress = (p) => {
          const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
          bar.firstChild.style.width = pct + '%';
          bar.setAttribute('aria-valuenow', String(pct));
          label.textContent = `Packing ${p.done.toLocaleString()} of ${p.total.toLocaleString()} · ${fmtSize(p.bytes)}`;
        };
        progressHandler = onProgress;
        try {
          const r = await req('vault.pack.create', req2());
          progressHandler = null;
          busy = false;
          if (!r || r.cancelled) { notice('Packing cancelled — no archive was created.', 2600); renderFoot(); return; }
          body.replaceChildren(el('div', { class: 'pack-done' },
            el('p', {}, el('strong', { text: '✓ Package created' })),
            el('p', { class: 'pack-path', text: r.path }),
            el('p', { text: `${r.entries.toLocaleString()} files · ${fmtSize(r.bytes)} before compression.` }),
            r.failures.length ? el('div', { class: 'pack-warn' }, el('p', { text: `${r.failures.length} file${r.failures.length === 1 ? ' was' : 's were'} skipped:` }),
              el('ul', {}, ...r.failures.slice(0, 50).map((f) => el('li', { text: `${f.entry} — ${f.problem}` })))) : null));
          foot.replaceChildren(el('span', { text: 'Nothing was uploaded. Share the ZIP yourself.' }), el('div', { class: 'modal-buttons' },
            el('button', { class: 'action', onclick: () => req('vault.pack.reveal').catch(fail) }, 'Show in folder'),
            el('button', { class: 'action primary', autofocus: true, onclick: () => close() }, 'Done')));
        } catch (err) { progressHandler = null; busy = false; renderFoot(); fail(err); }
      }

      renderForm();
      body.append(form, summary, details);
      s.append(NoorUI.head('Pack & Share', close), body, foot);
      renderFoot();
      refresh();
    });
  }
  let progressHandler = null;

  // ---------------------------------------------------------------- init

  function init(api) {
    app = api;
    bridge.on('vault.changed', onChanged);
    bridge.on('vault.tree', onTree);
    bridge.on('vault.indexed', onIndexed);
    bridge.on('vault.pack.progress', (p) => { if (progressHandler) progressHandler(p); });
    const box = $('#vault-tree');
    box.addEventListener('click', onTreeClick);
    box.addEventListener('keydown', onTreeKey);
    box.addEventListener('dblclick', (e) => { const row = e.target.closest('.vt-row'); if (row && entryOf(row.dataset.path)?.d) e.preventDefault(); });
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); const row = e.target.closest('.vt-row'); showContextMenu(row ? row.dataset.path : null, e.clientX, e.clientY); });
    setupDnD(box);
    $('#vault-filter').addEventListener('input', renderTree);
    $('#vault-filter').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); const r = visibleRows()[0]; if (r) focusRow(r.e.p); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = visibleRows()[0]; if (r) activate(r.e.p); }
      else if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; renderTree(); }
    });
    document.querySelectorAll('#side-switch button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('#tags-filter').addEventListener('input', () => { if (openTag) { openTag = null; renderTags(); } else drawTagList(); });
    $('#vault-new-note').addEventListener('click', () => newNote(targetFolder()));
    $('#vault-new-folder').addEventListener('click', () => newFolder(targetFolder()));
    $('#vault-collapse').addEventListener('click', () => { expanded = new Set(); saveExpanded(); renderTree(); });
    $('#vault-refresh').addEventListener('click', () => req('vault.refresh').catch(fail));
  }

  return {
    init, onChanged, showSearch, showPack, selection: () => [...selected], createVault, showSettings, followLink, linkAtCaret, pickNoteToLink, refreshBacklinks, setView, showTag, addPreset,
    renderTree, notes, isOpen: () => !!vault, name: () => (vault ? vault.name : null), recent: () => recent,
    focusExplorer: () => { if (!vault) return; document.body.classList.remove('sidebar-collapsed'); setView('files'); (document.querySelector('#vault-tree .vt-row[tabindex="0"]') || $('#vault-filter')).focus(); },
    _state: () => ({ vault, entries: entries.length, expanded: [...expanded], selected: [...selected], focusPath, indexed }),
  };
})();
