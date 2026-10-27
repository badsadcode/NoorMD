// The Stream Desk window (stream.html, hosted by StreamWindow.cs): the whole page is the Stream Desk. The host tells
// it which tab to show and relays the song the Music Bench is playing; closing the window closes the desk.
(() => {
  'use strict';
  const req = (type, payload) => NoorBridge.request(type, payload);
  NoorStream.init({ showError: (err) => { console.error(err); NoorUI.notice(err && err.message ? err.message : String(err), 6000); } });
  req('streamwin.ready')
    .then((r) => NoorStream.open((r && r.tab) || undefined))
    .then(() => req('stream.track'))
    .catch((err) => NoorUI.notice(err.message, 6000));
})();
