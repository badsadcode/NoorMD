// The main window's link to the Stream Desk, which lives in its own window (stream.html). Menu items, Ctrl+Alt+B and
// Ctrl+K open it there; the Music Bench reports what plays (for OBS overlays and the stream tracklist).
window.NoorStream = (() => {
  'use strict';
  const req = (type, payload) => NoorBridge.request(type, payload);
  let hooks = { showError: (e) => console.error(e) };
  let windowOpen = false, lastKey = '', lastSent = 0;

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('stream.window', (p) => { windowOpen = !!(p && p.open); });
  }

  /** Called by the Music Bench on every change and progress tick; the host only needs changes and a slow tick. */
  function nowPlaying(t) {
    const now = Date.now();
    const key = t ? `${t.id}|${t.playing}` : '';
    if (key === lastKey && now - lastSent < 5000) return;
    lastKey = key; lastSent = now;
    req('stream.np.update', { track: t ? { id: t.id, title: t.title, artist: t.artist, hasArt: t.hasArt, playing: t.playing, position: t.position, duration: t.duration } : null }).catch(() => {});
  }

  const show = (payload) => req('stream.window', payload).then((r) => { windowOpen = !!(r && r.open); }).catch(hooks.showError);
  const open = (tab) => show({ tab: tab || null });
  const toggle = () => show({ toggle: true });
  const close = () => show({ close: true });

  async function toggleMic() {
    try {
      const m = await req('mic.toggle');
      if (m && m.verdict !== 'notsetup') NoorUI.notice(`🎙 ${m.label}`, 1400);
    } catch (err) { hooks.showError(err); }
  }

  return { init, nowPlaying, open, toggle, close, toggleMic, isOpen: () => windowOpen };
})();
