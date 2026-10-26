// NoorMD sound processing for the Music Bench: 10-band equalizer with presets, loudness normalisation and a
// limiter so nothing clips. Files are never modified: loudness is measured here (ITU-R BS.1770 integrated loudness)
// or taken from ReplayGain tags, and applied as playback gain.
//
// The Web Audio graph is created only when an effect is first turned on (an <audio> element can't be detached from
// a graph again), and it is bypassed transparently while everything is flat.
'use strict';

window.NoorFx = (() => {
  const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const PRESETS = {
    flat: { label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    bass: { label: 'Bass boost', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
    treble: { label: 'Treble boost', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
    vocal: { label: 'Vocal clarity', gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
    electronic: { label: 'Electronic', gains: [5, 4, 1, 0, -2, 1, 1, 2, 4, 5] },
    lofi: { label: 'Warm lo-fi', gains: [3, 3, 2, 1, 0, -1, -2, -3, -4, -5] },
    acoustic: { label: 'Acoustic', gains: [2, 2, 1, 0, 1, 1, 2, 2, 2, 1] },
    night: { label: 'Late night (soft)', gains: [-3, -2, -1, 0, 1, 1, 1, 0, -1, -2] },
  };
  const TARGETS = [[-14, 'Streaming (−14 LUFS)'], [-16, 'Balanced (−16 LUFS)'], [-18, 'ReplayGain (−18 LUFS)'], [-23, 'Quiet (−23 LUFS)']];
  const DEFAULTS = { eqOn: false, preset: 'flat', gains: PRESETS.flat.gains.slice(), preventClipping: true, normalize: false, target: -14 };

  let settings = { ...DEFAULTS, gains: DEFAULTS.gains.slice() };
  let ctx = null, source = null, norm = null, filters = [], preamp = null, limiter = null;
  let audioEl = null, trackGainDb = 0, trackGainSource = 'none';

  function clampGain(v) { return Math.max(-12, Math.min(12, Number(v) || 0)); }

  function load(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    settings = {
      eqOn: !!s.eqOn, preset: PRESETS[s.preset] || s.preset === 'custom' ? s.preset : 'flat',
      gains: Array.isArray(s.gains) && s.gains.length === BANDS.length ? s.gains.map(clampGain) : DEFAULTS.gains.slice(),
      preventClipping: s.preventClipping !== false, normalize: !!s.normalize,
      target: TARGETS.some(([t]) => t === s.target) ? s.target : -14,
    };
    if (needsGraph()) ensureGraph();
    apply();
  }

  function needsGraph() { return settings.normalize || (settings.eqOn && settings.gains.some((g) => g !== 0)); }

  function attach(audio) { audioEl = audio; }

  /** Builds the graph once. Returns false when Web Audio isn't available (playback then simply has no effects). */
  function ensureGraph() {
    if (ctx) return true;
    if (!audioEl || !(window.AudioContext || window.webkitAudioContext)) return false;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      source = ctx.createMediaElementSource(audioEl);
      norm = ctx.createGain();
      filters = BANDS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f;
        b.Q.value = 1.1;
        return b;
      });
      preamp = ctx.createGain();
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
      let node = source.connect(norm);
      for (const f of filters) node = node.connect(f);
      node.connect(preamp).connect(limiter).connect(ctx.destination);
      // Browsers start an AudioContext suspended until the user interacts; resume on the next interaction.
      const resume = () => { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
      ['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, resume, true));
      audioEl.addEventListener('play', resume);
      resume();
      return true;
    } catch (err) {
      console.warn('Sound effects unavailable:', err);
      ctx = null;
      return false;
    }
  }

  /** Preamp that keeps the EQ's boosts from clipping: the largest boost, taken back off the whole signal. */
  function autoPreamp() {
    if (!settings.eqOn || !settings.preventClipping) return 0;
    const max = Math.max(0, ...settings.gains);
    return -max;
  }

  function apply() {
    if (!ctx) return;
    const t = ctx.currentTime;
    filters.forEach((f, i) => f.gain.setTargetAtTime(settings.eqOn ? settings.gains[i] : 0, t, 0.015));
    norm.gain.setTargetAtTime(settings.normalize ? dbToGain(trackGainDb) : 1, t, 0.03);
    preamp.gain.setTargetAtTime(dbToGain(autoPreamp()), t, 0.015);
    // The limiter only catches what's left (normalisation boosts, inter-sample peaks); with it off, it's transparent.
    limiter.threshold.value = settings.preventClipping ? -1 : 0;
    limiter.ratio.value = settings.preventClipping ? 20 : 1;
  }

  function dbToGain(db) { return Math.pow(10, db / 20); }

  /**
   * Playback gain for a track (dB): NoorMD's own measurement first, then ReplayGain tags (reference −18 LUFS),
   * limited so the track's peak stays below −1 dBFS, and clamped to −24…+12 dB. Null when nothing is known.
   */
  function gainFor(row, target = settings.target) {
    if (!row) return null;
    let g = null, from = 'none', peak = null;
    if (Number.isFinite(row.loudness)) { g = target - row.loudness; from = 'measured'; peak = row.peak; }
    else if (Number.isFinite(row.rgGain)) { g = row.rgGain + (target + 18); from = 'tags'; peak = row.rgPeak; }
    if (g == null) return null;
    if (Number.isFinite(peak) && peak > 0) g = Math.min(g, -20 * Math.log10(peak) - 1);
    return { db: Math.max(-24, Math.min(12, g)), from };
  }

  function setTrack(row) {
    const g = gainFor(row);
    trackGainDb = g ? g.db : 0;
    trackGainSource = g ? g.from : 'none';
    apply();
  }

  function update(patch) {
    settings = { ...settings, ...patch };
    if (patch.preset && PRESETS[patch.preset]) settings.gains = PRESETS[patch.preset].gains.slice();
    if (patch.gains) settings.gains = patch.gains.map(clampGain);
    if (needsGraph() && !ensureGraph()) return false;
    apply();
    return true;
  }

  // ------------------------------------------------------------------ BS.1770 loudness measurement

  function biquad(b, a) { return { b, a, x1: 0, x2: 0, y1: 0, y2: 0 }; }

  function kWeighting(fs) {
    // Coefficients for any sample rate (as in libebur128): a high-shelf "head" filter and the RLB high-pass.
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const pre = biquad([(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]);
    f0 = 38.13547087602444; Q = 0.5003270373238773;
    K = Math.tan(Math.PI * f0 / fs);
    a0 = 1 + K / Q + K * K;
    const rlb = biquad([1, -2, 1], [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]);
    return [pre, rlb];
  }

  /**
   * Integrated loudness (LUFS) and sample peak of PCM channels. 400 ms blocks with 75 % overlap, absolute gate
   * −70 LUFS, relative gate −10 LU. Returns { lufs: -Infinity } for silence.
   */
  function measure(channels, fs) {
    const seg = Math.max(1, Math.round(fs * 0.1));
    const n = channels[0].length;
    const segs = Math.floor(n / seg);
    const energy = new Float64Array(segs); // sum over channels of mean-square per 100 ms segment
    let peak = 0;
    for (const ch of channels) {
      const [f1, f2] = kWeighting(fs);
      let s = 0, k = 0, idx = 0;
      for (let i = 0; i < segs * seg; i++) {
        const x = ch[i];
        const ax = x < 0 ? -x : x;
        if (ax > peak) peak = ax;
        let y = f1.b[0] * x + f1.b[1] * f1.x1 + f1.b[2] * f1.x2 - f1.a[1] * f1.y1 - f1.a[2] * f1.y2;
        f1.x2 = f1.x1; f1.x1 = x; f1.y2 = f1.y1; f1.y1 = y;
        const z = f2.b[0] * y + f2.b[1] * f2.x1 + f2.b[2] * f2.x2 - f2.a[1] * f2.y1 - f2.a[2] * f2.y2;
        f2.x2 = f2.x1; f2.x1 = y; f2.y2 = f2.y1; f2.y1 = z;
        s += z * z;
        if (++k === seg) { energy[idx++] += s / seg; s = 0; k = 0; }
      }
      for (let i = segs * seg; i < n; i++) { const ax = Math.abs(ch[i]); if (ax > peak) peak = ax; }
    }
    const blocks = [];
    for (let i = 0; i + 4 <= segs; i++) blocks.push((energy[i] + energy[i + 1] + energy[i + 2] + energy[i + 3]) / 4);
    const lk = (z) => -0.691 + 10 * Math.log10(z);
    const abs = blocks.filter((z) => z > 0 && lk(z) > -70);
    if (!abs.length) return { lufs: -Infinity, peak };
    const relGate = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const rel = abs.filter((z) => lk(z) > relGate);
    return { lufs: lk(rel.reduce((a, b) => a + b, 0) / rel.length), peak };
  }

  /** Decodes a library file and measures it. Decoding runs at 32 kHz to keep memory low on long tracks. */
  async function analyze(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok && res.status !== 206) throw new Error(`The file could not be read (HTTP ${res.status}).`);
    const buf = await res.arrayBuffer();
    const off = new OfflineAudioContext(2, 1, 32000);
    const audio = await off.decodeAudioData(buf);
    const chans = [];
    for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) chans.push(audio.getChannelData(c));
    await new Promise((r) => setTimeout(r, 0));
    return measure(chans, audio.sampleRate);
  }

  return {
    BANDS, PRESETS, TARGETS, attach, load, update, setTrack, gainFor, measure, analyze,
    get settings() { return { ...settings, gains: settings.gains.slice() }; },
    get active() { return !!ctx; },
    get trackGain() { return { db: trackGainDb, from: trackGainSource }; },
    get preamp() { return autoPreamp(); },
  };
})();
