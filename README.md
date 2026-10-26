# NoorMD Desktop

A local-first Markdown writing studio for Windows: a WPF (C#) application with a
WebView2-hosted editor (visual WYSIWYG, Markdown source and split preview), native
file dialogs, crash recovery and revision snapshots. No account, no telemetry and no
web services.

![NoorMD](src/NoorMD/Assets/NoorMD-256.png)

## Download and run

1. Get `NoorMD-2.0.0-win-x64-portable.zip`. Use the build attached to the GitHub Actions
   run (artifact **NoorMD-win-x64**), or build it yourself (see below).
2. Extract the zip to any folder, for example `C:\Tools\NoorMD`. Do not run it from inside
   the zip.
3. Run `NoorMD.exe`.

**Requirements**

| | Portable zip (recommended) | Small zip |
|---|---|---|
| Windows 10 (1809+) / 11, x64 | ✔ | ✔ |
| Microsoft Edge **WebView2 Runtime** | ✔ required: preinstalled on Windows 11 and current Windows 10 | ✔ required |
| .NET 10 Desktop Runtime | not needed (bundled) | required |

If WebView2 is missing, NoorMD tells you and links to Microsoft's free installer
(<https://go.microsoft.com/fwlink/p/?LinkId=2124703>). The binaries are **not code-signed**,
so Windows SmartScreen may show "Windows protected your PC". Choose *More info → Run anyway*,
or right-click the zip → *Properties* → *Unblock* before extracting.

## Features

- **Open, save, Save As** with native Windows dialogs. Files are written atomically (temp
  file + replace) and the previous version is backed up. The original encoding (UTF-8 with or
  without BOM, UTF-16), line endings (CRLF/LF) and final newline are kept.
- **No silent data loss.** You get a Save / Don't save / Cancel prompt on close, New, Open and
  Recover. Unsaved text goes to a recovery draft about 0.6 s after you stop typing. After a
  crash or power loss, NoorMD offers the draft the next time it starts.
- **Three editing modes:** Visual (WYSIWYG), Markdown source and Split. The Split view has a
  draggable divider (30–70 %) whose position is remembered, independent scrolling (sync is
  optional), and stacks vertically when the editor is narrow.
- **A round-trip guard.** The Visual editor cannot represent every kind of Markdown; raw
  HTML, footnotes and hard line breaks are examples. NoorMD detects this when a file opens. It
  then opens the file in Markdown mode so nothing is rewritten, and asks before switching. A
  file that is only opened, never edited, is never re-saved.
- **Focus mode** (F11): the document fills the whole window.
- **Studio tools:** document outline with navigation, word/character counts, reading time,
  a writing goal, a command palette (Ctrl+K), find & replace (Ctrl+F / Ctrl+H) and revision
  snapshots with preview, restore and delete. Snapshots are kept across restarts.
- **Export:** Markdown copy, standalone HTML (sanitized, scripts blocked by CSP), PDF and
  Print through the Windows print dialog. Microsoft Print to PDF works too.
- **Light and dark themes.** The window title bar, the dialogs and the editor all follow the
  theme, and dark mode starts without a white flash.
- **Line width presets:** Comfortable (≈ 800 px), Wide (≈ 1100 px) and Full width. Change
  them with the ↔ button or Ctrl+Shift+W, in normal and Focus mode.
- **Markdown source editor:** plain text in one monospaced font (JetBrains Mono, bundled) and
  one size, with subtle syntax colours, line numbers, optional word wrap and a current-line
  highlight. Shortcuts for headings, links and code blocks, and Copy Markdown source.
  Switching modes never rewrites source you didn't edit in Visual mode.
- **Nine colour themes** with a live-preview picker (Theme button, Ctrl+Shift+T to cycle).
  All are contrast-checked.
- **Creator's Bench: Music Bench** (Ctrl+Shift+M, optional):
  - A local music library with fast search and triage (Favorite, Keep, Maybe, Skip).
  - Playlists, an Up next queue, and a persistent mini-player.
  - **Edit current track (F2)**: tags and/or file name, with safe renames and undo.
  - Session resume.
  - See [docs/CREATORS_BENCH_PLAN.md](docs/CREATORS_BENCH_PLAN.md).
- **Compact layout** (Ctrl+Shift+L) for more vertical room. **Spellcheck on/off**
  (Ctrl+Shift+Y) uses the Windows spell checker and the languages installed in Windows.
- **Preferences:** writing font (Inter is bundled), text size, line width, layout,
  spellcheck, the mode for opening files, and whether to restore the last document on start.
  You can also clear recent files or recovery drafts here.
- **Recent files**, **drag & drop** to open, and **New window** (in the command palette) to
  work on two documents side by side.
- **Works fully offline.** The editor, fonts and every script are bundled; nothing is loaded
  from a CDN.

See [docs/SHORTCUTS.md](docs/SHORTCUTS.md) for keyboard shortcuts.

## Build from source

Prerequisites: **.NET 10 SDK** on Windows. On Linux or macOS the solution also builds, because
`EnableWindowsTargeting` is set, but you need a Microsoft-built SDK; distro "source-built"
SDKs lack the WPF pack. Internet access is needed only during the build, for NuGet restore.

```powershell
dotnet restore
dotnet build NoorMD.sln -c Release
dotnet test tests/NoorMD.Core.Tests
dotnet run --project src/NoorMD          # starts the app (Windows)
```

Release packages:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\publish-win-x64.ps1
# -> artifacts\NoorMD-2.0.0-win-x64-portable.zip  (self-contained, ~70 MB)
#    artifacts\NoorMD-2.0.0-win-x64-small.zip     (needs .NET 10 Desktop Runtime)
```

`scripts/publish-win-x64.sh` produces the same zips when cross-building from Linux.

### Tests

| Suite | What it covers | Command |
|---|---|---|
| `tests/NoorMD.Media.Tests` (xUnit) | tag reading and writing on real MP3/FLAC/OGG/WAV files (checked with ffprobe), safe renames, collisions, read-only and missing files, the index and relinking, a 20,000-track query benchmark, M3U, HTTP ranges | `dotnet test tests/NoorMD.Media.Tests` |
| `tests/NoorMD.Core.Tests` (xUnit) | encodings and line endings, atomic writes, recovery locking, snapshots, path traversal, the link policy, HTML export, bridge protocol, settings | `dotnet test tests/NoorMD.Core.Tests` |
| `tests/web` (Playwright) | the real editor UI against a mock host: modes, split divider, focus mode, themes, outline, find/replace, palette, XSS, offline loading, the round-trip guard | `cd tests/web && npm i && npx playwright install chromium && node ui.test.js` |
| `NoorMD.exe --self-test <dir>` | the packaged app end to end on Windows: open → edit → recovery draft → save (CRLF and diacritics kept) → split → focus → theme → PDF, with screenshots | runs in CI ([.github/workflows/build.yml](.github/workflows/build.yml)) |

## How it works

```
src/NoorMD.Core      platform-neutral C#: TextFileCodec, AtomicFile, RecoveryStore, SnapshotStore,
                     SettingsStore, AssetResolver, LinkPolicy, HtmlExport, BridgeProtocol
src/NoorMD           WPF shell: MainWindow (WebView2 setup and security), MainWindow.Bridge (commands),
                     MainWindow.Documents (open/save/export/unsaved rules), ThemedDialog, ThemeManager
src/NoorMD/wwwroot   editor UI: index.html, css/app.css, js/{bridge,markdown-tools,ui,app}.js
  vendor/            TOAST UI Editor 3.2.2 (+ProseMirror) bundle, DOMPurify, Inter: built by web/vendor-build
```

- **Content and file ownership.** The web page owns the text and the "dirty" generation
  counter. The C# host owns files, dialogs, settings, drafts and snapshots. Before saving or
  closing, the host reads the editor state synchronously with `ExecuteScriptAsync`, so a
  keystroke made just before Ctrl+S or closing the window is never lost.
- **Bridge.** The page and the host exchange small, versioned JSON messages; see
  [docs/BRIDGE.md](docs/BRIDGE.md). The page has no file-system access. It can only ask for
  named commands, and every path comes from a native dialog, the recent list or a drag and drop.
- **Security.**
  - The UI is served from `https://noormd.local/` by `WebResourceRequested`, with a strict
    Content-Security-Policy (`script-src 'self'`), so markup inside a document cannot execute
    scripts.
  - Every navigation and popup is cancelled.
  - Links pass through `LinkPolicy`. http, https and mailto open in your browser after a
    confirmation. `.md` and `.txt` files open in NoorMD. Everything else is blocked:
    programs, `file:` URLs to other kinds of files, network shares, `javascript:` and custom
    schemes.
  - Browser accelerator keys, DevTools (in Release builds), downloads and permission
    requests are disabled.
- **Images:** relative image paths (`![](img/a.png)`) are served from the document's folder.
  Only image files are served, and nothing outside that folder.

### Where data is stored

| What | Where |
|---|---|
| Your documents | wherever you save them |
| Settings, recent files | `%APPDATA%\NoorMD\settings.json` |
| Music index (paths, triage, playlists, queue; audio files are never copied) | `%LOCALAPPDATA%\NoorMD\Music\library.db` |
| Recovery drafts | `%LOCALAPPDATA%\NoorMD\Recovery\` (deleted when you save or choose *Don't save*) |
| Revision snapshots | `%LOCALAPPDATA%\NoorMD\Snapshots\` (50 per document) |
| Backup of the previous version of each saved file | `%LOCALAPPDATA%\NoorMD\Backups\` |
| WebView2 profile, local log | `%LOCALAPPDATA%\NoorMD\WebView2\`, `…\Logs\noormd.log` |

*Preferences → Open data folder* opens this location. NoorMD never writes next to the `.exe`.

## Known caveats

- **Visual mode normalizes Markdown.** After an edit in Visual mode, saving rewrites
  formatting details: `-` list markers become `*`, setext headings become `#`, and table
  pipes are realigned. The meaning stays the same. Content Visual mode cannot represent
  triggers the guard described above. Markdown mode always saves your text byte for byte.
- **Not supported by the editor engine:** footnotes, math, Mermaid and wiki links. They are
  kept as plain text in Markdown mode.
- **One document per window.** Use *New window* for more. Tabs are designed but not built yet ([docs/TABS_DESIGN.md](docs/TABS_DESIGN.md)).
- **Not included:** file associations and an installer. Use *Open with → Choose another app
  → NoorMD.exe* to make NoorMD the handler for `.md` files.
- **Pasted images** are embedded as base64 data URIs, which is the editor's default.
  Dropping an image that sits in the document's folder inserts a relative link instead.
- **WebView2 itself** follows Windows' diagnostic-data settings. NoorMD turns off SmartScreen
  reputation checks and makes no network requests of its own. An image in your document with
  an `https://` address is fetched when shown.
- **Not code-signed.**

What changed between versions and how to go back to 1.0.0: [CHANGELOG.md](CHANGELOG.md).
The design proposal for tabs: [docs/TABS_DESIGN.md](docs/TABS_DESIGN.md).

Migrating drafts from the old single-file HTML version: see [docs/MIGRATION.md](docs/MIGRATION.md).
Test results against the acceptance checklist: [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## License

Third-party components and licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The
license texts ship in the `licenses` folder of every release.
