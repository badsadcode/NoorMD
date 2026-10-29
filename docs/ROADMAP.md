# NoorMD roadmap: ideas for later

Nothing here is scheduled. Each item still needs its own plan before work starts. The current work comes
first, and anything that conflicts with it waits.

## Done since this list was written

- Picture manager tools (stars, colour labels, tags, the date view, lossless turning): 2.0.0-preview.22.
- Batch convert / resize of pictures: preview.23.
- Music Bench in the middle: preview.24.
- Sound Bench MVP (presets, Quick controls, layers, live preview, A/B, variations, WAV export with recipes):
  preview.26. Next for it, from the concept: imported samples and granular texture, surface-specific
  weather (leaves, roof, window), a reference clip for A/B, stems, and OGG/FLAC export.
- Sound Bench effects racks and exact numeric entry (stage 1 of docs/concepts/SOUND_BENCH_EVOLUTION.md):
  preview.28. Stage 2, controls and modulators routed to any setting with drawn automation: preview.29. Stage 3,
  samples (a region editor on the waveform, stretch with pitch apart from speed, grain clouds, crossfaded loops):
  preview.30. Stage 4, feedback (meters with LUFS and true peak, a spectrogram, a loudness target, matched A/B
  and a reference clip): preview.31. Stage 5, first part (buses with sends, stems): preview.32; resonators:
  preview.33; convolution reverb (built-in and recorded spaces): preview.34; the Map (a view of the sound as
  connected blocks, each opening its editor): preview.35. Possible later, only if real use asks for connections the
  layers, buses and modulation can't make: an editable patching graph (a general signal graph in the engine, a new
  recipe format that still opens old recipes, and careful design so it stays usable).
- Texture Bench, stage 1 (procedural tileable materials, PBR maps, 3D preview, engine exports): preview.36.
  Stage 2 (photos as layers, painting from any layer, height and curvature masks, Sobel normals, horizon AO):
  preview.37. A better 3D preview (lights, clay and map views, parallax, zoom): preview.39. Stage 3, shapes and
  erosion (tiles, hexagons, planks, spots; rain, crumbling, wear): preview.40. Painting in NoorSketch as a layer of
  the recipe, the Gallery and the Vault: preview.41 (stage 3 complete). Export structures and game projects (also
  for the Sound Bench), pictures from the Gallery, new and random materials: preview.42. Full control of each
  map (the Maps tab) and of what is exported (which maps, normal convention, height bits, packed maps): preview.44.
  Blender-inspired additions (Musgrave, Voronoi distances, wave, gradient, checker, Magic, Blender's blend modes,
  ramp modes, colour ramps per layer, bump, offset): preview.45. Batch PBR from many albedo textures or photos
  (from the Gallery or picked), written with the export settings: preview.46. Later only if real use asks: a node view,
  animated noise, imported meshes for the preview.
- NoorSequencer, stage 1 (song grid of numbered patterns, piano roll with scale lock, drum grid, synth, drum kit
  and sample instruments, the Sound Bench's effects, mood templates, seamless loops, stems and MIDI): preview.47.
  Stage 2, help for non-musicians (chords of the key, progressions, rhythms, variations, presets, arpeggiator,
  humanize, LFO, FM, automation): preview.48. Stage 3, game music (adaptive layers, transitions, loop check, OGG,
  samples from the other benches, the Vault): preview.49. Ideas from LMMS (ghost notes, the computer keyboard as a
  piano with recording, slides and a place per note): preview.83. Acid bass (accent, filter decay), a Kick drum
  synth, drawn waves and a mixer with send buses and meters: preview.85. SoundFont (.sf2) instruments: preview.86. See [SEQUENCER_PLAN.md](SEQUENCER_PLAN.md).
- Connected benches (the concept's asset workflow): OGG from the Sound Bench, sounds and songs added to the Music
  Bench (playlist "Made in NoorMD"), sound recipes kept in and opened from the Vault: preview.50. Materials (Gallery,
  Vault) and songs (Vault) were connected earlier; samples for NoorSequencer come from the Sound and Music Benches.
- Calendar, stage 1 (entries, repeats, birthdays with ages, reminders in the app and near the clock, month, week
  and agenda views, search, .ics import and export): preview.52. Stage 2 (note links and agenda blocks, public
  holidays for 18 countries, "Next stream" and "This week" OBS overlays, the schedule as Discord, X or plain text and
  as a picture): preview.80. Days off (a vacation planner: drag across days, tinted days, work days counted):
  preview.82. See [CALENDAR_PLAN.md](CALENDAR_PLAN.md).
- Asset Bench, stage 1 (trees: skeleton growth, welded implicit wood with collars and root flare, merged, separate
  or mixed branches, leaf cards, clumps, wind data, levels of detail, GLB export checked by the Khronos validator,
  the 3D preview): preview.53. Next: stage 2 (rocks, realistic to hyper-realistic and stylized). See
  [ASSET_BENCH_PLAN.md](ASSET_BENCH_PLAN.md).
- Radio Bench: preview.25. HLS stations (streams cut into pieces: MPEG-TS, AAC, MP3 or fragmented MP4, live
  playlists followed, AES-128 decrypted, song titles from their tags) and the Music Bench's equalizer, limiter and
  even loudness shared with the radio (evened out live, as a station can't be measured ahead): preview.84.

- NoorForge (texturing a model with layers and smart masks, after Substance Painter's idea), stage 1 first cut:
  preview.87; stage 1 finished (height, a Godot material, smart materials of your own, one channel in the 3D view):
  preview.88; stage 2 (painting on the model: brush, eraser, mirror, straight lines, fill a part): preview.89; brush
  tips and a stencil: preview.90; stage 3 first part (masks following a layer, chips, drips, decals and text):
  preview.91; high-poly bakes, the Asset Bench's lower levels with the closest baked on, export presets per engine:
  preview.92; atlases and smaller copies for lower levels (stage 3 finished): preview.93. See
  [NOORFORGE_PLAN.md](NOORFORGE_PLAN.md).
- NoorSprite (pixel art and animation, after the ideas of Aseprite and LibreSprite), stage 1: preview.94; stage 2
  (shading, dithering, brushes from the sprite, outline, palette files, linked cels, RotSprite, Scale2x): preview.95;
  slices, reference layers, packed sheets, Godot SpriteFrames and scenes: preview.96; tilemap layers, tilesets and
  Godot TileSets: preview.97. See
  [NOORSPRITE_PLAN.md](NOORSPRITE_PLAN.md). NoorCanvas (a layered photo and painting editor) is planned in
  [NOORCANVAS_PLAN.md](NOORCANVAS_PLAN.md); NoorSketch stays the small sketchpad it is.

## Indie developer benches (concept)

See [concepts/INDIE_DEV_BENCHES.md](concepts/INDIE_DEV_BENCHES.md): Sound Bench (procedural SFX and
weather), Material/Texture Bench (procedural and image → PBR), NoorSequencer (a friendly composer).

Technical notes for when this is picked up:

- **Sound Bench:**
  - WebAudio can do layered noise, filters, envelopes, LFOs and seeded random events in real time.
  - `OfflineAudioContext` renders exact, repeatable WAV exports (same seed, same file).
  - The existing EQ (audiofx.js) and loudness code can be reused.
  - The MVP in the concept's order (wind and rain presets, seamless loops, WAV export) is realistic.
- **Material/Texture Bench:**
  - WebGL2 in the page can generate noise (Perlin/Simplex, Worley, fractal, domain warp) on the GPU.
  - It can derive normal, roughness and AO maps from height, and preview a lit plane, cube or sphere.
  - Recipes are small JSON files next to the exported PNGs, with the seed included.
  - Hand-painting goes through NoorSketch.
- **NoorSequencer:** built (stage 1, preview.47) with the song rendered by the app instead of WebAudio voices, so
  listening and export are the same sound and timing is exact without a scheduler.
- All three save recipes in the Vault and register their exports in the Gallery and Music Bench, so
  "make it in one bench, use it in another" works through the parts that already exist.
