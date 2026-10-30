// NoorMD in other languages. English is written in the code and is the key: a language is a list of English text →
// its translation (wwwroot/lang/xx.json, and your own in the Translations folder). The page is translated as it is
// shown — every text, title, label and placeholder that is a known English text becomes the translation, and
// changes back when the language does — so switching is instant and nothing has to be built twice. Text with
// numbers or names in it is matched by a pattern: "{0} frames" in the list matches "12 frames". What you write (the
// document, file and layer names, anything you can type into) is never touched.
window.NoorI18n = (() => {
  'use strict';
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
  // Where your own words are: never translated.
  const SKIP = '[data-noi18n], [contenteditable], .ProseMirror, .toastui-editor-contents, .CodeMirror, textarea, script, style, kbd, .menu-keys, .tab-title, .vault-tree, #vault-tree, .np-title';
  let words = new Map();      // English → translation
  let patterns = [];          // { re, out } for English with {0}, {1} … in it
  let code = 'en';
  const textOf = new WeakMap();   // a text node → its English
  const attrsOf = new WeakMap();  // an element → { attr: English }
  let observer = null, busy = false;

  /** A key with {0}, {1} … as a pattern; the translation may put them in another order. */
  function compile(key, out) {
    // {0}, {1} … a value; {|s} (or {y|ies}) an English plural ending, which a translation writes its own way.
    const parts = key.split(/\{(\d|[a-z]*\|[a-z]*)\}/);
    if (parts.length < 2) return null;
    let src = '^';
    const order = [];
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) src += parts[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      else if (/^\d$/.test(parts[i])) { src += '([\\s\\S]+?)'; order.push(Number(parts[i])); }
      else src += `(?:${parts[i]})`;
    }
    return { re: new RegExp(src + '$'), order, out: out.replace(/\{[a-z]*\|[a-z]*\}/g, '') };
  }

  /** The translation of an English text (itself when there is none): for code that builds text itself. */
  function t(en, ...args) {
    let s = words.get(en);
    if (s === undefined) {
      if (!args.length) for (const p of patterns) { const m = p.re.exec(en); if (m) { s = p.out.replace(/\{(\d)\}/g, (_, n) => { const at = p.order.indexOf(Number(n)); return at >= 0 ? m[at + 1] : ''; }); break; } }
      if (s === undefined) s = en;
    }
    return args.length ? s.replace(/\{(\d)\}/g, (_, n) => (args[n] !== undefined ? args[n] : '')) : s;
  }

  const skipped = (node) => { const e = node.nodeType === 1 ? node : node.parentElement; return !e || !!e.closest(SKIP); };

  function textNode(n) {
    const now = n.nodeValue;
    let en = textOf.get(n);
    // A text the page changed since: that is the English now.
    if (en === undefined || (now !== en && now !== n._noorTr)) en = now;
    textOf.set(n, en);
    const trimmed = en.trim();
    if (!trimmed || !/[A-Za-z]/.test(trimmed)) return;
    const tr = code === 'en' ? trimmed : t(trimmed);
    const next = tr === trimmed ? en : en.replace(trimmed, tr);
    n._noorTr = next;
    if (now !== next) n.nodeValue = next;
  }

  function element(e) {
    let orig = attrsOf.get(e);
    for (const a of ATTRS) {
      const now = e.getAttribute(a);
      if (now === null) continue;
      if (!orig) { orig = {}; attrsOf.set(e, orig); }
      if (orig[a] === undefined || (now !== orig[a] && now !== (orig['_' + a]))) orig[a] = now;
      const en = orig[a];
      if (!/[A-Za-z]/.test(en)) continue;
      const tr = code === 'en' ? en : t(en.trim());
      orig['_' + a] = tr;
      if (now !== tr) e.setAttribute(a, tr);
    }
  }

  /** Every text and label under a node, translated (or put back to English). */
  function translate(root) {
    if (!root || skipped(root)) return;
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1) return;
    element(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) (n.nodeType === 3 ? textNode(n) : element(n));
  }

  function watch() {
    if (observer) return;
    observer = new MutationObserver((list) => {
      if (busy || code === 'en') return;
      busy = true;
      try {
        for (const m of list) {
          if (m.type === 'childList') m.addedNodes.forEach(translate);
          else if (m.type === 'characterData') { if (!skipped(m.target)) textNode(m.target); }
          else if (m.type === 'attributes' && !skipped(m.target)) element(m.target);
        }
      } finally { busy = false; }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  /** A language put to work: its list ({ English: translation }), and the page shown in it at once. */
  function use(lang, list) {
    code = lang || 'en';
    words = new Map(); patterns = [];
    for (const [k, v] of Object.entries(list || {})) {
      if (!v || k.startsWith('_') || typeof v !== 'string') continue;
      const p = compile(k, v);
      if (p) patterns.push(p); else words.set(k, v);
    }
    document.documentElement.lang = code;
    busy = true;
    try { translate(document.body); } finally { busy = false; }
    watch();
    // Parts that build their text from pieces (the menu bar's underlined letters) build it again.
    window.dispatchEvent(new CustomEvent('noor-language', { detail: code }));
  }

  return { use, t, translate, language: () => code, _count: () => words.size + patterns.length };
})();
