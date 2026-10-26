# NoorMD Desktop: test report

This report checks the build against [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md).

**Evidence used**

- **Windows CI.** The [build workflow](../.github/workflows/build.yml) runs on `windows-latest`. It
  builds the solution, runs the 44 xUnit tests, packages both zips, then launches the
  packaged `NoorMD.exe --self-test`. The self-test drives the real WPF + WebView2 app.
  Run #2 passed all checks:
  - Opened the document in Visual mode, offline.
  - Served the relative image.
  - Ctrl+S on an unedited file left it byte-identical.
  - An edit set the dirty marker and wrote a recovery draft.
  - Save kept CRLF line endings and diacritics and added no BOM. The draft was removed after
    the save.
  - Split view showed two panes. Visual → Split → Visual kept the text.
  - Focus mode used the full width.
  - The theme setting was saved.
  - HTML export was sanitized.
  - PDF export produced a file.
- **Editor UI (Chromium, Playwright).** 55 checks against a mock host, also run in CI.
- **Not tested by a person on a physical Windows PC.** Display scaling, multi-monitor use,
  real printers, and dialogs clicked by hand were not exercised. The self-test calls the save
  path directly and does not click the native dialogs.

## Release blockers

| Item | Status | Evidence |
|---|---|---|
| Compiles on a supported Windows .NET SDK | ✅ | CI windows-latest, .NET 10 SDK, 0 warnings |
| Starts offline; editor styles and WYSIWYG work with no CDN | ✅ | Self-test "bundled editor loaded offline". The UI test fails on any request that leaves the app. |
| Opening Markdown keeps text and title; Unicode, Polish and code fences survive | ✅ | Self-test plus codec unit tests (UTF-8, BOM, UTF-16, CRLF, 1252 fallback) |
| Save writes to the original path; Save As uses the chosen path; New prompts when dirty | ✅ / ⚠ | The save path is verified in the self-test. The prompts are implemented (`ConfirmDiscardAsync`) but were not clicked by a person. |
| Ctrl+S saves exactly once; no download side effect | ✅ | UI tests (one request; held key repeat saves once). Downloads are blocked in WebView2. |
| Rapid edit, then close or open, is saved or recovered | ✅ / ⚠ | The host reads the editor state synchronously (`flush()`) before close and open. Recovery drafts are written while dirty (self-test) and locks are tested in unit tests. A real crash was not simulated on Windows. |
| WYSIWYG → Markdown → Split → WYSIWYG keeps content; unsupported syntax documented | ✅ | UI and self-test round trip. A round-trip guard plus a README section cover syntax the Visual editor can't represent. |
| Split: two panes, independent scrolling, resizable divider, layout survives window resize | ✅ | UI tests (drag to 65 %, setting saved, resize to 1024 px) |
| Focus Mode is editable, full width and exits reliably | ✅ | UI tests plus self-test |
| Dark/light on launch and after reopening, toolbar and editor included | ✅ | Self-test (setting saved). The boot script themes the page before first paint. Theme switches without rebuilding the editor. |
| HTML export and printing usable; untrusted markup can't run scripts | ✅ | DOMPurify plus page CSP plus CSP in the exported file. UI XSS test, self-test, unit tests. A PDF is produced. |
| Links can't trigger unsafe local operations | ✅ | `LinkPolicy` unit tests (blocks `javascript:`, exe/bat, UNC, custom schemes). Navigation and popups are cancelled. |
| Runs from a release zip on another PC | ✅ / ⚠ | Self-test ran the packaged portable folder on a clean CI VM. Not tried on a home PC. |

## Quality and polish

| Item | Status |
|---|---|
| Usable at 1024, 1440 and 1920 px wide | ✅ (UI tests, no horizontal overflow) |
| 125 % / 150 % display scaling | ⚠ Per-monitor DPI v2 manifest and fluid CSS are in place. Not checked by eye. |
| Outline tracks headings and navigates | ✅ (UI tests; a mid-click re-render race was fixed) |
| Command palette and search keyboard-accessible | ✅ |
| Revision snapshots recoverable across restarts | ✅ (unit test reopens the store) |
| Plain `.md` from the old HTML version opens intact | ✅ (it's plain UTF-8 Markdown; see MIGRATION.md) |
| No telemetry, account or web services | ✅ (SmartScreen reputation checks disabled; no network code) |
| Third-party licenses included; unimplemented items listed | ✅ (README → Known caveats) |

## Not implemented (P2 / optional)

- ~~Tabs for several documents in one window~~ — done in 2.0.0-preview.2.
- An installer and file associations.
- Code signing.
- A workspace folder tree.

## 1.1.0 additions (UX enhancements)

| Item from the ideas document | Status | Evidence |
|---|---|---|
| Width presets, including Focus mode | ✅ | UI tests at 1920 px in Focus mode measure the text column: Comfortable ≈ 800 px, Wide ≈ 1100 px, Full = pane minus 24–40 px padding. The preset is saved, cycling back works, and Markdown and Split modes don't overflow. The Windows self-test checks the same with screenshots. |
| Spellcheck on/off | ✅ / ⚠ | Unit, UI and self-test checks: the attribute is set on every editing surface, the setting survives mode switches and restarts, and the text is unchanged. Language follows Windows (WebView2 has no per-app language API); this is documented in Preferences. Whether red underlines actually disappear was not checked by a person. |
| Compact layout | ✅ | The editor gains more than 60 px of vertical room (more than 40 px in the Windows self-test), the sidebar stays, and toggling back restores the original spacing exactly. 125 % / 150 % scaling was not checked by eye. |
| Tabs | 📝 | Design proposal only (docs/TABS_DESIGN.md) |
| Shortcut discoverability | ✅ | F1 list is searchable and generated from the commands |
| About and identity | ✅ | Version, build date, repository link, licenses |
| Editor affordances | ✅ | Divider grip, active state on the Compact button |
| AltGr (Polish ś) not swallowed by Ctrl+Alt+S | ✅ | UI test |

## 1.2.0 additions (Markdown source editor)

| Requested test (proposal) | Status | Evidence |
|---|---|---|
| 1. ~7,500-word document with headings, tables, quotes, nested lists, code and links | ✅ | UI test generates ~7,700 words |
| 2. Raw markers at a uniform size in Markdown and Split | ✅ | Every element in the source pane is measured: one font size, one font family, one line height. The root cause and before/after measurements are in the CHANGELOG. |
| 3. Edit, switch modes repeatedly, compare | ✅ | Six mode switches without edits keep the source byte-for-byte and clean. Source edited and then sent through Visual stays exact. The Windows self-test checks that the original file text appears exactly in Markdown mode. |
| 4. Rapid typing in Split and pane resizing | ✅ | 72 characters typed into the 7,700-word document. The divider is dragged mid-typing, text stays in order and the preview updates. |
| 5. Themes, Compact/Focus, width presets, narrow windows | ✅ / ⚠ | Contrast is computed for every token in both themes: text ≥ 7:1, tokens ≥ 4.5:1, delimiters and line numbers ≥ 3:1. Every width preset was tested in Focus+Compact. In an 820 px window, Split stacks without overlap. HiDPI was not checked by eye. |
| 6. Save/reopen, recovery, UTF-8 and CRLF | ✅ | Unchanged paths. Existing unit tests and the self-test (CRLF and diacritics on save, recovery draft) still pass. |
| 7. Regression coverage for defects found | ✅ | New checks for uniform source styling, exact source after Visual, contrast, and stacked-split overlap (a defect found and fixed during this work) |

## 2.0.0-preview.1 (Creator's Bench milestone A and themes)

| Acceptance test (proposal §11) | Status | Evidence |
|---|---|---|
| 1. Thousands of MP3s without freezing; edit Markdown during indexing and playback | ✅ / ⚠ | Indexing runs on a background task with batched transactions. The UI test edits the document while real audio plays. The query benchmark covers 20,000 rows (3 queries in about 30 ms). The UI list is virtualised and was tested with 20,000 tracks. A real 8,000-file folder was not scanned on Windows; the scan cost per file is one tag read plus one 64 KB hash. |
| 2. Sequential, shuffle, repeat one and repeat all across track boundaries | ✅ | UI test with real audio in Chromium. Tracks end and advance, repeat one restarts, repeat all wraps, and shuffle keeps the current track. |
| 3. Rename and re-tag the playing MP3, save, and the queue continues | ✅ | Unit tests: rename while the file is open, collisions change nothing, id kept, playlists intact. UI test: F2 saves tags and the name, and playback resumes on the re-requested file. Windows self-test: renames and re-tags an MP3 *while WebView2 has it loaded*, then undoes it. |
| 4. Restart restores queue, track and position | ✅ | UI test: a second page restores the saved session, paused, at the saved position |
| 5. Batch rename of hundreds of files with preview and undo | ⏭ | Milestone B (not in this preview). The journal and SafeRename building blocks are in place. |
| 6. Tags checked with an external reader; Polish file names | ✅ | Tags written by NoorMD are read back with **ffprobe** (MP3, FLAC, OGG). Polish file and folder names are tested throughout. |
| 7. Missing, read-only, duplicate, locked and malformed files | ✅ | Unit tests for each. The UI skips an unplayable track with a notice. Locked files report "in use" and change nothing. |
| 8. No regressions (Focus, source mode, shortcuts, exports, recovery) | ✅ | All earlier UI checks still pass (151 in total). The Windows self-test still covers save, recovery, PDF and modes. |
| 9. Fully offline, including the media backend | ✅ | The player is Chromium inside WebView2. Audio and artwork are served locally by NoorMD. No new network use. |
| 10. Video in a detached window | ⏭ | Milestone D |

**Themes:**
- A unit test parses `themes.css` and checks that the C# catalogue matches it, plus WCAG
  contrast for every theme.
- The UI tests cover the picker (preview, cancel and apply), cycling, and readable text in
  every theme.

**Not verified by a person on a physical PC:**
- media keys through Windows' media overlay
- 125 %/150 % display scaling
- a real 8,000-track collection

These are best checked on your machine.

**Defect found by the Windows self-test and fixed before release.** The first Windows CI run
of the Music Bench passed its visible checks, but its log showed `music.query` failing. The
page sends `null` for "no filter", and .NET's `JsonElement.TryGetInt32` throws on null instead
of returning false, so on a real PC the library list would not have loaded. The Chromium UI
tests could not see it, because their mock host is JavaScript.

The fix:
- null-safe JSON readers everywhere;
- music payload parsing moved into the unit-tested `NoorMD.Media` library, with regression
  tests that replay the page's real payloads;
- the self-test now sends that exact query through the real bridge;
- the self-test now fails if *any* bridge request logs an error.

## 2.0.0-preview.2 (multi-document tabs)

| Acceptance test (tabs addendum) | Status | Evidence |
|---|---|---|
| Three files edited in turn, switching repeatedly: no cross-document contamination | ✅ | UI test: three rounds of typing in A, B and C via the strip. Each text contains only its own edits, and each tab's recovery draft carries only its own text. Windows self-test: the same on real WebView2 with three files on disk. |
| Two untitled documents, crash: both drafts recover separately | ✅ | Unit tests: one draft per tab, a "crashed" store's two drafts are listed and loaded separately, and session restore matches each draft back to its tab. UI test: two untitled tabs write separate drafts. |
| Round-trip guard still protects unsupported Markdown | ✅ | UI test: a lossy file opened into a tab is in Markdown mode, byte-exact. Its banner belongs to that tab and comes back with it. |
| Close a dirty tab → Cancel keeps it; Save writes only that file | ✅ | UI test (mock host prompts) and the host's `ConfirmDiscardAsync` per tab. The Windows self-test closes a saved tab; the native prompt itself was not clicked by a person. |
| Save As on one tab doesn't touch the others | ✅ | UI test. The host also refuses to save one tab under the name of a file another tab has open. |
| Same file twice by equivalent paths → existing tab | ✅ / ⚠ | UI test, plus the Windows self-test with a different casing and a `..\` path. The host compares the final path Windows reports (8.3 names, links). Short names and links were not tested separately. |
| Session restore: files and untitled tabs, order, selected tab | ✅ | Unit tests for the session model and restore plan. UI test with 24 restored tabs (pinned, untitled, split mode, selected tab). Windows self-test: the session is saved with the open tabs. A real restart on Windows was not run in CI. |
| Selection/scroll kept; undo can't reach another document | ✅ | UI tests: the cursor stays put across a switch, and 40× Ctrl+Z in one tab stops at its opened text. Every tab has its own editor and undo history. |
| Music keeps playing while opening, switching, closing tabs | ✅ | UI test with real audio, and the mini-player stays. |
| Rapid switching while typing; Ctrl+S right after a keystroke | ✅ | UI test: 16 words typed with Ctrl+Tab between them and no waits. Every word landed once, in the tab that was on screen. Ctrl+S straight after a key saved that key, to that file only. |
| Missing paths, different encodings/EOL | ✅ | Missing session files give a notice (unit-tested restore plan). Windows self-test: UTF-8 BOM + LF and CRLF tabs keep their own format on save. |
| 20+ tabs and UI scaling | ✅ / ⚠ | 24 tabs at 1024 px: the strip scrolls, the window doesn't overflow, Ctrl+E finds a document, and only shown tabs get an editor. 125 %/150 % scaling not checked by eye. |
| Offline, no new dependencies | ✅ | No new libraries; the UI test still fails on any outside request. |

Not verified by a person: the native close prompts and the multi-document window-close dialog,
Ctrl+Tab through WPF (handled by the host, because WPF would otherwise use it to move focus),
and a real crash with several unsaved tabs followed by a restart.

**Defect found by the Windows self-test and fixed before release.** A tab closed by the host
itself (not from a page request) stayed in the page's tab strip. The host now sends a
`tab.closed` event for every closed tab, and the mock host used by the UI tests does the same.

## 2.0.0-preview.3 (menus & toolbar, Vaults, Pack & Share, NoorSketch)

| Acceptance item | Status | Evidence |
|---|---|---|
| Menu, toolbar, shortcut and Ctrl+K run the same command | ✅ | One command registry. UI tests run Bold from the toolbar and Italic from the Format menu. Menus are built from command ids, so a missing module has no dead items. |
| Keyboard access, shortcuts in menus, disabled/checked state | ✅ | UI tests: Alt+F, arrow keys, Esc returns focus to the document, F10, ✓ marks, disabled items |
| Toolbar can be hidden/restored; settings persist; overflow, no clipping | ✅ | UI tests: View → Show toolbar, labels, hidden and reordered groups, Restore defaults, and the “More” menu at 1024 px with every menu title visible. Settings are validated on the host. |
| Formatting reflects the caret; WYSIWYG/source/split keep focus and content | ✅ | UI tests: Bold shows pressed, the heading picker shows H2, table insert, undo |
| Focus Mode editable and always exitable; music unaffected | ✅ | UI tests: Exit focus button, music plays while the toolbar is hidden and shown |
| Vault: 1,000+ notes browse/search without freezing editing or audio | ✅ / ⚠ | UI tests with 1,500 notes (folder expands in under 1.5 s). Windows self-test: 300+ notes indexed in the background. Music plays through search, refresh and close. A real 10,000-note Vault was not tried. |
| Standalone files still work; closing a Vault keeps tabs | ✅ | UI test |
| Rename/move: open tabs follow; inbound links | ✅ / ⚠ | Tabs follow (UI tests and the Windows self-test). Links are not rewritten automatically: NoorMD counts the notes that link to the item and asks first. Automatic rewriting is a later step. |
| Wiki links and YAML front matter kept exactly | ✅ | UI tests: exact text, Ctrl+click follows `[[Rivers]]` |
| Relative images in a Vault; moving the Vault | ✅ | `../../Images/pic.png` shown on real WebView2 (self-test). Links are relative, so they survive moving the whole folder. |
| Obsidian folder untouched | ✅ | Unit tests and the self-test check that `.obsidian/app.json` is unchanged and hidden |
| Pack & Share acceptance 1–10 | ✅ | Unit tests: folder and multi-selection layout, linked files included or skipped one by one, unresolved links, rules that protect secrets, handoff files in their own folder, the user's README untouched, no invented instructions, cancel leaves nothing, self-inclusion prevented, unsafe entry paths refused, a locked or vanished file reported while the rest is packed, links work after unzipping. UI tests: preview, progress, cancel, unsaved-edit choice, music playing. Windows self-test packs a real Vault. |
| NoorSketch checklist | ✅ / ⚠ | UI tests (Chromium):<br>• fast strokes without gaps; size and colour apply<br>• the eraser makes alpha 0; undo/redo/clear; Esc cancels a stroke<br>• zoom/fit/resize never change the pixels<br>• save → reopen is pixel-identical including soft edges; export keeps the resolution<br>• insert request; limits enforced; 4096×4096 canvas<br>Windows self-test: separate window on real WebView2, `.noorsketch` byte-identical round trip, editor untouched. Pen pressure, 125–200 % scaling and the native dialogs were not checked by a person. |

**Defect found and fixed during this work.** In the explorer, F2 was taken by the global
“edit current track” shortcut. It now renames in the explorer and edits the track elsewhere.

## 2.0.0-preview.4 (Batch Organizer, music polish, Video Bench, Stream Desk)

Evidence: 115 Core and 75 Media xUnit tests; Playwright UI tests (sections 15–23) against the mock
host; and the Windows self-test on real WebView2 in CI.

| Acceptance item | Status | Evidence |
|---|---|---|
| Music list multi-select and right-click menu | ✅ | UI tests: click, Shift+click and Ctrl+click; Shift+↓; Ctrl+A; Esc. Right-click keeps the selection. Add to an existing or new playlist, in list order. Mark several as Keep. Show in Explorer for one track only. Copy titles. Remove from the open playlist. |
| Shuffle reachable everywhere, random jump | ✅ | UI tests: mini-player, toolbar and Media menu show the same state. 🎲 reaches every track and never repeats the current one. |
| Batch rename of hundreds of files with preview and undo (milestone B) | ✅ | Unit tests: preview touches nothing; counters and new tags; collisions inside the batch and on disk; a three-file rotation and its undo; keep vs clear; illegal and reserved names, bad regex, unknown placeholders; case-only rename; undo skips files changed since. Windows self-test: swaps two names on NTFS and undoes the batch. UI tests: chips, collision and placeholder errors, per-file results, Undo this batch, Undo last edit undoes a batch. |
| Equalizer, clipping prevention, loudness levelling without touching files (milestone C) | ✅ | UI tests: BS.1770 gives −23.0 LUFS for a −20 dBFS 997 Hz sine (mono) and −20.0 (stereo), and silence is gated. Gain rules (measured, ReplayGain, −1 dBFS cap). Presets, preamp, persistence. Real fixtures measured from the page. Windows self-test: an MP3 measures −22.18 LUFS in WebView2, the same as Chromium on Linux, and plays through the EQ and limiter. |
| Smart collections, artwork | ✅ | Unit tests: text, numbers, dates, marks and flags; any/all; top-N; accent-insensitive; values only as SQL parameters; v1 → v3 upgrade in place; folder.jpg / cover.png. UI tests: rule builder with live count, presets, edit, delete, placeholder art and viewer. |
| Video library, episode order, resume, subtitles, detachable player, timestamped notes (milestone D) | ✅ | Unit tests: S01E02 / 1x02 / Episode / Part / "- 03 -" parsing, natural order; SRT/ASS → WebVTT; sidecar files; scan keeps ids, missing files; resume and watched rules; notes and their Markdown. UI tests: resume and Start over, subtitles and C, speed, notes (add, jump, edit, delete, into document), next-episode countdown, pop-out hand-off both ways, music pauses. Pop-out page: always on top, note, next episode, Esc. Windows self-test: plays MP4 (H.264/AAC) and WebM, loads SRT cues, saves positions. |
| OBS Now Playing overlay, designs and customising | ✅ | Unit tests: loopback-only server, 404 outside the overlay folder, 421 for other Host names, 405 for POST, SSE push with replay. UI tests: six designs, live preview, settings sent to the overlays, the OBS page renders from the event stream on a transparent background. Windows self-test: real HTTP and SSE from the packaged app; DNS-rebinding refusal; now-playing.txt. |
| Supporters list and credits roll with effects and a simple effect builder | ✅ | Unit tests: the Markdown table round-trips and keeps the rest of the note; CSV, TSV and plain-line imports; merge (new, updated, back, left); only web links kept. UI tests: only active people in the roll; channel short names; new effect from an existing one; emoji particles drawn; preview scroll; Roll credits in OBS; supporters added, marked left, imported and saved. OBS credits page starts by itself. Windows self-test: supporters note written in a Vault with Polish names. |
| Stream history with templates (title, description, keywords, thumbnail, date) | ✅ | Unit tests: templates and date formats; chapters (start at 00:00, ≥ 10 s); note round trip; file names. UI tests: template applied; tracklist recorded while music plays; copied description contains chapters; thumbnail; saved and listed. Windows self-test: note saved in a Vault and read back. |
| Not tested by a person | ⚠ | OBS itself (Browser Source rendering, `obsSourceVisibleChanged`), 125–200 % scaling, multi-monitor pop-out placement, MKV files with unusual codecs, very large libraries for the Batch Organizer. |

**Defects found and fixed during this work.**
- Submenus covered their own parent item next to the right edge; they now open to the left.
- The first shortcut chosen for the Stream Desk clashed with Ctrl+Alt+S (snapshot); it is now Ctrl+Alt+B.
- The pop-out page used relative media URLs; they now start with `/`.
- Two settings forms edited stale copies of their objects after the first change.
- The supporters import merged into the saved list instead of the one on screen.
- The new Media buttons pushed Play/Pause into "More"; they now collapse first.
