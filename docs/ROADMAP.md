# NoorMD roadmap: ideas for later

Nothing here is scheduled. Each item still needs its own plan before work starts. The current work comes
first, and anything that conflicts with it waits.

## Done since this list was written

- NoorMesh (preview.153): pictures on materials (linked, packed, relinked when missing), drawn in the view, in GLB out
  and in; the 3D cursor dragged over the surface and typed.
- NoorMesh (preview.152), phase B2 begun: materials (colour, roughness, metallic) in slots, assigned per face, saved,
  exported to GLB and read back.
- NoorMesh (preview.151), phase B1 begun: seams, unwrap (conformal), Smart UV project, cube and view projections, island
  packing, the checker texture, a UV editor (islands selected and moved, turned, scaled).
- NoorMesh (preview.150): Edit Mode on several objects at once (Tab with several selected).
- NoorMesh (preview.149): the knife's points stay on the mesh (vertices, edges, edge middles, inside faces) whatever
  the view does; cuts run over the surface across faces.
- NoorMesh (preview.148): the 3D cursor (Shift+right-click, Shift+S, Shift+C), the pivot point menu, join, separate,
  origin tools.
- NoorMesh (preview.147): bevel (edges, vertices, segments), knife, proportional editing, mirror editing, edge and
  vertex slide (G twice), Shift+X/Y/Z scaling, auto merge vertices.
- NoorMesh (preview.146), phase A3 begun: move/rotate/scale gizmos (switched on or off), plane constraints, region inset,
  Ctrl+R loop cut and slide, bridge edge loops, snapping (steps, vertices).
- NoorMesh (preview.145), phase A4: .noormesh files (save, open, recent, a draft after a crash), GLB and OBJ export
  (+Y up, for engines) and import.
- NoorMesh (preview.144), phase A2: Edit Mode as Blender's (Tab; vertices, edges, faces; loops, linked; G/R/S, extrude,
  inset, delete, dissolve, merge, make face, normals, shading).
- NoorMesh (preview.143): Z up as in Blender (the floor X by Y, front view from −Y); during G/R/S the middle button held
  and moved picks the axis along the movement (a middle click frees it); right-click menus in NoorMesh and
  NoorForge no longer open the browser's own menu as well.
- NoorMesh (preview.142), phase A1: a new bench for modelling game meshes (Ctrl+Alt+N): the scene in Object Mode with
  Blender's keys, eight primitives, move/rotate/scale with axes and typed numbers, apply, undo. See
  [NOORMESH_PLAN.md](NOORMESH_PLAN.md).
- NoorForge (preview.141): Paints on the brush bar (Colour, Rough, Metal, Height, each with its value): paint any map
  straight onto the model, as in Substance Painter or Blender; each stroke keeps what it painted.
- NoorForge (preview.140): the layers' height as bumps in the normal map (Bumps slider), and a key light that follows
  the view so the relief reads from every side.
- NoorForge (preview.139): F / Shift+F show a flat circle in place; W: colour by hue, saturation and value and the
  brush's blend on paintings; a look-dev light in the view (metal, reflections); the stroke shown as it will be; the
  textured model's normal maps lit the right way (its tangents were turned over).
- NoorForge's brush bar (preview.138): one slim row (size, hardness and flow as small fields you drag), the rest under
  ⚙ floating over the view; F / Shift+F size or flow on the model; right-click: the brush at the cursor.
- NoorForge paintings (preview.137): a layer of pixels painted straight onto the model in any colour (as Blender's
  texture painting), blank or over the model's texture or a picture; the brush's colour, recent colours, a colour
  picker and a colour-only view; paint layers keep each stroke's colour. See [NOORFORGE_PLAN.md](NOORFORGE_PLAN.md).
- Voice Forge (preview.136): "How clear its own words are" for a voice from a recording: from as recorded, through
  mumbled and barely understandable, to no word left, with the voice, timing and melody kept.
- Voice Forge, stage 2 (preview.135): voices from recordings (picked, or recorded in NoorSound): its own words with
  another voice (pitch and body size apart, breath, rasp, creature, robot), invented words with its timing, pauses,
  loudness and melody, or a mix word by word. See [VOICE_FORGE_PLAN.md](VOICE_FORGE_PLAN.md).
- Voice Forge, stage 1 (preview.134): a voice layer in NoorSound: invented speech in a language of its own
  (8 styles; the same number, the same words), sounds with no words (laughs, screams, grunts, sighs…), 14 built-in
  voices and your own, feelings with arcs, deliveries, takes, presets and Generate. See
  [VOICE_FORGE_PLAN.md](VOICE_FORGE_PLAN.md).
- NoorGallery fixes (preview.133): opening a picture folder (or a folder holding only albums) from the list shows
  its folders and pictures instead of falling back to all pictures; a picture folder added inside another one is a
  folder in it, its albums placed by where they are on the disk, with the same names whichever of the two looked
  through them last; finding (or filtering) inside an album or folder looks through the albums in it too.
- NoorMaterial makes pictures that don't tile seamless (preview.132): a picture layer is made to tile by stitching
  (its edges covered with matching pieces from elsewhere in the picture, joined along the line where they differ
  least, so no see-through doubles; small steps of light along the joins are smoothed away over the whole tile, edges
  of shapes are kept) or by fading as before; "Match opposite edges" takes off a slope of light across the picture
  (one side lighter). Hand-painted pictures can be made to tile too (the switch now only keeps their light).
- NoorMaterial for hand-painted textures (preview.131): a picture layer can be marked Hand-painted (kept exactly as
  painted: no light evening, no seam blending; Layers › Add › A hand-painted texture); big pictures are averaged
  down so thin painted lines stay whole; and every map has finishing touches in the Maps tab (blur, sharpen,
  levels, middle, brightness, contrast, invert; the normal map blur and sharpen).
- NoorInk, stage 2 (preview.124): smart snapping and guides, the gradient tool (handles on the picture, colour
  stops), swatches, live effects (blur, drop shadow), text on a path, text to outlines and the system's fonts, stroke
  to path, grow and shrink, and tracing a picture into paths. See [NOORINK_PLAN.md](NOORINK_PLAN.md).
- NoorInk (preview.123): a vector editor (Ctrl+Alt+U, or Tools). Pictures are plain SVG: it opens SVG files from
  other programs (Inkscape layers, class and style-sheet styles, gradients, text, pictures, clip paths and masks; the
  app takes out scripts, embedded pages and links to other files first) and saves SVG they open. Tools: select
  (move, scale, turn), edit points (anchors and handles, smooth or corner, add a point), pen, pencil (smoothed into
  curves), rectangle (rounded corners), ellipse, polygon, star, line, text typed on the page, eyedropper. Fill (a
  colour or a gradient) and stroke (width, dashes, ends), opacity and blend modes; align and distribute; group,
  arrange, lock and hide; unite, subtract, intersect and exclude shapes, simplify, reverse; clip and mask; layers;
  export PNG; to NoorPhoto as pixels. Plan: [NOORINK_PLAN.md](NOORINK_PLAN.md).
- NoorPhoto: layer-style effects (shadows, glows, strokes, bevels) drawn in a blend mode now blend with what is under
  the layer (before, the mode made no difference).
- NoorPhoto painting (preview.122; ideas from Krita, no code): the mixer brush (wet paint that mixes with what is
  under it, or blends with no paint at all), bristle brushes, wet edges (watercolour), brush presets (eleven ready,
  and your own), a pop-up palette on right-click (colours and brushes at the cursor), painting guides (a ruler, a
  vanishing point, an ellipse) the brushes follow, mirror painting, wrap-around for seamless tiles, and reference
  pictures floating over the canvas (the eyedropper takes their colours).
- NoorPhoto, round three (preview.121): a histogram panel (mean, spread, middle); Export shows the file as it will be
  and its size (and Quick export as PNG); brush tips (round, square, chalk, spray) and dynamics (size, scatter,
  opacity, hue and lightness varying dab to dab); the history brush (paints back a state chosen in History);
  transform again (Ctrl+Shift+T); box blur; selective colour; pattern fill layers (ready-made or your own, Edit ›
  Define a pattern); Select › Subject (the main thing, found from how unlike the border it is).
- NoorPhoto, round two (preview.120; ideas from PhotoCraft, no code): layer styles (drop shadow, outer and inner
  glow, inner shadow, bevel and emboss, colour and gradient overlays, stroke; fill opacity; ready-made styles; copy
  and paste), live on any layer and drawn from its shape; shape layers that stay changeable (rectangle, rounded,
  ellipse, polygon, star, line) and a pen for curved paths, with their fill, stroke and dashes in Properties and free
  transform that keeps them shapes; text typed right on the picture, as a line or in a box the words wrap in.
- NoorPhoto (preview.119): a layered photo and painting editor (Ctrl+Alt+J, or Tools). Pixel, group, fill, adjustment
  and text layers with 27 blend modes, opacity, masks and clipping; brushes with pen pressure, the clone stamp,
  healing, smudge / blur / sharpen and dodge / burn / sponge; selections (rectangle, ellipse, lasso, straight lines,
  magic wand, colour range, quick mask, grow / shrink / feather); free transform with perspective; crop; gradients,
  shapes and text. Filters (blur: Gaussian, motion, zoom, spin, lens, surface, median, tilt-shift, iris; sharpen:
  unsharp mask, sharpen, high pass, clarity; noise, grain, reduce noise, dust; stylize: emboss, edges, glow, dreamy
  glow, oil paint, pixelate, halftone, vignette, chromatic aberration, glitch, solarize, pencil sketch; distort:
  offset, twirl, pinch, ripple, lens distortion, polar; render: clouds, lens flare), each applied to the pixels or kept
  as a live filter; 17 adjustments, applied or kept as adjustment layers. Several pictures at once (tabs), a history
  panel, .noorphoto and PSD (open and save), PNG / JPEG / WebP / TIFF, from NoorGallery, to NoorMaterial. Next
  (stage 2–3 in [NOORPHOTO_PLAN.md](NOORPHOTO_PLAN.md)): liquify, editable shapes, 16-bit documents, content-aware fill.
- Languages (preview.118): Polish, German, French and Spanish (drafts) beside English, chosen in Preferences; the
  page changes at once, the app's dialogs at the next start; your own translations (or corrections) in
  Documents\NoorMD\Translations, from a file Preferences makes with every text. Not yet translated: NoorSketch's
  window and the stream and video pop-out windows.
- One family of names (preview.116): Asset Bench is NoorForm, Texture Bench NoorMaterial, Sound Bench NoorSound,
  Music Bench NoorMusic, Video Bench NoorVideo, Gallery NoorGallery, Radio NoorRadio, Voice notes NoorVoice, Stream
  Desk NoorStream, Calendar NoorCalendar and Apps Hub NoorHub; the planned NoorCanvas is NoorPhoto
  ([NOORPHOTO_PLAN.md](NOORPHOTO_PLAN.md)), NoorInk (vector graphics) came in preview.123,
  and NoorMesh (low-poly modelling) is planned. Files, folders and recipes are as they were. See the table in the README.
- Number fields everywhere (preview.114): the mouse wheel over one turns its value (Shift: ten steps), and arrows at
  its right end step it (held: they keep going), within the field's own limits.
- Benches as apps (preview.114): in focus mode (F11) a bench in the middle has the whole window and the menu bar
  becomes its own — NoorSprite, NoorForge, NoorSequencer, NoorMaterial, NoorSound and NoorForm each
  with menus for its own work (File, Edit, and Sprite / Layer / Paint / Bake / Song / Track / Pattern / Transport /
  Material / Sound / Play / Generate as fits it), View with its options ticked, Help with its shortcuts, and its
  own settings where it has defaults worth keeping; leaving focus mode brings NoorMD's menus back.
- Picture manager tools (stars, colour labels, tags, the date view, lossless turning): 2.0.0-preview.22.
- Batch convert / resize of pictures: preview.23.
- NoorMusic in the middle: preview.24.
- NoorSound MVP (presets, Quick controls, layers, live preview, A/B, variations, WAV export with recipes):
  preview.26. Next for it, from the concept: imported samples and granular texture, surface-specific
  weather (leaves, roof, window), a reference clip for A/B, stems, and OGG/FLAC export.
- NoorSound effects racks and exact numeric entry (stage 1 of docs/concepts/SOUND_BENCH_EVOLUTION.md):
  preview.28. Stage 2, controls and modulators routed to any setting with drawn automation: preview.29. Stage 3,
  samples (a region editor on the waveform, stretch with pitch apart from speed, grain clouds, crossfaded loops):
  preview.30. Stage 4, feedback (meters with LUFS and true peak, a spectrogram, a loudness target, matched A/B
  and a reference clip): preview.31. Stage 5, first part (buses with sends, stems): preview.32; resonators:
  preview.33; convolution reverb (built-in and recorded spaces): preview.34; the Map (a view of the sound as
  connected blocks, each opening its editor): preview.35. Possible later, only if real use asks for connections the
  layers, buses and modulation can't make: an editable patching graph (a general signal graph in the engine, a new
  recipe format that still opens old recipes, and careful design so it stays usable).
- NoorMaterial, stage 1 (procedural tileable materials, PBR maps, 3D preview, engine exports): preview.36.
  Stage 2 (photos as layers, painting from any layer, height and curvature masks, Sobel normals, horizon AO):
  preview.37. A better 3D preview (lights, clay and map views, parallax, zoom): preview.39. Stage 3, shapes and
  erosion (tiles, hexagons, planks, spots; rain, crumbling, wear): preview.40. Painting in NoorSketch as a layer of
  the recipe, NoorGallery and the Vault: preview.41 (stage 3 complete). Export structures and game projects (also
  for NoorSound), pictures from NoorGallery, new and random materials: preview.42. Full control of each
  map (the Maps tab) and of what is exported (which maps, normal convention, height bits, packed maps): preview.44.
  Blender-inspired additions (Musgrave, Voronoi distances, wave, gradient, checker, Magic, Blender's blend modes,
  ramp modes, colour ramps per layer, bump, offset): preview.45. Batch PBR from many albedo textures or photos
  (from NoorGallery or picked), written with the export settings: preview.46. Later only if real use asks: a node view,
  animated noise, imported meshes for the preview.
- NoorSequencer, stage 1 (song grid of numbered patterns, piano roll with scale lock, drum grid, synth, drum kit
  and sample instruments, NoorSound's effects, mood templates, seamless loops, stems and MIDI): preview.47.
  Stage 2, help for non-musicians (chords of the key, progressions, rhythms, variations, presets, arpeggiator,
  humanize, LFO, FM, automation): preview.48. Stage 3, game music (adaptive layers, transitions, loop check, OGG,
  samples from the other benches, the Vault): preview.49. Ideas from LMMS (ghost notes, the computer keyboard as a
  piano with recording, slides and a place per note): preview.83. Acid bass (accent, filter decay), a Kick drum
  synth, drawn waves and a mixer with send buses and meters: preview.85. SoundFont (.sf2) instruments: preview.86. See [SEQUENCER_PLAN.md](SEQUENCER_PLAN.md).
- Connected benches (the concept's asset workflow): OGG from NoorSound, sounds and songs added to the Music
  Bench (playlist "Made in NoorMD"), sound recipes kept in and opened from the Vault: preview.50. Materials (NoorGallery,
  Vault) and songs (Vault) were connected earlier; samples for NoorSequencer come from the Sound and Music Benches.
- NoorCalendar, stage 1 (entries, repeats, birthdays with ages, reminders in the app and near the clock, month, week
  and agenda views, search, .ics import and export): preview.52. Stage 2 (note links and agenda blocks, public
  holidays for 18 countries, "Next stream" and "This week" OBS overlays, the schedule as Discord, X or plain text and
  as a picture): preview.80. Days off (a vacation planner: drag across days, tinted days, work days counted):
  preview.82. See [CALENDAR_PLAN.md](CALENDAR_PLAN.md).
- NoorForm, stage 1 (trees: skeleton growth, welded implicit wood with collars and root flare, merged, separate
  or mixed branches, leaf cards, clumps, wind data, levels of detail, GLB export checked by the Khronos validator,
  the 3D preview): preview.53. Next: stage 2 (rocks, realistic to hyper-realistic and stylized). See
  [ASSET_BENCH_PLAN.md](ASSET_BENCH_PLAN.md).
- NoorRadio: preview.25. HLS stations (streams cut into pieces: MPEG-TS, AAC, MP3 or fragmented MP4, live
  playlists followed, AES-128 decrypted, song titles from their tags) and NoorMusic's equalizer, limiter and
  even loudness shared with the radio (evened out live, as a station can't be measured ahead): preview.84.

- NoorForge (texturing a model with layers and smart masks, after Substance Painter's idea), stage 1 first cut:
  preview.87; stage 1 finished (height, a Godot material, smart materials of your own, one channel in the 3D view):
  preview.88; stage 2 (painting on the model: brush, eraser, mirror, straight lines, fill a part): preview.89; brush
  tips and a stencil: preview.90; stage 3 first part (masks following a layer, chips, drips, decals and text):
  preview.91; high-poly bakes, NoorForm's lower levels with the closest baked on, export presets per engine:
  preview.92; atlases and smaller copies for lower levels (stage 3 finished): preview.93. See
  [NOORFORGE_PLAN.md](NOORFORGE_PLAN.md).
- NoorSprite (pixel art and animation, after the ideas of Aseprite and LibreSprite), stage 1: preview.94; stage 2
  (shading, dithering, brushes from the sprite, outline, palette files, linked cels, RotSprite, Scale2x): preview.95;
  slices, reference layers, packed sheets, Godot SpriteFrames and scenes: preview.96; tilemap layers, tilesets and
  Godot TileSets: preview.97; in-betweens and frame timing: preview.98; smooth lines, indexed colour and colour
  cycling, tiling, free and radial symmetry, turned tiles: preview.99; layer groups, gradients, pattern fills, squash
  and smear in-betweens: preview.100; the motion path, onion skin by tag and as outlines, a timeline of thumbnails
  and dragged frames, terrains (autotiling), every map layer in one Godot scene, hitboxes, Unity and Paper2D
  exports: preview.102; NoorForge decals, NoorMaterial, frame sounds, sprites in NoorGallery, the command search,
  shortcuts of one's own, a floating reference, pen pressure: preview.103; sprites shown in notes: preview.104;
  sprites playing in notes, hue-shifted ramps, auto shading, colour-blind views, Lospec palettes: preview.105;
  bones (cutout animation): preview.106; normal maps and a lit view: preview.107; clean slopes, curves, doubled
  corners, a live outline, motion templates: preview.108; a sound to animate to, bitmap fonts, clean-ups, a picture
  made pixel art: preview.109; sharing as GIF or video, a live link to a game project, atlases of many sprites,
  level markers: preview.110; turn-arounds and directions, isometric boxes and tiles, collision shapes, readability
  checks: preview.112; sprite stacking, effects, a scene to try animations in, seams, timelapses, contact sheets,
  snapshots, shared palettes: preview.113. See
  [NOORSPRITE_PLAN.md](NOORSPRITE_PLAN.md). NoorPhoto (a layered photo and painting editor) came in preview.119
  ([NOORPHOTO_PLAN.md](NOORPHOTO_PLAN.md)); NoorSketch stays the small sketchpad it is.

## Indie developer benches (concept)

See [concepts/INDIE_DEV_BENCHES.md](concepts/INDIE_DEV_BENCHES.md): NoorSound (procedural SFX and
weather), Material/NoorMaterial (procedural and image → PBR), NoorSequencer (a friendly composer).

Technical notes for when this is picked up:

- **NoorSound:**
  - WebAudio can do layered noise, filters, envelopes, LFOs and seeded random events in real time.
  - `OfflineAudioContext` renders exact, repeatable WAV exports (same seed, same file).
  - The existing EQ (audiofx.js) and loudness code can be reused.
  - The MVP in the concept's order (wind and rain presets, seamless loops, WAV export) is realistic.
- **Material/NoorMaterial:**
  - WebGL2 in the page can generate noise (Perlin/Simplex, Worley, fractal, domain warp) on the GPU.
  - It can derive normal, roughness and AO maps from height, and preview a lit plane, cube or sphere.
  - Recipes are small JSON files next to the exported PNGs, with the seed included.
  - Hand-painting goes through NoorSketch.
- **NoorSequencer:** built (stage 1, preview.47) with the song rendered by the app instead of WebAudio voices, so
  listening and export are the same sound and timing is exact without a scheduler.
- All three save recipes in the Vault and register their exports in NoorGallery and NoorMusic, so
  "make it in one bench, use it in another" works through the parts that already exist.
