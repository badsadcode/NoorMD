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
 * A menu at (x, y). Items: { label, keys, run, disabled, checked } | '-' | { header }.
 * Arrow keys move, Enter runs, Esc closes; onClose runs when it closes for any reason.
 */
export function menu(x, y, items, { onClose, anchor } = {}) {
  closeMenu();
  const box = el('div', { class: 'nui-menu', role: 'menu' });
  const buttons = [];
  for (const it of items) {
    if (it === '-') { box.append(el('hr')); continue; }
    if (it.header) { box.append(el('div', { class: 'mh', text: it.header })); continue; }
    const dis = typeof it.disabled === 'function' ? it.disabled() : !!it.disabled;
    const chk = typeof it.checked === 'function' ? it.checked() : it.checked;
    const b = el('button', { class: 'mi', role: chk === undefined ? 'menuitem' : 'menuitemcheckbox', 'aria-checked': chk === undefined ? null : String(!!chk), 'aria-disabled': dis ? 'true' : null, tabindex: '-1' },
      chk === undefined ? null : el('span', { class: 'chk', text: chk ? '✓' : '' }), el('span', { text: it.label }), it.keys ? el('kbd', { text: it.keys }) : null);
    b.addEventListener('click', () => { if (dis) return; closeMenu(); it.run && it.run(); });
    box.append(b); if (!dis) buttons.push(b);
  }
  document.body.append(box);
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  box.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  const onKey = (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (buttons[(i + 1) % buttons.length] || buttons[0])?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (buttons[(i - 1 + buttons.length) % buttons.length] || buttons[0])?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
  };
  // A click outside closes this menu (and only this one: a menu replaced within the same moment, e.g. F10 then →,
  // must not leave its listener behind to close the next).
  let closed = false;
  const self = { box, close() { closed = true; document.removeEventListener('pointerdown', onDown, true); box.remove(); onClose && onClose(); } };
  const onDown = (e) => { if (closed || openMenu !== self) { document.removeEventListener('pointerdown', onDown, true); return; } if (!box.contains(e.target) && !(anchor && anchor.contains(e.target))) closeMenu(); };
  box.addEventListener('keydown', onKey);
  setTimeout(() => { if (!closed) document.addEventListener('pointerdown', onDown, true); }, 0);
  openMenu = self;
  (buttons[0] || box).focus({ preventScroll: true });
  return openMenu;
}
export const menuIsOpen = () => !!openMenu;

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
