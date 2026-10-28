using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// The farthest level of detail: the tree drawn from the front and from the side (a small CPU renderer: orthographic,
/// depth-tested, textured, alpha-cut leaves, the painted shading and a soft sun), put on two crossed cards. A whole
/// tree for eight triangles.
/// </summary>
public static class Billboard
{
    /// <summary>Renders <paramref name="views"/> sides of the asset into one atlas, one cell each, side by side.</summary>
    public static (RawImage Atlas, float HalfWidth, float Height) Render(Asset3D asset, int views, int cellHeight)
    {
        var tris = Triangles(asset);
        var halfWidth = 0.1f;
        var height = 0.1f;
        foreach (var t in tris)
            foreach (var p in new[] { t.A, t.B, t.C })
            {
                halfWidth = MathF.Max(halfWidth, MathF.Max(MathF.Abs(p.X), MathF.Abs(p.Z)));
                height = MathF.Max(height, p.Y);
            }
        var cellWidth = Math.Max(16, (int)MathF.Round(cellHeight * 2 * halfWidth / height));
        var width = cellWidth * views;
        var rgba = new float[width * cellHeight * 4];
        var depth = new float[width * cellHeight];
        var sun = Vector3.Normalize(new Vector3(0.45f, 0.8f, 0.4f));
        for (var view = 0; view < views; view++)
        {
            var angle = MathF.PI * view / views;
            var right = new Vector3(MathF.Cos(angle), 0, -MathF.Sin(angle));
            var toward = new Vector3(MathF.Sin(angle), 0, MathF.Cos(angle));     // from the tree to the camera
            Array.Fill(depth, float.MaxValue, 0, depth.Length);
            var x0 = view * cellWidth;
            Vector3 Screen(Vector3 p) => new(x0 + (Vector3.Dot(p, right) / halfWidth * 0.5f + 0.5f) * cellWidth, (1 - p.Y / height) * cellHeight, -Vector3.Dot(p, toward));
            foreach (var t in tris)
            {
                Vector3 a = Screen(t.A), b = Screen(t.B), c = Screen(t.C);
                var area = (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
                if (MathF.Abs(area) < 1e-9f) continue;
                int minX = Math.Max(x0, (int)MathF.Floor(MathF.Min(a.X, MathF.Min(b.X, c.X)))), maxX = Math.Min(x0 + cellWidth - 1, (int)MathF.Ceiling(MathF.Max(a.X, MathF.Max(b.X, c.X))));
                int minY = Math.Max(0, (int)MathF.Floor(MathF.Min(a.Y, MathF.Min(b.Y, c.Y)))), maxY = Math.Min(cellHeight - 1, (int)MathF.Ceiling(MathF.Max(a.Y, MathF.Max(b.Y, c.Y))));
                for (var y = minY; y <= maxY; y++)
                    for (var x = minX; x <= maxX; x++)
                    {
                        float px = x + 0.5f, py = y + 0.5f;
                        var w0 = ((b.X - px) * (c.Y - py) - (b.Y - py) * (c.X - px)) / area;
                        var w1 = ((c.X - px) * (a.Y - py) - (c.Y - py) * (a.X - px)) / area;
                        var w2 = 1 - w0 - w1;
                        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                        var z = a.Z * w0 + b.Z * w1 + c.Z * w2;
                        var di = y * width + x;
                        if (z >= depth[di]) continue;
                        var uv = t.Ua * w0 + t.Ub * w1 + t.Uc * w2;
                        var texel = Sample(t.Mat.BaseColorPixels, uv);
                        if (t.Mat.Alpha == "mask" && texel.W < t.Mat.AlphaCutoff) continue;
                        depth[di] = z;
                        var n = Vector3.Normalize(t.Na * w0 + t.Nb * w1 + t.Nc * w2);
                        if (Vector3.Dot(n, toward) < 0 && t.Mat.Alpha == "mask") n = -n;
                        var shade = t.Ca * w0 + t.Cb * w1 + t.Cc * w2;
                        var baseColor = new Vector3(Srgb(t.Mat.BaseColor.X), Srgb(t.Mat.BaseColor.Y), Srgb(t.Mat.BaseColor.Z));
                        var lit = 0.55f + 0.5f * MathF.Max(0, Vector3.Dot(n, sun)) + (t.Mat.Alpha == "mask" ? 0.12f : 0);
                        var colour = new Vector3(texel.X, texel.Y, texel.Z) * baseColor * new Vector3(shade.X, shade.Y, shade.Z) * lit + t.Mat.Emissive;
                        var o = di * 4;
                        rgba[o] = colour.X; rgba[o + 1] = colour.Y; rgba[o + 2] = colour.Z; rgba[o + 3] = 1;
                    }
            }
        }
        // Colour bleeds into the transparent pixels around the tree, so filtering and mipmaps keep no dark halo.
        var bytes = new byte[width * cellHeight * 4];
        var fill = Average(rgba);
        for (var i = 0; i < width * cellHeight; i++)
        {
            var on = rgba[i * 4 + 3] > 0;
            bytes[i * 4] = B(on ? rgba[i * 4] : fill.X);
            bytes[i * 4 + 1] = B(on ? rgba[i * 4 + 1] : fill.Y);
            bytes[i * 4 + 2] = B(on ? rgba[i * 4 + 2] : fill.Z);
            bytes[i * 4 + 3] = on ? (byte)255 : (byte)0;
        }
        return (new RawImage(width, cellHeight, bytes), halfWidth, height);
    }

    /// <summary>The crossed cards: one per view, each showing its cell, with a front and a back.</summary>
    public static Mesh3D Cards(int views, float halfWidth, float height, int material, bool wind)
    {
        var m = new Mesh3D { Name = "Billboard" };
        var sub = m.Sub(material);
        for (var view = 0; view < views; view++)
        {
            var angle = MathF.PI * view / views;
            var right = new Vector3(MathF.Cos(angle), 0, -MathF.Sin(angle));
            var toward = new Vector3(MathF.Sin(angle), 0, MathF.Cos(angle));
            float u0 = view / (float)views, u1 = (view + 1) / (float)views;
            foreach (var side in new[] { 1f, -1f })
            {
                var n = Vector3.Normalize(toward * side + Vector3.UnitY * 0.35f);
                var first = m.VertexCount;
                // On the back the picture is seen mirrored, as it would be.
                foreach (var (x, y) in new[] { (-1f, 0f), (1f, 0f), (1f, 1f), (-1f, 1f) })
                {
                    var p = right * x * halfWidth + Vector3.UnitY * y * height;
                    var w = wind ? new Vector4(y * y, 0, 0, 0) : Vector4.Zero;
                    m.AddVertex(p, n, new Vector2(u0 + (u1 - u0) * (x * 0.5f + 0.5f), 1 - y), w);
                }
                if (side > 0) sub.Indices.AddRange([first, first + 1, first + 2, first, first + 2, first + 3]);
                else sub.Indices.AddRange([first, first + 2, first + 1, first, first + 3, first + 2]);
            }
        }
        return m;
    }

    /// <summary>A triangle in world space with what drawing it needs.</summary>
    internal readonly record struct Tri(Vector3 A, Vector3 B, Vector3 C, Vector2 Ua, Vector2 Ub, Vector2 Uc, Vector3 Na, Vector3 Nb, Vector3 Nc, Vector4 Ca, Vector4 Cb, Vector4 Cc, Material3D Mat);

    /// <summary>Every mesh's triangles in world space (nodes carry only translation and rotation).</summary>
    internal static List<Tri> Triangles(Asset3D asset)
    {
        var tris = new List<Tri>();
        void Walk(Node3D n, Matrix4x4 parent)
        {
            var world = Matrix4x4.CreateFromQuaternion(n.Rotation) * Matrix4x4.CreateTranslation(n.Translation) * parent;
            if (n.Mesh is { } m)
                foreach (var s in m.Submeshes)
                {
                    var mat = s.Material >= 0 && s.Material < asset.Materials.Count ? asset.Materials[s.Material] : new Material3D();
                    for (var i = 0; i + 2 < s.Indices.Count; i += 3)
                    {
                        int a = s.Indices[i], b = s.Indices[i + 1], c = s.Indices[i + 2];
                        Vector3 P(int v) => Vector3.Transform(m.Positions[v], world);
                        Vector3 N(int v) => m.Normals.Count > v ? Vector3.Normalize(Vector3.TransformNormal(m.Normals[v], world)) : Vector3.UnitY;
                        Vector2 U(int v) => m.UV0.Count > v ? m.UV0[v] : Vector2.Zero;
                        Vector4 C(int v) => m.Colors.Count > v ? m.Colors[v] : Vector4.One;
                        tris.Add(new Tri(P(a), P(b), P(c), U(a), U(b), U(c), N(a), N(b), N(c), C(a), C(b), C(c), mat));
                    }
                }
            foreach (var c in n.Children) Walk(c, world);
        }
        Walk(asset.Root, Matrix4x4.Identity);
        return tris;
    }

    internal static Vector4 Sample(RawImage? img, Vector2 uv)
    {
        if (img == null) return Vector4.One;
        var u = uv.X - MathF.Floor(uv.X);
        var v = uv.Y - MathF.Floor(uv.Y);
        var x = Math.Clamp((int)(u * img.Width), 0, img.Width - 1);
        var y = Math.Clamp((int)(v * img.Height), 0, img.Height - 1);
        var i = (y * img.Width + x) * 4;
        return new Vector4(img.Rgba[i], img.Rgba[i + 1], img.Rgba[i + 2], img.Rgba[i + 3]) / 255f;
    }

    private static Vector3 Average(float[] rgba)
    {
        var sum = Vector3.Zero;
        var n = 0;
        for (var i = 0; i < rgba.Length; i += 4)
            if (rgba[i + 3] > 0) { sum += new Vector3(rgba[i], rgba[i + 1], rgba[i + 2]); n++; }
        return n > 0 ? sum / n : new Vector3(0.3f, 0.4f, 0.2f);
    }

    private static float Srgb(float linear) => linear <= 0.0031308f ? linear * 12.92f : 1.055f * MathF.Pow(linear, 1 / 2.4f) - 0.055f;
    private static byte B(float v) => (byte)Math.Clamp((int)MathF.Round(v * 255), 0, 255);
}
