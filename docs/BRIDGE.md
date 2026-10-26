# Bridge protocol v1 (editor page ↔ desktop host)

The page (`wwwroot/js/bridge.js`) and the host (`MainWindow.Bridge.cs`,
`NoorMD.Core/Bridge/BridgeProtocol.cs`) exchange JSON objects over WebView2 web messages.

```text
page → host   { "v": 1, "id": 12 | null, "type": "doc.save", "payload": { … } }
host → page   { "v": 1, "replyTo": 12, "ok": true, "result": { … } }      reply
              { "v": 1, "replyTo": 12, "ok": false, "error": "message" }    error reply
              { "v": 1, "event": "doc.load", "payload": { … } }             push event
```

The rules:

- The host accepts messages only from `https://noormd.local/`.
- `v` must be `1`, and `type` must be at most 64 characters of `[A-Za-z0-9.]`.
- String payload fields are length-limited.
- The page cannot pass a file path for the host to write. Write paths always come from a
  native Save dialog or from the open document. Read paths must be in the recent list, come
  from a native Open dialog, come from a drop, or be a relative link resolved and checked by
  `LinkPolicy`.
- The host pulls the editor state when it needs it by calling
  `ExecuteScriptAsync("window.NoorMD.flush()")`. The call returns
  `{ markdown, title, dirty, gen, mode }`, so the host never works from a stale copy.

## Requests (page → host)

`id` is set when the page waits for a reply; for notifications it is `null`.

| type | payload | result |
|---|---|---|
| `app.ready` | `{ protocol }` | `{ prefs, recent, document \| null, recovery[] }` |
| `doc.state` (notification) | `{ dirty, title }` | — |
| `doc.changed` (notification, debounced) | `{ markdown, dirty, gen, title }` | — (writes or deletes the recovery draft) |
| `prefs.set` (notification) | partial prefs | — (validated and clamped) |
| `doc.new` | `{ markdown?, title? }` | `{ opened }` or `{ cancelled }` |
| `doc.open` | — | `{ opened }` or `{ cancelled }` |
| `doc.openRecent` | `{ path }` (must be in the recent list) | `{ opened }` or `{ cancelled }` |
| `doc.save`, `doc.saveAs` | — | `{ saved, fileName }` |
| `doc.reload`, `doc.reveal` | — | — |
| `export.markdown` | — | `{ path }` |
| `export.html` | `{ title, bodyHtml }` (sanitized by DOMPurify) | `{ path }` |
| `export.pdf`, `print` | `{ title }` | `{ path }` |
| `files.dropped` | sent with `postMessageWithAdditionalObjects(files)` | — |
| `link.open` | `{ href }` | — (the host asks the user first) |
| `recent.clear` | — | — |
| `recovery.list` / `.restore` / `.discard` / `.clearAll` | `{ id }` (32 hex characters) | summaries / `{ restored }` / — / `{ deleted }` |
| `snapshots.list` / `.create` / `.get` / `.delete` | `{ label }` / `{ id }` | info[] / info / snapshot / — |
| `app.about`, `app.openDataFolder`, `app.openLicenses`, `app.newWindow` | — | — |

Document operations are serialized. A second request that arrives while a dialog is open
gets `{ busy: true }`.

## Events (host → page)

| event | payload |
|---|---|
| `doc.load` | `{ markdown, path, fileName, title, dirty, encoding, eol, notice?, warning? }` |
| `doc.saved` | `{ gen, path, fileName, title, encoding, eol }`. The page marks the document clean only if no edit happened after `gen`. |
| `recent.changed` | `{ recent: [{ path, name }] }` |
| `recovery.available` | `{ drafts }` |
| `insert.text` | `{ markdown }`: inserts a relative image link for a dropped image |
| `notice` / `error` | `{ text, ms? }` |
| `command` | `{ id }`: runs a page command |

Any change to these shapes must bump `v` in both `bridge.js` and `BridgeProtocol.Version`.
