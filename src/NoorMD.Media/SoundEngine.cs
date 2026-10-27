using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media;

// Sound Bench: procedural sound effects and ambiences. A recipe is a stack of layers (noise beds, streams of small
// events such as rain drops or crackles, and simple synth voices) shaped by filters, slow "gust" movement and a master
// section. Rendering is deterministic: the same recipe and seed always give the same sound, so a recipe kept next to a
// WAV can make it again (or make variations of it).

/// <summary>The descriptive controls of Quick mode (0–1). At the neutral values a preset sounds as it was made.</summary>
public sealed class SoundMacros
{
    /// <summary>gentle ↔ violent (neutral 0.5)</summary>
    public double Intensity { get; set; } = 0.5;
    /// <summary>calm ↔ gusty (neutral 0.5)</summary>
    public double Gust { get; set; } = 0.5;
    /// <summary>soft ↔ sharp (neutral 0.5)</summary>
    public double Brightness { get; set; } = 0.5;
    /// <summary>near ↔ distant (neutral 0)</summary>
    public double Distance { get; set; }
    /// <summary>outdoors ↔ indoors (neutral 0)</summary>
    public double Shelter { get; set; }
}

/// <summary>The slow, irregular movement that layers can follow (gusts of wind, swells of rain).</summary>
public sealed class GustSettings
{
    /// <summary>About how many swells per minute.</summary>
    public double Rate { get; set; } = 6;
    /// <summary>How strong the swells are (0–1).</summary>
    public double Depth { get; set; } = 0.5;
    /// <summary>The level between swells (0–1).</summary>
    public double Base { get; set; } = 0.4;
}

public sealed class SoundLayer
{
    /// <summary>"noise" (a bed of filtered noise), "events" (many small sounds: drops, crackles) or "synth" (a tone with a pitch sweep).</summary>
    public string Type { get; set; } = "noise";
    public string Name { get; set; } = "Layer";
    public bool Mute { get; set; }
    public bool Solo { get; set; }
    /// <summary>Level in dB.</summary>
    public double Gain { get; set; } = -12;
    /// <summary>-1 left … 1 right.</summary>
    public double Pan { get; set; }
    /// <summary>Stereo spread (0 mono … 1 wide).</summary>
    public double Width { get; set; } = 0.7;
    /// <summary>How much the level follows the gusts (0–1).</summary>
    public double GustAmount { get; set; }
    /// <summary>Start time (s) and envelope for one-shots: attack and release in seconds (release 0 = continuous).</summary>
    public double Start { get; set; }
    public double Attack { get; set; }
    public double Release { get; set; }

    // noise
    /// <summary>"white", "pink" or "brown".</summary>
    public string Color { get; set; } = "pink";
    /// <summary>"lowpass", "highpass", "bandpass" or "none".</summary>
    public string Filter { get; set; } = "lowpass";
    public double Freq { get; set; } = 1000;
    public double Q { get; set; } = 0.7;
    /// <summary>How much the filter opens with the gusts (0–1, up to two octaves).</summary>
    public double GustFilter { get; set; }
    /// <summary>Slow random wandering of the filter (0–1, up to half an octave): a whistle that isn't a fixed tone.</summary>
    public double Drift { get; set; }
    /// <summary>Its own irregular level movement (0–1) and how fast (per second).</summary>
    public double Wobble { get; set; }
    public double WobbleRate { get; set; } = 1;

    // events
    /// <summary>Events per second (at neutral intensity).</summary>
    public double Density { get; set; } = 20;
    /// <summary>How long each event rings (ms).</summary>
    public double Decay { get; set; } = 10;
    /// <summary>Pitch of the events (Hz) and its spread (octaves either way).</summary>
    public double Pitch { get; set; } = 3000;
    public double PitchSpread { get; set; } = 0.7;
    /// <summary>0 = a dry click, 1 = a ringing ping.</summary>
    public double Tone { get; set; } = 0.3;
    /// <summary>Random loudness of each event (dB).</summary>
    public double GainSpread { get; set; } = 6;

    // synth
    /// <summary>"sine", "square", "saw", "triangle" or "noise".</summary>
    public string Wave { get; set; } = "sine";
    /// <summary>Pitch at the end of the sweep (Hz); 0 = no sweep.</summary>
    public double PitchEnd { get; set; }
    public double Hold { get; set; }
    public double Vibrato { get; set; }
    public double VibratoRate { get; set; } = 6;
    /// <summary>Repeat every this many seconds (0 = once).</summary>
    public double Repeat { get; set; }

    public SoundLayer Clone() => (SoundLayer)MemberwiseClone();
}

public sealed class MasterSettings
{
    public double Gain { get; set; }
    public double HighPass { get; set; } = 20;
    public double LowPass { get; set; } = 20000;
    public double Width { get; set; } = 1;
    /// <summary>Room sound (0 dry … 1 very wet) and room size (0 small … 1 large).</summary>
    public double Reverb { get; set; }
    public double Room { get; set; } = 0.5;
    /// <summary>Bring the loudest peak to the ceiling (one-shots); otherwise only peaks above it are softened.</summary>
    public bool Normalize { get; set; }
    public double Ceiling { get; set; } = -1;
}

public sealed class SoundRecipe
{
    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Untitled sound";
    public string Family { get; set; } = "Custom";
    public int Seed { get; set; } = 1;
    /// <summary>Length in seconds (a loop's length; a one-shot's length).</summary>
    public double Duration { get; set; } = 10;
    /// <summary>A seamless loop (the end flows into the start) or a one-shot.</summary>
    public bool Loop { get; set; } = true;
    public SoundMacros Macros { get; set; } = new();
    public GustSettings Gust { get; set; } = new();
    public List<SoundLayer> Layers { get; set; } = [];
    public MasterSettings Master { get; set; } = new();

    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.Never };

    public string ToJson() => JsonSerializer.Serialize(this, Options);

    /// <summary>Reads a recipe and keeps every value within its sensible range.</summary>
    public static SoundRecipe FromJson(string json)
    {
        var r = JsonSerializer.Deserialize<SoundRecipe>(json, Options) ?? throw new ArgumentException("That is not a sound recipe.");
        return r.Clamped();
    }

    public SoundRecipe Clone() => FromJson(ToJson());

    private static double C(double v, double lo, double hi) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : lo;

    public SoundRecipe Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Untitled sound" : Name.Trim()[..Math.Min(Name.Trim().Length, 80)];
        Family = string.IsNullOrWhiteSpace(Family) ? "Custom" : Family.Trim()[..Math.Min(Family.Trim().Length, 40)];
        Duration = C(Duration, 0.05, 600);
        Macros ??= new(); Gust ??= new(); Master ??= new(); Layers ??= [];
        Macros.Intensity = C(Macros.Intensity, 0, 1); Macros.Gust = C(Macros.Gust, 0, 1); Macros.Brightness = C(Macros.Brightness, 0, 1);
        Macros.Distance = C(Macros.Distance, 0, 1); Macros.Shelter = C(Macros.Shelter, 0, 1);
        Gust.Rate = C(Gust.Rate, 0.5, 60); Gust.Depth = C(Gust.Depth, 0, 1); Gust.Base = C(Gust.Base, 0, 1);
        if (Layers.Count > 16) Layers = Layers.Take(16).ToList();
        foreach (var l in Layers)
        {
            l.Type = l.Type is "noise" or "events" or "synth" ? l.Type : "noise";
            l.Name = string.IsNullOrWhiteSpace(l.Name) ? "Layer" : l.Name.Trim()[..Math.Min(l.Name.Trim().Length, 60)];
            l.Gain = C(l.Gain, -80, 12); l.Pan = C(l.Pan, -1, 1); l.Width = C(l.Width, 0, 1); l.GustAmount = C(l.GustAmount, 0, 1);
            l.Start = C(l.Start, 0, 600); l.Attack = C(l.Attack, 0, 60); l.Release = C(l.Release, 0, 120);
            l.Color = l.Color is "white" or "pink" or "brown" ? l.Color : "pink";
            l.Filter = l.Filter is "lowpass" or "highpass" or "bandpass" or "none" ? l.Filter : "lowpass";
            l.Freq = C(l.Freq, 20, 20000); l.Q = C(l.Q, 0.1, 60); l.GustFilter = C(l.GustFilter, 0, 1); l.Drift = C(l.Drift, 0, 1);
            l.Wobble = C(l.Wobble, 0, 1); l.WobbleRate = C(l.WobbleRate, 0.05, 20);
            l.Density = C(l.Density, 0, 5000); l.Decay = C(l.Decay, 0.5, 3000); l.Pitch = C(l.Pitch, 20, 16000); l.PitchSpread = C(l.PitchSpread, 0, 3);
            l.Tone = C(l.Tone, 0, 1); l.GainSpread = C(l.GainSpread, 0, 30);
            l.Wave = l.Wave is "sine" or "square" or "saw" or "triangle" or "noise" ? l.Wave : "sine";
            l.PitchEnd = C(l.PitchEnd, 0, 16000); l.Hold = C(l.Hold, 0, 60); l.Vibrato = C(l.Vibrato, 0, 1); l.VibratoRate = C(l.VibratoRate, 0.1, 30); l.Repeat = C(l.Repeat, 0, 60);
        }
        Master.Gain = C(Master.Gain, -40, 24); Master.HighPass = C(Master.HighPass, 10, 5000); Master.LowPass = C(Master.LowPass, 200, 20000);
        Master.Width = C(Master.Width, 0, 2); Master.Reverb = C(Master.Reverb, 0, 1); Master.Room = C(Master.Room, 0, 1); Master.Ceiling = C(Master.Ceiling, -24, 0);
        return this;
    }

    /// <summary>The recipe with the Quick controls worked into its layers and master (what is actually rendered).</summary>
    public SoundRecipe WithMacrosApplied()
    {
        var r = Clone();
        var m = r.Macros;
        var intensity = m.Intensity - 0.5; // -0.5 … 0.5
        r.Gust.Depth = Math.Clamp(r.Gust.Depth * (0.2 + 1.6 * m.Gust) * (1 + intensity * 0.6), 0, 1);
        r.Gust.Rate *= 0.6 + 0.8 * m.Gust;
        foreach (var l in r.Layers)
        {
            l.Gain += intensity * 14;
            if (l.Type == "events") { l.Density *= Math.Pow(2, intensity * 3.2); l.Gain -= m.Distance * 10 + m.Shelter * 6; l.Pitch *= Math.Pow(2, (m.Brightness - 0.5) * 0.8); }
            if (l.Type == "noise" && l.Filter != "none") l.Freq = Math.Clamp(l.Freq * Math.Pow(2, (m.Brightness - 0.5) * 2 + intensity * 0.8), 20, 20000);
            l.Width *= 1 - 0.5 * m.Distance;
        }
        // Far away: the highs go first. Indoors: muffled, with a room.
        var lp = 20000 * Math.Pow(2500.0 / 20000, Math.Pow(m.Distance, 1.3)) * Math.Pow(900.0 / 20000, m.Shelter * 0.75);
        r.Master.LowPass = Math.Min(r.Master.LowPass, lp);
        r.Master.Reverb = Math.Clamp(r.Master.Reverb + m.Distance * 0.25 + m.Shelter * 0.3, 0, 1);
        if (m.Shelter > 0) r.Master.Room = Math.Min(r.Master.Room, 1 - m.Shelter * 0.6);
        r.Master.Gain -= m.Distance * 4;
        return r;
    }
}

/// <summary>A rendered sound: stereo samples (−1…1) and what it measured.</summary>
public sealed class SoundRender
{
    public required int SampleRate { get; init; }
    public required float[] Left { get; init; }
    public required float[] Right { get; init; }
    public double PeakDb { get; init; }
    public double RmsDb { get; init; }
    public double Seconds => (double)Left.Length / SampleRate;

    /// <summary>Min/max of each of <paramref name="buckets"/> slices of the mono mix (for drawing the waveform).</summary>
    public float[] Peaks(int buckets)
    {
        buckets = Math.Clamp(buckets, 1, 4000);
        var outp = new float[buckets * 2];
        var n = Left.Length;
        for (var b = 0; b < buckets; b++)
        {
            int from = (int)((long)b * n / buckets), to = (int)Math.Max(from + 1, (long)(b + 1) * n / buckets);
            float lo = 0, hi = 0;
            for (var i = from; i < to && i < n; i++) { var v = (Left[i] + Right[i]) * 0.5f; if (v < lo) lo = v; if (v > hi) hi = v; }
            outp[b * 2] = lo; outp[b * 2 + 1] = hi;
        }
        return outp;
    }

    /// <summary>A PCM WAV file (16 or 24 bit, stereo).</summary>
    public byte[] ToWav(int bits = 16)
    {
        if (bits is not (16 or 24)) throw new ArgumentException("WAV is written as 16 or 24 bit.");
        var bytesPer = bits / 8;
        var dataLen = Left.Length * 2 * bytesPer;
        var ms = new MemoryStream(44 + dataLen);
        void W32(int v) { ms.WriteByte((byte)v); ms.WriteByte((byte)(v >> 8)); ms.WriteByte((byte)(v >> 16)); ms.WriteByte((byte)(v >> 24)); }
        void W16(int v) { ms.WriteByte((byte)v); ms.WriteByte((byte)(v >> 8)); }
        ms.Write("RIFF"u8); W32(36 + dataLen); ms.Write("WAVEfmt "u8); W32(16); W16(1); W16(2); W32(SampleRate); W32(SampleRate * 2 * bytesPer); W16(2 * bytesPer); W16(bits);
        ms.Write("data"u8); W32(dataLen);
        var max = bits == 16 ? 32767.0 : 8388607.0;
        // TPDF dither for 16-bit, so quiet tails fade smoothly instead of stepping.
        var rng = new SoundRng(0x5eed);
        for (var i = 0; i < Left.Length; i++)
            foreach (var s in new[] { Left[i], Right[i] })
            {
                var d = bits == 16 ? (rng.NextDouble() - rng.NextDouble()) : 0;
                var v = (int)Math.Round(Math.Clamp(s, -1f, 1f) * max + d);
                v = (int)Math.Clamp(v, -max - 1, max);
                if (bits == 16) W16(v); else { ms.WriteByte((byte)v); ms.WriteByte((byte)(v >> 8)); ms.WriteByte((byte)(v >> 16)); }
            }
        return ms.ToArray();
    }
}

/// <summary>A small, fast, seedable random generator (SplitMix64), so renders repeat exactly.</summary>
public sealed class SoundRng(ulong seed)
{
    private ulong _s = seed;
    public ulong Next() { var z = _s += 0x9E3779B97F4A7C15UL; z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL; z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL; return z ^ (z >> 31); }
    public double NextDouble() => (Next() >> 11) * (1.0 / (1UL << 53));
    public double Bipolar() => NextDouble() * 2 - 1;
    public double Gaussian() { var u = 1 - NextDouble(); var v = NextDouble(); return Math.Sqrt(-2 * Math.Log(u)) * Math.Cos(2 * Math.PI * v); }
}

public static class SoundEngine
{
    private const int Block = 32; // filter settings and movement are updated every 32 samples

    public static SoundRender Render(SoundRecipe recipe, int sampleRate = 48000)
    {
        if (sampleRate is < 8000 or > 192000) throw new ArgumentException("Sample rate out of range.");
        var r = recipe.Clone().Clamped().WithMacrosApplied();
        var length = (int)Math.Round(r.Duration * sampleRate);
        // A loop is rendered a little longer: that extra part is blended into its start, so the end flows into it.
        var fade = r.Loop ? (int)Math.Min(length * 0.25, 2.0 * sampleRate) : 0;
        var total = length + fade;
        var L = new double[total];
        var R = new double[total];
        var gust = GustCurve(r, total, sampleRate);
        var soloing = r.Layers.Any(l => l.Solo && !l.Mute);
        for (var k = 0; k < r.Layers.Count; k++)
        {
            var layer = r.Layers[k];
            if (layer.Mute || (soloing && !layer.Solo)) continue;
            // Each layer has its own random stream: muting one doesn't change the others.
            var rng = new SoundRng((ulong)(uint)r.Seed * 0x100000001B3UL + (ulong)k * 0x9E37UL + 17);
            switch (layer.Type)
            {
                case "noise": RenderNoise(layer, rng, gust, L, R, sampleRate, total, r.Loop); break;
                case "events": RenderEvents(layer, rng, gust, L, R, sampleRate, total); break;
                case "synth": RenderSynth(layer, rng, L, R, sampleRate, total); break;
            }
        }
        MasterChain(r.Master, L, R, sampleRate);
        float[] outL = new float[length], outR = new float[length];
        for (var i = 0; i < length; i++)
        {
            double l = L[i], rr = R[i];
            if (i < fade)
            {
                // Equal-power blend: sample 0 is the sample that follows the last one, so the loop has no seam.
                var t = (double)i / fade * Math.PI / 2;
                l = L[i] * Math.Sin(t) + L[length + i] * Math.Cos(t);
                rr = R[i] * Math.Sin(t) + R[length + i] * Math.Cos(t);
            }
            outL[i] = (float)l; outR[i] = (float)rr;
        }
        if (!r.Loop) FadeEdges(outL, outR, sampleRate);
        var peak = 0.0;
        for (var i = 0; i < length; i++) peak = Math.Max(peak, Math.Max(Math.Abs(outL[i]), Math.Abs(outR[i])));
        var ceiling = Math.Pow(10, r.Master.Ceiling / 20);
        if (r.Master.Normalize && peak > 1e-6) Scale(outL, outR, ceiling / peak);
        Limit(outL, outR, ceiling);
        double sumSq = 0; peak = 0;
        for (var i = 0; i < length; i++)
        {
            sumSq += (outL[i] * (double)outL[i] + outR[i] * (double)outR[i]) / 2;
            peak = Math.Max(peak, Math.Max(Math.Abs(outL[i]), Math.Abs(outR[i])));
        }
        var rms = Math.Sqrt(sumSq / Math.Max(1, length));
        return new SoundRender { SampleRate = sampleRate, Left = outL, Right = outR, PeakDb = Db(peak), RmsDb = Db(rms) };
    }

    private static double Db(double v) => v > 1e-9 ? Math.Round(20 * Math.Log10(v), 1) : -120;

    /// <summary>
    /// The gusts: a smooth, irregular curve (0–1), one value per block. Swells come at random spacing around the rate,
    /// rise a little faster than they fall, and are never a regular cycle.
    /// </summary>
    private static double[] GustCurve(SoundRecipe r, int total, int sr)
    {
        var blocks = total / Block + 2;
        var g = new double[blocks];
        var rng = new SoundRng((ulong)(uint)r.Seed * 31 + 7);
        var mean = 60.0 / Math.Max(0.5, r.Gust.Rate); // seconds between swells
        double t0 = 0, v0 = rng.NextDouble(), t1 = mean * (0.4 + rng.NextDouble()), v1 = rng.NextDouble();
        var fast = new SoundRng((ulong)(uint)r.Seed * 131 + 3);
        double f0 = 0, f1 = fast.Bipolar(), ft = 0;
        for (var b = 0; b < blocks; b++)
        {
            var t = (double)b * Block / sr;
            while (t > t1) { t0 = t1; v0 = v1; t1 += mean * (0.35 + 1.3 * rng.NextDouble()); v1 = Math.Pow(rng.NextDouble(), 1.6); }
            var x = (t - t0) / (t1 - t0);
            x = v1 > v0 ? Math.Pow(x, 0.75) : Math.Pow(x, 1.25); // swells rise faster than they die away
            var s = x * x * (3 - 2 * x);
            var slow = v0 + (v1 - v0) * s;
            // A little faster flutter on top.
            ft += (double)Block / sr * 1.7;
            if (ft >= 1) { ft -= 1; f0 = f1; f1 = fast.Bipolar(); }
            var fs = ft * ft * (3 - 2 * ft);
            var flutter = (f0 + (f1 - f0) * fs) * 0.12;
            g[b] = Math.Clamp(r.Gust.Base + r.Gust.Depth * (slow - 0.35) * 1.6 + flutter * r.Gust.Depth, 0, 1);
        }
        return g;
    }

    /// <summary>A one-shot envelope from a layer's start, attack and release (1 throughout when release is 0).</summary>
    private static double Envelope(SoundLayer l, double t)
    {
        if (t < l.Start) return 0;
        var u = t - l.Start;
        var a = l.Attack > 0 ? Math.Min(1, u / l.Attack) : 1;
        if (l.Release <= 0) return a;
        var d = u - l.Attack - l.Hold;
        return d <= 0 ? a : a * Math.Exp(-d * 6.9 / l.Release); // −60 dB after Release seconds
    }

    private sealed class Biquad
    {
        private double _b0, _b1, _b2, _a1, _a2, _x1, _x2, _y1, _y2;
        public void Set(string type, double freq, double q, int sr)
        {
            freq = Math.Clamp(freq, 10, sr * 0.45);
            var w = 2 * Math.PI * freq / sr;
            double cos = Math.Cos(w), alpha = Math.Sin(w) / (2 * Math.Max(0.05, q));
            double b0, b1, b2, a0 = 1 + alpha;
            switch (type)
            {
                case "highpass": b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; break;
                case "bandpass": b0 = alpha; b1 = 0; b2 = -alpha; break;
                default: b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; break;
            }
            _b0 = b0 / a0; _b1 = b1 / a0; _b2 = b2 / a0; _a1 = -2 * cos / a0; _a2 = (1 - alpha) / a0;
        }
        public double Run(double x)
        {
            var y = _b0 * x + _b1 * _x1 + _b2 * _x2 - _a1 * _y1 - _a2 * _y2;
            _x2 = _x1; _x1 = x; _y2 = _y1; _y1 = y;
            return y;
        }
    }

    /// <summary>Pink noise (Paul Kellet's filter), brown noise (leaky integration) or white.</summary>
    private sealed class NoiseSource(string color, SoundRng rng)
    {
        private double _b0, _b1, _b2, _b3, _b4, _b5, _b6, _brown;
        public double Next()
        {
            var w = rng.Bipolar();
            switch (color)
            {
                case "white": return w * 0.5;
                case "brown": _brown = (_brown + 0.02 * w) / 1.02; return _brown * 3.5;
                default:
                    _b0 = 0.99886 * _b0 + w * 0.0555179; _b1 = 0.99332 * _b1 + w * 0.0750759; _b2 = 0.96900 * _b2 + w * 0.1538520;
                    _b3 = 0.86650 * _b3 + w * 0.3104856; _b4 = 0.55000 * _b4 + w * 0.5329522; _b5 = -0.7616 * _b5 - w * 0.0168980;
                    var p = _b0 + _b1 + _b2 + _b3 + _b4 + _b5 + _b6 + w * 0.5362; _b6 = w * 0.115926;
                    return p * 0.11;
            }
        }
    }

    /// <summary>A smooth random curve (−1…1) for wobble and drift.</summary>
    private sealed class Wander(SoundRng rng, double ratePerSecond)
    {
        private double _a = rng.Bipolar(), _b = rng.Bipolar(), _t;
        public double Next(double dt)
        {
            _t += dt * ratePerSecond;
            while (_t >= 1) { _t -= 1; _a = _b; _b = rng.Bipolar(); }
            var s = _t * _t * (3 - 2 * _t);
            return _a + (_b - _a) * s;
        }
    }

    private static (double L, double R) PanGains(double pan)
    {
        var a = (Math.Clamp(pan, -1, 1) + 1) * Math.PI / 4;
        return (Math.Cos(a) * Math.Sqrt(2), Math.Sin(a) * Math.Sqrt(2));
    }

    private static void RenderNoise(SoundLayer l, SoundRng rng, double[] gust, double[] L, double[] R, int sr, int total, bool loop)
    {
        var srcL = new NoiseSource(l.Color, new SoundRng(rng.Next()));
        var srcR = new NoiseSource(l.Color, new SoundRng(rng.Next()));
        var fl = new Biquad(); var fr = new Biquad();
        var wobble = new Wander(new SoundRng(rng.Next()), l.WobbleRate);
        var drift = new Wander(new SoundRng(rng.Next()), 0.3);
        var gain = Math.Pow(10, l.Gain / 20);
        var (pl, pr) = PanGains(l.Pan);
        var dt = (double)Block / sr;
        // Two passes of a bandpass (steeper, for whistles and narrow bands) keep their level near the others'.
        var narrow = l.Filter == "bandpass" && l.Q > 4;
        var fl2 = new Biquad(); var fr2 = new Biquad();
        double amp = 0;
        for (var start = 0; start < total; start += Block)
        {
            var b = start / Block;
            var g = gust[b];
            var w = 1 + l.Wobble * 0.8 * wobble.Next(dt);
            var target = gain * (1 - l.GustAmount + l.GustAmount * g * 1.6) * Math.Max(0, w) * Envelope(l, (double)start / sr);
            if (l.Filter != "none")
            {
                var f = l.Freq * Math.Pow(2, l.GustFilter * 2 * (g - 0.4)) * Math.Pow(2, l.Drift * 0.5 * drift.Next(dt));
                fl.Set(l.Filter, f, l.Q, sr); fr.Set(l.Filter, f, l.Q, sr);
                if (narrow) { fl2.Set("bandpass", f, l.Q, sr); fr2.Set("bandpass", f, l.Q, sr); }
            }
            var end = Math.Min(total, start + Block);
            for (var i = start; i < end; i++)
            {
                amp += (target - amp) * 0.02; // no clicks when the level moves
                var a = srcL.Next();
                var c = srcR.Next();
                var right = a * (1 - l.Width) + c * l.Width;
                double x = a, y = right;
                if (l.Filter != "none")
                {
                    x = fl.Run(x); y = fr.Run(y);
                    if (narrow) { x = fl2.Run(x) * Math.Sqrt(l.Q); y = fr2.Run(y) * Math.Sqrt(l.Q); }
                }
                L[i] += x * amp * pl; R[i] += y * amp * pr;
            }
        }
    }

    private sealed class Voice
    {
        public double Amp, PanL, PanR, Decay, R1, R2, Coef, Rr, Tone, Click, Age, Hp, Xp;
        public int BurstLeft;
    }

    /// <summary>Many small sounds at random times: a short noise burst (the click) ringing a little resonator (the ping).</summary>
    private static void RenderEvents(SoundLayer l, SoundRng rng, double[] gust, double[] L, double[] R, int sr, int total)
    {
        var voices = new List<Voice>();
        var gain = Math.Pow(10, l.Gain / 20);
        var hpCoef = Math.Exp(-2 * Math.PI * Math.Min(l.Pitch * 0.6, sr * 0.4) / sr);
        for (var start = 0; start < total; start += Block)
        {
            var g = gust[start / Block];
            var env = Envelope(l, (double)start / sr);
            var rate = l.Density * (1 - l.GustAmount + l.GustAmount * g * 1.8) * (env > 0 ? 1 : 0);
            var end = Math.Min(total, start + Block);
            for (var i = start; i < end; i++)
            {
                // Poisson arrivals: at most one new event per sample, which is plenty below 48 000 per second.
                if (rate > 0 && rng.NextDouble() < rate / sr && voices.Count < 512)
                {
                    var freq = Math.Clamp(l.Pitch * Math.Pow(2, l.PitchSpread * rng.Bipolar()), 30, sr * 0.45);
                    var decay = l.Decay / 1000 * (0.6 + 0.8 * rng.NextDouble());
                    var rr = Math.Exp(-6.9 / (decay * sr)); // −60 dB after the decay time
                    var pan = Math.Clamp(l.Pan + l.Width * rng.Bipolar(), -1, 1);
                    var (pl, pr) = PanGains(pan);
                    var amp = gain * env * Math.Pow(10, -l.GainSpread * Math.Abs(rng.Gaussian()) / 20);
                    voices.Add(new Voice
                    {
                        Amp = amp, PanL = pl, PanR = pr, Decay = Math.Exp(-6.9 / (Math.Max(0.0005, decay * 0.25) * sr)), Rr = rr,
                        Coef = 2 * rr * Math.Cos(2 * Math.PI * freq / sr), Tone = l.Tone, BurstLeft = Math.Max(2, (int)(sr * (0.0004 + 0.0012 * rng.NextDouble()))), Click = 1,
                    });
                }
                double sumL = 0, sumR = 0;
                for (var v = voices.Count - 1; v >= 0; v--)
                {
                    var o = voices[v];
                    var x = o.BurstLeft > 0 ? rng.Bipolar() : 0;
                    if (o.BurstLeft > 0) o.BurstLeft--;
                    // The click: the burst, high-passed, dying away quickly.
                    o.Hp = hpCoef * (o.Hp + x - o.Xp); // one-pole high-pass: a brighter click for a higher pitch
                    o.Xp = x;
                    var click = o.Hp * o.Click;
                    o.Click *= o.Decay;
                    // The ping: the burst exciting a resonator.
                    var y = o.Coef * o.R1 - o.Rr * o.Rr * o.R2 + x * (1 - o.Rr) * 4;
                    o.R2 = o.R1; o.R1 = y;
                    var s = (click * (1 - o.Tone) + y * o.Tone) * o.Amp;
                    sumL += s * o.PanL; sumR += s * o.PanR;
                    o.Age++;
                    if (o.BurstLeft == 0 && o.Click < 1e-4 && Math.Abs(o.R1) < 1e-5 && Math.Abs(o.R2) < 1e-5) voices.RemoveAt(v);
                    else if (o.Age > sr * 4) voices.RemoveAt(v);
                }
                L[i] += sumL; R[i] += sumR;
            }
        }
    }

    /// <summary>A tone with a pitch sweep and an envelope (UI sounds, pickups, lasers, booms); it can repeat.</summary>
    private static void RenderSynth(SoundLayer l, SoundRng rng, double[] L, double[] R, int sr, int total)
    {
        var gain = Math.Pow(10, l.Gain / 20);
        var (pl, pr) = PanGains(l.Pan);
        var span = l.Attack + l.Hold + Math.Max(0.001, l.Release > 0 ? l.Release : 0.3);
        var starts = new List<double>();
        if (l.Repeat > 0) for (var t = l.Start; t < (double)total / sr; t += l.Repeat) starts.Add(t);
        else starts.Add(l.Start);
        foreach (var t0 in starts)
        {
            var phase = 0.0;
            var from = (int)(t0 * sr);
            var to = Math.Min(total, from + (int)(span * sr) + 1);
            for (var i = from; i < to; i++)
            {
                var u = (double)(i - from) / sr;
                var x = Math.Clamp(u / span, 0, 1);
                var f = l.PitchEnd > 0 ? l.Pitch * Math.Pow(l.PitchEnd / l.Pitch, x) : l.Pitch;
                f *= 1 + l.Vibrato * 0.06 * Math.Sin(2 * Math.PI * l.VibratoRate * u);
                phase += f / sr; phase -= Math.Floor(phase);
                double s = l.Wave switch
                {
                    "square" => phase < 0.5 ? 0.6 : -0.6,
                    "saw" => (2 * phase - 1) * 0.6,
                    "triangle" => (phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase) * 0.8,
                    "noise" => rng.Bipolar() * 0.6,
                    _ => Math.Sin(2 * Math.PI * phase),
                };
                var a = l.Attack > 0 ? Math.Min(1, u / l.Attack) : Math.Min(1, u * sr / 16); // never a hard click at the start
                var d = u - l.Attack - l.Hold;
                var env = d <= 0 ? a : a * Math.Exp(-d * 6.9 / Math.Max(0.001, l.Release > 0 ? l.Release : 0.3));
                var v = s * env * gain;
                L[i] += v * pl; R[i] += v * pr;
            }
        }
    }

    /// <summary>High-pass, low-pass, width, a small room (Schroeder: combs and all-passes) and the master level.</summary>
    private static void MasterChain(MasterSettings m, double[] L, double[] R, int sr)
    {
        var hpL = new Biquad(); var hpR = new Biquad(); var lpL = new Biquad(); var lpR = new Biquad();
        hpL.Set("highpass", m.HighPass, 0.707, sr); hpR.Set("highpass", m.HighPass, 0.707, sr);
        var lowpass = m.LowPass < 19000;
        if (lowpass) { lpL.Set("lowpass", m.LowPass, 0.707, sr); lpR.Set("lowpass", m.LowPass, 0.707, sr); }
        var gain = Math.Pow(10, m.Gain / 20);
        for (var i = 0; i < L.Length; i++)
        {
            double l = hpL.Run(L[i]), r = hpR.Run(R[i]);
            if (lowpass) { l = lpL.Run(l); r = lpR.Run(r); }
            var mid = (l + r) / 2; var side = (l - r) / 2 * m.Width;
            L[i] = (mid + side) * gain; R[i] = (mid - side) * gain;
        }
        if (m.Reverb <= 0.001) return;
        var scale = sr / 44100.0 * (0.5 + m.Room);
        int[] combs = [1116, 1188, 1277, 1356], allp = [556, 441];
        var wetL = Room(L, combs.Select(c => (int)(c * scale)).ToArray(), allp.Select(a => (int)(a * scale)).ToArray(), 0.7 + 0.25 * m.Room);
        var wetR = Room(R, combs.Select(c => (int)((c + 23) * scale)).ToArray(), allp.Select(a => (int)((a + 23) * scale)).ToArray(), 0.7 + 0.25 * m.Room);
        var wet = m.Reverb * 0.6; var dry = 1 - m.Reverb * 0.5;
        for (var i = 0; i < L.Length; i++) { L[i] = L[i] * dry + wetL[i] * wet; R[i] = R[i] * dry + wetR[i] * wet; }
    }

    private static double[] Room(double[] x, int[] combs, int[] allpasses, double feedback)
    {
        var y = new double[x.Length];
        foreach (var d in combs)
        {
            var buf = new double[Math.Max(1, d)];
            var idx = 0; double store = 0;
            for (var i = 0; i < x.Length; i++)
            {
                var o = buf[idx];
                store = o * 0.8 + store * 0.2; // damping: the highs die first
                buf[idx] = x[i] * 0.25 + store * feedback;
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

    private static void FadeEdges(float[] l, float[] r, int sr)
    {
        var n = Math.Min(l.Length / 4, (int)(sr * 0.02));
        for (var i = 0; i < n; i++)
        {
            var g = (float)i / n;
            l[l.Length - 1 - i] *= g; r[r.Length - 1 - i] *= g;
        }
    }

    private static void Scale(float[] l, float[] r, double k) { for (var i = 0; i < l.Length; i++) { l[i] = (float)(l[i] * k); r[i] = (float)(r[i] * k); } }

    /// <summary>A soft limiter: below the knee nothing changes; above it, peaks are rounded off toward the ceiling.</summary>
    private static void Limit(float[] l, float[] r, double ceiling)
    {
        var knee = ceiling * 0.8;
        for (var i = 0; i < l.Length; i++) { l[i] = Soft(l[i], knee, ceiling); r[i] = Soft(r[i], knee, ceiling); }
    }

    private static float Soft(float x, double knee, double ceiling)
    {
        var a = Math.Abs(x);
        if (a <= knee) return x;
        var over = (a - knee) / (ceiling - knee);
        var y = knee + (ceiling - knee) * Math.Tanh(over);
        return (float)(Math.Sign(x) * y);
    }
}
