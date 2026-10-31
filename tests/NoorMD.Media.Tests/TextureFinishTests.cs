using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>Each map's finishing touches (blur, sharpen, levels, middle, brightness, contrast, invert), hand-painted
/// pictures kept as painted, and big pictures averaged down instead of sampled.</summary>
public class TextureFinishTests
{
    private static TextureMaps M(Action<TextureSurface>? surface = null)
    {
        var r = TexturePresets.Make("bricks-red");
        surface?.Invoke(r.Surface);
        return TextureEngine.Render(r.Clamped(), 128);
    }
    private static double Spread(byte[] a) { var m = a.Average(v => (double)v); return Math.Sqrt(a.Average(v => (v - m) * (v - m))); }

    [Fact]
    public void Neutral_finishing_changes_nothing_and_old_recipes_read_without_it()
    {
        var plain = M();
        var neutral = M(s => s.Finish["roughness"] = new MapFinish());
        Assert.Equal(plain.Roughness, neutral.Roughness);
        Assert.Equal(plain.Normal, neutral.Normal);
        Assert.Empty(TextureRecipe.FromJson(TexturePresets.Make("bricks-red").ToJson().Replace("\"finish\": {}", "\"finish\": null")).Surface.Finish);
        // Unknown map names are dropped; values are kept in range.
        var r = TexturePresets.Make("bricks-red");
        r.Surface.Finish["sparkle"] = new MapFinish { Blur = 1 };
        r.Surface.Finish["ao"] = new MapFinish { Blur = 9, Gamma = -3 };
        r.Clamped();
        Assert.False(r.Surface.Finish.ContainsKey("sparkle"));
        Assert.Equal(0.05, r.Surface.Finish["ao"].Blur);
        Assert.Equal(1, r.Surface.Finish["ao"].Gamma);
    }

    [Fact]
    public void Blur_softens_sharpen_hardens_and_invert_turns_a_map_round()
    {
        var plain = M();
        var blurred = M(s => s.Finish["roughness"] = new MapFinish { Blur = 0.02 });
        var sharpened = M(s => s.Finish["roughness"] = new MapFinish { Sharpen = 2 });
        Assert.True(Spread(blurred.Roughness) < Spread(plain.Roughness) - 1, $"{Spread(blurred.Roughness)} vs {Spread(plain.Roughness)}");
        Assert.True(Spread(sharpened.Roughness) > Spread(plain.Roughness) + 1);
        var inverted = M(s => s.Finish["ao"] = new MapFinish { Invert = true });
        Assert.All(Enumerable.Range(0, plain.Ao.Length), i => Assert.InRange(inverted.Ao[i] + plain.Ao[i], 254, 256));
    }

    [Fact]
    public void Levels_middle_brightness_and_contrast()
    {
        var plain = M();
        // Levels: black at the darkest grey that matters, white at the brightest → the map uses the whole range.
        var lv = M(s => s.Finish["roughness"] = new MapFinish { Low = plain.Roughness.Min() / 255.0 + 0.05, High = plain.Roughness.Max() / 255.0 - 0.05 });
        Assert.Equal(0, lv.Roughness.Min()); Assert.Equal(255, lv.Roughness.Max());
        Assert.True(M(s => s.Finish["albedo"] = new MapFinish { Gamma = 2 }).Albedo.Average(v => (double)v) > plain.Albedo.Average(v => (double)v) + 10);
        Assert.True(M(s => s.Finish["metallic"] = new MapFinish { Brightness = 0.5 }).Metallic.Min() >= 127);
        Assert.True(Spread(M(s => s.Finish["albedo"] = new MapFinish { Contrast = 0.6 }).Albedo) > Spread(plain.Albedo) + 3);
        // The height map written out changes; the relief (normal) does not.
        var h = M(s => s.Finish["height"] = new MapFinish { Invert = true });
        Assert.NotNull(h.HeightOut);
        Assert.Equal(plain.Normal, h.Normal);
        Assert.InRange(h.HeightOut![0] + plain.Height[0], 0.99f, 1.01f);
    }

    [Fact]
    public void The_normal_map_is_blurred_as_directions_and_stays_unit_length()
    {
        var plain = M();
        var soft = M(s => s.Finish["normal"] = new MapFinish { Blur = 0.01, Brightness = 0.8, Invert = true }); // tone settings are ignored for normals
        double Tilt(byte[] nm) => Enumerable.Range(0, nm.Length / 3).Average(i => Math.Abs(nm[i * 3] / 255.0 * 2 - 1));
        Assert.True(Tilt(soft.Normal) < Tilt(plain.Normal), "blurred normals lean less");
        for (var i = 0; i < soft.Normal.Length / 3; i += 97)
        {
            double x = soft.Normal[i * 3] / 255.0 * 2 - 1, y = soft.Normal[i * 3 + 1] / 255.0 * 2 - 1, z = soft.Normal[i * 3 + 2] / 255.0 * 2 - 1;
            Assert.InRange(Math.Sqrt(x * x + y * y + z * z), 0.97, 1.03);
            Assert.True(z > 0);
        }
    }

    /// <summary>A painted texture: a light top-left corner fading to a dark bottom-right (the painted light), 256 × 256.</summary>
    private static TextureImage Painting(int n = 256, Func<int, int, float>? f = null)
    {
        var rgb = new float[n * n * 3];
        for (var y = 0; y < n; y++)
            for (var x = 0; x < n; x++)
            {
                var v = f?.Invoke(x, y) ?? (float)(0.85 - 0.6 * (x + y) / (2.0 * n));
                rgb[(y * n + x) * 3] = v; rgb[(y * n + x) * 3 + 1] = v * 0.9f; rgb[(y * n + x) * 3 + 2] = v * 0.7f;
            }
        return new TextureImage { Width = n, Height = n, Rgb = rgb, Id = "painting" + n + (f == null ? "" : "f") };
    }
    private static TextureMaps FromPicture(TextureImage img, bool handPainted, int size = 128, double delight = 0.5, double seam = 0.15)
    {
        var r = new TextureRecipe { Name = "t", Layers = [new TextureLayer { Id = "L1", Type = "image", Path = "p", ImageName = "p.png", ScaleX = 1, ScaleY = 1, HandPainted = handPainted, Delight = delight, SeamBlend = seam, ColorAmount = 1, Opacity = 1 }] };
        r.Surface.Dirt = 0; r.Surface.ColorVariation = 0;
        return TextureEngine.Render(r.Clamped(), size, _ => img);
    }

    [Fact]
    public void A_hand_painted_picture_keeps_its_painted_light_and_edges()
    {
        var img = Painting();
        var photo = FromPicture(img, handPainted: false);
        var painted = FromPicture(img, handPainted: true);
        int R(TextureMaps m, int x, int y) => m.Albedo[(y * 128 + x) * 3];
        // The painted light goes from bright (top left) to dark (bottom right): kept as painted, evened out as a photo.
        var paintedDrop = R(painted, 10, 10) - R(painted, 117, 117);
        var photoDrop = R(photo, 10, 10) - R(photo, 117, 117);
        Assert.True(paintedDrop > 100, $"painted {paintedDrop}: {R(painted, 10, 10)} {R(painted, 117, 117)} {R(painted, 64, 64)} photo {R(photo, 10, 10)} {R(photo, 117, 117)} rough {painted.Albedo[1]} {painted.Albedo[2]}");
        Assert.True(photoDrop < paintedDrop - 30, $"photo {photoDrop} vs painted {paintedDrop}");
        // Its middle is the picture's own colour (no light evening, no seam blending).
        Assert.InRange(R(painted, 64, 64), (int)(255 * (0.85 - 0.3)) - 6, (int)(255 * (0.85 - 0.3)) + 6);
    }

    [Fact]
    public void A_big_picture_is_averaged_down_so_thin_lines_stay_whole()
    {
        // Thin dark lines every 8 pixels on white, 2048 × 2048, into a 128 map: each pixel covers 16 × 16 of it,
        // so every pixel should be about the same grey (two lines in each), not white or black where a sample landed.
        var img = Painting(2048, (x, y) => x % 8 == 0 ? 0.1f : 0.9f);
        var m = FromPicture(img, handPainted: true);
        var reds = Enumerable.Range(0, 128 * 128).Select(i => (int)m.Albedo[i * 3]).ToArray();
        Assert.InRange(reds.Max() - reds.Min(), 0, 12);
        Assert.InRange(reds.Average(), 255 * 0.8 - 6, 255 * 0.8 + 6);
    }
}
