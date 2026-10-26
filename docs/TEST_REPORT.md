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

- Tabs for several documents in one window. *New window* gives one document per window.
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
