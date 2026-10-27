# NoorMD roadmap: ideas for later

Nothing here is scheduled. Each item still needs its own plan before work starts. The current work comes
first, and anything that conflicts with it waits.

## Next candidates (small, near the existing benches)

- **Picture manager tools:** ratings and colour labels, tags on pictures, a date view, lossless rotation.
- **Batch picture work:** resize or convert a selection (PSD/PNG → JPG for the web) with name templates.
- **Music Bench in the middle:** a big artwork view with the lists beside it, like the Video Bench.

## Radio Bench: internet radio (idea)

Keep favourite internet radio stations and listen to them, in a panel that docks like the other benches.

- Stations are a name and a stream address (MP3/AAC/Ogg/HLS), added by hand or imported from .m3u/.pls.
  Optionally search the free, community-run Radio Browser directory. That would be online, opt-in, and
  only when searching.
- Favourites, groups or tags, recently played, and a sleep timer. The now-playing title comes from the
  stream (ICY metadata) where the station sends it, and can feed the Stream Desk's Now Playing overlay.
- Shares one player with the Music Bench (one sound at a time, the same EQ and loudness, the mini player).
- Technical notes:
  - Streams are played by the page.
  - Station addresses are checked like Apps Hub web links (http/https only).
  - Reading the song titles from the stream needs a small host-side relay, because browsers don't expose
    ICY metadata.
  - No recording or downloading of streams.

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
