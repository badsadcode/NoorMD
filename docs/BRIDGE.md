# Bridge protocol v2 (editor page ↔ desktop host)

v2 (2.0.0-preview.2) adds document tabs: every document request names its `tabId`.

The page (`wwwroot/js/bridge.js`) and the host (`MainWindow.Bridge.cs`,
`NoorMD.Core/Bridge/BridgeProtocol.cs`) exchange JSON objects over WebView2 web messages.

```text
page → host   { "v": 2, "id": 12 | null, "type": "doc.save", "payload": { … } }
host → page   { "v": 2, "replyTo": 12, "ok": true, "result": { … } }      reply
              { "v": 2, "replyTo": 12, "ok": false, "error": "message" }    error reply
              { "v": 2, "event": "doc.load", "payload": { … } }             push event
```

The rules:

- The host accepts messages only from `https://noormd.local/`.
- `v` must be `2`, and `type` must be at most 64 characters of `[A-Za-z0-9.]`.
- String payload fields are length-limited.
- The page cannot pass a file path for the host to write. Write paths always come from a
  native Save dialog or from the open document. Read paths must be in the recent list, come
  from a native Open dialog, come from a drop, or be a relative link resolved and checked by
  `LinkPolicy`.
- Tab ids are 8–32 lowercase hex characters. The host creates them. A request naming a tab that
  is not open fails with "That document is no longer open"; notifications for it are ignored.
- The host pulls a tab's editor state when it needs it by calling
  `ExecuteScriptAsync("window.NoorMD.flush('<tabId>')")`. The call sends any pending debounced
  change first, then returns `{ tabId, markdown, title, dirty, gen, mode }` for **that tab**. The
  host never saves one tab with the text of another, or from a stale copy.

## Requests (page → host)

`id` is set when the page waits for a reply; for notifications it is `null`.

| type | payload | result |
|---|---|---|
| `app.ready` | `{ protocol }` | `{ prefs, recent, tabs: doc.load payload[], activeTabId, welcome, recovery[] }` |
| `doc.state` (notification) | `{ tabId, dirty, title }` | — |
| `doc.changed` (notification, debounced) | `{ tabId, markdown, dirty, gen, title }` | — (writes or deletes that tab's recovery draft) |
| `tabs.state` | `{ tabs: [{ id, pinned, mode }], active }` (strip order) | — (the host remembers it for the session; the page waits for the reply before showing a tab, so images resolve against that document's folder) |
| `tab.close` | `{ tabId }` | `{ closed }` (the host asks Save / Don't save / Cancel if needed; closing the last tab creates a blank one) |
| `prefs.set` (notification) | partial prefs | — (validated and clamped) |
| `doc.new` | `{ markdown?, title?, reuseBlank? }` | `{ opened, tabId }` (a new tab) |
| `doc.open` | — (multi-select dialog) | `{ opened, tabId, existing? }` or `{ cancelled }` |
| `doc.openRecent` | `{ path }` (must be in the recent list) | `{ opened, tabId, existing? }` or `{ cancelled }` |
| `doc.save`, `doc.saveAs` | `{ tabId }` | `{ saved, fileName }` |
| `doc.saveAll` | — | `{ saved, cancelled? }` |
| `doc.reload`, `doc.reveal`, `doc.copyPath` | `{ tabId }` | — |
| `export.markdown` | `{ tabId }` | `{ path }` |
| `export.html` | `{ tabId, title, bodyHtml }` (sanitized by DOMPurify) | `{ path }` |
| `export.pdf` | `{ tabId, title }` | `{ path }` |
| `print` | — | — |
| `files.dropped` | sent with `postMessageWithAdditionalObjects(files)` | — |
| `link.open` | `{ href, tabId? }` (relative links resolve against that tab's folder) | — (the host asks the user first) |
| `recent.clear` | — | — |
| `recovery.list` / `.restore` / `.discard` / `.clearAll` | `{ id }` (`<session>` or `<session>-<tab>`) | summaries / `{ restored, tabId }` / — / `{ deleted }` |
| `snapshots.list` / `.create` / `.get` / `.delete` | `{ tabId }` plus `{ label }` / `{ id }` | info[] / info / snapshot / — |
| `app.about`, `app.openDataFolder`, `app.openLicenses`, `app.newWindow` | — | — |

Document operations are serialized. A second request that arrives while a dialog is open
gets `{ busy: true }`.

## Events (host → page)

| event | payload |
|---|---|
| `doc.load` | `{ tabId, markdown, path, fileName, title, dirty, encoding, eol, pinned, mode, notice?, warning?, background? }`. A tab the page doesn't have is created; an existing tab gets a fresh editor (no undo into the previous text). `background` loads without showing it. |
| `doc.saved` | `{ tabId, gen, path, fileName, title, encoding, eol }`. The page marks that tab clean only if no edit happened after `gen`. |
| `tab.select` | `{ tabId }`: show this tab (the file was already open, or the host is about to ask about it) |
| `recent.changed` | `{ recent: [{ path, name }] }` |
| `recovery.available` | `{ drafts }` |
| `insert.text` | `{ markdown }`: inserts into the visible tab (a relative image link for a dropped image) |
| `notice` / `error` | `{ text, ms? }` |
| `command` | `{ id }`: runs a page command (the host sends `tab.next` / `tab.prev` for Ctrl+Tab, which WPF would otherwise use for focus) |

Any change to these shapes must bump `v` in both `bridge.js` and `BridgeProtocol.Version`.
