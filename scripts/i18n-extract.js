#!/usr/bin/env node
// Collects every English text NoorMD shows (from the page's scripts and the app's C#) into
// src/NoorMD/wwwroot/lang/en.json: the list a translation fills in. Text built with values in it becomes a pattern
// ("{0} frames"). Run it after changing what the app says: node scripts/i18n-extract.js
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'src/NoorMD/wwwroot/lang/en.json');

/** Does a string look like words someone reads (not an id, a selector, a path, CSS, code)? */
function isText(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 600 || !/[A-Za-z]{2}/.test(t)) return false;
  if (/^[a-z0-9_.:\-\/#\[\]=*>+~^$|"' ,()@%!]+$/.test(t) && !/^[a-z]+ [a-z]/.test(t)) return false; // ids, selectors, keys
  if (/^(https?:|mailto:|data:|_noormd|\.\/|\/|#|\.|--|var\(|rgba?\(|url\(|[a-z-]+:\s*[^ ]+;)/.test(t)) return false;
  if (/[{};]\s*$|=>|\bfunction\b|\breturn\b|\bconst\b|===|\|\||&&|\.(js|css|html|png|json)\b/.test(t)) return false;
  if (/\$\{|\$\{?$|\?\s*$|['"`]\s*\)|\b(err|catch|notice|el)\(|^[a-z]\s|^[,;:)}\]'"’”]|^[a-z]+\.[a-z]+[A-Z]?\w*$/.test(t)) return false; // code and pieces of it
  if (/^[A-Z][A-Za-z]+$/.test(t) && t.length > 18) return false; // a long CamelCase name
  if (/^[a-z]+([A-Z][a-z]+)+$/.test(t)) return false; // camelCase
  if (/^[\w.-]+\.[a-z0-9]{2,5}$/i.test(t) && !/ /.test(t)) return false; // a file name
  if (/^(Ctrl|Alt|Shift)\+/.test(t) && !/ /.test(t)) return false; // a key
  if (!/[A-Z ]/.test(t) && !/^[a-z]+$/.test(t)) return false;
  if (/^[a-z]+$/.test(t) && t.length < 3) return false;
  return true;
}

const keys = new Set();
/** ${n === 1 ? '' : 's'} (or "y" / "ies"): an English ending, written {|s} (or {y|ies}) in the key; else null. */
function ending(x) {
  const m = /\?\s*(['"])([a-z]{0,3})\1\s*:\s*(['"])([a-z]{0,3})\3\s*\)?\s*\}$/.exec(x);
  return m && m[2] !== m[4] ? `{${m[2]}|${m[4]}}` : null;
}
// Keys as they were before endings had their own form (for carrying translations over): old → new.
const renames = {};
function renamed(was, now) { if (was !== now) renames[was.replace(/\s+/g, ' ').trim()] = now.replace(/\s+/g, ' ').trim(); }
const add = (s) => { s = s.replace(/\s+/g, ' ').trim(); if (isText(s)) keys.add(s); };

// The page: its string literals, found by reading the code as JavaScript does (comments and regular expressions are
// stepped over, so an apostrophe in a comment can't run text and code together); a template's ${…} become {0}, {1} …
function literals(src) {
  const out = [];
  let i = 0, prev = '';
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$|typeof$/.test(prev)) {
      // A regular expression: to its closing slash (not one in a [class]).
      let j = i + 1, inClass = false;
      while (j < n && src[j] !== '\n') { const e = src[j]; if (e === '\\') { j += 2; continue; } if (e === '[') inClass = true; else if (e === ']') inClass = false; else if (e === '/' && !inClass) break; j++; }
      i = j + 1; while (/[a-z]/.test(src[i] || '')) i++; prev = 'x'; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, v = '';
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { v += src[j + 1] === 'n' ? ' ' : src[j + 1]; j += 2; continue; } v += src[j++]; }
      out.push({ at: i, text: v, template: false }); i = j + 1; prev = 'x'; continue;
    }
    if (c === '`') {
      // A template: its text, with each ${…} (braces counted, strings in it skipped) kept as it is.
      let j = i + 1, v = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { v += src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 0, k = j + 1;
          for (; k < n; k++) { const e = src[k]; if (e === '{') depth++; else if (e === '}') { depth--; if (!depth) break; } else if (e === "'" || e === '"' || e === '`') { const q = e; k++; while (k < n && src[k] !== q) { if (src[k] === '\\') k++; k++; } } }
          v += src.slice(j, k + 1); j = k + 1; continue;
        }
        v += src[j++];
      }
      out.push({ at: i, text: v, template: true }); i = j + 1; prev = 'x'; continue;
    }
    if (!/\s/.test(c)) { if (/[A-Za-z0-9_$]/.test(c)) { let j = i; while (/[A-Za-z0-9_$]/.test(src[j] || '')) j++; prev = src.slice(i, j); i = j; continue; } prev = c; }
    i++;
  }
  return out;
}

function scanJs(src) {
  for (const lit of literals(src)) {
    const before = src.slice(Math.max(0, lit.at - 30), lit.at);
    if (/(querySelector(All)?|\$\$?|getElementById|closest|matches|classList\.\w+|getAttribute|setAttribute|dataset\.?\w*|addEventListener|removeEventListener|getItem|setItem|removeItem|request|req|post|case|import|require|new RegExp|createElement|getPropertyValue|run)\(\s*$/.test(before)) continue;
    if (/\b(class|id|type|role|key|value|name|href|src|for|rel|tabindex|'data-[\w-]+'|kind|cmd|tab|icon|mode|blend|direction|layout|format)\s*:\s*$/.test(before)) continue;
    const s = lit.text;
    // A short lowercase word is a label when it is shown as text, or is the label of an [value, label] pair.
    if (/^[a-z]{3,14}$/.test(s) && /(\btext:\s*|\blabel:\s*|\[\s*[\w.'"-]+,\s*)$/.test(before)) { keys.add(s); continue; }
    // Anything given as a text, a title, a label or a placeholder is words to read.
    if (!lit.template && /(\btext|\btitle|\blabel|'aria-label'|\bplaceholder):\s*$/.test(before) && /[A-Za-z]{2}/.test(s) && s.trim().length < 600) { keys.add(s.replace(/\s+/g, ' ').trim()); continue; }
    if (!lit.template || !/\$\{/.test(s)) { add(s); continue; }
    // An English plural ending (${n === 1 ? '' : 's'}) is {|s} in the key: a translation writes its own form.
    let k = 0, o = 0;
    const pat = s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, (x) => { const e = ending(x); return e !== null ? e : `{${k++}}`; });
    const was = s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, () => `{${o++}}`);
    if (k <= 4 && /[A-Za-z]{3}/.test(pat.replace(/\{[^}]*\}/g, ''))) { add(pat); renamed(was, pat); }
  }
}

// The app: strings in dialogs, errors and messages; $"…{x}…" become patterns.
function scanCs(src) {
  const re = /(\$?)"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 60), m.index);
    if (!/(BridgeError\(|Exception\(|Title\s*=|Filter\s*=|Tr\.T\(|notes\.Add\(|MessageBox\.Show\(|Description\s*=|Content\s*=|Text\s*=|ToolTip\s*=|Header\s*=)\s*$/.test(before)) continue;
    let s = m[2].replace(/\\"/g, '"');
    if (m[1]) {
      let n = 0, k = 0;
      const was = s.replace(/\{(?:[^{}]|\([^()]*\))+\}/g, () => `{${k++}}`);
      s = s.replace(/\{(?:[^{}]|\([^()]*\))+\}/g, (x) => { const e = ending(x); return e !== null ? e : `{${n++}}`; });
      if (n > 4) continue;
      renamed(was, s);
    }
    add(s);
  }
}

function walk(dir, ext, fn) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (!/^(bin|obj|vendor|node_modules|lang)$/.test(f.name)) walk(p, ext, fn); }
    else if (f.name.endsWith(ext)) fn(fs.readFileSync(p, 'utf8'));
  }
}
walk(path.join(root, 'src/NoorMD/wwwroot/js'), '.js', scanJs);
walk(path.join(root, 'src/NoorMD/wwwroot/overlay'), '.js', scanJs);
const html = fs.readFileSync(path.join(root, 'src/NoorMD/wwwroot/index.html'), 'utf8');
for (const m of html.matchAll(/>([^<>]*[A-Za-z][^<>]*)</g)) add(m[1]);
for (const m of html.matchAll(/(?:title|aria-label|placeholder)="([^"]+)"/g)) add(m[1]);
walk(path.join(root, 'src/NoorMD'), '.cs', scanCs);
walk(path.join(root, 'src/NoorMD.Core'), '.cs', scanCs);
walk(path.join(root, 'src/NoorMD.Media'), '.cs', scanCs);

const list = { _language: 'English', _note: 'Every English text NoorMD shows. A translation is this list with the translations filled in ({0}, {1} … stand for numbers and names, in any order).' };
for (const k of [...keys].sort((a, b) => a.localeCompare(b))) list[k] = '';
fs.writeFileSync(out, JSON.stringify(list, null, 1) + '\n');
if (process.env.NOOR_I18N_RENAMES) fs.writeFileSync(process.env.NOOR_I18N_RENAMES, JSON.stringify(renames, null, 1));
console.log(`${keys.size} texts → ${path.relative(root, out)}`);
