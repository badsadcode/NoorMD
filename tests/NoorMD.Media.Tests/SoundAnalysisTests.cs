using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class SoundAnalysisTests
{
    private const int Sr = 48000;

    private static (float[] L, float[] R) Sine(double hz, double seconds, double amp, double phase = 0, int sr = Sr)
    {
        var n = (int)(seconds * sr); var l = new float[n];
        for (var i = 0; i < n; i++) l[i] = (float)(amp * Math.Sin(2 * Math.PI * hz * i / sr + phase));
        return (l, (float[])l.Clone());
    }

    [Fact]
    public void Loudness_Follows_BS1770_For_A_Sine_And_Ignores_Silence()
    {
        // A 1 kHz sine in both channels reads its peak level in LUFS (−20 dBFS → −20 LUFS).
        var (l, r) = Sine(1000, 5, 0.1);
        var (lufs, st, mom) = SoundAnalysis.Loudness(l, r, Sr);
        Assert.InRange(lufs, -20.15, -19.85);
        Assert.InRange(st, -20.15, -19.85);
        Assert.InRange(mom, -20.15, -19.85);
        // Two seconds of silence before it don't make it quieter (the gate), and a different rate measures the same.
        var quiet = new float[2 * Sr];
        var gl = quiet.Concat(l).ToArray(); var gr = quiet.Concat(r).ToArray();
        Assert.InRange(SoundAnalysis.Loudness(gl, gr, Sr).Integrated, -20.15, -19.85);
        var (l44, r44) = Sine(1000, 5, 0.1, 0, 44100);
        Assert.InRange(SoundAnalysis.Loudness(l44, r44, 44100).Integrated, -20.15, -19.85);
        // Short one-shots are measured as a whole; silence is −120.
        var (sl, sr) = Sine(1000, 0.2, 0.1);
        Assert.InRange(SoundAnalysis.Loudness(sl, sr, Sr).Integrated, -20.3, -19.7);
        Assert.Equal(-120, SoundAnalysis.Loudness(new float[Sr], new float[Sr], Sr).Integrated);
        // K-weighting: deep bass counts for less than the same level at 1 kHz.
        var (bl, br) = Sine(40, 5, 0.1);
        Assert.True(SoundAnalysis.Loudness(bl, br, Sr).Integrated < -21);
    }

    [Fact]
    public void True_Peak_Finds_The_Peak_Between_Samples()
    {
        // A sine at a quarter of the sample rate, a 45° off: every sample is at 0.707, the wave itself reaches 1.
        var (l, r) = Sine(Sr / 4.0, 0.5, 0.5, Math.PI / 4);
        var m = SoundAnalysis.Measure(l, r, Sr);
        Assert.InRange(m.SamplePeakDb, -9.1, -8.9);
        Assert.InRange(m.TruePeakDb, -6.4, -5.6);
    }

    [Fact]
    public void Stereo_Dc_Clipping_Brightness_And_The_Loop_Seam_Are_Measured()
    {
        var (l, r) = Sine(1000, 1, 0.5);
        var mono = SoundAnalysis.Measure(l, r, Sr);
        Assert.Equal((1.0, 0.0), (mono.Correlation, mono.Width));
        Assert.InRange(mono.CentroidHz, 900, 1100);
        var inverted = r.Select(v => -v).ToArray();
        var flipped = SoundAnalysis.Measure(l, inverted, Sr);
        Assert.Equal(-1, flipped.Correlation);
        Assert.Contains(flipped.Warnings(false, -1), w => w.Contains("cancel"));
        var (hl, hr) = Sine(6000, 1, 0.5);
        Assert.InRange(SoundAnalysis.Measure(hl, hr, Sr).CentroidHz, 5500, 6500);
        var dc = l.Select(v => v + 0.05f).ToArray();
        Assert.InRange(SoundAnalysis.Measure(dc, dc, Sr).DcPercent, 4.9, 5.1);
        var loud = l.Select(v => Math.Clamp(v * 4, -1f, 1f)).ToArray();
        var clipped = SoundAnalysis.Measure(loud, loud, Sr);
        Assert.True(clipped.Clipped > 1000);
        Assert.Contains(clipped.Warnings(false, -1), w => w.Contains("clipping"));
        // 1000 Hz over exactly 1 s wraps cleanly; cut a little short, it jumps.
        Assert.True(mono.SeamJump < 1.2, $"{mono.SeamJump}");
        var cut = l.Take(l.Length - 11).ToArray();
        var seam = SoundAnalysis.Measure(cut, cut, Sr);
        Assert.True(seam.SeamJump > 1.5, $"{seam.SeamJump}");
        Assert.Contains(seam.Warnings(true, -1), w => w.Contains("loop"));
        Assert.DoesNotContain(seam.Warnings(false, -1), w => w.Contains("loop"));
    }

    [Fact]
    public void The_Spectrogram_Shows_Where_The_Energy_Is()
    {
        var (l, r) = Sine(1000, 1, 0.5);
        const int rows = 64, cols = 50;
        var s = SoundAnalysis.Spectrogram(l, r, Sr, cols, rows);
        Assert.Equal(rows * cols, s.Length);
        var loudest = Enumerable.Range(0, rows).OrderByDescending(row => s[row * cols + cols / 2]).First();
        var hz = SoundAnalysis.SpectrogramLowHz * Math.Pow(SoundAnalysis.SpectrogramHighHz(Sr) / SoundAnalysis.SpectrogramLowHz, (loudest + 0.5) / rows);
        Assert.InRange(hz, 850, 1200);
        Assert.InRange(s[loudest * cols + cols / 2], 230, 255); // a −6 dB sine: near the top of the scale
        Assert.True(s[5 * cols + cols / 2] < 60, "little energy far below it");
        Assert.All(SoundAnalysis.Spectrogram(new float[1000], new float[1000], Sr, 10, 16), b => Assert.Equal(0, b));
    }

    [Fact]
    public void A_Loudness_Target_Brings_The_Sound_There()
    {
        foreach (var (id, target) in new[] { ("rain-steady", -23.0), ("ui-coin", -16.0), ("wind-storm", -14.0), ("step-wood", -14.0), ("rain-steady", -10.0) })
        {
            var r = SoundPresets.Make(id);
            r.Duration = Math.Min(r.Duration, 4);
            r.Master.TargetLufs = target;
            var x = SoundEngine.Render(r, Sr);
            var m = x.Measure();
            // At the target, or as close as the ceiling allows (a peaky sound is not squashed to get there).
            Assert.True(m.Lufs <= target + 0.3, $"{id}: {m.Lufs}");
            Assert.True(m.Lufs >= target - 0.6 || m.TruePeakDb >= r.Master.Ceiling - 0.6, $"{id}: {m.Lufs} LUFS, {m.TruePeakDb} dBTP");
            Assert.True(m.TruePeakDb <= r.Master.Ceiling + 0.05, $"{id}: {m.TruePeakDb} dBTP");
        }
        var c = new SoundRecipe { Master = new MasterSettings { TargetLufs = -80 } }.Clamped();
        Assert.Equal(-40, c.Master.TargetLufs);
        Assert.Equal(0, new SoundRecipe { Master = new MasterSettings { TargetLufs = 3 } }.Clamped().Master.TargetLufs);
    }
}
