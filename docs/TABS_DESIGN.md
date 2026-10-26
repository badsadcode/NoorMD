# Proposal: document tabs (phase D)

> **Status:** built in 2.0.0-preview.2, along the lines below (one editor per tab, bridge v2,
> per-tab recovery). See CHANGELOG.md and BRIDGE.md for what shipped.

**Status:** design for review. Nothing is implemented yet. The UX ideas document asks for
tabs to be "a deliberate architectural change", so this proposal should be agreed before any
code is written.

## Today

A window holds one document. The single-document assumption lives in three places:

| Layer | Single-document state |
|---|---|
| Page (`app.js`) | one TOAST UI `editor`, plus `doc`, `gen` / `savedGen` and `mode` |
| Host (`MainWindow`) | one `DocumentSession`, one recovery draft per window (`RecoveryStore`), and `_session.Folder` for image serving |
| Bridge | `doc.*` messages carry no document id |

## Proposed design

### 1. One editor instance per tab, kept alive while the tab exists

Each tab gets its own hidden `toastui.Editor`. The alternative, one editor whose content is
swapped on every tab switch, was rejected:

- **Undo history** is per editor (ProseMirror history). Swapping content would destroy it.
- **Selection and scroll position** are kept for free.
- Calling `setMarkdown` on each switch would run the Visual round-trip again and could
  normalize Markdown. The fidelity rules would be harder to guarantee.

Cost: about 1–3 MB of memory per open tab. A soft limit of 20 tabs, with a warning, is
plenty for a writing app.

### 2. Per-document state moves into a `DocumentTab` object

Each tab holds its own `{ id, editor, path, title, gen, savedGen, mode, banner, encoding, eol }`.
`getState()` becomes `getState(tabId)`. `flush()` returns every dirty tab.

On the host, `DocumentSession` becomes `Dictionary<tabId, DocumentSession>`, and each
session gets:

- its own recovery draft file, `<windowSession>-<tabId>.json`, written under the window's
  lock
- its own snapshot key
- its own file stamp

Image serving uses the folder of the **active** tab's document.

### 3. Bridge v2

All `doc.*`, `snapshots.*` and `export.*` messages gain a `tabId`. New messages are
`tab.open`, `tab.close`, `tab.activate` and `tab.reorder`. `BridgeProtocol.Version` becomes
2. Both sides are bumped together, so a page and a host from different versions never talk
to each other.

### 4. User experience

- A tab strip goes above the card head. Each tab shows the title, a `●` when unsaved and a
  close button, and the strip scrolls horizontally when there are many tabs.
- **Keys:** Ctrl+Tab / Ctrl+Shift+Tab to switch, Ctrl+W to close (it prompts when the tab is
  unsaved), Ctrl+1–9 to jump to a tab, middle-click to close.
- **Change to existing keys:** Ctrl+1/2/3 currently switch editor modes. Because Ctrl+1–9
  would jump to tabs, modes would move to **Ctrl+Alt+1/2/3**. Ctrl+Alt is safe here: the
  AltGr guard covers digits on Polish keyboards. *This is a user-visible change that needs
  sign-off.*
- **Opening and closing:** Open, drag and drop, recent files and linked `.md` files open in
  a new tab. If the file is already open, NoorMD switches to that tab instead.
- **Closing the window:** one dialog lists every unsaved tab, with Save all, Don't save and
  Cancel. It replaces one prompt per tab.
- **Session restore:** NoorMD reopens the tabs that were open last time, in the same order
  and with the same active tab.
- **New window** stays available.

### 5. Recovery

- After a crash, the startup dialog lists every orphaned tab draft. Restoring opens each
  draft in its own tab.
- 1.0 and 1.1 recovery drafts (`<sessionId>.json`) are still read. The id parser accepts
  both formats.

### 6. Tests that must pass before release

- **UI (Playwright):** edit two files; switch tabs 20 times; verify text, undo, selection and
  dirty state per tab. Save one; close the other while dirty and check the prompt. Ctrl+W on
  a clean tab. Reorder tabs.
- **Self-test (Windows):** open two files and edit both. Kill the WebView renderer. Reload and
  check that both drafts are restored into separate tabs and that neither tab's text appears
  in the other.
- **Unit:** multi-draft `RecoveryStore` (ids, locking, orphan detection, compatibility with
  1.0 draft names).

### Estimate and risk

This touches most of `app.js`, the bridge and `MainWindow.*`. It is about 2–3× the size of
the 1.1 UX changes. It should be its own release (2.0) with its own baseline branch, like
`noormd-1.0.0-baseline`. A workspace folder tree (phase E) should build on tabs, not come
before them.

## Questions for you

1. Move the mode shortcuts to Ctrl+Alt+1/2/3 so Ctrl+1–9 can select tabs? Or keep Ctrl+1/2/3
   for modes and use Alt+1–9 for tabs?
2. Should Open (Ctrl+O) always open a new tab, or replace the current tab when it is an
   untouched empty document?
3. Is a 20-tab soft limit acceptable?
