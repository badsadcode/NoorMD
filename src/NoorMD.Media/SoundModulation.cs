namespace NoorMD.Media;

// Sound Bench modulation: sources (LFOs, envelopes, smooth random, step sequences, drawn curves and named knobs) routed
// to targets (a layer's level, pan, pitch, filter or event density; an effect's mix, EQ or drive; the master level or
// high cut). Each route has its own amount and response curve, so one knob ("Motor RPM") can move many things at once,
// each in its own way. Nothing here changes the recipe's values: modulation is added while the sound is rendered.

/// <summary>A control signal. LFOs and random are bipolar (−1…1); envelopes, steps and curves are 0…1.</summary>
public sealed class SoundModulator
{
    public const int Max = 8;
    public static readonly string[] Types = ["lfo", "envelope", "random", "steps", "curve"];

    public string Id { get; set; } = "";
    public string Name { get; set; } = "Modulator";
    public string Type { get; set; } = "lfo";
    /// <summary>LFO shape: "sine", "triangle", "square", "saw" or "hold" (a new random value each cycle).</summary>
    public string Shape { get; set; } = "sine";
    /// <summary>Cycles (LFO), changes (random) or steps (steps) per second.</summary>
    public double Rate { get; set; } = 1;
    /// <summary>LFO start phase (0–1).</summary>
    public double Phase { get; set; }
    // envelope (seconds; sustain 0–1)
    public double Start { get; set; }
    public double Attack { get; set; } = 0.05;
    public double Hold { get; set; }
    public double Decay { get; set; } = 0.3;
    public double Sustain { get; set; } = 0.5;
    /// <summary>Random and steps: 0 = jumps, 1 = glides.</summary>
    public double Smooth { get; set; } = 0.5;
    /// <summary>Steps (0–1 each), played in turn at Rate.</summary>
    public List<double> Steps { get; set; } = [1, 0.5, 0.75, 0.25];
    /// <summary>A drawn curve: [time 0–1 of the sound's length, value 0–1] points, joined by straight lines.</summary>
    public List<double[]> Points { get; set; } = [[0, 0], [1, 1]];

    private static double C(double v, double lo, double hi) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : lo;

    public SoundModulator Clamped()
    {
        Type = Types.Contains(Type) ? Type : "lfo";
        Name = string.IsNullOrWhiteSpace(Name) ? "Modulator" : Name.Trim()[..Math.Min(Name.Trim().Length, 40)];
        Shape = Shape is "sine" or "triangle" or "square" or "saw" or "hold" ? Shape : "sine";
        Rate = C(Rate, 0.01, 50); Phase = C(Phase, 0, 1);
        Start = C(Start, 0, 600); Attack = C(Attack, 0, 60); Hold = C(Hold, 0, 60); Decay = C(Decay, 0, 60); Sustain = C(Sustain, 0, 1); Smooth = C(Smooth, 0, 1);
        Steps = (Steps ?? []).Take(16).Select(v => C(v, 0, 1)).ToList();
        if (Steps.Count == 0) Steps = [0];
        Points = (Points ?? []).Where(p => p is { Length: 2 }).Take(64).Select(p => new[] { C(p[0], 0, 1), C(p[1], 0, 1) }).OrderBy(p => p[0]).ToList();
        if (Points.Count == 0) Points = [[0, 0], [1, 1]];
        return this;
    }
}

/// <summary>A named control for Quick mode ("Motor RPM", "Rain intensity"): 0–1, routed to as many targets as you like.</summary>
public sealed class SoundKnob
{
    public const int Max = 8;
    public string Id { get; set; } = "";
    public string Name { get; set; } = "Knob";
    public double Value { get; set; } = 0.5;

    public SoundKnob Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Knob" : Name.Trim()[..Math.Min(Name.Trim().Length, 40)];
        Value = double.IsFinite(Value) ? Math.Clamp(Value, 0, 1) : 0.5;
        return this;
    }
}

/// <summary>Source → target, by an amount in the target's unit (dB, semitones, octaves…), through a response curve.</summary>
public sealed class SoundRoute
{
    public const int Max = 48;
    /// <summary>A modulator's or a knob's id ("M1", "K1").</summary>
    public string Source { get; set; } = "";
    /// <summary>"L1:gain", "L2/F1:mix", "master:lowpass"… (see <see cref="SoundTargets"/>).</summary>
    public string Target { get; set; } = "";
    public double Amount { get; set; }
    /// <summary>Response: 1 = straight; above 1 = slow start, fast end; below 1 = fast start.</summary>
    public double Curve { get; set; } = 1;
    public bool Off { get; set; }

    public SoundRoute Clamped()
    {
        Source ??= ""; Target ??= "";
        var (lo, hi) = SoundTargets.AmountRange(Target);
        Amount = double.IsFinite(Amount) ? Math.Clamp(Amount, lo, hi) : 0;
        Curve = double.IsFinite(Curve) ? Math.Clamp(Curve, 0.25, 4) : 1;
        return this;
    }
}

/// <summary>What can be modulated, and in which unit an amount is given.</summary>
public static class SoundTargets
{
    /// <summary>Layer targets: level (dB), pan (−1…1), pitch (semitones), filter (octaves), density (octaves), grain position (0–1, ±).</summary>
    public static readonly string[] LayerParams = ["gain", "pan", "pitch", "freq", "density", "position"];
    /// <summary>Effect targets: mix (0–1), EQ frequency (octaves), EQ gain (dB), saturation drive (0–1).</summary>
    public static readonly string[] EffectParams = ["mix", "freq", "gain", "drive"];
    /// <summary>Master targets: level (dB) and high cut (octaves).</summary>
    public static readonly string[] MasterParams = ["gain", "lowpass"];

    public static string Param(string target) { var i = target.LastIndexOf(':'); return i >= 0 ? target[(i + 1)..] : ""; }

    public static bool IsEffect(string target) => target.Contains('/');

    /// <summary>Bus targets: "B1:gain" (dB), and its effects like any other ("B1/F1:mix").</summary>
    public static readonly string[] BusParams = ["gain"];

    public static (double Lo, double Hi) AmountRange(string target) => (IsEffect(target), Param(target)) switch
    {
        (false, "gain") => (-48, 48),
        (false, "pan") => (-2, 2),
        (false, "pitch") => (-48, 48),
        (false, "freq" or "density" or "lowpass") => (-6, 6),
        (false, "position") => (-1, 1),
        (true, "freq") => (-6, 6),
        (true, "gain") => (-36, 36),
        (true, "mix" or "drive") => (-1, 1),
        _ => (-1, 1),
    };
}

/// <summary>The modulation of one render: per target, an offset for every block of <see cref="Block"/> samples.</summary>
public sealed class ModulationField
{
    public const int Block = 32;
    private readonly Dictionary<string, double[]> _curves = new(StringComparer.Ordinal);
    public static readonly ModulationField None = new();

    private ModulationField() { }

    public ModulationField(SoundRecipe r, int sr, int total, int length)
    {
        if (r.Routes.Count == 0) return;
        var blocks = total / Block + 2;
        var seconds = (double)length / sr;
        var sources = new Dictionary<string, double[]>(StringComparer.Ordinal);
        for (var m = 0; m < r.Modulators.Count; m++)
        {
            var mod = r.Modulators[m];
            sources[mod.Id] = Evaluate(mod, blocks, sr, seconds, r.Loop, new SoundRng((ulong)(uint)r.Seed * 7919UL + (ulong)m * 104729UL + 3));
        }
        foreach (var k in r.Knobs) sources[k.Id] = Enumerable.Repeat(k.Value, blocks).ToArray();
        foreach (var route in r.Routes)
        {
            if (route.Off || route.Amount == 0 || !sources.TryGetValue(route.Source, out var src)) continue;
            if (!_curves.TryGetValue(route.Target, out var sum)) _curves[route.Target] = sum = new double[blocks];
            for (var b = 0; b < blocks; b++)
            {
                var v = src[b];
                if (route.Curve != 1) v = Math.Sign(v) * Math.Pow(Math.Abs(v), route.Curve);
                sum[b] += route.Amount * v;
            }
        }
    }

    /// <summary>The offsets for a target (per block), or null when nothing modulates it.</summary>
    public double[]? For(string target) => _curves.TryGetValue(target, out var c) ? c : null;

    /// <summary>The offset at a sample, eased between blocks (no zipper steps).</summary>
    public static double At(double[] curve, int i)
    {
        var b = i / Block;
        if (b + 1 >= curve.Length) return curve[^1];
        var f = (double)(i % Block) / Block;
        return curve[b] + (curve[b + 1] - curve[b]) * f;
    }

    private static double[] Evaluate(SoundModulator m, int blocks, int sr, double seconds, bool loop, SoundRng rng)
    {
        var v = new double[blocks];
        double held = rng.Bipolar(), from = rng.Bipolar(), to = rng.Bipolar();
        var lastCycle = -1L;
        var nextChange = 1.0;
        for (var b = 0; b < blocks; b++)
        {
            var t = (double)b * Block / sr;
            switch (m.Type)
            {
                case "lfo":
                {
                    var x = m.Rate * t + m.Phase;
                    var f = x - Math.Floor(x);
                    var cycle = (long)Math.Floor(x);
                    if (m.Shape == "hold" && cycle != lastCycle) { held = rng.Bipolar(); lastCycle = cycle; }
                    v[b] = m.Shape switch
                    {
                        "triangle" => f < 0.5 ? 4 * f - 1 : 3 - 4 * f,
                        "square" => f < 0.5 ? 1 : -1,
                        "saw" => 2 * f - 1,
                        "hold" => held,
                        _ => Math.Sin(2 * Math.PI * x),
                    };
                    break;
                }
                case "random":
                {
                    var x = t * m.Rate;
                    while (x >= nextChange) { from = to; to = rng.Bipolar(); nextChange += 1; }
                    var f = x - (nextChange - 1);
                    var s = m.Smooth <= 0 ? 0 : Math.Clamp((f - (1 - m.Smooth)) / m.Smooth, 0, 1);
                    s = s * s * (3 - 2 * s);
                    v[b] = from + (to - from) * s;
                    break;
                }
                case "steps":
                {
                    var x = t * m.Rate;
                    var n = m.Steps.Count;
                    var i = (int)(Math.Floor(x) % n);
                    var f = x - Math.Floor(x);
                    var cur = m.Steps[i];
                    var next = m.Steps[(i + 1) % n];
                    var s = m.Smooth <= 0 ? 0 : Math.Clamp((f - (1 - m.Smooth)) / m.Smooth, 0, 1);
                    s = s * s * (3 - 2 * s);
                    v[b] = cur + (next - cur) * s;
                    break;
                }
                case "curve":
                {
                    // Across the sound's length; a loop's blended tail reads the curve again from its start.
                    var x = seconds > 0 ? t / seconds : 0;
                    if (loop) x -= Math.Floor(x); else x = Math.Min(1, x);
                    v[b] = CurveAt(m.Points, x);
                    break;
                }
                default: // envelope
                {
                    var u = t - m.Start;
                    if (u < 0) v[b] = 0;
                    else if (u < m.Attack) v[b] = u / m.Attack;
                    else if (u < m.Attack + m.Hold) v[b] = 1;
                    else if (m.Decay > 0 && u < m.Attack + m.Hold + m.Decay) v[b] = 1 - (1 - m.Sustain) * (u - m.Attack - m.Hold) / m.Decay;
                    else v[b] = m.Sustain;
                    break;
                }
            }
        }
        return v;
    }

    public static double CurveAt(IReadOnlyList<double[]> points, double x)
    {
        if (x <= points[0][0]) return points[0][1];
        for (var i = 1; i < points.Count; i++)
        {
            if (x > points[i][0]) continue;
            var (x0, y0, x1, y1) = (points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
            return x1 - x0 < 1e-9 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        }
        return points[^1][1];
    }
}
