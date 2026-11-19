# NoorMD 3.0: design

**Status:** draft for discussion (19 Nov 2026). Nothing here is built yet. NoorMD 2.0 (the current app,
`2.0.0-preview.N`) stays as it is and keeps working while 3.0 grows beside it.

**Why "3.0":** the current app already calls itself 2.0. 3.0 is the rework of the whole user interface,
and of how benches are built and talk to each other. The functions mostly exist already; 3.0 gives them one
home, one look and one way of working.

---

## 1. What we want

1. **A proper app window.** Our own title bar (the app's name, what is on screen, minimise / maximise /
   close), a main menu that follows the bench you are in, and no more going "back to Markdown" to get
   anywhere.
2. **Benches as tabs.** One tab per bench; each bench holds its own documents inside it.
3. **Real docking.** Panels dragged and dropped anywhere, split, tabbed together, and **floated out into
   their own windows** (two monitors).
4. **Benches that talk.** One "Send to…" system: each bench says what it can give and take, so a picture
   goes from the pixel editor to painting to texturing to a mesh without anyone wiring each pair by hand.
5. **Modular benches.** Each bench is its own DLL; its generator is a separate core DLL with no user
   interface, usable by other apps (NoorEngine's editor, a command-line tool, a build script).
6. **One design language.** The same controls, spacing, menus and words everywhere. Themes stay (all nine).
7. **NoorEngine first for game assets**, through Noor Interchange, with Godot, Unity, Unreal and plain
   glTF as the other targets.

**Decided so far (19 Nov):**
- **Density per bench, one design language.** Code (and later the pro tools: Mesh, Forge, Sprite…) uses the
  compact density (mock-up direction B); writing and media (Markdown, Vault, Music, Video, Gallery, Calendar)
  use the roomy one (direction C). Same controls, menus, colours and words; only spacing and sizes change.
  You can override it per bench in Settings.
- **The menus:** File, Edit, View, then the bench's own menus, then **Tools** and **Window**, then Help.
- **Send to** as a panel and a card strip (section 5.3).
- **NoorCode** keeps its name: in NoorMD it's the outside code editor, in NoorEngine the built-in one.
- **The logo:** the N with a page and picture / video / brush tiles (`references/logo-concept.png`), redrawn
  as an SVG.
- **Players beside your work:** the music player and the video player are panels like any other, so they can
  sit at the side of any bench; the video player also pops out into its own window. The mini player stays
  in the status bar. Music, Video, Gallery and Calendar are roomy.
- **Any panel in any bench:** a panel from an open bench can be docked anywhere (the music queue beside your
  notes, the Gallery's pictures beside NoorCode) and keeps working there.
- **Bench tabs only for open benches:** a bench gets a tab when you open it and loses it when you close it.
- **Starting up:** NoorMD comes back to your last session. A **Home** screen (recent files and vaults, open a
  bench, what's new) shows on the first launch and when no bench is open, and opens any time from the logo
  menu, Window › Home or Ctrl+Shift+H.
- **Where the main menu goes is a setting:** in the title bar (the default, saving a row) or on its own row
  under it. Easy to switch in Settings › Appearance, so you can try both.
- **Two copies of a bench are allowed** (two Vaults side by side, two NoorCode projects). They share one main
  menu: the menu belongs to the bench, and its commands act on the copy you're working in (the focused one).
  Their tabs say which is which ("Vault · Ideas", "Vault · Engine").
- **Home also shows** today's calendar, what's playing, and your NoorEngine projects.
- **Stage 1 order** (section 2.1).
- **Ideas that can wait go to the inbox**, not into the current stage (Sage says so when it happens).
- **The generators live in this repository**, each as core + command-line tool + bench (section 3.2).
- Your concept pictures are in `references/` as mood boards (they are AI-drawn, so their details are
  illustrations, not specs).

**Not goals for now:** porting every bench at once; changing what works mechanically (the Markdown editor,
the Vault, the players, the Gallery are good as they are inside); a look copied from NoorEditor (we take
inspiration from its concept art, but NoorMD has its own face).

## 2. Stages

| Stage | What | Done when |
| --- | --- | --- |
| **0. Design** (now) | This document; clickable mock-ups of the layout; you choose a direction | You say "yes, build that" |
| **1. The new home** | The shell (window, title bar, menus, bench tabs, docking, floating windows, status bar, command palette, settings, themes, languages), the bench contract and the exchange; the benches **Markdown, Vault, Music, Video, Radio, Gallery, Calendar**, and the new **NoorCode** | You use 3.0 for writing, notes, media and code every day instead of 2.0 |
| **2. The generators** | The heavy asset benches, reworked one at a time (trees, rocks and plants first; then NoorBuildings, NoorShipyard, NoorMechs, NoorRoads, NoorVegetation…), each as core + command-line tool + bench; **one export pipeline** with NoorEngine (Noor Interchange) first | A bench's export imports into NoorEngine with no conversion |
| **3. The rest** | The editing benches (Mesh, Forge, Material, Sprite, Photo, Ink, Sound, Sequencer, Voice…), as needed | — |

### 2.1 Stage 1, step by step

1. **The title bar spike.** A small WPF window with no Windows frame, a page drawing the title bar, dragging,
   Aero Snap, double-click to maximise, and Windows 11's snap layouts on the maximise button. It's the one
   risky part, so it's proven first, on its own. You try it on your PC.
   **Done (19 Nov): all 14 checks passed** on Windows 11 (build 26300), with two monitors: dragging (WebView2's
   `app-region`), snapping to edges, double-click, the window menu, **snap layouts on maximise**, the buttons
   and their hover colours, Win+arrows, resizing from every edge, maximising without spilling over, moving
   between monitors, theme colours on the buttons, the taskbar, shadow and rounded corners
   ([`spikes/NoorMD3.TitleBar`](../../spikes/NoorMD3.TitleBar)). One note: the page's scrollbars stayed the
   default ones; the design system themes them (section 6.2).
2. **The shell,** proven with two benches, **Markdown and Music**: bench tabs, the main menu following the
   bench, docking (any panel anywhere), floating windows on two monitors, the status bar with the mini
   player, the command palette, Home, settings and themes, the bench contract and the exchange.
   - **3.0.1 (done):** the window, the main menu following the bench, bench tabs, resizable sides, Home, Settings,
     the contract, Noor.UI and the Sandbox.
   - **3.0.2 (done):** docking. Panels in groups of tabs on each side; drag a panel by its tab (drop zones show
     where it lands: a side, before or after a group, or into a group as a tab; Esc cancels); right-click a tab to
     move it from the keyboard; resizable edges between groups; any panel of any bench docks anywhere (its bench
     opens quietly to run it, and closing that bench takes its panels with it); layouts kept per bench. A second
     demo bench, the Clock, gives panels worth borrowing.
   - **3.0.3 (done):** your first round of notes: bench tabs reorder by dragging (and Ctrl+Shift+PageUp /
     PageDown), focus mode gives the page the whole window, the slim themed scrollbars everywhere, no "Clock ·
     Clock".
   - **3.0.4 (done):** floating windows. Drag a panel's tab out of the window (or "Float in its own window") and it
     opens in a small window of its own, for a second monitor. The window runs the panel from its own copy of the
     bench's web module; the bench's events pass between windows (so a floating Statistics keeps counting, a
     floating Stopwatch keeps time), and so do theme changes. Closing it, or ⇲ Dock back, puts the panel back where
     it came from. Floating windows come back after a restart, and onto a monitor that's there if theirs isn't.
     Window › **Get over here!** (Ctrl+Shift+G) pulls every floating panel back at once, with ropes and grappling
     hooks (an easter egg; skipped when the system asks for less motion).
   - **3.0.5 (done): the Markdown bench**, the first real one. NoorMD 2.0's editor (Visual, Markdown, side by
     side; Visual never quietly rewrites a file), documents as tabs inside the bench, an Outline panel, File /
     Format / Insert menus. Its C# side (Markdown.Core, no interface) owns the files: it opens only what you picked
     (or picked once before: the recent list), saves back in the file's own encoding and line endings, and notices
     another program's changes before replacing them. Unsaved work is a draft that outlives the app, so closing
     NoorMD (or a crash) loses nothing: the documents come back with their changes. The shell learned what this
     needed: a bench's File / Edit / View items join the shell's menus, a bench can claim Ctrl+W (Ctrl+Shift+W
     still closes the bench), a bench may hold its closing for unsaved work, and file dialogs for benches.
   - **Before Music: everything 2.0's Markdown editor had**, in the new bench ("all features from 2.0, just in
     this new container"). The checklist (✓ = in):
     - **3.0.6 (done), editing comfort:** ✓ the formatting bar (2.0's icons; paragraph style picker, Ctrl+Shift+0–6)
       · ✓ find and replace (Ctrl+F / Ctrl+H) · ✓ indent / outdent · ✓ text size (Ctrl+= / Ctrl+- / Ctrl+0) and line
       width (comfortable / wide / full) · ✓ the Markdown view's line numbers, word wrap, synced scrolling and a
       draggable divider in side by side · ✓ spellcheck on/off · ✓ naming a new document before its first save · ✓
       files dropped on the window open (and files NoorMD is opened with: a bench says which file types it opens,
       the shell hands them over) · ✓ the document tab's menu (close others, close to the right, name, copy the
       path, show in Explorer, reload from disk) · ✓ noticing a file changed on disk when you come back to it.
       (Pictures from disk inside the editor: 2.0 didn't have it, so it went to the ideas inbox.)
     - **3.0.7 (done), writing tools and sharing:** ✓ the Statistics panel with the writing goal · ✓ the History
       panel: snapshots (take, look, bring back, delete; one is taken before bringing another back or reloading
       over unsaved work) · ✓ export to HTML (sanitised, no scripts) and PDF, print, copy the Markdown · ✓ Markdown
       settings (font, which view new documents open in, line width, goal, the bar, spellcheck) · ✓ the welcome
       document (first start, and Help). The shell learned printing (a print area benches fill) and Tools / Help
       items from benches.
     - **With the Music bench:** music beside your notes, the mini player.
   - **No Ctrl+Alt shortcuts**: Ctrl+Alt is AltGr on many keyboards (ą ę ś ł ń ż on Polish ones), so the shell never
     treats it as a shortcut.
   - **Modular, always** (your rule): every module is its own Core (no interface, reusable) and Bench, so each can
     grow without breaking the others. Benches are polished and upgraded as they move in.
   - **Next: the Vault bench** (before Music). Vault.Core: a vault is a folder you pick; an index of notes,
     headings, wiki links, tags and front matter; a watcher; full-text search; the link graph; links updated when
     a note is renamed; Pack & Share. Vault.Bench: its tab is the vault's home (overview, search, recent notes);
     its panels (Explorer, Backlinks, Tags, Search) dock into the Markdown bench or float; notes open as Markdown
     tabs, and the Markdown bench learns wiki links ([[ suggests notes, Ctrl+click follows). Everything 2.0's
     Vault had, plus:
     - **a vault wizard** (your idea): the popular structures to start from (PARA, Zettelkasten, Johnny.Decimal,
       a journal, a game design vault, a writer's vault, a project vault…), each with its folders and starter
       templates;
     - **templates** per vault; **a quick switcher** (Ctrl+P); **daily notes**; **unlinked mentions**;
       **properties** (front matter as a small form, and filtering by it);
     - **a visual map** of the vault (your bonus idea): notes and their links as a graph you can explore.
     - **3.0.8 (done), the Vault, part one:** ✓ Vault.Core (2.0's index, links, tags, presets, packaging, copied;
       a watched vault session; renames and moves that rewrite links) · ✓ the wizard (Start simple, Popular
       structures: PARA, Zettelkasten, Johnny.Decimal, Journal; For creators: Writer, Worldbuilding, Streamer, Game
       development), with a live preview of the folders and starter notes · ✓ the vault's home (search, recently
       changed notes, tags, recent vaults) · ✓ panels: Explorer (folders, filter, new / rename / move / delete to the
       Recycle Bin, drag to move), Backlinks, Tags, Search, docking into the Markdown bench · ✓ the Markdown bench
       learns wiki links ([[ suggests notes, Ctrl+click follows or offers to make the note) · ✓ open documents follow
       renamed notes, documents without unsaved changes reload by themselves when a rename rewrites their links,
       and close when deleted. The shell learned: benches pick folders, hand files to the bench that opens them,
       announce moved files; pages share topics (the document on screen, unsaved ones); one NoorMD at a time (a
       second start hands its files over); files dropped anywhere on the window open.
     - **3.0.9 (done), the Vault, part two (a nice, convenient tool):** ✓ all of the list below. Also: a shared quick
       picker in Noor.UI (the command palette will use it too), Ctrl+P in the Markdown bench (open documents, vault
       notes, recent files), links inside code examples no longer count. The visual map of the vault and a **local map**
       panel (the note on screen and its neighbours) · the quick switcher (Ctrl+P) · daily notes · templates (the
       wizard's Templates folder; {{title}}, {{date}}) · **hover preview** (Ctrl over a [[link]]) · **links to
       headings** ([[Note#Heading]], suggested after #) · **aliases** (aliases: in a note's properties) · **callouts**
       (> [!tip], > [!warning] drawn as coloured boxes).
     - **3.0.10 (done), the Vault, part three:** ✓ properties (front matter as a small form, a Markdown panel) ·
       ✓ unlinked mentions ("Link it") · ✓ Pack & Share (also for an AI assistant) · ✓ search operators (tag:,
       path:, file:, "exact", -skip, key:value) · ✓ bookmarks · ✓ outgoing links beside backlinks · ✓ extract a
       selection to a new note · ✓ random note. Also: a careful look through the vault code that came from 2.0,
       and 15 bugs fixed (see the devlog).
     - Ideas borrowed from Obsidian are ideas only (its code isn't open, and we don't take code anyway). Not taken:
       publishing and syncing to anyone's server (a vault is a plain folder: sync it with whatever you like).
   - **The Music bench**, in two parts (like the Vault). Music.Core is 2.0's NoorMD.Media music code, copied (and
     reviewed: 16 bugs found, the library and player ones fixed in part one).
     - **3.0.12 (done), part one:** ✓ the library as the bench's view (sections: all, favourite / keep / maybe /
       skip, not marked, missing; playlists; folders; search; sort by column; a long list drawn as it scrolls) ·
       ✓ the player in the main window, so music keeps playing in any bench or window; every page talks to it
       through events · ✓ panels: Now playing, Up next, Sound (10-band equalizer, presets, limiter, loudness
       normalisation, measuring) · ✓ the mini player in the status bar · ✓ marks (keys 0–4), playlists (make, add,
       drag tracks onto one, rename, delete) · ✓ media keys and Windows' media overlay · ✓ the session (queue,
       volume, sound) kept · ✓ audio streamed with ranges through the bench contract (IBenchMedia).
     - **3.0.13, part two:** editing tags and renaming with undo (and the review's three tag-editing bugs: a
       half-saved edit journaled as failed, an undo marked done when restoring tags failed, multi-value tags cut to
       one on undo), the Batch Organizer, smart collections, M3U import and export, artwork (show, save).
   - Then the mini player's big brother (a bigger player window), Send to between benches, the command palette.
   - **3.0.11 (done): a whole bench in a window of its own.** Drag its tab down out of the tab row (or right-click ›
     Move to a new window, or Window › Move … to a new window). The bench's view and docked panels go there, with its
     documents (unsaved work as drafts, never-saved tabs with their text); its tab stays in the main window with ↗
     and takes you there. ⇱ Back to the main window, closing the window, or right-click › Bring it back return it as a
     tab, as it was. The main window keeps the bench's module running quietly (no view), so its panels docked in
     other benches keep working; a bench window runs the modules of panels docked in it the same way. Each window
     writes only its own part of the settings (settings.patch); benches in windows open again at the next start.
3. **The rest of stage 1:** Vault, Video, Radio, Gallery, Calendar.
4. **NoorCode.**

Each step is released for you to try. **Versions are plain numbers:** 3.0.1, 3.0.2, 3.0.3… (each release bumps
the last number); **3.1.0** when stage 1 is done, **3.2.0** when stage 2 is, and so on.

Until a bench moves to 3.0, you use it in 2.0. Both apps can be installed side by side.

## 3. Architecture

### 3.1 The pieces

```text
┌──────────────────────────────── NoorMD 3.0 (the app) ─────────────────────────────────┐
│ Shell (WPF exe)                                                                       │
│  windows · title bar · WebView2 per window · layouts and docking · menus · shortcuts  │
│  settings · themes · languages · bench loader · exchange ("Send to") · jobs · logging │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Noor.Contracts.dll   the bench contract (versioned) + exchange types                  │
│ Noor.UI (web)        the design system: tokens, controls, menus, dock, icons          │
├──────────────┬──────────────┬──────────────┬──────────────┬───────────────────────────┤
│ Markdown     │ Vault        │ Music        │ NoorCode     │ …                         │
│ .Bench.dll   │ .Bench.dll   │ .Bench.dll   │ .Bench.dll   │                           │
│ (+ .Core)    │ (+ .Core)    │ (+ .Core)    │              │                           │
└──────────────┴──────────────┴──────────────┴──────────────┴───────────────────────────┘

Outside the app, for the same generators:
  NoorForm.Core.dll  ←  NoorForm.Cli (noorform generate oak.recipe.json --for noorengine --out …)
                     ←  NoorEngine's editor or tools (.NET), build scripts, other apps
```

- **Shell:** the only exe. It owns the windows, the layout, the menus, the settings and the loading of
  benches. It knows nothing about trees or songs.
- **Noor.Contracts:** what a bench must provide and what the shell offers it (section 4). It has a version.
  A bench says which version it was built for.
- **Noor.UI:** the shared web design system: every bench's interface is built from it, which is what makes
  them look and behave alike.
- **A bench = two DLLs:**
  - **`X.Core.dll`:** the work, with no user interface: generators, file formats, exporters, the library.
    Plain .NET. Unit-tested on its own. Usable by any .NET program.
  - **`X.Bench.dll`:** the bench in NoorMD: its web interface (HTML, JS, CSS packed inside the DLL), its
    host commands, its manifest. Depends on its core and on the contracts, never on another bench.
  - **`X.Cli` (generators):** a small command-line tool over the core, so NoorEngine, scripts and other tools
    can generate assets without NoorMD. It writes Noor Interchange files.
- **The existing code is reused, not rewritten.** `NoorMD.Core` and `NoorMD.Media` already keep most of the
  real work apart from the window (the music library, the Vault, the calendar, the tree and rock
  builders, the GLB writer). They are split along those lines into per-bench cores as each bench moves.

### 3.2 Where the code lives

Everything stays in this repository, beside 2.0 (which isn't touched):

```text
src/
  NoorMD/ NoorMD.Core/ NoorMD.Media/      2.0, as it is
  NoorMD3/                                3.0's shell (the exe)
  Noor.Contracts/                         the bench contract and exchange types
  Noor.UI/                                the web design system (tokens, controls, dock, menus, icons)
  Benches/
    Markdown/   Markdown.Core/  Markdown.Bench/
    Vault/      Vault.Core/     Vault.Bench/
    Music/ Video/ Radio/ Gallery/ Calendar/ NoorCode/
    NoorForm/   NoorForm.Core/  NoorForm.Bench/  NoorForm.Cli/      stage 2
    NoorBuildings/ NoorShipyard/ NoorMechs/ NoorRoads/ NoorVegetation/   each the same three parts
tests/
  per core: unit tests · per bench: UI tests against a mock shell · the shell's own · "bench rules" for all
```

Cores move out of `NoorMD.Core` / `NoorMD.Media` by copying what a bench needs into its own core (2.0 keeps
its copy until it's retired), so 3.0 work can never break 2.0.

### 3.3 Loading benches

- **Step 1 (stage 1):** every bench is its own project and DLL, built and shipped with the app. The shell
  finds them through their manifests. That gives the clean structure with no plugin risks.
- **Step 2 (once the contract has settled):** benches can also be loaded from a `Benches` folder: each in
  its own `AssemblyLoadContext` (so two benches can use different versions of a library), loaded only if
  you approved it (or it is signed with your key), with its contract version checked. A bench that fails to
  load is reported, and the rest of the app carries on.

A DLL can do anything your account can, so 3.0 never loads an unknown bench silently.

### 3.4 Windows and floating panels

- The main window and every floating window are WPF windows, each with **its own WebView2**, all in one
  WebView2 environment (one browser process, shared storage).
- **Panels are rebuilt from state, not moved.** A web page's elements can't travel between two WebViews, so
  when a panel is dragged into another window, the shell asks the bench for its state, closes it in one
  window and opens it in the other with that state. This is a rule for every bench: **a panel must be able
  to save and restore itself** (scroll, selection, what is open). A playing video resumes where it was.
- The layout (which panels, where, which window, which monitor) is saved per bench, and per monitor setup:
  unplug the second screen and its windows come back to the first instead of vanishing.

### 3.5 The title bar

- The window has no Windows frame (`WindowChrome` with the caption area at zero); the page draws the title
  bar. WebView2's non-client region support (`app-region: drag`) makes it draggable, with Aero Snap and a
  double-click to maximise.
- **Windows 11 snap layouts** (hovering over maximise) need the maximise button to answer the system's hit
  test as `HTMAXBUTTON`; the shell does that natively over the page's button. It is the one fiddly part, and
  it is tested on its own first (a spike) before the rest is built on it.
- Content: the app icon (its menu: Home, About), the **main menu** (in the title bar by default, or on its own
  row: a setting), the active
  bench and document ("Vault · Ideas/NoorRoads.md"), a small "now playing" when music or radio plays, and
  minimise / maximise / close.

## 4. The bench contract

Each `X.Bench.dll` has a manifest and implements the contract. What a bench provides:

| | |
| --- | --- |
| **Identity** | id (`noor.music`), name, icon, version, contract version, short description |
| **Documents** | the file types it opens (`.md`, `.noorform`…), "new document" kinds, how a document saves, autosaves and recovers, and whether it is dirty |
| **Menus** | its menu items (File, Edit, View and its own menus), each a **command** with an id, a label, a shortcut and a "can run now" check. The shell merges them with the app's own items |
| **Panels** | the panels it can show (id, title, icon, where they go by default) and its default layout |
| **Commands** | everything it can do, by id: menus, shortcuts, the command palette and tests all go through them |
| **Exchange** | what it can **give** and **take** (section 5) |
| **Settings** | its settings, shown in the app's settings window under its name |
| **Texts** | its strings, translated with the app's own system |
| **Status** | a line for the status bar, background jobs with progress and Cancel |

What the shell provides to a bench: opening and saving files (with the same safety rules as today: only
files you picked or the bench's own), the exchange, jobs, notifications, settings storage, the theme, the
language, logging, and the shared players.

**Rules every bench follows** (they are checked by a shared test):

- Every action is a command, in a menu, with its shortcut shown, and searchable in the command palette.
- Undo and redo for every change; dirty state shown in its tab; nothing lost on close or crash.
- Same words for the same things (Export…, Send to…, Settings, Reset), same controls, same menus.
- Panels save and restore their state (for floating windows and restarts).
- Long jobs show progress and can be cancelled; nothing freezes the window.

## 5. Benches that talk: the exchange

### 5.1 How it works

- Every bench declares **gives** and **takes**, as exchange types. "Send to…" (in the File menu, the
  right-click menus and as a button where it matters) lists only the benches that can take what you have.
- Sending opens (or switches to) that bench with the thing in it. Some sends are **links** that stay live
  (a texture set sent to a material, updated when the painting changes), most are **copies**.
- Dragging something from one bench onto another bench's tab or panel uses the same system.
- The shell keeps a short history of sends ("Sent 'Oak_01' to NoorMesh, 2 min ago").

### 5.2 Exchange types

| Type | What it is | Example givers → takers |
| --- | --- | --- |
| `text.markdown`, `text.plain` | text | NoorCode, Calendar → Markdown |
| `code` (+ language) | a script or source file | Markdown (a code block) → NoorCode |
| `image` | a picture (PNG, with its size and colour space) | Gallery, Photo, Sprite → Photo, Sprite, Forge |
| `image.sheet` | frames or a sprite sheet | Sprite → Gallery, engine export |
| `palette` | a list of colours | Sprite, Photo, Gallery → Sprite, Ink, Material |
| `texture.set` | PBR maps (base colour, normal, ORM, height…) | Material, Forge → Mesh, Form, Forge, engine export |
| `material` | a material (`.noormat`-compatible) | Material → Mesh, Forge, engine export |
| `model` | a GLB with its Noor Interchange manifest; `kind` from the Interchange list (`vegetation.tree`, `vegetation.plant`, `rock`, `building`, `ship`, `prop`…) | Form, Buildings, Shipyard, Mechs → Mesh, Forge, engine export |
| `sound`, `music` | audio | Sound, Sequencer, Voice → Music, video, engine export |
| `video` | a clip | Video → Gallery |
| `calendar.entry` | a date with a title | Markdown → Calendar |

Model kinds use **the same names as Noor Interchange**, so what moves between benches and what goes to the
engine is described one way. A new kind is added to the Interchange spec first.

### 5.3 How it looks

- **The Send to panel** (dockable like any other): what is selected, and the benches that can take it, each
  with what it will do ("NoorMesh: create a 3D model", "NoorEngine: export (Interchange)", "Vault: save a
  copy"). Benches still in 2.0 are listed greyed out, so you know they exist.
- **The send strip:** choosing Send to… (from the File menu, a right-click or Ctrl+Shift+S… shortcut to be
  chosen) slides a strip up from the bottom: the thing on the left, big cards for the targets on the right.
  Enter or a click sends; Esc closes it.
- See `references/concept-1-send-panel.png` and `references/concept-3-send-strip.png`.

## 6. The layout and the design language

### 6.1 The window

```text
┌ ◆ File Edit View Bench Help   Vault · Ideas/NoorRoads.md     ♪ Yeah — Song  ─ □ ✕ ┐  title bar + main menu
├ [Markdown] [Vault ●] [Music] [Gallery] [Code] [+]                                  ┤  bench tabs
├────────┬───────────────────────────────────────────────────────────┬───────────────┤
│ panel  │ [NoorRoads.md ●] [Mechs.md] [+]                            │ panel         │  documents of the bench
│ panel  │                                                            │ panel         │
│        │   the document                                             │               │
│        │                                                            │               │
├────────┴───────────────────────────────────────────────────────────┴───────────────┤
│ the bench's status                                        ⟳ 1 job · ♪ ▶ 1:12 · 🔔 2  │  status bar
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **Main menu:** File, Edit, View · the bench's own menus (Markdown: Format, Insert; Music: Playback,
  Library; NoorCode: Selection, Go, Run…) · **Tools** (Settings, Benches…, Command palette, Keyboard
  shortcuts) · **Window** (layouts: save, switch, reset; floating windows and which monitor; Focus mode) ·
  Help.
- **Bench tabs:** one per open bench (a closed bench has no tab), in the order you like; `+` opens a bench you don't have open
  (a list with icons and what each does). Ctrl+Tab cycles documents, Ctrl+1…9 jump to benches.
- **Document tabs** inside the bench, with the dirty mark; a bench that has a single view (Music, Radio,
  Calendar) has none.
- **Panels** dock left, right and bottom, tabbed together or split, and **any panel of an open bench can go
  into any bench** (it keeps working: the queue still plays, the file tree still opens files);
  **resizable**: drag the edge between two panels, or between a panel and the document, to give either more
  room; double-click an edge to reset it; sizes are saved with the bench's layout; each has a small header with its icon
  tabs, like the concept art. Dragging a panel shows drop zones (left / right / top / bottom / as a tab /
  out into its own window).
- **Status bar:** the bench's own status on the left; app-wide things on the right: background jobs, the
  mini player (music, radio and a video's sound keep playing whichever bench you're in), notifications.
- **Players beside your work:** Music's *Player* panel (cover, controls, queue) and Video's *Player* panel
  can be docked into any bench; the video player pops out into its own always-on-top window (⧉), as
  today. Closing the panel doesn't stop the music: the mini player in the status bar keeps it.
- **Home:** recent files, vaults and folders; open a bench; pinned items; what's new. Shown on the first
  launch and when nothing is open; otherwise one click away (the logo menu, Window › Home, Ctrl+Shift+H).
- **Command palette** (Ctrl+Shift+P): every command of every open bench, by name.
- **Focus mode** (F11) hides the panels and tabs, as today.

### 6.2 The design language

- **Density:** two sets of sizes, *compact* and *roomy*, chosen by each bench (section 1), so a code
  editor can be dense and a note can breathe in the same app.
- **Tokens:** a 4 px spacing grid; three control sizes (24, 28, 32 px); radii (4, 8, 12); one type scale
  (11, 12, 13, 15, 18, 24); elevation by surface colour, not heavy shadows.
- **Themes:** the nine themes carry over (Dark, Light, Nocturne, Ember, Evergreen, Rosewood, Parchment,
  Glacier, Contrast). Their colours become the tokens' values (`--bg`, `--panel`, `--surface`,
  `--surface2`, `--border`, `--text`, `--muted`, `--accent`), plus a few new ones (hover, selection, danger,
  warning, success).
- **Controls:** one set: button (primary, normal, quiet, icon), field, number field with drag, slider,
  toggle, select, segmented choice, colour well, list and tree rows, tabs, menu, dialog, toast, progress,
  empty state. Each with hover, pressed, focus (always visible from the keyboard) and disabled states.
- **Icons:** one line-icon set for everything (an open-licensed set such as Lucide, ISC, after a licence
  check), plus our own for the benches.
- **Words:** one vocabulary list (Export…, Send to…, Open…, Save as…, Settings, Reset to default…), and
  the same menu order everywhere (File, Edit, View, then the bench's menus, then Help).
- **Scrollbars:** themed and slim everywhere (`scrollbar-color`, and the scrollbar styling WebView2 supports),
  following the theme, light and dark (`color-scheme`). Found in the title bar test.
- **Motion:** short and purposeful (a panel sliding in, a drop zone appearing); nothing that slows work.

## 7. Stage 1 benches

| Bench | From 2.0 | What changes |
| --- | --- | --- |
| **Markdown** | the editor (Visual, Markdown, Split), tabs, recovery, export | Documents as the bench's tabs; the outline, find and properties as panels |
| **Vault** | vaults, search, backlinks, wiki links, Pack & Share | The file tree, backlinks, tags and search as panels around the open notes |
| **Music** | library, playlists, organiser, EQ, loudness | The library as the main view; queue, EQ and details as panels; the mini player everywhere |
| **Video** | library, player, notes, subtitles | The player as the main view; the library and notes as panels; Rescan in sight |
| **Radio** | stations, titles | One view; plays through the shared mini player |
| **Gallery** | albums, slideshows, picture tools | Thumbnails as the main view; albums and details as panels; "Send to" for pictures |
| **Calendar** | entries, repeats, holidays, reminders | Month, week and agenda views; reminders through the app's notifications |
| **NoorCode** (new) | — | Below |

### 7.1 NoorCode

- **The editor:** Monaco (the editor inside VS Code, MIT licence), with tabs, split views, the minimap,
  multiple cursors, find and replace (in a file and across a folder), go to line and symbol, bracket
  matching, folding.
- **Languages:** C#, HTML, CSS, JavaScript, TypeScript, Python, Lua and JSON are built into Monaco. **Luau**
  (Lua with types) and **GDScript** get grammars of our own.
- **Folders:** open a folder as a project (the file tree as a panel), with Git status shown on files.
- **Later:** running a script, completion and errors through language servers (C# and Luau first, for
  NoorEngine), a terminal panel.
- It's an outside editor for any project, and also NoorEngine's: open an engine project folder and its
  Lua and C# scripts are there.

## 8. Export (stage 2, outlined)

- **One export pipeline** for every generator bench: a target (NoorEngine, Godot, Unity, Unreal, glTF),
  a profile (sizes, LODs, texture formats, collision), a preview of the files it will write.
- **NoorEngine is the first target**, through Noor Interchange v0.4: `<name>.glb` + `<name>.lod<n>.glb`,
  `<name>.noor.json` with a stable id, `<name>.recipe.json`, `extras.noor` blocks, collision flags, JPEG
  for opaque maps and smaller maps on far levels. NoorEngine has written the hand-off for it
  (`NoorEngine/docs/interchange/NOORMD_NOORENGINE_EXPORT.md`), and it already names fixes we'll make on the
  way: **grass exported as `kind: tree`**, the oak's trunk standing over a metre from its pivot, textures
  copied into every level, and root knees that look like spikes from afar.
- Godot, Unity and Unreal keep what they get today (import scripts, LOD naming, helpers), on the same pipeline.

## 9. Living beside 2.0

- 3.0 is a separate exe with its own settings folder, so the two never fight over settings or layouts.
- Both read your same files (Vault folders, music and video folders, notes). The media library index
  (2.0's database) is **not** shared for writing: 3.0 keeps its own index of the same folders. Two apps
  writing one index is how libraries get corrupted.
- Tests as today: each core has unit tests; each bench has UI tests against a mock shell; the shell has its
  own (windows, docking, floating, title bar); a shared "bench rules" test runs over every bench.

## 10. Open questions

None right now. New ones go here as they come up.
