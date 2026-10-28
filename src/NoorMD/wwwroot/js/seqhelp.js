// NoorSequencer's musical help for people with little music theory: the chords of the song's key with their mood in
// plain words, chord progressions, drum rhythms, variations of a pattern and instrument presets. All rule-based and
// plain data: what they write is ordinary notes, changed like any other.
window.NoorSeqHelp = (() => {
  'use strict';

  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    'harmonic-minor': [0, 2, 3, 5, 7, 8, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], 'major-pentatonic': [0, 2, 4, 7, 9], 'minor-pentatonic': [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  // Chords are built on a seven-note scale: pentatonic, blues and chromatic songs use the one they come from.
  const PARENT = { 'major-pentatonic': 'major', 'minor-pentatonic': 'minor', blues: 'minor', chromatic: 'major' };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  // What each chord tends to feel like, by its place in a major or a minor key.
  const MOOD_MAJOR = ['home, settled', 'gentle, moving on', 'soft, wistful', 'warm, lifting', 'tension: wants to go home', 'sad, tender', 'unstable, on edge'];
  const MOOD_MINOR = ['home, dark', 'uneasy', 'hopeful', 'sad, longing', 'soft tension', 'warm, epic', 'heroic, lifting'];
  const QUALITY_MOOD = { major: 'bright', minor: 'soft, sad', dim: 'tense', aug: 'strange, dreamy' };

  const sevenOf = (scale) => SCALES[PARENT[scale] || scale] || SCALES.minor;
  const isMinorKey = (scale) => sevenOf(scale)[2] === 3;

  /** The triad on a degree (0–6) of the song's key: its notes (around middle C), name, numeral and mood. */
  function chord(key, scale, degree) {
    const s = sevenOf(scale);
    const at = (d) => s[d % 7] + 12 * Math.floor(d / 7);
    const intervals = [0, at(degree + 2) - at(degree), at(degree + 4) - at(degree)];
    const quality = intervals[1] === 4 ? (intervals[2] === 8 ? 'aug' : 'major') : intervals[2] === 6 ? 'dim' : 'minor';
    // The root between F3 and E4, so chords sit in the middle of the keyboard and don't jump around.
    let root = 48 + ((key + s[degree]) % 12);
    if (root < 53) root += 12;
    const numeral = (quality === 'major' || quality === 'aug' ? ROMAN[degree] : ROMAN[degree].toLowerCase()) + (quality === 'dim' ? '°' : quality === 'aug' ? '+' : '');
    const name = NAMES[(key + s[degree]) % 12] + (quality === 'minor' ? 'm' : quality === 'dim' ? 'dim' : quality === 'aug' ? 'aug' : '');
    const moods = isMinorKey(scale) && scale !== 'dorian' ? MOOD_MINOR : scale === 'major' || scale === 'major-pentatonic' || scale === 'chromatic' ? MOOD_MAJOR : null;
    return { degree, root, notes: intervals.map((i) => root + i), bass: root - 12, quality, numeral, name, mood: moods ? moods[degree] : QUALITY_MOOD[quality] };
  }

  const chords = (key, scale) => [0, 1, 2, 3, 4, 5, 6].map((d) => chord(key, scale, d));

  /** Progressions, in degrees of the key, with what they are good for. */
  const PROGRESSIONS = [
    { id: 'hopeful', name: 'Hopeful (I–V–vi–IV)', mood: 'bright, uplifting: the pop progression', degrees: [0, 4, 5, 3] },
    { id: 'tender', name: 'Sad and tender (vi–IV–I–V)', mood: 'bittersweet, emotional', degrees: [5, 3, 0, 4] },
    { id: 'classic', name: 'Classic (I–IV–V–I)', mood: 'simple, folk, resolved', degrees: [0, 3, 4, 0] },
    { id: 'dreamy', name: 'Dreamy (I–iii–vi–IV)', mood: 'floating, nostalgic', degrees: [0, 2, 5, 3] },
    { id: 'calm', name: 'Calm sway (I–IV)', mood: 'peaceful, for exploration', degrees: [0, 3] },
    { id: 'epic', name: 'Epic (i–VI–III–VII)', mood: 'heroic, adventure (minor keys)', degrees: [0, 5, 2, 6] },
    { id: 'dark', name: 'Dark march (i–iv–v–i)', mood: 'grim, determined (minor keys)', degrees: [0, 3, 4, 0] },
    { id: 'mystery', name: 'Mystery (i–VII–VI–VII)', mood: 'searching, unresolved (minor keys)', degrees: [0, 6, 5, 6] },
    { id: 'tension', name: 'Rising tension (i–ii°–V)', mood: 'danger approaching', degrees: [0, 1, 4, 4] },
  ];

  /**
   * The notes of one bar for a chord, in a style: 'held' (the whole bar), 'beats' (struck on each beat), 'offbeat'
   * (between the beats, a skank), or 'bass' (its root, low, on the first and third beat).
   */
  function chordBar(c, style, steps, velocity = 0.7) {
    const notes = [];
    const add = (step, length, pitches, v = velocity) => pitches.forEach((pitch) => notes.push({ step, length, pitch, velocity: v }));
    if (style === 'beats') for (let s = 0; s < steps; s += 4) add(s, 3, c.notes, s === 0 ? velocity : velocity * 0.8);
    else if (style === 'offbeat') for (let s = 2; s < steps; s += 4) add(s, 2, c.notes);
    else if (style === 'bass') { add(0, Math.min(6, steps), [c.bass], 0.85); if (steps >= 12) add(8, Math.min(6, steps - 8), [c.bass], 0.75); }
    else add(0, steps, c.notes);
    return { notes: notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch) };
  }

  /** Drum rhythms: rows of the kit (0 kick, 1 snare, 2 clap, 3 closed hat, 4 open hat, 5 low tom, 6 high tom, 7 rim). x = hit, o = soft. */
  const RHYTHMS = [
    { id: 'four', name: 'Four on the floor (dance)', beats: 4, rows: { 0: 'x...x...x...x...', 2: '....x.......x...', 3: '..x...x...x...x.', 4: '..............o.' } },
    { id: 'rock', name: 'Rock beat', beats: 4, rows: { 0: 'x.......x.x.....', 1: '....x.......x...', 3: 'x.x.x.x.x.x.x.x.' } },
    { id: 'half', name: 'Half-time (heavy, slow)', beats: 4, rows: { 0: 'x.........x.....', 1: '........x.......', 3: 'x...x...x...x...' } },
    { id: 'hiphop', name: 'Hip-hop (laid back)', beats: 4, rows: { 0: 'x......x..x.....', 1: '....x.......x...', 3: 'x.x.x.x.x.x.x.xo' } },
    { id: 'chip', name: 'Chiptune drive', beats: 4, rows: { 0: 'x...x...x...x...', 1: '....x.......x..x', 3: 'xoxoxoxoxoxoxoxo' } },
    { id: 'march', name: 'March', beats: 4, rows: { 0: 'x.......x.......', 1: 'x..xx...x.x.x.xx' } },
    { id: 'shuffle', name: 'Shuffle (use swing)', beats: 4, rows: { 0: 'x.....x.x.......', 1: '....x.......x...', 3: 'x.ox.ox.ox.ox.o.' } },
    { id: 'bossa', name: 'Bossa nova', beats: 4, rows: { 0: 'x..xx..xx..xx..x', 7: 'x..x..x...x..x..', 3: 'xxxxxxxxxxxxxxxx' } },
    { id: 'tribal', name: 'Tribal toms', beats: 4, rows: { 0: 'x.....x...x.....', 5: '..x.x...x...x.xx', 6: '.x.....x.....x..' } },
    { id: 'waltz', name: 'Waltz (3/4)', beats: 3, rows: { 0: 'x...........', 3: '....x...x...', 7: '....o...o...' } },
    { id: 'heartbeat', name: 'Heartbeat (tension)', beats: 4, rows: { 0: 'x.x.............', 5: '........o.......' } },
  ];

  /** A rhythm as one bar of notes for a song with this many beats per bar (repeated or cut to fit). */
  function rhythmBar(id, beatsPerBar) {
    const r = RHYTHMS.find((x) => x.id === id) || RHYTHMS[0];
    const steps = beatsPerBar * 4;
    const notes = [];
    for (const [row, hits] of Object.entries(r.rows)) {
      for (let s = 0; s < steps; s++) {
        const c = hits[s % hits.length];
        if (c === 'x' || c === 'o') notes.push({ step: s, length: 1, pitch: Number(row), velocity: c === 'x' ? 0.9 : 0.45 });
      }
    }
    return { notes: notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch) };
  }

  /** A small seeded random generator (mulberry32), so a variation can be repeated in tests. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /**
   * A variation of a pattern that keeps its character: a melody gets some notes moved a step of the scale, a few
   * rhythms nudged; drums get a few hats and ghost notes added or dropped. The original pattern is not touched.
   */
  function vary(pattern, kind, key, scale, steps, seed, amount = 0.3) {
    const rand = rng(seed);
    const notes = pattern.notes.map((n) => ({ ...n }));
    if (kind === 'drums') {
      const out = notes.filter((n) => !(n.pitch >= 3 && rand() < amount * 0.5)); // a few hats or toms dropped
      for (let s = 0; s < steps; s++) {
        if (rand() < amount * 0.25 && !out.some((n) => n.step === s && n.pitch === 3)) out.push({ step: s, length: 1, pitch: 3, velocity: 0.45 });
        if (s % 4 === 3 && rand() < amount * 0.2 && !out.some((n) => n.step === s && n.pitch === 1)) out.push({ step: s, length: 1, pitch: 1, velocity: 0.35 }); // a ghost snare
      }
      return { notes: out.sort((a, b) => a.step - b.step || a.pitch - b.pitch) };
    }
    const s = SCALES[scale] || SCALES.minor;
    const inScale = (p) => s.includes((((p - key) % 12) + 12) % 12);
    const moveBy = (p, d) => { let q = p; for (let k = 0; k < Math.abs(d); k++) { do { q += Math.sign(d); } while (!inScale(q) && q > 0 && q < 127); } return q; };
    for (const n of notes) {
      if (rand() < amount) n.pitch = Math.max(0, Math.min(127, moveBy(n.pitch, rand() < 0.5 ? -1 : 1)));
      // Sometimes a long note is split in two (a rhythm change that keeps the melody).
      if (n.length >= 4 && rand() < amount * 0.5) { const half = Math.floor(n.length / 2); notes.push({ ...n, step: n.step + half, length: n.length - half, pitch: moveBy(n.pitch, rand() < 0.5 ? -1 : 1) }); n.length = half; }
    }
    return { notes: notes.filter((n) => n.step < steps).sort((a, b) => a.step - b.step || a.pitch - b.pitch) };
  }

  /** Instrument presets for synth tracks: a starting point, every setting still there to change. */
  const PRESETS = [
    { id: 'pluck', name: 'Pluck (harp, guitar-ish)', ins: { wave: 'saw', detune: 4, attack: 0.002, decay: 0.25, sustain: 0, release: 0.2, cutoff: 1800, resonance: 1.2, filterEnvelope: 2.5, vibrato: 0 } },
    { id: 'piano', name: 'Soft keys (electric piano)', ins: { wave: 'sine', detune: 3, attack: 0.003, decay: 1.2, sustain: 0.2, release: 0.4, cutoff: 6000, fmRatio: 1, fmDepth: 1.5, vibrato: 0 } },
    { id: 'bell', name: 'Bell (music box, chimes)', ins: { wave: 'sine', detune: 2, octave: 1, attack: 0.001, decay: 1.8, sustain: 0, release: 1.5, cutoff: 12000, fmRatio: 3.5, fmDepth: 3, vibrato: 0 } },
    { id: 'pad', name: 'Warm pad', ins: { wave: 'saw', detune: 16, attack: 0.8, decay: 1, sustain: 0.8, release: 1.6, cutoff: 1100, resonance: 0.8, filterEnvelope: 0.5, vibrato: 4, vibratoRate: 0.6 } },
    { id: 'strings', name: 'Strings (slow bow)', ins: { wave: 'saw', detune: 12, attack: 0.35, decay: 0.5, sustain: 0.85, release: 0.6, cutoff: 2600, resonance: 0.7, vibrato: 10, vibratoRate: 5.5 } },
    { id: 'flute', name: 'Flute', ins: { wave: 'triangle', detune: 0, attack: 0.06, decay: 0.2, sustain: 0.85, release: 0.15, cutoff: 5000, vibrato: 14, vibratoRate: 5 } },
    { id: 'organ', name: 'Organ', ins: { wave: 'square', detune: 5, attack: 0.01, decay: 0.1, sustain: 1, release: 0.08, cutoff: 3200, vibrato: 0, lfo: 'volume', lfoRate: 6, lfoDepth: 0.15 } },
    { id: 'chiplead', name: 'Chiptune lead', ins: { wave: 'pulse', pulseWidth: 0.25, detune: 0, attack: 0.001, decay: 0.1, sustain: 0.7, release: 0.05, cutoff: 12000, vibrato: 18, vibratoRate: 6 } },
    { id: 'brass', name: 'Brass stab', ins: { wave: 'saw', detune: 8, attack: 0.04, decay: 0.3, sustain: 0.6, release: 0.15, cutoff: 900, resonance: 1, filterEnvelope: 2.2, vibrato: 0 } },
    { id: 'subbass', name: 'Sub bass', ins: { wave: 'sine', detune: 0, octave: -1, attack: 0.005, decay: 0.3, sustain: 0.9, release: 0.1, cutoff: 600, vibrato: 0 } },
    { id: 'synthbass', name: 'Synth bass', ins: { wave: 'saw', detune: 6, octave: -1, attack: 0.003, decay: 0.25, sustain: 0.5, release: 0.08, cutoff: 700, resonance: 2.5, filterEnvelope: 2, vibrato: 0 } },
    { id: 'wobble', name: 'Wobble bass', ins: { wave: 'saw', detune: 10, octave: -1, attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.1, cutoff: 500, resonance: 4, vibrato: 0, lfo: 'filter', lfoRate: 2, lfoDepth: 0.7 } },
    { id: 'wind', name: 'Wind (noise)', ins: { wave: 'noise', detune: 0, attack: 1.2, decay: 1, sustain: 0.7, release: 2, cutoff: 900, resonance: 3, vibrato: 0, lfo: 'filter', lfoRate: 0.2, lfoDepth: 0.6 } },
  ];
  // What a preset leaves as it was: everything else goes back to the defaults first, so presets don't mix.
  const DEFAULT_SYNTH = { wave: 'triangle', pulseWidth: 0.25, detune: 6, octave: 0, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2, cutoff: 8000, resonance: 0.7, filterEnvelope: 0, vibrato: 0, vibratoRate: 5, lfo: 'off', lfoRate: 4, lfoDepth: 0.3, fmRatio: 2, fmDepth: 0 };
  const applyPreset = (ins, id) => { const p = PRESETS.find((x) => x.id === id); if (p) Object.assign(ins, DEFAULT_SYNTH, p.ins); return !!p; };

  return { SCALES, chord, chords, PROGRESSIONS, chordBar, RHYTHMS, rhythmBar, vary, PRESETS, applyPreset, isMinorKey };
})();
