using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class TextureImageTests
{
    /// <summary>A "photo": light bricks in dark mortar, lit from the left (dark there, bright on the right), not tileable.</summary>
    private static TextureImage Photo(int w = 300, int h = 200)
    {
        var rgb = new float[w * h * 3];
        var rng = new Random(5);
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                var row = y / 25; var bx = (x + 17 + (row % 2) * 30) % 60; var by = y % 25; // (no mortar line at the photo's centre)
                var mortar = bx < 5 || by < 4;
                var light = 0.45 + 0.55 * x / (w - 1.0);
                var (r, g, b) = mortar ? (0.35, 0.33, 0.3) : (0.75, 0.35, 0.25);
                var grain = 0.9 + 0.1 * rng.NextDouble();
                var i = (y * w + x) * 3;
                rgb[i] = (float)(r * light * grain); rgb[i + 1] = (float)(g * light * grain); rgb[i + 2] = (float)(b * light * grain);
            }
        return new TextureImage { Width = w, Height = h, Rgb = rgb, Id = $"photo{w}x{h}" };
    }

    private static TextureRecipe WithPhoto(Action<TextureLayer>? more = null)
    {
        var l = new TextureLayer { Type = "image", Name = "Photo", Path = "wall.jpg", ImageName = "wall.jpg", ScaleX = 1, ScaleY = 1, SeamBlend = 0.2 };
        more?.Invoke(l);
        return new TextureRecipe { Layers = [l], Surface = new TextureSurface { ColorVariation = 0, Dirt = 0 } }.Clamped();
    }

    private static TextureMaps Render(TextureRecipe r, int size = 128) => TextureEngine.Render(r, size, p => p == "wall.jpg" ? Photo() : null);

    private static double AlbedoEdgeJump(TextureMaps m)
    {
        // The average colour step across the tile's left–right edge, against the steps inside.
        int n = m.Size; double across = 0, inside = 0;
        for (var y = 0; y < n; y++)
        {
            int a = (y * n + n - 1) * 3, b = (y * n) * 3;
            across += Math.Abs(m.Albedo[a] - m.Albedo[b]) + Math.Abs(m.Albedo[a + 1] - m.Albedo[b + 1]);
            for (var x = 1; x < n; x++) { int c = (y * n + x - 1) * 3, d = (y * n + x) * 3; inside += Math.Abs(m.Albedo[c] - m.Albedo[d]) + Math.Abs(m.Albedo[c + 1] - m.Albedo[d + 1]); }
        }
        return across / n / (inside / (n * (n - 1)));
    }

    [Fact]
    public void A_Photo_Is_Made_Seamless_Without_Losing_Its_Contrast()
    {
        var plain = Render(WithPhoto(l => l.SeamBlend = 0));
        var blended = Render(WithPhoto());
        Assert.True(AlbedoEdgeJump(plain) > 3, $"untreated: {AlbedoEdgeJump(plain):0.0}× the usual step at the edge");
        Assert.True(AlbedoEdgeJump(blended) < 2, $"blended: {AlbedoEdgeJump(blended):0.0}×");
        // Variance-preserving: the blended border keeps about the contrast of the middle (a plain average would halve it).
        double Std(TextureMaps m, int x0, int x1)
        {
            var v = new List<double>();
            for (var y = 0; y < m.Size; y++) for (var x = x0; x < x1; x++) v.Add(m.Albedo[(y * m.Size + x) * 3]);
            var mean = v.Average();
            return Math.Sqrt(v.Average(a => (a - mean) * (a - mean)));
        }
        Assert.True(Std(blended, 0, 6) > Std(blended, 50, 78) * 0.7, $"{Std(blended, 0, 6):0.0} vs {Std(blended, 50, 78):0.0}");
    }

    [Fact]
    public void Light_Baked_Into_A_Photo_Can_Be_Evened_Out()
    {
        double Side(TextureMaps m, int x0, int x1) { double s = 0; var k = 0; for (var y = 0; y < m.Size; y++) for (var x = x0; x < x1; x++) { s += m.Albedo[(y * m.Size + x) * 3]; k++; } return s / k; }
        var raw = Render(WithPhoto(l => { l.SeamBlend = 0; l.Delight = 0; }));
        var even = Render(WithPhoto(l => { l.SeamBlend = 0; l.Delight = 1; l.DelightRadius = 0.5; }));
        var rawRatio = Side(raw, 96, 120) / Side(raw, 8, 32);
        var evenRatio = Side(even, 96, 120) / Side(even, 8, 32);
        Assert.True(rawRatio > 1.6, $"{rawRatio}");
        Assert.InRange(evenRatio, 0.85, 1.2);
    }

    [Fact]
    public void Height_Comes_From_The_Photos_Detail_And_A_Colour_Can_Be_Made_Low()
    {
        // Brick faces are lighter than mortar: higher. Telling it "the mortar colour is low" pushes the mortar down further.
        var m = Render(WithPhoto(l => { l.SeamBlend = 0; l.Delight = 1; l.ColorAmount = 0; }), 150);
        // Photo pixel (x, y) is at tile pixel (x/2, y*0.75); a brick centre (x 13) and a mortar line (x 45) in row 0:
        int Px(int px, int py) => (int)(py * 0.75) * 150 + px / 2;
        Assert.True(m.Height[Px(13, 14)] > m.Height[Px(45, 14)] + 0.1, $"brick {m.Height[Px(13, 14)]:0.00} vs mortar {m.Height[Px(45, 14)]:0.00}");
        // The mortar's colour (as the photo shows it there), said to be high instead (raised joints):
        var colours = Render(WithPhoto(l => { l.SeamBlend = 0; l.Delight = 1; }), 150);
        var mortar = $"#{colours.Albedo[Px(45, 14) * 3]:x2}{colours.Albedo[Px(45, 14) * 3 + 1]:x2}{colours.Albedo[Px(45, 14) * 3 + 2]:x2}";
        var picked = Render(WithPhoto(l => { l.SeamBlend = 0; l.Delight = 1; l.ColorAmount = 0; l.HeightColor = mortar; l.HeightColorAmount = 1; l.HeightColorTolerance = 0.1; }), 150);
        Assert.True(picked.Height[Px(45, 14)] > m.Height[Px(45, 14)] + 0.2, $"{picked.Height[Px(45, 14)]:0.00} vs {m.Height[Px(45, 14)]:0.00} ({mortar})");
        Assert.True(Math.Abs(picked.Height[Px(13, 14)] - m.Height[Px(13, 14)]) < 0.1, "the bricks stay where they were");
    }

    [Fact]
    public void Its_Colours_Paint_The_Albedo_As_Much_As_Asked_And_A_Missing_Photo_Is_Reported()
    {
        var full = Render(WithPhoto(l => l.SeamBlend = 0));
        var none = Render(WithPhoto(l => { l.SeamBlend = 0; l.ColorAmount = 0; }));
        // A brick: reddish from the photo, grey from the default ramp.
        var i = (20 * 128 + 70) * 3;
        Assert.True(full.Albedo[i] > full.Albedo[i + 2] + 40, "the photo's red brick");
        Assert.True(Math.Abs(none.Albedo[i] - none.Albedo[i + 2]) < 6, "the grey ramp");
        var missing = TextureEngine.Render(WithPhoto(), 64, _ => null);
        Assert.Contains(missing.Warnings, w => w.Contains("wall.jpg"));
        // The photo is repeated as many times as asked (2 × 2: the same pixel half a tile away).
        var twice = Render(WithPhoto(l => { l.SeamBlend = 0.2; l.ScaleX = 2; l.ScaleY = 2; }));
        Assert.Equal(twice.Albedo[(10 * 128 + 10) * 3], twice.Albedo[(74 * 128 + 74) * 3]);
    }

    [Fact]
    public void Any_Layer_Can_Paint_Colour_Roughness_And_Metal_Without_Changing_The_Height()
    {
        var baseRecipe = new TextureRecipe
        {
            Layers = [new TextureLayer { Type = "bricks", ScaleX = 2, ScaleY = 2, Offset = 0, Mortar = 0.1, Bevel = 0.05, Variation = 0 }],
            Surface = new TextureSurface { ColorVariation = 0, RoughnessVariation = 0, RoughnessLow = 0.8, RoughnessHigh = 0.8, Metallic = 0 },
        }.Clamped();
        var plain = TextureEngine.Render(baseRecipe, 64);
        var painted = baseRecipe.Clone();
        // A sharp mask (bricks 3 × 3, half of it mortar), painting only: moss green, shiny and metal on the "bricks".
        painted.Layers.Add(new TextureLayer { Type = "bricks", ScaleX = 3, ScaleY = 3, Offset = 0, Mortar = 0.3, Bevel = 0, Variation = 0, Opacity = 0, Tint = "#2f7d32", TintAmount = 1, RoughnessShift = -0.6, MetallicShift = 1 });
        var p = TextureEngine.Render(painted.Clamped(), 64);
        Assert.Equal(plain.Height, p.Height); // opacity 0: the height is untouched
        int Green(byte[] a, int i) => a[i * 3 + 1] - (a[i * 3] + a[i * 3 + 2]) / 2; // how much greener than grey
        var greener = Enumerable.Range(0, 64 * 64).Count(i => Green(p.Albedo, i) > Green(plain.Albedo, i) + 40);
        var shinier = Enumerable.Range(0, 64 * 64).Count(i => p.Roughness[i] < plain.Roughness[i] - 60);
        var metal = Enumerable.Range(0, 64 * 64).Count(i => p.Metallic[i] > 200);
        Assert.InRange(greener, 64 * 64 / 5, 64 * 64 * 4 / 5);
        Assert.InRange(shinier, 64 * 64 / 5, 64 * 64 * 4 / 5);
        Assert.InRange(metal, 64 * 64 / 5, 64 * 64 * 4 / 5);
        Assert.All(plain.Metallic, v => Assert.Equal(0, v));
        var c = TextureRecipe.FromJson("""{"layers":[{"type":"noise","tint":"green","tintAmount":4,"roughnessShift":-9,"heightColor":"#ABCDEF","seamBlend":3}]}""");
        Assert.Equal(((string?)null, 1.0, -1.0, "#abcdef", 0.5), (c.Layers[0].Tint, c.Layers[0].TintAmount, c.Layers[0].RoughnessShift, c.Layers[0].HeightColor, c.Layers[0].SeamBlend));
    }
}
