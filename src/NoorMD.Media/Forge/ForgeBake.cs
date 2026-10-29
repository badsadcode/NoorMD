using System.Numerics;

namespace NoorMD.Media.Forge;

/// <summary>
/// The mesh maps of a texture set, in its UV space: for every texel the surface's position and normal (world space),
/// its tangent frame, which part it is, its ambient occlusion and its curvature — what the smart masks read.
/// </summary>
public sealed class ForgeBake
{
    public required int Size { get; init; }
    /// <summary>1 where a triangle covers the texel.</summary>
    public required byte[] Covered { get; init; }
    public required Vector3[] Position { get; init; }
    public required Vector3[] Normal { get; init; }
    public required Vector3[] Tangent { get; init; }
    public required Vector3[] Bitangent { get; init; }
    public required int[] Part { get; init; }
    /// <summary>0 (hidden) … 1 (open sky).</summary>
    public required float[] Ao { get; init; }
    /// <summary>−1 (a crease, concave) … 0 (flat) … 1 (an edge, convex).</summary>
    public required float[] Curvature { get; init; }
    public required Vector3 BoundsMin { get; init; }
    public required Vector3 BoundsMax { get; init; }

    /// <param name="EdgeWidth">How wide worn edges and creases are, as a share of the model's size.</param>
    public sealed record Settings(int AoRays = 24, float AoDistance = 0.25f, float CurvatureStrength = 1, float EdgeWidth = 0.02f);

    public static ForgeBake Bake(ForgeModel model, int setIndex, int size, Settings? settings = null)
    {
        settings ??= new Settings();
        var set = model.Sets[setIndex];
        var n = size * size;
        var covered = new byte[n];
        var pos = new Vector3[n]; var nrm = new Vector3[n]; var tan = new Vector3[n]; var bit = new Vector3[n];
        var part = new int[n];
        var curvTex = new float[n];
        var vertexCurv = Curvatures(model, settings.CurvatureStrength);
        for (var t = 0; t < set.TriangleCount; t++)
        {
            Vector3 p0 = set.Positions[t * 3], p1 = set.Positions[t * 3 + 1], p2 = set.Positions[t * 3 + 2];
            Vector3 n0 = set.Normals[t * 3], n1 = set.Normals[t * 3 + 1], n2 = set.Normals[t * 3 + 2];
            Vector2 u0 = set.Uvs[t * 3], u1 = set.Uvs[t * 3 + 1], u2 = set.Uvs[t * 3 + 2];
            float c0 = vertexCurv[Key(p0)], c1 = vertexCurv[Key(p1)], c2 = vertexCurv[Key(p2)];
            // The tangent frame from how the UVs run over the triangle (u along the tangent, v along the bitangent).
            var e1 = p1 - p0; var e2 = p2 - p0; var d1 = u1 - u0; var d2 = u2 - u0;
            var r = d1.X * d2.Y - d2.X * d1.Y;
            var T = MathF.Abs(r) > 1e-12f ? (e1 * d2.Y - e2 * d1.Y) / r : Vector3.UnitX;
            var B = MathF.Abs(r) > 1e-12f ? (e2 * d1.X - e1 * d2.X) / r : Vector3.UnitZ;
            var part0 = set.Parts[t];
            // UV v runs up the picture: row 0 is v = 1.
            UvAtlas.Raster(new Vector2(u0.X * size, (1 - u0.Y) * size), new Vector2(u1.X * size, (1 - u1.Y) * size), new Vector2(u2.X * size, (1 - u2.Y) * size), size, size, (x, y, wa, wb, wc) =>
            {
                var i = y * size + x;
                covered[i] = 1;
                pos[i] = p0 * wa + p1 * wb + p2 * wc;
                var nn = Vector3.Normalize(n0 * wa + n1 * wb + n2 * wc);
                nrm[i] = nn;
                // Gram-Schmidt: the tangent at right angles to the normal, the bitangent keeping its side.
                var tt = T - nn * Vector3.Dot(nn, T);
                tt = tt.LengthSquared() > 1e-12f ? Vector3.Normalize(tt) : Vector3.Normalize(Vector3.Cross(nn, MathF.Abs(nn.Y) < 0.9f ? Vector3.UnitY : Vector3.UnitX));
                var bb = Vector3.Cross(nn, tt) * (Vector3.Dot(Vector3.Cross(nn, tt), B) < 0 ? -1 : 1);
                tan[i] = tt; bit[i] = bb;
                part[i] = part0;
                curvTex[i] = c0 * wa + c1 * wb + c2 * wc;
            });
        }
        var (min, max) = model.Bounds();
        SharpEdges(model, covered, pos, curvTex, (max - min).Length() * settings.EdgeWidth, settings.CurvatureStrength);
        var ao = AmbientOcclusion(model, covered, pos, nrm, settings, (max - min).Length());
        return new ForgeBake { Size = size, Covered = covered, Position = pos, Normal = nrm, Tangent = tan, Bitangent = bit, Part = part, Ao = ao, Curvature = curvTex, BoundsMin = min, BoundsMax = max };
    }

    private static (int, int, int) Key(Vector3 p) => ((int)MathF.Round(p.X * 1e4f), (int)MathF.Round(p.Y * 1e4f), (int)MathF.Round(p.Z * 1e4f));

    /// <summary>
    /// Curvature at each point of the model (by position, so hard edges and seams count as joined): how the normals of
    /// its neighbours turn away (convex) or towards it (concave), scaled to the model's size and squashed into −1…1.
    /// </summary>
    private static Dictionary<(int, int, int), float> Curvatures(ForgeModel model, float strength)
    {
        var pos = new Dictionary<(int, int, int), Vector3>();
        var nrm = new Dictionary<(int, int, int), Vector3>();
        var nb = new Dictionary<(int, int, int), HashSet<(int, int, int)>>();
        foreach (var s in model.Sets)
            for (var t = 0; t < s.TriangleCount; t++)
            {
                // The face's own normal, area-weighted: a sharp edge's two sides both count at its points.
                var f = Vector3.Cross(s.Positions[t * 3 + 1] - s.Positions[t * 3], s.Positions[t * 3 + 2] - s.Positions[t * 3]);
                for (var k = 0; k < 3; k++)
                {
                    var key = Key(s.Positions[t * 3 + k]);
                    pos[key] = s.Positions[t * 3 + k];
                    nrm[key] = nrm.GetValueOrDefault(key) + f;
                    if (!nb.TryGetValue(key, out var set)) nb[key] = set = [];
                    set.Add(Key(s.Positions[t * 3 + (k + 1) % 3])); set.Add(Key(s.Positions[t * 3 + (k + 2) % 3]));
                }
            }
        var (min, max) = model.Bounds();
        var scale = MathF.Max(1e-4f, (max - min).Length()) * 0.02f * strength;
        var curv = new Dictionary<(int, int, int), float>(pos.Count);
        foreach (var (key, p) in pos)
        {
            var ni = nrm[key].LengthSquared() > 0 ? Vector3.Normalize(nrm[key]) : Vector3.UnitY;
            double sum = 0; var count = 0;
            foreach (var o in nb[key])
            {
                var d = pos[o] - p;
                var l2 = d.LengthSquared();
                if (l2 < 1e-12f) continue;
                var nj = nrm[o].LengthSquared() > 0 ? Vector3.Normalize(nrm[o]) : ni;
                sum += Vector3.Dot(nj - ni, d) / l2;
                count++;
            }
            curv[key] = count == 0 ? 0 : MathF.Tanh((float)(sum / count) * scale);
        }
        return curv;
    }

    /// <summary>
    /// Sharp edges and creases (where two faces meet at an angle) marked in the texels near them: convex edges up to 1,
    /// creases down to −1, fading over <paramref name="width"/>. A low-poly model's curvature lives here, not in its
    /// few points.
    /// </summary>
    private static void SharpEdges(ForgeModel model, byte[] covered, Vector3[] pos, float[] curv, float width, float strength)
    {
        if (width <= 0) return;
        var faces = new Dictionary<((int, int, int), (int, int, int)), List<(Vector3 N, Vector3 C)>>();
        foreach (var s in model.Sets)
            for (var t = 0; t < s.TriangleCount; t++)
            {
                Vector3 a = s.Positions[t * 3], b = s.Positions[t * 3 + 1], c = s.Positions[t * 3 + 2];
                var f = Vector3.Cross(b - a, c - a);
                if (f.LengthSquared() < 1e-20f) continue;
                var n = Vector3.Normalize(f);
                var centre = (a + b + c) / 3;
                foreach (var (p, q) in new[] { (a, b), (b, c), (c, a) })
                {
                    var (kp, kq) = (Key(p), Key(q));
                    var key = kp.CompareTo(kq) < 0 ? (kp, kq) : (kq, kp);
                    if (!faces.TryGetValue(key, out var list)) faces[key] = list = [];
                    list.Add((n, centre));
                }
            }
        // Edges with two faces at an angle: convex when each face's centre lies below the other's plane.
        var edges = new List<(Vector3 A, Vector3 B, float Sign)>();
        var points = new Dictionary<(int, int, int), Vector3>();
        foreach (var s in model.Sets) foreach (var p in s.Positions) points[Key(p)] = p;
        foreach (var ((ka, kb), list) in faces)
        {
            if (list.Count != 2) continue;
            var (n1, c1) = list[0]; var (n2, c2) = list[1];
            var cos = Vector3.Dot(n1, n2);
            if (cos > 0.94f) continue; // under about 20°: smooth, not an edge
            var weight = MathF.Min(1, MathF.Acos(Math.Clamp(cos, -1, 1)) / (MathF.PI / 2));
            var convex = Vector3.Dot(c2 - c1, n1) < 0;
            edges.Add((points[ka], points[kb], (convex ? 1 : -1) * weight * strength));
        }
        if (edges.Count == 0) return;
        // A grid of cells as wide as the band, so each texel looks at the edges near it only.
        var grid = new Dictionary<(int, int, int), List<int>>();
        (int, int, int) Cell(Vector3 p) => ((int)MathF.Floor(p.X / width), (int)MathF.Floor(p.Y / width), (int)MathF.Floor(p.Z / width));
        for (var e = 0; e < edges.Count; e++)
        {
            var (a, b, _) = edges[e];
            var (lo, hi) = (Cell(Vector3.Min(a, b) - new Vector3(width)), Cell(Vector3.Max(a, b) + new Vector3(width)));
            if ((long)(hi.Item1 - lo.Item1 + 1) * (hi.Item2 - lo.Item2 + 1) * (hi.Item3 - lo.Item3 + 1) > 200_000) continue; // a very long edge on a tiny band
            for (var x = lo.Item1; x <= hi.Item1; x++)
                for (var y = lo.Item2; y <= hi.Item2; y++)
                    for (var z = lo.Item3; z <= hi.Item3; z++)
                    {
                        if (!grid.TryGetValue((x, y, z), out var l)) grid[(x, y, z)] = l = [];
                        l.Add(e);
                    }
        }
        Parallel.For(0, covered.Length, i =>
        {
            if (covered[i] == 0 || !grid.TryGetValue(Cell(pos[i]), out var near)) return;
            var best = 0f;
            foreach (var e in near)
            {
                var (a, b, sign) = edges[e];
                var ab = b - a;
                var t = Math.Clamp(Vector3.Dot(pos[i] - a, ab) / MathF.Max(1e-12f, ab.LengthSquared()), 0, 1);
                var d = Vector3.Distance(pos[i], a + ab * t);
                if (d >= width) continue;
                var v = sign * (1 - d / width) * (1 - d / width);
                if (MathF.Abs(v) > MathF.Abs(best)) best = v;
            }
            if (MathF.Abs(best) > MathF.Abs(curv[i])) curv[i] = Math.Clamp(best, -1, 1);
        });
    }

    // ------------------------------------------------------------------ ambient occlusion

    private static float[] AmbientOcclusion(ForgeModel model, byte[] covered, Vector3[] pos, Vector3[] nrm, Settings s, float diagonal)
    {
        var ao = new float[covered.Length];
        if (s.AoRays <= 0) { Array.Fill(ao, 1f); return ao; }
        var bvh = new Bvh(model);
        var reach = diagonal * s.AoDistance;
        var eps = diagonal * 1e-4f;
        Parallel.For(0, covered.Length, i =>
        {
            if (covered[i] == 0) { ao[i] = 1; return; }
            var n = nrm[i];
            var t = Vector3.Normalize(Vector3.Cross(n, MathF.Abs(n.Y) < 0.9f ? Vector3.UnitY : Vector3.UnitX));
            var b = Vector3.Cross(n, t);
            var origin = pos[i] + n * eps * 4;
            // Cosine-weighted directions, the pattern turned per texel (no banding).
            var spin = (i * 0.618034f) % 1f * MathF.Tau;
            var open = 0f;
            for (var k = 0; k < s.AoRays; k++)
            {
                var u = (k + 0.5f) / s.AoRays;
                var r = MathF.Sqrt(u);
                var phi = k * 2.39996323f + spin;
                var dir = t * (r * MathF.Cos(phi)) + b * (r * MathF.Sin(phi)) + n * MathF.Sqrt(1 - u);
                var hit = bvh.Hit(origin, dir, reach);
                // Close hits darken most; something far away barely.
                open += hit < 0 ? 1 : MathF.Min(1, hit / reach);
            }
            ao[i] = open / s.AoRays;
        });
        return ao;
    }

    /// <summary>A bounding-volume hierarchy over every triangle of the model, for casting rays.</summary>
    private sealed class Bvh
    {
        private readonly Vector3[] _a, _b, _c;
        private readonly int[] _tri;
        private readonly List<(Vector3 Min, Vector3 Max, int Left, int Right, int First, int Count)> _nodes = [];

        public Bvh(ForgeModel m)
        {
            var all = m.Sets.SelectMany(s => Enumerable.Range(0, s.TriangleCount).Select(t => (s.Positions[t * 3], s.Positions[t * 3 + 1], s.Positions[t * 3 + 2]))).ToArray();
            _a = all.Select(x => x.Item1).ToArray(); _b = all.Select(x => x.Item2).ToArray(); _c = all.Select(x => x.Item3).ToArray();
            _tri = Enumerable.Range(0, all.Length).ToArray();
            var centres = all.Select(x => (x.Item1 + x.Item2 + x.Item3) / 3).ToArray();
            Build(0, _tri.Length, centres);
        }

        private int Build(int first, int count, Vector3[] centres)
        {
            var min = new Vector3(float.MaxValue); var max = new Vector3(float.MinValue);
            for (var i = first; i < first + count; i++) { var t = _tri[i]; min = Vector3.Min(min, Vector3.Min(_a[t], Vector3.Min(_b[t], _c[t]))); max = Vector3.Max(max, Vector3.Max(_a[t], Vector3.Max(_b[t], _c[t]))); }
            var index = _nodes.Count;
            _nodes.Add((min, max, -1, -1, first, count));
            if (count <= 4) return index;
            var size = max - min;
            var axis = size.X >= size.Y && size.X >= size.Z ? 0 : size.Y >= size.Z ? 1 : 2;
            Array.Sort(_tri, first, count, Comparer<int>.Create((x, y) => centres[x][axis].CompareTo(centres[y][axis])));
            var half = count / 2;
            var left = Build(first, half, centres);
            var right = Build(first + half, count - half, centres);
            _nodes[index] = (min, max, left, right, first, 0);
            return index;
        }

        /// <summary>The distance to the nearest triangle along the ray, within <paramref name="reach"/>, or −1.</summary>
        public float Hit(Vector3 o, Vector3 d, float reach)
        {
            var inv = new Vector3(1 / d.X, 1 / d.Y, 1 / d.Z);
            var best = reach;
            var found = false;
            Span<int> stack = stackalloc int[64];
            var sp = 0;
            stack[sp++] = 0;
            while (sp > 0)
            {
                var (min, max, left, right, first, count) = _nodes[stack[--sp]];
                var t1 = (min - o) * inv; var t2 = (max - o) * inv;
                var tn = Vector3.Min(t1, t2); var tf = Vector3.Max(t1, t2);
                var near = MathF.Max(MathF.Max(tn.X, tn.Y), tn.Z); var far = MathF.Min(MathF.Min(tf.X, tf.Y), tf.Z);
                if (far < MathF.Max(0, near) || near > best) continue;
                if (count > 0)
                {
                    for (var i = first; i < first + count; i++)
                    {
                        var t = Intersect(o, d, _a[_tri[i]], _b[_tri[i]], _c[_tri[i]]);
                        if (t > 0 && t < best) { best = t; found = true; }
                    }
                }
                else if (sp < 62) { stack[sp++] = left; stack[sp++] = right; }
            }
            return found ? best : -1;
        }

        private static float Intersect(Vector3 o, Vector3 d, Vector3 a, Vector3 b, Vector3 c)
        {
            var e1 = b - a; var e2 = c - a;
            var p = Vector3.Cross(d, e2);
            var det = Vector3.Dot(e1, p);
            if (MathF.Abs(det) < 1e-12f) return -1;
            var inv = 1 / det;
            var s = o - a;
            var u = Vector3.Dot(s, p) * inv;
            if (u < 0 || u > 1) return -1;
            var q = Vector3.Cross(s, e1);
            var v = Vector3.Dot(d, q) * inv;
            if (v < 0 || u + v > 1) return -1;
            return Vector3.Dot(e2, q) * inv;
        }
    }
}
