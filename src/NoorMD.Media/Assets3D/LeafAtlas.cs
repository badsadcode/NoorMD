using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// Draws the foliage card texture: a 2 × 2 atlas of twig sprites (leaves on a little stem), each with its anchor at the
/// bottom middle of its cell and growing straight up, so cards can be placed without hand-made hotpoints. Transparent
/// pixels carry the leaf colour, so mipmaps don't get dark fringes. Realistic leaves get veins and shading; stylized
/// ones are flat, bright and outlined like hand-painted game art.
/// </summary>
public static class LeafAtlas
{
    /// <summary>Atlas cell i (0–3) as a UV rectangle (u0, v0, u1, v1), v growing downwards as in glTF.</summary>
    public static Vector4 Cell(int i) => new((i & 1) * 0.5f, (i >> 1) * 0.5f, (i & 1) * 0.5f + 0.5f, (i >> 1) * 0.5f + 0.5f);

    public static byte[] Rgba(string shape, string color, string color2, bool stylized, int size, int seed)
    {
        var px = new float[size * size * 4];
        var c1 = Hex(color);
        var c2 = Hex(color2);
        var stem = Vector3.Lerp(c1, new Vector3(0.35f, 0.27f, 0.15f), 0.6f);
        var half = size / 2;
        for (var cell = 0; cell < 4; cell++)
        {
            var rng = new Random(seed * 31 + cell);
            int ox = (cell & 1) * half, oy = (cell >> 1) * half;
            // Sprite space: x −1…1 across, y 0 (anchor, bottom) … 1 (top).
            var leaves = new List<(Vector2 Base, Vector2 Dir, float Len, float Width, Vector3 Col)>();
            var stemBend = (float)(rng.NextDouble() - 0.5) * 0.3f;
            Vector2 StemAt(float t) => new(stemBend * t * t, t * 0.92f);
            // Stylized sprites are fuller: a tuft of leaves, not a twig.
            var count = shape switch { "needle" => 70, "maple" => 3, "round" => 9, _ => 7 } + (stylized && shape != "needle" ? 5 : 0);
            for (var k = 0; k < count; k++)
            {
                var t = shape == "needle" ? 0.04f + 0.92f * k / count : 0.18f + 0.8f * (k + 0.5f) / count;
                var side = k % 2 == 0 ? 1 : -1;
                var spread = shape switch { "needle" => 0.75f, "maple" => 0.75f, _ => 0.85f };
                var angle = side * (spread + (float)(rng.NextDouble() - 0.5) * 0.4f) * (1 - 0.5f * t);
                var dir = Vector2.Normalize(new Vector2(MathF.Sin(angle), MathF.Cos(angle)));
                var len = shape switch { "needle" => 0.42f, "round" => 0.28f, "maple" => 0.5f, _ => 0.4f } * (1 - 0.35f * t) * (0.85f + 0.3f * (float)rng.NextDouble());
                var width = shape switch { "needle" => 0.07f, "round" => 0.55f, "maple" => 0.9f, _ => 0.36f };
                var col = Vector3.Lerp(c1, c2, (float)rng.NextDouble() * 0.8f + t * 0.2f);
                leaves.Add((StemAt(t), dir, len, width, col));
            }
            // The top leaf, straight on.
            if (shape != "needle") leaves.Add((StemAt(0.97f), Vector2.UnitY, shape == "maple" ? 0.5f : 0.36f, shape == "round" ? 0.55f : shape == "maple" ? 0.9f : 0.36f, Vector3.Lerp(c1, c2, 0.6f)));

            for (var y = 0; y < half; y++)
                for (var x = 0; x < half; x++)
                {
                    // Pixel centre to sprite space (row 0 is the top of the image).
                    var sx = ((x + 0.5f) / half * 2 - 1) * 0.55f;
                    var sy = 1 - (y + 0.5f) / half;
                    var p = new Vector2(sx, sy);
                    var aa = 1.6f / half;
                    float alpha = 0;
                    var rgb = c1;
                    // Stem.
                    var ds = float.MaxValue;
                    for (var k = 0; k < 6; k++) ds = MathF.Min(ds, SegmentDistance(p, StemAt(k / 6f * 0.97f), StemAt((k + 1) / 6f * 0.97f)));
                    ds -= 0.012f * (1.2f - sy);
                    var stemA = Math.Clamp(0.5f - ds / aa, 0, 1);
                    if (stemA > 0) { alpha = stemA; rgb = stem; }
                    foreach (var (b, dir, len, width, col) in leaves)
                    {
                        var (d, along, across) = LeafDistance(shape, p - b, dir, len, width);
                        var a = Math.Clamp(0.5f - d / aa, 0, 1);
                        if (a <= 0) continue;
                        Vector3 c;
                        if (stylized)
                        {
                            // Flat paint: light top edge, darker rim, no veins.
                            var rim = Math.Clamp(-d / (aa * 3), 0, 1);
                            c = Vector3.Lerp(col * 0.55f, col * (1.05f + 0.25f * along), rim);
                        }
                        else
                        {
                            // Shading across the blade, a darker midrib and a few side veins.
                            var shade = 0.82f + 0.25f * (1 - MathF.Abs(across)) + 0.1f * along;
                            var rib = MathF.Exp(-MathF.Pow(across / 0.06f, 2)) * 0.25f;
                            var veins = shape is "broad" or "maple" ? MathF.Pow(MathF.Max(0, MathF.Sin((along * 9 - MathF.Abs(across) * 3) * MathF.PI)), 24) * 0.12f : 0;
                            c = col * (shade - rib - veins);
                        }
                        // Later leaves cover earlier ones.
                        rgb = Vector3.Lerp(rgb, c, alpha <= 0 ? 1 : a);
                        alpha = MathF.Max(alpha, a);
                    }
                    var i = ((oy + y) * size + ox + x) * 4;
                    px[i] = rgb.X; px[i + 1] = rgb.Y; px[i + 2] = rgb.Z; px[i + 3] = alpha;
                }
        }
        // Transparent pixels take the leaf colour (no dark halo when the texture is filtered).
        var bytes = new byte[size * size * 4];
        for (var i = 0; i < size * size; i++)
        {
            var a = px[i * 4 + 3];
            var rgb = a > 0.02f ? new Vector3(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) : c1;
            bytes[i * 4] = ToByte(rgb.X); bytes[i * 4 + 1] = ToByte(rgb.Y); bytes[i * 4 + 2] = ToByte(rgb.Z); bytes[i * 4 + 3] = ToByte(a);
        }
        return PngWriter.Rgba(size, size, bytes);
    }

    /// <summary>A soft vertical gradient (dark at the bottom of the crown, light at the top) for stylized leaf clumps.</summary>
    public static byte[] Gradient(string color, string color2, int height = 64)
    {
        var c1 = Hex(color) * 0.7f;
        var c2 = Hex(color2);
        var px = new byte[4 * height * 4];
        for (var y = 0; y < height; y++)
        {
            var t = 1 - y / (float)(height - 1);      // top row = light
            var c = Vector3.Lerp(c1, c2, MathF.Pow(t, 1.3f));
            for (var x = 0; x < 4; x++)
            {
                var i = (y * 4 + x) * 4;
                px[i] = ToByte(c.X); px[i + 1] = ToByte(c.Y); px[i + 2] = ToByte(c.Z); px[i + 3] = 255;
            }
        }
        return PngWriter.Rgba(4, height, px);
    }

    /// <summary>Signed distance to one leaf blade, and where the point is along (0–1) and across (−1…1) it.</summary>
    private static (float D, float Along, float Across) LeafDistance(string shape, Vector2 p, Vector2 dir, float len, float width)
    {
        var side = new Vector2(dir.Y, -dir.X);
        var along = Vector2.Dot(p, dir) / len;
        var across = Vector2.Dot(p, side);
        if (shape == "maple")
        {
            // Five pointed lobes around the base of the blade.
            var q = p / len;
            var ang = MathF.Atan2(Vector2.Dot(q, side), Vector2.Dot(q, dir));
            var r = q.Length();
            var lobes = 0.55f + 0.4f * MathF.Pow(MathF.Abs(MathF.Cos(ang * 2.5f)), 3);
            var inFront = MathF.Abs(ang) < 2.3f ? 1 : 0.2f;
            var d = (r - lobes * inFront * 0.9f) * len;
            return (d, Math.Clamp(r, 0, 1), Math.Clamp(ang / 2.3f, -1, 1));
        }
        // Blade half-width along its length: pointed at both ends, widest a third of the way up.
        var t = Math.Clamp(along, 0, 1);
        var profile = shape switch
        {
            "round" => MathF.Sqrt(MathF.Max(0, 1 - MathF.Pow(2 * t - 1, 2))),
            "needle" => 1 - t * 0.5f,
            _ => MathF.Pow(MathF.Sin(MathF.PI * MathF.Pow(t, 0.75f)), 0.9f),
        };
        var halfWidth = width * len * 0.5f * profile + 1e-4f;
        var outside = along < 0 ? -along * len : along > 1 ? (along - 1) * len : 0;
        var dist = MathF.Max(MathF.Abs(across) - halfWidth, 0) + outside;
        var inside = MathF.Min(halfWidth - MathF.Abs(across), MathF.Min(along, 1 - along) * len);
        return (outside > 0 || MathF.Abs(across) > halfWidth ? dist : -inside, t, Math.Clamp(across / Math.Max(halfWidth, 1e-4f), -1, 1));
    }

    private static float SegmentDistance(Vector2 p, Vector2 a, Vector2 b)
    {
        var ab = b - a;
        var t = Math.Clamp(Vector2.Dot(p - a, ab) / ab.LengthSquared(), 0, 1);
        return Vector2.Distance(p, a + ab * t);
    }

    internal static Vector3 Hex(string hex) =>
        hex is { Length: 7 } ? new Vector3(Convert.ToInt32(hex[1..3], 16), Convert.ToInt32(hex[3..5], 16), Convert.ToInt32(hex[5..7], 16)) / 255f : new Vector3(0.3f, 0.5f, 0.2f);

    private static byte ToByte(float v) => (byte)Math.Clamp((int)MathF.Round(v * 255), 0, 255);
}
