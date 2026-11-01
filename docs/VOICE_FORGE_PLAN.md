# Voice Forge: voices in NoorSound

Voice Forge makes voices for games, films, animations and the like: invented speech, a character's own language,
feelings and their arcs, and sounds with no words (laughs, screams, grunts, sighs…). It is general: nothing in it is
tied to one game. It runs offline, with no recordings and no downloaded models.

## How it fits in NoorSound

A voice is a **layer** in a sound recipe, like a noise bed, a synth or a sample. So everything NoorSound already has
works for voices with no new screens: the preview and its waveform, A/B, 🎲 Variation (another take), Mutate,
the effects racks, buses, modulation, the master (reverb, loudness), export to WAV and OGG with several takes at once,
the recipe file beside them, the Vault, the Music Bench and NoorSequencer. The controls look and work like every other
bench's (the same sliders with number boxes, menus and buttons).

## The four parts, kept apart

| Part | In the layer |
|---|---|
| Who is speaking | Voice (a profile: built in or yours), pitch, pitch range, body size, breathiness, rasp, nasal, creature, clarity |
| What is said | Says (chatter, a greeting, questions, commands, arguing, complaining, a warning, muttering, celebrating, chanting; or a laugh, giggle, chuckle, crying, scream, yelp, grunt, groan, sigh, gasp, growl, panting, cheer, hmm), how long, language style and its words (a number: the same number, the same words), how much it keeps to its own words |
| How it is said | Feeling and its strength, the feeling it ends in (an arc), delivery (normal, whisper, shout, mumble, sing-song, robotic, breathless, hesitant), syllables per second, pauses, hesitation |
| What is done to the sound | The layer's filter, drive and effects, and everything after it in the recipe |

An emotion is not just louder or higher: it changes the pitch contour and its range, the speed, pauses, effort
(a brighter or softer voice), breath, tremor, creak, rasp and how long the vowels are.

## How it works

- **The synthesizer** (`NoorMD.Media/VoiceForge.cs`): a glottal pulse (with jitter and shimmer for rasp, creak for
  tired voices, every other period weaker for a growl) and breath noise go through five resonators (the formants of
  the mouth and throat), plus a nasal resonance, bands of noise for s, sh, f, x, bursts for p, t, k, a trill for rr and
  clicks. Body size moves all the formants (small: higher). It is stylized on purpose.
- **The planner**: phrases of words in the language style (its sounds, syllable shapes, word lengths, stress), with
  declination, accents on stressed syllables, phrase ends that rise for questions and fall for statements, pauses with
  breaths, fillers and stutters; sounds with no words have their own shapes (a laugh is "ha" units in groups with
  breaths in between, a scream a long rising-then-falling vowel…).
- **Repeatable**: the recipe's seed is the take (word choice, timing, small variations), the language's own number is
  its words, so one character keeps one language across every take and every line.

## Stages

1. **Done in preview.134**: the voice layer; 14 built-in voices and voices of your own (saved, chosen, removed);
   8 language styles; 10 kinds of speech and 14 sounds with no words; 14 feelings, an arc from one to another, 8
   deliveries; takes (🎲 Variation and several files at export); 20 presets (Voices); Generate › Voice and Vocal reaction.
2. **Recordings**: open or record a voice; find where it speaks; transforms that keep the words (pitch, body size,
   breath, rasp, creature, robot); then the recording's timing, pauses, loudness and pitch put onto invented speech.
3. **Spoken lines**: written text spoken by Windows' own voice (offline), with speed, pitch, emphasis and a list of how
   names and invented words are said. What it can't do (real emotion) is shown as not available, not faked.
4. **Later, optional**: neural speech and voice conversion (only for recordings you own or may use), several speakers in
   one recording, casts of characters.
