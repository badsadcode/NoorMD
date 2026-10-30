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
  if (/^[A-Z][A-Za-z]+$/.test(t) && t.length > 18) return false; // a long CamelCase name
  if (/^[a-z]+([A-Z][a-z]+)+$/.test(t)) return false; // camelCase
  if (/^[\w.-]+\.[a-z0-9]{2,5}$/i.test(t) && !/ /.test(t)) return false; // a file name
  if (/^(Ctrl|Alt|Shift)\+/.test(t) && !/ /.test(t)) return false; // a key
  if (!/[A-Z ]/.test(t) && !/^[a-z]+$/.test(t)) return false;
  if (/^[a-z]+$/.test(t) && t.length < 3) return false;
  return true;
}

const keys = new Set();
const add = (s) => { s = s.replace(/\s+/g, ' ').trim(); if (isText(s)) keys.add(s); };

// The page: string literals; a template's ${…} become {0}, {1} …
function scanJs(src) {
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/gs;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 30), m.index);
    if (/(querySelector(All)?|\$\$?|getElementById|closest|matches|classList\.\w+|getAttribute|setAttribute|dataset\.?\w*|addEventListener|removeEventListener|getItem|setItem|removeItem|request|req|post|case|import|require|new RegExp|createElement|getPropertyValue|run)\(\s*$/.test(before)) continue;
    if (/\b(class|id|type|role|key|value|name|href|src|for|rel|tabindex|'data-[\w-]+'|kind|cmd|tab|icon|mode|blend|direction|layout|format)\s*:\s*$/.test(before)) continue;
    let s = m[1] ?? m[2];
    if (s !== undefined) { add(s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ')); continue; }
    s = m[3];
    if (/\$\{/.test(s)) {
      let n = 0;
      const pat = s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, () => `{${n++}}`);
      if (n <= 4 && /[A-Za-z]{3}/.test(pat.replace(/\{\d\}/g, ''))) add(pat);
    } else add(s);
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
    if (m[1]) { let n = 0; s = s.replace(/\{[^{}]+\}/g, () => `{${n++}}`); if (n > 4) continue; }
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
console.log(`${keys.size} texts → ${path.relative(root, out)}`);
