// Number fields everywhere: the mouse wheel over one turns its value up or down (Shift: ten steps), and the small
// arrows at its right end do the same when clicked (held: they keep going). The arrows are drawn in the field itself
// (nothing is added to the page), the field's own min, max and step are kept, and the page hears the change as if it
// had been typed (input and change), so every bench and dialog works with it unchanged.
window.NoorNumSpin = (() => {
  'use strict';
  const ZONE = 18; // the arrows' width, at the field's right end

  /** One step up (dir 1) or down (−1), n times: within min and max, on the field's step. */
  function step(input, dir, n = 1) {
    if (input.disabled || input.readOnly) return;
    const before = input.value;
    try { for (let i = 0; i < n; i++) (dir > 0 ? input.stepUp() : input.stepDown()); }
    catch {
      // step="any": a step of 1 (or a tenth for a value with decimals), kept within min and max by hand.
      const v = Number(input.value) || 0, s = /\./.test(input.value) ? 0.1 : 1;
      let next = Math.round((v + dir * s * n) * 1000) / 1000;
      if (input.min !== '') next = Math.max(Number(input.min), next);
      if (input.max !== '') next = Math.min(Number(input.max), next);
      input.value = String(next);
    }
    if (input.value === before) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const numberAt = (t) => (t && t.matches && t.matches('input[type=number]') ? t : null);
  /** Which arrow a pointer is on (1 up, −1 down, 0 none). */
  function arrowAt(input, e) {
    const r = input.getBoundingClientRect();
    if (e.clientX < r.right - ZONE || e.clientX > r.right) return 0;
    return e.clientY < r.top + r.height / 2 ? 1 : -1;
  }

  let hold = 0, repeat = 0;
  const stop = () => { clearTimeout(hold); clearInterval(repeat); hold = repeat = 0; };

  function init() {
    document.addEventListener('mousedown', (e) => {
      const input = numberAt(e.target);
      if (!input || e.button !== 0 || input.disabled || input.readOnly) return;
      const dir = arrowAt(input, e);
      if (!dir) return;
      e.preventDefault();
      input.focus({ preventScroll: true });
      const n = e.shiftKey ? 10 : 1;
      step(input, dir, n);
      hold = setTimeout(() => { repeat = setInterval(() => step(input, dir, n), 60); }, 400);
    }, true);
    document.addEventListener('mouseup', stop, true);
    window.addEventListener('blur', stop);
    // Over the arrows the pointer is an arrow, not a text cursor; the one under it lights up.
    document.addEventListener('mousemove', (e) => {
      const input = numberAt(e.target);
      if (!input) return;
      const dir = arrowAt(input, e);
      input.classList.toggle('numspin-up', dir === 1);
      input.classList.toggle('numspin-down', dir === -1);
    }, true);
    document.addEventListener('mouseout', (e) => { const input = numberAt(e.target); if (input) { input.classList.remove('numspin-up', 'numspin-down'); stop(); } }, true);
    // The wheel over a number field (focused or not) turns it; the page doesn't scroll under it.
    document.addEventListener('wheel', (e) => {
      const input = numberAt(e.target);
      if (!input || input.disabled || input.readOnly || !e.deltaY) return;
      e.preventDefault();
      e.stopPropagation();
      step(input, e.deltaY < 0 ? 1 : -1, e.shiftKey ? 10 : 1);
    }, { passive: false, capture: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  return { step };
})();
