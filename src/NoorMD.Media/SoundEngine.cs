using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media;

// Sound Bench: procedural sound effects and ambiences. A recipe is a stack of layers (noise beds, streams of small
// events such as rain drops or crackles, and simple synth voices) shaped by filters, slow "gust" movement and a master
// section. Rendering is deterministic: the same recipe and seed always give the same sound, so a recipe kept next to a
// WAV can make it again (or make variations of it).

/// <summary>The descriptive controls of Quick mode (0–1). At the neutral values a preset sounds as it was made.</summary>
public sealed class SoundMacros
{
    /// <summary>gentle ↔ violent (neutral 0.5)</summary>
    public double Intensity { get; set; } = 0.5;
    /// <summary>calm ↔ gusty (neutral 0.5)</summary>
    public double Gust { get; set; } = 0.5;
    /// <summary>soft ↔ sharp (neutral 0.5)</summary>
    public double Brightness { get; set; } = 0.5;
    /// <summary>near ↔ distant (neutral 0)</summary>
    public double Distance { get; set; }
    /// <summary>outdoors ↔ indoors (neutral 0)</summary>
    public double Shelter { get; set; }
}

/// <summary>The slow, irregular movement that layers can follow (gusts of wind, swells of rain).</summary>
public sealed class GustSettings
{
    /// <summary>About how many swells per minute.</summary>
    public double Rate { get; set; } = 6;
    /// <summary>How strong the swells are (0–1).</summary>
    public double Depth { get; set; } = 0.5;
    /// <summary>The level between swells (0–1).</summary>
    public double Base { get; set; } = 0.4;
}

public sealed class SoundLayer
{
    /// <summary>"noise" (a bed of filtered noise), "events" (many small sounds: drops, crackles, steps), "synth" (a tone with a
    /// pitch sweep) or "sample" (a WAV file of your own).</summary>
    public string Type { get; set; } = "noise";
    /// <summary>A stable id ("L1"…) that modulation routes point to; kept when layers are reordered.</summary>
    public string Id { get; set; } = "";
    public string Name { get; set; } = "Layer";
    public bool Mute { get; set; }
    public bool Solo { get; set; }
    /// <summary>Level in dB.</summary>
    public double Gain { get; set; } = -12;
    /// <summary>-1 left … 1 right.</summary>
    public double Pan { get; set; }
    /// <summary>Stereo spread (0 mono … 1 wide).</summary>
    public double Width { get; set; } = 0.7;
    /// <summary>How much the level follows the gusts (0–1).</summary>
    public double GustAmount { get; set; }
    /// <summary>Start time (s) and envelope for one-shots: attack and release in seconds (release 0 = continuous).</summary>
    public double Start { get; set; }
    public double Attack { get; set; }
    public double Release { get; set; }

    // noise
    /// <summary>"white", "pink" or "brown".</summary>
    public string Color { get; set; } = "pink";
    /// <summary>"lowpass", "highpass", "bandpass" or "none".</summary>
    public string Filter { get; set; } = "lowpass";
    public double Freq { get; set; } = 1000;
    public double Q { get; set; } = 0.7;
    /// <summary>How much the filter opens with the gusts (0–1, up to two octaves).</summary>
    public double GustFilter { get; set; }
    /// <summary>Slow random wandering of the filter (0–1, up to half an octave): a whistle that isn't a fixed tone.</summary>
    public double Drift { get; set; }
    /// <summary>Its own irregular level movement (0–1) and how fast (per second).</summary>
    public double Wobble { get; set; }
    public double WobbleRate { get; set; } = 1;

    // events
    /// <summary>Events per second (at neutral intensity).</summary>
    public double Density { get; set; } = 20;
    /// <summary>How long each event rings (ms).</summary>
    public double Decay { get; set; } = 10;
    /// <summary>Pitch of the events (Hz) and its spread (octaves either way).</summary>
    public double Pitch { get; set; } = 3000;
    public double PitchSpread { get; set; } = 0.7;
    /// <summary>0 = a dry click, 1 = a ringing ping.</summary>
    public double Tone { get; set; } = 0.3;
    /// <summary>Random loudness of each event (dB).</summary>
    public double GainSpread { get; set; } = 6;

    // synth
    /// <summary>"sine", "square", "saw", "triangle" or "noise".</summary>
    public string Wave { get; set; } = "sine";
    /// <summary>Pitch at the end of the sweep (Hz); 0 = no sweep.</summary>
    public double PitchEnd { get; set; }
    public double Hold { get; set; }
    public double Vibrato { get; set; }
    public double VibratoRate { get; set; } = 6;
    /// <summary>Repeat every this many seconds (0 = once).</summary>
    public double Repeat { get; set; }
    /// <summary>Square wave: how much of each cycle is "up" (0.5 = even; small = thin and nasal).</summary>
    public double Duty { get; set; } = 0.5;
    /// <summary>FM: a second oscillator at this ratio of the pitch bends the tone (0 = off); depth = how much (bells, metal, sci-fi).</summary>
    public double FmRatio { get; set; }
    public double FmDepth { get; set; }
    /// <summary>A jump in pitch (semitones) this many seconds after each start (coins, confirmations).</summary>
    public double Arp { get; set; }
    public double ArpTime { get; set; } = 0.08;

    // events
    /// <summary>0 = at random moments (rain), 1 = evenly spaced (steps, ticks).</summary>
    public double Rhythm { get; set; }
    /// <summary>Each event is a cluster of this many small hits, spread over BurstSpread ms (gravel, rattles).</summary>
    public int Burst { get; set; } = 1;
    public double BurstSpread { get; set; } = 30;

    // shaping (any layer)
    /// <summary>The filter's frequency at the end of the envelope (0 = it stays): whooshes, risers, closing sounds.</summary>
    public double FreqEnd { get; set; }
    /// <summary>Synth and sample layers go through the filter only when this is on (noise always does).</summary>
    public bool UseFilter { get; set; }
    /// <summary>Saturation (0–1): warmth, grit, distortion.</summary>
    public double Drive { get; set; }
    /// <summary>Retro (0–1): fewer samples per second and fewer bits.</summary>
    public double Crush { get; set; }

    // sample
    /// <summary>A WAV file of your own (its full path) and its name for show.</summary>
    public string? Path { get; set; }
    public string? SampleName { get; set; }
    /// <summary>Pitch change in semitones (it also changes the speed, as on a tape).</summary>
    public double Semitones { get; set; }
    /// <summary>The part of the file used (seconds; TrimEnd 0 = to its end), backwards or not, and looped back to back or not.</summary>
    public double TrimStart { get; set; }
    public double TrimEnd { get; set; }
    public bool Reverse { get; set; }
    public bool LoopSample { get; set; }
    /// <summary>A looped sample's crossfade where its end flows back into its start (seconds; 0 = back to back, as before).</summary>
    public double LoopFade { get; set; }
    /// <summary>
    /// How the sample is played: "tape" (pitch changes the speed, as before), "stretch" (pitch and speed apart, made of
    /// small overlapping grains) or "grains" (a cloud of grains from around a position: textures, pads, swarms).
    /// </summary>
    public string PlayMode { get; set; } = "tape";
    /// <summary>Stretch: how fast it plays through the sample (1 = as recorded; 0.5 = twice as long, same pitch).</summary>
    public double Speed { get; set; } = 1;
    /// <summary>Stretch and grains: the length of each grain (ms).</summary>
    public double GrainSize { get; set; } = 80;
    /// <summary>Grains: grains per second (Rhythm spaces them evenly or at random).</summary>
    public double GrainDensity { get; set; } = 40;
    /// <summary>Grains: where in the used part they come from (0–1), how far around it (0–1) and how fast it moves (parts per second, ±).</summary>
    public double Position { get; set; } = 0.5;
    public double PositionSpread { get; set; } = 0.2;
    public double Scan { get; set; }
    /// <summary>Grains: random pitch of each grain, in semitones either way.</summary>
    public double GrainPitch { get; set; }

    /// <summary>This layer's effects, in order (EQ, compressor, delay…).</summary>
    public List<SoundEffect> Effects { get; set; } = [];

    /// <summary>How much of this layer also goes to each bus (after its own effects, level and pan).</summary>
    public List<SoundSend> Sends { get; set; } = [];

    public SoundLayer Clone() { var c = (SoundLayer)MemberwiseClone(); c.Effects = Effects.Select(e => e.Clone()).ToList(); c.Sends = Sends.Select(x => new SoundSend { Bus = x.Bus, Level = x.Level }).ToList(); return c; }
}

public sealed class MasterSettings
{
    public double Gain { get; set; }
    public double HighPass { get; set; } = 20;
    public double LowPass { get; set; } = 20000;
    public double Width { get; set; } = 1;
    /// <summary>Room sound (0 dry … 1 very wet) and room size (0 small … 1 large).</summary>
    public double Reverb { get; set; }
    public double Room { get; set; } = 0.5;
    /// <summary>Bring the loudest peak to the ceiling (one-shots); otherwise only peaks above it are softened.</summary>
    public bool Normalize { get; set; }
    public double Ceiling { get; set; } = -1;
    /// <summary>
    /// Loudness the finished sound is brought to (LUFS, as streaming services and game audio guides measure it; 0 = off).
    /// Applied after Normalize, before the ceiling's limiter, so a set of sounds made with the same target sit together.
    /// It never raises a sound past the ceiling (by true peak): a very peaky one stays a little under the target.
    /// </summary>
    public double TargetLufs { get; set; }
    /// <summary>Effects on the whole sound, in order, after the master filters and room.</summary>
    public List<SoundEffect> Effects { get; set; } = [];
}

/// <summary>
/// A bus: effects shared by the layers that send to it (one reverb for all, so they sound like one place). Its
/// output joins the layers before the master.
/// </summary>
public sealed class SoundBus
{
    public const int Max = 4;
    public string Id { get; set; } = "";
    public string Name { get; set; } = "Bus";
    /// <summary>The bus's level (dB) as it joins the mix.</summary>
    public double Gain { get; set; }
    public bool Mute { get; set; }
    public List<SoundEffect> Effects { get; set; } = [];
}

/// <summary>A layer's send to a bus, in dB (−60 and below is off).</summary>
public sealed class SoundSend
{
    public const int Max = SoundBus.Max;
    public string Bus { get; set; } = "";
    public double Level { get; set; } = -12;
}

public sealed class SoundRecipe
{
    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Untitled sound";
    public string Family { get; set; } = "Custom";
    public int Seed { get; set; } = 1;
    /// <summary>Length in seconds (a loop's length; a one-shot's length).</summary>
    public double Duration { get; set; } = 10;
    /// <summary>A seamless loop (the end flows into the start) or a one-shot.</summary>
    public bool Loop { get; set; } = true;
    public SoundMacros Macros { get; set; } = new();
    public GustSettings Gust { get; set; } = new();
    public List<SoundLayer> Layers { get; set; } = [];
    public MasterSettings Master { get; set; } = new();
    /// <summary>LFOs, envelopes, random, steps and drawn curves that routes can use.</summary>
    public List<SoundModulator> Modulators { get; set; } = [];
    /// <summary>Named Quick-mode controls ("Motor RPM") that routes can use.</summary>
    public List<SoundKnob> Knobs { get; set; } = [];
    /// <summary>Source → target connections.</summary>
    public List<SoundRoute> Routes { get; set; } = [];
    /// <summary>Buses (shared effects) that layers send to.</summary>
    public List<SoundBus> Buses { get; set; } = [];

    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.Never };

    public string ToJson() => JsonSerializer.Serialize(this, Options);

    /// <summary>Reads a recipe and keeps every value within its sensible range.</summary>
    public static SoundRecipe FromJson(string json)
    {
        var r = JsonSerializer.Deserialize<SoundRecipe>(json, Options) ?? throw new ArgumentException("That is not a sound recipe.");
        return r.Clamped();
    }

    public SoundRecipe Clone() => FromJson(ToJson());

    /// <summary>
    /// For a recipe opened from a file: a sample named by a relative path is looked for next to the recipe, and one whose
    /// full path is gone (the folder was moved or copied elsewhere) is found next to the recipe if a file of that name is there.
    /// </summary>
    public SoundRecipe FindSamplesBeside(string folder)
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
        foreach (var l in Layers) if (l.Type == "sample") l.Path = Find(l.Path);
        foreach (var fx in AllEffects()) if (fx.Type == "convolution") fx.IrPath = Find(fx.IrPath);
        return this;
    }

    /// <summary>Every effect in the recipe: the layers', the buses' and the master's.</summary>
    public IEnumerable<SoundEffect> AllEffects() =>
        (Layers ?? []).SelectMany(l => l.Effects ?? []).Concat((Buses ?? []).SelectMany(b => b.Effects ?? [])).Concat(Master?.Effects ?? []);

    /// <summary>Every file the recipe reads: sample layers' WAVs and recorded spaces.</summary>
    public IEnumerable<string> Files() =>
        (Layers ?? []).Where(l => l.Type == "sample" && !string.IsNullOrEmpty(l.Path)).Select(l => l.Path!)
            .Concat(AllEffects().Where(fx => fx.Type == "convolution" && !string.IsNullOrEmpty(fx.IrPath)).Select(fx => fx.IrPath!));

    private static double C(double v, double lo, double hi) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : lo;

    public SoundRecipe Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Untitled sound" : Name.Trim()[..Math.Min(Name.Trim().Length, 80)];
        Family = string.IsNullOrWhiteSpace(Family) ? "Custom" : Family.Trim()[..Math.Min(Family.Trim().Length, 40)];
        Duration = C(Duration, 0.05, 600);
        Macros ??= new(); Gust ??= new(); Master ??= new(); Layers ??= [];
        Macros.Intensity = C(Macros.Intensity, 0, 1); Macros.Gust = C(Macros.Gust, 0, 1); Macros.Brightness = C(Macros.Brightness, 0, 1);
        Macros.Distance = C(Macros.Distance, 0, 1); Macros.Shelter = C(Macros.Shelter, 0, 1);
        Gust.Rate = C(Gust.Rate, 0.5, 60); Gust.Depth = C(Gust.Depth, 0, 1); Gust.Base = C(Gust.Base, 0, 1);
        if (Layers.Count > 16) Layers = Layers.Take(16).ToList();
        foreach (var l in Layers)
        {
            l.Type = l.Type is "noise" or "events" or "synth" or "sample" ? l.Type : "noise";
            l.Name = string.IsNullOrWhiteSpace(l.Name) ? "Layer" : l.Name.Trim()[..Math.Min(l.Name.Trim().Length, 60)];
            l.Gain = C(l.Gain, -80, 12); l.Pan = C(l.Pan, -1, 1); l.Width = C(l.Width, 0, 1); l.GustAmount = C(l.GustAmount, 0, 1);
            l.Start = C(l.Start, 0, 600); l.Attack = C(l.Attack, 0, 60); l.Release = C(l.Release, 0, 120);
            l.Color = l.Color is "white" or "pink" or "brown" ? l.Color : "pink";
            l.Filter = l.Filter is "lowpass" or "highpass" or "bandpass" or "none" ? l.Filter : "lowpass";
            l.Freq = C(l.Freq, 20, 20000); l.Q = C(l.Q, 0.1, 60); l.GustFilter = C(l.GustFilter, 0, 1); l.Drift = C(l.Drift, 0, 1);
            l.Wobble = C(l.Wobble, 0, 1); l.WobbleRate = C(l.WobbleRate, 0.05, 20);
            l.Density = C(l.Density, 0, 5000); l.Decay = C(l.Decay, 0.5, 3000); l.Pitch = C(l.Pitch, 20, 16000); l.PitchSpread = C(l.PitchSpread, 0, 3);
            l.Tone = C(l.Tone, 0, 1); l.GainSpread = C(l.GainSpread, 0, 30);
            l.Wave = l.Wave is "sine" or "square" or "saw" or "triangle" or "noise" ? l.Wave : "sine";
            l.PitchEnd = C(l.PitchEnd, 0, 16000); l.Hold = C(l.Hold, 0, 60); l.Vibrato = C(l.Vibrato, 0, 5); l.VibratoRate = C(l.VibratoRate, 0.1, 30); l.Repeat = C(l.Repeat, 0, 60);
            l.Duty = C(l.Duty, 0.05, 0.95); l.FmRatio = C(l.FmRatio, 0, 16); l.FmDepth = C(l.FmDepth, 0, 20); l.Arp = C(l.Arp, -36, 36); l.ArpTime = C(l.ArpTime, 0.001, 10);
            l.Rhythm = C(l.Rhythm, 0, 1); l.Burst = (int)C(l.Burst, 1, 40); l.BurstSpread = C(l.BurstSpread, 0, 1000);
            l.FreqEnd = l.FreqEnd <= 0 ? 0 : C(l.FreqEnd, 20, 20000); l.Drive = C(l.Drive, 0, 1); l.Crush = C(l.Crush, 0, 1);
            l.Semitones = C(l.Semitones, -36, 36); l.TrimStart = C(l.TrimStart, 0, 3600); l.TrimEnd = C(l.TrimEnd, 0, 3600);
            l.LoopFade = C(l.LoopFade, 0, 10); l.PlayMode = l.PlayMode is "stretch" or "grains" ? l.PlayMode : "tape"; l.Speed = C(l.Speed, 0.05, 8);
            l.GrainSize = C(l.GrainSize, 5, 1000); l.GrainDensity = C(l.GrainDensity, 0.5, 500); l.Position = C(l.Position, 0, 1); l.PositionSpread = C(l.PositionSpread, 0, 1);
            l.Scan = double.IsFinite(l.Scan) ? Math.Clamp(l.Scan, -4, 4) : 0; l.GrainPitch = C(l.GrainPitch, 0, 24);
            if (l.Path != null && (l.Path.Length > 1000 || l.Path.Any(char.IsControl))) l.Path = null;
            if (l.SampleName != null) l.SampleName = l.SampleName.Length > 120 ? l.SampleName[..120] : l.SampleName;
            l.Effects = (l.Effects ?? []).Where(e => e != null).Take(SoundEffect.MaxPerChain).Select(e => e.Clamped()).ToList();
        }
        Master.Gain = C(Master.Gain, -40, 24); Master.HighPass = C(Master.HighPass, 10, 5000); Master.LowPass = C(Master.LowPass, 200, 20000);
        Master.Width = C(Master.Width, 0, 2); Master.Reverb = C(Master.Reverb, 0, 1); Master.Room = C(Master.Room, 0, 1); Master.Ceiling = C(Master.Ceiling, -24, 0);
        Master.TargetLufs = double.IsFinite(Master.TargetLufs) && Master.TargetLufs < 0 ? Math.Clamp(Master.TargetLufs, -40, -6) : 0;
        Master.Effects = (Master.Effects ?? []).Where(e => e != null).Take(SoundEffect.MaxPerChain).Select(e => e.Clamped()).ToList();
        // Stable ids: an item keeps a valid id (the first of repeats keeps it); the others get the lowest free number.
        // Two passes, so a copy placed before the original never takes an id a later item already has.
        static bool Valid(string? id, string prefix) => id != null && id.Length is > 1 and <= 8 && id.StartsWith(prefix, StringComparison.Ordinal) && id[1..].All(char.IsAsciiDigit);
        static void Assign<T>(IReadOnlyList<T> items, string prefix, Func<T, string> get, Action<T, string> set, HashSet<string>? used = null)
        {
            used ??= new HashSet<string>(StringComparer.Ordinal);
            var keep = items.Select(it => Valid(get(it), prefix) && used.Add(get(it))).ToList();
            for (var i = 0; i < items.Count; i++)
            {
                if (keep[i]) continue;
                var n = 1;
                while (!used.Add(prefix + n)) n++;
                set(items[i], prefix + n);
            }
        }
        Assign(Layers, "L", l => l.Id, (l, v) => l.Id = v);
        foreach (var l in Layers) Assign(l.Effects, "F", e => e.Id, (e, v) => e.Id = v);
        Assign(Master.Effects, "F", e => e.Id, (e, v) => e.Id = v);
        Buses = (Buses ?? []).Where(b => b != null).Take(SoundBus.Max).ToList();
        foreach (var b in Buses)
        {
            b.Name = string.IsNullOrWhiteSpace(b.Name) ? "Bus" : b.Name.Trim()[..Math.Min(b.Name.Trim().Length, 40)];
            b.Gain = C(b.Gain, -60, 12);
            b.Effects = (b.Effects ?? []).Where(e => e != null).Take(SoundEffect.MaxPerChain).Select(e => e.Clamped()).ToList();
        }
        Assign(Buses, "B", b => b.Id, (b, v) => b.Id = v);
        foreach (var b in Buses) Assign(b.Effects, "F", e => e.Id, (e, v) => e.Id = v);
        var busIds = Buses.Select(b => b.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var l in Layers)
            l.Sends = (l.Sends ?? []).Where(x => x != null && busIds.Contains(x.Bus ?? "")).GroupBy(x => x.Bus).Select(g => g.First())
                .Select(x => { x.Level = C(x.Level, -60, 6); return x; }).ToList();
        Modulators = (Modulators ?? []).Where(m => m != null).Take(SoundModulator.Max).Select(m => m.Clamped()).ToList();
        Knobs = (Knobs ?? []).Where(k => k != null).Take(SoundKnob.Max).Select(k => k.Clamped()).ToList();
        var sources = new HashSet<string>(StringComparer.Ordinal);
        Assign(Modulators, "M", m => m.Id, (m, v) => m.Id = v, sources);
        Assign(Knobs, "K", k => k.Id, (k, v) => k.Id = v, sources);
        Routes = (Routes ?? []).Where(x => x != null).Take(SoundRoute.Max).Select(x => x.Clamped()).ToList();
        return this;
    }

    /// <summary>The recipe with the Quick controls worked into its layers and master (what is actually rendered).</summary>
    public SoundRecipe WithMacrosApplied()
    {
        var r = Clone();
        var m = r.Macros;
        var intensity = m.Intensity - 0.5; // -0.5 … 0.5
        r.Gust.Depth = Math.Clamp(r.Gust.Depth * (0.2 + 1.6 * m.Gust) * (1 + intensity * 0.6), 0, 1);
        r.Gust.Rate *= 0.6 + 0.8 * m.Gust;
        foreach (var l in r.Layers)
        {
            l.Gain += intensity * 14;
            if (l.Type == "events") { l.Density *= Math.Pow(2, intensity * 3.2); l.Gain -= m.Distance * 10 + m.Shelter * 6; l.Pitch *= Math.Pow(2, (m.Brightness - 0.5) * 0.8); }
            if (l.Type == "noise" && l.Filter != "none") l.Freq = Math.Clamp(l.Freq * Math.Pow(2, (m.Brightness - 0.5) * 2 + intensity * 0.8), 20, 20000);
            l.Width *= 1 - 0.5 * m.Distance;
        }
        // Far away: the highs go first. Indoors: muffled, with a room.
        var lp = 20000 * Math.Pow(2500.0 / 20000, Math.Pow(m.Distance, 1.3)) * Math.Pow(900.0 / 20000, m.Shelter * 0.75);
        r.Master.LowPass = Math.Min(r.Master.LowPass, lp);
        r.Master.Reverb = Math.Clamp(r.Master.Reverb + m.Distance * 0.25 + m.Shelter * 0.3, 0, 1);
        if (m.Shelter > 0) r.Master.Room = Math.Min(r.Master.Room, 1 - m.Shelter * 0.6);
        r.Master.Gain -= m.Distance * 4;
        return r;
    }
}

/// <summary>A rendered sound: stereo samples (−1…1) and what it measured.</summary>
/// <summary>How loud a part of a mix got at its loudest (a track or a bus of a song, after its level and place).</summary>
public sealed record SoundLevel(string Name, double PeakDb);

public sealed class SoundRender
{
    /// <summary>A song's tracks and buses at their loudest, in this render (for the mixer); null for other sounds.</summary>
    public IReadOnlyList<SoundLevel>? Levels { get; init; }
    public required int SampleRate { get; init; }
    public required float[] Left { get; init; }
    public required float[] Right { get; init; }
    public double PeakDb { get; init; }
    public double RmsDb { get; init; }
    /// <summary>What couldn't be used (a sample file that is missing or not allowed).</summary>
    public IReadOnlyList<string> Warnings { get; init; } = [];
    public double Seconds => (double)Left.Length / SampleRate;

    /// <summary>Loudness, true peak, stereo, brightness, DC and loop seam (see <see cref="SoundAnalysis"/>).</summary>
    public SoundMeasure Measure() => SoundAnalysis.Measure(Left, Right, SampleRate);

    /// <summary>Min/max of each of <paramref name="buckets"/> slices of the mono mix (for drawing the waveform).</summary>
    public float[] Peaks(int buckets)
    {
        buckets = Math.Clamp(buckets, 1, 4000);
        var outp = new float[buckets * 2];
        var n = Left.Length;
        for (var b = 0; b < buckets; b++)
        {
            int from = (int)((long)b * n / buckets), to = (int)Math.Max(from + 1, (long)(b + 1) * n / buckets);
            float lo = 0, hi = 0;
            for (var i = from; i < to && i < n; i++) { var v = (Left[i] + Right[i]) * 0.5f; if (v < lo) lo = v; if (v > hi) hi = v; }
            outp[b * 2] = lo; outp[b * 2 + 1] = hi;
        }
        return outp;
    }

    /// <summary>A PCM WAV file (16 or 24 bit, stereo).</summary>
    public byte[] ToWav(int bits = 16)
    {
        if (bits is not (16 or 24)) throw new ArgumentException("WAV is written as 16 or 24 bit.");
        var bytesPer = bits / 8;
        var dataLen = Left.Length * 2 * bytesPer;
        var ms = new MemoryStream(44 + dataLen);
        void W32(int v) { ms.WriteByte((byte)v); ms.WriteByte((byte)(v >> 8)); ms.WriteByte((byte)(v >> 16)); ms.WriteByte((byte)(v >> 24)); }
        void W16(int v) { ms.WriteByte((byte)v); ms.WriteByte((byte)(v >> 8)); }
        ms.Write("RIFF"u8); W32(36 + dataLen); ms.Write("WAVEfmt "u8); W32(16); W16(1); W16(2); W32(SampleRate); W32(SampleRate * 2 * bytesPer); W16(2 * bytesPer); W16(bits);
        ms.Write("data"u8); W32(dataLen);
        var max = bits == 16 ? 32767.0 : 8388607.0;
        // TPDF dither for 16-bit, so quiet tails fade smoothly instead of stepping.
        var rng = new SoundRng(0x5eed);
        for (var i = 0; i < Left.Length; i++)
            foreach (var s in new[] { Left[i], Right[i] })
            {
                var d = bits == 16 ? (rng.NextDouble() - rng.NextDouble()) : 0;
                var v = (int)Math.Round(Math.Clamp(s, -1f, 1f) * max + d);
                v = (int)Math.Clamp(v, -max - 1, max);
                if (bits == 16) W16(v); else { ms.WriteByte((byte)v); ms.WriteByte((byte)(v >> 8)); ms.WriteByte((byte)(v >> 16)); }
            }
        return ms.ToArray();
    }
}

/// <summary>A small, fast, seedable random generator (SplitMix64), so renders repeat exactly.</summary>
public sealed class SoundRng(ulong seed)
{
    private ulong _s = seed;
    public ulong Next() { var z = _s += 0x9E3779B97F4A7C15UL; z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL; z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL; return z ^ (z >> 31); }
    public double NextDouble() => (Next() >> 11) * (1.0 / (1UL << 53));
    public double Bipolar() => NextDouble() * 2 - 1;
    public double Gaussian() { var u = 1 - NextDouble(); var v = NextDouble(); return Math.Sqrt(-2 * Math.Log(u)) * Math.Cos(2 * Math.PI * v); }
}

public static class SoundEngine
{
    private const int Block = 32; // filter settings and movement are updated every 32 samples

    /// <param name="samples">Reads a sample layer's file (null when it can't or may not be used).</param>
    /// <param name="timeline">The length (seconds) drawn curves span; by default the recipe's. A preview that renders only
    /// the start of a long sound passes the full length, so its automation is heard where it will be in the export.</param>
    public static SoundRender Render(SoundRecipe recipe, int sampleRate = 48000, Func<string, SampleAudio?>? samples = null, double? timeline = null) =>
        RenderCore(recipe, sampleRate, samples, timeline, null, null, out _);

    /// <summary>
    /// The whole sound, then each layer that is heard on its own (with its share of the buses): stems that line up with
    /// the mix. Normalising and the loudness target are worked out once, on the mix, and the same gain is given to every
    /// stem, so a quiet layer stays quiet and the stems added together come close to the mix.
    /// </summary>
    public static IReadOnlyList<(string Name, SoundRender Render)> RenderStems(SoundRecipe recipe, int sampleRate = 48000, Func<string, SampleAudio?>? samples = null)
    {
        var mix = RenderCore(recipe, sampleRate, samples, null, null, null, out var scale);
        var r = recipe.Clone().Clamped();
        var soloing = r.Layers.Any(l => l.Solo && !l.Mute);
        var stems = new List<(string, SoundRender)> { ("Mix", mix) };
        for (var k = 0; k < r.Layers.Count; k++)
        {
            var layer = r.Layers[k];
            if (layer.Mute || (soloing && !layer.Solo)) continue;
            var only = k;
            stems.Add((layer.Name, RenderCore(recipe, sampleRate, samples, null, i => i == only, scale, out _)));
        }
        return stems;
    }

    /// <param name="keep">Only these layers (by index) are rendered: a stem.</param>
    /// <param name="fixedScale">The gain normalising and the loudness target gave the mix, used instead of working them out again.</param>
    /// <param name="scale">The gain normalising and the loudness target gave (1 when neither is on).</param>
    private static SoundRender RenderCore(SoundRecipe recipe, int sampleRate, Func<string, SampleAudio?>? samples, double? timeline,
        Func<int, bool>? keep, double? fixedScale, out double scale)
    {
        if (sampleRate is < 8000 or > 192000) throw new ArgumentException("Sample rate out of range.");
        var r = recipe.Clone().Clamped().WithMacrosApplied();
        var length = (int)Math.Round(r.Duration * sampleRate);
        // A loop is rendered a little longer: that extra part is blended into its start, so the end flows into it.
        var fade = r.Loop ? (int)Math.Min(length * 0.25, 2.0 * sampleRate) : 0;
        var total = length + fade;
        var L = new double[total];
        var R = new double[total];
        var gust = GustCurve(r, total, sampleRate);
        var soloing = r.Layers.Any(l => l.Solo && !l.Mute);
        var warnings = new List<string>();
        var mods = new ModulationField(r, sampleRate, total, timeline is > 0 and < 3600 ? (int)Math.Round(timeline.Value * sampleRate) : length);
        // A recorded space that can't be read is reported (the effect then lets the sound through as if it were off).
        foreach (var fx in r.Layers.Where(l => !l.Mute).SelectMany(l => l.Effects).Concat(r.Buses.Where(b => !b.Mute).SelectMany(b => b.Effects)).Concat(r.Master.Effects))
            if (fx.Type == "convolution" && !fx.Bypass && fx.Space == "file" && (string.IsNullOrEmpty(fx.IrPath) || samples?.Invoke(fx.IrPath) == null))
                warnings.Add($"“{fx.IrName ?? "Recorded space"}”: the recording of the space is missing or can't be read");
        var buses = r.Buses.Where(b => !b.Mute).ToDictionary(b => b.Id, _ => (L: new double[total], R: new double[total]), StringComparer.Ordinal);
        for (var k = 0; k < r.Layers.Count; k++)
        {
            var layer = r.Layers[k];
            if (layer.Mute || (soloing && !layer.Solo) || (keep != null && !keep(k))) continue;
            var sends = layer.Sends.Where(x => x.Level > -60 && buses.ContainsKey(x.Bus)).ToList();
            // Each layer has its own random stream: muting one doesn't change the others.
            var rng = new SoundRng((ulong)(uint)r.Seed * 0x100000001B3UL + (ulong)k * 0x9E37UL + 17);
            // Drive, crush and a filter on a synth or a sample work on the layer alone, before it joins the others.
            var md = new LayerMod(mods.For(layer.Id + ":pitch"), mods.For(layer.Id + ":freq"), mods.For(layer.Id + ":density"), mods.For(layer.Id + ":position"));
            var gainMod = mods.For(layer.Id + ":gain");
            var panMod = mods.For(layer.Id + ":pan");
            var post = layer.Drive > 0.001 || layer.Crush > 0.001 || (layer.Type is "synth" or "sample" && layer.UseFilter && layer.Filter != "none") || layer.Effects.Any(e => !e.Bypass)
                || gainMod != null || panMod != null || sends.Count > 0;
            var tl = post ? new double[total] : L;
            var tr = post ? new double[total] : R;
            switch (layer.Type)
            {
                case "noise": RenderNoise(layer, rng, gust, tl, tr, sampleRate, total, md); break;
                case "events": RenderEvents(layer, rng, gust, tl, tr, sampleRate, total, md); break;
                case "synth": RenderSynth(layer, rng, tl, tr, sampleRate, total, md); break;
                case "sample":
                {
                    var audio = string.IsNullOrEmpty(layer.Path) ? null : samples?.Invoke(layer.Path);
                    if (audio == null) { warnings.Add($"“{layer.SampleName ?? layer.Name}”: the file is missing or can't be read"); continue; }
                    if (layer.PlayMode == "tape") RenderSample(layer, audio, tl, tr, sampleRate, total, md);
                    else RenderGrains(layer, audio, rng, tl, tr, sampleRate, total, md);
                    break;
                }
            }
            if (post)
            {
                PostLayer(layer, tl, tr, sampleRate, total, md);
                GainPan(tl, tr, gainMod, panMod);
                SoundEffects.Apply(layer.Effects, tl, tr, sampleRate, (fx, param) => mods.For($"{layer.Id}/{fx.Id}:{param}"), samples);
                for (var i = 0; i < total; i++) { L[i] += tl[i]; R[i] += tr[i]; }
                foreach (var send in sends)
                {
                    var (bl, br) = buses[send.Bus];
                    var g = Math.Pow(10, send.Level / 20);
                    for (var i = 0; i < total; i++) { bl[i] += tl[i] * g; br[i] += tr[i] * g; }
                }
            }
        }
        // Buses: their effects on what the layers sent, then their level, joining the mix before the master.
        foreach (var bus in r.Buses)
        {
            if (!buses.TryGetValue(bus.Id, out var b)) continue;
            SoundEffects.Apply(bus.Effects, b.L, b.R, sampleRate, (fx, param) => mods.For($"{bus.Id}/{fx.Id}:{param}"), samples);
            GainPan(b.L, b.R, mods.For(bus.Id + ":gain"), null);
            var g = Math.Pow(10, bus.Gain / 20);
            for (var i = 0; i < total; i++) { L[i] += b.L[i] * g; R[i] += b.R[i] * g; }
        }
        MasterChain(r.Master, L, R, sampleRate, mods.For("master:lowpass"));
        SoundEffects.Apply(r.Master.Effects, L, R, sampleRate, (fx, param) => mods.For($"master/{fx.Id}:{param}"), samples);
        GainPan(L, R, mods.For("master:gain"), null);
        float[] outL = new float[length], outR = new float[length];
        for (var i = 0; i < length; i++)
        {
            double l = L[i], rr = R[i];
            if (i < fade)
            {
                // Equal-power blend: sample 0 is the sample that follows the last one, so the loop has no seam.
                var t = (double)i / fade * Math.PI / 2;
                l = L[i] * Math.Sin(t) + L[length + i] * Math.Cos(t);
                rr = R[i] * Math.Sin(t) + R[length + i] * Math.Cos(t);
            }
            outL[i] = (float)l; outR[i] = (float)rr;
        }
        if (!r.Loop) FadeEdges(outL, outR, sampleRate);
        var peak = 0.0;
        for (var i = 0; i < length; i++) peak = Math.Max(peak, Math.Max(Math.Abs(outL[i]), Math.Abs(outR[i])));
        var ceiling = Math.Pow(10, r.Master.Ceiling / 20);
        scale = 1;
        if (fixedScale is { } fixedGain)
        {
            if (fixedGain != 1) Scale(outL, outR, fixedGain);
            scale = fixedGain;
            Limit(outL, outR, ceiling);
        }
        else
        {
            if (r.Master.Normalize && peak > 1e-6) { Scale(outL, outR, ceiling / peak); scale *= ceiling / peak; }
            if (r.Master.TargetLufs < 0) scale *= ToLoudness(outL, outR, sampleRate, r.Master.TargetLufs, ceiling);
            Limit(outL, outR, ceiling);
            if (r.Master.TargetLufs < 0)
            {
                // The limiter's soft knee can take a little off: measure again and make that up (once, within the same limit).
                var (after, _, _) = SoundAnalysis.Loudness(outL, outR, sampleRate);
                if (after > -100 && r.Master.TargetLufs - after > 0.1) { scale *= ToLoudness(outL, outR, sampleRate, r.Master.TargetLufs, ceiling); Limit(outL, outR, ceiling); }
            }
        }
        double sumSq = 0; peak = 0;
        for (var i = 0; i < length; i++)
        {
            sumSq += (outL[i] * (double)outL[i] + outR[i] * (double)outR[i]) / 2;
            peak = Math.Max(peak, Math.Max(Math.Abs(outL[i]), Math.Abs(outR[i])));
        }
        var rms = Math.Sqrt(sumSq / Math.Max(1, length));
        return new SoundRender { SampleRate = sampleRate, Left = outL, Right = outR, PeakDb = Db(peak), RmsDb = Db(rms), Warnings = warnings };
    }

    /// <summary>Modulation a layer's own sound follows: pitch (semitones), filter (octaves) and event density (octaves).</summary>
    private sealed record LayerMod(double[]? Pitch, double[]? Freq, double[]? Density, double[]? Position = null)
    {
        public double PositionOffset(int i) => Position == null ? 0 : ModulationField.At(Position, i);
        public double PitchFactor(int i) => Pitch == null ? 1 : Math.Pow(2, ModulationField.At(Pitch, i) / 12);
        public double FreqFactor(int block) => Freq == null ? 1 : Math.Pow(2, Freq[Math.Min(block, Freq.Length - 1)]);
        public double DensityFactor(int block) => Density == null ? 1 : Math.Pow(2, Density[Math.Min(block, Density.Length - 1)]);
    }

    /// <summary>Level (dB) and pan (−1…1, a balance) moving over time.</summary>
    private static void GainPan(double[] L, double[] R, double[]? gain, double[]? pan)
    {
        if (gain == null && pan == null) return;
        for (var i = 0; i < L.Length; i++)
        {
            var g = gain == null ? 1 : Math.Pow(10, ModulationField.At(gain, i) / 20);
            double gl = g, gr = g;
            if (pan != null)
            {
                var p = Math.Clamp(ModulationField.At(pan, i), -1, 1);
                gl *= p > 0 ? 1 - p : 1; gr *= p < 0 ? 1 + p : 1;
            }
            L[i] *= gl; R[i] *= gr;
        }
    }

    private static double Db(double v) => v > 1e-9 ? Math.Round(20 * Math.Log10(v), 1) : -120;

    /// <summary>
    /// The gusts: a smooth, irregular curve (0–1), one value per block. Swells come at random spacing around the rate,
    /// rise a little faster than they fall, and are never a regular cycle.
    /// </summary>
    private static double[] GustCurve(SoundRecipe r, int total, int sr)
    {
        var blocks = total / Block + 2;
        var g = new double[blocks];
        var rng = new SoundRng((ulong)(uint)r.Seed * 31 + 7);
        var mean = 60.0 / Math.Max(0.5, r.Gust.Rate); // seconds between swells
        double t0 = 0, v0 = rng.NextDouble(), t1 = mean * (0.4 + rng.NextDouble()), v1 = rng.NextDouble();
        var fast = new SoundRng((ulong)(uint)r.Seed * 131 + 3);
        double f0 = 0, f1 = fast.Bipolar(), ft = 0;
        for (var b = 0; b < blocks; b++)
        {
            var t = (double)b * Block / sr;
            while (t > t1) { t0 = t1; v0 = v1; t1 += mean * (0.35 + 1.3 * rng.NextDouble()); v1 = Math.Pow(rng.NextDouble(), 1.6); }
            var x = (t - t0) / (t1 - t0);
            x = v1 > v0 ? Math.Pow(x, 0.75) : Math.Pow(x, 1.25); // swells rise faster than they die away
            var s = x * x * (3 - 2 * x);
            var slow = v0 + (v1 - v0) * s;
            // A little faster flutter on top.
            ft += (double)Block / sr * 1.7;
            if (ft >= 1) { ft -= 1; f0 = f1; f1 = fast.Bipolar(); }
            var fs = ft * ft * (3 - 2 * ft);
            var flutter = (f0 + (f1 - f0) * fs) * 0.12;
            g[b] = Math.Clamp(r.Gust.Base + r.Gust.Depth * (slow - 0.35) * 1.6 + flutter * r.Gust.Depth, 0, 1);
        }
        return g;
    }

    /// <summary>A one-shot envelope from a layer's start, attack and release (1 throughout when release is 0).</summary>
    private static double Envelope(SoundLayer l, double t)
    {
        if (t < l.Start) return 0;
        var u = t - l.Start;
        var a = l.Attack > 0 ? Math.Min(1, u / l.Attack) : 1;
        if (l.Release <= 0) return a;
        var d = u - l.Attack - l.Hold;
        return d <= 0 ? a : a * Math.Exp(-d * 6.9 / l.Release); // −60 dB after Release seconds
    }

    private sealed class Biquad
    {
        private double _b0, _b1, _b2, _a1, _a2, _x1, _x2, _y1, _y2;
        public void Set(string type, double freq, double q, int sr)
        {
            freq = Math.Clamp(freq, 10, sr * 0.45);
            var w = 2 * Math.PI * freq / sr;
            double cos = Math.Cos(w), alpha = Math.Sin(w) / (2 * Math.Max(0.05, q));
            double b0, b1, b2, a0 = 1 + alpha;
            switch (type)
            {
                case "highpass": b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; break;
                case "bandpass": b0 = alpha; b1 = 0; b2 = -alpha; break;
                default: b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; break;
            }
            _b0 = b0 / a0; _b1 = b1 / a0; _b2 = b2 / a0; _a1 = -2 * cos / a0; _a2 = (1 - alpha) / a0;
        }
        public double Run(double x)
        {
            var y = _b0 * x + _b1 * _x1 + _b2 * _x2 - _a1 * _y1 - _a2 * _y2;
            _x2 = _x1; _x1 = x; _y2 = _y1; _y1 = y;
            return y;
        }
    }

    /// <summary>Pink noise (Paul Kellet's filter), brown noise (leaky integration) or white.</summary>
    private sealed class NoiseSource(string color, SoundRng rng)
    {
        private double _b0, _b1, _b2, _b3, _b4, _b5, _b6, _brown;
        public double Next()
        {
            var w = rng.Bipolar();
            switch (color)
            {
                case "white": return w * 0.5;
                case "brown": _brown = (_brown + 0.02 * w) / 1.02; return _brown * 3.5;
                default:
                    _b0 = 0.99886 * _b0 + w * 0.0555179; _b1 = 0.99332 * _b1 + w * 0.0750759; _b2 = 0.96900 * _b2 + w * 0.1538520;
                    _b3 = 0.86650 * _b3 + w * 0.3104856; _b4 = 0.55000 * _b4 + w * 0.5329522; _b5 = -0.7616 * _b5 - w * 0.0168980;
                    var p = _b0 + _b1 + _b2 + _b3 + _b4 + _b5 + _b6 + w * 0.5362; _b6 = w * 0.115926;
                    return p * 0.11;
            }
        }
    }

    /// <summary>A smooth random curve (−1…1) for wobble and drift.</summary>
    private sealed class Wander(SoundRng rng, double ratePerSecond)
    {
        private double _a = rng.Bipolar(), _b = rng.Bipolar(), _t;
        public double Next(double dt)
        {
            _t += dt * ratePerSecond;
            while (_t >= 1) { _t -= 1; _a = _b; _b = rng.Bipolar(); }
            var s = _t * _t * (3 - 2 * _t);
            return _a + (_b - _a) * s;
        }
    }

    private static (double L, double R) PanGains(double pan)
    {
        var a = (Math.Clamp(pan, -1, 1) + 1) * Math.PI / 4;
        return (Math.Cos(a) * Math.Sqrt(2), Math.Sin(a) * Math.Sqrt(2));
    }

    /// <summary>How far through its envelope a layer is (0–1), for filter sweeps.</summary>
    private static double Sweep(SoundLayer l, double t)
    {
        var span = l.Attack + l.Hold + (l.Release > 0 ? l.Release : 0);
        if (span <= 0) return 0;
        return Math.Clamp((t - l.Start) / span, 0, 1);
    }

    private static double SweptFreq(SoundLayer l, double t) => l.FreqEnd > 0 ? l.Freq * Math.Pow(l.FreqEnd / l.Freq, Sweep(l, t)) : l.Freq;

    private static void RenderNoise(SoundLayer l, SoundRng rng, double[] gust, double[] L, double[] R, int sr, int total, LayerMod md)
    {
        var srcL = new NoiseSource(l.Color, new SoundRng(rng.Next()));
        var srcR = new NoiseSource(l.Color, new SoundRng(rng.Next()));
        var fl = new Biquad(); var fr = new Biquad();
        var wobble = new Wander(new SoundRng(rng.Next()), l.WobbleRate);
        var drift = new Wander(new SoundRng(rng.Next()), 0.3);
        var gain = Math.Pow(10, l.Gain / 20);
        var (pl, pr) = PanGains(l.Pan);
        var dt = (double)Block / sr;
        // Two passes of a bandpass (steeper, for whistles and narrow bands) keep their level near the others'.
        var narrow = l.Filter == "bandpass" && l.Q > 4;
        var fl2 = new Biquad(); var fr2 = new Biquad();
        double amp = 0;
        for (var start = 0; start < total; start += Block)
        {
            var b = start / Block;
            var g = gust[b];
            var w = 1 + l.Wobble * 0.8 * wobble.Next(dt);
            var target = gain * (1 - l.GustAmount + l.GustAmount * g * 1.6) * Math.Max(0, w) * Envelope(l, (double)start / sr);
            if (l.Filter != "none")
            {
                var f = SweptFreq(l, (double)start / sr) * Math.Pow(2, l.GustFilter * 2 * (g - 0.4)) * Math.Pow(2, l.Drift * 0.5 * drift.Next(dt)) * md.FreqFactor(b);
                fl.Set(l.Filter, f, l.Q, sr); fr.Set(l.Filter, f, l.Q, sr);
                if (narrow) { fl2.Set("bandpass", f, l.Q, sr); fr2.Set("bandpass", f, l.Q, sr); }
            }
            var end = Math.Min(total, start + Block);
            for (var i = start; i < end; i++)
            {
                amp += (target - amp) * 0.02; // no clicks when the level moves
                var a = srcL.Next();
                var c = srcR.Next();
                var right = a * (1 - l.Width) + c * l.Width;
                double x = a, y = right;
                if (l.Filter != "none")
                {
                    x = fl.Run(x); y = fr.Run(y);
                    if (narrow) { x = fl2.Run(x) * Math.Sqrt(l.Q); y = fr2.Run(y) * Math.Sqrt(l.Q); }
                }
                L[i] += x * amp * pl; R[i] += y * amp * pr;
            }
        }
    }

    private sealed class Voice
    {
        public double Amp, PanL, PanR, Decay, R1, R2, Coef, Rr, Tone, Click, Hp, Xp;
        public int BurstLeft, Delay, Age;
    }

    /// <summary>
    /// Many small sounds: a short noise burst (the click) ringing a little resonator (the ping). They come at random
    /// moments or evenly spaced (Rhythm), alone or as clusters (Burst: gravel under a step, a rattle).
    /// </summary>
    private static void RenderEvents(SoundLayer l, SoundRng rng, double[] gust, double[] L, double[] R, int sr, int total, LayerMod md)
    {
        var voices = new List<Voice>();
        var gain = Math.Pow(10, l.Gain / 20);
        var hpCoef = Math.Exp(-2 * Math.PI * Math.Min(l.Pitch * 0.6, sr * 0.4) / sr);
        var next = 0.0; // samples until the next event
        var planned = false;
        for (var start = 0; start < total; start += Block)
        {
            var g = gust[start / Block];
            var env = Envelope(l, (double)start / sr);
            var rate = l.Density * (1 - l.GustAmount + l.GustAmount * g * 1.8) * (env > 0 ? 1 : 0) * md.DensityFactor(start / Block);
            var end = Math.Min(total, start + Block);
            for (var i = start; i < end; i++)
            {
                if (rate > 0)
                {
                    if (!planned) { planned = true; next = l.Rhythm >= 0.999 ? 0 : Gap(rng, rate, sr, l.Rhythm) * rng.NextDouble(); }
                    if (next <= 0)
                    {
                        next += Gap(rng, rate, sr, l.Rhythm);
                        for (var b = 0; b < l.Burst && voices.Count < 768; b++)
                        {
                            var delay = b == 0 ? 0 : (int)(rng.NextDouble() * l.BurstSpread / 1000 * sr);
                            var amp = gain * env * Math.Pow(10, -l.GainSpread * Math.Abs(rng.Gaussian()) / 20) * (b == 0 ? 1 : 0.55 + 0.45 * rng.NextDouble());
                            voices.Add(NewVoice(l, rng, sr, amp, delay, md.PitchFactor(i)));
                        }
                    }
                    next--;
                }
                double sumL = 0, sumR = 0;
                for (var v = voices.Count - 1; v >= 0; v--)
                {
                    var o = voices[v];
                    if (o.Delay > 0) { o.Delay--; continue; }
                    var x = o.BurstLeft > 0 ? rng.Bipolar() : 0;
                    if (o.BurstLeft > 0) o.BurstLeft--;
                    o.Hp = hpCoef * (o.Hp + x - o.Xp); // one-pole high-pass: a brighter click for a higher pitch
                    o.Xp = x;
                    var click = o.Hp * o.Click;
                    o.Click *= o.Decay;
                    var y = o.Coef * o.R1 - o.Rr * o.Rr * o.R2 + x * (1 - o.Rr) * 4;
                    o.R2 = o.R1; o.R1 = y;
                    var sample = (click * (1 - o.Tone) + y * o.Tone) * o.Amp;
                    sumL += sample * o.PanL; sumR += sample * o.PanR;
                    o.Age++;
                    if ((o.BurstLeft == 0 && o.Click < 1e-4 && Math.Abs(o.R1) < 1e-5 && Math.Abs(o.R2) < 1e-5) || o.Age > sr * 4) voices.RemoveAt(v);
                }
                L[i] += sumL; R[i] += sumR;
            }
        }
    }

    /// <summary>Samples until the next event: random (exponential) gaps, or even ones with a little looseness.</summary>
    private static double Gap(SoundRng rng, double rate, int sr, double rhythm)
    {
        var mean = sr / rate;
        var random = -Math.Log(1 - rng.NextDouble() * 0.999999);
        var even = 1 + 0.06 * rng.Bipolar();
        return Math.Max(1, mean * ((1 - rhythm) * random + rhythm * even));
    }

    private static Voice NewVoice(SoundLayer l, SoundRng rng, int sr, double amp, int delay, double pitchFactor)
    {
        var freq = Math.Clamp(l.Pitch * pitchFactor * Math.Pow(2, l.PitchSpread * rng.Bipolar()), 30, sr * 0.45);
        var decay = l.Decay / 1000 * (0.6 + 0.8 * rng.NextDouble());
        var rr = Math.Exp(-6.9 / (decay * sr)); // −60 dB after the decay time
        var (pl, pr) = PanGains(Math.Clamp(l.Pan + l.Width * rng.Bipolar(), -1, 1));
        return new Voice
        {
            Amp = amp, PanL = pl, PanR = pr, Decay = Math.Exp(-6.9 / (Math.Max(0.0005, decay * 0.25) * sr)), Rr = rr, Delay = delay,
            Coef = 2 * rr * Math.Cos(2 * Math.PI * freq / sr), Tone = l.Tone, BurstLeft = Math.Max(2, (int)(sr * (0.0004 + 0.0012 * rng.NextDouble()))), Click = 1,
        };
    }

    /// <summary>An envelope measured from one start of a layer (attack, hold, then the release dies away).</summary>
    private static double EnvAt(SoundLayer l, double u, double defaultRelease)
    {
        if (u < 0) return 0;
        var a = l.Attack > 0 ? Math.Min(1, u / l.Attack) : 1;
        var release = l.Release > 0 ? l.Release : defaultRelease;
        if (release <= 0) return a;
        var d = u - l.Attack - l.Hold;
        return d <= 0 ? a : a * Math.Exp(-d * 6.9 / release);
    }

    private static List<double> Starts(SoundLayer l, double totalSeconds)
    {
        var starts = new List<double>();
        if (l.Repeat > 0) for (var t = l.Start; t < totalSeconds; t += l.Repeat) starts.Add(t);
        else starts.Add(l.Start);
        return starts;
    }

    /// <summary>A tone with a pitch sweep, an optional jump (Arp), FM and an envelope (UI sounds, pickups, lasers, bells, engines); it can repeat.</summary>
    private static void RenderSynth(SoundLayer l, SoundRng rng, double[] L, double[] R, int sr, int total, LayerMod md)
    {
        var gain = Math.Pow(10, l.Gain / 20);
        var (pl, pr) = PanGains(l.Pan);
        var release = l.Release > 0 ? l.Release : 0.3;
        var span = l.Attack + l.Hold + Math.Max(0.001, release);
        foreach (var t0 in Starts(l, (double)total / sr))
        {
            double phase = 0, mod = 0;
            var from = (int)(t0 * sr);
            var to = Math.Min(total, from + (int)((span + release * 0.2) * sr) + 1);
            for (var i = from; i < to; i++)
            {
                var u = (double)(i - from) / sr;
                var x = Math.Clamp(u / span, 0, 1);
                var f = l.PitchEnd > 0 ? l.Pitch * Math.Pow(l.PitchEnd / l.Pitch, x) : l.Pitch;
                if (l.Arp != 0 && u >= l.ArpTime) f *= Math.Pow(2, l.Arp / 12);
                f *= 1 + l.Vibrato * 0.06 * Math.Sin(2 * Math.PI * l.VibratoRate * u);
                if (md.Pitch != null) f *= md.PitchFactor(i);
                phase += f / sr; phase -= Math.Floor(phase);
                var p = phase;
                if (l.FmRatio > 0 && l.FmDepth > 0)
                {
                    mod += f * l.FmRatio / sr; mod -= Math.Floor(mod);
                    p += l.FmDepth * Math.Sin(2 * Math.PI * mod) / (2 * Math.PI);
                    p -= Math.Floor(p);
                }
                double s = l.Wave switch
                {
                    "square" => p < l.Duty ? 0.6 : -0.6,
                    "saw" => (2 * p - 1) * 0.6,
                    "triangle" => (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) * 0.8,
                    "noise" => rng.Bipolar() * 0.6,
                    _ => Math.Sin(2 * Math.PI * p),
                };
                var a = l.Attack > 0 ? Math.Min(1, u / l.Attack) : Math.Min(1, u * sr / 16); // never a hard click at the start
                var d = u - l.Attack - l.Hold;
                var env = d <= 0 ? a : a * Math.Exp(-d * 6.9 / release);
                var v = s * env * gain;
                L[i] += v * pl; R[i] += v * pr;
            }
        }
    }

    /// <summary>A WAV of your own: trimmed, maybe reversed, pitched (tape-style), placed, repeated or looped, with an envelope.</summary>
    private static void RenderSample(SoundLayer l, SampleAudio a, double[] L, double[] R, int sr, int total, LayerMod md)
    {
        var from = (int)Math.Min(a.Left.Length, l.TrimStart * a.Rate);
        var to = l.TrimEnd > 0 ? (int)Math.Min(a.Left.Length, l.TrimEnd * a.Rate) : a.Left.Length;
        if (to - from < 2) return;
        var len = to - from;
        var step = Math.Pow(2, l.Semitones / 12) * a.Rate / sr; // source samples per output sample
        var outLen = (int)(len / step);
        var gain = Math.Pow(10, l.Gain / 20);
        var (pl, pr) = PanGains(l.Pan);
        var edge = Math.Max(1, (int)(0.002 * sr)); // 2 ms fades at the cut ends: no clicks
        if (l.LoopSample && l.LoopFade > 0)
        {
            // One endless pass through a looped reader: each time round, the end is crossfaded into the start.
            var src = new SampleReader(a, from, to, l.Reverse, l.LoopFade);
            var o = (int)(l.Start * sr);
            var pos = 0.0;
            for (var i = Math.Max(0, o); i < total; i++)
            {
                var j = i - o;
                var (vl, vr) = src.Looped(pos);
                pos += step * md.PitchFactor(i);
                var mid = (vl + vr) / 2;
                vl = mid + (vl - mid) * l.Width; vr = mid + (vr - mid) * l.Width;
                var env = Math.Min(1, j / Math.Max(1.0, l.Attack * sr)) * gain;
                if (j < edge) env *= (double)j / edge;
                L[i] += vl * env * pl; R[i] += vr * env * pr;
            }
            return;
        }
        var starts = l.LoopSample
            ? Enumerable.Range(0, (int)Math.Ceiling(Math.Max(0, total - l.Start * sr) / Math.Max(1.0, outLen)) + 1).Select(k => l.Start + (double)k * outLen / sr).ToList()
            : Starts(l, (double)total / sr);
        foreach (var t0 in starts)
        {
            var o0 = (int)(t0 * sr);
            var moving = 0.0; // the playback position when the pitch is modulated (it no longer moves at a fixed speed)
            for (var j = 0; md.Pitch != null ? moving < len - 1 : j < outLen; j++)
            {
                var i = o0 + j;
                if (i >= total) break;
                var pos = md.Pitch == null ? j * step : moving;
                if (md.Pitch != null) moving += step * md.PitchFactor(Math.Max(0, i));
                if (i < 0) continue;
                var k = (int)pos;
                var frac = pos - k;
                if (k + 1 >= len) break;
                int s0, s1;
                if (l.Reverse) { s0 = to - 1 - k; s1 = to - 2 - k; } else { s0 = from + k; s1 = from + k + 1; }
                var vl = a.Left[s0] + (a.Left[s1] - a.Left[s0]) * frac;
                var vr = a.Right[s0] + (a.Right[s1] - a.Right[s0]) * frac;
                var mid = (vl + vr) / 2;
                vl = mid + (vl - mid) * l.Width; vr = mid + (vr - mid) * l.Width;
                var env = (l.LoopSample ? Math.Min(1, (i - l.Start * sr) / Math.Max(1.0, l.Attack * sr)) : EnvAt(l, (double)j / sr, 0)) * gain;
                if (j < edge) env *= (double)j / edge;
                var left = md.Pitch == null ? outLen - j : (len - pos) / step;
                if (left < edge) env *= Math.Max(0, left) / edge;
                L[i] += vl * env * pl; R[i] += vr * env * pr;
            }
        }
    }

    /// <summary>
    /// A sample played as grains: short, softly windowed pieces. "stretch" lays them end to end at 4× overlap, so the
    /// speed through the sample and the pitch are set apart; "grains" scatters them around a position (a texture).
    /// </summary>
    private static void RenderGrains(SoundLayer l, SampleAudio a, SoundRng rng, double[] L, double[] R, int sr, int total, LayerMod md)
    {
        var from = (int)Math.Min(a.Left.Length, l.TrimStart * a.Rate);
        var to = l.TrimEnd > 0 ? (int)Math.Min(a.Left.Length, l.TrimEnd * a.Rate) : a.Left.Length;
        if (to - from < 2) return;
        var src = new SampleReader(a, from, to, l.Reverse, Math.Max(0.01, l.LoopFade));
        var len = src.Length;
        var size = Math.Max(16, (int)(l.GrainSize / 1000 * sr)); // output samples per grain
        var gain = Math.Pow(10, l.Gain / 20);
        var (pl, pr) = PanGains(l.Pan);
        var rate = (double)a.Rate / sr;
        var window = new double[size];
        for (var n = 0; n < size; n++) window[n] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * (n + 0.5) / size);
        var o = (int)(l.Start * sr);

        void Grain(int at, double source, double step, double width, double amp, bool loop, int origin)
        {
            var (gl, gr) = PanGains(Math.Clamp(l.Pan + width, -1, 1));
            var pos = source;
            for (var n = 0; n < size; n++, pos += step)
            {
                var i = at + n;
                if (i >= total) break;
                if (!loop && (pos < 0 || pos >= len - 1)) break;
                if (i < 0) continue;
                var (vl, vr) = loop ? src.Looped(pos) : src.At(pos);
                var mid = (vl + vr) / 2;
                vl = mid + (vl - mid) * l.Width; vr = mid + (vr - mid) * l.Width;
                var e = window[n] * amp * EnvAt(l, (double)(i - origin) / sr, 0);
                L[i] += vl * e * gl; R[i] += vr * e * gr;
            }
        }

        if (l.PlayMode == "stretch")
        {
            // Four grains overlap at any moment; a Hann window at that overlap adds up to 2, hence ½. Each grain is read
            // from near where the speed puts it, nudged (as in WSOLA) to where it best continues the grain before it, so
            // the overlaps add up in phase: a steady level and a clean pitch instead of a phasey blur.
            var hop = Math.Max(1, size / 4);
            var advance = l.Speed * rate; // source samples per output sample
            var reach = Math.Min(size * rate / 4, 0.012 * a.Rate); // how far a grain may be nudged (source samples)
            var match = Math.Min(size / 2, 400); // output samples compared
            var mono = src.Mono(l.LoopSample);
            foreach (var t0 in l.LoopSample ? [l.Start] : Starts(l, (double)total / sr))
            {
                var g0 = (int)(t0 * sr);
                double? follow = null; // where the previous grain would be reading by now
                for (var j = -size + hop; ; j += hop)
                {
                    var at = g0 + j;
                    if (at >= total) break;
                    var source = Math.Max(0, j) * advance;
                    if (!l.LoopSample && source >= len - 1) break;
                    var step = Math.Pow(2, l.Semitones / 12) * rate * md.PitchFactor(Math.Max(0, at));
                    if (follow is { } f && j > 0)
                    {
                        var lo = Math.Max(0, source - reach); var hi = source + reach;
                        if (!l.LoopSample) hi = Math.Max(lo, Math.Min(hi, len - 2 - match * step));
                        double Score(double c)
                        {
                            double score = 0, energy = 1e-9;
                            for (var n = 0; n < match; n += 4)
                            {
                                var x = mono((long)(c + n * step));
                                score += x * mono((long)(f + n * step)); energy += x * x;
                            }
                            return score / Math.Sqrt(energy);
                        }
                        // Coarse, then fine around the best.
                        var best = source; var bestScore = double.NegativeInfinity;
                        for (var c = lo; c <= hi; c += 3) { var sc = Score(c); if (sc > bestScore) { bestScore = sc; best = c; } }
                        var centre = best;
                        for (var c = Math.Max(lo, centre - 2); c <= Math.Min(hi, centre + 2); c += 1) { var sc = Score(c); if (sc > bestScore) { bestScore = sc; best = c; } }
                        source = best;
                    }
                    if (!l.LoopSample) source = Math.Clamp(source, 0, len - 2);
                    Grain(at, source, step, 0, gain * 0.5, l.LoopSample, g0);
                    follow = source + hop * step;
                }
            }
            return;
        }

        // A cloud: grains at random (or, with Rhythm, evenly spaced) moments, from around the position.
        var end = l.Release > 0 ? Math.Min(total, o + (int)((l.Attack + l.Hold + l.Release * 1.2) * sr)) : total;
        var overlap = l.GrainDensity * size / sr; // grains sounding at once, on average
        var level = gain / Math.Sqrt(Math.Max(1, overlap));
        var t = (double)Math.Max(0, o);
        while (t < end)
        {
            var at = (int)t;
            var secs = (at - o) / (double)sr;
            var p = l.Position + l.Scan * secs + md.PositionOffset(at) + l.PositionSpread * 0.5 * rng.Bipolar();
            p -= Math.Floor(p);
            var semis = l.Semitones + l.GrainPitch * rng.Bipolar();
            var step = Math.Pow(2, semis / 12) * rate * md.PitchFactor(at);
            Grain(at - size / 2, p * len, step, rng.Bipolar() * 0.5 * l.Width, level, true, o);
            var density = l.GrainDensity * md.DensityFactor(at / Block);
            var mean = sr / Math.Max(0.5, density);
            var random = -Math.Log(1 - rng.NextDouble()) * mean;
            t += Math.Max(1, mean * l.Rhythm + random * (1 - l.Rhythm));
        }
    }

    /// <summary>Reads the used part of a sample (forwards or backwards) between samples, and as a seamless loop.</summary>
    private sealed class SampleReader
    {
        private readonly SampleAudio _a;
        private readonly int _from, _to, _fade, _period;
        private readonly bool _reverse;
        public int Length { get; }

        public SampleReader(SampleAudio a, int from, int to, bool reverse, double fadeSeconds)
        {
            _a = a; _from = from; _to = to; _reverse = reverse;
            Length = to - from;
            _fade = Math.Clamp((int)(fadeSeconds * a.Rate), 1, Math.Max(1, Length / 2));
            _period = Math.Max(1, Length - _fade);
        }

        private (double L, double R) Raw(int k)
        {
            var s = _reverse ? _to - 1 - k : _from + k;
            return (_a.Left[s], _a.Right[s]);
        }

        /// <summary>Position k (0 … Length−1) of the used part, between samples.</summary>
        public (double L, double R) At(double pos)
        {
            var k = Math.Clamp((int)pos, 0, Length - 2);
            var f = Math.Clamp(pos - k, 0, 1);
            var (a0, b0) = Raw(k); var (a1, b1) = Raw(k + 1);
            return (a0 + (a1 - a0) * f, b0 + (b1 - b0) * f);
        }

        /// <summary>
        /// The used part as an endless loop: the first time through it plays as it is; every later time round, its last
        /// part (the fade) is blended into its start with equal power, so the end flows into the start without a seam.
        /// </summary>
        public (double L, double R) Looped(double pos)
        {
            if (pos < 0) pos = 0;
            var k = (long)pos;
            var f = pos - k;
            var (a0, b0) = LoopedRaw(k); var (a1, b1) = LoopedRaw(k + 1);
            return (a0 + (a1 - a0) * f, b0 + (b1 - b0) * f);
        }

        /// <summary>
        /// A fast mono reading (left + right) by whole sample, for comparing pieces: of the used part as it is, or of the
        /// loop (which repeats exactly after its first time round).
        /// </summary>
        public Func<long, double> Mono(bool loop)
        {
            var n = loop ? Length + _period : Length;
            var m = new double[n];
            for (var i = 0; i < n; i++) { var (a, b) = loop ? LoopedRaw(i) : Raw(i); m[i] = a + b; }
            if (!loop) return k => m[Math.Clamp(k, 0, n - 1)];
            return k => k < 0 ? m[0] : k < n ? m[k] : m[_period + (k - _period) % _period];
        }

        private (double L, double R) LoopedRaw(long m)
        {
            if (m < _period) return Raw((int)m);
            var q = (int)((m - _period) % _period);
            if (q >= _fade || _period + q >= Length) return Raw(q);
            var x = Math.PI / 2 * q / _fade;
            var (hl, hr) = Raw(q); var (tl, tr) = Raw(_period + q);
            return (hl * Math.Sin(x) + tl * Math.Cos(x), hr * Math.Sin(x) + tr * Math.Cos(x));
        }
    }

    /// <summary>A layer's own shaping: the filter (synth and sample layers), its sweep, drive and crush.</summary>
    private static void PostLayer(SoundLayer l, double[] L, double[] R, int sr, int total, LayerMod md)
    {
        if (l.Type is "synth" or "sample" && l.UseFilter && l.Filter != "none")
        {
            var fl = new Biquad(); var fr = new Biquad();
            for (var start = 0; start < total; start += Block)
            {
                var f = SweptFreq(l, (double)start / sr) * md.FreqFactor(start / Block);
                fl.Set(l.Filter, f, l.Q, sr); fr.Set(l.Filter, f, l.Q, sr);
                var end = Math.Min(total, start + Block);
                for (var i = start; i < end; i++) { L[i] = fl.Run(L[i]); R[i] = fr.Run(R[i]); }
            }
        }
        if (l.Drive > 0.001)
        {
            var k = 1 + l.Drive * 9;
            var norm = 1 / Math.Tanh(k) / (1 + l.Drive * 2.5); // louder grit, but not much louder
            for (var i = 0; i < total; i++) { L[i] = Math.Tanh(L[i] * k) * norm; R[i] = Math.Tanh(R[i] * k) * norm; }
        }
        if (l.Crush > 0.001)
        {
            var hold = 1 + (int)(l.Crush * l.Crush * 23 * sr / 48000.0);
            var levels = Math.Pow(2, 15 - l.Crush * 12);
            double hl = 0, hr = 0;
            for (var i = 0; i < total; i++)
            {
                if (i % hold == 0) { hl = Math.Round(L[i] * levels) / levels; hr = Math.Round(R[i] * levels) / levels; }
                L[i] = hl; R[i] = hr;
            }
        }
    }

    /// <summary>High-pass, low-pass, width, a small room (Schroeder: combs and all-passes) and the master level.</summary>
    private static void MasterChain(MasterSettings m, double[] L, double[] R, int sr, double[]? lowpassMod)
    {
        var hpL = new Biquad(); var hpR = new Biquad(); var lpL = new Biquad(); var lpR = new Biquad();
        hpL.Set("highpass", m.HighPass, 0.707, sr); hpR.Set("highpass", m.HighPass, 0.707, sr);
        var lowpass = m.LowPass < 19000 || lowpassMod != null;
        if (lowpass) { lpL.Set("lowpass", m.LowPass, 0.707, sr); lpR.Set("lowpass", m.LowPass, 0.707, sr); }
        var gain = Math.Pow(10, m.Gain / 20);
        for (var i = 0; i < L.Length; i++)
        {
            if (lowpassMod != null && i % Block == 0)
            {
                // The high cut moves (octaves) with its modulation.
                var f = Math.Clamp(m.LowPass * Math.Pow(2, lowpassMod[Math.Min(i / Block, lowpassMod.Length - 1)]), 40, 20000);
                lpL.Set("lowpass", f, 0.707, sr); lpR.Set("lowpass", f, 0.707, sr);
            }
            double l = hpL.Run(L[i]), r = hpR.Run(R[i]);
            if (lowpass) { l = lpL.Run(l); r = lpR.Run(r); }
            var mid = (l + r) / 2; var side = (l - r) / 2 * m.Width;
            L[i] = (mid + side) * gain; R[i] = (mid - side) * gain;
        }
        if (m.Reverb <= 0.001) return;
        var scale = sr / 44100.0 * (0.5 + m.Room);
        int[] combs = [1116, 1188, 1277, 1356], allp = [556, 441];
        var wetL = Room(L, combs.Select(c => (int)(c * scale)).ToArray(), allp.Select(a => (int)(a * scale)).ToArray(), 0.7 + 0.25 * m.Room);
        var wetR = Room(R, combs.Select(c => (int)((c + 23) * scale)).ToArray(), allp.Select(a => (int)((a + 23) * scale)).ToArray(), 0.7 + 0.25 * m.Room);
        var wet = m.Reverb * 0.6; var dry = 1 - m.Reverb * 0.5;
        for (var i = 0; i < L.Length; i++) { L[i] = L[i] * dry + wetL[i] * wet; R[i] = R[i] * dry + wetR[i] * wet; }
    }

    private static double[] Room(double[] x, int[] combs, int[] allpasses, double feedback)
    {
        var y = new double[x.Length];
        foreach (var d in combs)
        {
            var buf = new double[Math.Max(1, d)];
            var idx = 0; double store = 0;
            for (var i = 0; i < x.Length; i++)
            {
                var o = buf[idx];
                store = o * 0.8 + store * 0.2; // damping: the highs die first
                buf[idx] = x[i] * 0.25 + store * feedback;
                idx = (idx + 1) % buf.Length;
                y[i] += o;
            }
        }
        foreach (var d in allpasses)
        {
            var buf = new double[Math.Max(1, d)];
            var idx = 0;
            for (var i = 0; i < y.Length; i++)
            {
                var b = buf[idx];
                var o = -y[i] + b;
                buf[idx] = y[i] + b * 0.5;
                idx = (idx + 1) % buf.Length;
                y[i] = o;
            }
        }
        return y;
    }

    private static void FadeEdges(float[] l, float[] r, int sr)
    {
        var n = Math.Min(l.Length / 4, (int)(sr * 0.02));
        for (var i = 0; i < n; i++)
        {
            var g = (float)i / n;
            l[l.Length - 1 - i] *= g; r[r.Length - 1 - i] *= g;
        }
    }

    private static void Scale(float[] l, float[] r, double k) { for (var i = 0; i < l.Length; i++) { l[i] = (float)(l[i] * k); r[i] = (float)(r[i] * k); } }

    /// <summary>A soft limiter: below the knee nothing changes; above it, peaks are rounded off toward the ceiling.</summary>
    /// <summary>
    /// Towards the loudness target, but never past the ceiling (by true peak): a very peaky sound (a crunchy step, a
    /// click) stays a little under the target rather than being squashed and distorted by the limiter.
    /// </summary>
    private static double ToLoudness(float[] l, float[] r, int sr, double target, double ceiling)
    {
        var (lufs, _, _) = SoundAnalysis.Loudness(l, r, sr);
        if (lufs <= -100) return 1;
        var gain = Math.Pow(10, (target - lufs) / 20);
        var peak = Math.Max(SoundAnalysis.TruePeak(l), SoundAnalysis.TruePeak(r));
        if (peak > 1e-6) gain = Math.Min(gain, ceiling / peak);
        Scale(l, r, gain);
        return gain;
    }

    private static void Limit(float[] l, float[] r, double ceiling)
    {
        var knee = ceiling * 0.8;
        for (var i = 0; i < l.Length; i++) { l[i] = Soft(l[i], knee, ceiling); r[i] = Soft(r[i], knee, ceiling); }
    }

    private static float Soft(float x, double knee, double ceiling)
    {
        var a = Math.Abs(x);
        if (a <= knee) return x;
        var over = (a - knee) / (ceiling - knee);
        var y = knee + (ceiling - knee) * Math.Tanh(over);
        return (float)(Math.Sign(x) * y);
    }
}

/// <summary>Audio read from a file for a sample layer: stereo (mono is doubled), −1…1, at its own sample rate.</summary>
public sealed class SampleAudio
{
    public required float[] Left { get; init; }
    public required float[] Right { get; init; }
    public required int Rate { get; init; }
    public double Seconds => (double)Left.Length / Rate;
    /// <summary>A SoundFont read from the file instead of a sample (its sound is in the font; Left and Right are empty).</summary>
    public SoundFont? Font { get; init; }

    /// <summary>The waveform for a picture of it: for each of <paramref name="columns"/> slices, its lowest and highest value (both channels).</summary>
    public float[] Peaks(int columns)
    {
        columns = Math.Clamp(columns, 1, 4000);
        var peaks = new float[columns * 2];
        var n = Left.Length;
        for (var c = 0; c < columns; c++)
        {
            int from = (int)((long)c * n / columns), to = Math.Max(from + 1, (int)((long)(c + 1) * n / columns));
            float lo = 0, hi = 0;
            for (var i = from; i < Math.Min(to, n); i++) { lo = Math.Min(lo, Math.Min(Left[i], Right[i])); hi = Math.Max(hi, Math.Max(Left[i], Right[i])); }
            peaks[c * 2] = (float)Math.Round(lo, 3); peaks[c * 2 + 1] = (float)Math.Round(hi, 3);
        }
        return peaks;
    }

    /// <summary>Reads a PCM (8/16/24/32-bit) or 32-bit float WAV file, mono or stereo (more channels: the first two).</summary>
    public static SampleAudio ReadWav(byte[] b)
    {
        if (b.Length < 44 || Encoding.ASCII.GetString(b, 0, 4) != "RIFF" || Encoding.ASCII.GetString(b, 8, 4) != "WAVE") throw new ArgumentException("That is not a WAV file.");
        int pos = 12, channels = 0, rate = 0, bits = 0, format = 0, dataAt = -1, dataLen = 0;
        while (pos + 8 <= b.Length)
        {
            var id = Encoding.ASCII.GetString(b, pos, 4);
            var size = BitConverter.ToInt32(b, pos + 4);
            if (size < 0) break;
            var body = pos + 8;
            if (id == "fmt " && body + 16 <= b.Length)
            {
                format = BitConverter.ToUInt16(b, body); channels = BitConverter.ToUInt16(b, body + 2); rate = BitConverter.ToInt32(b, body + 4); bits = BitConverter.ToUInt16(b, body + 14);
                if (format == 0xFFFE && size >= 26 && body + 26 <= b.Length) format = BitConverter.ToUInt16(b, body + 24); // WAVE_FORMAT_EXTENSIBLE: the sub-format
            }
            else if (id == "data") { dataAt = body; dataLen = (int)Math.Min((long)size, b.Length - body); break; }
            pos = body + size + (size & 1);
        }
        if (dataAt < 0 || channels < 1 || rate < 1000 || rate > 384000) throw new ArgumentException("This WAV file can't be read.");
        if (!(format == 1 && bits is 8 or 16 or 24 or 32) && !(format == 3 && bits == 32)) throw new ArgumentException("Only PCM or 32-bit float WAV files can be used.");
        var frame = channels * bits / 8;
        var frames = dataLen / frame;
        float[] l = new float[frames], r = new float[frames];
        float Read(int at) => format == 3 ? BitConverter.ToSingle(b, at) : bits switch
        {
            8 => (b[at] - 128) / 128f,
            16 => BitConverter.ToInt16(b, at) / 32768f,
            24 => ((b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) << 8 >> 8) / 8388608f,
            _ => BitConverter.ToInt32(b, at) / 2147483648f,
        };
        for (var i = 0; i < frames; i++)
        {
            var at = dataAt + i * frame;
            l[i] = Read(at);
            r[i] = channels > 1 ? Read(at + bits / 8) : l[i];
        }
        return new SampleAudio { Left = l, Right = r, Rate = rate };
    }
}
