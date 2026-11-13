# 📓 The NoorMD Devlog

*How a Markdown editor became a studio with twenty benches in nineteen days, told by the ones who were there:
one human with an endless supply of "oh, and also…", and one AI that kept saying "sure!".*

> **TL;DR** — 274 commits, 161 preview releases, ~90,000 lines of C# and JavaScript, ~27,000 lines of tests,
> 2,251 checks in the UI suite alone, five languages, and exactly one tree that was accidentally a bush.

---

## The numbers, because numbers are fun

| | |
| --- | --- |
| First commit | 26 October 2026 — *"NoorMD Desktop: WPF + WebView2 Markdown studio"* |
| Latest release | 2.0.0-preview.161 (13 November 2026) |
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

Less sprawl, more polish: one bench at a time, finished properly before the next. See
[docs/POLISH_PLAN.md](docs/POLISH_PLAN.md). The new ideas go into [docs/IDEAS_INBOX.md](docs/IDEAS_INBOX.md)
instead of straight into the code (we'll try 😇).

*To be continued…*
