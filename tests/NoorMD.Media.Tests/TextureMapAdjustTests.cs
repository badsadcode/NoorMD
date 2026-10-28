using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>The Maps tab: each map shaped on its own, neutral by default.</summary>
public class TextureMapAdjustTests
{
    private static TextureRecipe Bricks(Action<TextureSurface>? surface = null)
    {
        var r = TexturePresets.Make("bricks-red");
        surface?.Invoke(r.Surface);
        return r.Clamped();
    }

    private static TextureMaps M(Action<TextureSurface>? surface = null) => TextureEngine.Render(Bricks(surface), 128);

    [Fact]
    public void Neutral_settings_change_nothing()
    {
        var plain = M();
        var neutral = M(s => { s.AlbedoBrightness = 0; s.AlbedoSaturation = 1; s.RoughnessMin = 0; s.RoughnessMax = 1; s.AoGamma = 1; s.HeightHigh = 1; });
        Assert.Equal(plain.Albedo, neutral.Albedo);
        Assert.Equal(plain.Roughness, neutral.Roughness);
        Assert.Equal(plain.Ao, neutral.Ao);
        Assert.Null(neutral.HeightOut);
        // An older recipe (without the new settings) reads as neutral.
        var json = TexturePresets.Make("bricks-red").ToJson().Replace("\"albedoSaturation\": 1,", "");
        Assert.Equal(1, TextureRecipe.FromJson(json).Surface.AlbedoSaturation);
    }

    [Fact]
    public void Albedo_brightness_contrast_saturation_and_hue()
    {
        var plain = M();
        double Mean(byte[] a, int ch) => Enumerable.Range(0, a.Length / 3).Average(i => (double)a[i * 3 + ch]);
        Assert.True(Mean(M(s => s.AlbedoBrightness = 0.3).Albedo, 1) > Mean(plain.Albedo, 1) + 20);
        var grey = M(s => s.AlbedoSaturation = 0).Albedo;
        Assert.All(Enumerable.Range(0, grey.Length / 3), i => Assert.InRange(grey[i * 3] - grey[i * 3 + 2], -1, 1)); // no colour left
        // Red bricks turned a third of the way round become green-ish: more green than red on average.
        var turned = M(s => s.AlbedoHue = 120).Albedo;
        Assert.True(Mean(plain.Albedo, 0) > Mean(plain.Albedo, 1) && Mean(turned, 1) > Mean(turned, 0));
        double Spread(byte[] a) { var v = Enumerable.Range(0, a.Length / 3).Select(i => (double)a[i * 3]).ToArray(); var m = v.Average(); return Math.Sqrt(v.Average(x => (x - m) * (x - m))); }
        Assert.True(Spread(M(s => s.AlbedoContrast = 0.6).Albedo) > Spread(plain.Albedo) * 1.3);
    }

    [Fact]
    public void Roughness_range_contrast_and_smoothness()
    {
        var kept = M(s => { s.RoughnessMin = 0.4; s.RoughnessMax = 0.5; }).Roughness;
        Assert.All(kept, v => Assert.InRange(v, 101, 128));
        var plain = M().Roughness;
        var smooth = M(s => s.RoughnessInvert = true).Roughness;
        for (var i = 0; i < plain.Length; i += 97) Assert.InRange(plain[i] + smooth[i], 254, 256);
        var swapped = Bricks(s => { s.RoughnessMin = 0.8; s.RoughnessMax = 0.2; }).Surface;
        Assert.Equal((0.2, 0.8), (swapped.RoughnessMin, swapped.RoughnessMax));
    }

    [Fact]
    public void Ao_depth_and_metallic_cut()
    {
        Assert.True(M(s => s.AoGamma = 3).Ao.Average(v => v) < M().Ao.Average(v => v) - 10);
        byte[] Metal(double cut) => TextureEngine.Render(new TextureRecipe { Layers = [new TextureLayer { Type = "noise", ScaleX = 4, ScaleY = 4, Opacity = 0, MetallicShift = 1 }], Surface = new TextureSurface { MetallicThreshold = cut } }.Clamped(), 128).Metallic;
        int Between(byte[] m) => m.Count(v => v is > 20 and < 235);
        var soft = Metal(0); var cut = Metal(0.5);
        Assert.True(Between(cut) < Between(soft) / 4, $"in between: {Between(cut)} cut, {Between(soft)} soft");
        Assert.True(cut.Count(v => v >= 235) > cut.Length / 10 && cut.Count(v => v <= 20) > cut.Length / 10, "both metal and not");
    }

    [Fact]
    public void The_height_map_written_out_has_its_own_levels_but_the_relief_stays()
    {
        var plain = M();
        var levelled = M(s => { s.HeightLow = 0.3; s.HeightHigh = 0.7; s.HeightContrast = 0.2; });
        Assert.Equal(plain.Height, levelled.Height);
        Assert.Equal(plain.Normal, levelled.Normal); // the relief doesn't change
        Assert.NotNull(levelled.HeightOut);
        Assert.True(levelled.HeightOut!.Count(v => v is 0 or 1) > plain.Height.Count(v => v is 0 or 1));
        Assert.NotEqual(plain.Png("height"), levelled.Png("height"));
        Assert.Equal(128 * 128, levelled.Height8().Length);
    }

    [Fact]
    public void Packed_maps_take_any_grey_map_in_any_channel()
    {
        var m = M();
        var png = m.Packed("metallic", "ao", "height", "one");
        Assert.True(png.Length > 100 && png[1] == (byte)'P');
        Assert.Throws<ArgumentException>(() => m.Packed("albedo", "ao", "zero"));
    }
}
