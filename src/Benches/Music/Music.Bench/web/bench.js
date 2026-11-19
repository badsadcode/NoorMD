// The Music bench: your music folders as a library, and a player that keeps playing whichever bench is in front, as in
// NoorMD 2.0. The player runs in the main window (engine.js). The page (ui.js) is the bench's tab and, the same page in
// compact form, the Music panel to keep beside your writing; the mini player runs along the bottom of every window.
// They all talk to the player through the bench's events, from any window.
import { el } from '/ui/js/noor-ui.js';
import { createEngine } from './engine.js';
import { createMusicUi, listen, doIt, heard, setArt, fmt, ICON, TRIAGE } from './ui.js';

const here = (p) => new URL(p, import.meta.url).href;
let engine = null;

/** The mini player: a bar along the bottom of the window (whichever bench is in front), as in NoorMD 2.0. ✕ hides it
    (the music keeps playing); a small ♫ in the status bar brings it back. */
function miniPlayer(ctx) {
  const b = (label, title, fn, cls = '') => el('button', { class: 'nui-icon ' + cls, title, 'aria-label': title, onclick: fn }, label);
  const artBox = el('div', { class: 'mp-art', 'aria-hidden': 'true' }, el('span', { text: '♫' }));
  const title = el('div', { class: 'mp-title' }), sub = el('div', { class: 'mp-sub' });
  const shuffle = b(ICON.shuffle, 'Shuffle', () => doIt(ctx, { op: 'shuffle' }), 'mp-shuffle');
  const play = b(ICON.play, 'Play / pause', () => doIt(ctx, { op: 'toggle' }), 'mp-play');
  const cur = el('span', { class: 'mp-time', text: '0:00' }), dur = el('span', { class: 'mp-time', text: '0:00' });
  const range = el('input', { type: 'range', class: 'mp-range', min: '0', max: '1000', value: '0', 'aria-label': 'Position' });
  const mark = el('span', { class: 'mp-triage' });
  const openBench = () => ctx.openBench('noor.music');
  let hidden = !!ctx.restore('bar.hidden', false), has = false, d = 0;
  range.addEventListener('input', () => { range.dataset.dragging = '1'; cur.textContent = fmt((range.value / 1000) * d); });
  range.addEventListener('change', () => { delete range.dataset.dragging; if (d) doIt(ctx, { op: 'seek', t: (range.value / 1000) * d }); });
  const bar = el('div', { class: 'nm-mini miniplayer', role: 'region', 'aria-label': 'Mini player' },
    el('button', { class: 'mp-who', title: 'Open the Music bench', onclick: openBench }, artBox, el('div', { class: 'mp-text' }, title, sub)),
    shuffle, b(ICON.prev, 'Previous', () => doIt(ctx, { op: 'prev' })), play, b(ICON.next, 'Next', () => doIt(ctx, { op: 'next' })),
    b(ICON.random, 'A random track', async () => doIt(ctx, { op: 'random', ids: await ctx.call('music.ids', { sort: 'title', offset: 0, limit: 50000 }).catch(() => []) }), 'mp-random'),
    cur, range, dur, mark,
    b('✎', 'Edit the track (F2)', () => { openBench(); setTimeout(() => ctx.emit('ui.do', { cmd: 'music.editTrack' }), 150); }),
    b('♫', 'Open the Music bench', openBench),
    b('✕', 'Hide the mini player (the music keeps playing)', () => setHidden(true)));
  const reopen = el('button', { class: 'mu-mini-btn', title: 'Show the mini player', 'aria-label': 'Show the mini player', hidden: true, onclick: () => setHidden(false) }, '♫');
  function place() {
    ctx.setBottomBar(has && !hidden ? bar : null);
    reopen.hidden = !(has && hidden);
  }
  function setHidden(v) { hidden = v; ctx.keep('bar.hidden', v); place(); }
  function time(t) {
    if (!t) return;
    d = t.duration || d;
    if (range.dataset.dragging) return;
    cur.textContent = fmt(t.time); dur.textContent = fmt(d);
    range.value = d ? String(Math.round((t.time / d) * 1000)) : '0';
  }
  ctx.setStatusWidget(reopen);
  const off = listen(ctx, (s) => {
    has = !!(s && s.track);
    place();
    if (!has) return;
    setArt(artBox, s.track);
    title.textContent = s.track.displayTitle;
    sub.textContent = s.track.artist || s.track.fileName || '';
    play.textContent = s.playing ? ICON.pause : ICON.play;
    play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    shuffle.classList.toggle('on', !!s.shuffle); shuffle.setAttribute('aria-pressed', String(!!s.shuffle));
    mark.textContent = s.track.triage ? TRIAGE[s.track.triage].icon : '';
    time(s);
  }, time);
  return { stop() { off(); ctx.setBottomBar(null); ctx.setStatusWidget(null); } };
}

export default {
  /** Once per window: the player in the main window, the mini player along the bottom of every window. */
  start(ctx) {
    ctx.useStyle(here('bench.css'));
    if (ctx.isMainWindow && !engine) engine = createEngine(ctx);
    this._mini = miniPlayer(ctx);
  },
  /** For tests: the player (main window only). */
  _engine: () => engine,
  /** The bench closed: the music stops (its window's mini player goes too). */
  closed() {
    if (engine) { engine.stop(); engine = null; }
    if (this._mini) { this._mini.stop(); this._mini = null; }
    heard.state = null;
  },

  // ---------------------------------------------------------------- the bench's tab: everything, spread out when there's room
  mount(root, ctx) {
    ctx.useStyle(here('bench.css'));
    const ui = createMusicUi(root, ctx, { where: 'bench' });
    // Commands sent from elsewhere (the mini player's ✎) run here.
    const off = ctx.on('ui.do', (m) => { const fn = m && ui.commands[m.cmd]; if (fn) fn(); });
    return { ...ui, unmount() { off(); ui.unmount(); } };
  },

  panels: {
    // The same page, compact: the player card, then Library / Up next / Playlists / Sound, to keep beside your writing.
    player: {
      mount(root, ctx) {
        ctx.useStyle(here('bench.css'));
        const ui = createMusicUi(root, ctx, { where: 'panel' });
        return { unmount: () => ui.unmount() };
      },
    },
  },
};
