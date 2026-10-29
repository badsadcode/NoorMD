# NoorSequencer: plan

Step 4–5 of [concepts/INDIE_DEV_BENCHES.md](concepts/INDIE_DEV_BENCHES.md): a friendly composer, between BeepBox and a
small DAW. Loops, jingles, ambient beds and simple soundtracks for people with little music theory. Built in
stages, like the Sound and Texture Benches; each stage is released and tried before the next.

## Principles

- **One engine for playing and exporting.** The song is a small JSON recipe (`.noorsong.json`); the app renders it
  (C#, in `NoorMD.Media`), the page plays the rendered audio. What you hear is what is exported, sample for sample.
  The Sound Bench's effects (EQ, compressor, delay, chorus, reverb…) are reused for tracks and the master.
- **Deterministic.** Noise in drums and synths is seeded, so the same song renders the same file.
- **BeepBox-like structure:** tracks (channels) × bars. Each track has numbered patterns (one bar of notes each),
  and the song is the grid of which pattern each track plays in each bar (0 = rest). Change a pattern once and
  every bar using it changes.
- **Friendly by default, deep when wanted:** scale lock and highlighted notes, mood templates and plain words first;
  every instrument and effect setting is there for those who want it.
- **Game-ready export:** seamless loops (reverb and release tails wrapped into the start), stems per track, MIDI,
  and the shared export layouts and game projects (music folders for Godot, Unity, Unreal).
- **No cloud, no AI requirement.** Musical help is rule-based and editable.

## Stage 1 — the composer (preview.47, done)

- **Song:** name, tempo (BPM), beats per bar, swing, key and scale, length in bars, a loop region.
- **Tracks:** synth, drums (a synthesised kit) or sample (a WAV you pick, played at any pitch); gain, pan, mute,
  solo; an effects chain (the Sound Bench's effects).
- **Instruments:** synth with sine, triangle, square, pulse, saw and noise; two detuned voices; ADSR; a filter with
  an envelope; vibrato; octave. Drum kit: kick, snare, clap, closed and open hi-hat, low and high tom, rim — each
  shaped by a few sliders. Sample: root note, loop, ADSR.
- **Editors:** the song grid (tracks × bars, pattern numbers); a piano roll for synth and sample tracks (scale
  notes highlighted, scale lock); a drum grid for drum tracks. Click to add, drag to lengthen, right-click or click
  again to remove; velocity; a note sounds when placed.
- **Playback:** play/stop (Space), from the start or the loop, the playhead in the grid and the editor, volume.
- **Templates:** a few mood starters (cozy exploration, tense dungeon, cheerful arcade, lonely ambient), and an
  empty song.
- **Export:** WAV (mix; stems; a seamless loop), MIDI (one track per track; drums on channel 10, General MIDI
  drum notes), the recipe beside them; the shared layouts and projects. Save and open songs; my songs.

## Stage 2 — help for non-musicians (preview.48, done)

- Chord helper (chords of the key with their mood in plain words), progressions; arpeggiator; rhythm generator;
  bass and harmony suggestions; humanize (timing and velocity); variation of a pattern without losing the original.
- Instrument editor: LFOs, unison width, FM; instrument presets with previews; automation of gain, filter and
  effects over the song.
- Done in preview.48: chords of the key with moods, nine progressions (with a bass line), eleven drum rhythms,
  variations, thirteen instrument presets, arpeggiator, humanize, LFO, FM, level and filter automation. Left for
  later: automating effects, unison width, a rhythm generator beyond the presets.

## Stage 3 — game music (preview.49, done)

- Adaptive layers (exploration, danger, combat) sharing tempo, with a transition preview and export per layer.
- Loop inspector (seam check), OGG export, samples from the Music Bench and Gallery, renders in the Vault.
- Done in preview.49: up to four layers chosen per track, one shared level and loop length, a transition preview
  (one loop, then the next layer fading in over 0–4 bars), each layer exported as its own loop; the loop check
  (seam, tail, both ends, hear the seam); OGG Vorbis (exact length, LOOPSTART/LOOPLENGTH tags); samples from the
  Sound Bench (rendered) and WAVs in the Music Bench library (the Gallery holds pictures, so it isn't a source); songs
  kept in the Vault's Music folder with an OGG, opening from the Vault. An ⤓ Export button at the top.

## Later (only if real use asks)

- Triplets and odd subdivisions, tempo changes, a mixer view, MIDI import.

## Fix (preview.72): playback carries on while you edit

An edit while the song (or the loop) played renders it again and swaps the audio, which pauses it; nothing started it
again, so adding a note stopped playback, and the ▶/■ button showed the pause, not what you asked for. The bench now
keeps whether you want it playing (from ▶ until ■, the song's end, another player, or closing the bench): after each
re-render it carries on from the same spot (also when several edits come quickly, while one render is still loading),
and the button shows ■ throughout. ■ cancels a re-render still due, so it never starts again by itself. UI test: an
edit while the loop plays renders again and keeps playing; ■ stops it for good.

## Ideas from LMMS (preview.83)

LMMS (an open-source music maker, GPL) was looked at for ideas only; nothing of its code is used.

- **Ghost notes:** the piano roll can show another track's pattern in the same bar, faded behind its own notes
  (to write a melody over the bass or the chords). Pick the track above the roll; a different octave setting is
  allowed for.
- **The computer keyboard as a piano:** with the roll focused, A S D F G H J K ; play the white keys and W E T Y U O P
  the black ones (by position, so other keyboard layouts work); Z and X change the octave (A plays C4 at first).
- **⏺ Record:** while the song plays, a key writes a note where the playhead is (if that bar plays the pattern on
  screen), as long as it was held; when stopped, notes are written one after another from where you last clicked, as
  long as new notes, and keys pressed together make a chord.
- **The chosen note:** a click on a note chooses it (a second click, or a right-click, removes it). Below the roll:
  **↗ Slide into the next note** — the note and the next one become one held note that glides to the next pitch
  (70 ms, no new attack), as on a 303 bass line, chains allowed; **Place** left to right (on top of the track's pan);
  and its velocity. MIDI export writes each pitch of a slide as a note of its own.

Also in preview.83: an edit while playing is rendered into a second player that takes over at the same spot (no stop
and no jump back), and rendered previews are served in byte ranges so seeking works however much has loaded.
