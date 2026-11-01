using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>Voice Forge: voices with no recordings, in invented languages, with feelings and sounds with no words.</summary>
public class VoiceForgeTests
{
    private static SoundLayer Voice(string profile = "Adult, high", string says = "chatter", double seconds = 3, string emotion = "calm", string? end = null)
    {
        var l = new SoundLayer { Type = "voice", Name = "V", Gain = -3, Width = 0, VoiceSays = says, VoiceLength = seconds, Emotion = emotion, EmotionEnd = end };
        VoiceForge.Apply(VoiceForge.Profiles.First(p => p.Name == profile), l);
        return l;
    }

    private static SoundRender Render(SoundLayer l, int seed = 1, double? duration = null) =>
        SoundEngine.Render(new SoundRecipe { Seed = seed, Loop = false, Duration = duration ?? l.VoiceLength + 0.5, Layers = [l], Gust = new GustSettings { Depth = 0 } }, 24000);

    /// <summary>When the voice is heard: from the first to the last sample above a whisper of the peak.</summary>
    private static double Heard(SoundRender r)
    {
        var limit = r.Left.Max(Math.Abs) * 0.02;
        var first = Array.FindIndex(r.Left, x => Math.Abs(x) > limit);
        var last = Array.FindLastIndex(r.Left, x => Math.Abs(x) > limit);
        return (last - first) / (double)r.SampleRate;
    }

    [Fact]
    public void Every_Voice_Says_Everything_With_Clean_Sound()
    {
        foreach (var p in VoiceForge.Profiles)
            foreach (var says in VoiceForge.Says)
            {
                var r = Render(Voice(p.Name, says.Id, 1.2));
                Assert.All(r.Left, x => Assert.True(float.IsFinite(x)));
                Assert.True(r.RmsDb > -45, $"{p.Name} / {says.Id} is almost silent ({r.RmsDb:0.0} dB)");
                Assert.True(r.PeakDb < 0, $"{p.Name} / {says.Id} clips");
            }
    }

    [Fact]
    public void The_Same_Seed_Is_The_Same_Take_And_Another_Seed_Another_Take()
    {
        var l = Voice();
        Assert.Equal(Render(l, 3).Left, Render(l, 3).Left);
        var a = Render(l, 3); var b = Render(l, 4);
        Assert.NotEqual(a.Left, b.Left);
        Assert.InRange(b.RmsDb, a.RmsDb - 4, a.RmsDb + 4); // another take of the same voice, not another voice
    }

    [Fact]
    public void Short_And_Long_Lines_Are_About_As_Long_As_Asked()
    {
        foreach (var seconds in new[] { 1.5, 4.0, 15.0 })
        {
            var heard = Heard(Render(Voice(seconds: seconds)));
            Assert.InRange(heard, seconds * 0.7, seconds * 1.3);
        }
        Assert.InRange(Heard(Render(Voice("Brute", "grunt", 0.3))), 0.1, 0.5); // a short pain grunt
    }

    [Fact]
    public void A_Language_Keeps_Its_Words_Across_Takes_And_Another_Language_Seed_Has_Others()
    {
        var l = Voice(seconds: 8); l.Consistency = 1; l.LanguageSeed = 11;
        var take1 = VoiceForge.Words(l, 1).ToHashSet();
        var take2 = VoiceForge.Words(l, 2).ToHashSet();
        var other = Voice(seconds: 8); other.Consistency = 1; other.LanguageSeed = 12;
        var otherWords = VoiceForge.Words(other, 2).ToHashSet();
        var shared = take1.Intersect(take2).Count();
        Assert.True(shared >= 3, $"two takes share only {shared} words");
        Assert.True(take2.Intersect(otherWords).Count() < shared, "another language seed should mostly have other words");
        Assert.NotEqual(VoiceForge.Words(l, 1), VoiceForge.Words(l, 2)); // but they don't say the same thing
    }

    /// <summary>The middle pitch of the voiced parts (Hz), from where each loud stretch repeats itself best.</summary>
    private static double MedianPitch(float[] x, int sr)
    {
        var n = sr / 25; var f0s = new List<double>(); var loud = x.Max(Math.Abs) * 0.2;
        for (var from = 0; from + n + sr / 60 < x.Length; from += n)
        {
            if (x.Skip(from).Take(n).Max(Math.Abs) < loud) continue;
            double best = 0; var bestLag = 0;
            for (var lag = sr / 600; lag < sr / 60; lag++)
            {
                double c = 0, e0 = 0, e1 = 0;
                for (var i = 0; i < n; i++) { c += (double)x[from + i] * x[from + i + lag]; e0 += (double)x[from + i] * x[from + i]; e1 += (double)x[from + i + lag] * x[from + i + lag]; }
                var v = c / Math.Sqrt(e0 * e1 + 1e-12);
                if (v > best + 0.02) { best = v; bestLag = lag; } // the first strong peak, not a multiple of it
            }
            if (best > 0.6) f0s.Add((double)sr / bestLag);
        }
        return f0s.Count == 0 ? 0 : f0s.OrderBy(v => v).ElementAt(f0s.Count / 2);
    }

    [Fact]
    public void Calm_Then_Furious_Gets_Higher_And_Brighter_Not_Only_Louder()
    {
        var r = Render(Voice("Adult, low", "argument", 6, "calm", "furious"));
        var n = r.Left.Length / 2;
        var (first, second) = (r.Left[..n], r.Left[n..]);
        static double Rms(float[] a) => Math.Sqrt(a.Average(x => (double)x * x));
        static double Bright(float[] a) { double d = 0; for (var i = 1; i < a.Length; i++) d += (double)(a[i] - a[i - 1]) * (a[i] - a[i - 1]); return Math.Sqrt(d / a.Length) / (Rms(a) + 1e-9); }
        Assert.True(Rms(second) > Rms(first) * 1.15, $"louder at the end ({Rms(second):0.000} vs {Rms(first):0.000})");
        var (p1, p2) = (MedianPitch(first, r.SampleRate), MedianPitch(second, r.SampleRate));
        Assert.True(p2 > p1 * 1.15, $"higher at the end ({p2:0} Hz vs {p1:0} Hz)");
        Assert.True(Bright(second) > Bright(first) * 1.05, $"brighter at the end ({Bright(second):0.000} vs {Bright(first):0.000})");
    }

    [Fact]
    public void A_Whisper_Has_No_Voiced_Hum()
    {
        // Voiced sound repeats with each pitch period (a strong self-similarity 2.5–12 ms later); breath noise doesn't.
        static double Periodicity(SoundRender r)
        {
            var x = r.Left; var sr = r.SampleRate; var n = sr / 25; var scores = new List<double>();
            var loud = x.Max(Math.Abs) * 0.2;
            for (var from = 0; from + n + sr / 80 < x.Length; from += n)
            {
                if (x.Skip(from).Take(n).Max(Math.Abs) < loud) continue;
                double best = 0, e0 = 0;
                for (var i = 0; i < n; i++) e0 += (double)x[from + i] * x[from + i];
                for (var lag = sr / 400; lag < sr / 80; lag++)
                {
                    double c = 0, e1 = 0;
                    for (var i = 0; i < n; i++) { c += (double)x[from + i] * x[from + i + lag]; e1 += (double)x[from + i + lag] * x[from + i + lag]; }
                    best = Math.Max(best, c / Math.Sqrt(e0 * e1 + 1e-12));
                }
                scores.Add(best);
            }
            return scores.OrderBy(v => v).ElementAt(scores.Count / 2);
        }
        var spoken = Voice("Adult, low");
        var whisper = Voice("Adult, low"); whisper.Delivery = "whisper";
        var (p1, p2) = (Periodicity(Render(spoken)), Periodicity(Render(whisper)));
        Assert.True(p1 > 0.7 && p2 < p1 - 0.25, $"spoken {p1:0.00}, whispered {p2:0.00}");
    }

    [Fact]
    public void Unknown_Choices_Fall_Back_And_Values_Stay_In_Range()
    {
        var l = new SoundLayer { Type = "voice", VoiceSays = "sing opera", Emotion = "hangry", EmotionEnd = "zen", Delivery = "yodel", Language = "klingon", VoiceSize = 9, SyllableRate = 99, VoiceLength = -1 };
        var c = new SoundRecipe { Layers = [l] }.Clamped().Layers[0];
        Assert.Equal(("chatter", "calm", null, "normal", "common"), (c.VoiceSays, c.Emotion, c.EmotionEnd, c.Delivery, c.Language));
        Assert.Equal((2.5, 14.0, 0.05), (c.VoiceSize, c.SyllableRate, c.VoiceLength));
        Assert.Equal("voice", SoundRecipe.FromJson(new SoundRecipe { Layers = [Voice()] }.ToJson()).Layers[0].Type);
    }

    [Fact]
    public void Fifteen_Seconds_Of_Rambling_Renders_Quickly()
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        Render(Voice("Cartoon kid", "chatter", 15));
        Assert.True(sw.ElapsedMilliseconds < 5000, $"{sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    public void Generate_Makes_Voices_And_Reactions()
    {
        for (var seed = 1; seed <= 6; seed++)
        {
            var v = SoundGenerator.Make("voice", seed);
            Assert.Equal("voice", v.Layers[0].Type);
            Assert.Equal("Speech", VoiceForge.Says.First(x => x.Id == v.Layers[0].VoiceSays).Group);
            var r = SoundGenerator.Make("reaction", seed);
            Assert.Equal("Sounds", VoiceForge.Says.First(x => x.Id == r.Layers[0].VoiceSays).Group);
            Assert.True(SoundEngine.Render(r, 22050).RmsDb > -45);
        }
    }
}
