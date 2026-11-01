using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>Voice Forge with a recording: found where it speaks and its pitch; its words kept with another voice, or
/// invented words with its timing; a mix. A Voice Forge voice stands in for a recording (its pitch and timing are known).</summary>
public class VoiceRecordingTests
{
    private const int Sr = 24000;

    /// <summary>The "recording": a calm narrator (about 118 Hz) talking for five seconds, as a 44.1 kHz WAV file.</summary>
    private static SampleAudio Recording(string profile = "Narrator", double seconds = 5)
    {
        var l = new SoundLayer { Type = "voice", Gain = -3, Width = 0, VoiceSays = "chatter", VoiceLength = seconds, Emotion = "calm", EmotionAmount = 0 };
        VoiceForge.Apply(VoiceForge.Profiles.First(p => p.Name == profile), l);
        var r = new SoundRecipe { Seed = 5, Loop = false, Duration = seconds + 0.6, Layers = [l], Gust = new GustSettings { Depth = 0 } };
        r.Master.Reverb = 0;
        return SampleAudio.ReadWav(SoundEngine.Render(r, 44100).ToWav(16));
    }

    private static SoundLayer FromRecording(double keepWords, double keepVoice, string profile = "Fairy")
    {
        var l = new SoundLayer { Type = "voice", Gain = -3, Width = 0, VoiceSource = "recording", Path = "rec.wav", SampleName = "rec.wav", KeepWords = keepWords, KeepVoice = keepVoice, FollowPitch = 1 };
        VoiceForge.Apply(VoiceForge.Profiles.First(p => p.Name == profile), l);
        return l;
    }

    private static float[] Render(SoundLayer l, SampleAudio audio, int seed = 1)
    {
        var r = new SoundRecipe { Seed = seed, Loop = false, Duration = audio.Seconds, Layers = [l], Gust = new GustSettings { Depth = 0 } };
        return SoundEngine.Render(r, Sr, p => p == "rec.wav" ? audio : null).Left;
    }

    private static double Correlation(float[] a, float[] b)
    {
        var n = Math.Min(a.Length, b.Length); double ab = 0, aa = 0, bb = 0;
        for (var i = 0; i < n; i++) { ab += (double)a[i] * b[i]; aa += (double)a[i] * a[i]; bb += (double)b[i] * b[i]; }
        return ab / Math.Sqrt(aa * bb + 1e-12);
    }

    [Fact]
    public void A_Recording_Is_Found_Speaking_With_Its_Pitch_And_Syllables()
    {
        var audio = Recording();
        var an = VoiceForge.Analyze(VoiceForge.Mono(audio, 0, 0, Sr), Sr);
        Assert.InRange(an.MedianPitch, 95, 150); // the narrator speaks around 118 Hz
        Assert.NotEmpty(an.Speech);
        Assert.InRange(an.Speech[0].Start, 0, 0.2);
        Assert.InRange(an.Syllables.Count, 10, 32); // about 4.4 syllables a second, with pauses
        Assert.All(an.Syllables, s => Assert.True(s.Start <= s.Peak && s.Peak <= s.End));
    }

    [Fact]
    public void Keeping_Its_Words_And_Its_Voice_Leaves_It_As_It_Was()
    {
        var audio = Recording();
        var original = VoiceForge.Mono(audio, 0, 0, Sr);
        var same = Render(FromRecording(1, 1), audio);
        Assert.True(Correlation(original, same) > 0.9, $"correlation {Correlation(original, same):0.00}");
    }

    [Fact]
    public void Its_Words_With_Another_Voice_Move_The_Pitch_And_Keep_The_Timing()
    {
        var audio = Recording();
        var original = VoiceForge.Mono(audio, 0, 0, Sr);
        var a0 = VoiceForge.Analyze(original, Sr);
        var fairy = Render(FromRecording(1, 0, "Fairy"), audio); // the fairy speaks around 480 Hz
        var a1 = VoiceForge.Analyze(fairy, Sr);
        Assert.InRange(a1.MedianPitch, 380, 600);
        Assert.Equal(a0.Speech.Count, a1.Speech.Count);
        for (var i = 0; i < a0.Speech.Count; i++)
        {
            Assert.InRange(a1.Speech[i].Start, a0.Speech[i].Start - 0.06, a0.Speech[i].Start + 0.06);
            Assert.InRange(a1.Speech[i].End, a0.Speech[i].End - 0.08, a0.Speech[i].End + 0.08);
        }
    }

    [Fact]
    public void Invented_Words_Keep_Its_Timing_But_Not_Its_Sound()
    {
        var audio = Recording();
        var original = VoiceForge.Mono(audio, 0, 0, Sr);
        var a0 = VoiceForge.Analyze(original, Sr);
        var made = Render(FromRecording(0, 1, "Narrator"), audio);
        var a1 = VoiceForge.Analyze(made, Sr);
        Assert.True(Math.Abs(Correlation(original, made)) < 0.3, "invented words should not be the recording");
        // Where it speaks and stops: the same phrases.
        Assert.Equal(a0.Speech.Count, a1.Speech.Count);
        for (var i = 0; i < a0.Speech.Count; i++) Assert.InRange(a1.Speech[i].Start, a0.Speech[i].Start - 0.08, a0.Speech[i].Start + 0.08);
        // Its melody: in the same voice, the pitch follows the recording's (same middle within 15 %).
        Assert.InRange(a1.MedianPitch, a0.MedianPitch * 0.85, a0.MedianPitch * 1.15);
    }

    [Fact]
    public void A_Mix_Is_Partly_Each_And_The_Same_Seed_Gives_The_Same_Mix()
    {
        var audio = Recording();
        var own = Render(FromRecording(1, 1, "Narrator"), audio);
        var made = Render(FromRecording(0, 1, "Narrator"), audio);
        var mix = Render(FromRecording(0.5, 1, "Narrator"), audio);
        var cOwn = Correlation(own, mix); var cMade = Correlation(made, mix);
        Assert.InRange(cOwn, 0.2, 0.9);
        Assert.InRange(cMade, 0.2, 0.9);
        Assert.Equal(mix, Render(FromRecording(0.5, 1, "Narrator"), audio));
    }

    [Fact]
    public void Its_Own_Words_Become_Less_Clear_While_Its_Voice_Timing_And_Level_Stay()
    {
        var audio = Recording();
        var original = VoiceForge.Mono(audio, 0, 0, Sr);
        var a0 = VoiceForge.Analyze(original, Sr);
        float[] At(double clarity) { var l = FromRecording(1, 1, "Narrator"); l.WordClarity = clarity; return Render(l, audio); }
        // How much the mouth's shape moves: the spread of the brightness (spectral centroid) from moment to moment.
        static double Movement(float[] x)
        {
            var n = 1024; var list = new List<double>();
            for (var at = 0; at + n < x.Length; at += n / 2)
            {
                var re = new double[n]; var im = new double[n]; double e = 0;
                for (var i = 0; i < n; i++) { re[i] = x[at + i] * (0.5 - 0.5 * Math.Cos(2 * Math.PI * i / n)); e += re[i] * re[i]; }
                if (e < 1e-3) continue; // quiet: no shape to measure
                SoundAnalysis.Fft(re, im);
                double num = 0, den = 0;
                for (var k = 1; k < n / 2; k++) { var m = Math.Sqrt(re[k] * re[k] + im[k] * im[k]); num += k * m; den += m; }
                list.Add(num / den);
            }
            var mean = list.Average();
            return Math.Sqrt(list.Average(v => (v - mean) * (v - mean)));
        }
        static double Rms(float[] x) => Math.Sqrt(x.Average(v => (double)v * v));
        var clear = At(1); var mumbled = At(0.6); var gone = At(0);
        Assert.True(Correlation(original, clear) > 0.9);
        Assert.True(Movement(gone) < Movement(mumbled) && Movement(mumbled) < Movement(clear), $"{Movement(clear):0.0} > {Movement(mumbled):0.0} > {Movement(gone):0.0}");
        Assert.InRange(20 * Math.Log10(Rms(gone) / Rms(clear)), -2, 2); // as loud
        var a1 = VoiceForge.Analyze(gone, Sr);
        Assert.Equal(a0.Speech.Count, a1.Speech.Count); // the same phrases and pauses
        Assert.InRange(a1.MedianPitch, a0.MedianPitch * 0.9, a0.MedianPitch * 1.1); // the same voice
    }

    [Fact]
    public void A_Missing_Recording_Is_Reported_And_Recordings_Are_Files_The_Recipe_Reads()
    {
        var l = FromRecording(0, 0);
        var r = new SoundRecipe { Loop = false, Duration = 1, Layers = [l] };
        var render = SoundEngine.Render(r, Sr, _ => null);
        Assert.Contains(render.Warnings, w => w.Contains("recording is missing"));
        Assert.Contains("rec.wav", r.Files());
        Assert.DoesNotContain("x.wav", new SoundRecipe { Layers = [new SoundLayer { Type = "voice", Path = "x.wav" }] }.Files()); // a made-up voice reads no file
        var back = SoundRecipe.FromJson(r.ToJson()).Layers[0];
        Assert.Equal(("recording", 0.0, 0.0), (back.VoiceSource, back.KeepWords, back.KeepVoice));
    }
}
