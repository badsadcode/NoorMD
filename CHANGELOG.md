# Changelog

## 2.0.0-preview.3 — Menus & toolbar, Vaults, Pack & Share, NoorSketch

Built from four proposals: *Main Menu & Customizable Toolbars*, *Vaults Foundation*, *Vault Pack & Share*
and *NoorSketch*. Tabs, the Music Bench and every earlier feature are unchanged, and the
signature violet theme (Atelier Dark) is still the default.

**Main menu and toolbar.**
- Menus: **File, Edit, Insert, Format, View, Workspace, Media, Tools, Help**.
  - Open them with **Alt+letter** (holding Alt underlines the letters), or press **F10** and
    use the arrow keys.
  - Menu items show their shortcuts. Items that can't run right now are greyed out, and
    toggles show a check mark.
- **One command list for everything.** The menu, the toolbar, keyboard shortcuts and Ctrl+K
  all run the same commands, so they can't drift apart.
- **Toolbar** with groups: Document, Writing, Navigation, View, Tools and Media.
  - It replaces the editor's own toolbar. Bold, italic, lists and other formats light up for
    the text at the cursor.
  - The heading picker shows the current level. Insert table and Insert image have small
    dialogs.
  - When the window is narrow, the least-used buttons move into **More** instead of being
    cut off.
  - Right-click the toolbar or use **View → Customize toolbar…** to:
    - show text labels or use small buttons;
    - hide or reorder groups;
    - restore the defaults.
  - **View → Show toolbar** hides it completely. Everything stays in the menus and Ctrl+K.
- **Focus mode** hides the menu and toolbar (optionally keep the toolbar). An **Exit focus**
  button is always visible.
- **Edit menu:**
  - Cut, Copy and Paste-as-plain-text go through the Windows clipboard.
  - Select all, plus **Tools → Document statistics** and **Help → User guide** (opens the
    README in a tab).

**Vaults.** A Vault is any ordinary folder. Open it with **Workspace → Open Folder as Vault**,
or create one.
- NoorMD writes nothing into it except your own notes and folders. `.git`, `.obsidian` and
  other tools' folders are skipped and never changed. Its settings live in NoorMD's own
  settings.
- **Explorer** in the sidebar (Files / Document switch):
  - folders first, natural order;
  - name filter that ignores accents;
  - keyboard navigation, Ctrl/Shift multi-select and drag to move;
  - inline rename with F2;
  - New note / New folder, Duplicate, Reveal, Copy path;
  - Delete to the **Recycle Bin**.
- **Open tabs follow their files** when you rename or move them in NoorMD. Deleting a file
  closes its tab unless it has unsaved edits.
- **Find in Vault (Ctrl+Shift+F).**
  - Every note is searched in the background, ignoring accents and case. Matches are
    highlighted.
  - Opening a result highlights the words in the note.
  - The index is kept up to date by watching the folder. It is a cache, never stored in the
    Vault.
- **Ctrl+E** now also finds notes that aren't open. **Ctrl+Shift+E** focuses the explorer.
- **Linked from:** a sidebar list of notes that link to the current one, by relative link or
  `[[wiki link]]`.
- **Links:**
  - **Ctrl+click** a `[[wiki link]]` to open it (or to create the note).
  - Links between notes in the Vault open without a confirmation.
  - **Link to a note…** inserts a relative link.
- **Pictures:**
  - `../Images/x.png` style links work inside a Vault.
  - Dropping a picture from outside the Vault offers to copy it into the Vault's attachments
    folder.
- Front matter and wiki links keep their exact text; the round-trip guard handles notes the
  Visual editor can't represent.
- Closing or switching a Vault never closes a tab. The Vault reopens on start with the
  session.

**Pack & Share.** Right-click a folder, several items or the Vault, or use **Workspace →
Pack & Share…**.
- **Preview first:** file count and size, the files with their archive paths, what's left out
  and by which rule, linked files from elsewhere in the Vault (include or exclude each), and
  links that can't be packed.
- **Exclusion rules** are visible and editable. The defaults leave out `.git`, `.obsidian`,
  `.env`, keys, certificates, temp files and the like.
- **Folder structure is kept,** so relative links work after unzipping. The archive never
  includes itself.
- **AI Handoff Package** adds `MANIFEST.md` and `README.md` in `_noormd_handoff/` (your own
  README is never replaced). It includes only instructions you write; nothing is invented or
  summarised, and nothing is uploaded.
- **Packing:**
  - Runs in the background with progress and Cancel. Music keeps playing.
  - The ZIP is written under a temporary name, checked, and only then renamed.
  - Cancelling or failing leaves no archive, and your files are only ever read.
  - Locked files are reported, and the rest is packed.
- **Unsaved edits** in packed notes: choose to save first or to pack the versions on disk.

**NoorSketch** (**Tools → NoorSketch**). A quick sketchpad in its own resizable window that
doesn't block the editor or the music.
- **Tools:**
  - brush (1–100 px, no gaps on fast strokes) and colour swatches or any colour;
  - an eraser that makes pixels transparent, not white;
  - multi-step undo/redo, including Clear and canvas resize;
  - wheel zoom, Space/middle-drag pan, Fit and 100 %.
- **Canvas:** 1280×720, 1920×1080, 2048×2048, 4096×4096 or a custom size, with a white or
  transparent background.
- **Files:**
  - **.noorsketch** is a plain ZIP with `manifest.json` and `image.png`. NoorSketch keeps exact
    pixels, so a saved sketch reopens **pixel-identical**, including soft edges.
  - **Export PNG** at full resolution.
- **Insert into document** saves the PNG next to the note (`assets/`) or in the Vault's
  attachments folder, optionally with its editable `.noorsketch`, and inserts a relative
  `![Sketch](…)` link into that document. For an unsaved document it asks where.
- Unsaved sketches are protected when you close the sketch window or NoorMD.

**Tests.**
- 100 unit tests in Core, 46 in Media.
- 303 UI checks, 100 of them new, covering menus and the toolbar, Vaults, Pack & Share and
  NoorSketch.
- The Windows self-test now also covers:
  - a 300-note Vault, `../` pictures and rename following a tab;
  - the Recycle Bin and Pack & Share;
  - NoorSketch's exact PNG through the real `.noorsketch` file.

### Going back to 2.0.0-preview.2

Notes, sketches and ZIPs are ordinary files, so nothing needs converting. Older versions
ignore the new settings keys (toolbar, Vaults) and can't open `.noorsketch` files. The
preview.2 code is on **`noormd-2.0.0-preview.2-baseline`** (commit `1b3cc22`).

## 2.0.0-preview.2 — Multi-document tabs

Based on *NoorMD — Multi-Document Tabs & Session Management*. The Creator's Bench work is
unchanged; the music player belongs to the window, not to a tab.

**Tabs.**
- A tab strip above the document. Each tab shows the file name, a dot for unsaved changes and
  a close button; the tooltip is the full path.
- **Ctrl+T** (or Ctrl+N) opens a new untitled tab. **Ctrl+O** opens files into tabs, and you can
  pick several at once. Dropped Markdown files each get a tab.
- **Ctrl+Tab / Ctrl+Shift+Tab** and **Ctrl+PageDown / Ctrl+PageUp** switch tabs. **Ctrl+W** closes
  one, and so does a middle-click. Drag a tab to reorder it. **Ctrl+E** (or the ⌄ button) lists all
  open documents, with search.
- The right-click menu has **Close, Close Others, Close Tabs to the Right, Copy Path, Reveal in
  Explorer, Pin/Unpin**. Pinned tabs sit at the start and are skipped by Close Others / Close Tabs
  to the Right and by middle-click. Close or Ctrl+W still closes them.
- Opening a file that is already open selects its tab. Different spellings of the same path
  are recognised: casing, `..\`, 8.3 short names and links.
- Many tabs scroll sideways inside the strip, so the window never gets wider.

**Each document is kept separate.**
- Every tab has its own editor, so undo history, cursor, selection and scroll position belong
  to that document only.
- Encoding, BOM, line endings, dirty state and the round-trip guard (with its banner) are also
  per tab.
- Each tab has its own recovery draft and snapshot history. Two untitled documents stay two
  separate drafts, including after a crash.
- File-changed-on-disk checks run for every open file, not just the visible one.
- The host never takes text from "whatever is on screen". Every save, close and export names
  its tab, and the text is read from that tab's own editor at that moment, including keys
  typed a fraction of a second earlier.

**Saving and closing.**
- **Ctrl+S** saves only the visible tab. Save As changes only that tab's path and name.
- **Save all** is in the command palette.
- Closing a modified tab asks Save / Don't save / Cancel. Cancel keeps the tab and its text.
- Closing the window with several modified documents lists them and offers **Save all**,
  **Review each…**, **Don't save** or **Cancel**. Cancel keeps the window open.

**Session restore.**
- On start, NoorMD reopens the tabs from last time: files and untitled documents, in their
  order, with pinning, view mode and the selected tab.
- A tab whose unsaved work survived a crash or a Windows shutdown comes back with that work.
- Files that were moved or deleted are reported in a notice and skipped.
- Extra windows (*New window*) don't touch the main window's session.
- Turn this off in Preferences → *Reopen the tabs from last time*.

**Technical.**
- Bridge protocol v2: document requests carry a `tabId`, and `NoorMD.flush(tabId)` reads one
  tab. See [docs/BRIDGE.md](docs/BRIDGE.md).
- Recovery drafts are named `<session>-<tab>.json`.
- Tests:
  - 4 new unit tests (65 in Core; the protocol test now also checks that v1 messages are rejected);
  - 52 new UI checks (203 in total), including three files edited in turn, rapid switching
    while typing, Ctrl+S straight after a keystroke, 24 tabs, and music playing through tab
    changes;
  - Windows self-test checks for tabs on real WebView2.

### Going back to 2.0.0-preview.1

**Save or recover your work first.** Older versions don't recognise the new per-tab recovery
draft names, so they would not offer them. Settings, snapshots and the music library are
compatible; older versions ignore the new `session` key and reopen the last document as before.
The preview.1 code is on **`noormd-2.0.0-preview.1-baseline`** (commit `6fae20f`). Older
baselines: `noormd-1.2.0-baseline`, `noormd-1.1.0-baseline`, `noormd-1.0.0-baseline`.

## 2.0.0-preview.1 — Creator's Bench (milestone A) and themes

Based on *NoorMD 2.0 — Creator's Bench*. The engineering plan, decisions and conflicts are in
[docs/CREATORS_BENCH_PLAN.md](docs/CREATORS_BENCH_PLAN.md).

**Themes.** Nine colour themes:
- Atelier Dark and Atelier Light (the originals)
- Nocturne, Ember, Evergreen and Rosewood (dark)
- Parchment and Glacier (light)
- High Contrast

Choose one with the **Theme** button, which previews on hover and applies on click, or cycle
with **Ctrl+Shift+T**. The window title bar and dialogs follow the theme. Every theme is
checked automatically for WCAG contrast; see the screenshots in
[docs/themes-preview.png](docs/themes-preview.png).

**Music Bench (Ctrl+Shift+M).** It is optional and starts nothing until you open it.
- **Library:**
  - Add folders, including subfolders. The index builds in the background while you keep
    writing.
  - Search ignores case and Polish diacritics ("zolw" finds "Żółw"). Filter by triage, sort,
    and scroll a virtualised list (tested with 20,000 tracks).
  - Missing files are marked, never deleted. Files moved outside NoorMD are relinked when
    you rescan.
  - NoorMD never moves or changes files on its own.
- **Player:**
  - Play/pause, seek, volume, previous/next, shuffle, and repeat (off, all or one). It plays
    MP3, FLAC, WAV, OGG/Opus and M4A.
  - An **Up next** queue, a **Now Playing** card, and a **mini-player** under the editor that
    can be hidden.
  - Playback continues while you write and switch documents.
  - The last queue, track and position come back after a restart, paused.
- **Edit current track (F2):**
  - Edits title, artist, album, album artist, genre, year, track number and comment. Tags
    that aren't present show as "— not set —"; nothing is invented.
  - Updating the tags and renaming the file are separate choices. Use **Name from tags** for
    a suggestion, then **Save**, **Save & Next** or **Cancel**.
  - The file is validated before anything is touched: illegal characters, reserved names,
    collisions (nothing is ever overwritten), read-only files.
  - The playing file is released, edited and resumed at the same position.
  - Every edit is journalled. **Undo last track edit** reverts the name and tags, and refuses
    if the file was changed since.
- **Triage while listening:** **Alt+1** Favorite, **Alt+2** Keep, **Alt+3** Maybe, **Alt+4**
  Skip and **Alt+0** clear. These work from the editor without typing anything. In the
  library list, plain 1–4 also work.
- **Playlists:** create, rename, delete, play, "Save Up next as playlist", and import/export
  `.m3u`/`.m3u8` with relative paths.
- **Shortcuts:** **Ctrl+Alt+Space** play/pause and **Ctrl+Alt+→/←** next/previous. Media keys
  work through the Media Session API.
- **New components:** TagLib# (LGPL-2.1, as a separate DLL), Microsoft.Data.Sqlite (MIT),
  SQLitePCLRaw (Apache-2.0) and SQLite (public domain). License texts ship in `licenses/`.
- **Not in this preview:** the remaining phases from the proposal, each its own milestone:
  - **B:** the batch organizer (mass rename and tag templates with preview and dry run)
  - **C:** EQ and loudness
  - **D:** the Video Bench

  Streaming services stay out of scope.

### Going back to 1.2.0

Documents, recovery drafts, snapshots and settings are unaffected; older versions ignore the
new settings keys. The music index is a separate file (`%LOCALAPPDATA%\NoorMD\Music\library.db`)
that 1.x never reads. The 1.2.0 code is on **`noormd-1.2.0-baseline`** (commit `e6db7d3`).
Older baselines: `noormd-1.1.0-baseline`, `noormd-1.0.0-baseline`.

## 1.2.0 — Markdown source editor

Based on *NoorMD — Markdown Source Editing Improvements*.

**What was wrong.** The editing engine was fine; the cause was CSS. TOAST UI's own Markdown
syntax stylesheet enlarges and bolds heading tokens (`.toastui-editor-md-heading1..6`: 24, 22
and 20 px) and puts code blocks in Consolas. NoorMD 1.1's overrides targeted `h1`/`h2` and
`.toastui-editor-contents span`, which don't match the classes TOAST uses in the source
pane, so `# Heading` lines rendered large. Measured before the fix: 24/22/20 px heading lines
next to 14 px text, with line heights of 41, 37 and 24 px. After the fix: one size, one font
and one line height everywhere. No new editor was introduced.

- **The source pane is plain text.**
  - Every line uses the same font (the bundled **JetBrains Mono**), size and line height.
  - Markers such as `#`, `**` and `[]()` stay literal text, with subtle theme-aware colours
    only. All token colours pass WCAG contrast checks in both themes.
  - The source font size is a separate setting (Preferences, 11–22 px) from the reading
    font.
- **Exact source in Markdown mode.** Opening a file in Visual mode and switching to Markdown
  shows the original text byte for byte; before, it showed TOAST's re-serialised version
  (`- item` became `* item`). Save, snapshots, export and Copy Markdown source also use the
  exact source while nothing has been edited in Visual mode.
- **Line numbers** are on by default and can be toggled. **Word wrap** can be turned off;
  long lines then scroll horizontally. A **current-line highlight** is drawn behind the text,
  never inside the document.
- **Split view:**
  - The panes scroll **independently** by default. Synchronised scrolling is optional
    (Preferences or the command palette).
  - When the editor area is narrow, Split stacks source above preview instead of squeezing
    each into half. This is based on the editor's own width, not the window's.
  - A layout bug was fixed: in a short stacked pane, the 40vh bottom padding made the source
    box overflow onto the preview.
- **Source editing commands:**
  - Heading 1–6 (**Ctrl+Shift+1…6**), Insert link (**Ctrl+Shift+K**) and Insert code block
    (**Ctrl+Shift+C**).
  - **Copy Markdown source** in the command palette, which uses the Windows clipboard.
  - Tab/Shift+Tab indentation and list continuation on Enter were already provided by the
    editor.
- **Tests.** The UI suite grew from 75 to 100 checks, including a ~7,700-word document; the
  proposal's tests 1–7 are covered. The Windows self-test adds checks for exact source,
  uniform font and the bundled font.
- **Not done, on purpose:**
  - Auto-pairing of brackets and markers. It risks inserting characters you didn't type.
  - Indent guides, visible-whitespace markers and a minimap. These need editor decorations
    that would add complexity for little writing benefit.
  - All of these are possible later with a TOAST plugin. Switching to CodeMirror or Monaco
    isn't needed for them.

### Going back to 1.1.0 (or 1.0.0)

Same as below. The 1.1.0 code is on the branch **`noormd-1.1.0-baseline`** (commit `1d99c14`),
and the 1.0.0 code is on `noormd-1.0.0-baseline`. Settings stay compatible: older versions
ignore the new `sourceFontSize`, `lineNumbers`, `wordWrap` and `syncScroll` keys.

## 1.1.0 — UX enhancements

Based on *NoorMD UX Enhancement Ideas*, phases A–C plus small items from priority 3. Tabs
(phase D) are proposed in [docs/TABS_DESIGN.md](docs/TABS_DESIGN.md) and not yet implemented.

- **Line width presets.** Comfortable (≈ 800 px), Wide (≈ 1100 px) and Full width (with 24–40 px
  side padding).
  - Reachable from a **↔ button** in the editor bar, **Ctrl+Shift+W**, the command palette and
    Preferences.
  - Applies in Focus mode and Markdown mode, and is remembered.
  - In 1.0.0 these presets existed only in Preferences, which made Focus mode look narrow.
- **Spellcheck on/off.** Use **Ctrl+Shift+Y**, the command palette or Preferences.
  - Turning it off also hides underlines that were already drawn. The text is never changed.
  - The language follows the languages installed in Windows. Use the right-click menu →
    "Add to dictionary" for project terms.
- **Compact layout.** Use **Ctrl+Shift+L**, the new **Compact** button or Preferences. The
  header is smaller and the sidebar stays. This is separate from Focus mode.
- **Fix: AltGr letters on Polish and other layouts.** AltGr+S (ś) was swallowed by the
  Ctrl+Alt+S snapshot shortcut. AltGr keystrokes are never treated as shortcuts now.
- The **keyboard-shortcut list** (F1) is searchable. It is generated from the command list,
  so it cannot drift from the real shortcuts.
- **About** shows the build date and a link to the source repository. There is also a new
  palette command, "Open the NoorMD repository".
- The **split divider** has a visible grip, and the Compact button shows when it is active.
- **Tests.** The UI suite went from 55 to 75 checks. The Windows self-test now covers width
  presets in Focus mode, the compact layout and spellcheck. There is a new unit test for
  settings compatibility between 1.0.0 and 1.1.0.

### Going back to 1.0.0

Nothing in 1.1.0 changes how documents, recovery drafts, snapshots or backups are stored.

1. **Run 1.0.0 again.** Keep the 1.0.0 zip, or rebuild it from the branch
   **`noormd-1.0.0-baseline`** (commit `18ee008`). Run its `NoorMD.exe` instead. Settings stay
   compatible both ways: 1.0.0 ignores the new `spellcheck` and `compact` keys in
   `%APPDATA%\NoorMD\settings.json`.
2. **Return the code to 1.0.0:**
   - `git checkout noormd-1.0.0-baseline` to look at it or build it.
   - `git revert <1.1.0 commits>` on your branch to undo the changes while keeping history.
   - `git reset --hard noormd-1.0.0-baseline` on a branch you own to throw them away.

## 1.0.0

First release: WPF + WebView2 desktop app implementing the NoorMD Desktop brief. See
[docs/TEST_REPORT.md](docs/TEST_REPORT.md).
