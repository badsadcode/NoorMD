using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// The parts of fantasy trees that are not wood or leaves: mushroom caps (a turned profile with a spotted top and gills
/// underneath, from their own texture) and crystal shards (faceted, pointed, in clusters).
/// </summary>
public static class FantasyParts
{
    // The cap's profile from its top to the middle of its underside: (radius, height), as shares of its width.
    private static readonly (float R, float Z)[] CapProfile = [(0.4f, 0.52f), (0.72f, 0.36f), (0.94f, 0.16f), (1f, 0f), (0.8f, -0.12f), (0.35f, -0.25f), (0.06f, -0.3f)];
    private const float ApexZ = 0.6f, GillsFrom = 0.62f;

    /// <summary>
    /// A mushroom cap of <paramref name="width"/> metres sitting on <paramref name="top"/>, tilted a little towards
    /// <paramref name="dir"/>. UVs: around (u) and from the top's middle (v 0) over the rim to the underside's middle (v 1).
    /// </summary>
    public static void Cap(Mesh3D m, int material, Vector3 top, Vector3 dir, float width, int sides, Func<Vector3, Vector4> wind)
    {
        var up = Vector3.Normalize(Vector3.UnitY * 0.65f + (dir.LengthSquared() > 1e-8f ? Vector3.Normalize(dir) : Vector3.UnitY) * 0.35f);
        var a = Vector3.Normalize(Vector3.Cross(up, MathF.Abs(up.X) < 0.9f ? Vector3.UnitX : Vector3.UnitZ));
        var b = Vector3.Cross(up, a);
        var centre = top + up * width * 0.22f;
        var sub = m.Sub(material);
        var first = m.VertexCount;
        // Arc length down the profile, for v.
        var pts = new List<(float R, float Z)> { (0, ApexZ) };
        pts.AddRange(CapProfile);
        var length = new float[pts.Count];
        for (var i = 1; i < pts.Count; i++) length[i] = length[i - 1] + MathF.Sqrt(MathF.Pow(pts[i].R - pts[i - 1].R, 2) + MathF.Pow(pts[i].Z - pts[i - 1].Z, 2));
        Vector3 At(int i, int j)
        {
            var t = j / (float)sides * MathF.Tau;
            var wobble = 1 + 0.035f * MathF.Sin(t * 5 + width);
            return centre + (a * MathF.Cos(t) + b * MathF.Sin(t)) * pts[i].R * width * wobble + up * pts[i].Z * width;
        }
        var apex = m.AddVertex(centre + up * ApexZ * width, up, new Vector2(0.5f, 0), wind(centre));
        for (var i = 1; i < pts.Count; i++)
            for (var j = 0; j <= sides; j++)
            {
                var p = At(i, j);
                m.AddVertex(p, up, new Vector2(j / (float)sides, length[i] / length[^1]), wind(p));
            }
        int V(int i, int j) => first + 1 + (i - 1) * (sides + 1) + j;
        var tris = new List<int>();
        for (var j = 0; j < sides; j++) tris.AddRange([apex, V(1, j + 1), V(1, j)]);
        for (var i = 1; i + 1 < pts.Count; i++)
            for (var j = 0; j < sides; j++) tris.AddRange([V(i, j), V(i, j + 1), V(i + 1, j + 1), V(i, j), V(i + 1, j + 1), V(i + 1, j)]);
        // Outward: the volume seen from the centre must be positive.
        double vol = 0;
        for (var t = 0; t < tris.Count; t += 3)
            vol += Vector3.Dot(m.Positions[tris[t]] - centre, Vector3.Cross(m.Positions[tris[t + 1]] - centre, m.Positions[tris[t + 2]] - centre));
        if (vol < 0) for (var t = 0; t < tris.Count; t += 3) (tris[t + 1], tris[t + 2]) = (tris[t + 2], tris[t + 1]);
        sub.Indices.AddRange(tris);
        // Smooth normals from the cap's own faces, the same on both sides of the UV seam.
        var acc = new Dictionary<int, Vector3>();
        for (var t = 0; t < tris.Count; t += 3)
        {
            var n = Vector3.Cross(m.Positions[tris[t + 1]] - m.Positions[tris[t]], m.Positions[tris[t + 2]] - m.Positions[tris[t]]);
            for (var k = 0; k < 3; k++) acc[tris[t + k]] = acc.GetValueOrDefault(tris[t + k]) + n;
        }
        for (var i = 1; i < pts.Count; i++) { var s = acc[V(i, 0)] + acc[V(i, sides)]; acc[V(i, 0)] = acc[V(i, sides)] = s; }
        foreach (var (v, n) in acc) m.Normals[v] = n.LengthSquared() > 1e-20f ? Vector3.Normalize(n) : up;
    }

    /// <summary>The cap's texture: its colour, lighter towards the top, with round spots; pale gills underneath.</summary>
    public static byte[] CapTexture(string capHex, string spotHex, double spots, int seed, int size)
    {
        var cap = LeafAtlas.Hex(capHex);
        var spot = LeafAtlas.Hex(spotHex);
        var gill = Vector3.Lerp(spot, new Vector3(0.85f, 0.78f, 0.62f), 0.5f);
        var rng = new Random(seed);
        var dots = Enumerable.Range(0, (int)(spots * 38)).Select(_ => (U: (float)rng.NextDouble(), V: 0.06f + 0.48f * (float)rng.NextDouble(), R: 0.025f + 0.035f * (float)rng.NextDouble())).ToList();
        var px = new byte[size * size * 3];
        for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                float u = (x + 0.5f) / size, v = (y + 0.5f) / size;
                Vector3 c;
                if (v < GillsFrom)
                {
                    // Top: lighter at the crown, darker to the rim; spots squashed less near the rim (where u is wider).
                    c = cap * (1.25f - 0.45f * v / GillsFrom);
                    foreach (var (du, dv, r) in dots)
                    {
                        var dx = MathF.Abs(u - du); dx = MathF.Min(dx, 1 - dx);
                        var stretch = 0.35f + 1.6f * dv;
                        var d = MathF.Sqrt(MathF.Pow(dx * stretch, 2) + MathF.Pow(v - dv, 2));
                        if (d < r) c = Vector3.Lerp(c, spot * (1.05f - 0.25f * d / r), Math.Clamp((r - d) / (r * 0.25f), 0, 1));
                    }
                }
                else
                {
                    // Underside: gills fanning out from the stem.
                    var g = 0.5f + 0.5f * MathF.Sin(u * MathF.Tau * 48);
                    c = gill * (0.72f + 0.28f * g) * (0.8f + 0.2f * (1 - (v - GillsFrom) / (1 - GillsFrom)));
                }
                var i = (y * size + x) * 3;
                px[i] = B(c.X); px[i + 1] = B(c.Y); px[i + 2] = B(c.Z);
            }
        return PngWriter.Rgb(size, size, px);
        static byte B(float v) => (byte)Math.Clamp((int)MathF.Round(v * 255), 0, 255);
    }

    /// <summary>One crystal: a six-sided prism with a pointed tip, flat faces, its base buried at <paramref name="at"/>.</summary>
    public static void Shard(Mesh3D m, int material, Vector3 at, Vector3 axis, float length, Vector4 wind)
    {
        axis = Vector3.Normalize(axis);
        var a = Vector3.Normalize(Vector3.Cross(axis, MathF.Abs(axis.Y) < 0.9f ? Vector3.UnitY : Vector3.UnitX));
        var b = Vector3.Cross(axis, a);
        var r = length * 0.16f;
        var bodyTop = at + axis * length * 0.72f;
        var tip = at + axis * length;
        Vector3 Ring(Vector3 c, int k) { var t = k / 6f * MathF.Tau; return c + (a * MathF.Cos(t) + b * MathF.Sin(t)) * r; }
        var sub = m.Sub(material);
        void Face(Vector3 p0, Vector3 p1, Vector3 p2)
        {
            var n = Vector3.Cross(p1 - p0, p2 - p0);
            if (n.LengthSquared() < 1e-20f) return;
            n = Vector3.Normalize(n);
            var i0 = m.AddVertex(p0, n, new Vector2(0, 0), wind);
            var i1 = m.AddVertex(p1, n, new Vector2(1, 0), wind);
            var i2 = m.AddVertex(p2, n, new Vector2(0.5f, 1), wind);
            sub.Indices.AddRange([i0, i1, i2]);
        }
        for (var k = 0; k < 6; k++)
        {
            Vector3 b0 = Ring(at, k), b1 = Ring(at, k + 1), t0 = Ring(bodyTop, k), t1 = Ring(bodyTop, k + 1);
            Face(b0, b1, t1); Face(b0, t1, t0);
            Face(t0, t1, tip);
        }
    }
}
