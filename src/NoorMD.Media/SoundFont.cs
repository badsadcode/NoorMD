using System.Text;

namespace NoorMD.Media;

/// <summary>
/// A SoundFont 2 (.sf2): recorded instruments, each a preset (bank, program) whose zones say which sample plays for
/// which keys and velocities, tuned, looped and shaped by its envelope. NoorSequencer plays its presets as an
/// instrument (as LMMS's SF2 player). Read once, kept in memory as 16-bit samples; nothing in it is ever run.
/// </summary>
public sealed class SoundFont
{
    public sealed record Preset(int Index, string Name, int Bank, int Program);

    /// <summary>What one zone of a preset plays: a stretch of the sample pool and how.</summary>
    public sealed record Zone(int KeyLo, int KeyHi, int VelLo, int VelHi, int Start, int End, int LoopStart, int LoopEnd, int SampleRate,
        int RootKey, double TuneCents, double KeyScale, int LoopMode, double AttenuationDb, double Pan,
        double Delay, double Attack, double Hold, double Decay, double SustainLevel, double Release);

    public string Name { get; private set; } = "SoundFont";
    public List<Preset> Presets { get; } = [];
    /// <summary>All the font's samples, one after another (mono, 16-bit).</summary>
    public short[] Pool { get; private set; } = [];
    private readonly List<List<Zone>> _zones = [];

    public const long MaxBytes = 512L * 1024 * 1024;

    /// <summary>The zones of a preset that sound for this key and velocity (stereo pairs give two).</summary>
    public IEnumerable<Zone> ZonesFor(int preset, int key, int velocity)
    {
        if (preset < 0 || preset >= _zones.Count) yield break;
        foreach (var z in _zones[preset])
            if (key >= z.KeyLo && key <= z.KeyHi && velocity >= z.VelLo && velocity <= z.VelHi) yield return z;
    }

    // ------------------------------------------------------------------ reading

    private sealed class Gen
    {
        public readonly Dictionary<int, short> Values = [];
        public (int Lo, int Hi) Key = (0, 127), Vel = (0, 127);
        public int? Link; // instrument (preset zone) or sample (instrument zone)
    }

    private sealed record SampleHeader(string Name, int Start, int End, int LoopStart, int LoopEnd, int Rate, int Pitch, int Correction, int Type);

    // Generator numbers (SoundFont 2.04, section 8.1.2).
    private const int StartOffset = 0, EndOffset = 1, LoopStartOffset = 2, LoopEndOffset = 3, StartCoarse = 4, EndCoarse = 12,
        Pan = 17, DelayVol = 33, AttackVol = 34, HoldVol = 35, DecayVol = 36, SustainVol = 37, ReleaseVol = 38, Instrument = 41,
        KeyRange = 43, VelRange = 44, LoopStartCoarse = 45, Attenuation = 48, LoopEndCoarse = 50, CoarseTune = 51, FineTune = 52,
        SampleId = 53, SampleModes = 54, ScaleTuning = 56, RootKeyOverride = 58;

    public static SoundFont Read(byte[] data)
    {
        if (data.Length < 12 || Encoding.ASCII.GetString(data, 0, 4) != "RIFF" || Encoding.ASCII.GetString(data, 8, 4) != "sfbk")
            throw new InvalidDataException("That isn't a SoundFont (.sf2) file.");
        var f = new SoundFont();
        var chunks = new Dictionary<string, (int At, int Size)>();
        Walk(data, 12, Math.Min(data.Length, 8 + (int)Math.Min(int.MaxValue - 8, U32(data, 4))), chunks);
        if (chunks.TryGetValue("INAM", out var nam)) f.Name = Text(data, nam.At, nam.Size) is { Length: > 0 } n ? n : f.Name;
        if (!chunks.TryGetValue("smpl", out var smpl)) throw new InvalidDataException("The SoundFont has no samples.");
        f.Pool = new short[smpl.Size / 2];
        Buffer.BlockCopy(data, smpl.At, f.Pool, 0, f.Pool.Length * 2);
        if (!BitConverter.IsLittleEndian) for (var i = 0; i < f.Pool.Length; i++) f.Pool[i] = (short)((ushort)f.Pool[i] >> 8 | (ushort)f.Pool[i] << 8);
        foreach (var need in new[] { "phdr", "pbag", "pgen", "inst", "ibag", "igen", "shdr" })
            if (!chunks.ContainsKey(need)) throw new InvalidDataException($"The SoundFont is incomplete (no {need}).");

        var samples = Records(data, chunks["shdr"], 46, (d, a) => new SampleHeader(Text(d, a, 20), (int)U32(d, a + 20), (int)U32(d, a + 24), (int)U32(d, a + 28), (int)U32(d, a + 32), (int)U32(d, a + 36), d[a + 40], (sbyte)d[a + 41], U16(d, a + 44)));
        var instZones = Zones(data, chunks["inst"], 22, chunks["ibag"], chunks["igen"], SampleId);
        var presetZones = Zones(data, chunks["phdr"], 38, chunks["pbag"], chunks["pgen"], Instrument);
        var phdr = Records(data, chunks["phdr"], 38, (d, a) => (Name: Text(d, a, 20), Program: (int)U16(d, a + 20), Bank: (int)U16(d, a + 22)));
        // The last record of each list is the terminal one ("EOP", "EOI", "EOS").
        for (var p = 0; p + 1 < phdr.Count && p < presetZones.Count; p++)
        {
            var zones = new List<Zone>();
            var (pGlobal, pList) = presetZones[p];
            foreach (var pz in pList)
            {
                if (pz.Link is not int inst || inst >= instZones.Count) continue;
                var (iGlobal, iList) = instZones[inst];
                foreach (var iz in iList)
                {
                    if (iz.Link is not int sid || sid >= samples.Count - 1) continue;
                    var key = (Math.Max(pz.Key.Lo, iz.Key.Lo), Math.Min(pz.Key.Hi, iz.Key.Hi));
                    var vel = (Math.Max(pz.Vel.Lo, iz.Vel.Lo), Math.Min(pz.Vel.Hi, iz.Vel.Hi));
                    if (key.Item1 > key.Item2 || vel.Item1 > vel.Item2) continue;
                    var z = MakeZone(samples[sid], iGlobal, iz, pGlobal, pz, key, vel, f.Pool.Length);
                    if (z != null) zones.Add(z);
                }
            }
            f._zones.Add(zones);
            f.Presets.Add(new Preset(f.Presets.Count, phdr[p].Name, phdr[p].Bank, phdr[p].Program));
        }
        return f;
    }

    private static Zone? MakeZone(SampleHeader s, Gen? iGlobal, Gen iz, Gen? pGlobal, Gen pz, (int, int) key, (int, int) vel, int poolLength)
    {
        // Instrument generators: the zone's own, else the instrument's global zone, else the default.
        int I(int g, int def) => iz.Values.TryGetValue(g, out var v) ? v : iGlobal != null && iGlobal.Values.TryGetValue(g, out var gv) ? gv : def;
        // Preset generators are added to them (only some may be: tuning, level, place, envelope times).
        int P(int g) => pz.Values.TryGetValue(g, out var v) ? v : pGlobal != null && pGlobal.Values.TryGetValue(g, out var gv) ? gv : 0;
        int Both(int g, int def) => I(g, def) + P(g);
        var start = s.Start + I(StartOffset, 0) + 32768 * I(StartCoarse, 0);
        var end = s.End + I(EndOffset, 0) + 32768 * I(EndCoarse, 0);
        var loopStart = s.LoopStart + I(LoopStartOffset, 0) + 32768 * I(LoopStartCoarse, 0);
        var loopEnd = s.LoopEnd + I(LoopEndOffset, 0) + 32768 * I(LoopEndCoarse, 0);
        start = Math.Clamp(start, 0, poolLength - 1); end = Math.Clamp(end, start + 1, poolLength);
        loopStart = Math.Clamp(loopStart, start, end - 1); loopEnd = Math.Clamp(loopEnd, loopStart + 1, end);
        if (s.Rate is < 400 or > 400_000) return null;
        var root = I(RootKeyOverride, -1) is var o and >= 0 and <= 127 ? o : s.Pitch is >= 0 and <= 127 ? s.Pitch : 60;
        var tune = Both(CoarseTune, 0) * 100 + Both(FineTune, 0) + s.Correction;
        // Scale tuning: 100 cents a key (0: every key the same pitch, as drum kits are).
        var scale = Math.Clamp(I(ScaleTuning, 100), 0, 1200) / 100.0;
        double Sec(int g, int def) => Math.Clamp(Math.Pow(2, Both(g, def) / 1200.0), 0.001, 20);
        return new Zone(key.Item1, key.Item2, vel.Item1, vel.Item2, start, end, loopStart, loopEnd, s.Rate, root, tune, scale,
            I(SampleModes, 0) & 3, Math.Clamp(Both(Attenuation, 0), 0, 1440) / 10.0, Math.Clamp(Both(Pan, s.Type == 2 ? 500 : s.Type == 4 ? -500 : 0), -500, 500) / 500.0,
            Both(DelayVol, -12000) <= -12000 ? 0 : Sec(DelayVol, -12000), Sec(AttackVol, -12000), Both(HoldVol, -12000) <= -12000 ? 0 : Sec(HoldVol, -12000),
            Sec(DecayVol, -12000), Math.Pow(10, -Math.Clamp(Both(SustainVol, 0), 0, 1440) / 200.0), Sec(ReleaseVol, -12000));
    }

    /// <summary>Each preset's (or instrument's) zones: its global zone (if the first has no link) and the others.</summary>
    private static List<(Gen? Global, List<Gen> Zones)> Zones(byte[] d, (int At, int Size) headers, int headerSize, (int At, int Size) bags, (int At, int Size) gens, int linkGen)
    {
        var bagStarts = Records(d, headers, headerSize, (b, a) => (int)U16(b, a + headerSize - (headerSize == 38 ? 14 : 2)));
        var bagGen = Records(d, bags, 4, (b, a) => (int)U16(b, a));
        var genList = Records(d, gens, 4, (b, a) => (Oper: (int)U16(b, a), Lo: b[a + 2], Hi: b[a + 3], Amount: (short)U16(b, a + 2)));
        var result = new List<(Gen?, List<Gen>)>();
        for (var h = 0; h + 1 < bagStarts.Count; h++)
        {
            var list = new List<Gen>();
            Gen? global = null;
            for (var bag = bagStarts[h]; bag < bagStarts[h + 1] && bag + 1 < bagGen.Count; bag++)
            {
                var g = new Gen();
                for (var k = bagGen[bag]; k < bagGen[bag + 1] && k < genList.Count; k++)
                {
                    var (oper, lo, hi, amount) = genList[k];
                    if (oper == KeyRange) g.Key = (lo, hi);
                    else if (oper == VelRange) g.Vel = (lo, hi);
                    else if (oper == linkGen) g.Link = (ushort)amount;
                    else g.Values[oper] = amount;
                }
                if (g.Link == null) { if (list.Count == 0 && global == null) global = g; }
                else list.Add(g);
            }
            result.Add((global, list));
        }
        return result;
    }

    private static List<T> Records<T>(byte[] d, (int At, int Size) chunk, int size, Func<byte[], int, T> read)
    {
        var list = new List<T>(chunk.Size / size);
        for (var a = chunk.At; a + size <= chunk.At + chunk.Size; a += size) list.Add(read(d, a));
        return list;
    }

    private static void Walk(byte[] d, int from, int to, Dictionary<string, (int, int)> chunks)
    {
        for (var at = from; at + 8 <= to;)
        {
            var id = Encoding.ASCII.GetString(d, at, 4);
            var size = (int)Math.Min(U32(d, at + 4), (uint)(to - at - 8));
            if (id == "LIST" && size >= 4) Walk(d, at + 12, at + 8 + size, chunks);
            else chunks.TryAdd(id, (at + 8, size));
            at += 8 + size + (size & 1);
        }
    }

    private static uint U32(byte[] d, int a) => (uint)(d[a] | d[a + 1] << 8 | d[a + 2] << 16 | d[a + 3] << 24);
    private static int U16(byte[] d, int a) => d[a] | d[a + 1] << 8;
    private static string Text(byte[] d, int a, int n) { var s = Encoding.ASCII.GetString(d, a, n); var z = s.IndexOf('\0'); return (z >= 0 ? s[..z] : s).Trim(); }

    // ------------------------------------------------------------------ playing

    /// <summary>
    /// One note of a preset into a buffer: each zone for the key and velocity at its pitch and place, looped while held
    /// if it loops, shaped by its envelope (delay, attack, hold, decay to sustain, release).
    /// </summary>
    internal void Play(Action<int, double, double> add, int preset, int key, double velocity, double held, int sr, Func<double, double>? bend = null)
    {
        var vel = Math.Clamp((int)Math.Round(velocity * 127), 1, 127);
        foreach (var z in ZonesFor(preset, key, vel))
        {
            var rate = Math.Pow(2, (key - z.RootKey) * z.KeyScale / 12.0 + z.TuneCents / 1200) * z.SampleRate / sr;
            var gain = Math.Pow(10, -z.AttenuationDb / 20) * velocity * velocity * 0.9;
            var angle = (z.Pan + 1) * Math.PI / 4;
            double gl = Math.Cos(angle) * Math.Sqrt(2) * gain, gr = Math.Sin(angle) * Math.Sqrt(2) * gain;
            var loops = z.LoopMode is 1 or 3;
            var total = (int)((held + z.Release) * sr) + 1;
            if (!loops) total = Math.Min(total, (int)((z.End - z.Start) / rate) + 1);
            var pos = (double)z.Start;
            int loopLen = z.LoopEnd - z.LoopStart;
            for (var n = 0; n < total; n++)
            {
                var t = (double)n / sr;
                var env = Envelope(z, t, held);
                if (env <= 0 && t > held) break;
                // Mode 3 plays on past the loop after the key is let go.
                if (loops && (z.LoopMode == 1 || t < held)) { while (pos >= z.LoopEnd) pos -= loopLen; }
                else if (pos >= z.End - 1) break;
                var k = (int)pos; var f = pos - k;
                var s = (Pool[k] + (Pool[Math.Min(k + 1, z.End - 1)] - Pool[k]) * f) / 32768.0;
                add(n, s * env * gl, s * env * gr);
                pos += bend == null ? rate : rate * Math.Pow(2, bend(t) / 12);
            }
        }
    }

    private static double Envelope(Zone z, double t, double held)
    {
        double Level(double x)
        {
            x -= z.Delay;
            if (x < 0) return 0;
            if (x < z.Attack) return x / z.Attack;
            x -= z.Attack;
            if (x < z.Hold) return 1;
            x -= z.Hold;
            // Decay is to the sustain level in decibels: an exponential fall.
            return x < z.Decay ? Math.Pow(z.SustainLevel, x / z.Decay) : z.SustainLevel;
        }
        if (t < held) return Level(t);
        var r = t - held;
        return r >= z.Release ? 0 : Level(held) * Math.Pow(0.001, r / z.Release);
    }
}
