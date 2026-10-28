using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class SoundModulationTests
{
    private const int Sr = 22050;

    /// <summary>Fingerprints of presets rendered by 2.0.0-preview.28 (before modulation): RMS and twelve samples.</summary>
    private static readonly Dictionary<string, (double Rms, double[] Samples)> Preview28 = new()
    {
        ["wind-storm"] = (-10.5, new double[] {0.225652, 0.619092, -0.436137, 0.156744, -0.513681, -0.551515, 0.212448, 0.205679, -0.269733, -0.286640, -0.355327, -0.130720}),
        ["rain-steady"] = (-20.3, new double[] {0.119888, 0.126634, 0.109341, 0.000915, 0.049118, -0.014107, 0.133322, 0.031202, 0.209806, 0.179773, -0.195269, -0.008033}),
        ["fire-camp"] = (-23, new double[] {-0.049435, 0.161297, -0.033161, 0.040866, -0.066264, -0.103083, 0.053012, 0.105306, -0.153059, -0.139835, -0.156367, -0.058437}),
        ["step-gravel"] = (-22.4, new double[] {0.036417, -0.001959, 0.000042, -0.000002, 0.000000, -0.000000, 0.000000, -0.000000, 0.000000, -0.000000, 0.000000, -0.000000}),
        ["hit-metal"] = (-18.9, new double[] {0.253133, -0.130394, -0.062401, 0.001014, 0.006408, -0.014476, -0.009252, 0.004358, -0.002789, -0.000837, 0.000730, 0.000095}),
        ["machine-engine"] = (-20.6, new double[] {0.098641, 0.064606, 0.064392, 0.045965, 0.066298, 0.065425, 0.011557, -0.010096, -0.030465, -0.081174, -0.147517, -0.203487}),
        ["scifi-teleport"] = (-16.9, new double[] {-0.225846, 0.222668, -0.093920, -0.037312, -0.017067, -0.006638, 0.000804, -0.000284, 0.000436, -0.000219, -0.000001, -0.000001}),
        ["ui-coin"] = (-7.7, new double[] {0.844741, 0.828209, -0.804626, -0.408980, 0.164542, 0.071740, -0.028059, -0.011901, 0.004934, 0.002078, -0.000817, 0.000335}),
        ["retro-powerup"] = (-14.4, new double[] {0.489802, -0.234911, 0.106593, -0.049499, 0.027599, 0.013440, 0.006401, -0.002216, 0.002091, 0.000001, 0.000000, 0.000000}),
        ["magic-sparkle"] = (-17.6, new double[] {-0.632628, 0.037967, -0.051440, 0.048781, -0.020987, -0.004608, 0.003150, 0.001773, -0.001144, 0.000518, -0.000020, -0.000059}),
    };

    [Fact]
    public void Presets_Sound_Exactly_As_They_Did_Before_Modulation_Existed()
    {
        foreach (var (id, (rms, samples)) in Preview28)
        {
            var r = SoundPresets.Make(id);
            r.Duration = Math.Min(r.Duration, 2);
            var x = SoundEngine.Render(r, Sr);
            Assert.Equal(rms, x.RmsDb, 1);
            var picks = Enumerable.Range(1, 12).Select(k => (double)x.Left[(int)((long)k * (x.Left.Length - 1) / 13)]).ToArray();
            for (var k = 0; k < 12; k++) Assert.True(Math.Abs(picks[k] - samples[k]) < 1e-4, $"{id} sample {k}: {picks[k]} vs {samples[k]}");
        }
    }

    private static double Rms(float[] x, int from, int to) { double s = 0; for (var i = from; i < to; i++) s += x[i] * (double)x[i]; return 10 * Math.Log10(s / (to - from) + 1e-20); }
    private static int Crossings(float[] x, int from, int to) { var z = 0; for (var i = from + 1; i < to; i++) if (Math.Sign(x[i]) != Math.Sign(x[i - 1])) z++; return z; }

    private static SoundRecipe Tone(double seconds = 2) => new()
    {
        Duration = seconds, Loop = false, Gust = new GustSettings { Depth = 0 },
        Layers = [new SoundLayer { Type = "synth", Name = "Tone", Wave = "sine", Pitch = 440, Attack = 0.01, Hold = 600, Release = 0.1, Gain = -12, Width = 0 }],
    };

    [Fact]
    public void An_Lfo_On_Level_Makes_The_Sound_Pulse_At_Its_Rate()
    {
        var r = Tone().Clamped();
        r.Layers[0].Gain = -30; // well below the limiter, so both halves of the pulse stay clean
        r.Modulators.Add(new SoundModulator { Name = "Pulse", Type = "lfo", Shape = "square", Rate = 2 });
        r.Clamped();
        r.Routes.Add(new SoundRoute { Source = r.Modulators[0].Id, Target = r.Layers[0].Id + ":gain", Amount = -10 });
        var x = SoundEngine.Render(r, Sr).Left;
        // Square at 2 Hz: the first quarter second is +1 (−10 dB), the next quarter −1 (+10 dB).
        var first = Rms(x, Sr / 20, Sr / 5);
        var second = Rms(x, Sr * 3 / 10, Sr * 9 / 20);
        Assert.InRange(second - first, 18, 22);
    }

    [Fact]
    public void A_Knob_Can_Drive_Several_Targets_Each_In_Its_Own_Way()
    {
        var r = Tone().Clamped();
        r.Knobs.Add(new SoundKnob { Name = "Motor RPM", Value = 1 });
        r.Clamped();
        var k = r.Knobs[0].Id; var layer = r.Layers[0].Id;
        r.Routes.Add(new SoundRoute { Source = k, Target = layer + ":pitch", Amount = 12 });
        r.Routes.Add(new SoundRoute { Source = k, Target = layer + ":gain", Amount = 6 });
        var high = SoundEngine.Render(r, Sr).Left;
        r.Knobs[0].Value = 0;
        var low = SoundEngine.Render(r, Sr).Left;
        Assert.InRange((double)Crossings(high, Sr / 2, Sr) / Crossings(low, Sr / 2, Sr), 1.9, 2.1); // an octave up at full RPM
        Assert.InRange(Rms(high, Sr / 2, Sr) - Rms(low, Sr / 2, Sr), 5, 7);
        // Halfway with a response curve of 2: a quarter of the amount (3 semitones of 12).
        r.Knobs[0].Value = 0.5;
        r.Routes[0].Curve = 2;
        r.Routes.RemoveAt(1);
        var half = SoundEngine.Render(r, Sr).Left;
        Assert.InRange((double)Crossings(half, Sr / 2, Sr) / Crossings(low, Sr / 2, Sr), Math.Pow(2, 3 / 12.0) - 0.03, Math.Pow(2, 3 / 12.0) + 0.03);
    }

    [Fact]
    public void A_Drawn_Curve_Automates_Over_The_Length_And_An_Envelope_Shapes_Density()
    {
        var r = new SoundRecipe
        {
            Duration = 2, Loop = false, Gust = new GustSettings { Depth = 0 },
            Layers = [new SoundLayer { Type = "noise", Color = "white", Filter = "none", Gain = -12, Width = 0 }],
            Modulators = [new SoundModulator { Name = "Close", Type = "curve", Points = [[0, 0], [1, 1]] }],
        }.Clamped();
        r.Routes.Add(new SoundRoute { Source = r.Modulators[0].Id, Target = "master:lowpass", Amount = -5 });
        var x = SoundEngine.Render(r, Sr).Left;
        Assert.True(Crossings(x, Sr / 10, Sr / 2) > Crossings(x, Sr * 3 / 2, Sr * 19 / 10) * 3, "the high cut closes over the sound");
        var e = new SoundRecipe
        {
            Duration = 2, Loop = false, Gust = new GustSettings { Depth = 0 },
            Layers = [new SoundLayer { Type = "events", Density = 5, Decay = 5, Pitch = 2000, Tone = 0.3, Gain = -12, GainSpread = 0 }],
            Modulators = [new SoundModulator { Type = "envelope", Start = 1, Attack = 0.01, Hold = 5, Sustain = 1 }],
        }.Clamped();
        e.Routes.Add(new SoundRoute { Source = e.Modulators[0].Id, Target = e.Layers[0].Id + ":density", Amount = 4 }); // 16× after one second
        var ev = SoundEngine.Render(e, Sr).Left;
        Assert.True(Rms(ev, Sr * 5 / 4, Sr * 2) > Rms(ev, 0, Sr * 3 / 4) + 8, "many more events after the envelope opens");
    }

    [Fact]
    public void Effect_Parameters_Steps_And_Random_Can_Be_Modulated_And_Loops_Stay_Seamless()
    {
        var r = Tone(3).Clamped();
        r.Loop = true;
        r.Layers[0].Effects.Add(new SoundEffect { Type = "eq", Kind = "peak", Freq = 440, Q = 2, Gain = 0 });
        r.Layers[0].Effects.Add(new SoundEffect { Type = "saturate", Drive = 0, Mix = 1 });
        r.Modulators.Add(new SoundModulator { Type = "steps", Rate = 4, Steps = [0, 1, 0, 1], Smooth = 0 });
        r.Modulators.Add(new SoundModulator { Type = "random", Rate = 3, Smooth = 1 });
        r.Clamped();
        var layer = r.Layers[0];
        r.Routes.Add(new SoundRoute { Source = r.Modulators[0].Id, Target = $"{layer.Id}/{layer.Effects[0].Id}:gain", Amount = 12 });
        r.Routes.Add(new SoundRoute { Source = r.Modulators[1].Id, Target = $"{layer.Id}/{layer.Effects[1].Id}:drive", Amount = 0.8 });
        r.Routes.Add(new SoundRoute { Source = r.Modulators[1].Id, Target = layer.Id + ":pan", Amount = 0.8 });
        var x = SoundEngine.Render(r, Sr);
        Assert.All(x.Left, v => Assert.True(float.IsFinite(v)));
        Assert.True(Math.Abs(Rms(x.Left, Sr / 4 + 400, Sr / 2 - 400) - Rms(x.Left, 400, Sr / 4 - 400)) > 6, "the EQ boost steps on and off");
        Assert.NotEqual(x.Left, x.Right); // random panning
        var jumps = new double[x.Left.Length - 1];
        for (var i = 0; i < jumps.Length; i++) jumps[i] = Math.Abs(x.Left[i + 1] - x.Left[i]);
        Array.Sort(jumps);
        Assert.True(Math.Abs(x.Left[0] - x.Left[^1]) <= jumps[(int)(jumps.Length * 0.999)], "no seam");
        Assert.Equal(x.Left, SoundEngine.Render(r, Sr).Left); // random modulation repeats with the seed
    }

    [Fact]
    public void Ids_Are_Stable_And_Routes_To_Missing_Targets_Are_Harmless()
    {
        var r = SoundPresets.Make("wind-storm");
        var ids = r.Layers.Select(l => l.Id).ToList();
        Assert.Equal(["L1", "L2", "L3", "L4"], ids);
        var back = SoundRecipe.FromJson(r.ToJson());
        Assert.Equal(ids, back.Layers.Select(l => l.Id));
        back.Layers.Reverse();
        Assert.Equal(ids.AsEnumerable().Reverse(), back.Clamped().Layers.Select(l => l.Id)); // reordering keeps them
        back.Layers[1].Id = back.Layers[0].Id; // a duplicate gets a new one
        Assert.Equal(4, back.Clamped().Layers.Select(l => l.Id).Distinct().Count());
        // A copy put before a later layer takes a free id, not the later layer's.
        var copy = SoundRecipe.FromJson(r.ToJson());
        copy.Layers.Insert(1, SoundRecipe.FromJson(r.ToJson()).Layers[0]);
        Assert.Equal(["L1", "L5", "L2", "L3", "L4"], copy.Clamped().Layers.Select(l => l.Id));
        back.Knobs.Add(new SoundKnob { Value = 1 });
        back.Clamped();
        back.Routes.Add(new SoundRoute { Source = back.Knobs[0].Id, Target = "L99:gain", Amount = 12 });
        back.Routes.Add(new SoundRoute { Source = "M42", Target = "L1:gain", Amount = 12 });
        back.Routes.Add(new SoundRoute { Source = back.Knobs[0].Id, Target = "L1:gain", Amount = 400 }); // clamped to ±48 dB
        Assert.Equal(48, back.Clamped().Routes[2].Amount);
        back.Duration = 1;
        Assert.All(SoundEngine.Render(back, Sr).Left, v => Assert.True(float.IsFinite(v)));
    }

    [Fact]
    public void A_Preview_Of_The_Start_Hears_Automation_Where_The_Full_Sound_Has_It()
    {
        var full = Tone(4).Clamped();
        full.Modulators.Add(new SoundModulator { Type = "curve", Points = [[0, 0], [1, 1]] });
        full.Clamped();
        full.Routes.Add(new SoundRoute { Source = "M1", Target = "L1:gain", Amount = 12 });
        var whole = SoundEngine.Render(full, Sr).Left;
        var start = full.Clone();
        start.Duration = 2;
        var preview = SoundEngine.Render(start, Sr, null, 4).Left;
        var squeezed = SoundEngine.Render(start, Sr).Left;
        var at = Sr * 3 / 2;
        Assert.InRange(Rms(preview, at - 2000, at) - Rms(whole, at - 2000, at), -0.05, 0.05);
        Assert.True(Rms(squeezed, at - 2000, at) > Rms(whole, at - 2000, at) + 3, "without the timeline, the curve would run twice as fast");
    }

    [Fact]
    public void Pitch_Modulation_Bends_Samples_Too()
    {
        var source = SoundEngine.Render(Tone(1), 44100);
        var audio = SampleAudio.ReadWav(source.ToWav(24));
        var r = new SoundRecipe
        {
            Duration = 1, Loop = false, Gust = new GustSettings { Depth = 0 },
            Layers = [new SoundLayer { Type = "sample", Path = "t.wav", Gain = 0, Width = 1 }],
            Knobs = [new SoundKnob { Value = 1 }],
        }.Clamped();
        r.Routes.Add(new SoundRoute { Source = r.Knobs[0].Id, Target = r.Layers[0].Id + ":pitch", Amount = 12 });
        var x = SoundEngine.Render(r, 44100, p => p == "t.wav" ? audio : null).Left;
        var lastLoud = Array.FindLastIndex(x, v => Math.Abs(v) > 0.01);
        Assert.InRange(lastLoud, 44100 * 0.45, 44100 * 0.55); // twice as fast: half as long
        Assert.InRange((double)Crossings(x, 2000, 12000) / Crossings(source.Left, 2000, 12000), 1.9, 2.1);
    }
}
