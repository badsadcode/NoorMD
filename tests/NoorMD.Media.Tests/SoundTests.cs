using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class SoundTests
{
    private static SoundRecipe Short(string preset, double seconds = 4)
    {
        var r = SoundPresets.Make(preset);
        r.Duration = Math.Min(r.Duration, seconds);
        return r;
    }

    [Fact]
    public void Every_Preset_Renders_Clean_Sound_Below_The_Ceiling()
    {
        foreach (var p in SoundPresets.All)
        {
            var r = SoundEngine.Render(Short(p.Id), 32000);
            Assert.All(r.Left, x => Assert.True(float.IsFinite(x)));
            Assert.True(r.PeakDb <= -0.9, $"{p.Id} peaks at {r.PeakDb} dB");
            Assert.True(r.RmsDb > -45, $"{p.Id} is almost silent ({r.RmsDb} dB)");
        }
    }

    [Fact]
    public void The_Same_Recipe_And_Seed_Give_The_Same_Sound_And_Another_Seed_A_Variation()
    {
        var a = SoundEngine.Render(Short("rain-steady"), 22050);
        var b = SoundEngine.Render(Short("rain-steady"), 22050);
        Assert.Equal(a.Left, b.Left);
        var other = Short("rain-steady");
        other.Seed = 2;
        var c = SoundEngine.Render(other, 22050);
        Assert.NotEqual(a.Left, c.Left);
        Assert.InRange(c.RmsDb, a.RmsDb - 2, a.RmsDb + 2); // a variation, not a different sound
    }

    [Fact]
    public void Muting_A_Layer_Leaves_The_Others_Exactly_As_They_Were()
    {
        var full = Short("wind-forest");
        var only = Short("wind-forest");
        only.Layers[1].Mute = true; only.Layers[2].Mute = true;
        var solo = Short("wind-forest");
        solo.Layers[0].Solo = true;
        Assert.Equal(SoundEngine.Render(only, 22050).Left, SoundEngine.Render(solo, 22050).Left);
        Assert.NotEqual(SoundEngine.Render(full, 22050).Left, SoundEngine.Render(only, 22050).Left);
    }

    [Fact]
    public void Loops_Have_No_Seam()
    {
        foreach (var id in new[] { "wind-storm", "rain-downpour", "water-stream", "fire-camp" })
        {
            var r = SoundEngine.Render(Short(id, 6), 32000);
            foreach (var ch in new[] { r.Left, r.Right })
            {
                var jumps = new double[ch.Length - 1];
                for (var i = 0; i < jumps.Length; i++) jumps[i] = Math.Abs(ch[i + 1] - ch[i]);
                Array.Sort(jumps);
                var seam = Math.Abs(ch[0] - ch[^1]);
                Assert.True(seam <= jumps[(int)(jumps.Length * 0.999)], $"{id}: the jump from the end to the start ({seam}) stands out");
            }
        }
    }

    [Fact]
    public void Quick_Controls_Do_What_They_Say()
    {
        double Rms(Action<SoundRecipe> change)
        {
            var r = Short("rain-steady");
            r.Master.Gain -= 10; // stay below the limiter so loudness compares fairly
            change(r);
            return SoundEngine.Render(r, 22050).RmsDb;
        }
        var neutral = Rms(_ => { });
        Assert.True(Rms(r => r.Macros.Intensity = 1) > neutral + 3, "more intense is louder");
        Assert.True(Rms(r => r.Macros.Intensity = 0) < neutral - 3, "gentler is quieter");
        Assert.True(Rms(r => r.Macros.Distance = 1) < neutral - 3, "far away is quieter");
        var applied = Short("rain-steady");
        applied.Macros.Shelter = 1;
        Assert.True(applied.WithMacrosApplied().Master.LowPass < 2000, "indoors is muffled");
        Assert.True(applied.WithMacrosApplied().Master.Reverb > 0.2, "…with a room");
        var gusty = Short("wind-field"); gusty.Macros.Gust = 1;
        var calm = Short("wind-field"); calm.Macros.Gust = 0;
        Assert.True(gusty.WithMacrosApplied().Gust.Depth > calm.WithMacrosApplied().Gust.Depth * 3);
    }

    [Fact]
    public void One_Shots_Are_Normalized_And_Fade_Out()
    {
        var r = SoundEngine.Render(SoundPresets.Make("ui-laser"), 48000);
        Assert.InRange(r.PeakDb, -1.6, -0.9);
        Assert.Equal(0f, r.Left[^1]);
        Assert.Equal(0.4, r.Seconds, 2);
    }

    [Fact]
    public void Recipes_Round_Trip_And_Out_Of_Range_Values_Are_Kept_Sensible()
    {
        var r = SoundPresets.Make("wind-ruins");
        var back = SoundRecipe.FromJson(r.ToJson());
        Assert.Equal(r.ToJson(), back.ToJson());
        var wild = SoundRecipe.FromJson("""{"name":"  ","duration":-5,"layers":[{"type":"laser","gain":400,"freq":1e9,"color":"purple"}],"master":{"lowPass":5}}""");
        Assert.Equal(("Untitled sound", 0.05), (wild.Name, wild.Duration));
        Assert.Equal(("noise", 12.0, 20000.0, "pink"), (wild.Layers[0].Type, wild.Layers[0].Gain, wild.Layers[0].Freq, wild.Layers[0].Color));
        Assert.Equal(200, wild.Master.LowPass);
        Assert.Throws<ArgumentException>(() => SoundPresets.Make("nope"));
    }

    [Fact]
    public void Wav_Files_Are_Standard_Pcm()
    {
        var r = SoundEngine.Render(SoundPresets.Make("ui-click"), 44100);
        var wav = r.ToWav(24);
        Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(wav, 0, 4));
        Assert.Equal("WAVE", System.Text.Encoding.ASCII.GetString(wav, 8, 4));
        Assert.Equal(44100, BitConverter.ToInt32(wav, 24));
        Assert.Equal(24, BitConverter.ToInt16(wav, 34));
        Assert.Equal(r.Left.Length * 2 * 3, BitConverter.ToInt32(wav, 40));
        Assert.Equal(44 + r.Left.Length * 6, wav.Length);
        Assert.Throws<ArgumentException>(() => r.ToWav(8));
        var peaks = r.Peaks(100);
        Assert.Equal(200, peaks.Length);
        Assert.True(peaks.Max() > 0.5f);
    }
}
