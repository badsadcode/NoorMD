using System.Numerics;
using NoorMD.Media.Assets3D;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorForm's bushes (low, many-stemmed tree presets) and grass tufts (the grass archetype).</summary>
public class BushGrassTests
{
    private static IEnumerable<TreePresets.Preset> Group(string g) => TreePresets.All.Where(p => p.Group == g);

    /// <summary>With NOORMD_SHOTS set, each preset's side view is saved there (to look at them).</summary>
    private static void Shot(TreeBuild b, string id)
    {
        var dir = Environment.GetEnvironmentVariable("NOORMD_SHOTS");
        if (string.IsNullOrEmpty(dir)) return;
        Directory.CreateDirectory(dir);
        File.WriteAllBytes(Path.Combine(dir, id + ".png"), Billboard.Render(b.Lods[0], 2, 256).Atlas.Png());
    }

    [Fact]
    public void There_are_many_bushes_and_grass_tufts_in_both_looks()
    {
        Assert.True(Group("Bushes & shrubs").Count() >= 15);
        Assert.True(Group("Grass & tufts").Count() >= 18);
        foreach (var g in new[] { "Bushes & shrubs", "Grass & tufts" })
        {
            Assert.Contains(Group(g), p => p.Make().Style == "stylized");
            Assert.Contains(Group(g), p => p.Make().Style == "realistic");
        }
        Assert.All(Group("Grass & tufts"), p => Assert.Equal("grass", p.Make().Archetype));
    }

    [Fact]
    public void Every_bush_is_a_low_plant_with_leaves_from_near_the_ground()
    {
        foreach (var p in Group("Bushes & shrubs"))
        {
            var b = TreeBuilder.Build(TreePresets.Make(p.Id), new TreeBuilder.Options { TextureSize = 256, MaxLods = 1 });
            Shot(b, p.Id);
            var (lo, hi) = TreeExport.Bounds(b.Lods[0]);
            Assert.True(hi.Y < 3.2f && hi.Y > 0.3f, $"{p.Id}: {hi.Y} m tall");
            // Wider than a tree for its height: a bush, not a sapling.
            Assert.True(MathF.Max(hi.X - lo.X, hi.Z - lo.Z) > hi.Y * 0.45f, $"{p.Id}: {hi - lo}");
            Assert.True(b.Lods[0].TriangleCount > 50, p.Id);
        }
    }

    [Fact]
    public void Every_grass_tuft_builds_its_levels_each_lighter_with_wind_and_heads()
    {
        foreach (var p in Group("Grass & tufts"))
        {
            var r = TreePresets.Make(p.Id);
            var b = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 256 });
            Shot(b, p.Id);
            Assert.Equal(r.Lods, b.Lods.Count);
            var tris = b.Lods.Select(l => l.TriangleCount).ToList();
            for (var i = 1; i < tris.Count; i++) Assert.True(tris[i] < tris[i - 1], $"{p.Id}: {string.Join(",", tris)}");
            var (lo, hi) = TreeExport.Bounds(b.Lods[0]);
            Assert.InRange(hi.Y, r.Height * 0.4, r.Height * 1.5);
            Assert.True(lo.Y >= -1e-4f, p.Id);           // nothing under the ground
            var mesh = b.Lods[0].Root.All().First(n => n.Mesh != null).Mesh!;
            Assert.Equal(mesh.VertexCount, mesh.UV1.Count); // the wind data, where the shaders read it
            Assert.All(mesh.Positions, v => Assert.True(float.IsFinite(v.X) && float.IsFinite(v.Y) && float.IsFinite(v.Z)));
            if (r.Heads != "none" && r.GrassMode != "cards") Assert.Contains(b.Lods[0].Materials, m => m.Name == "Heads");
            // Writes as a GLB.
            Assert.True(GlbWriter.Write(b.Lods[0]).Length > 200);
        }
    }

    [Fact]
    public void Card_plants_are_a_few_planes_in_each_layout()
    {
        var cards = TreePresets.All.Where(p => p.Group == "Low-poly cards").ToList();
        Assert.True(cards.Count >= 18);
        foreach (var layout in TreeRecipe.CardLayouts) Assert.Contains(cards, p => p.Make().CardLayout == layout || layout == "random");
        foreach (var p in cards)
        {
            var r = TreePresets.Make(p.Id);
            var b = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 256 });
            Shot(b, p.Id);
            // Cheap: a cross is 16 triangles up close, 8 far away; a dome a few dozen.
            Assert.True(b.Lods[0].TriangleCount <= 80, $"{p.Id}: {b.Lods[0].TriangleCount}");
            Assert.True(b.Lods[^1].TriangleCount <= 40, $"{p.Id}: {b.Lods[^1].TriangleCount}");
            Assert.DoesNotContain(b.Lods[0].Materials, m => m.Name == "Heads");   // heads painted, not modelled
            var (lo, hi) = TreeExport.Bounds(b.Lods[0]);
            Assert.True(lo.Y >= -1e-4f && hi.Y <= r.Height * 1.3, p.Id);
        }
        var cross = TreeBuilder.Build(TreePresets.Make("cards-cross-grass"), new TreeBuilder.Options { TextureSize = 0 });
        Assert.Equal(16, cross.Lods[0].TriangleCount);
        Assert.Equal(8, cross.Lods[1].TriangleCount);
        // A bush's picture is a leafy clump with transparent corners.
        var px = GrassBuilder.BushPixels(TreePresets.Make("cards-round-bush"), 128);
        Assert.Equal(0, px.Rgba[3]);                                    // the top-left corner: see-through
        Assert.Equal(255, px.Rgba[((32 * 128) + 32) * 4 + 3]);          // the middle of a cell: leaves
    }

    [Fact]
    public void Pixel_art_plants_have_small_sharp_outlined_textures_in_few_colours()
    {
        var pixel = TreePresets.All.Where(p => p.Group == "Pixel art").ToList();
        Assert.True(pixel.Count >= 10);
        foreach (var p in pixel)
        {
            var r = TreePresets.Make(p.Id);
            var b = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 512 });
            Shot(b, p.Id);
            var mat = b.Lods[0].Materials[0];
            var img = mat.BaseColorPixels!;
            Assert.True(mat.Nearest, p.Id);
            Assert.True(img.Width <= r.Pixels * 2 && img.Height <= r.Pixels * 2, $"{p.Id}: {img.Width}×{img.Height}");
            // Few colours: the palette (and the outline's ink) and nothing else among the opaque pixels.
            var colours = new HashSet<int>();
            for (var i = 0; i < img.Rgba.Length; i += 4) if (img.Rgba[i + 3] >= 128) colours.Add(img.Rgba[i] << 16 | img.Rgba[i + 1] << 8 | img.Rgba[i + 2]);
            Assert.True(colours.Count <= r.PixelColours + 1, $"{p.Id}: {colours.Count} colours");
            // Hard alpha: each pixel see-through or not.
            for (var i = 3; i < img.Rgba.Length; i += 4) Assert.True(img.Rgba[i] is 0 or 255, p.Id);
        }
        // The outline: an opaque pixel next to a see-through one is the dark ink.
        var plain = TreePresets.Make("pixel-bush"); plain.PixelOutline = false;
        var a = TreeBuilder.Build(plain, new TreeBuilder.Options { TextureSize = 512, MaxLods = 1 }).Lods[0].Materials[0].BaseColorPixels!;
        var o = TreeBuilder.Build(TreePresets.Make("pixel-bush"), new TreeBuilder.Options { TextureSize = 512, MaxLods = 1 }).Lods[0].Materials[0].BaseColorPixels!;
        Assert.NotEqual(a.Rgba, o.Rgba);
    }

    [Fact]
    public void The_wind_bends_blades_more_towards_their_tips_and_not_at_the_root()
    {
        var b = TreeBuilder.Build(TreePresets.Make("meadow-grass"), new TreeBuilder.Options { TextureSize = 0, MaxLods = 1 });
        var m = b.Lods[0].Root.All().First(n => n.Mesh != null).Mesh!;
        for (var i = 0; i < m.VertexCount; i++)
        {
            if (m.Positions[i].Y < 1e-4f) Assert.True(m.UV1[i].X < 1e-3f);
            if (m.Positions[i].Y > 0.3f) Assert.True(m.UV1[i].X > 0.3f);
        }
    }

    [Fact]
    public void A_grass_recipe_is_kept_and_checked_and_the_same_seed_gives_the_same_tuft()
    {
        var r = TreePresets.Make("pampas");
        var back = TreeRecipe.FromJson(r.ToJson());
        Assert.Equal("plumes", back.Heads); Assert.Equal(r.Blades, back.Blades);
        var bad = TreeRecipe.FromJson("{\"archetype\":\"grass\",\"blades\":-5,\"heads\":\"rockets\",\"splay\":500,\"grassMode\":\"x\"}");
        Assert.Equal(1, bad.Blades); Assert.Equal("none", bad.Heads); Assert.Equal(85, bad.Splay); Assert.Equal("blades", bad.GrassMode);
        var a1 = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 0, MaxLods = 1 }).Lods[0].Root.All().First(n => n.Mesh != null).Mesh!;
        var a2 = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 0, MaxLods = 1 }).Lods[0].Root.All().First(n => n.Mesh != null).Mesh!;
        Assert.Equal(a1.Positions, a2.Positions);
        r.Seed = 2;
        var a3 = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 0, MaxLods = 1 }).Lods[0].Root.All().First(n => n.Mesh != null).Mesh!;
        Assert.NotEqual(a1.Positions, a3.Positions);
        // A triangle limit is kept to.
        var limited = TreePresets.Make("tall-grass"); limited.LodTriangles = [300, 120, 60];
        var lb = TreeBuilder.Build(limited, new TreeBuilder.Options { TextureSize = 0 });
        Assert.True(lb.Lods[0].TriangleCount <= 320, lb.Lods[0].TriangleCount.ToString());
        // Variety packs work for grass too.
        Assert.Equal(5, TreeVariants.Make(TreePresets.Make("meadow-grass"), 5, 0.2).Select(x => x.Seed).Distinct().Count());
    }
}
