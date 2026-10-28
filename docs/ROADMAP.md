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
- Texture Bench, stage 1 (procedural tileable materials, PBR maps, 3D preview, engine exports): preview.36. Next
  stages in docs/TEXTURE_BENCH_PLAN.md: image → material and hybrid, then shapes, masks and NoorSketch round trips.
- Radio Bench: preview.25. Still open from its idea: one shared EQ and loudness with the Music Bench, and HLS
  stations (streams cut into pieces), which NoorMD doesn't play yet.

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
- **NoorSequencer:**
  - The pattern and piano-roll editor plus WebAudio synth and sample voices are the core.
  - MIDI export is simple.
  - Exact timing needs a look-ahead scheduler, the standard WebAudio "two clocks" approach.
- All three save recipes in the Vault and register their exports in the Gallery and Music Bench, so
  "make it in one bench, use it in another" works through the parts that already exist.
