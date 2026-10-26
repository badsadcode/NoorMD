// Runs synchronously in <head> before any CSS paints, so the first frame already has the right theme.
// window.__NOORMD_BOOT__ is injected by the desktop host (AddScriptToExecuteOnDocumentCreated).
(function () {
  'use strict';
  var boot = window.__NOORMD_BOOT__ || {};
  var theme = /^[a-z]{2,20}$/.test(boot.theme || '') ? boot.theme : 'dark';
  document.documentElement.dataset.theme = theme;
  if (/^#[0-9a-fA-F]{6}$/.test(boot.background || '')) document.documentElement.style.background = boot.background;
})();
