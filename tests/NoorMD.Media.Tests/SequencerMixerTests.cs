using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>The mixer (as LMMS's FX mixer): send buses with their own effects, sends per track, levels for the meters.</summary>
public class SequencerMixerTests
{
    private const int Sr = 22050;

    private static SongRecipe Song(double send) => new SongRecipe
    {
        Tempo = 120, Bars = 2, LoopEnd = 2,
        Buses = [new SongBus { Id = "B1", Name = "Hall", Gain = 0, Effects = [new SoundEffect { Type = "reverb", Size = 0.9, Damping = 0.3, Mix = 1 }] }],
        Tracks =
        [
            new SongTrack { Name = "Pluck", Kind = "synth", Gain = 0, Sends = new() { ["B1"] = send },
                Instrument = new SongInstrument { Wave = "triangle", Detune = 0, Attack = 0.002, Decay = 0.1, Sustain = 0, Release = 0.02 },
                Patterns = [new SongPattern { Notes = [new SongNote { Step = 0, Length = 1, Pitch = 72 }] }], Sequence = [1, 0] },
        ],
    }.Clamped();

    private static double Rms(float[] x, double t0, double t1)
    {
        int a = (int)(t0 * Sr), b = Math.Min(x.Length, (int)(t1 * Sr));
        double s = 0; for (var i = a; i < b; i++) s += x[i] * x[i];
        return Math.Sqrt(s / Math.Max(1, b - a));
    }

    [Fact]
    public void A_send_to_a_reverb_bus_leaves_the_track_ringing_in_the_room()
    {
        var dry = SequencerEngine.Render(Song(0), Sr);
        var wet = SequencerEngine.Render(Song(0.6), Sr);
        // The pluck is over by 0.2 s; with the send the hall rings on.
        Assert.True(Rms(dry.Left, 0.4, 0.9) < 1e-4);
        Assert.True(Rms(wet.Left, 0.4, 0.9) > 1e-3);
    }

    [Fact]
    public void The_levels_name_each_track_and_bus_and_the_stems_add_up_to_the_mix()
    {
        var (mix, stems) = SequencerEngine.RenderStems(Song(0.6), Sr);
        Assert.Equal(["Pluck", "Hall"], mix.Levels!.Select(l => l.Name));
        Assert.All(mix.Levels!, l => Assert.InRange(l.PeakDb, -60, 0));
        Assert.Equal(["Pluck", "Hall"], stems.Select(s => s.Name));
        var n = Math.Min(mix.Left.Length, stems[0].Render.Left.Length);
        double err = 0;
        for (var i = 0; i < n; i++) err = Math.Max(err, Math.Abs(mix.Left[i] - stems.Sum(s => i < s.Render.Left.Length ? s.Render.Left[i] : 0)));
        Assert.True(err < 1e-4, $"stems differ from the mix by {err}");
    }

    [Fact]
    public void Buses_and_sends_are_kept_sensible()
    {
        var song = new SongRecipe
        {
            Buses = [new SongBus { Id = "X", Name = "", Gain = 99 }, new SongBus { Id = "B1" }, new SongBus { Id = "B2" }],
            Tracks = [new SongTrack { Sends = new() { ["B1"] = 3, ["B9"] = 0.5, ["B2"] = -1 } }],
        }.Clamped();
        Assert.Equal(2, song.Buses.Count);
        Assert.Equal(["B2", "B1"], song.Buses.Select(b => b.Id));
        Assert.Equal("Bus", song.Buses[0].Name);
        Assert.Equal(12, song.Buses[0].Gain);
        Assert.Equal(new Dictionary<string, double> { ["B1"] = 1 }, song.Tracks[0].Sends);
        var back = SongRecipe.FromJson(song.ToJson());
        Assert.Equal(1, back.Tracks[0].Sends["B1"]);
    }
}
