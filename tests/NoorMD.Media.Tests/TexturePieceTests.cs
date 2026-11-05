using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>Each piece its own (bricks, tiles, hexagons, planks told apart) and materials blended by height.</summary>
public class TexturePieceTests
{
    private static TextureRecipe R(params TextureLayer[] layers) => new TextureRecipe { Layers = [.. layers], Surface = new TextureSurface { ColorVariation = 0, Dirt = 0, Ramp = [new RampStop { Pos = 0, Color = "#808080" }, new RampStop { Pos = 1, Color = "#808080" }] } }.Clamped();

    /// <summary>The albedo's red at the middle of each tile of a 4 × 4 grid.</summary>
    private static double[] Centres(TextureMaps m, int cols = 4)
    {
        var s = m.Size;
        return Enumerable.Range(0, cols * cols).Select(k => { int cx = (int)((k % cols + 0.5) * s / cols), cy = (int)((k / cols + 0.5) * s / cols); return (double)m.Albedo[(cy * s + cx) * 3]; }).ToArray();
    }
    private static double Spread(double[] v) => v.Max() - v.Min();

    [Theory]
    [InlineData("tiles")]
    [InlineData("bricks")]
    [InlineData("planks")]
    public void Each_piece_gets_its_own_brightness(string type)
    {
        TextureLayer L(double pc) => new() { Type = type, ScaleX = 4, ScaleY = 4, Mortar = 0.05, Bevel = 0.02, Variation = 0, Tilt = 0, Grain = 0, Offset = 0, Opacity = 0, PieceColor = pc };
        var plain = TextureEngine.Render(R(L(0)), 128);
        var varied = TextureEngine.Render(R(L(1)), 128);
        Assert.True(Spread(Centres(plain)) < 3, $"plain spread {Spread(Centres(plain))}");
        Assert.True(Spread(Centres(varied)) > 30, $"varied spread {Spread(Centres(varied))}");
        // The same every time (the seed decides), and tiling: each piece one colour all over (its edge as its middle).
        Assert.Equal(varied.Albedo, TextureEngine.Render(R(L(1)), 128).Albedo);
    }

    [Fact]
    public void Hue_roughness_and_a_gradient_across_each_tile()
    {
        var warm = R(new TextureLayer { Type = "tiles", ScaleX = 4, ScaleY = 4, Mortar = 0.05, Tilt = 0, Variation = 0, Opacity = 0, PieceHue = 1 });
        warm.Surface.Ramp = [new RampStop { Pos = 0, Color = "#b06040" }, new RampStop { Pos = 1, Color = "#b06040" }];
        var hue = TextureEngine.Render(warm, 128);
        // Some tiles redder, some bluer: the channels no longer all equal.
        var s = hue.Size; var diff = 0;
        for (var k = 0; k < 16; k++) { int cx = (int)((k % 4 + 0.5) * s / 4), cy = (int)((k / 4 + 0.5) * s / 4), i = (cy * s + cx) * 3; if (Math.Abs(hue.Albedo[i] - 0xb0) > 12 || Math.Abs(hue.Albedo[i + 2] - 0x40) > 12) diff++; }
        Assert.True(diff >= 8, $"{diff} tiles with a hue of their own");
        var rough = TextureEngine.Render(R(new TextureLayer { Type = "tiles", ScaleX = 4, ScaleY = 4, Mortar = 0.05, Tilt = 0, Variation = 0, Opacity = 0, PieceRough = 1 }), 128);
        var rs = Enumerable.Range(0, 16).Select(k => (double)rough.Roughness[(int)((k / 4 + 0.5) * s / 4) * s + (int)((k % 4 + 0.5) * s / 4)]).ToArray();
        Assert.True(Spread(rs) > 40, $"roughness spread {Spread(rs)}");
        var grad = TextureEngine.Render(R(new TextureLayer { Type = "tiles", ScaleX = 2, ScaleY = 2, Mortar = 0.02, Tilt = 0, Variation = 0, Opacity = 0, PieceGradient = 1 }), 128);
        // Across one tile the brightness changes (darker one side, lighter the other).
        var row = Enumerable.Range(8, 48).Select(x => (double)grad.Albedo[(32 * 128 + x) * 3]).ToArray();
        var col = Enumerable.Range(8, 48).Select(y => (double)grad.Albedo[(y * 128 + 32) * 3]).ToArray();
        Assert.True(Math.Max(Spread(row), Spread(col)) > 20, $"row {Spread(row)}, column {Spread(col)}");
    }

    [Fact]
    public void A_material_blended_by_height_shows_where_it_is_higher()
    {
        // Flat low ground (height 0.2) and cobblestones blended in: they poke through where their height is above it.
        var ground = new TextureLayer { Type = "gradient", Mode = "linear", Low = 0, High = 0, Opacity = 0.2, Blend = "normal" };
        var stones = new TextureLayer { Type = "material", Material = "stone-cobbles", Opacity = 1, HeightBias = 0, Softness = 0.05 };
        var m = TextureEngine.Render(R(ground, stones), 128);
        var sub = TextureEngine.Render(TexturePresets.Make("stone-cobbles"), 128);
        int shown = 0, hidden = 0;
        for (var i = 0; i < 128 * 128; i += 7)
        {
            if (sub.Height[i] > 0.4) { shown++; Assert.InRange(m.Height[i], sub.Height[i] - 0.02, sub.Height[i] + 0.02); }
            if (sub.Height[i] < 0.1) hidden++;
        }
        Assert.True(shown > 100, $"{shown} texels of stone");
        // Sunk well below the ground: none of it shows (the ground's flat height everywhere).
        stones.HeightBias = -1;
        var sunk = TextureEngine.Render(R(ground, stones), 128);
        Assert.True(sunk.Height.All(v => Math.Abs(v - sunk.Height[0]) < 0.01), "sunk: the ground everywhere");
        // A material that isn't there: a warning, nothing else changes.
        stones.HeightBias = 0; stones.Material = "no-such";
        var missing = TextureEngine.Render(R(ground, stones), 64);
        Assert.Contains(missing.Warnings, w => w.Contains("no-such"));
        _ = hidden;
    }
}
