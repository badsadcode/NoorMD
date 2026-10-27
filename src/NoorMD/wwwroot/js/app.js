// NoorMD Desktop — editor UI controller.
// The page owns the editor content and the "dirty" generation counter; the native host owns files,
// dialogs, preferences, recovery drafts and snapshots. All host calls go through NoorBridge.
(() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const bridge = NoorBridge;

  const SAMPLE = '# Welcome to NoorMD ✨\n\nA calmer place for ideas, documentation, and glorious little side projects.\n\n## Start creating\n\nWrite **bold**, *italic*, and `inline code` without thinking about Markdown syntax.\n\n- Switch between **Visual**, **Markdown**, and **Split** view (Ctrl+1/2/3).\n- Open any `.md` file with Ctrl+O, or drop it on the window.\n- Unsaved work is kept in a local recovery folder until you save.\n\n> Good ideas deserve a beautiful editor. Even the terrible ideas. Especially those.\n\n### A tiny checklist\n\n- [x] Open the writing studio\n- [ ] Write something brilliant\n- [ ] Make it real\n\n| Shortcut | Action |\n| --- | --- |\n| Ctrl+K | Command palette |\n| F11 | Focus mode |\n\n```csharp\n// And yes, your code blocks are welcome here.\nConsole.WriteLine("Hello, world!");\n```\n';

  const REPO_URL = 'https://github.com/badsadcode/NoorMD';
  const DEFAULT_PREFS = {
    theme: 'dark', fontFamily: 'inter', fontSize: 16, lineWidth: 'comfortable', openMode: 'visual',
    sidebarWidth: 256, sidebarCollapsed: false, splitRatio: 0.5, goalWords: 750, restoreSession: true,
    spellcheck: true, compact: false,
    sourceFontSize: 14, lineNumbers: true, wordWrap: true, syncScroll: false,
    showMusic: true, miniPlayer: true, musicWidth: 400,
    showToolbar: true, toolbarLabels: false, toolbarSmall: false, zenToolbar: false, toolbarGroups: 'document,writing,navigation,view,tools,media',
  };
  const FONTS = {
    inter: "'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    system: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    serif: "Charter, 'Iowan Old Style', Georgia, Cambria, 'Times New Roman', serif",
    mono: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, monospace",
  };
  const MEASURES = { comfortable: '800px', wide: '1100px', full: '100000px' };
  const WIDTH_LABELS = { comfortable: 'Comfortable', wide: 'Wide', full: 'Full width' };
  const WIDTH_ORDER = ['comfortable', 'wide', 'full'];

  let prefs = { ...DEFAULT_PREFS };
  let recent = [];
  let suppress = 0;            // >0 while the app itself changes editor content
  let statsTimer = null;

  // ---------------------------------------------------------------- tabs: one document (and one editor) per tab
  //
  // Every tab owns its own TOAST UI editor instance, created the first time the tab is shown. Undo history,
  // selection, scroll position and the dirty counter therefore belong to one document and can never leak into
  // another. Hidden tabs keep their editor in the DOM (display: none). The host addresses tabs by id: it reads a
  // tab's text with NoorMD.flush(tabId), so saving one tab can never take its text from another.

  const tabs = [];      // in tab-strip order
  let t = null;         // the tab on screen
  let editor = null;    // t.editor (kept in sync by showTab)
  let fallback = null;  // t.fallback

  function newTab(id) {
    const pane = el('div', { class: 'doc-pane', 'data-tab': id, hidden: true });
    $('#editor').append(pane);
    return {
      id, pane, editor: null, fallback: null, mounted: false, pending: null,
      mode: 'wysiwyg', gen: 0, savedGen: 0, lastPostedDirty: false, changeTimer: null,
      // The exact Markdown source as it was when Visual mode took over, and the edit generation at that moment.
      // Coming back to source without any edit in between restores this text byte-for-byte, so merely looking
      // at a document in Visual mode never rewrites its Markdown (list markers, spacing, table pipes…).
      sourceBeforeVisual: null,
      doc: { title: 'Untitled document', path: null, fileName: null, encoding: 'UTF-8', eol: 'LF', untitled: true },
      pinned: false, banner: null, scroll: [], activeLine: null,
    };
  }

  const tabById = (id) => tabs.find((x) => x.id === id) || null;

  // ---------------------------------------------------------------- editor

  const normalizeText = (s) => String(s ?? '').replace(/\r\n?/g, '\n');

  function md(tab = t) {
    if (!tab) return '';
    if (!tab.mounted) return normalizeText(tab.pending ? tab.pending.markdown : '');
    if (!tab.editor) return tab.fallback ? tab.fallback.value : '';
    // Unedited since Visual mode took over: the canonical text is still the original source.
    const sbv = tab.sourceBeforeVisual;
    if (sbv && sbv.gen === tab.gen && tab.editor.isWysiwygMode()) return sbv.text;
    return tab.editor.getMarkdown();
  }
  const isDirty = (tab = t) => !!tab && tab.gen !== tab.savedGen;

  function createEditor(tab, initialValue, initialMode) {
    if (!window.toastui || !window.toastui.Editor) {
      tab.pane.append(el('div', { class: 'editor-fallback' },
        el('p', { text: 'The visual editor failed to load. You can still edit and save plain Markdown here.' }),
        tab.fallback = el('textarea', { 'aria-label': 'Markdown source', spellcheck: 'true' })));
      tab.fallback.value = initialValue;
      tab.fallback.addEventListener('input', () => onEditorChange(tab));
      return;
    }
    tab.editor = new toastui.Editor({
      el: tab.pane,
      height: '100%',
      minHeight: '200px',
      initialEditType: initialMode === 'wysiwyg' ? 'wysiwyg' : 'markdown',
      previewStyle: initialMode === 'split' ? 'vertical' : 'tab',
      initialValue,
      usageStatistics: false,
      hideModeSwitch: true,
      frontMatter: true,
      autofocus: false,
      theme: isDarkTheme() ? 'dark' : 'light',
      toolbarItems: [], // the app's own toolbar (chrome.js) drives formatting for every tab
      events: { change: () => onEditorChange(tab) },
    });
    tab.editor.eventEmitter.listen('changeToolbarState', (p) => { if (tab === t && p && p.toolbarState) NoorChrome.setFormatState(p.toolbarState); });
    setupSplitter(tab);
    setupSourceEditor(tab);
    if (tab.editor.eventEmitter) tab.editor.eventEmitter.emit('toggleScrollSync', !!prefs.syncScroll);
  }

  function destroyEditor(tab) {
    clearTimeout(tab.changeTimer);
    tab.changeTimer = null;
    if (tab.editor || tab.fallback) retire(tab.editor, tab.pane);
    tab.editor = null;
    tab.fallback = null;
    tab.activeLine = null;
    tab.mounted = false;
    // The tab gets a fresh, empty pane; the old one stays (hidden) until its editor is gone.
    const fresh = el('div', { class: 'doc-pane', 'data-tab': tab.id, hidden: tab.pane.hidden || undefined });
    tab.pane.hidden = true;
    tab.pane.removeAttribute('data-tab');
    tab.pane.after(fresh);
    tab.pane = fresh;
    if (tab === t) { editor = null; fallback = null; }
  }

  // TOAST UI's toolbar reacts to window resizes with a 200 ms throttle and can still touch its DOM after
  // destroy(). Old editors are therefore destroyed only once resizing has been quiet for a while.
  const retired = [];
  let retireTimer = null;
  function retire(ed, pane) {
    retired.push([ed, pane]);
    scheduleRetire();
  }
  function scheduleRetire() {
    clearTimeout(retireTimer);
    retireTimer = setTimeout(() => {
      for (const [ed, pane] of retired.splice(0)) {
        try { if (ed) ed.destroy(); } catch (err) { console.error(err); }
        pane.remove();
      }
    }, 700);
  }
  window.addEventListener('resize', () => { if (retired.length) scheduleRetire(); });

  /** Runs fn while ignoring editor change events (programmatic edits are not user edits). */
  function quietly(fn) {
    suppress++;
    try { return fn(); } finally { setTimeout(() => { suppress--; }, 0); }
  }

  function onEditorChange(tab) {
    if (suppress > 0 || !tab.mounted) return;
    tab.gen++;
    afterContentChange(tab);
  }

  function afterContentChange(tab) {
    updateDirtyUI(tab);
    if (tab.lastPostedDirty !== isDirty(tab)) {
      tab.lastPostedDirty = isDirty(tab);
      bridge.post('doc.state', { tabId: tab.id, dirty: tab.lastPostedDirty, title: titleOf(tab) });
    }
    clearTimeout(tab.changeTimer);
    tab.changeTimer = setTimeout(() => postContent(tab), 600);
    if (tab !== t) return;
    clearTimeout(statsTimer);
    statsTimer = setTimeout(refreshStatsAndOutline, 220);
    clearFindHighlights();
  }

  // Recovery: the host writes a draft for this tab whenever it is dirty.
  function postContent(tab) {
    clearTimeout(tab.changeTimer);
    tab.changeTimer = null;
    if (!tabs.includes(tab)) return;
    bridge.post('doc.changed', { tabId: tab.id, markdown: md(tab), dirty: isDirty(tab), gen: tab.gen, title: titleOf(tab) });
  }

  const titleOf = (tab) => ((tab && tab.doc.title || '').trim() || 'Untitled document');
  const currentTitle = () => titleOf(t);

  /** State snapshot read synchronously by the host (ExecuteScriptAsync) before save/close/open. */
  function stateOf(tab) {
    return { tabId: tab.id, markdown: md(tab), title: titleOf(tab), dirty: isDirty(tab), gen: tab.gen, mode: tab.mode };
  }
  const getState = () => (t ? stateOf(t) : null);

  // ---------------------------------------------------------------- documents

  /** doc.load: a document for a tab. The host names the tab; a tab the page doesn't have yet is created. */
  function onDocLoad(p) {
    let tab = tabById(p.tabId);
    if (!tab) {
      tab = newTab(p.tabId || localId());
      tabs.push(tab);
      if (p.pinned) placePinned(tab);
    } else {
      destroyEditor(tab); // a fresh editor: undo history never reaches back into the previous document
    }
    tab.pending = p;
    tab.pinned = !!p.pinned;
    tab.doc = {
      path: p.path || null, fileName: p.fileName || null, untitled: !p.path, title: p.title || 'Untitled document',
      encoding: p.encoding || 'UTF-8', eol: p.eol || 'LF',
    };
    tab.mode = p.mode || (prefs.openMode === 'markdown' ? 'markdown' : 'wysiwyg');
    tab.gen = p.dirty ? 1 : 0;
    tab.savedGen = 0;
    tab.lastPostedDirty = isDirty(tab);
    tab.sourceBeforeVisual = null;
    tab.banner = null;
    tab.scroll = [];
    hideWelcome();
    renderTabs();
    if (!p.background || !wanted) showTab(tab, { focus: !p.noFocus });
    else if (tab === wanted) showTab(tab, { focus: false, force: true });
  }

  /** Creates the tab's editor from its pending document (first time it is shown, or after a reload). */
  function mountTab(tab) {
    const p = tab.pending || { markdown: '' };
    tab.pending = null;
    const text = normalizeText(p.markdown);

    // Decide the editing mode: Visual is preferred, but never at the cost of silently rewriting a file.
    let target = tab.mode || 'wysiwyg';
    let check = null;
    if (target === 'wysiwyg' && text.trim()) {
      check = NoorMarkdown.visualRoundTrip(text);
      if (!check.lossless) target = 'markdown';
    }
    // The text is the editor's initial value, so its undo history starts with this document and nothing else.
    quietly(() => {
      createEditor(tab, text, target);
      tab.mounted = true;
      if (tab === t) { editor = tab.editor; fallback = tab.fallback; }
      if (tab.editor) {
        applyMode(tab, target, true);
        if (tab.editor.isMarkdownMode()) tab.editor.setSelection([1, 1], [1, 1]);
        clearHistory(tab.editor);
      }
    });
    tab.sourceBeforeVisual = target === 'wysiwyg' ? { text, gen: tab.gen } : null;
    applySpellcheck();

    if (check && !check.lossless) {
      tab.banner = {
        text: 'This file uses Markdown the Visual editor cannot represent exactly (for example raw HTML, footnotes or hard line breaks). It opened in Markdown mode so nothing is rewritten.',
        actions: [{ label: 'Use Visual anyway', run: () => setMode('wysiwyg') }, { label: 'Dismiss', run: hideBanner }],
      };
    } else if (p.notice && tab === t) {
      notice(p.notice, 4200);
    }
    if (p.warning) tab.banner = { text: p.warning, actions: [{ label: 'Dismiss', run: hideBanner }] };
    if (p.dirty) postContent(tab);
    reportTabs();
  }

  /** The editor records loading the text as an undoable step; a freshly opened document starts with no history. */
  function clearHistory(ed) {
    for (const view of [ed.wwEditor && ed.wwEditor.view, ed.mdEditor && ed.mdEditor.view]) {
      if (!view) continue;
      try {
        const st = view.state;
        view.updateState(st.constructor.create({ doc: st.doc, selection: st.selection, plugins: st.plugins }));
      } catch (err) { console.error(err); }
    }
  }

  function scrollEditorToTop() {
    requestAnimationFrame(() => {
      t?.pane.querySelectorAll('.toastui-editor-contents, .toastui-editor-md-preview').forEach((n) => { n.scrollTop = 0; });
    });
  }

  function updateDocUI() {
    if (!t) return;
    const title = $('#doc-title');
    title.value = t.doc.title;
    title.readOnly = !t.doc.untitled;
    title.title = t.doc.untitled ? 'Document name — used as the file name when you first save' : 'Use Save As (Ctrl+Shift+S) to save under a new name';
    $('#doc-path').textContent = t.doc.path || 'Not saved yet';
    $('#doc-path').title = t.doc.path || '';
    $('#file-format').textContent = `${t.doc.encoding} · ${t.doc.eol}`;
    updateCrumb();
  }

  function updateCrumb() {
    const name = $('#crumb-name');
    name.textContent = t ? (t.doc.fileName || currentTitle()) : '';
    name.parentElement.querySelector('.dirty-dot')?.remove();
    if (isDirty()) name.after(el('span', { class: 'dirty-dot', title: 'Unsaved changes', text: '●' }));
  }

  function updateDirtyUI(tab = t) {
    if (!tab) return;
    updateTabEl(tab);
    if (tab !== t) return;
    const dirty = isDirty(tab), untitled = tab.doc.untitled;
    $('#status-dot').classList.toggle('dirty', dirty);
    $('#status-dot').classList.remove('error');
    $('#status-text').textContent = dirty ? (untitled ? 'Not saved yet · recovery draft kept locally' : 'Unsaved changes · recovery draft kept locally') : (untitled ? 'Empty draft' : 'All changes saved');
    $('#updated').textContent = dirty ? 'Edited' : (untitled ? 'Ready to write' : 'Saved');
    $('#save-btn .label').textContent = dirty ? 'Save •' : 'Save';
    updateCrumb();
    refreshChrome();
  }

  function onSaved(p) {
    const tab = tabById(p.tabId);
    if (!tab) return;
    if (typeof p.gen === 'number' && p.gen > tab.savedGen) tab.savedGen = p.gen;
    else if (typeof p.gen === 'number' && p.gen === tab.gen) tab.savedGen = tab.gen;
    if (p.path) {
      const d = tab.doc;
      d.path = p.path; d.fileName = p.fileName || d.fileName; d.untitled = false;
      d.title = p.title || d.title; d.encoding = p.encoding || d.encoding; d.eol = p.eol || d.eol;
    }
    tab.lastPostedDirty = isDirty(tab);
    if (tab === t) updateDocUI();
    updateDirtyUI(tab);
    if (isDirty(tab)) postContent(tab);
  }

  // ---------------------------------------------------------------- modes

  function applyMode(tab, m, quiet) {
    tab.mode = m;
    if (tab === t) showModeUI(m);
    const ed = tab.editor;
    if (!ed) return;
    const run = () => {
      if (m === 'wysiwyg') ed.changeMode('wysiwyg', true);
      else { ed.changeMode('markdown', true); ed.changePreviewStyle(m === 'split' ? 'vertical' : 'tab'); }
    };
    if (quiet) run(); else quietly(run);
    applySpellcheck();
    if (tab === t) { requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); refreshChrome(); }
  }

  function showModeUI(m) {
    const host = $('#editor');
    host.classList.remove('mode-visual', 'mode-markdown', 'mode-split');
    host.classList.add('mode-' + (m === 'wysiwyg' ? 'visual' : m));
    document.querySelectorAll('.pill button').forEach((b) => {
      const on = b.dataset.mode === m;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  async function setMode(m) {
    const tab = t;
    if (!tab) return;
    if (!tab.editor) { notice('Visual editing is unavailable because the editor failed to load.'); return; }
    if (m === tab.mode) return;
    if (m === 'wysiwyg') {
      const text = md(tab);
      const check = NoorMarkdown.visualRoundTrip(text);
      if (!check.lossless) {
        const choice = await NoorUI.choose('Switch to Visual mode?', [
          'Visual mode cannot represent some of this Markdown exactly — raw HTML, footnotes, hard line breaks or other unsupported syntax would be rewritten or dropped.',
          'A revision snapshot of the current text is saved first, so you can restore it from Revision snapshots.',
        ], [{ label: 'Stay in Markdown', value: 'stay', primary: true }, { label: 'Switch anyway', value: 'switch' }]);
        if (choice !== 'switch' || tab !== t) return;
        await createSnapshot('Before switching to Visual', true);
        tab.sourceBeforeVisual = null;
        applyMode(tab, 'wysiwyg');
        hideBanner();
        tab.gen++;
        afterContentChange(tab);
        reportTabs();
        return;
      }
    }
    const leavingVisual = tab.mode === 'wysiwyg' && m !== 'wysiwyg';
    if (m === 'wysiwyg' && tab.mode !== 'wysiwyg') tab.sourceBeforeVisual = { text: md(tab), gen: tab.gen };
    applyMode(tab, m);
    if (leavingVisual) restoreSourceIfUnedited(tab);
    refreshOutline();
    reportTabs();
  }

  function restoreSourceIfUnedited(tab) {
    const sbv = tab.sourceBeforeVisual;
    if (!sbv || sbv.gen !== tab.gen || !tab.editor) return;
    if (md(tab) === sbv.text) return;
    quietly(() => {
      tab.editor.setMarkdown(sbv.text, false);
      tab.editor.setSelection([1, 1], [1, 1]);
    });
    scrollEditorToTop();
  }

  // ---------------------------------------------------------------- split divider

  function setupSplitter(tab) {
    const splitter = tab.pane.querySelector('.toastui-editor-md-splitter');
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
      const move = (ev) => applySidebarWidth(document.body.classList.contains('sidebar-right') ? window.innerWidth - ev.clientX : ev.clientX);
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
    if (!themes().some((t) => t.id === prefs.theme)) prefs.theme = 'dark';
    root.dataset.theme = prefs.theme;
    root.style.background = '';
    document.querySelectorAll('#editor .toastui-editor-defaultUI').forEach((ui) => ui.classList.toggle('toastui-editor-dark', isDarkTheme()));
    root.style.setProperty('--doc-font', FONTS[prefs.fontFamily] || FONTS.inter);
    root.style.setProperty('--doc-size', Math.min(26, Math.max(12, Number(prefs.fontSize) || 16)) + 'px');
    root.style.setProperty('--measure', MEASURES[prefs.lineWidth] || MEASURES.comfortable);
    document.body.dataset.width = WIDTH_ORDER.includes(prefs.lineWidth) ? prefs.lineWidth : 'comfortable';
    if (window.NoorChrome && chromeReady) NoorChrome.applyPrefs(prefs);
    const widthBtn = $('#width-toggle');
    if (widthBtn) {
      widthBtn.querySelector('.tb-label').textContent = WIDTH_LABELS[document.body.dataset.width];
      widthBtn.title = `Line width: ${WIDTH_LABELS[document.body.dataset.width]} — click to change (Ctrl+Shift+W)`;
    }
    document.body.classList.toggle('compact', !!prefs.compact);
    root.style.setProperty('--source-size', Math.min(22, Math.max(11, Number(prefs.sourceFontSize) || 14)) + 'px');
    document.body.classList.toggle('source-line-numbers', prefs.lineNumbers !== false);
    document.body.classList.toggle('source-nowrap', prefs.wordWrap === false);
    applyScrollSync();
    if (window.NoorMusic) NoorMusic.applyVisibility();
    requestAnimationFrame(updateActiveLine);
    document.querySelectorAll('[data-cmd="layout.compact"]').forEach((b) => { b.classList.toggle('selected', !!prefs.compact); b.setAttribute('aria-pressed', String(!!prefs.compact)); });
    applySpellcheck();
    applySidebarWidth(prefs.sidebarWidth);
    document.body.classList.toggle('sidebar-collapsed', !!prefs.sidebarCollapsed);
    setSplit(prefs.splitRatio, false);
    progress();
    refreshChrome();
  }

  function setPrefs(partial) {
    prefs = { ...prefs, ...partial };
    applyPrefs();
    bridge.post('prefs.set', partial);
  }

  // Themes are defined only in css/themes.css; each rule carries its own --theme-label and --theme-scheme.
  let themeCache = null;
  function themes() {
    if (themeCache) return themeCache;
    const found = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        const m = r.selectorText && r.selectorText.match(/\[data-theme=["']?([a-z]+)["']?\]/);
        if (!m || found.some((t) => t.id === m[1])) continue;
        const v = (name) => r.style.getPropertyValue(name).trim();
        found.push({ id: m[1], label: v('--theme-label').replace(/^"|"$/g, '') || m[1], dark: v('--theme-scheme') !== 'light',
          bg: v('--bg'), panel: v('--panel'), surface2: v('--surface2'), text: v('--text'), muted: v('--muted'), accent: v('--accent'), border: v('--border') });
      }
    }
    if (found.length) themeCache = found;
    return found.length ? found : [{ id: 'dark', label: 'Atelier Dark', dark: true }];
  }
  const isDarkTheme = () => (themes().find((t) => t.id === prefs.theme) || { dark: true }).dark;

  function setTheme(id) {
    const t = themes().find((x) => x.id === id);
    if (!t) return;
    setPrefs({ theme: id });
    notice('Theme: ' + t.label, 1400);
  }
  function toggleTheme() { setTheme(isDarkTheme() ? 'light' : 'dark'); }
  function nextTheme() {
    const list = themes();
    const i = list.findIndex((t) => t.id === prefs.theme);
    setTheme(list[(i + 1) % list.length].id);
  }

  function showThemePicker() {
    NoorUI.closeAll();
    // Closing (with or without a choice) re-applies the saved theme, which undoes any hover preview.
    NoorUI.modal({ label: 'Choose a theme', width: 760, onClose: () => { document.documentElement.dataset.theme = prefs.theme; } }, (s, close) => {
      const grid = el('div', { class: 'theme-grid', role: 'listbox', 'aria-label': 'Themes' });
      for (const t of themes()) {
        const card = el('button', {
          class: 'theme-card' + (t.id === prefs.theme ? ' selected' : ''), role: 'option', 'aria-selected': String(t.id === prefs.theme), 'data-theme-id': t.id,
          style: `--c-bg:${t.bg};--c-panel:${t.panel};--c-s2:${t.surface2};--c-text:${t.text};--c-muted:${t.muted};--c-accent:${t.accent};--c-border:${t.border}`,
          onclick: () => { setTheme(t.id); close(); },
          onmouseenter: () => { document.documentElement.dataset.theme = t.id; },
          onfocus: () => { document.documentElement.dataset.theme = t.id; },
        },
        el('span', { class: 'theme-swatch', 'aria-hidden': 'true' },
          el('i', { class: 'sw-side' }), el('i', { class: 'sw-title' }), el('i', { class: 'sw-line' }), el('i', { class: 'sw-line short' }), el('i', { class: 'sw-chip' })),
        el('span', { class: 'theme-name', text: t.label }),
        el('small', { text: t.dark ? 'Dark' : 'Light' }));
        grid.append(card);
      }
      grid.addEventListener('mouseleave', () => { document.documentElement.dataset.theme = prefs.theme; });
      s.append(NoorUI.head('Choose a theme', close), el('div', { class: 'modal-body' }, grid),
        el('div', { class: 'modal-foot' }, el('span', { text: 'Hover or Tab to preview · Enter or click to apply · Ctrl+Shift+T cycles themes' })));
    });
    setTimeout(() => document.querySelector('.theme-card.selected')?.focus(), 0);
  }


  function setLineWidth(w) {
    setPrefs({ lineWidth: w });
    notice('Line width: ' + WIDTH_LABELS[w], 1400);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  function cycleLineWidth() {
    const i = WIDTH_ORDER.indexOf(prefs.lineWidth);
    setLineWidth(WIDTH_ORDER[(i + 1) % WIDTH_ORDER.length]);
  }

  // Spellcheck uses the Windows spell checker (languages installed in Windows settings). Turning it off sets
  // spellcheck="false" on every editing surface and hides any markers already drawn; the text is untouched.
  function applySpellcheck() {
    const on = prefs.spellcheck !== false;
    document.body.classList.toggle('no-spellcheck', !on);
    document.querySelectorAll('#editor [contenteditable="true"], #doc-title, .editor-fallback textarea')
      .forEach((n) => n.setAttribute('spellcheck', on ? 'true' : 'false'));
  }
  function toggleSpellcheck() {
    setPrefs({ spellcheck: prefs.spellcheck === false });
    notice(prefs.spellcheck ? 'Spellcheck on' : 'Spellcheck off', 1400);
  }

  // ---- Markdown source editor (TOAST UI markdown mode = ProseMirror, one <div> per source line)

  function setupSourceEditor(tab) {
    const wrapper = tab.pane.querySelector('.toastui-editor-md-container > .toastui-editor');
    const pm = wrapper && wrapper.querySelector('.ProseMirror');
    if (!pm) return;
    tab.activeLine = el('div', { class: 'noor-active-line', 'aria-hidden': 'true' });
    wrapper.prepend(tab.activeLine); // a sibling of ProseMirror's DOM, never inside it
    pm.addEventListener('scroll', updateActiveLine, { passive: true });
  }

  function updateActiveLine() {
    const activeLine = t && t.activeLine;
    if (!activeLine || !editor || editor.isWysiwygMode()) return;
    const sel = window.getSelection();
    const pm = activeLine.parentElement.querySelector('.ProseMirror');
    if (!sel || !sel.rangeCount || !pm.contains(sel.anchorNode)) { activeLine.style.top = '-9999px'; return; }
    let node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    while (node && node.parentElement !== pm) node = node.parentElement;
    if (!node) return;
    const r = node.getBoundingClientRect(), w = activeLine.parentElement.getBoundingClientRect();
    activeLine.style.top = (r.top - w.top) + 'px';
    activeLine.style.height = r.height + 'px';
  }

  // Split view scrolls the two panes independently unless the user turns synchronised scrolling on.
  function applyScrollSync() {
    for (const tab of tabs) if (tab.editor && tab.editor.eventEmitter) tab.editor.eventEmitter.emit('toggleScrollSync', !!prefs.syncScroll);
  }

  function toggleSourcePref(key, label) {
    setPrefs({ [key]: !(prefs[key] !== false) });
    notice(`${label} ${prefs[key] ? 'on' : 'off'}`, 1400);
  }

  function setHeading(level) {
    if (!editor) return;
    if (level === 0) editor.exec('heading', { level: 0 }); // TOAST: level 0 = paragraph in Visual mode
    else editor.exec('heading', { level });
    editor.focus();
  }

  async function insertLink() {
    if (!editor) return;
    const text = editor.getSelectedText ? editor.getSelectedText() : '';
    const url = await NoorUI.prompt('Insert link', 'Link address (https://…, mailto:… or a relative .md path):', '', { okLabel: 'Insert' });
    if (!url) { editor.focus(); return; }
    editor.focus();
    editor.exec('addLink', { linkUrl: url.trim(), linkText: text || url.trim() });
  }

  async function copySource() {
    const text = md();
    try {
      await bridge.request('clipboard.copyText', { text });
      notice('Markdown source copied (' + text.length.toLocaleString() + ' characters)', 2000);
    } catch (err) {
      try { await navigator.clipboard.writeText(text); notice('Markdown source copied', 2000); } catch { showError(err); }
    }
  }

  function toggleCompact() {
    setPrefs({ compact: !prefs.compact });
    notice(prefs.compact ? 'Compact layout' : 'Standard layout', 1400);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
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
      const srcSize = el('input', { type: 'range', min: '11', max: '22', step: '1', value: String(prefs.sourceFontSize), id: 'pref-src-size', 'aria-label': 'Markdown source text size' });
      const srcSizeLabel = el('span', { text: prefs.sourceFontSize + ' px' });
      srcSize.addEventListener('input', () => { srcSizeLabel.textContent = srcSize.value + ' px'; setPrefs({ sourceFontSize: Number(srcSize.value) }); });
      const checkbox = (key, id) => {
        const c = el('input', { type: 'checkbox', id, checked: (key === 'syncScroll' ? !!prefs[key] : prefs[key] !== false) || undefined });
        c.addEventListener('change', () => setPrefs({ [key]: c.checked }));
        return c;
      };
      const lineNums = checkbox('lineNumbers', 'pref-line-numbers');
      const musicOn = checkbox('showMusic', 'pref-music');
      const miniOn = checkbox('miniPlayer', 'pref-mini');
      const wrap = checkbox('wordWrap', 'pref-wrap');
      const sync = checkbox('syncScroll', 'pref-sync');
      const compact = el('input', { type: 'checkbox', id: 'pref-compact', checked: prefs.compact || undefined });
      compact.addEventListener('change', () => setPrefs({ compact: compact.checked }));
      const spell = el('input', { type: 'checkbox', id: 'pref-spellcheck', checked: prefs.spellcheck !== false || undefined });
      spell.addEventListener('change', () => setPrefs({ spellcheck: spell.checked }));
      const restore = el('input', { type: 'checkbox', id: 'pref-restore', checked: prefs.restoreSession || undefined });
      restore.addEventListener('change', () => setPrefs({ restoreSession: restore.checked }));
      s.append(NoorUI.head('Preferences', close), el('div', { class: 'modal-body' },
        el('div', { class: 'pref-grid' },
          el('label', { for: 'pref-theme', text: 'Theme' }), select('theme', themes().map((t) => [t.id, t.label + (t.dark ? ' (dark)' : ' (light)')])),
          el('label', { for: 'pref-fontFamily', text: 'Writing font' }), select('fontFamily', [['inter', 'Inter (bundled)'], ['system', 'Segoe UI'], ['serif', 'Serif'], ['mono', 'Monospace']]),
          el('label', { for: 'pref-size', text: 'Text size' }), el('div', { class: 'inline' }, size, sizeLabel),
          el('label', { for: 'pref-src-size', text: 'Markdown source' }), el('div', {},
            el('div', { class: 'inline' }, srcSize, srcSizeLabel),
            el('label', { class: 'inline' }, lineNums, 'Line numbers'),
            el('label', { class: 'inline' }, wrap, 'Wrap long lines'),
            el('label', { class: 'inline' }, sync, 'Synchronise scrolling in Split view')),
          el('label', { for: 'pref-lineWidth', text: 'Line width' }), select('lineWidth', [['comfortable', 'Comfortable (≈ 800 px)'], ['wide', 'Wide (≈ 1100 px)'], ['full', 'Full width']]),
          el('label', { for: 'pref-compact', text: 'Layout' }), el('label', { class: 'inline' }, compact, 'Compact (smaller header, more room to write)'),
          el('label', { for: 'pref-spellcheck', text: 'Spellcheck' }), el('div', {}, el('label', { class: 'inline' }, spell, 'Underline misspelled words'),
            el('small', { class: 'pref-hint', text: 'Uses the Windows spell checker: languages follow Windows Settings → Time & language → Language (add Polish there to check Polish). Right-click a word → “Add to dictionary” for project terms.' })),
          el('label', { for: 'pref-openMode', text: 'Open files in' }), select('openMode', [['visual', 'Visual editor (Markdown mode if it would rewrite the file)'], ['markdown', 'Markdown source']]),
          el('label', { for: 'pref-music', text: 'Music Bench' }), el('div', {},
            el('label', { class: 'inline' }, musicOn, 'Show the Music Bench (turning it off also stops playback)'),
            el('label', { class: 'inline' }, miniOn, 'Show the mini-player while music is loaded')),
          el('label', { for: 'pref-restore', text: 'On startup' }), el('label', { class: 'inline' }, restore, 'Reopen the tabs from last time'),
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
    if (!await NoorUI.confirm('Delete all recovery drafts?', ['Recovery drafts hold unsaved work from previous sessions. Deleting them cannot be undone.', 'Drafts for the documents open in this window are kept.'], 'Delete drafts')) return;
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

  // The banner belongs to a document (e.g. "opened in Markdown mode so nothing is rewritten") and comes back with its tab.
  function showBanner(text, actions) {
    if (t) t.banner = { text, actions };
    renderBanner();
  }
  function hideBanner() {
    if (t) t.banner = null;
    renderBanner();
  }
  function renderBanner() {
    const b = t && t.banner;
    $('#banner').classList.toggle('hide', !b);
    if (!b) return;
    $('#banner-text').textContent = b.text;
    $('#banner-actions').replaceChildren(...b.actions.map((a) => el('button', { class: 'utility-btn', onclick: a.run }, a.label)));
  }

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

  /**
   * Find in all open documents (the Markdown of every tab, including unsaved edits and tabs not shown yet).
   * Matching works like the find bar (ignores case unless asked), so a result can be jumped to with it:
   * `n` is the occurrence's position among the document's matches.
   */
  function searchOpenTabs(query, { matchCase = false, wholeWord = false } = {}) {
    if (!query) return [];
    const needle = matchCase ? query : query.toLocaleLowerCase();
    const isWord = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
    const out = [];
    for (const tab of tabs) {
      const lines = md(tab).split('\n');
      const hits = [];
      let n = 0;
      lines.forEach((line, li) => {
        const hay = matchCase ? line : line.toLocaleLowerCase();
        let i = hay.indexOf(needle);
        while (i !== -1) {
          const whole = !wholeWord || (!isWord(line[i - 1]) && !isWord(line[i + needle.length]));
          if (whole && hits.length < 500) hits.push({ line: li + 1, text: line.length > 300 ? line.slice(Math.max(0, i - 80), i + 220) : line, start: line.length > 300 ? Math.min(80, i) : i, length: needle.length, n });
          n++;
          i = hay.indexOf(needle, i + Math.max(1, needle.length));
        }
      });
      if (hits.length) out.push({ tabId: tab.id, name: tab.doc.fileName || titleOf(tab), file: tab.doc.fileName || titleOf(tab), path: tab.doc.path, dirty: isDirty(tab), active: tab === t, hits });
    }
    return out;
  }

  /** Shows a tab and selects the n-th occurrence of the query in it (as counted by searchOpenTabs). */
  async function revealMatch(tabId, query, n, matchCase) {
    const tab = tabById(tabId);
    if (!tab) return;
    if (tab !== t) showTab(tab);
    await switching;
    if (!editor) return;
    showFind(false);
    $('#find-input').value = query;
    $('#find-case').checked = !!matchCase;
    matches = collectMatches(query, !!matchCase);
    if (!matches.length) { current = -1; $('#find-count').textContent = 'No results'; return; }
    current = Math.min(Math.max(0, n), matches.length - 1); // Visual mode can show fewer matches than the source has
    highlightMatches();
    $('#find-count').textContent = `${current + 1} of ${matches.length}`;
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
      await bridge.request('snapshots.create', { tabId: t.id, label: label || 'Manual snapshot' });
      if (!quiet) notice('Snapshot saved ✓');
    } catch (err) { showError(err); }
  }

  async function showHistory() {
    const tab = t;
    let list = [];
    try { list = await bridge.request('snapshots.list', { tabId: tab.id }) || []; } catch (err) { showError(err); return; }
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
              el('button', { class: 'utility-btn', onclick: () => previewSnapshot(tab, item.id) }, 'Preview'),
              el('button', { class: 'utility-btn', onclick: async () => { if (await restoreSnapshot(tab, item)) close(); } }, 'Restore'),
              el('button', { class: 'utility-btn danger', 'aria-label': 'Delete snapshot', onclick: async () => {
                if (!await NoorUI.confirm('Delete snapshot?', 'This snapshot will be permanently removed.', 'Delete')) return;
                try { await bridge.request('snapshots.delete', { tabId: tab.id, id: item.id }); list = list.filter((x) => x.id !== item.id); render(); } catch (err) { showError(err); }
              } }, '✕'))));
        }
      };
      render();
      s.append(NoorUI.head('◷ Revision snapshots — ' + titleOf(tab), close), body,
        el('div', { class: 'modal-foot' },
          el('span', { text: 'Stored in your Windows profile (%LOCALAPPDATA%\\NoorMD\\Snapshots) and kept across restarts.' }),
          el('div', { class: 'modal-buttons' }, el('button', { class: 'action primary', onclick: async () => { if (tab !== t) return; await createSnapshot(); list = await bridge.request('snapshots.list', { tabId: tab.id }) || []; render(); } }, 'Snapshot now'))));
    });
  }

  async function previewSnapshot(tab, id) {
    let snap;
    try { snap = await bridge.request('snapshots.get', { tabId: tab.id, id }); } catch (err) { showError(err); return; }
    NoorUI.modal({ label: 'Snapshot preview', width: 760 }, (s, close) => {
      s.append(NoorUI.head(snap.label || 'Snapshot', close),
        el('div', { class: 'modal-body' }, el('div', { class: 'snapshot-preview', text: snap.markdown })),
        el('div', { class: 'modal-foot' }, el('span', { text: new Date(snap.createdUtc).toLocaleString() }),
          el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => close() }, 'Close'))));
    });
  }

  async function restoreSnapshot(tab, item) {
    if (tab !== t || !tab.mounted) { notice('Switch to “' + titleOf(tab) + '” to restore its snapshots.'); return false; }
    const ok = await NoorUI.confirm('Restore this snapshot?', [
      `The editor content will be replaced with the snapshot from ${new Date(item.createdUtc).toLocaleString()}.`,
      'Your current text is saved as a new snapshot first, and the file on disk is not changed until you save.',
    ], 'Restore');
    if (!ok) return false;
    try {
      await createSnapshot('Before restoring a snapshot', true);
      const snap = await bridge.request('snapshots.get', { tabId: tab.id, id: item.id });
      if (!tabs.includes(tab)) return false;
      quietly(() => {
        if (tab.editor) tab.editor.setMarkdown(normalizeText(snap.markdown), false); else tab.fallback.value = snap.markdown;
      });
      tab.gen++;
      afterContentChange(tab);
      postContent(tab);
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
      const r = await bridge.request('export.html', { tabId: t.id, title: currentTitle(), bodyHtml: prepareRender() });
      if (r && r.path) notice('HTML exported to ' + r.path, 4000);
    } catch (err) { showError(err); }
  }

  async function exportPdf() {
    prepareRender();
    try {
      const r = await bridge.request('export.pdf', { tabId: t.id, title: currentTitle() });
      if (r && r.path) notice('PDF saved to ' + r.path, 4000);
    } catch (err) { showError(err); }
  }

  function print() {
    prepareRender();
    bridge.request('print').catch(showError);
  }

  // ---------------------------------------------------------------- command palette

  const COMMANDS = [
    ['doc.new', 'New document', 'Document', 'Ctrl+N', () => newDocument()],
    ['tab.new', 'New tab', 'Tabs', 'Ctrl+T', () => newDocument()],
    ['doc.open', 'Open files in tabs…', 'Document', 'Ctrl+O', () => bridge.request('doc.open').catch(showError)],
    ['doc.save', 'Save', 'Document', 'Ctrl+S', () => save('doc.save')],
    ['doc.saveAs', 'Save as…', 'Document', 'Ctrl+Shift+S', () => save('doc.saveAs')],
    ['doc.saveAll', 'Save all', 'Document', '', saveAll],
    ['doc.reveal', 'Show file in Explorer', 'Document', '', () => bridge.request('doc.reveal', { tabId: t.id }).catch(showError)],
    ['app.newWindow', 'New window', 'Document', '', () => bridge.request('app.newWindow').catch(showError)],
    ['doc.reload', 'Reload from disk', 'Document', '', () => bridge.request('doc.reload', { tabId: t.id }).catch(showError)],
    ['doc.sample', 'Open the sample document', 'Document', '', () => newDocument({ markdown: SAMPLE, title: 'Welcome to NoorMD' })],
    ['tab.close', 'Close tab', 'Tabs', 'Ctrl+W', () => closeTab(t)],
    ['tab.next', 'Next tab', 'Tabs', 'Ctrl+Tab', () => cycleTab(1)],
    ['tab.prev', 'Previous tab', 'Tabs', 'Ctrl+Shift+Tab', () => cycleTab(-1)],
    ['tab.switch', 'Go to open document…', 'Tabs', 'Ctrl+E', showSwitcher],
    ['tab.closeOthers', 'Close other tabs', 'Tabs', '', () => closeOthers()],
    ['tab.closeRight', 'Close tabs to the right', 'Tabs', '', () => closeToRight()],
    ['tab.pin', 'Pin / unpin tab', 'Tabs', '', () => togglePin()],
    ['tab.copyPath', 'Copy file path', 'Tabs', '', () => copyPath()],
    ['recovery.show', 'Recover unsaved drafts…', 'Document', '', () => showRecovery()],
    ['export.markdown', 'Export Markdown copy…', 'Export', '', () => bridge.request('export.markdown', { tabId: t.id }).catch(showError)],
    ['export.html', 'Export HTML…', 'Export', '', exportHtml],
    ['export.pdf', 'Export PDF…', 'Export', '', exportPdf],
    ['print', 'Print…', 'Export', 'Ctrl+P', print],
    ['view.visual', 'Visual editor', 'View', 'Ctrl+1', () => setMode('wysiwyg')],
    ['view.markdown', 'Markdown source', 'View', 'Ctrl+2', () => setMode('markdown')],
    ['view.split', 'Split view', 'View', 'Ctrl+3', () => setMode('split')],
    ['view.focus', 'Toggle focus mode', 'View', 'F11', () => toggleZen()],
    ['view.sidebar', 'Toggle sidebar', 'View', 'Ctrl+\\', () => toggleSidebar()],
    ['view.sidebarRight', 'Sidebar on the right', 'View', '', () => NoorDock.setSidebar(document.body.classList.contains('sidebar-right') ? 'left' : 'right')],
    ['layout.show', 'Layouts…', 'View', '', () => NoorDock.showLayouts()],
    ['layout.save', 'Save current layout…', 'View', '', () => NoorDock.saveAs()],
    ['layout.reset', 'Reset layout (classic)', 'View', '', () => NoorDock.applyPreset('classic')],
    ['theme.pick', 'Choose theme…', 'View', '', showThemePicker],
    ['theme.next', 'Next theme', 'View', 'Ctrl+Shift+T', nextTheme],
    ['theme.toggle', 'Switch between Atelier Dark and Atelier Light', 'View', '', toggleTheme],
    ['width.cycle', 'Line width: next preset', 'View', 'Ctrl+Shift+W', cycleLineWidth],
    ['width.comfortable', 'Line width: Comfortable', 'View', '', () => setLineWidth('comfortable')],
    ['width.wide', 'Line width: Wide', 'View', '', () => setLineWidth('wide')],
    ['width.full', 'Line width: Full width', 'View', '', () => setLineWidth('full')],
    ['layout.compact', 'Toggle compact layout', 'View', 'Ctrl+Shift+L', toggleCompact],
    ['spell.toggle', 'Toggle spellcheck', 'Edit', 'Ctrl+Shift+Y', toggleSpellcheck],
    ['source.copy', 'Copy Markdown source', 'Edit', '', copySource],
    ['insert.link', 'Insert link…', 'Edit', 'Ctrl+Shift+K', insertLink],
    ['insert.codeblock', 'Insert code block', 'Edit', 'Ctrl+Shift+C', () => { editor?.exec('codeBlock'); editor?.focus(); }],
    ['heading.0', 'Normal text', 'Format', '', () => setHeading(0)],
    ['heading.1', 'Heading 1', 'Edit', 'Ctrl+Shift+1', () => setHeading(1)],
    ['heading.2', 'Heading 2', 'Edit', 'Ctrl+Shift+2', () => setHeading(2)],
    ['heading.3', 'Heading 3', 'Edit', 'Ctrl+Shift+3', () => setHeading(3)],
    ['heading.4', 'Heading 4', 'Edit', 'Ctrl+Shift+4', () => setHeading(4)],
    ['heading.5', 'Heading 5', 'Edit', 'Ctrl+Shift+5', () => setHeading(5)],
    ['heading.6', 'Heading 6', 'Edit', 'Ctrl+Shift+6', () => setHeading(6)],
    ['source.lineNumbers', 'Toggle line numbers (Markdown source)', 'View', '', () => toggleSourcePref('lineNumbers', 'Line numbers')],
    ['source.wrap', 'Toggle word wrap (Markdown source)', 'View', '', () => toggleSourcePref('wordWrap', 'Word wrap')],
    ['source.sync', 'Toggle synchronised scrolling (Split)', 'View', '', () => { setPrefs({ syncScroll: !prefs.syncScroll }); notice('Synchronised scrolling ' + (prefs.syncScroll ? 'on' : 'off'), 1400); }],
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
    ['music.toggle', 'Music Bench', 'Music', 'Ctrl+Shift+M', () => NoorMusic.togglePanel()],
    ['video.toggle', 'Video Bench', 'Video', 'Ctrl+Alt+V', () => NoorVideo.toggle()],
    ['video.addFolder', 'Add a video folder…', 'Video', '', () => NoorVideo.addFolder()],
    ['stream.toggle', 'Stream Desk (OBS overlays, credits, stream log)', 'Stream', 'Ctrl+Alt+B', () => NoorStream.toggle()],
    ['stream.nowplaying', 'Now Playing overlay…', 'Stream', '', () => NoorStream.open('np')],
    ['stream.credits', 'Credits roll…', 'Stream', '', () => NoorStream.open('credits')],
    ['stream.supporters', 'Supporters…', 'Stream', '', () => NoorStream.open('supporters')],
    ['stream.log', 'Stream log…', 'Stream', '', () => NoorStream.open('log')],
    ['mic.toggle', 'Mute / unmute microphone (Mic Guard)', 'Stream', '', () => NoorStream.toggleMic()],
    ['mic.settings', 'Mic Guard: microphone, OBS, hotkey, indicator…', 'Stream', '', () => NoorStream.open('mic')],
    ['music.play', 'Play / pause music', 'Music', 'Ctrl+Alt+Space', () => NoorMusic.toggle()],
    ['music.next', 'Next track', 'Music', 'Ctrl+Alt+→', () => NoorMusic.next()],
    ['music.prev', 'Previous track', 'Music', 'Ctrl+Alt+←', () => NoorMusic.prev()],
    ['music.edit', 'Edit current track', 'Music', 'F2', () => NoorMusic.editCurrent()],
    ['music.fav', 'Mark current track: Favorite', 'Music', 'Alt+1', () => NoorMusic.triageCurrent(1)],
    ['music.keep', 'Mark current track: Keep', 'Music', 'Alt+2', () => NoorMusic.triageCurrent(2)],
    ['music.maybe', 'Mark current track: Maybe', 'Music', 'Alt+3', () => NoorMusic.triageCurrent(3)],
    ['music.skip', 'Mark current track: Skip', 'Music', 'Alt+4', () => NoorMusic.triageCurrent(4)],
    ['music.clearTriage', 'Clear triage of current track', 'Music', 'Alt+0', () => NoorMusic.triageCurrent(0)],
    ['music.shuffle', 'Shuffle', 'Music', '', () => NoorMusic.setShuffle()],
    ['music.random', 'Jump to a random track', 'Music', 'Ctrl+Alt+R', () => NoorMusic.playRandom()],
    ['music.repeat', 'Cycle repeat (off / all / one)', 'Music', '', () => NoorMusic.cycleRepeat()],
    ['music.batch', 'Batch Organizer (selected tracks)…', 'Music', '', () => NoorMusic.batchSelected()],
    ['music.sound', 'Sound: equalizer and loudness…', 'Music', '', () => NoorMusic.openSound()],
    ['music.smart', 'New smart collection…', 'Music', '', () => NoorMusic.editSmart(null)],
    ['music.undo', 'Undo last track edit', 'Music', '', () => NoorMusic.undoLastEdit()],
    ['music.addFolder', 'Add music folder…', 'Music', '', () => NoorMusic.addFolder()],
    ['music.folders', 'Music folders…', 'Music', '', () => NoorMusic.showFolders()],
    ['music.import', 'Import playlist (.m3u / .m3u8)…', 'Music', '', () => NoorMusic.importPlaylist()],
    ['music.mini', 'Show / hide mini-player', 'Music', '', () => { setPrefs({ miniPlayer: prefs.miniPlayer === false }); }],
    ['help.repo', 'Open the NoorMD repository (GitHub)', 'App', '', () => bridge.request('link.open', { href: REPO_URL }).catch(showError)],
    ['palette.show', 'Command palette', 'App', 'Ctrl+K', showPalette],
    ['vault.open', 'Open folder as Vault…', 'Vault', '', () => bridge.request('vault.open').catch(showError)],
    ['vault.create', 'Create new Vault…', 'Vault', '', () => NoorVault.createVault()],
    ['vault.addPreset', 'Add folders from a preset…', 'Vault', '', () => NoorVault.addPreset()],
    ['vault.close', 'Close Vault', 'Vault', '', () => bridge.request('vault.close').catch(showError)],
    ['vault.reveal', 'Show Vault in Explorer', 'Vault', '', () => bridge.request('vault.reveal').catch(showError)],
    ['vault.explorer', 'Vault explorer', 'Vault', 'Ctrl+Shift+E', () => NoorVault.focusExplorer()],
    ['vault.search', 'Find in files (open documents or Vault)…', 'Edit', 'Ctrl+Shift+F', () => NoorVault.showSearch()],
    ['vault.tags', 'Tags in this Vault', 'Vault', '', () => { document.body.classList.remove('sidebar-collapsed'); NoorVault.setView('tags'); }],
    ['vault.backlinks', 'Show notes linking here', 'Vault', '', () => { NoorVault.setView('doc'); document.body.classList.remove('sidebar-collapsed'); $('#backlinks-section')?.scrollIntoView({ block: 'nearest' }); NoorVault.refreshBacklinks(); }],
    ['vault.refresh', 'Refresh Vault', 'Vault', '', () => bridge.request('vault.refresh').catch(showError)],
    ['vault.settings', 'Vault settings…', 'Vault', '', () => NoorVault.showSettings()],
    ['vault.insertLink', 'Link to a note…', 'Vault', '', () => NoorVault.pickNoteToLink()],
    ['sketch.new', 'NoorSketch: new sketch', 'Tools', '', () => bridge.request('sketch.new').catch(showError)],
    ['sketch.open', 'NoorSketch: open sketch…', 'Tools', '', () => bridge.request('sketch.open').catch(showError)],
    ['vault.pack', 'Pack & Share…', 'Vault', '', () => NoorVault.showPack(document.body.classList.contains('side-files') ? NoorVault.selection() : [])],
    ['vault.followLink', 'Follow link at cursor', 'Vault', 'Ctrl+Click', () => NoorVault.followLink()],
    ['edit.undo', 'Undo', 'Edit', 'Ctrl+Z', () => fmt('undo')],
    ['edit.redo', 'Redo', 'Edit', 'Ctrl+Y', () => fmt('redo')],
    ['edit.cut', 'Cut', 'Edit', 'Ctrl+X', () => clipboardCut()],
    ['edit.copy', 'Copy', 'Edit', 'Ctrl+C', () => clipboardCopy()],
    ['edit.paste', 'Paste as plain text', 'Edit', 'Ctrl+Shift+V', () => clipboardPaste()],
    ['edit.selectAll', 'Select all', 'Edit', 'Ctrl+A', selectAll],
    ['fmt.bold', 'Bold', 'Format', 'Ctrl+B', () => fmt('bold')],
    ['fmt.italic', 'Italic', 'Format', 'Ctrl+I', () => fmt('italic')],
    ['fmt.strike', 'Strikethrough', 'Format', '', () => fmt('strike')],
    ['fmt.code', 'Inline code', 'Format', '', () => fmt('code')],
    ['fmt.quote', 'Quote', 'Format', '', () => fmt('blockQuote')],
    ['fmt.ul', 'Bulleted list', 'Format', '', () => fmt('bulletList')],
    ['fmt.ol', 'Numbered list', 'Format', '', () => fmt('orderedList')],
    ['fmt.task', 'Checklist', 'Format', '', () => fmt('taskList')],
    ['fmt.indent', 'Indent list item', 'Format', '', () => fmt('indent')],
    ['fmt.outdent', 'Outdent list item', 'Format', '', () => fmt('outdent')],
    ['insert.image', 'Insert image…', 'Edit', '', insertImage],
    ['insert.table', 'Insert table…', 'Edit', '', insertTable],
    ['insert.hr', 'Insert horizontal rule', 'Edit', '', () => fmt('hr')],
    ['view.toolbar', 'Show toolbar', 'View', '', () => setPrefs({ showToolbar: prefs.showToolbar === false })],
    ['toolbar.customize', 'Customize toolbar…', 'View', '', () => NoorChrome.showCustomize()],
    ['stats.show', 'Document statistics', 'Writing', '', showStats],
    ['session.restore', 'Reopen tabs on startup', 'App', '', () => { setPrefs({ restoreSession: !prefs.restoreSession }); notice(prefs.restoreSession ? 'Tabs will be reopened on startup' : 'NoorMD will start with an empty document', 2200); }],
    ['help.guide', 'User guide (README)', 'App', '', () => bridge.request('app.openGuide').catch(showError)],
    ['help.diagnostics', 'Open logs and data folder', 'App', '', () => bridge.request('app.openDataFolder').catch(showError)],
    ['app.exit', 'Exit', 'App', 'Alt+F4', () => bridge.request('app.exit').catch(showError)],
  ].map(([id, label, group, keys, run]) => ({ id, label, group, keys, run }));
  const commandById = new Map(COMMANDS.map((c) => [c.id, c]));

  /** Checked/enabled state of a command, shared by the menu bar, the toolbar and the palette. */
  function commandState(id) {
    const musicOn = prefs.showMusic !== false;
    const hasEditor = !!(t && t.editor);
    const checked = {
      'view.toolbar': prefs.showToolbar !== false, 'view.sidebar': !document.body.classList.contains('sidebar-collapsed'), 'view.sidebarRight': document.body.classList.contains('sidebar-right'),
      'music.toggle': !!(window.NoorMusic && NoorMusic.isOpen()), 'video.toggle': !!(window.NoorVideo && NoorVideo.isOpen()), 'stream.toggle': !!(window.NoorStream && NoorStream.isOpen()), 'music.mini': prefs.miniPlayer !== false,
      'view.visual': t?.mode === 'wysiwyg', 'view.markdown': t?.mode === 'markdown', 'view.split': t?.mode === 'split',
      'view.focus': document.body.classList.contains('zen'), 'layout.compact': !!prefs.compact, 'spell.toggle': prefs.spellcheck !== false,
      'source.lineNumbers': prefs.lineNumbers !== false, 'source.wrap': prefs.wordWrap !== false, 'source.sync': !!prefs.syncScroll,
      'width.comfortable': prefs.lineWidth === 'comfortable', 'width.wide': prefs.lineWidth === 'wide', 'width.full': prefs.lineWidth === 'full',
      'tab.pin': !!t?.pinned, 'session.restore': !!prefs.restoreSession,
      'music.shuffle': !!(window.NoorMusic && NoorMusic.shuffleOn && NoorMusic.shuffleOn()),
    }[id];
    let enabled = true;
    if (/^(fmt\.|insert\.|heading\.|edit\.)/.test(id) || id === 'find.show' || id === 'find.replace') enabled = hasEditor;
    else if (id === 'doc.reveal' || id === 'doc.reload' || id === 'tab.copyPath') enabled = !!t?.doc.path;
    else if (id === 'tab.closeOthers' || id === 'tab.closeRight' || id === 'tab.next' || id === 'tab.prev') enabled = tabs.length > 1;
    else if (id === 'doc.saveAll') enabled = tabs.some((x) => isDirty(x));
    else if (id.startsWith('music.') && id !== 'music.toggle') enabled = musicOn;
    else if (id.startsWith('vault.') && !['vault.open', 'vault.create', 'vault.followLink', 'vault.search'].includes(id)) enabled = NoorVault.isOpen() && (id !== 'vault.insertLink' || !!t?.doc.path);
    return { checked, enabled };
  }

  let chromeReady = false, chromeTimer = 0;
  function refreshChrome() {
    if (!chromeReady || chromeTimer) return;
    chromeTimer = requestAnimationFrame(() => { chromeTimer = 0; NoorChrome.refresh(); });
  }

  function headingLevel() {
    if (!editor) return 0;
    try {
      if (editor.isWysiwygMode()) {
        const node = editor.wwEditor.view.state.selection.$from.parent;
        return node.type.name === 'heading' ? node.attrs.level : 0;
      }
      const [line] = editor.getSelection()[0];
      const text = (md().split('\n')[line - 1] || '');
      const m = /^(#{1,6})\s/.exec(text);
      return m ? m[1].length : 0;
    } catch { return 0; }
  }

  /** Runs an editor command on the shown tab and keeps the caret in the document. */
  function fmt(name, payload) {
    if (!editor) return;
    editor.focus();
    editor.exec(name, payload);
    editor.focus();
  }

  async function clipboardCopy(cut) {
    if (!editor) return;
    const text = editor.getSelectedText ? editor.getSelectedText() : '';
    if (!text) { notice('Select some text first.', 1600); return; }
    try { await bridge.request('clipboard.copyText', { text }); } catch { try { await navigator.clipboard.writeText(text); } catch (err) { showError(err); return; } }
    if (cut) { editor.focus(); editor.replaceSelection(''); }
  }
  const clipboardCut = () => clipboardCopy(true);

  async function clipboardPaste() {
    if (!editor) return;
    let text = '';
    try { text = await bridge.request('clipboard.readText') || ''; } catch { try { text = await navigator.clipboard.readText(); } catch { /* no access */ } }
    if (!text) { notice('The clipboard has no text.', 1600); return; }
    editor.focus();
    editor.insertText(text.replace(/\r\n?/g, '\n'));
  }

  function selectAll() {
    if (!editor) return;
    editor.focus();
    document.execCommand('selectAll');
  }

  function insertTable() {
    if (!editor) return;
    NoorUI.modal({ label: 'Insert table', width: 380 }, (s, close) => {
      const rows = el('input', { type: 'number', id: 'table-rows', min: '1', max: '50', value: '3', 'aria-label': 'Rows' });
      const cols = el('input', { type: 'number', id: 'table-cols', min: '1', max: '20', value: '3', 'aria-label': 'Columns' });
      const ok = () => {
        const r = Math.min(50, Math.max(1, Math.floor(Number(rows.value) || 3)));
        const c = Math.min(20, Math.max(1, Math.floor(Number(cols.value) || 3)));
        close();
        fmt('addTable', { rowCount: r + 1, columnCount: c, data: [] });
      };
      for (const i of [rows, cols]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      s.append(NoorUI.head('Insert table', close), el('div', { class: 'modal-body' },
        el('div', { class: 'pref-grid' }, el('label', { for: 'table-rows', text: 'Body rows' }), rows, el('label', { for: 'table-cols', text: 'Columns' }), cols)),
      el('div', { class: 'modal-foot' }, el('span', { text: 'A header row is added on top.' }), el('div', { class: 'modal-buttons' },
        el('button', { class: 'action', onclick: () => close() }, 'Cancel'), el('button', { class: 'action primary', onclick: ok }, 'Insert'))));
      setTimeout(() => rows.select(), 0);
    });
  }

  function insertImage() {
    if (!editor) return;
    const tab = t;
    NoorUI.modal({ label: 'Insert image', width: 520 }, (s, close) => {
      const url = el('input', { id: 'image-url', placeholder: 'images/picture.png or https://…', 'aria-label': 'Image address', autocomplete: 'off', spellcheck: 'false' });
      const alt = el('input', { id: 'image-alt', placeholder: 'Describe the image', 'aria-label': 'Description (alt text)', autocomplete: 'off' });
      const ok = () => {
        const u = url.value.trim();
        if (!u) { url.focus(); return; }
        close();
        if (tab === t) fmt('addImage', { imageUrl: u, altText: alt.value.trim() || 'image' });
      };
      const browse = el('button', { class: 'utility-btn', onclick: async () => {
        try {
          const r = await bridge.request('doc.pickImage', { tabId: tab.id });
          if (r && r.path) { url.value = r.path; if (!alt.value) alt.value = r.name || ''; }
        } catch (err) { showError(err); }
      } }, 'Choose file…');
      for (const i of [url, alt]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      s.append(NoorUI.head('Insert image', close), el('div', { class: 'modal-body' },
        el('div', { class: 'pref-grid' }, el('label', { for: 'image-url', text: 'Address' }), el('div', { class: 'inline' }, url, browse),
          el('label', { for: 'image-alt', text: 'Description' }), alt),
        el('small', { class: 'pref-hint', text: 'Pictures inside the document’s folder are linked with a relative path, so the link keeps working when the folder moves.' })),
      el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' },
        el('button', { class: 'action', onclick: () => close() }, 'Cancel'), el('button', { class: 'action primary', onclick: ok }, 'Insert'))));
    });
  }

  function showStats() {
    const text = md();
    const st = NoorMarkdown.stats(text);
    const lines = text ? text.split('\n').length : 0;
    const noFences = text.replace(/^```[\s\S]*?^```/gm, '');
    const count = (re) => (noFences.match(re) || []).length;
    const rows = [
      ['Words', st.words], ['Characters', st.chars], ['Characters without spaces', text.replace(/\s/g, '').length], ['Lines', lines],
      ['Paragraphs', text.split(/\n\s*\n/).filter((x) => x.trim()).length], ['Headings', NoorMarkdown.headings(text).length],
      ['Links', count(/(^|[^!])\[[^\]]*\]\([^)]+\)/g)], ['Images', count(/!\[[^\]]*\]\([^)]+\)/g)], ['Code blocks', (text.match(/^```/gm) || []).length / 2 | 0],
      ['Reading time', st.minutes + ' min'],
    ];
    NoorUI.modal({ label: 'Document statistics', width: 420 }, (s, close) => {
      s.append(NoorUI.head('Statistics — ' + currentTitle(), close), el('div', { class: 'modal-body' },
        el('table', { class: 'shortcut-table stats-table' }, rows.map(([a, b]) => el('tr', {}, el('td', { text: a }), el('td', { text: typeof b === 'number' ? b.toLocaleString() : b }))))));
    });
  }

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
      // Generated from the command list, so it can never drift from the real shortcuts.
      const rows = COMMANDS.filter((c) => c.keys).map((c) => [c.label, c.keys]).concat(extra);
      const filter = el('input', { type: 'text', placeholder: 'Search shortcuts…', 'aria-label': 'Search shortcuts', autofocus: true });
      const table = el('table', { class: 'shortcut-table' });
      const render = () => {
        const q = filter.value.trim().toLowerCase();
        table.replaceChildren(...rows.filter(([a, b]) => !q || a.toLowerCase().includes(q) || b.toLowerCase().includes(q))
          .map(([a, b]) => el('tr', {}, el('td', { text: a }), el('td', {}, el('span', { class: 'kbd', text: b })))));
      };
      filter.addEventListener('input', render);
      render();
      s.append(NoorUI.head('Keyboard shortcuts', close), el('div', { class: 'modal-body' }, filter, el('div', { style: 'height:10px' }), table));
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
        el('p', { text: `Build: ${info.build || 'development'} · Runtime: ${info.runtime || '?'} · WebView2 ${info.webView2 || '?'}` }),
        el('p', {}, 'Source code: ', el('a', { href: REPO_URL, text: 'github.com/badsadcode/NoorMD' })),
        el('p', { text: 'Third-party components (licenses ship in the “licenses” folder next to NoorMD.exe):' }),
        el('ul', {}, ['TOAST UI Editor 3.2.2 — MIT', 'ProseMirror — MIT', 'DOMPurify 3.2.6 — Apache-2.0 / MPL-2.0', 'Inter typeface — SIL Open Font License 1.1', 'JetBrains Mono typeface — SIL Open Font License 1.1', 'Microsoft WebView2 SDK — BSD-style (Microsoft)'].map((t) => el('li', { text: t })))),
      el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' },
        el('button', { class: 'action', onclick: () => bridge.request('app.openLicenses').catch(showError) }, 'Open licenses folder'),
        el('button', { class: 'action primary', onclick: () => close() }, 'Close'))));
    });
  }

  // ---------------------------------------------------------------- tab strip

  let localSeq = 0;
  const localId = () => (Date.now().toString(16) + (++localSeq).toString(16).padStart(4, '0')).slice(-16).padStart(16, '0');

  const tabLabel = (tab) => tab.doc.fileName || titleOf(tab);

  function renderTabs() {
    const box = $('#tabs');
    const wanted = tabs.map((tab) => {
      if (!tab.tabEl) tab.tabEl = buildTabEl(tab);
      updateTabEl(tab);
      return tab.tabEl;
    });
    if (box.children.length !== wanted.length || wanted.some((n, i) => box.children[i] !== n)) box.replaceChildren(...wanted);
    $('#tabstrip').classList.toggle('single', tabs.length < 2);
  }

  function buildTabEl(tab) {
    const name = el('span', { class: 'tab-name' });
    const close = el('button', { class: 'tab-close', tabindex: '-1', 'aria-label': 'Close', title: 'Close (Ctrl+W)' }, '✕');
    const node = el('div', { class: 'tab', role: 'tab', 'data-tab': tab.id, tabindex: '-1' },
      el('span', { class: 'tab-pin', 'aria-hidden': 'true', title: 'Pinned', text: '📌' }), name,
      el('span', { class: 'tab-dirty', 'aria-hidden': 'true', text: '●' }), close);
    close.addEventListener('mousedown', (e) => e.stopPropagation());
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab); });
    node.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll
    node.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      if (tab.pinned) notice('Pinned tabs close from their menu (right-click) or with Ctrl+W.', 2600);
      else closeTab(tab);
    });
    node.addEventListener('contextmenu', (e) => { e.preventDefault(); showTabMenu(tab, e.clientX, e.clientY); });
    node.addEventListener('pointerdown', (e) => startTabDrag(tab, e));
    return node;
  }

  function updateTabEl(tab) {
    const node = tab.tabEl;
    if (!node) return;
    const dirty = isDirty(tab);
    node.querySelector('.tab-name').textContent = tabLabel(tab);
    node.title = (tab.doc.path || titleOf(tab) + ' (not saved yet)') + (dirty ? ' — unsaved changes' : '') + (tab.pinned ? ' — pinned' : '');
    node.classList.toggle('active', tab === t);
    node.classList.toggle('dirty', dirty);
    node.classList.toggle('pinned', tab.pinned);
    node.setAttribute('aria-selected', String(tab === t));
    node.querySelector('.tab-close').setAttribute('aria-label', 'Close ' + tabLabel(tab));
  }

  /** Tells the host the strip's order, pinning, modes and the shown tab (it remembers them for the next start). */
  function reportTabs(wait) {
    const payload = { tabs: tabs.map((x) => ({ id: x.id, pinned: x.pinned, mode: x.mode })), active: t ? t.id : null };
    if (!wait || !bridge.available) { bridge.post('tabs.state', payload); return Promise.resolve(); }
    // The host serves the shown document's relative images from its folder, so it must know before the editor renders.
    return Promise.race([bridge.request('tabs.state', payload).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  }

  // Tab switches run one at a time, in order, however fast they are requested.
  let switching = Promise.resolve();
  let wanted = null; // the tab most recently asked to be shown
  function showTab(tab, opts = {}) {
    wanted = tab;
    switching = switching.then(() => doShowTab(tab, opts)).catch((err) => console.error(err));
    return switching;
  }

  async function doShowTab(tab, { focus = true, force = false } = {}) {
    if (!tabs.includes(tab)) return;
    if (t === tab && tab.mounted && !force) { renderTabs(); return; }
    const prev = t;
    if (prev && prev !== tab && tabs.includes(prev)) {
      // Keystrokes typed a moment ago are sent now, from this tab's own editor.
      if (prev.changeTimer) postContent(prev);
      saveView(prev);
      prev.pane.hidden = true;
    }
    closeFind();
    NoorUI.closeAll();
    t = tab;
    editor = tab.editor;
    fallback = tab.fallback;
    renderTabs();
    await reportTabs(true);
    if (t !== tab) return; // another switch was requested meanwhile; it runs next
    tab.pane.hidden = false;
    if (!tab.mounted) mountTab(tab);
    editor = tab.editor;
    fallback = tab.fallback;
    showModeUI(tab.mode);
    restoreView(tab);
    outlineSignature = null;
    updateDocUI();
    updateDirtyUI(tab);
    refreshStatsAndOutline();
    renderBanner();
    NoorVault.renderTree();
    NoorVault.refreshBacklinks();
    tab.tabEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); updateActiveLine(); });
    if (focus && !NoorUI.hasOpenModal()) setTimeout(() => { if (t === tab) (tab.editor || tab.fallback)?.focus(); }, 0);
  }

  function saveView(tab) {
    tab.scroll = [...tab.pane.querySelectorAll('.ProseMirror, .toastui-editor-contents, .toastui-editor-md-preview, .editor-fallback textarea')]
      .filter((n) => n.scrollTop > 0 || n.scrollLeft > 0).map((n) => [n, n.scrollTop, n.scrollLeft]);
  }

  function restoreView(tab) {
    const list = tab.scroll || [];
    requestAnimationFrame(() => list.forEach(([n, top, left]) => { n.scrollTop = top; n.scrollLeft = left; }));
  }

  function cycleTab(step) {
    if (tabs.length < 2 || !t) return;
    const i = tabs.indexOf(t);
    showTab(tabs[(i + step + tabs.length) % tabs.length]);
  }

  /** Close one tab. The host asks Save / Don't save / Cancel if it has unsaved changes. */
  async function closeTab(tab) {
    if (!tab || !tabs.includes(tab)) return false;
    if (!bridge.available) { removeTab(tab); if (!tabs.length) onDocLoad({ markdown: '' }); return true; }
    if (tab.changeTimer) postContent(tab);
    try {
      const r = await bridge.request('tab.close', { tabId: tab.id });
      if (r && r.busy) { notice('Finish the open dialog first.'); return false; }
      if (!r || !r.closed) return false;
      removeTab(tab);
      return true;
    } catch (err) { showError(err); return false; }
  }

  function removeTab(tab) {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    destroyEditor(tab);
    tab.pane.remove();
    tab.tabEl?.remove();
    tabs.splice(i, 1);
    if (t === tab) {
      t = null; editor = null; fallback = null;
      const next = tabs[Math.min(i, tabs.length - 1)];
      if (next) showTab(next);
    } else reportTabs();
    renderTabs();
  }

  /** Bulk close: pinned tabs are skipped, and the first Cancel stops the rest. */
  async function closeMany(list) {
    let skipped = 0;
    for (const tab of list) {
      if (tab.pinned) { skipped++; continue; }
      if (!await closeTab(tab)) return;
    }
    if (skipped) notice(`${skipped} pinned tab${skipped === 1 ? '' : 's'} kept open`, 2200);
  }
  const closeOthers = (keep = t) => closeMany(tabs.filter((x) => x !== keep));
  const closeToRight = (from = t) => closeMany(tabs.slice(tabs.indexOf(from) + 1));

  /** Pinned tabs sit together at the start of the strip. */
  function placePinned(tab) {
    const i = tabs.indexOf(tab);
    tabs.splice(i, 1);
    const firstUnpinned = tabs.findIndex((x) => !x.pinned);
    tabs.splice(firstUnpinned < 0 ? tabs.length : firstUnpinned, 0, tab);
  }

  function togglePin(tab = t) {
    if (!tab) return;
    tab.pinned = !tab.pinned;
    if (tab.pinned) placePinned(tab);
    else {
      const i = tabs.indexOf(tab);
      tabs.splice(i, 1);
      const lastPinned = tabs.map((x) => x.pinned).lastIndexOf(true);
      tabs.splice(lastPinned + 1, 0, tab);
    }
    renderTabs();
    reportTabs();
    notice(tab.pinned ? 'Tab pinned — kept open by Close Others / Close Tabs to the Right' : 'Tab unpinned', 2200);
  }

  async function copyPath(tab = t) {
    if (!tab || !tab.doc.path) { notice('This document has not been saved yet.'); return; }
    try { await bridge.request('doc.copyPath', { tabId: tab.id }); notice('Path copied', 1600); } catch (err) { showError(err); }
  }

  // Drag to reorder (pointer events; a click without movement just selects the tab).
  function startTabDrag(tab, e) {
    if (e.button !== 0 || e.target.closest('.tab-close')) return;
    const startX = e.clientX;
    let dragging = false;
    const node = tab.tabEl;
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - startX) < 6) return;
      if (!dragging) { dragging = true; node.classList.add('dragging'); }
      const group = tabs.filter((x) => x.pinned === tab.pinned && x !== tab); // pinned and unpinned tabs don't mix
      let index = 0;
      for (const other of group) {
        const r = other.tabEl.getBoundingClientRect();
        if (ev.clientX > r.left + r.width / 2) index++;
      }
      const base = tab.pinned ? 0 : tabs.filter((x) => x.pinned).length;
      const cur = tabs.indexOf(tab);
      const target = base + index;
      if (target !== cur) { tabs.splice(cur, 1); tabs.splice(target, 0, tab); renderTabs(); }
    };
    // Listen on the window: re-ordering moves the tab's element, which would drop pointer capture.
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      node.classList.remove('dragging');
      if (dragging) reportTabs();
      else showTab(tab);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function showTabMenu(tab, x, y) {
    closeTabMenu();
    const i = tabs.indexOf(tab);
    const item = (label, run, disabled) => el('button', { role: 'menuitem', disabled: disabled || undefined, onclick: () => { closeTabMenu(); run(); } }, label);
    const menu = el('div', { class: 'tab-menu', role: 'menu', id: 'tab-menu', 'aria-label': 'Tab actions' },
      item('Close', () => closeTab(tab)),
      item('Close Others', () => closeOthers(tab), tabs.length < 2),
      item('Close Tabs to the Right', () => closeToRight(tab), i === tabs.length - 1),
      el('hr'),
      item('Copy Path', () => copyPath(tab), !tab.doc.path),
      item('Reveal in Explorer', () => bridge.request('doc.reveal', { tabId: tab.id }).catch(showError), !tab.doc.path),
      el('hr'),
      item(tab.pinned ? 'Unpin' : 'Pin', () => togglePin(tab)));
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    menu.querySelector('button:not([disabled])')?.focus();
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('button:not([disabled])')];
      const k = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(k + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    });
    setTimeout(() => document.addEventListener('mousedown', outsideMenu, true), 0);
  }
  function outsideMenu(e) { if (!e.target.closest('#tab-menu')) closeTabMenu(); }
  function closeTabMenu() {
    const m = $('#tab-menu');
    document.removeEventListener('mousedown', outsideMenu, true);
    if (!m) return false;
    m.remove();
    return true;
  }

  /** Searchable list of open documents (also the overflow menu when the strip is too narrow). */
  /** Open documents first, then (in a Vault) every other note — type to filter, Enter to open. */
  function showSwitcher() {
    const open = tabs.map((x) => ({ label: (x.pinned ? '📌 ' : '') + tabLabel(x) + (isDirty(x) ? ' ●' : ''), detail: x.doc.path || 'Not saved yet', group: 'Open', run: () => showTab(x), key: x.doc.path }));
    const openPaths = new Set(tabs.map((x) => vaultRel(x.doc.path)).filter(Boolean));
    const notes = NoorVault.isOpen() ? NoorVault.notes().filter((p) => !openPaths.has(p)).map((p) => ({
      label: p.slice(p.lastIndexOf('/') + 1), detail: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : NoorVault.name(), group: 'Vault',
      run: () => bridge.request('vault.openFile', { path: p }).catch(showError),
    })) : [];
    pickFrom(NoorVault.isOpen() ? 'Go to a document or note' : 'Open documents', open.concat(notes),
      `${tabs.length} open document${tabs.length === 1 ? '' : 's'}${notes.length ? ' · ' + notes.length.toLocaleString() + ' other notes in the Vault' : ''} · Ctrl+Tab cycles`);
  }

  /** A searchable list of choices (used by the switcher and "Link to a note"). */
  function pickFrom(title, all, footer) {
    NoorUI.closeAll();
    NoorUI.modal({ label: title }, (s, close) => {
      const query = el('input', { id: 'switcher-query', placeholder: title + '…', autocomplete: 'off', 'aria-label': title, autofocus: true, spellcheck: 'false' });
      const results = el('div', { class: 'palette-results', role: 'listbox' });
      let items = [], selected = 0;
      const fold = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[łŁ]/g, 'l').toLowerCase();
      const render = () => {
        const terms = fold(query.value.trim()).split(/\s+/).filter(Boolean);
        items = all.filter((x) => { const h = fold(x.label + ' ' + (x.detail || '')); return terms.every((w) => h.includes(w)); }).slice(0, 300);
        selected = Math.min(selected, Math.max(0, items.length - 1));
        results.replaceChildren(...items.map((x, i) => el('button', {
          class: 'cmd-item' + (i === selected ? ' selected' : ''), role: 'option', 'aria-selected': String(i === selected), tabindex: '-1',
          onclick: () => { close(); x.run(); },
        }, el('span', { text: x.label }), el('span', { class: 'meta' }, el('small', { text: x.detail || '' }), x.group === 'Vault' ? el('small', { class: 'kbd', text: 'Vault' }) : null))));
        if (!items.length) results.append(el('p', { text: 'Nothing matches', style: 'padding:14px;margin:0;color:var(--muted)' }));
        results.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
      };
      query.addEventListener('input', () => { selected = 0; render(); });
      query.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); selected = (selected + 1) % Math.max(1, items.length); render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); selected = (selected - 1 + items.length) % Math.max(1, items.length); render(); }
        else if (e.key === 'Enter') { e.preventDefault(); const x = items[selected]; if (x) { close(); x.run(); } }
      });
      s.append(query, results, el('div', { class: 'modal-foot' }, el('span', { text: footer || `${all.length} items` }), el('span', { text: 'Esc to close' })));
      render();
    });
  }

  /** The Vault-relative path of a file in the open Vault, or null. */
  function vaultRel(path) {
    const st = NoorVault._state();
    if (!path || !st.vault) return null;
    const root = st.vault.root.replace(/[\\/]+$/, '');
    if (!path.toLowerCase().startsWith(root.toLowerCase() + '\\') && !path.toLowerCase().startsWith(root.toLowerCase() + '/')) return null;
    return path.slice(root.length + 1).replace(/\\/g, '/');
  }

  function setupTabStrip() {
    $('#tab-new').addEventListener('click', () => runCommand('tab.new'));
    $('#tab-list').addEventListener('click', () => runCommand('tab.switch'));
    const box = $('#tabs');
    box.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { box.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    box.addEventListener('dblclick', (e) => { if (e.target === box) runCommand('tab.new'); });
    window.addEventListener('resize', () => { closeTabMenu(); t?.tabEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  }

  const welcomeVisible = () => !$('#welcome').classList.contains('hide');
  function hideWelcome() { $('#welcome').classList.add('hide'); }
  const newDocument = (extra = {}) => bridge.request('doc.new', { reuseBlank: welcomeVisible(), ...extra }).catch(showError);

  // ---------------------------------------------------------------- focus mode

  function toggleZen(force) {
    const on = force === undefined ? !document.body.classList.contains('zen') : force;
    document.body.classList.toggle('zen', on);
    refreshChrome();
    notice(on ? 'Focus mode · Esc or F11 to exit' : 'Focus mode off', 1600);
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      if (editor) editor.focus();
    });
  }

  // ---------------------------------------------------------------- saving

  /** Saves the tab on screen — only that tab, with the text the host reads from that tab's editor. */
  async function save(kind) {
    const tab = t;
    if (!tab) return;
    clearTimeout(tab.changeTimer);
    tab.changeTimer = null;
    $('#status-text').textContent = 'Saving…';
    try {
      const r = await bridge.request(kind, { tabId: tab.id });
      if (r && r.saved) notice('Saved ✓ ' + (r.fileName || ''), 1800);
      else updateDirtyUI(tab);
    } catch (err) {
      if (tab === t) {
        $('#status-dot').classList.add('error');
        $('#status-text').textContent = 'Save failed — your text is still here and in the recovery draft';
      }
      showError(err);
    }
  }

  async function saveAll() {
    for (const tab of tabs) if (tab.changeTimer) postContent(tab);
    try {
      const r = await bridge.request('doc.saveAll');
      if (r && !r.busy) notice(r.cancelled ? `Saved ${r.saved} — stopped at a cancelled save` : r.saved ? `Saved ${r.saved} document${r.saved === 1 ? '' : 's'} ✓` : 'Nothing to save', 2200);
    } catch (err) { showError(err); }
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
    // Menus first: Alt+letter / F10 open them, and while one is open its keys belong to it.
    if (!(e.getModifierState && e.getModifierState('AltGraph')) && NoorChrome.handleKey(e)) { e.stopPropagation(); return; }
    if (e.target && e.target.closest && e.target.closest('.menu-popup, #menubar') && !ctrl) return;
    if (key === 'Escape') {
      if (closeTabMenu()) { e.preventDefault(); return; }
      if (closeFind()) { e.preventDefault(); return; }
      if (document.body.classList.contains('zen')) { e.preventDefault(); toggleZen(false); }
      return;
    }
    if (key === 'F2' && e.target.closest && e.target.closest('#vault-tree')) return; // F2 renames in the explorer
    if (key === 'F2') cmd = 'music.edit';
    else if (ctrl && e.altKey && !e.shiftKey && !(e.getModifierState && e.getModifierState('AltGraph')) && (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'ArrowLeft'))
      cmd = { Space: 'music.play', ArrowRight: 'music.next', ArrowLeft: 'music.prev' }[e.code];
    else if (ctrl && e.altKey && !e.shiftKey && !(e.getModifierState && e.getModifierState('AltGraph')) && e.code === 'KeyR') cmd = 'music.random';
    else if (ctrl && e.altKey && !e.shiftKey && !(e.getModifierState && e.getModifierState('AltGraph')) && e.code === 'KeyV') cmd = 'video.toggle';
    else if (ctrl && e.altKey && !e.shiftKey && !(e.getModifierState && e.getModifierState('AltGraph')) && e.code === 'KeyB') cmd = 'stream.toggle';
    else if (e.altKey && !ctrl && !e.shiftKey && /^Digit[0-4]$/.test(e.code))
      cmd = ['music.clearTriage', 'music.fav', 'music.keep', 'music.maybe', 'music.skip'][Number(e.code.slice(5))];
    else if (key === 'F11') cmd = 'view.focus';
    else if (key === 'F1') cmd = 'shortcuts.show';
    // AltGr is reported as Ctrl+Alt: on Polish and many other layouts AltGr+S types "ś", AltGr+A "ą", etc.
    // Never treat an AltGr keystroke as a shortcut.
    else if (e.getModifierState && e.getModifierState('AltGraph')) return;
    else if (ctrl && e.altKey && key === 's' && e.code === 'KeyS') cmd = 'snapshot.create';
    else if (ctrl && !e.altKey && key === 'Tab') cmd = e.shiftKey ? 'tab.prev' : 'tab.next';
    else if (ctrl && !e.altKey && !e.shiftKey && (key === 'PageDown' || key === 'PageUp')) cmd = key === 'PageDown' ? 'tab.next' : 'tab.prev';
    else if (ctrl && !e.altKey) {
      if (key === 's') cmd = e.shiftKey ? 'doc.saveAs' : 'doc.save';
      else if (key === 't' && !e.shiftKey) cmd = 'tab.new';
      else if (key === 'w' && !e.shiftKey) cmd = 'tab.close';
      else if (key === 'e' && !e.shiftKey) cmd = 'tab.switch';
      else if (key === 'e' && e.shiftKey) cmd = 'vault.explorer';
      else if (key === 'f' && e.shiftKey) cmd = 'vault.search';
      else if (key === 'n' && !e.shiftKey) cmd = 'doc.new';
      else if (key === 'o' && !e.shiftKey) cmd = 'doc.open';
      else if (key === 'f' && !e.shiftKey) cmd = 'find.show';
      else if (key === 'h' && !e.shiftKey) cmd = 'find.replace';
      else if (key === 'h' && e.shiftKey) cmd = 'history.show';
      else if (key === 'w' && e.shiftKey) cmd = 'width.cycle';
      else if (key === 't' && e.shiftKey) cmd = 'theme.next';
      else if (key === 'm' && e.shiftKey) cmd = 'music.toggle';
      else if (key === 'l' && e.shiftKey) cmd = 'layout.compact';
      else if (key === 'y' && e.shiftKey) cmd = 'spell.toggle';
      else if (key === 'k' && e.shiftKey) cmd = 'insert.link';
      else if (key === 'c' && e.shiftKey) cmd = 'insert.codeblock';
      else if (e.shiftKey && /^Digit[1-6]$/.test(e.code)) cmd = 'heading.' + e.code.slice(5);
      else if ((key === 'k' && !e.shiftKey) || (key === 'p' && e.shiftKey)) cmd = 'palette.show';
      else if (key === 'p') cmd = 'print';
      else if (!e.shiftKey && (key === '1' || e.code === 'Digit1')) cmd = 'view.visual';
      else if (!e.shiftKey && (key === '2' || e.code === 'Digit2')) cmd = 'view.markdown';
      else if (!e.shiftKey && (key === '3' || e.code === 'Digit3')) cmd = 'view.split';
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
    if (e.repeat && (cmd.startsWith('doc.') || cmd === 'tab.close' || cmd === 'tab.new')) return; // a held Ctrl+S saves exactly once
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
    // Ctrl+click on [[Wiki link]] (or [text](note.md) in Markdown source) follows it, once the click has placed the caret.
    document.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !e.target.closest || !e.target.closest('#editor [contenteditable="true"]') || e.target.closest('a[href]')) return;
      setTimeout(() => { if (NoorVault.linkAtCaret()) NoorVault.followLink(); }, 0);
    });
  }

  // ---------------------------------------------------------------- host events

  function setupBridgeEvents() {
    bridge.on('doc.load', onDocLoad);
    bridge.on('doc.renamed', (p) => {
      const tab = tabById(p.tabId);
      if (!tab) return;
      Object.assign(tab.doc, { path: p.path, fileName: p.fileName, title: p.title, untitled: false });
      if (tab === t) updateDocUI();
      updateTabEl(tab);
      NoorVault.renderTree();
    });
    bridge.on('tab.closed', (p) => { const tab = tabById(p.tabId); if (tab) removeTab(tab); });
    bridge.on('tab.select', (p) => { const tab = tabById(p.tabId); if (tab) { hideWelcome(); showTab(tab); } });
    bridge.on('doc.saved', onSaved);
    bridge.on('recent.changed', (p) => { recent = p.recent || []; renderRecent(); });
    bridge.on('prefs.changed', (p) => { prefs = { ...prefs, ...p.prefs }; applyPrefs(); });
    bridge.on('notice', (p) => notice(p.text, p.ms || 3200));
    bridge.on('error', (p) => showError(new Error(p.text)));
    bridge.on('recovery.available', (p) => showRecovery(p.drafts));
    bridge.on('insert.text', (p) => {
      // Inserted into the tab it was meant for (a drop or a sketch for one document never lands in another).
      const tab = (p.tabId && tabById(p.tabId)) || t;
      if (!tab || !tab.editor || typeof p.markdown !== 'string') { if (p.tabId) notice('That document is no longer open; nothing was inserted.'); return; }
      tab.editor.insertText(p.markdown);
      if (tab === t) tab.editor.focus();
    });
    bridge.on('command', (p) => { if (p.id.startsWith('tab.') && NoorUI.hasOpenModal()) return; runCommand(p.id); });
  }

  // ---------------------------------------------------------------- startup

  async function start() {
    setupBridgeEvents();
    setupSidebar();
    setupFind();
    setupTabStrip();
    setupDropAndLinks();
    NoorDock.init({
      getPrefs: () => prefs, setPrefs,
      setSidebarCollapsed: (c) => toggleSidebar(c),
      isSidebarCollapsed: () => document.body.classList.contains('sidebar-collapsed'),
      panels: {
        music: { label: 'Music Bench', el: () => $('#music'), open: () => NoorMusic.togglePanel(true), close: () => NoorMusic.togglePanel(false), isOpen: () => NoorMusic.isOpen() },
        video: { label: 'Video Bench', el: () => $('#videobench'), open: () => NoorVideo.open(), close: () => NoorVideo.close(), isOpen: () => NoorVideo.isOpen() },
        stream: { label: 'Stream Desk', el: () => $('#streamdesk'), open: () => NoorStream.open(), close: () => NoorStream.close(), isOpen: () => document.body.classList.contains('stream-open') },
      },
    });
    NoorMusic.init({ getPrefs: () => prefs, setPrefs, showError, onNowPlaying: (t) => window.NoorStream && NoorStream.nowPlaying(t) });
    NoorVideo.init({ showError, onPlay: () => NoorMusic.pauseForVideo() });
    NoorStream.init({ showError });
    NoorChrome.init({
      command: (id) => commandById.get(id) || null,
      run: runCommand,
      state: commandState,
      prefs: () => prefs,
      setPrefs,
      recent: () => recent,
      openRecent,
      recentVaults: () => { const r = NoorVault.recent(); return r.length ? r.map((v) => ({ label: v.name, title: v.path, run: () => bridge.request('vault.openRecent', { path: v.path }).catch(showError) })) : [{ label: 'No recent Vaults', disabled: true }]; },
      headingLabel: () => { const n = headingLevel(); return n ? 'H' + n : 'Text'; },
      nowPlaying: () => (window.NoorMusic && NoorMusic.nowPlaying ? NoorMusic.nowPlaying() : { playing: false, title: null }),
      focusEditor: () => { if (editor) editor.focus(); },
    });
    chromeReady = true;
    NoorVault.init({
      showError, refreshChrome, runCommand, pickFrom,
      hasCommand: (id) => commandById.has(id),
      activeTabId: () => (t ? t.id : null),
      activeVaultPath: () => (t ? vaultRel(t.doc.path) : null),
      insertText: (text) => { if (editor) { editor.focus(); editor.insertText(text); } },
      findInDocument: async (q) => { await switching; showFind(false); $('#find-input').value = q; runFind(false); },
      searchOpenTabs, revealMatch, openTabCount: () => tabs.length,
    });
    window.addEventListener('noor-music', refreshChrome);
    document.addEventListener('selectionchange', refreshChrome);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', () => requestAnimationFrame(updateActiveLine));
    window.addEventListener('resize', () => requestAnimationFrame(updateActiveLine));
    document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => runCommand(b.dataset.cmd)));
    $('#doc-title').addEventListener('input', () => {
      if (!t || !t.doc.untitled) return;
      t.doc.title = $('#doc-title').value;
      updateCrumb();
      updateTabEl(t);
      bridge.post('doc.state', { tabId: t.id, dirty: isDirty(t), title: currentTitle() });
    });

    if (!bridge.available) {
      applyPrefs();
      onDocLoad({ markdown: SAMPLE, title: 'Welcome to NoorMD' });
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
    if (ready.vaults) NoorVault.onChanged(ready.vaults);
    // Restored tabs arrive in strip order; only the selected one gets an editor now, the rest when first shown.
    const first = (ready.tabs || []).find((p) => p.tabId === ready.activeTabId) || (ready.tabs || [])[0];
    if (first) wanted = first.tabId; // no tab is shown until the remembered one is
    for (const p of ready.tabs || []) onDocLoad({ ...p, background: true, noFocus: true });
    wanted = null;
    const shown = tabById(ready.activeTabId) || tabs[0];
    if (shown) await showTab(shown, { focus: !ready.welcome });
    if (ready.welcome) {
      $('#welcome').classList.remove('hide');
      $('#welcome .action.primary')?.focus();
    }
    if (ready.recovery && ready.recovery.length) showRecovery(ready.recovery);
    NoorMusic.resumeSession();
  }

  // Exposed for the host (ExecuteScriptAsync) and for automated UI tests.
  window.NoorMD = Object.freeze({
    getState,
    /** Sends any pending keystrokes of a tab (default: the one on screen) and returns that tab's state. */
    flush(tabId) {
      const tab = tabId ? tabById(tabId) : t;
      if (!tab) return null;
      if (tab.changeTimer) postContent(tab);
      return stateOf(tab);
    },
    tabs: () => tabs.map((x) => ({ id: x.id, title: titleOf(x), path: x.doc.path, dirty: isDirty(x), pinned: x.pinned, mode: x.mode, mounted: x.mounted, active: x === t })),
    activeTab: () => (t ? t.id : null),
    mode: () => (t ? t.mode : null),
    runCommand,
  });

  start();
})();
