namespace NoorMD.Media;

// Sound Bench feedback: what a render measures like (loudness as ITU-R BS.1770 defines it, true peak, stereo,
// brightness, DC and loop seams) and a spectrogram to see it. The loudness measurement matches the Music Bench's
// (audiofx.js): K-weighting, 400 ms blocks with 75 % overlap, an absolute gate at −70 LUFS and a relative one 10 LU down.

/// <summary>The measurements of a sound. Levels are in dB (LUFS for loudness); −120 stands for silence.</summary>
public sealed record SoundMeasure(
    double Lufs, double ShortTermMax, double MomentaryMax, double TruePeakDb, double SamplePeakDb,
    double Correlation, double Width, double DcPercent, int Clipped, double CentroidHz, double SeamJump)
{
    /// <summary>Plain warnings for the page (the loop seam only matters for loops).</summary>
    public IReadOnlyList<string> Warnings(bool loop, double ceilingDb)
    {
        var w = new List<string>();
        if (Clipped > 0) w.Add($"{Clipped} samples at full scale (clipping)");
        else if (TruePeakDb > ceilingDb + 0.3) w.Add($"True peak {TruePeakDb:0.0} dBTP is above the ceiling ({ceilingDb:0.0} dB): it may clip once converted");
        if (Lufs > -120 && Lufs < -40) w.Add("Very quiet (below −40 LUFS)");
        if (Correlation < -0.2) w.Add("Left and right mostly cancel each other in mono");
        if (Math.Abs(DcPercent) > 1) w.Add($"DC offset ({DcPercent:0.0} %)");
        if (loop && SeamJump > 4) w.Add("The loop has a jump where it wraps (a click)");
        return w;
    }
}

public static class SoundAnalysis
{
    private static double Db(double v) => v > 1e-6 ? Math.Round(20 * Math.Log10(v), 2) : -120;

    // ------------------------------------------------------------------ loudness (BS.1770)

    private sealed class Biquad(double b0, double b1, double b2, double a1, double a2)
    {
        private double _x1, _x2, _y1, _y2;
        public double Run(double x)
        {
            var y = b0 * x + b1 * _x1 + b2 * _x2 - a1 * _y1 - a2 * _y2;
            _x2 = _x1; _x1 = x; _y2 = _y1; _y1 = y;
            return y;
        }
    }

    /// <summary>K-weighting for any sample rate (as in libebur128): a high shelf, then the RLB high-pass.</summary>
    private static (Biquad, Biquad) KWeighting(int fs)
    {
        double f0 = 1681.974450955533, g = 3.999843853973347, q = 0.7071752369554196;
        var k = Math.Tan(Math.PI * f0 / fs);
        double vh = Math.Pow(10, g / 20), vb = Math.Pow(vh, 0.4996667741545416);
        var a0 = 1 + k / q + k * k;
        var pre = new Biquad((vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0);
        f0 = 38.13547087602444; q = 0.5003270373238773;
        k = Math.Tan(Math.PI * f0 / fs);
        a0 = 1 + k / q + k * k;
        var rlb = new Biquad(1, -2, 1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0);
        return (pre, rlb);
    }

    private static double Lk(double z) => z > 0 ? -0.691 + 10 * Math.Log10(z) : -120;

    /// <summary>
    /// Integrated, short-term (3 s) maximum and momentary (400 ms) maximum loudness. A sound shorter than one 400 ms
    /// block is measured as a whole, so short one-shots still get a number.
    /// </summary>
    public static (double Integrated, double ShortTermMax, double MomentaryMax) Loudness(float[] left, float[] right, int sr)
    {
        var seg = Math.Max(1, (int)Math.Round(sr * 0.1));
        var n = left.Length;
        var segs = n / seg;
        var energy = new double[Math.Max(1, segs)];
        double whole = 0;
        foreach (var ch in new[] { left, right })
        {
            var (f1, f2) = KWeighting(sr);
            double s = 0, all = 0;
            int k = 0, idx = 0;
            for (var i = 0; i < n; i++)
            {
                var z = f2.Run(f1.Run(ch[i]));
                s += z * z; all += z * z;
                if (++k == seg && idx < segs) { energy[idx++] += s / seg; s = 0; k = 0; }
            }
            whole += all / Math.Max(1, n);
        }
        if (segs < 4) { var v = Math.Round(Lk(whole), 2); return (v, v, v); }
        var blocks = new List<double>();
        for (var i = 0; i + 4 <= segs; i++) blocks.Add((energy[i] + energy[i + 1] + energy[i + 2] + energy[i + 3]) / 4);
        var momentary = blocks.Count > 0 ? blocks.Max() : 0;
        var shortTerm = 0.0;
        if (segs >= 30) for (var i = 0; i + 30 <= segs; i++) shortTerm = Math.Max(shortTerm, energy.Skip(i).Take(30).Average());
        else shortTerm = energy.Take(segs).Average();
        var gated = blocks.Where(z => Lk(z) > -70).ToList();
        if (gated.Count == 0) return (-120, Math.Round(Lk(shortTerm), 2), Math.Round(Lk(momentary), 2));
        var relGate = Lk(gated.Average()) - 10;
        var rel = gated.Where(z => Lk(z) > relGate).ToList();
        return (Math.Round(Lk(rel.Average()), 2), Math.Round(Lk(shortTerm), 2), Math.Round(Lk(momentary), 2));
    }

    // ------------------------------------------------------------------ true peak

    private static readonly double[][] Phases = BuildPhases();

    /// <summary>A 4× oversampling interpolator (windowed sinc, 12 taps per phase).</summary>
    private static double[][] BuildPhases()
    {
        const int taps = 12;
        var p = new double[4][];
        for (var ph = 0; ph < 4; ph++)
        {
            p[ph] = new double[taps];
            var sum = 0.0;
            for (var t = 0; t < taps; t++)
            {
                var x = t - taps / 2 + 1 - ph / 4.0; // distance from the point between samples
                var sinc = Math.Abs(x) < 1e-9 ? 1 : Math.Sin(Math.PI * x) / (Math.PI * x);
                var w = 0.42 + 0.5 * Math.Cos(Math.PI * x / (taps / 2.0)) + 0.08 * Math.Cos(2 * Math.PI * x / (taps / 2.0));
                p[ph][t] = sinc * Math.Max(0, w);
                sum += p[ph][t];
            }
            for (var t = 0; t < taps; t++) p[ph][t] /= sum;
        }
        return p;
    }

    /// <summary>The highest level between samples too (4× oversampled), as a converter would reconstruct it.</summary>
    public static double TruePeak(float[] x)
    {
        var peak = 0.0;
        foreach (var v in x) peak = Math.Max(peak, Math.Abs(v));
        var look = peak * 0.5; // only where the wave is near its top can it rise above the samples' peak
        const int taps = 12;
        for (var i = 0; i < x.Length; i++)
        {
            if (Math.Abs(x[i]) < look && (i + 1 >= x.Length || Math.Abs(x[i + 1]) < look)) continue;
            for (var ph = 1; ph < 4; ph++)
            {
                var c = Phases[ph];
                double v = 0;
                for (var t = 0; t < taps; t++)
                {
                    var j = i + t - taps / 2 + 1;
                    if (j >= 0 && j < x.Length) v += x[j] * c[t];
                }
                peak = Math.Max(peak, Math.Abs(v));
            }
        }
        return peak;
    }

    // ------------------------------------------------------------------ everything at once

    public static SoundMeasure Measure(float[] left, float[] right, int sr)
    {
        var n = left.Length;
        var (lufs, st, mom) = Loudness(left, right, sr);
        double sumL = 0, sumR = 0, ll = 0, rr = 0, lr = 0, mid = 0, side = 0, peak = 0;
        var clipped = 0;
        for (var i = 0; i < n; i++)
        {
            double l = left[i], r = right[i];
            sumL += l; sumR += r; ll += l * l; rr += r * r; lr += l * r;
            mid += (l + r) * (l + r) / 4; side += (l - r) * (l - r) / 4;
            var a = Math.Max(Math.Abs(l), Math.Abs(r));
            peak = Math.Max(peak, a);
            if (a >= 0.9999) clipped++;
        }
        var corr = ll > 1e-12 && rr > 1e-12 ? lr / Math.Sqrt(ll * rr) : 1;
        var width = mid > 1e-12 ? Math.Sqrt(side / mid) : side > 1e-12 ? 9.99 : 0;
        var dc = n > 0 ? (sumL + sumR) / (2.0 * n) * 100 : 0;
        // The loop seam: the step from the last sample to the first, against the steps the sound usually takes.
        var seam = 0.0;
        if (n > 16)
        {
            var every = Math.Max(1, n / 65536); // a sample of the steps is enough for "usually"
            var steps = new double[(n - 1) / every];
            for (var k = 0; k < steps.Length; k++) { var i = 1 + k * every; steps[k] = Math.Abs(left[i] - left[i - 1]) + Math.Abs(right[i] - right[i - 1]); }
            Array.Sort(steps);
            var usual = Math.Max(1e-4, steps[(int)(steps.Length * 0.99)]);
            seam = (Math.Abs(left[0] - left[^1]) + Math.Abs(right[0] - right[^1])) / usual;
        }
        var tp = Math.Max(TruePeak(left), TruePeak(right));
        return new SoundMeasure(lufs, st, mom, Db(tp), Db(peak), Math.Round(corr, 3), Math.Round(width, 3), Math.Round(dc, 3), clipped,
            Math.Round(Centroid(left, right, sr)), Math.Round(seam, 2));
    }

    // ------------------------------------------------------------------ spectrum

    private static void Fft(double[] re, double[] im)
    {
        var n = re.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            var bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { (re[i], re[j]) = (re[j], re[i]); (im[i], im[j]) = (im[j], im[i]); }
        }
        for (var len = 2; len <= n; len <<= 1)
        {
            var ang = -2 * Math.PI / len;
            double wr = Math.Cos(ang), wi = Math.Sin(ang);
            for (var i = 0; i < n; i += len)
            {
                double cr = 1, ci = 0;
                for (var k = 0; k < len / 2; k++)
                {
                    int a = i + k, b = i + k + len / 2;
                    double tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                    (cr, ci) = (cr * wr - ci * wi, cr * wi + ci * wr);
                }
            }
        }
    }

    /// <summary>Power per FFT bin (size <paramref name="size"/>, Hann window) of the mono mix around <paramref name="centre"/>.</summary>
    private static double[] Power(float[] left, float[] right, int centre, int size)
    {
        var re = new double[size]; var im = new double[size];
        for (var i = 0; i < size; i++)
        {
            var j = centre - size / 2 + i;
            var v = j >= 0 && j < left.Length ? (left[j] + right[j]) * 0.5 : 0;
            re[i] = v * (0.5 - 0.5 * Math.Cos(2 * Math.PI * i / size));
        }
        Fft(re, im);
        var p = new double[size / 2];
        for (var k = 0; k < size / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
        return p;
    }

    private static int FftSize(int sr) => sr > 60000 ? 4096 : 2048;

    /// <summary>Brightness: the average frequency weighted by power over the sound (Hz; 0 for silence).</summary>
    public static double Centroid(float[] left, float[] right, int sr)
    {
        var size = FftSize(sr);
        if (left.Length == 0) return 0;
        var frames = Math.Clamp(left.Length / size, 1, 64);
        double num = 0, den = 0;
        for (var f = 0; f < frames; f++)
        {
            var p = Power(left, right, (int)((f + 0.5) * left.Length / frames), size);
            for (var k = 1; k < p.Length; k++) { var hz = (double)k * sr / size; num += hz * p[k]; den += p[k]; }
        }
        return den > 1e-12 ? num / den : 0;
    }

    /// <summary>
    /// A spectrogram: <paramref name="columns"/> moments across the sound, <paramref name="rows"/> frequency bands spaced
    /// evenly on a musical (log) scale from <see cref="SpectrogramLowHz"/> to 20 kHz (or half the sample rate), each
    /// 0–255 for −96…0 dB (row 0 is the lowest band).
    /// </summary>
    public static byte[] Spectrogram(float[] left, float[] right, int sr, int columns, int rows)
    {
        columns = Math.Clamp(columns, 1, 1000); rows = Math.Clamp(rows, 8, 256);
        var size = FftSize(sr);
        var top = SpectrogramHighHz(sr);
        var edges = new double[rows + 1];
        for (var r = 0; r <= rows; r++) edges[r] = SpectrogramLowHz * Math.Pow(top / SpectrogramLowHz, (double)r / rows);
        var outp = new byte[columns * rows];
        var norm = Math.Pow(size / 4.0, 2); // a full-scale sine reads about 0 dB
        for (var c = 0; c < columns; c++)
        {
            if (left.Length == 0) break;
            var p = Power(left, right, (int)((c + 0.5) * left.Length / columns), size);
            for (var r = 0; r < rows; r++)
            {
                var k0 = (int)Math.Floor(edges[r] * size / sr); var k1 = Math.Max(k0, (int)Math.Ceiling(edges[r + 1] * size / sr));
                var best = 0.0;
                for (var k = Math.Max(1, k0); k <= Math.Min(p.Length - 1, k1); k++) best = Math.Max(best, p[k]);
                var db = best > 0 ? 10 * Math.Log10(best / norm) : -200;
                outp[r * columns + c] = (byte)Math.Clamp((int)Math.Round((db + 96) / 96 * 255), 0, 255);
            }
        }
        return outp;
    }

    public const double SpectrogramLowHz = 30;
    public static double SpectrogramHighHz(int sr) => Math.Min(20000, sr / 2.0);
}
