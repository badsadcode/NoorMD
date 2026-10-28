using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class SoundSampleTests
{
    private const int Sr = 22050;

    /// <summary>The test sample of preview.29's fingerprints: a rising tone on the left, 523 Hz on the right.</summary>
    private static SampleAudio Sweep()
    {
        var n = 30000; var l = new float[n]; var r = new float[n];
        for (var i = 0; i < n; i++) { var t = i / 44100.0; l[i] = (float)(0.5 * Math.Sin(2 * Math.PI * (300 + 400 * t) * t)); r[i] = (float)(0.4 * Math.Sin(2 * Math.PI * 523 * t)); }
        return new SampleAudio { Left = l, Right = r, Rate = 44100 };
    }

    /// <summary>Half a second at one pitch, then half a second at another (both channels).</summary>
    private static SampleAudio TwoTones(double first = 440, double second = 880, int rate = 44100)
    {
        var n = rate; var l = new float[n];
        for (var i = 0; i < n; i++) l[i] = (float)(0.5 * Math.Sin(2 * Math.PI * (i < n / 2 ? first : second) * i / rate));
        return new SampleAudio { Left = l, Right = (float[])l.Clone(), Rate = rate };
    }

    private static float[] Play(SampleAudio a, SoundLayer layer, double seconds, Action<SoundRecipe>? more = null)
    {
        layer.Type = "sample"; layer.Path = "s";
        var r = new SoundRecipe { Duration = seconds, Loop = false, Gust = new GustSettings { Depth = 0 }, Layers = [layer] }.Clamped();
        more?.Invoke(r);
        return SoundEngine.Render(r, Sr, _ => a).Left;
    }

    private static double Rms(float[] x, int from, int to) { double s = 0; for (var i = from; i < to; i++) s += x[i] * (double)x[i]; return 10 * Math.Log10(s / (to - from) + 1e-20); }
    private static double Hz(float[] x, int from, int to) { var z = 0; for (var i = from + 1; i < to; i++) if (x[i] >= 0 != x[i - 1] >= 0) z++; return z / 2.0 / ((to - from) / (double)Sr); }

    [Fact]
    public void Tape_Mode_Plays_Exactly_As_In_Preview_29()
    {
        var expected = new Dictionary<string, (double Rms, double[] Samples, SoundLayer Layer)>
        {
            ["plain"] = (-18.3, [-0.328506, 0.088192, 0.342066, 0.227438, -0.000030, -0.000000, 0.000000, -0.000000, 0.000000, 0.000000, -0.000000, 0.000000],
                new SoundLayer { Type = "sample", Path = "s", Gain = -3, Semitones = 3, Width = 0.7 }),
            ["loop"] = (-14.2, [0.234846, -0.021146, 0.123501, -0.181348, -0.338425, 0.331409, -0.055541, -0.308236, 0.252664, 0.013649, 0.294234, -0.339204],
                new SoundLayer { Type = "sample", Path = "s", Gain = -3, LoopSample = true, TrimStart = 0.1, TrimEnd = 0.5, Attack = 0.05 }),
            ["reverse"] = (-19.4, [0.107006, -0.002611, -0.000049, -0.324765, 0.019063, -0.000286, -0.337140, 0.119553, -0.001716, -0.000025, -0.304341, 0.002393],
                new SoundLayer { Type = "sample", Path = "s", Gain = -3, Reverse = true, Repeat = 0.4, Release = 0.2, Hold = 0.1 }),
        };
        var a = Sweep();
        foreach (var (name, (rms, samples, layer)) in expected)
        {
            var x = SoundEngine.Render(new SoundRecipe { Duration = 1.5, Loop = false, Layers = [layer] }, Sr, _ => a);
            Assert.Equal(rms, x.RmsDb, 1);
            for (var k = 0; k < 12; k++)
            {
                var v = x.Left[(int)((long)(k + 1) * (x.Left.Length - 1) / 13)];
                Assert.True(Math.Abs(v - samples[k]) < 1e-4, $"{name} sample {k}: {v} vs {samples[k]}");
            }
        }
    }

    [Fact]
    public void Stretch_Sets_Speed_And_Pitch_Apart()
    {
        var a = TwoTones();
        var slow = Play(a, new SoundLayer { PlayMode = "stretch", Speed = 0.5, GrainSize = 60 }, 3);
        // Twice as long: the 440 Hz half lasts a second, and keeps its pitch.
        Assert.InRange(Hz(slow, Sr / 4, Sr * 3 / 4), 425, 455);
        Assert.InRange(Hz(slow, Sr * 5 / 4, Sr * 7 / 4), 850, 910);
        Assert.True(Rms(slow, Sr * 17 / 10, Sr * 19 / 10) > -25, "still playing after 1.7 s");
        // The overlapping grains add up in phase: about as loud as the sample played straight (−12 dB layer, −9 dB sine).
        Assert.InRange(Rms(slow, Sr / 4, Sr * 3 / 4), -23, -19);
        Assert.True(Rms(slow, Sr * 22 / 10, Sr * 3) < -60, "and over by 2.2 s");
        var up = Play(a, new SoundLayer { PlayMode = "stretch", Speed = 1, Semitones = 12, GrainSize = 60 }, 2);
        // An octave up, and still as long as the sample.
        Assert.InRange(Hz(up, Sr / 10, Sr * 4 / 10), 850, 910);
        Assert.True(Rms(up, Sr * 8 / 10, Sr * 9 / 10) > -25, "an octave up but not shorter");
        // Steady level through the overlapping grains (no tremolo at the grain rate).
        var blocks = Enumerable.Range(0, 20).Select(b => Rms(slow, Sr / 10 + b * 400, Sr / 10 + b * 400 + 400)).ToArray();
        Assert.True(blocks.Max() - blocks.Min() < 3, string.Join(", ", blocks.Select(v => v.ToString("0.0"))));
    }

    [Fact]
    public void Stretch_Backwards_Starts_From_The_End()
    {
        var x = Play(TwoTones(), new SoundLayer { PlayMode = "stretch", Speed = 1, Reverse = true }, 1.2);
        Assert.InRange(Hz(x, Sr / 10, Sr * 4 / 10), 850, 910);
        Assert.InRange(Hz(x, Sr * 6 / 10, Sr * 9 / 10), 425, 455);
    }

    [Fact]
    public void A_Grain_Cloud_Comes_From_Around_Its_Position_And_Can_Be_Moved()
    {
        var a = TwoTones();
        var early = Play(a, new SoundLayer { PlayMode = "grains", Position = 0.25, PositionSpread = 0.1, GrainDensity = 60, GrainSize = 70 }, 2);
        var late = Play(a, new SoundLayer { PlayMode = "grains", Position = 0.75, PositionSpread = 0.1, GrainDensity = 60, GrainSize = 70 }, 2);
        Assert.InRange(Hz(early, Sr / 2, Sr * 3 / 2), 400, 480);
        Assert.InRange(Hz(late, Sr / 2, Sr * 3 / 2), 790, 960);
        Assert.True(Rms(early, Sr * 3 / 2, Sr * 2 - 100) > -30, "a cloud lasts as long as the sound");
        // Moved by modulation: a control pushes the position from the first half into the second.
        var moved = Play(a, new SoundLayer { PlayMode = "grains", Position = 0.25, PositionSpread = 0.1, GrainDensity = 60, GrainSize = 70 }, 2, r =>
        {
            r.Knobs.Add(new SoundKnob { Value = 1 });
            r.Clamped();
            r.Routes.Add(new SoundRoute { Source = r.Knobs[0].Id, Target = r.Layers[0].Id + ":position", Amount = 0.5 });
        });
        Assert.InRange(Hz(moved, Sr / 2, Sr * 3 / 2), 790, 960);
        // Scanning moves through the sample by itself.
        var scan = Play(a, new SoundLayer { PlayMode = "grains", Position = 0.1, PositionSpread = 0.05, Scan = 0.25, GrainDensity = 60, GrainSize = 50 }, 3);
        Assert.InRange(Hz(scan, Sr / 10, Sr / 2), 400, 480);
        Assert.InRange(Hz(scan, Sr * 21 / 10, Sr * 25 / 10), 790, 960);
        // Grain pitch spread scatters the pitches; the same seed gives the same cloud.
        var spread = Play(a, new SoundLayer { PlayMode = "grains", Position = 0.25, PositionSpread = 0.1, GrainPitch = 12 }, 1);
        Assert.Equal(spread, Play(a, new SoundLayer { PlayMode = "grains", Position = 0.25, PositionSpread = 0.1, GrainPitch = 12 }, 1));
        Assert.NotEqual(spread, early.Take(spread.Length).ToArray());
    }

    [Fact]
    public void Crossfaded_Loops_Have_No_Seam()
    {
        // 441.7 Hz over 0.3 s is not a whole number of cycles: back to back, the loop jumps where it wraps.
        var n = (int)(0.3 * 44100); var l = new float[n];
        for (var i = 0; i < n; i++) l[i] = (float)(0.5 * Math.Sin(2 * Math.PI * 441.7 * i / 44100));
        var a = new SampleAudio { Left = l, Right = (float[])l.Clone(), Rate = 44100 };
        static double Jump(float[] x) { var m = 0.0; for (var i = Sr / 10; i < x.Length; i++) m = Math.Max(m, Math.Abs(x[i] - x[i - 1])); return m; }
        var steady = 2 * Math.PI * 441.7 / Sr * 0.5; // the largest step a 441.7 Hz sine at 0.5 takes
        var faded = Play(a, new SoundLayer { LoopSample = true, LoopFade = 0.05 }, 2);
        Assert.True(Jump(faded) < steady * 1.15, $"crossfaded: {Jump(faded)} vs {steady}");
        Assert.True(Rms(faded, Sr / 2, Sr * 2) > -30, "it keeps playing");
        // Stretch loops keep going too, and the same crossfade applies.
        var stretched = Play(a, new SoundLayer { PlayMode = "stretch", Speed = 0.7, LoopSample = true, LoopFade = 0.05 }, 2);
        Assert.True(Rms(stretched, Sr * 3 / 2, Sr * 2) > -30);
        // With modulated pitch, the crossfaded tape loop still flows.
        var bent = Play(a, new SoundLayer { LoopSample = true, LoopFade = 0.05 }, 2, r =>
        {
            r.Modulators.Add(new SoundModulator { Type = "lfo", Rate = 0.5 });
            r.Clamped();
            r.Routes.Add(new SoundRoute { Source = r.Modulators[0].Id, Target = r.Layers[0].Id + ":pitch", Amount = 5 });
        });
        Assert.True(Jump(bent) < steady * 1.6, $"bent: {Jump(bent)}");
    }

    [Fact]
    public void A_Recipe_Finds_Its_Samples_Beside_It()
    {
        var folder = Path.Combine(Path.GetTempPath(), "noormd-sound-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try
        {
            File.WriteAllBytes(Path.Combine(folder, "creak.wav"), [0]);
            var gone = Path.Combine(Path.GetTempPath(), "moved-away-" + Guid.NewGuid().ToString("N"), "creak.wav");
            var r = new SoundRecipe
            {
                Layers =
                [
                    new SoundLayer { Type = "sample", Path = "creak.wav" },
                    new SoundLayer { Type = "sample", Path = gone },
                    new SoundLayer { Type = "sample", Path = Path.Combine(Path.GetTempPath(), "nowhere-" + Guid.NewGuid().ToString("N"), "other.wav") },
                    new SoundLayer { Type = "noise", Path = "creak.wav" },
                ],
            }.FindSamplesBeside(folder);
            var here = Path.Combine(folder, "creak.wav");
            Assert.Equal(here, r.Layers[0].Path);
            Assert.Equal(here, r.Layers[1].Path);
            Assert.EndsWith("other.wav", r.Layers[2].Path);
            Assert.NotEqual(Path.Combine(folder, "other.wav"), r.Layers[2].Path); // not there either: left as it was
            Assert.Equal("creak.wav", r.Layers[3].Path);
        }
        finally { Directory.Delete(folder, true); }
    }

    [Fact]
    public void Extreme_Grain_Settings_Stay_Finite_And_Within_Bounds()
    {
        var a = TwoTones(300, 1200, 8000);
        foreach (var layer in new[]
        {
            new SoundLayer { PlayMode = "grains", GrainSize = 1, GrainDensity = 10000, Scan = 50, GrainPitch = 99, Reverse = true, TrimStart = 0.4, TrimEnd = 0.41 },
            new SoundLayer { PlayMode = "stretch", Speed = 100, Semitones = -99, GrainSize = 5000, LoopSample = true, LoopFade = 99 },
            new SoundLayer { PlayMode = "stretch", Speed = 0, TrimStart = 5, Repeat = 0.1 },
            new SoundLayer { PlayMode = "nonsense", LoopSample = true, LoopFade = -3 },
        })
        {
            var x = Play(a, layer, 1);
            Assert.All(x, v => Assert.True(float.IsFinite(v) && Math.Abs(v) <= 1));
        }
        var c = new SoundLayer { PlayMode = "x", Speed = 0, GrainSize = 0, GrainDensity = 0, Position = 3, Scan = double.NaN }.Clone();
        new SoundRecipe { Layers = [c] }.Clamped();
        Assert.Equal(("tape", 0.05, 5.0, 0.5, 1.0, 0.0), (c.PlayMode, c.Speed, c.GrainSize, c.GrainDensity, c.Position, c.Scan));
    }
}
