// OBS Browser Source page for the credits roll. Starts when NoorMD says "roll credits", or by itself when the OBS
// source becomes visible (if "Start automatically" is on). Data comes over Server-Sent Events.
'use strict';
(() => {
  const cr = NoorCredits.mount(document.getElementById('stage'));
  let config = null, effects = [], data = [], started = false;
  const es = new EventSource('/events');
  const read = (e) => { try { return JSON.parse(e.data); } catch { return null; } };
  const apply = () => { if (config) cr.setConfig(config, effects); };
  const maybeStart = () => { if (config && config.autoStart && !started) { started = true; cr.start(); } };
  es.addEventListener('credits.config', (e) => { const c = read(e); if (!c) return; config = c.config; effects = c.effects || []; apply(); cr.setData(data); maybeStart(); });
  es.addEventListener('credits.data', (e) => { const d = read(e); if (!d) return; data = d.supporters || []; cr.setData(data); });
  es.addEventListener('credits.start', () => { started = true; cr.start(); });
  es.addEventListener('credits.stop', () => { started = false; cr.stop(); });
  // OBS: restart when the source is shown again; stop when hidden.
  if (window.obsstudio) {
    window.addEventListener('obsSourceVisibleChanged', (e) => { if (e.detail && e.detail.visible) { started = false; maybeStart(); } else { cr.stop(); started = false; } });
  }
})();
