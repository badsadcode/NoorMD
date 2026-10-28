using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorSequencer stage 2 in the engine: arpeggiator, humanize, LFO, FM and automation.</summary>
public class SequencerHelpTests
{
    private const int Sr = 22050;

    private static SongRecipe Chord(int length = 8, params int[] pitches) => new SongRecipe
    {
        Tempo = 120, Bars = 2, LoopEnd = 2,
        Tracks = [new SongTrack { Kind = "synth", Gain = 0, Instrument = new SongInstrument { Wave = "sine", Detune = 0, Release = 0.05 },
            Patterns = [new SongPattern { Notes = [.. pitches.Select(p => new SongNote { Step = 0, Length = length, Pitch = p, Velocity = 0.8 })] }], Sequence = [1, 1] }],
    }.Clamped();

    private static double Rms(float[] x, int from, int to)
    {
        double s = 0; for (var i = from; i < to; i++) s += x[i] * x[i];
        return Math.Sqrt(s / Math.Max(1, to - from));
    }

    [Fact]
    public void The_Arpeggiator_Plays_A_Held_Chord_One_Note_After_Another()
    {
        var song = Chord(8, 60, 64, 67);
        song.Tracks[0].Instrument.Arp = "up";
        var up = SequencerEngine.Played(song, song.Tracks[0], 0, 0);
        Assert.Equal([60, 64, 67, 60], up.Select(n => n.Pitch));
        Assert.Equal([0.0, 2, 4, 6], up.Select(n => n.Step));
        Assert.All(up, n => Assert.Equal(2, n.Length));
        song.Tracks[0].Instrument.Arp = "down"; song.Tracks[0].Instrument.ArpOctaves = 2;
        Assert.Equal([79, 76, 72, 67], SequencerEngine.Played(song, song.Tracks[0], 0, 0).Select(n => n.Pitch));
        song.Tracks[0].Instrument.Arp = "updown"; song.Tracks[0].Instrument.ArpOctaves = 1; song.Tracks[0].Instrument.ArpRate = 1;
        Assert.Equal([60, 64, 67, 64, 60, 64, 67, 64], SequencerEngine.Played(song, song.Tracks[0], 0, 0).Select(n => n.Pitch));
        song.Tracks[0].Instrument.Arp = "chord"; song.Tracks[0].Instrument.ArpRate = 4;
        Assert.Equal(6, SequencerEngine.Played(song, song.Tracks[0], 0, 0).Count); // struck twice
        // Bar 2 is from the song's start.
        Assert.Equal(16, SequencerEngine.Played(song, song.Tracks[0], 0, 1)[0].Step);
    }

    [Fact]
    public void Midi_Has_The_Notes_As_Heard()
    {
        var song = Chord(8, 60, 64, 67);
        song.Tracks[0].Instrument.Arp = "up";
        var midi = SequencerEngine.ToMidi(song);
        // Two bars of four arpeggio notes: eight note-ons in the second track.
        var ons = 0;
        for (var i = 0; i + 2 < midi.Length; i++) if (midi[i] == 0x90 && midi[i + 2] > 0) ons++;
        Assert.Equal(8, ons);
    }

    [Fact]
    public void Humanize_Moves_Notes_A_Little_The_Same_Way_Every_Time()
    {
        var song = SongTemplates.Make("arcade")!;
        var drums = song.Tracks.FindIndex(t => t.Kind == "drums");
        var straight = SequencerEngine.Played(song, song.Tracks[drums], drums, 0);
        song.Tracks[drums].Humanize = 1;
        var human = SequencerEngine.Played(song, song.Tracks[drums], drums, 0);
        Assert.Equal(human, SequencerEngine.Played(song, song.Tracks[drums], drums, 0));
        Assert.Equal(straight.Count, human.Count);
        var shift = straight.Zip(human, (a, b) => Math.Abs(a.Step - b.Step) * song.StepSeconds).ToList();
        Assert.Contains(shift, d => d > 0.001);
        Assert.All(shift, d => Assert.True(d <= 0.0201));
        Assert.Contains(straight.Zip(human), p => Math.Abs(p.First.Velocity - p.Second.Velocity) > 0.01);
    }

    [Fact]
    public void Level_Automation_Fades_The_Track()
    {
        var song = Chord(16, 69);
        var flat = SequencerEngine.Render(song, Sr);
        song.Tracks[0].GainAutomation = [new SongPoint { Bar = 0, Value = 0 }, new SongPoint { Bar = 2, Value = -48 }];
        var faded = SequencerEngine.Render(song, Sr);
        double Bar(SoundRender r, double from, double to) => Rms(r.Left, (int)(from * 2 * Sr), (int)(to * 2 * Sr));
        // The same at the start, much quieter in the second bar (the master keeps the same gain: nothing is louder than before).
        Assert.InRange(Bar(faded, 0.05, 0.15) / Bar(flat, 0.05, 0.15), 0.6, 1.01);
        Assert.True(Bar(faded, 1.5, 1.9) < Bar(flat, 1.5, 1.9) * 0.1);
        Assert.Equal(-24, SequencerEngine.At(song.Tracks[0].GainAutomation, 1, 0), 6);
    }

    [Fact]
    public void Filter_Automation_Darkens_The_Synth()
    {
        var song = Chord(16, 57);
        song.Tracks[0].Instrument.Wave = "saw"; song.Tracks[0].Instrument.Cutoff = 8000;
        var open = SequencerEngine.Render(song, Sr).Measure().CentroidHz;
        song.Tracks[0].FilterAutomation = [new SongPoint { Bar = 0, Value = -5 }];
        var dark = SequencerEngine.Render(song, Sr).Measure().CentroidHz;
        Assert.True(dark < open * 0.6, $"{dark} vs {open}");
    }

    [Fact]
    public void The_Lfo_Moves_The_Volume_And_Fm_Brightens_A_Sine()
    {
        var song = Chord(16, 69);
        song.Tracks[0].Instrument.Sustain = 1;
        song.Tracks[0].Instrument.Lfo = "volume"; song.Tracks[0].Instrument.LfoRate = 4; song.Tracks[0].Instrument.LfoDepth = 1;
        var r = SequencerEngine.Render(song, Sr);
        // Over a quarter-second window the level swings with the LFO (4 Hz: a trough and a peak 1/8 s apart).
        var windows = Enumerable.Range(0, 24).Select(k => Rms(r.Left, (int)((0.2 + k * 0.03) * Sr), (int)((0.22 + k * 0.03) * Sr))).ToList();
        Assert.True(windows.Max() > windows.Min() * 4);
        var plain = Chord(16, 57);
        var bell = Chord(16, 57);
        bell.Tracks[0].Instrument.FmDepth = 4; bell.Tracks[0].Instrument.FmRatio = 3.5;
        Assert.True(SequencerEngine.Render(bell, Sr).Measure().CentroidHz > SequencerEngine.Render(plain, Sr).Measure().CentroidHz * 2);
    }

    [Fact]
    public void Older_Songs_Open_With_The_New_Settings_Off()
    {
        var s = SongRecipe.FromJson("""{"tracks":[{"kind":"synth","instrument":{"arp":"sideways","lfo":"elsewhere","arpRate":3},"gainAutomation":[{"bar":99,"value":-99}],"patterns":[],"sequence":[]}]}""");
        var t = s.Tracks[0];
        Assert.Equal(("off", "off", 2, 0.0), (t.Instrument.Arp, t.Instrument.Lfo, t.Instrument.ArpRate, t.Instrument.FmDepth));
        Assert.Equal((s.Bars, -48.0), (t.GainAutomation[0].Bar, t.GainAutomation[0].Value));
    }
}
