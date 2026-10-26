# NoorMD Desktop — acceptance checklist

## Release blockers
- [ ] Solution compiles without errors on a supported Windows .NET SDK.
- [ ] Release build starts with internet disconnected; editor styles and WYSIWYG work with no CDN.
- [ ] Opening existing Markdown shows the correct text and title; Unicode/Polish diacritics and code fences survive.
- [ ] Editing then Save writes to the correct original path; Save As uses chosen path and extension; New prompts when dirty.
- [ ] Ctrl+S saves exactly once; no browser download side effect.
- [ ] Rapid edits immediately followed by close/open trigger save/recovery rather than losing changes.
- [ ] WYSIWYG -> Markdown -> Split -> WYSIWYG retains content; unsupported syntax behavior is documented.
- [ ] Split shows two usable panes, independent scrolling, resizable divider and correct layout after window resize.
- [ ] Focus Mode shows editable document and uses available width; returns to standard mode reliably.
- [ ] Dark/light works on launch and after re-opening, including toolbar and editor.
- [ ] HTML export and printing are usable; rendered untrusted markup cannot execute scripts.
- [ ] Link clicks inside Markdown cannot trigger unsafe local file/native operations.
- [ ] Run from a release zip on another Windows computer with documented prerequisites.

## Quality and polish
- [ ] Window widths around 1024px, 1440px and 1920px are usable.
- [ ] Windows display scaling at 125% and 150% does not clip controls.
- [ ] Outline tracks headings and navigates reliably.
- [ ] Command palette and search are keyboard accessible.
- [ ] Revision snapshots are recoverable across restarts.
- [ ] A plain `.md` file exported from the prior NoorMD HTML can be opened intact.
- [ ] No telemetry, mandatory account, or web services are required.
- [ ] Third-party licenses are included, and actual unimplemented items are listed.
