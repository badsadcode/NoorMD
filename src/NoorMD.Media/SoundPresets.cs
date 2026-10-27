namespace NoorMD.Media;

/// <summary>The built-in starting points of the Sound Bench, by family. Each is an ordinary recipe you can change.</summary>
public static class SoundPresets
{
    public sealed record Preset(string Id, string Family, string Name, string Description, Func<SoundRecipe> Make);

    private static SoundLayer Noise(string name, string color, string filter, double freq, double q, double gain, double gust = 0, double gustFilter = 0, double width = 0.8,
        double wobble = 0, double wobbleRate = 1, double drift = 0) =>
        new() { Type = "noise", Name = name, Color = color, Filter = filter, Freq = freq, Q = q, Gain = gain, GustAmount = gust, GustFilter = gustFilter, Width = width, Wobble = wobble, WobbleRate = wobbleRate, Drift = drift };

    private static SoundLayer Events(string name, double density, double decayMs, double pitch, double spread, double tone, double gain, double gust = 0, double gainSpread = 6, double width = 0.9) =>
        new() { Type = "events", Name = name, Density = density, Decay = decayMs, Pitch = pitch, PitchSpread = spread, Tone = tone, Gain = gain, GustAmount = gust, GainSpread = gainSpread, Width = width };

    private static SoundLayer Synth(string name, string wave, double pitch, double pitchEnd, double attack, double hold, double release, double gain, double start = 0) =>
        new() { Type = "synth", Name = name, Wave = wave, Pitch = pitch, PitchEnd = pitchEnd, Attack = attack, Hold = hold, Release = release, Gain = gain, Start = start, Width = 0 };

    private static SoundRecipe Ambience(string family, string name, double gustRate, double gustDepth, double gustBase, params SoundLayer[] layers) =>
        new() { Family = family, Name = name, Duration = 20, Loop = true, Gust = new GustSettings { Rate = gustRate, Depth = gustDepth, Base = gustBase }, Layers = [.. layers] };

    private static SoundRecipe OneShot(string family, string name, double seconds, params SoundLayer[] layers) =>
        new() { Family = family, Name = name, Duration = seconds, Loop = false, Gust = new GustSettings { Depth = 0, Base = 0.5 }, Layers = [.. layers], Master = new MasterSettings { Normalize = true, Ceiling = -1 } };

    public static readonly IReadOnlyList<Preset> All =
    [
        // Wind: a moving air bed, gusts, vegetation that answers the gusts, and whistles only where there's something to whistle around.
        new("wind-forest", "Wind", "Gentle forest breeze", "Soft air through trees, leaves stirring with each gust.", () => Ambience("Wind", "Gentle forest breeze", 5, 0.5, 0.35,
            Noise("Air", "pink", "lowpass", 600, 0.7, -14, gust: 0.7, gustFilter: 0.6),
            Noise("Leaves", "white", "bandpass", 4500, 0.8, -30, gust: 1, gustFilter: 0.3, width: 1, wobble: 0.5, wobbleRate: 3),
            Events("Leaf ticks", 25, 6, 5000, 1, 0.1, -36, gust: 1))),
        new("wind-field", "Wind", "Open-field gusts", "Big open air with strong, uneven gusts.", () => Ambience("Wind", "Open-field gusts", 7, 0.8, 0.3,
            Noise("Air", "pink", "lowpass", 900, 0.7, -12, gust: 0.9, gustFilter: 0.9, width: 0.9),
            Noise("Low rush", "brown", "lowpass", 250, 0.7, -14, gust: 0.8, gustFilter: 0.4))),
        new("wind-storm", "Wind", "Storm through trees", "Violent gusts, roaring canopy and thrashing leaves.", () => Ambience("Wind", "Storm through trees", 9, 0.9, 0.45,
            Noise("Roar", "brown", "lowpass", 300, 0.7, -8, gust: 1, gustFilter: 0.6),
            Noise("Canopy", "pink", "bandpass", 1200, 0.6, -14, gust: 1, gustFilter: 1),
            Noise("Leaves", "white", "bandpass", 6000, 0.7, -26, gust: 1, gustFilter: 0.3, width: 1, wobble: 0.6, wobbleRate: 4),
            Events("Twigs", 80, 4, 6000, 1, 0, -32, gust: 1))),
        new("wind-ruins", "Wind", "Wind around ruins", "Air whistling through gaps in old stone.", () => Ambience("Wind", "Wind around ruins", 5, 0.6, 0.35,
            Noise("Air", "pink", "lowpass", 700, 0.7, -14, gust: 0.8, gustFilter: 0.6),
            Noise("Whistle", "white", "bandpass", 780, 30, -26, gust: 1, drift: 0.3, width: 0.3),
            Noise("High whistle", "white", "bandpass", 1170, 40, -32, gust: 1, drift: 0.4, width: 0.3))),
        new("wind-window", "Wind", "Window draft", "Heard from inside: a draft at the window frame.", () =>
        {
            var r = Ambience("Wind", "Window draft", 4, 0.6, 0.3,
                Noise("Draft", "pink", "bandpass", 500, 1.5, -14, gust: 0.9, gustFilter: 0.5, width: 0.4),
                Noise("Frame whistle", "white", "bandpass", 1400, 25, -30, gust: 1, drift: 0.5, width: 0.2));
            r.Master.LowPass = 3000; r.Master.Reverb = 0.15; r.Master.Room = 0.2;
            return r;
        }),
        // Rain: a diffuse bed (never alone), near drops, heavier splashes and, for some, the surface they land on.
        new("rain-drizzle", "Rain", "Drizzle", "Fine, light rain: a hush with scattered drops.", () => Ambience("Rain", "Drizzle", 3, 0.3, 0.4,
            Noise("Rain bed", "white", "bandpass", 5000, 0.5, -32, gust: 0.3),
            Events("Drops", 40, 8, 3500, 1, 0.35, -30, gust: 0.4, gainSpread: 8))),
        new("rain-steady", "Rain", "Steady rain", "Rain falling all around, near drops and splashes.", () => Ambience("Rain", "Steady rain", 3, 0.3, 0.45,
            Noise("Rain bed", "white", "bandpass", 3500, 0.4, -22, gust: 0.4),
            Noise("Wash", "pink", "lowpass", 1200, 0.7, -30, gust: 0.3),
            Events("Near drops", 220, 6, 3000, 1, 0.3, -30, gust: 0.4),
            Events("Splashes", 15, 25, 1200, 0.8, 0.6, -28, gust: 0.4))),
        new("rain-downpour", "Rain", "Downpour", "Heavy, dense rain with a low roar underneath.", () => Ambience("Rain", "Downpour", 4, 0.4, 0.5,
            Noise("Rain bed", "white", "bandpass", 3000, 0.4, -14, gust: 0.4),
            Noise("Roar", "brown", "lowpass", 200, 0.7, -24, gust: 0.4),
            Events("Drops", 1200, 5, 3000, 1, 0.3, -34, gust: 0.5),
            Events("Splashes", 60, 25, 1000, 0.8, 0.6, -28, gust: 0.5))),
        new("rain-tent", "Rain", "Rain on a tent", "From inside a canvas tent: soft drumming close above you.", () =>
        {
            var r = Ambience("Rain", "Rain on a tent", 3, 0.3, 0.45,
                Noise("Outside", "pink", "lowpass", 1500, 0.7, -26, gust: 0.4),
                Events("Canvas taps", 300, 30, 350, 0.5, 0.8, -22, gust: 0.4, gainSpread: 6));
            r.Master.LowPass = 6000;
            return r;
        }),
        new("rain-roof", "Rain", "Rain on a metal roof", "Ringing drops on sheet metal, under cover.", () =>
        {
            var r = Ambience("Rain", "Rain on a metal roof", 3, 0.3, 0.45,
                Noise("Outside", "white", "bandpass", 3000, 0.5, -26, gust: 0.4),
                Events("Roof pings", 250, 60, 2500, 0.8, 0.9, -28, gust: 0.4));
            r.Master.Reverb = 0.2; r.Master.Room = 0.3;
            return r;
        }),
        // Fire and water.
        new("fire-camp", "Fire", "Campfire", "A low flutter of flames with crackles and the odd pop.", () => Ambience("Fire", "Campfire", 6, 0.3, 0.5,
            Noise("Flames", "brown", "lowpass", 250, 0.7, -16, wobble: 0.6, wobbleRate: 2, width: 0.5),
            Noise("Air", "pink", "bandpass", 1000, 0.7, -32, wobble: 0.5, wobbleRate: 1.5),
            Events("Crackles", 12, 3, 4000, 1.5, 0.05, -18, gainSpread: 10, width: 0.6),
            Events("Pops", 1.5, 15, 900, 0.5, 0.4, -20, width: 0.5))),
        new("water-stream", "Water", "Forest stream", "Shallow water over stones, with bubbles.", () => Ambience("Water", "Forest stream", 4, 0.2, 0.5,
            Noise("Flow", "pink", "bandpass", 1800, 0.5, -18, wobble: 0.3, wobbleRate: 0.7),
            Noise("Sparkle", "white", "highpass", 3000, 0.7, -32, wobble: 0.4, wobbleRate: 2),
            Events("Bubbles", 30, 20, 900, 1, 1, -32))),
        new("water-falls", "Water", "Distant waterfall", "A broad, steady wash of falling water.", () =>
        {
            var r = Ambience("Water", "Distant waterfall", 3, 0.15, 0.5,
                Noise("Weight", "brown", "lowpass", 600, 0.7, -10, wobble: 0.15),
                Noise("Wash", "pink", "lowpass", 2500, 0.7, -16, wobble: 0.2));
            r.Macros.Distance = 0.3;
            return r;
        }),
        // One-shots.
        new("thunder-distant", "Thunder", "Distant thunder", "A long, rolling rumble far away.", () =>
        {
            var r = OneShot("Thunder", "Distant thunder", 8,
                new SoundLayer { Type = "noise", Name = "Rumble", Color = "brown", Filter = "lowpass", Freq = 150, Q = 0.7, Gain = 0, Attack = 0.3, Release = 6, Wobble = 0.7, WobbleRate = 3, Width = 0.8 },
                new SoundLayer { Type = "noise", Name = "Crack", Color = "pink", Filter = "lowpass", Freq = 800, Q = 0.7, Gain = -10, Start = 0.2, Attack = 0.05, Release = 2, Wobble = 0.8, WobbleRate = 8, Width = 0.8 });
            r.Master.Reverb = 0.3; r.Master.Room = 0.9;
            return r;
        }),
        new("ui-click", "UI", "Soft click", "A short, gentle interface click.", () => OneShot("UI", "Soft click", 0.2,
            Synth("Tick", "sine", 1800, 1200, 0.001, 0, 0.04, -6),
            new SoundLayer { Type = "noise", Name = "Edge", Color = "white", Filter = "highpass", Freq = 4000, Q = 0.7, Gain = -18, Attack = 0.001, Release = 0.02, Width = 0 })),
        new("ui-coin", "UI", "Coin pickup", "A bright two-note pickup.", () => OneShot("UI", "Coin pickup", 0.5,
            Synth("Low note", "square", 988, 0, 0.002, 0.05, 0.02, -10),
            Synth("High note", "square", 1319, 0, 0.002, 0.05, 0.3, -10, start: 0.07))),
        new("ui-laser", "UI", "Laser", "A falling zap.", () => OneShot("UI", "Laser", 0.4,
            Synth("Zap", "saw", 1600, 200, 0.001, 0, 0.25, -8),
            new SoundLayer { Type = "noise", Name = "Hiss", Color = "white", Filter = "highpass", Freq = 3000, Q = 0.7, Gain = -22, Attack = 0.001, Release = 0.1, Width = 0 })),
        new("ui-explosion", "UI", "Explosion", "A short boom with debris.", () => OneShot("UI", "Explosion", 2.5,
            new SoundLayer { Type = "noise", Name = "Boom", Color = "brown", Filter = "lowpass", Freq = 800, Q = 0.7, Gain = 0, Attack = 0.005, Release = 1.2, Width = 0.6 },
            new SoundLayer { Type = "noise", Name = "Blast", Color = "white", Filter = "lowpass", Freq = 3000, Q = 0.7, Gain = -8, Attack = 0.002, Release = 0.3, Width = 0.8 },
            Synth("Thump", "sine", 90, 40, 0.002, 0, 0.6, -4))),
    ];

    /// <summary>
    /// Master level of each ambience (dB), measured so they sit at a usable loudness out of the box: about −19 to −28 dB RMS,
    /// gentle ones quieter than storms.
    /// </summary>
    private static readonly Dictionary<string, double> Level = new()
    {
        ["wind-forest"] = 14, ["wind-field"] = 14.5, ["wind-storm"] = 11.5, ["wind-ruins"] = 14.5, ["wind-window"] = 19,
        ["rain-drizzle"] = 21.5, ["rain-steady"] = 15.5, ["rain-downpour"] = 12, ["rain-tent"] = 6, ["rain-roof"] = 20.5,
        ["fire-camp"] = 11, ["water-stream"] = 15, ["water-falls"] = 6,
    };

    public static SoundRecipe Make(string id)
    {
        var p = All.FirstOrDefault(x => x.Id == id) ?? throw new ArgumentException("Unknown preset.");
        var r = p.Make();
        r.Name = p.Name;
        if (Level.TryGetValue(id, out var level)) r.Master.Gain += level;
        return r.Clamped();
    }
}
