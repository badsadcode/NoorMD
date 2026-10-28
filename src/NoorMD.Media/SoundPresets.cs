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
        new("rain-changing", "Rain", "Rain that comes and goes", "Showers that build and ease by themselves, with a Rain amount control.", () =>
        {
            var r = Ambience("Rain", "Rain that comes and goes", 3, 0.3, 0.45,
                Noise("Rain bed", "white", "bandpass", 3500, 0.4, -22, gust: 0.4),
                Noise("Wash", "pink", "lowpass", 1200, 0.7, -30, gust: 0.3),
                Events("Near drops", 220, 6, 3000, 1, 0.3, -30, gust: 0.4),
                Events("Splashes", 15, 25, 1200, 0.8, 0.6, -28, gust: 0.4));
            r.Duration = 30;
            r.Modulators.Add(new SoundModulator { Name = "Showers", Type = "random", Rate = 0.15, Smooth = 1 });
            r.Routes.AddRange([new() { Source = "M1", Target = "L1:gain", Amount = 6 }, new() { Source = "M1", Target = "L3:density", Amount = 1 }, new() { Source = "M1", Target = "L4:density", Amount = 1 }]);
            return Control(r, "Rain amount", 0.5, ("L1:gain", 12, 1), ("L2:gain", 10, 1), ("L3:density", 2.5, 1), ("L4:density", 2, 1), ("L1:freq", -0.8, 1));
        }),
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
        // Footsteps: a heel thump and the surface (a cluster of small hits); walking loops repeat them evenly.
        new("step-gravel", "Footsteps", "Step on gravel", "One step: a soft heel and crunching stones.", () => OneShot("Footsteps", "Step on gravel", 0.45,
            Synth("Heel", "sine", 110, 55, 0.002, 0, 0.07, -5),
            new SoundLayer { Type = "events", Name = "Gravel", Density = 1, Rhythm = 1, Burst = 18, BurstSpread = 70, Pitch = 3500, PitchSpread = 1, Tone = 0.1, Decay = 4, Gain = -10, Release = 0.14, GainSpread = 8, Width = 0.5 })),
        new("step-wood", "Footsteps", "Step on a wooden floor", "A hollow knock of a step on boards.", () => OneShot("Footsteps", "Step on a wooden floor", 0.45,
            Synth("Heel", "triangle", 170, 110, 0.002, 0, 0.09, -4),
            new SoundLayer { Type = "events", Name = "Boards", Density = 1, Rhythm = 1, Burst = 2, BurstSpread = 25, Pitch = 700, PitchSpread = 0.3, Tone = 0.7, Decay = 35, Gain = -10, Release = 0.12, Width = 0.3 })),
        new("step-snow", "Footsteps", "Step in snow", "A soft, squeaky crunch.", () => OneShot("Footsteps", "Step in snow", 0.5,
            Synth("Heel", "sine", 90, 50, 0.004, 0, 0.08, -12),
            new SoundLayer { Type = "events", Name = "Snow", Density = 1, Rhythm = 1, Burst = 26, BurstSpread = 130, Pitch = 2800, PitchSpread = 0.8, Tone = 0.05, Decay = 3, Gain = -10, Release = 0.2, GainSpread = 6, Width = 0.4 },
            new SoundLayer { Type = "noise", Name = "Hush", Color = "white", Filter = "bandpass", Freq = 4000, Q = 0.8, Gain = -24, Attack = 0.01, Release = 0.12, Width = 0.4 })),
        new("walk-gravel", "Footsteps", "Walking on gravel", "Steady steps on a gravel path (loops).", () =>
        {
            var r = Ambience("Footsteps", "Walking on gravel", 6, 0, 0.5,
                new SoundLayer { Type = "synth", Name = "Heels", Wave = "sine", Pitch = 110, PitchEnd = 55, Attack = 0.002, Release = 0.07, Repeat = 0.55, Gain = -8, Width = 0 },
                new SoundLayer { Type = "events", Name = "Gravel", Density = 1 / 0.55, Rhythm = 1, Burst = 18, BurstSpread = 80, Pitch = 3500, PitchSpread = 1, Tone = 0.1, Decay = 4, Gain = -14, GainSpread = 8, Width = 0.5 });
            r.Duration = 4.4;
            return r;
        }),
        new("walk-hall", "Footsteps", "Footsteps in a stone hall", "Hard steps sharing one big reverb: a bus (loops).", () =>
        {
            var r = Ambience("Footsteps", "Footsteps in a stone hall", 6, 0, 0.5,
                new SoundLayer { Type = "synth", Name = "Heels", Wave = "triangle", Pitch = 190, PitchEnd = 120, Attack = 0.001, Release = 0.06, Repeat = 0.6, Gain = -8, Width = 0 },
                new SoundLayer { Type = "events", Name = "Grit", Density = 1 / 0.6, Rhythm = 1, Burst = 4, BurstSpread = 15, Pitch = 2400, PitchSpread = 0.4, Tone = 0.3, Decay = 6, Gain = -16, GainSpread = 4, Width = 0.3 });
            r.Duration = 4.8;
            r.Buses.Add(new SoundBus { Name = "Hall", Effects = [new SoundEffect { Type = "reverb", Size = 0.9, Damping = 0.35, PreDelay = 30, Mix = 1 }, new SoundEffect { Type = "eq", Kind = "highpass", Freq = 250, Q = 0.7 }] });
            r.Clamped();
            r.Layers[0].Sends.Add(new SoundSend { Bus = "B1", Level = -6 });
            r.Layers[1].Sends.Add(new SoundSend { Bus = "B1", Level = -9 });
            return r;
        }),
        // Impacts and weapons.
        new("hit-wood", "Impacts", "Wooden knock", "Knuckles or a stick on wood.", () => OneShot("Impacts", "Wooden knock", 0.5,
            Synth("Knock", "triangle", 190, 150, 0.001, 0, 0.12, -4),
            new SoundLayer { Type = "noise", Name = "Wood", Color = "pink", Filter = "bandpass", Freq = 1100, Q = 4, Gain = -8, Attack = 0.001, Release = 0.06, Width = 0 })),
        new("hit-metal", "Impacts", "Metal clang", "A struck metal bar, ringing out.", () => OneShot("Impacts", "Metal clang", 2.2,
            new SoundLayer { Type = "synth", Name = "Ring", Wave = "sine", Pitch = 420, FmRatio = 2.76, FmDepth = 4, Attack = 0.001, Release = 1.8, Gain = -6, Width = 0 },
            new SoundLayer { Type = "synth", Name = "Overtone", Wave = "sine", Pitch = 1130, FmRatio = 1.41, FmDepth = 2, Attack = 0.001, Release = 1.1, Gain = -12, Width = 0 },
            new SoundLayer { Type = "noise", Name = "Strike", Color = "white", Filter = "highpass", Freq = 3500, Q = 0.7, Gain = -12, Attack = 0.001, Release = 0.03, Width = 0 })),
        new("hit-punch", "Impacts", "Punch", "A heavy body blow.", () => OneShot("Impacts", "Punch", 0.4,
            new SoundLayer { Type = "noise", Name = "Thud", Color = "brown", Filter = "lowpass", Freq = 900, Q = 0.7, Gain = -2, Attack = 0.001, Release = 0.15, Drive = 0.5, Width = 0 },
            Synth("Body", "sine", 120, 50, 0.001, 0, 0.12, -2),
            new SoundLayer { Type = "noise", Name = "Slap", Color = "white", Filter = "bandpass", Freq = 2500, Q = 1, Gain = -12, Attack = 0.001, Release = 0.02, Width = 0 })),
        new("hit-fall", "Impacts", "Body fall", "Someone hitting the ground.", () => OneShot("Impacts", "Body fall", 0.9,
            new SoundLayer { Type = "noise", Name = "Weight", Color = "brown", Filter = "lowpass", Freq = 400, Q = 0.7, Gain = -2, Attack = 0.004, Release = 0.35, Drive = 0.3, Width = 0.3 },
            new SoundLayer { Type = "noise", Name = "Cloth", Color = "pink", Filter = "bandpass", Freq = 1500, Q = 0.8, Gain = -14, Attack = 0.01, Release = 0.25, Width = 0.5 },
            new SoundLayer { Type = "events", Name = "Gear", Density = 1, Rhythm = 1, Burst = 6, BurstSpread = 150, Pitch = 2500, PitchSpread = 0.8, Tone = 0.4, Decay = 15, Gain = -18, Release = 0.3, Width = 0.6 })),
        new("whoosh-swing", "Whooshes", "Sword swing", "A fast blade cutting the air.", () => OneShot("Whooshes", "Sword swing", 0.5,
            new SoundLayer { Type = "noise", Name = "Air", Color = "pink", Filter = "bandpass", Freq = 400, FreqEnd = 2500, Q = 2, Gain = -4, Attack = 0.12, Release = 0.25, Width = 0.6 },
            new SoundLayer { Type = "noise", Name = "Edge", Color = "white", Filter = "bandpass", Freq = 3000, FreqEnd = 7000, Q = 4, Gain = -16, Attack = 0.1, Release = 0.15, Width = 0.6 })),
        new("whoosh-riser", "Whooshes", "Riser", "A build-up that rises for three seconds.", () => OneShot("Whooshes", "Riser", 3.2,
            new SoundLayer { Type = "noise", Name = "Rise", Color = "white", Filter = "bandpass", Freq = 300, FreqEnd = 6000, Q = 3, Gain = -6, Attack = 2.8, Release = 0.2, Width = 0.8 },
            new SoundLayer { Type = "synth", Name = "Tone", Wave = "saw", Pitch = 200, PitchEnd = 1200, Attack = 2.8, Release = 0.2, Gain = -16, Vibrato = 0.2, VibratoRate = 7, UseFilter = true, Filter = "lowpass", Freq = 2000, Width = 0 })),
        // Machines.
        new("machine-engine", "Machines", "Engine idle", "A running motor (loops).", () =>
        {
            var r = Ambience("Machines", "Engine idle", 6, 0, 0.5,
                new SoundLayer { Type = "synth", Name = "Motor", Wave = "saw", Pitch = 45, Hold = 600, Attack = 0.01, Release = 0.1, Gain = -10, Drive = 0.5, UseFilter = true, Filter = "lowpass", Freq = 400, Vibrato = 0.1, VibratoRate = 6, Width = 0 },
                new SoundLayer { Type = "noise", Name = "Rumble", Color = "brown", Filter = "lowpass", Freq = 180, Gain = -12, Wobble = 0.4, WobbleRate = 7, Width = 0.4 });
            r.Duration = 4;
            // At 0 the engine idles exactly as before; turned up it revs: higher, brighter, louder.
            return Control(r, "Motor RPM", 0, ("L1:pitch", 14, 0.8), ("L1:freq", 1.6, 1), ("L1:gain", 3, 1), ("L2:freq", 1.2, 1), ("L2:gain", 4, 1));
        }),
        new("machine-rev", "Machines", "Engine rev", "Revs up, holds and drops back (automation over the length).", () =>
        {
            var r = OneShot("Machines", "Engine rev", 3,
                new SoundLayer { Type = "synth", Name = "Motor", Wave = "saw", Pitch = 45, Hold = 2.8, Attack = 0.02, Release = 0.2, Gain = -10, Drive = 0.5, UseFilter = true, Filter = "lowpass", Freq = 400, Vibrato = 0.1, VibratoRate = 6, Width = 0 },
                new SoundLayer { Type = "noise", Name = "Rumble", Color = "brown", Filter = "lowpass", Freq = 180, Gain = -12, Wobble = 0.4, WobbleRate = 7, Width = 0.4, Hold = 2.8, Release = 0.2 });
            r.Modulators.Add(new SoundModulator { Name = "Throttle", Type = "curve", Points = [[0, 0], [0.12, 0.05], [0.5, 1], [0.7, 0.92], [0.92, 0.1], [1, 0]] });
            r.Routes.AddRange([new() { Source = "M1", Target = "L1:pitch", Amount = 16, Curve = 0.8 }, new() { Source = "M1", Target = "L1:freq", Amount = 2 },
                new() { Source = "M1", Target = "L2:freq", Amount = 1.5 }, new() { Source = "M1", Target = "L2:gain", Amount = 5 }]);
            return r;
        }),
        new("machine-fan", "Machines", "Computer fan hum", "A quiet room with a PC running (loops).", () =>
        {
            var r = Ambience("Machines", "Computer fan hum", 6, 0, 0.5,
                new SoundLayer { Type = "noise", Name = "Air", Color = "pink", Filter = "bandpass", Freq = 900, Q = 0.8, Gain = -18, Width = 0.6 },
                new SoundLayer { Type = "synth", Name = "Hum", Wave = "sine", Pitch = 120, Hold = 600, Attack = 0.01, Release = 0.1, Gain = -26, Width = 0 },
                new SoundLayer { Type = "synth", Name = "Blade tone", Wave = "sine", Pitch = 240, Hold = 600, Attack = 0.01, Release = 0.1, Gain = -34, Vibrato = 0.02, VibratoRate = 0.3, Width = 0 });
            r.Duration = 6;
            return r;
        }),
        new("machine-buzz", "Machines", "Electric buzz", "A faulty light or a transformer (loops).", () =>
        {
            var r = Ambience("Machines", "Electric buzz", 6, 0, 0.5,
                new SoundLayer { Type = "synth", Name = "Buzz", Wave = "saw", Pitch = 50, Hold = 600, Attack = 0.01, Release = 0.1, Gain = -12, Drive = 0.6, Crush = 0.3, UseFilter = true, Filter = "bandpass", Freq = 800, Q = 1, Width = 0 },
                new SoundLayer { Type = "synth", Name = "Hum", Wave = "sine", Pitch = 100, Hold = 600, Attack = 0.01, Release = 0.1, Gain = -18, Width = 0 },
                new SoundLayer { Type = "events", Name = "Crackle", Density = 3, Decay = 3, Pitch = 5000, PitchSpread = 0.5, Tone = 0, Gain = -24, Burst = 4, BurstSpread = 20, Width = 0.3 });
            r.Duration = 4;
            return r;
        }),
        // Sci-fi and magic.
        new("scifi-teleport", "Sci-fi", "Teleport", "A shimmering upward sweep.", () => OneShot("Sci-fi", "Teleport", 1.3,
            new SoundLayer { Type = "synth", Name = "Sweep", Wave = "sine", Pitch = 300, PitchEnd = 2400, FmRatio = 3, FmDepth = 3, Vibrato = 1, VibratoRate = 18, Attack = 0.05, Release = 0.8, Gain = -8, Width = 0 },
            new SoundLayer { Type = "noise", Name = "Rush", Color = "white", Filter = "bandpass", Freq = 2000, FreqEnd = 8000, Q = 2, Gain = -16, Attack = 0.05, Release = 0.8, Width = 0.8 })),
        new("scifi-shield", "Sci-fi", "Shield up", "A force field switching on.", () => OneShot("Sci-fi", "Shield up", 1.2,
            new SoundLayer { Type = "synth", Name = "Charge", Wave = "triangle", Pitch = 220, PitchEnd = 880, Attack = 0.3, Release = 0.6, Gain = -8, Vibrato = 0.3, VibratoRate = 12, Width = 0 },
            new SoundLayer { Type = "synth", Name = "Field", Wave = "sine", Pitch = 660, FmRatio = 1.5, FmDepth = 2, Start = 0.25, Attack = 0.02, Release = 0.8, Gain = -12, Width = 0 })),
        new("scifi-computer", "Sci-fi", "Computer beeps", "A busy console chattering (loops).", () =>
        {
            var r = Ambience("Sci-fi", "Computer beeps", 6, 0, 0.5,
                new SoundLayer { Type = "synth", Name = "Beep", Wave = "square", Pitch = 1200, Attack = 0.002, Release = 0.05, Repeat = 0.37, Gain = -16, Width = 0 },
                new SoundLayer { Type = "synth", Name = "Beep 2", Wave = "sine", Pitch = 1800, Attack = 0.002, Release = 0.04, Repeat = 0.29, Start = 0.1, Gain = -18, Pan = 0.3, Width = 0 },
                new SoundLayer { Type = "synth", Name = "Low blip", Wave = "triangle", Pitch = 600, Arp = 7, ArpTime = 0.05, Attack = 0.002, Release = 0.08, Repeat = 1.11, Start = 0.2, Gain = -18, Pan = -0.3, Width = 0 });
            r.Duration = 3.33;
            return r;
        }),
        new("magic-sparkle", "Magic", "Sparkle", "Chimes and shimmer of a spell.", () =>
        {
            var r = OneShot("Magic", "Sparkle", 1.6,
                new SoundLayer { Type = "events", Name = "Chimes", Density = 45, Decay = 140, Pitch = 4000, PitchSpread = 1, Tone = 1, Gain = -16, Release = 1.2, Width = 1, GainSpread = 6 },
                new SoundLayer { Type = "synth", Name = "Tone", Wave = "sine", Pitch = 1760, FmRatio = 3.5, FmDepth = 1, Attack = 0.02, Release = 1.2, Gain = -14, Width = 0 },
                new SoundLayer { Type = "noise", Name = "Shimmer", Color = "white", Filter = "highpass", Freq = 6000, Gain = -26, Attack = 0.05, Release = 0.8, Width = 1 });
            r.Master.Reverb = 0.35;
            return r;
        }),
        new("magic-heal", "Magic", "Healing chime", "A warm, rising two-note chime.", () =>
        {
            var r = OneShot("Magic", "Healing chime", 2,
                new SoundLayer { Type = "synth", Name = "Bell", Wave = "sine", Pitch = 880, Arp = 7, ArpTime = 0.14, FmRatio = 2, FmDepth = 0.6, Attack = 0.005, Release = 1.5, Gain = -8, Width = 0 },
                new SoundLayer { Type = "synth", Name = "Octave", Wave = "sine", Pitch = 1760, Arp = 7, ArpTime = 0.14, Attack = 0.005, Release = 1.2, Gain = -18, Width = 0 });
            r.Master.Reverb = 0.3;
            return r;
        }),
        new("magic-bowl", "Magic", "Singing bowl", "A struck metal bowl that sings for seconds (a bell resonator).", () =>
            OneShot("Magic", "Singing bowl", 6,
                new SoundLayer { Type = "noise", Name = "Strike", Color = "pink", Filter = "lowpass", Freq = 3000, Gain = -6, Attack = 0.001, Release = 0.012, Width = 0,
                    Effects = [new SoundEffect { Type = "resonator", Body = "bell", Freq = 220, Decay = 7, Damping = 0.35, Detune = 0.4, Mix = 1 }] })),
        // Resonators: strike or pluck something, and it rings at a pitch.
        new("hit-glass", "Impacts", "Glass tap", "A fingernail on a wine glass (a glass resonator).", () =>
            OneShot("Impacts", "Glass tap", 2,
                new SoundLayer { Type = "noise", Name = "Tap", Color = "white", Filter = "highpass", Freq = 2000, Gain = -6, Attack = 0.0005, Release = 0.003, Width = 0,
                    Effects = [new SoundEffect { Type = "resonator", Body = "glass", Freq = 1320, Decay = 1.8, Damping = 0.25, Detune = 0.3, Mix = 1 }] })),
        new("pluck-string", "Instruments", "Plucked string", "A plucked nylon string (a string resonator): change its pitch, or modulate it.", () =>
            OneShot("Instruments", "Plucked string", 2.5,
                new SoundLayer { Type = "noise", Name = "Pluck", Color = "white", Filter = "lowpass", Freq = 6000, Gain = -6, Attack = 0.0005, Release = 0.006, Width = 0,
                    Effects = [new SoundEffect { Type = "resonator", Body = "string", Freq = 196, Decay = 2.5, Damping = 0.35, Detune = 0.15, Mix = 1 }] })),
        // More interface sounds.
        new("ui-confirm", "UI", "Confirm", "A friendly, rising OK.", () => OneShot("UI", "Confirm", 0.35,
            new SoundLayer { Type = "synth", Name = "Note", Wave = "sine", Pitch = 660, Arp = 7, ArpTime = 0.06, Attack = 0.002, Hold = 0.05, Release = 0.15, Gain = -6, Width = 0 })),
        new("ui-cancel", "UI", "Cancel", "A soft, falling no.", () => OneShot("UI", "Cancel", 0.35,
            new SoundLayer { Type = "synth", Name = "Note", Wave = "triangle", Pitch = 440, Arp = -5, ArpTime = 0.07, Attack = 0.002, Hold = 0.04, Release = 0.15, Gain = -6, Width = 0 })),
        new("ui-error", "UI", "Error", "A buzzy double beep.", () => OneShot("UI", "Error", 0.35,
            new SoundLayer { Type = "synth", Name = "Buzz", Wave = "square", Pitch = 180, Duty = 0.3, Attack = 0.002, Hold = 0.06, Release = 0.04, Repeat = 0.14, Crush = 0.3, Gain = -6, Width = 0 })),
        new("ui-notify", "UI", "Notification", "A gentle two-tone chime.", () => OneShot("UI", "Notification", 0.9,
            new SoundLayer { Type = "synth", Name = "First", Wave = "sine", Pitch = 988, FmRatio = 2, FmDepth = 0.3, Attack = 0.003, Release = 0.4, Gain = -8, Width = 0 },
            new SoundLayer { Type = "synth", Name = "Second", Wave = "sine", Pitch = 1319, FmRatio = 2, FmDepth = 0.3, Attack = 0.003, Release = 0.6, Start = 0.12, Gain = -8, Width = 0 })),
        new("ui-type", "UI", "Typewriter tick", "A tiny mechanical key tick (for text appearing).", () => OneShot("UI", "Typewriter tick", 0.12,
            new SoundLayer { Type = "noise", Name = "Tick", Color = "white", Filter = "highpass", Freq = 2000, Gain = -6, Attack = 0.0005, Release = 0.015, Width = 0 },
            Synth("Body", "sine", 2500, 1800, 0.0005, 0, 0.01, -10))),
        new("retro-jump", "Retro / arcade", "Jump", "A classic 8-bit jump.", () => OneShot("Retro / arcade", "Jump", 0.35,
            new SoundLayer { Type = "synth", Name = "Sweep", Wave = "square", Duty = 0.25, Pitch = 250, PitchEnd = 800, Attack = 0.002, Release = 0.25, Crush = 0.35, Gain = -6, Width = 0 })),
        new("retro-powerup", "Retro / arcade", "Power-up", "Rising, warbling 8-bit power-up.", () => OneShot("Retro / arcade", "Power-up", 0.8,
            new SoundLayer { Type = "synth", Name = "Rise", Wave = "square", Duty = 0.5, Pitch = 300, PitchEnd = 1500, Vibrato = 0.6, VibratoRate = 16, Attack = 0.01, Release = 0.6, Crush = 0.4, Gain = -6, Width = 0 })),
        new("retro-hurt", "Retro / arcade", "Hurt", "A short, crunchy 8-bit hit.", () => OneShot("Retro / arcade", "Hurt", 0.3,
            new SoundLayer { Type = "synth", Name = "Hit", Wave = "noise", Pitch = 400, Attack = 0.001, Release = 0.15, Crush = 0.7, Gain = -6, Width = 0 },
            new SoundLayer { Type = "synth", Name = "Drop", Wave = "square", Pitch = 300, PitchEnd = 80, Attack = 0.001, Release = 0.15, Crush = 0.5, Gain = -10, Width = 0 })),
        // Alarms, water, body.
        new("alarm-siren", "Alarms", "Siren", "A wailing siren (loops).", () =>
        {
            var r = Ambience("Alarms", "Siren", 6, 0, 0.5,
                new SoundLayer { Type = "synth", Name = "Siren", Wave = "saw", Pitch = 700, Vibrato = 4, VibratoRate = 0.5, Attack = 0.01, Hold = 600, Release = 0.1, Gain = -14, UseFilter = true, Filter = "lowpass", Freq = 3000, Width = 0 });
            r.Duration = 4; r.Master.Reverb = 0.2; r.Master.Room = 0.8;
            return r;
        }),
        new("alarm-beeps", "Alarms", "Alarm beeps", "An urgent repeating beep (loops).", () =>
        {
            var r = Ambience("Alarms", "Alarm beeps", 6, 0, 0.5,
                new SoundLayer { Type = "synth", Name = "Beep", Wave = "square", Pitch = 880, Attack = 0.003, Hold = 0.18, Release = 0.03, Repeat = 0.4, Gain = -16, Width = 0 });
            r.Duration = 3.2;
            return r;
        }),
        new("water-drips", "Water", "Cave drips", "Slow drops echoing in a cave (loops).", () =>
        {
            var r = Ambience("Water", "Cave drips", 6, 0, 0.5,
                new SoundLayer { Type = "events", Name = "Drops", Density = 2, Decay = 60, Pitch = 1400, PitchSpread = 0.6, Tone = 1, Gain = -12, GainSpread = 6, Width = 0.8 },
                new SoundLayer { Type = "noise", Name = "Air", Color = "brown", Filter = "lowpass", Freq = 200, Gain = -32, Wobble = 0.3, Width = 0.8 });
            r.Master.Reverb = 0.6; r.Master.Room = 0.95; r.Duration = 12;
            return r;
        }),
        new("body-heartbeat", "Body", "Heartbeat", "A calm heartbeat (loops).", () =>
        {
            var r = Ambience("Body", "Heartbeat", 6, 0, 0.5,
                new SoundLayer { Type = "synth", Name = "Lub", Wave = "sine", Pitch = 60, PitchEnd = 45, Attack = 0.005, Release = 0.12, Repeat = 0.85, Gain = -2, Width = 0 },
                new SoundLayer { Type = "synth", Name = "Dub", Wave = "sine", Pitch = 70, PitchEnd = 50, Attack = 0.005, Release = 0.1, Repeat = 0.85, Start = 0.22, Gain = -6, Width = 0 });
            r.Duration = 3.4; r.Master.LowPass = 400;
            return r;
        }),
    ];

    /// <summary>
    /// Master level of each ambience (dB), measured so they sit at a usable loudness out of the box: about −19 to −28 dB RMS,
    /// gentle ones quieter than storms.
    /// </summary>
    private static readonly Dictionary<string, double> Level = new()
    {
        ["wind-forest"] = 14, ["wind-field"] = 14.5, ["wind-storm"] = 11.5, ["wind-ruins"] = 14.5, ["wind-window"] = 21,
        ["rain-drizzle"] = 21.5, ["rain-steady"] = 15.5, ["rain-changing"] = 9, ["rain-downpour"] = 9.5, ["rain-tent"] = 6, ["rain-roof"] = 20.5,
        ["fire-camp"] = 11, ["water-stream"] = 15, ["water-falls"] = 6,
        ["walk-gravel"] = 8, ["walk-hall"] = 8, ["machine-engine"] = -8, ["machine-buzz"] = -2, ["scifi-computer"] = 12, ["water-drips"] = 20.5, ["machine-fan"] = 2,
    };

    /// <summary>Adds a named control (shown in Quick) and its connections; layers are L1, L2… in the order given.</summary>
    private static SoundRecipe Control(SoundRecipe r, string name, double value, params (string Target, double Amount, double Curve)[] routes)
    {
        r.Clamped();
        var k = new SoundKnob { Name = name, Value = value };
        r.Knobs.Add(k);
        r.Clamped();
        foreach (var (target, amount, curve) in routes) r.Routes.Add(new SoundRoute { Source = k.Id, Target = target, Amount = amount, Curve = curve });
        return r;
    }

    /// <summary>
    /// One-shots are brought to one loudness, so a coin and a footstep sit together (peak normalising alone left them
    /// 17 LU apart, the square-wave ones loudest). Loops keep their own levels from <see cref="Level"/>.
    /// </summary>
    public const double OneShotLufs = -16;

    public static SoundRecipe Make(string id)
    {
        var p = All.FirstOrDefault(x => x.Id == id) ?? throw new ArgumentException("Unknown preset.");
        var r = p.Make();
        r.Name = p.Name;
        if (Level.TryGetValue(id, out var level)) r.Master.Gain += level;
        if (!r.Loop && r.Master.TargetLufs == 0) r.Master.TargetLufs = OneShotLufs;
        return r.Clamped();
    }
}
