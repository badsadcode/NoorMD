using System.Numerics;
using NoorMD.Media.Assets3D;
using Xunit;

namespace NoorMD.Media.Tests;

public class ImplicitFieldTests
{
    /// <summary>Signed volume (positive when triangles wind counter-clockwise seen from outside).</summary>
    internal static double Volume(Mesh3D m)
    {
        double v = 0;
        foreach (var s in m.Submeshes)
            for (var i = 0; i < s.Indices.Count; i += 3)
            {
                Vector3 a = m.Positions[s.Indices[i]], b = m.Positions[s.Indices[i + 1]], c = m.Positions[s.Indices[i + 2]];
                v += Vector3.Dot(a, Vector3.Cross(b, c)) / 6.0;
            }
        return v;
    }

    /// <summary>Closed and manifold: every directed edge appears once and its reverse once.</summary>
    internal static int OpenOrBadEdges(Mesh3D m)
    {
        var count = new Dictionary<(int, int), int>();
        foreach (var s in m.Submeshes)
            for (var i = 0; i < s.Indices.Count; i += 3)
                for (var e = 0; e < 3; e++)
                {
                    var key = (s.Indices[i + e], s.Indices[i + (e + 1) % 3]);
                    count[key] = count.GetValueOrDefault(key) + 1;
                }
        return count.Count(kv => kv.Value != 1 || count.GetValueOrDefault((kv.Key.Item2, kv.Key.Item1)) != 1);
    }

    internal static int Components(Mesh3D m)
    {
        var parent = Enumerable.Range(0, m.VertexCount).ToArray();
        int Find(int x) { while (parent[x] != x) x = parent[x] = parent[parent[x]]; return x; }
        foreach (var s in m.Submeshes)
            for (var i = 0; i < s.Indices.Count; i += 3)
            {
                parent[Find(s.Indices[i])] = Find(s.Indices[i + 1]);
                parent[Find(s.Indices[i + 1])] = Find(s.Indices[i + 2]);
            }
        return m.Submeshes.SelectMany(s => s.Indices).Select(Find).Distinct().Count();
    }

    [Fact]
    public void Round_cone_distance_is_exact_for_a_capsule()
    {
        var a = Vector3.Zero; var b = new Vector3(0, 2, 0);
        Assert.Equal(0.5f, ImplicitField.RoundCone(new Vector3(1, 1, 0), a, b, 0.5f, 0.5f), 4);
        Assert.Equal(0.5f, ImplicitField.RoundCone(new Vector3(0, 3, 0), a, b, 0.5f, 0.5f), 4);
        Assert.Equal(-0.5f, ImplicitField.RoundCone(new Vector3(0, 1, 0), a, b, 0.5f, 0.5f), 4);
        // Tapered: on the side halfway up, the radius is between the two.
        var d = ImplicitField.RoundCone(new Vector3(0.4f, 1, 0), a, b, 0.6f, 0.2f);
        Assert.InRange(d, -0.05f, 0.05f);
        Assert.True(ImplicitField.SmoothMin(1, 1, 0.5f) < 1);
        Assert.Equal(1, ImplicitField.SmoothMin(1, 3, 0.5f));
    }

    [Fact]
    public void A_sphere_comes_out_closed_round_and_outward_facing()
    {
        var field = new ImplicitField([new SdfSegment(Vector3.Zero, Vector3.Zero, 1, 1, 0, 0)], 0.1f);
        var m = field.Extract();
        Assert.Equal(0, OpenOrBadEdges(m));
        Assert.Equal(1, Components(m));
        var expected = 4 / 3.0 * Math.PI;
        Assert.InRange(Volume(m), expected * 0.97, expected * 1.01);
        Assert.All(m.Positions, p => Assert.InRange(p.Length(), 0.98f, 1.02f));
        field.FieldNormals(m);
        Assert.Equal(["UVs missing"], m.Problems());
        Assert.All(Enumerable.Range(0, m.VertexCount), v => Assert.True(Vector3.Dot(m.Normals[v], Vector3.Normalize(m.Positions[v])) > 0.99f));
    }

    [Fact]
    public void A_fork_is_one_welded_surface_with_a_collar()
    {
        var trunk = new SdfSegment(Vector3.Zero, new Vector3(0, 2, 0), 0.3f, 0.2f, 0, 0);
        var limb = new SdfSegment(new Vector3(0, 1.2f, 0), new Vector3(1.2f, 2.4f, 0), 0.14f, 0.08f, 0.15f, 1);
        var sharp = new ImplicitField([trunk, limb with { Blend = 0 }], 0.04f).Extract();
        var welded = new ImplicitField([trunk, limb], 0.04f).Extract();
        Assert.Equal(0, OpenOrBadEdges(welded));
        Assert.Equal(1, Components(welded));
        // The collar adds material where the limb leaves the trunk.
        Assert.True(Volume(welded) > Volume(sharp) * 1.005);

        // Owners: points on the limb's far end belong to the limb, on the base to the trunk.
        var field = new ImplicitField([trunk, limb], 0.04f);
        var owners = field.Owners(welded);
        for (var v = 0; v < welded.VertexCount; v++)
        {
            if (welded.Positions[v].X > 0.9f) Assert.Equal(1, owners[v]);
            if (welded.Positions[v].Y < 0.5f) Assert.Equal(0, owners[v]);
        }
    }

    [Fact]
    public void Separate_islands_stay_separate_and_negative_coordinates_work()
    {
        var field = new ImplicitField(
        [
            new SdfSegment(new Vector3(-3, -1, -2), new Vector3(-3, 1, -2), 0.3f, 0.3f, 0, 0),
            new SdfSegment(new Vector3(2, 0, 1), new Vector3(3, 0, 1), 0.25f, 0.15f, 0, 1),
        ], 0.05f);
        var m = field.Extract();
        Assert.Equal(0, OpenOrBadEdges(m));
        Assert.Equal(2, Components(m));
        var (lo, hi) = m.Bounds();
        Assert.InRange(lo.X, -3.32f, -3.28f);
        Assert.InRange(hi.X, 3.13f, 3.17f);
        Assert.True(Volume(m) > 0);
    }

    [Fact]
    public void Many_random_forks_stay_closed_and_manifold()
    {
        var rng = new Random(7);
        var segs = new List<SdfSegment> { new(Vector3.Zero, new Vector3(0, 3, 0), 0.25f, 0.15f, 0, 0) };
        for (var b = 1; b < 40; b++)
        {
            var parent = segs[rng.Next(segs.Count)];
            var t = (float)rng.NextDouble();
            var start = Vector3.Lerp(parent.A, parent.B, t);
            var r = (parent.Ra + (parent.Rb - parent.Ra) * t) * (0.4f + 0.4f * (float)rng.NextDouble());
            var dir = Vector3.Normalize(new Vector3((float)rng.NextDouble() - 0.5f, (float)rng.NextDouble() * 0.8f, (float)rng.NextDouble() - 0.5f));
            segs.Add(new SdfSegment(start, start + dir * (0.4f + (float)rng.NextDouble()), r, r * 0.6f, r * (float)rng.NextDouble(), b));
        }
        var m = new ImplicitField(segs, 0.03f).Extract();
        Assert.Equal(0, OpenOrBadEdges(m));
        Assert.True(Volume(m) > 0);
    }
}

public class SimplifierTests
{
    [Fact]
    public void A_sphere_simplifies_to_budget_keeping_shape_and_closure()
    {
        var m = new ImplicitField([new SdfSegment(Vector3.Zero, Vector3.Zero, 1, 1, 0, 0)], 0.05f).Extract();
        var before = m.TriangleCount;
        Assert.True(before > 5000);
        Simplifier.Simplify(m, 800);
        Assert.InRange(m.TriangleCount, 780, 800);
        Assert.Equal(0, ImplicitFieldTests.OpenOrBadEdges(m));
        Assert.All(m.Positions, p => Assert.InRange(p.Length(), 0.95f, 1.03f));
        var expected = 4 / 3.0 * Math.PI;
        Assert.InRange(ImplicitFieldTests.Volume(m), expected * 0.95, expected * 1.02);
        m.ComputeNormals();
        Assert.DoesNotContain("a normal is not unit length", m.Problems());
    }

    [Fact]
    public void A_tree_like_fork_simplifies_and_stays_manifold_and_one_piece()
    {
        var rng = new Random(3);
        var segs = new List<SdfSegment> { new(Vector3.Zero, new Vector3(0, 3, 0), 0.25f, 0.15f, 0, 0) };
        for (var b = 1; b < 30; b++)
        {
            var parent = segs[rng.Next(segs.Count)];
            var t = 0.2f + 0.8f * (float)rng.NextDouble();
            var start = Vector3.Lerp(parent.A, parent.B, t);
            var r = (parent.Ra + (parent.Rb - parent.Ra) * t) * 0.6f;
            var dir = Vector3.Normalize(new Vector3((float)rng.NextDouble() - 0.5f, 0.5f, (float)rng.NextDouble() - 0.5f));
            segs.Add(new SdfSegment(start, start + dir, r, r * 0.6f, r * 0.8f, b));
        }
        var m = new ImplicitField(segs, 0.025f).Extract();
        var comps = ImplicitFieldTests.Components(m);
        var vol = ImplicitFieldTests.Volume(m);
        Simplifier.Simplify(m, 3000);
        Assert.True(m.TriangleCount <= 3000);
        Assert.Equal(0, ImplicitFieldTests.OpenOrBadEdges(m));
        Assert.Equal(comps, ImplicitFieldTests.Components(m));
        Assert.InRange(ImplicitFieldTests.Volume(m), vol * 0.93, vol * 1.07);
    }

    [Fact]
    public void Open_borders_stay_in_place()
    {
        // A flat grid: the border is kept, the inside thins out.
        var m = new Mesh3D();
        var sub = m.Sub(0);
        const int n = 20;
        for (var y = 0; y <= n; y++) for (var x = 0; x <= n; x++) m.Positions.Add(new Vector3(x, 0, y));
        for (var y = 0; y < n; y++)
            for (var x = 0; x < n; x++)
            {
                var i = y * (n + 1) + x;
                sub.Indices.AddRange([i, i + n + 1, i + 1, i + 1, i + n + 1, i + n + 2]);
            }
        Simplifier.Simplify(m, 120);
        Assert.True(m.TriangleCount <= 120);
        var (lo, hi) = m.Bounds();
        Assert.Equal(new Vector3(0, 0, 0), lo);
        Assert.Equal(new Vector3(n, 0, n), hi);
        // Area unchanged (nothing folded or torn).
        double area = 0;
        foreach (var s in m.Submeshes)
            for (var i = 0; i < s.Indices.Count; i += 3)
                area += Vector3.Cross(m.Positions[s.Indices[i + 1]] - m.Positions[s.Indices[i]], m.Positions[s.Indices[i + 2]] - m.Positions[s.Indices[i]]).Length() / 2;
        Assert.InRange(area, n * n * 0.999, n * n * 1.001);
    }
}
