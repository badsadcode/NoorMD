// OBS Browser Source page: follows NoorMD's Now Playing over Server-Sent Events from the loopback overlay server.
'use strict';
(() => {
  const np = NoorNowPlaying.mount(document.getElementById('stage'));
  const params = new URLSearchParams(location.search);
  const es = new EventSource('/events');
  const read = (e) => { try { return JSON.parse(e.data); } catch { return null; } };
  es.addEventListener('np.config', (e) => { const c = read(e); if (c) np.setConfig({ ...c, ...(params.get('design') ? { design: params.get('design') } : {}) }); });
  es.addEventListener('np.track', (e) => { const t = read(e); np.setTrack(t && t.title ? { ...t, art: t.hasArt ? `/art?v=${encodeURIComponent(t.id)}` : null } : null); });
})();
