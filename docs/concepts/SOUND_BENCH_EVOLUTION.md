# NoorMD — NoorSound: Universal Sound Design Evolution

**Concept proposal for Sage**  
**Status:** Future design suggestions, **not an instruction to implement everything now**.  
**Product:** NoorMD ("Make It Done")  
**Scope:** Evolve the **existing NoorSound**, not add another bench or build an entire DAW.

## 1. The idea

NoorSound should be a **general-purpose, layered sound-design workstation** suitable for indie-game audio, UI effects, ambience, foley, mechanical noises, sci-fi, fantasy, creatures, and experimental synthesis. Wind and rain are useful examples, but **presets must not define the limits of the engine**.

The experience should work for two audiences at the same time:

- Someone without audio knowledge who wants to generate, tweak, compare and export a useful sound quickly.
- An advanced user who expects precise parameter entry, deep modulation, effect routing, sample editing, visual analysis and reproducible results.

**Design principle:** Easy to start; difficult to outgrow. Reveal complexity progressively without removing it.

### Existing foundation to preserve

Based on NoorMD **2.0.0-preview.27** source/changelog reviewed on GitHub, NoorSound already has useful building blocks. **Verify against the latest branch before planning work.** These include:

- Layered noise, event streams, synth voices, imported WAV sample layers, presets and a seeded generator.
- White/pink/brown noise, filters and sweeps, basic modulation, FM, pulse-width changes, pitch jumps, distortion/bitcrushing, trimming/reversing/looping samples.
- Quick controls, waveform, A/B comparison, undo/redo, variation generation, user presets, editable `.noorsound.json` recipes and WAV export.
- Automated tests and application self-tests.

**Do not rewrite or duplicate these simply to expand the feature list.** Extend and refine the underlying capability where it demonstrably helps.

---

## 2. Three views, one project and one audio engine

These are **views of the same sound**, not separate formats or separate applications.

### A. Quick Mode — create without DSP knowledge

- Pick a sound family or begin from a blank recipe.
- Descriptive controls such as *size/weight, energy, brightness, texture, movement, distance, space, damage/wear*.
- Generate, Mutate, Lock Parts, Save Preset, A/B and Export.
- A useful preview and just enough explanation of what each control does.
- Example: **Mechanical door** with sliders for *mass, motor speed, hydraulic pressure, wear and room size*.

Quick controls should map to **multiple real parameters** rather than applying arbitrary global EQ or loudness alone.

### B. Studio Mode — hands-on sound design

- Editable layered timeline with starts, fades, regions, trim, repeated events, and optional automation lanes.
- Each layer has full controls: gain, pan, mute, solo, envelopes, synthesizer or sample settings and effects rack.
- Effect chain order is editable; processors can be bypassed and wet/dry mixed.
- Groups/buses and optional send effects (for shared room reverb or delay).
- A detailed inspector with precise numeric input (Hz, dB, ms, semitones, percentage), reset and fine-adjustment controls.
- Visual waveform, spectrogram, and frequency analyzer; A/B level-matching to prevent louder from seeming automatically better.

### C. Lab Mode — expert DSP workspace (later/optional)

- An **optional node graph**, or similarly flexible signal-routing view.
- Source, filter, envelope, modulator, mixer, effect, control, and output nodes.
- Audio-rate vs control-rate modulation where appropriate; routing/mapping of one signal to many parameters.
- Advanced synthesis (FM/PM, additive/wavetable, granular, resonators, noise shaping) and custom effect chains.
- Parameter automation and detailed quality/performance settings.
- Safe graph validation and informative diagnostics for cycles, clipping, invalid values and expensive processors.

**Crucial behavior:** Moving between Quick, Studio and Lab must not flatten, discard, reset or destructively rewrite a sound. A Quick macro should have an explicit, reversible influence over deeper parameters. If a custom graph contains something Quick cannot fully represent, Quick should expose the mapped controls and preserve everything else untouched.

---

## 3. Core technical enhancements worth considering

### 3.1 Composable effects chains — **high priority**

Instead of a fixed set of controls attached to every source, consider modular and re-orderable processors:

- Parametric EQ (including shelves and high-/low-pass), notch, band-pass and resonant filters.
- Compressor, limiter, gate/expander, transient shaper, saturation/waveshaper and bitcrusher.
- Delay, chorus, flanger, phaser, tremolo, stereo tools and reverb.
- Bypass, wet/dry, input/output gain, preset storage and automation per effect.
- Per-layer racks first; shared buses/sends later if justified.

A flexible processing chain helps with **every** sound category, unlike adding more narrowly tailored generators.

### 3.2 Modulation matrix and automation — **high priority**

A powerful universal layer is the ability to route *control signals* into arbitrary sound parameters:

- ADSR and multistage envelopes, LFOs (including sample-and-hold), smoothed randomness, step sequencers and envelopes derived from audio level.
- Editable curves for pitch, filter cutoff, volume, pan, sample position, distortion amount, event density and effect parameters.
- Modulation polarity, amount, range, units, smoothing and optional tempo/time synchronization.
- One user-facing macro mapped to multiple targets, with individually adjustable response curves.
- Deterministic randomness with seeds so recipes and rendered variations are reproducible.

**Example:** A single *Motor RPM* control drives pitch, harmonic brightness, rattle density, vibration and loudness. *Rain Intensity* drives background noise, near-droplet density, runoff and canopy rustling with different responses.

### 3.3 Stronger sample manipulation and granular synthesis — **high priority**

Imported WAV layers already exist. Possible next steps:

- Waveform-based selection, nondestructive trims, crossfades, fades, loop-point editing and transient markers.
- Pitch shifting **independent** of playback duration, and time stretching with selectable quality.
- Sample interpolation quality settings and resampling safeguards.
- Granular playback: grain duration, overlap, density, jitter, random pitch, position scatter, reverse probability and stereo spread.
- Multiple sampled variants with randomized selection and velocity/intensity ranges.
- Later: sample slices, one-shot event sequencing and a tiny sample browser shared with NoorMusic.

Granular synthesis is useful for machinery, creature voices, organic textures, alien ambience and believable non-repeating variations. It should not be confused with simply slowing down a sample.

### 3.4 Richer synthesis, noise and resonators

- Band-limited basic oscillator waveforms; additional wavetable/additive modes if useful.
- More flexible FM/phase modulation with operator envelopes; controlled unison/detuning.
- Colored and band-limited noise with spectral shaping and smoothly time-varying filters.
- Resonators/modal synthesis approximating metal, glass, wood, hollow pipes, springs and vibrating objects.
- Physically *inspired* impacts (exciter + resonant body + decay), without promising accurate physical simulation.
- Rich event generators: Poisson/random, regular with jitter, bursts, clusters, conditional triggers and variation locks.

### 3.5 Acoustic space and game-audio preparation

- Better early reflections and room controls; convolution reverb using optional impulse-response files in a later phase.
- Frequency-dependent distance attenuation, occlusion/muffling and environmental response as **preview effects**.
- Simple movement/position automation where useful; keep stereo processing optional.
- Export **dry mono** assets when the game engine should perform 3D spatialization, alongside wet/stereo renders when requested.
- Consider layers or stems designed for adaptive environments, e.g. dry rain, foliage interaction, roof impacts and distant bed.

### 3.6 Waveform, spectrum and diagnostics

- A proper zoomable waveform with selection, region auditioning, loop markers and fades.
- Spectrogram (short-time FFT) with selectable frequency scale and time resolution.
- Frequency analyzer, peak/RMS and optional LUFS and true-peak meters.
- Clipping and DC-offset checks, unintended silence detection, and potential loop-click warnings.
- A/B and reference-file comparisons with optional loudness matching.
- Visual modulation preview: show *which controls actually change over time*.

### 3.7 Better DSP quality and performance

Consider technical improvements only where verified by tests/benchmarks:

- Anti-aliased/band-limited oscillators (e.g. PolyBLEP where suitable).
- Selective 2×/4× oversampling around nonlinear distortion and other alias-prone processing, rather than the entire graph.
- Stable biquad/state-variable filters with smoothly interpolated parameter changes, anti-zipper smoothing and denormal handling.
- High-quality sample interpolation and sample-rate conversion.
- Block-based engine processing; separation of control rate and audio rate where helpful.
- Background/offline rendering with progress, cancellation, bounded memory use, preview caching and responsiveness for longer audio.
- Deterministic render mode for regression tests and reproducibility.
- Quality tiers: responsive draft preview versus high-quality final offline render.

**Important:** Looping a rendered waveform without a click is useful, but an *unnoticeable repeating sound* is a more ambitious goal. Evaluate phase/spectral continuity, long-term motion and repetitive transients as well as the seam itself.

---

## 4. Universal "Sound Recipe Builder" (friendly front end)

Use semantic templates that **construct editable combinations of existing primitives**, rather than implementing every preset as a custom engine.

Examples:

| Recipe | Potential layers | Intuitive controls |
|---|---|---|
| Heavy door | motor, air pressure, metal impacts, resonance, room | mass, speed, wear, environment |
| Creature vocalization | imported vocal, resonators, noise, pitch modulation | size, aggression, roughness, distance |
| Footsteps | low impact, surface grit, clothing movement | surface, weight, speed, variation |
| Industrial engine | oscillators, harmonic buzz, vibration, rattles | RPM, load, age, mechanical health |
| Magic spell | tonal sweep, granular sparkle, sub impact, tail | energy, brightness, duration, character |
| Rain | diffuse noise, local drops, vegetation/roof impacts, runoff | intensity, wind, surface, shelter |

A preset should be **a starting recipe that experts can fully inspect and modify**, not a locked black box.

---

## 5. Deliverables and interoperability

- Keep the editable `.noorsound.json` recipe as the source of truth, with explicit schema versions/migrations.
- Export WAV at useful game-audio rates/bit depths (already supported); consider OGG/FLAC later if encoder/dependency/licensing choices make sense.
- Export full mix, optionally individual layers/stems, dry/wet versions, loop and one-shot variants.
- Render multiple seeded variations with consistent names and optional loudness targets.
- Preserve source references and enable portable asset bundling; show missing-file warnings rather than silently substituting data.
- Link finished assets into Vault, NoorMusic and project folders without duplicating everything by default.
- Avoid requiring cloud services or AI for core sound generation.

---

## 6. Architecture and compatibility safeguards

**Suggested conceptual signal path** (not a demand to rewrite existing code):

`Sources → Source modifiers → Per-layer effects → Groups/Sends → Master chain → Preview/Export`

Parallel **control/modulation paths** feed parameters at any appropriate stage. A macro maps to modulation targets; it should not destructively bake values into the underlying recipe.

Consider:

1. A versioned model for layers, processors, routings, automation curves, external samples and preset metadata.
2. Backward-compatible loading of preview.26/.27 recipes and migration tests before changing the schema.
3. Validated graphs, bounded CPU/memory use and non-finite parameter protection.
4. Careful sample-path access: import explicitly chosen files; recipes should not silently open arbitrary local paths.
5. No expensive DSP or graph rebuild on the UI thread; avoid glitches during preview.
6. Consistent user experience across panels and keyboard shortcuts.
7. A distinction between **core DSP utilities** and **individual presets**, so feature growth does not become a huge pile of one-off code.

---

## 7. Suggested development order (optional, staged)

This is an **evaluation sequence**, not a task list to execute immediately. NoorMD's polish/stability/release goals take priority.

| Stage | Explore | Why |
|---|---|---|
| 1 — Foundation | Modular per-layer effects and precise controls; inspect existing DSP for reusable pieces | Benefits almost every sound; comparatively contained |
| 2 — Expressiveness | Modulation matrix and automation lanes with Quick-macro mapping | Makes recipes evolve naturally over time |
| 3 — Samples | Crossfades, region editor, pitch/time separation, granular playback | Expands beyond synthetic-sounding SFX |
| 4 — Feedback | Spectrogram, better meters, reference/A-B loudness matching | Helps users understand and improve the sound |
| 5 — Advanced | Optional DSP graph, resonators, buses/sends, convolution, stems | Powerful, but requires care and UX validation |

**Do not implement all five stages in one push.** Prototype and evaluate each against a real set of sounds before deciding to proceed.

### Acceptance criteria worth testing

- Old sound recipes load and render with no unexpected changes (or with documented, opt-in migration).
- Quick ↔ Studio ↔ Lab switching never discards data or silently modifies a custom sound.
- A macro's routing is inspectable, reversible and does not create sudden parameter jumps.
- Identical recipe, seed, sample dependencies and quality settings produce reproducible output.
- Preset and user-defined sounds render without NaNs, DC offset, major unintended clipping, or unacceptable clicks.
- Mutations can preserve locked layers and remain perceptually related to the original.
- Preview stays responsive with several layers/effects; offline export is cancelable and bounded.
- Waveform, spectrum and meters agree with the exported audio.
- Critical tests include headphones/listening comparisons: objective audio measurements cannot tell whether a sound is convincing or pleasant.

---

## 8. The core recommendation

**Please consider evolving NoorSound into a three-level, universal sound-design tool: Quick, Studio and (optionally) Lab.** Preserve the beginner-friendly workflow, but let advanced users reach individual oscillators, samples, effects, modulation, automation and signal paths. Prioritize **extensibility and sonic quality over endlessly adding presets**.

The desired result is not another complicated professional DAW. It is a compact indie-developer tool that lets a beginner make useful audio in minutes and lets an experienced user keep refining the *same* sound without hitting a shallow ceiling.

**This document is a product/design suggestion for discussion and selective future adoption. It intentionally does not authorize immediate large-scale implementation.**
