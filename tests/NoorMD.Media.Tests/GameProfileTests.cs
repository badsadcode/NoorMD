using System.Text.Json;
using NoorMD.Media.Assets3D;
using Xunit;

namespace NoorMD.Media.Tests;

public class GameProfileTests
{
    private static TreeBuild Build(string id, int textureSize = 256) =>
        TreeBuilder.Build(TreePresets.Make(id), new TreeBuilder.Options { TextureSize = textureSize });

    [Fact]
    public void Each_level_comes_close_to_its_own_triangles()
    {
        foreach (var id in new[] { "thornwake-pine", "thornwake-oak", "thornwake-dead" })
        {
            var r = TreePresets.Make(id);
            var b = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 0 });
            Assert.Equal(3, b.Lods.Count);      // no billboard: the game bakes its own impostors
            for (var i = 0; i < 3; i++)
                Assert.InRange(b.Lods[i].TriangleCount, r.LodTriangles[i] * 0.6, r.LodTriangles[i] * 1.2 + 40);      // a far level: at least a simple trunk
        }
    }

    [Fact]
    public void Conifer_boughs_make_tiers_all_the_way_up_the_cone()
    {
        foreach (var id in new[] { "thornwake-pine", "thornwake-spruce" })
        {
            var b = TreeBuilder.Build(TreePresets.Make(id), new TreeBuilder.Options { TextureSize = 0 });
            var leaves = b.Lods[0].Root.All().First(n => n.Name == "Leaves").Mesh!;
            var h = b.Skeleton.Height;
            // Leaves in every third of the crown (the bug: a skirt at the bottom and tufts glued to the trunk above).
            var ys = leaves.Positions.Select(p => p.Y / h).ToList();
            foreach (var (lo, hi) in new[] { (0.3, 0.55), (0.55, 0.8), (0.8, 1.0) })
                Assert.True(ys.Count(y => y >= lo && y < hi) > ys.Count / 10, $"{id}: too few leaves between {lo} and {hi} of the height");
            // A cone: the leaves reach less far out the higher they are.
            float Reach(double lo, double hi) => leaves.Positions.Where(p => p.Y / h >= lo && p.Y / h < hi).Max(p => MathF.Sqrt(p.X * p.X + p.Z * p.Z));
            Assert.True(Reach(0.3, 0.55) > Reach(0.55, 0.8) && Reach(0.55, 0.8) > Reach(0.8, 1.0), id);
        }
    }

    [Fact]
    public void A_cactus_is_ribbed_wood_with_no_leaves_and_arms_that_turn_up()
    {
        var b = TreeBuilder.Build(TreePresets.Make("saguaro"), new TreeBuilder.Options { TextureSize = 64 });
        var lod0 = b.Lods[0];
        Assert.DoesNotContain(lod0.Materials, m => m.Name == "Leaves");
        Assert.Equal("none", TreeExport.About(b)["noor_wind"]);
        var trunk = lod0.Root.All().First(n => n.Name == "Trunk").Mesh!;
        // Ribs: round a ring halfway up, the distance from the axis rises and falls (lobes), not a plain circle.
        var mid = b.Skeleton.Trunk.At(0.5f).P;
        var ring = trunk.Positions.Where(p => MathF.Abs(p.Y - mid.Y) < 0.05f).Select(p => new System.Numerics.Vector2(p.X - mid.X, p.Z - mid.Z).Length()).ToList();
        Assert.True(ring.Count >= 8);
        Assert.True(ring.Max() / ring.Min() > 1.08f, $"ring {ring.Min():0.000}–{ring.Max():0.000}");
        // Arms: each ends higher than it starts, and below the top of the trunk.
        foreach (var arm in b.Skeleton.Branches.Where(x => x.Level == 1))
        {
            Assert.True(arm.Points[^1].Y > arm.Points[0].Y + 0.5f);
            Assert.True(arm.Points[0].Y < b.Skeleton.Height * 0.8f);
        }
    }

    [Fact]
    public void Willow_curtains_hang_from_a_broad_crown_nearly_to_the_ground()
    {
        var b = TreeBuilder.Build(TreePresets.Make("thornwake-willow"), new TreeBuilder.Options { TextureSize = 0 });
        var (lo, hi) = TreeExport.Bounds(b.Lods[0]);
        Assert.True(hi.X - lo.X > hi.Y * 0.9f, "a weeping willow is about as wide as it is tall");
        var leaves = b.Lods[0].Root.All().First(n => n.Name == "Leaves").Mesh!;
        Assert.Contains(leaves.Positions, p => p.Y < hi.Y * 0.25f);
        Assert.All(leaves.Positions, p => Assert.True(p.Y > 0.2f));
    }

    [Fact]
    public void Levels_past_the_list_are_half_the_one_before_and_without_a_list_it_halves()
    {
        var r = new TreeRecipe { LodTriangles = [3000, 1000], Lods = 3 };
        Assert.Equal(500, r.LevelBudgets(2).Wood + r.LevelBudgets(2).Leaves);
        Assert.Equal(1000, r.LevelBudgets(1).Wood + r.LevelBudgets(1).Leaves);
        Assert.Equal((750, 2250), r.Budgets());
        var plain = new TreeRecipe { TriangleTarget = 4000 };
        Assert.Equal((500, 1500), plain.LevelBudgets(1));
    }

    [Fact]
    public void Small_textures_keep_full_pbr_and_colour_and_are_sampled_nearest()
    {
        var b = Build("thornwake-birch-green");
        var leaves = b.Lods[0].Materials.First(m => m.Name == "Leaves");
        var bark = b.Lods[0].Materials.First(m => m.Name == "Bark");
        int Colours(Material3D m) => Enumerable.Range(0, m.BaseColorPixels!.Rgba.Length / 4).Where(i => m.BaseColorPixels.Rgba[i * 4 + 3] > 0)
            .Select(i => (m.BaseColorPixels.Rgba[i * 4], m.BaseColorPixels.Rgba[i * 4 + 1], m.BaseColorPixels.Rgba[i * 4 + 2])).Distinct().Count();
        foreach (var m in new[] { leaves, bark })
        {
            Assert.True(m.Nearest);
            Assert.Equal(64, m.BaseColorPixels!.Width);
            // Small isn't flat: the normal and ORM maps are there, at the same size.
            Assert.NotNull(m.NormalPng);
            Assert.NotNull(m.OcclusionRoughnessMetallicPng);
            Assert.True(Colours(m) > 24, $"{m.Name}: {Colours(m)} colours");
        }
        var px = leaves.BaseColorPixels!.Rgba;
        Assert.All(Enumerable.Range(0, px.Length / 4), i => Assert.True(px[i * 4 + 3] is 0 or 255));
        // Every texture in the file is sampled nearest; the leaves (with their normal maps) have tangents.
        var (json, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeExport.Level(b, 0)));
        var samplers = json.GetProperty("samplers").EnumerateArray().ToList();
        Assert.All(json.GetProperty("textures").EnumerateArray(), t => Assert.Equal(9728, samplers[t.GetProperty("sampler").GetInt32()].GetProperty("magFilter").GetInt32()));
        Assert.True((bool)TreeExport.About(b)["noor_sharp"]);
        Assert.NotEmpty(b.Lods[0].Root.All().First(n => n.Name == "Leaves").Mesh!.Tangents);
        // A palette only when asked for.
        var r = TreePresets.Make("thornwake-birch-green");
        r.PixelColours = 12;
        var paletted = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 256 });
        Assert.InRange(Colours(paletted.Lods[0].Materials.First(m => m.Name == "Bark")), 2, 12);
        // A tree without small textures keeps the one smooth sampler, unless sharp pixels are asked for.
        var (smooth, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeExport.Level(Build("birch"), 0)));
        Assert.Equal(9729, Assert.Single(smooth.GetProperty("samplers").EnumerateArray()).GetProperty("magFilter").GetInt32());
        var sharp = TreePresets.Make("birch");
        sharp.SharpPixels = true;
        var (crisp, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeExport.Level(TreeBuilder.Build(sharp, new TreeBuilder.Options { TextureSize = 256 }), 0)));
        Assert.All(crisp.GetProperty("samplers").EnumerateArray(), x => Assert.Equal(9728, x.GetProperty("magFilter").GetInt32()));
    }

    [Fact]
    public void Leaves_get_a_normal_map_from_their_shape_and_an_orm_map()
    {
        // A square leaf in the middle of a clear picture: its edges slope, the clear part is flat and fully lit.
        var px = new byte[16 * 16 * 4];
        for (var y = 4; y < 12; y++) for (var x = 4; x < 12; x++) { var i = (y * 16 + x) * 4; px[i + 1] = 160; px[i + 3] = 255; }
        var (normal, orm) = LeafAtlas.MapPixels(new RawImage(16, 16, px));
        int I(int x, int y) => (y * 16 + x) * 3;
        Assert.Equal(new byte[] { 128, 128, 255 }, normal[I(0, 0)..(I(0, 0) + 3)]);
        Assert.Equal(255, orm[I(0, 0)]);
        // The left edge tilts left (−X), the right edge right, the top edge up (+Y, OpenGL), the bottom down.
        Assert.True(normal[I(4, 8)] < 120 && normal[I(11, 8)] > 136);
        Assert.True(normal[I(8, 4) + 1] > 136 && normal[I(8, 11) + 1] < 120);
        // Inside the leaf: some occlusion and a waxy roughness, no metal.
        Assert.InRange(orm[I(8, 8)], 150, 254);
        Assert.InRange(orm[I(8, 8) + 1], 100, 190);
        Assert.Equal(0, orm[I(8, 8) + 2]);
    }

    [Fact]
    public void Pixel_art_averages_the_opaque_pixels_and_cuts_out_the_rest()
    {
        // 4 × 4: the left half opaque red, the right half see-through.
        var px = new byte[4 * 4 * 4];
        for (var y = 0; y < 4; y++) for (var x = 0; x < 2; x++) { var i = (y * 4 + x) * 4; px[i] = 200; px[i + 3] = 255; }
        var small = PixelArt.Make(new RawImage(4, 4, px), 2);
        Assert.Equal((2, 2), (small.Width, small.Height));
        Assert.Equal(new byte[] { 200, 0, 0, 255, 0, 0, 0, 0 }, small.Rgba[..8]);
    }

    [Fact]
    public void Recipes_keep_only_known_profiles_and_pixel_sizes()
    {
        var r = new TreeRecipe { Profile = "nope", Pixels = 50, LodTriangles = [10, 900_000] }.Clamped();
        Assert.Equal("", r.Profile);
        Assert.Equal(0, r.Pixels);
        Assert.Equal([60, 200_000], r.LodTriangles);
        var tw = TreeRecipe.FromJson(TreePresets.Make("thornwake-pine").ToJson());
        Assert.Equal(("thornwake", 64, 3), (tw.Profile, tw.Pixels, tw.LodTriangles.Count));
    }

    [Fact]
    public void Every_thornwake_tree_grows_for_the_game()
    {
        Assert.True(TreePresets.Thornwake.Count >= 24);
        foreach (var p in TreePresets.Thornwake)
        {
            var r = p.Make().Clamped();
            Assert.Equal("Thornwake", p.Group);
            Assert.Equal(("thornwake", false, 64), (r.Profile, r.Billboard, r.Pixels));
            Assert.Equal(3, r.LodTriangles.Count);
            Assert.True(r.LodTriangles[0] > r.LodTriangles[1] && r.LodTriangles[1] > r.LodTriangles[2]);
            Assert.DoesNotContain(' ', r.Name);
        }
        Assert.Contains(TreePresets.Everything, p => p.Id == "thornwake-spruce");
    }

    [Fact]
    public void Catalogue_names_and_the_handoff_note()
    {
        var tw = GameProfiles.Find("thornwake")!;
        Assert.Equal("TREE_Birch_Green_A", tw.CatalogueName("Birch Green", 0));
        Assert.Equal("TREE_Pine_C", tw.CatalogueName("Pine", 2));
        Assert.Equal("AA", GameProfile.Variant(26));
        var recipe = TreePresets.Make("thornwake-pine");
        var note = GameProfiles.Handoff(tw, recipe, "Pine.manifest.json",
            [new("TREE_Pine_A", "Pine_A.noortree.json", ["Pine_A_LOD0.glb", "Pine_A_LOD1.glb", "Pine_A_LOD2.glb"], [2700, 1100, 200], 12.5f, 7.1f)], 1024);
        foreach (var s in new[] { "TREE_Pine_A", "`Pine_A`", "2,700 / 1,100 / 200", "NEAREST", "TEXCOORD_1", "No billboard", "--test-tree", "Pine.manifest.json" })
            Assert.Contains(s, note);
        Assert.DoesNotContain("\r", note);
    }
}
