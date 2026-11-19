// Find and replace for the Markdown bench (NoorMD 2.0's, app.js). Matches are found in the editor's own document
// (ProseMirror) and shown with the CSS Custom Highlight API, so nothing in the document changes until you replace.
import { el } from '/ui/js/noor-ui.js';

export function createFind({ getEditor, toast }) {
  let matches = [], current = -1;
  const input = el('input', { class: 'nui-field md-find-input', type: 'search', placeholder: 'Find', 'aria-label': 'Find', spellcheck: 'false' });
  const replaceInput = el('input', { class: 'nui-field md-find-input', type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with', spellcheck: 'false' });
  const count = el('span', { class: 'md-find-count', 'aria-live': 'polite' });
  const matchCase = el('input', { type: 'checkbox' });
  const replaceRow = el('span', { class: 'md-find-replace' }, replaceInput,
    el('button', { class: 'nui-btn', title: 'Replace (Enter)', onclick: () => replaceOne() }, 'Replace'),
    el('button', { class: 'nui-btn', title: 'Replace all (Ctrl+Enter)', onclick: () => replaceAll() }, 'All'));
  const bar = el('div', { class: 'md-findbar', role: 'search', hidden: true },
    input,
    el('button', { class: 'nui-icon', title: 'Previous (Shift+Enter)', 'aria-label': 'Previous match', onclick: () => run(true, true) }, '↑'),
    el('button', { class: 'nui-icon', title: 'Next (Enter)', 'aria-label': 'Next match', onclick: () => run(true, false) }, '↓'),
    count,
    el('label', { class: 'md-find-case' }, matchCase, 'Match case'),
    replaceRow,
    el('button', { class: 'nui-icon md-find-close', title: 'Close (Esc)', 'aria-label': 'Close find', onclick: () => close() }, '✕'));

  const view = () => { const ed = getEditor(); return ed ? (ed.isWysiwygMode() ? ed.wwEditor.view : ed.mdEditor.view) : null; };

  function collect(query, caseSensitive) {
    const v = view();
    if (!v || !query) return [];
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const out = [];
    v.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      let text = '';
      const map = [];
      node.forEach((child, offset) => {
        const start = pos + 1 + offset;
        if (child.isText) { for (let i = 0; i < child.text.length; i++) map.push(start + i); text += child.text; } else { map.push(start); text += '￼'; }
      });
      const hay = caseSensitive ? text : text.toLocaleLowerCase();
      let i = hay.indexOf(needle);
      while (i !== -1 && out.length < 5000) { out.push({ from: map[i], to: map[i + needle.length - 1] + 1 }); i = hay.indexOf(needle, i + Math.max(1, needle.length)); }
      return false;
    });
    return out;
  }

  function run(advance, backwards) {
    const q = input.value;
    matches = collect(q, matchCase.checked);
    if (!matches.length) { current = -1; count.textContent = q ? 'No results' : ''; clearHighlights(); return; }
    if (!advance) { const head = view().state.selection.from; current = matches.findIndex((m) => m.from >= head); if (current < 0) current = 0; }
    else current = backwards ? (current - 1 + matches.length) % matches.length : (current + 1) % matches.length;
    highlight();
    count.textContent = `${current + 1} of ${matches.length}`;
  }

  function highlight() {
    clearHighlights();
    const v = view();
    if (!v || !window.CSS || !CSS.highlights || typeof Highlight !== 'function') return;
    const all = new Highlight(), now = new Highlight();
    matches.slice(0, 1000).forEach((m, i) => {
      try {
        const a = v.domAtPos(m.from), b = v.domAtPos(m.to), r = document.createRange();
        r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset);
        (i === current ? now : all).add(r);
        if (i === current) (a.node.nodeType === 1 ? a.node : a.node.parentElement)?.scrollIntoView({ block: 'center' });
      } catch { /* the view changed under us */ }
    });
    CSS.highlights.set('noor-find', all);
    CSS.highlights.set('noor-find-current', now);
  }
  function clearHighlights() { if (window.CSS && CSS.highlights) { CSS.highlights.delete('noor-find'); CSS.highlights.delete('noor-find-current'); } }

  function select(m) {
    const ed = getEditor(), v = view();
    if (!ed || !v) return;
    if (ed.isWysiwygMode()) ed.setSelection(m.from, m.to);
    else { const lc = (pos) => { const $p = v.state.doc.resolve(pos); return [$p.index(0) + 1, pos - $p.start(1) + 1]; }; ed.setSelection(lc(m.from), lc(m.to)); }
  }

  function replaceOne() {
    const v = view();
    if (!v || current < 0 || !matches[current]) { run(false); return; }
    const m = matches[current], keep = current;
    v.dispatch(v.state.tr.insertText(replaceInput.value, m.from, m.to));
    run(false);
    if (matches.length) { current = Math.min(keep, matches.length - 1); highlight(); count.textContent = `${current + 1} of ${matches.length}`; }
  }
  function replaceAll() {
    const v = view(), q = input.value;
    if (!v || !q) return;
    const list = collect(q, matchCase.checked);
    if (!list.length) { toast('No matches'); return; }
    let tr = v.state.tr;
    for (let i = list.length - 1; i >= 0; i--) tr = tr.insertText(replaceInput.value, list[i].from, list[i].to);
    v.dispatch(tr);
    toast(`Replaced ${list.length} occurrence${list.length === 1 ? '' : 's'} · Ctrl+Z to undo`);
    run(false);
  }

  function show(withReplace) {
    const ed = getEditor();
    if (!ed) return;
    bar.hidden = false;
    replaceRow.hidden = !withReplace;
    const sel = ed.getSelectedText ? ed.getSelectedText() : '';
    if (sel && !sel.includes('\n') && sel.length < 200) input.value = sel;
    (withReplace && input.value ? replaceInput : input).focus();
    if (!withReplace || !input.value) input.select();
    run(false);
  }
  function close() {
    if (bar.hidden) return false;
    bar.hidden = true;
    clearHighlights();
    const ed = getEditor();
    if (ed && current >= 0 && matches[current]) { select(matches[current]); ed.focus(); }
    matches = []; current = -1;
    return true;
  }

  input.addEventListener('input', () => run(false));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(true, e.shiftKey); } });
  replaceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey) replaceAll(); else replaceOne(); } });
  bar.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  matchCase.addEventListener('change', () => run(false));

  return {
    bar, show, close,
    isOpen: () => !bar.hidden,
    /** The document changed or another one is on screen: matches are found again. */
    refresh: () => { if (!bar.hidden) run(false); else clearHighlights(); },
    _state: () => ({ open: !bar.hidden, count: matches.length, current }),
  };
}
