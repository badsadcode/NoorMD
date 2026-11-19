// The Markdown bench's web module (contract v1). NoorMD 2.0's editor (TOAST UI: Visual, Markdown, side by side),
// documents as tabs inside the bench, an outline panel. The C# side owns the files: this page never reads or writes
// one itself, it asks (md.pick, md.load, md.write, md.writeAs, md.draft…).
import { el, menu, quickPick } from '/ui/js/noor-ui.js';
import { createFind } from './find.js';
import { visualRoundTrip, joinInlineBreaks, headings, stats, unescapeWikiLinks, renderSafe, escapeHtml, decorateCallouts, calloutType, properties, setProperty } from './mdtools.js';

const here = (p) => new URL(p, import.meta.url).href;
const MODES = [['wysiwyg', 'Visual'], ['markdown', 'Markdown'], ['split', 'Side by side']];
const modeName = (m) => (MODES.find((x) => x[0] === m) || MODES[0])[1];

// The outline as last sent, so an Outline panel shown later (or in a floating window) starts with it.
let lastOutline = { title: '', items: [] };
let lastProps = null;   // the properties of the document on screen (for the Properties panel)

let toastLoading = null;
/** TOAST UI is a classic script (window.toastui); it's loaded once, from the bench's own files. */
function loadToast() {
  if (window.toastui && window.toastui.Editor) return Promise.resolve(true);
  return (toastLoading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = here('vendor/toastui/toastui-editor-all.min.js');
    s.onload = () => resolve(!!(window.toastui && window.toastui.Editor));
    s.onerror = () => resolve(false);
    document.head.append(s);
  }));
}

/** DOMPurify (export and print), loaded the first time it's needed. */
let purifyLoading = null;
function loadPurify() {
  if (window.DOMPurify) return Promise.resolve(true);
  return (purifyLoading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = here('vendor/dompurify/purify.min.js');
    s.onload = () => resolve(!!window.DOMPurify); s.onerror = () => resolve(false);
    document.head.append(s);
  }));
}

// The statistics as last sent, so a Statistics panel shown later starts with them.
let lastStats = null;

const FONTS = {
  system: "var(--font-ui)",
  inter: "'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  serif: "Charter, 'Iowan Old Style', Georgia, Cambria, 'Times New Roman', serif",
  mono: "var(--font-code)",
};

const WELCOME = `# Welcome to the Markdown bench ✨

A calm place for ideas, notes, documentation and glorious little side projects.

## Writing

Write **bold**, *italic* and \`inline code\` without thinking about Markdown at all: the bar above does it, and so do
the usual keys (Ctrl+B, Ctrl+I, Ctrl+Shift+1…6 for headings, Ctrl+Shift+0 for plain text).

- **Visual**, **Markdown** and **side by side**: the buttons at the top right, or Ctrl+E.
- Open files with Ctrl+O, or drop them on the window.
- Unsaved work is kept as a draft, even when NoorMD closes.

> Good ideas deserve a beautiful editor. Even the terrible ideas. Especially those.

## Around the editor

- [x] Open the Markdown bench
- [ ] Try the **Outline**, **Statistics** and **History** panels (View menu): dock them anywhere, or float them
- [ ] Take a snapshot before a big rewrite (History)
- [ ] Find and replace with Ctrl+F and Ctrl+H

| Keys | What they do |
| --- | --- |
| Ctrl+N / Ctrl+O / Ctrl+S | New, open, save |
| Ctrl+E | Next view |
| Ctrl+= / Ctrl+- | Bigger, smaller text |

\`\`\`csharp
// And yes, your code is welcome here.
Console.WriteLine("Hello, NoorMD 3.0!");
\`\`\`
`;

// Toolbar icons (NoorMD 2.0's own, 24×24 strokes).
const ICONS = {
  new: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6', open: 'M4 19V5h7l2 3h7v11z', save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01',
  undo: 'M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3', redo: 'm15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h3',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z', italic: 'M10 4h8M6 20h8M14 4l-4 16',
  strike: 'M5 12h14M16 6.5C15 5 13.6 4.5 12 4.5c-2.5 0-4 1.3-4 3.2 0 1.6 1 2.4 2.6 3M8 17.5c1 1.5 2.4 2 4 2 2.6 0 4.2-1.3 4.2-3.3 0-.7-.2-1.3-.5-1.7',
  code: 'm8 8-4 4 4 4M16 8l4 4-4 4', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  ul: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  ol: 'M10 6h10M10 12h10M10 18h10M4 4h1.5v4M3.5 10.5c.5-.7 2.5-.7 2.5.6 0 1-2.5 2-2.5 2.9H6M3.5 16h2.3l-1.3 1.6c1 0 1.6.4 1.6 1.1 0 1.2-2 1.3-2.6.6',
  task: 'M4 5h5v5H4zM4 14h5v5H4zM5.5 16.5l1 1 2-2.5M13 7.5h7M13 16.5h7', quote: 'M7 7H4v6h3l-1 4M17 7h-3v6h3l-1 4',
  codeblock: 'M4 4h16v16H4zM9 10l-2 2 2 2M15 10l2 2-2 2', table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14', hr: 'M4 12h16',
  heading: 'M6 4v16M18 4v16M6 12h12',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]); svg.append(path);
  return svg;
}
// [command, icon, label, keys, the editor's toolbar-state key that lights it up]
const TOOLS = [
  ['md.new', 'new', 'New document', 'Ctrl+N'], ['md.open', 'open', 'Open', 'Ctrl+O'], ['md.save', 'save', 'Save', 'Ctrl+S'], '|',
  ['edit.undo', 'undo', 'Undo', 'Ctrl+Z'], ['edit.redo', 'redo', 'Redo', 'Ctrl+Y'], '|', 'heading', '|',
  ['md.fmt.bold', 'bold', 'Bold', 'Ctrl+B', 'strong'], ['md.fmt.italic', 'italic', 'Italic', 'Ctrl+I', 'emph'], ['md.fmt.strike', 'strike', 'Strikethrough', '', 'strike'], ['md.ins.link', 'link', 'Link', ''], '|',
  ['md.fmt.ul', 'ul', 'Bulleted list', '', 'bulletList'], ['md.fmt.ol', 'ol', 'Numbered list', '', 'orderedList'], ['md.fmt.task', 'task', 'Task list', '', 'taskList'], ['md.fmt.quote', 'quote', 'Quote', '', 'blockQuote'], '|',
  ['md.fmt.code', 'code', 'Inline code', '', 'code'], ['md.ins.codeblock', 'codeblock', 'Code block', '', 'codeBlock'], ['md.ins.table', 'table', 'Table', ''], ['md.ins.image', 'image', 'Image', ''], ['md.ins.hr', 'hr', 'Horizontal line', ''],
];

// The editor's own options (2.0's preferences), kept with the bench.
const PREF_DEFAULTS = { font: 'system', goal: 750, zoom: 0, width: 'comfortable', lineNumbers: true, wrap: true, sync: false, spell: true, split: 0.5 };
const MEASURES = { comfortable: '780px', wide: '1100px', full: '100000px' };
const WIDTHS = [['comfortable', 'Comfortable'], ['wide', 'Wide'], ['full', 'Full width']];

/** TOAST UI plugin: in Visual view, a quote starting with [!tip] (note, warning…) is drawn as a callout. */
function calloutPlugin() {
  return {
    wysiwygNodeViews: {
      blockQuote(node) {
        const dom = document.createElement('blockquote');
        const paint = (n) => { const t = calloutType(n.textContent); dom.className = t ? `callout callout-${t} editing` : ''; };
        paint(node);
        return { dom, contentDOM: dom, update(n) { if (n.type !== node.type) return false; paint(n); return true; } };
      },
    },
  };
}

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
const normalizeText = (s) => String(s ?? '').replace(/\r\n?/g, '\n');
const isDark = () => getComputedStyle(document.documentElement).colorScheme.includes('dark');
const samePath = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export default {
  mount(root, ctx) {
    const arrived = !!ctx.justMoved;   // moved here from another window (its documents come along, nothing to announce)
    ctx.useStyle(here('vendor/toastui/toastui-editor.css'));
    ctx.useStyle(here('vendor/toastui/toastui-editor-dark.css'));
    ctx.useStyle(here('bench.css'));

    const docs = [];
    let cur = null;
    let toastOk = null;   // null: still loading
    let suppress = 0;
    let statusTimer = 0, outlineTimer = 0;

    const tabsEl = el('div', { class: 'md-tabs', role: 'tablist', 'aria-label': 'Documents' });
    const modesEl = el('div', { class: 'nui-seg md-modes', role: 'group', 'aria-label': 'View' },
      ...MODES.map(([m, label]) => el('button', { 'data-mode': m, 'aria-pressed': 'false', title: `${label} (Ctrl+E: next view)`, onclick: () => cur && setMode(cur, m) }, label)));
    const bannerEl = el('div', { class: 'md-banner', hidden: true });
    const docsEl = el('div', { class: 'md-docs' });
    const emptyEl = el('div', { class: 'md-empty' });
    const toolsEl = el('div', { class: 'md-tools', role: 'toolbar', 'aria-label': 'Formatting', hidden: !ctx.restore('toolbar', true) });
    const find = createFind({ getEditor: () => cur && cur.editor, toast: (t) => ctx.toast(t) });
    const box = el('div', { class: 'md-bench' },
      el('div', { class: 'md-bar' }, tabsEl, el('button', { class: 'nui-icon md-new', title: 'New document (Ctrl+N)', 'aria-label': 'New document', onclick: () => newDoc() }, '+'), modesEl),
      toolsEl, find.bar, bannerEl, el('div', { class: 'md-docs-wrap', style: { position: 'relative', flex: '1 1 auto', minHeight: '0', display: 'flex' } }, docsEl, emptyEl));
    docsEl.style.flex = '1 1 auto';
    root.replaceChildren(box);

    // ------------------------------------------------------------ options: text size, line width, the Markdown view
    const prefs = { ...PREF_DEFAULTS, ...(ctx.restore('prefs', {}) || {}) };
    function setPrefs(p) { Object.assign(prefs, p); ctx.keep('prefs', { ...prefs }); applyPrefs(); renderStatus(); }
    function applyPrefs() {
      const z = Math.max(-6, Math.min(12, Number(prefs.zoom) || 0));
      box.style.setProperty('--doc-size', `calc(var(--font-size-doc, 15px) + ${1 + z}px)`);
      box.style.setProperty('--source-size', `calc(var(--font-size-doc, 15px) + ${z - 1}px)`);
      box.style.setProperty('--measure', MEASURES[prefs.width] || MEASURES.comfortable);
      box.style.setProperty('--doc-font', FONTS[prefs.font] || FONTS.system);
      box.style.setProperty('--split', (Math.min(0.75, Math.max(0.25, Number(prefs.split) || 0.5)) * 100).toFixed(1) + '%');
      box.classList.toggle('source-line-numbers', !!prefs.lineNumbers);
      box.classList.toggle('source-nowrap', !prefs.wrap);
      box.classList.toggle('no-spellcheck', !prefs.spell);
      docsEl.querySelectorAll('.ProseMirror').forEach((n) => n.setAttribute('spellcheck', String(!!prefs.spell)));
      for (const d of docs) if (d.editor && d.editor.eventEmitter) d.editor.eventEmitter.emit('toggleScrollSync', !!prefs.sync);
    }
    const zoomBy = (n) => setPrefs({ zoom: n === 0 ? 0 : Math.max(-6, Math.min(12, (Number(prefs.zoom) || 0) + n)) });

    // ------------------------------------------------------------ documents
    function makeDoc({ id = newId(), path = null, name = null, title = null, mode = null, format = 'UTF-8 · LF' } = {}) {
      const pane = el('div', { class: 'md-pane', 'data-doc': id, hidden: true });
      docsEl.append(pane);
      return {
        id, path, name, title: title || name || untitledName(), format, pane, editor: null, fallback: null, mounted: false, pending: '',
        mode: mode || 'wysiwyg', gen: 0, savedGen: 0, draftTimer: 0, sourceBeforeVisual: null, banner: null,
      };
    }
    function untitledName() {
      const used = new Set(docs.map((d) => d.title));
      if (!used.has('Untitled document')) return 'Untitled document';
      for (let i = 2; ; i++) if (!used.has(`Untitled ${i}`)) return `Untitled ${i}`;
    }
    const nameOf = (d) => d.name || d.title;
    const isDirty = (d) => !!d && d.gen !== d.savedGen;
    const byId = (id) => docs.find((d) => d.id === id) || null;

    /** The document's text as Markdown. Untouched since Visual took over, it's the original source, byte for byte. */
    function md(d) {
      if (!d) return '';
      if (!d.mounted) return d.pending;
      if (d.fallback) return d.fallback.value;
      const sbv = d.sourceBeforeVisual;
      if (sbv && sbv.gen === d.gen && d.editor.isWysiwygMode()) return sbv.text;
      return d.editor.getMarkdown();
    }

    function quietly(fn) { suppress++; try { return fn(); } finally { setTimeout(() => { suppress--; }, 0); } }

    function createEditor(d, text, mode) {
      if (!toastOk) {
        d.pane.append(el('div', { class: 'md-fallback' },
          el('p', { class: 'nui-muted', text: 'The visual editor didn\'t load. You can still edit and save plain Markdown here.' }),
          d.fallback = el('textarea', { 'aria-label': 'Markdown source', spellcheck: 'true' })));
        d.fallback.value = text;
        d.fallback.addEventListener('input', () => changed(d));
        return;
      }
      d.editor = new window.toastui.Editor({
        el: d.pane, height: '100%', minHeight: '200px',
        initialEditType: mode === 'wysiwyg' ? 'wysiwyg' : 'markdown',
        previewStyle: mode === 'split' ? 'vertical' : 'tab',
        initialValue: text, usageStatistics: false, hideModeSwitch: true, frontMatter: true, autofocus: false,
        theme: isDark() ? 'dark' : 'light', toolbarItems: [],
        plugins: [calloutPlugin],
        events: { change: () => changed(d) },
      });
      // Visual mode writes a typed [[wiki link]] as \[\[…\]\]; keep it a real link in the saved Markdown.
      d.editor.eventEmitter.listen('changeToolbarState', (p) => { if (d === cur) { fmtState = (p && p.toolbarState) || {}; renderTools(); } });
      d.editor.on('caretChange', () => { if (d === cur) renderTools(); });
      const conv = d.editor.convertor;
      if (conv && typeof conv.toMarkdownText === 'function') { const toMd = conv.toMarkdownText.bind(conv); conv.toMarkdownText = (...a) => unescapeWikiLinks(toMd(...a)); }
      setupSplitter(d);
    }

    /** Side by side: the divider between source and preview drags (double-click: half and half; ← → from the keyboard). */
    function setupSplitter(d) {
      const splitter = d.pane.querySelector('.toastui-editor-md-splitter');
      if (!splitter) return;
      Object.assign(splitter, { tabIndex: 0, title: 'Drag to share the room · double-click: half and half' });
      splitter.setAttribute('role', 'separator'); splitter.setAttribute('aria-orientation', 'vertical'); splitter.setAttribute('aria-label', 'Divider between source and preview');
      const container = splitter.parentElement;
      splitter.addEventListener('pointerdown', (e) => {
        e.preventDefault(); splitter.setPointerCapture(e.pointerId); box.classList.add('resizing');
        const move = (m) => { const r = container.getBoundingClientRect(); prefs.split = Math.min(0.75, Math.max(0.25, (m.clientX - r.left) / r.width)); applyPrefs(); };
        const up = () => { splitter.removeEventListener('pointermove', move); splitter.removeEventListener('pointerup', up); box.classList.remove('resizing'); setPrefs({ split: Math.round(prefs.split * 1000) / 1000 }); };
        splitter.addEventListener('pointermove', move); splitter.addEventListener('pointerup', up);
      });
      splitter.addEventListener('dblclick', () => setPrefs({ split: 0.5 }));
      splitter.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPrefs({ split: prefs.split + (e.key === 'ArrowLeft' ? -0.02 : 0.02) }); } });
    }

    /** The editor is made the first time its document is shown (many tabs open fast). */
    function mountDoc(d) {
      const text = normalizeText(d.pending);
      d.pending = '';
      let target = d.mode;
      let check = null;
      if (toastOk && target === 'wysiwyg' && text.trim()) {
        check = visualRoundTrip(text);
        if (!check.lossless) target = 'markdown';
      }
      quietly(() => {
        createEditor(d, target === 'wysiwyg' && toastOk ? joinInlineBreaks(text) : text, target);
        d.mounted = true;
        if (d.editor) { clearHistory(d.editor); if (d.editor.isMarkdownMode()) d.editor.setSelection([1, 1], [1, 1]); }
      });
      d.mode = toastOk ? target : 'markdown';
      d.pane.classList.toggle('mode-markdown', d.mode === 'markdown');
      d.pane.classList.toggle('mode-split', d.mode === 'split');
      d.sourceBeforeVisual = d.mode === 'wysiwyg' ? { text, gen: d.gen } : null;
      if (check && !check.lossless) {
        d.banner = { text: 'This file has Markdown the Visual view can\'t show exactly (raw HTML, footnotes, hard line breaks…), so it opened as Markdown and nothing gets rewritten.', acts: [['Use Visual anyway', () => setMode(d, 'wysiwyg', { force: true })], ['OK', () => hideBanner(d)]] };
      }
      applyTheme();
      applyPrefs();
    }

    /** Loading the text counts as an undoable step in the editor; a document starts with no history. */
    function clearHistory(ed) {
      for (const view of [ed.wwEditor && ed.wwEditor.view, ed.mdEditor && ed.mdEditor.view]) {
        if (!view) continue;
        try { const st = view.state; view.updateState(st.constructor.create({ doc: st.doc, selection: st.selection, plugins: st.plugins })); } catch (e) { console.error(e); }
      }
    }

    function changed(d) {
      if (suppress > 0 || !d.mounted) return;
      d.gen++;
      afterChange(d);
    }
    function afterChange(d) {
      renderTab(d);
      if (d === cur) { renderTitle(); clearTimeout(statusTimer); statusTimer = setTimeout(renderStatus, 200); clearTimeout(outlineTimer); outlineTimer = setTimeout(() => { sendOutline(); find.refresh(); }, 300); }
      clearTimeout(d.draftTimer);
      d.draftTimer = setTimeout(() => writeDraft(d), 600);
      publishDirty();
    }
    /** Unsaved work goes to a draft on the C# side; a saved (or undone back to saved) document has none. */
    function writeDraft(d) {
      clearTimeout(d.draftTimer); d.draftTimer = 0;
      if (!docs.includes(d)) return Promise.resolve();
      const p = isDirty(d) ? ctx.call('md.draft', { doc: d.id, markdown: md(d), title: d.title }) : ctx.call('md.dropDraft', { doc: d.id });
      return p.catch((e) => console.error(e));
    }

    function addDoc(d, { show = true } = {}) {
      docs.push(d);
      renderTabs();
      if (show) showDoc(d);
      keepSession();
      return d;
    }

    function showDoc(d, { focus = true } = {}) {
      if (!d) { cur = null; renderAll(); return; }
      cur = d;
      for (const x of docs) x.pane.hidden = x !== d;
      if (!d.mounted && toastOk !== null) mountDoc(d);   // (still loading the editor: it mounts when that's done)
      renderAll();
      find.refresh();
      if (focus && !find.isOpen()) setTimeout(() => focusEditor(), 0);
      keepSession();
      checkDisk(d);
    }
    function focusEditor() { if (!cur) return; if (cur.editor) cur.editor.focus(); else if (cur.fallback) cur.fallback.focus(); }

    function renderAll() {
      fmtState = {};
      renderTabs(); renderModes(); renderTools(); renderBanner(); renderTitle(); renderStatus(); sendOutline();
      emptyEl.hidden = docs.length > 0;
      if (!docs.length) renderEmpty();
    }

    // ------------------------------------------------------------ the strip of document tabs
    function renderTabs() {
      tabsEl.replaceChildren(...docs.map((d) => {
        const t = el('div', { class: 'md-tab', role: 'tab', 'data-doc': d.id, 'aria-selected': String(d === cur), title: d.path || 'Not saved yet',
          onclick: () => showDoc(d), onauxclick: (e) => { if (e.button === 1) closeDoc(d); },
          oncontextmenu: (e) => { e.preventDefault(); tabMenu(d, e.clientX, e.clientY); },
          ondblclick: (e) => { if (!d.path && !e.target.closest('.x')) nameDoc(d); } });
        renderTabInto(t, d);
        dragTab(t, d);
        return t;
      }));
      const sel = tabsEl.querySelector('[aria-selected=true]');
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function renderTabInto(t, d) {
      t.replaceChildren(el('span', { class: 'name', text: nameOf(d) }), isDirty(d) ? el('span', { class: 'dot', title: 'Unsaved changes', text: '●' }) : '',
        el('span', { class: 'x', role: 'button', title: 'Close the document (Ctrl+W)', 'aria-label': `Close ${nameOf(d)}`, onclick: (e) => { e.stopPropagation(); closeDoc(d); } }, '✕'));
      t.title = d.path || 'Not saved yet';
    }
    function tabMenu(d, x, y) {
      const i = docs.indexOf(d);
      menu(x, y, [
        { label: 'Close', keys: 'Ctrl+W', run: () => closeDoc(d) },
        { label: 'Close the others', disabled: docs.length < 2, run: () => closeMany(docs.filter((o) => o !== d)) },
        { label: 'Close the ones to the right', disabled: i >= docs.length - 1, run: () => closeMany(docs.slice(i + 1)) },
        '-',
        { label: 'Name it…', disabled: !!d.path, run: () => nameDoc(d) },
        { label: 'Copy the path', disabled: !d.path, run: () => navigator.clipboard.writeText(d.path).then(() => ctx.toast('Path copied.')).catch((e) => ctx.toast(e.message, { error: true })) },
        { label: 'Show in Explorer', disabled: !d.path, run: () => ctx.call('md.reveal', { doc: d.id }).catch((e) => ctx.toast(e.message, { error: true })) },
        { label: 'Reload from disk', disabled: !d.path, run: () => reload(d) },
      ], { anchor: tabsEl });
    }
    async function closeMany(list) { for (const d of [...list]) if (!(await closeDoc(d))) return false; return true; }
    /** A new document's name: shown on its tab, and offered as the file name when it's first saved. */
    async function nameDoc(d) {
      let input;
      const ok = await ctx.dialog('Name the document', el('label', { class: 'md-linkfield' }, el('span', { text: 'Its name (also the file name it gets when you first save it)' }),
        input = el('input', { class: 'nui-field', type: 'text', value: d.title, onkeydown: (e) => { if (e.key === 'Enter') e.target.closest('.nui-dialog').querySelector('.nui-btn.primary').click(); } })),
        [{ label: 'Cancel', value: null }, { label: 'Name it', value: true, primary: true }]);
      const name = ok && input.value.trim();
      if (!name || d.path) return;
      d.title = name.slice(0, 120);
      renderTab(d); if (d === cur) { renderTitle(); sendOutline(); }
      keepSession();
      if (isDirty(d)) writeDraft(d);
    }
    function renderTab(d) { const t = tabsEl.querySelector(`.md-tab[data-doc="${d.id}"]`); if (t) renderTabInto(t, d); }
    /** Tabs reorder by dragging. */
    function dragTab(t, d) {
      t.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.x')) return;
        const startX = e.clientX; let moving = false;
        const move = (m) => {
          if (!moving && Math.abs(m.clientX - startX) < 6) return;
          moving = true; t.classList.add('dragging');
          const over = document.elementFromPoint(m.clientX, m.clientY);
          const other = over && over.closest && over.closest('.md-tab');
          if (!other || other === t) return;
          const od = byId(other.dataset.doc), i = docs.indexOf(d), j = docs.indexOf(od);
          docs.splice(i, 1); docs.splice(j, 0, d);
          if (j > i) other.after(t); else other.before(t);
        };
        const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); t.classList.remove('dragging'); if (moving) keepSession(); };
        document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
      });
    }

    // ------------------------------------------------------------ the formatting bar
    let fmtState = {};
    const headingNames = ['Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'];
    function buildTools() {
      const kids = [];
      for (const t of TOOLS) {
        if (t === '|') { kids.push(el('span', { class: 'md-sep', 'aria-hidden': 'true' })); continue; }
        if (t === 'heading') {
          kids.push(el('button', { class: 'md-tool md-heading', 'data-cmd': 'heading', 'aria-haspopup': 'menu', title: 'Paragraph style (Ctrl+Shift+0…6)', onmousedown: (e) => e.preventDefault(), onclick: (e) => headingMenu(e.currentTarget) },
            icon('heading'), el('span', { class: 'lbl', text: 'Text' }), el('span', { class: 'caret', 'aria-hidden': 'true', text: '▾' })));
          continue;
        }
        const [cmd, ic, label, keys, stateKey] = t;
        kids.push(el('button', { class: 'md-tool', 'data-cmd': cmd, 'data-state': stateKey || '', title: keys ? `${label} (${keys})` : label, 'aria-label': label, ...(stateKey ? { 'aria-pressed': 'false' } : {}),
          onmousedown: (e) => e.preventDefault(),   // the editor keeps its selection
          onclick: () => commands && commands[cmd]() }, icon(ic)));
      }
      toolsEl.replaceChildren(...kids);
    }
    function headingMenu(button) {
      const r = button.getBoundingClientRect(), now = headingLevel();
      menu(r.left, r.bottom + 2, headingNames.map((n, lvl) => ({ label: n, keys: `Ctrl+Shift+${lvl}`, checked: () => lvl === now, run: () => setHeading(lvl) })), { anchor: toolsEl });
    }
    /** The heading level where the cursor is (0: plain text). */
    function headingLevel() {
      const ed = cur && cur.editor;
      if (!ed) return 0;
      try {
        if (ed.isWysiwygMode()) {
          const view = ed.wwEditor && ed.wwEditor.view;
          const node = view && view.state.selection.$from.parent;
          return node && node.type.name === 'heading' ? node.attrs.level : 0;
        }
        const [[line]] = ed.getSelection();
        const text = ed.getMarkdown().split('\n')[line - 1] || '';
        const m = text.match(/^\s{0,3}(#{1,6})\s/);
        return m ? m[1].length : 0;
      } catch { return 0; }
    }
    function setHeading(level) {
      if (!cur || !cur.editor) return;
      cur.editor.focus();
      try { cur.editor.exec('heading', { level }); } catch (e) { console.error(e); }
      renderTools();
    }
    function renderTools() {
      const on = !!(cur && cur.editor);
      for (const b of toolsEl.querySelectorAll('.md-tool')) {
        b.disabled = !on && !['md.new', 'md.open'].includes(b.dataset.cmd);
        if (b.dataset.state) b.setAttribute('aria-pressed', String(on && !!fmtState[b.dataset.state]));
      }
      const lbl = toolsEl.querySelector('.md-heading .lbl');
      if (lbl) lbl.textContent = headingNames[on ? headingLevel() : 0];
    }
    buildTools();

    function renderModes() {
      for (const b of modesEl.querySelectorAll('button')) { b.setAttribute('aria-pressed', String(!!cur && cur.mode === b.dataset.mode)); b.disabled = !cur || !cur.editor; }
    }
    function renderBanner() {
      const b = cur && cur.banner;
      bannerEl.hidden = !b;
      if (b) bannerEl.replaceChildren(el('span', { text: b.text }), el('span', { class: 'acts' }, ...b.acts.map(([label, run]) => el('button', { class: 'nui-btn', onclick: run }, label))));
    }
    function hideBanner(d) { d.banner = null; renderBanner(); }
    function renderTitle() { ctx.setTitle(cur ? `${nameOf(cur)}${isDirty(cur) ? ' ●' : ''}` : ''); }
    function renderStatus() {
      if (!cur) { ctx.setStatus(docs.length ? '' : 'Nothing open'); return; }
      const s = stats(md(cur));
      ctx.setStatus(`${s.words.toLocaleString()} word${s.words === 1 ? '' : 's'} · ${s.words ? s.minutes : 0} min read · ${modeName(cur.mode)} · ${cur.format} · ${isDirty(cur) ? (cur.path ? 'Unsaved changes' : 'Not saved yet') : cur.path ? 'Saved' : 'Empty draft'}`);
    }
    function sendOutline() {
      const text = cur ? md(cur) : '';
      const hs = cur ? headings(text) : [];
      lastOutline = cur ? { title: nameOf(cur), items: hs } : { title: '', items: [] };
      ctx.emit('outline', lastOutline);
      publishCurrent();
      // The Statistics and History panels hear about the document on screen too.
      if (cur) {
        const st = stats(text);
        const body = text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ' ');
        lastStats = {
          doc: cur.id, title: nameOf(cur), path: cur.path, words: st.words, characters: text.length,
          charactersNoSpaces: text.replace(/\s/g, '').length, minutes: st.words ? st.minutes : 0,
          headings: hs.length, paragraphs: body.split(/\n\s*\n/).filter((x) => x.trim()).length, goal: Math.max(1, Number(prefs.goal) || 750),
        };
      } else lastStats = null;
      ctx.emit('stats', lastStats);
      lastProps = cur ? { doc: cur.id, title: nameOf(cur), items: properties(text) } : null;
      ctx.emit('props', lastProps);
    }
    /** A property changed in the Properties panel: the front matter is rewritten (Ctrl+Z undoes it in the Markdown view). */
    function applyProperty(p) {
      if (!p || !cur || cur.id !== p.doc || !cur.editor) return;
      const d = cur, ed = d.editor;
      const before = md(d), after = setProperty(before, p.key, p.value);
      if (after === before) return;
      if (ed.isWysiwygMode()) { ed.setMarkdown(joinInlineBreaks(after), false); d.sourceBeforeVisual = null; }
      else { const ls = ed.getMarkdown().split('\n'); ed.replaceSelection(after, [1, 1], [ls.length, ls[ls.length - 1].length + 1]); }
      sendOutline();
    }
    /** Extract to a new note: the selection becomes a note of its own (next to this one, in the vault), and a [[link]] to it. */
    async function extractSelection() {
      if (!cur || !cur.editor) return;
      if (!ctx.hasBench || !ctx.hasBench('noor.vault')) { ctx.toast('Extracting to a new note needs the Vault bench.'); return; }
      const ed = cur.editor;
      const selected = ed.getSelectedText ? ed.getSelectedText() : '';
      if (!selected.trim()) { ctx.toast('Select the text to move into a new note first.'); return; }
      const first = selected.split('\n').find((l) => l.trim()) || 'New note';
      const guess = first.replace(/^[#>\-*+\s\d.]+/, '').replace(/[<>:"/\\|?*#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '') || 'New note';
      let input;
      const name = await ctx.dialog('Extract to a new note', el('label', { class: 'md-linkfield' }, el('span', { text: 'The new note\'s name (the selection moves into it, and a [[link]] to it stays here)' }),
        input = el('input', { class: 'nui-field', type: 'text', value: guess, onkeydown: (e) => { if (e.key === 'Enter') e.target.closest('.nui-dialog').querySelector('.nui-btn.primary').click(); } })),
        [{ label: 'Cancel', value: null }, { label: 'Extract', value: 'ok', primary: true }]).then((v) => (v ? input.value.trim() : ''));
      if (!name) { ed.focus(); return; }
      const markdown = selected.endsWith('\n') ? selected : selected + '\n';
      let r;
      try { r = await ctx.callBench('noor.vault', 'vault.extract', { from: cur.path || '', name, markdown }); } catch (e) { ctx.toast(e.message, { error: true }); ed.focus(); return; }
      ed.focus();
      ed.replaceSelection(`[[${r.name}]]`);
      ctx.toast(`Moved into “${r.name}”.`);
    }

    async function renderEmpty() {
      const recent = await ctx.call('md.recentList').catch(() => []);
      if (docs.length) return;
      emptyEl.replaceChildren(
        el('h2', { text: 'Nothing open yet' }),
        el('p', { text: 'Start something new, or open a Markdown file. Unsaved work is kept as a draft, even when NoorMD closes.' }),
        el('div', { class: 'acts' }, el('button', { class: 'nui-btn primary', onclick: () => newDoc() }, 'New document'), el('button', { class: 'nui-btn', onclick: () => openFiles() }, 'Open…')),
        recent.length ? el('div', { class: 'recent' }, el('p', { text: 'Recent' }), ...recent.slice(0, 8).map((r) => recentItem(r, () => openPath(r.path), () => renderEmpty()))) : '');
    }
    function recentItem(r, open, after) {
      return el('div', { class: 'md-recent-item' + (r.exists ? '' : ' gone'), role: 'button', tabindex: '0', title: r.exists ? r.path : `${r.path} (not there any more)`, onclick: () => (r.exists ? open() : null), onkeydown: (e) => { if (e.key === 'Enter' && r.exists) open(); } },
        el('span', { class: 'n', text: r.name }), el('span', { class: 'f', text: r.folder }),
        el('button', { class: 'nui-icon x', title: 'Forget it', 'aria-label': `Forget ${r.name}`, onclick: async (e) => { e.stopPropagation(); await ctx.call('md.recentForget', { path: r.path }); after(); } }, '✕'));
    }

    // ------------------------------------------------------------ the session: open documents come back next time
    function keepSession(moving = false) {
      // Moving to another window, a document that was never saved and has no changes (the welcome, a new one) takes
      // its text along: it has no file and no draft to come back from.
      const carry = (d) => (moving && !d.path && !isDirty(d) && md(d).length <= 20000 ? { text: md(d) } : {});
      ctx.keep('docs', docs.map((d) => ({ id: d.id, path: d.path, name: d.name, title: d.title, mode: d.mode, ...carry(d) })));
      ctx.keep('active', cur ? cur.id : null);
    }
    async function restoreSession() {
      const kept = ctx.restore('docs', []);
      const want = ctx.restore('active', null);
      let back = 0;
      for (const k of Array.isArray(kept) ? kept : []) {
        if (!k || typeof k.id !== 'string') continue;
        try {
          const draft = await ctx.call('md.resume', { doc: k.id });
          if (draft) {
            const d = makeDoc({ id: k.id, path: draft.path, name: draft.name, title: draft.title || k.title, mode: k.mode, format: draft.format });
            d.pending = draft.markdown; d.gen = 1; back++;
            addDoc(d, { show: false });
          } else if (!k.path && typeof k.text === 'string') {
            const d = makeDoc({ id: k.id, title: k.title, mode: k.mode });
            d.pending = k.text;
            addDoc(d, { show: false });
          } else if (k.path) {
            const r = await ctx.call('md.load', { doc: k.id, path: k.path });
            const d = makeDoc({ id: k.id, path: r.path, name: r.name, mode: k.mode, format: r.format });
            d.pending = r.markdown; d.warning = r.warning;
            addDoc(d, { show: false });
          }
        } catch (e) { ctx.toast(`${k.name || k.title || 'A document'} couldn't come back: ${e.message}`, { error: true }); }
      }
      if (!docs.length && !ctx.restore('welcomed', false)) { ctx.keep('welcomed', true); openWelcome({ focus: false }); }
      showDoc(byId(want) || docs[0] || null, { focus: false });
      if (back && !arrived) ctx.toast(`${back === 1 ? 'A document' : back + ' documents'} came back with unsaved changes.`);
      // Drafts nobody owns (left by a crash): offer them.
      const orphans = await ctx.call('md.drafts', { except: docs.map((d) => d.id) }).catch(() => []);
      if (orphans.length) offerOrphans(orphans);
    }
    function offerOrphans(list) {
      const b = { text: `Unsaved work from before: ${list.length === 1 ? `“${list[0].title}”` : `${list.length} documents`}.`, acts: [['Bring it back', () => recoverDrafts(list)], ['Throw it away', async () => { for (const o of list) await ctx.call('md.dropDraft', { doc: o.id }); dropBanner(); }]] };
      const dropBanner = () => { for (const d of docs) if (d.banner === b) d.banner = null; orphanBanner = null; renderBanner(); };
      orphanBanner = b;
      if (cur) { cur.banner = b; renderBanner(); } else renderEmptyBanner(b);
    }
    let orphanBanner = null;
    function renderEmptyBanner(b) { bannerEl.hidden = false; bannerEl.replaceChildren(el('span', { text: b.text }), el('span', { class: 'acts' }, ...b.acts.map(([l, run]) => el('button', { class: 'nui-btn', onclick: run }, l)))); }
    async function recoverDrafts(list) {
      for (const o of list) {
        const draft = await ctx.call('md.resume', { doc: o.id }).catch(() => null);
        if (!draft) continue;
        const d = makeDoc({ id: o.id, path: draft.path, name: draft.name, title: draft.title, format: draft.format });
        d.pending = draft.markdown; d.gen = 1;
        addDoc(d, { show: false });
      }
      for (const d of docs) if (d.banner === orphanBanner) d.banner = null;
      orphanBanner = null;
      bannerEl.hidden = true;
      showDoc(docs[docs.length - 1]);
    }

    // ------------------------------------------------------------ file commands
    /** The welcome document: a new, unsaved document with the tour in it. */
    function openWelcome({ focus = true } = {}) {
      const d = makeDoc({ title: 'Welcome to Markdown', mode: 'wysiwyg' });
      d.pending = WELCOME;
      return addDoc(d, { show: focus });
    }
    function newDoc() { return addDoc(makeDoc({ mode: ctx.restore('newMode', 'wysiwyg') })); }

    async function openFiles() {
      const paths = await ctx.call('md.pick');
      for (const p of paths || []) await openPath(p);
    }
    async function openPath(path) {
      const already = docs.find((d) => samePath(d.path, path));
      if (already) { showDoc(already); return already; }
      try {
        const id = newId();
        const r = await ctx.call('md.load', { doc: id, path });
        const d = makeDoc({ id, path: r.path, name: r.name, format: r.format });
        d.pending = r.markdown;
        // An empty untitled document nobody typed in gives its place to the opened file.
        if (cur && !cur.path && !isDirty(cur) && !md(cur).trim()) await closeDoc(cur, { quiet: true });
        addDoc(d);
        if (r.warning) { d.banner = { text: r.warning, acts: [['OK', () => hideBanner(d)]] }; renderBanner(); }
        return d;
      } catch (e) { ctx.toast(e.message, { error: true }); return null; }
    }

    /** Saves; true when it's on disk. A new document asks where to go. */
    async function save(d = cur, { as = false } = {}) {
      if (!d) return false;
      const text = md(d), gen = d.gen;
      clearTimeout(d.draftTimer);
      let r;
      try {
        if (as || !d.path) r = await ctx.call('md.writeAs', { doc: d.id, markdown: text, title: d.title });
        else {
          r = await ctx.call('md.write', { doc: d.id, markdown: text });
          if (r && r.conflict) {
            const what = await ctx.dialog('Changed by another program', el('p', { text: `“${nameOf(d)}” was changed on disk since you opened it. Saving now replaces those changes with yours.` }),
              [{ label: 'Cancel', value: null }, { label: 'Save as a copy…', value: 'copy' }, { label: 'Replace them', value: 'overwrite', primary: true }]);
            if (what === 'overwrite') r = await ctx.call('md.write', { doc: d.id, markdown: text, overwrite: true });
            else if (what === 'copy') r = await ctx.call('md.writeAs', { doc: d.id, markdown: text, title: d.title });
            else r = null;
          } else if (r && r.needsPath) r = await ctx.call('md.writeAs', { doc: d.id, markdown: text, title: d.title });
        }
      } catch (e) { ctx.toast(`“${nameOf(d)}” wasn't saved: ${e.message}`, { error: true }); writeDraft(d); return false; }
      if (!r || !r.path) { if (isDirty(d)) writeDraft(d); return false; }
      d.path = r.path; d.name = r.name; d.format = r.format || d.format; d.savedGen = gen; d.diskNoticed = false;
      if (d.banner && /changed by another program/.test(d.banner.text)) d.banner = null;
      if (d.gen !== gen) writeDraft(d);   // typed while it was saving: those words are still unsaved
      renderTab(d); if (d === cur) { renderTitle(); renderStatus(); sendOutline(); renderBanner(); }
      keepSession(); publishDirty();
      return true;
    }
    async function saveAll() {
      let n = 0;
      for (const d of docs.filter(isDirty)) { if (!(await save(d))) return false; n++; }
      if (n) ctx.toast(`Saved ${n} document${n === 1 ? '' : 's'}.`);
      return true;
    }

    /** Closes a document; asks first when it has unsaved changes. True when it's closed. */
    async function closeDoc(d = cur, { quiet = false } = {}) {
      if (!d) return false;
      if (isDirty(d) && !quiet) {
        showDoc(d, { focus: false });
        const what = await ctx.dialog('Unsaved changes', el('p', { text: `Save the changes to “${nameOf(d)}” before closing it?` }),
          [{ label: 'Cancel', value: null }, { label: 'Don\'t save', value: 'discard' }, { label: 'Save', value: 'save', primary: true }]);
        if (!what) return false;
        if (what === 'save' && !(await save(d))) return false;
      }
      clearTimeout(d.draftTimer);
      const i = docs.indexOf(d);
      docs.splice(i, 1);
      try { d.editor && d.editor.destroy(); } catch (e) { console.error(e); }
      d.pane.remove();
      await ctx.call('md.closeDoc', { doc: d.id }).catch((e) => console.error(e));
      if (cur === d) showDoc(docs[Math.min(i, docs.length - 1)] || null);
      else renderAll();
      keepSession();
      return true;
    }

    /** The file as it is on disk now, replacing what's in the editor (asks first when that has unsaved changes). */
    async function reload(d, { silent = false } = {}) {
      if (!d || !d.path) return false;
      if (isDirty(d) && !silent) {
        const ok = await ctx.dialog('Reload from disk', el('p', { text: `Reloading “${nameOf(d)}” throws away the changes you haven't saved (a snapshot keeps them in History, just in case).` }), [{ label: 'Cancel', value: false }, { label: 'Reload', value: true, primary: true }]);
        if (!ok) return false;
        await takeSnapshot(d, 'Before reloading from disk', { quiet: true });
      }
      let r;
      try { r = await ctx.call('md.load', { doc: d.id, path: d.path }); } catch (e) { if (!silent) ctx.toast(e.message, { error: true }); return false; }
      clearTimeout(d.draftTimer);
      try { d.editor && d.editor.destroy(); } catch { /* gone */ }
      d.pane.replaceChildren(); d.editor = null; d.fallback = null; d.mounted = false;
      d.pending = r.markdown; d.format = r.format; d.gen = 0; d.savedGen = 0; d.banner = null; d.diskNoticed = false;
      if (d === cur) mountDoc(d);
      renderAll(); writeDraft(d); publishDirty();
      return true;
    }
    /** Another program changed (or moved) the file since it was opened or saved here: say so, once. */
    async function checkDisk(d, { quiet = false } = {}) {
      if (!d || !d.path || d.diskNoticed) return;
      const changedOnDisk = await ctx.call('md.changed', { doc: d.id }).catch(() => false);
      if (!changedOnDisk || !docs.includes(d) || d.diskNoticed) return;
      if (!isDirty(d) && await reload(d, { silent: true })) { if (!quiet) ctx.toast(`“${nameOf(d)}” changed on disk; it's up to date here.`); return; }
      d.diskNoticed = true;
      d.banner = { text: `“${nameOf(d)}” was changed by another program.${isDirty(d) ? ' You have unsaved changes here too.' : ''}`, acts: [['Reload', () => reload(d)], ['Keep mine', () => hideBanner(d)]] };
      if (d === cur) renderBanner();
    }
    const onWindowFocus = () => { if (cur) checkDisk(cur); };
    window.addEventListener('focus', onWindowFocus);

    // ------------------------------------------------------------ what other benches hear (the Vault's panels follow along)
    let lastCurrent = '', lastDirty = '';
    function publishCurrent() {
      const v = cur ? { id: cur.id, path: cur.path, title: nameOf(cur) } : null;
      const key = JSON.stringify(v);
      if (key !== lastCurrent) { lastCurrent = key; ctx.publish('doc.current', v); }
    }
    function publishDirty() {
      const paths = docs.filter((d) => isDirty(d) && d.path).map((d) => d.path);
      const key = paths.join('|');
      if (key !== lastDirty) { lastDirty = key; ctx.publish('docs.dirty', { paths }); }
    }

    // ------------------------------------------------------------ wiki links: [[ suggests notes, Ctrl+click follows
    const wiki = { box: null, items: [], index: 0, query: '', notes: null, notesAt: 0, seq: 0 };
    async function vaultNotes() {
      if (!ctx.hasBench || !ctx.hasBench('noor.vault')) return [];
      if (wiki.notes && Date.now() - wiki.notesAt < 4000) return wiki.notes;
      wiki.notes = await ctx.callBench('noor.vault', 'vault.notes').catch(() => []);
      wiki.notesAt = Date.now();
      return wiki.notes;
    }
    function caretText() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed || !cur) return null;
      const n = sel.anchorNode;
      if (!n || n.nodeType !== 3 || !cur.pane.contains(n)) return null;
      return n.textContent.slice(0, sel.anchorOffset);
    }
    function closeWiki() { if (wiki.box) { wiki.box.remove(); wiki.box = null; } wiki.items = []; }
    async function suggestWiki() {
      const before = caretText();
      // [[Note#… : the note's headings.
      const hm = before && /\[\[([^[\]\n|#]{1,80})#([^[\]\n|]{0,80})$/.exec(before);
      if (hm) {
        const seq = ++wiki.seq;
        const hs = ctx.hasBench && ctx.hasBench('noor.vault') ? await ctx.callBench('noor.vault', 'vault.headings', { from: cur && cur.path ? cur.path : '', target: hm[1] }).catch(() => []) : [];
        if (seq !== wiki.seq) return;
        const lq = hm[2].toLowerCase();
        const found = hs.filter((h) => h.text.toLowerCase().includes(lq)).slice(0, 10).map((h) => ({ name: '#'.repeat(h.level) + ' ' + h.text, path: `in ${hm[1]}`, insert: h.text }));
        showWiki(found, hm[2]);
        return;
      }
      const m = before && /\[\[([^[\]\n|#]{0,80})$/.exec(before);
      if (!m) { closeWiki(); return; }
      const seq = ++wiki.seq, q = m[1];
      const notes = await vaultNotes();
      if (seq !== wiki.seq) return;
      const lq = q.toLowerCase();
      const names = new Map();
      for (const n of notes) names.set(n.name.toLowerCase(), (names.get(n.name.toLowerCase()) || 0) + 1);
      const found = notes.filter((n) => n.name.toLowerCase().includes(lq) || n.path.toLowerCase().includes(lq))
        .sort((a, b) => (b.name.toLowerCase().startsWith(lq) - a.name.toLowerCase().startsWith(lq)) || a.name.localeCompare(b.name)).slice(0, 8)
        .map((n) => ({ ...n, insert: names.get(n.name.toLowerCase()) > 1 ? n.path.replace(/\.(md|markdown|mdown|mkd)$/i, '') : n.name }));
      // Aliases: [[Ada]] → [[Ada Lovelace|Ada]].
      if (lq) for (const n of notes) for (const a of n.aliases || []) if (a.toLowerCase().includes(lq) && found.length < 10) found.push({ name: a, path: `→ ${n.name}`, insert: `${n.name}|${a}` });
      showWiki(found, q);
    }
    function showWiki(found, q) {
      if (!found.length) { closeWiki(); return; }
      wiki.items = found; wiki.index = 0; wiki.query = q;
      const sel = window.getSelection();
      const rects = sel.rangeCount ? sel.getRangeAt(0).getClientRects() : [];
      const r = rects.length ? rects[0] : cur.pane.getBoundingClientRect();
      if (!wiki.box) { wiki.box = el('div', { class: 'md-wiki', role: 'listbox', 'aria-label': 'Notes in the vault' }); document.body.append(wiki.box); }
      wiki.box.style.left = Math.min(r.left, window.innerWidth - 320) + 'px';
      wiki.box.style.top = (r.bottom + 4) + 'px';
      drawWiki();
    }
    function drawWiki() {
      if (!wiki.box) return;
      wiki.box.replaceChildren(...wiki.items.map((n, i) => el('div', { class: 'md-wiki-item', role: 'option', 'aria-selected': String(i === wiki.index),
        onmousedown: (e) => { e.preventDefault(); chooseWiki(i); } }, el('span', { class: 'n', text: n.name }), el('span', { class: 'p', text: n.path }))));
    }
    function chooseWiki(i) {
      const n = wiki.items[i];
      if (!n || !cur || !cur.editor) { closeWiki(); return; }
      const ed = cur.editor, len = wiki.query.length;
      closeWiki();
      try {
        if (ed.isWysiwygMode()) { const [, to] = ed.getSelection(); ed.replaceSelection(n.insert + ']]', to - len, to); }
        else { const [, [l, c]] = ed.getSelection(); ed.replaceSelection(n.insert + ']]', [l, c - len], [l, c]); }
      } catch (e) { console.error(e); }
      ed.focus();
    }
    /** The [[link]] under the pointer (Ctrl+click): its target, or null. */
    function linkAt(x, y) {
      const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      if (!range || range.startContainer.nodeType !== 3) return null;
      const text = range.startContainer.textContent, at = range.startOffset;
      for (const m of text.matchAll(/!?\[\[([^[\]\n]+?)\]\]/g)) {
        if (at >= m.index && at <= m.index + m[0].length) return m[1].split('|')[0].trim();
      }
      return null;
    }
    async function followLink(target) {
      if (!ctx.hasBench || !ctx.hasBench('noor.vault')) { ctx.toast('Wiki links need the Vault bench.'); return; }
      let r;
      try { r = await ctx.callBench('noor.vault', 'vault.openLink', { from: cur && cur.path ? cur.path : '', target }); } catch (e) { ctx.toast(e.message, { error: true }); return; }
      if (r.opened && r.heading) {
        // The note may be on screen already (its "opened" can arrive before this answer): go there now, or once it opens.
        pendingGoto = { path: r.full, heading: r.heading };
        const open = docs.find((d) => samePath(d.path, r.full));
        if (open) { if (open !== cur) showDoc(open); setTimeout(maybeGoto, 50); }
      }
      if (r.noVault) { ctx.toast('Open a vault (the Vault bench) to follow [[links]].'); return; }
      if (r.outside) { ctx.toast('This document isn\'t in the open vault, so its [[links]] lead nowhere.'); return; }
      if (r.missing) {
        const where = r.folder ? `in “${r.folder}”` : 'at the top of the vault';
        const ok = await ctx.dialog('Make the note?', el('p', { text: `There's no note called “${r.name.replace(/\.md$/i, '')}” yet. Make it ${where}?` }), [{ label: 'Cancel', value: false }, { label: 'Make it', value: true, primary: true }]);
        if (ok) ctx.callBench('noor.vault', 'vault.createLink', { from: cur && cur.path ? cur.path : '', target }).catch((e) => ctx.toast(e.message, { error: true }));
      }
    }
    // ------------------------------------------------------------ going to a heading (a [[Note#Heading]] followed)
    let pendingGoto = null;
    function goToHeadingText(text) {
      if (!cur) return false;
      const i = headings(md(cur)).findIndex((h) => h.text.toLowerCase() === String(text).toLowerCase());
      if (i < 0) return false;
      setTimeout(() => goToHeading(i), 60);
      return true;
    }
    function maybeGoto() {
      if (!pendingGoto || !cur || !samePath(cur.path, pendingGoto.path)) return;
      const h = pendingGoto.heading; pendingGoto = null;
      goToHeadingText(h);
    }

    // ------------------------------------------------------------ hover preview: Ctrl over a [[link]]
    let hoverBox = null, hoverTarget = '', hoverTimer = 0, hoverSeq = 0;
    function hideHover() { clearTimeout(hoverTimer); hoverTarget = ''; if (hoverBox) { hoverBox.remove(); hoverBox = null; } }
    docsEl.addEventListener('mousemove', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !ctx.hasBench || !ctx.hasBench('noor.vault')) { if (hoverBox && !e.ctrlKey) hideHover(); return; }
      const target = linkAt(e.clientX, e.clientY);
      if (!target) { if (hoverTarget) hideHover(); return; }
      if (target === hoverTarget) return;
      hideHover(); hoverTarget = target;
      const x = e.clientX, y = e.clientY, seq = ++hoverSeq;
      hoverTimer = setTimeout(async () => {
        const r = await ctx.callBench('noor.vault', 'vault.preview', { from: cur && cur.path ? cur.path : '', target }).catch(() => null);
        if (!r || seq !== hoverSeq || hoverTarget !== target) return;
        await loadPurify();
        hoverBox = el('div', { class: 'md-hover', role: 'tooltip' });
        if (r.missing) hoverBox.append(el('div', { class: 'md-hover-title', text: `${r.name}` }), el('p', { class: 'nui-muted', text: 'There\'s no note by that name yet. Ctrl+click to make it.' }));
        else {
          const body = el('div', { class: 'md-hover-body toastui-editor-contents' });
          body.innerHTML = renderSafe(r.markdown);
          hoverBox.append(el('div', { class: 'md-hover-title', text: r.heading ? `${r.name} › ${r.heading}` : r.name }), body);
        }
        document.body.append(hoverBox);
        const b = hoverBox.getBoundingClientRect();
        hoverBox.style.left = Math.max(8, Math.min(x + 12, innerWidth - b.width - 8)) + 'px';
        hoverBox.style.top = (y + 18 + b.height > innerHeight ? Math.max(8, y - b.height - 12) : y + 18) + 'px';
      }, 220);
    });
    docsEl.addEventListener('mouseleave', hideHover);
    window.addEventListener('keyup', (e) => { if (e.key === 'Control' || e.key === 'Meta') hideHover(); });

    docsEl.addEventListener('keyup', (e) => { if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key) || !wiki.box) suggestWiki(); });
    docsEl.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey)) { closeWiki(); return; }
      const target = linkAt(e.clientX, e.clientY);
      if (!target) return;
      e.preventDefault(); e.stopPropagation();
      followLink(target);
    }, true);

    // ------------------------------------------------------------ snapshots (History)
    async function takeSnapshot(d = cur, label = null, { quiet = false } = {}) {
      if (!d) return null;
      try {
        const s2 = await ctx.call('md.snapTake', { doc: d.id, markdown: md(d), title: nameOf(d), label: label || `Snapshot, ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` });
        if (!quiet) ctx.toast('Snapshot taken ✓');
        ctx.emit('snaps.changed', { doc: d.id });
        return s2;
      } catch (e) { ctx.toast(e.message, { error: true }); return null; }
    }
    async function viewSnapshot(id) {
      if (!cur) return;
      const d = cur;
      let s2;
      try { s2 = await ctx.call('md.snapGet', { doc: d.id, id }); } catch (e) { ctx.toast(e.message, { error: true }); return; }
      await loadPurify();
      const preview = el('div', { class: 'md-snap-preview toastui-editor-contents' });
      preview.innerHTML = renderSafe(s2.markdown);
      const what = await ctx.dialog(s2.label, el('div', {}, el('p', { class: 'nui-muted', text: `${new Date(s2.createdUtc).toLocaleString()} · ${s2.words} words` }), preview),
        [{ label: 'Close', value: null }, { label: 'Copy its Markdown', value: 'copy' }, { label: 'Bring it back', value: 'restore', primary: true }]);
      if (what === 'copy') navigator.clipboard.writeText(s2.markdown).then(() => ctx.toast('Copied.')).catch(() => {});
      if (what === 'restore') restoreSnapshot(id, s2);
    }
    /** The snapshot's text replaces the document's, after a snapshot of what's there (the editor can't undo a whole-text swap). */
    async function restoreSnapshot(id, got = null) {
      if (!cur || !cur.editor) return;
      const d = cur;
      let s2 = got;
      try { s2 = s2 || await ctx.call('md.snapGet', { doc: d.id, id }); } catch (e) { ctx.toast(e.message, { error: true }); return; }
      await takeSnapshot(d, `Before bringing back “${s2.label}”`, { quiet: true });
      const ed = d.editor;
      const text = ed.isWysiwygMode() ? joinInlineBreaks(s2.markdown) : s2.markdown;
      ed.setMarkdown(text, false);
      d.sourceBeforeVisual = null;
      ed.focus();
      ctx.toast(`Brought back “${s2.label}”. What you had is in History, as a snapshot.`);
    }

    // ------------------------------------------------------------ export and print
    const exportTitle = (d) => (d.name ? d.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') : d.title);
    async function exportHtml() {
      if (!cur) return;
      await loadPurify();
      try { const r = await ctx.call('md.exportHtml', { title: exportTitle(cur), bodyHtml: renderSafe(md(cur)) }); if (r) ctx.toast(`Exported to ${r.path}`); }
      catch (e) { ctx.toast(e.message, { error: true }); }
    }
    async function exportPdf() {
      if (!cur) return;
      await loadPurify();
      ctx.setPrintContent(`<h1 class="print-title" hidden></h1>${renderSafe(md(cur))}`);
      try { const r = await ctx.call('md.exportPdf', { title: exportTitle(cur) }); if (r) ctx.toast(`Exported to ${r.path}`); }
      catch (e) { ctx.toast(e.message, { error: true }); }
    }
    async function printDoc() {
      if (!cur) return;
      await loadPurify();
      ctx.print(renderSafe(md(cur)));
    }
    function copyMarkdown() {
      if (!cur) return;
      const text = md(cur);
      navigator.clipboard.writeText(text).then(() => ctx.toast(`The Markdown is copied (${text.length.toLocaleString()} characters).`)).catch((e) => ctx.toast(e.message, { error: true }));
    }

    // ------------------------------------------------------------ the bench's settings
    async function settingsDialog() {
      const pick = (label, value, options) => {
        const sel = el('select', { class: 'nui-select' }, ...options.map(([v, l]) => el('option', { value: v, selected: v === value || undefined }, l)));
        return [el('label', { class: 'md-setting' }, el('span', { text: label }), sel), sel];
      };
      const [fontRow, font] = pick('Font for documents', prefs.font, [['system', 'System (Segoe UI)'], ['inter', 'Inter (NoorMD 2.0\'s)'], ['serif', 'Serif'], ['mono', 'Monospace']]);
      const [modeRow, mode] = pick('New documents open in', ctx.restore('newMode', 'wysiwyg'), [['wysiwyg', 'Visual'], ['markdown', 'Markdown'], ['split', 'Side by side']]);
      const [widthRow, width] = pick('Line width', prefs.width, WIDTHS);
      const goal = el('input', { class: 'nui-field', type: 'number', min: '1', max: '1000000', step: '50', value: String(prefs.goal || 750) });
      const toolbar = el('input', { type: 'checkbox', checked: !toolsEl.hidden || undefined });
      const spell = el('input', { type: 'checkbox', checked: prefs.spell || undefined });
      const ok = await ctx.dialog('Markdown settings', el('div', { class: 'md-settings' },
        fontRow, modeRow, widthRow,
        el('label', { class: 'md-setting' }, el('span', { text: 'Writing goal (words)' }), goal),
        el('label', { class: 'md-setting check' }, toolbar, el('span', { text: 'Show the formatting bar' })),
        el('label', { class: 'md-setting check' }, spell, el('span', { text: 'Spellcheck' }))),
        [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }]);
      if (!ok) return;
      ctx.keep('newMode', mode.value);
      toolsEl.hidden = !toolbar.checked; ctx.keep('toolbar', toolbar.checked);
      setPrefs({ font: font.value, width: width.value, goal: Math.max(1, Math.round(Number(goal.value) || 750)), spell: spell.checked });
      sendOutline();
    }
    async function goalDialog() {
      const goal = el('input', { class: 'nui-field', type: 'number', min: '1', step: '50', value: String(prefs.goal || 750) });
      const ok = await ctx.dialog('Writing goal', el('label', { class: 'md-linkfield' }, el('span', { text: 'How many words are you aiming for in a document?' }), goal), [{ label: 'Cancel', value: false }, { label: 'Set the goal', value: true, primary: true }]);
      if (ok) { setPrefs({ goal: Math.max(1, Math.round(Number(goal.value) || 750)) }); sendOutline(); }
    }

    async function switcher() {
      wiki.notesAt = 0;   // fresh: the vault may have changed
      const [notes, recent] = await Promise.all([vaultNotes(), ctx.call('md.recentList').catch(() => [])]);
      const items = [], seen = new Set();
      for (const d of docs) { items.push({ label: nameOf(d), detail: d.path || 'Not saved yet', icon: '📄', doc: d }); if (d.path) seen.add(d.path.toLowerCase()); }
      for (const n of notes) items.push({ label: n.name, detail: n.path, icon: '📝', keywords: (n.aliases || []).join(' '), note: n.path });
      for (const r of recent) if (r.exists && !seen.has(r.path.toLowerCase())) items.push({ label: r.name, detail: r.path, icon: '🕘', file: r.path });
      if (!items.length) { ctx.toast('Nothing to go to yet.'); return; }
      const pick = await quickPick(items, { placeholder: 'Go to a document or note (type part of its name)' });
      if (!pick) { focusEditor(); return; }
      if (pick.doc) showDoc(pick.doc);
      else if (pick.note) ctx.callBench('noor.vault', 'vault.openNote', { path: pick.note }).catch((e) => ctx.toast(e.message, { error: true }));
      else if (pick.file) openPath(pick.file);
    }

    async function recentDialog() {
      const list = await ctx.call('md.recentList').catch(() => []);
      if (!list.length) { ctx.toast('No recent files yet.'); return; }
      const body = (finish) => {
        const box = el('div', { class: 'md-recent-list' });
        const fill = (items) => box.replaceChildren(...items.map((r) => recentItem(r, () => { finish(null); openPath(r.path); }, async () => fill(await ctx.call('md.recentList')))));
        fill(list);
        return box;
      };
      const r = await ctx.dialog('Open recent', body, [{ label: 'Forget them all', value: 'clear' }, { label: 'Close', value: null, primary: true }]);
      if (r === 'clear') { await ctx.call('md.recentForget', { path: '' }); if (!docs.length) renderEmpty(); }
    }
    async function draftsDialog() {
      const list = await ctx.call('md.drafts', { except: docs.map((d) => d.id) }).catch(() => []);
      if (!list.length) { ctx.toast('No unsaved work is waiting: everything open is all there is.'); return; }
      offerOrphans(list);
    }

    // ------------------------------------------------------------ views
    /** Visual, Markdown or side by side. Visual never quietly rewrites a file: when it would, the user is asked. */
    async function setMode(d, mode, { force = false } = {}) {
      if (!d || !d.editor || d.mode === mode) return;
      const ed = d.editor;
      if (mode === 'wysiwyg') {
        const text = md(d);
        const check = text.trim() ? visualRoundTrip(text) : { lossless: true };
        if (!check.lossless && !force) {
          const ok = await ctx.dialog('Visual view would change this file', el('p', { text: 'This document has Markdown the Visual view can\'t show exactly (raw HTML, footnotes, hard line breaks…). Editing it there may rewrite those parts.' }),
            [{ label: 'Stay in Markdown', value: false }, { label: 'Use Visual anyway', value: true, primary: true }]);
          if (!ok) return;
        }
        quietly(() => { const joined = joinInlineBreaks(text); if (joined !== text) ed.setMarkdown(joined, false); ed.changeMode('wysiwyg', true); });
        d.sourceBeforeVisual = { text, gen: d.gen };
        if (d.banner && !orphanBanner) d.banner = null;
      } else {
        const sbv = d.sourceBeforeVisual;
        const wasVisual = ed.isWysiwygMode();
        quietly(() => {
          ed.changePreviewStyle(mode === 'split' ? 'vertical' : 'tab');
          if (wasVisual) {
            ed.changeMode('markdown', true);
            // Only looked at in Visual: the source comes back exactly as it was.
            if (sbv && sbv.gen === d.gen && ed.getMarkdown() !== sbv.text) ed.setMarkdown(sbv.text, false);
          }
        });
        d.sourceBeforeVisual = null;
      }
      d.mode = mode;
      d.pane.classList.toggle('mode-markdown', mode === 'markdown');
      d.pane.classList.toggle('mode-split', mode === 'split');
      ctx.keep('newMode', mode === 'split' ? 'markdown' : mode);
      renderModes(); renderBanner(); renderStatus(); keepSession();
      ed.focus();
    }
    const nextMode = () => { if (!cur) return; const i = MODES.findIndex((m) => m[0] === cur.mode); setMode(cur, MODES[(i + 1) % MODES.length][0]); };

    // ------------------------------------------------------------ formatting
    const exec = (name, payload) => () => { if (!cur || !cur.editor) return; cur.editor.focus(); try { cur.editor.exec(name, payload); } catch (e) { console.error(e); } };
    /** Visual view inserts a table only at a plain cursor: a selection collapses to its end first. */
    function insertTable() {
      if (!cur || !cur.editor) return;
      const ed = cur.editor;
      ed.focus();
      try {
        if (ed.isWysiwygMode()) { const [, to] = ed.getSelection(); ed.setSelection(to, to); }
        ed.exec('addTable', { rowCount: 3, columnCount: 3 });
      } catch (e) { console.error(e); }
    }
    async function insertImage() {
      if (!cur || !cur.editor) return;
      const selected = cur.editor.getSelectedText ? cur.editor.getSelectedText() : '';
      let url, alt;
      const choose = async () => {
        const r = await ctx.call('md.pickImage', { doc: cur.id }).catch((e) => { ctx.toast(e.message, { error: true }); return null; });
        if (r) { url.value = r.url; if (!alt.value) alt.value = r.name; }
      };
      const ok = await ctx.dialog('Insert an image', el('div', { class: 'md-linkfield' },
        el('span', { text: 'Picture (a web address, or a file: next to the document it\'s written as a relative path)' }),
        el('div', { style: { display: 'flex', gap: '8px' } }, url = el('input', { class: 'nui-field', type: 'text', placeholder: 'https:// or images/picture.png', style: { flex: '1' } }), el('button', { class: 'nui-btn', onclick: choose }, 'Choose a file…')),
        el('span', { text: 'Description (for screen readers, and shown when the picture is missing)' }), alt = el('input', { class: 'nui-field', type: 'text', value: selected })),
        [{ label: 'Cancel', value: null }, { label: 'Insert', value: true, primary: true }]);
      cur.editor.focus();
      const u = ok && url.value.trim();
      if (u) cur.editor.exec('addImage', { imageUrl: u, altText: alt.value.trim() || 'image' });
    }
    async function insertLink() {
      if (!cur || !cur.editor) return;
      const selected = cur.editor.getSelectedText ? cur.editor.getSelectedText() : '';
      let input;
      const url = await ctx.dialog('Insert a link', el('label', { class: 'md-linkfield' }, el('span', { text: 'Address (https://…, mailto:…, or a .md file next to this one)' }), input = el('input', { class: 'nui-field', type: 'text', placeholder: 'https://', onkeydown: (e) => { if (e.key === 'Enter') e.target.closest('.nui-dialog').querySelector('.nui-btn.primary').click(); } })),
        [{ label: 'Cancel', value: null }, { label: 'Insert', value: 'ok', primary: true }]).then((v) => (v ? input.value.trim() : ''));
      cur.editor.focus();
      if (url) cur.editor.exec('addLink', { linkUrl: url, linkText: selected || url });
    }
    function insertText(text) { if (!cur || !cur.editor) return; cur.editor.focus(); cur.editor.insertText(text); }

    // ------------------------------------------------------------ the outline: a heading clicked in the panel
    function goToHeading(i) {
      if (!cur || !cur.editor) return;
      const h = headings(md(cur))[i];
      if (!h) return;
      const ed = cur.editor;
      if (ed.isMarkdownMode()) {
        ed.setSelection([h.line, 1], [h.line, 1]);
        ed.focus();
        const line = cur.pane.querySelectorAll('.toastui-editor-md-container .ProseMirror > div')[h.line - 1];
        if (line) line.scrollIntoView({ block: 'start' });
        if (cur.mode === 'split') { const ph = cur.pane.querySelectorAll('.toastui-editor-md-preview :is(h1,h2,h3,h4,h5,h6)')[i]; if (ph) ph.scrollIntoView({ block: 'start' }); }
      } else {
        const el2 = cur.pane.querySelectorAll('.toastui-editor-ww-container .ProseMirror :is(h1,h2,h3,h4,h5,h6)')[i];
        if (el2) { el2.scrollIntoView({ block: 'start' }); const view = ed.wwEditor && ed.wwEditor.view; if (view) { try { const pos = view.posAtDOM(el2, 0); ed.setSelection(pos, pos); } catch { /* place only */ } } ed.focus(); }
      }
    }
    let markReady;
    const ready = new Promise((r) => { markReady = r; });
    const offs = [
      ctx.on('stats.ask', () => ctx.emit('stats', lastStats)),
      ctx.on('goal.set', () => goalDialog()),
      ctx.on('snap.take', () => takeSnapshot()),
      ctx.on('snap.view', (p) => p && viewSnapshot(p.id)),
      ctx.on('snap.restore', (p) => p && restoreSnapshot(p.id)),
      ctx.on('shell.open', (p) => ready.then(async () => { for (const path of (p && p.paths) || []) await openPath(path); maybeGoto(); })),
      ctx.on('shell.moved', (p) => {
        for (const m of (p && p.moves) || []) {
          for (const d of docs) {
            if (!d.path) continue;
            const lp = d.path.toLowerCase(), lf = m.from.toLowerCase();
            const now = lp === lf ? m.to : lp.startsWith(lf + '\\') || lp.startsWith(lf + '/') ? m.to + d.path.slice(m.from.length) : null;
            if (!now) continue;
            d.path = now; d.name = now.split(/[\\/]/).pop(); d.diskNoticed = false;
            renderTab(d);
          }
        }
        renderTitle(); sendOutline(); keepSession(); publishDirty();
      }),
      ctx.subscribe('files.rewritten', (p) => {
        const set = new Set(((p && p.paths) || []).map((x) => x.toLowerCase()));
        for (const d of docs) if (d.path && set.has(d.path.toLowerCase())) { d.diskNoticed = false; checkDisk(d, { quiet: true }); }
      }),
      // Deleted in the Vault: documents without unsaved changes close; ones with changes stay (Save writes them again).
      ctx.subscribe('files.deleted', async (p) => {
        const gone = ((p && p.paths) || []).map((x) => x.toLowerCase());
        const inside = (d) => d.path && gone.some((g) => d.path.toLowerCase() === g || d.path.toLowerCase().startsWith(g + '\\') || d.path.toLowerCase().startsWith(g + '/'));
        let kept = 0;
        for (const d of docs.filter(inside)) { if (isDirty(d)) kept++; else await closeDoc(d, { quiet: true }); }
        if (kept) ctx.toast(`${kept === 1 ? 'A document' : kept + ' documents'} with unsaved changes stayed open; saving writes ${kept === 1 ? 'it' : 'them'} again.`);
      }),
      ctx.on('outline.ask', () => ctx.emit('outline', lastOutline)),
      ctx.on('props.ask', () => ctx.emit('props', lastProps)),
      ctx.on('props.set', (p) => applyProperty(p)),
      ctx.on('outline.go', (p) => goToHeading(p && p.index)),
      // Another bench asks to show a place: { path, heading }.
      ctx.subscribe('doc.goto', (p) => { if (p && p.path) { pendingGoto = { path: p.path, heading: p.heading }; maybeGoto(); } }),
    ];

    // ------------------------------------------------------------ the theme: TOAST UI's dark look follows the shell's
    function applyTheme() { const dark = isDark(); docsEl.querySelectorAll('.toastui-editor-defaultUI').forEach((n) => n.classList.toggle('toastui-editor-dark', dark)); }
    let calloutTimer = 0;
    const previewWatch = new MutationObserver(() => { clearTimeout(calloutTimer); calloutTimer = setTimeout(() => docsEl.querySelectorAll('.toastui-editor-md-preview .toastui-editor-contents').forEach(decorateCallouts), 60); });
    previewWatch.observe(docsEl, { childList: true, subtree: true });
    const themeWatch = new MutationObserver(applyTheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ------------------------------------------------------------ keys the bench's commands win over the editor
    // TOAST UI binds Ctrl+S (strikethrough), Ctrl+O (numbered list) and others; in this bench those are Save and Open.
    const OWN_KEYS = { 'ctrl+s': 'md.save', 'ctrl+shift+s': 'md.saveAs', 'ctrl+o': 'md.open', 'ctrl+shift+o': 'md.recent', 'ctrl+n': 'md.new', 'ctrl+w': 'md.close', 'ctrl+e': 'md.mode.next', 'ctrl+p': 'md.switcher',
      'ctrl+f': 'md.find', 'ctrl+h': 'md.replace', 'ctrl+=': 'md.zoom.in', 'ctrl++': 'md.zoom.in', 'ctrl+shift++': 'md.zoom.in', 'ctrl+-': 'md.zoom.out', 'ctrl+0': 'md.zoom.reset' };
    let commands = null;
    const ownKey = (e) => {
      if (wiki.box && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key) && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') closeWiki();
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { wiki.index = (wiki.index + (e.key === 'ArrowDown' ? 1 : -1) + wiki.items.length) % wiki.items.length; drawWiki(); }
        else chooseWiki(wiki.index);
        return;
      }
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const k = ['ctrl', e.shiftKey && 'shift', e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()].filter(Boolean).join('+');
      // Ctrl+Shift+0…6: paragraph style (by key position, whatever the keyboard layout prints there).
      const digit = /^Digit([0-6])$/.exec(e.code || '');
      if (e.shiftKey && digit && cur && cur.editor) { e.preventDefault(); e.stopPropagation(); setHeading(Number(digit[1])); return; }
      const cmd = OWN_KEYS[k];
      if (!cmd || !commands) return;
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;   // a held Ctrl+S saves once
      Promise.resolve().then(() => commands[cmd]()).catch((err) => ctx.toast(err.message, { error: true }));
    };
    box.addEventListener('keydown', ownKey, true);

    // ------------------------------------------------------------ start
    renderAll();
    loadToast().then(async (ok) => {
      toastOk = ok;
      if (cur && !cur.mounted) { mountDoc(cur); renderAll(); }
      if (!ok) ctx.toast('The visual editor didn\'t load; documents open as plain Markdown.', { error: true });
      await restoreSession();
      markReady();
    });

    commands = {
      'md.new': () => newDoc(),
      'md.open': () => openFiles(),
      'md.recent': () => recentDialog(),
      'md.save': () => save(),
      'md.saveAs': () => save(cur, { as: true }),
      'md.saveAll': () => saveAll(),
      'md.close': () => closeDoc(),
      'md.drafts': () => draftsDialog(),
      'md.mode.visual': () => cur && setMode(cur, 'wysiwyg'),
      'md.mode.markdown': () => cur && setMode(cur, 'markdown'),
      'md.mode.split': () => cur && setMode(cur, 'split'),
      'md.mode.next': nextMode,
      'md.find': () => find.show(false),
      'md.extract': () => extractSelection(),
      'md.switcher': switcher,
      'md.ins.callout': () => { if (!cur || !cur.editor) return; cur.editor.focus(); insertText('\n> [!tip] Title\n> Your text\n'); },
      'md.exportHtml': exportHtml, 'md.exportPdf': exportPdf, 'md.print': printDoc, 'md.copy': copyMarkdown,
      'md.snap': () => takeSnapshot(),
      'md.settings': settingsDialog, 'md.goal': goalDialog,
      'md.welcome': () => openWelcome(),
      'md.replace': () => find.show(true),
      'md.zoom.in': () => zoomBy(1), 'md.zoom.out': () => zoomBy(-1), 'md.zoom.reset': () => zoomBy(0),
      'md.width.comfortable': () => setPrefs({ width: 'comfortable' }), 'md.width.wide': () => setPrefs({ width: 'wide' }), 'md.width.full': () => setPrefs({ width: 'full' }),
      'md.width.next': () => { const i = WIDTHS.findIndex((w) => w[0] === prefs.width); setPrefs({ width: WIDTHS[(i + 1) % WIDTHS.length][0] }); ctx.toast(`Line width: ${WIDTHS[(i + 1) % WIDTHS.length][1]}`); },
      'md.lines': () => setPrefs({ lineNumbers: !prefs.lineNumbers }),
      'md.wrap': () => setPrefs({ wrap: !prefs.wrap }),
      'md.sync': () => setPrefs({ sync: !prefs.sync }),
      'md.spell': () => { setPrefs({ spell: !prefs.spell }); ctx.toast(prefs.spell ? 'Spellcheck on' : 'Spellcheck off'); },
      'md.fmt.indent': exec('indent'), 'md.fmt.outdent': exec('outdent'),
      'md.name': () => cur && !cur.path && nameDoc(cur),
      'md.reload': () => cur && reload(cur),
      'md.reveal': () => cur && ctx.call('md.reveal', { doc: cur.id }).catch((e) => ctx.toast(e.message, { error: true })),
      'md.toolbar': () => { toolsEl.hidden = !toolsEl.hidden; ctx.keep('toolbar', !toolsEl.hidden); },
      'md.fmt.bold': exec('bold'), 'md.fmt.italic': exec('italic'), 'md.fmt.strike': exec('strike'), 'md.fmt.code': exec('code'),
      'md.fmt.h1': exec('heading', { level: 1 }), 'md.fmt.h2': exec('heading', { level: 2 }), 'md.fmt.h3': exec('heading', { level: 3 }),
      'md.fmt.p': exec('heading', { level: 0 }),   // level 0: back to a plain paragraph
      'md.fmt.ul': exec('bulletList'), 'md.fmt.ol': exec('orderedList'), 'md.fmt.task': exec('taskList'), 'md.fmt.quote': exec('blockQuote'),
      'md.ins.link': insertLink, 'md.ins.table': insertTable, 'md.ins.image': insertImage, 'md.ins.codeblock': exec('codeBlock'), 'md.ins.hr': exec('hr'),
      'md.ins.date': () => insertText(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })),
      'edit.undo': exec('undo'), 'edit.redo': exec('redo'),
    };
    applyPrefs();
    const CHECKS = {
      'md.mode.visual': () => !!cur && cur.mode === 'wysiwyg', 'md.mode.markdown': () => !!cur && cur.mode === 'markdown', 'md.mode.split': () => !!cur && cur.mode === 'split',
      'md.toolbar': () => !toolsEl.hidden, 'md.lines': () => !!prefs.lineNumbers, 'md.wrap': () => !!prefs.wrap, 'md.sync': () => !!prefs.sync, 'md.spell': () => !!prefs.spell,
      'md.width.comfortable': () => prefs.width === 'comfortable', 'md.width.wide': () => prefs.width === 'wide', 'md.width.full': () => prefs.width === 'full',
    };
    return {
      focus: focusEditor,
      commands,
      /** Menu items with a tick (the shell asks). */
      checked: (cmd) => (CHECKS[cmd] ? CHECKS[cmd]() : undefined),
      /** Closing the bench: unsaved documents are either saved or kept (drafts) for when it opens again. */
      /** Moving to another window (the shell asks first): unsaved work goes to drafts now, so it comes along. */
      async suspend() { await Promise.all(docs.map(writeDraft)); keepSession(true); },
      async canClose() {
        const dirty = docs.filter(isDirty);
        if (!dirty.length) return true;
        const what = await ctx.dialog('Unsaved changes', el('p', { text: `${dirty.length === 1 ? `“${nameOf(dirty[0])}” has` : `${dirty.length} documents have`} unsaved changes. Keep them for next time, or save now?` }),
          [{ label: 'Cancel', value: null }, { label: 'Keep for next time', value: 'keep' }, { label: 'Save all', value: 'save', primary: true }]);
        if (!what) return false;
        if (what === 'save') return saveAll();
        await Promise.all(dirty.map(writeDraft));
        return true;
      },
      unmount() {
        // Documents stay as they are (drafts and the kept session bring them back): only the editors go.
        themeWatch.disconnect(); previewWatch.disconnect(); offs.forEach((f) => f()); closeWiki(); hideHover(); window.removeEventListener('focus', onWindowFocus); find.close(); box.removeEventListener('keydown', ownKey, true);
        for (const d of docs) { clearTimeout(d.draftTimer); try { d.editor && d.editor.destroy(); } catch { /* gone */ } }
        clearTimeout(statusTimer); clearTimeout(outlineTimer);
      },
      // For tests.
      _editor: () => cur && cur.editor,   // for tests
      _state: () => ({ stats: lastStats, prefs: { ...prefs }, find: find._state(), docs: docs.map((d) => ({ id: d.id, name: nameOf(d), path: d.path, mode: d.mode, dirty: isDirty(d), text: md(d), format: d.format })), current: cur ? cur.id : null, ready: toastOk !== null }),
    };
  },
  panels: {
    stats: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        const box = el('div', { class: 'md-stats' });
        root.replaceChildren(box);
        const show = (st) => {
          lastStats = st;
          if (!st) { box.replaceChildren(el('div', { class: 'none', text: 'Open a document to see its numbers.' })); return; }
          const pct = Math.min(100, Math.round((st.words / st.goal) * 100));
          box.replaceChildren(
            el('div', { class: 'doc', text: st.title }),
            el('div', { class: 'md-goal', title: 'Click to change the goal' },
              el('div', { class: 'md-goal-text' }, el('b', { text: st.words.toLocaleString() }), ` / ${st.goal.toLocaleString()} words`, el('span', { class: 'pct', text: pct >= 100 ? ' 🎉' : ` · ${pct}%` })),
              el('div', { class: 'md-goal-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, el('div', { class: 'fill', style: { width: pct + '%' } })),
              el('button', { class: 'nui-btn quiet', onclick: () => ctx.emit('goal.set') }, 'Set the goal…')),
            ...[['Words', st.words], ['Characters', st.characters], ['Characters without spaces', st.charactersNoSpaces], ['Paragraphs', st.paragraphs], ['Headings', st.headings], ['Reading time', `${st.minutes} min`]]
              .map(([k, v]) => el('div', { class: 'nui-row' }, el('span', { text: k }), el('span', { class: 'nui-muted', text: typeof v === 'number' ? v.toLocaleString() : v }))));
        };
        show(lastStats);
        const off = ctx.on('stats', show);
        ctx.emit('stats.ask');
        return { unmount: off };
      },
    },
    history: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        const box = el('div', { class: 'md-history' });
        root.replaceChildren(box);
        let doc = null, title = '';
        const render = async () => {
          if (!doc) { box.replaceChildren(el('div', { class: 'none', text: 'Open a document to see its snapshots.' })); return; }
          const list = await ctx.call('md.snapList', { doc }).catch(() => []);
          box.replaceChildren(
            el('div', { class: 'doc', text: title }),
            el('button', { class: 'nui-btn primary md-snap-take', onclick: () => ctx.emit('snap.take') }, 'Take a snapshot'),
            el('p', { class: 'nui-muted md-snap-hint', text: 'A snapshot keeps the document as it is now, so you can look back at it or bring it back later. Up to 50 per document.' }),
            ...(list.length ? list.map((s2) => el('div', { class: 'md-snap', 'data-snap': s2.id },
              el('button', { class: 'md-snap-main', title: 'Look at it', onclick: () => ctx.emit('snap.view', { id: s2.id }) },
                el('span', { class: 'l', text: s2.label }), el('span', { class: 'm', text: `${new Date(s2.createdUtc).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${s2.words.toLocaleString()} words` })),
              el('button', { class: 'nui-icon', title: 'Bring it back', 'aria-label': `Bring back ${s2.label}`, onclick: () => ctx.emit('snap.restore', { id: s2.id }) }, '⟲'),
              el('button', { class: 'nui-icon', title: 'Delete it', 'aria-label': `Delete ${s2.label}`, onclick: async () => { await ctx.call('md.snapDelete', { doc, id: s2.id }); ctx.emit('snaps.changed', { doc }); } }, '✕')))
              : [el('div', { class: 'none', text: 'No snapshots yet.' })]));
        };
        const offs = [
          ctx.on('stats', (st) => { const d = st ? st.doc : null; title = st ? st.title : ''; if (d !== doc) { doc = d; render(); } }),
          ctx.on('snaps.changed', (p) => { if (p && p.doc === doc) render(); }),
        ];
        if (lastStats) { doc = lastStats.doc; title = lastStats.title; }
        render();
        ctx.emit('stats.ask');
        return { unmount: () => offs.forEach((f) => f()) };
      },
    },
    props: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        const box = el('div', { class: 'md-props' });
        root.replaceChildren(box);
        const LISTS = ['tags', 'aliases', 'cssclasses'];
        const toValue = (raw, list) => (list ? raw.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean) : raw);
        const show = (p) => {
          lastProps = p;
          if (!p) { box.replaceChildren(el('div', { class: 'none', text: 'Open a document to see its properties.' })); return; }
          const set = (key, value) => ctx.emit('props.set', { doc: p.doc, key, value });
          const rows = p.items.map((it) => {
            const text = it.list ? it.value.join(', ') : it.value;
            const input = el('input', { class: 'nui-field', type: 'text', value: text, 'aria-label': it.key, title: it.list ? 'A list: separate items with commas' : '',
              onchange: (e) => set(it.key, toValue(e.target.value, it.list)), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
            return el('div', { class: 'md-prop' + (it.list ? ' list' : '') }, el('span', { class: 'k', text: it.key, title: it.key }), input,
              el('button', { class: 'nui-icon', title: `Remove “${it.key}”`, 'aria-label': `Remove ${it.key}`, onclick: () => set(it.key, null) }, '✕'));
          });
          const keyIn = el('input', { class: 'nui-field', type: 'text', placeholder: 'name (e.g. status)', 'aria-label': 'New property name', list: 'md-prop-keys' });
          const valIn = el('input', { class: 'nui-field', type: 'text', placeholder: 'value', 'aria-label': 'New property value' });
          const add = () => {
            const key = keyIn.value.trim().replace(/:+$/, '');
            if (!/^[A-Za-z0-9_][\w \-]*$/.test(key)) { ctx.toast('A property name is letters, digits, spaces, - and _.', { error: true }); return; }
            const list = LISTS.includes(key.toLowerCase()) || valIn.value.includes(',');
            set(key, toValue(valIn.value, list));
          };
          keyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') valIn.focus(); });
          valIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
          box.replaceChildren(
            el('div', { class: 'doc', text: p.title }),
            ...(rows.length ? rows : [el('p', { class: 'nui-muted md-prop-hint', text: 'No properties yet. Properties are a small form at the top of a note (front matter): its status, tags, other names (aliases)… The Vault can search them, e.g. status:done.' })]),
            el('div', { class: 'md-prop add' }, keyIn, valIn, el('button', { class: 'nui-btn small', onclick: add }, 'Add')),
            el('datalist', { id: 'md-prop-keys' }, ...['tags', 'aliases', 'status', 'created', 'due', 'author', 'source', 'type'].map((k) => el('option', { value: k }))));
        };
        show(lastProps);
        const off = ctx.on('props', show);
        ctx.emit('props.ask');
        return { unmount: off };
      },
    },
    outline: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        const box = el('div', { class: 'md-outline' });
        root.replaceChildren(box);
        const show = (o) => {
          lastOutline = o || { title: '', items: [] };
          box.replaceChildren(
            lastOutline.title ? el('div', { class: 'doc', text: lastOutline.title }) : '',
            ...(lastOutline.items.length ? lastOutline.items.map((h, i) => el('button', { class: `l${h.level}`, title: h.text, onclick: () => ctx.emit('outline.go', { index: i }) }, h.text))
              : [el('div', { class: 'none', text: lastOutline.title ? 'No headings yet. Lines starting with # become the outline.' : 'Open a document to see its outline.' })]));
        };
        show(lastOutline);
        const off = ctx.on('outline', show);
        ctx.emit('outline.ask');
        return { unmount: off };
      },
    },
  },
};
