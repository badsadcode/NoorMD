// The Markdown bench's helpers that don't touch the visible editor: the Visual round-trip check (Visual view must
// never quietly rewrite a file), headings for the outline, statistics. From NoorMD 2.0 (markdown-tools.js, app.js).
const TUI = () => window.toastui;

let checker = null;

// A hidden, never-focused editor instance used purely for conversions.
function getChecker() {
  if (checker || !TUI() || !TUI().Editor) return checker;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:400px;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  checker = new (TUI().Editor)({
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

/** HTML for export and print, sanitised: Markdown-embedded HTML is never trusted. Callouts are drawn as callouts. */
function renderSafe(md) {
  const raw = renderRaw(md);
  if (!window.DOMPurify) return '<pre>' + escapeHtml(md) + '</pre>';
  const tpl = document.createElement('template');
  tpl.innerHTML = window.DOMPurify.sanitize(raw, SANITIZE);
  decorateCallouts(tpl.content);
  return tpl.innerHTML;
}

// Callouts: a quote whose first line is [!tip] (or note, warning, danger…) becomes a coloured box with a title.
const CALLOUT_ICONS = { note: '✎', info: 'ℹ', tip: '💡', hint: '💡', important: '❗', success: '✔', check: '✔', done: '✔', question: '?', help: '?', faq: '?',
  warning: '⚠', caution: '⚠', attention: '⚠', danger: '⛔', error: '⛔', bug: '🐞', example: '◆', quote: '❝', cite: '❝', abstract: '☰', summary: '☰', tldr: '☰', todo: '☐' };
const CALLOUT_LINE = /^\s*\[!([A-Za-z]+)\][+-]?[ \t]*([^\n]*)\n?/;
/** The callout type of a quote's text ("[!tip] Title…"), or null. */
function calloutType(text) { const m = CALLOUT_LINE.exec(text || ''); return m ? m[1].toLowerCase() : null; }
/** Turns [!type] quotes under root into callouts: a class, a title with an icon, the marker line taken out. */
function decorateCallouts(root) {
  for (const bq of root.querySelectorAll('blockquote:not(.callout)')) {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P' || !p.firstChild || p.firstChild.nodeType !== 3) continue;
    const t = p.firstChild, mm = CALLOUT_LINE.exec(t.data);
    if (!mm) continue;
    const type = mm[1].toLowerCase();
    t.data = t.data.slice(mm[0].length);
    if (p.firstChild === t && /^\s*$/.test(t.data)) { t.remove(); if (p.firstChild && p.firstChild.nodeName === 'BR') p.firstChild.remove(); }
    if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
    bq.classList.add('callout', 'callout-' + type);
    const title = document.createElement('div');
    title.className = 'callout-title';
    title.textContent = `${CALLOUT_ICONS[type] || '✎'}  ${mm[2].trim() || type.charAt(0).toUpperCase() + type.slice(1)}`;
    bq.prepend(title);
  }
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

/** \[\[Note\_1|alias\]\] → [[Note_1|alias]], outside code; anything that would not stay one link is left alone. */
function unescapeWikiLinks(text) {
  if (!text || text.indexOf('\\[\\[') < 0) return text;
  const fix = (s) => s.replace(/(^|[^\\])(\\?!)?\\\[\\\[((?:[^\]\n\\]|\\[^\n])+?)\\\]\\\]/g, (m, pre, bang, inner) => {
    const plain = inner.replace(/\\([!-/:-@[-`{-~])/g, '$1');
    if (/[\[\]]/.test(plain) || !plain.trim()) return m;
    return pre + (bang ? '!' : '') + '[[' + plain + ']]';
  });
  let out = '', fence = null, buf = '';
  const flushProse = () => { out += buf.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 ? part : fix(part))).join(''); buf = ''; };
  for (const line of text.split(/(?<=\n)/)) {
    const tl = line.trimStart();
    if (fence) { out += line; if (tl.startsWith(fence)) fence = null; continue; }
    if (tl.startsWith('```') || tl.startsWith('~~~')) { flushProse(); fence = tl.slice(0, 3); out += line; continue; }
    buf += line;
  }
  flushProse();
  return out;
}

// ---------------------------------------------------------------- properties (the front matter at the top of a note)
const LIST_KEYS = ['tags', 'aliases', 'cssclasses'];
const unquote = (v) => { const t = v.trim(); return (t.length > 1 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) ? t.slice(1, -1).replace(/\\"/g, '"') : t; };
/** Where the front matter is: { lines, start (first line after ---), end (the closing --- line) }, or null. */
function frontMatterSpan(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && (l.trim() === '---' || l.trim() === '...'));
  return end > 0 ? { lines, start: 1, end } : null;
}
/** The note's properties: [{ key, value, list }] (a list's value is an array). Lines it doesn't understand are kept as they are. */
function properties(text) {
  const span = frontMatterSpan(text);
  if (!span) return [];
  const out = [];
  for (let i = span.start; i < span.end; i++) {
    const m = /^([A-Za-z0-9_][\w \-]*?)\s*:\s*(.*)$/.exec(span.lines[i]);
    if (!m) continue;
    const key = m[1], v = m[2].trim();
    if (v === '') {
      const items = [];
      while (i + 1 < span.end && /^\s*-\s+/.test(span.lines[i + 1])) items.push(unquote(span.lines[++i].replace(/^\s*-\s+/, '')));
      out.push({ key, value: items, list: items.length > 0 || LIST_KEYS.includes(key.toLowerCase()) });
    } else if (v.startsWith('[') && v.endsWith(']')) out.push({ key, value: v.slice(1, -1).split(',').map(unquote).filter((x) => x), list: true });
    else out.push({ key, value: unquote(v), list: false });
  }
  return out;
}
function yamlScalar(v) {
  const s = String(v);
  return s === '' || /^[\s#&*!|>'"%@`{}[\],?:-]|: | #|\s$/.test(s) || /^(true|false|null|yes|no|~)$/i.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}
/** The text with one property set (value: a string, or an array for a list), or taken out (value null). Everything else
 * in the front matter stays exactly as written; a note without front matter gets some. */
function setProperty(text, key, value) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let span = frontMatterSpan(text);
  if (!span) {
    if (value === null) return text;
    lines.unshift('---', '---');
    span = { lines, start: 1, end: 1 };
  }
  let at = -1, len = 0, dashStyle = true;
  for (let i = span.start; i < span.end; i++) {
    const m = /^([A-Za-z0-9_][\w \-]*?)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m || m[1].toLowerCase() !== key.toLowerCase()) continue;
    at = i; len = 1;
    if (m[2].trim() === '') while (i + len < span.end && /^\s*-\s+/.test(lines[i + len])) len++;
    else if (m[2].trim().startsWith('[')) dashStyle = false;
    break;
  }
  const name = at >= 0 ? /^([A-Za-z0-9_][\w \-]*?)\s*:/.exec(lines[at])[1] : key;
  let block = [];
  if (value !== null) {
    if (Array.isArray(value)) block = !dashStyle ? [`${name}: [${value.map(yamlScalar).join(', ')}]`] : value.length ? [`${name}:`, ...value.map((v) => `  - ${yamlScalar(v)}`)] : [`${name}: []`];
    else block = [`${name}: ${yamlScalar(value)}`];
  }
  if (at >= 0) lines.splice(at, len, ...block);
  else lines.splice(span.end, 0, ...block);
  // An empty front matter goes away entirely.
  if (lines[0] === '---' && lines[1] === '---') lines.splice(0, 2);
  return lines.join(nl);
}

export { visualRoundTrip, joinInlineBreaks, headings, stats, unescapeWikiLinks, escapeHtml, renderSafe, decorateCallouts, calloutType, properties, setProperty };
