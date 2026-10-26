// Runs synchronously in <head> before any CSS paints, so the first frame already has the right theme.
// window.__NOORMD_BOOT__ is injected by the desktop host (AddScriptToExecuteOnDocumentCreated).
(function () {
  'use strict';
  var boot = window.__NOORMD_BOOT__ || {};
  var theme = boot.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.background = theme === 'light' ? '#f3f5f9' : '#0b0d12';
})();
