using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>Ideas taken from LMMS: notes that slide into the next one (a 303 bass line) and a place per note.</summary>
public class SequencerSlideTests
{
    private const int Sr = 22050;

    private static SongRecipe Song(params SongNote[] notes) => new SongRecipe
    {
        Tempo = 120, Bars = 1, LoopEnd = 1,
        Tracks = [new SongTrack { Kind = "synth", Gain = 0, Instrument = new SongInstrument { Wave = "sine", Detune = 0, Attack = 0.005, Release = 0.05 },
            Patterns = [new SongPattern { Notes = [.. notes] }], Sequence = [1] }],
    }.Clamped();

    /// <summary>The frequency between two times, from upward zero crossings.</summary>
    private static double Hz(float[] x, double from, double to)
    {
        int a = (int)(from * Sr), b = (int)(to * Sr), first = -1, last = -1, count = 0;
        for (var i = a + 1; i < b; i++)
            if (x[i - 1] <= 0 && x[i] > 0) { if (first < 0) first = i; else count++; last = i; }
        return count == 0 ? 0 : count * Sr / (double)(last - first);
    }

    [Fact]
    public void A_sliding_note_and_the_next_become_one_note_that_glides()
    {
        var song = Song(new SongNote { Step = 0, Length = 4, Pitch = 60, Slide = true }, new SongNote { Step = 4, Length = 4, Pitch = 67 },
            new SongNote { Step = 8, Length = 4, Pitch = 64 });
        var played = SequencerEngine.Played(song, song.Tracks[0], 0, 0);
        Assert.Equal(2, played.Count);
        Assert.Equal(60, played[0].Pitch);
        Assert.Equal(8, played[0].Length);
        Assert.Equal([(4.0, 7)], played[0].Slides!);
        Assert.Null(played[1].Slides);

        // Heard: middle C, then (no new attack) the G a fifth up. One step is 0.125 s at 120 BPM.
        var r = SequencerEngine.Render(song, Sr);
        Assert.InRange(Hz(r.Left, 0.1, 0.45), 255, 268);
        Assert.InRange(Hz(r.Left, 0.65, 0.95), 384, 400);
        // No gap where the second note would have started again: the level stays up through the slide.
        double Rms(double t0, double t1) { double s = 0; int a = (int)(t0 * Sr), b = (int)(t1 * Sr); for (var i = a; i < b; i++) s += r.Left[i] * r.Left[i]; return Math.Sqrt(s / (b - a)); }
        Assert.True(Rms(0.49, 0.51) > 0.5 * Rms(0.3, 0.45));
    }

    [Fact]
    public void Slides_chain_and_choose_the_nearest_note_of_a_chord()
    {
        var song = Song(new SongNote { Step = 0, Length = 2, Pitch = 48, Slide = true }, new SongNote { Step = 2, Length = 2, Pitch = 50, Slide = true },
            new SongNote { Step = 4, Length = 2, Pitch = 53 }, new SongNote { Step = 4, Length = 2, Pitch = 72 });
        var played = SequencerEngine.Played(song, song.Tracks[0], 0, 0);
        var slid = played.Single(n => n.Slides != null);
        Assert.Equal([(2.0, 2), (4.0, 5)], slid.Slides!);
        Assert.Contains(played, n => n.Pitch == 72 && n.Slides == null);
    }

    [Fact]
    public void A_note_has_its_own_place_left_to_right()
    {
        var mid = SequencerEngine.Render(Song(new SongNote { Step = 0, Length = 4, Pitch = 69 }), Sr);
        Assert.Equal(mid.Left, mid.Right);
        var left = SequencerEngine.Render(Song(new SongNote { Step = 0, Length = 4, Pitch = 69, Pan = -1 }), Sr);
        double Energy(float[] x) => x.Sum(v => (double)v * v);
        Assert.True(Energy(left.Right) < 1e-6 * Energy(left.Left));
    }

    [Fact]
    public void Slides_and_places_are_kept_in_the_recipe_and_midi_has_each_pitch()
    {
        var song = Song(new SongNote { Step = 0, Length = 4, Pitch = 60, Slide = true, Pan = 0.5 }, new SongNote { Step = 4, Length = 4, Pitch = 67 });
        var back = SongRecipe.FromJson(song.ToJson());
        Assert.True(back.Tracks[0].Patterns[0].Notes[0].Slide);
        Assert.Equal(0.5, back.Tracks[0].Patterns[0].Notes[0].Pan);
        var midi = SequencerEngine.ToMidi(song);
        int NoteOns(byte pitch) { var c = 0; for (var i = 0; i + 2 < midi.Length; i++) if ((midi[i] & 0xF0) == 0x90 && midi[i + 1] == pitch && midi[i + 2] > 0) c++; return c; }
        Assert.Equal(1, NoteOns(60));
        Assert.Equal(1, NoteOns(67));
    }
}
