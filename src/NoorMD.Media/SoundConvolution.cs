using System.Collections.Concurrent;

namespace NoorMD.Media;

// Convolution reverb: the sound played "inside" a recorded space. An impulse response (a clap, a balloon pop or a
// sine sweep recorded in a room, church or tunnel, then turned into its echo pattern) is laid over every sample of
// the sound. Built-in spaces are made here, deterministically, so the effect is useful without any recordings.
// The work is a uniformly partitioned FFT convolution (overlap-add), with blocks as large as the response, so a
// 30-second sound in a 3-second hall takes a fraction of a second.

public static class SoundConvolution
{
    public static readonly string[] Spaces = ["room", "hall", "church", "cave", "plate", "tunnel", "file"];
    public const double MaxSeconds = 10;

    /// <summary>A built-in space: reverb time (s), early reflections (count, first and last ms), its own darkening, flutter echo (ms, 0 = none).</summary>
    private static readonly Dictionary<string, (double Rt, int Early, double EarlyFrom, double EarlyTo, double Dark, double Flutter)> BuiltIn = new()
    {
        ["room"] = (0.6, 6, 3, 25, 0.3, 0),
        ["hall"] = (2.2, 10, 10, 80, 0.3, 0),
        ["church"] = (4.5, 12, 20, 120, 0.5, 0),
        ["cave"] = (3.0, 8, 40, 250, 0.6, 0),
        ["plate"] = (1.8, 0, 0, 0, 0.1, 0),
        ["tunnel"] = (2.5, 4, 8, 30, 0.4, 35),
    };

    private static readonly ConcurrentDictionary<string, (double[] L, double[] R)> Cache = new();

    /// <summary>The response a convolution effect uses (null when its recording is missing or not allowed).</summary>
    public static (double[] L, double[] R)? Response(SoundEffect fx, int sr, Func<string, SampleAudio?>? files)
    {
        SampleAudio? audio = null;
        string key;
        if (fx.Space == "file")
        {
            if (string.IsNullOrEmpty(fx.IrPath)) return null;
            audio = files?.Invoke(fx.IrPath);
            if (audio == null) return null;
            key = $"file|{fx.IrPath}|{audio.Left.Length}|{audio.Rate}";
        }
        else key = "space|" + fx.Space;
        key += $"|{sr}|{fx.IrLength:0.###}|{fx.Damping:0.###}|{fx.PreDelay:0.#}";
        if (Cache.TryGetValue(key, out var hit)) return hit;
        var (rl, rr) = audio != null ? FromFile(audio, sr) : Make(fx.Space, sr);
        var ir = Shape(rl, rr, sr, fx, fx.Space == "file" ? 0 : BuiltIn[fx.Space].Dark, fx.Space == "file" ? 1.5 : BuiltIn[fx.Space].Rt);
        if (Cache.Count > 12) Cache.Clear();
        Cache[key] = ir;
        return ir;
    }

    private static (double[], double[]) FromFile(SampleAudio a, int sr)
    {
        // To the render's rate (linear: a response is mostly noise-like), at most MaxSeconds.
        var step = (double)a.Rate / sr;
        var n = (int)Math.Min(a.Left.Length / step, MaxSeconds * sr);
        double[] l = new double[n], r = new double[n];
        for (var i = 0; i < n; i++)
        {
            var p = i * step; var k = (int)p; var f = p - k;
            var k1 = Math.Min(k + 1, a.Left.Length - 1);
            l[i] = a.Left[k] + (a.Left[k1] - a.Left[k]) * f;
            r[i] = a.Right[k] + (a.Right[k1] - a.Right[k]) * f;
        }
        // Skip the silence before the response starts (a recording rarely begins on the clap).
        var peak = 0.0; foreach (var v in l) peak = Math.Max(peak, Math.Abs(v)); foreach (var v in r) peak = Math.Max(peak, Math.Abs(v));
        var start = 0;
        while (start < n - 1 && Math.Abs(l[start]) < peak * 0.05 && Math.Abs(r[start]) < peak * 0.05) start++;
        start = Math.Max(0, start - (int)(0.001 * sr));
        return (l[start..], r[start..]);
    }

    /// <summary>A built-in space: early reflections, then a dense tail that builds up and dies away; left and right differ.</summary>
    private static (double[], double[]) Make(string space, int sr)
    {
        var s = BuiltIn[space];
        var n = (int)(Math.Min(MaxSeconds, s.Rt * 1.3) * sr);
        var outp = new double[2][];
        for (var ch = 0; ch < 2; ch++)
        {
            var x = new double[n];
            // Seeded by the space's place in the list (string hashes change from run to run): the same space every time.
            var rng = new SoundRng((ulong)Array.IndexOf(Spaces, space) * 104729 + (ulong)ch * 7919 + 1);
            x[0] = 1; // the direct sound
            for (var e = 0; e < s.Early; e++)
            {
                var t = s.EarlyFrom + (s.EarlyTo - s.EarlyFrom) * Math.Pow(rng.NextDouble(), 0.7);
                var at = (int)(t / 1000 * sr);
                if (at < n) x[at] += (rng.NextDouble() < 0.5 ? -1 : 1) * (0.35 + 0.4 * rng.NextDouble()) * Math.Exp(-6.9 * t / 1000 / s.Rt);
            }
            if (s.Flutter > 0)
                for (var k = 1; k * s.Flutter / 1000 < s.Rt; k++)
                {
                    var at = (int)(k * s.Flutter / 1000 * sr) + (int)(rng.Bipolar() * 0.0004 * sr);
                    if (at > 0 && at < n) x[at] += (k % 2 == 0 ? 1 : -1) * 0.45 * Math.Exp(-6.9 * k * s.Flutter / 1000 / (s.Rt * 0.6));
                }
            var build = Math.Max(0.002, s.EarlyTo / 1000); // the tail fades in as reflections multiply
            for (var i = 1; i < n; i++)
            {
                var t = (double)i / sr;
                var env = Math.Exp(-6.9 * t / s.Rt) * Math.Min(1, t / build);
                x[i] += rng.Gaussian() * env * 0.25;
            }
            outp[ch] = x;
        }
        return (outp[0], outp[1]);
    }

    /// <summary>Trimmed to Length (with a short fade), darkened as it goes on, after the pre-delay, scaled so noise keeps its level.</summary>
    private static (double[], double[]) Shape(double[] l, double[] r, int sr, SoundEffect fx, double ownDark, double rt)
    {
        var n = l.Length;
        if (fx.IrLength > 0) n = Math.Min(n, Math.Max(16, (int)(fx.IrLength * sr)));
        var fade = Math.Min(n / 4, (int)(0.05 * sr));
        var pre = (int)(fx.PreDelay / 1000 * sr);
        var dark = ownDark + fx.Damping * 1.5;
        var outp = new double[2][];
        var energy = 0.0;
        for (var ch = 0; ch < 2; ch++)
        {
            var src = ch == 0 ? l : r;
            var y = new double[pre + n];
            double lp = 0;
            for (var i = 0; i < n; i++)
            {
                // The high cut falls through the tail: air and walls take the highs first.
                var t = (double)i / sr;
                var fc = Math.Max(250, 20000 * Math.Exp(-dark * 3 * t / Math.Max(0.1, rt)));
                var a = 1 - Math.Exp(-2 * Math.PI * Math.Min(fc, sr * 0.45) / sr);
                lp += (src[i] - lp) * a;
                var v = dark > 0 ? lp : src[i];
                if (i >= n - fade) v *= (double)(n - i) / fade;
                y[pre + i] = v;
                energy += v * v;
            }
            outp[ch] = y;
        }
        var g = energy > 1e-12 ? 1 / Math.Sqrt(energy / 2) : 0;
        foreach (var y in outp) for (var i = 0; i < y.Length; i++) y[i] *= g;
        return (outp[0], outp[1]);
    }

    /// <summary>The sound through the space (fully wet; the effect's Mix blends it with the dry sound).</summary>
    public static void Apply(double[] L, double[] R, (double[] L, double[] R) ir) => Convolve(L, R, ir.L, ir.R);

    /// <summary>One channel convolved with h, in place (kept to x's length).</summary>
    internal static void Convolve(double[] x, double[] h) => Convolve(x, new double[x.Length], h, h);

    /// <summary>
    /// Both channels convolved with their responses, in place, kept to their length: uniformly partitioned overlap-add.
    /// Left and right are real, so they share each FFT (left as the real part, right as the imaginary part) and are
    /// told apart by the spectrum's symmetry, which halves the work.
    /// </summary>
    internal static void Convolve(double[] xl, double[] xr, double[] hl, double[] hr)
    {
        var t = xl.Length;
        var m = Math.Max(hl.Length, hr.Length);
        if (t == 0 || m == 0) return;
        var b = 1024;
        while (b < m && b < 131072) b <<= 1; // blocks about as long as the response: few partitions
        var n = 2 * b;
        var half = n / 2 + 1;
        var parts = (m + b - 1) / b;
        // The responses' spectra, per partition (bins 0 … n/2 are enough for real signals).
        double[][] Hlr = new double[parts][], Hli = new double[parts][], Hrr = new double[parts][], Hri = new double[parts][];
        var wr = new double[n]; var wi = new double[n];
        for (var k = 0; k < parts; k++)
        {
            Array.Clear(wr); Array.Clear(wi);
            if (k * b < hl.Length) Array.Copy(hl, k * b, wr, 0, Math.Min(b, hl.Length - k * b));
            if (k * b < hr.Length) Array.Copy(hr, k * b, wi, 0, Math.Min(b, hr.Length - k * b));
            SoundAnalysis.Fft(wr, wi);
            (Hlr[k], Hli[k], Hrr[k], Hri[k]) = Split(wr, wi, n, half);
        }
        double[][] Xlr = new double[parts][], Xli = new double[parts][], Xrr = new double[parts][], Xri = new double[parts][];
        var blocks = (t + b - 1) / b;
        var yl = new double[t + n]; var yr = new double[t + n];
        double[] al = new double[half], ali = new double[half], ar = new double[half], ari = new double[half];
        for (var j = 0; j < blocks; j++)
        {
            var slot = j % parts;
            Array.Clear(wr); Array.Clear(wi);
            var len = Math.Min(b, t - j * b);
            Array.Copy(xl, j * b, wr, 0, len);
            Array.Copy(xr, j * b, wi, 0, len);
            SoundAnalysis.Fft(wr, wi);
            (Xlr[slot], Xli[slot], Xrr[slot], Xri[slot]) = Split(wr, wi, n, half);
            Array.Clear(al); Array.Clear(ali); Array.Clear(ar); Array.Clear(ari);
            for (var k = 0; k < parts && k <= j; k++)
            {
                var s = ((j - k) % parts + parts) % parts;
                double[] xlr = Xlr[s], xli = Xli[s], xrr = Xrr[s], xri = Xri[s], hlr = Hlr[k], hli = Hli[k], hrr = Hrr[k], hri = Hri[k];
                for (var q = 0; q < half; q++)
                {
                    al[q] += xlr[q] * hlr[q] - xli[q] * hli[q]; ali[q] += xlr[q] * hli[q] + xli[q] * hlr[q];
                    ar[q] += xrr[q] * hrr[q] - xri[q] * hri[q]; ari[q] += xrr[q] * hri[q] + xri[q] * hrr[q];
                }
            }
            // Y = YL + i·YR over the whole spectrum (each half mirrored), inverted: left comes out real, right imaginary.
            for (var q = 0; q < n; q++)
            {
                double lr, li, rr, ri;
                if (q < half) { lr = al[q]; li = ali[q]; rr = ar[q]; ri = ari[q]; }
                else { var p = n - q; lr = al[p]; li = -ali[p]; rr = ar[p]; ri = -ari[p]; }
                wr[q] = lr - ri;
                wi[q] = -(li + rr); // conjugated for the inverse
            }
            SoundAnalysis.Fft(wr, wi);
            var at = j * b;
            for (var q = 0; q < n; q++) { yl[at + q] += wr[q] / n; yr[at + q] -= wi[q] / n; }
        }
        Array.Copy(yl, xl, t);
        Array.Copy(yr, xr, t);
    }

    /// <summary>The spectra of two real signals that went through one FFT as real (a) and imaginary (b) parts.</summary>
    private static (double[], double[], double[], double[]) Split(double[] re, double[] im, int n, int half)
    {
        double[] ar = new double[half], ai = new double[half], br = new double[half], bi = new double[half];
        for (var q = 0; q < half; q++)
        {
            var p = (n - q) % n;
            // A = (Z[q] + conj Z[n−q]) / 2,  B = (Z[q] − conj Z[n−q]) / 2i
            ar[q] = (re[q] + re[p]) / 2; ai[q] = (im[q] - im[p]) / 2;
            br[q] = (im[q] + im[p]) / 2; bi[q] = -(re[q] - re[p]) / 2;
        }
        return (ar, ai, br, bi);
    }
}
