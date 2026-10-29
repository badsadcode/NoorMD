// Stream schedule overlay renderer: "Next stream" (with a countdown, LIVE while it is on) and "This week". Used by the
// OBS overlay pages (served by NoorMD's loopback overlay server) and by the live preview in the Stream Desk, so what you
// design is what OBS shows. Pure DOM, no network access of its own; it counts down by itself between updates.
'use strict';
window.NoorSchedule = (() => {
  const DESIGNS = { glass: 'Glass card', lowerthird: 'Lower third', neon: 'Neon', minimal: 'Minimal text' };
  const FONTS = {
    inter: "'NoorOverlayInter', 'Inter Variable', 'Inter', 'Segoe UI', system-ui, sans-serif", system: "'Segoe UI', system-ui, sans-serif",
    rounded: "'Nunito', 'Varela Round', 'Segoe UI Rounded', 'Segoe UI', sans-serif", serif: "Georgia, 'Times New Roman', serif",
    mono: "'JetBrains Mono Variable', 'Cascadia Code', Consolas, monospace", display: "'Bahnschrift', 'Segoe UI Black', Impact, sans-serif",
  };
  const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'bottom-center', 'top-center'];
  const DEFAULTS = {
    design: 'glass', accent: '#ff5d73', text: '#ffffff', background: '#120e1f', bgOpacity: 0.75, font: 'inter', scale: 1, radius: 16,
    position: 'top-right', weekPosition: 'top-left', nextLabel: 'Next stream', liveLabel: 'Live now', weekTitle: 'This week',
    showGame: true, showPlatform: true, showCountdown: true, clock: 'auto', mondayFirst: true, hideWhenNone: false,
  };

  function clean(c) {
    const o = { ...DEFAULTS, ...(c || {}) };
    if (!DESIGNS[o.design]) o.design = DEFAULTS.design;
    if (!FONTS[o.font]) o.font = DEFAULTS.font;
    for (const k of ['accent', 'text', 'background']) if (!/^#[0-9a-f]{6}$/i.test(o[k])) o[k] = DEFAULTS[k];
    o.bgOpacity = Math.max(0, Math.min(1, Number(o.bgOpacity)));
    o.scale = Math.max(0.5, Math.min(3, Number(o.scale) || 1));
    o.radius = Math.max(0, Math.min(40, Number(o.radius) || 0));
    for (const k of ['position', 'weekPosition']) if (!POSITIONS.includes(o[k])) o[k] = DEFAULTS[k];
    for (const k of ['nextLabel', 'liveLabel', 'weekTitle']) o[k] = String(o[k] ?? '').slice(0, 60);
    if (!['auto', '24', '12'].includes(o.clock)) o.clock = 'auto';
    for (const k of ['showGame', 'showPlatform', 'showCountdown', 'mondayFirst', 'hideWhenNone']) o[k] = !!o[k];
    return o;
  }

  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  /** "in 2 h 15 min", "in 3 days", "starting now". */
  function countdown(ms) {
    if (ms <= 60_000) return 'starting now';
    const min = Math.round(ms / 60_000);
    if (min < 60) return `in ${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return m ? `in ${h} h ${m} min` : `in ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'tomorrow' : `in ${d} days`;
  }

  /** Creates a renderer inside `root`; mode "next" or "week". Returns { setConfig, setData, tick }. */
  function mount(root, mode, opts = {}) {
    let cfg = clean();
    let data = null;
    const now = opts.now || (() => new Date());
    const box = node('div', 'ovsc');
    root.append(box);
    const timer = setInterval(() => render(), 15_000);

    const fmtTime = () => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...(cfg.clock === 'auto' ? {} : { hour12: cfg.clock === '12' }) });
    const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

    function when(s, t) {
      const start = new Date(s.start), today = t;
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      const day = sameDay(start, today) ? 'Today' : sameDay(start, tomorrow) ? 'Tomorrow' : (start - today < 6 * 86400_000 ? fmtDay.format(start) : fmtDate.format(start));
      return s.allDay ? day : `${day} · ${fmtTime().format(start)}`;
    }
    const extra = (s) => [cfg.showGame ? s.game : null, cfg.showPlatform ? s.platform : null].filter((x) => x && x.trim()).join(' · ');

    function style() {
      const st = box.style;
      st.setProperty('--sc-accent', cfg.accent);
      st.setProperty('--sc-text', cfg.text);
      st.setProperty('--sc-bg', hexA(cfg.background, cfg.bgOpacity));
      st.setProperty('--sc-font', FONTS[cfg.font]);
      st.setProperty('--sc-scale', String(cfg.scale));
      st.setProperty('--sc-radius', cfg.radius + 'px');
      box.className = `ovsc ovsc-${mode} ovsc-design-${cfg.design} ovsc-pos-${mode === 'week' ? cfg.weekPosition : cfg.position}`;
    }

    function renderNext(t) {
      const s = data && data.next;
      if (!s || new Date(s.end) <= t) {
        box.classList.toggle('ovsc-hidden', cfg.hideWhenNone);
        box.replaceChildren(node('div', 'ovsc-label', cfg.nextLabel), node('div', 'ovsc-title', 'No stream planned'));
        return;
      }
      const live = new Date(s.start) <= t;
      box.classList.toggle('ovsc-live', live);
      const label = node('div', 'ovsc-label');
      if (live) label.append(node('span', 'ovsc-dot'), cfg.liveLabel);
      else label.textContent = cfg.nextLabel;
      const parts = [label, node('div', 'ovsc-title', s.title)];
      const more = extra(s);
      if (more) parts.push(node('div', 'ovsc-game', more));
      if (!live) {
        const line = node('div', 'ovsc-when', when(s, t));
        if (cfg.showCountdown && !s.allDay) line.append(node('span', 'ovsc-count', ' · ' + countdown(new Date(s.start) - t)));
        parts.push(line);
      }
      box.replaceChildren(...parts);
    }

    function renderWeek(t) {
      const list = (data && data.week) || [];
      if (!list.length) {
        box.classList.toggle('ovsc-hidden', cfg.hideWhenNone);
        box.replaceChildren(node('div', 'ovsc-label', cfg.weekTitle), node('div', 'ovsc-empty', 'No streams this week'));
        return;
      }
      const rows = list.map((s) => {
        const start = new Date(s.start), end = new Date(s.end);
        const row = node('div', 'ovsc-row' + (end <= t ? ' ovsc-past' : start <= t ? ' ovsc-now' : '') + (sameDay(start, t) ? ' ovsc-today' : ''));
        row.append(node('span', 'ovsc-day', fmtDay.format(start)), node('span', 'ovsc-time', s.allDay ? '' : fmtTime().format(start)));
        const what = node('span', 'ovsc-what', s.title);
        const more = extra(s);
        if (more) what.append(node('small', 'ovsc-game', more));
        row.append(what);
        if (start <= t && t < end) row.append(node('span', 'ovsc-badge', cfg.liveLabel));
        return row;
      });
      box.replaceChildren(node('div', 'ovsc-label', cfg.weekTitle), ...rows);
    }

    function render() {
      style();
      box.classList.remove('ovsc-hidden', 'ovsc-live');
      const t = now();
      if (mode === 'week') renderWeek(t); else renderNext(t);
    }

    render();
    return {
      setConfig(c) { cfg = clean(c); render(); },
      setData(d) { data = d; render(); },
      tick: render,
      destroy() { clearInterval(timer); box.remove(); },
      get config() { return { ...cfg }; },
    };
  }

  return { DESIGNS, FONTS, DEFAULTS, POSITIONS, clean, countdown, mount };
})();
