using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class SoundResonatorTests
{
    private const int Sr = 48000;

    /// <summary>A 10 ms burst of noise, then silence: what a pluck or a strike gives a resonator.</summary>
    private static (double[] L, double[] R) Burst(double seconds = 1.5)
    {
        var n = (int)(seconds * Sr); var l = new double[n];
        var rng = new SoundRng(5);
        for (var i = 0; i < Sr / 100; i++) l[i] = rng.Bipolar() * 0.5;
        return (l, (double[])l.Clone());
    }

    private static (double[] L, double[] R) Ring(SoundEffect fx, (double[] L, double[] R)? input = null)
    {
        var (l, r) = input ?? Burst();
        SoundEffects.Apply([fx.Clamped()], l, r, Sr);
        return (l, r);
    }

    /// <summary>Energy at one frequency (Goertzel) between two times.</summary>
    private static double At(double[] x, double hz, double from, double to)
    {
        int a = (int)(from * Sr), b = (int)(to * Sr);
        var k = 2 * Math.Cos(2 * Math.PI * hz / Sr);
        double s1 = 0, s2 = 0;
        for (var i = a; i < b; i++) { var s = x[i] + k * s1 - s2; s2 = s1; s1 = s; }
        return (s1 * s1 + s2 * s2 - k * s1 * s2) / Math.Pow(b - a, 2);
    }

    private static double Rms(double[] x, double from, double to)
    {
        int a = (int)(from * Sr), b = (int)(to * Sr);
        double s = 0; for (var i = a; i < b; i++) s += x[i] * x[i];
        return 10 * Math.Log10(s / (b - a) + 1e-30);
    }

    [Theory]
    [InlineData("string", 220.0, 1.0)]
    [InlineData("tube", 220.0, 1.0)]
    [InlineData("metal", 440.0, 1.0)]
    [InlineData("wood", 300.0, 1.0)]
    [InlineData("glass", 880.0, 1.0)]
    [InlineData("bell", 330.0, 1.0)]
    [InlineData("membrane", 150.0, 1.0)]
    public void Each_Body_Rings_At_Its_Pitch(string body, double hz, double ratio)
    {
        var (l, _) = Ring(new SoundEffect { Type = "resonator", Body = body, Freq = hz, Decay = 2, Damping = 0.3, Detune = 0 });
        var to = body == "wood" ? 0.25 : 0.6; // wood dies quickly
        var on = At(l, hz * ratio, 0.05, to);
        var off = At(l, hz * 1.37, 0.05, to); // between partials of every body
        Assert.True(on > off * 30, $"{body}: {10 * Math.Log10(on / off):0.0} dB above the gap");
        Assert.True(Rms(l, 0.05, to) > -60, $"{body} rings");
    }

    [Fact]
    public void A_Tube_Has_Odd_Harmonics_Only()
    {
        var (l, _) = Ring(new SoundEffect { Type = "resonator", Body = "tube", Freq = 200, Decay = 2, Damping = 0.1, Detune = 0 });
        Assert.True(At(l, 600, 0.05, 0.6) > At(l, 400, 0.05, 0.6) * 10, "the third harmonic, not the second");
        var (s, _) = Ring(new SoundEffect { Type = "resonator", Body = "string", Freq = 200, Decay = 2, Damping = 0.1, Detune = 0 });
        Assert.True(At(s, 400, 0.05, 0.6) > At(s, 300, 0.05, 0.6) * 10, "a string has the second harmonic");
    }

    [Fact]
    public void Decay_Sets_How_Long_It_Rings_And_Damping_Darkens_It()
    {
        var (shortRing, _) = Ring(new SoundEffect { Type = "resonator", Body = "glass", Freq = 600, Decay = 0.3, Damping = 0.2, Detune = 0 });
        var (longRing, _) = Ring(new SoundEffect { Type = "resonator", Body = "glass", Freq = 600, Decay = 3, Damping = 0.2, Detune = 0 });
        // −60 dB per Decay: over 0.5 s, about 100 dB down for 0.3 s and about 10 dB for 3 s.
        var dropShort = Rms(shortRing, 0.05, 0.15) - Rms(shortRing, 0.55, 0.65);
        var dropLong = Rms(longRing, 0.05, 0.15) - Rms(longRing, 0.55, 0.65);
        Assert.InRange(dropLong, 6, 16);
        Assert.True(dropShort > 70, $"{dropShort}");
        var (bright, _) = Ring(new SoundEffect { Type = "resonator", Body = "metal", Freq = 300, Decay = 2, Damping = 0, Detune = 0 });
        var (dark, _) = Ring(new SoundEffect { Type = "resonator", Body = "metal", Freq = 300, Decay = 2, Damping = 1, Detune = 0 });
        double Highs(double[] x) => At(x, 300 * 5.404, 0.4, 0.8) / At(x, 300, 0.4, 0.8);
        Assert.True(Highs(bright) > Highs(dark) * 10, "more damping: the upper partials die sooner");
    }

    [Fact]
    public void Noise_Comes_Out_About_As_Loud_As_It_Went_In()
    {
        foreach (var body in new[] { "string", "tube", "metal", "wood", "glass", "bell", "membrane" })
        {
            var n = Sr; var l = new double[n];
            var rng = new SoundRng(9);
            for (var i = 0; i < n; i++) l[i] = rng.Bipolar() * 0.3;
            var before = Rms(l, 0.5, 1);
            var (outL, _) = Ring(new SoundEffect { Type = "resonator", Body = body, Freq = 330, Decay = 1, Damping = 0.4, Detune = 0 }, (l, (double[])l.Clone()));
            var change = Rms(outL, 0.5, 1) - before;
            Assert.True(change is > -8 and < 4, $"{body}: {change:0.0} dB");
        }
    }

    [Fact]
    public void Detune_Widens_It_And_Its_Pitch_Can_Be_Modulated()
    {
        var (l, r) = Ring(new SoundEffect { Type = "resonator", Body = "glass", Freq = 500, Decay = 2, Detune = 1 });
        Assert.NotEqual(l, r);
        var (ml, mr) = Ring(new SoundEffect { Type = "resonator", Body = "glass", Freq = 500, Decay = 2, Detune = 0 });
        Assert.Equal(ml, mr);
        // In a recipe: a control tunes the resonator on a layer up an octave.
        var recipe = new SoundRecipe
        {
            Duration = 1, Loop = false, Gust = new GustSettings { Depth = 0 },
            Layers = [new SoundLayer { Type = "noise", Color = "white", Filter = "none", Gain = -6, Release = 0.01, Width = 0,
                Effects = [new SoundEffect { Type = "resonator", Body = "glass", Freq = 400, Decay = 2, Detune = 0 }] }],
            Knobs = [new SoundKnob { Value = 1 }],
        }.Clamped();
        recipe.Routes.Add(new SoundRoute { Source = "K1", Target = "L1/F1:freq", Amount = 1 });
        var x = SoundEngine.Render(recipe, Sr).Left.Select(v => (double)v).ToArray();
        Assert.True(At(x, 800, 0.1, 0.6) > At(x, 400, 0.1, 0.6) * 30, "an octave up");
    }
}
