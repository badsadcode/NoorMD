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
| `tab.closed` | `{ tabId }`: the host closed this tab (sent before the new blank tab when the last one closes) |
| `tab.select` | `{ tabId }`: show this tab (the file was already open, or the host is about to ask about it) |
| `recent.changed` | `{ recent: [{ path, name }] }` |
| `recovery.available` | `{ drafts }` |
| `insert.text` | `{ markdown }`: inserts into the visible tab (a relative image link for a dropped image) |
| `notice` / `error` | `{ text, ms? }` |
| `command` | `{ id }`: runs a page command (the host sends `tab.next` / `tab.prev` for Ctrl+Tab, which WPF would otherwise use for focus) |

## Additions in 2.0.0-preview.3 (still protocol v2: new message types only)

| type | payload | result |
|---|---|---|
| `clipboard.readText` | — | text on the Windows clipboard |
| `doc.pickImage` | `{ tabId }` | `{ path, name }`: relative link where possible |
| `app.openGuide`, `app.exit` | — | — |
| `vault.open` / `.openRecent` / `.create` / `.close` / `.reveal` / `.refresh` | `{ path }` / `{ name }` | `{ opened }` |
| `vault.tree` | — | `{ root, indexed, entries: [{ p, d, s, m }] }` (Vault-relative paths) |
| `vault.openFile` | `{ path }` | opens the note in a tab (`.noorsketch` opens NoorSketch) |
| `vault.search` | `{ query }` | `{ hits: [{ path, name, line, snippet, nameMatch }], indexed }` |
| `vault.backlinks` | `{ tabId }` | `{ refs: [{ source, line, snippet }], inVault }` |
| `vault.openWiki` / `vault.linkTo` | `{ target, tabId }` / `{ tabId, path }` | opens / `{ link, title }` |
| `vault.newNote` / `.newFolder` / `.rename` / `.move` / `.duplicate` / `.delete` | Vault-relative paths and names | validated by the host; delete goes to the Recycle Bin |
| `vault.settings.get` / `.set` | `{ attachments, excluded[] }` | the Vault's options |
| `vault.pack.plan` / `.create` / `.cancel` / `.reveal` | selection and options | preview / `{ path, entries, bytes, failures }` |
| `sketch.new` / `sketch.open` | — | opens a NoorSketch window |

Events: `vault.changed`, `vault.tree`, `vault.indexed`, `vault.pack.progress` and
`doc.renamed` (`{ tabId, path, fileName, title }`).
`insert.text` may name a `tabId`; it is then inserted only into that tab.

The NoorSketch window has its own bridge and accepts messages only from `/_noormd/sketch.html`:
`sketch.ready`, `sketch.dirty`, `sketch.save`, `sketch.open`, `sketch.exportPng`,
`sketch.insert` and `sketch.closeNow`. The host sends it `sketch.saveAndClose` and
`sketch.load`.

## Additions in 2.0.0-preview.4 (still protocol v2: new message types only)

Music Bench:

| type | payload | result |
|---|---|---|
| `music.batch.preview` | `{ ids[], spec: { tags: { field: { mode: keep\|set\|clear, value } }, rename: { enabled, template, find, replace, regex, matchCase, prefix, suffix, case, underscores, tidy, replaceIllegal, counterStart, counterStep, counterDigits } } }` | `{ willChange, unchanged, blocked, items: [{ id, oldName, newName, renames, ok, tags[], problems[], warnings[] }] }`; touches nothing |
| `music.batch.apply` | same as preview | `{ batchId, done, failed, skipped, items: [{ id, oldName, newName, status, message }], undo }` |
| `music.batch.undo` | `{ batchId }` | same shape as apply |
| `music.undo` | — | undoes the last edit, or the whole last batch |
| `music.loudness.set` | `{ id, lufs, peak }` | stores the page's BS.1770 measurement (the file is not modified) |
| `music.loudness.unmeasured` | `{ ids[]? }` | ids without a measurement |
| `music.smart.save` / `.count` / `.delete` | `{ id?, name, rules: { matchAll, rules: [{ field, op, value }], limit?, limitSort?, limitDesc? } }` | `{ id, smart[] }` / count / `smart[]` |
| `music.query` / `music.ids` | also accept `smartId` | |
| `music.art.save` | `{ id }` | Save dialog; `{ path }` |

`music.status` also returns `smart[]`; rows carry `rgGain`, `rgPeak`, `loudness`, `peak` and `plays`.

Video Bench (`/_video/{id}` serves the file with ranges; `/_sub/{id}/{n}` serves subtitles as WebVTT):

| type | payload | result |
|---|---|---|
| `video.status` | — | `{ folders[], series: [{ key, name, count, watched, resumeId }], resume[] }` |
| `video.addFolder` / `.removeFolder` / `.rescan` | — / `{ id }` | |
| `video.episodes` / `video.search` | `{ key }` / `{ text }` | videos in watching order |
| `video.get` | `{ id }` | `{ video, subtitles: [{ index, label, lang }], notes[], next, exists }` |
| `video.position` | `{ id, position, duration }` | the updated video (watched near the end) |
| `video.watched` | `{ ids[], value }` | |
| `video.note.add` / `.update` / `.delete` / `.insert` | `{ id, time, text }` / `{ id, noteId, text }` / `{ id, noteId }` / `{ id }` | notes; insert puts them into the active document |
| `video.popout` / `video.popout.close` | `{ id, time, paused }` | opens / closes the pop-out player |
| `video.reveal`, `video.session.get` / `.save` | | |

Events: `video.scanned`, `video.popin` (`{ id, time }` when the pop-out closes), `video.notes`.
The pop-out window has its own bridge and accepts messages only from `/_noormd/video.html`:
`video.ready`, `video.get`, `video.position`, `video.next`, `video.note.add`, `video.topmost`,
`video.title` and `video.close`; the host sends it `video.load`.

Stream Desk:

| type | payload | result |
|---|---|---|
| `stream.status` | — | server state, overlay configs, effects, templates, text-file options, Vault, recording session |
| `stream.server` | `{ enabled, port }` | starts/stops the loopback overlay server |
| `stream.np.config` / `stream.credits.config` | `{ config }` / `{ config, effects[] }` | saved and pushed to connected overlays |
| `stream.np.update` | `{ track: { id, title, artist, hasArt, playing, position, duration } \| null }` | sent by the Music Bench |
| `stream.credits.start` / `.stop` | — | `{ clients }` |
| `stream.txt` | `{ enabled, format, choose }` | `{ path }` of now-playing.txt |
| `stream.paths` | `{ supportersNote, streamsFolder }` | Vault-relative locations |
| `stream.supporters.get` / `.save` | — / `{ supporters: [{ name, channel, tier, since, until, note }] }` | the table note in the Vault |
| `stream.supporters.import` | `{ text, markMissingAsLeft, current[] }` | `{ found, added[], updated[], returned[], left[], merged[] }`; nothing saved |
| `stream.log.list` / `.get` / `.save` | — / `{ path }` / `{ entry, path? }` | stream notes in the Vault |
| `stream.log.thumbnail` | — | picture copied into the Vault's attachments; `{ thumbnail, thumbnailData }` |
| `stream.templates.save` | `{ templates[] }` | |
| `stream.session.start` / `.stop` | — | records `{ offset, text }` for each song played |
| `stream.chapters` / `stream.fill` | `{ tracklist[] }` / `{ template, values, date }` | YouTube chapters / filled template |

Overlay server (http://127.0.0.1:port/, GET/HEAD only, Host must be loopback): `now-playing.html`,
`credits.html`, their scripts and CSS, `/inter.woff2`, `/art` and `/events` (Server-Sent Events:
`np.config`, `np.track`, `credits.config`, `credits.data`, `credits.start`, `credits.stop`).

Any change to these shapes must bump `v` in both `bridge.js` and `BridgeProtocol.Version`.
