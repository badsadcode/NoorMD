// Markdown helpers that do not touch the visible editor: rendering for export/print,
// Visual-mode round-trip checks, statistics and the heading outline.
window.NoorMarkdown = (() => {
  'use strict';
  let checker = null;

  // A hidden, never-focused editor instance used purely for conversions.
  function getChecker() {
    if (checker || !window.toastui || !window.toastui.Editor) return checker;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:400px;visibility:hidden;pointer-events:none';
    document.body.appendChild(host);
    checker = new toastui.Editor({
      el: host, height: '400px', initialEditType: 'markdown', previewStyle: 'tab',
      usageStatistics: false, frontMatter: true, hideModeSwitch: true, toolbarItems: [],
    });
    return checker;
  }

  const normalizeHtml = (h) => h
    .replace(/ data-nodeid="\d+"/g, '')
    // A soft line break (a line wrapped in the source: "<br>", where a hard break is "<br />") is a space.
    .replace(/<br>\s*/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();

  /** Renders Markdown to HTML exactly as the Markdown preview does (raw, unsanitized). */
  function renderRaw(md) {
    const c = getChecker();
    if (!c) return '<pre>' + escapeHtml(md) + '</pre>';
    if (!c.isMarkdownMode()) c.changeMode('markdown', true);
    c.setMarkdown(md, false);
    return c.preview.getRenderer().render(c.toastMark.getRootNode());
  }

  /**
   * Visual mode drops a line break inside bold, italic, strikethrough or a link instead of making it a space
   * ("**Create Collision⏎Shape**" would become "CreateCollisionShape"), so before Visual sees the text those lines
   * are joined with a space. Only those spans change; the rest of the text is as it was.
   */
  function joinInlineBreaks(md) {
    const c = getChecker();
    if (!c || !/\n/.test(md)) return md;
    try {
      if (!c.isMarkdownMode()) c.changeMode('markdown', true);
      c.setMarkdown(md, false);
      const lines = md.split('\n'), joins = new Set();
      const SPANS = new Set(['strong', 'emph', 'strike', 'link']);
      const walk = (node) => {
        for (let n = node.firstChild; n; n = n.next) {
          if (n.type === 'softbreak' && n.parent && SPANS.has(n.parent.type) && n.sourcepos) joins.add(n.sourcepos[0][0]);
          walk(n);
        }
      };
      walk(c.toastMark.getRootNode());
      if (!joins.size) return md;
      // A soft break's place is the line it ends (1-based): that line and the next become one, with one space.
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        if (out.length && joins.has(i)) out[out.length - 1] = out[out.length - 1].replace(/\s+$/, '') + ' ' + lines[i].replace(/^\s+/, '');
        else out.push(lines[i]);
      }
      return out.join('\n');
    } catch (err) {
      console.error('Joining inline line breaks failed', err);
      return md;
    }
  }

  /**
   * Checks what Visual (WYSIWYG) mode would do to this Markdown.
   *  - identical: the Markdown text survives byte-for-byte (after trailing whitespace).
   *  - lossless:  the text changes cosmetically (list markers, spacing) but renders the same.
   *  - otherwise content would be altered (raw HTML, hard breaks, footnotes, …) and the user is warned.
   */
  function visualRoundTrip(md) {
    const c = getChecker();
    if (!c) return { identical: true, lossless: true, converted: md };
    try {
      const before = normalizeHtml(renderRaw(md));
      const joined = joinInlineBreaks(md);
      if (joined !== md) c.setMarkdown(joined, false);
      c.changeMode('wysiwyg', true);
      const converted = c.getMarkdown();
      c.changeMode('markdown', true);
      const after = normalizeHtml(renderRaw(converted));
      const identical = converted.replace(/\s+$/, '') === md.replace(/\r\n/g, '\n').replace(/\s+$/, '');
      return { identical, lossless: identical || before === after, converted };
    } catch (err) {
      console.error('Round-trip check failed', err);
      return { identical: false, lossless: false, converted: md };
    }
  }

  const SANITIZE = {
    FORBID_TAGS: ['style', 'script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
    FORBID_ATTR: ['contenteditable', 'srcset'],
    ALLOW_DATA_ATTR: false,
  };

  /** Sanitized HTML for export/print. Never trust Markdown-embedded HTML. */
  function renderSafe(md) {
    const raw = renderRaw(md);
    if (!window.DOMPurify) return '<pre>' + escapeHtml(md) + '</pre>';
    return DOMPurify.sanitize(raw, SANITIZE);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function stripCodeFences(md) {
    return md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ' ');
  }

  function stats(md) {
    const text = stripCodeFences(md)
      .replace(/^---\n[\s\S]*?\n---\n/, ' ')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#*_>`~|[\]()-]/g, ' ');
    const words = (text.match(/[^\s]+/g) || []).length;
    return { words, chars: md.length, minutes: Math.max(1, Math.round(words / 230)) };
  }

  /** ATX and setext headings, skipping fenced code and front matter. */
  function headings(md) {
    const out = [];
    const lines = md.split('\n');
    let fence = null;
    let start = 0;
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) start = end + 1;
    }
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      const f = line.match(/^\s{0,3}(```|~~~)/);
      if (f) { if (!fence) fence = f[1]; else if (f[1] === fence) fence = null; continue; }
      if (fence) continue;
      const m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (m) { out.push({ level: m[1].length, text: clean(m[2]), line: i + 1 }); continue; }
      const next = lines[i + 1];
      if (line.trim() && next !== undefined && /^\s{0,3}(=+|-+)\s*$/.test(next) && !/^\s{0,3}([-*+]|\d+[.)])\s/.test(line)) {
        out.push({ level: next.trim()[0] === '=' ? 1 : 2, text: clean(line.trim()), line: i + 1 });
        i++;
      }
    }
    return out;
  }
  // A heading's text as shown: links as their words, no emphasis marks, no backslash escapes ("7\\. Spawn points").
  const clean = (s) => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\([!-/:-@[-`{-~])/g, (_, c) => String.fromCharCode(0xE000 + c.charCodeAt(0))) // escaped: kept aside
    .replace(/[*_`~]/g, '')
    .replace(/[\uE000-\uE07F]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xE000))
    .trim();

  return { renderSafe, renderRaw, visualRoundTrip, joinInlineBreaks, stats, headings, escapeHtml };
})();
