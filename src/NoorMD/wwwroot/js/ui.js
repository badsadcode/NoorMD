// Small UI toolkit: toasts and accessible in-app dialogs (no browser confirm/prompt).
window.NoorUI = (() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  let noticeTimer = null;
  const openModals = [];

  function notice(text, ms = 2600) {
    const n = $('#notice');
    n.textContent = text;
    n.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => n.classList.remove('show'), ms);
  }

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  }

  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /**
   * Opens a modal. `build(surface, close)` fills the surface. Returns { close, element }.
   * Escape and backdrop clicks close it; Tab is kept inside; focus returns to the previous element.
   */
  function modal({ label, width, onClose }, build) {
    const previous = document.activeElement;
    const surface = el('div', { class: 'modal-surface' });
    if (width) surface.style.width = `min(${width}px, 100%)`;
    const backdrop = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, surface);
    let closed = false;
    const close = (result) => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      openModals.splice(openModals.indexOf(entry), 1);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
      if (onClose) onClose(result);
    };
    const entry = { close, backdrop };
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(undefined); });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return; // Escape is handled globally (app.js) so it works wherever focus is
      const items = [...surface.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    build(surface, close);
    document.body.appendChild(backdrop);
    openModals.push(entry);
    const auto = surface.querySelector('[autofocus]') || surface.querySelector(FOCUSABLE);
    if (auto) auto.focus();
    return { close, element: surface };
  }

  function closeAll() { [...openModals].reverse().forEach((m) => m.close(undefined)); }
  function closeTop() { if (openModals.length) openModals[openModals.length - 1].close(undefined); }
  const hasOpenModal = () => openModals.length > 0;

  function head(title, close) {
    return el('div', { class: 'modal-head' }, el('strong', { text: title }),
      el('button', { class: 'utility-btn', 'aria-label': 'Close', onclick: () => close(undefined) }, '✕'));
  }

  /** Promise<string|undefined> — resolves with the chosen button value. */
  function choose(title, message, buttons) {
    return new Promise((resolve) => {
      modal({ label: title, width: 520, onClose: resolve }, (s, close) => {
        const body = el('div', { class: 'modal-body' });
        for (const para of [].concat(message)) body.append(el('p', { text: para }));
        s.append(head(title, close), body, el('div', { class: 'modal-foot' },
          el('div', { class: 'modal-buttons' }, buttons.map((b) => el('button', {
            class: 'action' + (b.primary ? ' primary' : ''), autofocus: b.primary || undefined, onclick: () => close(b.value),
          }, b.label)))));
      });
    });
  }

  const confirm = (title, message, okLabel = 'Continue') =>
    choose(title, message, [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: true }]).then((v) => v === true);

  /** Promise<string|undefined> */
  function prompt(title, label, value, { type = 'text', okLabel = 'OK' } = {}) {
    return new Promise((resolve) => {
      modal({ label: title, width: 440, onClose: resolve }, (s, close) => {
        const input = el('input', { type, value: String(value ?? ''), 'aria-label': label, autofocus: true });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
        s.append(head(title, close),
          el('div', { class: 'modal-body' }, el('p', { text: label }), input),
          el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' },
            el('button', { class: 'action', onclick: () => close(undefined) }, 'Cancel'),
            el('button', { class: 'action primary', onclick: () => close(input.value) }, okLabel))));
        setTimeout(() => input.select(), 0);
      });
    });
  }

  return { $, el, notice, modal, head, choose, confirm, prompt, closeAll, closeTop, hasOpenModal };
})();
