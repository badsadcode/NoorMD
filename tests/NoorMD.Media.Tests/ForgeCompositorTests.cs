using System.Numerics;
using NoorMD.Media;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorForge layers: plain and NoorMaterial materials, smart masks, the texture set and the textured GLB.</summary>
public class ForgeCompositorTests
{
    private static readonly ForgeModel Model = ForgeModel.ReadObj(ForgeModelTests.CubeOnFloor(), "Test");
    private static readonly Dictionary<string, TextureMaps> Cache = new();
    private static TextureMaps? Materials(string id) { lock (Cache) return Cache.TryGetValue(id, out var m) ? m : Cache[id] = TextureEngine.Render(TexturePresets.Make(id), 128); }

    private static (ForgeBake Bake, ForgeTextures Tex) Run(int set, params ForgeLayer[] layers)
    {
        var bake = ForgeBake.Bake(Model, set, 128, new ForgeBake.Settings(AoRays: 12));
        return (bake, ForgeCompositor.Compose(Model, set, bake, new ForgeRecipe { Layers = [.. layers] }.Clamped(), Materials));
    }

    private static double Avg(ForgeBake b, byte[] px, int ch, int c, Func<Vector3, Vector3, bool> where) =>
        Enumerable.Range(0, b.Size * b.Size).Where(i => b.Covered[i] == 1 && where(b.Position[i], b.Normal[i])).Average(i => (double)px[i * ch + c]);

    private static double Top(ForgeBake b, byte[] px, int ch, int c) => Avg(b, px, ch, c, (p, n) => n.Y > 0.9f && MathF.Abs(p.X) < 0.3f && MathF.Abs(p.Z) < 0.3f);

    [Fact]
    public void Each_channel_blends_its_own_way_with_its_own_opacity()
    {
        // Multiply: a mid grey over white gives the grey; the roughness added, the metal left alone (opacity 0).
        var (b, t) = Run(1,
            new ForgeLayer { Color = "#ffffff", Roughness = 0.2, Metallic = 0.5 },
            new ForgeLayer { Color = "#808080", ColorBlend = "multiply", Roughness = 0.3, RoughBlend = "add", Metallic = 1, MetalOpacity = 0 });
        var white = Run(1, new ForgeLayer { Color = "#ffffff" }).Tex;
        Assert.InRange(Top(b, t.BaseColor, 3, 0), 122, 134);            // #808080 (0.22 linear) × white: #808080 back
        Assert.InRange(Top(b, t.Roughness, 1, 0), 0.5 * 255 - 3, 0.5 * 255 + 3); // 0.2 + 0.3
        Assert.InRange(Top(b, t.Metallic, 1, 0), 0.5 * 255 - 3, 0.5 * 255 + 3);  // unchanged
        Assert.True(Top(b, white.BaseColor, 3, 0) > 250);
        // Half colour opacity: halfway between.
        var (b2, t2) = Run(1, new ForgeLayer { Color = "#000000" }, new ForgeLayer { Color = "#ffffff", ColorOpacity = 0.5 });
        Assert.InRange(Top(b2, t2.BaseColor, 3, 0), 180, 195);
    }

    [Fact]
    public void A_folder_masks_and_hides_the_layers_inside_it()
    {
        var folder = new ForgeLayer { Id = "f1", Name = "Snow folder", IsFolder = true, Mask = new ForgeMask { Kind = "top", Amount = 0.3, Noise = 0 } };
        var snow = new ForgeLayer { Name = "Snow", Folder = "f1", Color = "#ffffff" };
        var (b, t) = Run(1, new ForgeLayer { Color = "#202020" }, folder, snow);
        var top = Top(b, t.BaseColor, 3, 0);
        var side = Avg(b, t.BaseColor, 3, 0, (p, n) => MathF.Abs(n.X) > 0.9f && p.Y < 0.8f);
        Assert.True(top > 230 && side < 100, $"top {top}, side {side}"); // the layer shows only where the folder's mask is
        folder.Visible = false;
        var (b2, t2) = Run(1, new ForgeLayer { Color = "#202020" }, folder, snow);
        Assert.True(Top(b2, t2.BaseColor, 3, 0) < 100); // the folder hidden: nothing inside shows
        // A folder inside a folder, or a folder that isn't there, is dropped.
        var r = new ForgeRecipe { Layers = [new ForgeLayer { Id = "a", IsFolder = true, Folder = "a" }, new ForgeLayer { Folder = "nope" }] }.Clamped();
        Assert.All(r.Layers, l => Assert.Equal("", l.Folder));
    }

    [Fact]
    public void Mask_filters_and_colour_adjustments()
    {
        // A threshold on a soft "top" mask: hard edged; invert: the other way round.
        var layer = new ForgeLayer { Name = "Snow", Color = "#ffffff", Mask = new ForgeMask { Kind = "top", Amount = 0.3, Noise = 0, Filters = [new ForgeFilter { Kind = "invert" }] } };
        var (b, t) = Run(1, new ForgeLayer { Color = "#202020" }, layer);
        Assert.True(Top(b, t.BaseColor, 3, 0) < 100, "inverted: no snow on top");
        var bake = ForgeBake.Bake(Model, 1, 64, new ForgeBake.Settings(AoRays: 4));
        var m = new ForgeLayer { Mask = new ForgeMask { Kind = "edges", Amount = 0.4, Softness = 0.6, Noise = 0 } };
        var soft = ForgePaint.LayerMask(bake, m, 1);
        m.Mask.Filters = [new ForgeFilter { Kind = "threshold", A = 0.5, B = 0.01 }];
        var hard = ForgePaint.LayerMask(bake, m, 1);
        var cov = Enumerable.Range(0, bake.Size * bake.Size).Where(i => bake.Covered[i] == 1).ToList();
        Assert.True(cov.Count(i => soft[i] > 0.05 && soft[i] < 0.95) > cov.Count(i => hard[i] > 0.05 && hard[i] < 0.95) * 2, "fewer in-between values after a threshold");
        m.Mask.Filters = [new ForgeFilter { Kind = "blur", A = 0.03 }];
        var blurred = ForgePaint.LayerMask(bake, m, 1);
        Assert.True(cov.Count(i => blurred[i] > 0.05 && blurred[i] < 0.95) > cov.Count(i => soft[i] > 0.05 && soft[i] < 0.95), "more in-between values after a blur");
        // Hue turned 120°: red becomes green.
        var g = ForgeFilters.Adjust(new System.Numerics.Vector3(1, 0, 0), 120, 0, 0, 0);
        Assert.True(g.Y > 0.6f && g.X < 0.3f && g.Z < 0.3f, $"{g}");
        Assert.Equal(new System.Numerics.Vector3(1, 1, 1), ForgeFilters.Adjust(new System.Numerics.Vector3(0.5f, 0.5f, 0.5f), 0, 0, 1, 0));
    }

    [Fact]
    public void Worn_edges_show_the_layer_on_the_edges_only()
    {
        var (b, t) = Run(1,
            new ForgeLayer { Name = "Paint", Color = "#2040c0", Roughness = 0.4 },
            new ForgeLayer { Name = "Bare metal", Color = "#d0d0d0", Metallic = 1, Roughness = 0.3, Mask = new ForgeMask { Kind = "edges", Amount = 0.4, Softness = 0.1, Noise = 0 } });
        var edge = Avg(b, t.Metallic, 1, 0, (p, n) => p.Y > 0.97f && (MathF.Abs(p.X) > 0.48f || MathF.Abs(p.Z) > 0.48f));
        var middle = Avg(b, t.Metallic, 1, 0, (p, n) => n.Y > 0.9f && MathF.Abs(p.X) < 0.2f && MathF.Abs(p.Z) < 0.2f);
        Assert.True(edge > 150 && middle < 10, $"edge {edge}, middle {middle}");
        // The paint's blue elsewhere (red low, blue high).
        Assert.True(Avg(b, t.BaseColor, 3, 2, (p, n) => n.Y > 0.9f && MathF.Abs(p.X) < 0.2f) > 150 + Avg(b, t.BaseColor, 3, 0, (p, n) => n.Y > 0.9f && MathF.Abs(p.X) < 0.2f) * 0.2);
    }

    [Fact]
    public void Snow_on_top_and_dirt_in_the_corner()
    {
        var (b, t) = Run(1,
            new ForgeLayer { Color = "#606060" },
            new ForgeLayer { Name = "Snow", Color = "#ffffff", Roughness = 0.9, Mask = new ForgeMask { Kind = "top", Amount = 0.3, Noise = 0 } });
        var top = Avg(b, t.BaseColor, 3, 0, (p, n) => n.Y > 0.9f);
        var side = Avg(b, t.BaseColor, 3, 0, (p, n) => MathF.Abs(n.X) > 0.9f && p.Y < 0.8f);
        Assert.True(top > 230 && side < 150, $"top {top}, side {side}");
        var (fb, ft) = Run(0,
            new ForgeLayer { Color = "#a0a0a0" },
            new ForgeLayer { Name = "Dirt", Color = "#302010", Mask = new ForgeMask { Kind = "cavity", Amount = 0.5, Noise = 0 } });
        var corner = Avg(fb, ft.BaseColor, 3, 0, (p, n) => MathF.Abs(p.X) < 0.7f && MathF.Abs(p.Z) < 0.7f && (MathF.Abs(p.X) > 0.5f || MathF.Abs(p.Z) > 0.5f));
        var open = Avg(fb, ft.BaseColor, 3, 0, (p, n) => MathF.Abs(p.X) > 1.7f || MathF.Abs(p.Z) > 1.7f);
        Assert.True(corner < open - 20, $"corner {corner}, open {open}");
    }

    [Fact]
    public void A_texture_bench_material_gives_colour_and_relief_with_no_seams_to_its_size()
    {
        var (b, t) = Run(1, new ForgeLayer { Name = "Bricks", Material = "bricks-red", Scale = 0.5 });
        // Relief: the normals lean, not all straight up.
        var tilted = Enumerable.Range(0, b.Size * b.Size).Count(i => b.Covered[i] == 1 && t.Normal[i * 3 + 2] < 245);
        Assert.True(tilted > b.Covered.Count(c => c == 1) * 0.1, $"{tilted} tilted texels");
        Assert.True(Avg(b, t.BaseColor, 3, 0, (p, n) => true) > Avg(b, t.BaseColor, 3, 2, (p, n) => true) + 15); // red bricks
        // Outside the charts the colours were bled outwards (no black lines when filtered).
        var outside = Enumerable.Range(0, b.Size * b.Size).Where(i => b.Covered[i] == 0).ToList();
        Assert.True(outside.Count(i => t.BaseColor[i * 3] > 0) > outside.Count * 0.5);
    }

    [Fact]
    public void Masks_by_part_and_inverted_and_the_textured_glb()
    {
        var floor = ForgeBake.Bake(Model, 0, 64, new ForgeBake.Settings(AoRays: 0));
        Assert.Equal(1, ForgeCompositor.MaskAt(new ForgeMask { Kind = "part", Index = 0 }, floor, Array.IndexOf(floor.Covered, (byte)1), 0, Vector3.One));
        Assert.Equal(0, ForgeCompositor.MaskAt(new ForgeMask { Kind = "part", Index = 0, Invert = true }, floor, Array.IndexOf(floor.Covered, (byte)1), 0, Vector3.One));
        var sets = Enumerable.Range(0, Model.Sets.Count).Select(s => Run(s, new ForgeLayer { Color = "#806040" }).Tex).ToList();
        var glb = ForgeExport.Glb(Model, sets);
        var back = ForgeModel.ReadGlb(glb, "Back");
        Assert.Equal(["Ground", "Stone"], back.Sets.Select(s => s.Name));
        Assert.False(back.Sets[1].Unwrapped); // the painted UVs went with it
        Assert.Equal(Model.Sets[1].Uvs[0].X, back.Sets[1].Uvs[0].X, 3);
        Assert.Equal(Model.Sets[1].Uvs[0].Y, back.Sets[1].Uvs[0].Y, 3);
        var json = System.Text.Encoding.UTF8.GetString(glb, 20, BitConverter.ToInt32(glb, 12));
        Assert.Contains("baseColorTexture", json);
        Assert.Contains("normalTexture", json);
        Assert.Contains("metallicRoughnessTexture", json);
        var recipe = ForgeRecipe.FromJson(new ForgeRecipe { Model = "C:\\m.glb", Size = 999, Layers = [new ForgeLayer { Color = "red", Mask = new ForgeMask { Kind = "nope", Amount = 7 } }] }.ToJson());
        Assert.Equal(1024, recipe.Size);
        Assert.Equal("#808080", recipe.Layers[0].Color);
        Assert.Equal("all", recipe.Layers[0].Mask.Kind);
        Assert.Equal(1, recipe.Layers[0].Mask.Amount);
    }
}
