// NoorMD Desktop — editor UI controller.
// The page owns the editor content and the "dirty" generation counter; the native host owns files,
// dialogs, preferences, recovery drafts and snapshots. All host calls go through NoorBridge.
(() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const bridge = NoorBridge;

  const SAMPLE = '# Welcome to NoorMD ✨\n\nA calmer place for ideas, documentation, and glorious little side projects.\n\n## Start creating\n\nWrite **bold**, *italic*, and `inline code` without thinking about Markdown syntax.\n\n- Switch between **Visual**, **Markdown**, and **Split** view (Ctrl+1/2/3).\n- Open any `.md` file with Ctrl+O, or drop it on the window.\n- Unsaved work is kept in a local recovery folder until you save.\n\n> Good ideas deserve a beautiful editor. Even the terrible ideas. Especially those.\n\n### A tiny checklist\n\n- [x] Open the writing studio\n- [ ] Write something brilliant\n- [ ] Make it real\n\n| Shortcut | Action |\n| --- | --- |\n| Ctrl+K | Command palette |\n| F11 | Focus mode |\n\n```csharp\n// And yes, your code blocks are welcome here.\nConsole.WriteLine("Hello, world!");\n```\n';

  const DEFAULT_PREFS = {
    theme: 'dark', fontFamily: 'inter', fontSize: 16, lineWidth: 'comfortable', openMode: 'visual',
    sidebarWidth: 256, sidebarCollapsed: false, splitRatio: 0.5, goalWords: 750, restoreSession: true,
  };
  const FONTS = {
    inter: "'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    system: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    serif: "Charter, 'Iowan Old Style', Georgia, Cambria, 'Times New Roman', serif",
    mono: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, monospace",
  };
  const MEASURES = { comfortable: '780px', wide: '1100px', full: '100000px' };

  let prefs = { ...DEFAULT_PREFS };
  let recent = [];
  let editor = null;
  let fallback = null;
  let mode = 'wysiwyg';
  let suppress = 0;            // >0 while the app itself changes editor content
  let gen = 0, savedGen = 0;   // dirty == gen !== savedGen
  let lastPostedDirty = false;
  const doc = { title: 'Untitled document', path: null, fileName: null, encoding: 'UTF-8', eol: 'LF', untitled: true };
  let changeTimer = null, statsTimer = null;

  // ---------------------------------------------------------------- editor

  const md = () => (editor ? editor.getMarkdown() : fallback ? fallback.value : '');
  const isDirty = () => gen !== savedGen;

  function createEditor(initialValue) {
    if (!window.toastui || !window.toastui.Editor) {
      $('#editor').append(el('div', { class: 'editor-fallback' },
        el('p', { text: 'The visual editor failed to load. You can still edit and save plain Markdown here.' }),
        fallback = el('textarea', { 'aria-label': 'Markdown source', spellcheck: 'true' })));
      fallback.value = initialValue;
      fallback.addEventListener('input', onEditorChange);
      return;
    }
    editor = new toastui.Editor({
      el: $('#editor'),
      height: '100%',
      minHeight: '200px',
      initialEditType: 'wysiwyg',
      previewStyle: 'vertical',
      initialValue,
      usageStatistics: false,
      hideModeSwitch: true,
      frontMatter: true,
      autofocus: false,
      theme: prefs.theme === 'dark' ? 'dark' : 'light',
      toolbarItems: [['heading', 'bold', 'italic', 'strike'], ['hr', 'quote'], ['ul', 'ol', 'task', 'indent', 'outdent'], ['table', 'link', 'image'], ['code', 'codeblock']],
      events: { change: onEditorChange },
    });
    setupSplitter();
  }

  /** Runs fn while ignoring editor change events (programmatic edits are not user edits). */
  function quietly(fn) {
    suppress++;
    try { return fn(); } finally { setTimeout(() => { suppress--; }, 0); }
  }

  function onEditorChange() {
    if (suppress > 0) return;
    gen++;
    afterContentChange();
  }

  function afterContentChange() {
    updateDirtyUI();
    if (lastPostedDirty !== isDirty()) {
      lastPostedDirty = isDirty();
      bridge.post('doc.state', { dirty: lastPostedDirty, title: currentTitle() });
    }
    clearTimeout(changeTimer);
    changeTimer = setTimeout(postContent, 600);
    clearTimeout(statsTimer);
    statsTimer = setTimeout(refreshStatsAndOutline, 220);
    clearFindHighlights();
  }

  // Recovery: the host writes a draft whenever the document is dirty.
  function postContent() {
    changeTimer = null;
    bridge.post('doc.changed', { markdown: md(), dirty: isDirty(), gen, title: currentTitle() });
  }

  const currentTitle = () => ($('#doc-title').value.trim() || 'Untitled document');

  /** State snapshot read synchronously by the host (ExecuteScriptAsync) before save/close/open. */
  function getState() {
    return { markdown: md(), title: currentTitle(), dirty: isDirty(), gen, mode };
  }

  // ---------------------------------------------------------------- documents

  function loadDocument(p) {
    NoorUI.closeAll();
    closeFind();
    hideBanner();
    $('#welcome').classList.add('hide');
    const text = String(p.markdown ?? '').replace(/\r\n?/g, '\n');
    doc.path = p.path || null;
    doc.fileName = p.fileName || null;
    doc.untitled = !doc.path;
    doc.title = p.title || 'Untitled document';
    doc.encoding = p.encoding || 'UTF-8';
    doc.eol = p.eol || 'LF';

    // Decide the editing mode: Visual is preferred, but never at the cost of silently rewriting a file.
    let target = p.mode || (prefs.openMode === 'markdown' ? 'markdown' : 'wysiwyg');
    if (target === 'split') target = mode === 'split' ? 'split' : target;
    let check = null;
    if (target === 'wysiwyg' && text.trim()) {
      check = NoorMarkdown.visualRoundTrip(text);
      if (!check.lossless) target = 'markdown';
    }
    quietly(() => {
      if (editor) {
        applyMode(target === 'wysiwyg' ? 'wysiwyg' : target, true);
        editor.setMarkdown(text, false);
        if (editor.isMarkdownMode()) editor.setSelection([1, 1], [1, 1]);
      } else if (fallback) {
        fallback.value = text;
      }
    });
    gen = p.dirty ? 1 : 0;
    savedGen = 0;
    lastPostedDirty = isDirty();
    updateDocUI();
    updateDirtyUI();
    refreshStatsAndOutline();
    scrollEditorToTop();

    if (check && !check.lossless) {
      showBanner('This file uses Markdown the Visual editor cannot represent exactly (for example raw HTML, footnotes or hard line breaks). It opened in Markdown mode so nothing is rewritten.',
        [{ label: 'Use Visual anyway', run: () => setMode('wysiwyg') }, { label: 'Dismiss', run: hideBanner }]);
    } else if (p.notice) {
      notice(p.notice, 4200);
    }
    if (p.warning) showBanner(p.warning, [{ label: 'Dismiss', run: hideBanner }]);
    if (p.dirty) postContent();
    if (editor && !p.noFocus) setTimeout(() => editor.focus(), 0);
  }

  function scrollEditorToTop() {
    requestAnimationFrame(() => {
      document.querySelectorAll('#editor .toastui-editor-contents, #editor .toastui-editor-md-preview').forEach((n) => { n.scrollTop = 0; });
    });
  }

  function updateDocUI() {
    const title = $('#doc-title');
    title.value = doc.title;
    title.readOnly = !doc.untitled;
    title.title = doc.untitled ? 'Document name — used as the file name when you first save' : 'Use Save As (Ctrl+Shift+S) to save under a new name';
    $('#doc-path').textContent = doc.path || 'Not saved yet';
    $('#doc-path').title = doc.path || '';
    $('#file-format').textContent = `${doc.encoding} · ${doc.eol}`;
    updateCrumb();
  }

  function updateCrumb() {
    const name = $('#crumb-name');
    name.textContent = doc.fileName || currentTitle();
    name.parentElement.querySelector('.dirty-dot')?.remove();
    if (isDirty()) name.after(el('span', { class: 'dirty-dot', title: 'Unsaved changes', text: '●' }));
  }

  function updateDirtyUI() {
    const dirty = isDirty();
    $('#status-dot').classList.toggle('dirty', dirty);
    $('#status-text').textContent = dirty ? (doc.untitled ? 'Not saved yet · recovery draft kept locally' : 'Unsaved changes · recovery draft kept locally') : (doc.untitled ? 'Empty draft' : 'All changes saved');
    $('#updated').textContent = dirty ? 'Edited' : (doc.untitled ? 'Ready to write' : 'Saved');
    $('#save-btn .label').textContent = dirty ? 'Save •' : 'Save';
    updateCrumb();
  }

  function onSaved(p) {
    if (typeof p.gen === 'number' && p.gen > savedGen) savedGen = p.gen;
    else if (typeof p.gen === 'number' && p.gen === gen) savedGen = gen;
    if (p.path) {
      doc.path = p.path; doc.fileName = p.fileName || doc.fileName; doc.untitled = false;
      doc.title = p.title || doc.title; doc.encoding = p.encoding || doc.encoding; doc.eol = p.eol || doc.eol;
    }
    lastPostedDirty = isDirty();
    updateDocUI();
    updateDirtyUI();
    if (isDirty()) postContent();
  }

  // ---------------------------------------------------------------- modes

  function applyMode(m, quiet) {
    mode = m;
    const host = $('#editor');
    host.classList.remove('mode-visual', 'mode-markdown', 'mode-split');
    host.classList.add('mode-' + (m === 'wysiwyg' ? 'visual' : m));
    document.querySelectorAll('.pill button').forEach((b) => {
      const on = b.dataset.mode === m;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (!editor) return;
    const run = () => {
      if (m === 'wysiwyg') editor.changeMode('wysiwyg', true);
      else { editor.changeMode('markdown', true); editor.changePreviewStyle(m === 'split' ? 'vertical' : 'tab'); }
    };
    if (quiet) run(); else quietly(run);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  async function setMode(m) {
    if (!editor) { notice('Visual editing is unavailable because the editor failed to load.'); return; }
    if (m === mode) return;
    if (m === 'wysiwyg') {
      const text = md();
      const check = NoorMarkdown.visualRoundTrip(text);
      if (!check.lossless) {
        const choice = await NoorUI.choose('Switch to Visual mode?', [
          'Visual mode cannot represent some of this Markdown exactly — raw HTML, footnotes, hard line breaks or other unsupported syntax would be rewritten or dropped.',
          'A revision snapshot of the current text is saved first, so you can restore it from Revision snapshots.',
        ], [{ label: 'Stay in Markdown', value: 'stay', primary: true }, { label: 'Switch anyway', value: 'switch' }]);
        if (choice !== 'switch') return;
        await createSnapshot('Before switching to Visual', true);
        applyMode('wysiwyg');
        hideBanner();
        gen++;
        afterContentChange();
        return;
      }
    }
    applyMode(m);
    refreshOutline();
  }

  // ---------------------------------------------------------------- split divider

  function setupSplitter() {
    const splitter = document.querySelector('#editor .toastui-editor-md-splitter');
    if (!splitter) return;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', 'vertical');
    splitter.setAttribute('aria-label', 'Resize split panes');
    splitter.tabIndex = 0;
    const container = splitter.parentElement;
    splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing-split');
      const move = (ev) => {
        const r = container.getBoundingClientRect();
        setSplit((ev.clientX - r.left) / r.width, false);
      };
      const up = () => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
        splitter.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing-split');
        setPrefs({ splitRatio: prefs.splitRatio });
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
      splitter.addEventListener('pointercancel', up);
    });
    splitter.addEventListener('dblclick', () => setSplit(0.5, true));
    splitter.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setSplit(prefs.splitRatio + (e.key === 'ArrowLeft' ? -0.02 : 0.02), true);
      }
    });
  }

  function setSplit(ratio, persist) {
    const r = Math.min(0.7, Math.max(0.3, Number(ratio) || 0.5));
    prefs.splitRatio = Math.round(r * 1000) / 1000;
    $('#editor').style.setProperty('--split', (prefs.splitRatio * 100).toFixed(1) + '%');
    if (persist) setPrefs({ splitRatio: prefs.splitRatio });
  }

  // ---------------------------------------------------------------- sidebar

  function setupSidebar() {
    const resizer = $('#sidebar-resizer');
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing-sidebar');
      const move = (ev) => applySidebarWidth(ev.clientX);
      const up = () => {
        resizer.removeEventListener('pointermove', move);
        resizer.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing-sidebar');
        setPrefs({ sidebarWidth: prefs.sidebarWidth });
      };
      resizer.addEventListener('pointermove', move);
      resizer.addEventListener('pointerup', up);
    });
    resizer.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        applySidebarWidth(prefs.sidebarWidth + (e.key === 'ArrowLeft' ? -16 : 16));
        setPrefs({ sidebarWidth: prefs.sidebarWidth });
      }
    });
    $('#sidebar-collapse').addEventListener('click', () => toggleSidebar(true));
    $('#sidebar-expand').addEventListener('click', () => toggleSidebar(false));
  }

  function applySidebarWidth(w) {
    prefs.sidebarWidth = Math.round(Math.min(420, Math.max(200, Number(w) || 256)));
    document.documentElement.style.setProperty('--sidebar-w', prefs.sidebarWidth + 'px');
  }

  function toggleSidebar(collapse) {
    const c = collapse === undefined ? !document.body.classList.contains('sidebar-collapsed') : collapse;
    document.body.classList.toggle('sidebar-collapsed', c);
    setPrefs({ sidebarCollapsed: c });
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  // ---------------------------------------------------------------- preferences

  function applyPrefs() {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme === 'light' ? 'light' : 'dark';
    root.style.background = '';
    const ui = document.querySelector('#editor .toastui-editor-defaultUI');
    if (ui) ui.classList.toggle('toastui-editor-dark', prefs.theme !== 'light');
    root.style.setProperty('--doc-font', FONTS[prefs.fontFamily] || FONTS.inter);
    root.style.setProperty('--doc-size', Math.min(26, Math.max(12, Number(prefs.fontSize) || 16)) + 'px');
    root.style.setProperty('--measure', MEASURES[prefs.lineWidth] || MEASURES.comfortable);
    applySidebarWidth(prefs.sidebarWidth);
    document.body.classList.toggle('sidebar-collapsed', !!prefs.sidebarCollapsed);
    setSplit(prefs.splitRatio, false);
    progress();
  }

  function setPrefs(partial) {
    prefs = { ...prefs, ...partial };
    applyPrefs();
    bridge.post('prefs.set', partial);
  }

  function toggleTheme() {
    setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' });
    notice(prefs.theme === 'dark' ? 'Dark theme' : 'Light theme');
  }

  function changeFontSize(delta) {
    const size = delta === 0 ? 16 : Math.min(26, Math.max(12, prefs.fontSize + delta));
    setPrefs({ fontSize: size });
    notice('Text size ' + size + ' px', 1200);
  }

  function showPreferences() {
    NoorUI.modal({ label: 'Preferences', width: 620 }, (s, close) => {
      const select = (key, options) => {
        const sel = el('select', { id: 'pref-' + key }, options.map(([v, label]) => el('option', { value: v, selected: String(prefs[key]) === String(v) || undefined }, label)));
        sel.addEventListener('change', () => setPrefs({ [key]: sel.value }));
        return sel;
      };
      const size = el('input', { type: 'range', min: '12', max: '26', step: '1', value: String(prefs.fontSize), id: 'pref-size', 'aria-label': 'Text size' });
      const sizeLabel = el('span', { text: prefs.fontSize + ' px' });
      size.addEventListener('input', () => { sizeLabel.textContent = size.value + ' px'; setPrefs({ fontSize: Number(size.value) }); });
      const restore = el('input', { type: 'checkbox', id: 'pref-restore', checked: prefs.restoreSession || undefined });
      restore.addEventListener('change', () => setPrefs({ restoreSession: restore.checked }));
      s.append(NoorUI.head('Preferences', close), el('div', { class: 'modal-body' },
        el('div', { class: 'pref-grid' },
          el('label', { for: 'pref-theme', text: 'Theme' }), select('theme', [['dark', 'Dark'], ['light', 'Light']]),
          el('label', { for: 'pref-fontFamily', text: 'Writing font' }), select('fontFamily', [['inter', 'Inter (bundled)'], ['system', 'Segoe UI'], ['serif', 'Serif'], ['mono', 'Monospace']]),
          el('label', { for: 'pref-size', text: 'Text size' }), el('div', { class: 'inline' }, size, sizeLabel),
          el('label', { for: 'pref-lineWidth', text: 'Line width' }), select('lineWidth', [['comfortable', 'Comfortable (≈ 780 px)'], ['wide', 'Wide (≈ 1100 px)'], ['full', 'Full width']]),
          el('label', { for: 'pref-openMode', text: 'Open files in' }), select('openMode', [['visual', 'Visual editor (Markdown mode if it would rewrite the file)'], ['markdown', 'Markdown source']]),
          el('label', { for: 'pref-restore', text: 'On startup' }), el('label', { class: 'inline' }, restore, 'Reopen the last document'),
        ),
        el('div', { class: 'pref-actions' },
          el('button', { class: 'utility-btn', onclick: () => runCommand('recovery.show') }, 'Recovery drafts…'),
          el('button', { class: 'utility-btn danger', onclick: clearRecent }, 'Clear recent files'),
          el('button', { class: 'utility-btn danger', onclick: clearRecovery }, 'Delete all recovery drafts'),
          el('button', { class: 'utility-btn', onclick: () => bridge.request('app.openDataFolder').catch(showError) }, 'Open data folder'),
          el('button', { class: 'utility-btn', onclick: () => runCommand('shortcuts.show') }, 'Keyboard shortcuts'),
          el('button', { class: 'utility-btn', onclick: () => runCommand('about.show') }, 'About & licenses'),
        )),
      el('div', { class: 'modal-foot' }, el('span', { text: 'Preferences are saved automatically in your Windows profile.' })));
    });
  }

  async function clearRecent() {
    if (!await NoorUI.confirm('Clear recent files?', 'The list of recently opened files will be emptied. Your files are not touched.', 'Clear list')) return;
    bridge.request('recent.clear').then(() => notice('Recent files cleared')).catch(showError);
  }

  async function clearRecovery() {
    if (!await NoorUI.confirm('Delete all recovery drafts?', ['Recovery drafts hold unsaved work from previous sessions. Deleting them cannot be undone.', 'The draft for the document open in this window is kept.'], 'Delete drafts')) return;
    bridge.request('recovery.clearAll').then((r) => notice(`${r?.deleted ?? 0} recovery draft(s) deleted`)).catch(showError);
  }

  // ---------------------------------------------------------------- stats, outline, goal

  function refreshStatsAndOutline() {
    const text = md();
    const s = NoorMarkdown.stats(text);
    $('#counter-top').textContent = `${s.words.toLocaleString()} words`;
    $('#counter-bottom').textContent = `${s.words.toLocaleString()} words · ${s.chars.toLocaleString()} characters · ${s.minutes} min read`;
    progress(s.words);
    renderOutline(NoorMarkdown.headings(text));
  }
  const refreshOutline = () => renderOutline(NoorMarkdown.headings(md()));

  let outlineSignature = null;
  function renderOutline(list) {
    // Rebuilding identical buttons mid-click would swallow the click, so only re-render on change.
    const signature = JSON.stringify(list.map((h) => [h.level, h.text, h.line]));
    if (signature === outlineSignature) return;
    outlineSignature = signature;
    const box = $('#outline-box');
    box.replaceChildren();
    if (!list.length) { box.append(el('p', { class: 'empty', text: 'Headings appear as you write.' })); return; }
    const seen = new Map();
    for (const h of list.slice(0, 200)) {
      const occurrence = seen.get(h.text) || 0;
      seen.set(h.text, occurrence + 1);
      box.append(el('button', {
        class: 'depth-' + Math.min(h.level, 4), title: h.text,
        onmousedown: (e) => e.preventDefault(), // keep the caret in the editor while clicking
        onclick: () => goToHeading(h, occurrence),
      }, h.text || '(empty heading)'));
    }
  }

  function goToHeading(h, occurrence) {
    if (!editor) return;
    try {
      // Focus first: ProseMirror re-reads the DOM selection on focus, which would undo a selection set before it.
      editor.focus();
      if (editor.isMarkdownMode()) {
        editor.setSelection([h.line, 1], [h.line, 1]);
        const view = editor.mdEditor.view;
        const pos = view.state.doc.child(h.line - 1) ? positionOfLine(view.state.doc, h.line) : 1;
        scrollViewTo(view, pos);
      } else {
        const view = editor.wwEditor.view;
        let found = null, count = 0;
        view.state.doc.descendants((node, pos) => {
          if (found !== null) return false;
          if (node.type.name === 'heading') {
            if (node.textContent.replace(/[*_`~]/g, '').trim() === h.text) { if (count === occurrence) found = pos; count++; }
            return false;
          }
          return true;
        });
        if (found === null) return;
        editor.setSelection(found + 1, found + 1);
        scrollViewTo(view, found + 1);
      }
    } catch (err) { console.error(err); }
  }

  function positionOfLine(pmDoc, line) {
    let pos = 0;
    for (let i = 0; i < line - 1 && i < pmDoc.childCount; i++) pos += pmDoc.child(i).nodeSize;
    return pos + 1;
  }

  function scrollViewTo(view, pos) {
    try {
      const { node } = view.domAtPos(pos);
      const target = node.nodeType === 1 ? node : node.parentElement;
      target?.scrollIntoView({ block: 'center' });
    } catch { /* position may be stale; ignore */ }
  }

  function progress(words) {
    const count = words ?? NoorMarkdown.stats(md()).words;
    const goal = Math.max(1, Number(prefs.goalWords) || 750);
    const pct = Math.min(100, (count / goal) * 100);
    $('#goaltext').textContent = `${count.toLocaleString()} / ${goal.toLocaleString()} words`;
    $('#goalfill').style.width = pct + '%';
    $('#goalbar').setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  async function setGoal() {
    const v = await NoorUI.prompt('Writing goal', 'How many words are you aiming for in this document?', prefs.goalWords, { type: 'number', okLabel: 'Set goal' });
    if (v === undefined) return;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > 1000000) { notice('Enter a number between 1 and 1,000,000'); return; }
    setPrefs({ goalWords: n });
  }

  // ---------------------------------------------------------------- recent files

  function renderRecent() {
    const box = $('#recent-box');
    box.replaceChildren();
    if (!recent.length) box.append(el('p', { class: 'empty', text: 'Files you open appear here.' }));
    for (const r of recent.slice(0, 8)) {
      box.append(el('button', { title: r.path, onclick: () => openRecent(r.path) }, r.name));
    }
    const w = $('#welcome-recent');
    w.replaceChildren();
    if (recent.length) {
      w.append(el('div', { class: 'section-heading', text: 'Recent' }));
      for (const r of recent.slice(0, 6)) w.append(el('button', { onclick: () => openRecent(r.path), title: r.path }, el('span', { text: r.name }), el('small', { text: r.path })));
    }
  }

  function openRecent(path) {
    bridge.request('doc.openRecent', { path }).catch(showError);
  }

  // ---------------------------------------------------------------- banner

  function showBanner(text, actions) {
    $('#banner-text').textContent = text;
    const box = $('#banner-actions');
    box.replaceChildren(...actions.map((a) => el('button', { class: 'utility-btn', onclick: a.run }, a.label)));
    $('#banner').classList.remove('hide');
  }
  function hideBanner() { $('#banner').classList.add('hide'); }

  // ---------------------------------------------------------------- find & replace

  let matches = [];
  let current = -1;

  function activeView() {
    if (!editor) return null;
    return editor.isWysiwygMode() ? editor.wwEditor.view : editor.mdEditor.view;
  }

  function showFind(replace) {
    if (!editor) return;
    const bar = $('#findbar');
    bar.classList.remove('hide');
    const input = $('#find-input');
    const sel = editor.getSelectedText ? editor.getSelectedText() : '';
    if (sel && !sel.includes('\n') && sel.length < 200) input.value = sel;
    (replace ? $('#replace-input') : input).focus();
    input.select();
    runFind(false);
  }

  function closeFind() {
    if ($('#findbar').classList.contains('hide')) return false;
    $('#findbar').classList.add('hide');
    clearFindHighlights();
    if (editor && current >= 0 && matches[current]) {
      selectMatch(matches[current]);
      editor.focus();
    }
    matches = []; current = -1;
    return true;
  }

  function collectMatches(query, caseSensitive) {
    const view = activeView();
    if (!view || !query) return [];
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const out = [];
    view.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      let text = '';
      const map = [];
      node.forEach((child, offset) => {
        const start = pos + 1 + offset;
        if (child.isText) { for (let i = 0; i < child.text.length; i++) map.push(start + i); text += child.text; }
        else { map.push(start); text += '￼'; }
      });
      const hay = caseSensitive ? text : text.toLocaleLowerCase();
      let idx = hay.indexOf(needle);
      while (idx !== -1 && out.length < 5000) {
        out.push({ from: map[idx], to: map[idx + needle.length - 1] + 1 });
        idx = hay.indexOf(needle, idx + Math.max(1, needle.length));
      }
      return false;
    });
    return out;
  }

  function runFind(advance, backwards) {
    const q = $('#find-input').value;
    matches = collectMatches(q, $('#find-case').checked);
    if (!matches.length) { current = -1; $('#find-count').textContent = q ? 'No results' : ''; clearFindHighlights(); return; }
    const view = activeView();
    const head = view.state.selection.from;
    if (!advance) {
      current = matches.findIndex((m) => m.from >= head);
      if (current < 0) current = 0;
    } else {
      current = backwards ? (current - 1 + matches.length) % matches.length : (current + 1) % matches.length;
    }
    highlightMatches();
    $('#find-count').textContent = `${current + 1} of ${matches.length}`;
  }

  function selectMatch(m) {
    const view = activeView();
    if (!view) return;
    if (editor.isWysiwygMode()) editor.setSelection(m.from, m.to);
    else {
      const a = lineCh(view.state.doc, m.from), b = lineCh(view.state.doc, m.to);
      editor.setSelection(a, b);
    }
  }

  function lineCh(pmDoc, pos) {
    const $pos = pmDoc.resolve(pos);
    const line = $pos.index(0) + 1;
    return [line, pos - $pos.start(1) + 1];
  }

  // CSS Custom Highlight API: shows matches without touching the document or stealing focus.
  function highlightMatches() {
    clearFindHighlights();
    const view = activeView();
    if (!view || !window.CSS || !CSS.highlights || typeof Highlight !== 'function') return;
    const all = new Highlight();
    const cur = new Highlight();
    matches.slice(0, 1000).forEach((m, i) => {
      try {
        const a = view.domAtPos(m.from), b = view.domAtPos(m.to);
        const r = document.createRange();
        r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset);
        (i === current ? cur : all).add(r);
        if (i === current) (a.node.nodeType === 1 ? a.node : a.node.parentElement)?.scrollIntoView({ block: 'center' });
      } catch { /* stale */ }
    });
    CSS.highlights.set('noor-find', all);
    CSS.highlights.set('noor-find-current', cur);
  }

  function clearFindHighlights() {
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('noor-find'); CSS.highlights.delete('noor-find-current'); }
  }

  function replaceOne() {
    const view = activeView();
    if (!view || current < 0 || !matches[current]) { runFind(false); return; }
    const m = matches[current];
    const repl = $('#replace-input').value;
    view.dispatch(view.state.tr.insertText(repl, m.from, m.to));
    const keep = current;
    runFind(false);
    if (matches.length) { current = Math.min(keep, matches.length - 1); highlightMatches(); $('#find-count').textContent = `${current + 1} of ${matches.length}`; }
  }

  function replaceAll() {
    const view = activeView();
    const q = $('#find-input').value;
    if (!view || !q) return;
    const list = collectMatches(q, $('#find-case').checked);
    if (!list.length) { notice('No matches'); return; }
    const repl = $('#replace-input').value;
    let tr = view.state.tr;
    for (let i = list.length - 1; i >= 0; i--) tr = tr.insertText(repl, list[i].from, list[i].to);
    view.dispatch(tr);
    notice(`Replaced ${list.length} occurrence${list.length === 1 ? '' : 's'} · Ctrl+Z to undo`);
    runFind(false);
  }

  function setupFind() {
    const input = $('#find-input');
    input.addEventListener('input', () => runFind(false));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runFind(true, e.shiftKey); }
    });
    $('#replace-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey) replaceAll(); else replaceOne(); }
    });
    $('#find-case').addEventListener('change', () => runFind(false));
    $('#find-next').addEventListener('click', () => runFind(true, false));
    $('#find-prev').addEventListener('click', () => runFind(true, true));
    $('#replace-one').addEventListener('click', replaceOne);
    $('#replace-all').addEventListener('click', replaceAll);
    $('#find-close').addEventListener('click', closeFind);
    const style = document.createElement('style');
    style.textContent = '::highlight(noor-find){background-color:color-mix(in srgb,var(--accent) 28%,transparent)}::highlight(noor-find-current){background-color:var(--accent);color:var(--on-accent)}';
    document.head.append(style);
  }

  // ---------------------------------------------------------------- snapshots

  async function createSnapshot(label, quiet) {
    try {
      await bridge.request('snapshots.create', { label: label || 'Manual snapshot' });
      if (!quiet) notice('Snapshot saved ✓');
    } catch (err) { showError(err); }
  }

  async function showHistory() {
    let list = [];
    try { list = await bridge.request('snapshots.list') || []; } catch (err) { showError(err); return; }
    NoorUI.modal({ label: 'Revision snapshots', width: 680 }, (s, close) => {
      const body = el('div', { class: 'modal-body' });
      const render = () => {
        body.replaceChildren();
        if (!list.length) body.append(el('p', { text: 'No snapshots for this document yet. Save one (Ctrl+Alt+S) before a big edit.' }));
        for (const item of list) {
          const when = new Date(item.createdUtc);
          body.append(el('div', { class: 'snapshot' },
            el('div', { class: 'info' },
              el('div', { text: item.label || 'Snapshot' }),
              el('small', { text: `${when.toLocaleString()} · ${item.words.toLocaleString()} words` })),
            el('div', { class: 'row-actions' },
              el('button', { class: 'utility-btn', onclick: () => previewSnapshot(item.id) }, 'Preview'),
              el('button', { class: 'utility-btn', onclick: async () => { if (await restoreSnapshot(item)) close(); } }, 'Restore'),
              el('button', { class: 'utility-btn danger', 'aria-label': 'Delete snapshot', onclick: async () => {
                if (!await NoorUI.confirm('Delete snapshot?', 'This snapshot will be permanently removed.', 'Delete')) return;
                try { await bridge.request('snapshots.delete', { id: item.id }); list = list.filter((x) => x.id !== item.id); render(); } catch (err) { showError(err); }
              } }, '✕'))));
        }
      };
      render();
      s.append(NoorUI.head('◷ Revision snapshots', close), body,
        el('div', { class: 'modal-foot' },
          el('span', { text: 'Stored in your Windows profile (%LOCALAPPDATA%\\NoorMD\\Snapshots) and kept across restarts.' }),
          el('div', { class: 'modal-buttons' }, el('button', { class: 'action primary', onclick: async () => { await createSnapshot(); list = await bridge.request('snapshots.list') || []; render(); } }, 'Snapshot now'))));
    });
  }

  async function previewSnapshot(id) {
    let snap;
    try { snap = await bridge.request('snapshots.get', { id }); } catch (err) { showError(err); return; }
    NoorUI.modal({ label: 'Snapshot preview', width: 760 }, (s, close) => {
      s.append(NoorUI.head(snap.label || 'Snapshot', close),
        el('div', { class: 'modal-body' }, el('div', { class: 'snapshot-preview', text: snap.markdown })),
        el('div', { class: 'modal-foot' }, el('span', { text: new Date(snap.createdUtc).toLocaleString() }),
          el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => close() }, 'Close'))));
    });
  }

  async function restoreSnapshot(item) {
    const ok = await NoorUI.confirm('Restore this snapshot?', [
      `The editor content will be replaced with the snapshot from ${new Date(item.createdUtc).toLocaleString()}.`,
      'Your current text is saved as a new snapshot first, and the file on disk is not changed until you save.',
    ], 'Restore');
    if (!ok) return false;
    try {
      await createSnapshot('Before restoring a snapshot', true);
      const snap = await bridge.request('snapshots.get', { id: item.id });
      quietly(() => {
        if (editor) editor.setMarkdown(snap.markdown.replace(/\r\n?/g, '\n'), false); else fallback.value = snap.markdown;
      });
      gen++;
      afterContentChange();
      postContent();
      notice('Snapshot restored ✓ — save to keep it');
      return true;
    } catch (err) { showError(err); return false; }
  }

  // ---------------------------------------------------------------- recovery

  async function showRecovery(drafts) {
    let list = drafts;
    if (!list) { try { list = await bridge.request('recovery.list') || []; } catch (err) { showError(err); return; } }
    NoorUI.modal({ label: 'Recover unsaved work', width: 680 }, (s, close) => {
      const body = el('div', { class: 'modal-body' });
      const render = () => {
        body.replaceChildren();
        if (!list.length) { body.append(el('p', { text: 'There are no recovery drafts from other sessions.' })); return; }
        body.append(el('p', { text: 'NoorMD found unsaved work from a previous session. Restore it to keep editing, or discard it.' }));
        for (const d of list) {
          body.append(el('div', { class: 'snapshot' },
            el('div', { class: 'info' }, el('div', { text: d.title || 'Untitled document' }),
              el('small', { text: `${d.path || 'Never saved'} · ${new Date(d.savedUtc).toLocaleString()} · ${d.words.toLocaleString()} words` })),
            el('div', { class: 'row-actions' },
              el('button', { class: 'utility-btn', onclick: async () => {
                try { const r = await bridge.request('recovery.restore', { id: d.id }); if (r && r.restored) close(); } catch (err) { showError(err); }
              } }, 'Restore'),
              el('button', { class: 'utility-btn danger', onclick: async () => {
                if (!await NoorUI.confirm('Discard this draft?', 'The unsaved text in this recovery draft will be deleted permanently.', 'Discard')) return;
                try { await bridge.request('recovery.discard', { id: d.id }); list = list.filter((x) => x.id !== d.id); render(); } catch (err) { showError(err); }
              } }, 'Discard'))));
        }
      };
      render();
      s.append(NoorUI.head('Recover unsaved work', close), body,
        el('div', { class: 'modal-foot' }, el('span', { text: 'Drafts you keep stay available from the command palette (“Recover unsaved drafts”).' }),
          el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => close() }, 'Later'))));
    });
  }

  // ---------------------------------------------------------------- export / print

  function prepareRender() {
    const html = NoorMarkdown.renderSafe(md());
    $('#print-root').innerHTML = html;
    return html;
  }

  async function exportHtml() {
    try {
      const r = await bridge.request('export.html', { title: currentTitle(), bodyHtml: prepareRender() });
      if (r && r.path) notice('HTML exported to ' + r.path, 4000);
    } catch (err) { showError(err); }
  }

  async function exportPdf() {
    prepareRender();
    try {
      const r = await bridge.request('export.pdf', { title: currentTitle() });
      if (r && r.path) notice('PDF saved to ' + r.path, 4000);
    } catch (err) { showError(err); }
  }

  function print() {
    prepareRender();
    bridge.request('print').catch(showError);
  }

  // ---------------------------------------------------------------- command palette

  const COMMANDS = [
    ['doc.new', 'New document', 'Document', 'Ctrl+N', () => bridge.request('doc.new').catch(showError)],
    ['doc.open', 'Open file…', 'Document', 'Ctrl+O', () => bridge.request('doc.open').catch(showError)],
    ['doc.save', 'Save', 'Document', 'Ctrl+S', () => save('doc.save')],
    ['doc.saveAs', 'Save as…', 'Document', 'Ctrl+Shift+S', () => save('doc.saveAs')],
    ['doc.reveal', 'Show file in Explorer', 'Document', '', () => bridge.request('doc.reveal').catch(showError)],
    ['app.newWindow', 'New window', 'Document', '', () => bridge.request('app.newWindow').catch(showError)],
    ['doc.reload', 'Reload from disk', 'Document', '', () => bridge.request('doc.reload').catch(showError)],
    ['doc.sample', 'Open the sample document', 'Document', '', () => bridge.request('doc.new', { markdown: SAMPLE, title: 'Welcome to NoorMD' }).catch(showError)],
    ['recovery.show', 'Recover unsaved drafts…', 'Document', '', () => showRecovery()],
    ['export.markdown', 'Export Markdown copy…', 'Export', '', () => bridge.request('export.markdown').catch(showError)],
    ['export.html', 'Export HTML…', 'Export', '', exportHtml],
    ['export.pdf', 'Export PDF…', 'Export', '', exportPdf],
    ['print', 'Print…', 'Export', 'Ctrl+P', print],
    ['view.visual', 'Visual editor', 'View', 'Ctrl+1', () => setMode('wysiwyg')],
    ['view.markdown', 'Markdown source', 'View', 'Ctrl+2', () => setMode('markdown')],
    ['view.split', 'Split view', 'View', 'Ctrl+3', () => setMode('split')],
    ['view.focus', 'Toggle focus mode', 'View', 'F11', () => toggleZen()],
    ['view.sidebar', 'Toggle sidebar', 'View', 'Ctrl+\\', () => toggleSidebar()],
    ['theme.toggle', 'Toggle light / dark theme', 'View', '', toggleTheme],
    ['font.bigger', 'Increase text size', 'View', 'Ctrl+=', () => changeFontSize(1)],
    ['font.smaller', 'Decrease text size', 'View', 'Ctrl+-', () => changeFontSize(-1)],
    ['font.reset', 'Reset text size', 'View', 'Ctrl+0', () => changeFontSize(0)],
    ['find.show', 'Find', 'Edit', 'Ctrl+F', () => showFind(false)],
    ['find.replace', 'Find and replace', 'Edit', 'Ctrl+H', () => showFind(true)],
    ['snapshot.create', 'Save revision snapshot', 'History', 'Ctrl+Alt+S', () => createSnapshot()],
    ['history.show', 'Browse revision snapshots', 'History', 'Ctrl+Shift+H', showHistory],
    ['goal.set', 'Set writing goal', 'Writing', '', setGoal],
    ['prefs.show', 'Preferences', 'App', 'Ctrl+,', showPreferences],
    ['shortcuts.show', 'Keyboard shortcuts', 'App', 'F1', showShortcuts],
    ['about.show', 'About NoorMD & licenses', 'App', '', showAbout],
    ['palette.show', 'Command palette', 'App', 'Ctrl+K', showPalette],
  ].map(([id, label, group, keys, run]) => ({ id, label, group, keys, run }));
  const commandById = new Map(COMMANDS.map((c) => [c.id, c]));

  function runCommand(id) {
    const c = commandById.get(id);
    if (!c) return;
    if (id !== 'palette.show' && id !== 'shortcuts.show' && id !== 'about.show' && id !== 'recovery.show') NoorUI.closeAll();
    Promise.resolve().then(c.run).catch(showError);
  }

  function showPalette() {
    NoorUI.closeAll();
    NoorUI.modal({ label: 'Command palette' }, (s, close) => {
      const query = el('input', { id: 'palette-query', placeholder: 'What would you like to do?', autocomplete: 'off', 'aria-label': 'Search commands', autofocus: true, role: 'combobox', 'aria-controls': 'palette-results', 'aria-expanded': 'true' });
      const results = el('div', { class: 'palette-results', id: 'palette-results', role: 'listbox' });
      let items = [];
      let selected = 0;
      const recentCmds = recent.slice(0, 8).map((r) => ({ id: 'recent:' + r.path, label: 'Open recent: ' + r.name, group: 'Recent', keys: '', run: () => openRecent(r.path) }));
      const render = () => {
        const q = query.value.trim().toLowerCase();
        const pool = COMMANDS.filter((c) => c.id !== 'palette.show').concat(recentCmds);
        items = pool.filter((c) => !q || c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
        selected = Math.min(selected, Math.max(0, items.length - 1));
        results.replaceChildren();
        if (!items.length) results.append(el('p', { text: 'No matching actions', style: 'padding:14px;margin:0;color:var(--muted)' }));
        items.forEach((c, i) => {
          results.append(el('button', {
            class: 'cmd-item' + (i === selected ? ' selected' : ''), role: 'option', 'aria-selected': String(i === selected), id: 'cmd-' + i, tabindex: '-1',
            onclick: () => { close(); Promise.resolve().then(c.run).catch(showError); },
            onmousemove: () => { if (selected !== i) { selected = i; render(); } },
          }, el('span', { text: c.label }), el('span', { class: 'meta' }, c.keys ? el('span', { class: 'kbd', text: c.keys }) : null, el('small', { text: c.group }))));
        });
        query.setAttribute('aria-activedescendant', items.length ? 'cmd-' + selected : '');
        results.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
      };
      query.addEventListener('input', () => { selected = 0; render(); });
      query.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); selected = (selected + 1) % Math.max(1, items.length); render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); selected = (selected - 1 + items.length) % Math.max(1, items.length); render(); }
        else if (e.key === 'Enter') { e.preventDefault(); const c = items[selected]; if (c) { close(); Promise.resolve().then(c.run).catch(showError); } }
      });
      s.append(query, results, el('div', { class: 'modal-foot' }, el('span', { text: '↑ ↓ to choose · Enter to run' }), el('span', { text: 'Esc to close' })));
      render();
    });
  }

  function showShortcuts() {
    NoorUI.closeAll();
    NoorUI.modal({ label: 'Keyboard shortcuts', width: 560 }, (s, close) => {
      const extra = [['Bold / italic', 'Ctrl+B / Ctrl+I'], ['Undo / redo', 'Ctrl+Z / Ctrl+Y'], ['Close dialog · exit focus mode', 'Esc'], ['Next / previous match', 'Enter / Shift+Enter'], ['Replace all (in replace box)', 'Ctrl+Enter']];
      const rows = COMMANDS.filter((c) => c.keys).map((c) => [c.label, c.keys]).concat(extra);
      s.append(NoorUI.head('Keyboard shortcuts', close), el('div', { class: 'modal-body' },
        el('table', { class: 'shortcut-table' }, rows.map(([a, b]) => el('tr', {}, el('td', { text: a }), el('td', {}, el('span', { class: 'kbd', text: b })))))));
    });
  }

  async function showAbout() {
    let info = {};
    try { info = await bridge.request('app.about') || {}; } catch { /* host may be older */ }
    NoorUI.closeAll();
    NoorUI.modal({ label: 'About NoorMD', width: 560 }, (s, close) => {
      s.append(NoorUI.head('About NoorMD', close), el('div', { class: 'modal-body' },
        el('p', {}, el('strong', { text: 'NoorMD Desktop ' + (info.version || '') })),
        el('p', { text: 'A local-first Markdown writing studio. No account, telemetry or web services.' }),
        el('p', { text: `Runtime: ${info.runtime || '?'} · WebView2 ${info.webView2 || '?'}` }),
        el('p', { text: 'Third-party components (licenses ship in the “licenses” folder next to NoorMD.exe):' }),
        el('ul', {}, ['TOAST UI Editor 3.2.2 — MIT', 'ProseMirror — MIT', 'DOMPurify 3.2.6 — Apache-2.0 / MPL-2.0', 'Inter typeface — SIL Open Font License 1.1', 'Microsoft WebView2 SDK — BSD-style (Microsoft)'].map((t) => el('li', { text: t })))),
      el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' },
        el('button', { class: 'action', onclick: () => bridge.request('app.openLicenses').catch(showError) }, 'Open licenses folder'),
        el('button', { class: 'action primary', onclick: () => close() }, 'Close'))));
    });
  }

  // ---------------------------------------------------------------- focus mode

  function toggleZen(force) {
    const on = force === undefined ? !document.body.classList.contains('zen') : force;
    document.body.classList.toggle('zen', on);
    $('#zen-toggle').classList.toggle('selected', on);
    notice(on ? 'Focus mode · Esc or F11 to exit' : 'Focus mode off', 1600);
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      if (editor) editor.focus();
    });
  }

  // ---------------------------------------------------------------- saving

  async function save(kind) {
    clearTimeout(changeTimer);
    $('#status-text').textContent = 'Saving…';
    try {
      const r = await bridge.request(kind);
      if (r && r.saved) notice('Saved ✓ ' + (r.fileName || ''), 1800);
      else updateDirtyUI();
    } catch (err) {
      $('#status-dot').classList.add('error');
      $('#status-text').textContent = 'Save failed — your text is still here and in the recovery draft';
      showError(err);
    }
  }

  function showError(err) {
    const msg = (err && err.message) || String(err);
    console.error(err);
    NoorUI.choose('Something went wrong', msg, [{ label: 'OK', value: true, primary: true }]);
  }

  // ---------------------------------------------------------------- keyboard: the single owner of app shortcuts

  function onKeyDown(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let cmd = null;
    if (NoorUI.hasOpenModal()) {
      // Esc always closes the top dialog, even if focus is not inside it; other keys belong to the dialog.
      if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); NoorUI.closeTop(); }
      return;
    }
    if (key === 'Escape') {
      if (closeFind()) { e.preventDefault(); return; }
      if (document.body.classList.contains('zen')) { e.preventDefault(); toggleZen(false); }
      return;
    }
    if (key === 'F11') cmd = 'view.focus';
    else if (key === 'F1') cmd = 'shortcuts.show';
    else if (ctrl && e.altKey && key === 's') cmd = 'snapshot.create';
    else if (ctrl && !e.altKey) {
      if (key === 's') cmd = e.shiftKey ? 'doc.saveAs' : 'doc.save';
      else if (key === 'n' && !e.shiftKey) cmd = 'doc.new';
      else if (key === 'o' && !e.shiftKey) cmd = 'doc.open';
      else if (key === 'f' && !e.shiftKey) cmd = 'find.show';
      else if (key === 'h' && !e.shiftKey) cmd = 'find.replace';
      else if (key === 'h' && e.shiftKey) cmd = 'history.show';
      else if (key === 'k' || (key === 'p' && e.shiftKey)) cmd = 'palette.show';
      else if (key === 'p') cmd = 'print';
      else if (key === '1' || e.code === 'Digit1') cmd = 'view.visual';
      else if (key === '2' || e.code === 'Digit2') cmd = 'view.markdown';
      else if (key === '3' || e.code === 'Digit3') cmd = 'view.split';
      else if (key === '\\' || e.code === 'Backslash') cmd = 'view.sidebar';
      else if (key === ',') cmd = 'prefs.show';
      else if (key === '=' || key === '+') cmd = 'font.bigger';
      else if (key === '-') cmd = 'font.smaller';
      else if (key === '0') cmd = 'font.reset';
      else if (key === 'y' && !e.shiftKey && editor) { e.preventDefault(); e.stopPropagation(); editor.exec('redo'); return; }
    }
    if (!cmd) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat && cmd.startsWith('doc.')) return; // a held Ctrl+S saves exactly once
    runCommand(cmd);
  }

  // ---------------------------------------------------------------- drag & drop, links

  function setupDropAndLinks() {
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }, true);
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      if (!bridge.postFiles('files.dropped', files)) notice('Use Open (Ctrl+O) to open files.');
    }, true);

    // Links never navigate the app. They are handed to the host, which validates and asks first.
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const inEditable = !!a.closest('[contenteditable="true"]');
      e.preventDefault();
      if (inEditable && !(e.ctrlKey || e.metaKey)) return; // editing a link, not following it
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) return;
      bridge.request('link.open', { href }).catch(showError);
    }, true);
    document.addEventListener('auxclick', (e) => { if (e.target.closest && e.target.closest('a[href]')) e.preventDefault(); }, true);
  }

  // ---------------------------------------------------------------- host events

  function setupBridgeEvents() {
    bridge.on('doc.load', loadDocument);
    bridge.on('doc.saved', onSaved);
    bridge.on('recent.changed', (p) => { recent = p.recent || []; renderRecent(); });
    bridge.on('prefs.changed', (p) => { prefs = { ...prefs, ...p.prefs }; applyPrefs(); });
    bridge.on('notice', (p) => notice(p.text, p.ms || 3200));
    bridge.on('error', (p) => showError(new Error(p.text)));
    bridge.on('recovery.available', (p) => showRecovery(p.drafts));
    bridge.on('insert.text', (p) => { if (editor && typeof p.markdown === 'string') { editor.insertText(p.markdown); editor.focus(); } });
    bridge.on('command', (p) => runCommand(p.id));
  }

  // ---------------------------------------------------------------- startup

  async function start() {
    setupBridgeEvents();
    createEditor('');
    setupSidebar();
    setupFind();
    setupDropAndLinks();
    window.addEventListener('keydown', onKeyDown, true);
    document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => runCommand(b.dataset.cmd)));
    document.querySelectorAll('.pill button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('#doc-title').addEventListener('input', () => {
      if (!doc.untitled) return;
      updateCrumb();
      bridge.post('doc.state', { dirty: isDirty(), title: currentTitle() });
    });
    applyMode('wysiwyg', true);

    if (!bridge.available) {
      applyPrefs();
      loadDocument({ markdown: SAMPLE, title: 'Welcome to NoorMD' });
      showBanner('Running outside the NoorMD desktop host — files cannot be opened or saved here.', [{ label: 'Dismiss', run: hideBanner }]);
      return;
    }
    let ready;
    try {
      ready = await bridge.request('app.ready', { protocol: bridge.PROTOCOL });
    } catch (err) { showError(err); return; }
    prefs = { ...DEFAULT_PREFS, ...(ready.prefs || {}) };
    recent = ready.recent || [];
    applyPrefs();
    renderRecent();
    if (ready.document) loadDocument(ready.document);
    else {
      refreshStatsAndOutline();
      updateDocUI();
      updateDirtyUI();
      $('#welcome').classList.remove('hide');
      $('#welcome .action.primary')?.focus();
    }
    if (ready.recovery && ready.recovery.length) showRecovery(ready.recovery);
  }

  // Exposed for the host (ExecuteScriptAsync) and for automated UI tests.
  window.NoorMD = Object.freeze({
    getState,
    flush() { if (changeTimer) { clearTimeout(changeTimer); postContent(); } return getState(); },
    mode: () => mode,
    runCommand,
  });

  start();
})();
