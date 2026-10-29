using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>More ideas from LMMS: a 303's accent and filter decay, a drum synth (Kicker), a drawn wave (BitInvader).</summary>
public class SequencerInstrumentTests
{
    private const int Sr = 22050;

    private static SongRecipe Song(SongInstrument ins, params SongNote[] notes) => new SongRecipe
    {
        Tempo = 120, Bars = 1, LoopEnd = 1,
        Tracks = [new SongTrack { Kind = "synth", Gain = 0, Instrument = ins, Patterns = [new SongPattern { Notes = [.. notes] }], Sequence = [1] }],
    }.Clamped();

    private static double Rms(float[] x, double t0, double t1)
    {
        int a = (int)(t0 * Sr), b = Math.Min(x.Length, (int)(t1 * Sr));
        double s = 0; for (var i = a; i < b; i++) s += x[i] * x[i];
        return Math.Sqrt(s / Math.Max(1, b - a));
    }

    /// <summary>How bright: the energy of the sample-to-sample change against the energy (a rough spectral tilt).</summary>
    private static double Bright(float[] x, double t0, double t1)
    {
        int a = (int)(t0 * Sr), b = Math.Min(x.Length, (int)(t1 * Sr));
        double d = 0, e = 0; for (var i = a + 1; i < b; i++) { d += (x[i] - x[i - 1]) * (x[i] - x[i - 1]); e += x[i] * x[i]; }
        return d / Math.Max(1e-12, e);
    }

    private static double Hz(float[] x, double t0, double t1)
    {
        int a = (int)(t0 * Sr), b = (int)(t1 * Sr), first = -1, last = -1, n = 0;
        for (var i = a + 1; i < b; i++) if (x[i - 1] <= 0 && x[i] > 0) { if (first < 0) first = i; else n++; last = i; }
        return n == 0 ? 0 : n * Sr / (double)(last - first);
    }

    private static SongInstrument Acid() => new() { Wave = "saw", Detune = 0, Octave = -1, Attack = 0.002, Decay = 0.3, Sustain = 0.6, Release = 0.05, Cutoff = 400, Resonance = 4, FilterEnvelope = 3, FilterDecay = 0.15 };

    [Fact]
    public void An_accent_is_louder_and_brighter()
    {
        var plain = SequencerEngine.Render(Song(Acid(), new SongNote { Step = 0, Length = 4, Pitch = 45 }), Sr);
        var hard = SequencerEngine.Render(Song(Acid(), new SongNote { Step = 0, Length = 4, Pitch = 45, Accent = true }), Sr);
        Assert.True(Rms(hard.Left, 0, 0.3) > 1.15 * Rms(plain.Left, 0, 0.3));
        Assert.True(Bright(hard.Left, 0.01, 0.08) > Bright(plain.Left, 0.01, 0.08));
    }

    [Fact]
    public void The_filter_decay_closes_the_filter_while_the_note_holds()
    {
        var r = SequencerEngine.Render(Song(Acid(), new SongNote { Step = 0, Length = 8, Pitch = 45 }), Sr);
        Assert.True(Bright(r.Left, 0.005, 0.05) > 2 * Bright(r.Left, 0.6, 0.9));
        // Without it the filter follows the volume envelope (sustained: still open later on).
        var ins = Acid(); ins.FilterDecay = 0;
        var held = SequencerEngine.Render(Song(ins, new SongNote { Step = 0, Length = 8, Pitch = 45 }), Sr);
        Assert.True(Bright(held.Left, 0.6, 0.9) > Bright(r.Left, 0.6, 0.9));
    }

    [Fact]
    public void A_kick_falls_in_pitch_and_other_notes_tune_it()
    {
        var ins = new SongInstrument { Wave = "kick", Attack = 0.001, Decay = 0.5, Sustain = 0, Release = 0.05, Cutoff = 20000, KickStart = 200, KickEnd = 50, KickSweep = 0.03, KickClick = 0, KickDrive = 0 };
        var c3 = SequencerEngine.Render(Song(ins, new SongNote { Step = 0, Length = 4, Pitch = 48 }), Sr);
        var early = Hz(c3.Left, 0.002, 0.03); var late = Hz(c3.Left, 0.15, 0.4);
        Assert.True(early > 90, $"early {early}");
        Assert.InRange(late, 45, 56);
        var c4 = SequencerEngine.Render(Song(ins, new SongNote { Step = 0, Length = 4, Pitch = 60 }), Sr);
        Assert.InRange(Hz(c4.Left, 0.15, 0.4), 92, 108); // an octave up
        // It dies away (decay with no sustain).
        Assert.True(Rms(c3.Left, 0.45, 0.55) < 0.2 * Rms(c3.Left, 0.0, 0.1));
    }

    [Fact]
    public void A_drawn_wave_sounds_as_drawn()
    {
        var square = Enumerable.Range(0, 64).Select(k => k < 32 ? 1.0 : -1.0).ToList();
        var ins = new SongInstrument { Wave = "drawn", Table = square, TableSmooth = false, Detune = 0, Attack = 0.001, Decay = 0.1, Sustain = 1, Release = 0.02, Cutoff = 20000, Resonance = 0.7 };
        var r = SequencerEngine.Render(Song(ins, new SongNote { Step = 0, Length = 4, Pitch = 57 }), Sr);
        Assert.InRange(Hz(r.Left, 0.1, 0.4), 214, 226); // A3
        // Mostly at its two levels, as a square is (the filter fully open).
        var seg = r.Left.Skip((int)(0.1 * Sr)).Take((int)(0.2 * Sr)).ToArray();
        var peak = seg.Max(Math.Abs);
        Assert.True(seg.Count(v => Math.Abs(v) > 0.8 * peak) > seg.Length * 0.8);
    }

    [Fact]
    public void Drawn_waves_are_kept_to_64_points_and_saved_with_the_recipe()
    {
        var song = Song(new SongInstrument { Wave = "drawn", Table = [0, 1, 0, -1], TableSmooth = false, FilterDecay = 0.2 }, new SongNote { Step = 0, Length = 2, Pitch = 60, Accent = true });
        var t = song.Tracks[0].Instrument.Table;
        Assert.Equal(SongInstrument.TableSize, t.Count);
        Assert.Equal(1, t[16], 3);
        var back = SongRecipe.FromJson(song.ToJson());
        Assert.Equal(t, back.Tracks[0].Instrument.Table);
        Assert.False(back.Tracks[0].Instrument.TableSmooth);
        Assert.True(back.Tracks[0].Patterns[0].Notes[0].Accent);
        Assert.Equal(0.2, back.Tracks[0].Instrument.FilterDecay);
        // No table at all: a sine.
        Assert.Equal(0, Song(new SongInstrument { Wave = "drawn" }).Tracks[0].Instrument.Table[0], 3);
    }
}
