# 📓 The NoorMD Devlog

*How a Markdown editor became a studio with twenty benches in nineteen days, told by the ones who were there:
one human with an endless supply of "oh, and also…", and one AI that kept saying "sure!".*

> **TL;DR** — 274 commits, 162 preview releases, ~90,000 lines of C# and JavaScript, ~27,000 lines of tests,
> 2,251 checks in the UI suite alone, five languages, and exactly one tree that was accidentally a bush.

---

## The numbers, because numbers are fun

| | |
| --- | --- |
| First commit | 26 October 2026 — *"NoorMD Desktop: WPF + WebView2 Markdown studio"* |
| Latest release | NoorMD 3.0.4 (19 November 2026), and 2.0.0-preview.162 for everything not in 3.0 yet |
| Busiest day | 28 October: **67 commits** (Sound Bench, Texture Bench, the whole Sequencer, a calendar and the first trees) |
| Favourite hour to commit | 1 pm, apparently |
| Benches | 20-ish, depending on how you count Voice Forge |
| Tests | 2,251 UI checks · 631 media tests · 318 core tests · Godot and the Khronos glTF validator on CI |
| Languages | English, Polish, German, French, Spanish (and your own, if you write one) |
| Trees that were inside out | at least one (the low-poly tubes faced inwards — fixed in an afternoon) |

---

## Day 1 — 26 October: "It's just a Markdown editor"

It started innocently. A WPF window, a WebView2 inside it, a Markdown editor with a Visual mode and a source mode.
By lunch it was **NoorMD 1.1** (width presets, spellcheck), by tea time **1.2** (a proper source editor), and then
someone said *"themes would be nice"* and suddenly there were **nine colour themes** with a live preview.

That should have been the end of the day. Instead:

- **Creator's Bench** appeared: a media library core with tags, safe renames and undo, and the first **Music Bench**.
  Version **2.0.0-preview.1** was born.
- **Tabs.** Proper multi-document tabs, each with its own session and recovery drafts.
- **A menu bar** and a customizable toolbar.
- **Vaults** — open a folder as a workspace, with search, backlinks and `[[wiki links]]`. Then **Pack & Share** to
  zip a part of it up safely.
- **NoorSketch**, a little sketchpad in its own window.
- The music player grew shuffle, a **Batch Organizer** (dry-run renames, batch undo), EQ and loudness.
- A **Video Bench**.
- A **Stream Desk**: an OBS "Now Playing" overlay, a credits roll with effects, a supporters list.
- **Mic Guard**: one switch for the Windows microphone *and* OBS.

Nine preview releases. On day one. Nobody slept, metaphorically.

## Day 2 — 27 October: The panels learn to dock

- Stream Desk got its own window; Mic Guard learned to listen to mouse buttons.
- **Find in files**, links that survive renames, notes that pause the video.
- **Docks and layouts** for the whole window.
- **Apps Hub** for launching your programs and games, **voice notes**, a **Gallery** with slideshows set to music.
- A full audit and its fixes (preview.17), single-instance mode, panels as tabs in the middle.
- **The Affinity Incident**: Windows handed us some thumbnails upside down. We flipped them. They were still upside
  down. We read them through `GetDIBits` instead, and peace returned.
- **NoorRadio** — internet radio with song titles through a little loopback relay.
- And at the very end of the day: the first lines of the **Sound Bench** engine. Procedural sound. Noise beds, gusts,
  synth voices, seamless loops. You can probably guess what happened next.

## Day 3 — 28 October: The day of 67 commits 🔥

The Sound Bench went from "a panel" to "a studio" before breakfast: effect racks, a **modulation matrix** (LFOs,
envelopes, knobs, routes), samples stretched and grained, meters and a spectrogram, buses and stems,
**resonators**, **convolution reverb**, and a **Map**.

Then, without pausing for breath:

- **Texture Bench** (now NoorMaterial): tileable PBR materials, photos to materials, painting, masks, tiles,
  hexagons, planks, rain and crumble erosion, Blender-style nodes (Musgrave! Voronoi distances!) and batch maps.
- **NoorSequencer**, all three stages in one day: a song grid, a piano roll with scale lock, chords with moods,
  progressions, adaptive game-music layers, loop checks, OGG export.
- **Connected benches**: sounds and songs flow into the music library, recipes into the Vault.
- **NoorCalendar** with repeats, birthdays and reminders.
- And then, very late: the **Asset Bench** (now NoorForm). A mesh model, a GLB writer checked by the Khronos
  validator, implicit surfaces, a quadric simplifier, and **trees**. Leaf tufts! Mushroom trees! Crystal trees!
  Billboards drawn by a little CPU renderer! A Godot import plugin tested in headless Godot on CI!

There was also a **stack overflow on Windows** (a `stackalloc` inside a loop — classic), and a commit
optimistically titled *"WIP (untested): sharp pixels…"*. It was then tested. It was fine. Mostly.

## Day 4 — 29 October: Rocks, forges and sprites

- Willows stopped being *"ropes on sticks"* and became a leafy dome with curtains (an actual commit message).
- Trees learned to keep their leaves full at a distance, and to let light through.
- **Rocks**: stones, boulders, outcrops, scree, arches, stacked stones, moss, edge wear and a faceted, hand-cut look.
- **The calendar** got holidays, stream schedules and a vacation planner.
- **The Sequencer** started borrowing ideas from LMMS (ideas only, never code): ghost notes, a keyboard piano, acid
  bass, a kick drum synth, a mixer, and SoundFont instruments.
- **NoorForge**: texture a 3D model with layers and smart masks, paint on it, stencils, drips, decals, high-poly
  bakes, export presets per engine.
- **NoorSprite**: a pixel art and animation bench, which in one afternoon went through tilemaps, Godot TileSets,
  in-betweens, RotSprite, indexed colour, symmetry, layer groups, hitboxes and Unity exports.

## Day 5 — 30 October: Everything becomes an app

- NoorSprite kept going: bones, normal maps, a lit view, bitmap fonts, sharing as GIF, turn-arounds, isometric
  tiles, sprite stacking, timelapses. Sprites can now **play inside your notes**.
- **Benches as apps**: press F11 and each bench gets its own menu bar, like a real program.
- **One family of names**: everything became Noor-something — NoorForm, NoorMaterial, NoorSound, NoorMusic…
- **Five languages** appeared in a single day.
- **NoorPhoto**: a layered photo and painting editor with filters, layer styles, a pen, text, and Krita-inspired
  painting (ideas only — Krita is GPL and we respect that).
- **NoorInk**: a vector (SVG) editor, with tracing, stroke to path, grow and shrink.

## Days 6–8 — 31 October to 2 November: Voices, paintings and Blender in a box

- NoorGallery's albums became a proper folder tree.
- NoorMaterial got finishing touches on every map and learned to make any picture seamless.
- **Voice Forge** inside NoorSound: voices with no recordings at all (and gibberish languages), then voices from
  recordings, with performance transfer.
- NoorForge learned to **paint pixels** onto models, got a brush bar, a look-dev light and relief that shows.
- And then the big one: **NoorMesh**. The rule: *"Blender, stripped down to its modelling. Blender's keys. Z up."*
  In one day it got a geometry kernel, Object and Edit Mode, files, gizmos, inset, loop cut and slide, bridge,
  snapping, **bevel**, **knife** (rewritten so its points stick to the surface like Blender's), proportional
  editing, mirror, auto merge, the **3D cursor**, join and separate, editing several objects at once, **UV
  unwrapping** (LSCM, Smart UV Project, packing, a UV editor), materials and textures.
  Somewhere in there the hand cursor became an arrow, because you couldn't see what you were clicking.

## Days 11–17 — 5 to 11 November: Plants, lots of plants 🌿

- NoorMesh models go straight to NoorForge for texturing; NoorForge got folders, per-channel blending, colour
  adjustments and mask filters (ideas from TextureCraft — ideas only, no code).
- NoorMaterial gave every brick, tile and plank its own colour, and learned to blend materials **by height** (moss
  in the cracks, stones poking through the dirt). Materials now have **inputs** you can tweak straight from NoorForge.
- An *"urgent need"* arrived: **bushes and grass**. NoorForm got 20 bushes, then 28 grass tufts (blades, seed heads,
  flowers, pampas plumes, cattails, ferns). The bushes first came out looking like tiny trees on a stick. We gave
  them more stems. They became bushes.
- *"Can we have a cheaper version?"* — **21 low-poly card plants**: a few crossed planes in a cross, a star, a #, a
  fan or a dome. A whole bush in a few dozen triangles.
- *"…and a pixel art version? 😃 Sorry."* — **13 pixel-art plants**. The first try turned grass into green bricks;
  the second try drew the blades fat enough to survive being 32 pixels tall.

## Day 19 — 13 November: The video player gets a menu

The human deleted a video, couldn't find Rescan (it was hiding in the Folders window — noted for later), then
asked for audio tracks in a right-click menu. The video player now has picture effects, flips and turns, a sound
boost and night mode, subtitle styling and timing, A–B loops, a sleep timer, and saving a frame as a picture.

A **subtitle editor** went on the list for later. So did **NoorArchitect** (a procedural Quake-style map
generator) and a still-unnamed **procedural spaceship generator**, both waiting for their handoffs.

---

## Day 19, later — Groundwork ✅

Before polishing anything, we swept the workshop floor:

- **The CI script that never reported back** turned out to have been knocking on a door it wasn't allowed through
  (the session's network can't call GitHub's API directly). CI itself had been happily green all along, except
  for one run where Ubuntu's package mirror took a nap; the browser install now tries three times.
- **The README** caught up with three weeks of benches (NoorMesh was still "planned"!).
- **A bench audit** now opens every bench and counts controls with no name or tooltip. The result: zero, across
  seventeen benches and about 900 controls, apart from one shy filter chip in NoorMusic. Three benches are
  missing a Help menu. Noted.

Next up: **NoorMesh**, the first real polish pass.

## Day 19, even later — NoorMesh, polished ✅

The first real polish pass. We walked through NoorMesh as a newcomer and timed everything on meshes up to 40,000
faces. Almost everything was quick, except **unwrapping**: 15 seconds for 10,000 faces, with the whole bench frozen.
A packed solver, a smarter starting guess and a preconditioner (a word that sounds like hair care but isn't) brought it
down to **0.4 seconds**, with exactly the same UVs. The human called it *"a humongous upgrade"*. We'll take it.

The rest of the list:

- A **Help menu**, with a "first five minutes" guide and a "for Blender users" page.
- A **Select menu**, because Blender has one and Blender people look for it.
- **H, Shift+H and Alt+H** now hide parts of a mesh in Edit Mode (it used to say "comes later").
- **Subdivide**, with a smooth version that turns a cube into something that would like to be a ball.
- **Alt+O** does what it does in Blender (proportional editing, connected only), so auto merge gave up its key.
- The **3D cursor** is saved with the scene.
- The word **"preview"** is gone. NoorMesh has grown up.

Writing the tests found a real bug: pressing Esc to close a right-click menu in focus mode also threw you out of
focus mode. It's fixed. That's what tests are for.

Next up: **NoorForge**.

*Encore, two days later:* the human said a status bar with Blender's counts "would be awesome 😃", so NoorMesh's
status bar now keeps count — "4/8 vertices · 4/12 edges · 1/6 faces" — in five languages. Adding it found that about
240 texts across the app never got translated, because they end in a number. That one went into the inbox. The full test run also kept tripping over NoorPhoto's text box: typing straight after
dragging one could miss it, because it only took the keyboard a moment later. It takes it at once now.

---

# Part two: NoorMD 3.0 🏗️

## Day 25 — 19 November: "We need to talk" 😬

Every developer fears that sentence. This time it was the human saying it to the AI, and then: *"Don't change
anything yet."*

What followed was not a breakup but a renovation. Twenty benches had grown up in twenty different weeks, and it
showed. Each had its own idea of where buttons go, and getting from one to another meant going back to Markdown
first, like changing trains at a single station for every journey. The verdict: **the insides are good, the house
needs a rebuild.** One window, benches as tabs, panels you can drag anywhere (even onto your second monitor), and
benches that talk to each other ("Send to…").

The name took a minute. "NoorMD 2.0" was the obvious choice, until someone pointed out the current app already calls
itself 2.0.0-preview.162. *"Hm, then 3.0 😉"*. And while we were at it, "3.0.0-preview.N" was voted out in favour
of plain numbers: 3.0.1, 3.0.2, 3.0.3…

Things decided over one long, cheerful afternoon:

- **Two looks, one family:** code gets a compact, dense look; writing and media get a roomy, calm one.
- **The music player can sit beside your notes**, the video player can pop out, and any panel can visit any bench.
- **Every bench becomes its own building block**, so one day the tree generator can work inside NoorEngine too.
  The plans for NoorBuildings, NoorShipyard, NoorMechs, NoorRoads and NoorVegetation fit right in.
- **The main menu goes in the title bar** — or on its own row. The human couldn't decide (*"Oh decisions decisions 😃
  HOW TO LIVE?!?"*), so it's a setting.
- **Ideas that can wait go to the inbox.** The human asked to be stopped when they start throwing ideas.
  The AI has been told to say so. It hasn't had to yet.

There were mock-ups, three of them, in nine themes. The human brought AI-drawn concept pictures and a new logo: an N
with a page, a picture, a play button and a brush. The AI declared them mood boards, because one of them had invented
a menu item that doesn't exist.

## Day 25, later — The title bar test ✅

Before building a house, you check the ground. 3.0 draws its own title bar instead of using Windows' one, and that's
the kind of thing that can go wrong in fifty small ways: windows that won't snap to the screen edge, maximise buttons
that ignore Windows 11's snap layouts, windows that spill onto the second monitor.

So a tiny test program went out with a checklist of fourteen things to try. The result came back: **fourteen out of
fourteen**, first try, on two monitors. The only complaint was that the scrollbar didn't match the theme. It was
noted, solemnly, in the design rules.

## Day 25, evening — NoorMD 3.0.1, the skeleton

The first real piece of 3.0: the new window, bench tabs, the main menu that changes with the bench, side panels you
can resize by dragging their edges, Home, and Settings (theme, where the menu goes, compact or roomy per bench).

There's only one bench in it so far, and it's a small one: the **Sandbox**, a scratchpad whose whole job is to prove
that a bench can live in its own building block and still talk to the rest. You type, and the counting happens in a
different part of the program. It works. The Sandbox will be retired with honours when the real benches move in.

## Day 25, night — 3.0.2: panels that move ✋

Panels can now be picked up by their tabs and dropped anywhere: on a side, above or below another panel, or right
into it as a tab. While you drag, the window shows where it'll land; Esc changes your mind for you.

And the big one: **any panel can visit any bench.** To prove it there's a second tiny bench, a **Clock**, whose
stopwatch can sit under your writing in the Sandbox and keep ticking. It's the same stopwatch everywhere: start it in
one bench, and it's running in the other.

The tests found a real bug on the way. Open one menu and then flick to the next with the arrow keys quickly enough,
and the first menu left a little "close on click" helper behind. Later it would close the next menu just before
your click landed, like a waiter whisking your plate away mid-bite. It's been spoken to.

*The next morning:* the human tried it, wrote "Hello Mr. Sage! Thank you for your work! You're awesome!" into the
Sandbox (which counted it: ten words, one minute's read), and then found three things: bench tabs that wouldn't move,
a focus mode that hid the panels but kept their chairs warm, and a scrollbar wearing last season's arrows. 3.0.3 fixed
all three.

## Day 25, late — 3.0.4: the party part 🥳

"Part three sounds almost like party", said the human, and so it was. Panels can now leave home: drag one out of
the window and it gets a little window of its own, ready for a second monitor. It isn't a copy that drifts off on
its own, either. The floating Statistics keeps counting your words, the floating Stopwatch keeps the same time as
the one at home, and when you change the theme, the floating windows change with it.

Then came the idea of the day: a button that brings them all back, called **"Get over here!"**. Five minutes later came the
follow-up: *"can it also draw small ropes with grappling hooks? 😛"* It can. Press Ctrl+Shift+G and a rope flies
out of each panel's spot towards its floating window, hooks it, and reels it back in, the panel riding home along
the rope. It plays for less than a second, and politely sits out if your computer is set to reduce motion.

Building it, a safety check stopped one of the AI's own commands because it *might* have deleted something. It
didn't. But it's nice to know someone's watching the AI too.

## Day 26 — 3.0.5: the first real bench ✍️

The Sandbox did its job. It proved that a bench can live in its own DLL and talk to the shell, and that its panels can
go on holiday to another monitor. Now the first real bench has moved in: **Markdown**, the one this whole app started as.

Moving it was a bit like moving house with a very fussy grandfather clock. The editor came over from 2.0 in one
piece, along with all its old quirks and the rules it lives by. The most important rule is that **looking at a file
never changes it**. Open a note in Visual view, glance at it, switch back, and your Markdown is exactly as you left
it, down to the last asterisk. A file with raw HTML in it opens in Markdown view with a little note explaining why,
so nothing gets "helpfully" rewritten.

New in the new house: documents are tabs inside the bench, there's an Outline panel you can dock anywhere (or float
onto that second monitor), and **unsaved work survives closing the app**. Close NoorMD with three half-written
notes, open it tomorrow, and there they are, still unsaved and still yours. If another program changes a file
while you're editing it, the bench asks before it replaces anything.

The fun bug of the day: the editor had quietly taken over Ctrl+S (strikethrough!) and Ctrl+O (numbered list!).
Press Save and your sentence got a line through it. The tests caught it before anyone else did, and the bench
now gets those keys first.

## Day 26, later — 3.0.6: "we miss helper buttons" 🔘

The human opened 3.0.5, looked around, and asked the obvious question: *where are the buttons?* The Markdown bench
had moved in without its toolbar, a bit like moving house and leaving the light switches behind. Then came the
follow-up that set the plan for the next few days: *"i want all features from 2.0, just in this new container 😉"*.

So now there's a checklist, and 3.0.6 ticks off its first part. The formatting bar is back, with the same icons
2.0 had (the human sent a screenshot, just in case we'd forgotten what they looked like). Find and replace is back.
So are bigger and smaller text, line widths, line numbers, and a divider in side-by-side view you can drag.

There are new things too. Drop a file on the window and it opens. Right-click a tab and you get the usual
suspects: close the others, show in Explorer, reload. Name a new document before you save it. And if another
program changes your file while you're away, NoorMD tells you when you come back, instead of quietly saving over
it later.

The bug of the day: the table button did nothing at all if you had some text selected. Toast UI just shrugged.
Now the cursor hops to the end of your selection first, and the table appears.

## Day 26, evening — 3.0.7: the rest of the old editor 🧳

The last boxes from 2.0's editor are unpacked. There's a **Statistics** panel with a writing goal: set 750 words,
watch the bar fill up, and get a tiny 🎉 when you make it. There's a **History** panel that keeps snapshots of your
document, so a brave rewrite is never a scary one. Bring an old version back and the one you had becomes a snapshot
too, because regret goes both ways.

Export to HTML and PDF is back, and so is printing. If a Markdown file hides a sneaky `<script>` tag, it gets
thrown out on the way, so the exported page can't run anything. There's a settings dialog with fonts (Inter from
2.0 included), and a welcome document that greets you on the very first start, then politely leaves when you close it.

The fun moment: a test kept typing into the *start* of a heading instead of the end. The editor wasn't wrong, the
test was just too quick for it. No human types that fast, so the test now waits a moment, like a polite person
would.

Meanwhile the plan grew a little: **the Vault comes next**, before Music. It gets a wizard to set up a vault in a
popular style (PARA, Zettelkasten, a game design vault…) and, as a bonus, a map of how your notes link together.

## Day 27 — 3.0.8: the Vault moves in 🗄️

A vault is just a folder of notes that know about each other. 2.0 had one, but it lived inside the editor like a
lodger in the spare room. In 3.0 it gets its own bench: its own tab, its own home page, and four panels (Explorer,
Backlinks, Tags, Search) that can move into the Markdown bench and sit right beside whatever you're writing.

The human asked for a wizard, so there's a wizard. Pick a way to organise your notes and it shows you, before
anything happens, exactly which folders and starter notes you'll get. There are the famous ones (PARA, Zettelkasten,
Johnny.Decimal, a journal) and the ones for makers (a writer's vault, worldbuilding, a game design vault). Give it a
name, pick a place, and its Home note opens, ready to go.

Type `[[` in a note and NoorMD suggests the other notes. Ctrl+click a link to jump there. Click a link to a note that
doesn't exist yet and it offers to make it. Rename a note and every link to it is rewritten. Any open note that
links to it updates by itself, and the renamed note's own tab follows along with its new name.

Also new: drop a file anywhere on the window, or on NoorMD's icon, and it opens. If NoorMD is already running, the
second copy quietly hands the file over and gets out of the way. Earlier, dropping a file on the editor did
nothing, because the editor grabbed it first. Now the window catches it first.

The bug of the day: on Windows, a string's "hash" changes every time you start the program. The two copies of
NoorMD would have tried to find each other by two different names, like two friends meeting "at the usual
place" without ever agreeing which place that is. They now agree on a name.

## Day 27, later — 3.0.9: a map, and other conveniences 🗺️

The human asked what we could borrow from Obsidian. The answer was "ideas, plenty; code, none". Then came the
best brief of the project so far: *"I just want a nice, convenient tool."*

So the vault has a **map** now. Your notes are dots, links are lines, and the whole thing jiggles into place like a
nervous constellation. Drag it, zoom it, click a dot to open the note. Notes that are linked but don't exist yet
show up as dotted circles: click one and it gets made. There's also a **local map** that docks beside your writing
and shows just the note you're in and its neighbours.

Hold **Ctrl** over a `[[link]]` and a little preview pops up, so you can peek without leaving. **Ctrl+P** jumps to
any note by typing a bit of its name, or one of its other names (aliases: "Ada" finds "Ada Lovelace"). Links can
point at a heading (`[[Ada Lovelace#Engines]]`) and land you right there. **Today's note** is one click away, and
templates fill in their own title and date. A quote that starts with `> [!warning]` turns into a proper coloured box.

Two bugs got squashed on the way. The map was counting example links in the Home note's tips (the ones written
`like this`, in code) as real links. And the shortcuts for "new note" used Ctrl+Alt, which on a Polish keyboard is
how you type ń. Imagine trying to write "koń" and getting three new notes. NoorMD now never treats Ctrl+Alt as a
shortcut, anywhere.

## Day 28 — 3.0.10: the Vault learns to notice things 🔍

The human said 2.0 was really good and asked for all of it, *"but while you port it look for bugs please."* So
before writing anything new, a reviewer went through every file the vault had brought over from 2.0, and came
back with fifteen bugs. Some were small. Some were the kind you'd only ever meet once, on a very bad day:

- A single odd file (a note saved in a strange text format) stopped the whole vault from being indexed. Search,
  backlinks, links updating on rename: all quietly off, forever. Now the odd file is just skipped.
- A folder *link* inside a vault (a shortcut to somewhere else on the disk) let notes be written outside the vault.
  Now links lead nowhere they shouldn't.
- Renaming one note "tidied up" links to *other* notes, and broke tables that had a `|` in them.
- A heading called `# C#` was read as `# C`. Sorry, C# fans.
- Colours like `#a1b2c3` turned up in the tag list.

All fixed, each with a test so it stays fixed.

Then the fun part. The vault now **notices**: when another note says "Grace Hopper" without linking to her, the
Backlinks panel shows it, with a **Link it** button. It shows where the note links *out* to, as well. There are
**bookmarks** (a star), a **🎲 random note** for rediscovering old ideas, and **Extract to a new note**: select a
paragraph that's grown too big, give it a name, and it moves into a note of its own with a link left behind.

**Properties** are a little form now. No more remembering where the dashes go in front matter: type `status`,
type `draft`, done. And search understands them: `status:draft`, `tag:idea`, `path:Projects`, `"exact words"`,
`-skip`.

Last, **Pack & Share** came over from 2.0: a ZIP of some notes and everything they link to, so nothing's missing
at the other end. One tick makes it a package for an AI assistant, with a short guide to how the notes connect
and a box for what you'd like it to do. Hidden files like passwords stay out, and nothing is ever uploaded.

## Things we learned along the way

- **Ideas, not code.** LMMS, Krita, LibreSprite, TextureCraft and MaterialCraft inspired features. None of their
  code is in here, and that's on purpose.
- **Privacy is a feature.** Secrets live in the Credential Manager, servers only listen on your own machine, the
  microphone only turns on when you press Record, and files are read only when you pick them.
- **Tests or it didn't happen.** Every release runs the whole UI suite. It once caught NoorForge's undo taking back
  a deleted layer together with the slider moves made just before it. It also once insisted that typing was slow, because the
  computer was busy building another release at the time.
- **A tree is a bush if you squint, and a bush is a tree if you don't add enough stems.**

## What's next

**NoorMD 3.0**, piece by piece: the Music bench next (the library and the player, as a panel you can dock anywhere),
then the mini player, Send to and the command palette.
The plan is in [docs/noormd3/DESIGN.md](docs/noormd3/DESIGN.md). 2.0 keeps working beside it in the meantime. The new ideas go into [docs/IDEAS_INBOX.md](docs/IDEAS_INBOX.md)
instead of straight into the code (we'll try 😇).

*To be continued…*
