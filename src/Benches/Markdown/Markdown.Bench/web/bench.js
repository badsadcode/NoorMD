// The Markdown bench's web module (contract v1). NoorMD 2.0's editor (TOAST UI: Visual, Markdown, side by side),
// documents as tabs inside the bench, an outline panel. The C# side owns the files: this page never reads or writes
// one itself, it asks (md.pick, md.load, md.write, md.writeAs, md.draft…).
import { el, menu } from '/ui/js/noor-ui.js';
import { visualRoundTrip, joinInlineBreaks, headings, stats, unescapeWikiLinks } from './mdtools.js';

const here = (p) => new URL(p, import.meta.url).href;
const MODES = [['wysiwyg', 'Visual'], ['markdown', 'Markdown'], ['split', 'Side by side']];
const modeName = (m) => (MODES.find((x) => x[0] === m) || MODES[0])[1];

// The outline as last sent, so an Outline panel shown later (or in a floating window) starts with it.
let lastOutline = { title: '', items: [] };

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

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
const normalizeText = (s) => String(s ?? '').replace(/\r\n?/g, '\n');
const isDark = () => getComputedStyle(document.documentElement).colorScheme.includes('dark');
const samePath = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export default {
  mount(root, ctx) {
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
    const box = el('div', { class: 'md-bench' },
      el('div', { class: 'md-bar' }, tabsEl, el('button', { class: 'nui-icon md-new', title: 'New document (Ctrl+N)', 'aria-label': 'New document', onclick: () => newDoc() }, '+'), modesEl),
      toolsEl, bannerEl, el('div', { class: 'md-docs-wrap', style: { position: 'relative', flex: '1 1 auto', minHeight: '0', display: 'flex' } }, docsEl, emptyEl));
    docsEl.style.flex = '1 1 auto';
    root.replaceChildren(box);

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
        events: { change: () => changed(d) },
      });
      // Visual mode writes a typed [[wiki link]] as \[\[…\]\]; keep it a real link in the saved Markdown.
      d.editor.eventEmitter.listen('changeToolbarState', (p) => { if (d === cur) { fmtState = (p && p.toolbarState) || {}; renderTools(); } });
      d.editor.on('caretChange', () => { if (d === cur) renderTools(); });
      const conv = d.editor.convertor;
      if (conv && typeof conv.toMarkdownText === 'function') { const toMd = conv.toMarkdownText.bind(conv); conv.toMarkdownText = (...a) => unescapeWikiLinks(toMd(...a)); }
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
      if (d === cur) { renderTitle(); clearTimeout(statusTimer); statusTimer = setTimeout(renderStatus, 200); clearTimeout(outlineTimer); outlineTimer = setTimeout(sendOutline, 300); }
      clearTimeout(d.draftTimer);
      d.draftTimer = setTimeout(() => writeDraft(d), 600);
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
      if (focus) setTimeout(() => focusEditor(), 0);
      keepSession();
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
          onclick: () => showDoc(d), onauxclick: (e) => { if (e.button === 1) closeDoc(d); } });
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
      lastOutline = cur ? { title: nameOf(cur), items: headings(md(cur)) } : { title: '', items: [] };
      ctx.emit('outline', lastOutline);
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
    function keepSession() {
      ctx.keep('docs', docs.map((d) => ({ id: d.id, path: d.path, name: d.name, title: d.title, mode: d.mode })));
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
          } else if (k.path) {
            const r = await ctx.call('md.load', { doc: k.id, path: k.path });
            const d = makeDoc({ id: k.id, path: r.path, name: r.name, mode: k.mode, format: r.format });
            d.pending = r.markdown; d.warning = r.warning;
            addDoc(d, { show: false });
          }
        } catch (e) { ctx.toast(`${k.name || k.title || 'A document'} couldn't come back: ${e.message}`, { error: true }); }
      }
      showDoc(byId(want) || docs[0] || null, { focus: false });
      if (back) ctx.toast(`${back === 1 ? 'A document' : back + ' documents'} came back with unsaved changes.`);
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
      d.path = r.path; d.name = r.name; d.format = r.format || d.format; d.savedGen = gen;
      if (d.gen !== gen) writeDraft(d);   // typed while it was saving: those words are still unsaved
      renderTab(d); if (d === cur) { renderTitle(); renderStatus(); sendOutline(); }
      keepSession();
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
    const offs = [
      ctx.on('outline.ask', () => ctx.emit('outline', lastOutline)),
      ctx.on('outline.go', (p) => goToHeading(p && p.index)),
    ];

    // ------------------------------------------------------------ the theme: TOAST UI's dark look follows the shell's
    function applyTheme() { const dark = isDark(); docsEl.querySelectorAll('.toastui-editor-defaultUI').forEach((n) => n.classList.toggle('toastui-editor-dark', dark)); }
    const themeWatch = new MutationObserver(applyTheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ------------------------------------------------------------ keys the bench's commands win over the editor
    // TOAST UI binds Ctrl+S (strikethrough), Ctrl+O (numbered list) and others; in this bench those are Save and Open.
    const OWN_KEYS = { 'ctrl+s': 'md.save', 'ctrl+shift+s': 'md.saveAs', 'ctrl+o': 'md.open', 'ctrl+shift+o': 'md.recent', 'ctrl+n': 'md.new', 'ctrl+w': 'md.close', 'ctrl+e': 'md.mode.next' };
    let commands = null;
    const ownKey = (e) => {
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
      'md.toolbar': () => { toolsEl.hidden = !toolsEl.hidden; ctx.keep('toolbar', !toolsEl.hidden); },
      'md.fmt.bold': exec('bold'), 'md.fmt.italic': exec('italic'), 'md.fmt.strike': exec('strike'), 'md.fmt.code': exec('code'),
      'md.fmt.h1': exec('heading', { level: 1 }), 'md.fmt.h2': exec('heading', { level: 2 }), 'md.fmt.h3': exec('heading', { level: 3 }),
      'md.fmt.p': exec('heading', { level: 0 }),   // level 0: back to a plain paragraph
      'md.fmt.ul': exec('bulletList'), 'md.fmt.ol': exec('orderedList'), 'md.fmt.task': exec('taskList'), 'md.fmt.quote': exec('blockQuote'),
      'md.ins.link': insertLink, 'md.ins.table': insertTable, 'md.ins.image': insertImage, 'md.ins.codeblock': exec('codeBlock'), 'md.ins.hr': exec('hr'),
      'md.ins.date': () => insertText(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })),
      'edit.undo': exec('undo'), 'edit.redo': exec('redo'),
    };
    return {
      focus: focusEditor,
      commands,
      /** Closing the bench: unsaved documents are either saved or kept (drafts) for when it opens again. */
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
        themeWatch.disconnect(); offs.forEach((f) => f()); box.removeEventListener('keydown', ownKey, true);
        for (const d of docs) { clearTimeout(d.draftTimer); try { d.editor && d.editor.destroy(); } catch { /* gone */ } }
        clearTimeout(statusTimer); clearTimeout(outlineTimer);
      },
      // For tests.
      _state: () => ({ docs: docs.map((d) => ({ id: d.id, name: nameOf(d), path: d.path, mode: d.mode, dirty: isDirty(d), text: md(d), format: d.format })), current: cur ? cur.id : null, ready: toastOk !== null }),
    };
  },
  panels: {
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
