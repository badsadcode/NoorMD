using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class SequencerTests
{
    private const int Sr = 22050;

    private static SongRecipe OneNote(string kind = "synth", int pitch = 69, string wave = "sine", int bars = 1) => new SongRecipe
    {
        Tempo = 120, Bars = bars, LoopEnd = bars,
        Tracks = [new SongTrack { Kind = kind, Gain = 0, Instrument = new SongInstrument { Wave = wave, Detune = 0, Release = 0.05 },
            Patterns = [new SongPattern { Notes = [new SongNote { Step = 0, Length = 4, Pitch = pitch, Velocity = 1 }] }], Sequence = [.. Enumerable.Repeat(1, bars)] }],
    }.Clamped();

    private static double Rms(float[] x, int from, int to)
    {
        double s = 0; for (var i = from; i < to; i++) s += x[i] * x[i];
        return Math.Sqrt(s / Math.Max(1, to - from));
    }

    /// <summary>The main frequency, by counting rising zero crossings.</summary>
    private static double Pitch(float[] x, int from, int to)
    {
        var c = 0;
        for (var i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) c++;
        return c * (double)Sr / (to - from);
    }

    [Fact]
    public void A_Note_Sounds_At_Its_Pitch_And_Only_While_It_Should()
    {
        var r = SequencerEngine.Render(OneNote(), Sr);
        // 120 BPM: a step is 0.125 s; the note holds 4 steps (0.5 s), then a 0.05 s release.
        Assert.InRange(Pitch(r.Left, (int)(0.1 * Sr), (int)(0.4 * Sr)), 430, 450);
        Assert.True(Rms(r.Left, (int)(0.1 * Sr), (int)(0.4 * Sr)) > 0.05);
        Assert.True(Rms(r.Left, (int)(0.7 * Sr), (int)(1.9 * Sr)) < 1e-4);
        // One bar of 4/4 at 120 BPM is 2 s.
        Assert.True(r.Seconds >= 2 - 1e-3);
    }

    [Fact]
    public void Same_Song_Renders_The_Same_And_Seed_Changes_Noise()
    {
        var song = SongTemplates.Make("arcade")!;
        var a = SequencerEngine.Render(song, Sr);
        var b = SequencerEngine.Render(song, Sr);
        Assert.Equal(a.Left, b.Left);
        song.Seed = 99;
        var c = SequencerEngine.Render(song, Sr);
        Assert.NotEqual(a.Left, c.Left);
    }

    [Fact]
    public void Every_Waveform_And_Drum_Row_Makes_Sound_Without_Clipping()
    {
        foreach (var w in SongInstrument.Waves)
        {
            var r = SequencerEngine.Render(OneNote(wave: w), Sr);
            Assert.True(Rms(r.Left, 0, Sr / 2) > 0.01, w);
            Assert.True(r.PeakDb <= 0, w);
        }
        for (var row = 0; row < SongRecipe.KitRows.Length; row++)
        {
            var r = SequencerEngine.Render(OneNote("drums", row), Sr);
            Assert.True(Rms(r.Left, 0, Sr / 10) > 0.005, SongRecipe.KitRows[row]);
            Assert.All(r.Left, v => Assert.True(float.IsFinite(v)));
        }
    }

    [Fact]
    public void Mute_Solo_Pan_And_Gain_Work()
    {
        var song = OneNote();
        song.Tracks.Add(new SongTrack { Kind = "synth", Gain = 0, Instrument = new SongInstrument { Wave = "square", Detune = 0 },
            Patterns = [new SongPattern { Notes = [new SongNote { Step = 8, Length = 4, Pitch = 57 }] }], Sequence = [1] });
        song.Clamped();
        song.Tracks[0].Solo = true;
        var solo = SequencerEngine.Render(song, Sr);
        Assert.True(Rms(solo.Left, (int)(1.1 * Sr), (int)(1.4 * Sr)) < 1e-4); // the second track is not heard
        song.Tracks[0].Solo = false; song.Tracks[0].Mute = true;
        var muted = SequencerEngine.Render(song, Sr);
        Assert.True(Rms(muted.Left, (int)(0.1 * Sr), (int)(0.4 * Sr)) < 1e-4);
        Assert.True(Rms(muted.Left, (int)(1.1 * Sr), (int)(1.4 * Sr)) > 0.01);
        // Hard left: nothing on the right.
        var left = OneNote(); left.Tracks[0].Pan = -1;
        var l = SequencerEngine.Render(left, Sr);
        Assert.True(Rms(l.Right, 0, Sr) < 1e-4 && Rms(l.Left, 0, Sr) > 0.01);
    }

    [Fact]
    public void Patterns_Are_Shared_And_Rests_Are_Silent()
    {
        var song = OneNote(bars: 3);
        song.Tracks[0].Sequence = [1, 0, 1];
        var r = SequencerEngine.Render(song, Sr);
        Assert.True(Rms(r.Left, (int)(0.1 * Sr), (int)(0.4 * Sr)) > 0.05);
        Assert.True(Rms(r.Left, (int)(2.1 * Sr), (int)(3.9 * Sr)) < 1e-4);
        Assert.True(Rms(r.Left, (int)(4.1 * Sr), (int)(4.4 * Sr)) > 0.05);
        // The two plays of pattern 1 are the same sound.
        Assert.Equal(r.Left.Skip(Sr / 10).Take(Sr / 4), r.Left.Skip(4 * Sr + Sr / 10).Take(Sr / 4));
    }

    [Fact]
    public void Swing_Delays_The_Offbeats()
    {
        var song = OneNote();
        song.Tracks[0].Patterns[0].Notes = [new SongNote { Step = 1, Length = 1, Pitch = 69, Velocity = 1 }];
        int Onset(SongRecipe s) { var r = SequencerEngine.Render(s, Sr); return Array.FindIndex(r.Left, v => Math.Abs(v) > 0.01); }
        var straight = Onset(song);
        song.Swing = 0.4;
        var swung = Onset(song);
        Assert.InRange(swung - straight, (int)(0.4 * 0.125 * Sr) - 50, (int)(0.4 * 0.125 * Sr) + 50);
    }

    [Fact]
    public void A_Loop_Has_The_Loop_Length_And_Wraps_Its_Tail_Without_A_Click()
    {
        var song = SongTemplates.Make("ambient")!;
        song.LoopStart = 2; song.LoopEnd = 6;
        var r = SequencerEngine.Render(song, Sr, loop: true);
        Assert.Equal((int)Math.Round(4 * song.BarSeconds * Sr), r.Left.Length);
        // Long reverbs and releases ring over the end: folded into the start, the start is not silent and the seam doesn't jump.
        Assert.True(Rms(r.Left, 0, 200) > 1e-4);
        Assert.True(SoundAnalysis.Measure(r.Left, r.Right, Sr).SeamJump <= 1.5);
        // The whole song keeps its tail instead.
        var whole = SequencerEngine.Render(song, Sr);
        Assert.True(whole.Seconds > song.Bars * song.BarSeconds + 0.5);
    }

    [Fact]
    public void Stems_Add_Up_To_The_Mix()
    {
        var song = SongTemplates.Make("cozy")!;
        song.Bars = 2; song.LoopEnd = 2; song.Clamped();
        var (mix, stems) = SequencerEngine.RenderStems(song, Sr);
        Assert.Equal(song.Tracks.Count, stems.Count);
        Assert.All(stems, s => Assert.Equal(mix.Left.Length, s.Render.Left.Length));
        for (var i = 0; i < mix.Left.Length; i += 97)
            Assert.Equal(mix.Left[i], stems.Sum(s => s.Render.Left[i]), 3);
    }

    [Fact]
    public void A_Sample_Track_Plays_The_Sample_At_Each_Notes_Pitch()
    {
        var n = Sr; var tone = new float[n];
        for (var i = 0; i < n; i++) tone[i] = (float)(0.5 * Math.Sin(2 * Math.PI * 220 * i / Sr));
        var sample = new SampleAudio { Left = tone, Right = tone, Rate = Sr };
        var song = OneNote("sample", 69);
        song.Tracks[0].Instrument.Path = "C:/x/tone.wav"; song.Tracks[0].Instrument.RootNote = 57; // the sample is A3
        var r = SequencerEngine.Render(song, Sr, samples: p => p == "C:/x/tone.wav" ? sample : null);
        Assert.InRange(Pitch(r.Left, (int)(0.1 * Sr), (int)(0.4 * Sr)), 430, 450); // played an octave up
        Assert.Empty(r.Warnings);
        var missing = SequencerEngine.Render(song, Sr, samples: _ => null);
        Assert.Single(missing.Warnings);
    }

    [Fact]
    public void Clamped_Repairs_Anything()
    {
        var s = SongRecipe.FromJson("""
            {"tempo":9999,"beatsPerBar":40,"key":-1,"scale":"nope","bars":0,"loopStart":5,"loopEnd":2,
             "tracks":[{"kind":"weird","gain":1e9,"patterns":[{"notes":[{"step":99,"length":-3,"pitch":500,"velocity":7}]}],"sequence":[7,1]},
                       {"kind":"drums","patterns":[{"notes":[{"pitch":20}]}],"sequence":[]}]}
            """);
        Assert.Equal(300, s.Tempo); Assert.Equal(7, s.BeatsPerBar); Assert.Equal(11, s.Key); Assert.Equal("minor", s.Scale);
        Assert.Equal(1, s.Bars); Assert.Equal(0, s.LoopStart); Assert.Equal(1, s.LoopEnd);
        var t = s.Tracks[0];
        Assert.Equal("synth", t.Kind); Assert.Equal(12, t.Gain);
        var n = t.Patterns[0].Notes[0];
        Assert.Equal((27, 1, 127, 1.0), (n.Step, n.Length, n.Pitch, n.Velocity));
        Assert.Equal([1], t.Sequence);
        Assert.Equal(SongRecipe.KitRows.Length - 1, s.Tracks[1].Patterns[0].Notes[0].Pitch);
        Assert.Equal(["K1", "K2"], s.Tracks.Select(x => x.Id));
        Assert.Equal(s.ToJson(), SongRecipe.FromJson(s.ToJson()).ToJson());
    }

    [Fact]
    public void Templates_Are_Well_Formed_And_In_Their_Scale()
    {
        foreach (var tpl in SongTemplates.All)
        {
            var raw = tpl.Make();
            foreach (var t in raw.Tracks)
            {
                foreach (var p in t.Patterns) Assert.All(p.Notes, n => Assert.InRange(n.Step, 0, raw.StepsPerBar - 1));
                Assert.Equal(raw.Bars, t.Sequence.Count);
                Assert.All(t.Sequence, x => Assert.InRange(x, 0, t.Patterns.Count));
                if (t.Kind == "drums") continue;
                foreach (var p in t.Patterns) Assert.All(p.Notes, n => Assert.True(SongScales.Contains(raw.Scale, raw.Key, n.Pitch), $"{tpl.Id}/{t.Name}: {n.Pitch}"));
            }
            var r = SequencerEngine.Render(SongTemplates.Make(tpl.Id)!, Sr);
            Assert.True(r.PeakDb <= 0);
            if (tpl.Id != "empty") Assert.True(r.RmsDb > -40, tpl.Id);
        }
    }

    [Fact]
    public void Midi_Is_A_Valid_Type_1_File_With_Drums_On_Channel_10()
    {
        var song = SongTemplates.Make("arcade")!;
        var midi = SequencerEngine.ToMidi(song);
        Assert.Equal("MThd"u8.ToArray(), midi[..4]);
        Assert.Equal(1, midi[9]); // format 1
        Assert.Equal(song.Tracks.Count + 1, midi[11]); // a tempo track and one per track
        Assert.Equal(480, midi[12] << 8 | midi[13]);
        // Walk the chunks and the events.
        var pos = 14; var noteOns = new Dictionary<int, int>(); var drumNotes = new HashSet<int>();
        while (pos < midi.Length)
        {
            Assert.Equal("MTrk"u8.ToArray(), midi[pos..(pos + 4)]);
            var len = midi[pos + 4] << 24 | midi[pos + 5] << 16 | midi[pos + 6] << 8 | midi[pos + 7];
            var p = pos + 8; var end = p + len; byte status = 0;
            while (p < end)
            {
                while ((midi[p++] & 0x80) != 0) { } // delta
                if (midi[p] == 0xFF) { var l = midi[p + 2]; p += 3 + l; continue; }
                status = midi[p++];
                var kind = status & 0xF0; var ch = status & 0x0F;
                if (kind == 0xC0) { p += 1; continue; }
                var note = midi[p]; var vel = midi[p + 1]; p += 2;
                if (kind == 0x90 && vel > 0) { noteOns[ch] = noteOns.GetValueOrDefault(ch) + 1; if (ch == 9) drumNotes.Add(note); }
            }
            Assert.Equal(end, p);
            pos = end;
        }
        Assert.True(noteOns.GetValueOrDefault(9) > 50);
        Assert.Subset(SequencerEngine.GmDrums.ToHashSet(), drumNotes);
        var expected = song.Tracks.Sum(t => Enumerable.Range(0, song.Bars).Sum(b => t.Sequence[b] > 0 ? t.Patterns[t.Sequence[b] - 1].Notes.Count : 0));
        Assert.Equal(expected, noteOns.Values.Sum());
    }
}
