using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorSequencer stage 3: adaptive layers, transitions between them and the loop check.</summary>
public class SequencerLayerTests
{
    private const int Sr = 22050;

    private static double Rms(float[] x, int from, int to)
    {
        double s = 0; for (var i = from; i < to; i++) s += x[i] * x[i];
        return Math.Sqrt(s / Math.Max(1, to - from));
    }

    [Fact]
    public void A_Layer_Plays_Its_Tracks_And_Those_In_Every_Layer()
    {
        var song = SongTemplates.Make("adaptive")!;
        Assert.Equal(["Exploration", "Danger", "Combat"], song.Layers.Select(l => l.Name));
        // A song of one sine track in layer L2 and nothing else: silent in L1, heard in L2 and in the whole song.
        var one = new SongRecipe
        {
            Tempo = 120, Bars = 1, LoopEnd = 1, Layers = [new SongLayer { Name = "Calm" }, new SongLayer { Name = "Fight" }],
            Tracks = [new SongTrack { Kind = "synth", Gain = 0, InLayers = ["L2"], Instrument = new SongInstrument { Wave = "sine", Detune = 0 },
                Patterns = [new SongPattern { Notes = [new SongNote { Step = 0, Length = 8, Pitch = 69 }] }], Sequence = [1] }],
        }.Clamped();
        Assert.Equal(["L1", "L2"], one.Layers.Select(l => l.Id));
        Assert.True(SequencerEngine.Render(one, Sr, layer: "L1").RmsDb < -100);
        Assert.True(SequencerEngine.Render(one, Sr, layer: "L2").RmsDb > -30);
        Assert.True(SequencerEngine.Render(one, Sr).RmsDb > -30);
    }

    [Fact]
    public void Layers_Share_One_Level_And_Loop_Length()
    {
        var song = SongTemplates.Make("adaptive")!;
        var layers = SequencerEngine.RenderLayers(song, Sr);
        Assert.Equal(3, layers.Count);
        Assert.All(layers, l => Assert.Equal(layers[0].Render.Left.Length, l.Render.Left.Length));
        Assert.All(layers, l => Assert.True(l.Render.PeakDb <= 0));
        // Combat has more going on than exploration, and they keep that difference (each is not brought up or down on its own).
        var calm = layers.Single(l => l.Layer.Name == "Exploration").Render;
        var fight = layers.Single(l => l.Layer.Name == "Combat").Render;
        Assert.True(fight.RmsDb > calm.RmsDb + 2, $"{fight.RmsDb} vs {calm.RmsDb}");
        // The track in every layer (the pad) is the same in each: subtracting two layers removes it.
        var pad = song.Clone(); pad.Tracks = [pad.Tracks[0]]; pad.Clamped();
        Assert.Empty(song.Tracks[0].InLayers);
    }

    [Fact]
    public void A_Transition_Plays_One_Layer_Then_Fades_Into_The_Next_In_Time()
    {
        float[] Tone(double hz, int n) => Enumerable.Range(0, n).Select(i => (float)(0.5 * Math.Sin(2 * Math.PI * hz * i / Sr))).ToArray();
        var n = Sr * 2;
        var a = new SoundRender { SampleRate = Sr, Left = Tone(220, n), Right = Tone(220, n) };
        var b = new SoundRender { SampleRate = Sr, Left = Tone(330, n), Right = Tone(330, n) };
        var t = SequencerEngine.Transition(a, b, 1);
        Assert.Equal(2 * n, t.Left.Length);
        Assert.Equal(a.Left[100], t.Left[100]);
        Assert.Equal(b.Left[Sr + 100], t.Left[n + Sr + 100], 5); // after the fade: only the new layer
        // Equal power through the fade: never a dip to silence.
        for (var k = 0; k < 10; k++) Assert.True(Rms(t.Left, n + k * Sr / 10, n + (k + 1) * Sr / 10) > 0.25);
    }

    [Fact]
    public void The_Loop_Check_Finds_A_Seamless_Loop_Clean_And_Measures_Its_Tail()
    {
        var song = SongTemplates.Make("adaptive")!;
        var report = SequencerEngine.CheckLoop(song, Sr);
        Assert.Equal(Math.Round(4 * song.BarSeconds, 3), report.Seconds, 2);
        Assert.True(report.SeamJump <= 1.5);
        Assert.True(report.TailPercent > 0); // the pad's release and reverb ring over the end, folded into the start
        Assert.DoesNotContain(report.Checks, c => c.Contains("jump"));
        // A layer with nothing in it is reported.
        song.Tracks.ForEach(t => t.InLayers = ["L1"]);
        Assert.Contains(SequencerEngine.CheckLoop(song, Sr, layer: "L2").Checks, c => c.Contains("nearly silent"));
    }

    [Fact]
    public void Layers_Survive_Saving_And_Unknown_Ones_Are_Dropped()
    {
        var s = SongRecipe.FromJson("""{"layers":[{"id":"L1","name":"Calm"},{"id":"L1","name":"Twice"},{"name":""},{"name":"4"},{"name":"5"}],"tracks":[{"inLayers":["L1","L9","L1"]}]}""");
        Assert.Equal(4, s.Layers.Count);
        Assert.Equal(["L1", "L2", "L3", "L4"], s.Layers.Select(l => l.Id));
        Assert.Equal("Layer", s.Layers[2].Name);
        Assert.Equal(["L1"], s.Tracks[0].InLayers);
    }
}
