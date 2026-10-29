using System.Numerics;
using NoorMD.Media.Assets3D;
using Xunit;

namespace NoorMD.Media.Tests;

public class RockTests
{
    private static RockBuild Build(string preset, Action<RockRecipe>? change = null, int texture = 0)
    {
        var r = RockPresets.Make(preset);
        change?.Invoke(r);
        return RockBuilder.Build(r, new RockBuilder.Options { TextureSize = texture });
    }

    private static Mesh3D Surface(Asset3D level) => level.Root.Children.First(n => !n.Name.EndsWith("-convcolonly", StringComparison.Ordinal)).Mesh!;

    public static IEnumerable<object[]> Presets => RockPresets.All.Select(p => new object[] { p.Id });

    [Theory]
    [MemberData(nameof(Presets))]
    public void Every_preset_fits_its_budget_on_every_level_and_is_clean(string id)
    {
        var b = Build(id);
        var r = b.Recipe;
        Assert.Equal(r.Lods, b.Lods.Count);
        var drawn = b.Lods.Select(RockExport.Drawn).ToList();
        for (var i = 0; i < drawn.Count; i++)
        {
            Assert.True(drawn[i] <= r.LevelTriangles(i), $"{id} LOD{i}: {drawn[i]} triangles for a budget of {r.LevelTriangles(i)}");
            Assert.True(drawn[i] >= Math.Min(20, r.LevelTriangles(i) / 4), $"{id} LOD{i}: only {drawn[i]} triangles");
            if (i > 0) Assert.True(drawn[i] < drawn[i - 1], $"{id}: LOD{i} is not lighter than LOD{i - 1}");
            Assert.Empty(Surface(b.Lods[i]).Problems());
        }
        // Its size is what the kind says, give or take what the shape cuts away.
        Assert.InRange(b.Width, r.Size * 0.6, r.Size * 1.35);
    }

    [Fact]
    public void The_surface_is_closed_with_no_holes()
    {
        foreach (var id in new[] { "rock", "boulder", "outcrop", "stylized-boulder" })
        {
            var m = Surface(Build(id).Lods[0]);
            // Welded by position (normals and UVs split corners), every edge has exactly two triangles.
            var ids = new Dictionary<Vector3, int>();
            int Id(int v) { var p = m.Positions[v]; if (!ids.TryGetValue(p, out var i)) ids[p] = i = ids.Count; return i; }
            var edges = new Dictionary<(int, int), int>();
            foreach (var s in m.Submeshes)
                for (var t = 0; t < s.Indices.Count; t += 3)
                    for (var k = 0; k < 3; k++)
                    {
                        int a = Id(s.Indices[t + k]), c = Id(s.Indices[t + (k + 1) % 3]);
                        var e = a < c ? (a, c) : (c, a);
                        edges[e] = edges.GetValueOrDefault(e) + 1;
                    }
            Assert.True(edges.Values.All(n => n == 2), $"{id}: {edges.Values.Count(n => n != 2)} open or shared edges");
        }
    }

    [Fact]
    public void The_pivot_is_the_middle_of_the_ground_contact_and_the_base_sinks_in()
    {
        var b = Build("boulder", r => r.Sink = 0.2);
        var (lo, hi) = Surface(b.Lods[0]).Bounds();
        var h = hi.Y - lo.Y;
        Assert.Equal(-0.2f * h, lo.Y, 2);
        Assert.True(hi.Y > 0.6f * h);
        // The bottom's middle is under the pivot.
        var bottom = Surface(b.Lods[0]).Positions.Where(p => p.Y < lo.Y + h * 0.1f).ToList();
        var mid = bottom.Aggregate(Vector3.Zero, (s, p) => s + p) / bottom.Count;
        Assert.True(MathF.Abs(mid.X) < b.Width * 0.08f && MathF.Abs(mid.Z) < b.Width * 0.08f, $"bottom centred at {mid}");
    }

    [Fact]
    public void A_flat_base_sits_flat()
    {
        var m = Surface(Build("outcrop").Lods[0]);
        var (lo, hi) = m.Bounds();
        var h = hi.Y - lo.Y;
        // Many corners on the bottom plane, and faces there look straight down.
        var low = Enumerable.Range(0, m.VertexCount).Where(i => m.Positions[i].Y < lo.Y + h * 0.03f).ToList();
        Assert.True(low.Count > 10);
        Assert.True(low.Count(i => m.Normals[i].Y < -0.9f) > low.Count / 3);
    }

    [Fact]
    public void Collision_pieces_are_convex_small_named_for_godot_and_cover_the_rock()
    {
        var b = Build("outcrop");
        Assert.Equal(3, b.Collision.Count);
        var level = b.Lods[0];
        Assert.Equal(3, level.Root.Children.Count(n => n.Name.EndsWith("-convcolonly", StringComparison.Ordinal)));
        Assert.All(b.Lods.Skip(1), l => Assert.DoesNotContain(l.Root.All(), n => n.Name.Contains("convcol")));
        foreach (var hull in b.Collision)
        {
            Assert.InRange(hull.TriangleCount, 4, 64);
            // Convex: every corner is on or behind every face.
            var s = hull.Submeshes[0].Indices;
            for (var t = 0; t < s.Count; t += 3)
            {
                Vector3 a = hull.Positions[s[t]], c = hull.Positions[s[t + 1]], d = hull.Positions[s[t + 2]];
                var n = Vector3.Normalize(Vector3.Cross(c - a, d - a));
                Assert.All(hull.Positions, p => Assert.True(Vector3.Dot(p - a, n) < 1e-3f, "a corner in front of a face: not convex"));
            }
        }
        // Together they hold nearly all the rock (a point is covered when it is inside some piece, a little slack allowed).
        bool Inside(Mesh3D hull, Vector3 p)
        {
            var s = hull.Submeshes[0].Indices;
            for (var t = 0; t < s.Count; t += 3)
            {
                Vector3 a = hull.Positions[s[t]], c = hull.Positions[s[t + 1]], d = hull.Positions[s[t + 2]];
                if (Vector3.Dot(p - a, Vector3.Normalize(Vector3.Cross(c - a, d - a))) > b.Width * 0.03f) return false;
            }
            return true;
        }
        var pts = Surface(level).Positions;
        Assert.True(pts.Count(p => b.Collision.Any(h => Inside(h, p))) > pts.Count * 0.98, "the collision misses much of the rock");
        // …and not much more: the pieces stay within the rock's box, a little loosely.
        var (lo, hi) = Surface(level).Bounds();
        var slack = (hi - lo) * 0.12f;
        Assert.All(b.Collision.SelectMany(h => h.Positions), p => Assert.True(p.X > lo.X - slack.X && p.Y > lo.Y - slack.Y && p.Z > lo.Z - slack.Z && p.X < hi.X + slack.X && p.Y < hi.Y + slack.Y && p.Z < hi.Z + slack.Z, $"a collision corner far outside the rock at {p}"));
    }

    [Fact]
    public void The_same_seed_makes_the_same_rock_and_another_seed_another()
    {
        var a = GlbWriter.Write(Build("boulder").Lods[0]);
        var b = GlbWriter.Write(Build("boulder").Lods[0]);
        var c = GlbWriter.Write(Build("boulder", r => r.Seed = 2).Lods[0]);
        Assert.Equal(a, b);
        Assert.NotEqual(a, c);
    }

    [Fact]
    public void Snow_lies_on_top_in_its_own_material_and_moss_greens_the_upward_faces()
    {
        var snowy = Build("snowy-rock", texture: 64);
        var m = Surface(snowy.Lods[0]);
        Assert.Contains(snowy.Lods[0].Materials, x => x.Name == "Snow");
        var snow = m.Submeshes.Single(s => s.Material == 1).Indices;
        Assert.True(snow.Count > 0);
        Assert.True(snow.Average(i => m.Normals[i].Y) > 0.6);
        Assert.NotNull(snowy.Lods[0].Materials[0].BaseColorPng);

        var mossy = Surface(Build("mossy-boulder").Lods[0]);
        float Green(Func<Vector3, bool> where)
        {
            var c = Enumerable.Range(0, mossy.VertexCount).Where(i => where(mossy.Normals[i])).Select(i => mossy.Colors[i]).ToList();
            return c.Average(x => x.Y - (x.X + x.Z) / 2);
        }
        Assert.True(Green(n => n.Y > 0.8f) > Green(n => MathF.Abs(n.Y) < 0.3f) + 0.05f, "no moss on top");
    }

    [Fact]
    public void Stylized_rocks_are_faceted_and_lighter()
    {
        var b = Build("stylized-boulder");
        var m = Surface(b.Lods[0]);
        var s = m.Submeshes[0].Indices;
        for (var t = 0; t < s.Count; t += 3)
        {
            var n = Vector3.Normalize(Vector3.Cross(m.Positions[s[t + 1]] - m.Positions[s[t]], m.Positions[s[t + 2]] - m.Positions[s[t]]));
            for (var k = 0; k < 3; k++) Assert.True(Vector3.Dot(n, m.Normals[s[t + k]]) > 0.999f, "a smooth normal on a stylized rock");
        }
        Assert.True(RockExport.Drawn(b.Lods[0]) <= RockRecipe.Budget("boulder") / 3);
    }

    [Fact]
    public void A_scree_patch_is_many_stones_on_the_ground_with_no_collision()
    {
        var b = Build("scree");
        Assert.Empty(b.Collision);
        var m = Surface(b.Lods[0]);
        // Separate stones: count the pieces by connected corners.
        var parent = Enumerable.Range(0, m.VertexCount).ToArray();
        int Find(int x) => parent[x] == x ? x : parent[x] = Find(parent[x]);
        var at = new Dictionary<Vector3, int>();
        for (var i = 0; i < m.VertexCount; i++) { if (at.TryGetValue(m.Positions[i], out var j)) parent[Find(i)] = Find(j); else at[m.Positions[i]] = i; }
        foreach (var s in m.Submeshes) for (var t = 0; t < s.Indices.Count; t += 3) { parent[Find(s.Indices[t + 1])] = Find(s.Indices[t]); parent[Find(s.Indices[t + 2])] = Find(s.Indices[t]); }
        var stones = Enumerable.Range(0, m.VertexCount).Select(Find).Distinct().Count();
        Assert.InRange(stones, 20, b.Recipe.Stones);
        var (lo, hi) = m.Bounds();
        Assert.True(lo.Y < 0 && hi.Y < 0.3f, "the stones lie on the ground");
        Assert.InRange(MathF.Max(hi.X - lo.X, hi.Z - lo.Z), 1.5f, 3.5f);
        // The far levels leave out the small stones.
        Assert.True(RockExport.Drawn(b.Lods[2]) < RockExport.Drawn(b.Lods[0]) / 3);
    }

    [Fact]
    public void One_file_tags_the_levels_and_says_it_is_a_rock()
    {
        var b = Build("boulder", texture: 64);
        var (json, _) = GlbWriterTests.Parse(GlbWriter.Write(RockExport.OneFile(b)));
        var nodes = json.GetProperty("nodes").EnumerateArray().ToList();
        var root = nodes[json.GetProperty("scenes")[0].GetProperty("nodes")[0].GetInt32()];
        Assert.Equal(1, root.GetProperty("extras").GetProperty("noor_rock").GetInt32());
        Assert.Equal("boulder", root.GetProperty("extras").GetProperty("noor_kind").GetString());
        var levels = nodes.Where(n => n.TryGetProperty("extras", out var e) && e.TryGetProperty("noor_lod", out _)).ToList();
        Assert.Equal(["Boulder_LOD0", "Boulder_LOD1", "Boulder_LOD2"], levels.Select(n => n.GetProperty("name").GetString()));
        Assert.Contains(nodes, n => n.GetProperty("name").GetString() == "Collision-convcolonly");
        var to = levels.Select(n => n.GetProperty("extras").GetProperty("noor_visible_to").GetSingle()).ToList();
        Assert.True(to[0] > 0 && to[1] > to[0] && to[2] == 0);
    }

    [Fact]
    public void Recipes_round_trip_and_odd_values_are_made_safe()
    {
        var r = RockPresets.Make("outcrop");
        Assert.Equal(r.ToJson(), RockRecipe.FromJson(r.ToJson()).ToJson());
        var odd = RockRecipe.FromJson("""{"kind":"mountain","style":"cubist","size":1e9,"height":-4,"fractures":99,"material":"../../x","color":"red","lods":9,"lodTriangles":[5,2000000,10,10],"collisionPieces":40,"snow":"NaN"}""".Replace("\"NaN\"", "2"));
        Assert.Equal("rock", odd.Kind);
        Assert.Equal("realistic", odd.Style);
        Assert.Equal(80, odd.Size);
        Assert.Equal(0.1, odd.Height);
        Assert.Equal(12, odd.Fractures);
        Assert.Equal("", odd.Material);
        Assert.Equal("#8a8580", odd.Color);
        Assert.Equal(3, odd.Lods);
        Assert.Equal([8, 100_000, 10], odd.LodTriangles);
        Assert.Equal(8, odd.CollisionPieces);
        Assert.Equal(1, odd.Snow);
    }

    [Fact]
    public void A_variety_pack_keeps_the_first_and_varies_the_rest()
    {
        var r = RockPresets.Make("boulder");
        var pack = RockVariants.Make(r, 4, 0.2);
        Assert.Equal(4, pack.Count);
        Assert.Equal(r.Seed, pack[0].Seed);
        Assert.Equal(r.Size, pack[0].Size);
        Assert.Equal(4, pack.Select(p => p.Seed).Distinct().Count());
        Assert.All(pack, p => Assert.InRange(p.Size, r.Size * 0.8 - 1e-9, r.Size * 1.2 + 1e-9));
        Assert.Equal("Boulder 03", pack[2].Name);
    }

    [Fact]
    public void Rock_materials_are_texture_recipes_in_the_rocks_colour()
    {
        foreach (var id in RockTextures.Ids)
        {
            var t = RockTextures.For(id, "#806040");
            Assert.NotNull(t);
            var maps = TextureEngine.Render(t!, 64);
            Assert.Equal(64 * 64 * 3, maps.Albedo.Length);
        }
        Assert.Null(RockTextures.For("stone-rock", "#806040"));
    }
}
