using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>Stage 3: tiles, hexagons, planks, spots, and erosion of the height so far.</summary>
public class TextureShapeTests
{
    private static TextureRecipe R(params TextureLayer[] layers) => new TextureRecipe { Layers = [.. layers] }.Clamped();
    private static float[] H(TextureRecipe r, int size = 128) => TextureEngine.Render(r, size).Height;

    /// <summary>The steps across the tile's edges are no bigger than the steps inside it: it tiles.</summary>
    private static void Seamless(float[] h, int n)
    {
        double inside = 0, across = 0;
        for (var k = 0; k < n; k++)
        {
            across = Math.Max(across, Math.Max(Math.Abs(h[k * n + n - 1] - h[k * n]), Math.Abs(h[(n - 1) * n + k] - h[k])));
            inside = Math.Max(inside, Math.Max(Math.Abs(h[k * n + n / 2] - h[k * n + n / 2 - 1]), Math.Abs(h[(n / 2) * n + k] - h[(n / 2 - 1) * n + k])));
        }
        Assert.True(across <= inside + 0.02, $"across {across:F3}, inside {inside:F3}");
    }

    [Theory]
    [InlineData("tiles")]
    [InlineData("hexagons")]
    [InlineData("planks")]
    [InlineData("spots")]
    public void New_shapes_tile_and_are_the_same_every_time(string type)
    {
        var r = R(new TextureLayer { Type = type, ScaleX = 5, ScaleY = 6, Mortar = 0.1, Bevel = 0.1, Tilt = 0.5, Variation = 0.4, Warp = 0.2 });
        var a = H(r); var b = H(r);
        Assert.Equal(a, b);
        Seamless(a, 128);
        Assert.True(a.Max() - a.Min() > 0.3, "it has relief");
    }

    [Fact]
    public void Tiles_have_joints_and_round_corners()
    {
        TextureLayer T(double round) => new() { Type = "tiles", ScaleX = 4, ScaleY = 4, Mortar = 0.2, Bevel = 0.05, Roundness = round, Variation = 0 };
        var square = H(R(T(0))); var round = H(R(T(1)));
        int n = 128, c = 16; // the middle of the first tile is at (16, 16); its corner near (31, 31)
        Assert.True(square[c * n + c] > 0.95 && round[c * n + c] > 0.95, "the tops are flat and high");
        Assert.True(square[0] < 0.05, "the joint between tiles is low");
        // Just inside the corner: a square tile is still up there, a round one has curved away.
        var corner = 27 * n + 27;
        Assert.True(square[corner] > round[corner] + 0.3, $"{square[corner]} vs {round[corner]}");
    }

    [Fact]
    public void Hexagons_are_regular_and_need_an_even_number_of_rows()
    {
        Assert.Equal(8, R(new TextureLayer { Type = "hexagons", ScaleX = 7, ScaleY = 7 }).Layers[0].ScaleY);
        // With rows ≈ 1.15 × across the cells are regular: the joint is as far from the middle in all six directions.
        var r = R(new TextureLayer { Type = "hexagons", ScaleX = 7, ScaleY = 8, Mortar = 0.15, Bevel = 0, Variation = 0 });
        var h = H(r, 512);
        double cx = 0, cy = 0; // a cell centred on the corner of the tile
        var reach = new List<double>();
        for (var k = 0; k < 6; k++)
        {
            var a = Math.PI / 6 + k * Math.PI / 3; // towards each edge's middle
            var t = 0.0;
            while (t < 0.2) { var x = (int)((cx + Math.Cos(a) * t) * 512); var y = (int)((cy + Math.Sin(a) * t) * 512); if (h[(((y % 512) + 512) % 512) * 512 + ((x % 512) + 512) % 512] < 0.5) break; t += 0.0005; }
            reach.Add(t);
        }
        Assert.True(reach.Max() - reach.Min() < 0.012, string.Join(", ", reach.Select(x => x.ToString("F4"))));
    }

    [Fact]
    public void Spots_follow_density_profile_and_size()
    {
        TextureLayer S(Action<TextureLayer> f) { var l = new TextureLayer { Type = "spots", ScaleX = 8, ScaleY = 8, Size = 0.6, Jitter = 0, Variation = 0, Density = 1 }; f(l); return l; }
        Assert.All(H(R(S(l => l.Density = 0))), v => Assert.Equal(0, v));
        var full = H(R(S(_ => { })));
        var half = H(R(S(l => l.Density = 0.5)));
        Assert.True(half.Count(v => v > 0.1) < full.Count(v => v > 0.1) * 0.75);
        // In rows (no jitter): a spot in the middle of every cell; dome highest at its centre, a crater lower there than at its rim.
        int n = 128, c = 8; // cells are 16 px: the first centre is at (8, 8)
        Assert.True(full[c * n + c] > 0.95);
        Assert.True(full[0] < 0.01, "between spots is flat");
        var crater = H(R(S(l => l.Profile = "crater")));
        var rim = crater.Skip(c * n).Take(16).Max();
        Assert.True(crater[c * n + c] < rim - 0.3, $"centre {crater[c * n + c]}, rim {rim}");
        var bigger = H(R(S(l => l.Size = 0.9)));
        Assert.True(bigger.Count(v => v > 0.05) > full.Count(v => v > 0.05) * 1.5);
    }

    [Fact]
    public void Planks_run_along_the_tile_with_staggered_joints()
    {
        var h = H(R(new TextureLayer { Type = "planks", ScaleX = 4, ScaleY = 1, Offset = 1, Mortar = 0.1, Bevel = 0.02, Grain = 0, Variation = 0 }), 256);
        // The gaps between boards run down the whole tile; the board ends are at different heights in each column.
        Assert.All(Enumerable.Range(0, 256), y => Assert.True(h[y * 256] < 0.1));
        var ends = Enumerable.Range(0, 4).Select(col => Enumerable.Range(0, 256).First(y => h[y * 256 + col * 64 + 32] < 0.1)).ToList();
        Assert.True(ends.Distinct().Count() >= 3, string.Join(",", ends));
    }

    private static TextureLayer Ground() => new() { Type = "noise", ScaleX = 2, ScaleY = 2, Octaves = 5, Persistence = 0.45 };

    [Theory]
    [InlineData("rain")]
    [InlineData("crumble")]
    [InlineData("wear")]
    public void Erosion_changes_the_height_the_same_way_every_time_and_still_tiles(string mode)
    {
        var before = H(R(Ground()));
        var r = R(Ground(), new TextureLayer { Type = "erosion", Mode = mode, Amount = 0.8 });
        var a = H(r); var b = H(r);
        Assert.Equal(a, b);
        Seamless(a, 128);
        var change = a.Zip(before, (x, y) => Math.Abs(x - y)).Average();
        Assert.True(change > 0.001, $"{mode} changed it by {change:F4} on average");
        // Nothing is made out of thin air: the eroded ground isn't higher overall.
        Assert.True(a.Average() <= before.Average() + 0.01);
    }

    [Fact]
    public void Erosion_does_its_own_thing()
    {
        double MaxSlope(float[] h, int n) { double m = 0; for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) m = Math.Max(m, Math.Abs(h[y * n + (x + 1) % n] - h[y * n + x])); return m; }
        double Peak(float[] h) => h.OrderByDescending(v => v).Take(h.Length / 100).Average();
        var before = H(R(Ground()), 256);
        var crumble = H(R(Ground(), new TextureLayer { Type = "erosion", Mode = "crumble", Amount = 1 }), 256);
        Assert.True(MaxSlope(crumble, 256) < MaxSlope(before, 256), "crumbling takes the steepest slopes down");
        var wear = H(R(Ground(), new TextureLayer { Type = "erosion", Mode = "wear", Amount = 1 }), 256);
        // Wear: what stands above its surroundings (edges, small ridges) stands up less.
        double Sharp(float[] h, int n) { double sum = 0; for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) { var around = (h[y * n + (x + 2) % n] + h[y * n + (x + n - 2) % n] + h[((y + 2) % n) * n + x] + h[((y + n - 2) % n) * n + x]) / 4; sum += Math.Max(0, h[y * n + x] - around); } return sum; }
        Assert.True(Sharp(wear, 256) < Sharp(before, 256) * 0.8, $"wear rounds the edges: {Sharp(wear, 256):F1} vs {Sharp(before, 256):F1}");
        Assert.True(Peak(wear) <= Peak(before), "…and never raises the tops");
        // Rain: it paints where the water ran: in streaks, not everywhere.
        var painted = TextureEngine.Render(R(Ground(), new TextureLayer { Type = "erosion", Mode = "rain", Amount = 0.8, Opacity = 0, Tint = "#ff0000", TintAmount = 1 }), 256);
        var plain = TextureEngine.Render(R(Ground()), 256);
        var redder = Enumerable.Range(0, 256 * 256).Count(i => painted.Albedo[i * 3] > plain.Albedo[i * 3] + 40);
        Assert.InRange(redder, 256 * 256 / 50, 256 * 256 / 2);
        Assert.Equal(plain.Height, painted.Height); // Strength 0: it only paints
    }

    [Fact]
    public void Erosion_agrees_between_the_preview_and_a_large_export()
    {
        var r = R(Ground(), new TextureLayer { Type = "erosion", Mode = "rain", Amount = 0.7 });
        var small = H(r, 256); var big = H(r, 1024);
        double diff = 0;
        for (var y = 0; y < 256; y++)
            for (var x = 0; x < 256; x++)
            {
                double sum = 0; for (var k = 0; k < 16; k++) sum += big[(y * 4 + k / 4) * 1024 + x * 4 + k % 4];
                diff += Math.Abs(sum / 16 - small[y * 256 + x]);
            }
        Assert.True(diff / (256 * 256) < 0.01, $"{diff / (256 * 256):F4}");
    }

    [Fact]
    public void New_settings_are_kept_in_range()
    {
        var l = new TextureLayer { Type = "spots", Roundness = 5, Tilt = -1, Grain = double.NaN, Size = 0, Density = 3, Profile = "star", Amount = 9 };
        var e = new TextureLayer { Type = "erosion", Mode = "flood" };
        var c = R(l, e);
        Assert.Equal((1.0, 0.0, 0.0, 0.05, 1.0, "dome", 1.0), (c.Layers[0].Roundness, c.Layers[0].Tilt, c.Layers[0].Grain, c.Layers[0].Size, c.Layers[0].Density, c.Layers[0].Profile, c.Layers[0].Amount));
        Assert.Equal("rain", c.Layers[1].Mode);
        Assert.Equal("cells", R(new TextureLayer { Type = "cells", Mode = "rain" }).Layers[0].Mode);
        var back = TextureRecipe.FromJson(c.ToJson());
        Assert.Equal(c.ToJson(), back.ToJson());
    }
}
