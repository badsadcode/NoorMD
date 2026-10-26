# Changelog

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
