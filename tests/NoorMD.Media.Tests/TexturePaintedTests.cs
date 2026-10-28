using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>Stage 3: a layer painted by hand in NoorSketch (colour with transparency) goes on the material.</summary>
public class TexturePaintedTests
{
    /// <summary>A 64 × 64 painting: a white square (opaque) in the top-left quarter, a black one in the bottom-right, nothing elsewhere.</summary>
    private static TextureImage Painting()
    {
        const int n = 64;
        var rgb = new float[n * n * 3];
        var alpha = new float[n * n];
        for (var y = 0; y < n; y++)
            for (var x = 0; x < n; x++)
            {
                var i = y * n + x;
                if (x < 32 && y < 32) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = 1; alpha[i] = 1; }
                else if (x >= 32 && y >= 32) { alpha[i] = 1; }
            }
        return new TextureImage { Width = n, Height = n, Rgb = rgb, Alpha = alpha, Id = "painting" };
    }

    private static TextureRecipe R(TextureLayer painted) => new TextureRecipe
    {
        Layers = [new TextureLayer { Type = "noise", ScaleX = 2, ScaleY = 2, Low = 0, High = 0, Opacity = 0.5 }, painted], // flat ground at half height
        Surface = new TextureSurface { Ramp = [new() { Pos = 0, Color = "#808080" }, new() { Pos = 1, Color = "#808080" }], ColorVariation = 0, Dirt = 0, AoStrength = 0 },
    }.Clamped();

    private static TextureMaps Render(TextureLayer painted, int size = 128) => TextureEngine.Render(R(painted), size, p => p == "art.noorsketch" ? Painting() : null);

    [Fact]
    public void Its_colours_go_on_only_where_it_is_painted()
    {
        var m = Render(new TextureLayer { Type = "painted", Path = "art.noorsketch", ColorAmount = 1, Opacity = 0 });
        int n = 128;
        byte Red(int x, int y) => m.Albedo[(y * n + x) * 3];
        Assert.InRange(Red(20, 20), 250, 255); // white painted
        Assert.InRange(Red(100, 100), 0, 5); // black painted
        Assert.InRange(Red(100, 20), 120, 136); // not painted: the material shows
        Assert.Empty(m.Warnings);
        // Strength 0 for relief: the height is untouched.
        var plain = TextureEngine.Render(R(new TextureLayer { Type = "noise", Opacity = 0 }), 128);
        Assert.InRange(plain.Height[5 * n + 5], 0.49, 0.51);
        Assert.Equal(plain.Height, m.Height);
        // Half the colour amount: half way.
        var half = Render(new TextureLayer { Type = "painted", Path = "art.noorsketch", ColorAmount = 0.5, Opacity = 0 });
        Assert.InRange(half.Albedo[(20 * n + 20) * 3], 185, 200);
    }

    [Fact]
    public void Its_brightness_raises_and_lowers_the_relief_where_painted()
    {
        var m = Render(new TextureLayer { Type = "painted", Path = "art.noorsketch", ColorAmount = 0, Opacity = 1 });
        int n = 128;
        Assert.True(m.Height[20 * n + 20] > 0.9, "white raises");
        Assert.True(m.Height[100 * n + 100] < 0.1, "black lowers");
        Assert.InRange(m.Height[20 * n + 100], 0.49, 0.51); // unpainted: as it was
        Assert.InRange(m.Albedo[(20 * n + 20) * 3], 120, 136); // colour amount 0: no colour change
    }

    [Fact]
    public void It_tints_and_changes_roughness_where_painted()
    {
        var m = Render(new TextureLayer { Type = "painted", Path = "art.noorsketch", ColorAmount = 0, Opacity = 0, RoughnessShift = -0.5 });
        int n = 128;
        Assert.True(m.Roughness[20 * n + 20] < m.Roughness[20 * n + 100] - 100);
    }

    [Fact]
    public void A_missing_painting_is_reported_and_left_out()
    {
        var m = Render(new TextureLayer { Type = "painted", Path = "gone.noorsketch", ImageName = "my painting" });
        Assert.Contains(m.Warnings, w => w.Contains("my painting") && w.Contains("painting is missing"));
    }

    [Fact]
    public void Paintings_are_files_of_the_recipe_and_found_beside_it()
    {
        var dir = Directory.CreateTempSubdirectory("noortex").FullName;
        try
        {
            File.WriteAllText(Path.Combine(dir, "Bricks painting.noorsketch"), "x");
            var r = new TextureRecipe { Layers = [new TextureLayer { Type = "painted", Path = "Bricks painting.noorsketch" }, new TextureLayer { Type = "painted", Path = Path.Combine(Path.GetTempPath(), "gone-" + Guid.NewGuid().ToString("N"), "Bricks painting.noorsketch") }] }.Clamped();
            Assert.Equal(2, r.Files().Count());
            r.FindImagesBeside(dir);
            Assert.All(r.Layers, l => Assert.Equal(Path.Combine(dir, "Bricks painting.noorsketch"), l.Path));
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void A_painting_scales_to_any_size_and_tiles()
    {
        // Painted across the edge: a stripe on both the left and right edges joins up when tiled.
        const int n = 32;
        var rgb = new float[n * n * 3]; var alpha = new float[n * n];
        for (var y = 0; y < n; y++) { alpha[y * n] = 1; alpha[y * n + n - 1] = 1; rgb[y * n * 3] = rgb[(y * n + n - 1) * 3] = 1; }
        var art = new TextureImage { Width = n, Height = n, Rgb = rgb, Alpha = alpha, Id = "edge" };
        var m = TextureEngine.Render(R(new TextureLayer { Type = "painted", Path = "edge", ColorAmount = 1, Opacity = 0 }), 256, _ => art);
        // At 256 the 2-pixel stripe straddles the edge: the first and last columns are both red, the middle is not.
        Assert.True(m.Albedo[(100 * 256) * 3] > 200 && m.Albedo[(100 * 256 + 255) * 3] > 200 && m.Albedo[(100 * 256 + 128) * 3] < 140);
    }
}
