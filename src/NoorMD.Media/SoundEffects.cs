namespace NoorMD.Media;

/// <summary>
/// One processor in an effects chain (a layer's or the master's). Chains run in order; each effect can be switched off
/// (Bypass), blended with the unprocessed sound (Mix) and set to an output level (Out). Only the fields of its Type are used.
/// </summary>
public sealed class SoundEffect
{
    public const int MaxPerChain = 8;
    public static readonly string[] Types = ["eq", "compressor", "gate", "saturate", "crush", "delay", "chorus", "flanger", "phaser", "tremolo", "reverb", "width", "resonator", "convolution"];

    public string Type { get; set; } = "eq";
    /// <summary>A stable id ("F1"…) within its chain, for modulation routes.</summary>
    public string Id { get; set; } = "";
    public bool Bypass { get; set; }
    /// <summary>0 = only the sound coming in, 1 = only the processed sound.</summary>
    public double Mix { get; set; } = 1;
    /// <summary>Output level (dB).</summary>
    public double Out { get; set; }

    // eq: one band. Kind: "peak", "lowshelf", "highshelf", "lowpass", "highpass", "bandpass", "notch".
    public string Kind { get; set; } = "peak";
    public double Freq { get; set; } = 1000;
    public double Q { get; set; } = 0.7;
    public double Gain { get; set; }

    // compressor and gate
    public double Threshold { get; set; } = -18;
    public double Ratio { get; set; } = 4;
    public double Attack { get; set; } = 10;
    public double Release { get; set; } = 120;
    /// <summary>Gate: how far it turns the sound down when closed (dB).</summary>
    public double Range { get; set; } = 40;

    // saturate: Shape "soft", "hard" or "fold"
    public double Drive { get; set; } = 0.5;
    public string Shape { get; set; } = "soft";

    // crush
    public double Bits { get; set; } = 8;
    public double Downsample { get; set; } = 4;

    // delay
    public double Time { get; set; } = 250;
    public double Feedback { get; set; } = 0.35;
    public bool PingPong { get; set; }
    /// <summary>Echoes get darker: a low-pass in the feedback (Hz).</summary>
    public double Tone { get; set; } = 6000;

    // chorus, flanger, phaser, tremolo (Rate in Hz, Depth 0–1)
    public double Rate { get; set; } = 0.8;
    public double Depth { get; set; } = 0.5;
    /// <summary>Tremolo: move the sound left and right instead of up and down in level.</summary>
    public bool Pan { get; set; }

    // reverb
    public double Size { get; set; } = 0.5;
    public double Damping { get; set; } = 0.5;
    public double PreDelay { get; set; } = 10;

    // width
    public double Width { get; set; } = 1.5;

    // resonator: Body "string", "tube", "metal", "wood", "glass", "bell" or "membrane"; Freq is its pitch (Hz),
    // Decay how long it rings (seconds, to −60 dB), Damping how much faster its higher partials die (0–1), Detune
    // how far the right side is tuned from the left (0–1, up to 25 cents: width).
    public string Body { get; set; } = "string";
    public double Decay { get; set; } = 1.5;
    public double Detune { get; set; } = 0.2;

    // convolution: Space is a built-in one ("room", "hall", "church", "cave", "plate", "tunnel") or "file", a recorded
    // impulse response (IrPath, shown as IrName); IrLength keeps that many seconds of it (0 = all, at most 10). Damping
    // darkens its tail, PreDelay delays it.
    public string Space { get; set; } = "hall";
    public string? IrPath { get; set; }
    public string? IrName { get; set; }
    public double IrLength { get; set; }

    public SoundEffect Clone() => (SoundEffect)MemberwiseClone();

    private static double C(double v, double lo, double hi) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : lo;

    public SoundEffect Clamped()
    {
        Type = Types.Contains(Type) ? Type : "eq";
        Mix = C(Mix, 0, 1); Out = C(Out, -40, 24);
        Kind = Kind is "peak" or "lowshelf" or "highshelf" or "lowpass" or "highpass" or "bandpass" or "notch" ? Kind : "peak";
        Freq = C(Freq, 20, 20000); Q = C(Q, 0.1, 30); Gain = C(Gain, -36, 36);
        Threshold = C(Threshold, -80, 0); Ratio = C(Ratio, 1, 40); Attack = C(Attack, 0.05, 500); Release = C(Release, 1, 5000); Range = C(Range, 0, 90);
        Drive = C(Drive, 0, 1); Shape = Shape is "soft" or "hard" or "fold" ? Shape : "soft";
        Bits = C(Bits, 1, 16); Downsample = C(Downsample, 1, 64);
        Time = C(Time, 1, 2000); Feedback = C(Feedback, 0, 0.95); Tone = C(Tone, 200, 20000);
        Rate = C(Rate, 0.01, 20); Depth = C(Depth, 0, 1);
        Size = C(Size, 0, 1); Damping = C(Damping, 0, 1); PreDelay = C(PreDelay, 0, 250);
        Width = C(Width, 0, 2);
        Body = Body is "string" or "tube" or "metal" or "wood" or "glass" or "bell" or "membrane" ? Body : "string";
        Decay = C(Decay, 0.02, 30); Detune = C(Detune, 0, 1);
        Space = SoundConvolution.Spaces.Contains(Space) ? Space : "hall";
        if (IrPath != null && (IrPath.Length > 1000 || IrPath.Any(char.IsControl))) IrPath = null;
        if (IrName != null) IrName = IrName.Length > 120 ? IrName[..120] : IrName;
        IrLength = IrLength <= 0 || !double.IsFinite(IrLength) ? 0 : Math.Clamp(IrLength, 0.05, SoundConvolution.MaxSeconds);
        return this;
    }
}

/// <summary>The processors behind <see cref="SoundEffect"/>, working in place on stereo buffers.</summary>
public static class SoundEffects
{
    /// <param name="mod">The modulation of an effect's parameter ("mix", "freq", "gain", "drive"), per block, or null.</param>
    /// <param name="files">Reads a recorded space (a convolution's impulse response), or null when it can't or may not be used.</param>
    public static void Apply(IReadOnlyList<SoundEffect> chain, double[] L, double[] R, int sr, Func<SoundEffect, string, double[]?>? mod = null,
        Func<string, SampleAudio?>? files = null)
    {
        foreach (var fx in chain)
        {
            if (fx.Bypass) continue;
            (double[] L, double[] R)? ir = null;
            if (fx.Type == "convolution" && (ir = SoundConvolution.Response(fx, sr, files)) == null) continue; // its recording is missing: as if off
            var mixMod = mod?.Invoke(fx, "mix");
            var mix = fx.Mix;
            var outGain = Math.Pow(10, fx.Out / 20);
            if (mix <= 0 && mixMod == null) { Scale(L, R, outGain); continue; }
            // Mixing needs the incoming sound kept aside (only when it isn't fully wet).
            double[]? dl = null, dr = null;
            if (mix < 1 || mixMod != null) { dl = (double[])L.Clone(); dr = (double[])R.Clone(); }
            if (ir is { } space) SoundConvolution.Apply(L, R, space);
            else Process(fx, L, R, sr, mod == null ? null : p => mod(fx, p));
            for (var i = 0; i < L.Length; i++)
            {
                var m = mixMod == null ? mix : Math.Clamp(mix + ModulationField.At(mixMod, i), 0, 1);
                var l = dl == null ? L[i] : dl[i] * (1 - m) + L[i] * m;
                var r = dr == null ? R[i] : dr[i] * (1 - m) + R[i] * m;
                L[i] = Finite(l * outGain); R[i] = Finite(r * outGain);
            }
        }
    }

    private static double Finite(double v) => double.IsFinite(v) ? v : 0;

    private static void Scale(double[] L, double[] R, double k) { if (k == 1) return; for (var i = 0; i < L.Length; i++) { L[i] *= k; R[i] *= k; } }

    private static void Process(SoundEffect fx, double[] L, double[] R, int sr, Func<string, double[]?>? mod)
    {
        switch (fx.Type)
        {
            case "eq":
            {
                var freqMod = mod?.Invoke("freq"); var gainMod = mod?.Invoke("gain");
                if (freqMod == null && gainMod == null) { Eq(fx, L, sr); Eq(fx, R, sr); }
                else { MovingEq(fx, L, sr, freqMod, gainMod); MovingEq(fx, R, sr, freqMod, gainMod); }
                break;
            }
            case "compressor": Dynamics(fx, L, R, sr, gate: false); break;
            case "gate": Dynamics(fx, L, R, sr, gate: true); break;
            case "saturate": { var dm = mod?.Invoke("drive"); Saturate(fx, L, dm); Saturate(fx, R, dm); break; }
            case "crush": Crush(fx, L); Crush(fx, R); break;
            case "delay": Delay(fx, L, R, sr); break;
            case "chorus": Modulated(fx, L, R, sr, baseMs: 18, depthMs: 8, feedback: 0); break;
            case "flanger": Modulated(fx, L, R, sr, baseMs: 1, depthMs: 4, feedback: fx.Feedback); break;
            case "phaser": Phaser(fx, L, sr, 0); Phaser(fx, R, sr, Math.PI / 2); break;
            case "tremolo": Tremolo(fx, L, R, sr); break;
            case "reverb": Reverb(fx, L, R, sr); break;
            case "resonator":
            {
                var fm = mod?.Invoke("freq");
                var cents = fx.Detune * 25;
                Resonate(fx, L, sr, 1, fm);
                Resonate(fx, R, sr, Math.Pow(2, cents / 1200), fm);
                break;
            }
            case "width":
                for (var i = 0; i < L.Length; i++) { var m = (L[i] + R[i]) / 2; var s = (L[i] - R[i]) / 2 * fx.Width; L[i] = m + s; R[i] = m - s; }
                break;
        }
    }

    /// <summary>A biquad from the RBJ cookbook, including peaking and shelving bands.</summary>
    private sealed class Band
    {
        private double _b0, _b1, _b2, _a1, _a2, _x1, _x2, _y1, _y2;

        public Band(string kind, double freq, double q, double gainDb, int sr)
        {
            freq = Math.Clamp(freq, 10, sr * 0.45);
            var a = Math.Pow(10, gainDb / 40);
            var w = 2 * Math.PI * freq / sr;
            double cos = Math.Cos(w), sin = Math.Sin(w), alpha = sin / (2 * Math.Max(0.05, q));
            double b0, b1, b2, a0, a1, a2;
            switch (kind)
            {
                case "lowshelf":
                {
                    var s = 2 * Math.Sqrt(a) * alpha;
                    b0 = a * ((a + 1) - (a - 1) * cos + s); b1 = 2 * a * ((a - 1) - (a + 1) * cos); b2 = a * ((a + 1) - (a - 1) * cos - s);
                    a0 = (a + 1) + (a - 1) * cos + s; a1 = -2 * ((a - 1) + (a + 1) * cos); a2 = (a + 1) + (a - 1) * cos - s;
                    break;
                }
                case "highshelf":
                {
                    var s = 2 * Math.Sqrt(a) * alpha;
                    b0 = a * ((a + 1) + (a - 1) * cos + s); b1 = -2 * a * ((a - 1) + (a + 1) * cos); b2 = a * ((a + 1) + (a - 1) * cos - s);
                    a0 = (a + 1) - (a - 1) * cos + s; a1 = 2 * ((a - 1) - (a + 1) * cos); a2 = (a + 1) - (a - 1) * cos - s;
                    break;
                }
                case "lowpass": b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
                case "highpass": b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
                case "bandpass": b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
                case "notch": b0 = 1; b1 = -2 * cos; b2 = 1; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
                default: // peak
                    b0 = 1 + alpha * a; b1 = -2 * cos; b2 = 1 - alpha * a; a0 = 1 + alpha / a; a1 = -2 * cos; a2 = 1 - alpha / a; break;
            }
            _b0 = b0 / a0; _b1 = b1 / a0; _b2 = b2 / a0; _a1 = a1 / a0; _a2 = a2 / a0;
        }

        /// <summary>New settings, keeping the filter's memory (so a moving band doesn't click).</summary>
        public Band Retuned(string kind, double freq, double q, double gainDb, int sr)
        {
            var n = new Band(kind, freq, q, gainDb, sr) { _x1 = _x1, _x2 = _x2, _y1 = _y1, _y2 = _y2 };
            return n;
        }

        public double Run(double x)
        {
            var y = _b0 * x + _b1 * _x1 + _b2 * _x2 - _a1 * _y1 - _a2 * _y2;
            if (Math.Abs(y) < 1e-25) y = 0; // no denormals in long tails
            _x2 = _x1; _x1 = x; _y2 = _y1; _y1 = y;
            return y;
        }
    }

    /// <summary>An EQ band whose frequency (octaves) and boost (dB) move with modulation.</summary>
    private static void MovingEq(SoundEffect fx, double[] x, int sr, double[]? freqMod, double[]? gainMod)
    {
        Band? band = null;
        for (var i = 0; i < x.Length; i++)
        {
            if (i % ModulationField.Block == 0)
            {
                var b = i / ModulationField.Block;
                var f = fx.Freq * (freqMod == null ? 1 : Math.Pow(2, freqMod[Math.Min(b, freqMod.Length - 1)]));
                var g = fx.Gain + (gainMod == null ? 0 : gainMod[Math.Min(b, gainMod.Length - 1)]);
                band = band == null ? new Band(fx.Kind, f, fx.Q, g, sr) : band.Retuned(fx.Kind, f, fx.Q, g, sr);
            }
            x[i] = band!.Run(x[i]);
        }
    }

    private static void Eq(SoundEffect fx, double[] x, int sr)
    {
        var band = new Band(fx.Kind, fx.Freq, fx.Q, fx.Gain, sr);
        for (var i = 0; i < x.Length; i++) x[i] = band.Run(x[i]);
    }

    /// <summary>Compressor (turns loud parts down above the threshold) or gate (turns quiet parts down below it), stereo-linked.</summary>
    private static void Dynamics(SoundEffect fx, double[] L, double[] R, int sr, bool gate)
    {
        var att = Math.Exp(-1 / (fx.Attack / 1000 * sr));
        var rel = Math.Exp(-1 / (fx.Release / 1000 * sr));
        double env = 0, gainDb = 0;
        for (var i = 0; i < L.Length; i++)
        {
            var level = Math.Max(Math.Abs(L[i]), Math.Abs(R[i]));
            env = level > env ? att * env + (1 - att) * level : rel * env + (1 - rel) * level;
            var db = env > 1e-9 ? 20 * Math.Log10(env) : -180;
            double target;
            if (gate) target = db < fx.Threshold ? -fx.Range : 0;
            else target = db > fx.Threshold ? -(db - fx.Threshold) * (1 - 1 / fx.Ratio) : 0;
            // The gain moves smoothly: fast when it has to act, slow when it lets go.
            var k = target < gainDb ? (gate ? rel : att) : (gate ? att : rel);
            gainDb = k * gainDb + (1 - k) * target;
            var g = Math.Pow(10, gainDb / 20);
            L[i] *= g; R[i] *= g;
        }
    }

    private static void Saturate(SoundEffect fx, double[] x, double[]? driveMod)
    {
        var drive = fx.Drive;
        var k = 1 + drive * 9;
        var norm = fx.Shape == "soft" ? 1 / Math.Tanh(k) : 1;
        var comp = 1 / (1 + drive * 2.5);
        for (var i = 0; i < x.Length; i++)
        {
            if (driveMod != null && i % ModulationField.Block == 0)
            {
                drive = Math.Clamp(fx.Drive + driveMod[Math.Min(i / ModulationField.Block, driveMod.Length - 1)], 0, 1);
                k = 1 + drive * 9; norm = fx.Shape == "soft" ? 1 / Math.Tanh(k) : 1; comp = 1 / (1 + drive * 2.5);
            }
            var v = x[i] * k;
            x[i] = (fx.Shape switch
            {
                "hard" => Math.Clamp(v, -1, 1),
                "fold" => Math.Asin(Math.Sin(v * Math.PI / 2)) * 2 / Math.PI, // folds back instead of clipping: buzzy, metallic
                _ => Math.Tanh(v) * norm,
            }) * comp;
        }
    }

    private static void Crush(SoundEffect fx, double[] x)
    {
        var hold = Math.Max(1, (int)Math.Round(fx.Downsample));
        var levels = Math.Pow(2, fx.Bits - 1);
        double h = 0;
        for (var i = 0; i < x.Length; i++)
        {
            if (i % hold == 0) h = Math.Round(x[i] * levels) / levels;
            x[i] = h;
        }
    }

    private static void Delay(SoundEffect fx, double[] L, double[] R, int sr)
    {
        var d = Math.Max(1, (int)(fx.Time / 1000 * sr));
        var bl = new double[d]; var br = new double[d];
        var lp = Math.Exp(-2 * Math.PI * fx.Tone / sr);
        double tl = 0, tr = 0;
        var idx = 0;
        for (var i = 0; i < L.Length; i++)
        {
            double el = bl[idx], er = br[idx];
            tl = lp * tl + (1 - lp) * el; tr = lp * tr + (1 - lp) * er; // darker each time around
            double inL = L[i], inR = R[i];
            if (fx.PingPong) { bl[idx] = (inL + inR) / 2 + tr * fx.Feedback; br[idx] = tl * fx.Feedback; }
            else { bl[idx] = inL + tl * fx.Feedback; br[idx] = inR + tr * fx.Feedback; }
            idx = (idx + 1) % d;
            // Wet = the echoes only; the Mix control blends the dry sound back in.
            L[i] = el; R[i] = er;
        }
    }

    /// <summary>Chorus and flanger: a short delay that sways, blended with the sound (both channels sway a quarter apart).</summary>
    private static void Modulated(SoundEffect fx, double[] L, double[] R, int sr, double baseMs, double depthMs, double feedback)
    {
        var size = (int)((baseMs + depthMs + 2) / 1000 * sr) + 4;
        var bl = new double[size]; var br = new double[size];
        var w = 0;
        for (var i = 0; i < L.Length; i++)
        {
            var t = (double)i / sr;
            double ReadAt(double[] buf, double ms)
            {
                var back = ms / 1000 * sr;
                var pos = w - back;
                while (pos < 0) pos += size;
                var k = (int)pos; var f = pos - k;
                return buf[k % size] * (1 - f) + buf[(k + 1) % size] * f;
            }
            var ml = baseMs + depthMs * fx.Depth * (0.5 + 0.5 * Math.Sin(2 * Math.PI * fx.Rate * t));
            var mr = baseMs + depthMs * fx.Depth * (0.5 + 0.5 * Math.Sin(2 * Math.PI * fx.Rate * t + Math.PI / 2));
            var dl = ReadAt(bl, ml); var dr = ReadAt(br, mr);
            bl[w] = L[i] + dl * feedback; br[w] = R[i] + dr * feedback;
            w = (w + 1) % size;
            L[i] = (L[i] + dl) * 0.7; R[i] = (R[i] + dr) * 0.7;
        }
    }

    /// <summary>A sweeping notch pattern: six all-pass stages whose frequency moves between 200 Hz and 3 kHz.</summary>
    private static void Phaser(SoundEffect fx, double[] x, int sr, double phase)
    {
        const int stages = 6;
        var z = new double[stages];
        double fb = 0;
        for (var i = 0; i < x.Length; i++)
        {
            var lfo = 0.5 + 0.5 * Math.Sin(2 * Math.PI * fx.Rate * i / sr + phase);
            var f = 200 * Math.Pow(15, lfo * fx.Depth);
            var tan = Math.Tan(Math.PI * Math.Min(f, sr * 0.45) / sr);
            var a = (tan - 1) / (tan + 1);
            var v = x[i] + fb * fx.Feedback * 0.7;
            for (var s = 0; s < stages; s++) { var y = a * v + z[s]; z[s] = v - a * y; v = y; }
            fb = v;
            x[i] = (x[i] + v) * 0.5;
        }
    }

    private static void Tremolo(SoundEffect fx, double[] L, double[] R, int sr)
    {
        for (var i = 0; i < L.Length; i++)
        {
            var lfo = 0.5 + 0.5 * Math.Sin(2 * Math.PI * fx.Rate * i / sr);
            if (fx.Pan)
            {
                // Auto-pan: the sound moves from side to side at the same level.
                L[i] *= 1 - fx.Depth * lfo; R[i] *= 1 - fx.Depth * (1 - lfo);
            }
            else { var g = 1 - fx.Depth * lfo; L[i] *= g; R[i] *= g; }
        }
    }

    /// <summary>A room: pre-delay, eight damped combs and four all-passes per side (Freeverb-style).</summary>
    // ------------------------------------------------------------------ resonator

    /// <summary>Partials of each body: (ratio to the pitch, loudness, how long it rings relative to Decay).</summary>
    private static readonly Dictionary<string, (double Ratio, double Amp, double Ring)[]> Bodies = new()
    {
        // A free metal bar: inharmonic, long and bright.
        ["metal"] = [(1, 1, 1), (2.756, 0.8, 0.9), (5.404, 0.6, 0.75), (8.933, 0.45, 0.6), (13.34, 0.3, 0.5), (18.64, 0.2, 0.4)],
        // Wood: a few low partials that die quickly.
        ["wood"] = [(1, 1, 0.35), (2.32, 0.55, 0.22), (4.25, 0.3, 0.14), (6.63, 0.15, 0.1)],
        // A wine glass: few, very pure, long partials.
        ["glass"] = [(1, 1, 1), (2.61, 0.5, 0.85), (4.81, 0.28, 0.7), (7.42, 0.14, 0.55)],
        // A church bell: hum, prime, minor third (tierce), fifth, nominal and above.
        ["bell"] = [(0.5, 0.7, 1.4), (1, 1, 1), (1.183, 0.8, 0.9), (1.506, 0.5, 0.8), (2, 0.9, 0.7), (2.514, 0.35, 0.55), (2.662, 0.3, 0.5), (3.011, 0.25, 0.45), (4.166, 0.2, 0.35)],
        // A drum skin (circular membrane): crowded inharmonic partials, short.
        ["membrane"] = [(1, 1, 1), (1.593, 0.8, 0.8), (2.136, 0.6, 0.65), (2.296, 0.5, 0.6), (2.653, 0.4, 0.5), (2.918, 0.3, 0.45), (3.156, 0.25, 0.4), (3.501, 0.2, 0.35)],
    };

    /// <summary>
    /// A resonator rings at its pitch when the sound excites it: a burst of noise becomes a plucked string, a click a
    /// struck bar or a glass. Each kind is scaled so that noise comes out about as loud as it went in.
    /// </summary>
    private static void Resonate(SoundEffect fx, double[] x, int sr, double tune, double[]? freqMod)
    {
        double Pitch(int i) => Math.Clamp(fx.Freq * tune * (freqMod == null ? 1 : Math.Pow(2, ModulationField.At(freqMod, i))), 20, sr * 0.45);
        if (fx.Body is "string" or "tube")
        {
            // A delay line one period long, fed back through a gentle low-pass (string) or turned over (tube: a pipe
            // closed at one end, odd harmonics only, so its delay is half a period).
            var tubeKind = fx.Body == "tube";
            var line = new double[(int)(sr / 20.0) + 4];
            var w = 0; double lp = 0;
            var damp = 0.05 + fx.Damping * 0.9; // the low-pass in the loop: more damping, darker and shorter highs
            double period = 0, g = 0, inGain = 0;
            for (var i = 0; i < x.Length; i++)
            {
                if (i % 32 == 0)
                {
                    var f = Pitch(i);
                    period = Math.Clamp(sr / f / (tubeKind ? 2 : 1), 2, line.Length - 2);
                    g = Math.Pow(10, -3 * (period / sr) / fx.Decay); // −60 dB after Decay seconds
                    // Noise in comes out about as loud: the loop's noise gain, averaged over frequency, is the mean of
                    // 1 / (1 − g² |LP(ω)|²); the low-pass in the loop takes energy from the higher harmonics.
                    var alpha = 1 - damp * 0.5;
                    var mean = 0.0;
                    for (var q = 0; q < 64; q++)
                    {
                        var wq = Math.PI * (q + 0.5) / 64;
                        var lp2 = alpha * alpha / (1 - 2 * (1 - alpha) * Math.Cos(wq) + (1 - alpha) * (1 - alpha));
                        mean += 1 / Math.Max(1e-6, 1 - g * g * lp2);
                    }
                    inGain = 1 / Math.Sqrt(mean / 64);
                }
                var rp = w - period;
                while (rp < 0) rp += line.Length;
                var k = (int)rp; var frac = rp - k;
                var d = line[k % line.Length] * (1 - frac) + line[(k + 1) % line.Length] * frac;
                lp += (d - lp) * (1 - damp * 0.5);
                var fb = (tubeKind ? -lp : lp) * g;
                var y = x[i] * inGain + fb;
                line[w] = y;
                w = (w + 1) % line.Length;
                x[i] = y;
            }
            return;
        }
        var modes = Bodies[fx.Body];
        var norm = 1 / Math.Sqrt(modes.Sum(m => m.Amp * m.Amp));
        var n = modes.Length;
        double[] y1 = new double[n], y2 = new double[n], a1 = new double[n], a2 = new double[n], b0 = new double[n];
        var tilt = 0.2 + fx.Damping * 1.6; // higher partials ring shorter, more so with damping
        void Tune(int i)
        {
            var f0 = Pitch(i);
            for (var m = 0; m < n; m++)
            {
                var f = f0 * modes[m].Ratio;
                if (f >= sr * 0.45) { b0[m] = 0; a1[m] = 0; a2[m] = 0; continue; }
                var ring = Math.Max(0.005, fx.Decay * modes[m].Ring * Math.Pow(Math.Max(1, modes[m].Ratio), -tilt));
                var r = Math.Pow(10, -3 / (ring * sr));
                var wv = 2 * Math.PI * f / sr;
                a1[m] = 2 * r * Math.Cos(wv); a2[m] = -r * r;
                // Noise in comes out about as loud: a two-pole resonator's noise gain is b0² / (4 (1 − r) sin² ω).
                b0[m] = 2 * Math.Sin(wv) * Math.Sqrt(1 - r) * modes[m].Amp * norm;
            }
        }
        for (var i = 0; i < x.Length; i++)
        {
            if (i % 32 == 0 && (i == 0 || freqMod != null)) Tune(i);
            var input = x[i]; var sum = 0.0;
            for (var m = 0; m < n; m++)
            {
                var y = b0[m] * input + a1[m] * y1[m] + a2[m] * y2[m];
                y2[m] = y1[m]; y1[m] = y;
                sum += y;
            }
            x[i] = sum;
        }
    }

    private static void Reverb(SoundEffect fx, double[] L, double[] R, int sr)
    {
        var scale = sr / 44100.0;
        int[] combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], allp = [556, 441, 341, 225];
        var feedback = 0.7 + 0.28 * fx.Size;
        var pre = (int)(fx.PreDelay / 1000 * sr);
        var wl = Tail(L, combs.Select(c => (int)(c * scale)).ToArray(), allp.Select(a => (int)(a * scale)).ToArray(), feedback, fx.Damping, pre);
        var wr = Tail(R, combs.Select(c => (int)((c + 23) * scale)).ToArray(), allp.Select(a => (int)((a + 23) * scale)).ToArray(), feedback, fx.Damping, pre);
        // Wet = the room only; Mix blends the sound back in (0.3 is a natural amount).
        for (var i = 0; i < L.Length; i++) { L[i] = wl[i]; R[i] = wr[i]; }
    }

    private static double[] Tail(double[] x, int[] combs, int[] allpasses, double feedback, double damping, int pre)
    {
        var y = new double[x.Length];
        foreach (var d in combs)
        {
            var buf = new double[Math.Max(1, d)];
            int idx = 0; double store = 0;
            for (var i = 0; i < x.Length; i++)
            {
                var o = buf[idx];
                store = o * (1 - damping) + store * damping;
                var input = i >= pre ? x[i - pre] : 0;
                buf[idx] = input * 0.12 + store * feedback;
                idx = (idx + 1) % buf.Length;
                y[i] += o;
            }
        }
        foreach (var d in allpasses)
        {
            var buf = new double[Math.Max(1, d)];
            var idx = 0;
            for (var i = 0; i < y.Length; i++)
            {
                var b = buf[idx];
                var o = -y[i] + b;
                buf[idx] = y[i] + b * 0.5;
                idx = (idx + 1) % buf.Length;
                y[i] = o;
            }
        }
        return y;
    }
}
