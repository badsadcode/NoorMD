# Sage task: Build NoorMD Desktop (Windows, C#)

## Mission
Turn the supplied `web/NoorMD_Atelier_1.2_FullWidth.html` prototype into a polished, reliable, **standalone Windows desktop Markdown editor**. Deliver a complete, buildable C# repository, not a wrapper that merely launches the file in the user's default browser. Preserve the existing aesthetic: dark refined panels, violet accent, thoughtful typography, modern desktop UI reminiscent of a high-quality ChatGPT-like writing studio. Do not copy OpenAI trademarks/branding. Use the name **NoorMD**.

## Architecture
- Target: Windows 10/11 x64. Prefer **WPF on a current supported .NET LTS SDK + Microsoft.Web.WebView2** for an efficient native C# shell with rich HTML editing. Document chosen SDK and WebView2 Runtime prerequisite.
- WPF owns window, title bar/chrome, native dialogs, file system access, menus, keyboard shortcuts, unsaved-changes coordination and application settings.
- WebView2 displays **bundled local** HTML/CSS/JS editor assets. Load via a virtual host mapping or an equivalently secure local resource scheme, not remote CDNs or `file://` scripts with surprising limitations. Restrict navigation, popups and bridge messages to trusted app content; open external links via explicit native handling and validate all bridge commands and paths.
- Preserve visual design and editor behaviors from supplied HTML, but feel free to refactor into maintainable `wwwroot/index.html`, CSS, and JS modules. Avoid duplicating state between C# and JS.
- Build must not depend on network at **runtime**. Vendor/package editor JavaScript and CSS (TOAST UI Editor or another suitable Markdown↔WYSIWYG engine) locally, including third-party licenses. Internet during build is acceptable.
- Use a clean separation: C# document/file service, JS editor adapter/bridge, HTML view. Do not hardcode file paths. Use cancellation/error handling around file operations.

## Functional priorities (implement in this order)
### P0: Genuine desktop basics
1. Open `.md`/`.markdown`/`.txt` with system Open dialog; save and Save As preserving UTF-8, support drag-and-drop files and recently opened documents.
2. New document, unsaved marker, recoverable autosave, prompt on close or opening another file with unsaved modifications. **No silent data loss**. Honor Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S, Ctrl+Z, Ctrl+Y, Ctrl+F, Ctrl+K; avoid duplicate handling in JS and WPF.
3. Faithful WYSIWYG editing, Markdown-source editing, functional 50/50 split preview, rendering of headings, tables, code fences, lists, links, quotes, checkboxes, images. Changing modes must not mutate or drop Markdown unexpectedly. Consider Markdown round-trip limitations and warn when unsupported syntax is transformed.
4. Fix and preserve full-width Focus Mode, responsive editor height, robust independent pane scrolling. Add a **draggable split divider** (30–70% to 70–30%), and remember divider ratio.
5. Light/dark themes, desktop window controls, responsive layout for normal desktop sizes and HiDPI. Include accessible focus states and usable keyboard-only navigation.
6. Export Markdown/HTML and Print/PDF via Windows print (PDF printer). Keep export paths explicit to users. Provide HTML sanitization and safe export handling.
7. Bundle all web assets locally so disconnected startup, load, editing, save, and export work.

### P1: Studio conveniences
- Document outline/sidebar headings navigation, resizable/collapsible navigation panel, word and character counts, estimated reading time.
- Command palette (Ctrl+K), writing-goal progress, manual version snapshots with visible restore flow and timestamp; store history in app data, not transient WebView localStorage.
- Document-level search and replace; preserve current selection on toolbar actions and use native/system clipboard behavior.
- Recent files, file associations (`.md`) optional, restore last session, clear recovery/recent lists from preferences.
- A tasteful welcome/new document experience, configurable font family/size and comfortable line width including true full-width mode.

### P2: Optional polish after reliability
- Multi-document tabs with per-tab dirty state and distinct recovery drafts.
- Portable zip distribution as well as optional Windows installer, app icon, signed binaries only if signing available. No fake 'signed' claim.
- Optional workspace/folder tree and local Markdown link navigation. No cloud sync required.

## Prototype details / migration risks
- Current HTML references `https://uicdn.toast.com/editor/3.2.2/toastui-editor.min.css`, dark-theme CSS and `toastui-editor-all.min.js`. These MUST be bundled locally in the desktop release.
- Current localStorage keys: `noormd-studio-v1` (one draft incl. title, md, theme); `noormd-studio-atelier-revisions` (snapshots); `noormd-goal` (writing target). Existing drafts inside the user's Firefox `file://` context might not be accessible to WebView2; **do not promise an automatic import**. Provide a migration path: export `.md` from old HTML, then open in desktop. If the HTML prototype has never been exported, tell the user to back it up first.
- Original HTML currently calls browser-side `download` for file save and `window.print` for Print. Replace with proper native C# handling via a minimal documented message interface; do not expose unrestricted file-system access to JS.
- Current theme switch destroys/recreates the editor. Preserve caret/scroll if refactoring; check rapid edits for loss.
- Current prototype replaces the whole draft when opening/new, and uses browser confirm prompts. Native app needs multi-document/recovery semantics to prevent loss.
- Markdown HTML export contains sanitization code, but also needs review for security and reliable external/local image references; don't trust Markdown HTML blindly.
- Separate existing UI implementation from content handling; comment the bridge message schema and version it if helpful.

## Required deliverables
1. `NoorMD.sln` with WPF C# project(s), source code, local editor assets, and included license notices.
2. `README.md`: environment prerequisites, `dotnet restore`, `dotnet build`, run, offline behavior, how storage works, known caveats.
3. A reproducible publish script, e.g. `scripts/publish-win-x64.ps1`, and a release zip containing a runnable `.exe` plus required files. If the WebView2 Runtime is required, document it clearly; consider a managed deployment strategy if appropriate.
4. User-facing shortcuts guide and migration guide from legacy HTML draft.
5. Test report referencing `docs/ACCEPTANCE_CHECKLIST.md`; disclose any incomplete items.

## Engineering / aesthetic guardrails
- Favor boring, maintainable architecture over experimental complexity. No extra backend, telemetry, sign-in, analytics or paid services.
- Use strict encoding, atomic file writes (temporary file + replace/backup), recovery snapshots, and meaningful errors.
- Modern, elegant UI: dark charcoal surfaces, restrained plum/violet accent, crisp icons, tidy spacing, high readability; match prototype but improve usability.
- No dark-mode white flashes on startup; native shell and web content should coordinate theme.
- Respect Windows scaling at 100%, 125%, 150% and above.
- Test on Windows with network disconnected, including clean first launch after installation.

## Suggested Sage starting prompt
> Read the attached brief and inspect the HTML reference. Implement NoorMD Desktop as a complete C# WPF + WebView2 application, using locally bundled Markdown editor assets. First establish stable file IO, WYSIWYG/source/split and offline mode; then add advanced UI. Execute acceptance checks, build and publish win-x64. Make practical decisions independently, document tradeoffs, and don't declare finished if compile/run tests weren't executed.
