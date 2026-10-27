namespace NoorMD.Media;

/// <summary>
/// "Generate": a new sound of a kind (a pickup, a laser, a footstep, an engine…) from a seed. Each press makes a different
/// one within sensible ranges for that kind; the result is an ordinary recipe you can keep shaping.
/// </summary>
public static class SoundGenerator
{
    public sealed record Category(string Id, string Name, string Description);

    public static readonly IReadOnlyList<Category> Categories =
    [
        new("pickup", "Pickup / coin", "Bright, short, rising."),
        new("jump", "Jump", "A quick upward sweep."),
        new("laser", "Laser / shot", "A falling zap."),
        new("explosion", "Explosion", "A boom with debris."),
        new("hit", "Hit / hurt", "A short, harsh knock."),
        new("powerup", "Power-up", "A rising, shimmering tone."),
        new("blip", "UI blip / select", "A tiny interface sound."),
        new("error", "Error / denied", "A low, buzzy no."),
        new("whoosh", "Whoosh / swing", "Air moving past fast."),
        new("footstep", "Footstep", "One step on a surface."),
        new("impact", "Impact", "Something hard hitting something."),
        new("magic", "Magic / sparkle", "Chimes and shimmer."),
        new("scifi", "Sci-fi", "Beeps, warbles, teleports."),
        new("alarm", "Alarm", "A repeating warning (loops)."),
        new("engine", "Engine / machine hum", "A running motor (loops)."),
    ];

    public static SoundRecipe Make(string category, int seed)
    {
        var c = Categories.FirstOrDefault(x => x.Id == category) ?? throw new ArgumentException("Unknown kind of sound.");
        var rng = new SoundRng((ulong)(uint)seed * 0x9E3779B1UL + Hash(category)); // the same kind and seed: the same sound
        double R(double lo, double hi) => lo + (hi - lo) * rng.NextDouble();
        bool Chance(double p) => rng.NextDouble() < p;
        T Pick<T>(params T[] items) => items[(int)(rng.NextDouble() * items.Length) % items.Length];
        var r = new SoundRecipe { Family = "Generated", Name = $"{c.Name} {seed % 1000:000}", Seed = seed, Loop = false, Duration = 0.5, Gust = new GustSettings { Depth = 0 }, Master = new MasterSettings { Normalize = true, Ceiling = -1 } };
        SoundLayer Synth(string name, string wave, double pitch, double pitchEnd, double attack, double hold, double release, double gain) =>
            new() { Type = "synth", Name = name, Wave = wave, Pitch = pitch, PitchEnd = pitchEnd, Attack = attack, Hold = hold, Release = release, Gain = gain, Width = 0, Duty = R(0.2, 0.5) };
        SoundLayer Noise(string name, string color, string filter, double freq, double q, double attack, double release, double gain) =>
            new() { Type = "noise", Name = name, Color = color, Filter = filter, Freq = freq, Q = q, Attack = attack, Release = release, Gain = gain, Width = 0.6 };
        switch (category)
        {
            case "pickup":
            {
                var p = R(600, 1600);
                var s = Synth("Note", Pick("square", "sine", "triangle"), p, Chance(0.3) ? p * R(1.1, 1.5) : 0, 0.002, R(0.02, 0.08), R(0.12, 0.35), -6);
                s.Arp = Pick(3, 4, 5, 7, 12); s.ArpTime = R(0.04, 0.09);
                r.Layers.Add(s);
                if (Chance(0.4)) r.Layers.Add(new SoundLayer { Type = "synth", Name = "Sparkle", Wave = "sine", Pitch = p * 2, Arp = s.Arp, ArpTime = s.ArpTime, Attack = 0.002, Release = s.Release, Gain = -16, Width = 0 });
                r.Duration = Math.Round(s.ArpTime + s.Hold + s.Release * 1.2 + 0.05, 2);
                break;
            }
            case "jump":
            {
                var p = R(150, 400);
                var s = Synth("Sweep", Pick("square", "triangle", "sine"), p, p * R(2, 4), 0.003, 0, R(0.15, 0.3), -6);
                s.Vibrato = Chance(0.3) ? R(0.1, 0.4) : 0; s.VibratoRate = R(8, 20);
                r.Layers.Add(s);
                r.Duration = Math.Round(s.Release * 1.3 + 0.05, 2);
                break;
            }
            case "laser":
            {
                var s = Synth("Zap", Pick("saw", "square", "sine"), R(900, 2400), R(80, 400), 0.001, 0, R(0.12, 0.35), -6);
                if (Chance(0.4)) { s.FmRatio = R(0.5, 3); s.FmDepth = R(0.5, 3); }
                s.Crush = Chance(0.3) ? R(0.2, 0.6) : 0;
                r.Layers.Add(s);
                if (Chance(0.5)) r.Layers.Add(Noise("Hiss", "white", "highpass", R(2000, 5000), 0.7, 0.001, R(0.05, 0.15), -20));
                r.Duration = Math.Round(s.Release * 1.4 + 0.05, 2);
                break;
            }
            case "explosion":
            {
                var len = R(0.8, 2.5);
                var boom = Noise("Boom", "brown", "lowpass", R(300, 1200), 0.7, 0.004, len, 0);
                boom.FreqEnd = R(80, 200); boom.Drive = R(0, 0.5);
                r.Layers.Add(boom);
                r.Layers.Add(Noise("Blast", "white", "lowpass", R(2000, 6000), 0.7, 0.002, R(0.15, 0.4), -8));
                r.Layers.Add(Synth("Thump", "sine", R(70, 120), R(30, 50), 0.002, 0, R(0.3, 0.8), -4));
                if (Chance(0.6)) r.Layers.Add(new SoundLayer { Type = "events", Name = "Debris", Density = R(30, 120), Decay = R(10, 40), Pitch = R(1500, 4000), PitchSpread = 1, Tone = R(0, 0.4), Gain = R(-26, -18), Start = 0.05, Release = len * 0.8, Width = 1 });
                if (Chance(0.3)) boom.Crush = R(0.2, 0.5);
                r.Duration = Math.Round(len + 0.4, 2);
                r.Master.Reverb = R(0, 0.3);
                break;
            }
            case "hit":
            {
                r.Layers.Add(Noise("Smack", Pick("white", "pink"), "bandpass", R(800, 3000), R(0.6, 2), 0.001, R(0.04, 0.12), -6));
                var t = Synth("Body", Pick("sine", "square", "triangle"), R(150, 400), R(50, 120), 0.001, 0, R(0.06, 0.18), -6);
                t.Drive = R(0.2, 0.8); t.Crush = Chance(0.4) ? R(0.2, 0.7) : 0;
                r.Layers.Add(t);
                r.Duration = 0.3;
                break;
            }
            case "powerup":
            {
                var p = R(200, 500);
                var s = Synth("Rise", Pick("square", "triangle", "saw"), p, p * R(3, 6), R(0.01, 0.05), 0, R(0.4, 0.9), -8);
                s.Vibrato = R(0.2, 0.8); s.VibratoRate = R(10, 22);
                if (s.Wave != "square") { s.UseFilter = true; s.Filter = "lowpass"; s.Freq = R(1500, 4000); }
                r.Layers.Add(s);
                r.Layers.Add(new SoundLayer { Type = "synth", Name = "Shimmer", Wave = "sine", Pitch = p * 2, PitchEnd = p * 8, Attack = 0.05, Release = s.Release, Gain = -18, FmRatio = 2, FmDepth = R(0.5, 2), Width = 0 });
                r.Duration = Math.Round(s.Attack + s.Release * 1.2 + 0.05, 2);
                break;
            }
            case "blip":
            {
                var s = Synth("Blip", Pick("sine", "square", "triangle"), R(500, 2500), Chance(0.3) ? R(400, 3000) : 0, 0.001, 0, R(0.03, 0.1), -6);
                if (Chance(0.3)) { s.Arp = Pick(5, 7, 12, -5); s.ArpTime = R(0.02, 0.05); }
                r.Layers.Add(s);
                r.Duration = 0.2;
                break;
            }
            case "error":
            {
                var s = Synth("Buzz", Pick("square", "saw"), R(110, 260), 0, 0.002, R(0.04, 0.1), 0.06, -6);
                s.Repeat = R(0.11, 0.18); s.Crush = R(0, 0.4); s.Arp = Chance(0.4) ? -R(2, 5) : 0; s.ArpTime = 0.06;
                r.Layers.Add(s);
                r.Duration = Math.Round(s.Repeat * Pick(2, 3) + 0.02, 2);
                break;
            }
            case "whoosh":
            {
                var len = R(0.2, 0.6);
                var w = Noise("Air", Pick("pink", "white"), "bandpass", R(250, 700), R(1, 3), len * R(0.3, 0.6), len, -6);
                w.FreqEnd = R(1500, 5000); w.Hold = 0;
                r.Layers.Add(w);
                if (Chance(0.5)) { var h = Noise("Edge", "white", "bandpass", R(2500, 4000), R(3, 6), w.Attack, len * 0.6, -18); h.FreqEnd = R(5000, 9000); r.Layers.Add(h); }
                r.Duration = Math.Round(w.Attack + len * 1.3 + 0.05, 2);
                break;
            }
            case "footstep":
            {
                var surface = Pick("gravel", "wood", "snow", "stone", "grass");
                r.Name = $"Footstep on {surface} {seed % 1000:000}";
                r.Layers.Add(Synth("Heel", "sine", surface == "wood" ? R(140, 200) : R(80, 130), R(45, 70), 0.002, 0, R(0.05, 0.1), surface == "snow" ? -10 : -4));
                var crunch = new SoundLayer
                {
                    Type = "events", Name = "Surface", Release = R(0.08, 0.18), Width = 0.5, GainSpread = 8,
                    Density = 1, Rhythm = 1, Burst = surface switch { "gravel" => 18, "snow" => 26, "grass" => 14, "stone" => 3, _ => 2 },
                    BurstSpread = surface switch { "snow" => 120, "gravel" => 70, "grass" => 90, _ => 25 },
                    Pitch = surface switch { "wood" => R(500, 900), "stone" => R(1500, 2500), "snow" => R(2000, 3500), "grass" => R(3000, 6000), _ => R(2500, 4500) },
                    PitchSpread = 1, Tone = surface is "wood" or "stone" ? R(0.4, 0.8) : R(0, 0.2), Decay = surface == "wood" ? R(20, 40) : R(2, 6), Gain = R(-14, -8),
                };
                r.Layers.Add(crunch);
                if (surface is "grass" or "snow") r.Layers.Add(Noise("Rustle", "white", "bandpass", R(3000, 6000), 0.8, 0.005, 0.12, -22));
                r.Duration = 0.45;
                break;
            }
            case "impact":
            {
                var metal = Chance(0.5);
                if (metal)
                {
                    var p = R(250, 700);
                    r.Layers.Add(new SoundLayer { Type = "synth", Name = "Ring", Wave = "sine", Pitch = p, FmRatio = R(1.3, 3.6), FmDepth = R(2, 6), Attack = 0.001, Release = R(0.8, 2.2), Gain = -6, Width = 0 });
                    r.Layers.Add(new SoundLayer { Type = "synth", Name = "Overtone", Wave = "sine", Pitch = p * R(2.3, 3.1), FmRatio = R(1.1, 2), FmDepth = R(1, 3), Attack = 0.001, Release = R(0.4, 1.2), Gain = -12, Width = 0 });
                    r.Layers.Add(Noise("Strike", "white", "highpass", R(2500, 5000), 0.7, 0.001, 0.03, -12));
                    r.Name = $"Metal impact {seed % 1000:000}";
                    r.Duration = 2;
                }
                else
                {
                    r.Layers.Add(Synth("Knock", "triangle", R(120, 260), R(90, 160), 0.001, 0, R(0.08, 0.2), -4));
                    r.Layers.Add(Noise("Wood", "pink", "bandpass", R(700, 1600), R(2, 5), 0.001, R(0.04, 0.1), -8));
                    r.Name = $"Wooden impact {seed % 1000:000}";
                    r.Duration = 0.5;
                }
                break;
            }
            case "magic":
            {
                var len = R(0.8, 1.8);
                r.Layers.Add(new SoundLayer { Type = "events", Name = "Chimes", Density = R(25, 70), Decay = R(80, 200), Pitch = R(2500, 5000), PitchSpread = R(0.6, 1.2), Tone = 1, Gain = R(-20, -14), Release = len, Width = 1, GainSpread = 6 });
                r.Layers.Add(new SoundLayer { Type = "synth", Name = "Tone", Wave = "sine", Pitch = R(600, 1200), PitchEnd = Chance(0.5) ? R(1200, 2400) : 0, FmRatio = R(2, 4), FmDepth = R(0.5, 2), Attack = R(0.01, 0.1), Release = len, Gain = -12, Vibrato = R(0, 0.3), VibratoRate = 6, Width = 0 });
                r.Layers.Add(Noise("Shimmer", "white", "highpass", R(5000, 8000), 0.7, 0.05, len * 0.7, -26));
                r.Duration = Math.Round(len + 0.3, 2);
                r.Master.Reverb = R(0.2, 0.5);
                break;
            }
            case "scifi":
            {
                var kind = Pick("beeps", "warble", "teleport");
                if (kind == "beeps")
                {
                    r.Name = $"Computer beeps {seed % 1000:000}";
                    r.Layers.Add(new SoundLayer { Type = "synth", Name = "Beep", Wave = Pick("square", "sine"), Pitch = R(800, 2000), Attack = 0.002, Release = 0.05, Repeat = R(0.11, 0.25), Gain = -10, Duty = 0.5, Width = 0 });
                    r.Layers.Add(new SoundLayer { Type = "synth", Name = "Beep 2", Wave = "sine", Pitch = R(1500, 3000), Attack = 0.002, Release = 0.04, Repeat = R(0.17, 0.33), Start = R(0.03, 0.1), Gain = -14, Width = 0 });
                    r.Duration = 1.5;
                }
                else if (kind == "warble")
                {
                    r.Name = $"Sci-fi warble {seed % 1000:000}";
                    r.Layers.Add(new SoundLayer { Type = "synth", Name = "Warble", Wave = Pick("sine", "triangle"), Pitch = R(300, 900), PitchEnd = R(200, 1500), Vibrato = R(1, 4), VibratoRate = R(8, 25), Attack = 0.02, Hold = R(0.2, 0.6), Release = 0.3, Gain = -8, FmRatio = R(0.5, 2), FmDepth = R(0, 2), Width = 0 });
                    r.Duration = 1.2;
                }
                else
                {
                    r.Name = $"Teleport {seed % 1000:000}";
                    r.Layers.Add(new SoundLayer { Type = "synth", Name = "Sweep", Wave = "sine", Pitch = R(200, 400), PitchEnd = R(1800, 3500), FmRatio = R(2, 4), FmDepth = R(1, 4), Vibrato = R(0.5, 1.5), VibratoRate = R(14, 24), Attack = 0.05, Release = R(0.6, 1), Gain = -8, Width = 0 });
                    var n = Noise("Rush", "white", "bandpass", R(1500, 2500), 2, 0.05, 0.8, -16); n.FreqEnd = R(6000, 9000);
                    r.Layers.Add(n);
                    r.Duration = 1.3;
                }
                break;
            }
            case "alarm":
            {
                var p = R(500, 1000);
                r.Loop = true; r.Master.Normalize = false; r.Master.Gain = -4;
                var siren = Chance(0.5);
                if (siren)
                {
                    r.Name = $"Siren {seed % 1000:000}";
                    r.Duration = 4;
                    r.Layers.Add(new SoundLayer { Type = "synth", Name = "Siren", Wave = Pick("saw", "square", "triangle"), Pitch = p, Vibrato = R(3, 5), VibratoRate = 0.5, Attack = 0.01, Hold = 600, Release = 0.1, Gain = -10, UseFilter = true, Filter = "lowpass", Freq = R(2000, 5000), Width = 0 });
                }
                else
                {
                    r.Name = $"Alarm beeps {seed % 1000:000}";
                    var every = Pick(0.25, 0.4, 0.5);
                    r.Duration = every * 8;
                    r.Layers.Add(new SoundLayer { Type = "synth", Name = "Beep", Wave = Pick("square", "saw"), Pitch = p, Attack = 0.003, Hold = every * 0.45, Release = 0.03, Repeat = every, Gain = -10, Arp = Chance(0.5) ? Pick(-5, 5, 7) : 0, ArpTime = every * 0.25, Width = 0 });
                }
                break;
            }
            case "engine":
            {
                var f = R(30, 70);
                r.Loop = true; r.Master.Normalize = false; r.Duration = 4; r.Master.Gain = -6;
                r.Name = $"Engine hum {seed % 1000:000}";
                r.Layers.Add(new SoundLayer { Type = "synth", Name = "Motor", Wave = Pick("saw", "square"), Pitch = f, Hold = 600, Attack = 0.01, Release = 0.1, Gain = -12, Drive = R(0.3, 0.7), UseFilter = true, Filter = "lowpass", Freq = R(250, 700), Vibrato = R(0.05, 0.2), VibratoRate = R(4, 9), Width = 0 });
                r.Layers.Add(new SoundLayer { Type = "noise", Name = "Rumble", Color = "brown", Filter = "lowpass", Freq = R(120, 300), Gain = -14, Wobble = R(0.2, 0.5), WobbleRate = f / R(4, 8), Width = 0.4 });
                if (Chance(0.5)) r.Layers.Add(new SoundLayer { Type = "noise", Name = "Whine", Color = "white", Filter = "bandpass", Freq = R(1500, 4000), Q = 20, Gain = -30, Drift = 0.2, Width = 0.2 });
                break;
            }
        }
        return r.Clamped();
    }

    private static ulong Hash(string s)
    {
        ulong h = 1469598103934665603;
        foreach (var ch in s) { h ^= ch; h *= 1099511628211; }
        return h;
    }
}
