// Credits roll renderer: supporters scrolling over an "effect" (background + particles + name animation). Used by
// the OBS credits page and by NoorMD's preview and effect builder. An effect is plain data, so a new one is just a
// few choices saved under a name; nothing here runs code from the effect.
'use strict';
window.NoorCredits = (() => {
  const PARTICLES = { none: 'None', stars: 'Twinkling stars', sparkles: 'Sparkles', hearts: 'Hearts', confetti: 'Confetti', snow: 'Snow', bubbles: 'Bubbles', emoji: 'Emoji / symbol' };
  const NAME_ANIMS = { none: 'None', glow: 'Glow', shimmer: 'Shimmer', wave: 'Wave', fade: 'Fade in' };
  const EFFECTS = {
    classic: { label: 'Classic', background: { type: 'transparent' }, particles: { kind: 'none' }, nameAnim: 'none' },
    starfield: { label: 'Starfield', background: { type: 'gradient', color1: '#05040f', color2: '#1b1240', animate: true }, particles: { kind: 'stars', count: 160, speed: 0.4, size: 1, direction: 'drift', colors: ['#ffffff', '#cfc4ff'] }, nameAnim: 'glow' },
    hearts: { label: 'Neon hearts', background: { type: 'transparent' }, particles: { kind: 'hearts', count: 40, speed: 0.8, size: 1.2, direction: 'up', colors: ['#ff6fae', '#b19aff', '#ff9bd2'] }, nameAnim: 'glow' },
    confetti: { label: 'Confetti party', background: { type: 'transparent' }, particles: { kind: 'confetti', count: 120, speed: 1.2, size: 1, direction: 'down', colors: ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#b19aff'] }, nameAnim: 'wave' },
    snow: { label: 'Snowfall', background: { type: 'gradient', color1: '#0b1630', color2: '#1d2f55', animate: false }, particles: { kind: 'snow', count: 140, speed: 0.6, size: 1, direction: 'down', colors: ['#ffffff'] }, nameAnim: 'fade' },
    violet: { label: 'Violet dream', background: { type: 'gradient', color1: '#120a24', color2: '#3b1f6e', animate: true }, particles: { kind: 'sparkles', count: 70, speed: 0.6, size: 1.1, direction: 'drift', colors: ['#b19aff', '#e2d9ff', '#7f66db'] }, nameAnim: 'shimmer' },
  };
  const DEFAULTS = {
    title: 'Thank you, supporters!', message: 'This stream exists because of you.', endText: 'See you next stream 💜',
    groupByTier: true, showChannel: true, speed: 70, loop: false, autoStart: true, startDelay: 1,
    font: 'inter', scale: 1, text: '#ffffff', accent: '#b19aff', shadow: true, effect: 'violet',
  };
  const FONTS = (window.NoorNowPlaying && window.NoorNowPlaying.FONTS) || { inter: 'system-ui, sans-serif' };

  const hex = (s, d) => (/^#[0-9a-f]{6}$/i.test(s || '') ? s : d);
  const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d; };

  function cleanEffect(e) {
    e = e && typeof e === 'object' ? e : EFFECTS.classic;
    const bg = e.background || {}, p = e.particles || {};
    return {
      label: String(e.label || 'Custom').slice(0, 60),
      background: { type: ['transparent', 'solid', 'gradient'].includes(bg.type) ? bg.type : 'transparent', color1: hex(bg.color1, '#120a24'), color2: hex(bg.color2, '#3b1f6e'), animate: !!bg.animate },
      particles: {
        kind: PARTICLES[p.kind] ? p.kind : 'none', emoji: [...String(p.emoji || '💜')].slice(0, 2).join(''),
        count: num(p.count, 0, 400, 60), speed: num(p.speed, 0.1, 4, 1), size: num(p.size, 0.3, 4, 1),
        direction: ['down', 'up', 'drift'].includes(p.direction) ? p.direction : 'down',
        colors: (Array.isArray(p.colors) ? p.colors : []).map((c) => hex(c, null)).filter(Boolean).slice(0, 8),
      },
      nameAnim: NAME_ANIMS[e.nameAnim] ? e.nameAnim : 'none',
    };
  }

  function clean(c, customEffects) {
    const o = { ...DEFAULTS, ...(c || {}) };
    for (const k of ['title', 'message', 'endText']) o[k] = String(o[k] ?? '').slice(0, 400);
    o.speed = num(o.speed, 10, 400, 70); o.scale = num(o.scale, 0.5, 3, 1); o.startDelay = num(o.startDelay, 0, 30, 1);
    o.text = hex(o.text, '#ffffff'); o.accent = hex(o.accent, '#b19aff');
    if (!FONTS[o.font]) o.font = 'inter';
    const custom = (customEffects || []).find((x) => x.id === o.effect);
    o.effectData = cleanEffect(custom || EFFECTS[o.effect] || (typeof o.effect === 'object' ? o.effect : EFFECTS.violet));
    return o;
  }

  /** "https://www.youtube.com/@noor" → "@noor"; twitch → "twitch.tv/name"; others: host/path, shortened. */
  function shortChannel(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\.|^m\./, '');
      const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
      if (/youtube\.com$/.test(host)) { const at = path.match(/\/(@[^/]+)/); return at ? at[1] : 'YouTube'; }
      if (host === 'twitch.tv') return 'twitch.tv' + path;
      const s = host + path;
      return s.length > 40 ? s.slice(0, 39) + '…' : s;
    } catch { return ''; }
  }

  function mount(root) {
    let cfg = clean();
    let people = [];
    let raf = 0, startAt = 0, running = false, parts = [], last = 0, onDone = null;
    const stage = document.createElement('div');
    stage.className = 'cr-stage';
    const bg = document.createElement('div'); bg.className = 'cr-bg';
    const canvas = document.createElement('canvas'); canvas.className = 'cr-canvas';
    const roll = document.createElement('div'); roll.className = 'cr-roll';
    stage.append(bg, canvas, roll);
    root.append(stage);
    const ctx = canvas.getContext('2d');

    function build() {
      const e = cfg.effectData;
      stage.style.setProperty('--cr-font', FONTS[cfg.font]);
      stage.style.setProperty('--cr-text', cfg.text);
      stage.style.setProperty('--cr-accent', cfg.accent);
      stage.style.setProperty('--cr-scale', String(cfg.scale * (stage.clientHeight || 1080) / 1080));
      stage.className = `cr-stage cr-anim-${e.nameAnim}${cfg.shadow ? ' cr-shadow' : ''}`;
      bg.style.background = e.background.type === 'solid' ? e.background.color1 : e.background.type === 'gradient' ? `linear-gradient(160deg, ${e.background.color1}, ${e.background.color2}, ${e.background.color1})` : 'transparent';
      bg.style.backgroundSize = e.background.type === 'gradient' && e.background.animate ? '100% 300%' : '';
      bg.style.animation = e.background.type === 'gradient' && e.background.animate ? 'cr-bgmove 18s ease-in-out infinite alternate' : '';
      const el = (cls, text) => { const d = document.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d; };
      const kids = [];
      if (cfg.title) kids.push(el('cr-title', cfg.title));
      if (cfg.message) kids.push(el('cr-message', cfg.message));
      const active = people.filter((p) => p && p.name);
      const groups = new Map();
      for (const p of active) { const k = cfg.groupByTier ? (p.tier || '') : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
      for (const [tier, list] of groups) {
        if (tier) kids.push(el('cr-tier', tier));
        for (const p of list) {
          const n = el('cr-name', p.name);
          const ch = cfg.showChannel && p.channel ? shortChannel(p.channel) : '';
          if (ch) { const s = document.createElement('span'); s.className = 'cr-channel'; s.textContent = ch; n.append(s); }
          kids.push(n);
        }
      }
      if (!active.length) kids.push(el('cr-message', 'Your supporters will appear here.'));
      if (cfg.endText) kids.push(el('cr-end', cfg.endText));
      roll.replaceChildren(...kids);
      seedParticles();
      place(running ? undefined : 0);
    }

    function size() {
      const r = stage.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stage.style.setProperty('--cr-scale', String(cfg.scale * (r.height || 1080) / 1080));
    }

    function seedParticles() {
      size();
      const p = cfg.effectData.particles;
      const w = stage.clientWidth || 1920, h = stage.clientHeight || 1080;
      const k = h / 1080;
      parts = p.kind === 'none' ? [] : Array.from({ length: p.count }, () => ({
        x: Math.random() * w, y: Math.random() * h, r: (p.kind === 'stars' ? 1 + Math.random() * 2 : 6 + Math.random() * 10) * p.size * k,
        vx: (Math.random() - 0.5) * 20 * k, vy: (20 + Math.random() * 40) * p.speed * k, rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 3,
        phase: Math.random() * Math.PI * 2, color: p.colors.length ? p.colors[Math.floor(Math.random() * p.colors.length)] : '#ffffff',
      }));
    }

    function heart(x, y, s) {
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.3);
      ctx.bezierCurveTo(x, y, x - s * 0.5, y - s * 0.1, x - s * 0.5, y + s * 0.3);
      ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
      ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
      ctx.bezierCurveTo(x + s * 0.5, y - s * 0.1, x, y, x, y + s * 0.3);
      ctx.fill();
    }

    function drawParticles(dt, t) {
      const w = stage.clientWidth, h = stage.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const p = cfg.effectData.particles;
      for (const q of parts) {
        const dir = p.direction === 'up' ? -1 : p.direction === 'drift' ? 0.15 : 1;
        q.y += q.vy * dir * dt;
        q.x += (q.vx + Math.sin(t * 0.8 + q.phase) * 12) * dt * (p.kind === 'stars' ? 0.2 : 1);
        q.rot += q.vr * dt;
        if (q.y > h + 30) q.y = -30; else if (q.y < -30) q.y = h + 30;
        if (q.x > w + 30) q.x = -30; else if (q.x < -30) q.x = w + 30;
        ctx.save();
        ctx.fillStyle = q.color; ctx.strokeStyle = q.color;
        const tw = 0.55 + 0.45 * Math.sin(t * 2.2 + q.phase);
        switch (p.kind) {
          case 'stars': ctx.globalAlpha = tw; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill(); break;
          case 'sparkles': {
            ctx.globalAlpha = tw; ctx.translate(q.x, q.y); ctx.rotate(q.rot * 0.2); const s = q.r * (0.6 + tw * 0.6);
            ctx.beginPath(); for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.lineTo(0, -s); ctx.lineTo(s * 0.22, -s * 0.22); } ctx.closePath(); ctx.fill(); break;
          }
          case 'hearts': ctx.globalAlpha = 0.85; heart(q.x, q.y, q.r * 1.6); break;
          case 'confetti': ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.fillRect(-q.r * 0.5, -q.r * 0.25, q.r, q.r * 0.5); break;
          case 'snow': ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * 0.4, 0, Math.PI * 2); ctx.fill(); break;
          case 'bubbles': ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.stroke(); break;
          case 'emoji': ctx.globalAlpha = 0.9; ctx.font = `${q.r * 2.4}px 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`; ctx.textAlign = 'center'; ctx.fillText(p.emoji, q.x, q.y); break;
          default: break;
        }
        ctx.restore();
      }
    }

    function distance() { return (stage.clientHeight || 1080) + roll.scrollHeight; }

    function place(elapsed) {
      const h = stage.clientHeight || 1080;
      const pxPerSec = cfg.speed * h / 1080;
      const y = elapsed == null ? null : h - elapsed * pxPerSec;
      if (y != null) roll.style.transform = `translateY(${Math.round(y)}px)`;
      return y;
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      drawParticles(dt, now / 1000);
      if (running) {
        const elapsed = Math.max(0, (now - startAt) / 1000);
        const y = place(elapsed);
        // Stop with the end text centred on screen (or loop).
        const endEl = roll.lastElementChild;
        const endStop = endEl ? (stage.clientHeight / 2) - (endEl.offsetTop + endEl.offsetHeight / 2) : -roll.scrollHeight;
        if (y <= endStop) {
          if (cfg.loop) startAt = now; else { running = false; place(null); roll.style.transform = `translateY(${Math.round(endStop)}px)`; if (onDone) onDone(); }
        }
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      running = true;
      startAt = performance.now() + cfg.startDelay * 1000;
      place(0);
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function stop() { running = false; place(0); }

    new ResizeObserver(() => { size(); if (!running) place(0); }).observe(stage);
    raf = requestAnimationFrame(frame);

    return {
      setConfig(c, customEffects) { cfg = clean(c, customEffects); build(); },
      setData(list) { people = Array.isArray(list) ? list : []; build(); },
      start, stop,
      set onDone(fn) { onDone = fn; },
      get running() { return running; },
      get config() { return { ...cfg }; },
      destroy() { cancelAnimationFrame(raf); raf = 0; stage.remove(); },
    };
  }

  return { PARTICLES, NAME_ANIMS, EFFECTS, DEFAULTS, clean, cleanEffect, shortChannel, mount };
})();
