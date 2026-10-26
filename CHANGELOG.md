# Changelog

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
