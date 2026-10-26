// NoorMD host bridge (protocol v2). See docs/BRIDGE.md for the full message schema.
//
//   JS -> host  { v: 2, id: number|null, type: string, payload: object }
//   host -> JS  { v: 2, replyTo: number, ok: boolean, result?: any, error?: string }   (reply)
//               { v: 2, event: string, payload: object }                             (push event)
//
// The page never gets raw file-system access: it can only ask the host to run named commands,
// and the host validates every request (paths come from native dialogs or host-owned lists).
window.NoorBridge = (() => {
  'use strict';
  const PROTOCOL = 2;
  const host = (window.chrome && window.chrome.webview) || window.__NOORMD_TEST_HOST__ || null;
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();

  if (host) {
    host.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.v !== PROTOCOL) return;
      if (typeof m.replyTo === 'number') {
        const p = pending.get(m.replyTo);
        if (!p) return;
        pending.delete(m.replyTo);
        if (m.ok) p.resolve(m.result === undefined ? null : m.result);
        else p.reject(new Error(m.error || 'The desktop host reported an error.'));
      } else if (typeof m.event === 'string') {
        for (const fn of handlers.get(m.event) || []) {
          try { fn(m.payload || {}); } catch (err) { console.error('Bridge handler failed', m.event, err); }
        }
      }
    });
  }

  /** Sends a request and resolves with the host's result. Native dialogs may keep it pending for a while. */
  function request(type, payload = {}) {
    if (!host) return Promise.reject(new Error('NoorMD desktop host is not available.'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      host.postMessage({ v: PROTOCOL, id, type, payload });
    });
  }

  /** Fire-and-forget notification (no reply expected). */
  function post(type, payload = {}) {
    if (host) host.postMessage({ v: PROTOCOL, id: null, type, payload });
  }

  /** Sends dropped File objects; the host receives them as CoreWebView2File (with a real path). */
  function postFiles(type, files) {
    if (!host || typeof host.postMessageWithAdditionalObjects !== 'function') return false;
    host.postMessageWithAdditionalObjects({ v: PROTOCOL, id: null, type, payload: {} }, files);
    return true;
  }

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(fn);
  }

  return { available: !!host, request, post, postFiles, on, PROTOCOL };
})();
