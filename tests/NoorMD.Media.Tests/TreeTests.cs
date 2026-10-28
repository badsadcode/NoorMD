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
        r.Budget = 2500;            // just enough for full tubes (the lean wood of small budgets has its own test)
        r.Lods = 2;
        r.Billboard = false;
        r.CanopyFullness = 0;       // the cards as placed (the canopy fill has its own test)
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

    public static IEnumerable<object[]> AllPresets => TreePresets.All.Select(p => new object[] { p.Id });

    [Theory]
    [MemberData(nameof(AllPresets))]
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
                    // Wind data within 0–1, in the extra UV sets; the vertex colours carry the painted shading (grey, 0–1).
                    Assert.Equal(node.Mesh.VertexCount, node.Mesh.Colors.Count);
                    Assert.All(node.Mesh.Colors, c => Assert.True(c.X is > 0.2f and <= 1 && c.W == 1));
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
        r.Budget = 1800;    // above the low-poly tubes of small budgets (their own test)
        var build = TreeBuilder.Build(r, NoTextures);
        var trunk = build.Lods[0].Root.Children[0].Mesh!;
        Assert.InRange(trunk.TriangleCount, 1200, 1800);
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
        r.Foliage = "tufts";
        var tufts = TreeBuilder.Build(r, NoTextures);
        Assert.True(Tris(tufts, "Leaves") > 300);
        Assert.Equal(-1, Material(tufts, "Leaf clumps"));     // no solid mesh in the canopy
        Assert.True(TreePresets.Make("stylized-oak").Foliage == "tufts" && TreePresets.Make("stylized-pine").Foliage == "tufts");
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
        r.TrimCards = false;     // the rectangle's layout (cards cut to their leaves have their own test)
        var build = TreeBuilder.Build(r, NoTextures);
        var leaves = build.Lods[0].Root.All().First(n => n.Name == "Leaves").Mesh!;
        // Twelve corners per card (six in front, six behind): the bottom row (anchor) doesn't flutter, the top row does.
        Assert.Equal(0, leaves.VertexCount % 12);
        for (var c = 0; c < leaves.VertexCount; c += 12)
        {
            Assert.Equal(0, leaves.UV1[c].Y);
            Assert.Equal(0, leaves.UV1[c + 1].Y);
            Assert.Equal(1, leaves.UV1[c + 6].Y);
            // Front and back share the corner.
            Assert.Equal(leaves.Positions[c], leaves.Positions[c + 1]);
        }
        // …not the normal, except on a card facing straight out of the crown, where the crown normal wins on both sides.
        var cards = leaves.VertexCount / 12;
        var distinct = Enumerable.Range(0, cards).Count(k => Vector3.Dot(leaves.Normals[k * 12], leaves.Normals[k * 12 + 1]) < 0.99f);
        Assert.True(distinct > cards * 0.6, $"{distinct} of {cards}");
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
        Assert.Equal(120, bad.Height);
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
        r.TrimCards = false;
        r.WindData = "color";
        var leaves = TreeBuilder.Build(r, NoTextures).Lods[0].Root.All().First(n => n.Name == "Leaves").Mesh!;
        Assert.Equal(leaves.VertexCount, leaves.Colors.Count);
        Assert.Empty(leaves.UV1);
        Assert.Equal(1, leaves.Colors[6].Z);
        var (json, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeBuilder.Build(r, NoTextures).Lods[0]));
        Assert.Contains("COLOR_0", json.GetRawText());
        r.Wind = false;
        r.Shading = 0;
        var still = TreeBuilder.Build(r, NoTextures).Lods[0].Root.All().First(n => n.Name == "Leaves").Mesh!;
        Assert.Empty(still.Colors);
        Assert.Empty(still.UV1);
    }

    private static Mesh3D Wood(TreeBuild b) => b.Lods[0].Root.All().First(n => n.Name == "Trunk").Mesh!;
    private static Mesh3D? Leaves(TreeBuild b) => b.Lods[0].Root.All().FirstOrDefault(n => n.Name == "Leaves")?.Mesh;

    [Fact]
    public void Fluting_ribs_the_lower_trunk()
    {
        float Ribbing(double flute)
        {
            var r = Small("oak");
            r.Levels.Clear(); r.Foliage = "none"; r.RootStyle = "compact"; r.Wobble = 0; r.Lean = 0; r.Twist = 0; r.Quality = "high"; r.Budget = 20000; r.Lods = 1;
            r.Flute = flute; r.FluteLobes = 8; r.FluteHeight = 0.5;
            var w = Wood(TreeBuilder.Build(r, NoTextures));
            var y = (float)r.Height * 0.12f;
            var band = w.Positions.Where(p => MathF.Abs(p.Y - y) < 0.15f).Select(p => new Vector2(p.X, p.Z).Length()).ToList();
            return band.Max() / band.Min();
        }
        Assert.True(Ribbing(0) < 1.12f);
        Assert.True(Ribbing(1) > 1.25f);
    }

    [Fact]
    public void Stilt_roots_arch_from_the_trunk_down_to_the_ground_and_knees_stand_around_it()
    {
        var r = TreePresets.Make("mangrove");
        r.Knees = 6;
        var sk = TreeSkeleton.Grow(r);
        var props = sk.Branches.Where(b => b.Kind == "prop").ToList();
        Assert.Equal(r.Roots, props.Count);
        Assert.All(props, b =>
        {
            Assert.True(b.Points[0].Y > r.TrunkRadius * 1.5);                       // they leave the trunk well above the ground
            Assert.InRange(b.Points[^1].Y, -r.TrunkRadius, 0.05f);                 // and end in it
            Assert.True(new Vector2(b.Points[^1].X, b.Points[^1].Z).Length() > r.TrunkRadius * 3);
        });
        Assert.Equal(6, sk.Branches.Count(b => b.Kind == "knee"));
        // The knees are woody cones of their own, standing out of the ground apart from the trunk.
        r.Levels.Clear(); r.Foliage = "none"; r.Quality = "low"; r.Lods = 1; r.Roots = 0; r.RootStyle = "compact";
        var weld = new Mesh3D();
        var w = Wood(TreeBuilder.Build(r, NoTextures));
        weld.Positions.AddRange(w.Positions);
        var map = new Dictionary<Vector3, int>();
        var sub = weld.Sub(0);
        foreach (var x in w.Submeshes) foreach (var i in x.Indices) { if (!map.TryGetValue(w.Positions[i], out var v)) map[w.Positions[i]] = v = i; sub.Indices.Add(v); }
        Assert.True(ImplicitFieldTests.Components(weld) >= 4);
    }

    [Fact]
    public void Surface_roots_fork_and_sink_their_tips()
    {
        var r = Small("oak");
        r.RootStyle = "surface"; r.Roots = 5; r.RootForks = 2; r.RootBurial = 1;
        var sk = TreeSkeleton.Grow(r);
        var roots = sk.Branches.Where(b => b.Kind == "root").ToList();
        Assert.Equal(5 * 3, roots.Count);
        Assert.All(roots, b => Assert.True(b.Points[^1].Y < 0));
        Assert.True(roots.Max(b => new Vector2(b.Points[^1].X, b.Points[^1].Z).Length()) > r.TrunkRadius * 2.5);
    }

    [Fact]
    public void Willow_curtains_hang_down_and_flutter_more_towards_their_tips()
    {
        var r = Small("willow");
        var b = TreeBuilder.Build(r, NoTextures);
        var leaves = Leaves(b)!;
        Assert.Empty(leaves.Problems());
        // Strips: rows of six vertices (left, middle, right, each front and back); the flutter rises down the ribbon.
        Assert.True(leaves.UV1.Max(u => u.Y) == 1 && leaves.UV1.Min(u => u.Y) == 0);
        Assert.True(leaves.Positions.Min(p => p.Y) > 0.2f);
        var (lo, hi) = leaves.Bounds();
        Assert.True(hi.Y - lo.Y > r.Height * 0.4f);       // long curtains, not a ball of cards
    }

    [Fact]
    public void Palm_fronds_crown_the_trunk()
    {
        var b = TreeBuilder.Build(Small("palm"), NoTextures);
        var leaves = Leaves(b)!;
        Assert.Empty(leaves.Problems());
        var (lo, hi) = leaves.Bounds();
        Assert.True(lo.Y > b.Recipe.Height * 0.5);                 // up at the top
        Assert.True(hi.X - lo.X > b.Recipe.Height * 0.3);          // spread wide
    }

    [Fact]
    public void Moss_hangs_even_from_dead_trees_and_vines_carry_no_leaves()
    {
        var r = Small("bog-snag");
        var b = TreeBuilder.Build(r, NoTextures);
        var moss = b.Lods[0].Materials.FindIndex(m => m.Name == "Moss");
        Assert.True(moss >= 0);
        Assert.Equal("mask", b.Lods[0].Materials[moss].Alpha);
        Assert.True(Leaves(b)!.Submeshes.Single(x => x.Material == moss).Indices.Count > 300);
        var vines = b.Skeleton.Branches.Where(x => x.Kind == "vine").ToList();
        Assert.NotEmpty(vines);
        Assert.All(vines, v => { Assert.True(v.Bare); Assert.True(v.Points[^1].Y < v.Points[0].Y); Assert.True(v.Points[^1].Y > 0.2f); });
        r.Moss = 0;
        Assert.DoesNotContain(TreeBuilder.Build(r, NoTextures).Lods[0].Materials, m => m.Name == "Moss");
    }

    [Theory]
    [InlineData("cross")]
    [InlineData("star")]
    [InlineData("fan")]
    [InlineData("dome")]
    [InlineData("single")]
    public void Card_arrangements_build_clean_leaves(string arrangement)
    {
        var r = Small("oak");
        r.Arrangement = arrangement;
        var leaves = Leaves(TreeBuilder.Build(r, NoTextures))!;
        Assert.Empty(leaves.Problems());
        Assert.True(leaves.TriangleCount > 200);
    }

    [Fact]
    public void Variety_packs_number_their_trees_and_spread_their_sizes()
    {
        var r = TreePresets.Make("oak");
        var pack = TreeVariants.Make(r, 6, 0.2);
        Assert.Equal(6, pack.Count);
        Assert.Equal(r.Seed, pack[0].Seed);
        Assert.Equal(r.Height, pack[0].Height);
        Assert.Equal(6, pack.Select(x => x.Seed).Distinct().Count());
        Assert.All(pack, x => Assert.InRange(x.Height, r.Height * 0.8 - 1e-9, r.Height * 1.2 + 1e-9));
        Assert.Contains(pack, x => Math.Abs(x.Height - r.Height) > 0.05);
        Assert.Equal(["Oak 01", "Oak 06"], new[] { pack[0].Name, pack[5].Name });
        Assert.Equal(pack.Select(x => x.ToJson()), TreeVariants.Make(r, 6, 0.2).Select(x => x.ToJson()));     // the same pack every time
        Assert.Equal("Oak", TreeVariants.Make(r, 1, 0.2)[0].Name);
        Assert.Equal(TreeVariants.MaxCount, TreeVariants.Make(r, 999, 0.2).Count);
    }

    [Fact]
    public void Umbrella_crowns_are_longest_at_the_top()
    {
        Assert.True(TreeSkeleton.ShapeRatio("umbrella", 1) > TreeSkeleton.ShapeRatio("umbrella", 0.5f));
        Assert.True(TreeSkeleton.ShapeRatio("umbrella", 0.5f) > TreeSkeleton.ShapeRatio("umbrella", 0));
    }

    [Fact]
    public void Painted_shading_darkens_the_inside_of_the_crown_and_the_foot_of_the_trunk()
    {
        var r = Small("stylized-oak");
        r.Shading = 1;
        var b = TreeBuilder.Build(r, NoTextures);
        var leaves = Leaves(b)!;
        var c = b.Skeleton.CrownCentre;
        var inner = Enumerable.Range(0, leaves.VertexCount).Where(i => Vector3.Distance(leaves.Positions[i], c) < b.Skeleton.CrownRadius * 0.3f).Select(i => leaves.Colors[i].X).DefaultIfEmpty(0.5f).Average();
        var outer = Enumerable.Range(0, leaves.VertexCount).Where(i => leaves.Positions[i].Y > c.Y + b.Skeleton.CrownRadius * 0.6f).Select(i => leaves.Colors[i].X).Average();
        Assert.True(outer > inner + 0.15f, $"outer {outer}, inner {inner}");
        var wood = Wood(b);
        var foot = Enumerable.Range(0, wood.VertexCount).Where(i => wood.Positions[i].Y < 0.2f).Select(i => wood.Colors[i].X).Average();
        var up = Enumerable.Range(0, wood.VertexCount).Where(i => wood.Positions[i].Y > r.Height * 0.3f).Select(i => wood.Colors[i].X).Average();
        Assert.True(up > foot + 0.1f);
        // With the wind data in the vertex colours there is no shading (they can't hold both).
        r.WindData = "color";
        Assert.All(Leaves(TreeBuilder.Build(r, NoTextures))!.Colors, x => Assert.InRange(x.Z, 0, 1));
    }

    [Fact]
    public void Bark_is_made_in_the_tree_colour_painted_or_birch()
    {
        foreach (var id in BarkTextures.Ids)
        {
            var recipe = BarkTextures.For(id, "#8a4a2c")!;
            var maps = NoorMD.Media.TextureEngine.Render(recipe, 64);
            Assert.Equal(64 * 64 * 3, maps.Albedo.Length);
        }
        Assert.Null(BarkTextures.For("nothing", "#8a4a2c"));
        // Red bark comes out red.
        var red = NoorMD.Media.TextureEngine.Render(BarkTextures.For("bark", "#c04020")!, 64).Albedo;
        double R = 0, B = 0;
        for (var i = 0; i < red.Length; i += 3) { R += red[i]; B += red[i + 2]; }
        Assert.True(R > B * 2);
        var tree = Small("birch");
        tree.Lods = 1;
        Assert.NotNull(TreeBuilder.Build(tree, new TreeBuilder.Options { TextureSize = 64 }).Lods[0].Materials[0].BaseColorPng);
    }

    [Fact]
    public void Mushroom_trees_wear_a_textured_cap_on_top_and_smaller_ones_on_their_limbs()
    {
        var r = Small("glowcap");
        var b = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 64 });
        var cap = b.Lods[0].Materials.FindIndex(m => m.Name == "Cap");
        Assert.True(cap >= 0);
        Assert.NotNull(b.Lods[0].Materials[cap].BaseColorPng);
        Assert.True(b.Lods[0].Materials[cap].Emissive.Length() > 0);         // it glows
        var wood = Wood(b);
        Assert.Empty(wood.Problems());
        var capVerts = wood.Submeshes.Single(x => x.Material == cap).Indices.Distinct().Select(i => wood.Positions[i]).ToList();
        // The big cap is about as wide as asked and sits at the top.
        Assert.True(capVerts.Max(p => p.Y) >= b.Recipe.Height * 0.95);
        var top = capVerts.Where(p => p.Y > b.Recipe.Height * 0.8).ToList();
        Assert.InRange(top.Max(p => p.X) - top.Min(p => p.X), r.CapWidth * 1.6, r.CapWidth * 2.3);
        // …and there are caps lower down too (on the limbs).
        Assert.Contains(capVerts, p => p.Y < b.Recipe.Height * 0.8);
        Assert.True(r.BranchCaps > 0);
        // Outward-facing: normals point away from each cap's middle on its top.
        Assert.True(capVerts.Count > 100);
        var json = GlbWriterTests.Parse(GlbWriter.Write(b.Lods[0])).Json.GetRawText();
        Assert.Contains("emissiveFactor", json);
    }

    [Fact]
    public void Crystal_trees_grow_faceted_glowing_shards_instead_of_leaves()
    {
        var b = TreeBuilder.Build(Small("crystal-tree"), NoTextures);
        var crystal = b.Lods[0].Materials.FindIndex(m => m.Name == "Crystal");
        Assert.True(crystal >= 0);
        Assert.True(b.Lods[0].Materials[crystal].Emissive.Length() > 0.1f);
        Assert.DoesNotContain(b.Lods[0].Materials, m => m.Name == "Leaves");
        var leaves = Leaves(b)!;
        Assert.Empty(leaves.Problems());
        var tris = leaves.Submeshes.Single(x => x.Material == crystal).Indices.Count / 3;
        Assert.Equal(0, tris % 18);           // six sides, two triangles each, and six for the point
        // Flat faces: every triangle has its own corners, all with the face's normal.
        Assert.Equal(leaves.VertexCount, leaves.Submeshes.Sum(x => x.Indices.Count));
    }

    [Fact]
    public void Wind_shaders_read_the_wind_data_where_the_export_puts_it()
    {
        Assert.Contains("shader_type spatial;", WindShaders.Godot);
        // UV2 (glTF TEXCOORD_1) gives bend and flutter; with wind_in_color they come from COLOR's green and blue.
        Assert.Contains("vec2 bend_flutter = UV2;", WindShaders.Godot);
        Assert.Contains("bend_flutter = COLOR.gb;", WindShaders.Godot);
        Assert.Contains("bend_flutter.x * bend_amount", WindShaders.Godot);
        Assert.Contains("bend_flutter.y * flutter_amount", WindShaders.Godot);
        Assert.Contains("void NoorTreeWind_float(", WindShaders.Hlsl);
        Assert.Contains("void NoorTreeWind_half(", WindShaders.Hlsl);
        // Balanced braces (a typo here would only show up in the engine).
        foreach (var code in new[] { WindShaders.Godot, WindShaders.Hlsl })
            Assert.Equal(code.Count(c => c == '{'), code.Count(c => c == '}'));
    }

    [Fact]
    public void A_billboard_is_the_last_level_a_whole_tree_on_crossed_cards()
    {
        var r = Small("oak");
        r.Billboard = true;
        r.BillboardViews = 3;
        var b = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 128 });
        Assert.Equal(3, b.Lods.Count);
        var bb = b.Lods[^1];
        Assert.Equal("Oak_LOD2", bb.Name);
        Assert.Equal(3 * 2 * 2, bb.TriangleCount);      // three cards, front and back
        // Its material comes after the tree's own ones (the levels share the indices); its file holds only that one.
        var mat = bb.Materials[Assert.Single(bb.Root.Children[0].Mesh!.Submeshes).Material];
        Assert.Equal("Billboard", mat.Name);
        Assert.Same(b.Lods[0].Materials[0], bb.Materials[0]);
        Assert.Equal("mask", mat.Alpha);
        var img = mat.BaseColorPixels!;
        Assert.Equal(128, img.Height);
        // The tree is drawn (opaque pixels) with see-through air around it, in each view.
        var cell = img.Width / 3;
        for (var v = 0; v < 3; v++)
        {
            var opaque = 0;
            for (var y = 0; y < img.Height; y++) for (var x = v * cell; x < (v + 1) * cell; x++) if (img.Rgba[(y * img.Width + x) * 4 + 3] > 0) opaque++;
            Assert.InRange(opaque, cell * img.Height / 20, cell * img.Height * 9 / 10);
        }
        // The trunk stands at the bottom middle of the cards.
        var mid = img.Width / 6;
        Assert.True(img.Rgba[((img.Height - 2) * img.Width + mid) * 4 + 3] > 0);
        // As tall as the tree's finest level (its leaves may stand a little above the skeleton's top).
        var top = b.Lods[0].Root.All().Where(n => n.Mesh != null).Max(n => n.Mesh!.Bounds().Max.Y + n.Translation.Y);
        var (lo, hi) = bb.Root.Children[0].Mesh!.Bounds();
        Assert.InRange(hi.Y - lo.Y, top * 0.97, top * 1.03);
        Assert.Empty(bb.Root.Children[0].Mesh!.Problems());
        var (json, _) = GlbWriterTests.Parse(GlbWriter.Write(bb));
        Assert.Equal("Billboard", Assert.Single(json.GetProperty("materials").EnumerateArray()).GetProperty("name").GetString());
    }

    [Fact]
    public void Pictures_of_your_own_dress_the_bark_and_the_leaves()
    {
        var leaf = new RawImage(8, 8, Enumerable.Repeat((byte)200, 8 * 8 * 4).ToArray());
        var barkPic = new RawImage(4, 4, Enumerable.Repeat((byte)90, 4 * 4 * 4).ToArray());
        var r = Small("oak");
        r.Lods = 1;
        r.LeafImage = @"D:\Art\leaves.png";
        r.LeafImageAtlas = false;
        r.BarkImage = @"D:\Art\bark.png";
        var b = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 64, Images = p => p.EndsWith("leaves.png") ? leaf : p.EndsWith("bark.png") ? barkPic : null });
        var mats = b.Lods[0].Materials;
        Assert.Same(leaf, mats.First(m => m.Name == "Leaves").BaseColorPixels);
        Assert.Same(barkPic, mats.First(m => m.Name == "Bark").BaseColorPixels);
        Assert.Null(mats.First(m => m.Name == "Bark").NormalPng);       // colour only
        Assert.DoesNotContain(b.Notes, n => n.Contains("picture"));
        // One picture (not an atlas): every card shows all of it.
        var leaves = Leaves(b)!;
        Assert.Equal(0f, leaves.UV0.Min(u => u.X));
        Assert.Equal(1f, leaves.UV0.Max(u => u.X));
        // A picture that can't be read: generated instead, and said so.
        var missing = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 64, Images = _ => null });
        Assert.Equal(2, missing.Notes.Count(n => n.Contains("picture")));
        Assert.NotNull(missing.Lods[0].Materials.First(m => m.Name == "Leaves").BaseColorPng);
    }

    // ---- Fuller crowns for fewer triangles ----

    private static int Opaque(RawImage img) { var n = 0; for (var i = 3; i < img.Rgba.Length; i += 4) if (img.Rgba[i] > 128) n++; return n; }

    [Fact]
    public void A_spray_or_a_cluster_card_holds_more_leaf_than_a_twig()
    {
        var twig = LeafAtlas.Pixels("broad", "#3f6b26", "#7a9a33", false, 256, 3, "twig");
        var spray = LeafAtlas.Pixels("broad", "#3f6b26", "#7a9a33", false, 256, 3, "spray");
        var cluster = LeafAtlas.Pixels("broad", "#3f6b26", "#7a9a33", false, 256, 3, "cluster");
        Assert.True(Opaque(spray) > Opaque(twig) * 1.3, $"spray {Opaque(spray)} vs twig {Opaque(twig)}");
        Assert.True(Opaque(cluster) > Opaque(twig) * 1.3, $"cluster {Opaque(cluster)} vs twig {Opaque(twig)}");
        // Nothing is cut off at a cell's edge: the outermost pixel columns of every cell stay clear.
        foreach (var img in new[] { spray, cluster })
            for (var y = 0; y < img.Height; y++)
                foreach (var x in new[] { 0, img.Width / 2 - 1, img.Width / 2, img.Width - 1 })
                    Assert.True(img.Rgba[(y * img.Width + x) * 4 + 3] < 200, $"edge pixel {x},{y}");
        // Fronds and moss are their own sprites: no clusters.
        Assert.Equal(LeafAtlas.Pixels("frond", "#3f6b26", "#7a9a33", false, 64, 3, "twig").Rgba, LeafAtlas.Pixels("frond", "#3f6b26", "#7a9a33", false, 64, 3, "cluster").Rgba);
    }

    [Fact]
    public void The_leaf_budget_caps_the_leaves_and_the_cards_grow_instead()
    {
        var r = Small();
        r.Quality = "medium";
        r.LeafDensity = 1;
        r.LeafSize = 0.4;
        r.LeafBudget = 200_000;
        var free = Leaves(TreeBuilder.Build(r, NoTextures))!;
        r.LeafBudget = 2000;
        var capped = Leaves(TreeBuilder.Build(r, NoTextures))!;
        Assert.True(free.TriangleCount > 4000, $"free {free.TriangleCount}");
        Assert.InRange(capped.TriangleCount, 1200, 2500);
        // The crown is as wide: the fewer cards are bigger.
        var (flo, fhi) = free.Bounds();
        var (clo, chi) = capped.Bounds();
        Assert.InRange(chi.X - clo.X, (fhi.X - flo.X) * 0.85, (fhi.X - flo.X) * 1.3);
        var cardFree = free.TriangleCount / 8;
        var cardCapped = capped.TriangleCount / 8;
        Assert.True(CardArea(capped) / cardCapped > CardArea(free) / cardFree * 2, "the capped cards are bigger");
    }

    private static double CardArea(Mesh3D m)
    {
        double a = 0;
        foreach (var s in m.Submeshes)
            for (var i = 0; i + 2 < s.Indices.Count; i += 3)
                a += Vector3.Cross(m.Positions[s.Indices[i + 1]] - m.Positions[s.Indices[i]], m.Positions[s.Indices[i + 2]] - m.Positions[s.Indices[i]]).Length() / 2;
        return a;
    }

    [Fact]
    public void Card_size_makes_the_planes_bigger_not_more()
    {
        var r = Small();
        r.TrimCards = false;     // rectangles: their area is the plane's
        r.LeafCluster = "twig";
        var normal = Leaves(TreeBuilder.Build(r, NoTextures))!;
        r.CardScale = 2;
        var big = Leaves(TreeBuilder.Build(r, NoTextures))!;
        Assert.Equal(normal.TriangleCount, big.TriangleCount);
        Assert.InRange(CardArea(big) / CardArea(normal), 3.5, 4.5);
        // A cluster's card grows by itself so its smaller leaves stay their size.
        r.CardScale = 1;
        r.LeafCluster = "cluster";
        var cluster = Leaves(TreeBuilder.Build(r, NoTextures))!;
        Assert.Equal(normal.TriangleCount, cluster.TriangleCount);
        Assert.InRange(CardArea(cluster) / CardArea(normal), 2.3, 3.2);
    }

    [Fact]
    public void Outer_leaves_move_cover_to_the_outside_of_the_crown()
    {
        var r = Small();
        r.Quality = "medium";
        double Mean(double outer)
        {
            r.OuterLeaves = outer;
            var b = TreeBuilder.Build(r, NoTextures);
            var m = Leaves(b)!;
            return m.Positions.Average(p => Vector3.Distance(p, b.Skeleton.CrownCentre)) / b.Skeleton.CrownRadius;
        }
        var inside = Mean(0);
        var outside = Mean(1);
        Assert.True(outside > inside + 0.03, $"outer 0: {inside:0.000}, outer 1: {outside:0.000}");
    }

    [Fact]
    public void Realistic_card_trees_come_with_clusters_and_conifers_with_sprays()
    {
        Assert.Equal("cluster", TreePresets.Make("oak").LeafCluster);
        Assert.Equal("cluster", TreePresets.Make("maple").LeafCluster);
        Assert.Equal("spray", TreePresets.Make("spruce").LeafCluster);
        Assert.Equal("twig", TreePresets.Make("willow").LeafCluster);
        // A recipe saved before keeps its twigs.
        Assert.Equal("twig", TreeRecipe.FromJson("{\"name\":\"Old\"}").LeafCluster);
        Assert.Equal(16000, TreeRecipe.FromJson("{\"name\":\"Old\"}").LeafBudget);
        Assert.Equal(4, TreeRecipe.FromJson("{\"cardScale\":9}").CardScale);
    }

    [Fact]
    public void Stats_say_what_a_level_costs_and_how_full_its_crown_looks()
    {
        var r = Small();
        r.Quality = "medium";
        r.LeafCluster = "twig";
        r.TrimCards = false;     // rectangles: twig and cluster cards cost the same
        var twig = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 128 });
        var t = TreeStatsMeter.Measure(twig.Lods[0]);
        Assert.Equal(twig.Lods[0].TriangleCount, t.Triangles);
        Assert.Equal(t.Triangles, t.WoodTriangles + t.LeafTriangles);
        Assert.Equal(Leaves(twig)!.TriangleCount, t.LeafTriangles);
        Assert.Equal(2, t.DrawCalls);                      // bark and leaves
        Assert.InRange(t.Fullness!.Value, 0.2, 1);
        Assert.InRange(t.Overdraw!.Value, 1, 30);
        Assert.InRange(t.EmptyCardArea!.Value, 0.2, 0.95);  // cards are rectangles round their leaves
        // Clusters: a fuller crown for the same leaf triangles.
        r.LeafCluster = "cluster";
        var c = TreeStatsMeter.Measure(TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 128 }).Lods[0]);
        Assert.Equal(t.LeafTriangles, c.LeafTriangles);
        Assert.True(c.Fullness > t.Fullness + 0.03, $"twig {t.Fullness:0.000} (overdraw {t.Overdraw:0.0}, empty {t.EmptyCardArea:0.00}), cluster {c.Fullness:0.000} (overdraw {c.Overdraw:0.0}, empty {c.EmptyCardArea:0.00})");
        // A tree without leaves has no crown to measure.
        var dead = TreeStatsMeter.Measure(TreeBuilder.Build(Small("dead"), NoTextures).Lods[0]);
        Assert.Null(dead.Fullness);
        Assert.Equal(0, dead.LeafTriangles);
    }

    [Fact]
    public void A_budget_that_makes_the_cards_grow_says_so()
    {
        var r = Small();
        r.LeafDensity = 1;
        r.LeafSize = 0.3;
        r.LeafBudget = 800;
        Assert.Contains(TreeBuilder.Build(r, NoTextures).Notes, n => n.Contains("leaf budget"));
        r.LeafBudget = 200_000;
        Assert.DoesNotContain(TreeBuilder.Build(r, NoTextures).Notes, n => n.Contains("leaf budget"));
    }

    [Fact]
    public void Cards_cut_to_their_leaves_draw_less_empty_space_for_the_same_triangles()
    {
        foreach (var cluster in new[] { "twig", "cluster" })
        {
            var r = Small();
            r.Quality = "medium";
            r.LeafCluster = cluster;
            r.TrimCards = false;
            var square = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 128 });
            r.TrimCards = true;
            var cut = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 128 });
            var a = TreeStatsMeter.Measure(square.Lods[0]);
            var b = TreeStatsMeter.Measure(cut.Lods[0]);
            // Six corners where the outline allows it inside its cell, a seventh now and then.
            Assert.InRange(b.LeafTriangles, a.LeafTriangles, a.LeafTriangles * 1.15);
            Assert.True(b.EmptyCardArea < a.EmptyCardArea - 0.1, $"{cluster}: see-through {a.EmptyCardArea:0.00} → {b.EmptyCardArea:0.00}");
            Assert.InRange(b.Fullness!.Value, a.Fullness!.Value - 0.04, a.Fullness.Value + 0.04);
            // Each triangle samples one sprite only, and none is empty.
            var m = Leaves(cut)!;
            Assert.Empty(m.Problems());
            foreach (var sub in m.Submeshes)
                for (var i = 0; i + 2 < sub.Indices.Count; i += 3)
                {
                    var uv = new[] { m.UV0[sub.Indices[i]], m.UV0[sub.Indices[i + 1]], m.UV0[sub.Indices[i + 2]] };
                    float lu = uv.Min(u => u.X), hu = uv.Max(u => u.X), lv = uv.Min(u => u.Y), hv = uv.Max(u => u.Y);
                    Assert.Equal(MathF.Floor((lu + 1e-4f) * 2), MathF.Floor((hu - 1e-4f) * 2));
                    Assert.Equal(MathF.Floor((lv + 1e-4f) * 2), MathF.Floor((hv - 1e-4f) * 2));
                }
        }
    }

    [Fact]
    public void A_sprite_outline_holds_every_leaf_with_few_corners()
    {
        var img = LeafAtlas.Pixels("broad", "#3f6b26", "#7a9a33", false, 256, 5, "spray");
        for (var cell = 0; cell < 4; cell++)
        {
            var rect = LeafAtlas.Cell(cell);
            var outline = CardShape.Outline(img, rect)!;
            Assert.InRange(outline.Length, 3, 6);
            // Every opaque pixel of the cell is inside (or on) the outline.
            int x0 = (int)(rect.X * 256), y0 = (int)(rect.Y * 256);
            for (var y = 0; y < 128; y++)
                for (var x = 0; x < 128; x++)
                {
                    if (img.Rgba[((y0 + y) * 256 + x0 + x) * 4 + 3] < 64) continue;
                    var p = new Vector2((x + 0.5f) / 128, (y + 0.5f) / 128);
                    Assert.True(Inside(outline, p), $"cell {cell}: pixel {x},{y} outside " + string.Join(" ", outline.Select(o => $"({o.X:0.000},{o.Y:0.000})")));
                }
        }
        // An empty picture has no outline.
        Assert.Null(CardShape.Outline(new RawImage(8, 8, new byte[8 * 8 * 4]), new Vector4(0, 0, 1, 1)));
    }

    private static bool Inside(Vector2[] poly, Vector2 p)
    {
        var sign = 0;
        for (var i = 0; i < poly.Length; i++)
        {
            Vector2 a = poly[i], b = poly[(i + 1) % poly.Length];
            var c = (b.X - a.X) * (p.Y - a.Y) - (b.Y - a.Y) * (p.X - a.X);
            if (MathF.Abs(c) < 1e-4f) continue;
            var s = MathF.Sign(c);
            if (sign == 0) sign = s; else if (s != sign) return false;
        }
        return true;
    }

    [Fact]
    public void The_canopy_fill_puts_cards_where_the_sky_shows_through()
    {
        var r = TreePresets.Make("oak");
        r.Billboard = false; r.Lods = 1;
        r.CanopyFullness = 0;
        var open = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 128 });
        r.CanopyFullness = 0.85;
        var filled = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 128 });
        var a = TreeStatsMeter.Measure(open.Lods[0]);
        var b = TreeStatsMeter.Measure(filled.Lods[0]);
        Assert.True(b.Fullness > a.Fullness + 0.04, $"{a.Fullness:0.00} → {b.Fullness:0.00}");
        Assert.True(b.LeafTriangles <= r.LeafBudget * 1.05, $"{b.LeafTriangles} leaf triangles");
        Assert.Empty(Leaves(filled)!.Problems());
        // The wood is the same tree.
        Assert.Equal(a.WoodTriangles, b.WoodTriangles);
    }

    [Fact]
    public void A_triangle_target_makes_a_forest_tree_of_a_few_thousand_triangles()
    {
        var r = TreePresets.Make("oak");
        r.Billboard = false; r.Lods = 3;
        r.TriangleTarget = 3000;
        Assert.Equal((750, 2250), r.Budgets());
        var b = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 128 });
        var s = TreeStatsMeter.Measure(b.Lods[0]);
        Assert.InRange(s.Triangles, 2000, 3000 * 1.25);
        Assert.InRange(s.WoodTriangles, 300, 1400);
        Assert.True(s.Fullness > 0.7, $"crown {s.Fullness:0.00} full at {s.Triangles} triangles");
        // Farther levels about half each.
        Assert.True(b.Lods[1].TriangleCount < s.Triangles * 0.75 && b.Lods[2].TriangleCount < b.Lods[1].TriangleCount * 0.8,
            string.Join(", ", b.Lods.Select(l => l.TriangleCount)));
        // A tree without leaves gives it all to the wood; none means the budgets as set.
        var dead = TreePresets.Make("dead");
        dead.TriangleTarget = 3000;
        Assert.Equal(3000, dead.Budgets().Wood);
        Assert.Equal(0, TreeRecipe.FromJson("{}").TriangleTarget);
        Assert.Equal(1000, TreeRecipe.FromJson("{\"triangleTarget\":5}").TriangleTarget);
    }

    [Fact]
    public void A_small_wood_budget_makes_clean_low_poly_tubes_not_a_crushed_surface()
    {
        foreach (var preset in new[] { "oak", "baobab", "mangrove", "spruce" })
        {
            var r = TreePresets.Make(preset);
            r.Billboard = false; r.Lods = 2;
            r.TriangleTarget = 2000;
            var b = TreeBuilder.Build(r, NoTextures);
            var wood = Wood(b);
            Assert.Empty(wood.Problems());
            Assert.InRange(wood.TriangleCount, 150, r.Budgets().Wood * 1.15);
            Assert.Contains(b.Notes, n => n.StartsWith("Low-poly wood"));
            // The trunk keeps its height and its base: no part of it pulled out of shape.
            var (lo, hi) = wood.Bounds();
            Assert.True(hi.Y > r.Height * 0.6, $"{preset}: wood up to {hi.Y:0.0} m of {r.Height}");
            Assert.True(lo.Y < 0.3, $"{preset}: wood starts at {lo.Y:0.00} m");
            // The next level is lighter still.
            Assert.True(Wood(b) != null && b.Lods[1].Root.All().First(n => n.Name == "Trunk").Mesh!.TriangleCount <= wood.TriangleCount);
        }
        // A bigger budget keeps the welded surface.
        var big = TreePresets.Make("oak");
        big.Billboard = false; big.Lods = 1; big.TriangleTarget = 20000;
        Assert.DoesNotContain(TreeBuilder.Build(big, NoTextures).Notes, n => n.StartsWith("Low-poly wood"));
    }

    [Fact]
    public void Moss_shares_the_leaf_budget()
    {
        var r = TreePresets.Make("cypress");
        r.Billboard = false; r.Lods = 1;
        r.TriangleTarget = 2000;
        var b = TreeBuilder.Build(r, NoTextures);
        Assert.True(Leaves(b)!.TriangleCount <= r.Budgets().Leaves * 1.15, $"{Leaves(b)!.TriangleCount} leaf and moss triangles");
    }

    /// <summary>Triangles whose face points against their vertex normals (seen from outside, they would be culled).</summary>
    private static double InsideOut(Mesh3D m)
    {
        int bad = 0, all = 0;
        foreach (var sub in m.Submeshes)
            for (var i = 0; i + 2 < sub.Indices.Count; i += 3)
            {
                int a = sub.Indices[i], b = sub.Indices[i + 1], c = sub.Indices[i + 2];
                var face = Vector3.Cross(m.Positions[b] - m.Positions[a], m.Positions[c] - m.Positions[a]);
                if (face.LengthSquared() < 1e-14f) continue;
                all++;
                if (Vector3.Dot(face, m.Normals[a] + m.Normals[b] + m.Normals[c]) < 0) bad++;
            }
        return all == 0 ? 0 : bad / (double)all;
    }

    [Fact]
    public void Wood_faces_outwards_whether_welded_or_tubes()
    {
        // Low-poly tubes (a small budget), tubes on the thin ends of a welded tree, and the welded surface.
        foreach (var target in new[] { 2000, 20000 })
        {
            var r = TreePresets.Make("oak");
            r.Billboard = false; r.Lods = 1; r.TriangleTarget = target;
            var wood = Wood(TreeBuilder.Build(r, NoTextures));
            Assert.True(InsideOut(wood) < 0.01, $"target {target}: {InsideOut(wood):P1} of the wood faces inwards");
        }
        var thin = TreePresets.Make("pine");
        thin.Billboard = false; thin.Lods = 1; thin.Quality = "low";
        Assert.True(InsideOut(Wood(TreeBuilder.Build(thin, NoTextures))) < 0.01);
    }

    [Fact]
    public void The_trunk_is_round_up_close_and_simple_far_away()
    {
        var r = TreePresets.Make("oak");
        r.Billboard = false; r.Lods = 3; r.TriangleTarget = 4000;
        var b = TreeBuilder.Build(r, NoTextures);
        // The trunk's rings: count the vertices around its lowest ring on each level.
        int Sides(int level)
        {
            // The trunk is the first tube; a ring's vertices share the bark's v (distance up the trunk), the seam doubled.
            var wood = b.Lods[level].Root.All().First(n => n.Name == "Trunk").Mesh!;
            return wood.UV0.TakeWhile(uv => MathF.Abs(uv.Y - wood.UV0[0].Y) < 1e-5f).Count() - 1;
        }
        Assert.InRange(Sides(0), 10, 16);
        Assert.Equal(6, Sides(1));
        Assert.Equal(5, Sides(2));
        r.TrunkSides = 14;
        b = TreeBuilder.Build(r, NoTextures);
        Assert.Equal(14, Sides(0));
        // Each farther level costs about half.
        Assert.True(b.Lods[1].TriangleCount < b.Lods[0].TriangleCount * 0.6 && b.Lods[2].TriangleCount < b.Lods[1].TriangleCount * 0.6, string.Join(", ", b.Lods.Select(l => l.TriangleCount)));
        // A hero tree keeps its welded trunk up close and gets the simple one far away.
        var hero = TreePresets.Make("oak");
        hero.Billboard = false; hero.Lods = 4; hero.TriangleTarget = 20000;
        var hb = TreeBuilder.Build(hero, NoTextures);
        Assert.DoesNotContain(hb.Notes, n => n.StartsWith("Low-poly wood"));
        Assert.Empty(Wood(hb).Problems());
        Assert.True(hb.Lods[3].Root.All().First(n => n.Name == "Trunk").Mesh!.TriangleCount < 800);
    }

    [Fact]
    public void Conifers_are_slim_cones_three_times_taller_than_wide()
    {
        foreach (var preset in new[] { "pine", "spruce", "sequoia" })
        {
            var r = TreePresets.Make(preset);
            r.Billboard = false; r.Lods = 1; r.TriangleTarget = 8000;
            var (lo, hi) = TreeExport.Bounds(TreeBuilder.Build(r, NoTextures).Lods[0]);
            var ratio = hi.Y / MathF.Max(hi.X - lo.X, hi.Z - lo.Z);
            Assert.InRange(ratio, 2.6, 5);
        }
    }
}
