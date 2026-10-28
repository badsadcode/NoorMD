namespace NoorMD.Media;

/// <summary>Mood starters for NoorSequencer: small songs to listen to, change and build on.</summary>
public static class SongTemplates
{
    public sealed record Template(string Id, string Name, string Description, Func<SongRecipe> Make);

    public static readonly IReadOnlyList<Template> All =
    [
        new("empty", "Empty song", "A drum track and a synth, no notes: start from nothing.", Empty),
        new("cozy", "Cozy exploration", "Warm and unhurried, in a major key: wandering a village or a forest.", Cozy),
        new("dungeon", "Tense dungeon", "Low, slow and uneasy, harmonic minor: something is near.", Dungeon),
        new("arcade", "Cheerful arcade", "Fast, bright square waves and a busy beat: a level that wants to be played.", Arcade),
        new("ambient", "Lonely ambient", "Long soft pads, a few notes and a lot of space: a quiet, empty place.", Ambient),
    ];

    public static SongRecipe? Make(string id) => All.FirstOrDefault(t => t.Id == id)?.Make().Clamped();

    /// <summary>Notes from "step:length:pitch[:velocity]" separated by spaces.</summary>
    private static SongPattern P(string notes) => new()
    {
        Notes = notes.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(n =>
        {
            var f = n.Split(':');
            return new SongNote
            {
                Step = int.Parse(f[0]), Length = int.Parse(f[1]), Pitch = int.Parse(f[2]),
                Velocity = f.Length > 3 ? double.Parse(f[3], System.Globalization.CultureInfo.InvariantCulture) : 0.8,
            };
        }).ToList(),
    };

    /// <summary>A drum bar: one line per kit row in use ("row=x...x..."): x hits, o a soft hit, . nothing.</summary>
    private static SongPattern D(params string[] rows)
    {
        var p = new SongPattern();
        foreach (var r in rows)
        {
            var (row, hits) = (int.Parse(r[..r.IndexOf('=')]), r[(r.IndexOf('=') + 1)..]);
            for (var s = 0; s < hits.Length; s++)
                if (hits[s] is 'x' or 'o') p.Notes.Add(new SongNote { Step = s, Length = 1, Pitch = row, Velocity = hits[s] == 'x' ? 0.9 : 0.45 });
        }
        return p;
    }

    private static SongTrack Track(string name, string kind, SongInstrument ins, double gain, double pan, int[] sequence, params SongPattern[] patterns) =>
        new() { Name = name, Kind = kind, Instrument = ins, Gain = gain, Pan = pan, Sequence = [.. sequence], Patterns = [.. patterns] };

    private static SoundEffect Reverb(double size, double mix) => new() { Type = "reverb", Size = size, Mix = mix, Damping = 0.5 };
    private static SoundEffect Delay(double ms, double feedback, double mix) => new() { Type = "delay", Time = ms, Feedback = feedback, Mix = mix, Tone = 4000 };

    private static SongRecipe Empty() => new()
    {
        Name = "Untitled song", Tempo = 110, Key = 0, Scale = "minor", Bars = 8, LoopStart = 0, LoopEnd = 8,
        Tracks =
        [
            Track("Drums", "drums", new SongInstrument(), -6, 0, [1, 1, 1, 1, 1, 1, 1, 1], new SongPattern()),
            Track("Lead", "synth", new SongInstrument { Wave = "triangle" }, -8, 0, [1, 1, 1, 1, 1, 1, 1, 1], new SongPattern()),
        ],
    };

    private static SongRecipe Cozy()
    {
        // C major, 96 BPM: C – Am – F – G, a wandering triangle melody, a sine bass and soft brushes.
        var s = new SongRecipe { Name = "Cozy exploration", Family = "Exploration", Tempo = 96, Swing = 0.12, Key = 0, Scale = "major", Bars = 8, LoopEnd = 8 };
        s.Tracks.Add(Track("Melody", "synth", new SongInstrument { Wave = "triangle", Detune = 4, Attack = 0.01, Decay = 0.3, Sustain = 0.5, Release = 0.25, Cutoff = 5000, Vibrato = 8, VibratoRate = 5 },
            -9, 0.1, [1, 2, 1, 3, 1, 2, 4, 5],
            P("0:2:72 2:2:76 4:4:79 8:2:76 10:2:74 12:4:72"),
            P("0:3:69 3:1:71 4:4:72 8:2:76 10:2:74 12:4:72"),
            P("0:2:77 2:2:76 4:2:74 6:2:72 8:8:69"),
            P("0:2:77 2:2:81 4:4:79 8:2:77 10:2:76 12:4:74"),
            P("0:2:74 2:2:76 4:2:74 6:2:71 8:8:72")));
        s.Tracks.Add(Track("Bass", "synth", new SongInstrument { Wave = "sine", Detune = 0, Octave = -1, Attack = 0.005, Decay = 0.4, Sustain = 0.7, Release = 0.15 },
            -7, 0, [1, 2, 3, 4, 1, 2, 3, 4],
            P("0:6:48 8:4:48 12:4:55"), P("0:6:45 8:4:45 12:4:52"), P("0:6:41 8:4:41 12:4:48"), P("0:6:43 8:4:43 12:4:50")));
        s.Tracks.Add(Track("Chords", "synth", new SongInstrument { Wave = "saw", Detune = 10, Attack = 0.3, Decay = 0.5, Sustain = 0.6, Release = 0.6, Cutoff = 1200 },
            -18, -0.2, [1, 2, 3, 4, 1, 2, 3, 4],
            P("0:16:60 0:16:64 0:16:67"), P("0:16:57 0:16:60 0:16:64"), P("0:16:57 0:16:60 0:16:65"), P("0:16:59 0:16:62 0:16:67")));
        s.Tracks.Add(Track("Drums", "drums", new SongInstrument { DrumTone = 0.3, DrumDecay = 0.8 }, -10, 0, [0, 0, 1, 1, 1, 1, 1, 2],
            D("0=x.......x.o.....", "7=....x.......x...", "3=o.o.o.o.o.o.o.o."),
            D("0=x.......x.......", "7=....x.......x...", "3=o.o.o.o.o.o.o.o.", "1=..............oo")));
        s.Tracks[0].Effects.Add(Reverb(0.5, 0.25));
        s.Tracks[2].Effects.Add(Reverb(0.7, 0.4));
        return s;
    }

    private static SongRecipe Dungeon()
    {
        // A harmonic minor, 78 BPM: a pulsing low drone, a creeping pulse arpeggio and distant toms.
        var s = new SongRecipe { Name = "Tense dungeon", Family = "Dungeon", Tempo = 78, Key = 9, Scale = "harmonic-minor", Bars = 8, LoopEnd = 8 };
        s.Tracks.Add(Track("Drone", "synth", new SongInstrument { Wave = "saw", Detune = 14, Octave = -1, Attack = 0.8, Decay = 1, Sustain = 0.8, Release = 1.5, Cutoff = 400, Resonance = 2, FilterEnvelope = 1 },
            -12, 0, [1, 1, 2, 1, 1, 1, 2, 3],
            P("0:16:45 0:16:52"), P("0:16:41 0:16:48"), P("0:16:44 0:16:52")));
        s.Tracks.Add(Track("Arpeggio", "synth", new SongInstrument { Wave = "pulse", PulseWidth = 0.15, Detune = 0, Attack = 0.003, Decay = 0.15, Sustain = 0.2, Release = 0.2, Cutoff = 2500, FilterEnvelope = 1.5 },
            -16, 0.3, [0, 1, 1, 2, 1, 1, 2, 3],
            P("0:2:57:0.7 2:2:60:0.5 4:2:64:0.6 6:2:60:0.5 8:2:57:0.7 10:2:60:0.5 12:2:65:0.6 14:2:64:0.5"),
            P("0:2:53:0.7 2:2:57:0.5 4:2:60:0.6 6:2:57:0.5 8:2:53:0.7 10:2:57:0.5 12:2:60:0.6 14:2:65:0.5"),
            P("0:2:56:0.7 2:2:59:0.5 4:2:62:0.6 6:2:64:0.5 8:2:68:0.7 10:2:64:0.5 12:2:62:0.6 14:2:59:0.5")));
        s.Tracks.Add(Track("Bell", "synth", new SongInstrument { Wave = "sine", Detune = 3, Attack = 0.002, Decay = 1.2, Sustain = 0, Release = 1.2, Octave = 1 },
            -18, -0.4, [0, 0, 0, 1, 0, 0, 0, 2], P("0:4:69:0.5 12:4:68:0.4"), P("8:8:76:0.4")));
        s.Tracks.Add(Track("Drums", "drums", new SongInstrument { DrumTune = -5, DrumDecay = 1.6, DrumTone = 0.2 }, -8, 0, [1, 1, 1, 2, 1, 1, 1, 3],
            D("0=x...............", "5=........x......."),
            D("0=x.........x.....", "5=........x...o..."),
            D("0=x.......x.......", "5=........x.o.x.o.", "6=..............x.")));
        s.Tracks[1].Effects.Add(Delay(577, 0.45, 0.3));
        s.Tracks[2].Effects.Add(Reverb(0.9, 0.6));
        s.Tracks[3].Effects.Add(Reverb(0.8, 0.35));
        return s;
    }

    private static SongRecipe Arcade()
    {
        // G major pentatonic, 140 BPM: a square lead, a bouncy pulse bass and a full kit.
        var s = new SongRecipe { Name = "Cheerful arcade", Family = "Arcade", Tempo = 140, Key = 7, Scale = "major-pentatonic", Bars = 8, LoopEnd = 8 };
        s.Tracks.Add(Track("Lead", "synth", new SongInstrument { Wave = "square", Detune = 0, Attack = 0.002, Decay = 0.12, Sustain = 0.5, Release = 0.08, Cutoff = 6000, Vibrato = 12, VibratoRate = 6 },
            -14, 0, [1, 2, 1, 3, 1, 2, 4, 5],
            P("0:2:79 2:2:83 4:2:86 6:2:83 8:3:88 11:1:86 12:4:83"),
            P("0:2:81 2:2:79 4:2:76 6:2:79 8:4:81 12:4:74"),
            P("0:2:79 2:2:81 4:2:83 6:2:86 8:6:88 14:2:86"),
            P("0:2:88 2:2:86 4:2:83 6:2:81 8:2:79 10:2:76 12:4:74"),
            P("0:2:76 2:2:79 4:2:81 6:2:83 8:8:79")));
        s.Tracks.Add(Track("Bass", "synth", new SongInstrument { Wave = "pulse", PulseWidth = 0.3, Detune = 0, Octave = -1, Attack = 0.002, Decay = 0.1, Sustain = 0.4, Release = 0.05, Cutoff = 2000 },
            -11, 0, [1, 2, 1, 3, 1, 2, 3, 1],
            P("0:2:55 4:2:55 6:2:62 8:2:55 12:2:55 14:2:62"), P("0:2:52 4:2:52 6:2:59 8:2:52 12:2:52 14:2:59"), P("0:2:52 4:2:52 6:2:59 8:2:50 12:2:50 14:2:57")));
        s.Tracks.Add(Track("Drums", "drums", new SongInstrument { DrumTone = 0.6 }, -8, 0, [1, 1, 1, 2, 1, 1, 1, 3],
            D("0=x.....x.x.....", "1=....x.......x...", "3=x.x.x.x.x.x.x.x."),
            D("0=x.....x.x.....", "1=....x.......x...", "3=x.x.x.x.x.x.x...", "4=..............x."),
            D("0=x.....x.x.....", "1=....x.......x.xx", "2=............x...", "6=........x.x.....", "5=............x.x.")));
        s.Tracks[0].Effects.Add(Delay(214, 0.25, 0.2));
        return s;
    }

    private static SongRecipe Ambient()
    {
        // E minor, 66 BPM: two slow pads, sparse sine notes with long echoes, a rare soft pulse.
        var s = new SongRecipe { Name = "Lonely ambient", Family = "Ambient", Tempo = 66, Key = 4, Scale = "minor", Bars = 8, LoopEnd = 8 };
        s.Tracks.Add(Track("Pad", "synth", new SongInstrument { Wave = "saw", Detune = 18, Attack = 1.5, Decay = 1, Sustain = 0.8, Release = 2.5, Cutoff = 900, Vibrato = 4, VibratoRate = 0.5 },
            -16, -0.2, [1, 1, 2, 2, 3, 3, 4, 4],
            P("0:16:52 0:16:59 0:16:64"), P("0:16:48 0:16:55 0:16:64"), P("0:16:45 0:16:52 0:16:60"), P("0:16:47 0:16:54 0:16:62")));
        s.Tracks.Add(Track("Notes", "synth", new SongInstrument { Wave = "sine", Detune = 2, Attack = 0.01, Decay = 1.5, Sustain = 0, Release = 1.5 },
            -14, 0.3, [0, 1, 0, 2, 0, 1, 0, 3], P("4:4:76:0.5 10:4:79:0.4"), P("0:4:78:0.5 8:4:74:0.4"), P("2:4:71:0.4 8:8:76:0.5")));
        s.Tracks.Add(Track("Pulse", "drums", new SongInstrument { DrumTone = 0.1, DrumDecay = 2, DrumTune = -7 }, -16, 0, [1, 0, 1, 0, 1, 0, 1, 0], D("0=o...............")));
        s.Tracks[0].Effects.Add(Reverb(0.95, 0.5));
        s.Tracks[1].Effects.Add(Delay(682, 0.55, 0.4));
        s.Tracks[1].Effects.Add(Reverb(0.9, 0.5));
        return s;
    }
}
