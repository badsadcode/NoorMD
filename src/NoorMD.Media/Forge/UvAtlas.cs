using System.Numerics;

namespace NoorMD.Media.Forge;

/// <summary>
/// UVs to paint on: a texture set's own UVs if every triangle has its own place in the square (none missing, none
/// outside it, hardly any overlapping), else an automatic unwrap — triangles grouped into charts by the side they face
/// and by being joined, each chart laid flat by its side (true to size), the charts packed into the square.
/// </summary>
public static class UvAtlas
{
    private const int CheckRes = 256;

    /// <summary>Whether the set's UVs can be painted on as they are.</summary>
    public static bool Usable(ForgeSet s)
    {
        if (s.Uvs.Any(uv => !float.IsFinite(uv.X) || !float.IsFinite(uv.Y) || uv.X < -0.001f || uv.X > 1.001f || uv.Y < -0.001f || uv.Y > 1.001f)) return false;
        var hits = new byte[CheckRes * CheckRes];
        long covered = 0, twice = 0, flat = 0;
        for (var t = 0; t < s.TriangleCount; t++)
        {
            var (a, b, c) = (s.Uvs[t * 3] * CheckRes, s.Uvs[t * 3 + 1] * CheckRes, s.Uvs[t * 3 + 2] * CheckRes);
            if (MathF.Abs(Cross(b - a, c - a)) < 1e-6f) { flat++; continue; }
            Raster(a, b, c, CheckRes, CheckRes, (x, y, _, _, _) =>
            {
                var i = y * CheckRes + x;
                if (hits[i] == 0) covered++; else if (hits[i] == 1) twice++;
                if (hits[i] < 2) hits[i]++;
            });
        }
        // Some overlap is normal along seams at this coarse check; mirrored or stacked islands are much more.
        return covered > 0 && twice <= covered * 0.03 && flat <= s.TriangleCount * 0.05;
    }

    public static void Unwrap(ForgeSet s, float padding = 0.006f)
    {
        var n = s.TriangleCount;
        var axis = new int[n];
        for (var t = 0; t < n; t++)
        {
            var f = Vector3.Cross(s.Positions[t * 3 + 1] - s.Positions[t * 3], s.Positions[t * 3 + 2] - s.Positions[t * 3]);
            var ax = MathF.Abs(f.X) >= MathF.Abs(f.Y) && MathF.Abs(f.X) >= MathF.Abs(f.Z) ? 0 : MathF.Abs(f.Y) >= MathF.Abs(f.Z) ? 1 : 2;
            axis[t] = ax * 2 + (f[ax] < 0 ? 1 : 0);
        }
        // Charts: triangles facing the same side, joined along an edge.
        var parent = Enumerable.Range(0, n).ToArray();
        int Find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
        var edges = new Dictionary<(long, long), int>();
        static long Key(Vector3 p) => ((long)MathF.Round(p.X * 1e4f) * 73856093) ^ ((long)MathF.Round(p.Y * 1e4f) * 19349663) ^ ((long)MathF.Round(p.Z * 1e4f) * 83492791);
        for (var t = 0; t < n; t++)
            for (var k = 0; k < 3; k++)
            {
                long ka = Key(s.Positions[t * 3 + k]), kb = Key(s.Positions[t * 3 + (k + 1) % 3]);
                var e = ka < kb ? (ka, kb) : (kb, ka);
                if (edges.TryGetValue(e, out var o)) { if (axis[o] == axis[t]) parent[Find(o)] = Find(t); }
                else edges[e] = t;
            }
        var charts = Enumerable.Range(0, n).GroupBy(Find).Select(g => g.ToList()).ToList();
        // Each chart flat by its side, in metres.
        var flat = new Vector2[n * 3];
        var boxes = new List<(List<int> Tris, Vector2 Min, Vector2 Size)>();
        foreach (var chart in charts)
        {
            var min = new Vector2(float.MaxValue); var max = new Vector2(float.MinValue);
            foreach (var t in chart)
                for (var k = 0; k < 3; k++)
                {
                    var p = s.Positions[t * 3 + k];
                    var uv = axis[t] switch
                    {
                        0 => new Vector2(-p.Z, p.Y), 1 => new Vector2(p.Z, p.Y),
                        2 => new Vector2(p.X, -p.Z), 3 => new Vector2(p.X, p.Z),
                        4 => new Vector2(p.X, p.Y), _ => new Vector2(-p.X, p.Y),
                    };
                    flat[t * 3 + k] = uv;
                    min = Vector2.Min(min, uv); max = Vector2.Max(max, uv);
                }
            boxes.Add((chart, min, Vector2.Max(max - min, new Vector2(1e-6f))));
        }
        // Shelf packing into a square, the tallest charts first; a little room between them for bleeding.
        var total = boxes.Sum(b => b.Size.X * b.Size.Y);
        var side = MathF.Sqrt(total) * 1.15f;
        var biggest = boxes.Max(b => MathF.Max(b.Size.X, b.Size.Y));
        side = MathF.Max(side, biggest);
        var order = boxes.OrderByDescending(b => b.Size.Y).ToList();
        Vector2[] place;
        while (true)
        {
            var gap = side * padding;
            place = new Vector2[order.Count];
            float x = gap, y = gap, shelf = 0;
            for (var i = 0; i < order.Count; i++)
            {
                var sz = order[i].Size;
                if (x + sz.X + gap > side && x > gap) { x = gap; y += shelf + gap; shelf = 0; }
                place[i] = new Vector2(x, y);
                x += sz.X + gap; shelf = MathF.Max(shelf, sz.Y);
            }
            if (y + shelf + gap <= side) break;
            side *= 1.05f;
        }
        for (var i = 0; i < order.Count; i++)
        {
            var (tris, min, _) = order[i];
            foreach (var t in tris)
                for (var k = 0; k < 3; k++)
                {
                    var uv = (flat[t * 3 + k] - min + place[i]) / side;
                    s.Uvs[t * 3 + k] = new Vector2(uv.X, 1 - uv.Y);
                }
        }
    }

    private static float Cross(Vector2 a, Vector2 b) => a.X * b.Y - a.Y * b.X;

    /// <summary>
    /// Every texel whose centre is inside a triangle (pixel coordinates), with its barycentric weights: the texel's
    /// (x, y) and the weights of a, b and c.
    /// </summary>
    public static void Raster(Vector2 a, Vector2 b, Vector2 c, int w, int h, Action<int, int, float, float, float> texel)
    {
        var area = Cross(b - a, c - a);
        if (MathF.Abs(area) < 1e-9f) return;
        int x0 = Math.Max(0, (int)MathF.Floor(MathF.Min(a.X, MathF.Min(b.X, c.X)))), x1 = Math.Min(w - 1, (int)MathF.Ceiling(MathF.Max(a.X, MathF.Max(b.X, c.X))));
        int y0 = Math.Max(0, (int)MathF.Floor(MathF.Min(a.Y, MathF.Min(b.Y, c.Y)))), y1 = Math.Min(h - 1, (int)MathF.Ceiling(MathF.Max(a.Y, MathF.Max(b.Y, c.Y))));
        for (var y = y0; y <= y1; y++)
            for (var x = x0; x <= x1; x++)
            {
                var p = new Vector2(x + 0.5f, y + 0.5f);
                var wa = Cross(b - p, c - p) / area;
                var wb = Cross(c - p, a - p) / area;
                var wc = 1 - wa - wb;
                if (wa >= -1e-5f && wb >= -1e-5f && wc >= -1e-5f) texel(x, y, wa, wb, wc);
            }
    }
}
