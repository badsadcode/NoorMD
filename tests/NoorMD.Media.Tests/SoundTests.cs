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

    private static SoundRecipe One(SoundLayer layer, double seconds = 2, bool loop = false) =>
        new() { Duration = seconds, Loop = loop, Gust = new GustSettings { Depth = 0 }, Layers = [layer] };

    [Fact]
    public void Events_Sound_And_Get_Louder_With_More_Of_Them_And_Can_Be_Evenly_Spaced()
    {
        SoundLayer Ev(double density, double rhythm = 0, int burst = 1) => new() { Type = "events", Density = density, Decay = 10, Pitch = 2000, Tone = 0.5, Gain = -20, Rhythm = rhythm, Burst = burst, BurstSpread = 40 };
        var few = SoundEngine.Render(One(Ev(10)), 22050);
        var many = SoundEngine.Render(One(Ev(100)), 22050);
        Assert.True(few.RmsDb > -80, "events alone make sound");
        Assert.InRange(many.RmsDb - few.RmsDb, 6, 14); // ten times as many: about 10 dB louder
        Assert.True(SoundEngine.Render(One(Ev(10, burst: 8)), 22050).RmsDb > few.RmsDb + 4, "clusters are fuller than single hits");
        // Evenly spaced: 4 per second gives about 4 loud moments a second, a steady distance apart.
        var even = SoundEngine.Render(One(Ev(4, rhythm: 1), 3), 22050);
        var threshold = even.Left.Max(Math.Abs) * 0.08;
        var onsets = new List<int>();
        for (var i = 1; i < even.Left.Length; i++)
            if (Math.Abs(even.Left[i]) > threshold && (onsets.Count == 0 || i - onsets[^1] > 22050 / 10)) onsets.Add(i);
        var gaps = onsets.Zip(onsets.Skip(1), (a, b) => b - a).ToList();
        Assert.InRange(onsets.Count, 10, 13);
        Assert.All(gaps, g => Assert.InRange(g, 22050 / 4 * 0.85, 22050 / 4 * 1.15));
    }

    [Fact]
    public void Synth_Fm_Drive_Crush_And_Filter_Sweeps_Change_The_Sound()
    {
        SoundLayer Tone() => new() { Type = "synth", Wave = "sine", Pitch = 440, Attack = 0.01, Hold = 1, Release = 0.2, Gain = -10, Width = 0 };
        var plain = SoundEngine.Render(One(Tone()), 22050);
        var fm = Tone(); fm.FmRatio = 2.76; fm.FmDepth = 4;
        Assert.NotEqual(plain.Left, SoundEngine.Render(One(fm), 22050).Left);
        var driven = Tone(); driven.Drive = 1; driven.Gain = 0;
        var d = SoundEngine.Render(One(driven), 22050);
        Assert.True(d.PeakDb - d.RmsDb < plain.PeakDb - plain.RmsDb - 1, "drive flattens the peaks (squarer wave)");
        var crushed = Tone(); crushed.Crush = 1;
        var c = SoundEngine.Render(One(crushed), 22050);
        static double Rough(SoundRender x) { double d = 0, e = 0; for (var i = 1; i < x.Left.Length; i++) { d += Math.Pow(x.Left[i] - x.Left[i - 1], 2); e += x.Left[i] * (double)x.Left[i]; } return d / e; }
        Assert.True(Rough(c) > Rough(plain) * 2, "crush adds hard steps (a rougher, retro sound)");
        // A whoosh: band-passed noise sweeping up is darker at the start than at the end.
        var sweep = new SoundLayer { Type = "noise", Color = "white", Filter = "bandpass", Freq = 300, FreqEnd = 6000, Q = 3, Attack = 0.9, Release = 0.6, Gain = 0, Width = 0 };
        var w = SoundEngine.Render(One(sweep, 1.5), 22050);
        double Zero(int from, int to) { var z = 0; for (var i = from + 1; i < to; i++) if (Math.Sign(w.Left[i]) != Math.Sign(w.Left[i - 1])) z++; return z; }
        Assert.True(Zero(22050 * 6 / 10, 22050 * 8 / 10) > Zero(2205, 22050 * 2 / 10) * 3, "the sweep ends higher than it starts");
        var arp = Tone(); arp.Arp = 12; arp.ArpTime = 0.5;
        var a = SoundEngine.Render(One(arp), 22050);
        double Rate(SoundRender x, int from, int to) { var z = 0; for (var i = from + 1; i < to; i++) if (Math.Sign(x.Left[i]) != Math.Sign(x.Left[i - 1])) z++; return z; }
        Assert.InRange(Rate(a, 22050 * 6 / 10, 22050 * 9 / 10) / Rate(a, 2205, 22050 * 4 / 10), 1.8, 2.2); // an octave up
    }

    [Fact]
    public void Samples_Of_Your_Own_Are_Read_Reversed_Pitched_And_Missing_Ones_Reported()
    {
        // A WAV made by the engine itself: a falling tone.
        var source = SoundEngine.Render(One(new SoundLayer { Type = "synth", Wave = "sine", Pitch = 880, PitchEnd = 220, Attack = 0.001, Hold = 0.5, Release = 0.1, Gain = -6, Width = 0 }, 0.6), 44100);
        var audio = SampleAudio.ReadWav(source.ToWav(24));
        Assert.Equal(44100, audio.Rate);
        Assert.Equal(source.Left.Length, audio.Left.Length);
        Assert.InRange(audio.Left[1000] - source.Left[1000], -0.001, 0.001);
        Assert.Throws<ArgumentException>(() => SampleAudio.ReadWav(new byte[100]));
        SampleAudio? Load(string path) => path == "tone.wav" ? audio : null;
        SoundLayer Smp() => new() { Type = "sample", Path = "tone.wav", SampleName = "tone.wav", Gain = 0, Width = 1 };
        var same = SoundEngine.Render(One(Smp(), 0.6), 44100, Load);
        Assert.True(same.RmsDb > -30);
        var up = Smp(); up.Semitones = 12; // twice as fast: half as long
        var u = SoundEngine.Render(One(up, 0.6), 44100, Load);
        var lastLoud = Array.FindLastIndex(u.Left, x => Math.Abs(x) > 0.01);
        Assert.InRange(lastLoud, 44100 * 0.25, 44100 * 0.33);
        var rev = Smp(); rev.Reverse = true;
        var r = SoundEngine.Render(One(rev, 0.6), 44100, Load);
        double Zc(SoundRender x, int from, int to) { var z = 0; for (var i = from + 1; i < to; i++) if (Math.Sign(x.Left[i]) != Math.Sign(x.Left[i - 1])) z++; return z; }
        Assert.True(Zc(r, 2000, 8000) < Zc(r, 18000, 24000), "reversed, the falling tone rises");
        var missing = SoundEngine.Render(One(new SoundLayer { Type = "sample", Path = "gone.wav", SampleName = "gone.wav" }, 0.3), 22050, Load);
        Assert.Contains(missing.Warnings, w => w.Contains("gone.wav"));
    }

    [Fact]
    public void The_Generator_Makes_Every_Kind_Repeatably_And_Differently_Per_Seed()
    {
        foreach (var c in SoundGenerator.Categories)
        {
            var a = SoundGenerator.Make(c.Id, 7);
            Assert.Equal(a.ToJson(), SoundGenerator.Make(c.Id, 7).ToJson());
            Assert.NotEqual(a.ToJson(), SoundGenerator.Make(c.Id, 8).ToJson());
            var r = SoundEngine.Render(a, 22050);
            Assert.True(r.RmsDb > -40 && r.PeakDb <= -0.9, $"{c.Id}: rms {r.RmsDb}, peak {r.PeakDb}");
        }
        Assert.Throws<ArgumentException>(() => SoundGenerator.Make("nope", 1));
    }
}
