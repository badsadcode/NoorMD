# Moving from the NoorMD HTML prototype to NoorMD Desktop

The earlier NoorMD (a single `NoorMD_Atelier_*.html` file opened in a browser) kept your
draft inside **that browser's local storage**. Those keys are `noormd-studio-v1` for the
draft, `noormd-studio-atelier-revisions` for snapshots and `noormd-goal` for the writing
goal. NoorMD Desktop cannot read another browser's storage, so it **does not import
anything automatically**. Moving takes one minute.

## 1. Back up first

Before you change anything, open the old HTML file in the **same browser** you used before
(for example Firefox) and export your text:

1. Open `NoorMD_Atelier_1.2_FullWidth.html` (or whichever version you used).
2. Check that your draft appears.
3. Click **Export .md** (or press Ctrl+S in the old version). The browser downloads
   `<your title>.md`.
4. Keep that file somewhere safe, for example in `Documents`.

Snapshots: the old version can show them under *Revision snapshots*. Restore each one you
care about, then export it as `.md` too. Each restore first saves the current text as a
snapshot, so the old version loses nothing by doing this.

> Do not clear the browser's data or site storage until you have exported and checked your
> files. That would delete the old drafts.

## 2. Open the file in NoorMD Desktop

- Start `NoorMD.exe` and press **Ctrl+O**, or drop the exported `.md` file onto the window.
- Check the title, the text, Polish and other diacritics, and code blocks.
- From now on **Ctrl+S saves to that file**. Nothing is downloaded; it is a normal Windows
  file.

If the exported text contains Markdown the Visual editor cannot represent exactly, NoorMD
opens it in Markdown mode and shows a note. Examples are raw HTML, footnotes and two-space
hard line breaks. Your text is then kept byte for byte.

## 3. Writing goal

Set the goal again with *Writing goal → Set goal* in the sidebar. The old browser value
cannot be read.

## What changed compared with the prototype

| Prototype (HTML) | Desktop |
|---|---|
| One draft in browser storage | Real `.md` files, plus recovery drafts in `%LOCALAPPDATA%\NoorMD\Recovery` |
| "Export .md" downloads a copy | **Save** writes the file in place (atomically, with a backup) |
| Snapshots in browser storage (25) | Snapshots per document in `%LOCALAPPDATA%\NoorMD\Snapshots` (50) |
| Editor loaded from `uicdn.toast.com` | Everything bundled; works offline |
| Browser `confirm()` prompts, opening replaced the draft | Save / Don't save / Cancel prompts; nothing is replaced silently |
| Theme switch rebuilt the editor | Theme switches instantly; caret and scroll stay where they were |
