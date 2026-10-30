// NoorMD player controls: a control bar over a video (previous, play/pause, next, timeline, volume, ⚙ speed / subtitles /
// audio, full screen) that shows when the mouse moves and fades after a few seconds while the video plays. Used by the
// pop-out player and by NoorVideo in full screen, so both look and work the same.
window.NoorPlayerControls = (() => {
  'use strict';
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const HIDE_MS = 2600;
  const fmt = (s) => { s = Math.floor(Math.max(0, s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };

  function mk(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  }

  /**
   * @param stage the element the bar sits in (and the one that goes full screen)
   * @param video the <video>
   * @param opts { onPrev, onNext, hasPrev(), hasNext(), onFullscreen(), fullscreenOnly, onSpeed(rate), onSubtitle(i), onAudio(i) }
   */
  function attach(stage, video, opts = {}) {
    let hideTimer = null;
    let dragging = false;
    const btn = (cls, label, title, fn) => mk('button', { class: 'pc-btn ' + cls, type: 'button', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(); poke(); } }, label);
    const prev = btn('pc-prev', '⏮', 'Previous', () => opts.onPrev && opts.onPrev());
    const play = btn('pc-play', '▶', 'Play / pause (Space)', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
    const next = btn('pc-next', '⏭', 'Next', () => opts.onNext && opts.onNext());
    const cur = mk('span', { class: 'pc-time', text: '0:00' });
    const dur = mk('span', { class: 'pc-time', text: '0:00' });
    const seek = mk('input', { type: 'range', class: 'pc-seek', min: '0', max: '1000', value: '0', 'aria-label': 'Timeline' });
    const mute = btn('pc-mute', '🔊', 'Mute (M)', () => { video.muted = !video.muted; });
    const vol = mk('input', { type: 'range', class: 'pc-vol', min: '0', max: '100', value: String(Math.round(video.volume * 100)), 'aria-label': 'Volume' });
    const gear = btn('pc-gear', '⚙', 'Speed, subtitles and sound', () => toggleMenu());
    const full = btn('pc-full', '⛶', 'Full screen (F)', () => (opts.onFullscreen ? opts.onFullscreen() : toggleFullscreen()));
    const menu = mk('div', { class: 'pc-menu', role: 'menu', hidden: true });
    const bar = mk('div', { class: 'pc-bar' + (opts.fullscreenOnly ? ' pc-fs-only' : ''), onclick: (e) => e.stopPropagation(), ondblclick: (e) => e.stopPropagation() },
      seek, mk('div', { class: 'pc-row' }, prev, play, next, cur, mk('span', { class: 'pc-sep', text: '/' }), dur, mk('span', { class: 'pc-space' }), mute, vol, gear, full), menu);
    stage.append(bar);
    stage.classList.add('pc-stage');

    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else stage.requestFullscreen().catch(() => {});
    }

    function toggleMenu(force) {
      const open = force ?? menu.hidden;
      menu.hidden = !open;
      if (!open) return;
      const tracks = [...video.textTracks];
      const audio = video.audioTracks ? [...video.audioTracks] : [];
      const item = (label, on, fn) => mk('button', { class: 'pc-mi' + (on ? ' on' : ''), type: 'button', role: 'menuitemradio', 'aria-checked': String(!!on), onclick: (e) => { e.stopPropagation(); fn(); toggleMenu(true); } }, label);
      menu.replaceChildren(
        mk('div', { class: 'pc-mh', text: 'Speed' }),
        mk('div', { class: 'pc-mrow' }, ...SPEEDS.map((s) => item(s === 1 ? '1×' : `${s}×`, Math.abs(video.playbackRate - s) < 0.01, () => { video.playbackRate = s; if (opts.onSpeed) opts.onSpeed(s); }))),
        mk('div', { class: 'pc-mh', text: 'Subtitles' }),
        item('Off', tracks.every((t) => t.mode !== 'showing'), () => { tracks.forEach((t) => { t.mode = 'disabled'; }); if (opts.onSubtitle) opts.onSubtitle(-1); }),
        ...tracks.map((t, i) => item(t.label || t.language || `Track ${i + 1}`, t.mode === 'showing', () => { tracks.forEach((x, j) => { x.mode = j === i ? 'showing' : 'disabled'; }); if (opts.onSubtitle) opts.onSubtitle(i); })),
        ...(audio.length > 1 ? [mk('div', { class: 'pc-mh', text: 'Sound' }), ...audio.map((t, i) => item(`${t.label || t.language || `Track ${i + 1}`}${t.label && t.language ? ` (${t.language})` : ''}`, t.enabled, () => { audio.forEach((x, j) => { x.enabled = j === i; }); if (opts.onAudio) opts.onAudio(i); }))] : []));
    }

    function render() {
      const d = video.duration, c = video.currentTime;
      cur.textContent = fmt(c);
      dur.textContent = fmt(d);
      if (!dragging) seek.value = Number.isFinite(d) && d > 0 ? String(Math.round((c / d) * 1000)) : '0';
      seek.style.setProperty('--pc-fill', `${Number(seek.value) / 10}%`);
      play.textContent = video.paused ? '▶' : '❚❚';
      play.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
      mute.textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
      if (document.activeElement !== vol) vol.value = String(Math.round((video.muted ? 0 : video.volume) * 100));
      prev.hidden = !opts.onPrev || (opts.hasPrev && !opts.hasPrev());
      next.disabled = !opts.onNext || (opts.hasNext && !opts.hasNext());
      if (video.paused) show(); // paused: the controls stay
    }

    function show() {
      stage.classList.add('pc-visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!video.paused && !dragging && menu.hidden && !bar.matches(':hover')) stage.classList.remove('pc-visible');
      }, HIDE_MS);
    }
    const poke = show;

    seek.addEventListener('input', () => { dragging = true; const d = video.duration; if (Number.isFinite(d)) { cur.textContent = fmt((Number(seek.value) / 1000) * d); seek.style.setProperty('--pc-fill', `${Number(seek.value) / 10}%`); } poke(); });
    seek.addEventListener('change', () => { const d = video.duration; if (Number.isFinite(d)) video.currentTime = (Number(seek.value) / 1000) * d; dragging = false; poke(); });
    vol.addEventListener('input', () => { video.volume = Number(vol.value) / 100; video.muted = video.volume === 0; poke(); });
    for (const ev of ['timeupdate', 'play', 'pause', 'durationchange', 'volumechange', 'loadedmetadata', 'ratechange']) video.addEventListener(ev, render);
    stage.addEventListener('mousemove', poke);
    stage.addEventListener('pointerdown', poke);
    stage.addEventListener('keydown', poke);
    stage.addEventListener('mouseleave', () => { if (!video.paused) { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!video.paused && menu.hidden) stage.classList.remove('pc-visible'); }, 600); } });
    document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== gear) toggleMenu(false); });
    render();
    show();
    return { refresh: render, show, closeMenu: () => toggleMenu(false), bar };
  }

  return { attach, fmt };
})();
