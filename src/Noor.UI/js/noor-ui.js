// Noor.UI helpers, shared by the shell and the benches: building elements, menus at a point, dialogs, toasts.

/** el('button', { class: 'nui-btn', onclick }, 'Text', child…) */
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

let openMenu = null;
export function closeMenu() { if (openMenu) { const m = openMenu; openMenu = null; m.close(); } }

/**
 * A menu at (x, y). Items: { label, keys, run, disabled, checked } | { label, sub: items or () => items } | '-' |
 * { header }. A submenu opens to the side on hover, click or →; ← and Esc close it. Arrow keys move, Enter runs, Esc
 * closes; onClose runs when the menu closes for any reason. When any item can be ticked, every item keeps the tick's
 * column, so the labels line up.
 */
export function menu(x, y, items, { onClose, anchor } = {}) {
  closeMenu();
  const boxes = [];   // the menu and its open submenus, outermost first
  let closed = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!closed) fn(); }, ms); timers.add(t); return t; };
  function build(list, level) {
    const box = el('div', { class: 'nui-menu', role: 'menu' });
    const buttons = [];
    const ticks = list.some((it) => it && typeof it === 'object' && it.checked !== undefined);
    let hoverTimer = 0;
    const stopHover = () => { clearTimeout(hoverTimer); timers.delete(hoverTimer); };
    for (const it of list) {
      if (!it) continue;
      if (it === '-') { box.append(el('hr')); continue; }
      if (it.header) { box.append(el('div', { class: 'mh' + (ticks ? ' ticked' : ''), text: it.header })); continue; }
      const dis = typeof it.disabled === 'function' ? it.disabled() : !!it.disabled;
      const chk = typeof it.checked === 'function' ? it.checked() : it.checked;
      const sub = it.sub;
      const b = el('button', { class: 'mi' + (sub ? ' has-sub' : ''), role: sub ? 'menuitem' : chk === undefined ? 'menuitem' : 'menuitemcheckbox', 'aria-haspopup': sub ? 'menu' : null,
        'aria-checked': chk === undefined || sub ? null : String(!!chk), 'aria-disabled': dis ? 'true' : null, tabindex: '-1' },
      ticks ? el('span', { class: 'chk', text: chk ? '✓' : '' }) : null, el('span', { class: 'lbl', text: it.label }),
      it.keys ? el('kbd', { text: it.keys }) : null, sub ? el('span', { class: 'arrow', text: '›' }) : null);
      const openSub = (focusFirst) => {
        if (closed) return;
        while (boxes.length > level + 1) boxes.pop().box.remove();
        if (dis) return;
        const child = build(typeof sub === 'function' ? sub() : sub, level + 1);
        document.body.append(child.box);
        const br = b.getBoundingClientRect(), cr = child.box.getBoundingClientRect();
        const left = br.right + cr.width + 4 <= innerWidth ? br.right + 2 : br.left - cr.width - 2;
        child.box.style.left = Math.max(8, left) + 'px';
        child.box.style.top = Math.max(8, Math.min(br.top - 6, innerHeight - cr.height - 8)) + 'px';
        boxes.push(child);
        box.querySelectorAll('.mi.open').forEach((m) => m.classList.remove('open'));
        b.classList.add('open');
        if (focusFirst) (child.buttons[0] || child.box).focus({ preventScroll: true });
      };
      if (sub) {
        b.addEventListener('click', () => { stopHover(); openSub(true); });
        b.addEventListener('pointerenter', () => { stopHover(); hoverTimer = later(() => openSub(false), 120); });
        b._openSub = openSub;
      } else {
        b.addEventListener('pointerenter', () => { stopHover(); hoverTimer = later(() => { while (boxes.length > level + 1) boxes.pop().box.remove(); box.querySelectorAll('.mi.open').forEach((m) => m.classList.remove('open')); }, 160); });
        b.addEventListener('click', () => { if (dis) return; closeMenu(); it.run && it.run(); });
      }
      box.append(b); if (!dis) buttons.push(b);
    }
    box.addEventListener('keydown', (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); (buttons[(i + 1) % buttons.length] || buttons[0])?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); (buttons[(i - 1 + buttons.length) % buttons.length] || buttons[0])?.focus(); }
      else if (e.key === 'ArrowRight' && document.activeElement && document.activeElement._openSub) { e.preventDefault(); e.stopPropagation(); document.activeElement._openSub(true); }
      else if ((e.key === 'ArrowLeft' || e.key === 'Escape') && level > 0) {
        e.preventDefault(); e.stopPropagation();
        while (boxes.length > level) boxes.pop().box.remove();
        const parent = boxes[level - 1];
        const opener = parent && parent.box.querySelector('.mi.open');
        if (opener) { opener.classList.remove('open'); opener.focus(); }
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    });
    return { box, buttons };
  }
  const top = build(items, 0);
  boxes.push(top);
  document.body.append(top.box);
  const r = top.box.getBoundingClientRect();
  top.box.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  top.box.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  // A click outside closes this menu (and only this one: a menu replaced within the same moment, e.g. F10 then →,
  // must not leave its listener behind to close the next).
  const self = { box: top.box, close() { closed = true; timers.forEach(clearTimeout); timers.clear(); document.removeEventListener('pointerdown', onDown, true); boxes.forEach((b) => b.box.remove()); boxes.length = 0; onClose && onClose(); } };
  const onDown = (e) => { if (closed || openMenu !== self) { document.removeEventListener('pointerdown', onDown, true); return; } if (!boxes.some((b) => b.box.contains(e.target)) && !(anchor && anchor.contains(e.target))) closeMenu(); };
  setTimeout(() => { if (!closed) document.addEventListener('pointerdown', onDown, true); }, 0);
  openMenu = self;
  (top.buttons[0] || top.box).focus({ preventScroll: true });
  return openMenu;
}
export const menuIsOpen = () => !!openMenu;

/** How well a query matches a text (letters in order; whole-word and early matches score higher), or -1. */
export function fuzzyScore(query, text) {
  const q = query.toLowerCase().trim(), t = text.toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at >= 0) return 1000 - at * 2 - t.length * 0.1 + (at === 0 || /[\s/_\-.]/.test(t[at - 1]) ? 200 : 0);
  let score = 0, ti = 0, run = 0;
  for (const c of q) {
    if (c === ' ') continue;
    const i = t.indexOf(c, ti);
    if (i < 0) return -1;
    run = i === ti ? run + 1 : 0;
    score += 10 + run * 5 - (i - ti);
    ti = i + 1;
  }
  return score - t.length * 0.1;
}

/**
 * A quick picker (Ctrl+P and friends): a box at the top with a filter and a list. Items: { label, detail, keywords,
 * icon }. Resolves with the chosen item, or null (Esc, a click outside).
 */
export function quickPick(items, { placeholder = 'Type to search', empty = 'Nothing matches.', limit = 14 } = {}) {
  return new Promise((resolve) => {
    let shown = [], index = 0;
    const input = el('input', { class: 'nui-field nui-pick-input', type: 'text', placeholder, 'aria-label': placeholder, spellcheck: 'false' });
    const list = el('div', { class: 'nui-pick-list', role: 'listbox' });
    const scrim = el('div', { class: 'nui-scrim nui-pick-scrim', onpointerdown: (e) => { if (e.target === scrim) finish(null); } },
      el('div', { class: 'nui-pick', role: 'dialog', 'aria-label': placeholder }, input, list));
    const finish = (v) => { scrim.remove(); resolve(v); };
    const draw = () => {
      const q = input.value;
      shown = q.trim()
        ? items.map((it) => ({ it, s: Math.max(fuzzyScore(q, it.label), it.keywords ? fuzzyScore(q, it.keywords) - 50 : -1, it.detail ? fuzzyScore(q, it.detail) - 300 : -1) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.it)
        : items.slice(0, limit);
      index = Math.min(index, Math.max(0, shown.length - 1));
      list.replaceChildren(...(shown.length ? shown.map((it, i) => el('div', { class: 'nui-pick-item', role: 'option', 'aria-selected': String(i === index),
        onmousedown: (e) => { e.preventDefault(); finish(it); }, onmousemove: () => { if (index !== i) { index = i; draw(); } } },
        it.icon ? el('span', { class: 'ic', text: it.icon }) : null, el('span', { class: 'l', text: it.label }), it.detail ? el('span', { class: 'd', text: it.detail }) : null))
        : [el('div', { class: 'nui-pick-empty', text: empty })]));
    };
    input.addEventListener('input', () => { index = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); index = (index + 1) % Math.max(1, shown.length); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); index = (index - 1 + shown.length) % Math.max(1, shown.length); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[index]) finish(shown[index]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
    });
    document.body.append(scrim);
    draw();
    input.focus();
  });
}

/** A dialog with a title, a body (element or builder) and buttons; resolves with the button's value (or null on Esc). */
export function dialog(title, body, buttons = [{ label: 'Close', value: null, primary: true }]) {
  return new Promise((resolve) => {
    const finish = (v) => { scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    const scrim = el('div', { class: 'nui-scrim', onpointerdown: (e) => { if (e.target === scrim) finish(null); } },
      el('div', { class: 'nui-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        el('header', {}, el('span', { text: title }), el('button', { class: 'nui-icon', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => finish(null) }, '✕')),
        el('div', { class: 'body' }, typeof body === 'function' ? body(finish) : body),
        el('footer', {}, ...buttons.map((b) => el('button', { class: 'nui-btn' + (b.primary ? ' primary' : ''), onclick: () => finish(b.value) }, b.label)))));
    document.body.append(scrim);
    document.addEventListener('keydown', onKey, true);
    const first = scrim.querySelector('input, select, textarea, .nui-btn.primary');
    if (first) first.focus();
  });
}
export const dialogIsOpen = () => !!document.querySelector('.nui-scrim');

/** A short message in the corner. */
export function toast(text, { error = false, ms = 3800 } = {}) {
  let box = document.querySelector('.nui-toasts');
  if (!box) { box = el('div', { class: 'nui-toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = el('div', { class: 'nui-toast' + (error ? ' error' : ''), role: error ? 'alert' : 'status', text });
  box.append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}
