namespace NoorMD.Media;

/// <summary>
/// Voice Forge with a recording: what it says can be kept (the voice changed: its pitch and body size apart, breath,
/// rasp, growl, a robot) or replaced by invented words that keep its acting (when each syllable comes, the pauses, how
/// loud, the melody), or a mix, word by word. The recording itself is never changed.
/// </summary>
public static partial class VoiceForge
{
    /// <summary>One syllable found in a recording: where it starts, is loudest and ends (seconds), and how loud (dB).</summary>
    public sealed record FoundSyllable(double Start, double Peak, double End, double PeakDb);

    /// <summary>What a recording does: its pitch (Hz, 0 = no voice) and loudness (dB) every 10 ms, where it speaks, its syllables.</summary>
    public sealed class Analysis
    {
        public const double Hop = 0.01;
        public required float[] Pitch { get; init; }
        public required float[] Db { get; init; }
        public required List<(double Start, double End)> Speech { get; init; }
        public required List<FoundSyllable> Syllables { get; init; }
        public double MedianPitch { get; init; }
        public double LoudestDb { get; init; }
        public double Seconds { get; init; }
        public double PitchAt(double t) { var i = (int)(t / Hop); return i >= 0 && i < Pitch.Length ? Pitch[i] : 0; }
    }

    /// <summary>The used part of a recording, mono, at the given rate (linear interpolation is enough for speech).</summary>
    public static float[] Mono(SampleAudio a, double trimStart, double trimEnd, int sr)
    {
        var from = (int)Math.Clamp(trimStart * a.Rate, 0, a.Left.Length);
        var to = trimEnd > 0 ? (int)Math.Clamp(trimEnd * a.Rate, from, a.Left.Length) : a.Left.Length;
        var n = to - from;
        var outN = (int)((long)n * sr / a.Rate);
        var o = new float[outN];
        var step = (double)a.Rate / sr;
        for (var i = 0; i < outN; i++)
        {
            var x = from + i * step; var k = (int)x; var f = (float)(x - k);
            float S(int j) => j < to ? (a.Left[j] + a.Right[j]) * 0.5f : 0;
            o[i] = S(k) * (1 - f) + S(Math.Min(k + 1, to - 1)) * f;
        }
        return o;
    }

    /// <summary>Finds where a recording speaks, its syllables (loudness peaks with dips between), and its pitch (YIN).</summary>
    public static Analysis Analyze(float[] x, int sr)
    {
        var hop = (int)(sr * Analysis.Hop);
        var frames = Math.Max(1, x.Length / hop);
        var db = new float[frames];
        var win = (int)(sr * 0.03);
        for (var f = 0; f < frames; f++)
        {
            int c = f * hop + hop / 2, a = Math.Max(0, c - win / 2), b = Math.Min(x.Length, c + win / 2);
            double e = 0; for (var i = a; i < b; i++) e += (double)x[i] * x[i];
            db[f] = (float)(10 * Math.Log10(e / Math.Max(1, b - a) + 1e-12));
        }
        var loudest = db.Max();
        var floor = db.OrderBy(v => v).ElementAt(frames / 10);
        var threshold = Math.Max(floor + 10, loudest - 40);
        // Where it speaks: loud enough, short gaps filled (a stop inside a word), short bits dropped (a click).
        var on = db.Select(v => v > threshold).ToArray();
        var regions = new List<(int A, int B)>();
        for (var f = 0; f < frames;)
        {
            if (!on[f]) { f++; continue; }
            var a = f; while (f < frames && on[f]) f++;
            if (regions.Count > 0 && a - regions[^1].B < 12) regions[^1] = (regions[^1].A, f); else regions.Add((a, f));
        }
        regions = regions.Where(r => r.B - r.A >= 6).ToList();
        // Pitch: YIN on a copy at about 12 kHz (fast and enough for voices from 60 to 800 Hz).
        var down = Math.Max(1, sr / 12000); var dsr = sr / down;
        var small = new float[x.Length / down];
        for (var i = 0; i < small.Length; i++) { float s = 0; for (var j = 0; j < down; j++) s += x[i * down + j]; small[i] = s / down; }
        int minLag = dsr / 800, maxLag = dsr / 60, w = maxLag;
        var pitch = new float[frames];
        var d = new double[maxLag + 1];
        foreach (var (ra, rb) in regions)
            for (var f = ra; f < rb; f++)
            {
                var start = (f * hop) / down - w / 2;
                if (start < 0 || start + w + maxLag >= small.Length) continue;
                for (var tau = 1; tau <= maxLag; tau++)
                {
                    double s = 0;
                    for (var j = 0; j < w; j++) { var diff = small[start + j] - small[start + j + tau]; s += diff * diff; }
                    d[tau] = s;
                }
                double run = 0; var best = -1; var bestV = 1.0;
                for (var tau = 1; tau <= maxLag; tau++)
                {
                    run += d[tau];
                    var v = d[tau] * tau / Math.Max(1e-12, run);
                    if (tau < minLag) continue;
                    if (v < 0.15) { while (tau + 1 <= maxLag && d[tau + 1] * (tau + 1) / Math.Max(1e-12, run + d[tau + 1]) < v) { tau++; run += d[tau]; v = d[tau] * tau / Math.Max(1e-12, run); } best = tau; bestV = v; break; }
                    if (v < bestV) { bestV = v; best = tau; }
                }
                if (best > 0 && bestV < 0.3) pitch[f] = (float)((double)dsr / best);
            }
        // Single odd frames (an octave slip) are smoothed out with a median of three.
        var pm = (float[])pitch.Clone();
        for (var f = 1; f + 1 < frames; f++)
            if (pitch[f] > 0 && pitch[f - 1] > 0 && pitch[f + 1] > 0) pm[f] = new[] { pitch[f - 1], pitch[f], pitch[f + 1] }.OrderBy(v => v).ElementAt(1);
        var voiced = pm.Where(v => v > 0).OrderBy(v => v).ToList();
        var median = voiced.Count > 0 ? voiced[voiced.Count / 2] : 0;
        // Syllables: peaks of the smoothed loudness at least 80 ms apart, each standing 2.5 dB above the dip before it.
        var sm = new float[frames];
        for (var f = 0; f < frames; f++) { double s = 0; var n = 0; for (var k = Math.Max(0, f - 2); k <= Math.Min(frames - 1, f + 2); k++) { s += db[k]; n++; } sm[f] = (float)(s / n); }
        var syllables = new List<FoundSyllable>();
        foreach (var (ra, rb) in regions)
        {
            var peaks = new List<int>();
            for (var f = ra + 1; f < rb - 1; f++)
                if (sm[f] >= sm[f - 1] && sm[f] > sm[f + 1] && sm[f] > threshold + 3)
                {
                    if (peaks.Count > 0)
                    {
                        var dip = Enumerable.Range(peaks[^1], f - peaks[^1] + 1).Min(k => sm[k]);
                        if (f - peaks[^1] < 8 || Math.Min(sm[f], sm[peaks[^1]]) - dip < 2.5) { if (sm[f] > sm[peaks[^1]]) peaks[^1] = f; continue; }
                    }
                    peaks.Add(f);
                }
            if (peaks.Count == 0) peaks.Add(Enumerable.Range(ra, rb - ra).OrderByDescending(k => sm[k]).First());
            for (var k = 0; k < peaks.Count; k++)
            {
                var a = k == 0 ? ra : Enumerable.Range(peaks[k - 1], peaks[k] - peaks[k - 1] + 1).OrderBy(j => sm[j]).First();
                var b = k == peaks.Count - 1 ? rb : Enumerable.Range(peaks[k], peaks[k + 1] - peaks[k] + 1).OrderBy(j => sm[j]).First();
                syllables.Add(new FoundSyllable(a * Analysis.Hop, peaks[k] * Analysis.Hop, b * Analysis.Hop, sm[peaks[k]]));
            }
        }
        return new Analysis
        {
            Pitch = pm, Db = db, Speech = regions.Select(r => (r.A * Analysis.Hop, r.B * Analysis.Hop)).ToList(), Syllables = syllables,
            MedianPitch = median, LoudestDb = loudest, Seconds = (double)x.Length / sr,
        };
    }

    // ---------------------------------------------------------------- keeping the words: the voice changed

    /// <summary>
    /// The recording with its voice changed (TD-PSOLA): one grain per pitch period, put back at the new pitch's spacing
    /// (pitch moves, the mouth doesn't) and read faster or slower (the mouth moves: body size). Rasp shakes the
    /// spacing and level, creature makes every other period weaker and longer (an undertone), robot holds one pitch,
    /// breath adds air where it speaks. Timing stays exactly as recorded.
    /// </summary>
    internal static float[] Transform(float[] x, Analysis an, int sr, double pitchFactor, double formant, double rasp, double creature, double breath, bool robot, double robotHz, SoundRng rng)
    {
        var n = x.Length;
        var hop = (int)(sr * Analysis.Hop);
        double F0At(int i) { var f = i / hop; return f < an.Pitch.Length ? an.Pitch[f] : 0; }
        // Pitch marks: one per period on the voiced parts (at the strongest sample of each period), every 5 ms elsewhere.
        var marks = new List<int>();
        var at = 0;
        while (at < n)
        {
            var f0 = F0At(at);
            var period = f0 > 0 ? (int)(sr / f0) : sr / 200;
            var best = at; var bestV = -1f;
            for (var i = at; i < Math.Min(n, at + period); i++) { var v = Math.Abs(x[i]); if (v > bestV) { bestV = v; best = i; } }
            if (f0 <= 0) best = at;
            if (marks.Count == 0 || best - marks[^1] >= period / 2) marks.Add(best);
            at = (marks.Count > 0 ? marks[^1] : at) + Math.Max(period * 3 / 4, 8);
            if (at <= best) at = best + 8;
        }
        if (marks.Count < 2) return (float[])x.Clone();
        var outp = new double[n]; var weight = new double[n];
        double t = marks[0];
        var k = 0; var count = 0;
        while (t < n)
        {
            while (k + 1 < marks.Count && Math.Abs(marks[k + 1] - t) < Math.Abs(marks[k] - t)) k++;
            var m = marks[k];
            var ps = k + 1 < marks.Count ? marks[k + 1] - m : m - marks[k - 1];
            var voiced = F0At(m) > 0;
            double pOut = voiced ? (robot && robotHz > 0 ? sr / robotHz : ps / pitchFactor) : ps;
            var amp = 1.0;
            if (voiced)
            {
                if (rasp > 0) { pOut *= 1 + (rng.NextDouble() - 0.5) * rasp * 0.16; amp *= 1 - rng.NextDouble() * rasp * 0.5; }
                if (creature > 0 && (count & 1) == 1) { amp *= 1 - 0.7 * creature; pOut *= 1 + 0.25 * creature; }
            }
            var h = (int)Math.Max(ps, pOut);
            var center = (int)t;
            for (var j = -h; j <= h; j++)
            {
                var o = center + j;
                if (o < 0 || o >= n) continue;
                var src = m + j * formant;
                var si = (int)Math.Floor(src);
                if (si < 0 || si + 1 >= n) continue;
                var fr = src - si;
                var wv = 0.5 + 0.5 * Math.Cos(Math.PI * j / (h + 1));
                outp[o] += (x[si] * (1 - fr) + x[si + 1] * fr) * wv * amp;
                weight[o] += wv;
            }
            t += Math.Max(8, pOut);
            count++;
        }
        var y = new float[n];
        for (var i = 0; i < n; i++) y[i] = (float)(outp[i] / Math.Max(weight[i], 0.5));
        // Breath: air (high, soft noise) that follows how loud it is where it speaks.
        if (breath > 0.01)
        {
            double lp = 0, env = 0;
            var kEnv = 1 - Math.Exp(-1 / (0.02 * sr));
            for (var i = 0; i < n; i++)
            {
                var noise = rng.Bipolar();
                lp += (noise - lp) * 0.15; // what is left after taking this off is the high part
                env += (Math.Abs(y[i]) - env) * kEnv;
                y[i] += (float)((noise - lp) * env * breath * 0.25);
            }
        }
        return y;
    }

    // ---------------------------------------------------------------- invented words, its acting

    /// <summary>
    /// A plan of invented words in the layer's language, said with the recording's timing (each syllable where the
    /// recording has one), its pauses, its loudness and (as much as FollowPitch says) its melody.
    /// </summary>
    private static Plan PlanFromRecording(SoundLayer l, Analysis an, SoundRng rng)
    {
        var plan = new Plan();
        var nextWord = WordPicker(l, rng);
        var queue = new Queue<(Syl S, bool First)>();
        (Syl S, bool First) Next()
        {
            if (queue.Count == 0) { var w = nextWord(); for (var i = 0; i < w.Count; i++) queue.Enqueue((w[i], i == 0)); plan.Words.Add(string.Concat(w.Select(y => string.Concat(y.Onset) + y.Vowel + string.Concat(y.Coda)))); }
            return queue.Dequeue();
        }
        var range = l.VoiceRange;
        var accents = new List<(double T, double Amount)>();
        foreach (var syl in an.Syllables)
        {
            if (plan.Time < syl.Start - 0.005) AddPause(plan, syl.Start - plan.Time, l.Delivery != "robotic" && syl.Start - plan.Time > 0.45);
            var (s, first) = Next();
            if (first) accents.Add((syl.Peak, 1));
            var span = Math.Max(0.06, syl.End - Math.Max(plan.Time, syl.Start));
            var consonants = s.Onset.Length + s.Coda.Length;
            var cons = consonants == 0 ? 0 : Math.Min(0.07, span * 0.4 / consonants);
            var amp = Math.Clamp(Math.Pow(10, (syl.PeakDb - an.LoudestDb) / 20 * 0.8), 0.15, 1.2);
            var i0 = plan.Segs.Count; var t0 = plan.Time;
            AddSyllable(plan, s, Math.Max(0.04, span - consonants * cons), cons, amp, false);
            // Fit it exactly into the recording's syllable.
            var k = span / Math.Max(1e-4, plan.Time - t0);
            var tt = t0;
            for (var i = i0; i < plan.Segs.Count; i++) { plan.Segs[i].T0 = tt; plan.Segs[i].Dur *= k; tt += plan.Segs[i].Dur; }
            plan.Time = tt;
        }
        plan.Time = Math.Max(plan.Time, an.Seconds);
        // The melody: the recording's own (in semitones from its middle), blended with the voice's own phrase shape.
        var follow = Math.Clamp(l.FollowPitch, 0, 1);
        double Own(double t)
        {
            var region = an.Speech.FirstOrDefault(r => t >= r.Start && t <= r.End);
            var x = region.End > region.Start ? (t - region.Start) / (region.End - region.Start) : 0;
            var st = range * 0.25 - range * 0.5 * x;
            foreach (var (at, a) in accents) st += a * range * 0.4 * Math.Exp(-Math.Pow((t - at) / 0.06, 2));
            return st;
        }
        for (var f = 0; f < an.Pitch.Length; f += 2)
        {
            var t = f * Analysis.Hop;
            if (!an.Speech.Any(r => t >= r.Start && t <= r.End)) continue;
            var rec = an.Pitch[f] > 0 && an.MedianPitch > 0 ? 12 * Math.Log2(an.Pitch[f] / an.MedianPitch) : double.NaN;
            if (double.IsNaN(rec)) { if (follow < 1) plan.Point(Own(t), t); continue; }
            plan.Point(follow * rec + (1 - follow) * Own(t), t);
        }
        return plan;
    }

    /// <summary>
    /// A voice layer with a recording: its own words with the voice changed (KeepWords 1), invented words with its acting
    /// (0), or a mix by words (each group of syllables one or the other, joined across the quiet between syllables).
    /// </summary>
    public static float[] RenderRecording(SoundLayer l, SampleAudio audio, SoundRng rng, int sr)
    {
        var x = Mono(audio, l.TrimStart, l.TrimEnd, sr);
        if (x.Length < sr / 20) return [];
        var an = Analyze(x, sr);
        if (an.Speech.Count == 0) return x;
        var change = 1 - Math.Clamp(l.KeepVoice, 0, 1);
        var robot = l.Delivery == "robotic";
        var keep = Math.Clamp(l.KeepWords, 0, 1);
        float[]? own = null, made = null;
        if (keep > 0)
        {
            var pitchFactor = an.MedianPitch > 0 ? Math.Pow(l.Pitch / an.MedianPitch, change) : 1;
            var formant = Math.Pow(1 / Math.Clamp(l.VoiceSize, 0.4, 2.5), change);
            own = Transform(x, an, sr, pitchFactor, formant, l.Rasp * change, l.Creature * change, l.Breath * change * 0.5, robot, robot ? l.Pitch : 0, rng);
        }
        if (keep < 1)
        {
            var plan = PlanFromRecording(l, an, rng);
            var feel = Feeling(l);
            made = Synthesize(l, plan, feel, rng, sr);
            Array.Resize(ref made, x.Length);
        }
        if (own == null) return made!;
        if (made == null) return own;
        // Even levels: the invented part as loud as the recording where it speaks.
        static double Rms(float[] a, Analysis an, int sr)
        {
            double s = 0; long c = 0;
            foreach (var (a0, b0) in an.Speech) for (var i = (int)(a0 * sr); i < Math.Min(a.Length, (int)(b0 * sr)); i++) { s += (double)a[i] * a[i]; c++; }
            return Math.Sqrt(s / Math.Max(1, c));
        }
        var g = (float)(Rms(own, an, sr) / Math.Max(1e-6, Rms(made, an, sr)));
        // Which syllables keep their own words: by groups of one to three (about a word), as many as KeepWords says.
        var mask = new float[x.Length];
        var keepGroup = false;
        var left = 0;
        var target = new float[an.Syllables.Count];
        for (var i = 0; i < an.Syllables.Count; i++)
        {
            if (left == 0) { left = 1 + (int)(rng.NextDouble() * 3); keepGroup = rng.NextDouble() < keep; }
            target[i] = keepGroup ? 1 : 0; left--;
        }
        for (var i = 0; i < an.Syllables.Count; i++)
        {
            var from = i == 0 ? 0 : (int)(an.Syllables[i].Start * sr);
            var to = i == an.Syllables.Count - 1 ? x.Length : (int)(an.Syllables[i + 1].Start * sr);
            for (var j = Math.Max(0, from); j < Math.Min(x.Length, to); j++) mask[j] = target[i];
        }
        // Soft joins (15 ms) so a change from one to the other doesn't click.
        var kS = 1 - Math.Exp(-1 / (0.005 * sr));
        double m = mask.Length > 0 ? mask[0] : 0;
        var o = new float[x.Length];
        for (var i = 0; i < x.Length; i++) { m += (mask[i] - m) * kS; o[i] = (float)(own[i] * m + made[i] * g * (1 - m)); }
        return o;
    }
}
