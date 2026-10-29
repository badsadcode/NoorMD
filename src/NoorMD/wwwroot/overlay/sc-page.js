// OBS Browser Source page: the stream schedule from NoorMD's calendar, over Server-Sent Events from the loopback overlay
// server. data-mode on <body>: "next" (next-stream.html) or "week" (schedule.html).
'use strict';
(() => {
  const sc = NoorSchedule.mount(document.getElementById('stage'), document.body.dataset.mode === 'week' ? 'week' : 'next');
  const es = new EventSource('/events');
  const read = (e) => { try { return JSON.parse(e.data); } catch { return null; } };
  es.addEventListener('sc.config', (e) => { const c = read(e); if (c) sc.setConfig(c); });
  es.addEventListener('sc.data', (e) => { const d = read(e); if (d) sc.setData(d); });
})();
