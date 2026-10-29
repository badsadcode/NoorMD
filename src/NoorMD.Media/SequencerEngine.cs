using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media;

// NoorSequencer: a friendly composer. A song is tracks × bars: each track has numbered patterns (one bar of notes
// each) and the song says which pattern each track plays in each bar (0 = rest), as in BeepBox. The app renders the
// song (the same code for listening and exporting); noise is seeded, so a song always renders the same.

/// <summary>A note in a pattern: when (in steps of a sixteenth), how long, which pitch (MIDI; drums: the kit row), how hard.</summary>
public sealed class SongNote
{
    public int Step { get; set; }
    public int Length { get; set; } = 1;
    public int Pitch { get; set; } = 60;
    public double Velocity { get; set; } = 0.8;
    /// <summary>Left (−1) to right (1), on top of the track's place.</summary>
    public double Pan { get; set; }
    /// <summary>Glides into the next note (no new attack), as a 303 bass line does.</summary>
    public bool Slide { get; set; }
    /// <summary>Played harder: louder, and the filter opens further and snaps back quicker (a 303's accent).</summary>
    public bool Accent { get; set; }
}

/// <summary>
/// A note as it is played: from the song's start, in sixteenths. <paramref name="Slides"/>: where (sixteenths from
/// the note's start) it glides, and to how many semitones from its own pitch; or null.
/// </summary>
public readonly record struct PlayedNote(double Step, double Length, int Pitch, double Velocity, double Pan = 0, IReadOnlyList<(double At, int To)>? Slides = null, bool Accent = false);

/// <summary>One bar of notes.</summary>
public sealed class SongPattern
{
    public List<SongNote> Notes { get; set; } = [];
}

/// <summary>How a track sounds. Only the fields of its kind are used.</summary>
public sealed class SongInstrument
{
    public static readonly string[] Waves = ["sine", "triangle", "square", "pulse", "saw", "noise", "kick", "drawn"];
    public const int TableSize = 64;

    // synth
    public string Wave { get; set; } = "triangle";
    /// <summary>Pulse: how wide (0.05–0.5; 0.5 is a square).</summary>
    public double PulseWidth { get; set; } = 0.25;
    /// <summary>A second voice detuned by this many cents (0 = one voice).</summary>
    public double Detune { get; set; } = 6;
    public int Octave { get; set; }
    // envelope (seconds; sustain 0–1); synth and sample
    public double Attack { get; set; } = 0.005;
    public double Decay { get; set; } = 0.2;
    public double Sustain { get; set; } = 0.6;
    public double Release { get; set; } = 0.2;
    /// <summary>Low-pass filter: cutoff (Hz), resonance (0.5–10) and how many octaves the envelope opens it.</summary>
    public double Cutoff { get; set; } = 8000;
    public double Resonance { get; set; } = 0.7;
    public double FilterEnvelope { get; set; }
    /// <summary>The filter's own envelope: how long it takes to close (seconds; 0 = it follows the volume envelope). A 303 sound.</summary>
    public double FilterDecay { get; set; }
    // kick (a drum synth, as LMMS's Kicker): a sine falling from Start to End Hz (for C3; other notes tune it), with punch
    public double KickStart { get; set; } = 160;
    public double KickEnd { get; set; } = 45;
    /// <summary>How quickly the pitch falls (seconds).</summary>
    public double KickSweep { get; set; } = 0.06;
    /// <summary>0–1: warmth to crunch (soft clipping).</summary>
    public double KickDrive { get; set; } = 0.2;
    /// <summary>0–1: the click of the beater at the start.</summary>
    public double KickClick { get; set; } = 0.3;
    /// <summary>0–1: noise mixed in (a snappier, dirtier hit).</summary>
    public double KickNoise { get; set; }
    // drawn (as LMMS's BitInvader): one cycle of the wave, drawn with the mouse, −1…1
    public List<double> Table { get; set; } = [];
    /// <summary>Between the drawn points a smooth curve (or steps, for a gritty 8-bit sound).</summary>
    public bool TableSmooth { get; set; } = true;
    /// <summary>Vibrato depth (cents) and speed (Hz).</summary>
    public double Vibrato { get; set; }
    public double VibratoRate { get; set; } = 5;
    // drums: the whole kit tuned (semitones), its decays stretched, and how bright it is (0–1)
    public double DrumTune { get; set; }
    public double DrumDecay { get; set; } = 1;
    public double DrumTone { get; set; } = 0.5;
    // sample: a WAV you picked, which pitch it is (MIDI), and whether it loops while the note is held
    public string? Path { get; set; }
    public string? SampleName { get; set; }
    public int RootNote { get; set; } = 60;
    public bool Loop { get; set; }
    // sf2: a SoundFont you picked (Path, SampleName) and which of its presets plays (its index in the font), with its
    // General MIDI program number for MIDI export
    public int FontPreset { get; set; }
    public int FontProgram { get; set; }

    // stage 2: arpeggiator (synth and sample): notes held together are played one after another
    public static readonly string[] ArpModes = ["off", "up", "down", "updown", "random", "chord"];
    /// <summary>"off", "up", "down", "updown" (up then down), "random", or "chord" (the chord struck again and again).</summary>
    public string Arp { get; set; } = "off";
    /// <summary>Steps (sixteenths) per arpeggio note: 1, 2 or 4.</summary>
    public int ArpRate { get; set; } = 2;
    /// <summary>How many octaves the arpeggio climbs (1–3).</summary>
    public int ArpOctaves { get; set; } = 1;
    // stage 2: an LFO (synth): "off", "pitch" (± semitones), "filter" (± octaves) or "volume" (tremolo)
    public static readonly string[] LfoTargets = ["off", "pitch", "filter", "volume"];
    public string Lfo { get; set; } = "off";
    public double LfoRate { get; set; } = 4;
    /// <summary>0–1: pitch up to ±2 semitones, filter up to ±3 octaves, volume fully down.</summary>
    public double LfoDepth { get; set; } = 0.3;
    // stage 2: FM (synth, sine wave): a modulator at this ratio of the note's pitch, this deep (bells, electric piano)
    public double FmRatio { get; set; } = 2;
    public double FmDepth { get; set; }
}

/// <summary>
/// A send bus of the mixer (as LMMS's FX channels): tracks send some of their sound to it, it runs its own effects
/// (a shared reverb or echo, usually all wet) and joins the mix at its level.
/// </summary>
public sealed class SongBus
{
    public const int Max = 2;
    public string Id { get; set; } = "";
    public string Name { get; set; } = "Reverb";
    public double Gain { get; set; }
    public List<SoundEffect> Effects { get; set; } = [];
}

/// <summary>An adaptive-music layer (exploration, danger, combat…): the tracks that play in it, at the same tempo.</summary>
public sealed class SongLayer
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "Layer";
}

/// <summary>A point of a track's automation: at this place in the song (in bars, fractional), this value.</summary>
public sealed class SongPoint
{
    public double Bar { get; set; }
    public double Value { get; set; }
}

public sealed class SongTrack
{
    public static readonly string[] Kinds = ["synth", "drums", "sample", "sf2"];
    public const int MaxPatterns = 32;

    public string Id { get; set; } = "";
    public string Name { get; set; } = "Track";
    public string Kind { get; set; } = "synth";
    public SongInstrument Instrument { get; set; } = new();
    public double Gain { get; set; } = -6;
    /// <summary>−1 (left) … 1 (right).</summary>
    public double Pan { get; set; }
    public bool Mute { get; set; }
    public bool Solo { get; set; }
    public List<SoundEffect> Effects { get; set; } = [];
    /// <summary>Pattern 1 is Patterns[0].</summary>
    public List<SongPattern> Patterns { get; set; } = [];
    /// <summary>For each bar, the pattern played (0 = nothing).</summary>
    public List<int> Sequence { get; set; } = [];
    /// <summary>0–1: notes a little early or late and a little softer or harder, as a person plays (seeded).</summary>
    public double Humanize { get; set; }
    /// <summary>The adaptive layers (ids) the track plays in; empty = all of them (and the whole song).</summary>
    public List<string> InLayers { get; set; } = [];
    /// <summary>Level over the song (dB added; empty = none), between points a straight line.</summary>
    public List<SongPoint> GainAutomation { get; set; } = [];
    /// <summary>Synth filter over the song (octaves added to the cutoff; empty = none).</summary>
    public List<SongPoint> FilterAutomation { get; set; } = [];
    /// <summary>How much goes to each send bus (bus id → 0–1, after the track's level and place).</summary>
    public Dictionary<string, double> Sends { get; set; } = [];
}

public sealed class SongRecipe
{
    public const int MaxTracks = 12, MaxBars = 128;
    public static readonly string[] KitRows = ["Kick", "Snare", "Clap", "Closed hat", "Open hat", "Low tom", "High tom", "Rim"];

    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Untitled song";
    public string Family { get; set; } = "Custom";
    public double Tempo { get; set; } = 110;
    public int BeatsPerBar { get; set; } = 4;
    /// <summary>The second sixteenth of each eighth comes later by this much of a step (0 = straight, 0.33 ≈ triplet feel).</summary>
    public double Swing { get; set; }
    /// <summary>The key's tonic (0 = C … 11 = B) and scale.</summary>
    public int Key { get; set; }
    public string Scale { get; set; } = "minor";
    public int Bars { get; set; } = 8;
    /// <summary>The loop: bars LoopStart (included) to LoopEnd (excluded).</summary>
    public int LoopStart { get; set; }
    public int LoopEnd { get; set; } = 8;
    public double MasterGain { get; set; }
    /// <summary>Effects on the whole mix (the Sound Bench's).</summary>
    public List<SoundEffect> MasterEffects { get; set; } = [];
    /// <summary>The mixer's send buses (up to two).</summary>
    public List<SongBus> Buses { get; set; } = [];
    public int Seed { get; set; } = 1;
    public List<SongTrack> Tracks { get; set; } = [];
    /// <summary>Adaptive layers (up to four), each a version of the song with some of its tracks (empty = none).</summary>
    public List<SongLayer> Layers { get; set; } = [];
    public const int MaxLayers = 4;

    public int StepsPerBar => BeatsPerBar * 4;
    public double StepSeconds => 60.0 / Tempo / 4;
    public double BarSeconds => StepSeconds * StepsPerBar;

    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.Never };
    public string ToJson() => JsonSerializer.Serialize(this, Options);
    public static SongRecipe FromJson(string json) => (JsonSerializer.Deserialize<SongRecipe>(json, Options) ?? new SongRecipe()).Clamped();
    public SongRecipe Clone() => FromJson(ToJson());

    private static double C(double v, double lo, double hi) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : lo;

    /// <summary>A drawn wave of exactly <see cref="SongInstrument.TableSize"/> points in −1…1 (another length is resampled; none: a sine).</summary>
    private static List<double> FixTable(List<double>? t)
    {
        var n = SongInstrument.TableSize;
        if (t == null || t.Count < 2) return [.. Enumerable.Range(0, n).Select(k => Math.Round(Math.Sin(2 * Math.PI * k / n), 4))];
        var src = t.Take(4096).Select(v => C(v, -1, 1)).ToList();
        if (src.Count == n) return src;
        return [.. Enumerable.Range(0, n).Select(k => { var x = (double)k * src.Count / n; var a = (int)x; return src[a] + (src[(a + 1) % src.Count] - src[a]) * (x - a); })];
    }

    public SongRecipe Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Untitled song" : Name.Trim()[..Math.Min(Name.Trim().Length, 80)];
        Family = string.IsNullOrWhiteSpace(Family) ? "Custom" : Family.Trim()[..Math.Min(Family.Trim().Length, 40)];
        Tempo = C(Tempo, 30, 300); BeatsPerBar = Math.Clamp(BeatsPerBar, 2, 7); Swing = C(Swing, 0, 0.5);
        Key = ((Key % 12) + 12) % 12; Scale = SongScales.All.ContainsKey(Scale ?? "") ? Scale! : "minor";
        Bars = Math.Clamp(Bars, 1, MaxBars);
        LoopStart = Math.Clamp(LoopStart, 0, Bars - 1); LoopEnd = Math.Clamp(LoopEnd, LoopStart + 1, Bars);
        MasterGain = C(MasterGain, -24, 12);
        MasterEffects = (MasterEffects ?? []).Where(e => e != null).Take(SoundEffect.MaxPerChain).Select(e => e.Clamped()).ToList();
        Seed = Math.Clamp(Seed, 0, int.MaxValue);
        Tracks = (Tracks ?? []).Where(t => t != null).Take(MaxTracks).ToList();
        var layerIds = new HashSet<string>(StringComparer.Ordinal);
        Layers = (Layers ?? []).Where(l => l != null).Take(MaxLayers).ToList();
        foreach (var l in Layers)
        {
            l.Name = string.IsNullOrWhiteSpace(l.Name) ? "Layer" : l.Name.Trim()[..Math.Min(l.Name.Trim().Length, 40)];
            if (l.Id is not { Length: > 1 and <= 6 } || l.Id[0] != 'L' || !l.Id[1..].All(char.IsAsciiDigit) || !layerIds.Add(l.Id)) l.Id = "";
        }
        foreach (var l in Layers.Where(l => l.Id == "")) { var n = 1; while (!layerIds.Add("L" + n)) n++; l.Id = "L" + n; }
        var busIds = new HashSet<string>(StringComparer.Ordinal);
        Buses = (Buses ?? []).Where(b => b != null).Take(SongBus.Max).ToList();
        foreach (var b in Buses)
        {
            b.Name = string.IsNullOrWhiteSpace(b.Name) ? "Bus" : b.Name.Trim()[..Math.Min(b.Name.Trim().Length, 30)];
            b.Gain = C(b.Gain, -60, 12);
            b.Effects = (b.Effects ?? []).Where(e => e != null).Take(SoundEffect.MaxPerChain).Select(e => e.Clamped()).ToList();
            if (b.Id is not ("B1" or "B2") || !busIds.Add(b.Id)) b.Id = "";
        }
        foreach (var b in Buses.Where(b => b.Id == "")) { b.Id = busIds.Add("B1") ? "B1" : "B2"; busIds.Add(b.Id); }
        var used = new HashSet<string>(StringComparer.Ordinal);
        foreach (var t in Tracks)
        {
            t.Sends = (t.Sends ?? []).Where(kv => busIds.Contains(kv.Key) && double.IsFinite(kv.Value) && kv.Value > 0).ToDictionary(kv => kv.Key, kv => Math.Min(1, kv.Value));
            t.Kind = SongTrack.Kinds.Contains(t.Kind) ? t.Kind : "synth";
            t.Name = string.IsNullOrWhiteSpace(t.Name) ? "Track" : t.Name.Trim()[..Math.Min(t.Name.Trim().Length, 40)];
            t.Gain = C(t.Gain, -60, 12); t.Pan = C(t.Pan, -1, 1);
            var i = t.Instrument ??= new();
            i.Wave = SongInstrument.Waves.Contains(i.Wave) ? i.Wave : "triangle";
            i.PulseWidth = C(i.PulseWidth, 0.05, 0.5); i.Detune = C(i.Detune, 0, 50); i.Octave = Math.Clamp(i.Octave, -3, 3);
            i.Attack = C(i.Attack, 0.001, 5); i.Decay = C(i.Decay, 0.001, 5); i.Sustain = C(i.Sustain, 0, 1); i.Release = C(i.Release, 0.001, 8);
            i.Cutoff = C(i.Cutoff, 40, 20000); i.Resonance = C(i.Resonance, 0.5, 10); i.FilterEnvelope = C(i.FilterEnvelope, -4, 6);
            i.FilterDecay = double.IsFinite(i.FilterDecay) && i.FilterDecay > 0 ? Math.Clamp(i.FilterDecay, 0.01, 4) : 0;
            i.KickStart = C(i.KickStart, 30, 2000); i.KickEnd = C(i.KickEnd, 20, 1000); i.KickSweep = C(i.KickSweep, 0.005, 1);
            i.KickDrive = C(i.KickDrive, 0, 1); i.KickClick = C(i.KickClick, 0, 1); i.KickNoise = C(i.KickNoise, 0, 1);
            i.Table = FixTable(i.Table);
            i.Vibrato = C(i.Vibrato, 0, 100); i.VibratoRate = C(i.VibratoRate, 0.1, 15);
            i.DrumTune = C(i.DrumTune, -24, 24); i.DrumDecay = C(i.DrumDecay, 0.2, 4); i.DrumTone = C(i.DrumTone, 0, 1);
            i.RootNote = Math.Clamp(i.RootNote, 0, 127);
            i.FontPreset = Math.Clamp(i.FontPreset, 0, 65535); i.FontProgram = Math.Clamp(i.FontProgram, 0, 127);
            if (i.Path != null && (i.Path.Length > 1000 || i.Path.Any(char.IsControl))) i.Path = null;
            if (i.SampleName != null && i.SampleName.Length > 120) i.SampleName = i.SampleName[..120];
            i.Arp = SongInstrument.ArpModes.Contains(i.Arp) ? i.Arp : "off";
            i.ArpRate = i.ArpRate is 1 or 2 or 4 ? i.ArpRate : 2; i.ArpOctaves = Math.Clamp(i.ArpOctaves, 1, 3);
            i.Lfo = SongInstrument.LfoTargets.Contains(i.Lfo) ? i.Lfo : "off";
            i.LfoRate = C(i.LfoRate, 0.05, 20); i.LfoDepth = C(i.LfoDepth, 0, 1);
            i.FmRatio = C(i.FmRatio, 0.25, 16); i.FmDepth = C(i.FmDepth, 0, 10);
            t.Humanize = C(t.Humanize, 0, 1);
            t.InLayers = (t.InLayers ?? []).Where(layerIds.Contains).Distinct().ToList();
            List<SongPoint> Points(List<SongPoint>? list, double lo, double hi) =>
                (list ?? []).Where(p => p != null).Take(256).Select(p => { p.Bar = C(p.Bar, 0, Bars); p.Value = C(p.Value, lo, hi); return p; }).OrderBy(p => p.Bar).ToList();
            t.GainAutomation = Points(t.GainAutomation, -48, 12);
            t.FilterAutomation = Points(t.FilterAutomation, -6, 6);
            t.Effects = (t.Effects ?? []).Where(e => e != null).Take(SoundEffect.MaxPerChain).Select(e => e.Clamped()).ToList();
            t.Patterns = (t.Patterns ?? []).Take(SongTrack.MaxPatterns).Select(p => p ?? new SongPattern()).ToList();
            var steps = StepsPerBar;
            foreach (var p in t.Patterns)
                p.Notes = (p.Notes ?? []).Where(n => n != null).Take(512).Select(n =>
                {
                    n.Step = Math.Clamp(n.Step, 0, steps - 1); n.Length = Math.Clamp(n.Length, 1, steps * 8);
                    n.Pitch = t.Kind == "drums" ? Math.Clamp(n.Pitch, 0, KitRows.Length - 1) : Math.Clamp(n.Pitch, 0, 127);
                    n.Velocity = C(n.Velocity, 0.05, 1);
                    n.Pan = C(n.Pan, -1, 1);
                    if (t.Kind == "drums") { n.Slide = false; n.Accent = false; }
                    return n;
                }).OrderBy(n => n.Step).ThenBy(n => n.Pitch).ToList();
            t.Sequence = (t.Sequence ?? []).Take(Bars).Select(s => Math.Clamp(s, 0, t.Patterns.Count)).ToList();
            while (t.Sequence.Count < Bars) t.Sequence.Add(0);
            if (t.Id is not { Length: > 1 and <= 8 } || t.Id[0] != 'K' || !t.Id[1..].All(char.IsAsciiDigit) || !used.Add(t.Id)) t.Id = "";
        }
        foreach (var t in Tracks.Where(t => t.Id == "")) { var n = 1; while (!used.Add("K" + n)) n++; t.Id = "K" + n; }
        return this;
    }

    /// <summary>Samples given by name only, or moved: found in the folder beside the recipe (where an export puts them).</summary>
    public SongRecipe FindSamplesBeside(string folder)
    {
        string? Find(string? path)
        {
            if (string.IsNullOrEmpty(path)) return path;
            try
            {
                if (!System.IO.Path.IsPathFullyQualified(path)) return System.IO.Path.GetFullPath(System.IO.Path.Combine(folder, path));
                if (File.Exists(path)) return path;
                var name = System.IO.Path.GetFileName(path.Replace('\\', System.IO.Path.DirectorySeparatorChar));
                var beside = System.IO.Path.Combine(folder, name);
                return name.Length > 0 && File.Exists(beside) ? beside : path;
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { return path; /* reported missing when rendered */ }
        }
        foreach (var t in Tracks) if (t.Kind is "sample" or "sf2") t.Instrument.Path = Find(t.Instrument.Path);
        foreach (var fx in Tracks.SelectMany(t => t.Effects).Concat(MasterEffects)) if (fx.Type == "convolution") fx.IrPath = Find(fx.IrPath);
        return this;
    }

    /// <summary>The samples the song's tracks read (for allowing and finding them beside a recipe).</summary>
    public IEnumerable<string> Files() =>
        Tracks.Where(t => t.Kind is "sample" or "sf2" && !string.IsNullOrEmpty(t.Instrument.Path)).Select(t => t.Instrument.Path!)
            .Concat(Tracks.SelectMany(t => t.Effects).Concat(MasterEffects).Where(fx => fx.Type == "convolution" && !string.IsNullOrEmpty(fx.IrPath)).Select(fx => fx.IrPath!));
}

/// <summary>Scales by name: the semitones above the key's tonic that belong to it.</summary>
public static class SongScales
{
    public static readonly Dictionary<string, int[]> All = new()
    {
        ["major"] = [0, 2, 4, 5, 7, 9, 11],
        ["minor"] = [0, 2, 3, 5, 7, 8, 10],
        ["dorian"] = [0, 2, 3, 5, 7, 9, 10],
        ["mixolydian"] = [0, 2, 4, 5, 7, 9, 10],
        ["harmonic-minor"] = [0, 2, 3, 5, 7, 8, 11],
        ["phrygian"] = [0, 1, 3, 5, 7, 8, 10],
        ["major-pentatonic"] = [0, 2, 4, 7, 9],
        ["minor-pentatonic"] = [0, 3, 5, 7, 10],
        ["blues"] = [0, 3, 5, 6, 7, 10],
        ["chromatic"] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    };

    public static bool Contains(string scale, int key, int pitch) => All.TryGetValue(scale, out var s) && s.Contains((((pitch - key) % 12) + 12) % 12);
}

public static class SequencerEngine
{
    /// <summary>How long notes and effects may ring on after the last bar (seconds).</summary>
    private const double TailSeconds = 3;

    /// <param name="loop">Render only the loop region, its tail folded into its start: it repeats without a gap or a click.</param>
    /// <param name="samples">Reads a sample track's WAV (null when it can't or may not be used).</param>
    /// <param name="layer">An adaptive layer's id: only its tracks (and those in every layer) play.</param>
    public static SoundRender Render(SongRecipe song, int sampleRate = 48000, bool loop = false, Func<string, SampleAudio?>? samples = null, string? layer = null) =>
        RenderAll(song, sampleRate, loop, samples, stems: false, layer: layer).Mix;

    /// <summary>
    /// Every adaptive layer (each with its tracks), at one shared level so they can be crossfaded in a game without
    /// a jump: the loudest layer sets how far all of them are brought down (if at all).
    /// </summary>
    public static List<(SongLayer Layer, SoundRender Render)> RenderLayers(SongRecipe recipe, int sampleRate = 48000, bool loop = true, Func<string, SampleAudio?>? samples = null)
    {
        var song = recipe.Clone();
        var raw = song.Layers.Select(l => (l, RenderAll(song, sampleRate, loop, samples, stems: false, layer: l.Id, limit: false).Mix)).ToList();
        var peak = raw.Count == 0 ? 0 : raw.Max(r => Math.Max(r.Mix.Left.Max(Math.Abs), r.Mix.Right.Max(Math.Abs)));
        var g = peak > 0.97 ? (float)(0.97 / peak) : 1f;
        return raw.Select(r => (r.l, Scaled(r.Mix, g))).ToList();
    }

    private static SoundRender Scaled(SoundRender r, float g)
    {
        if (g == 1f) return r;
        var (l, rr) = (new float[r.Left.Length], new float[r.Right.Length]);
        for (var i = 0; i < l.Length; i++) { l[i] = r.Left[i] * g; rr[i] = r.Right[i] * g; }
        double Db(double x) => x <= 1e-9 ? -120 : Math.Round(20 * Math.Log10(x), 1);
        return new SoundRender { SampleRate = r.SampleRate, Left = l, Right = rr, PeakDb = Math.Round(r.PeakDb + 20 * Math.Log10(g), 1), RmsDb = Math.Round(r.RmsDb + 20 * Math.Log10(g), 1), Warnings = r.Warnings };
    }

    /// <summary>
    /// What a game does when the music changes: the first layer's loop once, then the second fading in over it (in
    /// time: both loops are the same length) and playing on for one loop.
    /// </summary>
    public static SoundRender Transition(SoundRender from, SoundRender to, double fadeSeconds)
    {
        var n = Math.Min(from.Left.Length, to.Left.Length);
        var fade = Math.Clamp((int)(fadeSeconds * from.SampleRate), 1, n);
        float[] l = new float[2 * n], r = new float[2 * n];
        for (var i = 0; i < n; i++) { l[i] = from.Left[i]; r[i] = from.Right[i]; }
        for (var i = 0; i < n; i++)
        {
            // Equal power: the two together keep the same loudness through the fade.
            var x = Math.Min(1, (double)i / fade);
            float a = (float)Math.Cos(x * Math.PI / 2), b = (float)Math.Sin(x * Math.PI / 2);
            l[n + i] = from.Left[i] * a + to.Left[i] * b;
            r[n + i] = from.Right[i] * a + to.Right[i] * b;
        }
        return new SoundRender { SampleRate = from.SampleRate, Left = l, Right = r, PeakDb = Math.Max(from.PeakDb, to.PeakDb), RmsDb = Math.Max(from.RmsDb, to.RmsDb) };
    }

    /// <summary>How well the loop loops: the step at the seam, how much rings over the end (folded into the start), and the level at both ends.</summary>
    public sealed record LoopReport(double Seconds, double SeamJump, double TailPercent, double StartDb, double EndDb, IReadOnlyList<string> Checks);

    public static LoopReport CheckLoop(SongRecipe recipe, int sampleRate = 48000, Func<string, SampleAudio?>? samples = null, string? layer = null)
    {
        var song = recipe.Clone();
        var looped = Render(song, sampleRate, true, samples, layer);
        var open = RenderAll(song, sampleRate, false, samples, stems: false, song.LoopStart, song.LoopEnd, layer, limit: false).Mix;
        var n = looped.Left.Length;
        double Energy(float[] a, float[] b, int from, int to) { double e = 0; for (var i = from; i < Math.Min(to, a.Length); i++) e += a[i] * a[i] + b[i] * b[i]; return e; }
        var all = Energy(open.Left, open.Right, 0, open.Left.Length);
        var tail = all > 0 ? 100 * Energy(open.Left, open.Right, n, open.Left.Length) / all : 0;
        var half = Math.Min(n / 2, sampleRate / 2);
        double Db(double e, int count) => e <= 1e-12 ? -120 : Math.Round(10 * Math.Log10(e / (2.0 * count)), 1);
        var start = Db(Energy(looped.Left, looped.Right, 0, half), half);
        var end = Db(Energy(looped.Left, looped.Right, n - half, n), half);
        var seam = looped.Measure().SeamJump;
        var checks = new List<string>();
        if (seam > 1.5) checks.Add("There is a jump where the loop wraps (a click): an effect or a note may be cut at the end");
        if (Math.Abs(start - end) > 6 && Math.Max(start, end) > -60) checks.Add($"The start and the end differ by {Math.Abs(start - end):0} dB: the loop may sound like it restarts");
        if (tail > 15) checks.Add($"{tail:0} % of the sound rings over the end (folded into the start): fine for reverb, but a long tail may blur the start");
        if (looped.RmsDb < -50) checks.Add("The loop is nearly silent (are its tracks muted, or in another layer?)");
        return new LoopReport(Math.Round(looped.Seconds, 3), seam, Math.Round(tail, 1), start, end, checks);
    }

    /// <summary>For listening: bars from (included) to (excluded), with the tail of the last one.</summary>
    public static SoundRender RenderBars(SongRecipe song, int fromBar, int toBar, int sampleRate = 48000, Func<string, SampleAudio?>? samples = null) =>
        RenderAll(song, sampleRate, false, samples, stems: false, fromBar, toBar).Mix;

    /// <summary>One note of a track, as it sounds in the song (its instrument, effects, level and pan), for hearing a note as it is placed.</summary>
    public static SoundRender RenderNote(SongRecipe recipe, int track, int pitch, double velocity = 0.8, int sampleRate = 48000, Func<string, SampleAudio?>? samples = null) =>
        RenderNotes(recipe, track, [pitch], velocity, sampleRate, samples);

    /// <summary>Notes struck together (a chord) on a track, as they sound in the song.</summary>
    public static SoundRender RenderNotes(SongRecipe recipe, int track, IReadOnlyList<int> pitches, double velocity = 0.8, int sampleRate = 48000, Func<string, SampleAudio?>? samples = null)
    {
        var song = recipe.Clone();
        if (track < 0 || track >= song.Tracks.Count) throw new ArgumentException("There is no such track.");
        var t = song.Tracks[track];
        t.Mute = false; t.Solo = false;
        t.Patterns = [new SongPattern { Notes = [.. pitches.Take(8).Select(pitch => new SongNote { Step = 0, Length = t.Kind == "drums" ? 1 : pitches.Count > 1 ? 4 : 2, Pitch = pitch, Velocity = velocity })] }];
        // A note on its own: not arpeggiated or humanized, and with no automation.
        t.Instrument.Arp = "off"; t.Humanize = 0; t.GainAutomation = []; t.FilterAutomation = [];
        t.Sequence = [1];
        song.Tracks = [t];
        song.Bars = 1; song.LoopStart = 0; song.LoopEnd = 1;
        song.MasterEffects = [];
        song.Clamped();
        var full = RenderAll(song, sampleRate, false, samples, stems: false).Mix;
        // Only up to where it falls silent (a short sound, not a whole bar).
        var end = full.Left.Length;
        while (end > 1 && Math.Abs(full.Left[end - 1]) < 1e-4 && Math.Abs(full.Right[end - 1]) < 1e-4) end--;
        end = Math.Min(full.Left.Length, end + 64);
        return new SoundRender { SampleRate = full.SampleRate, Left = full.Left[..end], Right = full.Right[..end], PeakDb = full.PeakDb, RmsDb = full.RmsDb, Warnings = full.Warnings };
    }

    /// <summary>The mix and each track on its own (same length and gain as in the mix), for stems.</summary>
    public static (SoundRender Mix, List<(string Name, SoundRender Render)> Stems) RenderStems(SongRecipe song, int sampleRate = 48000, bool loop = false, Func<string, SampleAudio?>? samples = null) =>
        RenderAll(song, sampleRate, loop, samples, stems: true);

    /// <summary>For listening to one adaptive layer from a bar on (its level shared with the other layers, as exported).</summary>
    public static SoundRender RenderLayerBars(SongRecipe recipe, string layer, int fromBar, int toBar, int sampleRate = 48000, Func<string, SampleAudio?>? samples = null)
    {
        var song = recipe.Clone();
        var raw = RenderAll(song, sampleRate, false, samples, stems: false, fromBar, toBar, layer, limit: false).Mix;
        // The same bringing-down as the loudest layer's, so switching layers while listening keeps their balance.
        var peak = song.Layers.Select(l => l.Id == layer ? raw : RenderAll(song, sampleRate, false, samples, stems: false, fromBar, toBar, l.Id, limit: false).Mix)
            .Max(r => Math.Max(r.Left.Length == 0 ? 0 : r.Left.Max(Math.Abs), r.Right.Length == 0 ? 0 : r.Right.Max(Math.Abs)));
        return Scaled(raw, peak > 0.97 ? (float)(0.97 / peak) : 1f);
    }

    private static (SoundRender Mix, List<(string Name, SoundRender Render)> Stems) RenderAll(SongRecipe recipe, int sr, bool loop, Func<string, SampleAudio?>? samples, bool stems,
        int? from = null, int? to = null, string? layer = null, bool limit = true)
    {
        var song = recipe.Clone();
        int fromBar = loop ? song.LoopStart : 0, toBar = loop ? song.LoopEnd : song.Bars;
        if (from != null) fromBar = Math.Clamp(from.Value, 0, song.Bars - 1);
        if (to != null) toBar = Math.Clamp(to.Value, fromBar + 1, song.Bars);
        var length = (int)Math.Round((toBar - fromBar) * song.BarSeconds * sr);
        var total = length + (int)(TailSeconds * sr);
        var warnings = new List<string>();
        var anySolo = song.Tracks.Any(t => t.Solo);
        double[] mixL = new double[total], mixR = new double[total];
        var trackRenders = new List<(string Name, double[] L, double[] R)>();
        // The send buses: what the tracks send them, before their effects.
        var buses = song.Buses.Select(b => (Bus: b, L: new double[total], R: new double[total])).ToList();
        var levels = new List<(string Name, double Peak)>();
        foreach (var track in song.Tracks)
        {
            var outOfLayer = layer != null && track.InLayers.Count > 0 && !track.InLayers.Contains(layer);
            if (track.Mute || (anySolo && !track.Solo) || outOfLayer) { if (stems) trackRenders.Add((track.Name, new double[total], new double[total])); continue; }
            SampleAudio? sample = null;
            if (track.Kind is "sample" or "sf2")
            {
                sample = string.IsNullOrEmpty(track.Instrument.Path) ? null : samples?.Invoke(track.Instrument.Path);
                if (track.Kind == "sf2" && sample?.Font == null) sample = null;
                if (sample == null) { warnings.Add(track.Kind == "sf2" ? $"“{track.Name}”: its SoundFont is missing or can't be read" : $"“{track.Name}”: its sample is missing or can't be read"); if (stems) trackRenders.Add((track.Name, new double[total], new double[total])); continue; }
            }
            double[] L = new double[total], R = new double[total];
            var trackIndex = song.Tracks.IndexOf(track);
            for (var bar = fromBar; bar < toBar; bar++)
            {
                var played = Played(song, track, trackIndex, bar);
                for (var k = 0; k < played.Count; k++)
                {
                    var (step, noteSteps, pitch, velocity, pan, slides, accent) = played[k];
                    var note = new SongNote { Step = 0, Length = 1, Pitch = pitch, Velocity = velocity };
                    // A note's own place: equal power, the middle as loud as before.
                    var na = (pan + 1) * Math.PI / 4;
                    double nl = pan == 0 ? 1 : Math.Cos(na) * Math.Sqrt(2), nr = pan == 0 ? 1 : Math.Sin(na) * Math.Sqrt(2);
                    var bend = Bend(slides, song.StepSeconds);
                    var songSeconds = step * song.StepSeconds;
                    var start = songSeconds - fromBar * song.BarSeconds;
                    var seconds = noteSteps * song.StepSeconds;
                    var seed = (ulong)(uint)song.Seed * 0x9E3779B97F4A7C15UL ^ (ulong)(trackIndex * 7919 + bar * 104729 + k * 31 + pitch);
                    var at = (int)Math.Round(start * sr);
                    switch (track.Kind)
                    {
                        case "drums": Drum(new Out(L, R, nl, nr), at, note, track.Instrument, sr, new SoundRng(seed)); break;
                        case "sample": SampleVoice(new Out(L, R, nl, nr), at, note, seconds, track.Instrument, sample!, sr, bend); break;
                        case "sf2":
                        {
                            var (la, ra, aa) = (L, R, at);
                            sample!.Font!.Play((n, l, rr) => { var x = aa + n; if (x >= 0 && x < la.Length) { la[x] += l * nl; ra[x] += rr * nr; } },
                                track.Instrument.FontPreset, Math.Clamp(pitch + 12 * track.Instrument.Octave, 0, 127), Math.Min(1, velocity * (accent ? 1.25 : 1)), seconds, sr, bend);
                            break;
                        }
                        default: Synth(new Out(L, R, nl, nr), at, note, seconds, track.Instrument, sr, new SoundRng(seed), songSeconds, At(track.FilterAutomation, step / song.StepsPerBar, 0), bend, accent); break;
                    }
                }
            }
            if (track.Effects.Count > 0) SoundEffects.Apply(track.Effects, L, R, sr, files: samples);
            // Level automation (after the effects, so a fade takes the echoes with it).
            if (track.GainAutomation.Count > 0)
                for (var i = 0; i < total; i++)
                {
                    var level = Math.Pow(10, At(track.GainAutomation, fromBar + (double)i / sr / song.BarSeconds, 0) / 20);
                    L[i] *= level; R[i] *= level;
                }
            // Level and place: equal-power pan.
            var gain = Math.Pow(10, track.Gain / 20);
            var angle = (track.Pan + 1) * Math.PI / 4;
            double gl = Math.Cos(angle) * Math.Sqrt(2) * gain, gr = Math.Sin(angle) * Math.Sqrt(2) * gain;
            double tp = 0;
            for (var i = 0; i < total; i++) { L[i] *= gl; R[i] *= gr; mixL[i] += L[i]; mixR[i] += R[i]; tp = Math.Max(tp, Math.Max(Math.Abs(L[i]), Math.Abs(R[i]))); }
            levels.Add((track.Name, tp));
            foreach (var (bus, bl, br) in buses)
            {
                if (!track.Sends.TryGetValue(bus.Id, out var amount) || amount <= 0) continue;
                for (var i = 0; i < total; i++) { bl[i] += L[i] * amount; br[i] += R[i] * amount; }
            }
            if (stems) trackRenders.Add((track.Name, L, R));
        }
        // Each bus: its effects, its level, into the mix (and a stem of its own, so the stems still add up to the mix).
        foreach (var (bus, bl, br) in buses)
        {
            if (bus.Effects.Count > 0) SoundEffects.Apply(bus.Effects, bl, br, sr, files: samples);
            var bg = Math.Pow(10, bus.Gain / 20);
            double bp = 0;
            for (var i = 0; i < total; i++) { bl[i] *= bg; br[i] *= bg; mixL[i] += bl[i]; mixR[i] += br[i]; bp = Math.Max(bp, Math.Max(Math.Abs(bl[i]), Math.Abs(br[i]))); }
            levels.Add((bus.Name, bp));
            if (stems) trackRenders.Add((bus.Name, bl, br));
        }
        // Master effects work on the mix (stems keep their track's own sound).
        if (song.MasterEffects.Count > 0) SoundEffects.Apply(song.MasterEffects, mixL, mixR, sr, files: samples);
        // The master: its gain, then never louder than just below full scale (the same gain for every stem).
        var master = Math.Pow(10, song.MasterGain / 20);
        if (loop) { Fold(mixL, length); Fold(mixR, length); foreach (var t in trackRenders) { Fold(t.L, length); Fold(t.R, length); } }
        var n = loop ? length : LastSound(mixL, mixR, length);
        double peak = 0;
        for (var i = 0; i < n; i++) peak = Math.Max(peak, Math.Max(Math.Abs(mixL[i]), Math.Abs(mixR[i])) * master);
        var g = master * (limit && peak > 0.97 ? 0.97 / peak : 1);
        SoundRender Make(double[] a, double[] b, IReadOnlyList<string> w, IReadOnlyList<SoundLevel>? lv = null)
        {
            float[] fl = new float[n], fr = new float[n];
            double p = 0, sum = 0;
            for (var i = 0; i < n; i++) { fl[i] = (float)(a[i] * g); fr[i] = (float)(b[i] * g); p = Math.Max(p, Math.Max(Math.Abs(fl[i]), Math.Abs(fr[i]))); sum += fl[i] * fl[i] + fr[i] * fr[i]; }
            double Db(double x) => x <= 1e-9 ? -120 : Math.Round(20 * Math.Log10(x), 1);
            return new SoundRender { SampleRate = sr, Left = fl, Right = fr, PeakDb = Db(p), RmsDb = Db(Math.Sqrt(sum / Math.Max(1, 2 * n))), Warnings = w, Levels = lv };
        }
        var meters = levels.Select(x => new SoundLevel(x.Name, x.Peak * g <= 1e-9 ? -120 : Math.Round(20 * Math.Log10(x.Peak * g), 1))).ToList();
        return (Make(mixL, mixR, warnings, meters), trackRenders.Select(t => (t.Name, Make(t.L, t.R, []))).ToList());
    }

    /// <summary>An automation's value at a place in the song: a straight line between its points, flat before and after.</summary>
    internal static double At(List<SongPoint> points, double bar, double none)
    {
        if (points.Count == 0) return none;
        if (bar <= points[0].Bar) return points[0].Value;
        for (var k = 1; k < points.Count; k++)
            if (bar <= points[k].Bar)
            {
                var (a, b) = (points[k - 1], points[k]);
                return b.Bar - a.Bar < 1e-9 ? b.Value : a.Value + (b.Value - a.Value) * (bar - a.Bar) / (b.Bar - a.Bar);
            }
        return points[^1].Value;
    }

    /// <summary>
    /// The notes of a track's bar as they are played: arpeggiated if its instrument says so, swung, and humanized
    /// (seeded: the same song plays the same). Step is from the song's start, in sixteenths (fractional).
    /// </summary>
    internal static List<PlayedNote> Played(SongRecipe song, SongTrack track, int trackIndex, int bar)
    {
        var result = new List<PlayedNote>();
        var number = bar < track.Sequence.Count ? track.Sequence[bar] : 0;
        if (number <= 0 || number > track.Patterns.Count) return result;
        var notes = track.Patterns[number - 1].Notes;
        var ins = track.Instrument;
        var rng = new SoundRng((ulong)(uint)song.Seed * 0xD1B54A32D192ED69UL ^ (ulong)(trackIndex * 15485863 + bar * 32452843 + 7));
        var raw = new List<(int Step, double Length, int Pitch, double Velocity, double Pan, List<(double At, int To)>? Slides, bool Accent)>();
        if (ins.Arp != "off" && track.Kind != "drums")
        {
            foreach (var group in notes.GroupBy(n => n.Step))
            {
                var pitches = group.Select(n => n.Pitch).Distinct().OrderBy(p => p).ToList();
                var up = Enumerable.Range(0, ins.ArpOctaves).SelectMany(o => pitches.Select(p => Math.Min(127, p + 12 * o))).ToList();
                var order = ins.Arp switch
                {
                    "down" => Enumerable.Reverse(up).ToList(),
                    "updown" => up.Count > 2 ? [.. up, .. Enumerable.Reverse(up).Skip(1).Take(up.Count - 2)] : up,
                    _ => up,
                };
                var length = group.Max(n => n.Length);
                var velocity = group.Max(n => n.Velocity);
                for (int s = 0, k = 0; s < length; s += ins.ArpRate, k++)
                {
                    var len = Math.Min(ins.ArpRate, length - s);
                    var pan = group.Average(n => n.Pan);
                    var accent = group.Any(n => n.Accent) && s == 0;
                    if (ins.Arp == "chord") foreach (var p in pitches) raw.Add((group.Key + s, len, p, velocity, pan, null, accent));
                    else raw.Add((group.Key + s, len, ins.Arp == "random" ? order[(int)(rng.NextDouble() * order.Count) % order.Count] : order[k % order.Count], velocity, pan, null, accent));
                }
            }
        }
        else if (track.Kind != "drums" && notes.Any(n => n.Slide)) raw.AddRange(Slid(notes));
        else raw.AddRange(notes.Select(n => (n.Step, (double)n.Length, n.Pitch, n.Velocity, n.Pan, (List<(double, int)>?)null, n.Accent)));
        foreach (var (step, length, pitch, velocity, pan, slides, accent) in raw.OrderBy(n => n.Step).ThenBy(n => n.Pitch))
        {
            var at = bar * song.StepsPerBar + step + (step % 2 == 1 ? song.Swing : 0);
            var v = velocity;
            if (track.Humanize > 0)
            {
                // Up to ±20 ms early or late, up to ±25 % softer or harder.
                at += rng.Bipolar() * 0.02 * track.Humanize / song.StepSeconds;
                v = Math.Clamp(v * (1 + rng.Bipolar() * 0.25 * track.Humanize), 0.05, 1);
            }
            result.Add(new PlayedNote(Math.Max(0, at), length, pitch, v, pan, slides, accent));
        }
        return result;
    }

    /// <summary>
    /// Notes that slide: a sliding note and the one after it (the next to start; of a chord, the nearest pitch) become
    /// one held note that glides to the next pitch when that note starts, without a new attack. Chains carry on.
    /// </summary>
    private static List<(int Step, double Length, int Pitch, double Velocity, double Pan, List<(double At, int To)>? Slides, bool Accent)> Slid(List<SongNote> notes)
    {
        var list = notes.OrderBy(n => n.Step).ThenBy(n => n.Pitch).ToList();
        var used = new HashSet<SongNote>();
        var raw = new List<(int, double, int, double, double, List<(double, int)>?, bool)>();
        foreach (var first in list)
        {
            if (!used.Add(first)) continue;
            var cur = first;
            var end = (double)(first.Step + first.Length);
            List<(double, int)>? slides = null;
            while (cur.Slide)
            {
                var c = cur;
                var later = list.Where(n => n.Step > c.Step && !used.Contains(n)).ToList();
                if (later.Count == 0) break;
                var at = later.Min(n => n.Step);
                var next = later.Where(n => n.Step == at).OrderBy(n => Math.Abs(n.Pitch - c.Pitch)).First();
                used.Add(next);
                (slides ??= []).Add((next.Step - first.Step, next.Pitch - first.Pitch));
                end = Math.Max(end, next.Step + next.Length);
                cur = next;
            }
            raw.Add((first.Step, end - first.Step, first.Pitch, first.Velocity, first.Pan, slides, first.Accent));
        }
        return raw;
    }

    /// <summary>How long a slide takes: quick, as on a 303.</summary>
    public const double GlideSeconds = 0.07;

    /// <summary>The pitch bend of a sliding note in semitones at a time (seconds from its start), or null.</summary>
    private static Func<double, double>? Bend(IReadOnlyList<(double At, int To)>? slides, double stepSeconds)
    {
        if (slides == null || slides.Count == 0) return null;
        return t =>
        {
            double offset = 0, from = 0;
            foreach (var (at, to) in slides)
            {
                var start = at * stepSeconds;
                if (t < start) break;
                var target = to;
                // Gliding from where the last slide got to.
                var k = Math.Min(1, (t - start) / GlideSeconds);
                offset = from + (target - from) * k;
                from = target;
            }
            return offset;
        };
    }

    /// <summary>Where a voice goes: both channels, each with its gain (a note's own place).</summary>
    private readonly record struct Out(double[] L, double[] R, double Gl, double Gr)
    {
        public int Length => L.Length;
        public void Add(int i, double x) { L[i] += x * Gl; R[i] += x * Gr; }
    }

    /// <summary>What rings on after the loop's end is added to its start, so the loop repeats seamlessly.</summary>
    private static void Fold(double[] a, int length)
    {
        for (var i = length; i < a.Length; i++) a[(i - length) % length] += a[i];
    }

    /// <summary>The song's length plus its tail, up to where it falls silent.</summary>
    private static int LastSound(double[] l, double[] r, int length)
    {
        var last = length;
        for (var i = l.Length - 1; i >= length; i--) if (Math.Abs(l[i]) > 1e-4 || Math.Abs(r[i]) > 1e-4) { last = i + 1; break; }
        return Math.Min(l.Length, last + 64);
    }

    private static double Freq(int pitch) => 440 * Math.Pow(2, (pitch - 69) / 12.0);

    /// <summary>ADSR: attack, decay to sustain while held, release after.</summary>
    private static double Envelope(double t, double held, SongInstrument i)
    {
        double Level(double x) => x < i.Attack ? x / i.Attack : x < i.Attack + i.Decay ? 1 - (1 - i.Sustain) * (x - i.Attack) / i.Decay : i.Sustain;
        if (t < held) return Level(t);
        var r = t - held;
        return r >= i.Release ? 0 : Level(held) * (1 - r / i.Release);
    }

    /// <summary>The correction that takes the click out of a jump in a saw or square wave (polyBLEP).</summary>
    private static double Blep(double t, double dt)
    {
        if (t < dt) { t /= dt; return t + t - t * t - 1; }
        if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
        return 0;
    }

    private static void Synth(Out buf, int at, SongNote note, double held, SongInstrument i, int sr, SoundRng rng, double songSeconds = 0, double filterShift = 0, Func<double, double>? bend = null, bool accent = false)
    {
        if (i.Wave == "kick") { Kick(buf, at, note, held, i, sr, rng, filterShift, accent); return; }
        var fmPhase = 0.0;
        var cutoffBase = i.Cutoff * Math.Pow(2, filterShift);
        var total = (int)((held + i.Release) * sr) + 1;
        var baseFreq = Freq(note.Pitch + 12 * i.Octave);
        var voices = i.Detune > 0 && i.Wave != "noise" ? 2 : 1;
        var phase = new double[voices];
        // Every voice starts at phase 0: a pattern sounds the same each time it plays (only noise differs).
        // A low-pass, its cutoff following the envelope.
        var filter = new Svf();
        var amp = note.Velocity * 0.32 / Math.Sqrt(voices) * (accent ? 1.35 : 1);
        // The filter's envelope: the volume's, or its own quicker decay (an accent opens it further and closes it sooner).
        var fDecay = i.FilterDecay > 0 ? i.FilterDecay * (accent ? 0.6 : 1) : 0;
        var fAmount = i.FilterEnvelope + (accent ? 1.5 : 0);
        var table = i.Wave == "drawn" ? i.Table : null;
        for (var n = 0; n < total && at + n < buf.Length; n++)
        {
            if (at + n < 0) continue;
            var t = (double)n / sr;
            var env = Envelope(t, held, i);
            if (env <= 0 && t > held) break;
            var vib = i.Vibrato > 0 ? Math.Pow(2, i.Vibrato / 1200 * Math.Sin(2 * Math.PI * i.VibratoRate * t)) : 1;
            if (bend != null) vib *= Math.Pow(2, bend(t) / 12);
            // The LFO runs with the song (its phase from the song's start), so held and repeated notes move together.
            var lfo = i.Lfo == "off" ? 0 : Math.Sin(2 * Math.PI * i.LfoRate * (songSeconds + t));
            if (i.Lfo == "pitch") vib *= Math.Pow(2, lfo * i.LfoDepth * 2 / 12);
            var tremolo = i.Lfo == "volume" ? 1 - i.LfoDepth * (0.5 + 0.5 * lfo) : 1;
            var fm = 0.0;
            if (i.FmDepth > 0 && i.Wave == "sine")
            {
                // Phase modulation, its depth following the envelope (brighter at the start, as a struck bell).
                fm = i.FmDepth * env * Math.Sin(2 * Math.PI * fmPhase);
                fmPhase = (fmPhase + baseFreq * vib * i.FmRatio / sr) % 1;
            }
            double s = 0;
            for (var v = 0; v < voices; v++)
            {
                var f = baseFreq * vib * (voices == 2 ? Math.Pow(2, (v == 0 ? -1 : 1) * i.Detune / 2400) : 1);
                var dt = Math.Min(0.5, f / sr);
                var p = phase[v];
                s += i.Wave switch
                {
                    "sine" => Math.Sin(2 * Math.PI * p + fm),
                    "triangle" => 4 * Math.Abs(p - 0.5) - 1,
                    "saw" => 2 * p - 1 - Blep(p, dt),
                    "square" => (p < 0.5 ? 1 : -1) + Blep(p, dt) - Blep((p + 0.5) % 1, dt),
                    "pulse" => (p < i.PulseWidth ? 1 : -1) + Blep(p, dt) - Blep((p + 1 - i.PulseWidth) % 1, dt),
                    "drawn" => Table(table!, p, i.TableSmooth),
                    _ => rng.Bipolar(),
                };
                phase[v] = (p + dt) % 1;
            }
            if ((n & 15) == 0) filter.Set(cutoffBase * Math.Pow(2, fAmount * (fDecay > 0 ? Math.Exp(-t / fDecay) : env) + (i.Lfo == "filter" ? lfo * i.LfoDepth * 3 : 0)), i.Resonance, sr);
            buf.Add(at + n, filter.Low(s) * env * amp * tremolo);
        }
    }

    /// <summary>One point of a drawn wave: between points a smooth (Catmull-Rom) curve, or steps.</summary>
    private static double Table(List<double> t, double phase, bool smooth)
    {
        var n = t.Count;
        var x = phase * n;
        var k = (int)x % n;
        if (!smooth) return t[k];
        var f = x - Math.Floor(x);
        double p0 = t[(k - 1 + n) % n], p1 = t[k], p2 = t[(k + 1) % n], p3 = t[(k + 2) % n];
        return Math.Clamp(p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0))), -1.2, 1.2);
    }

    /// <summary>
    /// A synthesised kick (as LMMS's Kicker): a sine falling from its start to its end pitch (tuned by the note: C3
    /// plays them as set), the volume envelope's decay, a click, some noise and soft clipping, then the filter.
    /// </summary>
    private static void Kick(Out buf, int at, SongNote note, double held, SongInstrument i, int sr, SoundRng rng, double filterShift, bool accent)
    {
        var tune = Math.Pow(2, (note.Pitch + 12 * i.Octave - 48) / 12.0);
        double f0 = i.KickStart * tune, f1 = i.KickEnd * tune;
        var total = (int)((held + i.Release) * sr) + 1;
        var filter = new Svf();
        filter.Set(Math.Min(sr * 0.45, i.Cutoff * Math.Pow(2, filterShift)), i.Resonance, sr);
        var amp = note.Velocity * 0.6 * (accent ? 1.35 : 1);
        var drive = 1 + i.KickDrive * 8;
        var norm = Math.Tanh(drive);
        var phase = 0.0;
        for (var n = 0; n < total && at + n < buf.Length; n++)
        {
            var t = (double)n / sr;
            var env = Envelope(t, held, i);
            if (env <= 0 && t > held) break;
            var f = f1 + (f0 - f1) * Math.Exp(-t / i.KickSweep);
            phase = (phase + f / sr) % 1;
            var s = Math.Sin(2 * Math.PI * phase);
            if (i.KickClick > 0 && t < 0.004) s += i.KickClick * (1 - t / 0.004) * (rng.Bipolar() * 0.5 + 0.8);
            if (i.KickNoise > 0) s += i.KickNoise * rng.Bipolar() * Math.Exp(-t / 0.05);
            s = Math.Tanh(s * drive) / norm;
            if (at + n >= 0) buf.Add(at + n, filter.Low(s) * env * amp);
        }
    }

    /// <summary>A note of a sample: played faster or slower for its pitch, looped while held if asked, shaped by the envelope.</summary>
    private static void SampleVoice(Out buf, int at, SongNote note, double held, SongInstrument i, SampleAudio s, int sr, Func<double, double>? bend = null)
    {
        var rate = Math.Pow(2, (note.Pitch + 12 * i.Octave - i.RootNote) / 12.0) * s.Rate / sr;
        var len = s.Left.Length;
        var total = i.Loop || bend != null ? (int)((held + i.Release) * sr) + 1 : (int)Math.Min((held + i.Release) * sr, len / rate) + 1;
        var amp = note.Velocity * 0.9;
        var read = 0.0; // where in the sample (a slide changes the speed as it goes)
        for (var n = 0; n < total && at + n < buf.Length; n++, read += bend == null ? rate : rate * Math.Pow(2, bend((double)n / sr) / 12))
        {
            if (at + n < 0) continue;
            var pos = read;
            if (i.Loop) pos %= len; else if (pos >= len - 1) break;
            var k = (int)pos; var f = pos - k;
            var k2 = Math.Min(len - 1, k + 1);
            var v = ((s.Left[k] + s.Right[k]) * (1 - f) + (s.Left[k2] + s.Right[k2]) * f) * 0.5;
            buf.Add(at + n, v * Envelope((double)n / sr, held, i) * amp);
        }
    }

    /// <summary>The synthesised kit: each row a recipe of tone and noise, tuned, stretched and brightened by the track.</summary>
    private static void Drum(Out buf, int at, SongNote note, SongInstrument ins, int sr, SoundRng rng)
    {
        var tune = Math.Pow(2, ins.DrumTune / 12);
        var stretch = ins.DrumDecay;
        var bright = 0.5 + ins.DrumTone;
        var v = note.Velocity;
        double hp = 0, hpPrev = 0;
        var bp = new Svf();
        var bpSet = false;
        void Add(int n, double x) { if (at + n >= 0 && at + n < buf.Length) buf.Add(at + n, x * v); }
        double Noise() => rng.Bipolar();
        double HighPass(double x, double cutoff) { var a = Math.Exp(-2 * Math.PI * cutoff / sr); var y = a * (hp + x - hpPrev); hpPrev = x; hp = y; return y; }
        double BandPass(double x, double cutoff) { if (!bpSet) { bp.Set(cutoff, 1.6, sr); bpSet = true; } bp.Low(x); return bp.Band; }
        int Len(double s) => (int)(s * stretch * sr);
        double phase = 0;
        switch (note.Pitch)
        {
            case 0: // kick: a sine falling from 160 to 45 Hz, and a click
                for (int n = 0, end = Len(0.45); n < end; n++)
                {
                    var t = (double)n / sr;
                    var f = (45 + 115 * Math.Exp(-t / 0.035)) * tune;
                    phase += f / sr;
                    Add(n, (Math.Sin(2 * Math.PI * phase) * Math.Exp(-t / (0.16 * stretch)) + (n < sr / 1000 ? Noise() * 0.3 * bright : 0)) * 0.9);
                }
                break;
            case 1: // snare: a short tone and bright noise
                for (int n = 0, end = Len(0.3); n < end; n++)
                {
                    var t = (double)n / sr;
                    phase += 185 * tune / sr;
                    Add(n, 0.35 * Math.Sin(2 * Math.PI * phase) * Math.Exp(-t / 0.05) + 0.45 * HighPass(Noise(), 900 * bright) * Math.Exp(-t / (0.07 * stretch)));
                }
                break;
            case 2: // clap: three quick bursts then a tail, band-passed
                for (int n = 0, end = Len(0.35); n < end; n++)
                {
                    var t = (double)n / sr;
                    var burst = t < 0.03 ? Math.Exp(-((t % 0.01) / 0.003)) : Math.Exp(-(t - 0.03) / (0.09 * stretch));
                    Add(n, 0.8 * BandPass(Noise(), 1200 * bright * tune) * burst);
                }
                break;
            case 3: case 4: // hats: high noise, short (closed) or long (open)
                for (int n = 0, end = Len(note.Pitch == 3 ? 0.08 : 0.5); n < end; n++)
                {
                    var t = (double)n / sr;
                    Add(n, 0.35 * HighPass(Noise(), 6500 * bright * tune) * Math.Exp(-t / ((note.Pitch == 3 ? 0.018 : 0.14) * stretch)));
                }
                break;
            case 5: case 6: // toms: a falling sine, low or high
                var start = (note.Pitch == 5 ? 110 : 180) * tune;
                for (int n = 0, end = Len(0.5); n < end; n++)
                {
                    var t = (double)n / sr;
                    phase += start * (0.75 + 0.25 * Math.Exp(-t / 0.08)) / sr;
                    Add(n, 0.75 * Math.Sin(2 * Math.PI * phase) * Math.Exp(-t / (0.14 * stretch)));
                }
                break;
            default: // rim: a short woody click
                for (int n = 0, end = Len(0.06); n < end; n++)
                {
                    var t = (double)n / sr;
                    phase += 820 * tune / sr;
                    Add(n, (0.5 * (4 * Math.Abs(phase % 1 - 0.5) - 1) + 0.2 * Noise() * bright) * Math.Exp(-t / (0.012 * stretch)));
                }
                break;
        }
    }

    /// <summary>A state-variable filter that stays stable at any cutoff (the trapezoidal form).</summary>
    private struct Svf
    {
        private double _a1, _a2, _a3, _ic1, _ic2;
        public double Band;

        public void Set(double cutoff, double q, int sr)
        {
            var g = Math.Tan(Math.PI * Math.Clamp(cutoff, 20, sr * 0.49) / sr);
            var k = 1 / q;
            _a1 = 1 / (1 + g * (g + k)); _a2 = g * _a1; _a3 = g * _a2;
        }

        public double Low(double x)
        {
            var v3 = x - _ic2;
            var v1 = _a1 * _ic1 + _a2 * v3;
            var v2 = _ic2 + _a2 * _ic1 + _a3 * v3;
            _ic1 = 2 * v1 - _ic1; _ic2 = 2 * v2 - _ic2;
            Band = v1;
            return v2;
        }
    }

    // ------------------------------------------------------------------ MIDI

    /// <summary>General MIDI drum notes for the kit's rows.</summary>
    public static readonly int[] GmDrums = [36, 38, 39, 42, 46, 45, 50, 37];

    /// <summary>
    /// A Standard MIDI File (type 1, 480 ticks a beat): a tempo track, then one track per song track with its notes
    /// (swing included); drums on channel 10 with General MIDI drum notes.
    /// </summary>
    public static byte[] ToMidi(SongRecipe recipe)
    {
        var song = recipe.Clone();
        const int ppq = 480, stepTicks = ppq / 4;
        var tracks = new List<byte[]>();
        var head = new List<byte>();
        void Meta(List<byte> b, int type, byte[] data) { b.AddRange(Vlq(0)); b.Add(0xFF); b.Add((byte)type); b.AddRange(Vlq(data.Length)); b.AddRange(data); }
        var mpq = (int)Math.Round(60_000_000 / song.Tempo);
        Meta(head, 0x03, Encoding.UTF8.GetBytes(song.Name));
        Meta(head, 0x51, [(byte)(mpq >> 16), (byte)(mpq >> 8), (byte)mpq]);
        Meta(head, 0x58, [(byte)song.BeatsPerBar, 2, 24, 8]);
        head.AddRange(Vlq(0)); head.AddRange([0xFF, 0x2F, 0]);
        tracks.Add([.. head]);
        var channel = 0;
        var anySolo = song.Tracks.Any(t => t.Solo);
        foreach (var t in song.Tracks)
        {
            if (t.Mute || (anySolo && !t.Solo)) continue;
            var ch = t.Kind == "drums" ? 9 : channel++;
            if (channel == 9) channel++;
            if (ch > 15) break;
            var events = new List<(long Tick, int Order, byte[] Data)>();
            var trackIndex = song.Tracks.IndexOf(t);
            for (var bar = 0; bar < song.Bars; bar++)
            {
                // The notes as heard: arpeggiated, swung and humanized.
                foreach (var note in Played(song, t, trackIndex, bar))
                {
                    var on = (long)Math.Round(note.Step * stepTicks);
                    var off = t.Kind == "drums" ? on + stepTicks / 2 : on + Math.Max(1, (long)Math.Round(note.Length * stepTicks));
                    var pitch = t.Kind == "drums" ? GmDrums[note.Pitch] : Math.Clamp(note.Pitch + 12 * t.Instrument.Octave, 0, 127);
                    var vel = (byte)Math.Clamp((int)Math.Round(note.Velocity * 127), 1, 127);
                    // A sliding note: each pitch it glides to as a note of its own (MIDI has no slide of its own here).
                    var parts = new List<(long On, long Off, int Pitch)>();
                    var segStart = on; var segPitch = pitch;
                    foreach (var (at, to) in note.Slides ?? [])
                    {
                        var cut = on + (long)Math.Round(at * stepTicks);
                        if (cut > segStart) parts.Add((segStart, cut, segPitch));
                        segStart = cut; segPitch = Math.Clamp(pitch + to, 0, 127);
                    }
                    parts.Add((segStart, Math.Max(segStart + 1, off), segPitch));
                    foreach (var (pOn, pOff, pp) in parts)
                    {
                        events.Add((pOn, 1, [(byte)(0x90 | ch), (byte)pp, vel]));
                        events.Add((pOff, 0, [(byte)(0x80 | ch), (byte)pp, 0]));
                    }
                }
            }
            var b = new List<byte>();
            Meta(b, 0x03, Encoding.UTF8.GetBytes(t.Name));
            if (ch != 9) { b.AddRange(Vlq(0)); b.Add((byte)(0xC0 | ch)); b.Add((byte)GmProgram(t)); }
            long last = 0;
            foreach (var e in events.OrderBy(e => e.Tick).ThenBy(e => e.Order))
            {
                b.AddRange(Vlq((int)(e.Tick - last))); b.AddRange(e.Data); last = e.Tick;
            }
            b.AddRange(Vlq(0)); b.AddRange([0xFF, 0x2F, 0]);
            tracks.Add([.. b]);
        }
        var ms = new MemoryStream();
        void Be(int v, int bytes) { for (var k = bytes - 1; k >= 0; k--) ms.WriteByte((byte)(v >> (8 * k))); }
        ms.Write("MThd"u8); Be(6, 4); Be(1, 2); Be(tracks.Count, 2); Be(ppq, 2);
        foreach (var tr in tracks) { ms.Write("MTrk"u8); Be(tr.Length, 4); ms.Write(tr); }
        return ms.ToArray();
    }

    /// <summary>A General MIDI instrument close to the track's sound.</summary>
    private static int GmProgram(SongTrack t) => t.Kind == "sample" ? 0 : t.Kind == "sf2" ? t.Instrument.FontProgram : t.Instrument.Wave switch
    {
        "square" or "pulse" => 80, // square lead
        "saw" => t.Instrument.Octave < 0 ? 38 : 81, // synth bass / saw lead
        "sine" => t.Instrument.Attack > 0.2 ? 89 : 79, // warm pad / ocarina
        "noise" => 122, // seashore
        "kick" => 118, // synth drum
        "drawn" => 80, // square lead
        _ => t.Instrument.Attack > 0.2 ? 88 : 4, // new-age pad / electric piano
    };

    private static byte[] Vlq(int v)
    {
        var bytes = new List<byte> { (byte)(v & 0x7F) };
        while ((v >>= 7) > 0) bytes.Insert(0, (byte)((v & 0x7F) | 0x80));
        return [.. bytes];
    }
}
