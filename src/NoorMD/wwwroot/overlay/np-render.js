// Now Playing overlay renderer. Used by the OBS overlay page (served by NoorMD's loopback overlay server) and by the
// live preview inside NoorMD, so what you design is exactly what OBS shows. Pure DOM, no network access of its own.
'use strict';
window.NoorNowPlaying = (() => {
  const DESIGNS = {
    glass: 'Glass card', lowerthird: 'Lower third', neon: 'Neon', vinyl: 'Vinyl', minimal: 'Minimal text', ticker: 'Ticker',
  };
  const FONTS = {
    inter: "'NoorOverlayInter', 'Inter Variable', 'Inter', 'Segoe UI', system-ui, sans-serif", system: "'Segoe UI', system-ui, sans-serif",
    rounded: "'Nunito', 'Varela Round', 'Segoe UI Rounded', 'Segoe UI', sans-serif", serif: "Georgia, 'Times New Roman', serif",
    mono: "'JetBrains Mono Variable', 'Cascadia Code', Consolas, monospace", display: "'Bahnschrift', 'Segoe UI Black', Impact, sans-serif",
  };
  const DEFAULTS = {
    design: 'glass', accent: '#b19aff', text: '#ffffff', background: '#120e1f', bgOpacity: 0.72, font: 'inter', scale: 1, radius: 16,
    position: 'bottom-left', showArt: true, showArtist: true, showProgress: true, label: 'Now playing', animation: 'slide', autoHide: 0, hideWhenPaused: false,
  };

  function clean(c) {
    const o = { ...DEFAULTS, ...(c || {}) };
    if (!DESIGNS[o.design]) o.design = 'glass';
    if (!FONTS[o.font]) o.font = 'inter';
    for (const k of ['accent', 'text', 'background']) if (!/^#[0-9a-f]{6}$/i.test(o[k])) o[k] = DEFAULTS[k];
    o.bgOpacity = Math.max(0, Math.min(1, Number(o.bgOpacity)));
    o.scale = Math.max(0.5, Math.min(3, Number(o.scale) || 1));
    o.radius = Math.max(0, Math.min(40, Number(o.radius) || 0));
    o.autoHide = Math.max(0, Math.min(600, Number(o.autoHide) || 0));
    o.label = String(o.label ?? '').slice(0, 60);
    if (!['slide', 'fade', 'pop', 'none'].includes(o.animation)) o.animation = 'slide';
    if (!['top-left', 'top-right', 'bottom-left', 'bottom-right', 'bottom-center', 'top-center'].includes(o.position)) o.position = 'bottom-left';
    return o;
  }

  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  /** Creates a renderer inside `root`. Returns { setConfig, setTrack, setProgress }. */
  function mount(root) {
    let cfg = clean();
    let track = null, hideTimer = 0, lastKey = '';
    const box = node('div', 'ovnp');
    root.append(box);

    function style() {
      const s = box.style;
      s.setProperty('--np-accent', cfg.accent);
      s.setProperty('--np-text', cfg.text);
      s.setProperty('--np-bg', hexA(cfg.background, cfg.bgOpacity));
      s.setProperty('--np-font', FONTS[cfg.font]);
      s.setProperty('--np-scale', String(cfg.scale));
      s.setProperty('--np-radius', cfg.radius + 'px');
      box.className = `ovnp ovnp-design-${cfg.design} ovnp-pos-${cfg.position} ovnp-anim-${cfg.animation}`;
    }

    function render(changed) {
      style();
      if (!track || !track.title) { box.classList.add('ovnp-hidden'); box.replaceChildren(); return; }
      const art = cfg.showArt && cfg.design !== 'minimal' && cfg.design !== 'ticker';
      const parts = [];
      if (art) {
        const a = node('div', 'ovnp-art');
        if (track.art) { const img = new Image(); img.alt = ''; img.src = track.art; img.onerror = () => img.remove(); a.append(img); }
        else a.append(node('span', 'ovnp-note', '♫'));
        parts.push(a);
      }
      const text = node('div', 'ovnp-text');
      if (cfg.label && cfg.design !== 'ticker') text.append(node('div', 'ovnp-label', cfg.label));
      const title = node('div', 'ovnp-title', cfg.design === 'ticker' ? `${cfg.label ? cfg.label + ': ' : ''}${track.title}${cfg.showArtist && track.artist ? ' — ' + track.artist : ''}` : cfg.design === 'minimal' ? `♪ ${track.title}${cfg.showArtist && track.artist ? ' — ' + track.artist : ''}` : track.title);
      if (cfg.design === 'ticker') { const wrap = node('div', 'ovnp-marquee'); wrap.append(title, title.cloneNode(true)); text.append(wrap); }
      else text.append(title);
      if (cfg.showArtist && track.artist && cfg.design !== 'minimal' && cfg.design !== 'ticker') text.append(node('div', 'ovnp-artist', track.artist));
      if (cfg.showProgress && cfg.design !== 'minimal' && cfg.design !== 'ticker') { const bar = node('div', 'ovnp-progress'); bar.append(node('span')); text.append(bar); }
      parts.push(text);
      box.replaceChildren(...parts);
      box.classList.toggle('ovnp-paused', !track.playing);
      box.classList.toggle('ovnp-hidden', cfg.hideWhenPaused && !track.playing);
      if (changed && cfg.animation !== 'none') { box.classList.remove('ovnp-enter'); void box.offsetWidth; box.classList.add('ovnp-enter'); }
      progress();
      clearTimeout(hideTimer);
      if (cfg.autoHide > 0) hideTimer = setTimeout(() => box.classList.add('ovnp-hidden'), cfg.autoHide * 1000);
    }

    function progress() {
      const bar = box.querySelector('.ovnp-progress > span');
      if (bar && track && track.duration > 0) bar.style.width = Math.min(100, (track.position / track.duration) * 100) + '%';
    }

    return {
      setConfig(c) { cfg = clean(c); render(false); },
      setTrack(t) {
        const key = t ? `${t.id}|${t.title}|${t.artist}` : '';
        const changed = key !== lastKey;
        lastKey = key;
        const wasPlaying = track && track.playing;
        track = t;
        if (changed || !!wasPlaying !== !!(t && t.playing)) render(changed);
        else progress();
      },
      get config() { return { ...cfg }; },
    };
  }

  return { DESIGNS, FONTS, DEFAULTS, clean, mount };
})();
