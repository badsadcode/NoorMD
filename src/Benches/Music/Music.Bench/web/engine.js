// The Music bench's player: one <audio> in the main window, so music keeps playing whichever bench (or window) is in
// front. Every page (the library view, the Now playing / Up next / Sound panels, the mini player, in any window)
// talks to it through the bench's events: "player.do" asks it to do something, "player.state" says where things
// stand (and "player.time" ticks the position). The queue, shuffle, repeat, volume and the sound settings are kept
// in the library's session, so they come back next time. From NoorMD 2.0's music.js (queue and playback).
import { NoorFx } from './fx.js';

let version = 0;   // bumped after a track's file is edited, so the audio is fetched afresh
const media = (id) => `/media/noor.music/track/${id}${version ? `?v=${version}` : ''}`;

export function createEngine(ctx) {
  const audio = new Audio();
  audio.preload = 'auto';
  NoorFx.attach(audio);
  const q = { ids: [], order: [], pos: -1, shuffle: false, repeat: 'off', volume: 0.8 };
  const cache = new Map();       // id → track row
  let started = false, restorePosition = null, saveTimer = 0, errors = 0, playedId = null, lastTimeSent = 0;
  let released = null;           // { id, at, playing } while a track's file is being edited
  let measuring = false;

  const currentId = () => (q.pos >= 0 && q.pos < q.order.length ? q.ids[q.order[q.pos]] : null);
  const upcoming = (n) => q.order.slice(Math.max(0, q.pos), q.pos + n).map((i) => q.ids[i]);
  const around = (n) => q.order.slice(Math.max(0, q.pos - 3), q.pos + n).map((i) => q.ids[i]);   // Up next shows the last three played too
  function shuffledOrder(n, keepFirst) {
    const order = [...Array(n).keys()].filter((i) => i !== keepFirst);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return keepFirst != null && keepFirst >= 0 ? [keepFirst, ...order] : order;
  }

  // ---------------------------------------------------------------- what the pages hear
  function state() {
    const id = currentId();
    const from = Math.max(0, q.pos - 3);
    const items = q.order.slice(from, q.pos + 150).map((i, k) => {
      const r = cache.get(q.ids[i]);
      return { pos: from + k, id: q.ids[i], title: r ? r.displayTitle : '…', artist: r ? r.artist : null, fileName: r ? r.fileName : '', duration: r ? r.duration : 0 };
    });
    return {
      id, track: id != null ? cache.get(id) || null : null, playing: !audio.paused && !!audio.getAttribute('src'),
      time: audio.currentTime || 0, duration: Number.isFinite(audio.duration) ? audio.duration : (cache.get(id) || {}).duration || 0,
      volume: q.volume, shuffle: q.shuffle, repeat: q.repeat, queue: { pos: q.pos, total: q.order.length, items },
      fx: NoorFx.settings, trackGain: NoorFx.trackGain, preamp: NoorFx.preamp,
    };
  }
  let stateTimer = 0;
  function announce() { clearTimeout(stateTimer); stateTimer = setTimeout(() => ctx.emit('player.state', state()), 0); }
  function tick() {
    const now = Date.now();
    if (now - lastTimeSent < 240) return;
    lastTimeSent = now;
    ctx.emit('player.time', { id: currentId(), time: audio.currentTime || 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
  }

  // ---------------------------------------------------------------- tracks and the queue
  async function loadTracks(ids) {
    const need = ids.filter((id) => id != null && !cache.has(id));
    if (!need.length) return;
    try { (await ctx.call('music.tracks', { ids: need.slice(0, 2000) })).forEach((r) => cache.set(r.id, r)); } catch { /* shown when playing */ }
  }
  async function setQueue(ids, startIndex, autoplay = true) {
    errors = 0;
    q.ids = ids.slice();
    const start = Math.max(0, Math.min(ids.length - 1, startIndex | 0));
    q.order = q.shuffle ? shuffledOrder(ids.length, start) : ids.map((_, i) => i);
    q.pos = q.order.indexOf(start);
    await loadTracks(around(200));
    loadCurrent(autoplay);
    save();
  }
  function loadCurrent(autoplay) {
    const id = currentId();
    if (id == null) { audio.removeAttribute('src'); audio.load(); announce(); media_(); return; }
    audio.src = media(id);
    NoorFx.setTrack(cache.get(id));
    if (autoplay) audio.play().catch((e) => { if (e.name !== 'AbortError') console.warn(e); });
    playedId = null;
    announce(); media_();
    loadTracks(around(60)).then(announce);
    autoMeasure();
  }

  // Evening out the loudness, and nothing known about this track: measure it (and the next two) quietly, here. The
  // files are only read.
  async function autoMeasure() {
    const fx = NoorFx.settings;
    if (!fx.normalize || fx.autoMeasure === false || measuring) return;
    const want = upcoming(3).filter((id) => { const r = cache.get(id); return r && !Number.isFinite(r.loudness) && !Number.isFinite(r.rgGain); });
    if (!want.length) return;
    measuring = true;
    try {
      for (const id of want) {
        try {
          const m = await NoorFx.analyze(media(id));
          if (!Number.isFinite(m.lufs)) continue;
          await ctx.call('music.loudness.set', { id, lufs: Math.round(m.lufs * 100) / 100, peak: Math.round(m.peak * 10000) / 10000 });
          if (cache.has(id)) cache.set(id, { ...cache.get(id), loudness: m.lufs, peak: m.peak });
          if (id === currentId()) { NoorFx.setTrack(cache.get(id)); announce(); }
          ctx.emit('measured', { id, loudness: m.lufs, peak: m.peak });
        } catch (e) { if (e && e.name === 'AbortError') break; }
      }
    } finally { measuring = false; }
  }
  function next(auto = false, afterError = false) {
    if (!q.order.length) return;
    if (auto && !afterError && q.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    let pos = q.pos + 1;
    if (pos >= q.order.length) {
      // Shuffle never runs dry: at the end it reshuffles and keeps playing random songs (repeat one/off aside).
      if (q.repeat === 'all' || !auto || (q.shuffle && q.ids.length > 1)) {
        if (q.shuffle) { const last = q.order[q.pos]; q.order = shuffledOrder(q.ids.length, -1); if (q.order[0] === last && q.order.length > 1) q.order.push(q.order.shift()); }
        pos = 0;
      } else { audio.pause(); audio.currentTime = 0; announce(); save(); return; }
    }
    q.pos = pos;
    loadCurrent(true);
    save();
  }
  function prev() {
    if (!q.order.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    q.pos = q.pos > 0 ? q.pos - 1 : (q.repeat === 'all' ? q.order.length - 1 : 0);
    loadCurrent(true);
    save();
  }
  function compact() {
    const keep = new Set(q.order), remap = new Map(), ids = [];
    q.ids.forEach((id, i) => { if (keep.has(i)) { remap.set(i, ids.length); ids.push(id); } });
    q.ids = ids;
    q.order = q.order.map((i) => remap.get(i));
  }
  function enqueue(ids) {
    const have = new Set(upcoming(Infinity));
    const fresh = ids.filter((id) => !have.has(id));
    if (!fresh.length) return 0;
    const startPlaying = currentId() == null;
    for (const id of fresh) { q.ids.push(id); q.order.push(q.ids.length - 1); }
    if (startPlaying) { q.pos = 0; loadCurrent(true); }
    loadTracks(fresh).then(announce);
    save();
    return fresh.length;
  }
  function playNext(ids) {
    if (currentId() == null) return enqueue(ids);
    const at = q.pos + 1;
    ids.forEach((id, k) => { q.ids.push(id); q.order.splice(at + k, 0, q.ids.length - 1); });
    loadTracks(ids).then(announce);
    save();
    return ids.length;
  }

  // ---------------------------------------------------------------- the session (kept in the library)
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 900); announce(); }
  function saveNow() {
    if (!started) return;
    const used = [...new Set(q.order)].sort((a, b) => a - b);
    const remap = new Map(used.map((old, i) => [old, i]));
    const session = { v: 1, ids: used.map((i) => q.ids[i]), order: q.order.map((i) => remap.get(i)), pos: q.pos, shuffle: q.shuffle, repeat: q.repeat, volume: q.volume, position: audio.currentTime || 0, fx: NoorFx.settings };
    ctx.call('music.session.save', { session }).catch(() => {});
  }
  async function restore() {
    let s = null;
    try { s = await ctx.call('music.session.get'); } catch { /* no library yet */ }
    if (s && s.v === 1) {
      q.ids = Array.isArray(s.ids) ? s.ids.filter(Number.isFinite) : [];
      q.order = Array.isArray(s.order) ? s.order.filter((i) => Number.isInteger(i) && i >= 0 && i < q.ids.length) : q.ids.map((_, i) => i);
      q.pos = Number.isInteger(s.pos) && s.pos < q.order.length ? s.pos : (q.order.length ? 0 : -1);
      q.shuffle = !!s.shuffle; q.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
      q.volume = Number.isFinite(s.volume) ? Math.max(0, Math.min(1, s.volume)) : 0.8;
      NoorFx.load(s.fx);
      restorePosition = Number.isFinite(s.position) ? s.position : null;
      audio.volume = q.volume;
      await loadTracks(around(200));
      if (currentId() != null) { audio.src = media(currentId()); NoorFx.setTrack(cache.get(currentId())); }
    } else NoorFx.load(null);
    audio.volume = q.volume;
    started = true;
    announce(); media_();
  }

  // ---------------------------------------------------------------- the audio element
  audio.addEventListener('loadedmetadata', () => {
    if (restorePosition != null) { try { audio.currentTime = Math.min(restorePosition, audio.duration || restorePosition); } catch { /* not seekable */ } restorePosition = null; }
    announce();
  });
  audio.addEventListener('play', () => { errors = 0; announce(); media_(); });
  audio.addEventListener('pause', () => { announce(); media_(); saveNow(); });
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('timeupdate', () => {
    tick();
    // Counted as played after 30 seconds (or half a short track).
    const id = currentId();
    if (id != null && playedId !== id && audio.currentTime > Math.min(30, (audio.duration || 60) / 2)) { playedId = id; ctx.call('music.played', { id }).catch(() => {}); }
    if (!audio.paused && Math.floor(audio.currentTime) % 10 === 0) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 900); }
  });
  audio.addEventListener('error', () => {
    const id = currentId();
    if (id == null || !audio.getAttribute('src')) return;
    if (audio.error && /empty src/i.test(audio.error.message || '')) return;
    const r = cache.get(id);
    errors++;
    ctx.toast(`Can't play “${r ? r.displayTitle : 'a track'}” (missing, moved or unsupported).${errors < q.order.length ? ' Skipping…' : ''}`, { error: true });
    if (errors >= Math.min(q.order.length, 25)) { audio.pause(); errors = 0; announce(); return; }
    setTimeout(() => next(true, true), 700);
  });

  // ---------------------------------------------------------------- media keys and Windows' media overlay
  function media_() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const r = cache.get(currentId());
    try {
      ms.metadata = r && window.MediaMetadata ? new MediaMetadata({ title: r.displayTitle, artist: r.artist || '', album: r.album || '', artwork: r.hasArt ? [{ src: `/media/noor.music/art/${r.id}` }] : [] }) : null;
      ms.playbackState = audio.paused ? 'paused' : 'playing';
    } catch { /* not supported */ }
  }
  if (navigator.mediaSession) {
    const on = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* not supported */ } };
    on('play', () => doIt({ op: 'play' })); on('pause', () => doIt({ op: 'pause' }));
    on('nexttrack', () => next()); on('previoustrack', () => prev());
    on('seekto', (d) => d && Number.isFinite(d.seekTime) && doIt({ op: 'seek', t: d.seekTime }));
  }

  // ---------------------------------------------------------------- what the pages ask
  async function doIt(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.op) {
      case 'playIds': if (Array.isArray(m.ids) && m.ids.length) await setQueue(m.ids, m.start || 0, true); break;
      case 'toggle': if (currentId() == null) { if (Array.isArray(m.ids) && m.ids.length) await setQueue(m.ids, m.start || 0, true); else ctx.toast('Choose a track in the Music bench to start.'); } else if (audio.paused) audio.play().catch(() => {}); else audio.pause(); break;
      case 'play': if (currentId() != null) audio.play().catch(() => {}); break;
      case 'pause': audio.pause(); break;
      case 'next': next(); break;
      case 'prev': prev(); break;
      case 'seek': if (Number.isFinite(m.t) && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration - 0.25, m.t)); tick(); break;
      case 'volume': if (Number.isFinite(m.v)) { q.volume = Math.max(0, Math.min(1, m.v)); audio.volume = q.volume; audio.muted = false; save(); } break;
      case 'shuffle': {
        const cur = q.pos >= 0 ? q.order[q.pos] : 0;
        q.shuffle = m.on == null ? !q.shuffle : !!m.on;
        q.order = q.shuffle ? shuffledOrder(q.ids.length, q.ids.length ? cur : -1) : q.ids.map((_, i) => i);
        q.pos = q.ids.length ? q.order.indexOf(cur) : -1;
        ctx.toast(q.shuffle ? 'Shuffle on' : 'Shuffle off', { ms: 1200 });
        save(); break;
      }
      case 'repeat': q.repeat = { off: 'all', all: 'one', one: 'off' }[q.repeat]; ctx.toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat this track' }[q.repeat], { ms: 1200 }); save(); break;
      case 'enqueue': { const n = enqueue(m.ids || []); ctx.toast(n ? (n === 1 ? 'Added to Up next' : `${n} tracks added to Up next`) : 'Already in Up next', { ms: 1400 }); break; }
      case 'playNext': { const n = playNext(m.ids || []); if (n) ctx.toast('Plays next', { ms: 1200 }); break; }
      case 'jump': if (Number.isInteger(m.pos) && m.pos >= 0 && m.pos < q.order.length) { q.pos = m.pos; loadCurrent(true); save(); } break;
      case 'remove': if (Number.isInteger(m.pos) && m.pos > q.pos && m.pos < q.order.length) { q.order.splice(m.pos, 1); compact(); save(); } break;
      case 'move': {
        const from = m.pos, to = m.pos + (m.delta | 0);
        if (Number.isInteger(from) && from > q.pos && to > q.pos && to < q.order.length) { [q.order[from], q.order[to]] = [q.order[to], q.order[from]]; save(); }
        break;
      }
      case 'clearUpcoming': q.order = q.order.slice(0, q.pos + 1); compact(); save(); break;
      case 'random': {
        const ids = Array.isArray(m.ids) ? m.ids : [];
        if (!ids.length) { ctx.toast('Add a music folder first.'); break; }
        let pick = Math.floor(Math.random() * ids.length);
        if (ids.length > 1 && ids[pick] === currentId()) pick = (pick + 1 + Math.floor(Math.random() * (ids.length - 1))) % ids.length;
        await setQueue(ids, pick, true);
        const r = cache.get(ids[pick]);
        ctx.toast('🎲 ' + (r ? r.displayTitle : 'A random track'), { ms: 1600 });
        break;
      }
      case 'fx': NoorFx.update(m.patch || {}); if (cache.get(currentId())) NoorFx.setTrack(cache.get(currentId())); save(); autoMeasure(); break;
      // A track's file is about to be renamed or retagged: let go of it (and remember where it was).
      case 'release': {
        const id = currentId();
        if (id == null || (Array.isArray(m.ids) && !m.ids.includes(id))) break;
        released = { id, at: audio.currentTime || 0, playing: !audio.paused };
        audio.pause(); audio.removeAttribute('src'); audio.load();
        break;
      }
      // …and done: fresh rows for those tracks, and the released one back where it was (unless it moves on).
      case 'reload': {
        version++;
        const ids = Array.isArray(m.ids) ? m.ids : [...cache.keys()];
        ids.forEach((id) => cache.delete(id));
        await loadTracks([...new Set([...ids.filter((id) => q.ids.includes(id)), ...upcoming(60)])]);
        const r = released; released = null;
        if (m.next) { next(); break; }
        if (r && r.id === currentId()) {
          restorePosition = r.at;
          audio.src = media(r.id);
          NoorFx.setTrack(cache.get(r.id));
          if (r.playing) audio.play().catch(() => {});
        }
        announce(); media_();
        break;
      }
      case 'trackChanged': {
        // A track's row changed (triage, loudness measured): its cached row follows.
        if (Array.isArray(m.rows)) for (const r of m.rows) if (cache.has(r.id)) cache.set(r.id, { ...cache.get(r.id), ...r });
        if (m.rows && m.rows.some((r) => r.id === currentId())) NoorFx.setTrack(cache.get(currentId()));
        announce(); break;
      }
      default: break;
    }
  }
  const offs = [ctx.on('player.do', doIt), ctx.on('player.ask', () => announce())];
  restore();
  return {
    stop() { offs.forEach((f) => f()); saveNow(); audio.pause(); audio.removeAttribute('src'); audio.load(); try { if (navigator.mediaSession) navigator.mediaSession.metadata = null; } catch { /* fine */ } },
    _audio: audio,   // for tests
    _state: state,
  };
}
