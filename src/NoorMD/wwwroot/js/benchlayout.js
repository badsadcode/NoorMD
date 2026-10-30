/* NoorMD — how a bench with a preview and controls is arranged (NoorMaterial, NoorForm): one above the other or
   side by side, the list of presets shown or hidden, and the bar between them dragged to share the room. Remembered
   per bench. Side by side, a bench can have its preview take the free room and the controls a set width (sideSized:
   'edit'), and can move its top row (name, seed…) into the controls so the preview gets the full height. */
(() => {
  'use strict';

  /**
   * o: { root, storageKey, defaults, split, viewCol, editCol, splitter, sideButton, listButton, top?, sideSized?: 'view' | 'edit',
   *      onChange?(prefs) }. Returns { set(change), prefs, apply() }.
   */
  function attach(o) {
    let prefs = { side: false, list: true, height: 0, width: 0, ...(o.defaults || {}) };
    try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(o.storageKey) || '{}') }; } catch { /* private storage off */ }
    const editSized = () => prefs.side && o.sideSized === 'edit';
    const sized = () => (editSized() ? o.editCol : o.viewCol);

    function apply() {
      o.root.classList.toggle('tb-side', !!prefs.side);
      o.root.classList.toggle('tb-no-list', !prefs.list);
      o.viewCol.style.height = !prefs.side && prefs.height ? prefs.height + 'px' : '';
      o.viewCol.style.width = prefs.side && !editSized() && prefs.width ? prefs.width + 'px' : '';
      o.editCol.style.width = editSized() && prefs.width ? prefs.width + 'px' : '';
      if (o.top) { if (prefs.side) o.editCol.prepend(o.top); else o.split.before(o.top); }
      if (o.sideButton) { o.sideButton.setAttribute('aria-pressed', String(!!prefs.side)); o.sideButton.classList.toggle('on', !!prefs.side); }
      if (o.listButton) o.listButton.setAttribute('aria-pressed', String(!!prefs.list));
      o.splitter.setAttribute('aria-orientation', prefs.side ? 'vertical' : 'horizontal');
      if (o.onChange) o.onChange({ ...prefs });
    }

    function set(change) {
      prefs = { ...prefs, ...change };
      try { localStorage.setItem(o.storageKey, JSON.stringify(prefs)); } catch { /* private storage off */ }
      apply();
    }

    // The bar: drag it, or arrow keys on it; double-click puts the sizes back. The sized part is the preview, except
    // side by side with sideSized 'edit' (then the controls, so dragging right gives the preview more room).
    const limit = (v) => {
      const box = o.split.getBoundingClientRect();
      const total = prefs.side ? box.width : box.height;
      const least = prefs.side ? (editSized() ? 280 : 240) : 150;
      return Math.round(Math.max(least, Math.min(total - (prefs.side ? 300 : 140), v)));
    };
    const measure = () => { const r = sized().getBoundingClientRect(); return prefs.side ? r.width : r.height; };
    const sign = () => (editSized() ? -1 : 1);
    const setSize = (v) => set(prefs.side ? { width: limit(v) } : { height: limit(v) });
    let drag = null;
    const sp = o.splitter;
    sp.addEventListener('pointerdown', (e) => {
      e.preventDefault(); sp.setPointerCapture(e.pointerId);
      drag = { start: prefs.side ? e.clientX : e.clientY, size: measure() };
      sp.classList.add('dragging');
    });
    sp.addEventListener('pointermove', (e) => { if (drag) setSize(drag.size + sign() * ((prefs.side ? e.clientX : e.clientY) - drag.start)); });
    const end = () => { drag = null; sp.classList.remove('dragging'); };
    sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
    sp.addEventListener('dblclick', () => set(prefs.side ? { width: 0 } : { height: 0 }));
    sp.addEventListener('keydown', (e) => {
      const step = { ArrowUp: -24, ArrowLeft: -24, ArrowDown: 24, ArrowRight: 24 }[e.key];
      if (!step) return;
      e.preventDefault();
      setSize(measure() + sign() * step);
    });

    apply();
    return { set, apply, get prefs() { return { ...prefs }; } };
  }

  window.NoorBenchLayout = { attach };
})();
