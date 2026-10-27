# NoorMD — Indie Developer Benches

**Status:** Future product/design concept. **Not** an instruction to implement immediately.

**Vision:** NoorMD remains a fast, comfortable creative workspace with connected, modestly scoped benches. It should help small indie developers create, edit, preview, organize, and export useful assets without requiring professional-level expertise. Each bench should be approachable in **Quick** mode, with deeper options available in **Advanced** mode.

## 1. Shared design principles

- **Connected, not isolated:** create an asset in one bench, use it immediately in another, and find it later through the Gallery/Library/Vault.
- **Non-destructive and reproducible:** preserve an editable project/recipe alongside exported files. Parameters and random seeds should be saved.
- **Beginner-friendly without a low ceiling:** descriptive presets, guided controls, tooltips, visual feedback, and optional advanced DSP/node/instrument editing.
- **Fast audition and iteration:** real-time preview when feasible; A/B comparisons, undo/redo, favourites, quick variations, preset saving.
- **Offline-first:** generation and editing should not depend on cloud services.
- **Small-tool philosophy:** avoid recreating Blender, Substance Designer, Photoshop, or a full-scale DAW inside NoorMD.
- **Reasonable performance:** progressive preview quality and background/offline export for expensive operations. Keep audio playback glitch-free.
- **Project-aware exports:** clear naming, folder templates, metadata, and convenient asset packaging for game projects.

---

## 2. Texture Bench + PBR Bench — One connected material workspace

Instead of two entirely independent apps, consider a shared **Material/Texture Bench**, offering multiple creation modes and one common preview/export pipeline. **Material Maker** is a useful reference for the procedural workflow, without needing to duplicate all its features.

### A. Image → Material (existing PBR idea)

Import an image or photograph and derive useful maps:
- Base color / albedo (from source or adjusted)
- Height and normal
- Roughness and ambient occlusion approximations
- Metallic and other masks where explicitly supplied or authored (do **not** assume metallic content can be reliably inferred from a photo)

Provide intuitive sliders for strength, detail scale, inversion, levels, filtering, and seamlessness. Make clear which generated maps are estimates and may require artistic correction.

### B. Procedural Material

Create materials without imported pictures:
- Perlin/Simplex-style gradient noise, value noise, Worley/Voronoi cellular patterns, fractals and turbulence
- Fractal octaves, frequency, lacunarity, persistence, seed, domain warp/distortion
- Shapes, stripes, tiles, scratches, cracks, masks, blending, gradients, erosion/weathering effects
- Seamless tileable output, multiple resolutions, preset variations
- Material presets: soil, mud, gravel, stone, wood, metal, bark, fabric, snow, stylized surfaces
- **Quick mode:** layered recipe stack, named sliders and visual presets
- **Advanced mode:** optional node graph linking generators, filters, masks, transforms and output maps

### C. Hybrid Material

Combine an imported source texture with generated noise, dirt, wear, cracks, scratches, and masks; then pass the result to PBR map authoring. It should be possible to hand-paint details in NoorSketch and come back without losing the procedural recipe.

### Preview and outputs

- Real-time PBR preview on plane, cube, sphere, and optionally an imported mesh; adjustable lighting and material tiling.
- Common export sizes and formats; grouped, consistently named maps with optional engine presets.
- Keep an editable material recipe (including source references, settings and seed), **not just the PNGs**.
- Later exploration: animated/flowing noise, lava/clouds/water normals, procedural masks, shader-oriented export.

---

## 3. NoorSequencer — BeepBox-inspired composer with samples

**Intent:** A friendly miniature composition workstation, more capable than a basic chiptune editor but less intimidating than a full DAW. A user with little music theory should be able to make loops, jingles, ambient beds and simple soundtracks.

### Composition and arrangement

- Accessible piano roll and step/pattern sequencer with note length, velocity, snapping, quantization and loop regions.
- Multiple tracks, patterns, song timeline, basic mixing (gain, pan, mute/solo) and automation.
- Drum grid, sample clips, one-shots, loops and basic sample slicing/trimming.
- Adjustable tempo, time signature, key, scale and swing.

### Instruments

- Synth oscillators: sine, square, triangle, saw, noise; later wavetable and FM.
- **Sample instruments:** import audio, map single or multiple samples across notes, tune, set loop points, envelopes and velocity response.
- **Hybrid instruments:** layer sample playback with synthesis for fuller timbres.
- Instrument shaping: ADSR, EQ/filters, resonance, LFO, vibrato, detune, unison/stereo spread as appropriate, distortion, chorus, delay and reverb.
- Save instrument presets and browse them with friendly descriptions and audio previews.

### Quality-of-life features for non-musicians

- **Scale lock and highlighted safe notes** (optional).
- **Chord helper:** suggested chords and progressions, with a simple explanation of their mood/function rather than theory jargon only.
- **Arpeggiator and rhythm generator:** create starter ideas from selected notes/tempo.
- **Smart bass suggestions and optional harmonies**, all editable.
- **Humanize:** controlled timing and velocity variation; **Variation:** mutate a selected pattern without destroying the original.
- Mood/style starter templates (e.g. lonely ambient, cozy exploration, tense dungeon, cheerful arcade).
- Beginner view shows creative intent (soft, bright, pulsing, spacious), advanced view exposes sound-engine parameters.
- No mandatory generative AI or cloud dependency. Musical assistance can be deterministic/rule-based.

### Game-friendly extras

- Seamless loop checking and export, WAV/OGG audio plus MIDI when applicable.
- Export individual tracks/stems as well as a final mix.
- Later: **adaptive music mode** with tempo-synchronized exploration, danger and combat layers and a simple transition preview.
- Drag samples from Music Bench / Gallery, and organize renders in the project Vault.

---

## 4. Sound Bench — Procedural SFX and ambience studio

**Core idea:** Go beyond arcade sound presets. Generate and sculpt sound effects and convincing environmental ambiences from synthesis, imported samples, layered noise, filters, envelopes and controlled randomization. The synthetic wind already made for Thornwake shows why this is worth exploring.

**Important principle:** EQ/filtering alone cannot make every synthetic noise realistic. Realism is usually the combination of **sound source**, **spectral shape**, **time variation**, **many small transient events**, **environmental context**, and (when beneficial) **quiet real-world recordings** layered underneath. The aim is controllable, believable game audio, not a claim of perfect physical simulation.

### 4.1 Two interfaces, one engine

**Quick / Describe the Sound**
- Pick a sound family (Wind, Rain, Thunder, Fire, Water, Nature, Footsteps, Machinery, UI, Sci-fi, etc.).
- Tweak descriptive controls such as: `gentle ↔ violent`, `near ↔ distant`, `indoors ↔ outdoors`, `soft ↔ sharp`, `dry ↔ wet`, `calm ↔ gusty`.
- Select a setting or surface: forest, field, alley, cave, rooftop, window, canvas tent, metal roof, dirt, leaves, stone, wood.
- Hit **Generate**, **Mutate**, **Make 5 variations**, **A/B**, **Save preset**, **Export**.

**Advanced / Sound Designer**
- Layer stack (and optional node view later): noise, oscillators, transient/event generators, imported samples, granular playback, filters, modulation, room/space effects.
- Waveform, spectral view, meters, parameter automation and seed control.
- Per-layer solo/mute, volume, spatial placement, envelopes, randomization ranges and wet/dry balance.
- Save the editable recipe with external sample references and licensing/source notes where applicable.

### 4.2 Sound-generation building blocks

**Sources**
- White, pink and brown/red noise; band-limited noise; simple oscillators; resonators.
- Filtered bursts and impulses for clicks, drops, impacts and crackles.
- Granular/sample playback to build texture from short recordings without obvious short-loop repetition.
- Random event streams (density, pitch, amplitude, spacing, stereo position), seeded for repeatable exports.

**Sound shaping**
- High-pass, low-pass, band-pass and notch filters; parametric EQ and shelving.
- Dynamic envelopes; transient shaping, gentle saturation/distortion and limiting where needed.
- Slow/fast LFO modulation for gusts, pulsing, tremolo, filter movement and stereo motion.
- Reverb, delay, early reflections and room impulse responses (advanced/future).
- Pitch/time adjustment for imported samples; multiband layering; simple distance/occlusion simulations.
- Natural variation that avoids mechanical repetition, abrupt volume jumps and excessive stereo motion.

**Practical editing**
- Basic sample trim, fade, normalize, reverse, crop, loop region and crossfade.
- Loop audition with automatic click detection, waveform continuity checks, and crossfade handles.
- Batch-generate related variants with controllable seed/intensity/surface differences.
- Dry/wet export, individual layers, final mix; consistent names and tags.

### 4.3 Weather as the flagship showcase

#### WIND — from acceptable synthesis to believable outdoor ambience

Layer several elements rather than pushing one filtered noise source:

1. **Background air movement:** broad, gently filtered pink/white noise, continuously fluctuating but not periodically cycling.
2. **Gusts:** slow, asymmetrical amplitude envelopes with correlated low-frequency filter changes; occasional stronger swells.
3. **Vegetation response:** separate, lighter high-frequency rustle/crackle layer that intensifies with gust strength; tree canopy, grass and bushes can sound different.
4. **Whistle around obstacles:** subtle resonant band-pass tones where appropriate (gaps, buildings, exposed ridges); avoid a constant synthetic whistle.
5. **Space/distance:** adjust high-frequency attenuation and diffuse stereo field for open fields versus sheltered woods.
6. **Optional real recording layer:** a quiet field-recorded noise bed can anchor synthesized motion in reality.

Presets could include `Gentle forest breeze`, `Open-field gusts`, `Storm through trees`, `Wind around ruins`, `Window draft`, `Desert wind`.

#### RAIN — a layered *soundscape*, not just static hiss

1. **Distant rain bed:** continuous, diffuse noise with intensity-dependent density/spectrum, never the only layer.
2. **Near droplets:** randomized tiny transient sounds with variable pitch, brightness, loudness and spacing, increasing in number as rainfall rises.
3. **Surface impacts:** separate wood/metal/roof/leaves/soil/stone/window/water profiles; mixed according to the player's environment.
4. **Runoff and splashes:** intermittent drip clusters, trickling, puddle splatter, gutter flow, with response to rain intensity and duration.
5. **Wind-driven rain:** gusts alter the balance, spectral energy, stereo direction and droplet density rather than simply raising master volume.
6. **Shelter:** outdoors → under a canopy → inside a building transitions change the rain bed, foreground patter and low-pass/occlusion, plus roof/window impacts.
7. **Thunder:** independent distant/near events with appropriate low rumble and decay; optional separate lightning-triggered playback.

**Intensity presets:** drizzle, shower, steady rain, downpour, storm. Transitions should be continuous where possible, with no obvious loop seams.

#### Additional procedural families

- Fire: bed of low flutter + irregular crackles + airflow; size and fuel-type variation.
- Rivers and waterfalls: broadband flows, bubbles/splashes, nearby water vs distant wash.
- Footsteps: material-specific sample/transient variants, speed and weight controls; procedural layering for grit, snow, mud or gravel.
- UI and arcade effects: clicks, pickups, alerts, lasers, explosions, retro/gamey presets.
- Machines: motor hum, mechanical cycles, friction, rattles, wear, speed changes.
- Creature and fantasy effects: layer animal recordings, pitch/formant-like changes, textured noise and modulation (avoid making all creatures sound identical).

### 4.4 Two export targets (important distinction)

**A. Rendered asset, first priority.** Produce high-quality WAV and optionally OGG/FLAC as supported: one-shots, seamless loops, long ambiences, or stems. Choose sample rate/bit depth (e.g. 48 kHz, 16/24-bit PCM); provide peak/loudness meters and sensible output level.

**B. Procedural live ambience, possible later extension.** Save a recipe that an *optional game-engine runtime* could evaluate and control with weather variables. This would require a compact runtime implementation or supported integration; a NoorMD preset cannot by itself make a Godot/raylib game synthesize sound. Offline rendered variations and stems are the practical first step.

For Thornwake-style dynamic audio, potential parameters could include:

| Gameplay parameter | Possible sound response |
| --- | --- |
| Wind speed and gust strength | Background level, gust frequency, canopy rustle, low-frequency energy |
| Wind direction relative to camera | Gentle stereo emphasis, never disorienting hard-panning |
| Rain intensity | Drop event density, diffuse rain bed, runoff, splash frequency |
| Surface under/near player | Leaf/soil/roof/window/stone/water impact blend |
| Indoors / under cover | Filtering, outdoor attenuation, roof patter, occlusion and room sound |
| Distance to river/sea | Level, HF attenuation and local splashes |

Presets should support smooth parameter transitions, sensible bounds, randomization without sudden clicks, and low CPU use if runtime synthesis is introduced later.

### 4.5 What makes it pleasant to use?

- **Listen while editing:** effects and layers update in near-real time.
- **A/B compare** against a reference clip, with level matching for fair comparison.
- **Presets and guided labels**: `More foliage`, `Heavier drops`, `Less synthetic`, `Further away`, `Inside tent`.
- **Mutate only selected properties:** change drop timing without changing the whole sound; lock tone but vary intensity, etc.
- **Three quality levels:** fast preview, standard, high-quality offline render.
- **Project export:** `/Audio/Weather/Rain_Heavy_01.wav`, plus recipe and descriptive tags.
- **Reuse existing audio benches:** audition files through Music Bench, annotate them in notes, store them in the Vault, and assign them to game assets.

---

## 5. Connected asset workflow

A plausible workflow:

1. Generate a tileable mud or stone texture with **Texture Bench** and preview its PBR maps.
2. Touch up details with **NoorSketch** and save editable materials to a project Vault.
3. Create footsteps and a rain ambience in **Sound Bench**, keeping both the renders and recipes.
4. Compose an exploration loop with **NoorSequencer**, perhaps using samples from **Music Bench**.
5. Preview, tag, compare and organize everything through **Gallery/Library** and attach references to Markdown design notes.
6. Export game-ready textures and audio using project-specific folder/naming presets.

## 6. Terminology and UI boundaries

- **Bench:** a persistent workspace such as Material/Texture Bench, Music Bench, Video Bench or Gallery.
- **Tool:** a focused workflow hosted by a bench: PBR Map Generator, Noise Generator, Sample Editor, SFX Generator, Loop Inspector, Pattern Sequencer.
- **Recipe/project:** source files and editable settings; **render/export:** finished asset.
- Allow panels/tabs to be rearranged, but avoid filling the main window with dozens of permanent tabs.

## 7. Suggested order — only if and when this is prioritized

1. **Sound Bench MVP:** layered noise/transient synth + wind/rain presets + EQ/filter/envelope + easy audition + seamless WAV loop and one-shot export.
2. **Sound Bench expansion:** imported samples, granular variation, surface-specific weather, A/B reference, batch variants and stems.
3. **Texture/PBR unification:** shared preview, noise layers, image-to-material and recipe presets; optional node editor later.
4. **NoorSequencer MVP:** pattern editor, synth voices, drum grid, sample tracks, scales, playback and WAV/MIDI export.
5. **NoorSequencer expansion:** detailed instrument editor, chord/rhythm tools, automation and adaptive-game-music stems.
6. **Optional runtimes/advanced workflows:** live procedural audio playback in games, fully node-based materials, advanced DSP and more export targets.

**Non-goal for now:** Replacing mature professional DAWs or material-authoring tools. Focus on *immediate creative usefulness*, simple interfaces and seamless reuse across NoorMD.

---

### Small guiding question

> Can a solo developer make an interesting material, a convincing ambient sound and a little musical loop in a single evening, without having to become a shader artist, audio engineer or musician first?

That should be the bar for these benches.
