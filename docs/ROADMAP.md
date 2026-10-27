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
  preview.28. Next stages from that proposal, one at a time and only after listening tests: a modulation matrix
  with automation (macros mapped to many targets), stronger sample work (crossfades, pitch apart from time,
  granular), a spectrogram and loudness-matched A/B, then optional buses, resonators and a node view.
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
