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
2. **The shell,** proven with two benches, **Markdown and Music**: bench tabs, the main menu following the
   bench, docking (any panel anywhere), floating windows on two monitors, the status bar with the mini
   player, the command palette, Home, settings and themes, the bench contract and the exchange.
3. **The rest of stage 1:** Vault, Video, Radio, Gallery, Calendar.
4. **NoorCode.**

Each step is released as a preview of 3.0 for you to try, like the 2.0 previews.

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
  into any bench** (it keeps working: the queue still plays, the file tree still opens files); each has a small header with its icon
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
