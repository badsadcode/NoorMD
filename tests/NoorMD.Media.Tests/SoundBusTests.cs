using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class SoundBusTests
{
    private const int Sr = 22050;

    private static double Rms(float[] x, int from, int to) { double s = 0; for (var i = from; i < to; i++) s += x[i] * (double)x[i]; return 10 * Math.Log10(s / (to - from) + 1e-20); }

    /// <summary>A short blip (the first 0.1 s) and a reverb bus it can send to; 2 s long, nothing normalised.</summary>
    private static SoundRecipe Blip(double send = 0)
    {
        var r = new SoundRecipe
        {
            Duration = 2, Loop = false, Gust = new GustSettings { Depth = 0 },
            Layers = [new SoundLayer { Type = "synth", Name = "Blip", Wave = "sine", Pitch = 660, Attack = 0.002, Hold = 0.06, Release = 0.02, Gain = -12, Width = 0 }],
            Buses = [new SoundBus { Name = "Room", Effects = [new SoundEffect { Type = "reverb", Size = 0.8, Damping = 0.3, Mix = 1 }] }],
        }.Clamped();
        r.Layers[0].Sends.Add(new SoundSend { Bus = r.Buses[0].Id, Level = send });
        return r;
    }

    [Fact]
    public void A_Send_Puts_The_Layer_Through_The_Bus_Effects()
    {
        var wet = SoundEngine.Render(Blip(), Sr).Left;
        var r = Blip(); r.Layers[0].Sends.Clear();
        var dry = SoundEngine.Render(r, Sr).Left;
        Assert.True(Rms(dry, Sr / 2, Sr) < -100, "dry: silent after the blip");
        Assert.True(Rms(wet, Sr / 2, Sr) > -60, "sent to the reverb bus: a tail");
        // The dry blip is still there as it was (the send adds to it).
        Assert.InRange(Rms(wet, 100, 1200) - Rms(dry, 100, 1200), -1, 3);
        // Send level, bus level and mute.
        var quieter = Blip(-12);
        Assert.InRange(Rms(wet, Sr / 2, Sr) - Rms(SoundEngine.Render(quieter, Sr).Left, Sr / 2, Sr), 11, 13);
        var busDown = Blip(); busDown.Buses[0].Gain = -6;
        Assert.InRange(Rms(wet, Sr / 2, Sr) - Rms(SoundEngine.Render(busDown, Sr).Left, Sr / 2, Sr), 5, 7);
        var muted = Blip(); muted.Buses[0].Mute = true;
        Assert.True(Rms(SoundEngine.Render(muted, Sr).Left, Sr / 2, Sr) < -100);
        var off = Blip(-60);
        Assert.True(Rms(SoundEngine.Render(off, Sr).Left, Sr / 2, Sr) < -100, "−60 dB is off");
    }

    [Fact]
    public void Layers_Share_A_Bus_And_Its_Level_And_Effects_Can_Be_Modulated()
    {
        var r = Blip();
        r.Layers.Add(new SoundLayer { Type = "synth", Name = "Later", Wave = "sine", Pitch = 990, Start = 1, Attack = 0.002, Hold = 0.06, Release = 0.02, Gain = -12, Width = 0 });
        r.Clamped();
        r.Layers[1].Sends.Add(new SoundSend { Bus = r.Buses[0].Id, Level = 0 });
        var x = SoundEngine.Render(r, Sr).Left;
        Assert.True(Rms(x, Sr * 3 / 2, Sr * 2) > Rms(SoundEngine.Render(Blip(), Sr).Left, Sr * 3 / 2, Sr * 2) + 3, "the second layer's tail too");
        // A control turns the bus down; another route drives its reverb's mix.
        r.Knobs.Add(new SoundKnob { Value = 1 });
        r.Clamped();
        r.Routes.Add(new SoundRoute { Source = r.Knobs[0].Id, Target = r.Buses[0].Id + ":gain", Amount = -20 });
        var down = SoundEngine.Render(r, Sr).Left;
        Assert.InRange(Rms(x, Sr / 2, Sr * 9 / 10) - Rms(down, Sr / 2, Sr * 9 / 10), 19, 21);
        r.Routes[0].Target = $"{r.Buses[0].Id}/{r.Buses[0].Effects[0].Id}:mix";
        r.Routes[0].Amount = -1;
        Assert.True(Rms(SoundEngine.Render(r, Sr).Left, Sr / 2, Sr * 9 / 10) < -100, "reverb mix modulated to dry: the bus passes the blip only");
    }

    [Fact]
    public void Buses_And_Sends_Are_Kept_Tidy()
    {
        var r = Blip();
        r.Layers[0].Sends.Add(new SoundSend { Bus = r.Buses[0].Id, Level = -3 });   // a second send to the same bus
        r.Layers[0].Sends.Add(new SoundSend { Bus = "B9", Level = 0 });              // to a bus that isn't there
        r.Layers[0].Sends.Add(new SoundSend { Bus = r.Buses[0].Id, Level = 99 });
        for (var i = 0; i < 6; i++) r.Buses.Add(new SoundBus { Gain = 400 });
        var c = SoundRecipe.FromJson(r.ToJson()).Clamped();
        Assert.Equal(SoundBus.Max, c.Buses.Count);
        Assert.Equal(["B1", "B2", "B3", "B4"], c.Buses.Select(b => b.Id));
        Assert.Equal(12, c.Buses[1].Gain);
        Assert.Single(c.Layers[0].Sends);
        Assert.Equal(("B1", 0.0), (c.Layers[0].Sends[0].Bus, c.Layers[0].Sends[0].Level));
        Assert.Equal("F1", c.Buses[0].Effects[0].Id);
        var copy = c.Layers[0].Clone();
        copy.Sends[0].Level = -30;
        Assert.Equal(0, c.Layers[0].Sends[0].Level); // a copied layer has its own sends
    }

    [Fact]
    public void Stems_Line_Up_With_The_Mix()
    {
        var r = Blip(-6);
        r.Layers.Add(new SoundLayer { Type = "noise", Name = "Air", Color = "pink", Filter = "lowpass", Freq = 2000, Gain = -30, Width = 0.6 });
        r.Layers.Add(new SoundLayer { Type = "synth", Name = "Muted", Wave = "saw", Pitch = 100, Hold = 2, Gain = -12, Mute = true });
        r.Master.TargetLufs = -30; // quiet: the limiter doesn't touch it, so the stems add up exactly
        var stems = SoundEngine.RenderStems(r, Sr);
        Assert.Equal(["Mix", "Blip", "Air"], stems.Select(s => s.Name));
        var mix = stems[0].Render;
        Assert.InRange(mix.Measure().Lufs, -30.6, -29.7);
        Assert.Equal(mix.Left, SoundEngine.Render(r, Sr).Left);
        for (var i = 0; i < mix.Left.Length; i += 7)
            Assert.True(Math.Abs(stems[1].Render.Left[i] + stems[2].Render.Left[i] - mix.Left[i]) < 1e-4, $"sample {i}");
        // The blip's stem carries its reverb tail; the air stem is quieter, as it is in the mix (not normalised on its own).
        Assert.True(Rms(stems[1].Render.Left, Sr / 2, Sr) > -90);
        Assert.True(stems[2].Render.RmsDb < stems[1].Render.RmsDb + 6);
        // Solo: only the soloed layers get stems.
        r.Layers[1].Solo = true;
        Assert.Equal(["Mix", "Air"], SoundEngine.RenderStems(r, Sr).Select(s => s.Name));
    }
}
