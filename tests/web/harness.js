// Test harness: serves wwwroot the same way the desktop host does (/ -> index.html, /_noormd/* -> assets)
// and injects a scripted mock of the host bridge (window.__NOORMD_TEST_HOST__).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.resolve(__dirname, '..', '..', 'src', 'NoorMD', 'wwwroot');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = url.pathname === '/' ? 'index.html' : url.pathname.startsWith('/_noormd/') ? url.pathname.slice('/_noormd/'.length) : null;
    if (!rel) { res.writeHead(404); res.end(); return; }
    const file = path.join(WWW, decodeURIComponent(rel));
    if (!file.startsWith(WWW) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

// Runs inside the page before any app script. Mirrors the C# BridgeHost semantics closely enough
// to exercise the UI: requests get replies, the host pulls state with NoorMD.getState().
function mockHostScript(initial) {
  const listeners = [];
  const log = [];
  const files = initial.files || {};
  const state = { path: (initial.document && initial.document.path) || null, prefs: initial.prefs || {}, recent: initial.recent || [], snapshots: [], recovery: initial.recovery || [], printed: 0 };
  const emit = (data) => setTimeout(() => listeners.forEach((fn) => fn({ data })), 0);
  const reply = (id, ok, result, error) => id != null && emit({ v: 1, replyTo: id, ok, result, error });
  const event = (name, payload) => emit({ v: 1, event: name, payload });
  const loadFile = (p) => event('doc.load', { markdown: files[p], path: p, fileName: p.split(/[\\/]/).pop(), title: p.split(/[\\/]/).pop().replace(/\.(md|markdown|txt)$/i, '') });
  window.__NOORMD_TEST_HOST__ = {
    addEventListener: (_t, fn) => listeners.push(fn),
    postMessage(m) {
      log.push(m);
      const p = m.payload || {};
      const S = () => window.NoorMD.getState();
      switch (m.type) {
        case 'app.ready': return reply(m.id, true, { prefs: state.prefs, recent: state.recent, document: initial.document || null, recovery: state.recovery });
        case 'doc.save': case 'doc.saveAs': {
          const s = S();
          const target = (m.type === 'doc.saveAs' || !state.path) ? (initial.saveAsPath || 'C:\\docs\\saved.md') : state.path;
          files[target] = s.markdown; state.path = target;
          event('doc.saved', { gen: s.gen, path: target, fileName: target.split('\\').pop(), title: target.split('\\').pop().replace(/\.md$/, '') });
          return reply(m.id, true, { saved: true, fileName: target.split('\\').pop() });
        }
        case 'doc.open': case 'doc.openRecent': { const p2 = p.path || initial.openPath; state.path = p2; loadFile(p2); return reply(m.id, true, { opened: true }); }
        case 'doc.new': state.path = null; event('doc.load', { markdown: p.markdown || '', title: p.title || 'Untitled document' }); return reply(m.id, true, {});
        case 'snapshots.create': { const s = S(); state.snapshots.unshift({ id: 's' + state.snapshots.length, label: p.label, createdUtc: new Date().toISOString(), words: 1, markdown: s.markdown }); return reply(m.id, true, {}); }
        case 'snapshots.list': return reply(m.id, true, state.snapshots.map(({ markdown, ...x }) => x));
        case 'snapshots.get': return reply(m.id, true, state.snapshots.find((x) => x.id === p.id));
        case 'snapshots.delete': state.snapshots = state.snapshots.filter((x) => x.id !== p.id); return reply(m.id, true, {});
        case 'print': state.printed++; return reply(m.id, true, {});
        case 'export.html': state.exportedHtml = p.bodyHtml; return reply(m.id, true, { path: 'C:\\out.html' });
        case 'export.pdf': return reply(m.id, true, { path: 'C:\\out.pdf' });
        case 'link.open': state.lastLink = p.href; return reply(m.id, true, {});
        case 'recovery.list': return reply(m.id, true, state.recovery);
        default: return reply(m.id, true, {});
      }
    },
  };
  window.__mock = { log, files, state };
}

module.exports = { serve, mockHostScript, WWW };
