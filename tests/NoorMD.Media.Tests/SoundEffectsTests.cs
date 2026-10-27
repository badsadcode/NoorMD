using System.Text.Json.Nodes;
using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class SoundEffectsTests
{
    private const int Sr = 22050;

    private static (double[] L, double[] R) Sine(double hz, double seconds, double amp = 0.5)
    {
        var n = (int)(seconds * Sr);
        var l = new double[n];
        for (var i = 0; i < n; i++) l[i] = amp * Math.Sin(2 * Math.PI * hz * i / Sr);
        return (l, (double[])l.Clone());
    }

    private static double Rms(double[] x, int from = 0, int to = -1)
    {
        if (to < 0) to = x.Length;
        double s = 0; for (var i = from; i < to; i++) s += x[i] * x[i];
        return 20 * Math.Log10(Math.Sqrt(s / (to - from)) + 1e-12);
    }

    private static (double[] L, double[] R) Run(params SoundEffect[] chain)
    {
        var (l, r) = Sine(1000, 1);
        SoundEffects.Apply(chain.Select(e => e.Clamped()).ToList(), l, r, Sr);
        return (l, r);
    }

    [Fact]
    public void Recipes_Made_Before_Effects_Render_Exactly_As_Before()
    {
        foreach (var id in new[] { "wind-forest", "rain-steady", "hit-metal", "ui-coin" })
        {
            var recipe = SoundPresets.Make(id);
            recipe.Duration = Math.Min(recipe.Duration, 2);
            // The recipe as preview.27 wrote it: no "effects" anywhere.
            var node = JsonNode.Parse(recipe.ToJson())!;
            foreach (var layer in node["layers"]!.AsArray()) layer!.AsObject().Remove("effects");
            node["master"]!.AsObject().Remove("effects");
            var old = SoundRecipe.FromJson(node.ToJsonString());
            Assert.Empty(old.Layers.SelectMany(l => l.Effects));
            Assert.Equal(SoundEngine.Render(recipe, Sr).Left, SoundEngine.Render(old, Sr).Left);
        }
    }

    [Fact]
    public void A_Bypassed_Or_Fully_Dry_Effect_Changes_Nothing()
    {
        var (plain, _) = Sine(1000, 1);
        Assert.Equal(plain, Run(new SoundEffect { Type = "eq", Gain = 12, Bypass = true }).L);
        Assert.Equal(plain, Run(new SoundEffect { Type = "saturate", Drive = 1, Mix = 0 }).L);
        var half = Run(new SoundEffect { Type = "eq", Kind = "peak", Freq = 1000, Gain = 12, Q = 1, Mix = 0.5 }).L;
        Assert.InRange(Rms(half) - Rms(plain), 4, 9); // between dry (0 dB) and fully boosted (12 dB)
    }

    [Fact]
    public void Eq_Bands_Boost_Cut_And_Filter_Where_They_Should()
    {
        var (plain, _) = Sine(1000, 1);
        Assert.InRange(Rms(Run(new SoundEffect { Type = "eq", Kind = "peak", Freq = 1000, Q = 1, Gain = 12 }).L) - Rms(plain), 11, 13);
        Assert.InRange(Rms(Run(new SoundEffect { Type = "eq", Kind = "peak", Freq = 1000, Q = 1, Gain = -12 }).L) - Rms(plain), -13, -11);
        Assert.True(Rms(Run(new SoundEffect { Type = "eq", Kind = "lowpass", Freq = 200 }).L) < Rms(plain) - 20, "a low-pass well below 1 kHz removes it");
        Assert.True(Rms(Run(new SoundEffect { Type = "eq", Kind = "notch", Freq = 1000, Q = 2 }).L, Sr / 2) < Rms(plain) - 20, "a notch at 1 kHz removes it");
        Assert.InRange(Rms(Run(new SoundEffect { Type = "eq", Kind = "highshelf", Freq = 300, Q = 0.7, Gain = 6 }).L) - Rms(plain), 5, 7);
        Assert.InRange(Rms(Run(new SoundEffect { Type = "eq", Kind = "lowshelf", Freq = 3000, Q = 0.7, Gain = -6 }).L) - Rms(plain), -7, -5);
    }

    [Fact]
    public void The_Compressor_Evens_Out_Loud_And_Quiet_And_The_Gate_Closes_On_Quiet()
    {
        // Half a second quiet (−26 dB), half a second loud (−6 dB).
        var (l, r) = Sine(500, 1, 0.05);
        for (var i = Sr / 2; i < l.Length; i++) { l[i] *= 10; r[i] *= 10; }
        var before = Rms(l, Sr * 3 / 4, Sr) - Rms(l, Sr / 4, Sr / 2);
        var (cl, cr) = ((double[])l.Clone(), (double[])r.Clone());
        SoundEffects.Apply([new SoundEffect { Type = "compressor", Threshold = -20, Ratio = 8, Attack = 2, Release = 50 }.Clamped()], cl, cr, Sr);
        var after = Rms(cl, Sr * 3 / 4, Sr) - Rms(cl, Sr / 4, Sr / 2);
        Assert.InRange(before, 19, 21);
        Assert.True(after < before - 8, $"compressed: {after:0.0} dB apart (was {before:0.0})");
        var (gl, gr) = ((double[])l.Clone(), (double[])r.Clone());
        SoundEffects.Apply([new SoundEffect { Type = "gate", Threshold = -15, Range = 40, Attack = 1, Release = 20 }.Clamped()], gl, gr, Sr);
        Assert.True(Rms(gl, Sr / 4, Sr / 2) < Rms(l, Sr / 4, Sr / 2) - 30, "the quiet half is gated");
        Assert.InRange(Rms(gl, Sr * 3 / 4, Sr) - Rms(l, Sr * 3 / 4, Sr), -1, 0.5);
    }

    [Fact]
    public void Delay_Echoes_At_Its_Time_And_Feedback_Repeats_Quieter()
    {
        var n = Sr;
        var l = new double[n]; var r = new double[n];
        l[0] = r[0] = 1; // a click
        SoundEffects.Apply([new SoundEffect { Type = "delay", Time = 100, Feedback = 0.5, Tone = 20000, Mix = 1 }.Clamped()], l, r, Sr);
        var d = (int)(0.1 * Sr);
        Assert.InRange(Math.Abs(l[d]), 0.9, 1.01);
        Assert.InRange(Math.Abs(l[2 * d]), 0.4, 0.55);
        Assert.Equal(0, l[d / 2]);
        var pl = new double[n]; var pr = new double[n];
        pl[0] = 1; pr[0] = 1;
        SoundEffects.Apply([new SoundEffect { Type = "delay", Time = 100, Feedback = 0.5, PingPong = true, Tone = 20000 }.Clamped()], pl, pr, Sr);
        Assert.True(Math.Abs(pl[d]) > 0.5 && Math.Abs(pr[d]) < 0.01 && Math.Abs(pr[2 * d]) > 0.2, "ping-pong: left first, then right");
    }

    [Fact]
    public void Modulation_Room_And_Width_Effects_Change_The_Sound_Safely()
    {
        var (plain, _) = Sine(440, 1);
        foreach (var type in new[] { "chorus", "flanger", "phaser", "reverb", "saturate", "crush" })
        {
            var (l, r) = Run(new SoundEffect { Type = type, Depth = 0.8, Rate = 2, Drive = 0.8, Bits = 4, Downsample = 8, Mix = type == "reverb" ? 0.4 : 1, Shape = "fold" });
            Assert.All(l, v => Assert.True(double.IsFinite(v) && Math.Abs(v) < 4));
            Assert.NotEqual(plain, l);
        }
        var (tl, _) = Run(new SoundEffect { Type = "tremolo", Rate = 4, Depth = 1 });
        Assert.True(Rms(tl, 0, Sr / 8) - Rms(tl, Sr / 8, Sr / 4) is > 6 or < -6, "tremolo moves the level");
        var (ml, mr) = Sine(440, 0.5);
        for (var i = 0; i < mr.Length; i++) mr[i] *= -0.3; // a wide sound
        SoundEffects.Apply([new SoundEffect { Type = "width", Width = 0 }.Clamped()], ml, mr, Sr);
        Assert.Equal(ml, mr); // width 0: mono
    }

    [Fact]
    public void The_Order_Of_A_Chain_Matters_And_Extreme_Settings_Stay_Finite()
    {
        var a = Run(new SoundEffect { Type = "saturate", Drive = 1 }, new SoundEffect { Type = "eq", Kind = "lowpass", Freq = 1500 }).L;
        var b = Run(new SoundEffect { Type = "eq", Kind = "lowpass", Freq = 1500 }, new SoundEffect { Type = "saturate", Drive = 1 }).L;
        Assert.NotEqual(a, b);
        var rng = new Random(7);
        for (var k = 0; k < 40; k++)
        {
            var fx = new SoundEffect
            {
                Type = SoundEffect.Types[rng.Next(SoundEffect.Types.Length)], Kind = new[] { "peak", "lowshelf", "highshelf", "lowpass", "highpass", "bandpass", "notch" }[rng.Next(7)],
                Freq = rng.NextDouble() * 30000 - 100, Q = rng.NextDouble() * 50, Gain = rng.NextDouble() * 100 - 50, Threshold = -rng.NextDouble() * 100, Ratio = rng.NextDouble() * 50,
                Attack = rng.NextDouble() * 600, Release = rng.NextDouble() * 6000, Drive = rng.NextDouble() * 2, Bits = rng.NextDouble() * 20, Downsample = rng.NextDouble() * 80,
                Time = rng.NextDouble() * 3000, Feedback = rng.NextDouble() * 2, Rate = rng.NextDouble() * 30, Depth = rng.NextDouble() * 2, Size = rng.NextDouble() * 2,
                Damping = rng.NextDouble() * 2, PreDelay = rng.NextDouble() * 400, Width = rng.NextDouble() * 4, Mix = rng.NextDouble() * 2, Out = rng.NextDouble() * 60 - 30,
            };
            var (l, r) = Run(fx);
            Assert.All(l, v => Assert.True(double.IsFinite(v)));
        }
    }

    [Fact]
    public void Layer_And_Master_Chains_Are_Part_Of_The_Recipe_And_The_Render()
    {
        var recipe = SoundPresets.Make("ui-confirm");
        var plain = SoundEngine.Render(recipe, Sr);
        recipe.Layers[0].Effects.Add(new SoundEffect { Type = "delay", Time = 120, Feedback = 0.4, Mix = 0.4 });
        recipe.Master.Effects.Add(new SoundEffect { Type = "reverb", Size = 0.7, Mix = 0.3 });
        var back = SoundRecipe.FromJson(recipe.ToJson());
        Assert.Equal(("delay", "reverb"), (back.Layers[0].Effects[0].Type, back.Master.Effects[0].Type));
        var wet = SoundEngine.Render(back, Sr);
        Assert.NotEqual(plain.Left, wet.Left);
        Assert.True(wet.PeakDb <= -0.9);
        var tooMany = SoundRecipe.FromJson(recipe.ToJson());
        for (var i = 0; i < 20; i++) tooMany.Master.Effects.Add(new SoundEffect());
        Assert.Equal(SoundEffect.MaxPerChain, tooMany.Clamped().Master.Effects.Count);
    }
}
