using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>Blender-style additions: more noises, blend modes, ramp modes, colours per layer, bump and offset.</summary>
public class TextureBlenderTests
{
    private static TextureRecipe R(params TextureLayer[] layers) => new TextureRecipe { Layers = [.. layers] }.Clamped();
    private static float[] H(TextureRecipe r, int size = 128) => TextureEngine.Render(r, size).Height;

    private static void Seamless(float[] h, int n)
    {
        double inside = 0, across = 0;
        for (var y = 0; y < n; y++)
            for (var x = 0; x < n; x++)
            {
                var right = Math.Abs(h[y * n + (x + 1) % n] - h[y * n + x]);
                var down = Math.Abs(h[((y + 1) % n) * n + x] - h[y * n + x]);
                if (x == n - 1 || y == n - 1) across = Math.Max(across, x == n - 1 ? right : down); else inside = Math.Max(inside, Math.Max(right, down));
            }
        Assert.True(across <= inside + 0.02, $"across {across:F3}, inside {inside:F3}");
    }

    [Theory]
    [InlineData("musgrave", "fbm")]
    [InlineData("musgrave", "multifractal")]
    [InlineData("musgrave", "hybrid")]
    [InlineData("musgrave", "hetero")]
    [InlineData("musgrave", "ridged")]
    [InlineData("wave", "bands")]
    [InlineData("wave", "rings")]
    [InlineData("gradient", "linear")]
    [InlineData("gradient", "spherical")]
    [InlineData("checker", "")]
    [InlineData("magic", "")]
    [InlineData("cells", "smooth")]
    [InlineData("cells", "f2")]
    public void New_kinds_tile_have_relief_and_are_the_same_every_time(string type, string mode)
    {
        var r = R(new TextureLayer { Type = type, Mode = mode, ScaleX = 3, ScaleY = 4, Octaves = 5, Distortion = 0.4, Bevel = 0.1, Metric = "manhattan" });
        var a = H(r); var b = H(r);
        Assert.Equal(a, b);
        if (type != "checker") Seamless(a, 128); // a checker's squares meet at the edge as everywhere else
        Assert.True(a.Max() - a.Min() > 0.3, $"{type}/{mode} has relief: {a.Min():F2}–{a.Max():F2}");
    }

    [Fact]
    public void Musgrave_is_levelled_and_distance_styles_differ()
    {
        var m = H(R(new TextureLayer { Type = "musgrave", Mode = "hetero", ScaleX = 3, ScaleY = 3, Octaves = 7 }), 256);
        Assert.True(m.Min() <= 0.001 && m.Max() >= 0.999, "spread to 0–1");
        var round = H(R(new TextureLayer { Type = "cells", ScaleX = 5, ScaleY = 5, Metric = "euclidean" }));
        var square = H(R(new TextureLayer { Type = "cells", ScaleX = 5, ScaleY = 5, Metric = "chebyshev" }));
        Assert.NotEqual(round, square);
    }

    [Fact]
    public void Wave_bands_can_run_one_way()
    {
        var r = R(new TextureLayer { Type = "wave", ScaleX = 4, ScaleY = 0 });
        Assert.Equal(0, r.Layers[0].ScaleY);
        var h = H(r);
        // Bands across: every row is the same.
        for (var y = 1; y < 128; y += 9) for (var x = 0; x < 128; x += 7) Assert.Equal(h[x], h[y * 128 + x], 4);
        Assert.Equal(1, R(new TextureLayer { Type = "wave", Mode = "rings", ScaleX = 0, ScaleY = 0 }).Layers[0].ScaleX);
    }

    [Theory]
    [InlineData("softlight", 0.5, 0.5, 0.5)]
    [InlineData("softlight", 0.4, 1.0, 0.64)]
    [InlineData("difference", 0.8, 0.3, 0.5)]
    [InlineData("dodge", 0.4, 0.5, 0.8)]
    [InlineData("burn", 0.6, 0.5, 0.2)]
    [InlineData("divide", 0.3, 0.6, 0.5)]
    [InlineData("linearlight", 0.5, 0.75, 1.0)]
    [InlineData("linearlight", 0.5, 0.25, 0.0)]
    public void Blend_modes_as_in_Blender(string blend, double below, double layer, double expected)
    {
        Assert.Contains(blend, TextureLayer.Blends);
        Assert.Equal(expected, Math.Clamp(TextureEngine.Mix(blend, below, layer, 1), 0, 1), 6);
        Assert.Equal(below + (expected - below) * 0.5, Math.Clamp(TextureEngine.Mix(blend, below, layer, 0.5), 0, 1), 6); // opacity mixes towards it
    }

    [Fact]
    public void Ramp_modes_and_colours_of_a_layer_own()
    {
        TextureMaps Ramped(string mode) => TextureEngine.Render(new TextureRecipe
        {
            Layers = [new TextureLayer { Type = "noise", ScaleX = 3, ScaleY = 3 }],
            Surface = new TextureSurface { RampMode = mode, Ramp = [new() { Pos = 0, Color = "#000000" }, new() { Pos = 0.5, Color = "#ff0000" }, new() { Pos = 1, Color = "#ffffff" }], ColorVariation = 0, Dirt = 0, AoStrength = 0 },
        }.Clamped(), 128);
        var steps = Ramped("constant").Albedo;
        var colours = Enumerable.Range(0, steps.Length / 3).Select(i => (steps[i * 3], steps[i * 3 + 1], steps[i * 3 + 2])).Distinct().ToList();
        Assert.True(colours.Count <= 3, $"constant: only the stops' colours, got {colours.Count}");
        Assert.True(Ramped("linear").Albedo.Distinct().Count() > 50);
        Assert.NotEqual(Ramped("linear").Albedo, Ramped("ease").Albedo);
        Assert.NotEqual(Ramped("linear").Albedo, Ramped("bspline").Albedo);
        // A layer's own ramp: transparent where its stop says 0, green where it says 1.
        var plain = TextureEngine.Render(R(new TextureLayer { Type = "noise", ScaleX = 2, ScaleY = 2 }), 128);
        var moss = TextureEngine.Render(R(new TextureLayer { Type = "noise", ScaleX = 2, ScaleY = 2 },
            new TextureLayer { Type = "cells", ScaleX = 6, ScaleY = 6, Opacity = 0, Ramp = [new() { Pos = 0.5, Color = "#00ff00", Alpha = 0 }, new() { Pos = 0.6, Color = "#00ff00", Alpha = 1 }] }), 128);
        Assert.Equal(plain.Height, moss.Height);
        int greener = 0, same = 0;
        for (var i = 0; i < 128 * 128; i++)
        {
            if (moss.Albedo[i * 3 + 1] > 240 && moss.Albedo[i * 3] < 40) greener++;
            else if (moss.Albedo[i * 3 + 1] == plain.Albedo[i * 3 + 1]) same++;
        }
        Assert.True(greener > 500 && same > 2000, $"green {greener}, untouched {same}");
    }

    [Fact]
    public void Bump_changes_the_normals_not_the_height()
    {
        var plain = TextureEngine.Render(R(new TextureLayer { Type = "noise", ScaleX = 2, ScaleY = 2 }), 128);
        var bumped = TextureEngine.Render(R(new TextureLayer { Type = "noise", ScaleX = 2, ScaleY = 2 }, new TextureLayer { Type = "cells", ScaleX = 10, ScaleY = 10, Mode = "cracks", Opacity = 0, Bump = 1 }), 128);
        Assert.Equal(plain.Height, bumped.Height);
        Assert.NotEqual(plain.Normal, bumped.Normal);
    }

    [Fact]
    public void Offset_moves_the_pattern_and_it_still_tiles()
    {
        var a = H(R(new TextureLayer { Type = "bricks", ScaleX = 4, ScaleY = 8 }));
        var b = H(R(new TextureLayer { Type = "bricks", ScaleX = 4, ScaleY = 8, ShiftX = 0.25, ShiftY = 0.5 }));
        Assert.NotEqual(a, b);
        for (var y = 0; y < 128; y += 5) for (var x = 0; x < 128; x += 3) Assert.Equal(a[y * 128 + x], b[((y + 64) % 128) * 128 + (x + 32) % 128]);
    }

    [Fact]
    public void New_settings_are_kept_in_range_and_old_recipes_still_open()
    {
        var c = R(new TextureLayer { Type = "musgrave", Mode = "wobbly", Dimension = 9, Gain = -1, Frequency = 999, Distortion = 99, Bump = 2, ShiftX = -1, Metric = "taxi", RampMode = "x", Ramp = [new() { Pos = 2, Color = "nope", Alpha = 3 }] },
            new TextureLayer { Type = "wave", Profile = "dome" }, new TextureLayer { Type = "checker", ScaleX = 3, ScaleY = 5 }, new TextureLayer { Type = "noise", Blend = "glow" });
        var m = c.Layers[0];
        Assert.Equal(("fbm", 2.0, 0.0, 64, 4.0, 1.0, 0.0, "euclidean", "linear"), (m.Mode, m.Dimension, m.Gain, m.Frequency, m.Distortion, m.Bump, m.ShiftX, m.Metric, m.RampMode));
        Assert.Equal((1.0, "#808080", 1.0), (m.Ramp![0].Pos, m.Ramp[0].Color, m.Ramp[0].Alpha));
        Assert.Equal(("bands", "sine"), (c.Layers[1].Mode, c.Layers[1].Profile));
        Assert.Equal((4, 6), (c.Layers[2].ScaleX, c.Layers[2].ScaleY)); // a checker needs even counts to tile
        Assert.Equal("normal", c.Layers[3].Blend);
        var old = TextureRecipe.FromJson(TexturePresets.Make("bricks-red").ToJson().Replace("\"rampMode\": \"linear\",", ""));
        Assert.Equal("linear", old.Surface.RampMode);
        Assert.Equal(c.ToJson(), TextureRecipe.FromJson(c.ToJson()).ToJson());
    }
}

