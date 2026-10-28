# Changelog

## 2.0.0-preview.44 — Texture Bench: every map under control

- **Maps tab:** a card for each map with its picture (click it to look at that map) and its own controls:
  - **Albedo:** brightness, contrast, saturation, hue.
  - **Normal:** relief strength.
  - **Roughness:** low and high parts, variation, contrast, a range it stays within (at least / at most), and
    "write smoothness instead".
  - **Ambient occlusion:** strength, width, depth of the shade.
  - **Metallic:** amount, and a sharpening cut (metal or not).
  - **Height (the map written out):** levels, middle and contrast, without changing the relief.
  - **↺ Reset** undoes a card's adjustments; the material's own settings stay. The Surface tab keeps the colours.
- **Export:** choose which of the target's maps to write (remembered per target), **OpenGL or DirectX normals**
  for any target, **16- or 8-bit height**, and **＋ Packed maps** of your own: any of roughness, smoothness, AO,
  metallic, height, black or white in R, G, B and A (a mask map, ORM in another order…). The path preview follows.
- Disabled buttons now look disabled everywhere in the app.

## 2.0.0-preview.43 — Texture Bench: room to work

- **Drag the bar** between the preview and the controls to give either more room (or use the arrow keys on it;
  double-click goes back to normal).
- **◫ Side by side:** the preview on the left and the controls in their own column on the right, each scrolling on
  its own, with a bar between them to drag. Good on wide screens.
- **☰ Hide the materials list** to give its width to the editor.
- All three are remembered. The zoom buttons stay together in a narrow preview.

## 2.0.0-preview.42 — Export structures, pictures from the Gallery, materials from scratch

- **Where exports go** (Texture Bench and Sound Bench), with a preview of every file's path before anything is written:
  - **Into:** a folder chosen each time (as before), or a **game project**: its folder chosen once, then exports
    go straight into it. Projects are shared by both benches; taking one off the list leaves its folder alone.
  - **Arranged:** Flat (as before), A folder for each, **Godot** (assets/materials/red_bricks/red_bricks_albedo),
    **Unity** (Assets/Materials/RedBricks/Textures/RedBricks_Albedo), **Unreal** (Content/Materials/RedBricks/
    T_RedBricks_BC, _N, _ORM; sounds as A_…), By size or kind, or **your own pattern** for folders and file names
    with tokens: {name} {Name} {name_snake} {name-kebab}, {map} {Map} {MAP}, {size}, {family}, {project}, and {n}
    for a sound's variation.
  - Files are only written inside the folder or project you chose (patterns can't lead out of it, and names
    Windows refuses are cleaned). If any file is already there, you're asked: **Replace** (keeps the game's
    references working), **Keep both** (numbered), or Cancel.
- **Pictures from the Gallery into the Texture Bench:** right-click › Open in › 🧱 Texture Bench, or 🧱 Texture… in
  the info panel: a **new material** from them (the first as its base, the others over it, each repeated in its
  own proportions), or **added over the material you are making**.
- **Materials from scratch:** **＋ New material** starts with one noise layer on a plain grey surface to build on (or
  remove it and start empty); **🎲 Random** makes a different stack of 2–5 layers (shapes, noises, spots,
  scratches, sometimes erosion) with colours that go together, every part of it editable.

## 2.0.0-preview.41 — Texture Bench: paint in NoorSketch, the Gallery and the Vault

Stage 3 of the Texture Bench is complete (docs/TEXTURE_BENCH_PLAN.md).

- **＋ Hand-painted:** paint on a material by hand, as a layer of its recipe, and keep changing the recipe.
  - It opens in **NoorSketch** with the material shown underneath (as it is without the painting; hide it to see
    the painting alone). The painting itself is transparent where you haven't painted.
  - **Strokes carry on across the edges** (a stroke off the right edge comes in at the left), so the material
    still tiles.
  - **Ctrl+S (Apply to material)** puts it straight on the material: the Texture Bench renders again at once.
    **✏ Paint in NoorSketch** on the layer opens it again, with the material as it is now.
  - **Alt+click** picks a colour from the painting or the material under it (in every NoorSketch window).
  - On the material: its colours where it is painted (by how much you choose), its brightness can raise (white)
    or lower (black) the relief, and like any layer it can tint, roughen or make metal where it is painted.
  - Paintings are kept with NoorMD's data, travel with exported recipes (copied beside them), and are found again
    beside a recipe you open.
- **Export:** optionally **show the maps in the Gallery** (the folder is added if no Gallery folder holds it, and
  the maps are tagged "material" and with the material's name), and **keep the recipe in the Vault** (the open
  Vault's Materials folder, with its paintings and a small picture). Both choices are remembered.
- **Vault:** a material recipe (🧱 .noortex.json) opens in the Texture Bench.

## 2.0.0-preview.40 — Texture Bench: shapes and erosion

The first part of stage 3 (docs/TEXTURE_BENCH_PLAN.md).

- **New shapes**, each tiling seamlessly at any size:
  - **Tiles:** a grid with joints, a bevel, round corners and (Uneven) tiles that don't lie quite flat.
  - **Hexagons:** a honeycomb with exact joints; with rows ≈ 1.15 × across they are regular.
  - **Planks:** boards with staggered joints, gaps, warped boards and wood grain of their own.
  - **Spots:** one per grid cell (as many as you choose), scattered or in rows, as domes (pebbles, studs), flat
    discs (rivets, coins), craters or cones, in sizes that can differ.
- **Erosion** reshapes the height built above it, and paints where it acted:
  - **Rain:** thousands of drops run downhill, carrying material from the slopes into the dips (droplet hydraulic
    erosion, after Beyer 2015); the gullies are cut deeper where most water ran. Paint silt or wet streaks there.
  - **Crumbling:** what is steeper than it can stand slides down (thermal erosion), leaving scree slopes.
  - **Wear:** raised edges and corners worn round; paint them lighter, as bare stone or metal.
  - Worked out at 512 × 512, so the preview and every export size agree; kept for a moment, so changing a later
    layer or the surface doesn't wait for it again. Its Levels sliders shape where it paints.
- **New presets:** Hexagon tiles, Eroded rock, Weathered sandstone, Pebbles and Studded floor plate. Wooden planks
  and Floor tiles now use the new shapes.

## 2.0.0-preview.39 — Texture Bench: a better 3D preview

- **Fixed: the material was mirrored on the sphere,** and with it the normal map's up and down, so relief looked
  wrong (bumps lit like dents across the slopes). Every shape is now checked by a test: the picture's right is on
  the right and its top is up.
- **Fixed: the flat map view was stretched** to the shape of its box. Tiles stay square and the pattern carries on
  across the wider side. The thumbnails show the map tiled instead of cropped, and the preview grows with the window.
- **Zoom:** the mouse wheel, + / −, or the − + buttons; ⟲ goes back to the starting view.
- **Lights:** Studio, Sun, Low side light (best for judging relief), Overcast and Night (rim light). Shift+drag
  (or right-drag, or Shift+arrow keys) moves the light; **⟳ Light round** sends it round the shape so every slope
  catches it in turn.
- **Show:** the whole material, **Lighting only** (grey clay: the normals and AO with no colour to hide behind), or a
  single map (albedo, normal, roughness, metallic, AO, height) on the shape.
- **Depth:** parallax occlusion from the height map, so the relief sinks in as you turn the shape (preview only).
- **Rounded cube** shape: flat faces with soft edges and no pinched poles, how materials are usually judged.

## 2.0.0-preview.38 — Sound Bench: listening volume and repeat

- **Listening volume** next to ▶: how loud the preview plays here. It is remembered, and it never changes the sound
  itself, its recipe or what is exported. Matched loudness (A/B) still works on top of it.
- **🔁 Play over and over** (L): repeat the preview while you change things, or play it once. It follows
  "Seamless loop" by itself (a loop repeats, a one-shot plays once) until you switch it.
- **Seam blending in the Texture Bench** now shifts the copy to where the photo matches itself best, so regular
  patterns (bricks, tiles, planks) line up instead of showing doubled lines; a photo also repeats in its own
  proportions (a 4:3 photo: 3 across and 4 down).

## 2.0.0-preview.37 — Texture Bench: photos, painting and masks

The second stage of the Texture Bench (docs/TEXTURE_BENCH_PLAN.md). It is built around creative freedom rather than
presets, using methods from professional texturing tools and research (frequency-separated height as in
Materialize, delighting by dividing out a wide blur, variance-preserving blending for seamless tiling after Heitz &
Neyret and Burley, horizon-based ambient occlusion).

- **Your own photos as layers** (＋ Photo): a photo of a wall, the ground, bark, fabric, or a scan or a painting.
  - **Seamless:** its edges are blended with a half-shifted copy of itself, so it tiles. The blend keeps its
    contrast (variance-preserving) instead of going grey where the copies meet.
  - **Light evened out:** the lighting baked into a photo is divided out (you choose how much, and how large the
    light is), so the albedo isn't brighter on one side.
  - **Height from its detail:** fine, medium and large detail, weighted as you choose (frequency separation).
  - **Height by colour:** pick a colour of the photo (💧 eyedropper) and say it is low or high: mortar sunk
    between bricks, raised joints, dark cracks.
  - **Its colours** go on the surface by any amount, and it repeats a whole number of times across the tile.
  - Like everything else it can be mixed with any other layer: noise, dirt and wear over a photo.
  - Only pictures you picked (or that a recipe you opened names) are read, and a moved recipe finds its pictures
    beside it.
- **Every layer can paint the surface** where it is high: a tint colour, a roughness change and a metallic change.
  Set its strength to 0 to paint without changing the height. The metallic map is now per pixel: rust that is not
  metal on steel that is.
- **Masks from the material itself:**
  - **Height so far:** the tops, the dips, or a band of what the layers above have built. Use it for snow on top,
    moss in the gaps or water in the dips.
  - **Edges & cavities:** curvature, for paint worn off the edges and dirt in the corners.
  - Both have warp, to break their outlines up.
- **Better maps:** normals with a Sobel filter (smoother, less noisy), and horizon-based ambient occlusion: how much
  sky each point sees past the surrounding height, as tall as the normal map shows it.
- **New materials showing what this can do:** Mossy stones, Snowy rock, Wet ground with puddles, Worn painted panels
  (blue paint worn to bare steel at the edges and scratches). Rusty metal is now steel with non-metal rust. 18 in all.

## 2.0.0-preview.36 — Texture Bench: materials for games

The first stage of the Texture Bench (docs/TEXTURE_BENCH_PLAN.md, from the indie benches concept): tileable
materials for game worlds, made from a recipe rather than painted, with their PBR maps.

- **Texture Bench** (Ctrl+Alt+T, in the middle): 14 materials to start from: cobblestones, rough rock, gravel,
  dried mud, forest soil, sand ripples, snow, wooden planks, tree bark, brushed metal, rusty metal, red bricks,
  floor tiles and woven fabric.
- **Seamless at any size:** every map tiles without a seam at 512 to 4096 pixels, and the same material looks
  the same at every size. The same recipe and seed always give the same pixels.
- **Layers** build the height of the material, each blended onto the ones before it (replace, add, subtract,
  multiply, screen, overlay, higher, lower), with its strength, levels and invert:
  - **noise, ridged noise and turbulence**, with detail (octaves) and domain warp (swirl);
  - **cells**: round bumps, raised edges, cracks or flat stones;
  - **wood grain**, **bricks / tiles** (mortar, bevel, row offset, bricks that differ), **weave** and
    **scratches**.
  - Each layer can be hidden, reordered, copied, or given another random version of its own (🎲).
- **Surface:** colour along the height from a colour ramp you edit, colour variation, dirt in the cavities,
  roughness for the low and high parts, metallic (set, never guessed), relief and ambient occlusion.
- **See it:** the material lit on a sphere, cube or plane (drag to turn it), tiled 1 × 1 to 4 × 4, or each map
  flat and tiled (albedo, normal, roughness, AO, height, metallic). Changes show a quick preview at once and the
  full one when you stop.
- **Variation, undo and compare:** 🎲 Variation (V) tries the next seed, Ctrl+Z / Ctrl+Y undo and redo, and
  📌 Pin as A with A/B (B) compares versions.
- **Export** PNG maps at 512, 1024, 2048 or 4096 for:
  - Generic or Godot (one map each);
  - Unity (metallic with smoothness in alpha);
  - Unreal (DirectX normal and an ORM map: occlusion, roughness, metallic).
  Height is 16-bit. The recipe (.noortex.json) is saved with the maps, to make another size or change it later.
  Your own presets are kept like the Sound Bench's.

## 2.0.0-preview.35 — Sound Bench: the Map

The last part of stage 5 of Noor's Sound Bench proposal (docs/concepts/SOUND_BENCH_EVOLUTION.md), as a view of the
sound (an editable patching graph stays a later decision; see the roadmap).

- **Map tab:** the whole sound as connected blocks. Each layer is a row with its effects in order; layers flow into
  the master and its effects, then Out. Buses stand between them, and each send's wire shows its level.
- **What moves what:** controls and modulators stand on the left, with a dashed wire to each block they move. The
  wire names the settings ("pitch, freq, gain") and its tooltip gives the amounts. A checkbox hides them when the
  map gets busy (remembered).
- **At a glance:** blocks say what they are set to (an EQ's type and frequency, a resonator's body and pitch, a
  convolution's space, a bus's level). Muted layers, switched-off effects and connections, and layers not heard
  while another is soloed are dimmed.
- **Click to edit:** clicking a block (or Tab to it and Enter) opens it where it is edited (the layer, the effect
  in its rack, the bus, the control or modulator, the master) and lights it up for a moment.
- Nothing about the sound changes: the map only shows the recipe.

## 2.0.0-preview.34 — Sound Bench: convolution reverb

The third part of stage 5 of Noor's Sound Bench proposal (docs/concepts/SOUND_BENCH_EVOLUTION.md).

- **Convolution reverb,** a new effect for any rack (a layer, a bus or the master), which places the sound inside
  a real space.
  - **Built-in spaces** that work without any recordings: room, hall, church, cave (dark, with distant echoes),
    plate (bright and dense) and tunnel (with flutter echoes). Each one is the same every time.
  - **Your own recording of a space** (*your recording…*): a WAV impulse response, such as a clap, a balloon pop
    or a sine sweep recorded in a stairwell, a car park or a church and turned into its echoes. The silence
    before it is skipped. As with samples, only a file you picked (or that a recipe you opened names) is read,
    and a recipe finds it beside itself after the folder has moved. If it's missing you're told, and the sound
    passes as if the effect were off.
  - **Length** keeps only the first part of the space, **damping** darkens its tail as it goes on (air and
    walls take the highs first), and **pre-delay** moves it away from the sound. Every space passes noise at
    about the level it came in, so switching spaces doesn't jump in level.
  - Fast: the sound and the space are combined with partitioned FFT convolution, left and right sharing each
    FFT, so 30 seconds in a 6-second church takes well under a second.
- **New preset:** *Church bell, far away*, a bell resonator inside the built-in church. 55 presets in all.
- **Fix:** the Normalize checkbox and the Loudness target choice no longer run into each other on the Output tab.
- **Nothing changes for your saved sounds:** a recipe without convolution renders exactly as before.

## 2.0.0-preview.33 — Sound Bench: resonators

The second part of stage 5 of Noor's Sound Bench proposal (docs/concepts/SOUND_BENCH_EVOLUTION.md).

- **Resonator,** a new effect for any rack (a layer, a bus or the master). It rings at a pitch when the sound
  excites it: a burst of noise becomes a plucked string, a click a struck bar, a glass or a bell. Bodies:
  - **string**, a plucked string with all its harmonics;
  - **tube**, a pipe closed at one end, with odd harmonics only (hollow, woody);
  - **metal**, a free bar, bright and inharmonic;
  - **wood**, a few low partials that die quickly;
  - **glass**, a wine glass, few and very pure;
  - **bell**, a church bell's hum, prime, minor third, fifth and nominal;
  - **membrane**, a drum skin.
- Set its **pitch** (exact Hz), how long it **rings** (seconds to fade by 60 dB), **damping** (higher partials
  die sooner, so darker) and **stereo detune** (the right side tuned up to 25 cents away, for width). Every body
  passes noise at about the level it came in, so switching bodies or ring times doesn't jump in level.
- **Its pitch can be modulated** (in octaves), so it can glide, follow a control or play a step pattern.
- **New presets:** *Plucked string* (in a new *Instruments* family), *Glass tap* and *Singing bowl*. 54 presets
  in all.
- **Nothing changes for your saved sounds:** a recipe without resonators renders exactly as before.

## 2.0.0-preview.32 — Sound Bench: buses, sends and stems

The first part of stage 5 of Noor's Sound Bench proposal (docs/concepts/SOUND_BENCH_EVOLUTION.md), chosen as the
most contained part of it.

- **Buses (shared effects):** add a reverb bus, a delay bus or an empty one (up to four), each with its own
  name, level, mute and effects chain. Send several layers to one bus so they share one reverb and sound like
  one place, which separate reverbs on each layer don't do.
- **Sends:** every layer gets a send level for each bus (−60 dB is off). A send is only stored once you move it,
  and removing a bus removes the sends and connections to it.
- **Modulation reaches buses too:** a bus's level and any of its effects can be connected to controls and
  modulators ("Cave (bus) › 1. Reverb › Mix").
- **Stems:** Export can also write each layer on its own, with its share of the buses, in a folder beside the
  file. Normalising and the loudness target are worked out once on the whole sound and applied the same way to
  every stem, so a quiet layer stays quiet and the stems line up with the mix (they add up to it whenever the
  ceiling's limiter isn't working). Muted layers get no stem; with solo on, only the soloed ones do.
- **New preset:** *Footsteps in a stone hall*, hard steps sharing one big reverb on a bus. 51 presets in all.
- **Nothing changes for your saved sounds:** a recipe without buses renders exactly as before.

## 2.0.0-preview.31 — Sound Bench: meters, spectrogram and fair comparisons

Stage 4 of Noor's Sound Bench proposal (docs/concepts/SOUND_BENCH_EVOLUTION.md): see and measure what you hear,
and compare fairly.

- **Meters** under the waveform, for every preview:
  - **loudness** in LUFS (ITU-R BS.1770, as the Music Bench measures it), with the loudest 3 s and 0.4 s in
    its tooltip;
  - **true peak** (between samples, as a converter rebuilds the wave) and the sample peak;
  - **stereo** (mono, narrow, wide, or out of phase) and **brightness** (where the energy sits on average).
- **Plain warnings** when something needs a look: clipping, a true peak above the ceiling, a sound below
  −40 LUFS, left and right cancelling in mono, a DC offset, or a loop that jumps where it wraps.
- **▦ Spectrogram:** see the sound by pitch over time instead of the waveform (marked at 100 Hz, 1 kHz and
  10 kHz). The choice is remembered.
- **Loudness target** (Output tab): bring the finished sound to −14, −16, −18, −20 or −23 LUFS, so a set of
  sounds made with the same target sit together in a game or a video. Off by default.
- **Match loudness** when comparing: the louder of A and B (and the reference) plays quieter, so you hear the
  difference itself and not just "louder". It is on by default and can be switched off.
- **🎧 Reference…:** pick a finished sound (a WAV from a game, a library, or one you like) and compare it with
  yours: its waveform, spectrogram and meters are shown, and B (or the A/B/R button) goes round A, B and R.
  Only the file you picked is read.
- **Built-in one-shots now sit together:** measured with the new meters, the one-shot presets were 17 LU apart
  (Coin pickup at −4 LUFS, a wooden step at −21), and six went over the ceiling between samples. One-shot presets
  and 🎲 generated sounds now use a −16 LUFS target. A very peaky sound (a footstep, a fall) stops at the ceiling
  instead of being squashed, so it may stay a little under. Nothing goes over the ceiling now. Four ambiences that
  sat far from the others (Downpour, Computer fan, Cave drips, Window draft) were evened out.
- **Nothing changes for your saved sounds:** a recipe without a loudness target renders exactly as before.

## 2.0.0-preview.30 — Sound Bench: samples, stretched and as grains

Stage 3 of Noor's Sound Bench proposal (docs/concepts/SOUND_BENCH_EVOLUTION.md): your own recordings become
much more useful.

- **See the part you use:** a sample layer shows its waveform. Drag the edges to trim it, or drag anywhere else
  to choose a new part. The exact times are still in the number boxes.
- **Play as:**
  - **Tape**, as before: changing the pitch changes the speed.
  - **Stretch:** speed and pitch are set apart. Make a creak twice as long without it dropping in pitch, or a
    voice an octave up without it getting shorter. Small overlapping grains are lined up with each other, so
    the result stays steady and clean rather than phasey.
  - **Grains:** a cloud of short pieces from around one spot in the sample, for textures, pads, swarms and
    drones. Set the grain length, grains per second (at random or evenly spaced), where they come from (click
    inside the waveform), how far around, how fast that spot moves through the sample, and a random pitch per
    grain.
- **Seamless sample loops:** a looped sample can crossfade where its end meets its start, instead of starting
  again back to back. This also works while its pitch is being modulated.
- **More to modulate:** a grain cloud's position and its grains per second can be connected to controls and
  modulators. Sweep a "Position" control and the cloud moves through the recording.
- **Recipes travel with their samples:** when you open a recipe, a sample named by a relative path is found next
  to it, and one whose folder has moved is found next to the recipe if a file of that name is there.
- **Fix:** a new sample layer starts with a sensible filter (low-pass at 4 kHz, off until you tick Filter)
  instead of showing 0 Hz.
- **Nothing changes for your existing sounds:** sample layers play as Tape unless you choose otherwise, and
  render exactly as in preview.29. This is tested against renders made by preview.29 itself.

## 2.0.0-preview.29 — Sound Bench: controls, modulators and automation

Stage 2 of Noor's Sound Bench proposal (docs/concepts/SOUND_BENCH_EVOLUTION.md): sounds that move by
themselves, and one control that moves many things at once.

- **Controls of your own:** name a slider (*Motor RPM*, *Rain amount*) and connect it to as many settings as you
  like, each with its own amount and response. It appears first in the Quick tab. The *Engine idle* preset has
  a Motor RPM control: turned up, the motor goes higher, brighter and louder, and the rumble opens up with it.
- **Modulators** move settings over time, in a new **Modulation** tab:
  - **LFO** (sine, triangle, square, saw or random steps) at any speed, with a start phase;
  - **Envelope**: starts at a time you choose, rises, holds, falls and then stays;
  - **Random drift** that jumps or glides;
  - **Steps**: a pattern of up to 16 steps, each with its own slider;
  - **Drawn curve** over the whole sound: click to add a point, drag it, double-click to remove it, or start from
    Rise, Fall, Up and down, or Swell at the end.
- **What can be moved:** a layer's level, pan, pitch, filter and events per second; an effect's mix, an EQ
  band's frequency and boost/cut, and saturation drive; the master level and high cut. Amounts are typed in
  the setting's own unit (dB, semitones, octaves, %) and kept in range. Each connection can be switched off.
- **Tidy by design:** removing a layer, effect, control or modulator removes its connections too, so a new
  layer never inherits old ones. Copied layers get their own id. Undo brings everything back together.
- **The preview hears automation where the export will:** a long sound's preview renders only its first 30
  seconds, but drawn curves still follow the full length.
- **New presets:** *Engine rev* (a drawn throttle curve) and *Rain that comes and goes* (showers that build and
  ease by themselves, with a Rain amount control). 50 presets in all.
- **Nothing changes for your existing sounds:** recipes from earlier previews have no connections and render
  exactly as in preview.28. This is tested against renders made by preview.28 itself.

## 2.0.0-preview.28 — Sound Bench: effects racks and exact values

The first stage of Noor's Sound Bench proposal (docs/concepts/SOUND_BENCH_EVOLUTION.md): effects that work for
every kind of sound, and precise control.

- **Effects racks:** every layer, and the master, has its own chain of effects. Add them from *＋ Add an effect…*,
  switch each on or off (⏻) without losing its settings, change their order (↑ ↓), and set each one's
  **mix** (dry ↔ wet) and **output** level. Up to eight per chain.
  - **EQ band:** peak, low/high shelf, low-pass, high-pass, band-pass or notch, with frequency, width (Q) and
    boost/cut. Stack several for a parametric EQ.
  - **Compressor** (threshold, ratio, attack, release) and **gate** (closes on quiet parts).
  - **Saturation** (soft, hard or wavefold) and a **bit-crusher** (bits and downsampling).
  - **Delay** (time, feedback, darker echoes, ping-pong), **chorus**, **flanger**, **phaser**, and
    **tremolo / auto-pan**.
  - **Reverb** (size, damping, pre-delay) and **stereo width**.
- **Exact values:** every slider has a number box beside it. Type 333 ms, −4.5 dB, 1,250 Hz or 35 % and press
  Enter. Hz and time sliders move on a natural (logarithmic) scale.
- **Nothing changes for your existing sounds:** recipes and presets from preview.26–27 load and render exactly
  as before (this is tested). The Quick controls still never overwrite your settings: they are worked in only
  when the sound is rendered.

## 2.0.0-preview.27 — The Sound Bench for every kind of sound

- **🎲 Generate:** pick a kind of sound and press 🎲. Each press makes a new one, which you can then shape like any
  other. Kinds: pickup/coin, jump, laser/shot, explosion, hit/hurt, power-up, UI blip, error, whoosh/swing,
  footstep (gravel, wood, snow, stone, grass), impact (wood or metal), magic, sci-fi (beeps, warbles,
  teleports), alarm and engine hum.
- **Your own sounds as layers:** add a WAV file (a voice, a creature, real foley). Pitch it like tape, trim it,
  play it backwards, loop or repeat it, fade it, filter it, and layer it with the made sounds. Only files you
  picked (or that a recipe or preset you opened names) are read.
- **New building blocks for any layer:**
  - **Filter sweeps:** the filter moves from one frequency to another over the sound (whooshes, risers,
    closing doors).
  - **Drive** adds grit and distortion. **Crush** gives a retro, 8-bit sound.
  - **Synth voices** get FM (bells, metal, sci-fi), pulse width, a pitch jump (coins, confirmations), a
    filter, and vibrato wide enough for a siren.
  - **Events** can be evenly spaced (steps, ticks) and come as clusters (gravel under a step, rattles).
- **30 new presets**, 48 in all:
  - footsteps on gravel, wood and snow, and walking on gravel (loop);
  - impacts (wooden knock, metal clang, punch, body fall);
  - whooshes (sword swing, riser);
  - machines (engine idle, computer fan, electric buzz);
  - sci-fi (teleport, shield, computer beeps);
  - magic (sparkle, healing chime);
  - UI (confirm, cancel, error, notification, typewriter tick);
  - retro (jump, power-up, hurt);
  - alarms (siren, beeps), cave drips and a heartbeat.
- **Find a preset** with the search box above the list.

## 2.0.0-preview.26 — Sound Bench: wind, rain and effects for your games

- **Sound Bench** (Ctrl+Alt+K, or Tools › Sound Bench): make sound effects and ambiences for games. It opens
  in the middle, next to your documents, and docks elsewhere too. It's the first of the indie developer benches.
  - **Presets to start from:**
    - wind: forest breeze, open-field gusts, storm through trees, wind around ruins, window draft;
    - rain: drizzle, steady rain, downpour, rain on a tent, rain on a metal roof;
    - campfire, forest stream, distant waterfall and distant thunder;
    - UI sounds: click, coin pickup, laser, explosion.
  - **Quick:** shape it with five sliders, *gentle ↔ violent*, *calm ↔ gusty*, *soft ↔ sharp*,
    *near ↔ distant* and *outdoors ↔ indoors*. Set the length and whether it's a seamless loop or a one-shot.
  - **Listen while you change things:** the preview is made again a moment after each change and keeps
    playing from the same spot. You see its waveform, peak and RMS level. Space plays and stops.
  - **🎲 Variation** (V) makes another take of the same sound. **📌 Pin as A**, change things, then **A/B** (B)
    to compare. Ctrl+Z / Ctrl+Y undo and redo.
  - **Layers** show how a sound is built, and you can change everything:
    - noise beds (white, pink, brown; filters that open with the gusts; drifting whistles; wobble);
    - streams of events (drops, crackles, ticks: how many, how they ring, click or ping);
    - synth voices (pitch sweeps, vibrato, repeats);
    - each layer has its level, pan, width, mute and solo, and an envelope for one-shots;
    - **Gusts** are the slow, irregular movement that layers follow, so the leaves rustle harder when the
      wind swells.
  - **Output:** level, low and high cut, stereo width, room sound, a ceiling, and normalize for one-shots.
  - **Export** WAV (48 or 44.1 kHz, 16 or 24 bit): one file, or up to 10 variations, each a different take.
    The recipe is saved next to them (.noorsound.json), so you can open it later and make more.
  - **Save as my preset** keeps your sounds in the list. Loops have no seam: the end flows into the start.
  - **One sound at a time:** the preview stops when music, a video or the radio plays, and pauses them when
    it plays.
- The same recipe and seed always make exactly the same sound. All of it is made on your computer, with
  nothing online.

## 2.0.0-preview.25 — Radio, and fixes from a review

- **Radio** (Ctrl+Alt+I, or Tools › Radio): your internet radio stations, in a panel that docks like the
  others (left, right, bottom or the middle).
  - **Add a station** by its stream address. A .pls or .m3u link is read for you. Give it a name and tags.
  - **Import** .m3u/.pls lists and **export** your stations as .m3u8.
  - **Find stations online** in Radio Browser, a free community directory. It is asked only when you
    search, and only what you type is sent. Try a station before adding it.
  - **The song title** comes from the stream (when the station sends it). It also goes to the Stream Desk's
    Now Playing overlay, and into the stream's tracklist.
  - Favourites (☆), Recent, tags as filters, volume, and a **sleep timer** (15–90 minutes; it fades out).
  - **One sound at a time:** the radio pauses the music and the video, and stops when they start.
  - Nothing is recorded or downloaded. Stations play through a small relay on 127.0.0.1 inside NoorMD,
    which is how the song titles are read. Stations that send HLS (a stream in pieces) can't play yet.
- **Fixes from a review of the last releases:**
  - **Turned photos now show turned everywhere.** NoorMD wrote the orientation in a form the viewer and the
    slideshow ignored (previews were right, the full picture wasn't). It now writes only that one value,
    in the standard form, and fixes photos turned by preview.22–24 the next time you turn them.
  - **Turning is safer:** a JPEG is replaced only once the new file is complete. PNG and TIFF keep their
    colour profile and details; animated PNGs and Photoshop-layered TIFFs are left to their programs.
  - **Turning no longer changes the date** of a picture without a date of its own (screenshots, scans).
  - **Tags of removed pictures** could appear on new ones. They are cleaned up.
  - Converted copies keep the colour profile (iPhone and Adobe RGB photos keep their colours), and mirrored
    photos are shown the right way.
  - A damaged picture in a batch turn no longer stops the others.
  - The Music Bench keeps its place in the list when it leaves the middle.

## 2.0.0-preview.24 — The Music Bench in the middle

- **Put the Music Bench in the middle** (⊞ › *In the middle*) and it spreads out like a music player:
  - **on the left:** Now playing with a big cover, the controls and triage, and **Up next** under it, always
    in view (so it is no longer a tab there);
  - **on the right:** the library as a table, one line per track, with columns for title, artist, album,
    genre, year, triage, plays and length. **Click a column head to sort** by it; click it again to turn the
    order around. In a narrower middle, genre and plays step aside.
- The mini-player at the bottom steps aside while the Music Bench is shown in the middle, and comes back
  when you switch to a document.
- In a side dock the bench stays as it was: two-line rows and the four tabs.

## 2.0.0-preview.23 — Convert and resize pictures

- **Convert or resize** many pictures at once (right-click › *Convert or resize…*, or ⇲ in the details
  panel). Choose:
  - the format: the same as now, JPEG (small files for sharing) or PNG (sharp, keeps see-through parts);
  - the longest side: as they are, 3840 (4K), 2560, 1920 (Full HD), 1280, 1024, 800 or any size in pixels;
  - the JPEG quality, and an ending for the names ("-web" makes *plaża-web.jpg*);
  - where: a folder you choose, or a "Converted" folder next to each picture.
- **The originals are never changed** and nothing is overwritten: a name that is already taken gets (2).
  Smaller pictures are never made bigger. Photos come out the way they were taken (not sideways), and
  see-through parts become white in a JPEG instead of black.
- **Good for sharing:** a converted JPEG keeps the date the photo was taken, but not the camera details
  or the location. Pictures Windows can't read (PSD, Affinity) are listed with the reason; export those
  from their program.
- The dialog shows its progress, says what was made, and opens the folder. It remembers your last choices.
- **Fix: photos turned in NoorMD** could get a sideways preview the next time it was made, because the
  orientation was then stored in a way the preview maker didn't read. It reads both ways now.
- **Fix:** rows in some dialogs that should be hidden (for example the JPEG quality when PNG is chosen)
  stayed visible.

## 2.0.0-preview.22 — Picture tools: stars, colour labels, tags, dates, turning

- **Stars and colour labels.** Give pictures 1–5 stars with the keys 1–5 (0 takes them away), or with the
  stars in the details panel. Keys 6–9 give a colour label: red, yellow, green, blue (the same key again
  takes it off). Orange and purple are in the panel and the right-click menu. Stars and labels show on the
  pictures, and *Any stars or label* next to the formats shows only, say, ★★★ or more, or the green ones.
  There is also a new order: *Most stars first*.
- **Tags on pictures.** Type tags in the details panel (several at once, separated by commas), or press T.
  Tags work across albums ("Thornwake", "reference", "textures"). They are listed on the left. Click one to
  see its pictures. A tag keeps the way you first wrote it, and the search finds tags too.
- **By date.** The left side lists the years you have pictures from. Click a year to see it and its
  months, then a month.
- **Turning pictures.** ⟳ / ⟲ in the details panel and the viewer, Ctrl+R / Ctrl+Shift+R, or the right-click
  menu. JPEG photos are turned the lossless way, like cameras and Windows do: only their orientation
  changes, never the picture. PNG, BMP and TIFF are saved again with every pixel kept. Other formats (PSD,
  Affinity…) are left to their own program.
- **Sizes of turned photos.** Photos a camera stored sideways now show their size as you see them
  (portrait 3000 × 4000, not 4000 × 3000).
- **The viewer** shows a picture's stars, label and tags, and takes the same keys. *Fit / actual size*
  moved from 0 and 1 to Z, because the number keys now give stars.
- **Fix: thumbnails from Windows** (Affinity, Photoshop with its plug-in) are read the way Windows stores
  them, so they are always the right way up.

## 2.0.0-preview.21 — Affinity previews the right way up

- **Fix: Affinity Photo files showed upside down and mirrored** in the Gallery (previews and the viewer).
  Their thumbnails come from Windows already the right way up, and NoorMD flipped them as if they were
  icons. NoorMD now checks which way each picture is stored. Old previews are made again once.

## 2.0.0-preview.20 — Video controls in full screen and in the pop-out

- **Full screen in the Video Bench** now has controls on the video: the timeline, previous / play / next,
  volume, ⚙ (speed, subtitles, sound) and leaving full screen. They show when you move the mouse and
  fade, with the pointer, after a few seconds while the video plays. They stay while it's paused.
- **The pop-out player has the same control bar**, instead of the browser's own controls (whose ⚙ didn't
  work and whose timeline disappeared in a small window).
  - It adds a timeline, play, next, volume, a working ⚙, full screen, and notes on the video.
  - New keys: ← → jump 5 seconds, M mutes.
- **Video Bench in the middle:** ☰ in its header hides the list (Library, Up next, Playlists, Notes), so the
  video gets the whole width. Press it again to bring the list back. The choice is remembered.
- **The Gallery looks for new pictures by itself** the first time you open it in a session. Folders added
  before preview.19 now also show their PSD and Affinity files, without *Look for new pictures*.

## 2.0.0-preview.19 — Picture manager for work files; video notes on the video

- **Video Bench in the middle:** the player is on the left, and Library, Up next, Playlists and Notes are on
  the right. Before, the lists were squeezed out of view.
- **Notes on the video.** A note pops up over the picture at its moment, for a few seconds, in full screen
  too. 💬 next to the player turns it off or on, and the choice is remembered.
- **Gallery albums:** right-click an album (or press F2 on it) to rename it. The pictures inside keep
  their favourites and slideshow places, and Ctrl+Z renames it back. The menu also has *New album inside*,
  *Slideshow of this album*, *Pack into a ZIP* and *Show in Explorer*.
- **Work files in the Gallery:** PSD/PSB, Affinity (.afphoto, .afdesign), TIFF, HEIC, Krita and GIMP
  files are listed.
  - Their previews come from the program that made them, through Windows (when Affinity or Photoshop is
    installed). A PSD also has a small preview inside it, which NoorMD reads without Photoshop.
  - A format badge marks them. The viewer shows a big preview.
- **Format filter and sorting:** choose one format (JPG, PNG, PSD, AFPHOTO…), or sort by type or by file
  size.
- **Open in your editor:** right-click › *Open in* opens the selected pictures in Affinity Photo,
  Photoshop, GIMP, Krita or Paint.NET (found automatically when installed), in a program you add, in the
  default program, or through Windows' *Open with* list.
- **Copy or move anywhere:** *Copy to a folder…* and *Move to a folder…* use Windows' folder dialog, where
  you can also make a new folder. Pictures moved outside your Gallery folders leave the Gallery, and Ctrl+Z
  brings them back.
- **Pack into a ZIP:** choose the name and the folder, and the ZIP appears there. Names are made unique and
  photos are stored without re-compressing.
- **Find duplicates** (⋯ › Find duplicates):
  - It finds exact copies, and optionally look-alikes (resized or re-saved).
  - The biggest picture of each group is kept and the rest are marked. Click to change, or use *Keep the
    newest / oldest*.
  - Marked pictures go to the Recycle Bin after one more question.
- **Fixes:** renaming an album could fail with "Access denied" after its pictures were viewed (a file stayed
  open). Turning off notes on the video now hides a note that is already showing. Marking a favourite
  in the picture viewer no longer resets the zoom.

## 2.0.0-preview.18 — Panels in the middle; the Gallery as a picture manager

- **The middle of the window is a dock area too.** Choose *In the middle* from a panel's ⊞ button (Gallery,
  Stream Desk, Music Bench, Video Bench, Apps Hub, Voice notes).
  - The panel opens as a tab next to your documents and fills the editing space.
  - Several panels can be there at once, one tab each.
  - Click a document tab to get back to writing: the panels stay open behind their tabs. ✕ on a panel tab
    closes it.
  - New ready-made layout: *Streaming, desk in the middle*.
- **The Gallery as a picture manager.** With room (in the middle, or a wide dock):
  - Albums, favourites and slideshows are listed on the left. Details of the selected picture are on the
    right: preview, name, album, date, size.
  - A click selects, Ctrl/Shift+click selects several, double-click or Enter opens the picture. A slider sets
    the picture size.
  - **Rename** in the details or with F2. Several pictures can be renamed as a **numbered series**
    ("Wakacje 01, 02…" in the order shown).
  - **Move** pictures by dragging them onto an album, or with *Move… › album*. *New album* makes a folder
    inside your picture folder.
  - **Delete** (Del) sends pictures to the Recycle Bin, after asking. On drives without one, NoorMD says the
    delete is permanent.
  - **Ctrl+Z** puts the last rename or move back.
  - Nothing is ever overwritten. Favourites and places in slideshows follow renamed and moved pictures.
- **Fix: the mouse pointer could disappear** in NoorMD's dialogs (such as *Update links?* after Rename)
  when they opened right after typing or clicking in the editor. Dialogs and file pickers now always show
  the pointer.

## 2.0.0-preview.17 — Gallery and slideshows; a full review of the app

- **Gallery** (Ctrl+Alt+G, or Tools › Gallery) is a dock panel for your pictures.
  - Add folders: subfolders become albums. NoorMD reads the date taken (EXIF) and the size, and makes small
    previews (turned upright like the camera was held).
  - Browse all pictures, ★ favourites, an album or a saved slideshow. Sort by date or name, and search by
    name or album (Polish letters optional).
  - Click a picture to view it full size: ← → to move, wheel or + − to zoom (drag to pan), F for a favourite,
    I to put it into the note. A picture from outside the Vault or the document's folder is copied there
    first, after asking.
  - **Slideshows:** choose how long each picture stays (3–20 s), the transition (fade, slow zoom, slide),
    shuffle, loop and captions. Music can be what the Music Bench plays or one of your music playlists, and
    it pauses when the slideshow ends. Space pauses, F is full screen, Esc ends.
  - Save a selection as a slideshow. Drag pictures to put them in order. Its settings are saved with it.
  - The pictures themselves are never changed, moved or deleted.
- **Opening a file while NoorMD is running** opens it in a tab of that window, instead of starting a second
  NoorMD that restored the whole session again and saved its settings over the first one. *New window*
  still opens a separate window, and the Stream Desk and Mic Guard stay in the first one.
- **Fixes from a full review of the app.** The serious ones:
  - **Privacy:** the microphone permission could be remembered by WebView2 after the first recording. It is
    now never remembered, and any remembered answer is cleared at start. Two quick presses of Record no
    longer leave the microphone open.
  - **Delete** on a drive without a Recycle Bin (network shares, some USB drives) deleted for good while
    saying it could be restored. NoorMD now checks first and asks "Delete permanently?".
  - **Moving several notes** where one name was taken moved some and stopped, without updating their
    links. Everything is checked first now. A folder selected together with notes inside it moves once.
  - **Links:** names with parentheses ("Plan (v2).md") broke on the second move and didn't show as
    backlinks. A stray backtick no longer stops link updates for whole paragraphs. Renaming a note to a
    name with a dot ("Spotkanie 27.10.2026") no longer drops its .md. Pack & Share now includes
    `![[embedded]]` pictures and `<angle bracket>` links.
  - **Documents:** restoring a snapshot that Visual mode can't show exactly now restores it in Markdown
    mode, unchanged. A recovered draft no longer overwrites a file changed on disk after the crash without
    asking. Snapshots of untitled documents survive a restart.
  - **Music and Video:** renaming a track to the name of a file deleted in Explorer broke undo. Folders
    that overlap (D:\Music and D:\Music\Rock) or an imported playlist plus its folder made every scan fail.
    Undo kept only the first of several genres or artists, and it overwrote tag changes made in other
    programs. Removing from a filtered video playlist deleted the hidden entries too. Clearing Up next
    then toggling shuffle brought the songs back. Save & Next started the next song partway through.
  - **Stream Desk:** an OBS browser source that stops reading could freeze NoorMD. Quitting with unsaved
    supporters in the Stream Desk window lost them even after "Cancel". A hand-edited stream note with a
    Windows path broke the stream history. Apps Hub web shortcuts with an unknown launcher scheme now ask
    before they are added.
  - **Links in documents** are checked before anything on disk is touched, so a crafted link can't make
    Windows contact a network share.

## 2.0.0-preview.16 — Apps Hub categories, fixes

- **Apps Hub categories.** A row of chips above the tiles chooses what is shown:
  - *All*, *Recent* (what you started last), or one category.
  - Your choice is remembered.
  - Searching still looks through every category.
  - ＋ makes a new category. Right-click a category to rename it, move it left or right, or remove
    it. Its shortcuts are never removed: they move to the category you pick.
  - Right-click a shortcut › *Move to category* to file it elsewhere.
  - Adding something while a category is chosen puts it in that category.
- **Fix: renaming a note didn't update `[[wiki links]]` typed in Visual mode.** Visual mode saved
  them as escaped text (`\[\[Note\]\]`), so they weren't links in the file. Rename, backlinks and
  other Markdown tools couldn't see them.
  - They're now saved as real `[[links]]`.
  - Notes that already have the escaped form are understood too: they count as backlinks, and
    renaming the note rewrites them as plain `[[links]]`.
  - Links update when you rename or move in NoorMD's Vault explorer (F2, right-click › Rename,
    drag), not in Windows Explorer.
- **Fix: menu highlighting.** After you moved off an item with a submenu, it stayed highlighted
  along with the item under the mouse. Now one item is highlighted at a time, and the highlight
  clears when the mouse leaves the menu. An item whose submenu is open stays marked.

## 2.0.0-preview.15 — Voice notes

- **Voice notes** (Ctrl+Alt+D, or Tools › Voice notes) is a small recorder in a dock panel.
  - Record with a level meter, and pause and continue.
  - Listen to the take, give it a name, then save it or discard it.
  - Recordings are saved next to your notes: the Vault's `attachments/Voice notes`, or
    `Documents\NoorMD\Voice notes` without a Vault.
  - Formats: **Opus** (small) or **WAV** (opens in every player).
  - *Put a link into the document* adds `🎙 Name (0:42)` at the cursor, as a real link.
  - Your recordings are listed with play, link, show in Explorer and delete (to the Recycle Bin).
  - Music pauses while you record.
  - NoorMD may use the microphone only for a few seconds after you press Record in NoorMD. Every
    other request is refused, and the microphone is released when you stop.
- **Fix: inserting into a document in Visual mode.** Video notes ("Into document"), Vault note
  links, sketches, dropped files and voice notes used to appear as escaped text (`\[name\](…)`) in
  Visual mode. They're now inserted as real links, lists and formatting. Markdown mode is unchanged.

## 2.0.0-preview.14 — Apps Hub

- **Apps Hub** (Ctrl+Alt+H, or Tools › Apps Hub) holds your shortcuts to programs, games, folders,
  files and websites, as tiles with their pictures.
  - It's a dock panel like the benches: left, right or bottom.
  - Programs, games, folders and files get the icon Windows shows for them. That includes Steam and
    Epic desktop shortcuts (.url) and .lnk shortcuts.
  - Websites get a coloured letter tile, or a picture you choose. NoorMD downloads nothing for
    them.
  - Shortcuts sit in groups (Apps, Games, Web… or your own) with a *Recently used* row and search.
    Enter starts the first match.
  - Right-click to start, edit (name, group, start arguments such as `-novid`), change the picture
    or go back to the Windows icon, show in Explorer, move to the start, or remove.
  - Web addresses can be http(s) or launcher links such as `steam://` and `discord://`.
    `javascript:`, `file:` and similar are refused. Programs start only from what you added, by its
    id, so a document or web page can never start a program.

## 2.0.0-preview.13 — Tags and the new-Vault wizard

- **Tags in Vault notes**, written the Obsidian way: `#idea`, nested `#project/alpha`, or
  `tags: [idea, lore]` (also `- item` lines) in the front matter.
  - Sidebar › **Tags** lists every tag with how many notes use it, with a filter.
  - Click a tag to see its notes, then click one to open it.
  - `#project` also finds notes tagged `#project/alpha`.
  - Headings, `page#part` links, numbers like `#123` and code are not tags.
- **New-Vault wizard** (Workspace › Create new Vault…): a name and a starting point.
  - The starting points are Empty, Personal notes, Writer, Worldbuilding, Streamer / creator (matches
    the Stream Desk folders) and Game development.
  - Each one creates folders, a Home note with links, and a few short templates.
  - **Add folders from a preset…** does the same for an open Vault. It only adds what's missing and
    never replaces a file.

## 2.0.0-preview.12 — Docks and layouts

- **Docks, one rule for the whole window.** There are three dock areas: left, right, and bottom
  (under the document). The sidebar can sit on the left or the right.
  - The Music Bench, Video Bench and Stream Desk each live in the area you choose with their
    **⊞** button. Each area shows one panel at a time.
  - Panels in different areas can be open together, for example music on the left and a video on
    the right. Before, opening one closed the other.
  - Drag a dock's inner edge to resize it.
  - Moving a playing video to another dock doesn't stop it.
  - The classic layout is the default: sidebar on the left, panels on the right.
- **Layouts** (View › Layout, or Layouts… from any ⊞):
  - Ready-made: *Classic*, *Writing* (just the document), *Music + video*, *Streaming* (music left,
    Stream Desk right, videos below), *Stream Desk in its own window*, *Sidebar on the right*.
  - *Save current layout…* remembers where everything is, which panels are open and their sizes,
    under a name of your choice.
- **The Stream Desk matches the other benches.** It docks beside the editor with the same title row
  and tabs as the Music Bench. In a narrow dock the tabs show icons only and the cards stack.
  **⧉** pops it out into its own window, and **⇤** in that window docks it back. Ctrl+Alt+B opens
  it wherever it lives.

## 2.0.0-preview.11 — Find in files, links that survive renames, smarter players

- **Find in files** (Ctrl+Shift+F) searches **all open documents**, like Notepad++'s "Find in All
  Opened Documents". It includes unsaved changes and doesn't need a Vault. It can also search
  **every note in the Vault**.
  - Results are grouped by document, with line numbers.
  - Match case and Whole word are available for open documents.
  - Enter or a click jumps to that exact match.
- **Renaming or moving a note keeps links working.** NoorMD asks *Rename and update links*,
  *Rename only* or *Cancel*, and says which notes would change. It then updates:
  - Markdown links and images;
  - [[wiki links]], including `![[embeds]]`;
  - the moved note's own relative links.

  The rest of the note isn't touched: links in code, external links, encoding and line endings
  stay as they were. Open notes reload. Notes open with unsaved changes are left alone and named.
- **Writing a video note pauses the video** and continues when the note is added (Esc also
  continues). It works in the Video Bench and the pop-out player, and you can switch it off under
  the note box.
- **The Music and Video lists follow what's playing.** When the song or video changes, the list
  scrolls to show it (it's highlighted). It doesn't jump while you're scrolling or clicking the list
  yourself, or with several items selected.
- Fix: switching tabs in the Music Bench could hide the Video Bench's lists.

## 2.0.0-preview.10 — Stream Desk window, mouse buttons for Mic Guard

- **The Stream Desk has its own window.** You can put it on a second monitor next to OBS, and the
  editor stays free. Ctrl+Alt+B, the Stream menu and Ctrl+K open it or bring it forward; the
  title bar closes it. It remembers its size and position. It only gets the Stream Desk and Mic
  Guard commands. If you close it with unsaved changes to the supporters list, it asks first.
- **Mic Guard hotkey: mouse buttons and more keys.**
  - The side buttons on the mouse (Mouse4 / Mouse5) work, alone or with Ctrl/Alt/Shift. So does the
    middle button with a modifier.
  - The click that mutes is not passed on, so a browser or game doesn't also go "back".
  - Keys like `/ \ , . ; ' [ ] - =`, the arrow keys, the numpad, F13–F24 and the media keys now
    work too.
- **Layout fixes:**
  - The Stream Desk header no longer breaks into lines with the ✕ out of place.
  - Text fields and menus have the app's style.
  - The microphone menu stays inside its card.
  - A mistyped OBS password stays in the field so it can be corrected.
- Dates in the Stream Desk (supporters "Left on", a new stream's date) use your local date. Before,
  they used UTC, so a late-evening stream in Poland could be dated the next day.

## 2.0.0-preview.9 — Mic Guard

**Mic Guard** (Stream Desk › 🎙 Mic Guard) ends the "OBS muted, Discord live" mix-ups. Everything is
off until you switch it on.
- **One switch for every program.** NoorMD mutes the microphone in Windows itself, so OBS, Discord,
  games and everything else hear silence at once. Pick the default microphone or a specific one.
- **OBS, optional.** NoorMD connects to OBS's built-in WebSocket server (OBS 28 or newer) and sets
  your mic source's mute explicitly. It also notices when you mute it in OBS yourself. The password
  is kept in Windows Credential Manager, never in NoorMD's files.
- **The truth, read back.** NoorMD shows what Windows and OBS actually report: **LIVE**, **MUTED**, or
  **CHECK** when they disagree.
- **One system-wide hotkey** that also works in games. If anything is live, it mutes everything; only
  when everything is muted does it unmute. It never toggles each side separately, which is what made
  them drift apart.
- **A floating indicator** that stays on top, never takes focus from a game, and is hidden from OBS
  and screenshots (Windows 10 2004 or newer). Click it to mute or unmute, drag it anywhere, and
  set its opacity and size. It isn't drawn over games in exclusive full screen; use borderless
  windowed.
- **Discord:** NoorMD doesn't touch Discord's own mute button, since Discord doesn't allow that
  reliably. Muting in Windows makes Discord hear silence.
- New Ctrl+K commands: *Mute / unmute microphone* and *Mic Guard settings*.

## 2.0.0-preview.8

- **Selecting several tracks or videos no longer highlights their text.** Shift+click and Ctrl+click
  in the Music and Video lists used to select the row text too, which looked like a second, broken
  highlight. Only the rows are highlighted now.

## 2.0.0-preview.7 — the Video Bench works like the Music Bench

- **Video Bench, rebuilt like the Music Bench.** The picture sits where the cover art is, with the
  same seek bar and transport: shuffle, previous, play/pause, next, repeat and volume. Below it are
  the tabs *Library · Up next · Playlists · Notes*.
  - **Library:** search, sort, filters (All, Unwatched, In progress, Watched) and a series menu.
    Click, Ctrl+click and Shift+click select; double-click plays. The playing video is
    highlighted, and ◎ (or clicking its title) finds it in the list.
  - **Right-click menu:** Play, Play next, Add to Up next, Add to playlist ▸, Remove from the open
    playlist, Mark as watched / not watched, Notes, Show in Explorer and Select all.
  - **Up next:** a queue with shuffle and repeat. Move items up or down, remove them, clear the rest,
    or save the queue as a playlist.
  - **Playlists:** make one from a whole series or TV show in one click, or from selected videos.
    You can open, play, rename and delete them. Inside an open playlist, Alt+↑/↓ reorders and Delete
    removes (the files are never touched). Playing a playlist starts at its first unwatched video.
  - **Audio tracks:** videos with more than one audio track (e.g. two languages) get a 🔊 menu; **A**
    switches tracks. The language you choose is kept for the next video when it has it too.
  - Up next, shuffle, repeat, volume and the library view are remembered between sessions.
- **Music Bench:** the playing song is highlighted in the list, and ◎ (or clicking the song title)
  scrolls to it. When the panel is narrow, the controls wrap onto a new line instead of sticking out,
  and the round buttons keep their shape.

## 2.0.0-preview.6

- **The Video Bench docks beside the editor** like the Music Bench, instead of covering it. The
  editor, toolbar and Save button get narrower and stay usable. This also applies when the panel is
  wide or resized. Opening the Music Bench closes the Video Bench, and the other way round.

## 2.0.0-preview.5 — fixes from trying preview.4

- **Cover art in the Music Bench is small again.** The OBS overlay's styles leaked into the app
  and blew up the artwork. The overlay now uses its own class names.
- **Shuffle keeps going.** With ⇄ on, when a song ends a random one follows. At the end of the
  queue it reshuffles instead of stopping. The ⇄ button is clearly highlighted when on.
- **Video Bench is a side panel** like the Music Bench: the picture on top, controls, then
  *Episodes · Library · Notes*. Drag its left edge to resize, or use ⤢ for a wide panel. The picture
  was missing before: the episode list squeezed it to zero height. Opening it tucks the Music Bench
  away (the music keeps playing until a video starts).
- **Pop-out player and NoorSketch windows show their content right away.** They used to stay blank
  until the window was resized.
- Stream Desk: overlapping refreshes no longer draw a tab twice.

## 2.0.0-preview.4 — Music Bench polish, Batch Organizer, Video Bench, Stream Desk

Finishes the Creator's Bench milestones (B: Batch Organizer, C: music polish, D: Video Bench) and adds
the three stream features asked for: a **Now Playing** overlay for OBS, a **credits roll** for supporters,
and a local **stream log** with templates. Editing, tabs, Vaults and earlier features are unchanged.

**Music list: selection and right-click menu.**
- Click selects a track; **Ctrl+click** adds or removes one; **Shift+click** selects a range;
  **Shift+↑/↓** extends; **Ctrl+A** selects all; **Esc** goes back to one track.
- **Right-click** (or Shift+F10 / the Menu key) opens a menu for the selection:
  - Play these tracks, Play next, Add to Up next.
  - **Add to playlist ▸** with your existing playlists or **New playlist…**.
  - Remove from the open playlist (the files are not touched).
  - Mark as ▸ Favorite / Keep / Maybe / Skip / Clear.
  - Edit track (one) or **Batch Organizer** (several).
  - Show in Explorer, Show artwork, Measure loudness, Copy titles, Copy file paths, Select all.
- The 0–4, Q, N and Enter keys work on the whole selection.

**Shuffle and random.**
- **Shuffle** is now in the mini-player, the toolbar and the Media menu, not only in the Bench.
- **🎲 Random** (Ctrl+Alt+R) jumps to a random track of the current view, or of the whole library.

**Batch Organizer** (several tracks at once).
- **Tags**, per field: *Leave unchanged*, *Set to* (placeholders allowed) or *Clear*.
- **File names** from a template: `{Title}` `{Artist}` `{Album}` `{AlbumArtist}` `{Genre}` `{Year}`
  `{TrackNumber:00}` `{OriginalName}` `{Folder}` and a counter `{n}` (start, step, digits).
  Then find and replace (plain text or regular expression), prefix and suffix, letter case,
  underscores to spaces, tidy spaces, and optionally replace characters Windows doesn't allow.
- A **dry-run preview** shows the old and new name and the tag changes for every file, and
  blocks files with a problem: two files getting the same name, a name already taken on disk,
  illegal characters, reserved names, names or paths that are too long. Empty placeholders and
  long paths are warnings.
- **Apply** changes only the files that passed the preview. Swaps and chains (A→B, B→A) work,
  because files are first moved to temporary names; nothing is ever overwritten.
- **Per-file results**, and **Undo this batch** (also via Media › Undo last track edit). Files
  changed since the batch are skipped with a reason.

**Sound.** A new **Sound** tab in the Music Bench.
- **Equalizer** with 10 bands and presets (Bass boost, Treble boost, Vocal clarity, Electronic,
  Warm lo-fi, Acoustic, Late night). **Prevent clipping** lowers the preamp by the largest boost,
  and a limiter keeps peaks under −1 dBFS.
- **Even out loudness**: tracks play at about the same loudness (−14, −16, −18 or −23 LUFS).
  - NoorMD measures loudness itself (ITU-R BS.1770), or uses ReplayGain tags.
  - The files are never changed; the gain is applied while playing, and never pushes a
    track above −1 dBFS.
  - Measure the playing track, the selection, the view or the whole library. With
    normalisation on, new tracks are measured in the background as they play.

**Smart collections.** Playlists that fill themselves from rules: text (contains, is, starts
with, empty…), numbers (year, plays, duration, loudness), dates (added or last played in / not in
the last N days, never), marks and flags (has artwork, missing). Match all or any, optionally keep
only the first N (most played, recently added, random…). Starting points: Recently added,
Favorites, Never played, Not played for a month, Most played, Still to triage, Short tracks,
Missing artwork. Counts update live.

**Artwork.** `cover.jpg` / `folder.jpg` next to the music is used when a file has no embedded
artwork. Tracks without artwork get a generated placeholder. Click the artwork for a large
view and **Save artwork as…**.

**Video Bench** (Media › Video Bench, Ctrl+Alt+V).
- Add video folders; each subfolder is a **series**, in episode order: S01E02, 1x02, "Episode 3",
  "Part 2", "- 03 -", or natural number order.
- **Resume**: NoorMD remembers where you stopped. *Continue watching* lists unfinished videos, and
  each series continues at the right episode. Near the end, a video counts as watched.
- **Subtitles** next to the video (SRT, ASS/SSA, VTT; also `Name.en.srt`) are converted and shown.
  Press **C** to cycle through them.
- **Speed** 0.5×–2× (`[` and `]`), J/L ±10 s, ←/→ ±5 s, F full screen. The next episode starts
  after a short countdown. Music pauses when a video starts.
- **Timestamped notes**:
  - Press **N**, type, Enter. Click a time to jump there; double-click a note to edit it.
  - **⇩ Into document** inserts the notes as a list with times.
- **⧉ Pop out**: a small player window that stays on top of other programs (📌 to toggle). It
  keeps position and notes, and closing it continues in the Video Bench at the same moment.
- MP4 (H.264/AAC), WebM and Ogg play directly. Other formats show a clear message.

**Stream Desk** (Media › Stream Desk, Ctrl+Alt+B).
- **OBS overlays**, served by NoorMD on **127.0.0.1 only** (read-only; requests for other host
  names are refused). In OBS, add a *Browser Source* with the address shown. Changes update OBS
  live.
- **Now Playing**: six designs (Glass card, Lower third, Neon, Vinyl, Minimal text, Ticker). You
  can customise:
  - colours, background opacity, font, size, corners and position;
  - label, artwork, artist and progress bar;
  - the animation when the song changes;
  - auto-hide, and hide while paused.

  The preview is the real overlay. An optional **now-playing.txt** is written for an OBS Text
  source.
- **Credits roll** of your supporters, grouped by tier, with channel names. Settings:
  - title, message and closing text;
  - speed, size, font, colours, loop, and start delay.
  - Start it from NoorMD (**🎬 Roll credits in OBS**), or let it start by itself when the OBS
    source appears.
- **Effects**: built-in Classic, Starfield, Neon hearts, Confetti party, Snowfall and Violet
  dream.
  - **New effect** makes your own from any of them. Choose a background (transparent, solid or
    moving gradient), particles (stars, sparkles, hearts, confetti, snow, bubbles or any emoji)
    with amount, speed, size, direction and colours, and a name animation (glow, shimmer, wave or
    fade in).
  - Effects can be copied as text to share, and imported.
- **Supporters**: kept as a Markdown table note in your Vault (`Stream/Supporters.md`).
  - Add people by hand, or **paste an export** (YouTube members, Patreon, Ko-fi CSV, or "Name
    link" lines).
  - The preview shows who is new, updated or back. Optionally, people missing from the export
    are marked as left (they stay in the list as history).
- **Stream log**: one note per stream in your Vault's `Streams` folder.
  - Each note keeps the title, date, number, description, keywords, thumbnail (copied into the
    Vault's attachments), video URL and notes.
  - **● Record the tracklist** notes every song played during the stream with its time.
  - **Templates** for titles, descriptions and keywords use `{number}`, `{date}`,
    `{date:dd.MM.yyyy}`, `{title}` and `{keywords}`. In a copied description, `{tracklist}`
    becomes YouTube chapters.
  - **Copy title / description / keywords**: NoorMD never publishes anything by itself.

**Under the hood.**
- Library schema v3: batch journal, ReplayGain, loudness, smart collections. Older libraries
  upgrade in place.
- The page may now read its own `/_media/` files (`connect-src 'self'`) for loudness
  measurement. Nothing external is allowed.
- The Windows self-test now also:
  - plays MP4 and WebM;
  - checks subtitle cues;
  - measures loudness in WebView2 and plays through the equalizer;
  - swaps two file names in one batch on NTFS and undoes it;
  - runs the overlay server (DNS-rebinding refusal and Server-Sent Events);
  - writes the supporters and stream notes into a Vault.

## 2.0.0-preview.3 — Menus & toolbar, Vaults, Pack & Share, NoorSketch

Built from four proposals: *Main Menu & Customizable Toolbars*, *Vaults Foundation*, *Vault Pack & Share*
and *NoorSketch*. Tabs, the Music Bench and every earlier feature are unchanged, and the
signature violet theme (Atelier Dark) is still the default.

**Main menu and toolbar.**
- Menus: **File, Edit, Insert, Format, View, Workspace, Media, Tools, Help**.
  - Open them with **Alt+letter** (holding Alt underlines the letters), or press **F10** and
    use the arrow keys.
  - Menu items show their shortcuts. Items that can't run right now are greyed out, and
    toggles show a check mark.
- **One command list for everything.** The menu, the toolbar, keyboard shortcuts and Ctrl+K
  all run the same commands, so they can't drift apart.
- **Toolbar** with groups: Document, Writing, Navigation, View, Tools and Media.
  - It replaces the editor's own toolbar. Bold, italic, lists and other formats light up for
    the text at the cursor.
  - The heading picker shows the current level. Insert table and Insert image have small
    dialogs.
  - When the window is narrow, the least-used buttons move into **More** instead of being
    cut off.
  - Right-click the toolbar or use **View → Customize toolbar…** to:
    - show text labels or use small buttons;
    - hide or reorder groups;
    - restore the defaults.
  - **View → Show toolbar** hides it completely. Everything stays in the menus and Ctrl+K.
- **Focus mode** hides the menu and toolbar (optionally keep the toolbar). An **Exit focus**
  button is always visible.
- **Edit menu:**
  - Cut, Copy and Paste-as-plain-text go through the Windows clipboard.
  - Select all, plus **Tools → Document statistics** and **Help → User guide** (opens the
    README in a tab).

**Vaults.** A Vault is any ordinary folder. Open it with **Workspace → Open Folder as Vault**,
or create one.
- NoorMD writes nothing into it except your own notes and folders. `.git`, `.obsidian` and
  other tools' folders are skipped and never changed. Its settings live in NoorMD's own
  settings.
- **Explorer** in the sidebar (Files / Document switch):
  - folders first, natural order;
  - name filter that ignores accents;
  - keyboard navigation, Ctrl/Shift multi-select and drag to move;
  - inline rename with F2;
  - New note / New folder, Duplicate, Reveal, Copy path;
  - Delete to the **Recycle Bin**.
- **Open tabs follow their files** when you rename or move them in NoorMD. Deleting a file
  closes its tab unless it has unsaved edits.
- **Find in Vault (Ctrl+Shift+F).**
  - Every note is searched in the background, ignoring accents and case. Matches are
    highlighted.
  - Opening a result highlights the words in the note.
  - The index is kept up to date by watching the folder. It is a cache, never stored in the
    Vault.
- **Ctrl+E** now also finds notes that aren't open. **Ctrl+Shift+E** focuses the explorer.
- **Linked from:** a sidebar list of notes that link to the current one, by relative link or
  `[[wiki link]]`.
- **Links:**
  - **Ctrl+click** a `[[wiki link]]` to open it (or to create the note).
  - Links between notes in the Vault open without a confirmation.
  - **Link to a note…** inserts a relative link.
- **Pictures:**
  - `../Images/x.png` style links work inside a Vault.
  - Dropping a picture from outside the Vault offers to copy it into the Vault's attachments
    folder.
- Front matter and wiki links keep their exact text; the round-trip guard handles notes the
  Visual editor can't represent.
- Closing or switching a Vault never closes a tab. The Vault reopens on start with the
  session.

**Pack & Share.** Right-click a folder, several items or the Vault, or use **Workspace →
Pack & Share…**.
- **Preview first:** file count and size, the files with their archive paths, what's left out
  and by which rule, linked files from elsewhere in the Vault (include or exclude each), and
  links that can't be packed.
- **Exclusion rules** are visible and editable. The defaults leave out `.git`, `.obsidian`,
  `.env`, keys, certificates, temp files and the like.
- **Folder structure is kept,** so relative links work after unzipping. The archive never
  includes itself.
- **AI Handoff Package** adds `MANIFEST.md` and `README.md` in `_noormd_handoff/` (your own
  README is never replaced). It includes only instructions you write; nothing is invented or
  summarised, and nothing is uploaded.
- **Packing:**
  - Runs in the background with progress and Cancel. Music keeps playing.
  - The ZIP is written under a temporary name, checked, and only then renamed.
  - Cancelling or failing leaves no archive, and your files are only ever read.
  - Locked files are reported, and the rest is packed.
- **Unsaved edits** in packed notes: choose to save first or to pack the versions on disk.

**NoorSketch** (**Tools → NoorSketch**). A quick sketchpad in its own resizable window that
doesn't block the editor or the music.
- **Tools:**
  - brush (1–100 px, no gaps on fast strokes) and colour swatches or any colour;
  - an eraser that makes pixels transparent, not white;
  - multi-step undo/redo, including Clear and canvas resize;
  - wheel zoom, Space/middle-drag pan, Fit and 100 %.
- **Canvas:** 1280×720, 1920×1080, 2048×2048, 4096×4096 or a custom size, with a white or
  transparent background.
- **Files:**
  - **.noorsketch** is a plain ZIP with `manifest.json` and `image.png`. NoorSketch keeps exact
    pixels, so a saved sketch reopens **pixel-identical**, including soft edges.
  - **Export PNG** at full resolution.
- **Insert into document** saves the PNG next to the note (`assets/`) or in the Vault's
  attachments folder, optionally with its editable `.noorsketch`, and inserts a relative
  `![Sketch](…)` link into that document. For an unsaved document it asks where.
- Unsaved sketches are protected when you close the sketch window or NoorMD.

**Tests.**
- 100 unit tests in Core, 46 in Media.
- 303 UI checks, 100 of them new, covering menus and the toolbar, Vaults, Pack & Share and
  NoorSketch.
- The Windows self-test now also covers:
  - a 300-note Vault, `../` pictures and rename following a tab;
  - the Recycle Bin and Pack & Share;
  - NoorSketch's exact PNG through the real `.noorsketch` file.

### Going back to 2.0.0-preview.2

Notes, sketches and ZIPs are ordinary files, so nothing needs converting. Older versions
ignore the new settings keys (toolbar, Vaults) and can't open `.noorsketch` files. The
preview.2 code is on **`noormd-2.0.0-preview.2-baseline`** (commit `1b3cc22`).

## 2.0.0-preview.2 — Multi-document tabs

Based on *NoorMD — Multi-Document Tabs & Session Management*. The Creator's Bench work is
unchanged; the music player belongs to the window, not to a tab.

**Tabs.**
- A tab strip above the document. Each tab shows the file name, a dot for unsaved changes and
  a close button; the tooltip is the full path.
- **Ctrl+T** (or Ctrl+N) opens a new untitled tab. **Ctrl+O** opens files into tabs, and you can
  pick several at once. Dropped Markdown files each get a tab.
- **Ctrl+Tab / Ctrl+Shift+Tab** and **Ctrl+PageDown / Ctrl+PageUp** switch tabs. **Ctrl+W** closes
  one, and so does a middle-click. Drag a tab to reorder it. **Ctrl+E** (or the ⌄ button) lists all
  open documents, with search.
- The right-click menu has **Close, Close Others, Close Tabs to the Right, Copy Path, Reveal in
  Explorer, Pin/Unpin**. Pinned tabs sit at the start and are skipped by Close Others / Close Tabs
  to the Right and by middle-click. Close or Ctrl+W still closes them.
- Opening a file that is already open selects its tab. Different spellings of the same path
  are recognised: casing, `..\`, 8.3 short names and links.
- Many tabs scroll sideways inside the strip, so the window never gets wider.

**Each document is kept separate.**
- Every tab has its own editor, so undo history, cursor, selection and scroll position belong
  to that document only.
- Encoding, BOM, line endings, dirty state and the round-trip guard (with its banner) are also
  per tab.
- Each tab has its own recovery draft and snapshot history. Two untitled documents stay two
  separate drafts, including after a crash.
- File-changed-on-disk checks run for every open file, not just the visible one.
- The host never takes text from "whatever is on screen". Every save, close and export names
  its tab, and the text is read from that tab's own editor at that moment, including keys
  typed a fraction of a second earlier.

**Saving and closing.**
- **Ctrl+S** saves only the visible tab. Save As changes only that tab's path and name.
- **Save all** is in the command palette.
- Closing a modified tab asks Save / Don't save / Cancel. Cancel keeps the tab and its text.
- Closing the window with several modified documents lists them and offers **Save all**,
  **Review each…**, **Don't save** or **Cancel**. Cancel keeps the window open.

**Session restore.**
- On start, NoorMD reopens the tabs from last time: files and untitled documents, in their
  order, with pinning, view mode and the selected tab.
- A tab whose unsaved work survived a crash or a Windows shutdown comes back with that work.
- Files that were moved or deleted are reported in a notice and skipped.
- Extra windows (*New window*) don't touch the main window's session.
- Turn this off in Preferences → *Reopen the tabs from last time*.

**Technical.**
- Bridge protocol v2: document requests carry a `tabId`, and `NoorMD.flush(tabId)` reads one
  tab. See [docs/BRIDGE.md](docs/BRIDGE.md).
- Recovery drafts are named `<session>-<tab>.json`.
- Tests:
  - 4 new unit tests (65 in Core; the protocol test now also checks that v1 messages are rejected);
  - 52 new UI checks (203 in total), including three files edited in turn, rapid switching
    while typing, Ctrl+S straight after a keystroke, 24 tabs, and music playing through tab
    changes;
  - Windows self-test checks for tabs on real WebView2.

### Going back to 2.0.0-preview.1

**Save or recover your work first.** Older versions don't recognise the new per-tab recovery
draft names, so they would not offer them. Settings, snapshots and the music library are
compatible; older versions ignore the new `session` key and reopen the last document as before.
The preview.1 code is on **`noormd-2.0.0-preview.1-baseline`** (commit `6fae20f`). Older
baselines: `noormd-1.2.0-baseline`, `noormd-1.1.0-baseline`, `noormd-1.0.0-baseline`.

## 2.0.0-preview.1 — Creator's Bench (milestone A) and themes

Based on *NoorMD 2.0 — Creator's Bench*. The engineering plan, decisions and conflicts are in
[docs/CREATORS_BENCH_PLAN.md](docs/CREATORS_BENCH_PLAN.md).

**Themes.** Nine colour themes:
- Atelier Dark and Atelier Light (the originals)
- Nocturne, Ember, Evergreen and Rosewood (dark)
- Parchment and Glacier (light)
- High Contrast

Choose one with the **Theme** button, which previews on hover and applies on click, or cycle
with **Ctrl+Shift+T**. The window title bar and dialogs follow the theme. Every theme is
checked automatically for WCAG contrast; see the screenshots in
[docs/themes-preview.png](docs/themes-preview.png).

**Music Bench (Ctrl+Shift+M).** It is optional and starts nothing until you open it.
- **Library:**
  - Add folders, including subfolders. The index builds in the background while you keep
    writing.
  - Search ignores case and Polish diacritics ("zolw" finds "Żółw"). Filter by triage, sort,
    and scroll a virtualised list (tested with 20,000 tracks).
  - Missing files are marked, never deleted. Files moved outside NoorMD are relinked when
    you rescan.
  - NoorMD never moves or changes files on its own.
- **Player:**
  - Play/pause, seek, volume, previous/next, shuffle, and repeat (off, all or one). It plays
    MP3, FLAC, WAV, OGG/Opus and M4A.
  - An **Up next** queue, a **Now Playing** card, and a **mini-player** under the editor that
    can be hidden.
  - Playback continues while you write and switch documents.
  - The last queue, track and position come back after a restart, paused.
- **Edit current track (F2):**
  - Edits title, artist, album, album artist, genre, year, track number and comment. Tags
    that aren't present show as "— not set —"; nothing is invented.
  - Updating the tags and renaming the file are separate choices. Use **Name from tags** for
    a suggestion, then **Save**, **Save & Next** or **Cancel**.
  - The file is validated before anything is touched: illegal characters, reserved names,
    collisions (nothing is ever overwritten), read-only files.
  - The playing file is released, edited and resumed at the same position.
  - Every edit is journalled. **Undo last track edit** reverts the name and tags, and refuses
    if the file was changed since.
- **Triage while listening:** **Alt+1** Favorite, **Alt+2** Keep, **Alt+3** Maybe, **Alt+4**
  Skip and **Alt+0** clear. These work from the editor without typing anything. In the
  library list, plain 1–4 also work.
- **Playlists:** create, rename, delete, play, "Save Up next as playlist", and import/export
  `.m3u`/`.m3u8` with relative paths.
- **Shortcuts:** **Ctrl+Alt+Space** play/pause and **Ctrl+Alt+→/←** next/previous. Media keys
  work through the Media Session API.
- **New components:** TagLib# (LGPL-2.1, as a separate DLL), Microsoft.Data.Sqlite (MIT),
  SQLitePCLRaw (Apache-2.0) and SQLite (public domain). License texts ship in `licenses/`.
- **Not in this preview:** the remaining phases from the proposal, each its own milestone:
  - **B:** the batch organizer (mass rename and tag templates with preview and dry run)
  - **C:** EQ and loudness
  - **D:** the Video Bench

  Streaming services stay out of scope.

### Going back to 1.2.0

Documents, recovery drafts, snapshots and settings are unaffected; older versions ignore the
new settings keys. The music index is a separate file (`%LOCALAPPDATA%\NoorMD\Music\library.db`)
that 1.x never reads. The 1.2.0 code is on **`noormd-1.2.0-baseline`** (commit `e6db7d3`).
Older baselines: `noormd-1.1.0-baseline`, `noormd-1.0.0-baseline`.

## 1.2.0 — Markdown source editor

Based on *NoorMD — Markdown Source Editing Improvements*.

**What was wrong.** The editing engine was fine; the cause was CSS. TOAST UI's own Markdown
syntax stylesheet enlarges and bolds heading tokens (`.toastui-editor-md-heading1..6`: 24, 22
and 20 px) and puts code blocks in Consolas. NoorMD 1.1's overrides targeted `h1`/`h2` and
`.toastui-editor-contents span`, which don't match the classes TOAST uses in the source
pane, so `# Heading` lines rendered large. Measured before the fix: 24/22/20 px heading lines
next to 14 px text, with line heights of 41, 37 and 24 px. After the fix: one size, one font
and one line height everywhere. No new editor was introduced.

- **The source pane is plain text.**
  - Every line uses the same font (the bundled **JetBrains Mono**), size and line height.
  - Markers such as `#`, `**` and `[]()` stay literal text, with subtle theme-aware colours
    only. All token colours pass WCAG contrast checks in both themes.
  - The source font size is a separate setting (Preferences, 11–22 px) from the reading
    font.
- **Exact source in Markdown mode.** Opening a file in Visual mode and switching to Markdown
  shows the original text byte for byte; before, it showed TOAST's re-serialised version
  (`- item` became `* item`). Save, snapshots, export and Copy Markdown source also use the
  exact source while nothing has been edited in Visual mode.
- **Line numbers** are on by default and can be toggled. **Word wrap** can be turned off;
  long lines then scroll horizontally. A **current-line highlight** is drawn behind the text,
  never inside the document.
- **Split view:**
  - The panes scroll **independently** by default. Synchronised scrolling is optional
    (Preferences or the command palette).
  - When the editor area is narrow, Split stacks source above preview instead of squeezing
    each into half. This is based on the editor's own width, not the window's.
  - A layout bug was fixed: in a short stacked pane, the 40vh bottom padding made the source
    box overflow onto the preview.
- **Source editing commands:**
  - Heading 1–6 (**Ctrl+Shift+1…6**), Insert link (**Ctrl+Shift+K**) and Insert code block
    (**Ctrl+Shift+C**).
  - **Copy Markdown source** in the command palette, which uses the Windows clipboard.
  - Tab/Shift+Tab indentation and list continuation on Enter were already provided by the
    editor.
- **Tests.** The UI suite grew from 75 to 100 checks, including a ~7,700-word document; the
  proposal's tests 1–7 are covered. The Windows self-test adds checks for exact source,
  uniform font and the bundled font.
- **Not done, on purpose:**
  - Auto-pairing of brackets and markers. It risks inserting characters you didn't type.
  - Indent guides, visible-whitespace markers and a minimap. These need editor decorations
    that would add complexity for little writing benefit.
  - All of these are possible later with a TOAST plugin. Switching to CodeMirror or Monaco
    isn't needed for them.

### Going back to 1.1.0 (or 1.0.0)

Same as below. The 1.1.0 code is on the branch **`noormd-1.1.0-baseline`** (commit `1d99c14`),
and the 1.0.0 code is on `noormd-1.0.0-baseline`. Settings stay compatible: older versions
ignore the new `sourceFontSize`, `lineNumbers`, `wordWrap` and `syncScroll` keys.

## 1.1.0 — UX enhancements

Based on *NoorMD UX Enhancement Ideas*, phases A–C plus small items from priority 3. Tabs
(phase D) are proposed in [docs/TABS_DESIGN.md](docs/TABS_DESIGN.md) and not yet implemented.

- **Line width presets.** Comfortable (≈ 800 px), Wide (≈ 1100 px) and Full width (with 24–40 px
  side padding).
  - Reachable from a **↔ button** in the editor bar, **Ctrl+Shift+W**, the command palette and
    Preferences.
  - Applies in Focus mode and Markdown mode, and is remembered.
  - In 1.0.0 these presets existed only in Preferences, which made Focus mode look narrow.
- **Spellcheck on/off.** Use **Ctrl+Shift+Y**, the command palette or Preferences.
  - Turning it off also hides underlines that were already drawn. The text is never changed.
  - The language follows the languages installed in Windows. Use the right-click menu →
    "Add to dictionary" for project terms.
- **Compact layout.** Use **Ctrl+Shift+L**, the new **Compact** button or Preferences. The
  header is smaller and the sidebar stays. This is separate from Focus mode.
- **Fix: AltGr letters on Polish and other layouts.** AltGr+S (ś) was swallowed by the
  Ctrl+Alt+S snapshot shortcut. AltGr keystrokes are never treated as shortcuts now.
- The **keyboard-shortcut list** (F1) is searchable. It is generated from the command list,
  so it cannot drift from the real shortcuts.
- **About** shows the build date and a link to the source repository. There is also a new
  palette command, "Open the NoorMD repository".
- The **split divider** has a visible grip, and the Compact button shows when it is active.
- **Tests.** The UI suite went from 55 to 75 checks. The Windows self-test now covers width
  presets in Focus mode, the compact layout and spellcheck. There is a new unit test for
  settings compatibility between 1.0.0 and 1.1.0.

### Going back to 1.0.0

Nothing in 1.1.0 changes how documents, recovery drafts, snapshots or backups are stored.

1. **Run 1.0.0 again.** Keep the 1.0.0 zip, or rebuild it from the branch
   **`noormd-1.0.0-baseline`** (commit `18ee008`). Run its `NoorMD.exe` instead. Settings stay
   compatible both ways: 1.0.0 ignores the new `spellcheck` and `compact` keys in
   `%APPDATA%\NoorMD\settings.json`.
2. **Return the code to 1.0.0:**
   - `git checkout noormd-1.0.0-baseline` to look at it or build it.
   - `git revert <1.1.0 commits>` on your branch to undo the changes while keeping history.
   - `git reset --hard noormd-1.0.0-baseline` on a branch you own to throw them away.

## 1.0.0

First release: WPF + WebView2 desktop app implementing the NoorMD Desktop brief. See
[docs/TEST_REPORT.md](docs/TEST_REPORT.md).
