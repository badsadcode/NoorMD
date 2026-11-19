# NoorMD 3.0 spike: the title bar

Stage 1, step 1 of [NoorMD 3.0](../../docs/noormd3/DESIGN.md#21-stage-1-step-by-step): before the 3.0 shell is
built on a title bar of its own, this small program checks that one behaves like a real Windows title bar.
It doesn't touch NoorMD 2.0 and isn't part of its solution.

**How it works**
- A WPF window with no Windows frame (`WindowChrome`, no caption), filled by a WebView2 page that draws the
  title bar.
- **Dragging, double-click and the window menu:** the page marks its title bar `app-region: drag`, and WebView2
  (`IsNonClientRegionSupportEnabled`) treats it as the caption. A fallback (the page asks, the window sends
  itself `WM_NCLBUTTONDOWN` / `HTCAPTION`) can be switched on in the page, to compare.
- **The window buttons are native,** so Windows 11 shows snap layouts on maximise: a hole is cut in the web
  view (`SetWindowRgn`) where they are, the window draws them there, and answers `WM_NCHITTEST` with
  `HTMINBUTTON` / `HTMAXBUTTON` / `HTCLOSE`; hover and clicks come through the non-client mouse messages. They
  take the page's theme colours.
- **Resizing:** a 5 px border around the page belongs to the window (WindowChrome's resize border); maximised,
  the content is pulled in by the overhang so nothing spills onto another monitor.
- Per-monitor DPI v2; Windows 11 rounded corners (`DWMWA_WINDOW_CORNER_PREFERENCE`).

**Build:** `dotnet build spikes/NoorMD3.TitleBar -c Release` (builds anywhere; runs on Windows 10/11 with the
WebView2 runtime). The page has a checklist and "Copy the results".
