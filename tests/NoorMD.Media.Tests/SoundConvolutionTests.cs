using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class SoundConvolutionTests
{
    private const int Sr = 48000;

    private static double Db(double[] x, double from, double to)
    {
        int a = (int)(from * Sr), b = Math.Min(x.Length, (int)(to * Sr));
        double s = 0; for (var i = a; i < b; i++) s += x[i] * x[i];
        return 10 * Math.Log10(s / (b - a) + 1e-30);
    }

    private static (double[] L, double[] R) Impulse(double seconds = 3)
    {
        var l = new double[(int)(seconds * Sr)]; l[0] = 1;
        return (l, (double[])l.Clone());
    }

    private static (double[] L, double[] R) Through(SoundEffect fx, (double[] L, double[] R) x, Func<string, SampleAudio?>? files = null)
    {
        SoundEffects.Apply([fx.Clamped()], x.L, x.R, Sr, null, files);
        return x;
    }

    [Theory]
    [InlineData(5000, 1)]
    [InlineData(5000, 1500)]
    [InlineData(20000, 5000)]
    [InlineData(3000, 9000)]
    public void Partitioned_Convolution_Matches_Direct_Convolution(int t, int m)
    {
        var rng = new SoundRng((ulong)(t + m));
        var x = Enumerable.Range(0, t).Select(_ => rng.Bipolar()).ToArray();
        var h = Enumerable.Range(0, m).Select(_ => rng.Bipolar() * 0.1).ToArray();
        var direct = new double[t];
        for (var i = 0; i < t; i++) { double s = 0; for (var k = 0; k <= Math.Min(i, m - 1); k++) s += h[k] * x[i - k]; direct[i] = s; }
        var fast = (double[])x.Clone();
        SoundConvolution.Convolve(fast, h);
        for (var i = 0; i < t; i++) Assert.True(Math.Abs(fast[i] - direct[i]) < 1e-9, $"sample {i}: {fast[i]} vs {direct[i]}");
        // Two channels sharing the FFTs, each with its own response, come out apart and right.
        var h2 = h.Select(v => -v * 0.5).ToArray();
        var left = (double[])x.Clone(); var right = x.Select(v => v * 2).ToArray();
        SoundConvolution.Convolve(left, right, h, h2);
        for (var i = 0; i < t; i++)
        {
            Assert.True(Math.Abs(left[i] - direct[i]) < 1e-9, $"left {i}");
            Assert.True(Math.Abs(right[i] - direct[i] * -1) < 1e-9, $"right {i}"); // 2x through −h/2
        }
    }

    [Fact]
    public void Built_In_Spaces_Are_Stereo_Keep_The_Level_And_Ring_For_Their_Time()
    {
        var drops = new Dictionary<string, double>();
        foreach (var space in new[] { "room", "hall", "church", "cave", "plate", "tunnel" })
        {
            var (l, r) = Through(new SoundEffect { Type = "convolution", Space = space, Damping = 0, PreDelay = 0, Mix = 1 }, Impulse());
            var energy = l.Sum(v => v * v) + r.Sum(v => v * v);
            Assert.InRange(energy / 2, 0.8, 1.2); // an impulse in, unit energy out: noise keeps its level
            Assert.NotEqual(l, r);
            drops[space] = Db(l, 0.05, 0.15) - Db(l, 0.45, 0.55);
            // The same space each time.
            Assert.Equal(l, Through(new SoundEffect { Type = "convolution", Space = space, Damping = 0, PreDelay = 0, Mix = 1 }, Impulse()).L);
        }
        Assert.True(drops["room"] > drops["hall"] + 10 && drops["hall"] > drops["church"], string.Join(", ", drops.Select(d => $"{d.Key} {d.Value:0}")));
    }

    [Fact]
    public void Pre_Delay_Length_And_Damping_Shape_It()
    {
        var (late, _) = Through(new SoundEffect { Type = "convolution", Space = "hall", PreDelay = 50, Mix = 1 }, Impulse());
        var first = Array.FindIndex(late, v => Math.Abs(v) > 1e-9);
        Assert.InRange(first, (int)(0.05 * Sr) - 1, (int)(0.05 * Sr) + 1);
        var (cut, _) = Through(new SoundEffect { Type = "convolution", Space = "church", IrLength = 0.5, Mix = 1, PreDelay = 0 }, Impulse());
        Assert.True(Db(cut, 0.51, 1) < -200, "nothing after half a second");
        Assert.True(Db(cut, 0.3, 0.4) > -60);
        static double Brightness(double[] x) // the share of the late tail above 4 kHz, by a first difference (a crude high-pass)
        {
            double hi = 0, all = 0;
            for (var i = (int)(0.6 * Sr); i < (int)(1.2 * Sr); i++) { var d = x[i] - x[i - 1]; hi += d * d; all += x[i] * x[i]; }
            return hi / (all + 1e-30);
        }
        var (bright, _) = Through(new SoundEffect { Type = "convolution", Space = "plate", Damping = 0, PreDelay = 0, Mix = 1 }, Impulse());
        var (dark, _) = Through(new SoundEffect { Type = "convolution", Space = "plate", Damping = 1, PreDelay = 0, Mix = 1 }, Impulse());
        Assert.True(Brightness(bright) > Brightness(dark) * 2, "damping darkens the tail");
    }

    [Fact]
    public void A_Recorded_Space_Is_Used_When_Allowed_And_Reported_When_Missing()
    {
        // A "recording": silence first, then a clap and three echoes 100 ms apart, at 44.1 kHz.
        var n = 44100; var ir = new float[n];
        ir[2000] = 0.9f; ir[2000 + 4410] = 0.5f; ir[2000 + 8820] = 0.25f; ir[2000 + 13230] = 0.12f;
        var audio = new SampleAudio { Left = ir, Right = (float[])ir.Clone(), Rate = 44100 };
        var (l, _) = Through(new SoundEffect { Type = "convolution", Space = "file", IrPath = "clap.wav", IrName = "Stairwell", PreDelay = 0, Mix = 1 }, Impulse(), p => p == "clap.wav" ? audio : null);
        // The silence before the clap is skipped; the echoes come 100 ms apart, each quieter.
        // (the response is darkened a little by default, so each echo is a short smear: take its largest sample)
        var peaks = Enumerable.Range(0, 4).Select(k => Enumerable.Range((int)(k * 0.1 * Sr), 200).Max(i => Math.Abs(l[i]))).ToArray();
        Assert.True(peaks[0] > peaks[1] && peaks[1] > peaks[2] && peaks[2] > peaks[3] && peaks[3] > 0.01, string.Join(", ", peaks));
        // In a recipe: a missing recording is reported, and the sound passes as if the effect were off.
        var r = new SoundRecipe
        {
            Duration = 0.5, Loop = false, Gust = new GustSettings { Depth = 0 },
            Layers = [new SoundLayer { Type = "noise", Color = "pink", Filter = "none", Gain = -12, Release = 0.05,
                Effects = [new SoundEffect { Type = "convolution", Space = "file", IrPath = "gone.wav", IrName = "Old cellar", Mix = 1 }] }],
        };
        var x = SoundEngine.Render(r, Sr, _ => null);
        Assert.Contains(x.Warnings, w => w.Contains("Old cellar"));
        r.Layers[0].Effects.Clear();
        Assert.Equal(SoundEngine.Render(r, Sr).Left, x.Left);
    }

    [Fact]
    public void A_Long_Sound_In_A_Long_Space_Renders_Quickly()
    {
        var r = new SoundRecipe
        {
            Duration = 30, Loop = true,
            Layers = [new SoundLayer { Type = "noise", Color = "pink", Filter = "lowpass", Freq = 3000, Gain = -18,
                Effects = [new SoundEffect { Type = "convolution", Space = "church", Mix = 0.4 }] }],
        };
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var x = SoundEngine.Render(r, Sr);
        Assert.True(sw.ElapsedMilliseconds < 15000, $"{sw.ElapsedMilliseconds} ms"); // generous: tests may run unoptimised
        Assert.All(x.Left, v => Assert.True(float.IsFinite(v)));
    }
}
