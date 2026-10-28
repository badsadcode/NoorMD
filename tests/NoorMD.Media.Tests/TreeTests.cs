using System.Numerics;
using NoorMD.Media.Assets3D;
using Xunit;

namespace NoorMD.Media.Tests;

public class TreeTests
{
    private static TreeRecipe Small(string preset = "oak", string branches = "merged")
    {
        var r = TreePresets.Make(preset);
        r.Branches = branches;
        r.Quality = "low";
        r.Budget = 2000;
        r.Lods = 2;
        return r;
    }

    private static readonly TreeBuilder.Options NoTextures = new() { TextureSize = 0 };

    [Fact]
    public void Skeleton_is_deterministic_and_exactly_as_tall_as_asked()
    {
        var r = Small();
        var a = TreeSkeleton.Grow(r);
        var b = TreeSkeleton.Grow(r);
        Assert.Equal(a.AllPoints, b.AllPoints);
        Assert.Equal((float)r.Height, a.AllPoints.Max(p => p.Y), 3);
        r.Seed++;
        Assert.NotEqual(a.AllPoints, TreeSkeleton.Grow(r).AllPoints);
        // Levels are respected: limbs on the trunk, branches on the limbs, roots at the base.
        Assert.Contains(a.Branches, x => x.Level == r.Levels.Count);
        Assert.Equal(r.Roots, a.Branches.Count(x => x.Root));
        Assert.All(a.Branches.Where(x => x.Parent >= 0 && !x.Root), x => Assert.Equal(a.Branches[x.Parent].Level + 1, x.Level));
        // Thinner as they go: every branch starts no thicker than its parent at that point.
        Assert.All(a.Branches.Where(x => x.Parent >= 0 && !x.Root), x => Assert.True(x.BaseRadius <= a.Branches[x.Parent].At(x.ParentT).R + 1e-4f));
    }

    [Theory]
    [InlineData("oak")]
    [InlineData("pine")]
    [InlineData("birch")]
    [InlineData("dead")]
    [InlineData("stylized-oak")]
    [InlineData("stylized-pine")]
    [InlineData("stylized-dead")]
    public void Every_preset_builds_clean_meshes_in_every_branch_mode(string preset)
    {
        foreach (var mode in TreeRecipe.BranchModes)
        {
            var build = TreeBuilder.Build(Small(preset, mode), NoTextures);
            Assert.Equal(2, build.Lods.Count);
            foreach (var lod in build.Lods)
                foreach (var node in lod.Root.All().Where(n => n.Mesh != null))
                {
                    Assert.Empty(node.Mesh!.Problems());
                    // Wind data within 0–1, in the extra UV sets (vertex colours stay free, so nothing gets tinted).
                    Assert.Empty(node.Mesh.Colors);
                    Assert.Equal(node.Mesh.VertexCount, node.Mesh.UV1.Count);
                    Assert.All(node.Mesh.UV1.Concat(node.Mesh.UV2), c => Assert.True(c.X is >= 0 and <= 1 && c.Y is >= 0 and <= 1));
                }
            // Later levels of detail are lighter.
            Assert.True(build.Lods[1].TriangleCount < build.Lods[0].TriangleCount);
            // The file is well formed.
            GlbWriterTests.Parse(GlbWriter.Write(build.Lods[0]));
        }
    }

    [Fact]
    public void Separate_branches_are_their_own_nodes_with_pivots_where_they_leave_the_trunk()
    {
        var merged = TreeBuilder.Build(Small("oak", "merged"), NoTextures);
        var separate = TreeBuilder.Build(Small("oak", "separate"), NoTextures);
        var limbs = separate.Skeleton.Branches.Where(b => b.Level == 1).ToList();
        var trunk = separate.Lods[0].Root.Children.Single(n => n.Name == "Trunk");
        var branchNodes = trunk.Children.Where(n => n.Name.StartsWith("Branch_")).ToList();
        Assert.Equal(limbs.Count, branchNodes.Count);
        for (var i = 0; i < limbs.Count; i++)
        {
            Assert.Equal(limbs[i].Points[0], branchNodes[i].Translation);
            // The mesh sits around its pivot: its base is near the local origin.
            var mesh = branchNodes[i].Mesh!;
            Assert.True(mesh.Positions.Min(p => p.Length()) < limbs[i].BaseRadius * 1.5f + 0.1f);
            Assert.Contains(branchNodes[i].Children, c => c.Name == branchNodes[i].Name + "_Leaves");
        }
        Assert.DoesNotContain(merged.Lods[0].Root.All(), n => n.Name.StartsWith("Branch_"));
        // Mixed: thick limbs welded, thin ones separate.
        var mixedRecipe = Small("oak", "mixed");
        mixedRecipe.MixedRadius = limbs.Select(b => b.BaseRadius).OrderBy(r => r).ElementAt(limbs.Count / 2);
        var mixed = TreeBuilder.Build(mixedRecipe, NoTextures);
        var mixedCount = mixed.Lods[0].Root.All().Count(n => n.Name.StartsWith("Branch_") && !n.Name.EndsWith("_Leaves"));
        Assert.Equal(limbs.Count(b => b.BaseRadius < mixedRecipe.MixedRadius), mixedCount);
        Assert.InRange(mixedCount, 1, limbs.Count - 1);
    }

    [Fact]
    public void The_trunk_is_one_welded_surface_and_meets_the_budget()
    {
        var r = Small("stylized-oak");
        r.Levels.Clear();
        r.Roots = 5;
        r.Foliage = "none";
        r.Taper = 0.4;      // a thick top, so no part of it is too thin for the grid
        r.Budget = 1500;
        var build = TreeBuilder.Build(r, NoTextures);
        var trunk = build.Lods[0].Root.Children[0].Mesh!;
        Assert.InRange(trunk.TriangleCount, 1000, 1500);
        // Welded: once the UV seams are joined again, the trunk and its roots are a single closed piece.
        var weld = new Mesh3D();
        var map = new Dictionary<Vector3, int>();
        var sub = weld.Sub(0);
        foreach (var s in trunk.Submeshes)
            foreach (var i in s.Indices)
            {
                if (!map.TryGetValue(trunk.Positions[i], out var v)) { v = map[trunk.Positions[i]] = weld.Positions.Count; weld.Positions.Add(trunk.Positions[i]); }
                sub.Indices.Add(v);
            }
        Assert.Equal(1, ImplicitFieldTests.Components(weld));
        Assert.Equal(0, ImplicitFieldTests.OpenOrBadEdges(weld));
        // The root flare: the base is much wider than the trunk.
        var baseWidth = trunk.Positions.Where(p => p.Y is > 0 and < 0.2f).Max(p => new Vector2(p.X, p.Z).Length());
        Assert.True(baseWidth > r.TrunkRadius * 1.6);
    }

    [Fact]
    public void Leaves_follow_the_foliage_kind()
    {
        int Material(TreeBuild b, string name) => b.Lods[0].Materials.FindIndex(m => m.Name == name);
        int Tris(TreeBuild b, string name)
        {
            var mat = Material(b, name);
            return mat < 0 ? 0 : b.Lods[0].Root.All().Where(n => n.Mesh != null).Sum(n => n.Mesh!.Submeshes.Where(s => s.Material == mat).Sum(s => s.Indices.Count / 3));
        }
        var r = Small("oak");
        r.Foliage = "cards";
        var cards = TreeBuilder.Build(r, NoTextures);
        Assert.True(Tris(cards, "Leaves") > 100);
        Assert.Equal(-1, Material(cards, "Leaf clumps"));
        Assert.Equal("mask", cards.Lods[0].Materials[Material(cards, "Leaves")].Alpha);
        Assert.False(cards.Lods[0].Materials[Material(cards, "Leaves")].DoubleSided);
        r.Foliage = "clumps";
        var clumps = TreeBuilder.Build(r, NoTextures);
        Assert.True(Tris(clumps, "Leaf clumps") > 100);
        Assert.Equal(0, Tris(clumps, "Leaves"));
        r.Foliage = "both";
        var both = TreeBuilder.Build(r, NoTextures);
        Assert.True(Tris(both, "Leaf clumps") > 100 && Tris(both, "Leaves") > 100);
        r.Foliage = "none";
        Assert.DoesNotContain(TreeBuilder.Build(r, NoTextures).Lods[0].Root.All(), n => n.Name.EndsWith("Leaves"));
        // Dead trees stay bare whatever the setting.
        var dead = Small("dead");
        dead.Foliage = "cards";
        Assert.Equal(0, Tris(TreeBuilder.Build(dead, NoTextures), "Leaves"));
    }

    [Fact]
    public void Leaf_cards_anchor_at_the_branch_and_flutter_at_the_tip()
    {
        var r = Small("birch");
        var build = TreeBuilder.Build(r, NoTextures);
        var leaves = build.Lods[0].Root.All().First(n => n.Name == "Leaves").Mesh!;
        // Twelve corners per card (six in front, six behind): the bottom row (anchor) doesn't flutter, the top row does.
        Assert.Equal(0, leaves.VertexCount % 12);
        for (var c = 0; c < leaves.VertexCount; c += 12)
        {
            Assert.Equal(0, leaves.UV1[c].Y);
            Assert.Equal(0, leaves.UV1[c + 1].Y);
            Assert.Equal(1, leaves.UV1[c + 6].Y);
            // Front and back share the corner, not the normal (unless the crown normals take over completely).
            Assert.Equal(leaves.Positions[c], leaves.Positions[c + 1]);
            Assert.True(Vector3.Dot(leaves.Normals[c], leaves.Normals[c + 1]) < 0.999f);
        }
        // Card UVs stay inside one atlas cell.
        for (var c = 0; c < leaves.VertexCount; c += 12)
        {
            var us = Enumerable.Range(c, 12).Select(i => leaves.UV0[i]).ToList();
            Assert.True(us.Max(u => u.X) - us.Min(u => u.X) <= 0.5f + 1e-5f);
            Assert.True(us.Max(u => u.Y) - us.Min(u => u.Y) <= 0.5f + 1e-5f);
        }
    }

    [Fact]
    public void Textures_and_tangents_are_made_for_textured_bark()
    {
        var r = Small("oak");
        r.Lods = 1;
        var build = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 64 });
        var bark = build.Lods[0].Materials[0];
        Assert.NotNull(bark.BaseColorPng);
        Assert.NotNull(bark.NormalPng);
        Assert.NotNull(bark.OcclusionRoughnessMetallicPng);
        var trunk = build.Lods[0].Root.Children[0].Mesh!;
        Assert.Equal(trunk.VertexCount, trunk.Tangents.Count);
        Assert.Empty(trunk.Problems());
        Assert.NotNull(build.Lods[0].Materials.First(m => m.Name == "Leaves").BaseColorPng);
        // Bark UVs: no triangle jumps across the wrap-around seam (only end caps, where all directions meet, span widely).
        var wide = 0;
        var all = 0;
        foreach (var s in trunk.Submeshes.Where(s => s.Material == 0))
            for (var i = 0; i < s.Indices.Count; i += 3, all++)
            {
                var us = new[] { trunk.UV0[s.Indices[i]].X, trunk.UV0[s.Indices[i + 1]].X, trunk.UV0[s.Indices[i + 2]].X };
                if (us.Max() - us.Min() > 0.5f) wide++;
            }
        Assert.True(wide < all * 0.03, $"{wide} of {all} triangles span half a texture");
    }

    [Fact]
    public void Recipe_survives_json_and_is_clamped()
    {
        var r = TreePresets.Make("pine");
        var back = TreeRecipe.FromJson(r.ToJson());
        Assert.Equal(r.ToJson(), back.ToJson());
        var bad = TreeRecipe.FromJson("""{"height": 9999, "archetype": "palm", "levels": [{"count": 9999}, {}, {}, {}, {}], "leafColor": "red", "barkMaterial": "../x", "budget": 1}""");
        Assert.Equal(60, bad.Height);
        Assert.Equal("broadleaf", bad.Archetype);
        Assert.Equal(3, bad.Levels.Count);
        Assert.Equal(80, bad.Levels[0].Count);
        Assert.Equal("#4f7a2c", bad.LeafColor);
        Assert.Equal("", bad.BarkMaterial);
        Assert.Equal(200, bad.Budget);
    }

    [Fact]
    public void Wind_data_can_go_to_vertex_colours_or_be_left_out()
    {
        var r = Small("birch");
        r.Lods = 1;
        r.WindData = "color";
        var leaves = TreeBuilder.Build(r, NoTextures).Lods[0].Root.All().First(n => n.Name == "Leaves").Mesh!;
        Assert.Equal(leaves.VertexCount, leaves.Colors.Count);
        Assert.Empty(leaves.UV1);
        Assert.Equal(1, leaves.Colors[6].Z);
        var (json, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeBuilder.Build(r, NoTextures).Lods[0]));
        Assert.Contains("COLOR_0", json.GetRawText());
        r.Wind = false;
        var still = TreeBuilder.Build(r, NoTextures).Lods[0].Root.All().First(n => n.Name == "Leaves").Mesh!;
        Assert.Empty(still.Colors);
        Assert.Empty(still.UV1);
    }
}
